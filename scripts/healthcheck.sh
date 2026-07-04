#!/bin/bash
# PM2 health check + jobpulse-mu hang watchdog. Runs via cron every 5 minutes.
#
# 1) DOWN CHECK: DMs the admin (via scripts/notify-admin.js) if any pm2
#    process is down. Alerts once per incident (flag file).
# 2) MU WATCHDOG: jobpulse-mu can wedge in uninterruptible sleep (D-state)
#    under RAM pressure: pm2 still reports "online" but the poll loop stops.
#    The poll loop touches data/mu-heartbeat every successful cycle (~10s);
#    when that file goes stale while pm2 says online, this script restarts
#    jobpulse-mu and DMs the admin. At most one auto-restart per backoff
#    window; if the heartbeat is still stale inside the window, it escalates
#    with a single CRITICAL DM instead of restart-thrashing.

FLAG_FILE="/tmp/pm2-alert-sent"
MU_RESTART_FLAG="/tmp/mu-watchdog-restarted-at"
MU_ESCALATE_FLAG="/tmp/mu-watchdog-escalated"
MU_STALE_LIMIT="${MU_HEARTBEAT_STALE_SECONDS:-900}"        # 15 min
MU_RESTART_BACKOFF="${MU_WATCHDOG_BACKOFF_SECONDS:-1800}"  # 30 min
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
HEARTBEAT_FILE="$PROJECT_DIR/data/mu-heartbeat"

# Resolve node_modules (discord.js) and any relative paths from the project root.
cd "$PROJECT_DIR" || exit 1

# Serialize runs: a hung `pm2 restart` must not pile up concurrent cron runs.
exec 200>/tmp/jobpulse-healthcheck.lock
flock -n 200 || exit 0

notify_admin() {
  node "$PROJECT_DIR/scripts/notify-admin.js" "$1"
}

# Determine which processes are down. Critically, treat a missing/empty/unparseable
# `pm2 jlist` as DOWN. That is exactly the catastrophic case (pm2 daemon dead,
# all processes gone) this watchdog exists to catch, and the old version silently
# treated it as healthy.
PM2_JSON=$(pm2 jlist 2>/dev/null)
DOWN=$(printf '%s' "$PM2_JSON" | node -e "
  let raw = '';
  try { raw = require('fs').readFileSync('/dev/stdin', 'utf8').trim(); } catch { console.log('pm2 (read error)'); process.exit(0); }
  if (!raw) { console.log('pm2 daemon (no output)'); process.exit(0); }
  let d = null;
  for (const candidate of [raw, raw.slice(raw.indexOf('['))]) {
    try { d = JSON.parse(candidate); break; } catch {}
  }
  if (!Array.isArray(d)) { console.log('pm2 jlist (unparseable)'); process.exit(0); }
  if (d.length === 0) { console.log('pm2 (no processes registered)'); process.exit(0); }
  const bad = d.filter(p => !p.pm2_env || p.pm2_env.status !== 'online').map(p => p.name);
  if (bad.length) console.log(bad.join(', '));
")

if [ -n "$DOWN" ]; then
  # Something is down. Alert if we haven't already AND the DM actually sends.
  if [ ! -f "$FLAG_FILE" ]; then
    if notify_admin "⚠️ **PM2 Alert:** \`$DOWN\` is down on EC2. Check with \`pm2 status\`."; then
      # Only mark the incident alerted once the DM was confirmed sent.
      touch "$FLAG_FILE"
      echo "[$(date -u +%FT%TZ)] ALERT: $DOWN is down (admin notified)"
    else
      echo "[$(date -u +%FT%TZ)] ALERT: $DOWN is down (notification FAILED, will retry next run)"
    fi
  fi
else
  # Everything is online. Clear the flag so the next incident triggers an alert.
  if [ -f "$FLAG_FILE" ]; then
    rm "$FLAG_FILE"
    echo "[$(date -u +%FT%TZ)] RECOVERED: all processes online"
  fi
fi

# ── MU heartbeat watchdog ────────────────────────────────────────────────────
# Only meaningful when pm2 claims jobpulse-mu is online (the down path above
# covers everything else) and the heartbeat file exists (it appears on the
# first successful poll cycle after this feature deploys).

MU_ONLINE=$(printf '%s' "$PM2_JSON" | node -e "
  let raw = '';
  try { raw = require('fs').readFileSync('/dev/stdin', 'utf8').trim(); } catch {}
  let d = null;
  for (const candidate of [raw, raw.slice(raw.indexOf('['))]) {
    try { d = JSON.parse(candidate); break; } catch {}
  }
  const p = Array.isArray(d) ? d.find(x => x.name === 'jobpulse-mu') : null;
  console.log(p && p.pm2_env && p.pm2_env.status === 'online' ? '1' : '0');
")

if [ "$MU_ONLINE" = "1" ] && [ -f "$HEARTBEAT_FILE" ]; then
  NOW=$(date +%s)
  HB_AGE=$(( NOW - $(stat -c %Y "$HEARTBEAT_FILE") ))
  if [ "$HB_AGE" -gt "$MU_STALE_LIMIT" ]; then
    HB_MIN=$(( HB_AGE / 60 ))
    LAST_RESTART=$(cat "$MU_RESTART_FLAG" 2>/dev/null || echo 0)
    case "$LAST_RESTART" in ''|*[!0-9]*) LAST_RESTART=0 ;; esac
    if [ $(( NOW - LAST_RESTART )) -gt "$MU_RESTART_BACKOFF" ]; then
      echo "$NOW" > "$MU_RESTART_FLAG"
      timeout 120 pm2 restart jobpulse-mu
      echo "[$(date -u +%FT%TZ)] WATCHDOG: restarted jobpulse-mu (heartbeat stale ${HB_MIN}m, pm2 said online)"
      notify_admin "🔄 **Watchdog:** jobpulse-mu heartbeat was stale for ${HB_MIN} min while pm2 reported it online (likely D-state hang). Auto-restarted it." \
        || echo "[$(date -u +%FT%TZ)] WATCHDOG: restart DM failed"
    elif [ ! -f "$MU_ESCALATE_FLAG" ]; then
      if notify_admin "🚨 **Watchdog CRITICAL:** jobpulse-mu heartbeat is still stale (${HB_MIN} min) after an auto-restart. Manual check needed: \`pm2 logs jobpulse-mu --lines 50\`."; then
        touch "$MU_ESCALATE_FLAG"
      fi
      echo "[$(date -u +%FT%TZ)] WATCHDOG: still stale after restart (${HB_MIN}m), escalation attempted"
    fi
  else
    # Heartbeat is fresh: the incident (if any) is over, reset the budget.
    rm -f "$MU_RESTART_FLAG" "$MU_ESCALATE_FLAG"
  fi
fi
