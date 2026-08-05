const DISCORD_API = "https://discord.com/api/v10";
const DISCORD_REQUEST_TIMEOUT_MS = 10_000;

const PERM_VIEW_CHANNEL = 1n << 10n;
const PERM_READ_HISTORY = 1n << 16n;

function slugifyName(name) {
  const slug = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "user";
}

async function discordRequest(fetchImpl, url, options, action, timeoutMs) {
  try {
    return await fetchImpl(url, {
      ...options,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    // Do not attach the original error: fetch failures can include request
    // details, and these requests carry OAuth or bot credentials.
    throw new Error(`${action} request failed or timed out`);
  }
}

export async function createUserChannel({
  guildId,
  categoryId,
  jobpulseMemberRoleId,
  userId,
  firstName,
  botToken,
  fetchImpl = fetch,
  timeoutMs = DISCORD_REQUEST_TIMEOUT_MS,
}) {
  if (!guildId || !categoryId || !jobpulseMemberRoleId || !userId || !botToken) {
    throw new Error("createUserChannel: missing required argument");
  }

  const baseName = `jobs-${slugifyName(firstName)}`;
  const tail = String(userId).slice(-4);

  const overwrites = [
    { id: guildId, type: 0, deny: PERM_VIEW_CHANNEL.toString() },
    { id: jobpulseMemberRoleId, type: 0, deny: PERM_VIEW_CHANNEL.toString() },
    { id: userId, type: 1, allow: (PERM_VIEW_CHANNEL | PERM_READ_HISTORY).toString() },
  ];

  async function attempt(name) {
    const res = await discordRequest(fetchImpl, `${DISCORD_API}/guilds/${encodeURIComponent(guildId)}/channels`, {
      method: "POST",
      headers: { Authorization: `Bot ${botToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name, type: 0, parent_id: categoryId, permission_overwrites: overwrites }),
    }, "Discord channel creation", timeoutMs);
    if (res.ok) {
      let payload;
      try {
        payload = await res.json();
      } catch {
        throw new Error("Discord channel creation returned an invalid response");
      }
      if (!payload?.id) throw new Error("Discord channel creation returned an invalid response");
      return payload;
    }
    return { __error: { status: res.status } };
  }

  let result = await attempt(baseName);
  if (result.__error && (result.__error.status === 400 || result.__error.status === 409)) {
    result = await attempt(`${baseName}-${tail}`);
  }
  if (result.__error) {
    throw new Error(`Discord channel creation failed (HTTP ${result.__error.status})`);
  }
  return result.id;
}

export async function addUserToGuildWithRole({
  discordId,
  accessToken,
  guildId,
  roleId,
  botToken,
  fetchImpl = fetch,
  timeoutMs = DISCORD_REQUEST_TIMEOUT_MS,
}) {
  if (!discordId || !accessToken || !guildId || !roleId || !botToken) {
    throw new Error("addUserToGuildWithRole: missing required argument");
  }

  const addRes = await discordRequest(
    fetchImpl,
    `${DISCORD_API}/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(discordId)}`,
    {
      method: "PUT",
      headers: { Authorization: `Bot ${botToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ access_token: accessToken, roles: [roleId] }),
    },
    "Discord guild membership",
    timeoutMs,
  );

  if (addRes.status === 201) return { added: true, roleEnsured: true };

  // 204: already a member. The PUT body's `roles` field is ignored in this case,
  // so we follow up with an explicit role-add to guarantee the role is present.
  if (addRes.status === 204) {
    const roleRes = await discordRequest(
      fetchImpl,
      `${DISCORD_API}/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(discordId)}/roles/${encodeURIComponent(roleId)}`,
      { method: "PUT", headers: { Authorization: `Bot ${botToken}` } },
      "Discord role assignment",
      timeoutMs,
    );
    if (!roleRes.ok) {
      throw new Error(`Discord role assignment failed (HTTP ${roleRes.status})`);
    }
    return { added: false, roleEnsured: true };
  }

  throw new Error(`Discord guild membership failed (HTTP ${addRes.status})`);
}

export async function deleteDiscordUserArtifacts({
  discordId,
  channelId,
  guildId,
  botToken,
  fetchImpl = fetch,
  timeoutMs = DISCORD_REQUEST_TIMEOUT_MS,
}) {
  if (!discordId || !botToken) return { skipped: true, failures: [] };

  const operations = [];
  if (channelId) {
    operations.push({
      name: "channel",
      url: `${DISCORD_API}/channels/${encodeURIComponent(channelId)}`,
    });
  }
  if (guildId) {
    operations.push({
      name: "membership",
      url: `${DISCORD_API}/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(discordId)}`,
    });
  }

  const failures = [];
  for (const operation of operations) {
    try {
      const response = await discordRequest(fetchImpl, operation.url, {
        method: "DELETE",
        headers: { Authorization: `Bot ${botToken}` },
      }, `Discord ${operation.name} deletion`, timeoutMs);
      if (!response.ok && response.status !== 404) {
        failures.push(`${operation.name}:${response.status}`);
      }
    } catch {
      failures.push(`${operation.name}:network_error`);
    }
  }
  return { skipped: operations.length === 0, failures };
}
