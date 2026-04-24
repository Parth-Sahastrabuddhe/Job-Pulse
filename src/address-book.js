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
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from "discord.js";

export const MAX_ADDRESSES_PER_USER = 200;
export const MAX_LINE1 = 120;
export const MAX_CITY = 60;
export const MAX_STATE = 60;
export const MAX_POSTAL = 20;
export const MAX_COUNTRY = 60;
// Discord select menus allow max 25 options, so SEARCH_LIMIT must stay ≤ 25.
// The current value also stays safely under the embed description cap at
// worst-case field lengths.
export const SEARCH_LIMIT = 10;

function escapeLike(s) {
  return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

// US state name ↔ acronym map. Source of truth for bidirectional search
// expansion and dup-detection normalization. DC is included as a de-facto
// state for application-form compatibility. Any future update to this map
// should keep acronyms uppercase and full names in their canonical title case.
// Not exported; use canonicalState() / stateMatchSet() for external access.
const US_STATE_ACRONYMS = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri",
  MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio",
  OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  DC: "District of Columbia",
};

// Reverse index: lowercase full name → acronym. Built once at module load.
const US_STATE_NAMES_TO_ACRONYM = Object.fromEntries(
  Object.entries(US_STATE_ACRONYMS).map(([acr, name]) => [name.toLowerCase(), acr])
);

/**
 * Given any string, return the canonical US-state acronym if the input is a
 * known full name or acronym (case/whitespace insensitive); otherwise return
 * the trimmed input unchanged. Callers must pass a string; null/undefined are
 * safely treated as "", but other non-strings (objects, arrays) are coerced
 * via String() and may produce unexpected passthrough values.
 */
export function canonicalState(input) {
  const trimmed = String(input ?? "").trim();
  if (!trimmed) return "";
  const upper = trimmed.toUpperCase();
  if (upper in US_STATE_ACRONYMS) return upper;
  const lower = trimmed.toLowerCase();
  if (lower in US_STATE_NAMES_TO_ACRONYM) return US_STATE_NAMES_TO_ACRONYM[lower];
  return trimmed;
}

/**
 * Given any string, return [acronym, fullName] if the input matches a known
 * US state (by acronym or full name, case/whitespace insensitive); otherwise
 * return null. Used by the search layer to decide whether to expand the WHERE
 * clause to match both forms. Callers must pass a string; null/undefined are
 * treated as unknown.
 */
export function stateMatchSet(input) {
  const trimmed = String(input ?? "").trim();
  if (!trimmed) return null;
  const upper = trimmed.toUpperCase();
  if (upper in US_STATE_ACRONYMS) return [upper, US_STATE_ACRONYMS[upper]];
  const lower = trimmed.toLowerCase();
  if (lower in US_STATE_NAMES_TO_ACRONYM) {
    const acr = US_STATE_NAMES_TO_ACRONYM[lower];
    return [acr, US_STATE_ACRONYMS[acr]];
  }
  return null;
}

/**
 * Collapse runs of any whitespace (including tabs, NBSP, etc.) to a single
 * space. Used as part of text-field normalization for dup detection — a
 * pasted address with NBSP between tokens should still match one typed with
 * a regular space.
 */
function collapseSpaces(s) {
  return s.replace(/\s+/g, " ");
}

/**
 * Given the raw fields a user submitted, produce a normalized 5-tuple suitable
 * for dup comparison. Rules:
 * - line1, city, country: trim, lowercase, collapse internal whitespace runs
 * - postal code: trim, uppercase (alphanumeric codes like UK/CA are conventionally
 *   uppercase; numeric-only codes like US ZIP are unchanged by the operation)
 * - state: canonicalState (acronym if known, trimmed input otherwise)
 */
export function normalizeAddressTuple({ line1, city, state, postalCode, country }) {
  const normalizeText = (v) => collapseSpaces(String(v ?? "").trim().toLowerCase());
  return {
    line1: normalizeText(line1),
    city: normalizeText(city),
    state: canonicalState(state),
    postalCode: String(postalCode ?? "").trim().toUpperCase(),
    country: normalizeText(country),
  };
}

