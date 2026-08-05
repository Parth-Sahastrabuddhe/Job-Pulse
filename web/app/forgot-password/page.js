"use client";

import { useState } from "react";
import Link from "next/link";
import { BrandWordmark } from "@/components/Brand";

export default function ForgotPasswordPage() {
  const [step, setStep] = useState("request");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function requestCode(event) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const response = await fetch("/api/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "Unable to send a reset code.");
        return;
      }
      setStep("reset");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function resetPassword(event) {
    event.preventDefault();
    setError("");
    if (password.length < 12) {
      setError("Password must be at least 12 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      const response = await fetch("/api/password-reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code, password }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "Unable to reset your password.");
        return;
      }
      setPassword("");
      setConfirmPassword("");
      setCode("");
      setStep("done");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const inputClass = "field-control px-3.5 py-3 text-sm placeholder:text-faint";

  return (
    <div className="flex min-h-[calc(100vh-9rem)] items-center justify-center py-6 animate-fade-in-up">
      <div className="surface-card w-full max-w-lg rounded-[26px] p-6 sm:p-9">
        <div className="mb-8 flex justify-center"><BrandWordmark href="/" /></div>

        <div className="section-kicker">Account recovery</div>
        <h1 className="mt-2 font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          {step === "done" ? "Password updated" : "Reset your password"}
        </h1>
        <p className="mb-7 mt-2 text-sm leading-6 text-muted">
          {step === "request" && "Enter the email connected to your JobLookout account."}
          {step === "reset" && `If an account exists for ${email}, a 6-digit code is on its way.`}
          {step === "done" && "Your previous sessions have been signed out. You can now log in with your new password."}
        </p>

        {error && (
          <div className="mb-4 rounded-xl border border-[rgba(255,114,123,0.24)] bg-[rgba(255,114,123,0.08)] px-4 py-3 text-sm text-danger" role="alert">
            {error}
          </div>
        )}

        {step === "request" && (
          <form onSubmit={requestCode} className="space-y-4">
            <div>
              <label htmlFor="reset-email" className="mb-1.5 block text-sm font-semibold text-foreground/80">Email address</label>
              <input
                id="reset-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                required
                maxLength={254}
                autoComplete="email"
                className={inputClass}
              />
            </div>
            <button type="submit" disabled={loading} className="primary-button w-full px-5 py-3">
              {loading ? "Sending…" : "Send reset code"}
            </button>
          </form>
        )}

        {step === "reset" && (
          <form onSubmit={resetPassword} className="space-y-4">
            <div>
              <label htmlFor="reset-code" className="mb-1.5 block text-sm font-semibold text-foreground/80">Reset code</label>
              <input
                id="reset-code"
                type="text"
                inputMode="numeric"
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
                placeholder="000000"
                required
                maxLength={6}
                autoComplete="one-time-code"
                className="field-control px-4 py-3 text-center font-mono text-2xl tracking-[0.3em]"
              />
            </div>
            <div>
              <label htmlFor="new-password" className="mb-1.5 block text-sm font-semibold text-foreground/80">New password</label>
              <input
                id="new-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="At least 12 characters"
                required
                minLength={12}
                maxLength={1024}
                autoComplete="new-password"
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="confirm-password" className="mb-1.5 block text-sm font-semibold text-foreground/80">Confirm new password</label>
              <input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Repeat your new password"
                required
                minLength={12}
                maxLength={1024}
                autoComplete="new-password"
                className={inputClass}
              />
            </div>
            <button
              type="submit"
              disabled={loading || code.length !== 6 || password.length < 12 || password !== confirmPassword}
              className="primary-button w-full px-5 py-3"
            >
              {loading ? "Updating…" : "Update password"}
            </button>
            <button
              type="button"
              onClick={() => { setStep("request"); setCode(""); setError(""); }}
              className="w-full text-sm text-faint transition-colors hover:text-muted"
            >
              Use a different email or resend
            </button>
          </form>
        )}

        {step === "done" && (
          <Link href="/auth" className="primary-button flex w-full px-5 py-3">
            Return to login
          </Link>
        )}

        {step !== "done" && (
          <p className="mt-7 text-center text-sm text-faint">
            Remembered it? <Link href="/auth" className="font-semibold text-pulse hover:text-pulse-hover">Back to login</Link>
          </p>
        )}
      </div>
    </div>
  );
}
