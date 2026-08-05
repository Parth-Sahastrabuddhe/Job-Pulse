"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import CompanySelector from "@/components/CompanySelector";
import { ROLE_SECTIONS } from "@/lib/role-taxonomy.mjs";
import { PROVIDERS } from "../../../src/llm-providers.js";

const SENIORITY_LEVELS = [
  { value: "intern", label: "Intern" },
  { value: "entry", label: "Entry Level" },
  { value: "mid", label: "Mid Level" },
  { value: "senior", label: "Senior" },
  { value: "staff", label: "Staff+" },
];

const EDUCATION_LEVELS = [
  { value: "bachelors", label: "Bachelor's" },
  { value: "masters", label: "Master's" },
  { value: "phd", label: "PhD" },
];

const NOTIFICATION_MODES = [
  { value: "realtime", label: "Real-time", desc: "Notified the moment a job is posted" },
  { value: "daily", label: "Daily Digest", desc: "One summary per day" },
  { value: "weekly", label: "Weekly Digest", desc: "One summary per week" },
];

const TIMEZONES = [
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "America/Phoenix", "America/Anchorage", "Pacific/Honolulu", "UTC",
  "Europe/London", "Europe/Berlin", "Asia/Tokyo", "Asia/Kolkata",
];

const COUNTRY_OPTIONS = [
  { value: "US", label: "United States" },
  { value: "CA", label: "Canada" },
  { value: "ALL", label: "All countries" },
];
const LEGACY_COUNTRY_LABELS = { GB: "United Kingdom", DE: "Germany", IN: "India" };

const LLM_PROVIDER_OPTIONS = [
  { value: "gemini", label: "Gemini (free tier, recommended)" },
  { value: "groq", label: "Groq (free tier)" },
  { value: "openrouter", label: "OpenRouter (some free models)" },
  { value: "openai", label: "OpenAI (paid)" },
  { value: "anthropic", label: "Anthropic (paid)" },
  { value: "custom", label: "Custom / local (OpenAI-compatible)" },
].map((o) => ({ ...o, defaultModel: PROVIDERS[o.value].defaultModel ?? "" }));

