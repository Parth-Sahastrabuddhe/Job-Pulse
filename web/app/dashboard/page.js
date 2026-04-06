"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import StatusBadge from "@/components/StatusBadge";

const ALL_STATUSES = ["applied", "interviewing", "offer", "rejected"];

function formatDate(dateStr) {
  if (!dateStr) return "\u2014";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function DashboardPage() {
  const router = useRouter();
  const [applications, setApplications] = useState([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatingKey, setUpdatingKey] = useState(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const debounceRef = useRef(null);

  const fetchApplications = useCallback(async (filter, pg, query) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (filter) params.set("status", filter);
      if (query) params.set("query", query);
      params.set("page", String(pg));
      const res = await fetch(`/api/applications?${params}`);
      if (res.status === 401) { router.push("/auth"); return; }
      if (!res.ok) { setError("Failed to load applications."); return; }
      const data = await res.json();
      setApplications(data.applications || []);
      setTotalPages(data.totalPages || 1);
      setTotal(data.total || 0);
    } catch { setError("Network error. Please try again."); }
    finally { setLoading(false); }
  }, [router]);

  useEffect(() => {
    fetchApplications(statusFilter, page, searchQuery);
  }, [statusFilter, page, searchQuery, fetchApplications]);

  function handleFilterChange(e) {
    setStatusFilter(e.target.value);
    setPage(1);
  }

  function handleSearchInput(e) {
    const val = e.target.value;
    setSearchInput(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearchQuery(val);
      setPage(1);
    }, 300);
  }

  async function handleStatusChange(jobKey, newStatus) {
    setUpdatingKey(jobKey);
    try {
      const res = await fetch(`/api/applications/${encodeURIComponent(jobKey)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "Failed to update status.");
        return;
      }
      if (statusFilter && newStatus !== statusFilter) {
        setApplications((prev) => prev.filter((app) => app.job_key !== jobKey));
        setTotal((t) => t - 1);
      } else {
        setApplications((prev) =>
          prev.map((app) => app.job_key === jobKey ? { ...app, status: newStatus } : app)
        );
      }
    } catch { alert("Network error. Please try again."); }
    finally { setUpdatingKey(null); }
  }

  const selectClass = "bg-surface border border-line rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-pulse focus:ring-1 focus:ring-[rgba(34,197,94,0.2)]";

  return (
    <div className="animate-fade-in-up">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground font-display">Application Tracker</h1>
          <p className="text-muted text-sm mt-0.5">
            {total} job{total !== 1 ? "s" : ""}
            {statusFilter ? ` with status \u201c${statusFilter}\u201d` : " tracked"}
            {totalPages > 1 ? ` \u2014 page ${page} of ${totalPages}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={searchInput}
            onChange={handleSearchInput}
            placeholder="Search jobs..."
            className="bg-surface border border-line rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-faint focus:outline-none focus:border-pulse focus:ring-1 focus:ring-[rgba(34,197,94,0.2)] w-48"
          />
          <select id="statusFilter" value={statusFilter} onChange={handleFilterChange} className={selectClass}>
            <option value="">All Statuses</option>
            {ALL_STATUSES.map((s) => (
              <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="bg-[rgba(239,68,68,0.1)] border border-[rgba(239,68,68,0.2)] text-danger text-sm px-4 py-3 rounded-lg mb-4">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="text-muted text-sm">Loading applications...</div>
        </div>
      ) : applications.length === 0 ? (
        <div className="bg-surface rounded-xl border border-line p-12 text-center">
          <div className="text-faint text-4xl mb-3">{"\ud83d\udccb"}</div>
          <h3 className="text-base font-semibold text-foreground mb-1 font-display">No applications yet</h3>
          <p className="text-sm text-muted">Jobs you receive alerts for will appear here.</p>
        </div>
      ) : (
        <>
          <div className="bg-surface rounded-xl border border-line overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line bg-elevated">
                    <th className="text-left px-4 py-3 font-medium text-muted text-xs uppercase tracking-wider">Company</th>
                    <th className="text-left px-4 py-3 font-medium text-muted text-xs uppercase tracking-wider">Role</th>
                    <th className="text-left px-4 py-3 font-medium text-muted text-xs uppercase tracking-wider">Status</th>
                    <th className="text-left px-4 py-3 font-medium text-muted text-xs uppercase tracking-wider">Date</th>
                    <th className="text-left px-4 py-3 font-medium text-muted text-xs uppercase tracking-wider">Update</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {applications.map((app) => (
                    <tr key={app.job_key} className="hover:bg-surface-hover transition-colors">
                      <td className="px-4 py-3 font-medium text-foreground">
                        {app.source_label || app.source_key || "\u2014"}
                      </td>
                      <td className="px-4 py-3 text-muted max-w-xs">
                        {app.url ? (
                          <a href={app.url} target="_blank" rel="noopener noreferrer"
                            className="text-pulse hover:text-pulse-hover hover:underline">
                            {app.title || "View Job"}
                          </a>
                        ) : (
                          <span>{app.title || "\u2014"}</span>
                        )}
                        {app.location && (
                          <div className="text-xs text-faint mt-0.5">{app.location}</div>
                        )}
                      </td>
                      <td className="px-4 py-3"><StatusBadge status={app.status} /></td>
                      <td className="px-4 py-3 text-muted whitespace-nowrap">
                        {formatDate(app.applied_at || app.notified_at)}
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={app.status}
                          onChange={(e) => handleStatusChange(app.job_key, e.target.value)}
                          disabled={updatingKey === app.job_key}
                          className="bg-surface border border-line rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-pulse disabled:opacity-50"
                        >
                          {ALL_STATUSES.map((s) => (
                            <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="bg-elevated hover:bg-surface-hover disabled:opacity-30 text-foreground px-4 py-2 rounded-lg border border-line text-sm font-medium transition-colors"
              >
                Previous
              </button>
              <span className="text-muted text-sm">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="bg-elevated hover:bg-surface-hover disabled:opacity-30 text-foreground px-4 py-2 rounded-lg border border-line text-sm font-medium transition-colors"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
