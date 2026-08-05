"use client";

import { useState, useEffect, useCallback } from "react";

const TICKET_CATEGORIES = [
  { value: "account", label: "Can't sign in / account issue" },
  { value: "question", label: "General question" },
  { value: "bug", label: "Something's broken" },
  { value: "missing_jobs", label: "Missing jobs" },
  { value: "feature_request", label: "Feature request" },
  { value: "other", label: "Other" },
];

function TicketStatusBadge({ status }) {
  const styleMap = {
    open: "bg-[rgba(245,158,11,0.12)] text-warn",
    in_progress: "bg-[rgba(59,130,246,0.12)] text-info",
    resolved: "bg-[rgba(34,197,94,0.12)] text-pulse",
    closed: "bg-[rgba(124,127,147,0.12)] text-faint",
  };
  const labelMap = { open: "Open", in_progress: "In Progress", resolved: "Resolved", closed: "Closed" };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${styleMap[status] || "bg-[rgba(124,127,147,0.12)] text-muted"}`}>
      {labelMap[status] || status}
    </span>
  );
}

function formatDate(dateStr) {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function SupportTickets({ isMember = false }) {
  const [category, setCategory] = useState("account");
  const [description, setDescription] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [tickets, setTickets] = useState([]);
  const [ticketsLoading, setTicketsLoading] = useState(isMember);

  const fetchTickets = useCallback(async () => {
    if (!isMember) return;
    try {
      const res = await fetch("/api/tickets");
      if (res.ok) { const data = await res.json(); setTickets(data.tickets || []); }
    } catch {} finally { setTicketsLoading(false); }
  }, [isMember]);

  useEffect(() => { fetchTickets(); }, [fetchTickets]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(""); setSuccess(false); setLoading(true);
    try {
      const res = await fetch(isMember ? "/api/tickets" : "/api/support", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isMember ? { category, description } : { category, description, email }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Failed to submit ticket."); return; }
      setSuccess(true); setDescription(""); setEmail("");
      if (isMember) fetchTickets();
      setTimeout(() => setSuccess(false), 5000);
    } catch { setError("Network error. Please try again."); }
    finally { setLoading(false); }
  }

  const inputClass = "field-control px-3.5 py-2.5 text-sm placeholder:text-faint";

  return (
    <div className="space-y-8">
      <div className="surface-card max-w-2xl rounded-2xl p-5 sm:p-7">
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-xl border border-[rgba(255,114,123,0.24)] bg-[rgba(255,114,123,0.08)] px-4 py-3 text-sm text-danger">{error}</div>
          )}
          {success && (
            <div className="rounded-xl border border-[rgba(215,255,112,0.2)] bg-[rgba(215,255,112,0.08)] px-4 py-3 text-sm text-pulse">
              {isMember ? "Ticket submitted. It's in our queue." : "Ticket submitted. We'll reply to your email."}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-foreground/80 mb-1">What is this about?</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass}>
              {TICKET_CATEGORIES.map((cat) => (
                <option key={cat.value} value={cat.value}>{cat.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground/80 mb-1">Your question or issue</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="Tell us what's going on..." required minLength={10} maxLength={2000} rows={5}
              className={`${inputClass} resize-none`} />
          </div>
          {!isMember && (
            <div>
              <label htmlFor="support-email" className="block text-sm font-medium text-foreground/80 mb-1">Your email</label>
              <input id="support-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com" required maxLength={254} autoComplete="email" className={inputClass} />
              <p className="mt-1.5 text-xs text-faint">Only used to reply to this ticket.</p>
            </div>
          )}
          <button type="submit" disabled={loading} className="primary-button w-full px-5 py-3">
            {loading ? "Submitting…" : "Submit"}
          </button>
        </form>
      </div>

      {isMember && (
        <section className="max-w-2xl">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-lg font-bold text-foreground">Your tickets</h2>
            <span className="text-xs text-faint">{tickets.length} total</span>
          </div>
          {ticketsLoading ? (
            <div className="text-muted text-sm py-4">Loading tickets...</div>
          ) : tickets.length === 0 ? (
            <div className="surface-card rounded-2xl p-8 text-center">
              <p className="text-sm text-muted">No tickets yet. Your submissions and our responses will show up here.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {tickets.map((ticket) => (
                <div key={ticket.id} className="surface-card rounded-2xl p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-xs font-medium text-faint uppercase tracking-wide">
                          {TICKET_CATEGORIES.find((c) => c.value === ticket.category)?.label || ticket.category}
                        </span>
                        <TicketStatusBadge status={ticket.status || "open"} />
                      </div>
                      <p className="text-sm text-muted break-words">{ticket.description}</p>
                      {ticket.admin_response && (
                        <div className="mt-3 rounded-xl border border-[rgba(215,255,112,0.12)] bg-[rgba(215,255,112,0.05)] px-3 py-2">
                          <div className="text-xs font-medium text-pulse mb-1">Response</div>
                          <p className="text-sm text-muted">{ticket.admin_response}</p>
                        </div>
                      )}
                    </div>
                    <div className="text-xs text-faint whitespace-nowrap">{formatDate(ticket.submitted_at)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
