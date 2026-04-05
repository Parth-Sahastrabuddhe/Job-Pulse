"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import StatusBadge from "@/components/StatusBadge";

const TICKET_CATEGORIES = [
  { value: "bug", label: "Bug Report" },
  { value: "missing_jobs", label: "Missing Jobs" },
  { value: "feature_request", label: "Feature Request" },
  { value: "other", label: "Other" },
];

const TICKET_STATUS_MAP = {
  open: "notified",
  in_progress: "interviewing",
  resolved: "applied",
  closed: "skipped",
};

function TicketStatusBadge({ status }) {
  const styleMap = {
    open: "bg-yellow-100 text-yellow-700",
    in_progress: "bg-blue-100 text-blue-700",
    resolved: "bg-green-100 text-green-700",
    closed: "bg-gray-100 text-gray-500",
  };
  const labelMap = {
    open: "Open",
    in_progress: "In Progress",
    resolved: "Resolved",
    closed: "Closed",
  };
  const style = styleMap[status] || "bg-gray-100 text-gray-600";
  const label = labelMap[status] || status;
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${style}`}>
      {label}
    </span>
  );
}

function formatDate(dateStr) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function SupportPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("issue");

  // Issue form state
  const [issueCategory, setIssueCategory] = useState("bug");
  const [issueDescription, setIssueDescription] = useState("");
  const [issueLoading, setIssueLoading] = useState(false);
  const [issueError, setIssueError] = useState("");
  const [issueSuccess, setIssueSuccess] = useState(false);

  // Suggestion form state
  const [suggCompany, setSuggCompany] = useState("");
  const [suggUrl, setSuggUrl] = useState("");
  const [suggReason, setSuggReason] = useState("");
  const [suggLoading, setSuggLoading] = useState(false);
  const [suggError, setSuggError] = useState("");
  const [suggSuccess, setSuggSuccess] = useState(false);

  // Tickets list
  const [tickets, setTickets] = useState([]);
  const [ticketsLoading, setTicketsLoading] = useState(true);

  const fetchTickets = useCallback(async () => {
    try {
      const res = await fetch("/api/tickets");
      if (res.status === 401) {
        router.push("/auth");
        return;
      }
      if (res.ok) {
        const data = await res.json();
        setTickets(data.tickets || []);
      }
    } catch {
      // non-critical, tickets load silently
    } finally {
      setTicketsLoading(false);
    }
  }, [router]);

  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  async function handleIssueSubmit(e) {
    e.preventDefault();
    setIssueError("");
    setIssueSuccess(false);
    setIssueLoading(true);

    try {
      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: issueCategory, description: issueDescription }),
      });
      const data = await res.json();

      if (!res.ok) {
        setIssueError(data.error || "Failed to submit ticket.");
        return;
      }

      setIssueSuccess(true);
      setIssueDescription("");
      setIssueCategory("bug");
      fetchTickets();
      setTimeout(() => setIssueSuccess(false), 4000);
    } catch {
      setIssueError("Network error. Please try again.");
    } finally {
      setIssueLoading(false);
    }
  }

  async function handleSuggestionSubmit(e) {
    e.preventDefault();
    setSuggError("");
    setSuggSuccess(false);
    setSuggLoading(true);

    try {
      const res = await fetch("/api/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyName: suggCompany, careersUrl: suggUrl, reason: suggReason }),
      });
      const data = await res.json();

      if (!res.ok) {
        setSuggError(data.error || "Failed to submit suggestion.");
        return;
      }

      setSuggSuccess(true);
      setSuggCompany("");
      setSuggUrl("");
      setSuggReason("");
      setTimeout(() => setSuggSuccess(false), 4000);
    } catch {
      setSuggError("Network error. Please try again.");
    } finally {
      setSuggLoading(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Support</h1>
        <p className="text-gray-500 text-sm">Report issues or suggest companies to add.</p>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex border-b border-gray-200">
          <button
            onClick={() => setActiveTab("issue")}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              activeTab === "issue"
                ? "text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            Report an Issue
          </button>
          <button
            onClick={() => setActiveTab("suggest")}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              activeTab === "suggest"
                ? "text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            Suggest a Company
          </button>
        </div>

        <div className="p-6">
          {activeTab === "issue" && (
            <form onSubmit={handleIssueSubmit} className="space-y-4">
              {issueError && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">
                  {issueError}
                </div>
              )}
              {issueSuccess && (
                <div className="bg-green-50 border border-green-200 text-green-700 text-sm px-4 py-3 rounded-lg">
                  Ticket submitted! We'll look into it.
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                <select
                  value={issueCategory}
                  onChange={(e) => setIssueCategory(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                >
                  {TICKET_CATEGORIES.map((cat) => (
                    <option key={cat.value} value={cat.value}>{cat.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  value={issueDescription}
                  onChange={(e) => setIssueDescription(e.target.value)}
                  placeholder="Describe the issue in detail..."
                  required
                  minLength={10}
                  rows={5}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
                />
              </div>

              <button
                type="submit"
                disabled={issueLoading}
                className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-semibold py-2.5 rounded-lg transition-colors"
              >
                {issueLoading ? "Submitting..." : "Submit Ticket"}
              </button>
            </form>
          )}

          {activeTab === "suggest" && (
            <form onSubmit={handleSuggestionSubmit} className="space-y-4">
              {suggError && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">
                  {suggError}
                </div>
              )}
              {suggSuccess && (
                <div className="bg-green-50 border border-green-200 text-green-700 text-sm px-4 py-3 rounded-lg">
                  Thanks! We'll review your suggestion.
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Company Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={suggCompany}
                  onChange={(e) => setSuggCompany(e.target.value)}
                  placeholder="e.g. Palantir"
                  required
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Careers Page URL
                </label>
                <input
                  type="url"
                  value={suggUrl}
                  onChange={(e) => setSuggUrl(e.target.value)}
                  placeholder="https://example.com/careers"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Why should we add this company?
                </label>
                <textarea
                  value={suggReason}
                  onChange={(e) => setSuggReason(e.target.value)}
                  placeholder="They sponsor H1B, post a lot of SWE roles, etc."
                  rows={3}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
                />
              </div>

              <button
                type="submit"
                disabled={suggLoading}
                className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-semibold py-2.5 rounded-lg transition-colors"
              >
                {suggLoading ? "Submitting..." : "Submit Suggestion"}
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Ticket History */}
      <section>
        <h2 className="text-base font-semibold text-gray-900 mb-3">Your Tickets</h2>

        {ticketsLoading ? (
          <div className="text-gray-500 text-sm py-4">Loading tickets...</div>
        ) : tickets.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
            <p className="text-sm text-gray-500">No tickets submitted yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {tickets.map((ticket) => (
              <div key={ticket.id} className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                        {TICKET_CATEGORIES.find((c) => c.value === ticket.category)?.label || ticket.category}
                      </span>
                      <TicketStatusBadge status={ticket.status || "open"} />
                    </div>
                    <p className="text-sm text-gray-700 break-words">{ticket.description}</p>
                    {ticket.admin_response && (
                      <div className="mt-3 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2">
                        <div className="text-xs font-medium text-indigo-600 mb-1">Admin Response</div>
                        <p className="text-sm text-gray-700">{ticket.admin_response}</p>
                      </div>
                    )}
                  </div>
                  <div className="text-xs text-gray-400 whitespace-nowrap">
                    {formatDate(ticket.submitted_at)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
