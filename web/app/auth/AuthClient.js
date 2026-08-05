"use client";

import { useState } from "react";
import Link from "next/link";
import { BrandWordmark } from "@/components/Brand";

function DiscordMark({ className = "w-5 h-5" }) {
  return (
    <svg className={className} viewBox="0 0 127.14 96.36" xmlns="http://www.w3.org/2000/svg" fill="currentColor" aria-hidden="true">
      <path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z" />
    </svg>
  );
}

const REGISTER_STEPS = [
  { number: "1", label: "Connect Discord" },
  { number: "2", label: "Verify email" },
  { number: "3", label: "Tune your feed" },
];

export default function AuthClient({ initialTab = "login" }) {
  const [tab, setTab] = useState(initialTab === "register" ? "register" : "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleLogin(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Login failed."); return; }
      window.location.href = "/profile";
    } catch { setError("Network error."); }
    finally { setLoading(false); }
  }

  const inputClass = "field-control px-3.5 py-3 text-sm placeholder:text-faint";

  return (
    <div className="mx-auto grid min-h-[calc(100vh-9rem)] max-w-5xl items-stretch overflow-hidden rounded-[28px] border border-line bg-surface/70 shadow-[0_30px_100px_rgba(0,0,0,0.3)] animate-fade-in-up lg:grid-cols-[0.92fr_1.08fr]">
      <aside className="radar-grid relative hidden overflow-hidden border-r border-line bg-[linear-gradient(150deg,rgba(20,37,31,0.98),rgba(7,16,14,0.96))] p-10 lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -right-28 -top-28 h-72 w-72 rounded-full border border-pulse/20" />
        <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full border border-pulse/20" />
        <BrandWordmark href="/" />
        <div className="relative my-16">
          <div className="section-kicker">Your search, on watch</div>
          <h1 className="mt-4 max-w-sm font-display text-4xl font-bold leading-tight tracking-[-0.05em] text-foreground">
            New opportunities should find you, too.
          </h1>
          <p className="mt-5 max-w-sm leading-7 text-muted">
            Connect once, set your signal, and let JobLookout monitor the sources while you focus on stronger applications.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[["190+", "companies"], ["24/7", "monitoring"], ["~2 min", "to set up"]].map(([value, label]) => (
            <div key={label} className="rounded-xl border border-line bg-background/60 p-3">
              <div className="font-display text-lg font-bold text-pulse">{value}</div>
              <div className="mt-0.5 text-[10px] uppercase tracking-wider text-faint">{label}</div>
            </div>
          ))}
        </div>
      </aside>

      <div className="flex items-center p-5 sm:p-10 lg:p-14">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-8 lg:hidden"><BrandWordmark href="/" /></div>
          <div className="mb-7">
            <div className="section-kicker">Member access</div>
            <h2 className="mt-2 font-display text-3xl font-bold tracking-[-0.04em] text-foreground">
              {tab === "login" ? "Welcome back" : "Start your lookout"}
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              {tab === "login" ? "Sign in to manage your alerts and application pipeline." : "Create an account through Discord, then personalize your search."}
            </p>
          </div>

          <div className="mb-6 grid grid-cols-2 rounded-xl border border-line bg-background/60 p-1">
          <button onClick={() => { setTab("login"); setError(""); }}
            className={`rounded-lg px-3 py-2.5 text-sm font-semibold transition-all ${tab === "login" ? "bg-elevated text-foreground shadow" : "text-faint hover:text-muted"}`}>
            Log in
          </button>
          <button onClick={() => { setTab("register"); setError(""); }}
            className={`rounded-lg px-3 py-2.5 text-sm font-semibold transition-all ${tab === "register" ? "bg-elevated text-foreground shadow" : "text-faint hover:text-muted"}`}>
            Create account
          </button>
          </div>

          {error && (
            <div className="mb-4 rounded-xl border border-[rgba(255,114,123,0.24)] bg-[rgba(255,114,123,0.08)] px-4 py-3 text-sm text-danger" role="alert">{error}</div>
          )}

          {tab === "login" ? (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
              <label htmlFor="email" className="mb-1.5 block text-sm font-semibold text-foreground/80">Email address</label>
              <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com" required maxLength={254} autoComplete="email" className={inputClass} />
              </div>
              <div>
              <div className="mb-1.5 flex items-center justify-between gap-3">
                <label htmlFor="password" className="block text-sm font-semibold text-foreground/80">Password</label>
                <Link href="/forgot-password" className="text-xs font-semibold text-pulse transition-colors hover:text-pulse-hover">
                  Forgot password?
                </Link>
              </div>
              <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="Your password" required maxLength={1024} autoComplete="current-password" className={inputClass} />
              </div>
              <button type="submit" disabled={loading} className="primary-button mt-2 w-full px-5 py-3">
                {loading ? "Signing in…" : "Continue to JobLookout"}
              </button>
              <div className="flex items-center gap-3 text-xs text-faint">
                <span className="h-px flex-1 bg-line" />or<span className="h-px flex-1 bg-line" />
              </div>
              <a href="/api/auth/discord" className="secondary-button w-full px-5 py-3 text-sm">
                <span className="text-[#5865F2]"><DiscordMark /></span>
                Continue with Discord
              </a>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="rounded-2xl border border-line bg-background/50 p-4">
                <div className="flex items-center gap-2">
                  {REGISTER_STEPS.map((step, index) => (
                    <div key={step.number} className="flex flex-1 items-center gap-2">
                      <div className="flex items-center gap-2">
                        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold ${index === 0 ? "bg-pulse text-[#07100c]" : "bg-elevated text-faint"}`}>
                          {step.number}
                        </span>
                        <span className={`text-[11px] font-semibold leading-tight ${index === 0 ? "text-foreground" : "text-faint"}`}>{step.label}</span>
                      </div>
                      {index < REGISTER_STEPS.length - 1 && <span className="h-px min-w-2 flex-1 bg-line" />}
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-xs leading-5 text-muted">
                  Discord is where your alerts arrive. You&rsquo;ll verify an email and set a password right after connecting.
                </p>
              </div>
            <a href="/api/auth/discord"
              className="flex w-full items-center justify-center gap-3 rounded-xl bg-[#5865F2] px-6 py-3.5 font-semibold text-white shadow-[0_12px_32px_rgba(88,101,242,0.22)] transition-all hover:-translate-y-0.5 hover:bg-[#4752c4]">
              <DiscordMark />
              Continue with Discord
            </a>
              <p className="text-center text-xs leading-5 text-faint">
                Free · about 2 minutes · no card required. Discord is only used to deliver your alerts.
              </p>
            </div>
          )}

          <p className="mt-8 text-center text-xs text-faint">
            By continuing, you agree to the{" "}
            <Link href="/terms" className="font-semibold text-muted transition-colors hover:text-foreground">Terms</Link>
            {" "}and{" "}
            <Link href="/privacy" className="font-semibold text-muted transition-colors hover:text-foreground">Privacy Policy</Link>.
          </p>
          </div>
      </div>
    </div>
  );
}
