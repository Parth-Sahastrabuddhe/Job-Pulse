const STATUS_STYLES = {
  notified: "bg-[rgba(124,127,147,0.12)] text-muted",
  saved: "bg-[rgba(59,130,246,0.15)] text-info",
  applied: "bg-[rgba(34,197,94,0.15)] text-pulse",
  skipped: "bg-[rgba(78,81,102,0.15)] text-faint",
  interviewing: "bg-[rgba(59,130,246,0.15)] text-info",
  offer: "bg-[rgba(245,158,11,0.15)] text-warn",
  rejected: "bg-[rgba(239,68,68,0.15)] text-danger",
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
  const style = STATUS_STYLES[status] || "bg-[rgba(124,127,147,0.12)] text-muted";
  const label = STATUS_LABELS[status] || status;

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${style}`}>
      {label}
    </span>
  );
}
