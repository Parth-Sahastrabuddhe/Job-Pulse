import fs from "node:fs/promises";
import path from "node:path";
import childProcess from "node:child_process";
import { PROJECT_ROOT } from "./config.js";
import { loadJobData } from "./job-description.js";
import { getGeminiApiKey, runGemini } from "./gemini.js";

const RESUME_DIR = path.join(PROJECT_ROOT, "resume");

async function readResumeFiles() {
  const baseResume = await fs.readFile(path.join(RESUME_DIR, "base.tex"), "utf8");
  const skills = await fs.readFile(path.join(RESUME_DIR, "skills.md"), "utf8");
  const prompt = await fs.readFile(path.join(RESUME_DIR, "prompt.md"), "utf8");
  return { baseResume, skills, prompt };
}

const FIT_CHECK_SUFFIX = `

---

## IMPORTANT: FIT CHECK ONLY MODE

This is being run in an automated pipeline. ONLY perform Step 1 (Fit Assessment). Do NOT proceed to Steps 2 or 3. Do NOT output any LaTeX or resume changes.

### Additional analysis required (include in Reasoning):

1. **Years of experience check**: If the JD specifies minimum years (e.g., "5+ years"), compare against the candidate's 3.5 years of industry experience + MS degree. Flag if underqualified.

2. **H1B/Visa sponsorship check**: Look for phrases like "no sponsorship", "must be authorized to work", "US citizen or permanent resident required", "will not sponsor". If found, set Should Apply to NO and explain why. If the JD is silent on sponsorship or says "visa sponsorship available", note that positively. The candidate requires H1B sponsorship.

3. **Company context**: Consider the company's typical tech stack. For example:
   - Banks/fintech (JPMorgan, Goldman, Citi, Capital One) → strong .NET/C#/Java fit
   - Big tech (Google, Meta, Amazon) → Java/C++/Python expected, .NET is a gap
   - Startups → language-flexible, systems experience matters more

4. **ATS Score calculation**: Score based on this weighted breakdown:
   - 40% — Technical skills keyword match (languages, frameworks, tools in JD vs resume)
   - 25% — Experience type match (backend/distributed/APIs/microservices vs what JD asks)
   - 20% — Domain/industry alignment (fintech, cloud, platform, etc.)
   - 15% — Level alignment (years of experience, seniority signals)
   Show the breakdown in reasoning.

5. **Stack gap analysis**: If the JD requires Java/Go/Python as primary and candidate's primary is C#/.NET, note this as a gap but acknowledge transferability if the systems concepts align.

Output ONLY the fit assessment block in the exact format specified in Step 1.

6. **Structured scores**: After the closing ═══ line, output exactly one line in this format (valid JSON, no markdown):
FIT_SCORES:{"score":82,"skills":85,"experience":75,"domain":90,"level":78}

Where:
- score = weighted total (skills*0.4 + experience*0.25 + domain*0.2 + level*0.15, rounded)
- skills = technical skills keyword match (0-100)
- experience = experience type match (0-100)
- domain = domain/industry alignment (0-100)
- level = seniority/years alignment (0-100)

If sponsorship is blocked, set score to 0. Output nothing after the FIT_SCORES line.
`;

// getGeminiApiKey and runGemini are now imported from ./gemini.js

// Fallback to Claude CLI if Gemini is not configured
function runClaude(prompt) {
  const { spawn } = childProcess;
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn("claude", ["-p", "--output-format", "text"], {
      cwd: PROJECT_ROOT,
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => { stdout += data.toString(); });
    child.stderr.on("data", (data) => { stderr += data.toString(); });

    child.on("error", (error) => {
      if (!settled) { settled = true; reject(new Error(`Claude CLI spawn failed: ${error.message}`)); }
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      if (code !== 0) {
        reject(new Error(`Claude CLI exited with code ${code}: ${stderr.slice(0, 500)}`));
        return;
      }
      resolve(stdout);
    });

    child.stdin.write(prompt);
    child.stdin.end();

    setTimeout(() => {
      if (!settled) { settled = true; child.kill(); reject(new Error("Claude CLI timed out after 5 minutes")); }
    }, 300_000);
  });
}

