const DISCORD_API = "https://discord.com/api/v10";

const PERM_VIEW_CHANNEL = 1n << 10n;
const PERM_READ_HISTORY = 1n << 16n;

function slugifyName(name) {
  const slug = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "user";
}

export async function createUserChannel({ guildId, categoryId, jobpulseMemberRoleId, userId, firstName, botToken }) {
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
    const res = await fetch(`${DISCORD_API}/guilds/${guildId}/channels`, {
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
    throw new Error(`Channel create failed ${result.__error.status}: ${result.__error.body}`);
  }
  return result.id;
}

export async function addUserToGuildWithRole({ discordId, accessToken, guildId, roleId, botToken }) {
  if (!discordId || !accessToken || !guildId || !roleId || !botToken) {
    throw new Error("addUserToGuildWithRole: missing required argument");
  }

  const addRes = await fetch(`${DISCORD_API}/guilds/${guildId}/members/${discordId}`, {
    method: "PUT",
    headers: { Authorization: `Bot ${botToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ access_token: accessToken, roles: [roleId] }),
  });

  if (addRes.status === 201) return { added: true, roleEnsured: true };

  // 204: already a member. The PUT body's `roles` field is ignored in this case,
  // so we follow up with an explicit role-add to guarantee the role is present.
  if (addRes.status === 204) {
    const roleRes = await fetch(
      `${DISCORD_API}/guilds/${guildId}/members/${discordId}/roles/${roleId}`,
      { method: "PUT", headers: { Authorization: `Bot ${botToken}` } }
    );
    if (!roleRes.ok) {
      const body = await roleRes.text().catch(() => "");
      throw new Error(`Role add failed ${roleRes.status}: ${body}`);
    }
    return { added: false, roleEnsured: true };
  }

  const body = await addRes.text().catch(() => "");
  throw new Error(`Guild add failed ${addRes.status}: ${body}`);
}
