#!/usr/bin/env node

import { getConfig } from "./config.js";
import { runPipelineOnce } from "./pipeline.js";
import { pathToFileURL } from "node:url";

export function parseCoreFlags(argv) {
  const flags = {
    inspectDescriptions: false,
    includeStale: false,
    sourceKeys: [],
    lanes: [],
    limit: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--inspect-descriptions") flags.inspectDescriptions = true;
    else if (arg === "--include-stale") flags.includeStale = true;
    else if (arg === "--source" || arg === "--lane" || arg === "--limit") {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      if (arg === "--source") flags.sourceKeys.push(value);
      if (arg === "--lane") {
        if (!["fast", "normal", "slow"].includes(value)) {
          throw new Error("--lane must be fast, normal, or slow");
        }
        flags.lanes.push(value);
      }
      if (arg === "--limit") {
        if (!/^\d+$/.test(value)) throw new Error("--limit must be a non-negative integer");
        flags.limit = Number(value);
      }
    } else if (arg === "--help" || arg === "-h") {
      flags.help = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return flags;
}

function printHelp() {
  console.log(`Usage: node src/core-cli.js [options]

Collect and process jobs without a database, web app, or delivery adapter.

Options:
  --source <key>          Limit to a source; repeatable
  --lane <lane>           Limit to fast, normal, or slow; repeatable
  --limit <count>         Limit processed output
  --include-stale         Do not apply the configured freshness window
  --inspect-descriptions  Fetch and inspect each job description
  -h, --help              Show this help`);
}

async function main() {
  const flags = parseCoreFlags(process.argv.slice(2));
  if (flags.help) {
    printHelp();
    return;
  }

  const config = getConfig();
  const logger = (message) => console.error(`[pipeline] ${message}`);
  const result = await runPipelineOnce(config, { ...flags, logger });

  for (const item of result.inspected) {
    process.stdout.write(`${JSON.stringify(item)}\n`);
  }
  console.error(JSON.stringify({
    collectors: result.totalCount,
    collectorErrors: result.errorCount,
    jobs: result.jobs.length,
  }));

  if (result.totalCount > 0 && result.errorCount === result.totalCount) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
