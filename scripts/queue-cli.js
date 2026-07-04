/**
 * queue-cli.js: machine-readable CRUD for the company_queue table.
 *
 * Runs wherever data/jobs.db lives (EC2 in prod); the add-company automation
 * calls it over ssh. stdout carries JSON only; human noise goes to stderr.
 *
 * Usage:
 *   node scripts/queue-cli.js claim-next
 *       Requeues stale in_progress items, then atomically claims the oldest
 *       pending item. Prints the claimed row as JSON, or null.
 *   node scripts/queue-cli.js complete <id> <status> [notes]
 *       status: added | failed | duplicate | needs_human | pending
 *   node scripts/queue-cli.js list [status]
 *   node scripts/queue-cli.js add <name> [requestedBy]
 */

import {
  initDb,
  closeDb,
  addToCompanyQueue,
  claimNextPendingCompany,
  completeCompanyQueueItem,
  listCompanyQueue,
  requeueStaleInProgress,
} from "../src/state.js";
import { getConfig } from "../src/config.js";

const VALID_COMPLETE_STATUSES = new Set(["added", "failed", "duplicate", "needs_human", "pending"]);

function usage() {
  console.error("Usage: node scripts/queue-cli.js <claim-next|complete|list|add> [args]");
  process.exit(1);
}

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) usage();

initDb(getConfig().dbFile);

try {
  if (cmd === "claim-next") {
    const recovered = requeueStaleInProgress();
    if (recovered.requeued || recovered.failed) {
      console.error(`queue-cli: recovered stale items: ${JSON.stringify(recovered)}`);
    }
    console.log(JSON.stringify(claimNextPendingCompany()));
  } else if (cmd === "complete") {
    const [id, status, notes] = args;
    if (!id || !VALID_COMPLETE_STATUSES.has(status)) usage();
    const changes = completeCompanyQueueItem(Number(id), status, notes || "");
    console.log(JSON.stringify({ id: Number(id), status, updated: changes === 1 }));
  } else if (cmd === "list") {
    console.log(JSON.stringify(listCompanyQueue(args[0] || null, 50)));
  } else if (cmd === "add") {
    if (!args[0]) usage();
    addToCompanyQueue(args[0], args[1] || "");
    console.log(JSON.stringify({ added: args[0] }));
  } else {
    usage();
  }
} finally {
  closeDb();
}
