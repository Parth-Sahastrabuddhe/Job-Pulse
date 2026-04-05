const STATUS_STYLES = {
  notified: "bg-gray-100 text-gray-600",
  applied: "bg-green-100 text-green-700",
  skipped: "bg-gray-200 text-gray-500",
  interviewing: "bg-blue-100 text-blue-700",
  offer: "bg-yellow-100 text-yellow-700",
  rejected: "bg-red-100 text-red-600",
};

const STATUS_LABELS = {
  notified: "Notified",
  applied: "Applied",
  skipped: "Skipped",
  interviewing: "Interviewing",
  offer: "Offer",
  rejected: "Rejected",
};

export default function StatusBadge({ status }) {
  const style = STATUS_STYLES[status] || "bg-gray-100 text-gray-600";
  const label = STATUS_LABELS[status] || status;

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${style}`}>
      {label}
    </span>
  );
}
