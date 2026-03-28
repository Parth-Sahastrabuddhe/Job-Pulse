import fs from "node:fs/promises";
import path from "node:path";
import childProcess from "node:child_process";
import { PROJECT_ROOT } from "./config.js";
import { loadJobData } from "./job-description.js";

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

Output ONLY the fit assessment block in the exact format specified in Step 1, then stop. Do not output anything after the closing ═══ line.
`;

async function getGeminiApiKey() {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (key) return key;

  // Try reading from .env file directly
  try {
    const envContent = await fs.readFile(path.join(PROJECT_ROOT, ".env"), "utf8");
    const match = envContent.match(/GEMINI_API_KEY=(.+)/);
    if (match) return match[1].trim();
  } catch {}

  return null;
}

async function runGemini(prompt) {
  const apiKey = await getGeminiApiKey();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not set in .env");
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 8192
        }
      })
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${error.slice(0, 300)}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("Gemini returned empty response");
  }

  return text;
}

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

  return result;
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
