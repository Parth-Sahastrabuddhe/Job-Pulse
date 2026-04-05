"use client";

import { useState } from "react";

export default function CompanySelector({ groups, selected, onChange }) {
  const [search, setSearch] = useState("");

  const allKeys = Object.values(groups).flat().map((c) => c.key);
  const isAllSelected =
    selected.includes("all") ||
    (allKeys.length > 0 && allKeys.every((k) => selected.includes(k)));

  function handleSelectAll(e) {
    if (e.target.checked) {
      onChange(["all"]);
    } else {
      onChange([]);
    }
  }

  function handleToggle(key) {
    let next;
    const effectiveSelected = selected.includes("all") ? allKeys : selected;
    if (effectiveSelected.includes(key)) {
      next = effectiveSelected.filter((k) => k !== key);
    } else {
      next = [...effectiveSelected, key];
    }
    // If all are selected, store as "all"
    if (next.length === allKeys.length) {
      onChange(["all"]);
    } else {
      onChange(next);
    }
  }

  function isChecked(key) {
    return selected.includes("all") || selected.includes(key);
  }

  const searchLower = search.toLowerCase();

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm font-medium text-gray-700 cursor-pointer">
          <input
            type="checkbox"
            checked={isAllSelected}
            onChange={handleSelectAll}
            className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
          />
          Select All Companies
        </label>
      </div>

      <input
        type="text"
        placeholder="Search companies..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
      />

      <div className="space-y-2 max-h-80 overflow-y-auto border border-gray-200 rounded-lg p-3">
        {Object.entries(groups).map(([groupName, companies]) => {
          const filtered = companies.filter((c) =>
            c.label.toLowerCase().includes(searchLower)
          );
          if (filtered.length === 0) return null;
          return (
            <details key={groupName} open={search.length > 0} className="group">
              <summary className="text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer py-1 hover:text-gray-700 list-none flex items-center gap-1">
                <span className="group-open:rotate-90 transition-transform inline-block">›</span>
                {groupName} ({filtered.length})
              </summary>
              <div className="mt-1 ml-4 grid grid-cols-2 sm:grid-cols-3 gap-1">
                {filtered.map((company) => (
                  <label
                    key={company.key}
                    className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer py-0.5 hover:text-gray-900"
                  >
                    <input
                      type="checkbox"
                      checked={isChecked(company.key)}
                      onChange={() => handleToggle(company.key)}
                      className="w-3.5 h-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    {company.label}
                  </label>
                ))}
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}
