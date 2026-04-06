"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AuthPage() {
  const router = useRouter();
  const [tab, setTab] = useState("login");
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

  const inputClass = "w-full bg-surface border border-line rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-faint focus:outline-none focus:border-pulse focus:ring-1 focus:ring-[rgba(34,197,94,0.2)]";

  return (
    <div className="flex flex-col items-center justify-center py-16 animate-fade-in-up">
      <div className="bg-surface rounded-xl border border-line p-8 w-full max-w-md">
        <div className="flex items-center justify-center gap-0.5 mb-8">
          <span className="text-2xl font-bold text-foreground font-display">Job</span>
          <span className="text-2xl font-bold text-pulse font-display">Pulse</span>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-line mb-6">
          <button onClick={() => { setTab("login"); setError(""); }}
            className={`flex-1 pb-3 text-sm font-medium transition-colors ${tab === "login" ? "border-b-2 border-pulse text-pulse" : "text-faint hover:text-muted"}`}>
            Login
          </button>
          <button onClick={() => { setTab("register"); setError(""); }}
            className={`flex-1 pb-3 text-sm font-medium transition-colors ${tab === "register" ? "border-b-2 border-pulse text-pulse" : "text-faint hover:text-muted"}`}>
            Register
          </button>
        </div>

        {error && (
          <div className="bg-[rgba(239,68,68,0.1)] border border-[rgba(239,68,68,0.2)] text-danger text-sm px-4 py-3 rounded-lg mb-4">
            {error}
          </div>
        )}

        {tab === "login" ? (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-foreground/80 mb-1">Email</label>
              <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com" required className={inputClass} />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-foreground/80 mb-1">Password</label>
              <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="Your password" required className={inputClass} />
            </div>
            <button type="submit" disabled={loading}
              className="w-full bg-pulse hover:bg-pulse-hover disabled:opacity-50 text-black font-semibold py-2.5 rounded-lg transition-colors">
              {loading ? "Logging in..." : "Login"}
            </button>
          </form>
        ) : (
          <div className="space-y-4">
            <p className="text-muted text-sm text-center">
              Register with Discord to link your account for job alerts.
            </p>
            <a href="/api/auth/discord"
              className="flex items-center justify-center gap-3 w-full bg-[#5865F2] hover:bg-[#4752c4] text-white font-semibold py-3 px-6 rounded-lg transition-colors">
              <svg className="w-5 h-5" viewBox="0 0 127.14 96.36" xmlns="http://www.w3.org/2000/svg" fill="white">
                <path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z" />
              </svg>
              Register with Discord
            </a>
            <p className="text-xs text-faint text-center">
              After Discord auth, you'll verify your email and set a password for future logins.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