export default function ProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState(null);
  const [groups, setGroups] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState("");
  const [llmKey, setLlmKey] = useState("");

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

  async function handlePasswordSave() {
    if (!newPassword) return;
    setPwSaving(true); setPwMsg("");
    try {
      const res = await fetch("/api/profile", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword }),
      });
      const data = await res.json();
      if (!res.ok) { setPwMsg(data.error || "Failed to set password."); return; }
      if (data.reauthRequired) {
        setPwMsg("Password saved. Redirecting you to sign in again…");
        setTimeout(() => { window.location.href = "/auth"; }, 900);
        return;
      }
      setPwMsg("Password saved.");
      setNewPassword("");
      setProfile((p) => ({ ...p, hasPassword: true }));
    } catch { setPwMsg("Network error."); }
    finally { setPwSaving(false); }
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true); setError(""); setSuccess(false);
    const sel = Array.isArray(profile.country) ? profile.country : [profile.country].filter(Boolean);
    if (sel.length === 0) {
      setError("Select at least one country.");
      setSaving(false);
      return;
    }
    try {
      const res = await fetch("/api/profile", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(llmKey ? { ...profile, llmKey } : profile),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Failed to save profile."); return; }
      setSuccess(true);
      setLlmKey("");
    } catch { setError("Network error. Please try again."); }
    finally { setSaving(false); }
  }

  if (loading) return <div className="flex justify-center py-16"><div className="text-muted text-sm">Loading profile...</div></div>;
  if (!profile) return <div className="flex justify-center py-16"><div className="text-danger text-sm">{error || "Profile not found."}</div></div>;

  const inputClass = "field-control px-3.5 py-2.5 text-sm";

  return (
    <>
      {/* Success popup — fixed to viewport */}
      {success && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(0,0,0,0.7)] px-4 backdrop-blur-sm">
          <div className="surface-card w-full max-w-sm rounded-[24px] p-8 text-center animate-fade-in-up">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[rgba(215,255,112,0.12)] text-pulse">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-foreground font-display mb-2">Profile Saved</h3>
            <p className="text-muted text-sm mb-6">Your preferences have been updated.</p>
            <button
              onClick={() => setSuccess(false)}
              className="primary-button px-8 py-2.5"
            >
              OK
            </button>
          </div>
        </div>
      )}

      <div className="mx-auto max-w-6xl animate-fade-in-up">
        <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <div className="section-kicker">Tune your signal</div>
            <h1 className="mt-2 font-display text-3xl font-bold tracking-[-0.045em] text-foreground sm:text-4xl">Lookout preferences</h1>
            <p className="mt-2 text-sm text-muted">Tell JobLookout which opportunities are worth interrupting you for.</p>
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className="primary-button px-6 py-3"
          >
            {saving ? "Saving..." : "Save Profile"}
          </button>
        </div>

        {error && (
          <div className="mb-6 rounded-xl border border-[rgba(255,114,123,0.24)] bg-[rgba(255,114,123,0.08)] px-4 py-3 text-sm text-danger" role="alert">{error}</div>
        )}

        <form onSubmit={handleSave} className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          {/* ---- Left Column ---- */}
          <div className="space-y-5">
            {/* Role Categories, grouped by section */}
            <section className="surface-card rounded-2xl p-5 sm:p-6">
              <div className="section-kicker">01 · Target roles</div>
              <h2 className="mb-4 mt-1 font-display text-lg font-bold text-foreground">Role categories</h2>
              <div className="space-y-4">
                {Object.entries(ROLE_SECTIONS).map(([sectionKey, section]) => {
                  const values = section.categories.map((c) => c.value);
                  const allSelected = values.every((v) => profile.roleCategories.includes(v));
                  return (
                    <div key={sectionKey}>
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="text-xs font-semibold text-pulse uppercase tracking-wider">{section.label}</h3>
                        <button type="button"
                          className="text-xs text-muted hover:text-foreground transition-colors"
                          onClick={() => setProfile((p) => ({
                            ...p,
                            roleCategories: allSelected
                              ? p.roleCategories.filter((v) => !values.includes(v))
                              : [...new Set([...p.roleCategories, ...values])],
                          }))}>
                          {allSelected ? "Clear all" : "Select all"}
                        </button>
                      </div>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {section.categories.map((role) => (
                          <label key={role.value} className="flex items-center gap-2 text-sm text-muted cursor-pointer hover:text-foreground transition-colors">
                            <input type="checkbox" checked={profile.roleCategories.includes(role.value)}
                              onChange={() => setProfile((p) => ({ ...p, roleCategories: toggleArrayValue(p.roleCategories, role.value) }))}
                              className="w-4 h-4 rounded border-line bg-background accent-pulse" />
                            {role.label}
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Seniority */}
            <section className="surface-card rounded-2xl p-5 sm:p-6">
              <h2 className="mb-3 font-display text-base font-bold text-foreground">Seniority level</h2>
              <div className="flex flex-wrap gap-3">
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

            {/* Education */}
            <section className="surface-card rounded-2xl p-5 sm:p-6">
              <h2 className="mb-3 font-display text-base font-bold text-foreground">Education</h2>
              <p className="text-xs text-muted mb-3">Used to pick the right experience tier when a job lists requirements like &ldquo;Bachelor&rsquo;s + 5 years OR Master&rsquo;s + 3 years&rdquo;.</p>
              <div className="flex flex-wrap gap-3">
                {EDUCATION_LEVELS.map((e) => (
                  <label key={e.value} className="flex items-center gap-2 text-sm text-muted cursor-pointer hover:text-foreground transition-colors">
                    <input type="radio" name="educationLevel" value={e.value}
                      checked={profile.educationLevel === e.value}
                      onChange={() => setProfile((p) => ({ ...p, educationLevel: e.value }))}
                      className="w-4 h-4 border-line bg-background accent-pulse" />
                    {e.label}
                  </label>
                ))}
                <label className="flex items-center gap-2 text-sm text-muted cursor-pointer hover:text-foreground transition-colors">
                  <input type="radio" name="educationLevel" value=""
                    checked={!profile.educationLevel}
                    onChange={() => setProfile((p) => ({ ...p, educationLevel: "" }))}
                    className="w-4 h-4 border-line bg-background accent-pulse" />
                  Prefer not to say
                </label>
              </div>
            </section>

            {/* Country + Sponsorship */}
            <section className="surface-card space-y-3 rounded-2xl p-5 sm:p-6">
              <h2 className="font-display text-base font-bold text-foreground">Location & visa</h2>
              <div>
                <label className="block text-sm font-medium text-foreground/80 mb-1">Countries</label>
                <div className="space-y-2">
                  {COUNTRY_OPTIONS.map((c) => {
                    const selected = Array.isArray(profile.country) ? profile.country : [profile.country].filter(Boolean);
                    const isAll = selected.includes("ALL");
                    const checked = c.value === "ALL" ? isAll : selected.includes(c.value);
                    const disabled = c.value !== "ALL" && isAll;
                    return (
                      <label key={c.value} className={`flex items-center gap-2 text-sm cursor-pointer transition-colors ${disabled ? "opacity-40 cursor-not-allowed" : "text-muted hover:text-foreground"}`}>
                        <input type="checkbox" checked={checked} disabled={disabled}
                          onChange={() => setProfile((p) => {
                            const cur = Array.isArray(p.country) ? p.country : [p.country].filter(Boolean);
                            if (c.value === "ALL") return { ...p, country: checked ? [] : ["ALL"] };
                            return { ...p, country: toggleArrayValue(cur.filter((v) => v !== "ALL"), c.value) };
                          })}
                          className="w-4 h-4 rounded border-line bg-background accent-pulse" />
                        {c.label}
                      </label>
                    );
                  })}
                  {(Array.isArray(profile.country) ? profile.country : []).filter((v) => !["US", "CA", "ALL"].includes(v)).map((legacy) => (
                    <label key={legacy} className="flex items-center gap-2 text-sm text-muted cursor-pointer hover:text-foreground transition-colors">
                      <input type="checkbox" checked
                        onChange={() => setProfile((p) => ({ ...p, country: (Array.isArray(p.country) ? p.country : []).filter((v) => v !== legacy) }))}
                        className="w-4 h-4 rounded border-line bg-background accent-pulse" />
                      {LEGACY_COUNTRY_LABELS[legacy] || legacy}
                    </label>
                  ))}
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-muted cursor-pointer hover:text-foreground transition-colors">
                <input type="checkbox" checked={profile.requiresSponsorship}
                  onChange={(e) => setProfile((p) => ({ ...p, requiresSponsorship: e.target.checked }))}
                  className="w-4 h-4 rounded border-line bg-background accent-pulse" />
                I need work-visa sponsorship (H-1B or similar)
              </label>
            </section>

            {/* Notification Mode */}
            <section className="surface-card rounded-2xl p-5 sm:p-6">
              <h2 className="mb-3 font-display text-base font-bold text-foreground">Notification rhythm</h2>
              <div className="space-y-2">
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
          </div>

          {/* ---- Right Column ---- */}
          <div className="space-y-5">
            {/* Companies */}
            <section className="surface-card rounded-2xl p-5 sm:p-6">
              <div className="section-kicker">02 · Watchlist</div>
              <h2 className="mb-4 mt-1 font-display text-lg font-bold text-foreground">Companies to watch</h2>
              <CompanySelector groups={groups} selected={profile.companySelections}
                onChange={(val) => setProfile((p) => ({ ...p, companySelections: val }))} />
              <p className="mt-4 text-xs text-muted">
                Missing a company?{" "}
                <a href="/suggest-company" className="font-semibold text-pulse hover:underline">Suggest it</a>
                {" "}and we&apos;ll review it for the watchlist.
              </p>
            </section>

            {/* Quiet Hours */}
            <section className="surface-card space-y-3 rounded-2xl p-5 sm:p-6">
              <h2 className="font-display text-base font-bold text-foreground">Quiet hours</h2>
              <p className="text-xs text-faint">No notifications during these hours.</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="block text-xs font-medium text-foreground/80 mb-1">Start</label>
                  <input type="time" value={profile.quietHoursStart}
                    onChange={(e) => setProfile((p) => ({ ...p, quietHoursStart: e.target.value }))}
                    className={`${inputClass} w-full`} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground/80 mb-1">End</label>
                  <input type="time" value={profile.quietHoursEnd}
                    onChange={(e) => setProfile((p) => ({ ...p, quietHoursEnd: e.target.value }))}
                    className={`${inputClass} w-full`} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground/80 mb-1">Timezone</label>
                  <select value={profile.quietHoursTz}
                    onChange={(e) => setProfile((p) => ({ ...p, quietHoursTz: e.target.value }))}
                    className={`${inputClass} w-full`}>
                    {TIMEZONES.map((tz) => (<option key={tz} value={tz}>{tz}</option>))}
                  </select>
                </div>
              </div>
            </section>

            {/* Active Toggle */}
            <section className="surface-card rounded-2xl p-5 sm:p-6">
              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <div className="font-display text-base font-bold text-foreground">Active notifications</div>
                  <div className="text-xs text-muted mt-1">Pause all alerts while keeping settings.</div>
                </div>
                <div className="relative"
                  onClick={() => setProfile((p) => ({ ...p, isActive: !p.isActive }))}>
                  <input type="checkbox" checked={profile.isActive}
                    onChange={(e) => setProfile((p) => ({ ...p, isActive: e.target.checked }))}
                    className="sr-only peer" />
                  <div className={`h-6 w-11 cursor-pointer rounded-full transition-colors ${profile.isActive ? "bg-pulse" : "border border-line bg-elevated"}`}>
                    <div className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-foreground shadow transition-transform ${profile.isActive ? "translate-x-5 bg-[#07100c]" : "translate-x-0"}`} />
                  </div>
                </div>
              </label>
            </section>

            {/* Password */}
            <section className="surface-card space-y-3 rounded-2xl p-5 sm:p-6">
              <h2 className="font-display text-base font-bold text-foreground">
                {profile.hasPassword ? "Change Password" : "Set Password"}
              </h2>
              <p className="text-xs text-faint">
                {profile.hasPassword ? "Update your login password." : "Set a password so you can log in with email."}
              </p>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="New password (12+ characters)"
                minLength={12}
                maxLength={1024}
                className={`${inputClass} w-full`}
              />
              {pwMsg && (
                <p className={`text-xs ${pwMsg.startsWith("Password saved.") ? "text-pulse" : "text-danger"}`}>{pwMsg}</p>
              )}
              <button
                type="button"
                onClick={handlePasswordSave}
                disabled={pwSaving || newPassword.length < 12}
                className="secondary-button px-4 py-2 text-sm disabled:opacity-30"
              >
                {pwSaving ? "Saving..." : profile.hasPassword ? "Update Password" : "Set Password"}
              </button>
            </section>

            {/* Fit Check stays unavailable to production users until its server-side flag is enabled. */}
            {profile.fitCheckEnabled && <section className="surface-card rounded-2xl p-5 sm:p-6">
              <div className="section-kicker">03 · Optional intelligence</div>
              <h2 className="mb-1 mt-1 font-display text-lg font-bold text-foreground">Fit Check AI</h2>
              <p className="text-xs text-muted mb-3">
                Bring your own LLM; JobLookout never uses your key or endpoint for anything but your own fit checks.
                Gemini and Groq have free tiers; OpenAI and Anthropic spend your money. Get a free Gemini key at{" "}
                <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="text-pulse hover:underline">aistudio.google.com/apikey</a>.
              </p>

              <label className="block text-xs text-muted mb-1">Resume (plain text, pasted)</label>
              <textarea
                value={profile.resumeText ?? ""}
                maxLength={15000}
                rows={8}
                onChange={(e) => setProfile((p) => ({ ...p, resumeText: e.target.value }))}
                className={`${inputClass} w-full font-mono text-xs`}
                placeholder="Paste your resume text here..."
              />
              <div className="text-right text-xs text-muted mb-3">{(profile.resumeText ?? "").length}/15000</div>

              <label className="block text-xs text-muted mb-1">Years of experience</label>
              <input
                type="number" min="0" max="50" step="0.5"
                value={profile.experienceYears ?? ""}
                onChange={(e) => setProfile((p) => ({ ...p, experienceYears: e.target.value === "" ? null : Number(e.target.value) }))}
                className={`${inputClass} w-32 mb-3`}
              />

              <label className="block text-xs text-muted mb-1">LLM provider</label>
              <select
                value={profile.llmProvider ?? "gemini"}
                onChange={(e) => {
                  const opt = LLM_PROVIDER_OPTIONS.find((o) => o.value === e.target.value);
                  setProfile((p) => ({ ...p, llmProvider: e.target.value, llmModel: opt?.defaultModel ?? "" }));
                }}
                className={`${inputClass} w-full mb-3`}
              >
                {LLM_PROVIDER_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>

              <label className="block text-xs text-muted mb-1">Model</label>
              <input
                type="text"
                value={profile.llmModel ?? ""}
                onChange={(e) => setProfile((p) => ({ ...p, llmModel: e.target.value }))}
                className={`${inputClass} w-full mb-3`}
                placeholder={profile.llmProvider === "openrouter" || profile.llmProvider === "custom" ? "required" : "provider default"}
              />

              {profile.llmProvider === "custom" && (
                <>
                  <label className="block text-xs text-muted mb-1">Endpoint base URL (OpenAI-compatible)</label>
                  <input
                    type="text"
                    value={profile.llmBaseUrl ?? ""}
                    onChange={(e) => setProfile((p) => ({ ...p, llmBaseUrl: e.target.value }))}
                    className={`${inputClass} w-full mb-1`}
                    placeholder="https://your-tunnel.example.com/v1"
                  />
                  <p className="text-xs text-muted mb-3">
                    Your machine must be reachable from the internet (Tailscale Funnel, cloudflared, ngrok) and answer within 60s.
                    Small models may fail the structured output and return an error instead of a score.
                  </p>
                </>
              )}

              <label className="block text-xs text-muted mb-1">
                API key {profile.llmKeyConfigured ? <span className="text-pulse">(configured)</span> : profile.llmProvider === "custom" ? "(optional)" : ""}
              </label>
              <input
                type="password"
                value={llmKey}
                onChange={(e) => setLlmKey(e.target.value)}
                className={`${inputClass} w-full mb-1`}
                placeholder={profile.llmKeyConfigured ? "leave blank to keep the current key" : "paste your API key"}
                autoComplete="off"
              />
              {profile.llmKeyConfigured && (
                <button type="button" className="text-xs text-danger hover:underline mb-2"
                  onClick={async () => {
                    setError("");
                    try {
                      const res = await fetch("/api/profile", {
                        method: "PUT", headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ llmKey: "" }),
                      });
                      if (res.ok) {
                        setProfile((p) => ({ ...p, llmKeyConfigured: false }));
                      } else {
                        const data = await res.json().catch(() => ({}));
                        setError(data.error || "Failed to remove the stored key.");
                      }
                    } catch {
                      setError("Network error. Please try again.");
                    }
                  }}>
                  Remove stored key
                </button>
              )}

              <p className="text-xs mt-2">
                {(profile.resumeText ?? "").trim() && (profile.llmKeyConfigured || llmKey || (profile.llmProvider === "custom" && profile.llmBaseUrl && profile.llmModel))
                  ? <span className="text-pulse">Fit Check active: the Fit Check button on your job DMs will work after saving.</span>
                  : <span className="text-muted">Fit Check inactive: add your resume and connect an LLM, then save.</span>}
              </p>
            </section>}
          </div>
        </form>
      </div>
    </>
  );
}
