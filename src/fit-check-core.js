/**
 * fit-check-core.js - shared fit-check output parsing.
 *
 * The FIT_SCORES output contract is shared by the owner pipeline (tailor.js)
 * and the multi-user pipeline (mu-fit-check.js). Keep this module pure: no
 * I/O, no env reads.
 */

export function parseFitCheckOutput(output) {
  const result = {
    fitAssessment: "",
    shouldApply: "UNKNOWN",
    fitScore: null,
    fitScores: null,
  };

  // Extract fit assessment block
  const fullBlock = output.match(/(═{3,}[\s\S]*?FIT ASSESSMENT[\s\S]*?═{3,}[\s\S]*?═{3,})/);
  if (fullBlock) {
    result.fitAssessment = fullBlock[1].trim();
  }

  // Determine recommendation
  if (/Should Apply:\s*YES/i.test(output)) {
    result.shouldApply = "YES";
  } else if (/Should Apply:\s*STRETCH/i.test(output)) {
    result.shouldApply = "STRETCH";
  } else if (/Should Apply:\s*NO/i.test(output)) {
    result.shouldApply = "NO";
  }

  // Extract structured scores
  const scoresMatch = output.match(/FIT_SCORES:\s*(\{[^}]+\})/);
  if (scoresMatch) {
    try {
      const scores = JSON.parse(scoresMatch[1]);
      if (typeof scores.score === "number") {
        result.fitScore = scores.score;
        result.fitScores = scores;
      }
    } catch {}
  }

  return result;
}
