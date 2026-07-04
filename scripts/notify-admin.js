/**
 * notify-admin.js: send a Discord DM to the admin from ops scripts.
 *
 * Usage: node scripts/notify-admin.js "message text"
 *
 * Reads MULTI_USER_BOT_TOKEN and ADMIN_DISCORD_ID from the repo-root .env
 * (first-wins semantics, matching src/config.js's loader); real environment
 * variables take precedence. Exits 0 only when the DM was confirmed sent, so
 * callers can gate their "already alerted" flags on success.
 *
 * Used by scripts/healthcheck.sh (pm2 down alerts + mu watchdog) and the
 * add-company automation's completion reports.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client, GatewayIntentBits } from "discord.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

function readEnvFile() {
  const out = {};
  let content = "";
  try {
    content = fs.readFileSync(path.join(PROJECT_ROOT, ".env"), "utf8");
  } catch {
    return out;
  }
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (out[key] !== undefined) continue; // first occurrence wins, like src/config.js
    out[key] = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
  }
  return out;
}

// --b64 <base64>: message arrives base64-encoded (the add-company runner uses
// this to pass arbitrary text through ssh without quoting hazards).
let message = process.argv[2];
if (message === "--b64") {
  try {
    message = Buffer.from(process.argv[3] || "", "base64").toString("utf8");
  } catch {
    message = "";
  }
}
if (!message) {
  console.error('Usage: node scripts/notify-admin.js "message" | --b64 <base64>');
  process.exit(1);
}

const envFile = readEnvFile();
const token = process.env.MULTI_USER_BOT_TOKEN || envFile.MULTI_USER_BOT_TOKEN;
const adminId = process.env.ADMIN_DISCORD_ID || envFile.ADMIN_DISCORD_ID;
if (!token || !adminId) {
  console.error("notify-admin: missing MULTI_USER_BOT_TOKEN or ADMIN_DISCORD_ID");
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const timer = setTimeout(() => {
  console.error("notify-admin: timed out");
  process.exit(1);
}, 20_000);

client.once("ready", async () => {
  let ok = false;
  try {
    const user = await client.users.fetch(adminId);
    await user.send(message);
    ok = true;
  } catch (err) {
    console.error(`notify-admin: DM failed: ${err.message}`);
  }
  clearTimeout(timer);
  client.destroy();
  process.exit(ok ? 0 : 1);
});

client.once("error", (err) => {
  console.error(`notify-admin: client error: ${err.message}`);
  process.exit(1);
});

client.login(token).catch((err) => {
  console.error(`notify-admin: login failed: ${err.message}`);
  process.exit(1);
});