/**
 * Look for any row in the shared pool whose normalized 5-tuple equals the
 * passed-in normalized tuple. Returns { id } of the first match, or null.
 * Dup detection is now global — no user-scoping.
 *
 * Implementation: normalized form isn't persisted, so we load all rows and
 * compare in JS. Fine at the current scale (global pool cap is 200 per user).
 */
export function findDuplicateAddress(db, normalized) {
  const rows = db.prepare(`
    SELECT id, line1, city, state, postal_code, country
    FROM user_addresses
  `).all();

  for (const row of rows) {
    const rowNorm = normalizeAddressTuple({
      line1: row.line1,
      city: row.city,
      state: row.state,
      postalCode: row.postal_code,
      country: row.country,
    });
    if (
      rowNorm.line1 === normalized.line1 &&
      rowNorm.city === normalized.city &&
      rowNorm.state === normalized.state &&
      rowNorm.postalCode === normalized.postalCode &&
      rowNorm.country === normalized.country
    ) {
      return { id: row.id };
    }
  }
  return null;
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

/**
 * Count how many addresses THIS user has added to the shared pool.
 * Only used for the per-user add cap (MAX_ADDRESSES_PER_USER) —
 * the pool itself is fully shared across all users.
 */
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

/**
 * Search the shared pool of addresses by optional city/state filters.
 * Returns up to `limit` rows. No user-scoping — every registered user
 * sees the same pool.
 */
export function searchAddresses(db, { city, state, limit = SEARCH_LIMIT }) {
  const params = [];
  let sql = "SELECT id, line1, city, state, postal_code, country FROM user_addresses WHERE 1=1";
  if (city) {
    sql += " AND city LIKE ? COLLATE NOCASE ESCAPE '\\'";
    params.push(`%${escapeLike(city)}%`);
  }
  if (state) {
    const matches = stateMatchSet(state);
    if (matches) {
      // Acronym side is exact-match to prevent substring false positives
      // (e.g., "IN" should not match "Illinois"). Full-name side stays LIKE
      // for partial-matching UX.
      sql += " AND (state = ? COLLATE NOCASE OR state LIKE ? COLLATE NOCASE ESCAPE '\\')";
      params.push(matches[0], `%${escapeLike(matches[1])}%`);
    } else {
      sql += " AND state LIKE ? COLLATE NOCASE ESCAPE '\\'";
      params.push(`%${escapeLike(state)}%`);
    }
  }
  sql += " ORDER BY created_at DESC, id DESC LIMIT ?";
  params.push(limit);
  return db.prepare(sql).all(...params);
}

/**
 * Count addresses in the shared pool matching optional city/state filters.
 * No user-scoping — counts across all users in the shared pool.
 */
export function countMatchingAddresses(db, { city, state }) {
  const params = [];
  let sql = "SELECT COUNT(*) AS cnt FROM user_addresses WHERE 1=1";
  if (city) {
    sql += " AND city LIKE ? COLLATE NOCASE ESCAPE '\\'";
    params.push(`%${escapeLike(city)}%`);
  }
  if (state) {
    const matches = stateMatchSet(state);
    if (matches) {
      // Acronym side is exact-match to prevent substring false positives
      // (e.g., "IN" should not match "Illinois"). Full-name side stays LIKE
      // for partial-matching UX.
      sql += " AND (state = ? COLLATE NOCASE OR state LIKE ? COLLATE NOCASE ESCAPE '\\')";
      params.push(matches[0], `%${escapeLike(matches[1])}%`);
    } else {
      sql += " AND state LIKE ? COLLATE NOCASE ESCAPE '\\'";
      params.push(`%${escapeLike(state)}%`);
    }
  }
  return db.prepare(sql).get(...params).cnt;
}


/**
 * Bulk-delete addresses from the shared pool by id. Any user can delete any
 * entry — ownership is not checked. Returns the number of rows actually
 * deleted (so callers can report "Deleted N of M" if some ids were stale).
 * Empty ids → 0, no DB hit. Non-positive / non-integer ids in the array are
 * filtered out before the SQL runs, so a caller passing user-supplied values
 * can't smuggle in `"DROP TABLE"` or negative ids.
 */
export function deleteAddresses(db, { ids }) {
  const validIds = (ids || []).filter((id) => Number.isInteger(id) && id > 0);
  if (validIds.length === 0) return 0;

  const placeholders = validIds.map(() => "?").join(",");
  const sql = `DELETE FROM user_addresses WHERE id IN (${placeholders})`;
  const info = db.prepare(sql).run(...validIds);
  return info.changes;
}

// ─────────────────────────────────────────────────────────────────────────────
// Discord layer — slash command builders
// ─────────────────────────────────────────────────────────────────────────────

export const ADDRESS_MODAL_ID = "mu_add_address";
export const ADDRESS_SEL_MENU_ID = "mu_addr_sel";
export const ADDRESS_DELSEL_PREFIX = "mu_addr_delsel";

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
    new TextInputBuilder().setCustomId("country").setLabel("Country").setStyle(TextInputStyle.Short).setMaxLength(MAX_COUNTRY).setRequired(true).setValue("USA"),
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

    const normalized = normalizeAddressTuple({ line1, city, state, postalCode, country });
    const duplicate = findDuplicateAddress(db, profile.id, normalized);
    if (duplicate) {
      await interaction.reply({
        content: `This address is already saved as #${duplicate.id}. Nothing to add.`,
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
    `${line1}\n` +
    `${city}\n` +
    `${state}\n` +
    `${postal}\n` +
    `${country}\n` +
    "```"
  );
}

export async function handleSearchAddressCommand(interaction, profile, db) {
  try {
    await interaction.deferReply({ ephemeral: true });

    const city  = interaction.options.getString("city")  ?? undefined;
    const state = interaction.options.getString("state") ?? undefined;

    const rows  = searchAddresses(db, { userId: profile.id, city, state, limit: SEARCH_LIMIT });
    // If the result set came back non-full, the total equals the returned count —
    // skip the extra count query in the common case.
    const total = rows.length < SEARCH_LIMIT
      ? rows.length
      : countMatchingAddresses(db, { userId: profile.id, city, state });

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

    // Multi-select dropdown + single "Delete Selected" button.
    // Dropdown starts with no pre-selection, so the button is disabled
    // until the user selects at least one address.
    const shownRows = rows.slice(0, shownCount);
    const components = [
      buildAddressSelectMenuRow(shownRows, /* selectedIds */ new Set()),
      buildDeleteSelectedButtonRow(/* selectedIds */ []),
    ];

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

/**
 * Build the multi-select dropdown ActionRow for /search-address results.
 * `selectedIds` is a Set of row.id values that should render as pre-selected
 * (checked) — used when re-rendering after the user changes their selection.
 */
function buildAddressSelectMenuRow(rows, selectedIds) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(ADDRESS_SEL_MENU_ID)
    .setPlaceholder("Select addresses to delete")
    .setMinValues(0)
    .setMaxValues(Math.max(rows.length, 1));

  for (const [idx, row] of rows.entries()) {
    // Label: "1. City, ST" — Discord caps label at 100 chars.
    const label = `${idx + 1}. ${row.city}, ${row.state}`.slice(0, 100);
    // Description: first line of the address — Discord caps at 100 chars.
    const description = row.line1.slice(0, 100);
    const opt = new StringSelectMenuOptionBuilder()
      .setLabel(label)
      .setValue(String(row.id))
      .setDescription(description);
    if (selectedIds.has(row.id)) opt.setDefault(true);
    menu.addOptions(opt);
  }

  return new ActionRowBuilder().addComponents(menu);
}

/**
 * Build the "Delete Selected" button ActionRow. Button is disabled until
 * at least one id is selected. The selected ids are embedded in the
 * customId so the click handler can read them without a separate store.
 */
function buildDeleteSelectedButtonRow(selectedIds) {
  const payload = selectedIds.join(",");
  const count = selectedIds.length;
  const button = new ButtonBuilder()
    .setCustomId(`${ADDRESS_DELSEL_PREFIX}:${payload}`)
    .setLabel(count > 0 ? `🗑 Delete Selected (${count})` : "🗑 Delete Selected")
    .setStyle(ButtonStyle.Danger)
    .setDisabled(count === 0);
  return new ActionRowBuilder().addComponents(button);
}

/**
 * Fires when the user opens the dropdown, ticks/unticks options, and closes it.
 * Re-renders the message so the checkmarks persist and the Delete Selected
 * button gets the selected ids embedded in its customId (and the right
 * label/disabled state).
 *
 * Menu options are reconstructed from `interaction.message.components` — the
 * message already holds the exact list that was originally shown, so we don't
 * need to re-query the DB (and don't have the original search filter handy).
 *
 * `profile` is currently unused because the ownership boundary lives in the
 * button-click handler (where rows are actually mutated). It's kept in the
 * signature so the dispatch layer stays uniform across all handlers.
 */
export async function handleAddressSelect(interaction, profile) { // eslint-disable-line no-unused-vars
  try {
    const selectedIdStrs = interaction.values; // ["1", "5", "7"]
    const selectedIds = selectedIdStrs
      .map((s) => Number(s))
      .filter((n) => Number.isInteger(n) && n > 0);
    const selectedSet = new Set(selectedIds);

    // Read the existing menu's options from the message and rebuild the menu
    // with the same options — just marking the now-selected ones as default.
    const existingMenu = interaction.message?.components?.[0]?.components?.[0];
    const existingOptions = existingMenu?.options ?? [];

    const menu = new StringSelectMenuBuilder()
      .setCustomId(ADDRESS_SEL_MENU_ID)
      .setPlaceholder("Select addresses to delete")
      .setMinValues(0)
      .setMaxValues(Math.max(existingOptions.length, 1));

    for (const existing of existingOptions) {
      const opt = new StringSelectMenuOptionBuilder()
        .setLabel(existing.label)
        .setValue(existing.value)
        .setDescription(existing.description || "");
      if (selectedSet.has(Number(existing.value))) opt.setDefault(true);
      menu.addOptions(opt);
    }

    const components = [
      new ActionRowBuilder().addComponents(menu),
      buildDeleteSelectedButtonRow(selectedIds),
    ];
    await interaction.update({ components });
  } catch (err) {
    console.error(`[address-book] select error: ${err.message}`);
    if (!interaction.replied && !interaction.deferred) {
      try {
        await interaction.reply({ content: "Something went wrong. Try again in a moment.", ephemeral: true });
      } catch (secondary) {
        console.error(`[address-book] select fallback reply failed: ${secondary.message}`);
      }
    }
  }
}

/**
 * Fires when the user clicks the Delete Selected button. Parses the selected
 * ids out of the customId payload, deletes them (scoped to the user), and
 * replies ephemerally with the count. Also strips components from the source
 * message so the stale select menu isn't used to "delete again" against
 * already-deleted rows.
 */
export async function handleAddressDeleteSelected(interaction, profile, rawPayload, db) {
  try {
    await interaction.deferReply({ ephemeral: true });

    const ids = (rawPayload || "")
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0);

    if (ids.length === 0) {
      try { await interaction.message.edit({ components: [] }); } catch {}
      await interaction.editReply({ content: "No addresses selected." });
      return;
    }

    const deleted = deleteAddresses(db, { ids, userId: profile.id });

    // Strip components from the source message so the stale menu can't be reused.
    try {
      await interaction.message.edit({ components: [] });
    } catch (editErr) {
      // Non-fatal: if the message is too old or gone, just carry on with the reply.
      console.error(`[address-book] message.edit after delete failed: ${editErr.message}`);
    }

    let content;
    if (deleted === 0) {
      content = "No matching addresses found — they may have already been deleted. Run /search-address again to refresh.";
    } else {
      const word = deleted === 1 ? "address" : "addresses";
      content = `Deleted ${deleted} ${word}. Run /search-address again to refresh.`;
    }
    await interaction.editReply({ content });
  } catch (err) {
    console.error(`[address-book] delete-selected error: ${err.message}`);
    if (interaction.deferred) {
      try { await interaction.editReply({ content: "Something went wrong. Try again in a moment." }); } catch {}
    } else if (!interaction.replied) {
      try { await interaction.reply({ content: "Something went wrong. Try again in a moment.", ephemeral: true }); } catch {}
    }
  }
}
