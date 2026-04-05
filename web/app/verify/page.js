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

  return (
    <div className="flex flex-col items-center justify-center py-16">
      <div className="bg-white rounded-xl border border-gray-200 p-8 w-full max-w-md">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          Complete Registration
        </h1>
        <p className="text-gray-500 text-sm mb-6">
          {step === 1
            ? "Enter your name and email to receive a verification code."
            : `We sent a 6-digit code to ${email}. Enter it below and set your password.`}
        </p>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg mb-4">
            {error}
          </div>
        )}

        {step === 1 ? (
          <form onSubmit={handleSendCode} className="space-y-4">
            <div>
              <label htmlFor="firstName" className="block text-sm font-medium text-gray-700 mb-1">First name</label>
              <input id="firstName" type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)}
                placeholder="Alex" required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />
            </div>
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">Email address</label>
              <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com" required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />
            </div>
            <button type="submit" disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-semibold py-2.5 rounded-lg transition-colors">
              {loading ? "Sending..." : "Send Verification Code"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerify} className="space-y-4">
            <div>
              <label htmlFor="code" className="block text-sm font-medium text-gray-700 mb-1">Verification code</label>
              <input id="code" type="text" maxLength={6} value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder="000000" autoComplete="one-time-code"
                className="w-full border border-gray-300 rounded-lg px-4 py-3 text-center tracking-[0.3em] text-2xl font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">Set a password</label>
              <input id="password" type="password" value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters" autoComplete="new-password"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />
              <p className="text-xs text-gray-400 mt-1">You'll use this to log in next time (no Discord needed).</p>
            </div>
            <button type="submit" disabled={loading || code.length < 6 || password.length < 6}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-semibold py-2.5 rounded-lg transition-colors">
              {loading ? "Verifying..." : "Complete Registration"}
            </button>
            <button type="button" onClick={() => { setStep(1); setCode(""); setPassword(""); setError(""); }}
              className="w-full text-sm text-gray-500 hover:text-gray-700">
              Use a different email
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
