"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

const TICKET_CATEGORIES = [
  { value: "bug", label: "Bug Report" },
  { value: "missing_jobs", label: "Missing Jobs" },
  { value: "feature_request", label: "Feature Request" },
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
  if (!dateStr) return "\u2014";
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function SupportPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("issue");
  const [issueCategory, setIssueCategory] = useState("bug");
  const [issueDescription, setIssueDescription] = useState("");
  const [issueLoading, setIssueLoading] = useState(false);
  const [issueError, setIssueError] = useState("");
  const [issueSuccess, setIssueSuccess] = useState(false);
  const [suggCompany, setSuggCompany] = useState("");
  const [suggUrl, setSuggUrl] = useState("");
  const [suggReason, setSuggReason] = useState("");
  const [suggLoading, setSuggLoading] = useState(false);
  const [suggError, setSuggError] = useState("");
  const [suggSuccess, setSuggSuccess] = useState(false);
  const [tickets, setTickets] = useState([]);
  const [ticketsLoading, setTicketsLoading] = useState(true);

  const fetchTickets = useCallback(async () => {
    try {
      const res = await fetch("/api/tickets");
      if (res.status === 401) { router.push("/auth"); return; }
      if (res.ok) { const data = await res.json(); setTickets(data.tickets || []); }
    } catch {} finally { setTicketsLoading(false); }
  }, [router]);

  useEffect(() => { fetchTickets(); }, [fetchTickets]);

  async function handleIssueSubmit(e) {
    e.preventDefault();
    setIssueError(""); setIssueSuccess(false); setIssueLoading(true);
    try {
      const res = await fetch("/api/tickets", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: issueCategory, description: issueDescription }),
      });
      const data = await res.json();
      if (!res.ok) { setIssueError(data.error || "Failed to submit ticket."); return; }
      setIssueSuccess(true); setIssueDescription(""); setIssueCategory("bug");
      fetchTickets(); setTimeout(() => setIssueSuccess(false), 4000);
    } catch { setIssueError("Network error. Please try again."); }
    finally { setIssueLoading(false); }
  }

  async function handleSuggestionSubmit(e) {
    e.preventDefault();
    setSuggError(""); setSuggSuccess(false); setSuggLoading(true);
    try {
      const res = await fetch("/api/suggestions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyName: suggCompany, careersUrl: suggUrl, reason: suggReason }),
      });
      const data = await res.json();
      if (!res.ok) { setSuggError(data.error || "Failed to submit suggestion."); return; }
      setSuggSuccess(true); setSuggCompany(""); setSuggUrl(""); setSuggReason("");
      setTimeout(() => setSuggSuccess(false), 4000);
    } catch { setSuggError("Network error. Please try again."); }
    finally { setSuggLoading(false); }
  }

  const inputClass = "w-full bg-surface border border-line rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-faint focus:outline-none focus:border-pulse focus:ring-1 focus:ring-[rgba(34,197,94,0.2)]";

  return (
    <div className="max-w-2xl mx-auto space-y-8 animate-fade-in-up">
      <div>
        <h1 className="text-2xl font-bold text-foreground mb-1 font-display">Support</h1>
        <p className="text-muted text-sm">Report issues or suggest companies to add.</p>
      </div>

      <div className="bg-surface rounded-xl border border-line overflow-hidden">
        <div className="flex border-b border-line">
          <button onClick={() => setActiveTab("issue")}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${activeTab === "issue" ? "text-pulse border-b-2 border-pulse bg-[rgba(34,197,94,0.05)]" : "text-faint hover:text-muted"}`}>
            Report an Issue
          </button>
          <button onClick={() => setActiveTab("suggest")}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${activeTab === "suggest" ? "text-pulse border-b-2 border-pulse bg-[rgba(34,197,94,0.05)]" : "text-faint hover:text-muted"}`}>
            Suggest a Company
          </button>
        </div>

        <div className="p-6">
          {activeTab === "issue" && (
            <form onSubmit={handleIssueSubmit} className="space-y-4">
              {issueError && (
                <div className="bg-[rgba(239,68,68,0.1)] border border-[rgba(239,68,68,0.2)] text-danger text-sm px-4 py-3 rounded-lg">{issueError}</div>
              )}
              {issueSuccess && (
                <div className="bg-[rgba(34,197,94,0.1)] border border-[rgba(34,197,94,0.2)] text-pulse text-sm px-4 py-3 rounded-lg">Ticket submitted!</div>
              )}
              <div>
                <label className="block text-sm font-medium text-foreground/80 mb-1">Category</label>
                <select value={issueCategory} onChange={(e) => setIssueCategory(e.target.value)} className={inputClass}>
                  {TICKET_CATEGORIES.map((cat) => (
                    <option key={cat.value} value={cat.value}>{cat.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground/80 mb-1">Description</label>
                <textarea value={issueDescription} onChange={(e) => setIssueDescription(e.target.value)}
                  placeholder="Describe the issue in detail..." required minLength={10} rows={5}
                  className={`${inputClass} resize-none`} />
              </div>
              <button type="submit" disabled={issueLoading}
                className="w-full bg-pulse hover:bg-pulse-hover disabled:opacity-50 text-black font-semibold py-2.5 rounded-lg transition-colors">
                {issueLoading ? "Submitting..." : "Submit Ticket"}
              </button>
            </form>
          )}

          {activeTab === "suggest" && (
            <form onSubmit={handleSuggestionSubmit} className="space-y-4">
              {suggError && (
                <div className="bg-[rgba(239,68,68,0.1)] border border-[rgba(239,68,68,0.2)] text-danger text-sm px-4 py-3 rounded-lg">{suggError}</div>
              )}
              {suggSuccess && (
                <div className="bg-[rgba(34,197,94,0.1)] border border-[rgba(34,197,94,0.2)] text-pulse text-sm px-4 py-3 rounded-lg">Thanks! We'll review your suggestion.</div>
              )}
              <div>
                <label className="block text-sm font-medium text-foreground/80 mb-1">Company Name <span className="text-danger">*</span></label>
                <input type="text" value={suggCompany} onChange={(e) => setSuggCompany(e.target.value)}
                  placeholder="e.g. Palantir" required className={inputClass} />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground/80 mb-1">Careers Page URL</label>
                <input type="url" value={suggUrl} onChange={(e) => setSuggUrl(e.target.value)}
                  placeholder="https://example.com/careers" className={inputClass} />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground/80 mb-1">Why should we add this company?</label>
                <textarea value={suggReason} onChange={(e) => setSuggReason(e.target.value)}
                  placeholder="They sponsor H1B, post a lot of SWE roles, etc." rows={3}
                  className={`${inputClass} resize-none`} />
              </div>
              <button type="submit" disabled={suggLoading}
                className="w-full bg-pulse hover:bg-pulse-hover disabled:opacity-50 text-black font-semibold py-2.5 rounded-lg transition-colors">
                {suggLoading ? "Submitting..." : "Submit Suggestion"}
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Ticket History */}
      <section>
        <h2 className="text-base font-semibold text-foreground mb-3 font-display">Your Tickets</h2>
        {ticketsLoading ? (
          <div className="text-muted text-sm py-4">Loading tickets...</div>
        ) : tickets.length === 0 ? (
          <div className="bg-surface rounded-xl border border-line p-8 text-center">
            <p className="text-sm text-muted">No tickets submitted yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {tickets.map((ticket) => (
              <div key={ticket.id} className="bg-surface rounded-xl border border-line p-4">
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
                      <div className="mt-3 bg-[rgba(34,197,94,0.05)] border border-[rgba(34,197,94,0.1)] rounded-lg px-3 py-2">
                        <div className="text-xs font-medium text-pulse mb-1">Admin Response</div>
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
    </div>
  );
}
