import { fetchWithTimeout, delay } from "../sources/shared.js";

const MAX_MESSAGE_LENGTH = 1800;
const MAX_RETRIES = 3;

function formatJob(job) {
  const parts = [`[${job.sourceLabel}] ${job.title}`];

  if (job.id) {
    parts.push(`Job ID: ${job.id}`);
  }

  parts.push(job.location || "Location not mentioned");

  if (job.postedText) {
    parts.push(job.postedText);
  }

  return `- ${parts.join(" | ")}\n${job.url}`;
}

function chunkMessages(jobs, heading) {
  const chunks = [];
  let current = heading;

  for (const job of jobs) {
    const block = `\n\n${formatJob(job)}`;

    if ((current + block).length > MAX_MESSAGE_LENGTH) {
      chunks.push(current);
      current = heading + block;
      continue;
    }

    current += block;
  }

  if (current.trim()) {
    chunks.push(current);
  }

  return chunks;
}

export async function sendDiscordNotification(webhookUrl, jobs, options = {}) {
  if (!webhookUrl || jobs.length === 0) {
    return;
  }

  const messages = chunkMessages(jobs, `New software engineering jobs: ${jobs.length}`);

  for (const content of messages) {
    if (options.dryRun) {
      console.log(`[dry-run][discord]\n${content}`);
      continue;
    }

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const response = await fetchWithTimeout(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content })
      }, 10000);

      if (response.ok) break;

      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === MAX_RETRIES) {
        const body = await response.text();
        throw new Error(`Discord webhook failed with status ${response.status}: ${body.slice(0, 200)}`);
      }

      const retryAfter = response.headers.get("retry-after");
      const delayMs = retryAfter ? Math.min(parseInt(retryAfter, 10) * 1000 || 1000, 10000) : 1000 * 2 ** attempt;
      console.error(`[discord] HTTP ${response.status}, retrying in ${delayMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
      await delay(delayMs);
    }
  }
}
