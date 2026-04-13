/**
 * Zero-cost ghost job legitimacy detection.
 * Pure SQL + regex only — no LLM, no external API calls.
 *
 * checkLegitimacy(job, description, opts?) → { tier, topSignal, signals }
 *   tier:      'high_confidence' | 'caution' | 'suspicious'
 *   topSignal: string | null  — most significant signal message (shown in Discord)
 *   signals:   string[]       — all fired signal messages
 *
 * opts.getRepostCountFn — injectable for testing; defaults to state.js export
 */

import { getRepostCount as _defaultGetRepostCount } from "./state.js";

// Strip seniority/level words before repost title matching
const SENIORITY_STRIP_RE = /\b(senior|sr\.?|junior|jr\.?|lead|staff|principal|distinguished)\b|\s+[IVX]+\s*$|\s+[IVX]+$/gi;

// Evergreen / pool posting patterns
const EVERGREEN_RE = /\b(always\s+hiring|ongoing\s+recruitment|talent\s+pool|pipeline\s+role|building\s+a\s+pipeline|future\s+openings?|similar\s+roles?\s+may\s+be\s+available|may\s+not\s+have\s+an\s+immediate\s+opening)\b/i;

// Age thresholds in days per seniority level. Missing key = skip signal.
const AGE_THRESHOLDS = {
  entry:     { caution: 30, suspicious: 60 },
  entry_mid: { caution: 30, suspicious: 60 },
  mid:       { caution: 30, suspicious: 60 },
  senior:    { caution: 45, suspicious: 90 },
  // staff, director: intentionally omitted — skip age signal
};

// Signal evaluation order — also the topSignal priority (first = highest priority)
const SIGNAL_KEYS = ["repost", "age", "thin", "evergreen"];

function stripTitleCore(title) {
  return title
    .replace(SENIORITY_STRIP_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function signalAge(job) {
  const thresholds = AGE_THRESHOLDS[job.seniorityLevel];
  if (!thresholds || !job.postedAt) return null;

  const ageMs = Date.now() - Date.parse(job.postedAt);
  if (!Number.isFinite(ageMs) || ageMs < 0) return null;
  const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));

  if (ageDays > thresholds.suspicious) {
    return { weight: "suspicious", message: `Posted ${ageDays} days ago` };
  }
  if (ageDays > thresholds.caution) {
    return { weight: "caution", message: `Posted ${ageDays} days ago` };
  }
  return null;
}

function signalRepost(job, getRepostCountFn) {
  if (!job.sourceLabel || !job.title || !job.key) return null;
  const titleCore = stripTitleCore(job.title);
  if (!titleCore) return null;

  const count = getRepostCountFn(job.sourceLabel, titleCore, job.key, 90);
  if (count >= 2) {
    return { weight: "suspicious", message: `Reposted ${count + 1}× in 90 days` };
  }
  if (count === 1) {
    return { weight: "caution", message: "Reposted once in 90 days" };
  }
  return null;
}

function signalThinJd(description) {
  if (!description) return null;
  const cleaned = description.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;

  if (cleaned.length < 300) {
    return { weight: "suspicious", message: `Very thin job description (${cleaned.length} chars)` };
  }
  if (cleaned.length < 600) {
    return { weight: "caution", message: `Thin job description (${cleaned.length} chars)` };
  }
  return null;
}

function signalEvergreen(description) {
  if (!description) return null;
  if (EVERGREEN_RE.test(description)) {
    return { weight: "caution", message: "Evergreen posting — talent pool or pipeline role" };
  }
  return null;
}

export function checkLegitimacy(job, description, { getRepostCountFn = _defaultGetRepostCount } = {}) {
  try {
    const rawSignals = {
      repost:    signalRepost(job, getRepostCountFn),
      age:       signalAge(job),
      thin:      signalThinJd(description),
      evergreen: signalEvergreen(description),
    };

    // Collect in priority order, drop nulls
    const fired = SIGNAL_KEYS.map((k) => rawSignals[k]).filter(Boolean);

    if (fired.length === 0) {
      return { tier: "high_confidence", topSignal: null, signals: [] };
    }

    const hasSuspicious = fired.some((s) => s.weight === "suspicious");
    const tier = hasSuspicious ? "suspicious" : "caution";

    // topSignal: first suspicious, then first caution (already in priority order)
    const topSignal =
      (fired.find((s) => s.weight === "suspicious") || fired[0])?.message ?? null;

    return {
      tier,
      topSignal,
      signals: fired.map((s) => s.message),
    };
  } catch (err) {
    console.warn(`[legitimacy] checkLegitimacy error: ${err.message}`);
    return { tier: "high_confidence", topSignal: null, signals: [] };
  }
}
