"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BrandWordmark } from "@/components/Brand";

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
    if (password.length < 12) { setError("Password must be at least 12 characters."); return; }
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

  const inputClass = "field-control px-3.5 py-3 text-sm placeholder:text-faint";

  return (
    <div className="flex min-h-[calc(100vh-9rem)] items-center justify-center py-6 animate-fade-in-up">
      <div className="surface-card w-full max-w-lg rounded-[26px] p-6 sm:p-9">
        <div className="mb-8 flex justify-center"><BrandWordmark href="/" /></div>
        {/* Step indicator */}
        <div className="mb-7 flex items-center gap-3">
          <div className={`flex h-9 w-9 items-center justify-center rounded-xl text-xs font-bold ${step >= 1 ? "bg-pulse text-[#07100c]" : "bg-elevated text-faint"}`}>1</div>
          <div className={`h-px flex-1 ${step >= 2 ? "bg-pulse" : "bg-line"}`} />
          <div className={`flex h-9 w-9 items-center justify-center rounded-xl text-xs font-bold ${step >= 2 ? "bg-pulse text-[#07100c]" : "bg-elevated text-faint"}`}>2</div>
        </div>

        <div className="section-kicker">Secure your account</div>
        <h1 className="mt-2 font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          Complete your registration
        </h1>
        <p className="mb-7 mt-2 text-sm leading-6 text-muted">
          {step === 1
            ? "Enter your name and email to receive a verification code."
            : `We sent a 6-digit code to ${email}.`}
        </p>

        {error && (
          <div className="mb-4 rounded-xl border border-[rgba(255,114,123,0.24)] bg-[rgba(255,114,123,0.08)] px-4 py-3 text-sm text-danger" role="alert">
            {error}
          </div>
        )}

        {step === 1 ? (
          <form onSubmit={handleSendCode} className="space-y-4">
            <div>
              <label htmlFor="firstName" className="mb-1.5 block text-sm font-semibold text-foreground/80">First name</label>
              <input id="firstName" type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)}
                placeholder="Alex" required maxLength={100} autoComplete="given-name" className={inputClass} />
            </div>
            <div>
              <label htmlFor="email" className="mb-1.5 block text-sm font-semibold text-foreground/80">Email address</label>
              <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com" required maxLength={254} autoComplete="email" className={inputClass} />
            </div>
            <button type="submit" disabled={loading}
              className="primary-button w-full px-5 py-3">
              {loading ? "Sending…" : "Send verification code"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerify} className="space-y-4">
            <div>
              <label htmlFor="code" className="mb-1.5 block text-sm font-semibold text-foreground/80">Verification code</label>
              <input id="code" type="text" maxLength={6} value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder="000000" autoComplete="one-time-code"
                className="field-control px-4 py-3 text-center font-mono text-2xl tracking-[0.3em]" />
            </div>
            <div>
              <label htmlFor="password" className="mb-1.5 block text-sm font-semibold text-foreground/80">Set a password</label>
              <input id="password" type="password" value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 12 characters" minLength={12} maxLength={1024} autoComplete="new-password"
                className={inputClass} />
              <p className="mt-1.5 text-xs text-faint">Use 12+ characters. You&apos;ll use this to log in next time.</p>
            </div>
            <button type="submit" disabled={loading || code.length < 6 || password.length < 12}
              className="primary-button w-full px-5 py-3">
              {loading ? "Verifying…" : "Complete registration"}
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
