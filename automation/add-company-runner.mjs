#!/usr/bin/env node
/**
 * add-company-runner.mjs: the unattended /add pipeline.
 *
 * Runs on the dev box (NOT EC2; EC2 cannot run claude). Polls company_queue on
 * EC2 over ssh and, for each claimed item:
 *
 *   1. creates a detached git worktree from ADD_RUNNER_BASE_REF (origin/main)
 *   2. copies the add-company skill into it and runs `claude -p` (UNATTENDED=1)
 *   3. re-verifies everything itself: result file, diff allowlist, node
 *      --check, registry integrity, live collector probe
 *   4. commits, rebases onto origin/main, pushes to main
 *   5. deploys on EC2 (branch check, ff-only pull, syntax checks, probe,
 *      pm2 restart micro-bot jobpulse-mu, post-restart online check), rolling
 *      EC2 back to the previous SHA if any deploy step fails
 *   6. marks the queue row and DMs the admin the outcome
 *
 * Modes:
 *   node automation/add-company-runner.mjs                  poll loop (pm2)
 *   node automation/add-company-runner.mjs --once           single queue pass
 *   node automation/add-company-runner.mjs --once --dry-run --company "Figma"
 *     test mode: fabricated queue item, base ref defaults to local main,
 *     no push / deploy / DM / queue writes; prints the report JSON
 *   --keep-worktree   keep the worktree for inspection
 *   --base <ref>      worktree base (default origin/main; main when --dry-run)
 *
 * Safety:
 *   - single-instance lock in ~/.jobpulse-add-runner/
 *   - the claude session runs with acceptEdits + a Bash allowlist (curl/node/
 *     grep/ls/head/tail/sort/wc/cat): no git, no ssh, no npm from the session
 *   - the runner never trusts the session's self-report; it re-checks the diff
 *   - at most MAX_ITEMS_PER_PASS queue items per pass
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = process.env.JOBPULSE_REPO || path.resolve(__dirname, "..");

const EC2_HOST = process.env.ADD_RUNNER_EC2_HOST || "ubuntu@3.138.62.29";
const EC2_KEY = process.env.ADD_RUNNER_EC2_KEY || path.join(REPO, "data", "jobpulse.pem");
const EC2_REPO = process.env.ADD_RUNNER_EC2_REPO || "/home/ubuntu/Job-Pulse";

const CLAUDE_BIN = process.env.ADD_RUNNER_CLAUDE_BIN || "claude";
const CLAUDE_MODEL = process.env.ADD_RUNNER_MODEL || "sonnet";
const CLAUDE_TIMEOUT_MS = Number(process.env.ADD_RUNNER_TIMEOUT_MS) || 30 * 60 * 1000;
const POLL_INTERVAL_MS = (Number(process.env.ADD_RUNNER_POLL_SECONDS) || 300) * 1000;
const MAX_ITEMS_PER_PASS = Number(process.env.ADD_RUNNER_MAX_PER_PASS) || 3;

const HOME_DIR = path.join(os.homedir(), ".jobpulse-add-runner");
const LOCK_DIR = path.join(HOME_DIR, "lock");
const LOG_DIR = path.join(HOME_DIR, "logs");
const WT_ROOT = path.join(HOME_DIR, "wt");

const ALLOWED_TOOLS = [
  "Read", "Grep", "Glob", "Edit", "Write",
  "Bash(curl:*)", "Bash(node:*)", "Bash(grep:*)", "Bash(ls:*)",
  "Bash(head:*)", "Bash(tail:*)", "Bash(sort:*)", "Bash(wc:*)", "Bash(cat:*)",
];

const argv = process.argv.slice(2);
const flags = {
  once: argv.includes("--once"),
  dryRun: argv.includes("--dry-run"),
  keepWorktree: argv.includes("--keep-worktree"),
  company: argv.includes("--company") ? argv[argv.indexOf("--company") + 1] : null,
  base: argv.includes("--base") ? argv[argv.indexOf("--base") + 1] : null,
};
const BASE_REF = flags.base || (flags.dryRun ? "main" : "origin/main");

function ts() {
  return new Date().toISOString();
}

function log(msg) {
  console.log(`[${ts()}] ${msg}`);
}

function run(cmd, args, { cwd = REPO, timeout = 120_000, input } = {}) {
  const res = spawnSync(cmd, args, {
    cwd,
    timeout,
    input,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    env: process.env,
  });
  return {
    ok: res.status === 0 && !res.error,
    status: res.status,
    stdout: res.stdout || "",
    stderr: res.stderr || "",
    error: res.error ? String(res.error.message || res.error) : (res.signal ? `signal ${res.signal}` : ""),
  };
}

function git(args, opts = {}) {
  return run("git", args, opts);
}

function ssh(script, { timeout = 60_000 } = {}) {
  return run("ssh", [
    "-i", EC2_KEY,
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=10",
    "-o", "StrictHostKeyChecking=accept-new",
    EC2_HOST,
    script,
  ], { timeout });
}

// stdout may carry stray warnings before the JSON; parse the last JSON-looking line.
function parseLastJsonLine(stdout) {
  const lines = stdout.trim().split("\n").reverse();
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith("{") || t.startsWith("[") || t === "null") {
      try { return JSON.parse(t); } catch {}
    }
  }
  return undefined;
}

function claimNext() {
  const res = ssh(`cd ${EC2_REPO} && node scripts/queue-cli.js claim-next`);
  if (!res.ok) {
    log(`claim-next ssh failed: ${res.error || res.stderr.slice(0, 200)}`);
    return null;
  }
  const parsed = parseLastJsonLine(res.stdout);
  return parsed && typeof parsed === "object" ? parsed : null;
}

function completeItem(id, status, notes) {
  if (flags.dryRun) {
    log(`[dry-run] queue complete: id=${id} status=${status} notes=${notes}`);
    return;
  }
  const res = ssh(`cd ${EC2_REPO} && node scripts/queue-cli.js complete ${Number(id)} ${status} ${shellQuote(String(notes || "").slice(0, 400))}`);
  if (!res.ok) log(`queue complete failed for id=${id}: ${res.error || res.stderr.slice(0, 200)}`);
}

function notifyAdmin(text) {
  if (flags.dryRun) {
    log(`[dry-run] would DM admin: ${text}`);
    return;
  }
  const b64 = Buffer.from(text, "utf8").toString("base64");
  const res = ssh(`cd ${EC2_REPO} && node scripts/notify-admin.js --b64 ${b64}`, { timeout: 45_000 });
  if (!res.ok) log(`admin DM failed: ${res.error || res.stderr.slice(0, 200)}`);
}

function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function acquireLock() {
  fs.mkdirSync(HOME_DIR, { recursive: true });
  try {
    fs.mkdirSync(LOCK_DIR);
    return true;
  } catch {
    try {
      const age = Date.now() - fs.statSync(LOCK_DIR).mtimeMs;
      if (age > 2 * 60 * 60 * 1000) {
        fs.rmdirSync(LOCK_DIR);
        fs.mkdirSync(LOCK_DIR);
        log("recovered stale lock");
        return true;
      }
    } catch {}
    return false;
  }
}

function releaseLock() {
  try { fs.rmdirSync(LOCK_DIR); } catch {}
}

function sanitizeCompanyName(name) {
  return String(name || "").replace(/[`\n\r]/g, " ").trim().slice(0, 80);
}

function slugify(name) {
  return sanitizeCompanyName(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "company";
}

function makeWorktree(item) {
  fs.mkdirSync(WT_ROOT, { recursive: true });
  const wt = path.join(WT_ROOT, `add-${item.id}-${slugify(item.company_name)}-${Date.now()}`);
  const fetch = git(["fetch", "origin"], { timeout: 90_000 });
  if (!fetch.ok) log(`git fetch failed (continuing with local refs): ${fetch.stderr.slice(0, 150)}`);
  const add = git(["worktree", "add", "--detach", wt, BASE_REF]);
  if (!add.ok) throw new Error(`worktree add failed: ${add.stderr.slice(0, 300)}`);
  // The session needs the skill, but .claude/ is gitignored so the worktree
  // starts without it.
  fs.cpSync(path.join(REPO, ".claude", "skills", "add-company"), path.join(wt, ".claude", "skills", "add-company"), { recursive: true });
  return wt;
}

function removeWorktree(wt) {
  if (flags.keepWorktree) {
    log(`keeping worktree for inspection: ${wt}`);
    return;
  }
  const res = git(["worktree", "remove", "--force", wt]);
  if (!res.ok) {
    log(`worktree remove failed (${res.stderr.slice(0, 120)}); forcing rm`);
    try { fs.rmSync(wt, { recursive: true, force: true }); } catch {}
    git(["worktree", "prune"]);
  }
}

function runClaudeSession(wt, companyName, itemId) {
  const prompt = [
    "UNATTENDED=1",
    "",
    `Use the add-company skill to integrate the company "${sanitizeCompanyName(companyName)}" into JobPulse.`,
    "Follow the skill's UNATTENDED mode rules exactly: edit only src/companies.js and",
    "src/config.js, never ask questions, never run git/ssh/deploy commands, and always",
    "finish by writing .add-company-result.json at the repository root, even on failure.",
  ].join("\n");

  const args = [
    "-p", prompt,
    "--output-format", "json",
    "--model", CLAUDE_MODEL,
    "--permission-mode", "acceptEdits",
    "--allowedTools", ...ALLOWED_TOOLS,
  ];

  log(`claude session starting for "${companyName}" (model=${CLAUDE_MODEL}, timeout=${CLAUDE_TIMEOUT_MS / 60000}m)`);
  const res = run(CLAUDE_BIN, args, { cwd: wt, timeout: CLAUDE_TIMEOUT_MS });

  fs.mkdirSync(LOG_DIR, { recursive: true });
  const logFile = path.join(LOG_DIR, `add-${itemId}-${slugify(companyName)}-${Date.now()}.log`);
  fs.writeFileSync(logFile, `ARGS: ${JSON.stringify(args.slice(0, 2))}\n\nSTDOUT:\n${res.stdout}\n\nSTDERR:\n${res.stderr}\n\nERROR: ${res.error}\n`);
  log(`claude session finished (ok=${res.ok}); log: ${logFile}`);
  return res;
}

function readResultFile(wt) {
  try {
    const raw = fs.readFileSync(path.join(wt, ".add-company-result.json"), "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

const KEY_RE = /^[a-z0-9]{2,40}$/;

function verifyWorktree(wt, result) {
  const status = git(["status", "--porcelain"], { cwd: wt });
  if (!status.ok) return { ok: false, reason: "git status failed" };

  const modified = [];
  const disallowed = [];
  for (const line of status.stdout.split("\n")) {
    if (!line.trim()) continue;
    const file = line.slice(3).trim();
    const untracked = line.startsWith("??");
    if (untracked && (file === ".add-company-result.json" || file.startsWith(".claude/"))) continue;
    if (!untracked && (file === "src/companies.js" || file === "src/config.js")) {
      modified.push(file);
      continue;
    }
    disallowed.push(`${line.slice(0, 2)} ${file}`);
  }
  if (disallowed.length) return { ok: false, reason: `session touched disallowed paths: ${disallowed.join("; ").slice(0, 200)}` };
  if (!modified.includes("src/companies.js") || !modified.includes("src/config.js")) {
    return { ok: false, reason: `expected edits to src/companies.js AND src/config.js, saw: ${modified.join(", ") || "none"}` };
  }

  for (const f of ["src/companies.js", "src/config.js"]) {
    const check = run("node", ["--check", f], { cwd: wt });
    if (!check.ok) return { ok: false, reason: `node --check ${f} failed: ${check.stderr.slice(0, 200)}` };
  }

  const key = result.companyKey;
  if (!KEY_RE.test(String(key || ""))) return { ok: false, reason: `bad companyKey in result: ${JSON.stringify(key)}` };

  const integrity = run("node", ["-e", `
    import(${JSON.stringify(pathToFileURL(path.join(wt, "src", "companies.js")).href)}).then(({ COMPANIES, JOB_URL_PATTERNS }) => {
      const keys = COMPANIES.map(c => c.key);
      if (new Set(keys).size !== keys.length) throw new Error("duplicate keys");
      const c = COMPANIES.find(x => x.key === ${JSON.stringify(key)});
      if (!c) throw new Error("new key missing from COMPANIES");
      if (!(c.urlPattern instanceof RegExp)) throw new Error("urlPattern is not a RegExp");
      if (!JOB_URL_PATTERNS.find(p => p.source === ${JSON.stringify(key)})) throw new Error("derived patterns missing key");
      console.log("registry OK: " + keys.length + " companies");
    }).catch(e => { console.error(e.message); process.exit(1); });
  `], { cwd: wt });
  if (!integrity.ok) return { ok: false, reason: `registry integrity failed: ${(integrity.stderr || integrity.stdout).slice(0, 200)}` };

  const probe = run("node", [path.join(wt, "scripts", "probe-company.js"), key], { cwd: wt, timeout: 120_000 });
  if (!probe.ok) return { ok: false, reason: `local probe failed: ${(probe.stdout || probe.stderr).slice(0, 200)}` };
  let probeData;
  try { probeData = JSON.parse(probe.stdout); } catch { return { ok: false, reason: "local probe output unparseable" }; }
  if (typeof probeData.total !== "number") return { ok: false, reason: "local probe returned no total" };

  return { ok: true, probe: probeData };
}

function commitAndPush(wt, result) {
  const label = result.companyLabel || result.company;
  const add = git(["add", "src/companies.js", "src/config.js"], { cwd: wt });
  if (!add.ok) return { ok: false, reason: "git add failed" };
  const commit = git(["commit", "-m", `feat(companies): add ${label} (${result.ats}, automated /add)`], { cwd: wt });
  if (!commit.ok) return { ok: false, reason: `commit failed: ${commit.stderr.slice(0, 200)}` };

  const fetch = git(["fetch", "origin"], { cwd: wt, timeout: 90_000 });
  if (!fetch.ok) return { ok: false, reason: "pre-push fetch failed" };
  const rebase = git(["rebase", "origin/main"], { cwd: wt });
  if (!rebase.ok) {
    git(["rebase", "--abort"], { cwd: wt });
    return { ok: false, reason: `rebase onto origin/main failed: ${rebase.stderr.slice(0, 200)}` };
  }
  const push = git(["push", "origin", "HEAD:main"], { cwd: wt, timeout: 90_000 });
  if (!push.ok) return { ok: false, reason: `push failed: ${push.stderr.slice(0, 200)}` };

  const sha = git(["rev-parse", "--short", "HEAD"], { cwd: wt }).stdout.trim();
  return { ok: true, sha };
}

function deployToEc2(key) {
  const script = `
set -e
cd ${EC2_REPO}
BR=$(git branch --show-current)
if [ "$BR" != "main" ]; then echo "DEPLOY_ABORT_BRANCH=$BR"; exit 9; fi
PREV=$(git rev-parse HEAD); echo "PREV_SHA=$PREV"
git pull --ff-only
node --check src/companies.js
node --check src/config.js
timeout 120 node scripts/probe-company.js ${key} | head -c 400
echo
pm2 restart micro-bot jobpulse-mu
sleep 20
pm2 jlist | node -e "let r='';process.stdin.on('data',d=>r+=d).on('end',()=>{let a=[];try{a=JSON.parse(r.slice(r.indexOf('[')))}catch{};const bad=['micro-bot','jobpulse-mu'].filter(n=>!a.find(p=>p.name===n&&p.pm2_env&&p.pm2_env.status==='online'));if(bad.length){console.error('OFFLINE:'+bad.join(','));process.exit(1)}console.log('BOTH_ONLINE')})"
echo DEPLOY_OK
`.trim();

  const res = ssh(script, { timeout: 300_000 });
  const prevMatch = res.stdout.match(/PREV_SHA=([0-9a-f]{7,40})/);
  if (res.ok && res.stdout.includes("DEPLOY_OK")) return { ok: true };

  const reason = `deploy failed: ${(res.stdout + res.stderr).slice(-300)}`;
  if (prevMatch) {
    log(`rolling EC2 back to ${prevMatch[1].slice(0, 7)}`);
    const rb = ssh(`cd ${EC2_REPO} && git reset --hard ${prevMatch[1]} && pm2 restart micro-bot jobpulse-mu`, { timeout: 180_000 });
    return { ok: false, reason: `${reason}; EC2 rolled back ${rb.ok ? "OK" : "FAILED"} (main still has the commit, review before next deploy)` };
  }
  return { ok: false, reason: `${reason}; no rollback needed (nothing pulled)` };
}

function processItem(item) {
  const name = sanitizeCompanyName(item.company_name);
  const requestedBy = String(item.requested_by || "").trim();
  const mention = requestedBy ? ` (requested by <@${requestedBy}>)` : "";
  log(`processing queue item #${item.id}: "${name}" (attempt ${item.attempts})`);

  let wt;
  try {
    wt = makeWorktree(item);
  } catch (err) {
    completeItem(item.id, "failed", `worktree setup failed: ${err.message}`);
    notifyAdmin(`❌ **${name}** automated add failed before starting: ${err.message.slice(0, 200)}`);
    return;
  }

  try {
    const session = runClaudeSession(wt, name, item.id);
    const result = readResultFile(wt);

    if (!result) {
      const why = session.ok ? "session wrote no result file" : `claude session failed (${session.error || "nonzero exit"})`;
      completeItem(item.id, "failed", why);
      notifyAdmin(`❌ **${name}** automated add failed: ${why}`);
      return;
    }

    if (result.status === "already_exists") {
      completeItem(item.id, "duplicate", result.reason || "already tracked");
      notifyAdmin(`♻️ **${name}**: ${result.reason || "already tracked"}. Queue item closed.`);
      return;
    }
    if (result.status === "needs_human") {
      completeItem(item.id, "needs_human", result.reason || "unspecified");
      notifyAdmin(`🙋 **${name}** needs a human: ${(result.reason || "unspecified").slice(0, 300)}`);
      return;
    }
    if (result.status !== "added") {
      completeItem(item.id, "failed", result.reason || `status=${result.status}`);
      notifyAdmin(`❌ **${name}** automated add failed: ${(result.reason || `status=${result.status}`).slice(0, 300)}`);
      return;
    }

    const verify = verifyWorktree(wt, result);
    if (!verify.ok) {
      completeItem(item.id, "failed", verify.reason);
      notifyAdmin(`❌ **${name}** failed verification: ${verify.reason.slice(0, 300)}`);
      return;
    }
    const probe = verify.probe;
    log(`verified: ${result.companyKey} (${result.ats}) total=${probe.total} us=${probe.us}`);

    if (flags.dryRun) {
      const diff = git(["diff", "--stat"], { cwd: wt }).stdout.trim();
      console.log(JSON.stringify({ dryRun: true, item: { id: item.id, name }, result, probe: { total: probe.total, us: probe.us, sample: probe.sample?.slice(0, 3) }, diffStat: diff }, null, 2));
      return;
    }

    const pushed = commitAndPush(wt, result);
    if (!pushed.ok) {
      completeItem(item.id, "failed", pushed.reason);
      notifyAdmin(`❌ **${name}** failed at commit/push: ${pushed.reason.slice(0, 300)}`);
      return;
    }

    const deployed = deployToEc2(result.companyKey);
    if (!deployed.ok) {
      completeItem(item.id, "failed", deployed.reason);
      notifyAdmin(`❌ **${name}** pushed (${pushed.sha}) but deploy failed: ${deployed.reason.slice(0, 350)}`);
      return;
    }

    completeItem(item.id, "added", `key=${result.companyKey} ats=${result.ats} jobs=${probe.total} us=${probe.us} sha=${pushed.sha}`);
    notifyAdmin(`✅ **${result.companyLabel || name}** integrated automatically: ${result.ats}, ${probe.total} open roles (${probe.us} US-eligible). Commit \`${pushed.sha}\` is live on EC2.${mention}`);
    log(`item #${item.id} DONE: added ${result.companyKey} @ ${pushed.sha}`);
  } finally {
    removeWorktree(wt);
  }
}

function runPass() {
  let processed = 0;
  while (processed < MAX_ITEMS_PER_PASS) {
    let item;
    if (flags.company) {
      if (processed > 0) break;
      item = { id: 0, company_name: flags.company, requested_by: "", attempts: 1 };
    } else {
      item = claimNext();
    }
    if (!item) break;
    processed++;
    try {
      processItem(item);
    } catch (err) {
      log(`unexpected error on item #${item.id}: ${err.stack || err.message}`);
      completeItem(item.id, "failed", `runner crashed: ${err.message}`.slice(0, 300));
      notifyAdmin(`❌ **${sanitizeCompanyName(item.company_name)}** runner crashed: ${err.message.slice(0, 250)}`);
    }
  }
  return processed;
}

async function main() {
  if (flags.company && !flags.dryRun && !flags.once) {
    console.error("--company requires --once (and usually --dry-run)");
    process.exit(1);
  }
  if (!acquireLock()) {
    log("another runner instance holds the lock; exiting");
    process.exit(0);
  }
  try {
    if (flags.once) {
      const n = runPass();
      log(`pass complete: ${n} item(s) processed`);
      return;
    }
    log(`poll loop started (every ${POLL_INTERVAL_MS / 1000}s, base=${BASE_REF}, model=${CLAUDE_MODEL})`);
    for (;;) {
      try {
        const n = runPass();
        if (n) log(`pass complete: ${n} item(s) processed`);
      } catch (err) {
        log(`pass error: ${err.stack || err.message}`);
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  } finally {
    releaseLock();
  }
}

main();
