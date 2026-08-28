"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import { useAuth, ApiError } from "@/lib/AuthContext";

const PINS = [
  { top: "18%", left: "12%", size: 5, duration: 9, delay: 0 },
  { top: "72%", left: "8%", size: 4, duration: 11, delay: 1.2 },
  { top: "30%", left: "88%", size: 6, duration: 10, delay: 0.6 },
  { top: "80%", left: "82%", size: 4, duration: 8, delay: 2 },
  { top: "10%", left: "55%", size: 3, duration: 12, delay: 0.4 },
  { top: "60%", left: "48%", size: 3, duration: 9.5, delay: 1.8 },
  { top: "45%", left: "6%", size: 4, duration: 10.5, delay: 2.4 },
  { top: "88%", left: "40%", size: 5, duration: 11.5, delay: 0.9 },
];

// Shared tilt/magnetic-hover behavior. Checks prefers-reduced-motion
// ONCE on mount and caches it, instead of calling matchMedia on every
// mousemove event. `strength` controls how far the element rotates
// (for cards) or translates (for buttons) — same math, different scale.
function useTilt<T extends HTMLElement>(strength = 10) {
  const ref = useRef<T | null>(null);
  const reduceMotion = useRef(false);

  useEffect(() => {
    reduceMotion.current = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
  }, []);

  const onMove = (e: React.MouseEvent<T>) => {
    const el = ref.current;
    if (!el || reduceMotion.current) return;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;

    el.style.transition = "transform 0.05s linear";
    el.style.setProperty("--sheen-x", `${px * 100}%`);
    el.style.setProperty("--sheen-y", `${py * 100}%`);

    if (el.tagName === "BUTTON") {
      // Buttons get a small translate, not a 3D rotation.
      const dx = (px - 0.5) * strength;
      const dy = (py - 0.5) * (strength * 0.8);
      el.style.transform = `translate(${dx}px, ${dy}px)`;
    } else {
      const rotateY = (px - 0.5) * strength;
      const rotateX = (0.5 - py) * strength;
      el.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.01,1.01,1.01)`;
    }
  };

  const onLeave = () => {
    const el = ref.current;
    if (!el) return;
    el.style.transition = el.tagName === "BUTTON" ? "transform 0.3s ease" : "transform 0.4s ease";
    el.style.transform =
      el.tagName === "BUTTON"
        ? "translate(0px, 0px)"
        : "perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1,1,1)";
  };

  return { ref, onMove, onLeave };
}

export default function LoginPage() {
  const router = useRouter();
  const { login, register } = useAuth();

  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (mode === "register" && password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    setSubmitting(true);
    try {
      if (mode === "login") {
        await login(email, password);
      } else {
        await register(email, password);
      }
      router.push("/workspace");
    } catch (err) {
      // Log the real cause for us — never show raw backend/dev details
      // (ports, stack traces, connection errors) to the end user.
      console.error("Auth error:", err);
      setError(
        err instanceof ApiError
          ? err.message
          : "Something went wrong. Please try again in a moment."
      );
    } finally {
      setSubmitting(false);
    }
  };

  const card = useTilt<HTMLDivElement>(10);
  const submitBtn = useTilt<HTMLButtonElement>(10);

  return (
    <main className="min-h-screen bg-[var(--bg)] text-[var(--text)] flex flex-col">
      <Navbar />

      <div className="docusense-login-stage flex-1 relative flex items-center justify-center px-6 overflow-hidden">
        <div className="pointer-events-none absolute inset-0">
          {PINS.map((pin, i) => (
            <span
              key={i}
              className="docusense-pin absolute rounded-full bg-highlight-400/25"
              style={{
                top: pin.top,
                left: pin.left,
                width: pin.size,
                height: pin.size,
                animationDuration: `${pin.duration}s`,
                animationDelay: `${pin.delay}s`,
              }}
            />
          ))}
        </div>

        <div
          ref={card.ref}
          onMouseMove={card.onMove}
          onMouseLeave={card.onLeave}
          className="docusense-card relative w-full max-w-sm rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-8"
          style={{ transformStyle: "preserve-3d" }}
        >
          <div className="docusense-sheen pointer-events-none absolute inset-0 rounded-lg" />

          <form onSubmit={handleSubmit} className="relative space-y-5" noValidate>
            <div>
              <h1 className="font-display text-2xl text-[var(--text)]">
                {mode === "login" ? "Log in" : "Create an account"}
              </h1>
              <p className="font-body text-sm text-[var(--text-muted)] mt-1">
                {mode === "login"
                  ? "Access your documents and chat history."
                  : "Takes a few seconds — no verification email needed for now."}
              </p>
            </div>

            <div className="space-y-3">
              <label className="block">
                <span className="font-body text-xs text-[var(--text-muted)] uppercase tracking-wide">
                  Email
                </span>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full rounded-md bg-[var(--surface-2)] border border-[var(--border-subtle)] px-3 py-2
                             font-body text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]
                             focus:outline-none focus:ring-1 focus:ring-highlight-400"
                  placeholder="you@example.com"
                />
              </label>

              <label className="block">
                <span className="font-body text-xs text-[var(--text-muted)] uppercase tracking-wide">
                  Password
                </span>
                <div className="relative mt-1">
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    minLength={mode === "register" ? 8 : undefined}
                    autoComplete={mode === "register" ? "new-password" : "current-password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-md bg-[var(--surface-2)] border border-[var(--border-subtle)] pl-3 pr-10 py-2
                               font-body text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]
                               focus:outline-none focus:ring-1 focus:ring-highlight-400"
                    placeholder={mode === "register" ? "At least 8 characters" : "••••••••"}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                    className="absolute right-0 top-0 h-full px-3 flex items-center text-[var(--text-muted)]
                               hover:text-[var(--text)] hover:scale-110 active:scale-90 transition-all"
                  >
                    {showPassword ? (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a13.16 13.16 0 0 1-1.67 2.68" />
                        <path d="M6.61 6.61A13.5 13.5 0 0 0 2 12s3 8 10 8a9.74 9.74 0 0 0 5.39-1.61" />
                        <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                        <path d="M1 1l22 22" />
                      </svg>
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <path d="M1 12s3.5-8 11-8 11 8 11 8-3.5 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
              </label>

              {mode === "register" && (
                <label className="block">
                  <span className="font-body text-xs text-[var(--text-muted)] uppercase tracking-wide">
                    Confirm password
                  </span>
                  <div className="relative mt-1">
                    <input
                      type={showPassword ? "text" : "password"}
                      required
                      minLength={8}
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="w-full rounded-md bg-[var(--surface-2)] border border-[var(--border-subtle)] pl-3 pr-10 py-2
                                 font-body text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]
                                 focus:outline-none focus:ring-1 focus:ring-highlight-400"
                      placeholder="Re-enter your password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      aria-pressed={showPassword}
                      className="absolute right-0 top-0 h-full px-3 flex items-center text-[var(--text-muted)]
                                 hover:text-[var(--text)] hover:scale-110 active:scale-90 transition-all"
                    >
                      {showPassword ? (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a13.16 13.16 0 0 1-1.67 2.68" />
                          <path d="M6.61 6.61A13.5 13.5 0 0 0 2 12s3 8 10 8a9.74 9.74 0 0 0 5.39-1.61" />
                          <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                          <path d="M1 1l22 22" />
                        </svg>
                      ) : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                          <path d="M1 12s3.5-8 11-8 11 8 11 8-3.5 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      )}
                    </button>
                  </div>
                </label>
              )}
            </div>

            {error && (
              <p
                role="alert"
                aria-live="polite"
                className="font-body text-xs text-red-300 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2"
              >
                {error}
              </p>
            )}

            <button
              ref={submitBtn.ref}
              type="submit"
              disabled={submitting}
              onMouseMove={submitBtn.onMove}
              onMouseLeave={submitBtn.onLeave}
              className="docusense-submit-btn relative w-full font-body text-sm font-medium rounded-md bg-highlight-400 text-ink-950
                         px-4 py-2 hover:bg-highlight-500 transition-colors overflow-hidden
                         disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span className="relative z-10">
                {submitting
                  ? "Please wait…"
                  : mode === "login"
                  ? "Log in"
                  : "Create account"}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setError(null);
                setConfirmPassword("");
                setMode(mode === "login" ? "register" : "login");
              }}
              className="w-full font-body text-xs text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
            >
              {mode === "login"
                ? "Don't have an account? Sign up"
                : "Already have an account? Log in"}
            </button>
          </form>
        </div>
      </div>

      <style>{`
        .docusense-card {
          --sheen-x: 50%;
          --sheen-y: 50%;
          will-change: transform;
        }
        .docusense-sheen {
          background: radial-gradient(
            260px circle at var(--sheen-x) var(--sheen-y),
            rgba(var(--glow-rgb), 0.1),
            transparent 65%
          );
        }
        .docusense-submit-btn {
          will-change: transform;
        }
        .docusense-submit-btn::before {
          content: "";
          position: absolute;
          inset: 0;
          background: radial-gradient(
            120px circle at var(--sheen-x, 50%) var(--sheen-y, 50%),
            rgba(255, 255, 255, 0.2),
            transparent 70%
          );
          opacity: 0;
          transition: opacity 0.2s ease;
          pointer-events: none;
        }
        .docusense-submit-btn:hover::before {
          opacity: 1;
        }

        @media (prefers-reduced-motion: no-preference) {
          .docusense-pin {
            animation-name: docusense-drift;
            animation-timing-function: ease-in-out;
            animation-iteration-count: infinite;
          }
        }
        @keyframes docusense-drift {
          0%, 100% { transform: translateY(0) scale(1); opacity: 0.2; }
          50% { transform: translateY(-14px) scale(1.3); opacity: 0.45; }
        }

        @media (prefers-reduced-motion: reduce) {
          .docusense-card,
          .docusense-submit-btn {
            transition: none !important;
          }
        }
      `}</style>
    </main>
  );
}