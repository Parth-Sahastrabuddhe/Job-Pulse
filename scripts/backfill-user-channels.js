#!/usr/bin/env node
// Backfill: create a private per-user Discord channel under the User Feeds
// category for every active user in the DB who doesn't already have one.
// Skips the admin if PERSONAL_CHANNEL_ID is already set — links it instead.
//
// Run once after the v2 deploy and after the manual Discord setup is done.
//   node scripts/backfill-user-channels.js
import "../src/config.js"; // loads root .env into process.env
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

// Also load web/.env.local — the new Discord vars may live there since the web
// app is what normally uses them.
function loadEnvIfPresent(p) {
  if (!fs.existsSync(p)) return;
  for (const rawLine of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined || process.env[key] === "") {
      process.env[key] = value;
    }
  }
}
loadEnvIfPresent(path.join(PROJECT_ROOT, "web", ".env.local"));

const guildId = process.env.DISCORD_GUILD_ID;
const categoryId = process.env.DISCORD_USER_FEED_CATEGORY_ID;
const roleId = process.env.DISCORD_BOT_ROLE_ID;
const botToken = process.env.MULTI_USER_BOT_TOKEN;
const adminId = process.env.ADMIN_DISCORD_ID;
const adminPersonalChannel = process.env.PERSONAL_CHANNEL_ID;

const missing = [];
if (!guildId) missing.push("DISCORD_GUILD_ID");
if (!categoryId) missing.push("DISCORD_USER_FEED_CATEGORY_ID");
if (!roleId) missing.push("DISCORD_BOT_ROLE_ID");
if (!botToken) missing.push("MULTI_USER_BOT_TOKEN");
if (missing.length) {
  console.error(`Missing required env vars: ${missing.join(", ")}`);
  console.error("Add them to .env or web/.env.local and re-run.");
  process.exit(1);
}

const dbPath = process.env.DB_PATH || process.env.DB_FILE || path.resolve(PROJECT_ROOT, "data/jobs.db");
const db = new Database(dbPath);

const PERM_VIEW_CHANNEL = 1n << 10n;
const PERM_READ_HISTORY = 1n << 16n;

function slugifyName(name) {
  const slug = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "user";
}

async function createChannel({ userId, firstName }) {
  const baseName = `jobs-${slugifyName(firstName)}`;
  const tail = String(userId).slice(-4);
  const overwrites = [
    { id: guildId, type: 0, deny: PERM_VIEW_CHANNEL.toString() },
    { id: roleId, type: 0, deny: PERM_VIEW_CHANNEL.toString() },
    { id: userId, type: 1, allow: (PERM_VIEW_CHANNEL | PERM_READ_HISTORY).toString() },
  ];
  async function attempt(name) {
    const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, {
      method: "POST",
      headers: { Authorization: `Bot ${botToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name, type: 0, parent_id: categoryId, permission_overwrites: overwrites }),
    });
    if (res.ok) return await res.json();
    const body = await res.text().catch(() => "");
    return { __error: { status: res.status, body } };
  }
  let result = await attempt(baseName);
  if (result.__error && (result.__error.status === 400 || result.__error.status === 409)) {
    result = await attempt(`${baseName}-${tail}`);
  }
  if (result.__error) {
    throw new Error(`${result.__error.status}: ${result.__error.body}`);
  }
  return result.id;
}

const users = db.prepare(
  "SELECT discord_id, first_name FROM user_profiles WHERE notification_channel_id IS NULL OR notification_channel_id = ''"
).all();

console.log(`Backfilling ${users.length} user(s)...`);

const setChannel = db.prepare(
  "UPDATE user_profiles SET notification_channel_id = ?, updated_at = ? WHERE discord_id = ?"
);
const now = () => new Date().toISOString();

let okCount = 0, skipCount = 0, failCount = 0;

for (const u of users) {
  if (u.discord_id === adminId && adminPersonalChannel) {
    setChannel.run(adminPersonalChannel, now(), u.discord_id);
    console.log(`  admin (${u.discord_id}): linked to PERSONAL_CHANNEL_ID ${adminPersonalChannel}`);
    skipCount++;
    continue;
  }
  try {
    const channelId = await createChannel({ userId: u.discord_id, firstName: u.first_name });
    setChannel.run(channelId, now(), u.discord_id);
    console.log(`  ${u.first_name} (${u.discord_id}) -> #${channelId}`);
    okCount++;
    await new Promise((r) => setTimeout(r, 500));
  } catch (err) {
    console.error(`  ${u.first_name} (${u.discord_id}) FAILED: ${err.message}`);
    failCount++;
  }
}

console.log(`\nDone. created=${okCount} linked=${skipCount} failed=${failCount}`);
db.close();
