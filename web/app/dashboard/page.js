"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import StatusBadge from "@/components/StatusBadge";

const ALL_STATUSES = ["notified", "applied", "skipped", "interviewing", "offer", "rejected"];

function formatDate(dateStr) {
  if (!dateStr) return "—";
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatingKey, setUpdatingKey] = useState(null);

  const fetchApplications = useCallback(async (filter) => {
    setLoading(true);
    setError("");
    try {
      const url = filter ? `/api/applications?status=${filter}` : "/api/applications";
      const res = await fetch(url);

      if (res.status === 401) {
        router.push("/auth");
        return;
      }

      if (!res.ok) {
        setError("Failed to load applications.");
        return;
      }

      const data = await res.json();
      setApplications(data.applications || []);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    fetchApplications(statusFilter);
  }, [statusFilter, fetchApplications]);

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

      setApplications((prev) =>
        prev.map((app) =>
          app.job_key === jobKey ? { ...app, status: newStatus } : app
        )
      );
    } catch {
      alert("Network error. Please try again.");
    } finally {
      setUpdatingKey(null);
    }
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Application Tracker</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {applications.length} job{applications.length !== 1 ? "s" : ""}
            {statusFilter ? ` with status "${statusFilter}"` : " tracked"}
          </p>
        </div>

        <div>
          <label className="sr-only" htmlFor="statusFilter">Filter by status</label>
          <select
            id="statusFilter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          >
            <option value="">All Statuses</option>
            {ALL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg mb-4">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="text-gray-500 text-sm">Loading applications...</div>
        </div>
      ) : applications.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <div className="text-gray-400 text-4xl mb-3">📋</div>
          <h3 className="text-base font-semibold text-gray-900 mb-1">No applications yet</h3>
          <p className="text-sm text-gray-500">
            Jobs you receive alerts for will appear here.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Company</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Role</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Date</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Update</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {applications.map((app) => (
                  <tr key={app.job_key} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {app.source_label || app.source_key || "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-700 max-w-xs">
                      {app.url ? (
                        <a
                          href={app.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-indigo-600 hover:text-indigo-800 hover:underline"
                        >
                          {app.title || "View Job"}
                        </a>
                      ) : (
                        <span>{app.title || "—"}</span>
                      )}
                      {app.location && (
                        <div className="text-xs text-gray-400 mt-0.5">{app.location}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={app.status} />
                    </td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                      {formatDate(app.applied_at || app.notified_at)}
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={app.status}
                        onChange={(e) => handleStatusChange(app.job_key, e.target.value)}
                        disabled={updatingKey === app.job_key}
                        className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
                      >
                        {ALL_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s.charAt(0).toUpperCase() + s.slice(1)}
                          </option>
                        ))}
                      </select>
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
