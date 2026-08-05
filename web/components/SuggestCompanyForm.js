"use client";

import { useState } from "react";

export default function SuggestCompanyForm() {
  const [company, setCompany] = useState("");
  const [url, setUrl] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(""); setSuccess(false); setLoading(true);
    try {
      const res = await fetch("/api/suggestions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyName: company, careersUrl: url, reason }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Failed to submit suggestion."); return; }
      setSuccess(true); setCompany(""); setUrl(""); setReason("");
      setTimeout(() => setSuccess(false), 4000);
    } catch { setError("Network error. Please try again."); }
    finally { setLoading(false); }
  }

  const inputClass = "field-control px-3.5 py-2.5 text-sm placeholder:text-faint";

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="surface-card rounded-2xl p-5 sm:p-7">
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-xl border border-[rgba(255,114,123,0.24)] bg-[rgba(255,114,123,0.08)] px-4 py-3 text-sm text-danger">{error}</div>
          )}
          {success && (
            <div className="rounded-xl border border-[rgba(215,255,112,0.2)] bg-[rgba(215,255,112,0.08)] px-4 py-3 text-sm text-pulse">Thanks! We&apos;ll review your suggestion.</div>
          )}
          <div>
            <label className="block text-sm font-medium text-foreground/80 mb-1">Company Name <span className="text-danger">*</span></label>
            <input type="text" value={company} onChange={(e) => setCompany(e.target.value)}
              placeholder="e.g. Palantir" required maxLength={200} className={inputClass} />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground/80 mb-1">Careers Page URL</label>
            <input type="url" value={url} onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/careers" maxLength={2048} className={inputClass} />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground/80 mb-1">Why should we add this company?</label>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="They post a lot of SWE roles, sponsor work visas, etc." maxLength={2000} rows={3}
              className={`${inputClass} resize-none`} />
          </div>
          <button type="submit" disabled={loading}
            className="primary-button w-full px-5 py-3">
            {loading ? "Submitting…" : "Submit suggestion"}
          </button>
        </form>
      </div>
      <aside className="space-y-4">
        <div className="surface-card rounded-2xl p-5">
          <div className="section-kicker">What makes a good pick</div>
          <ul className="mt-4 space-y-3 text-sm text-muted">
            <li>Posts software roles regularly</li>
            <li>Has an official careers page we can watch directly</li>
            <li>Bonus: a history of visa sponsorship</li>
          </ul>
        </div>
        <div className="soft-card rounded-2xl p-5">
          <div className="text-sm font-bold text-foreground">Where suggestions go</div>
          <p className="mt-2 text-xs leading-5 text-muted">
            Every suggestion lands in the review queue. Companies with source-direct career pages
            are the fastest to add.
          </p>
        </div>
      </aside>
    </div>
  );
}
