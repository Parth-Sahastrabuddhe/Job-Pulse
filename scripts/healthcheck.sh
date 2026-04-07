#!/bin/bash
# PM2 health check — runs via cron every 5 minutes.
# Sends a Discord DM to admin (via MU bot) if any process is down.
# Only alerts once per incident (uses a flag file to avoid flooding).

FLAG_FILE="/tmp/pm2-alert-sent"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Check for any non-online processes
DOWN=$(pm2 jlist 2>/dev/null | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8'));
  const bad = d.filter(p => p.pm2_env.status !== 'online').map(p => p.name);
  if (bad.length) console.log(bad.join(', '));
")

if [ -n "$DOWN" ]; then
  # Something is down — alert if we haven't already
  if [ ! -f "$FLAG_FILE" ]; then
    node -e "
      const { Client, GatewayIntentBits } = require('discord.js');
      const fs = require('fs');
      const path = require('path');

      // Load .env
      const envPath = path.resolve('$SCRIPT_DIR', '..', '.env');
      const envContent = fs.readFileSync(envPath, 'utf8');
      let token = '';
      for (const line of envContent.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('MULTI_USER_BOT_TOKEN=')) {
          token = trimmed.split('=').slice(1).join('=').replace(/^['\"]|['\"]$/g, '');
        }
      }

      const client = new Client({ intents: [GatewayIntentBits.Guilds] });
      client.once('ready', async () => {
        try {
          const user = await client.users.fetch('1038422401874145372');
          await user.send('⚠️ **PM2 Alert:** \`$DOWN\` is down on EC2. Check with \`pm2 status\`.');
        } catch (e) {
          console.error('DM failed:', e.message);
        }
        client.destroy();
      });
      client.login(token);
    "
    touch "$FLAG_FILE"
    echo "[$(date -u +%FT%TZ)] ALERT: $DOWN is down"
  fi
else
  # Everything is online — clear the flag so next incident triggers alert
  if [ -f "$FLAG_FILE" ]; then
    rm "$FLAG_FILE"
    echo "[$(date -u +%FT%TZ)] RECOVERED: all processes online"
  fi
fi
