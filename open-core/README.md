# JobPulse Core

JobPulse Core is the open-source, delivery-agnostic part of JobPulse. It
collects jobs from public ATS endpoints and career sites, normalizes stable job
identities, deduplicates results, applies country/role/freshness filters, checks
link liveness, and can fetch and inspect job descriptions.

This repository intentionally contains no web application, user database,
Discord/email delivery code, deployment configuration, or personal tracker.
Those are private consumers of this package and communicate through explicit
application-owned adapters.

## Requirements

- Node.js 20.19 or newer (but below 26)
- Chromium only when using the Playwright-backed sources

## Run once

```bash
npm install
npx playwright install chromium
cp .env.example .env
npm start -- --source meta --limit 10
```

Output is newline-delimited JSON on stdout. Diagnostics and the final collector
summary go to stderr, which makes the CLI safe to pipe into another process.

Useful options:

```text
--source <key>          limit to a source; repeatable
--lane <lane>           fast, normal, or slow; repeatable
--limit <count>         cap processed output
--include-stale         bypass the freshness window
--inspect-descriptions  fetch and inspect job descriptions
```

## Library API

```js
import { runPipelineOnce } from "jobpulse-core";

const result = await runPipelineOnce(config, {
  sourceKeys: ["meta", "microsoft"],
  inspectDescriptions: true,
});
```

`src/pipeline.js` also exports the registry builder, batch collector, and job
inspection stage separately. Persistence and delivery are supplied by the
calling application rather than imported by the core.

## Security and responsible use

Collectors enforce bounded responses, timeouts, cancellation, public-network
URL validation, and conservative browser concurrency. Respect each site's
terms, robots policy, and rate limits when adding or operating a collector.

## License

MIT
