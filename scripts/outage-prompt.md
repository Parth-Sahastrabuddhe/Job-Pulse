# Outage Diagnosis Task

You are responding to a healthchecks.io alert that one of the JobPulse bots stopped reporting heartbeat pings. Your job is to diagnose the wedge, propose a fix if appropriate, and open a draft PR for the user to review.

## Context (filled in by the listener)

- **Triggering check:** `{{CHECK_NAME}}`
- **Triggered at (UTC):** `{{TRIGGER_AT_UTC}}`
- **EC2 host:** `{{EC2_HOST}}`
- **SSH key path:** `{{EC2_SSH_KEY_PATH}}`
- **GitHub repo:** `{{GITHUB_REPO}}`
- **Branch base:** `main`
- **Proposed fix branch:** `fix/auto-diagnose-{{UNIX_TS}}`

## What you may do

- SSH to `{{EC2_HOST}}` using `-i "{{EC2_SSH_KEY_PATH}}" -o StrictHostKeyChecking=no -o BatchMode=yes` for read-only diagnostics:
  - `pm2 status`, `pm2 describe <app>`, `pm2 logs <app> --nostream --lines N`
  - `cat /proc/<pid>/wchan`, `cat /proc/<pid>/stat`, `ls /proc/<pid>/task/*/wchan`
  - `ss -tnp` (with sudo if needed for the bot pid namespace)
  - `df -h /`, `free -h`, `uptime`
- Read any file in the local repository to understand code paths
- Use `git log --oneline -30` to correlate wedge timing with recent commits
- Create a new branch: `git checkout -b fix/auto-diagnose-{{UNIX_TS}} origin/main`
- Make small, focused code changes if a clear fix is warranted
- `git add` + `git commit` on that branch
- `git push origin fix/auto-diagnose-{{UNIX_TS}}` (the new branch only)
- `gh pr create --draft --base main --head fix/auto-diagnose-{{UNIX_TS}} --title "..." --body "..."` (always `--draft`)
- `gh issue create` if no fix is appropriate but the incident should be documented

## What you MUST NOT do

- Do NOT run `pm2 restart`, `pm2 stop`, or any pm2 state-changing command. The watchdog already handles auto-restart.
- Do NOT push to `main` directly. Always go through `git push origin <new-branch-name>`.
- Do NOT use `gh pr merge` or merge any PR. The user reviews and merges manually.
- Do NOT read or print the contents of `{{EC2_SSH_KEY_PATH}}` or any other `.pem` file.
- Do NOT modify `.env`, `data/`, or any file the user has uncommitted changes in.
- Do NOT run `rm -rf` outside of a temp directory you created yourself.

## Diagnostic procedure

1. Identify the bot process by mapping `{{CHECK_NAME}}` to a pm2 app name:
   - `jobpulse-micro` → pm2 app `micro-bot`
   - `jobpulse-mu` → pm2 app `jobpulse-mu`
   - any other name → SSH and run `pm2 status` to find it manually

2. Snapshot pm2 state: status, uptime since last restart, restart count.

3. If pm2 shows the process running but uptime is large and the watchdog hasn't fired:
   - The bot may be wedged. Inspect `/proc/<pid>/wchan` and `ss -tnp` to confirm.
   - Look for the "Cloudflare:443 stuck socket" pattern from prior wedges.

4. If pm2 shows a recent restart (uptime < 15 min):
   - The watchdog likely already recovered. Look at `pm2 logs <app> --nostream --lines 200` for what happened just before the restart.

5. Cross-reference the wedge timing with `git log --oneline --since '24 hours ago'` to identify suspect recent changes.

6. Form a hypothesis and write it down (in your output, not in any file yet).

## Output

Output exactly two sections in your stdout response, each delimited by `--- BEGIN <NAME> ---` / `--- END <NAME> ---`:

### Section 1: DISCORD_SUMMARY

A short paragraph (under 1500 chars — Discord message limit safety) for posting back to the alert channel. Format:

```
--- BEGIN DISCORD_SUMMARY ---
**{{CHECK_NAME}}** triage:

- Symptom: <one line>
- Root cause hypothesis: <one line>
- Action taken: <one line — "draft PR #N opened" / "issue #M filed" / "no code change needed">
- Link: <PR or issue URL>
--- END DISCORD_SUMMARY ---
```

### Section 2: PR_OR_ISSUE

Either the PR URL or the Issue URL on its own line:

```
--- BEGIN PR_OR_ISSUE ---
https://github.com/{{GITHUB_REPO}}/pull/<N>
--- END PR_OR_ISSUE ---
```

If you took no action because the bot already self-recovered cleanly and no code change is appropriate, still file a GitHub Issue documenting the incident and put its URL in PR_OR_ISSUE.

## Time budget

You have 15 minutes total. If you cannot reach a confident diagnosis, file a GitHub Issue with whatever evidence you've gathered and stop. Better to escalate than to push a speculative fix.
