#!/bin/bash
# PM2 health check — runs via cron every 5 minutes.
# Sends a Discord DM to admin (via MU bot) if any process is down.
# Only alerts once per incident (uses a flag file to avoid flooding).

FLAG_FILE="/tmp/pm2-alert-sent"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Resolve node_modules (discord.js) and any relative paths from the project root.
cd "$PROJECT_DIR" || exit 1

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
    if node -e "
      const { Client, GatewayIntentBits } = require('discord.js');
      const fs = require('fs');
      const path = require('path');

      const envPath = path.resolve('$PROJECT_DIR', '.env');
      const envContent = fs.readFileSync(envPath, 'utf8');
      let token = '';
      let adminId = '';
      for (const line of envContent.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('MULTI_USER_BOT_TOKEN=')) {
          token = trimmed.split('=').slice(1).join('=').replace(/^['\"]|['\"]$/g, '');
        } else if (trimmed.startsWith('ADMIN_DISCORD_ID=')) {
          adminId = trimmed.split('=').slice(1).join('=').replace(/^['\"]|['\"]$/g, '');
        }
      }
      if (!token || !adminId) { console.error('Missing token/adminId'); process.exit(1); }

      const client = new Client({ intents: [GatewayIntentBits.Guilds] });
      let ok = false;
      client.once('ready', async () => {
        try {
          const user = await client.users.fetch(adminId);
          await user.send('⚠️ **PM2 Alert:** \`$DOWN\` is down on EC2. Check with \`pm2 status\`.');
          ok = true;
        } catch (e) {
          console.error('DM failed:', e.message);
        }
        client.destroy();
        process.exit(ok ? 0 : 1);
      });
      client.once('error', (e) => { console.error('Client error:', e.message); process.exit(1); });
      client.login(token).catch((e) => { console.error('Login failed:', e.message); process.exit(1); });
      setTimeout(() => { console.error('Alert timed out'); process.exit(1); }, 20000);
    "; then
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
