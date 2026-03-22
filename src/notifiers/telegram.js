const MAX_MESSAGE_LENGTH = 3900;

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

export async function sendTelegramNotification(botToken, chatId, jobs, options = {}) {
  if (!botToken || !chatId || jobs.length === 0) {
    return;
  }

  const messages = chunkMessages(jobs, `New software engineering jobs: ${jobs.length}`);

  for (const text of messages) {
    if (options.dryRun) {
      console.log(`[dry-run][telegram]\n${text}`);
      continue;
    }

    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: false
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Telegram notification failed with status ${response.status}: ${body.slice(0, 200)}`);
    }
  }
}
