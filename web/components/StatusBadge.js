const STATUS_STYLES = {
  notified: "border-line bg-white/[0.04] text-muted",
  saved: "border-info/25 bg-info/10 text-info",
  applied: "border-pulse/25 bg-pulse/10 text-pulse",
  skipped: "border-line bg-white/[0.03] text-faint",
  interviewing: "border-info/25 bg-info/10 text-info",
  offer: "border-warn/25 bg-warn/10 text-warn",
  rejected: "border-danger/25 bg-danger/10 text-danger",
};

const STATUS_LABELS = {
  notified: "Notified",
  saved: "Saved",
  applied: "Applied",
  skipped: "Skipped",
  interviewing: "Interviewing",
  offer: "Offer",
  rejected: "Rejected",
};

export default function StatusBadge({ status }) {
  const style = STATUS_STYLES[status] || "border-line bg-white/[0.04] text-muted";
  const label = STATUS_LABELS[status] || status;

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${style}`}>
      {label}
    </span>
  );
}