export async function fitCheckResume(jobDirId, log = console.log) {
  log(`Loading job data for: ${jobDirId}`);
  const { meta, description, dir } = await loadJobData(jobDirId);

  if (!description) {
    throw new Error(`No job description found in ${dir}/description.txt`);
  }

  log(`Loading resume files...`);
  const { baseResume, skills, prompt } = await readResumeFiles();

  log(`Assembling fit-check prompt for: ${meta.title} @ ${meta.sourceLabel}`);
  const filledPrompt = prompt
    .replace("{{BASE_RESUME}}", baseResume)
    .replace("{{SKILLS}}", skills)
    .replace("{{JOB_DESCRIPTION}}", description)
    .replace("{{JOB_TITLE}}", meta.title || "")
    .replace("{{COMPANY}}", meta.sourceLabel || "")
    .replace("{{LOCATION}}", meta.location || "")
    .replace("{{JOB_URL}}", meta.url || "");

  const fitOnlyPrompt = filledPrompt + FIT_CHECK_SUFFIX;

  // Try Gemini first, fall back to Claude CLI
  let output;
  let engine = "unknown";
  const geminiKey = await getGeminiApiKey();
  if (geminiKey) {
    try {
      log(`Running fit check via Gemini API...`);
      output = await runGemini(fitOnlyPrompt);
      engine = "Gemini 2.5 Flash";
    } catch (geminiError) {
      log(`Gemini failed (${geminiError.message.slice(0, 80)}), falling back to Claude CLI...`);
      output = await runClaude(fitOnlyPrompt);
      engine = "Claude (fallback)";
    }
  } else {
    log(`Running fit check via Claude CLI (set GEMINI_API_KEY in .env for faster checks)...`);
    output = await runClaude(fitOnlyPrompt);
    engine = "Claude CLI";
  }

  const result = parseFitCheckOutput(output);
  result.engine = engine;
  result.dir = dir;
  result.meta = meta;
  return result;
}

function parseFitCheckOutput(output) {
  const result = {
    fitAssessment: "",
    shouldApply: "UNKNOWN",
    fitScore: null,
    fitScores: null,
  };

  // Extract fit assessment block
  const fullBlock = output.match(/(═{3,}[\s\S]*?FIT ASSESSMENT[\s\S]*?═{3,}[\s\S]*?═{3,})/);
  if (fullBlock) {
    result.fitAssessment = fullBlock[1].trim();
  }

  // Determine recommendation
  if (/Should Apply:\s*YES/i.test(output)) {
    result.shouldApply = "YES";
  } else if (/Should Apply:\s*STRETCH/i.test(output)) {
    result.shouldApply = "STRETCH";
  } else if (/Should Apply:\s*NO/i.test(output)) {
    result.shouldApply = "NO";
  }

  // Extract structured scores
  const scoresMatch = output.match(/FIT_SCORES:\s*(\{[^}]+\})/);
  if (scoresMatch) {
    try {
      const scores = JSON.parse(scoresMatch[1]);
      if (typeof scores.score === "number") {
        result.fitScore = scores.score;
        result.fitScores = scores;
      }
    } catch {}
  }

  return result;
}

const TAILOR_SUFFIX = `

---

## IMPORTANT: FULL TAILORING MODE

Run ALL three steps: Fit Assessment (Step 1), Change Decision (Step 2), and Output (Step 3).

Output the COMPLETE modified LaTeX resume — not just changed sections. I need the full .tex file content so it can be compiled directly to PDF. Output it inside a single \`\`\`latex code block.

If the fit assessment is NO (ATS < 70% or sponsorship blocked), still output the best possible tailored resume — the candidate will decide whether to apply.

After outputting the full LaTeX, output the fit assessment block as well.
`;

