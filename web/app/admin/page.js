"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import StatusBadge from "@/components/StatusBadge";

function formatDate(dateStr) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(dateStr) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatCard({ label, value, color = "indigo" }) {
  const colorMap = {
    indigo: "text-indigo-600",
    green: "text-green-600",
    blue: "text-blue-600",
    yellow: "text-yellow-600",
    red: "text-red-600",
    gray: "text-gray-600",
  };
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className={`text-2xl font-bold ${colorMap[color] || colorMap.indigo}`}>{value ?? "—"}</div>
      <div className="text-sm text-gray-500 mt-0.5">{label}</div>
    </div>
  );
}

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
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${styleMap[status] || "bg-gray-100 text-gray-600"}`}>
      {labelMap[status] || status}
    </span>
  );
}

function SuggestionStatusBadge({ status }) {
  const styleMap = {
    pending: "bg-yellow-100 text-yellow-700",
    approved: "bg-green-100 text-green-700",
    rejected: "bg-red-100 text-red-600",
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${styleMap[status] || "bg-gray-100 text-gray-600"}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

// --- Overview Tab ---
function OverviewTab() {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/admin/health")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setHealth(data);
      })
      .catch(() => setError("Network error"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-gray-500 text-sm py-8 text-center">Loading health data...</div>;
  if (error) return <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">{error}</div>;
  if (!health) return null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Total Users" value={health.totalUsers} color="indigo" />
        <StatCard label="Active Users" value={health.activeUsers} color="green" />
        <StatCard label="Jobs Today" value={health.jobsToday} color="blue" />
        <StatCard label="Total Jobs" value={health.totalJobs} color="gray" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="DMs Sent (24h)" value={health.dmsSent} color="green" />
        <StatCard label="DMs Failed (24h)" value={health.dmsFailed} color="red" />
        <StatCard label="Open Tickets" value={health.openTickets} color="yellow" />
        <StatCard label="Pending Suggestions" value={health.pendingSuggestions} color="indigo" />
      </div>

      <div>
        <h2 className="text-base font-semibold text-gray-900 mb-3">Recent Errors</h2>
        {health.recentErrors.length === 0 ? (
          <div className="text-sm text-gray-500 bg-white rounded-xl border border-gray-200 p-6 text-center">
            No recent errors — system is healthy.
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Source</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Error</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {health.recentErrors.map((err) => (
                    <tr key={err.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{err.source_key || "—"}</td>
                      <td className="px-4 py-3 text-red-600 max-w-sm truncate">{err.error_message}</td>
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{formatDateTime(err.occurred_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Users Tab ---
function UsersTab() {
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionPending, setActionPending] = useState(null);

  const fetchUsers = useCallback(async (s, sf) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (s) params.set("search", s);
      if (sf) params.set("status", sf);
      const res = await fetch(`/api/admin/users?${params}`);
      const data = await res.json();
      if (data.error) setError(data.error);
      else setUsers(data.users || []);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers(search, statusFilter);
  }, [search, statusFilter, fetchUsers]);

  async function toggleActive(discordId, currentActive) {
    setActionPending(discordId);
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(discordId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: currentActive ? 0 : 1 }),
      });
      if (!res.ok) {
        const d = await res.json();
        alert(d.error || "Failed to update user");
        return;
      }
      setUsers((prev) => prev.map((u) => u.discord_id === discordId ? { ...u, is_active: currentActive ? 0 : 1 } : u));
    } catch {
      alert("Network error");
    } finally {
      setActionPending(null);
    }
  }

  async function handleDelete(discordId, username) {
    if (!confirm(`Delete user @${username}? This cannot be undone.`)) return;
    setActionPending(discordId);
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(discordId)}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json();
        alert(d.error || "Failed to delete user");
        return;
      }
      setUsers((prev) => prev.filter((u) => u.discord_id !== discordId));
    } catch {
      alert("Network error");
    } finally {
      setActionPending(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3">
        <input
          type="text"
          placeholder="Search by username, name, or email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">All Users</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
        </select>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">{error}</div>
      )}

      {loading ? (
        <div className="text-gray-500 text-sm py-8 text-center">Loading users...</div>
      ) : users.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-500">
          No users found.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Username</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Email</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Role</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Joined</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {users.map((user) => (
                  <tr key={user.discord_id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">@{user.discord_username}</td>
                    <td className="px-4 py-3 text-gray-700">{user.first_name}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{user.email}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{user.role || "user"}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${user.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                        {user.is_active ? "Active" : "Paused"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{formatDate(user.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button
                          onClick={() => toggleActive(user.discord_id, user.is_active)}
                          disabled={actionPending === user.discord_id}
                          className={`px-2 py-1 rounded text-xs font-medium disabled:opacity-50 ${user.is_active ? "bg-yellow-100 text-yellow-700 hover:bg-yellow-200" : "bg-green-100 text-green-700 hover:bg-green-200"}`}
                        >
                          {user.is_active ? "Pause" : "Resume"}
                        </button>
                        <button
                          onClick={() => handleDelete(user.discord_id, user.discord_username)}
                          disabled={actionPending === user.discord_id}
                          className="px-2 py-1 rounded text-xs font-medium bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-50"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Tickets Tab ---
function TicketsTab() {
  const [tickets, setTickets] = useState([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [responding, setResponding] = useState(null);
  const [responseText, setResponseText] = useState({});
  const [responseStatus, setResponseStatus] = useState({});

  const fetchTickets = useCallback(async (sf) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (sf) params.set("status", sf);
      const res = await fetch(`/api/admin/tickets?${params}`);
      const data = await res.json();
      if (data.error) setError(data.error);
      else setTickets(data.tickets || []);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTickets(statusFilter);
  }, [statusFilter, fetchTickets]);

  async function handleRespond(ticketId) {
    const status = responseStatus[ticketId] || "in_progress";
    const adminResponse = responseText[ticketId] || "";
    setResponding(ticketId);
    try {
      const res = await fetch("/api/admin/tickets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId, status, adminResponse }),
      });
      if (!res.ok) {
        const d = await res.json();
        alert(d.error || "Failed to update ticket");
        return;
      }
      setTickets((prev) => prev.map((t) => t.id === ticketId ? { ...t, status, admin_response: adminResponse } : t));
      setResponseText((prev) => ({ ...prev, [ticketId]: "" }));
    } catch {
      alert("Network error");
    } finally {
      setResponding(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <label className="text-sm text-gray-600">Filter:</label>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">All Statuses</option>
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="resolved">Resolved</option>
          <option value="closed">Closed</option>
        </select>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">{error}</div>
      )}

      {loading ? (
        <div className="text-gray-500 text-sm py-8 text-center">Loading tickets...</div>
      ) : tickets.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-500">
          No tickets found.
        </div>
      ) : (
        <div className="space-y-4">
          {tickets.map((ticket) => (
            <div key={ticket.id} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                <div>
                  <span className="font-medium text-gray-900">#{ticket.id}</span>
                  <span className="mx-2 text-gray-300">|</span>
                  <span className="text-gray-700">@{ticket.discord_username}</span>
                  <span className="mx-2 text-gray-300">|</span>
                  <span className="text-xs text-gray-500">{ticket.category}</span>
                </div>
                <div className="flex items-center gap-2">
                  <TicketStatusBadge status={ticket.status} />
                  <span className="text-xs text-gray-400">{formatDate(ticket.submitted_at)}</span>
                </div>
              </div>
              <p className="text-sm text-gray-700 mb-3 bg-gray-50 rounded p-3">{ticket.description}</p>
              {ticket.admin_response && (
                <p className="text-sm text-indigo-700 bg-indigo-50 rounded p-3 mb-3">
                  <span className="font-medium">Admin: </span>{ticket.admin_response}
                </p>
              )}
              <div className="flex flex-col sm:flex-row gap-2">
                <textarea
                  placeholder="Response (optional)..."
                  value={responseText[ticket.id] || ""}
                  onChange={(e) => setResponseText((prev) => ({ ...prev, [ticket.id]: e.target.value }))}
                  rows={2}
                  className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                />
                <div className="flex gap-2 sm:flex-col">
                  <select
                    value={responseStatus[ticket.id] || "in_progress"}
                    onChange={(e) => setResponseStatus((prev) => ({ ...prev, [ticket.id]: e.target.value }))}
                    className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="open">Open</option>
                    <option value="in_progress">In Progress</option>
                    <option value="resolved">Resolved</option>
                    <option value="closed">Closed</option>
                  </select>
                  <button
                    onClick={() => handleRespond(ticket.id)}
                    disabled={responding === ticket.id}
                    className="px-3 py-1 bg-indigo-600 text-white rounded text-xs font-medium hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {responding === ticket.id ? "Saving..." : "Submit"}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Suggestions Tab ---
function SuggestionsTab() {
  const [suggestions, setSuggestions] = useState([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [acting, setActing] = useState(null);

  const fetchSuggestions = useCallback(async (sf) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (sf) params.set("status", sf);
      const res = await fetch(`/api/admin/suggestions?${params}`);
      const data = await res.json();
      if (data.error) setError(data.error);
      else setSuggestions(data.suggestions || []);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSuggestions(statusFilter);
  }, [statusFilter, fetchSuggestions]);

  async function handleAction(suggestionId, status) {
    setActing(suggestionId);
    try {
      const res = await fetch("/api/admin/suggestions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suggestionId, status }),
      });
      if (!res.ok) {
        const d = await res.json();
        alert(d.error || "Failed to update suggestion");
        return;
      }
      setSuggestions((prev) => prev.map((s) => s.id === suggestionId ? { ...s, status } : s));
    } catch {
      alert("Network error");
    } finally {
      setActing(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <label className="text-sm text-gray-600">Filter:</label>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">{error}</div>
      )}

      {loading ? (
        <div className="text-gray-500 text-sm py-8 text-center">Loading suggestions...</div>
      ) : suggestions.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-500">
          No suggestions found.
        </div>
      ) : (
        <div className="space-y-4">
          {suggestions.map((sug) => (
            <div key={sug.id} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                <div>
                  <span className="font-semibold text-gray-900">{sug.company_name}</span>
                  <span className="mx-2 text-gray-300">|</span>
                  <span className="text-gray-600 text-sm">@{sug.discord_username}</span>
                </div>
                <div className="flex items-center gap-2">
                  <SuggestionStatusBadge status={sug.status} />
                  <span className="text-xs text-gray-400">{formatDate(sug.submitted_at)}</span>
                </div>
              </div>
              {sug.careers_url && (
                <a
                  href={sug.careers_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-indigo-600 hover:underline block mb-1"
                >
                  {sug.careers_url}
                </a>
              )}
              {sug.reason && (
                <p className="text-sm text-gray-600 bg-gray-50 rounded p-2 mb-3">{sug.reason}</p>
              )}
              {sug.status === "pending" && (
                <div className="flex gap-2">
                  <button
                    onClick={() => handleAction(sug.id, "approved")}
                    disabled={acting === sug.id}
                    className="px-3 py-1 bg-green-100 text-green-700 rounded text-xs font-medium hover:bg-green-200 disabled:opacity-50"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => handleAction(sug.id, "rejected")}
                    disabled={acting === sug.id}
                    className="px-3 py-1 bg-red-100 text-red-700 rounded text-xs font-medium hover:bg-red-200 disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Main Admin Page ---
const TABS = ["Overview", "Users", "Tickets", "Suggestions"];

export default function AdminPage() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(null);
  const [activeTab, setActiveTab] = useState("Overview");

  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((data) => {
        if (data.role === "admin") setAuthorized(true);
        else setAuthorized(false);
      })
      .catch(() => setAuthorized(false));
  }, []);

  if (authorized === null) {
    return (
      <div className="flex justify-center py-16">
        <div className="text-gray-500 text-sm">Checking access...</div>
      </div>
    );
  }

  if (authorized === false) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 px-6 py-8 rounded-xl text-center">
        <div className="text-lg font-semibold mb-1">Access denied</div>
        <div className="text-sm">You do not have permission to view this page.</div>
        <button
          onClick={() => router.push("/")}
          className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700"
        >
          Go home
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Admin Panel</h1>
        <p className="text-gray-500 text-sm mt-0.5">Manage users, tickets, and system health.</p>
      </div>

      <div className="flex gap-1 border-b border-gray-200 mb-6">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab
                ? "border-indigo-600 text-indigo-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === "Overview" && <OverviewTab />}
      {activeTab === "Users" && <UsersTab />}
      {activeTab === "Tickets" && <TicketsTab />}
      {activeTab === "Suggestions" && <SuggestionsTab />}
    </div>
  );
}
