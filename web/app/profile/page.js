"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import CompanySelector from "@/components/CompanySelector";

const ROLE_CATEGORIES = [
  { value: "software_engineer", label: "Software Engineer" },
  { value: "data_engineer", label: "Data Engineer" },
  { value: "ml_engineer", label: "ML Engineer" },
  { value: "frontend", label: "Frontend" },
  { value: "backend", label: "Backend" },
  { value: "devops_sre", label: "DevOps / SRE" },
  { value: "product_manager", label: "Product Manager" },
  { value: "mobile", label: "Mobile" },
];

const SENIORITY_LEVELS = [
  { value: "intern", label: "Intern" },
  { value: "entry", label: "Entry Level" },
  { value: "mid", label: "Mid Level" },
  { value: "senior", label: "Senior" },
  { value: "staff", label: "Staff+" },
];

const NOTIFICATION_MODES = [
  { value: "realtime", label: "Real-time", desc: "Get notified the moment a job is posted" },
  { value: "daily", label: "Daily Digest", desc: "One summary per day" },
  { value: "weekly", label: "Weekly Digest", desc: "One summary per week" },
];

const TIMEZONES = [
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "America/Phoenix", "America/Anchorage", "Pacific/Honolulu", "UTC",
  "Europe/London", "Europe/Berlin", "Asia/Tokyo", "Asia/Kolkata",
];

