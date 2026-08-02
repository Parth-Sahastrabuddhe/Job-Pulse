/**
 * Aggregate collector outcomes across a complete scheduling window.
 *
 * Health must not depend on arbitrary batch boundaries: with 181 collectors
 * and a batch size of 20, the final batch contains one source. Treating that
 * singleton as its own health population makes one transient source timeout
 * look like a total pipeline outage.
 */

const MAX_FAILURE_DETAILS = 20;

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function normalizeFailure(error) {
  return {
    key: String(error?.key || "unknown").slice(0, 100),
    message: String(error?.error?.message || error?.message || "collector failed").slice(0, 300),
  };
}

export function createCollectorHealthWindow() {
  let totalCount = 0;
  let errorCount = 0;
  let errors = [];

  return {
    record(collection) {
      const total = nonNegativeInteger(collection?.totalCount);
      const failed = Math.min(total, nonNegativeInteger(collection?.errorCount));
      totalCount += total;
      errorCount += failed;
      if (errors.length < MAX_FAILURE_DETAILS && Array.isArray(collection?.errors)) {
        errors.push(
          ...collection.errors
            .slice(0, MAX_FAILURE_DETAILS - errors.length)
            .map(normalizeFailure),
        );
      }
    },

    snapshot() {
      return { totalCount, errorCount, errors: errors.map((error) => ({ ...error })) };
    },

    take() {
      const result = this.snapshot();
      totalCount = 0;
      errorCount = 0;
      errors = [];
      return result;
    },
  };
}

export function allWindowCollectorsFailed(collection) {
  const total = nonNegativeInteger(collection?.totalCount);
  return total > 0 && nonNegativeInteger(collection?.errorCount) === total;
}

export function collectorFailureReason(collection, label, maxKeys = 8) {
  const total = nonNegativeInteger(collection?.totalCount);
  const keys = Array.isArray(collection?.errors)
    ? collection.errors
      .map((error) => String(error?.key || "").trim())
      .filter(Boolean)
      .slice(0, maxKeys)
    : [];
  const detail = keys.length > 0 ? `; sources: ${keys.join(", ")}` : "";
  return `all ${total} collectors in ${label} failed${detail}`;
}
