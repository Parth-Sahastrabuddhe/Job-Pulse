import { fetchWithTimeout, delay } from "../sources/shared.js";

const MAX_MESSAGE_LENGTH = 1800;
const MAX_RETRIES = 3;

class UncertainDeliveryError extends Error {
  constructor(message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = "UncertainDeliveryError";
  }
}

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

export function chunkMessages(jobs, heading) {
  const chunks = [];
  let current = { content: heading, jobs: [] };

  for (const job of jobs) {
    const block = `\n\n${formatJob(job)}`;

    if ((current.content + block).length > MAX_MESSAGE_LENGTH && current.jobs.length > 0) {
      chunks.push(current);
      current = { content: heading, jobs: [] };
    }

    // Collector fields are bounded before this point, but retain a final API
    // limit guard so malformed persisted data cannot make the whole batch fail.
    const remaining = MAX_MESSAGE_LENGTH - current.content.length;
    current.content += block.length > remaining
      ? `${block.slice(0, Math.max(0, remaining - 1))}…`
      : block;
    current.jobs.push(job);
  }

  if (current.jobs.length > 0) {
    chunks.push(current);
  }

  return chunks;
}

async function responseError(response) {
  try {
    return (await response.text()).slice(0, 200);
  } catch {
    return "unreadable response";
  }
}

async function postChunk(webhookUrl, content, options) {
  const fetchFn = options.fetchFn || fetchWithTimeout;
  const delayFn = options.delayFn || delay;
  const maxRetries = Number.isInteger(options.maxRetries) ? Math.max(0, options.maxRetries) : MAX_RETRIES;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let response;
    try {
      response = await fetchFn(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content,
          // Job titles and company names are untrusted ATS input. Never allow
          // them to turn into @everyone, role, or user notifications.
          allowed_mentions: { parse: [] },
        })
      }, 10000);
    } catch (error) {
      // A transport exception can happen after Discord accepted the request.
      // Retrying or falling back would risk a duplicate, so preserve the claim.
      throw new UncertainDeliveryError(
        `Discord webhook delivery outcome is uncertain: ${error?.message || error}`,
        error,
      );
    }

    if (response.ok) return;

    const body = await responseError(response);
    const error = new Error(`Discord webhook failed with status ${response.status}: ${body}`);

    // A received 429 explicitly says the request was rate-limited and may be
    // retried. Other server-side failures can occur after accepting the post,
    // so treat 5xx responses as uncertain rather than retrying them.
    if (response.status === 429 && attempt < maxRetries) {
      const retryAfter = Number.parseFloat(response.headers?.get?.("retry-after") || "");
      const delayMs = Number.isFinite(retryAfter)
        ? Math.min(Math.max(retryAfter * 1000, 0), 10000)
        : 1000 * 2 ** attempt;
      console.error(`[discord] HTTP 429, retrying in ${delayMs}ms (attempt ${attempt + 1}/${maxRetries})`);
      await delayFn(delayMs);
      continue;
    }

    if (response.status >= 500) {
      throw new UncertainDeliveryError(error.message, error);
    }
    throw error;
  }
}

export async function sendDiscordNotification(webhookUrl, jobs, options = {}) {
  const result = { deliveredJobs: [], failedJobs: [], uncertainJobs: [], errors: [] };
  if (!webhookUrl || jobs.length === 0) {
    result.failedJobs.push(...jobs);
    return result;
  }

  const messages = chunkMessages(jobs, `New software engineering jobs: ${jobs.length}`);

  for (const chunk of messages) {
    if (options.dryRun) {
      console.log(`[dry-run][discord]\n${chunk.content}`);
      result.deliveredJobs.push(...chunk.jobs);
      continue;
    }

    try {
      await postChunk(webhookUrl, chunk.content, options);
    } catch (error) {
      if (error instanceof UncertainDeliveryError) {
        result.uncertainJobs.push(...chunk.jobs);
      } else {
        result.failedJobs.push(...chunk.jobs);
      }
      result.errors.push(error);
      continue;
    }

    try {
      if (options.onChunkDelivered) await options.onChunkDelivered(chunk.jobs);
      result.deliveredJobs.push(...chunk.jobs);
    } catch (error) {
      // The remote endpoint accepted the message, so retrying could duplicate
      // it. Keep the durable pre-send claim and surface an uncertain outcome.
      result.uncertainJobs.push(...chunk.jobs);
      result.errors.push(error);
    }
  }

  return result;
}
