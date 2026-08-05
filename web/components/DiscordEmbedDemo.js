// Static replica of a real JobLookout alert DM. Layout mirrors buildJobEmbed
// in src/mu-delivery.js (author = company, linked title, description lines,
// H-1B history line) plus the live button row from src/discord-bot.js.
// Fit Check is deliberately absent until the feature ships.

function BotAvatar() {
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-pulse text-[#07100c]">
      <svg viewBox="0 0 32 32" width="22" height="22" fill="none" aria-hidden="true">
        <path d="M5 18.5a11 11 0 0 1 22 0" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        <path d="M8 18.5a8 8 0 0 1 16 0" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" opacity=".55" />
        <path d="M4.5 22.5h23" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="16" cy="16" r="2.3" fill="currentColor" />
      </svg>
    </span>
  );
}

function DiscordButton({ children, variant = "secondary" }) {
  const styles = variant === "success"
    ? "bg-[#248046] text-white"
    : "bg-[#4e5058] text-white";
  return (
    <span className={`inline-flex cursor-default select-none items-center gap-1.5 rounded-[8px] px-4 py-2 text-[13px] font-medium leading-none ${styles}`}>
      {children}
    </span>
  );
}

export default function DiscordEmbedDemo() {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-[#313338] shadow-2xl">
      <div className="flex items-center gap-2 border-b border-[#26272b] px-4 py-2.5 text-xs font-semibold text-[#949ba4]">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z" />
        </svg>
        Direct message · JobLookout
      </div>

      <div className="flex gap-3.5 px-4 py-4">
        <BotAvatar />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-semibold text-white">JobLookout</span>
            <span className="rounded-[4px] bg-[#5865f2] px-1.5 py-0.5 text-[10px] font-bold uppercase leading-none text-white">App</span>
            <span className="text-xs text-[#949ba4]">Today at 9:14 AM</span>
          </div>

          <div className="mt-2 max-w-md overflow-hidden rounded-[4px] border-l-4 border-[#5865f2] bg-[#2b2d31] p-3.5">
            <div className="text-xs font-semibold text-[#dbdee1]">Databricks</div>
            <div className="mt-1.5 text-[15px] font-semibold leading-snug text-[#00a8fc]">
              Software Engineer II - Distributed Systems
            </div>
            <div className="mt-2 space-y-0.5 text-[13px] leading-relaxed text-[#dbdee1]">
              <div>Bellevue, WA</div>
              <div>Posted: 22 minutes ago</div>
              <div>Level: L3 (≈ entry-mid, SDE 1 / E3 equivalent)</div>
              <div>🛂 H-1B 2025: ~1,850 LCAs certified, median ~$165k</div>
            </div>
          </div>

          <div className="mt-2.5 flex max-w-md flex-wrap gap-1.5">
            <DiscordButton>
              View Job
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M7 17 17 7M9 7h8v8" />
              </svg>
            </DiscordButton>
            <DiscordButton variant="success">Applied</DiscordButton>
            <DiscordButton>Save</DiscordButton>
            <DiscordButton>Skip</DiscordButton>
          </div>
        </div>
      </div>
    </div>
  );
}
