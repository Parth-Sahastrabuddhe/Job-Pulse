"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function VerifyPage() {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSendCode(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Failed to send code."); return; }
      setStep(2);
    } catch { setError("Network error."); }
    finally { setLoading(false); }
  }

  async function handleVerify(e) {
    e.preventDefault();
    setError("");
    if (password.length < 6) { setError("Password must be at least 6 characters."); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code, firstName, password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Verification failed."); return; }
      router.push("/profile");
    } catch { setError("Network error."); }
    finally { setLoading(false); }
  }

  const inputClass = "w-full bg-surface border border-line rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-faint focus:outline-none focus:border-pulse focus:ring-1 focus:ring-[rgba(34,197,94,0.2)]";

  return (
    <div className="flex flex-col items-center justify-center py-16 animate-fade-in-up">
      <div className="bg-surface rounded-xl border border-line p-8 w-full max-w-md">
        {/* Step indicator */}
        <div className="flex items-center gap-3 mb-6">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${step >= 1 ? "bg-pulse text-black" : "bg-elevated text-faint"}`}>1</div>
          <div className={`flex-1 h-px ${step >= 2 ? "bg-pulse" : "bg-line"}`} />
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${step >= 2 ? "bg-pulse text-black" : "bg-elevated text-faint"}`}>2</div>
        </div>

        <h1 className="text-xl font-bold text-foreground mb-2 font-display">
          Complete Registration
        </h1>
        <p className="text-muted text-sm mb-6">
          {step === 1
            ? "Enter your name and email to receive a verification code."
            : `We sent a 6-digit code to ${email}.`}
        </p>

        {error && (
          <div className="bg-[rgba(239,68,68,0.1)] border border-[rgba(239,68,68,0.2)] text-danger text-sm px-4 py-3 rounded-lg mb-4">
            {error}
          </div>
        )}

        {step === 1 ? (
          <form onSubmit={handleSendCode} className="space-y-4">
            <div>
              <label htmlFor="firstName" className="block text-sm font-medium text-foreground/80 mb-1">First name</label>
              <input id="firstName" type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)}
                placeholder="Alex" required className={inputClass} />
            </div>
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-foreground/80 mb-1">Email address</label>
              <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com" required className={inputClass} />
            </div>
            <button type="submit" disabled={loading}
              className="w-full bg-pulse hover:bg-pulse-hover disabled:opacity-50 text-black font-semibold py-2.5 rounded-lg transition-colors">
              {loading ? "Sending..." : "Send Verification Code"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerify} className="space-y-4">
            <div>
              <label htmlFor="code" className="block text-sm font-medium text-foreground/80 mb-1">Verification code</label>
              <input id="code" type="text" maxLength={6} value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder="000000" autoComplete="one-time-code"
                className="w-full bg-surface border border-line rounded-lg px-4 py-3 text-center tracking-[0.3em] text-2xl font-mono text-foreground focus:outline-none focus:border-pulse focus:ring-1 focus:ring-[rgba(34,197,94,0.2)]" />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-foreground/80 mb-1">Set a password</label>
              <input id="password" type="password" value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters" autoComplete="new-password"
                className={inputClass} />
              <p className="text-xs text-faint mt-1">You'll use this to log in next time.</p>
            </div>
            <button type="submit" disabled={loading || code.length < 6 || password.length < 6}
              className="w-full bg-pulse hover:bg-pulse-hover disabled:opacity-50 text-black font-semibold py-2.5 rounded-lg transition-colors">
              {loading ? "Verifying..." : "Complete Registration"}
            </button>
            <button type="button" onClick={() => { setStep(1); setCode(""); setPassword(""); setError(""); }}
              className="w-full text-sm text-faint hover:text-muted transition-colors">
              Use a different email
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
