import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
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

## IMPORTANT: FIT CHECK ONLY

This is being run in an automated pipeline. ONLY perform Step 1 (Fit Assessment). Do NOT proceed to Steps 2 or 3. Do NOT output any LaTeX or resume changes. Just output the fit assessment block and stop.
`;

function runClaude(prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", ["-p", "--output-format", "text"], {
      cwd: PROJECT_ROOT,
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => { stdout += data.toString(); });
    child.stderr.on("data", (data) => { stderr += data.toString(); });

    child.on("error", (error) => {
      reject(new Error(`Claude CLI spawn failed: ${error.message}`));
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Claude CLI exited with code ${code}: ${stderr.slice(0, 500)}`));
        return;
      }
      resolve(stdout);
    });

    child.stdin.write(prompt);
    child.stdin.end();

    // 5 minute timeout
    setTimeout(() => {
      child.kill();
      reject(new Error("Claude CLI timed out after 5 minutes"));
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

  log(`Running Claude Code CLI for fit check...`);
  const output = await runClaude(fitOnlyPrompt);

  const result = parseFitCheckOutput(output);
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
