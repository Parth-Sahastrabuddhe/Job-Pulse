import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Canonical shared SQLite path. DB_PATH remains a compatibility fallback. */
export function resolveDbFile(env = process.env) {
  const configured = String(env.DB_FILE || env.DB_PATH || "data/jobs.db").trim();
  if (!configured) throw new Error("DB_FILE must not be empty");
  return path.isAbsolute(configured) ? configured : path.resolve(PROJECT_ROOT, configured);
}

/** Create (without truncating) and restrict a private SQLite database file. */
export function preparePrivateDbFile(dbFile) {
  if (!dbFile || dbFile === ":memory:") return;
  const dbDir = path.dirname(dbFile);
  // Do not chmod an existing parent: it may be shared deliberately. A newly
  // created application data directory, however, must start owner-only.
  const createdDir = fs.mkdirSync(dbDir, { recursive: true, mode: 0o700 });
  if (createdDir) fs.chmodSync(dbDir, 0o700);

  // Append mode creates atomically without truncating an existing database.
  const flags = fs.constants.O_CREAT |
    fs.constants.O_APPEND |
    fs.constants.O_WRONLY |
    (fs.constants.O_NOFOLLOW || 0);
  const descriptor = fs.openSync(dbFile, flags, 0o600);
  try {
    if (!fs.fstatSync(descriptor).isFile()) {
      throw new Error(`SQLite path is not a regular file: ${dbFile}`);
    }
    // Apply permissions through the opened descriptor so a path swap cannot
    // redirect chmod to another owner-controlled file.
    fs.fchmodSync(descriptor, 0o600);
  } finally {
    fs.closeSync(descriptor);
  }
}

/** Restrict SQLite's database and any currently materialized WAL sidecars. */
export function hardenSqliteFilePermissions(dbFile) {
  if (!dbFile || dbFile === ":memory:") return;
  for (const suffix of ["", "-wal", "-shm"]) {
    const sqliteFile = `${dbFile}${suffix}`;
    if (fs.existsSync(sqliteFile)) fs.chmodSync(sqliteFile, 0o600);
  }
}
