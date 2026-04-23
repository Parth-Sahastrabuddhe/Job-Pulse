// src/address-book.js
//
// Per-user address book. Data layer lives here; Discord handlers are added in
// later tasks and also live in this file (single-feature module).

export const MAX_ADDRESSES_PER_USER = 200;
export const MAX_LINE1 = 120;
export const MAX_CITY = 60;
export const MAX_STATE = 60;
export const MAX_POSTAL = 20;
export const MAX_COUNTRY = 60;
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
