import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import {
  addressBookMigrate,
  countAddresses,
  insertAddress,
  searchAddresses,
  countMatchingAddresses,
  deleteAddress,
  MAX_ADDRESSES_PER_USER,
  canonicalState,
  stateMatchSet,
  normalizeAddressTuple,
  findDuplicateAddress,
} from "../src/address-book.js";

function makeDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE user_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_id TEXT UNIQUE NOT NULL
    );
    INSERT INTO user_profiles (id, discord_id) VALUES (1, 'u1'), (2, 'u2');
  `);
  addressBookMigrate(db);
  return db;
}

describe("addressBookMigrate", () => {
  it("creates user_addresses table with required columns", () => {
    const db = makeDb();
    const cols = db.pragma("table_info(user_addresses)").map((c) => c.name);
    expect(cols).toEqual(
      expect.arrayContaining(["id", "user_id", "line1", "city", "state", "postal_code", "country", "created_at"])
    );
  });

  it("is idempotent on re-run", () => {
    const db = makeDb();
    expect(() => addressBookMigrate(db)).not.toThrow();
  });
});

describe("insertAddress + countAddresses", () => {
  it("returns the new id and counts it for that user", () => {
    const db = makeDb();
    const id = insertAddress(db, {
      userId: 1,
      line1: "742 Evergreen Terr",
      city: "Springfield",
      state: "IL",
      postalCode: "62704",
      country: "USA",
    });
    expect(typeof id).toBe("number");
    expect(countAddresses(db, 1)).toBe(1);
    expect(countAddresses(db, 2)).toBe(0);
  });
});

describe("searchAddresses", () => {
  it("returns user's rows ordered by created_at DESC when no filter", () => {
    const db = makeDb();
    insertAddress(db, { userId: 1, line1: "A", city: "Austin",     state: "TX", postalCode: "1", country: "USA" });
    insertAddress(db, { userId: 1, line1: "B", city: "Springfield", state: "IL", postalCode: "2", country: "USA" });
    insertAddress(db, { userId: 2, line1: "C", city: "Austin",     state: "TX", postalCode: "3", country: "USA" });

    const rows = searchAddresses(db, { userId: 1 });
    expect(rows.map((r) => r.line1)).toEqual(["B", "A"]); // newest first
  });

  it("partial, case-insensitive match on city", () => {
    const db = makeDb();
    insertAddress(db, { userId: 1, line1: "A", city: "Springfield", state: "IL", postalCode: "1", country: "USA" });
    insertAddress(db, { userId: 1, line1: "B", city: "Austin",      state: "TX", postalCode: "2", country: "USA" });

    const rows = searchAddresses(db, { userId: 1, city: "spring" });
    expect(rows).toHaveLength(1);
    expect(rows[0].line1).toBe("A");
  });

  it("partial, case-insensitive match on state", () => {
    const db = makeDb();
    insertAddress(db, { userId: 1, line1: "A", city: "Springfield", state: "Illinois", postalCode: "1", country: "USA" });
    insertAddress(db, { userId: 1, line1: "B", city: "Austin",      state: "TX",       postalCode: "2", country: "USA" });

    const rows = searchAddresses(db, { userId: 1, state: "ill" });
    expect(rows).toHaveLength(1);
    expect(rows[0].line1).toBe("A");
  });

  it("combines city and state as AND", () => {
    const db = makeDb();
    insertAddress(db, { userId: 1, line1: "A", city: "Springfield", state: "IL", postalCode: "1", country: "USA" });
    insertAddress(db, { userId: 1, line1: "B", city: "Springfield", state: "MA", postalCode: "2", country: "USA" });

    const rows = searchAddresses(db, { userId: 1, city: "spring", state: "il" });
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe("IL");
  });

  it("respects limit", () => {
    const db = makeDb();
    for (let i = 0; i < 12; i++) {
      insertAddress(db, { userId: 1, line1: `L${i}`, city: "Austin", state: "TX", postalCode: String(i), country: "USA" });
    }
    expect(searchAddresses(db, { userId: 1, limit: 10 })).toHaveLength(10);
  });

  it("does not return other users' rows", () => {
    const db = makeDb();
    insertAddress(db, { userId: 1, line1: "A", city: "Austin", state: "TX", postalCode: "1", country: "USA" });
    insertAddress(db, { userId: 2, line1: "B", city: "Austin", state: "TX", postalCode: "2", country: "USA" });

    const rows = searchAddresses(db, { userId: 1, city: "austin" });
    expect(rows).toHaveLength(1);
    expect(rows[0].line1).toBe("A");
  });

  it("treats % in city as a literal, not a wildcard", () => {
    const db = makeDb();
    insertAddress(db, { userId: 1, line1: "A", city: "Austin",   state: "TX", postalCode: "1", country: "USA" });
    insertAddress(db, { userId: 1, line1: "B", city: "50% off",  state: "CA", postalCode: "2", country: "USA" });

    const rows = searchAddresses(db, { userId: 1, city: "%" });
    expect(rows).toHaveLength(1);
    expect(rows[0].line1).toBe("B");
  });

  it("treats _ in city as a literal, not a single-char wildcard", () => {
    const db = makeDb();
    insertAddress(db, { userId: 1, line1: "A", city: "Austin",    state: "TX", postalCode: "1", country: "USA" });
    insertAddress(db, { userId: 1, line1: "B", city: "under_score", state: "CA", postalCode: "2", country: "USA" });

    const rows = searchAddresses(db, { userId: 1, city: "_" });
    expect(rows).toHaveLength(1);
    expect(rows[0].line1).toBe("B");
  });
});

describe("countMatchingAddresses", () => {
  it("counts full match set ignoring limit", () => {
    const db = makeDb();
    for (let i = 0; i < 15; i++) {
      insertAddress(db, { userId: 1, line1: `L${i}`, city: "Austin", state: "TX", postalCode: String(i), country: "USA" });
    }
    expect(countMatchingAddresses(db, { userId: 1, city: "aus" })).toBe(15);
  });
});

describe("deleteAddress", () => {
  it("deletes a row the user owns and returns 1", () => {
    const db = makeDb();
    const id = insertAddress(db, { userId: 1, line1: "A", city: "Austin", state: "TX", postalCode: "1", country: "USA" });
    expect(deleteAddress(db, { id, userId: 1 })).toBe(1);
    expect(countAddresses(db, 1)).toBe(0);
  });

  it("returns 0 when id belongs to another user (does not delete)", () => {
    const db = makeDb();
    const id = insertAddress(db, { userId: 1, line1: "A", city: "Austin", state: "TX", postalCode: "1", country: "USA" });
    expect(deleteAddress(db, { id, userId: 2 })).toBe(0);
    expect(countAddresses(db, 1)).toBe(1);
  });

  it("returns 0 when id does not exist", () => {
    const db = makeDb();
    expect(deleteAddress(db, { id: 99999, userId: 1 })).toBe(0);
  });
});

describe("MAX_ADDRESSES_PER_USER", () => {
  it("is exported and equals 200", () => {
    expect(MAX_ADDRESSES_PER_USER).toBe(200);
  });
});

describe("canonicalState", () => {
  it("returns the acronym unchanged for a known acronym input", () => {
    expect(canonicalState("IL")).toBe("IL");
    expect(canonicalState("NY")).toBe("NY");
  });

  it("returns the acronym for a known full name input (any casing)", () => {
    expect(canonicalState("Illinois")).toBe("IL");
    expect(canonicalState("illinois")).toBe("IL");
    expect(canonicalState("ILLINOIS")).toBe("IL");
    expect(canonicalState("new york")).toBe("NY");
    expect(canonicalState("New York")).toBe("NY");
  });

  it("trims whitespace before lookup", () => {
    expect(canonicalState("  IL  ")).toBe("IL");
    expect(canonicalState("  Illinois  ")).toBe("IL");
  });

  it("returns the trimmed input unchanged when the value is not a known state", () => {
    expect(canonicalState("Ill")).toBe("Ill");
    expect(canonicalState("  Ill  ")).toBe("Ill");
    expect(canonicalState("Ontario")).toBe("Ontario");
    expect(canonicalState("")).toBe("");
  });

  it("handles District of Columbia", () => {
    expect(canonicalState("DC")).toBe("DC");
    expect(canonicalState("District of Columbia")).toBe("DC");
    expect(canonicalState("district of columbia")).toBe("DC");
  });

  it("handles null and undefined gracefully", () => {
    expect(canonicalState(null)).toBe("");
    expect(canonicalState(undefined)).toBe("");
  });
});

describe("stateMatchSet", () => {
  it("returns [acronym, full name] for a known acronym input", () => {
    expect(stateMatchSet("IL")).toEqual(["IL", "Illinois"]);
    expect(stateMatchSet("NY")).toEqual(["NY", "New York"]);
  });

  it("returns [acronym, full name] for a known full name input (any casing)", () => {
    expect(stateMatchSet("Illinois")).toEqual(["IL", "Illinois"]);
    expect(stateMatchSet("illinois")).toEqual(["IL", "Illinois"]);
    expect(stateMatchSet("new york")).toEqual(["NY", "New York"]);
  });

  it("trims whitespace before lookup", () => {
    expect(stateMatchSet("  IL  ")).toEqual(["IL", "Illinois"]);
  });

  it("returns null when the input is not a known state", () => {
    expect(stateMatchSet("Ill")).toBeNull();
    expect(stateMatchSet("Ontario")).toBeNull();
    expect(stateMatchSet("")).toBeNull();
  });

  it("handles null and undefined gracefully", () => {
    expect(stateMatchSet(null)).toBeNull();
    expect(stateMatchSet(undefined)).toBeNull();
  });
});

describe("normalizeAddressTuple", () => {
  it("trims, lowercases, and collapses internal whitespace on text fields", () => {
    const n = normalizeAddressTuple({
      line1: "  742   Evergreen   Terr  ",
      city: "  Springfield  ",
      state: "IL",
      postalCode: "62704",
      country: " USA ",
    });
    expect(n.line1).toBe("742 evergreen terr");
    expect(n.city).toBe("springfield");
    expect(n.country).toBe("usa");
  });

  it("canonicalizes state to acronym when known", () => {
    const n1 = normalizeAddressTuple({ line1: "x", city: "x", state: "illinois", postalCode: "1", country: "x" });
    expect(n1.state).toBe("IL");

    const n2 = normalizeAddressTuple({ line1: "x", city: "x", state: "IL", postalCode: "1", country: "x" });
    expect(n2.state).toBe("IL");
  });

  it("leaves unknown state inputs as trimmed unchanged", () => {
    const n = normalizeAddressTuple({ line1: "x", city: "x", state: "  Ontario  ", postalCode: "1", country: "CA" });
    expect(n.state).toBe("Ontario");
  });

  it("uppercases postal code and trims", () => {
    const n = normalizeAddressTuple({ line1: "x", city: "x", state: "IL", postalCode: "  k1a0b1  ", country: "Canada" });
    expect(n.postalCode).toBe("K1A0B1");
  });

  it("handles null/undefined field values defensively", () => {
    const n = normalizeAddressTuple({ line1: null, city: undefined, state: "IL", postalCode: null, country: undefined });
    expect(n.line1).toBe("");
    expect(n.city).toBe("");
    expect(n.postalCode).toBe("");
    expect(n.country).toBe("");
    expect(n.state).toBe("IL");
  });
});

describe("findDuplicateAddress", () => {
  it("returns null when no row matches", () => {
    const db = makeDb();
    insertAddress(db, { userId: 1, line1: "742 Evergreen Terr", city: "Springfield", state: "IL", postalCode: "62704", country: "USA" });
    const normalized = normalizeAddressTuple({ line1: "1 Main St", city: "Austin", state: "TX", postalCode: "78701", country: "USA" });
    expect(findDuplicateAddress(db, 1, normalized)).toBeNull();
  });

  it("finds a dup that differs only by casing", () => {
    const db = makeDb();
    const id = insertAddress(db, { userId: 1, line1: "742 Evergreen Terr", city: "Springfield", state: "IL", postalCode: "62704", country: "USA" });
    const normalized = normalizeAddressTuple({ line1: "742 EVERGREEN TERR", city: "SPRINGFIELD", state: "IL", postalCode: "62704", country: "usa" });
    const match = findDuplicateAddress(db, 1, normalized);
    expect(match).not.toBeNull();
    expect(match.id).toBe(id);
  });

  it("finds a dup that differs only by whitespace runs", () => {
    const db = makeDb();
    const id = insertAddress(db, { userId: 1, line1: "742 Evergreen Terr", city: "Springfield", state: "IL", postalCode: "62704", country: "USA" });
    const normalized = normalizeAddressTuple({ line1: "742  Evergreen   Terr", city: "Springfield", state: "IL", postalCode: "62704", country: "USA" });
    expect(findDuplicateAddress(db, 1, normalized)?.id).toBe(id);
  });

  it("treats rows stored as acronym and full name as duplicates of each other", () => {
    const db = makeDb();
    const id = insertAddress(db, { userId: 1, line1: "742 Evergreen Terr", city: "Springfield", state: "IL", postalCode: "62704", country: "USA" });
    const normalized = normalizeAddressTuple({ line1: "742 Evergreen Terr", city: "Springfield", state: "Illinois", postalCode: "62704", country: "USA" });
    expect(findDuplicateAddress(db, 1, normalized)?.id).toBe(id);
  });

  it("does NOT match another user's row", () => {
    const db = makeDb();
    insertAddress(db, { userId: 2, line1: "742 Evergreen Terr", city: "Springfield", state: "IL", postalCode: "62704", country: "USA" });
    const normalized = normalizeAddressTuple({ line1: "742 Evergreen Terr", city: "Springfield", state: "IL", postalCode: "62704", country: "USA" });
    expect(findDuplicateAddress(db, 1, normalized)).toBeNull();
  });

  it("does NOT match when any of the 5 fields differs materially", () => {
    const db = makeDb();
    insertAddress(db, { userId: 1, line1: "742 Evergreen Terr", city: "Springfield", state: "IL", postalCode: "62704", country: "USA" });
    const normalized = normalizeAddressTuple({ line1: "743 Evergreen Terr", city: "Springfield", state: "IL", postalCode: "62704", country: "USA" });
    expect(findDuplicateAddress(db, 1, normalized)).toBeNull();
  });

  it("returns the first match when multiple legacy duplicates exist", () => {
    const db = makeDb();
    const firstId  = insertAddress(db, { userId: 1, line1: "742 Evergreen Terr", city: "Springfield", state: "IL",       postalCode: "62704", country: "USA" });
    const secondId = insertAddress(db, { userId: 1, line1: "742 evergreen terr", city: "springfield", state: "Illinois", postalCode: "62704", country: "USA" });
    const normalized = normalizeAddressTuple({ line1: "742 Evergreen Terr", city: "Springfield", state: "IL", postalCode: "62704", country: "USA" });
    const match = findDuplicateAddress(db, 1, normalized);
    expect(match).not.toBeNull();
    // Data layer does not specify ordering; assert match is one of the two inserted rows.
    expect([firstId, secondId]).toContain(match.id);
  });
});
