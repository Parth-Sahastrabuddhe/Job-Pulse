"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import StatusBadge from "@/components/StatusBadge";
import CalendarSidebar from "@/components/CalendarSidebar";

const BASE_STATUSES = ["applied", "interviewing", "offer", "rejected"];
const ALL_STATUSES_WITH_SKIP = ["applied", "skipped", "interviewing", "offer", "rejected"];

function formatDate(dateStr, tz = "America/New_York") {
  if (!dateStr) return "\u2014";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: tz,
  });
}

export default function DashboardPage() {
  const router = useRouter();
  const [applications, setApplications] = useState([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [sort, setSort] = useState("date_desc");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatingKey, setUpdatingKey] = useState(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState({ tracked: 0, active: 0 });
  const [hideSkipped, setHideSkipped] = useState(false);
  const [timezone, setTimezone] = useState("America/New_York");
  const debounceRef = useRef(null);

  const fetchApplications = useCallback(async (filter, pg, query, sortOrder) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (filter) params.set("status", filter);
      if (query) params.set("query", query);
      params.set("sort", sortOrder);
      params.set("page", String(pg));
      const res = await fetch(`/api/applications?${params}`);
      if (res.status === 401) { router.push("/auth"); return; }
      if (!res.ok) { setError("Failed to load applications."); return; }
      const data = await res.json();
      setApplications(data.applications || []);
      setTotalPages(data.totalPages || 1);
      setTotal(data.total || 0);
      if (data.stats) setStats(data.stats);
      if (data.hideSkipped !== undefined) setHideSkipped(data.hideSkipped);
      if (data.timezone) setTimezone(data.timezone);
    } catch { setError("Network error. Please try again."); }
    finally { setLoading(false); }
  }, [router]);

  useEffect(() => {
    fetchApplications(statusFilter, page, searchQuery, sort);
  }, [statusFilter, page, searchQuery, sort, fetchApplications]);

  function handleFilterChange(e) {
    setStatusFilter(e.target.value);
    setPage(1);
  }

  function handleSortChange(e) {
    setSort(e.target.value);
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

  const selectClass = "field-control px-3.5 py-2.5 text-sm";
  return (
    <div className="flex flex-col gap-6 animate-fade-in-up lg:flex-row lg:gap-7">
      <div className="order-2 lg:order-1">
        <CalendarSidebar />
      </div>
      <div className="order-1 min-w-0 flex-1 lg:order-2">
        <header className="mb-6">
          <div className="section-kicker">Search command center</div>
          <div className="mt-2 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div>
              <h1 className="font-display text-3xl font-bold tracking-[-0.045em] text-foreground sm:text-4xl">Your application pipeline</h1>
              <p className="mt-2 text-sm text-muted">Keep every opportunity visible from first alert to final decision.</p>
            </div>
            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-[rgba(215,255,112,0.18)] bg-[rgba(215,255,112,0.06)] px-3 py-1.5 text-xs font-semibold text-pulse">
              <span className="h-1.5 w-1.5 rounded-full bg-pulse" /> Lookout active
            </div>
          </div>
        </header>

        <div className="mb-5 grid grid-cols-2 gap-2 sm:gap-3">
          {[
            [stats.tracked, "Jobs tracked", "Across your tracker"],
            [stats.active, "Active pipeline", "Interviewing or offer"],
          ].map(([value, label, description]) => (
            <div key={label} className="soft-card rounded-2xl px-3 py-4 sm:px-5">
              <div className="font-display text-2xl font-bold text-foreground sm:text-3xl">{value}</div>
              <div className="mt-1 text-[11px] text-muted sm:text-xs">{label}</div>
              <div className="mt-1 text-[10px] text-faint sm:text-[11px]">{description}</div>
            </div>
          ))}
        </div>

        <div className="soft-card mb-5 grid grid-cols-1 gap-3 rounded-2xl p-3 md:grid-cols-2 xl:grid-cols-[minmax(18rem,1fr)_minmax(10rem,12rem)_minmax(11rem,13rem)]">
          <div className="relative min-w-0 md:col-span-2 xl:col-span-1">
            <svg className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" width="17" height="17" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
              <circle cx="8" cy="8" r="5" /><path d="m12 12 3 3" strokeLinecap="round" />
            </svg>
          <input
            type="text"
            value={searchInput}
            onChange={handleSearchInput}
              placeholder="Search company, role or location"
              maxLength={200}
              className="field-control py-2.5 pl-10 pr-3 text-sm text-foreground caret-pulse placeholder:text-faint"
          />
          </div>
          <select id="statusFilter" value={statusFilter} onChange={handleFilterChange} className={selectClass}>
            <option value="">All Statuses</option>
            {(hideSkipped ? BASE_STATUSES : ALL_STATUSES_WITH_SKIP).map((s) => (
              <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
            ))}
          </select>
          <select aria-label="Sort applications" value={sort} onChange={handleSortChange} className={selectClass}>
            <option value="date_desc">Date · newest</option>
            <option value="date_asc">Date · oldest</option>
            <option value="company_asc">Company · A–Z</option>
            <option value="company_desc">Company · Z–A</option>
            <option value="status_asc">Status · pipeline</option>
          </select>
        </div>

      {error && (
          <div className="mb-4 rounded-xl border border-[rgba(255,114,123,0.24)] bg-[rgba(255,114,123,0.08)] px-4 py-3 text-sm text-danger" role="alert">
          {error}
        </div>
      )}

      {loading ? (
          <div className="surface-card flex min-h-64 items-center justify-center rounded-2xl">
            <div className="flex items-center gap-3 text-sm text-muted">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-pulse" /> Loading applications…
            </div>
        </div>
      ) : applications.length === 0 ? (
          <div className="surface-card rounded-2xl px-6 py-16 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-line bg-elevated text-pulse">
              <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                <path d="M8 4h8M9 2h6a1 1 0 0 1 1 1v3H8V3a1 1 0 0 1 1-1Z" /><path d="M6 5h12a2 2 0 0 1 2 2v13H4V7a2 2 0 0 1 2-2Z" /><path d="M8 11h8M8 15h5" strokeLinecap="round" />
              </svg>
            </div>
            <h3 className="mt-5 font-display text-lg font-bold text-foreground">No matching applications</h3>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted">
              {statusFilter || searchQuery ? "Try clearing your search or status filter." : "Jobs delivered to your alert channel will appear here as your pipeline grows."}
            </p>
        </div>
      ) : (
        <>
            <div className="surface-card hidden overflow-hidden rounded-2xl md:block">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                    <tr className="border-b border-line bg-elevated/70">
                    <th className="text-left px-4 py-3 font-medium text-muted text-xs uppercase tracking-wider">Company</th>
                    <th className="text-left px-4 py-3 font-medium text-muted text-xs uppercase tracking-wider">Role</th>
                    <th className="text-left px-4 py-3 font-medium text-muted text-xs uppercase tracking-wider">Status</th>
                    <th className="text-left px-4 py-3 font-medium text-muted text-xs uppercase tracking-wider">Date</th>
                    <th className="text-left px-4 py-3 font-medium text-muted text-xs uppercase tracking-wider">Update</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {applications.map((app) => (
                      <tr key={app.job_key} className="transition-colors hover:bg-surface-hover/80">
                      <td className="px-4 py-3 font-medium text-foreground">
                          <div className="flex items-center gap-2.5">
                            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-elevated text-[10px] font-bold text-pulse">
                              {(app.source_label || app.source_key || "?").slice(0, 2).toUpperCase()}
                            </span>
                            {app.source_label || app.source_key || "\u2014"}
                          </div>
                      </td>
                      <td className="px-4 py-3 text-muted max-w-xs">
                        {app.url ? (
                          <a href={app.url} target="_blank" rel="noopener noreferrer"
                              className="font-semibold text-foreground transition-colors hover:text-pulse">
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
                        {formatDate(app.applied_at || app.notified_at, timezone)}
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={app.status}
                          onChange={(e) => handleStatusChange(app.job_key, e.target.value)}
                          disabled={updatingKey === app.job_key}
                            className="field-control min-w-28 px-2 py-1.5 text-xs disabled:opacity-50"
                        >
                          {(hideSkipped ? BASE_STATUSES : ALL_STATUSES_WITH_SKIP).map((s) => (
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

            <div className="space-y-3 md:hidden">
              {applications.map((app) => (
                <article key={app.job_key} className="surface-card rounded-2xl p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-elevated text-xs font-bold text-pulse">
                      {(app.source_label || app.source_key || "?").slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold uppercase tracking-wider text-faint">{app.source_label || app.source_key || "Unknown company"}</div>
                      {app.url ? (
                        <a href={app.url} target="_blank" rel="noopener noreferrer" className="mt-1 block font-semibold leading-5 text-foreground hover:text-pulse">
                          {app.title || "View job"}
                        </a>
                      ) : <div className="mt-1 font-semibold text-foreground">{app.title || "Untitled role"}</div>}
                      {app.location && <div className="mt-1 text-xs text-muted">{app.location}</div>}
                    </div>
                    <StatusBadge status={app.status} />
                  </div>
                  <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-3">
                    <span className="text-xs text-faint">{formatDate(app.applied_at || app.notified_at, timezone)}</span>
                    <select
                      value={app.status}
                      onChange={(event) => handleStatusChange(app.job_key, event.target.value)}
                      disabled={updatingKey === app.job_key}
                      className="field-control w-auto min-w-28 px-2 py-1.5 text-xs disabled:opacity-50"
                    >
                      {(hideSkipped ? BASE_STATUSES : ALL_STATUSES_WITH_SKIP).map((status) => (
                        <option key={status} value={status}>{status.charAt(0).toUpperCase() + status.slice(1)}</option>
                      ))}
                    </select>
                  </div>
                </article>
              ))}
            </div>

          {/* Pagination */}
          {totalPages > 1 && (
              <div className="mt-5 flex items-center justify-between">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                  className="secondary-button px-4 py-2 text-sm disabled:opacity-30"
              >
                Previous
              </button>
              <span className="text-muted text-sm">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                  className="secondary-button px-4 py-2 text-sm disabled:opacity-30"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
      </div>
    </div>
  );
}