export async function tailorResume(jobDirId, log = console.log) {
  log(`Loading job data for: ${jobDirId}`);
  const { meta, description, dir } = await loadJobData(jobDirId);

  if (!description) {
    throw new Error(`No job description found in ${dir}/description.txt`);
  }

  log(`Loading resume files...`);
  const { baseResume, skills, prompt } = await readResumeFiles();

  log(`Assembling tailor prompt for: ${meta.title} @ ${meta.sourceLabel}`);
  const filledPrompt = prompt
    .replace("{{BASE_RESUME}}", baseResume)
    .replace("{{SKILLS}}", skills)
    .replace("{{JOB_DESCRIPTION}}", description)
    .replace("{{JOB_TITLE}}", meta.title || "")
    .replace("{{COMPANY}}", meta.sourceLabel || "")
    .replace("{{LOCATION}}", meta.location || "")
    .replace("{{JOB_URL}}", meta.url || "");

  const fullPrompt = filledPrompt + TAILOR_SUFFIX;

  // Always use Claude CLI for tailoring — needs high quality
  log(`Running full resume tailoring via Claude CLI...`);
  const output = await runClaude(fullPrompt);

  // Extract the full LaTeX from the output
  const latexMatch = output.match(/```latex\s*([\s\S]*?)```/);
  if (!latexMatch) {
    throw new Error("Claude did not output a LaTeX code block");
  }

  const tailoredLatex = latexMatch[1].trim();

  // Also extract fit assessment
  const fitResult = parseFitCheckOutput(output);

  // Write the tailored LaTeX to a temp file
  const outputDir = path.join(PROJECT_ROOT, "data", "tailored");
  await fs.mkdir(outputDir, { recursive: true });

  const safeName = `${meta.sourceLabel}-${meta.title}`.replace(/[^a-zA-Z0-9-]/g, "_").slice(0, 60);
  const texFile = path.join(outputDir, `${safeName}.tex`);
  await fs.writeFile(texFile, tailoredLatex, "utf8");

  // Compile to PDF
  log(`Compiling tailored resume to PDF...`);
  const pdfPath = await compileLaTeX(texFile, outputDir, log);

  // Check page count
  const pageCount = await getPdfPageCount(pdfPath);
  if (pageCount > 1) {
    log(`WARNING: Resume is ${pageCount} pages. Needs trimming.`);
  }

  return {
    pdfPath,
    texFile,
    pageCount,
    fitAssessment: fitResult.fitAssessment,
    shouldApply: fitResult.shouldApply,
    meta,
    safeName
  };
}

async function compileLaTeX(texFile, outputDir, log) {
  const { execSync } = childProcess;
  const texDir = path.dirname(texFile);
  const texName = path.basename(texFile);

  try {
    execSync(
      `pdflatex -interaction=nonstopmode -output-directory="${outputDir}" "${texFile}"`,
      { cwd: texDir, stdio: "pipe", timeout: 30000 }
    );
  } catch (error) {
    // pdflatex returns non-zero on warnings too — check if PDF was created
    const pdfName = texName.replace(".tex", ".pdf");
    const pdfPath = path.join(outputDir, pdfName);
    try {
      await fs.access(pdfPath);
      log("LaTeX compiled with warnings (PDF created)");
      return pdfPath;
    } catch {
      throw new Error(`LaTeX compilation failed: ${error.message.slice(0, 300)}`);
    }
  }

  const pdfName = path.basename(texFile).replace(".tex", ".pdf");
  return path.join(outputDir, pdfName);
}

async function getPdfPageCount(pdfPath) {
  try {
    const content = await fs.readFile(pdfPath);
    // Count /Type /Page entries in PDF (rough but works)
    const matches = content.toString("latin1").match(/\/Type\s*\/Page[^s]/g);
    return matches ? matches.length : 1;
  } catch {
    return 1;
  }
}

