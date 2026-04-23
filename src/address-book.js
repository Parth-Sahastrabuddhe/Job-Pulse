// src/address-book.js
//
// Per-user address book. Data layer lives here; Discord handlers are added in
// later tasks and also live in this file (single-feature module).

import {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";

export const MAX_ADDRESSES_PER_USER = 200;
export const MAX_LINE1 = 120;
export const MAX_CITY = 60;
export const MAX_STATE = 60;
export const MAX_POSTAL = 20;
export const MAX_COUNTRY = 60;
// Discord allows max 5 ActionRows × 5 buttons, so SEARCH_LIMIT must stay ≤ 25
// to keep a one-button-per-row layout feasible. The current value also stays
// safely under the embed description cap at worst-case field lengths.
export const SEARCH_LIMIT = 10;

function escapeLike(s) {
  return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export function addressBookMigrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_addresses (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL,
      line1       TEXT NOT NULL,
      city        TEXT NOT NULL,
      state       TEXT NOT NULL,
      postal_code TEXT NOT NULL,
      country     TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES user_profiles(id)
    );
    CREATE INDEX IF NOT EXISTS idx_user_addresses_user ON user_addresses(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_addresses_city ON user_addresses(user_id, city COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_user_addresses_state ON user_addresses(user_id, state COLLATE NOCASE);
  `);
}

export function countAddresses(db, userId) {
  return db.prepare("SELECT COUNT(*) AS cnt FROM user_addresses WHERE user_id = ?").get(userId).cnt;
}

export function insertAddress(db, { userId, line1, city, state, postalCode, country }) {
  const info = db.prepare(`
    INSERT INTO user_addresses (user_id, line1, city, state, postal_code, country, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(userId, line1, city, state, postalCode, country, new Date().toISOString());
  return Number(info.lastInsertRowid);
}

export function searchAddresses(db, { userId, city, state, limit = SEARCH_LIMIT }) {
  const params = [userId];
  let sql = "SELECT id, line1, city, state, postal_code, country FROM user_addresses WHERE user_id = ?";
  if (city) {
    sql += " AND city LIKE ? COLLATE NOCASE ESCAPE '\\'";
    params.push(`%${escapeLike(city)}%`);
  }
  if (state) {
    sql += " AND state LIKE ? COLLATE NOCASE ESCAPE '\\'";
    params.push(`%${escapeLike(state)}%`);
  }
  sql += " ORDER BY created_at DESC, id DESC LIMIT ?";
  params.push(limit);
  return db.prepare(sql).all(...params);
}

export function countMatchingAddresses(db, { userId, city, state }) {
  const params = [userId];
  let sql = "SELECT COUNT(*) AS cnt FROM user_addresses WHERE user_id = ?";
  if (city) {
    sql += " AND city LIKE ? COLLATE NOCASE ESCAPE '\\'";
    params.push(`%${escapeLike(city)}%`);
  }
  if (state) {
    sql += " AND state LIKE ? COLLATE NOCASE ESCAPE '\\'";
    params.push(`%${escapeLike(state)}%`);
  }
  return db.prepare(sql).get(...params).cnt;
}

export function deleteAddress(db, { id, userId }) {
  const info = db.prepare("DELETE FROM user_addresses WHERE id = ? AND user_id = ?").run(id, userId);
  return info.changes;
}

// ─────────────────────────────────────────────────────────────────────────────
// Discord layer — slash command builders
// ─────────────────────────────────────────────────────────────────────────────

export const ADDRESS_MODAL_ID = "mu_add_address";
export const ADDRESS_DELETE_PREFIX = "mu_addr_del";

export function buildAddressSlashCommands() {
  return [
    new SlashCommandBuilder()
      .setName("add-address")
      .setDescription("Save a new postal address to your private address book"),

    new SlashCommandBuilder()
      .setName("search-address")
      .setDescription("Search your saved addresses by city and/or state")
      .addStringOption((opt) =>
        opt.setName("city")
          .setDescription("City (partial match, case-insensitive)")
          .setRequired(false)
      )
      .addStringOption((opt) =>
        opt.setName("state")
          .setDescription("State (partial match, case-insensitive)")
          .setRequired(false)
      ),
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Discord layer — /add-address (slash command + modal)
// ─────────────────────────────────────────────────────────────────────────────

export async function handleAddAddressCommand(interaction) {
  const modal = new ModalBuilder()
    .setCustomId(ADDRESS_MODAL_ID)
    .setTitle("Add address");

  const inputs = [
    new TextInputBuilder().setCustomId("line1").setLabel("Address line 1").setStyle(TextInputStyle.Short).setMaxLength(MAX_LINE1).setRequired(true),
    new TextInputBuilder().setCustomId("city").setLabel("City").setStyle(TextInputStyle.Short).setMaxLength(MAX_CITY).setRequired(true),
    new TextInputBuilder().setCustomId("state").setLabel("State").setStyle(TextInputStyle.Short).setMaxLength(MAX_STATE).setRequired(true),
    new TextInputBuilder().setCustomId("postal_code").setLabel("Postal code").setStyle(TextInputStyle.Short).setMaxLength(MAX_POSTAL).setRequired(true),
    new TextInputBuilder().setCustomId("country").setLabel("Country").setStyle(TextInputStyle.Short).setMaxLength(MAX_COUNTRY).setRequired(true),
  ];

  // Discord requires each TextInput to live in its own ActionRow.
  modal.addComponents(...inputs.map((input) => new ActionRowBuilder().addComponents(input)));

  await interaction.showModal(modal);
}

export async function handleAddressModalSubmit(interaction, profile, db) {
  try {
    const line1      = interaction.fields.getTextInputValue("line1").trim();
    const city       = interaction.fields.getTextInputValue("city").trim();
    const state      = interaction.fields.getTextInputValue("state").trim();
    const postalCode = interaction.fields.getTextInputValue("postal_code").trim();
    const country    = interaction.fields.getTextInputValue("country").trim();

    if (!line1 || !city || !state || !postalCode || !country) {
      await interaction.reply({
        content: "All fields are required. Please try /add-address again.",
        ephemeral: true,
      });
      return;
    }

    if (
      line1.length > MAX_LINE1 ||
      city.length > MAX_CITY ||
      state.length > MAX_STATE ||
      postalCode.length > MAX_POSTAL ||
      country.length > MAX_COUNTRY
    ) {
      await interaction.reply({
        content: "One or more fields exceeded the allowed length. Please try /add-address again.",
        ephemeral: true,
      });
      return;
    }

    if (countAddresses(db, profile.id) >= MAX_ADDRESSES_PER_USER) {
      await interaction.reply({
        content: `You have reached the ${MAX_ADDRESSES_PER_USER}-address limit. Delete one with /search-address before adding a new one.`,
        ephemeral: true,
      });
      return;
    }

    const newId = insertAddress(db, { userId: profile.id, line1, city, state, postalCode, country });

    const embed = new EmbedBuilder()
      .setColor(0x57F287)
      .setTitle("📍 Address saved")
      .setDescription(
        "```\n" +
        `line 1  : ${line1}\n` +
        `city    : ${city}\n` +
        `state   : ${state}\n` +
        `postal  : ${postalCode}\n` +
        `country : ${country}\n` +
        "```"
      )
      .setFooter({ text: `#${newId}` });

    await interaction.reply({ embeds: [embed], ephemeral: true });
  } catch (err) {
    console.error(`[address-book] modal-submit error: ${err.message}`);
    if (!interaction.replied && !interaction.deferred) {
      try {
        await interaction.reply({ content: "Something went wrong. Try again in a moment.", ephemeral: true });
      } catch {}
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Discord layer — /search-address and delete
// ─────────────────────────────────────────────────────────────────────────────

function sanitizeCodeBlock(value) {
  // Replace backticks with U+02CB (MODIFIER LETTER GRAVE ACCENT) so user
  // content cannot escape the triple-backtick fence below.
  return String(value).replace(/`/g, "ˋ");
}

function formatAddressEntry(row, idx) {
  const line1   = sanitizeCodeBlock(row.line1);
  const city    = sanitizeCodeBlock(row.city);
  const state   = sanitizeCodeBlock(row.state);
  const postal  = sanitizeCodeBlock(row.postal_code);
  const country = sanitizeCodeBlock(row.country);
  return (
    `**${idx + 1}.** ${city}, ${state}, ${country}\n` +
    "```\n" +
    `line 1  : ${line1}\n` +
    `city    : ${city}\n` +
    `state   : ${state}\n` +
    `postal  : ${postal}\n` +
    `country : ${country}\n` +
    "```"
  );
}

export async function handleSearchAddressCommand(interaction, profile, db) {
  try {
    await interaction.deferReply({ ephemeral: true });

    const city  = interaction.options.getString("city")  ?? undefined;
    const state = interaction.options.getString("state") ?? undefined;

    const rows  = searchAddresses(db, { userId: profile.id, city, state, limit: SEARCH_LIMIT });
    const total = countMatchingAddresses(db, { userId: profile.id, city, state });

    if (rows.length === 0) {
      const hasFilter = Boolean(city || state);
      await interaction.editReply({
        content: hasFilter
          ? "No addresses match that filter. Try fewer terms, or /search-address with no filters to see all."
          : "No addresses saved yet. Use /add-address to add one.",
      });
      return;
    }

    let title;
    if (!city && !state)     title = "📍 Your addresses";
    else if (total === 1)    title = "📍 1 address matches";
    else                     title = `📍 ${total} addresses match`;

    const MAX_EMBED_DESC = 4000; // Discord cap is 4096; leave a small buffer
    const rendered = rows.map(formatAddressEntry);
    const kept = [];
    let usedChars = 0;
    for (const entry of rendered) {
      const next = usedChars + entry.length + (kept.length > 0 ? 1 : 0); // +1 for join newline
      if (next > MAX_EMBED_DESC) break;
      kept.push(entry);
      usedChars = next;
    }
    const truncated = kept.length < rendered.length;
    const shownCount = kept.length;

    // Guard against the pathological case where no entry fits the embed budget.
    // Not reachable today (single worst-case entry is ~575 chars; budget is 4000),
    // but protects against future schema changes that bump field length caps.
    if (shownCount === 0) {
      await interaction.editReply({
        content: `Found ${total} matching address${total === 1 ? "" : "es"}, but the entries are too long to display. Narrow your search.`,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle(title)
      .setDescription(kept.join("\n"));

    let footerText = null;
    if (total > rows.length)  footerText = `Showing ${shownCount} of ${total}. Narrow your search.`;
    else if (truncated)       footerText = `Showing ${shownCount} of ${rows.length}; some entries were hidden to fit Discord limits.`;
    if (footerText) embed.setFooter({ text: footerText });

    // Delete buttons — one per shown entry, up to 10 across two ActionRows of 5 (Discord caps).
    const buttons = rows.slice(0, shownCount).map((row, idx) =>
      new ButtonBuilder()
        .setCustomId(`${ADDRESS_DELETE_PREFIX}:${row.id}`)
        .setLabel(`🗑 ${idx + 1}`)
        .setStyle(ButtonStyle.Danger)
    );

    const components = [];
    for (let i = 0; i < buttons.length; i += 5) {
      components.push(new ActionRowBuilder().addComponents(...buttons.slice(i, i + 5)));
    }

    await interaction.editReply({ embeds: [embed], components });
  } catch (err) {
    console.error(`[address-book] search error: ${err.message}`);
    if (interaction.deferred) {
      try { await interaction.editReply({ content: "Something went wrong. Try again in a moment." }); } catch {}
    } else if (!interaction.replied) {
      try { await interaction.reply({ content: "Something went wrong. Try again in a moment.", ephemeral: true }); } catch {}
    }
  }
}

export async function handleAddressDelete(interaction, profile, rawId, db) {
  try {
    await interaction.deferReply({ ephemeral: true });

    const id = Number(rawId);
    if (!Number.isFinite(id) || !Number.isInteger(id) || id <= 0) {
      await interaction.editReply({ content: "Invalid address id." });
      return;
    }

    const changes = deleteAddress(db, { id, userId: profile.id });

    if (changes === 0) {
      await interaction.editReply({ content: "Already deleted." });
      return;
    }

    await interaction.editReply({
      content: `Deleted address #${id}. Run /search-address again to refresh this list.`,
    });
  } catch (err) {
    console.error(`[address-book] delete error: ${err.message}`);
    if (interaction.deferred) {
      try { await interaction.editReply({ content: "Something went wrong. Try again in a moment." }); } catch {}
    } else if (!interaction.replied) {
      try { await interaction.reply({ content: "Something went wrong. Try again in a moment.", ephemeral: true }); } catch {}
    }
  }
}