export default function ProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState(null);
  const [groups, setGroups] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    async function loadData() {
      try {
        const [profileRes, companiesRes] = await Promise.all([
          fetch("/api/profile"), fetch("/api/companies"),
        ]);
        if (profileRes.status === 401) { router.push("/auth"); return; }
        if (!profileRes.ok) { setError("Failed to load profile."); setLoading(false); return; }
        const profileData = await profileRes.json();
        const companiesData = await companiesRes.json();
        setProfile(profileData);
        if (companiesData.groups) setGroups(companiesData.groups);
      } catch { setError("Network error loading profile."); }
      finally { setLoading(false); }
    }
    loadData();
  }, [router]);

  function toggleArrayValue(arr, value) {
    return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true); setError(""); setSuccess(false);
    try {
      const res = await fetch("/api/profile", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Failed to save profile."); return; }
      setSuccess(true);
    } catch { setError("Network error. Please try again."); }
    finally { setSaving(false); }
  }

  if (loading) return <div className="flex justify-center py-16"><div className="text-muted text-sm">Loading profile...</div></div>;
  if (!profile) return <div className="flex justify-center py-16"><div className="text-danger text-sm">{error || "Profile not found."}</div></div>;

  const inputClass = "bg-surface border border-line rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-pulse focus:ring-1 focus:ring-[rgba(34,197,94,0.2)]";

  return (
    <div className="max-w-2xl mx-auto animate-fade-in-up">
      <h1 className="text-2xl font-bold text-foreground mb-1 font-display">Profile Settings</h1>
      <p className="text-muted text-sm mb-8">Customize your job alert preferences.</p>

      {error && (
        <div className="bg-[rgba(239,68,68,0.1)] border border-[rgba(239,68,68,0.2)] text-danger text-sm px-4 py-3 rounded-lg mb-6">{error}</div>
      )}
      {success && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,0.6)] backdrop-blur-sm">
          <div className="bg-surface border border-line rounded-xl p-8 max-w-sm w-full mx-4 text-center animate-fade-in-up">
            <div className="w-12 h-12 rounded-full bg-[rgba(34,197,94,0.15)] flex items-center justify-center mx-auto mb-4">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-foreground font-display mb-2">Profile Saved</h3>
            <p className="text-muted text-sm mb-6">Your preferences have been updated.</p>
            <button
              onClick={() => setSuccess(false)}
              className="bg-pulse hover:bg-pulse-hover text-black font-semibold py-2.5 px-8 rounded-lg transition-colors"
            >
              OK
            </button>
          </div>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6 stagger">
        {/* Role Categories */}
        <section className="bg-surface rounded-xl border border-line p-6">
          <h2 className="text-base font-semibold text-foreground mb-4 font-display">Role Categories</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {ROLE_CATEGORIES.map((role) => (
              <label key={role.value} className="flex items-center gap-2 text-sm text-muted cursor-pointer hover:text-foreground transition-colors">
                <input type="checkbox" checked={profile.roleCategories.includes(role.value)}
                  onChange={() => setProfile((p) => ({ ...p, roleCategories: toggleArrayValue(p.roleCategories, role.value) }))}
                  className="w-4 h-4 rounded border-line bg-background accent-pulse" />
                {role.label}
              </label>
            ))}
          </div>
        </section>

        {/* Seniority */}
        <section className="bg-surface rounded-xl border border-line p-6">
          <h2 className="text-base font-semibold text-foreground mb-4 font-display">Seniority Level</h2>
          <div className="flex flex-wrap gap-4">
            {SENIORITY_LEVELS.map((s) => (
              <label key={s.value} className="flex items-center gap-2 text-sm text-muted cursor-pointer hover:text-foreground transition-colors">
                <input type="checkbox" checked={profile.seniorityLevels.includes(s.value)}
                  onChange={() => setProfile((p) => ({ ...p, seniorityLevels: toggleArrayValue(p.seniorityLevels, s.value) }))}
                  className="w-4 h-4 rounded border-line bg-background accent-pulse" />
                {s.label}
              </label>
            ))}
          </div>
        </section>

        {/* Country + Sponsorship */}
        <section className="bg-surface rounded-xl border border-line p-6 space-y-4">
          <h2 className="text-base font-semibold text-foreground font-display">Location & Visa</h2>
          <div>
            <label className="block text-sm font-medium text-foreground/80 mb-1">Country</label>
            <select value={profile.country} onChange={(e) => setProfile((p) => ({ ...p, country: e.target.value }))} className={inputClass}>
              <option value="US">United States</option>
              <option value="CA">Canada</option>
              <option value="GB">United Kingdom</option>
              <option value="DE">Germany</option>
              <option value="IN">India</option>
              <option value="ALL">All Countries</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-muted cursor-pointer hover:text-foreground transition-colors">
            <input type="checkbox" checked={profile.requiresSponsorship}
              onChange={(e) => setProfile((p) => ({ ...p, requiresSponsorship: e.target.checked }))}
              className="w-4 h-4 rounded border-line bg-background accent-pulse" />
            I require H1B / work visa sponsorship
          </label>
        </section>

        {/* Companies */}
        <section className="bg-surface rounded-xl border border-line p-6">
          <h2 className="text-base font-semibold text-foreground mb-4 font-display">Companies to Watch</h2>
          <CompanySelector groups={groups} selected={profile.companySelections}
            onChange={(val) => setProfile((p) => ({ ...p, companySelections: val }))} />
        </section>

        {/* Notification Mode */}
        <section className="bg-surface rounded-xl border border-line p-6">
          <h2 className="text-base font-semibold text-foreground mb-4 font-display">Notification Mode</h2>
          <div className="space-y-3">
            {NOTIFICATION_MODES.map((mode) => (
              <label key={mode.value} className="flex items-start gap-3 cursor-pointer group">
                <input type="radio" name="notificationMode" value={mode.value}
                  checked={profile.notificationMode === mode.value}
                  onChange={() => setProfile((p) => ({ ...p, notificationMode: mode.value }))}
                  className="mt-0.5 w-4 h-4 border-line bg-background accent-pulse" />
                <div>
                  <div className="text-sm font-medium text-foreground group-hover:text-pulse transition-colors">{mode.label}</div>
                  <div className="text-xs text-faint">{mode.desc}</div>
                </div>
              </label>
            ))}
          </div>
        </section>

        {/* Quiet Hours */}
        <section className="bg-surface rounded-xl border border-line p-6 space-y-4">
          <h2 className="text-base font-semibold text-foreground font-display">Quiet Hours</h2>
          <p className="text-xs text-faint">No notifications during these hours.</p>
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <label className="block text-sm font-medium text-foreground/80 mb-1">Start</label>
              <input type="time" value={profile.quietHoursStart}
                onChange={(e) => setProfile((p) => ({ ...p, quietHoursStart: e.target.value }))}
                className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground/80 mb-1">End</label>
              <input type="time" value={profile.quietHoursEnd}
                onChange={(e) => setProfile((p) => ({ ...p, quietHoursEnd: e.target.value }))}
                className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground/80 mb-1">Timezone</label>
              <select value={profile.quietHoursTz}
                onChange={(e) => setProfile((p) => ({ ...p, quietHoursTz: e.target.value }))}
                className={inputClass}>
                {TIMEZONES.map((tz) => (<option key={tz} value={tz}>{tz}</option>))}
              </select>
            </div>
          </div>
        </section>

        {/* Active Toggle */}
        <section className="bg-surface rounded-xl border border-line p-6">
          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <div className="text-base font-semibold text-foreground font-display">Active Notifications</div>
              <div className="text-sm text-muted mt-0.5">Pause all job alerts while keeping your settings.</div>
            </div>
            <div className="relative"
              onClick={() => setProfile((p) => ({ ...p, isActive: !p.isActive }))}>
              <input type="checkbox" checked={profile.isActive}
                onChange={(e) => setProfile((p) => ({ ...p, isActive: e.target.checked }))}
                className="sr-only peer" />
              <div className={`w-11 h-6 rounded-full cursor-pointer transition-colors ${profile.isActive ? "bg-pulse" : "bg-elevated border border-line"}`}>
                <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-foreground rounded-full shadow transition-transform ${profile.isActive ? "translate-x-5" : "translate-x-0"}`} />
              </div>
            </div>
          </label>
        </section>

        <button type="submit" disabled={saving}
          className="w-full bg-pulse hover:bg-pulse-hover disabled:opacity-50 text-black font-semibold py-2.5 rounded-lg transition-colors">
          {saving ? "Saving..." : "Save Profile"}
        </button>
      </form>
    </div>
  );
}