// Tailor from a URL (for /tailor command)
export async function tailorFromUrl(jobUrl, log = console.log) {
  // Import dynamically to avoid circular deps
  const { fetchJobDescription } = await import("./job-description.js");

  log(`Fetching job description from: ${jobUrl}`);

  // Identify company from URL using the same patterns as Discord bot
  let sourceKey = "unknown";
  let sourceLabel = "Unknown";
  let jobId = "";

  // Dynamic: import JOB_URL_PATTERNS from discord-bot to match against all 100+ companies
  try {
    const discordBot = await import("./discord-bot.js");
    // discord-bot.js doesn't export JOB_URL_PATTERNS, so fall back to regex matching
  } catch {}

  // Match against known ATS URL patterns
  const urlPatterns = [
    { key: "microsoft", label: "Microsoft", test: /apply\.careers\.microsoft\.com/i },
    { key: "amazon", label: "Amazon", test: /amazon\.jobs/i },
    { key: "google", label: "Google", test: /google\.com\/.*careers/i },
    { key: "meta", label: "Meta", test: /metacareers\.com/i },
    { key: "greenhouse", label: "Company", test: /greenhouse\.io|boards-api\.greenhouse/i },
    { key: "lever", label: "Company", test: /lever\.co/i },
    { key: "ashby", label: "Company", test: /ashbyhq\.com/i },
    { key: "workday", label: "Company", test: /myworkdayjobs\.com/i },
    { key: "smartrecruiters", label: "Company", test: /smartrecruiters\.com/i },
    { key: "oraclecloud", label: "Company", test: /oraclecloud\.com/i },
  ];

  for (const { key, label, test } of urlPatterns) {
    if (test.test(jobUrl)) {
      sourceKey = key;
      sourceLabel = label;
      // Try to extract company name from URL for better labeling
      if (key === "greenhouse") {
        const slugMatch = jobUrl.match(/boards\.greenhouse\.io\/(\w+)/i);
        if (slugMatch) sourceLabel = slugMatch[1].charAt(0).toUpperCase() + slugMatch[1].slice(1);
      } else if (key === "lever") {
        const slugMatch = jobUrl.match(/lever\.co\/(\w+)/i);
        if (slugMatch) sourceLabel = slugMatch[1].charAt(0).toUpperCase() + slugMatch[1].slice(1);
      } else if (key === "ashby") {
        const slugMatch = jobUrl.match(/ashbyhq\.com\/(\w+)/i);
        if (slugMatch) sourceLabel = slugMatch[1].charAt(0).toUpperCase() + slugMatch[1].slice(1);
      } else if (key === "workday") {
        const slugMatch = jobUrl.match(/(\w+)\.wd\d+\.myworkdayjobs/i);
        if (slugMatch) sourceLabel = slugMatch[1].charAt(0).toUpperCase() + slugMatch[1].slice(1);
      }
      break;
    }
  }

  // Extract job ID from URL
  const idMatch = jobUrl.match(/(\d{5,})|([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
  jobId = idMatch ? idMatch[0] : "unknown";

  const description = await fetchJobDescription({ sourceKey, id: jobId, url: jobUrl, sourceLabel });
  if (!description || description.length < 50) {
    throw new Error("Could not fetch job description from the provided URL");
  }

  // Save job data
  const dirId = `${sourceKey}-${jobId}`.replace(/[^a-zA-Z0-9_-]/g, "_");
  const jobDir = path.join(PROJECT_ROOT, "data", "jobs", dirId);
  await fs.mkdir(jobDir, { recursive: true });
  await fs.writeFile(path.join(jobDir, "description.txt"), description, "utf8");
  await fs.writeFile(path.join(jobDir, "meta.json"), JSON.stringify({
    id: jobId, sourceKey, sourceLabel, title: "Unknown", location: "", url: jobUrl
  }), "utf8");

  // Extract title from description
  const titleMatch = description.match(/Title:\s*(.+)/);
  const title = titleMatch ? titleMatch[1].trim() : "Software Engineer";

  // Update meta with real title
  await fs.writeFile(path.join(jobDir, "meta.json"), JSON.stringify({
    id: jobId, sourceKey, sourceLabel, title, location: "", url: jobUrl
  }), "utf8");

  return tailorResume(dirId, log);
}

// CLI entry point
const isDirectRun = process.argv[1]?.endsWith("tailor.js");

async function main() {
  const jobDirId = process.argv[2];
  if (!jobDirId) {
    console.error("Usage: npm run tailor <job-id>");
    console.error("Example: npm run tailor microsoft-1970393556814249");
    process.exitCode = 1;
    return;
  }

  try {
    const result = await fitCheckResume(jobDirId, console.log);
    console.log(`\nFit: ${result.shouldApply}`);
    if (result.fitAssessment) console.log(result.fitAssessment);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}

if (isDirectRun) {
  main();
}
