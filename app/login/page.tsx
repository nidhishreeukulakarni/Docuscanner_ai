"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import { useAuth, ApiError } from "@/lib/AuthContext";

export default function LoginPage() {
  const router = useRouter();
  const { login, register } = useAuth();

  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === "login") {
        await login(email, password);
      } else {
        await register(email, password);
      }
      router.push("/workspace");
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Couldn't reach the backend. Is uvicorn running on :8000?"
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-ink-950 text-paper-50 flex flex-col">
      <Navbar />
      <div className="flex-1 flex items-center justify-center px-6">
        <form
          onSubmit={handleSubmit}
          className="w-full max-w-sm rounded-lg border border-white/10 bg-white/[0.03] p-8 space-y-5"
        >
          <div>
            <h1 className="font-display text-2xl text-paper-50">
              {mode === "login" ? "Log in" : "Create an account"}
            </h1>
            <p className="font-body text-sm text-slate-400 mt-1">
              {mode === "login"
                ? "Access your documents and chat history."
                : "Takes a few seconds — no verification email needed for now."}
            </p>
          </div>

          <div className="space-y-3">
            <label className="block">
              <span className="font-body text-xs text-slate-400 uppercase tracking-wide">
                Email
              </span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-md bg-white/5 border border-white/10 px-3 py-2
                           font-body text-sm text-paper-50 placeholder:text-slate-500
                           focus:outline-none focus:ring-1 focus:ring-highlight-400"
                placeholder="you@example.com"
              />
            </label>

            <label className="block">
              <span className="font-body text-xs text-slate-400 uppercase tracking-wide">
                Password
              </span>
              <input
                type="password"
                required
                minLength={mode === "register" ? 8 : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-md bg-white/5 border border-white/10 px-3 py-2
                           font-body text-sm text-paper-50 placeholder:text-slate-500
                           focus:outline-none focus:ring-1 focus:ring-highlight-400"
                placeholder={mode === "register" ? "At least 8 characters" : "••••••••"}
              />
            </label>
          </div>

          {error && (
            <p className="font-body text-xs text-red-300 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full font-body text-sm font-medium rounded-md bg-highlight-400 text-ink-950
                       px-4 py-2 hover:bg-highlight-500 transition-colors
                       disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting
              ? "Please wait…"
              : mode === "login"
              ? "Log in"
              : "Create account"}
          </button>

          <button
            type="button"
            onClick={() => {
              setError(null);
              setMode(mode === "login" ? "register" : "login");
            }}
            className="w-full font-body text-xs text-slate-400 hover:text-paper-50 transition-colors"
          >
            {mode === "login"
              ? "Don't have an account? Sign up"
              : "Already have an account? Log in"}
          </button>
        </form>
      </div>
    </main>
  );
}