import { fetchWithTimeout, delay } from "../sources/shared.js";

const MAX_MESSAGE_LENGTH = 3900;
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
  let current = { text: heading, jobs: [] };

  for (const job of jobs) {
    const block = `\n\n${formatJob(job)}`;

    if ((current.text + block).length > MAX_MESSAGE_LENGTH && current.jobs.length > 0) {
      chunks.push(current);
      current = { text: heading, jobs: [] };
    }

    const remaining = MAX_MESSAGE_LENGTH - current.text.length;
    current.text += block.length > remaining
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

async function postChunk(botToken, chatId, text, options) {
  const fetchFn = options.fetchFn || fetchWithTimeout;
  const delayFn = options.delayFn || delay;
  const maxRetries = Number.isInteger(options.maxRetries) ? Math.max(0, options.maxRetries) : MAX_RETRIES;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let response;
    try {
      response = await fetchFn(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          disable_web_page_preview: false
        })
      }, 10000);
    } catch (error) {
      throw new UncertainDeliveryError(
        `Telegram delivery outcome is uncertain: ${error?.message || error}`,
        error,
      );
    }

    if (response.ok) return;

    const body = await responseError(response);
    const error = new Error(`Telegram notification failed with status ${response.status}: ${body}`);

    if (response.status === 429 && attempt < maxRetries) {
      const retryAfterHeader = Number.parseFloat(response.headers?.get?.("retry-after") || "");
      const delayMs = Number.isFinite(retryAfterHeader)
        ? Math.min(Math.max(retryAfterHeader * 1000, 0), 10000)
        : 1000 * 2 ** attempt;
      console.error(`[telegram] HTTP 429, retrying in ${delayMs}ms (attempt ${attempt + 1}/${maxRetries})`);
      await delayFn(delayMs);
      continue;
    }

    if (response.status >= 500) {
      throw new UncertainDeliveryError(error.message, error);
    }
    throw error;
  }
}

export async function sendTelegramNotification(botToken, chatId, jobs, options = {}) {
  const result = { deliveredJobs: [], failedJobs: [], uncertainJobs: [], errors: [] };
  if (!botToken || !chatId || jobs.length === 0) {
    result.failedJobs.push(...jobs);
    return result;
  }

  const messages = chunkMessages(jobs, `New software engineering jobs: ${jobs.length}`);

  for (const chunk of messages) {
    if (options.dryRun) {
      console.log(`[dry-run][telegram]\n${chunk.text}`);
      result.deliveredJobs.push(...chunk.jobs);
      continue;
    }

    try {
      await postChunk(botToken, chatId, chunk.text, options);
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
      result.uncertainJobs.push(...chunk.jobs);
      result.errors.push(error);
    }
  }

  return result;
}
