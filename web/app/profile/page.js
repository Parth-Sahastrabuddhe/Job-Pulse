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
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Anchorage",
  "Pacific/Honolulu",
  "UTC",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Asia/Kolkata",
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
          fetch("/api/profile"),
          fetch("/api/companies"),
        ]);

        if (profileRes.status === 401) {
          router.push("/auth");
          return;
        }

        if (!profileRes.ok) {
          setError("Failed to load profile.");
          setLoading(false);
          return;
        }

        const profileData = await profileRes.json();
        const companiesData = await companiesRes.json();

        setProfile(profileData);
        if (companiesData.groups) setGroups(companiesData.groups);
      } catch {
        setError("Network error loading profile.");
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [router]);

  function toggleArrayValue(arr, value) {
    return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSuccess(false);

    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to save profile.");
        return;
      }

      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="text-gray-500 text-sm">Loading profile...</div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex justify-center py-16">
        <div className="text-red-600 text-sm">{error || "Profile not found."}</div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Profile Settings</h1>
      <p className="text-gray-500 text-sm mb-8">Customize your job alert preferences.</p>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg mb-6">
          {error}
        </div>
      )}
      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 text-sm px-4 py-3 rounded-lg mb-6">
          Profile saved successfully.
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-8">
        {/* Role Categories */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Role Categories</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {ROLE_CATEGORIES.map((role) => (
              <label key={role.value} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={profile.roleCategories.includes(role.value)}
                  onChange={() =>
                    setProfile((p) => ({ ...p, roleCategories: toggleArrayValue(p.roleCategories, role.value) }))
                  }
                  className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                {role.label}
              </label>
            ))}
          </div>
        </section>

        {/* Seniority */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Seniority Level</h2>
          <div className="flex flex-wrap gap-4">
            {SENIORITY_LEVELS.map((s) => (
              <label key={s.value} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={profile.seniorityLevels.includes(s.value)}
                  onChange={() =>
                    setProfile((p) => ({ ...p, seniorityLevels: toggleArrayValue(p.seniorityLevels, s.value) }))
                  }
                  className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                {s.label}
              </label>
            ))}
          </div>
        </section>

        {/* Country + Sponsorship */}
        <section className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <h2 className="text-base font-semibold text-gray-900">Location & Visa</h2>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Country</label>
            <select
              value={profile.country}
              onChange={(e) => setProfile((p) => ({ ...p, country: e.target.value }))}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            >
              <option value="US">United States</option>
              <option value="CA">Canada</option>
              <option value="GB">United Kingdom</option>
              <option value="DE">Germany</option>
              <option value="IN">India</option>
              <option value="ALL">All Countries</option>
            </select>
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              checked={profile.requiresSponsorship}
              onChange={(e) => setProfile((p) => ({ ...p, requiresSponsorship: e.target.checked }))}
              className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            I require H1B / work visa sponsorship
          </label>
        </section>

        {/* Companies */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Companies to Watch</h2>
          <CompanySelector
            groups={groups}
            selected={profile.companySelections}
            onChange={(val) => setProfile((p) => ({ ...p, companySelections: val }))}
          />
        </section>

        {/* Notification Mode */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Notification Mode</h2>
          <div className="space-y-3">
            {NOTIFICATION_MODES.map((mode) => (
              <label key={mode.value} className="flex items-start gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="notificationMode"
                  value={mode.value}
                  checked={profile.notificationMode === mode.value}
                  onChange={() => setProfile((p) => ({ ...p, notificationMode: mode.value }))}
                  className="mt-0.5 w-4 h-4 border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                <div>
                  <div className="text-sm font-medium text-gray-900">{mode.label}</div>
                  <div className="text-xs text-gray-500">{mode.desc}</div>
                </div>
              </label>
            ))}
          </div>
        </section>

        {/* Quiet Hours */}
        <section className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <h2 className="text-base font-semibold text-gray-900">Quiet Hours</h2>
          <p className="text-xs text-gray-500">No notifications will be sent during these hours.</p>

          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Start</label>
              <input
                type="time"
                value={profile.quietHoursStart}
                onChange={(e) => setProfile((p) => ({ ...p, quietHoursStart: e.target.value }))}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">End</label>
              <input
                type="time"
                value={profile.quietHoursEnd}
                onChange={(e) => setProfile((p) => ({ ...p, quietHoursEnd: e.target.value }))}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Timezone</label>
              <select
                value={profile.quietHoursTz}
                onChange={(e) => setProfile((p) => ({ ...p, quietHoursTz: e.target.value }))}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {/* Active Toggle */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <div className="text-base font-semibold text-gray-900">Active Notifications</div>
              <div className="text-sm text-gray-500 mt-0.5">Pause all job alerts while keeping your settings.</div>
            </div>
            <div className="relative">
              <input
                type="checkbox"
                checked={profile.isActive}
                onChange={(e) => setProfile((p) => ({ ...p, isActive: e.target.checked }))}
                className="sr-only peer"
              />
              <div
                onClick={() => setProfile((p) => ({ ...p, isActive: !p.isActive }))}
                className={`w-11 h-6 rounded-full cursor-pointer transition-colors ${
                  profile.isActive ? "bg-indigo-600" : "bg-gray-300"
                }`}
              >
                <div
                  className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                    profile.isActive ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </div>
            </div>
          </label>
        </section>

        <button
          type="submit"
          disabled={saving}
          className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-semibold py-2.5 rounded-lg transition-colors"
        >
          {saving ? "Saving..." : "Save Profile"}
        </button>
      </form>
    </div>
  );
}
