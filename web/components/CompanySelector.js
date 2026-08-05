"use client";

import { useState } from "react";

export default function CompanySelector({ groups, selected, onChange }) {
  const [search, setSearch] = useState("");

  const allKeys = Object.values(groups).flat().map((c) => c.key);
  const isAllSelected =
    selected.includes("all") ||
    (allKeys.length > 0 && allKeys.every((k) => selected.includes(k)));

  function handleSelectAll(e) {
    onChange(e.target.checked ? ["all"] : []);
  }

  function handleToggle(key) {
    const effectiveSelected = selected.includes("all") ? allKeys : selected;
    let next;
    if (effectiveSelected.includes(key)) {
      next = effectiveSelected.filter((k) => k !== key);
    } else {
      next = [...effectiveSelected, key];
    }
    onChange(next.length === allKeys.length ? ["all"] : next);
  }

  function isChecked(key) {
    return selected.includes("all") || selected.includes(key);
  }

  const searchLower = search.toLowerCase();

  return (
    <div className="space-y-3">
      <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-background/55 px-3 py-2.5 text-sm font-semibold text-foreground/80">
        <input
          type="checkbox"
          checked={isAllSelected}
          onChange={handleSelectAll}
          className="w-4 h-4 rounded border-line bg-surface accent-pulse"
        />
        Select All Companies
      </label>

      <input
        type="text"
        placeholder="Search companies..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        maxLength={100}
        className="field-control px-3.5 py-2.5 text-sm placeholder:text-faint"
      />

      <div className="max-h-80 space-y-2 overflow-y-auto rounded-xl border border-line bg-background/70 p-3">
        {Object.entries(groups).map(([groupName, companies]) => {
          const filtered = companies.filter((c) =>
            c.label.toLowerCase().includes(searchLower)
          );
          if (filtered.length === 0) return null;
          return (
            <details key={groupName} open={search.length > 0} className="group">
              <summary className="text-xs font-semibold text-faint uppercase tracking-wide cursor-pointer py-1 hover:text-muted list-none flex items-center gap-1">
                <span className="group-open:rotate-90 transition-transform inline-block text-faint">›</span>
                {groupName} ({filtered.length})
              </summary>
              <div className="ml-4 mt-1 grid grid-cols-1 gap-1 sm:grid-cols-2 xl:grid-cols-3">
                {filtered.map((company) => (
                  <label
                    key={company.key}
                    className="flex items-center gap-2 text-sm text-muted cursor-pointer py-0.5 hover:text-foreground"
                  >
                    <input
                      type="checkbox"
                      checked={isChecked(company.key)}
                      onChange={() => handleToggle(company.key)}
                      className="w-3.5 h-3.5 rounded border-line bg-surface accent-pulse"
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
