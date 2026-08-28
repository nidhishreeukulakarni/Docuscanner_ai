"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";

function useReveal<T extends HTMLElement>(threshold = 0.15) {
  const ref = useRef<T | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduceMotion || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold]);

  return { ref, visible };
}

function prefersReducedMotion() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const STEPS = [
  {
    n: "01",
    title: "Upload",
    body: "Drop in a PDF and DocuSense reads every page, chunks it, and indexes it for search — no manual tagging.",
  },
  {
    n: "02",
    title: "Ask",
    body: "Chat with your document like a colleague who's actually read the whole thing. Ask about one document, or all of them at once.",
  },
  {
    n: "03",
    title: "Verify",
    body: "Every answer links straight back to the exact passage and page it came from — click a citation, see the source highlighted.",
  },
];

const FEATURES: {
  label: string;
  body: string;
  accent: "highlight" | "verify" | "risk";
}[] = [
  {
    label: "Grounded answers",
    body: "No answer without a citation. Every claim in the chat traces back to a highlighted passage in the source document.",
    accent: "highlight",
  },
  {
    label: "Select, then ask",
    body: "Highlight any passage and ask DocuSense to explain it simply, summarize it, or flag risks and obligations in it.",
    accent: "verify",
  },
  {
    label: "Search across documents",
    body: "Switch from one document to your whole library — DocuSense searches everything you've uploaded and says which file each answer came from.",
    accent: "risk",
  },
];

const ACCENT_DOT: Record<(typeof FEATURES)[number]["accent"], string> = {
  highlight: "bg-highlight-400",
  verify: "bg-verify-500",
  risk: "bg-risk-500",
};

// Mock document lines. `accent` bars are the ones that read as
// AI-highlighted passages; the rest are plain "text" lines.
const MOCK_LINES: { width: string; accent?: "highlight" | "verify" | "risk" }[] = [
  { width: "w-4/5" },
  { width: "w-full" },
  { width: "w-3/5", accent: "highlight" },
  { width: "w-full" },
  { width: "w-11/12" },
  { width: "w-2/3", accent: "verify" },
  { width: "w-full" },
  { width: "w-4/5" },
  { width: "w-1/2", accent: "risk" },
  { width: "w-full" },
  { width: "w-3/4" },
];

const MOCK_LINE_BG: Record<"highlight" | "verify" | "risk", string> = {
  highlight: "bg-highlight-400/50",
  verify: "bg-verify-500/40",
  risk: "bg-risk-500/40",
};

export default function RootPage() {
  const howItWorks = useReveal<HTMLDivElement>();
  const features = useReveal<HTMLDivElement>();
  const closingCta = useReveal<HTMLDivElement>();

  const [heroReady, setHeroReady] = useState(false);
  useEffect(() => {
    // One tick after mount so the initial (hidden) state actually
    // paints before we transition to visible.
    const t = setTimeout(() => setHeroReady(true), 50);
    return () => clearTimeout(t);
  }, []);

  const mockCardRef = useRef<HTMLDivElement | null>(null);
  const handleMockMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = mockCardRef.current;
    if (!el || prefersReducedMotion()) return;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    const rotateY = (px - 0.5) * 8;
    const rotateX = (0.5 - py) * 8;
    el.style.transition = "transform 0.05s linear";
    el.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.02,1.02,1.02)`;
  };
  const resetMockTilt = () => {
    const el = mockCardRef.current;
    if (!el) return;
    el.style.transition = "transform 0.5s ease";
    el.style.transform = "perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1,1,1)";
  };

  return (
    <main className="min-h-screen bg-[var(--bg)] text-[var(--text)] flex flex-col">
      <Navbar />

      {/* Hero */}
      <section className="flex-1 relative overflow-hidden">
        {/* Ambient background blobs — independent of the cursor, just
            slow, faint drift so the page has life at rest. */}
        <div
          aria-hidden="true"
          className="docusense-hero-blob docusense-hero-blob-a pointer-events-none absolute"
        />
        <div
          aria-hidden="true"
          className="docusense-hero-blob docusense-hero-blob-b pointer-events-none absolute"
        />

        <div className="relative mx-auto max-w-6xl px-6 py-20 md:py-28 grid md:grid-cols-2 gap-16 items-center">
          <div>
            <span
              className={`block font-mono text-xs tracking-widest text-[var(--accent)] uppercase
                          transition-all duration-700 ease-out ${
                heroReady ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
              }`}
            >
              Document review, grounded in the page
            </span>
            <h1
              className={`font-display text-4xl md:text-5xl leading-tight text-[var(--text)] mt-4
                          transition-all duration-700 ease-out ${
                heroReady ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
              }`}
              style={{ transitionDelay: heroReady ? "100ms" : "0ms" }}
            >
              Read faster.
              <br />
              Trust every line.
            </h1>
            <p
              className={`font-body text-base text-[var(--text-muted)] mt-5 max-w-md leading-relaxed
                          transition-all duration-700 ease-out ${
                heroReady ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
              }`}
              style={{ transitionDelay: heroReady ? "200ms" : "0ms" }}
            >
              DocuSense answers questions about your documents and shows you
              exactly where each answer came from — down to the page and the
              passage.
            </p>
            <div
              className={`mt-8 flex items-center gap-6 flex-wrap transition-all duration-700 ease-out ${
                heroReady ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
              }`}
              style={{ transitionDelay: heroReady ? "300ms" : "0ms" }}
            >
              <Link
                href="/login"
                className="font-body text-sm font-medium rounded-md bg-highlight-400 text-ink-950
                           px-5 py-2.5 hover:bg-highlight-500 hover:scale-[1.03] active:scale-[0.97]
                           hover:shadow-[0_10px_30px_-8px_rgba(240,180,60,0.45)]
                           transition-all"
              >
                Log in to get started
              </Link>

              <a
                href="#how-it-works"
                className="group font-body text-sm text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
              >
                See how it works{" "}
                <span className="inline-block transition-transform duration-300 group-hover:translate-y-0.5">
                  ↓
                </span>
              </a>
            </div>
          </div>

          {/* Mock document stays literal "paper" regardless of theme — it's
              meant to represent a physical page, not a themed UI surface. */}
          <div className="docusense-float relative mx-auto w-full max-w-sm">
            <div
              ref={mockCardRef}
              onMouseMove={handleMockMouseMove}
              onMouseLeave={resetMockTilt}
              className="relative aspect-3/4 rounded-lg bg-paper-50 shadow-page overflow-hidden p-6"
              style={{ transformStyle: "preserve-3d" }}
            >
              <div className="space-y-2.5">
                {MOCK_LINES.map((line, i) => (
                  <div
                    key={i}
                    className={`h-2 ${line.width} rounded-full origin-left ${
                      line.accent ? MOCK_LINE_BG[line.accent] : "bg-ink-950/10"
                    } ${heroReady ? "docusense-drawline" : ""}`}
                    style={{
                      transform: heroReady ? undefined : "scaleX(0)",
                      animationDelay: heroReady ? `${400 + i * 90}ms` : undefined,
                    }}
                  />
                ))}
              </div>

              <div
                className="absolute left-0 right-0 h-8 bg-highlight-400/10 animate-beam-sweep"
                style={{ boxShadow: "var(--shadow-beam)" }}
              />
            </div>

            <div
              className={`docusense-badge-pulse absolute -bottom-4 -right-4 inline-flex items-center gap-1.5 font-mono text-[11px]
                         px-3 py-1.5 rounded-full bg-[var(--surface)] border border-[var(--accent)]/30 text-[var(--accent)]
                         shadow-page transition-all duration-700 ease-out ${
                heroReady ? "opacity-100 scale-100" : "opacity-0 scale-90"
              }`}
              style={{ transitionDelay: heroReady ? "900ms" : "0ms" }}
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <path d="M14 2v6h6" />
              </svg>
              p. 12
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="border-t border-[var(--border-subtle)]">
        <div
          ref={howItWorks.ref}
          className={`mx-auto max-w-6xl px-6 py-20 transition-all duration-700 ease-out ${
            howItWorks.visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
          }`}
        >
          <h2 className="font-display text-2xl text-[var(--text)] mb-12">
            How it works
          </h2>
          <div className="grid md:grid-cols-3 gap-10">
            {STEPS.map((step, i) => (
              <div
                key={step.n}
                className={`transition-all duration-700 ease-out ${
                  howItWorks.visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
                }`}
                style={{ transitionDelay: howItWorks.visible ? `${i * 120}ms` : "0ms" }}
              >
                <span className="font-mono text-xs text-[var(--accent)]">
                  {step.n}
                </span>
                <h3 className="font-display text-lg text-[var(--text)] mt-2">
                  {step.title}
                </h3>
                <p className="font-body text-sm text-[var(--text-muted)] mt-2 leading-relaxed">
                  {step.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="border-t border-[var(--border-subtle)]">
        <div ref={features.ref} className="mx-auto max-w-6xl px-6 py-20">
          <div className="grid md:grid-cols-3 gap-10">
            {FEATURES.map((f, i) => (
              <div
                key={f.label}
                className={`border border-[var(--border-subtle)] rounded-lg p-6 transition-all duration-700 ease-out
                            hover:-translate-y-1 hover:shadow-[0_12px_28px_-12px_rgba(0,0,0,0.35)] hover:border-[var(--accent)]/30 ${
                  features.visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
                }`}
                style={{ transitionDelay: features.visible ? `${i * 120}ms` : "0ms" }}
              >
                <span
                  className={`inline-block w-2 h-2 rounded-full mb-4 ${ACCENT_DOT[f.accent]}`}
                />
                <h3 className="font-body text-sm font-medium text-[var(--text)]">
                  {f.label}
                </h3>
                <p className="font-body text-sm text-[var(--text-muted)] mt-2 leading-relaxed">
                  {f.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Closing CTA */}
      <section className="border-t border-[var(--border-subtle)]">
        <div
          ref={closingCta.ref}
          className={`mx-auto max-w-6xl px-6 py-16 flex flex-col md:flex-row items-center justify-between gap-6
                      transition-all duration-700 ease-out ${
            closingCta.visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
          }`}
        >
          <p className="font-display text-xl text-[var(--text)]">
            Stop searching. Start asking.
          </p>
          <Link
            href="/login"
            className="font-body text-sm font-medium rounded-md bg-highlight-400 text-ink-950
                       px-5 py-2.5 hover:bg-highlight-500 hover:scale-[1.03] active:scale-[0.97]
                       hover:shadow-[0_10px_30px_-8px_rgba(240,180,60,0.45)]
                       transition-all"
          >
            Log in to get started
          </Link>
        </div>
      </section>

      <footer className="border-t border-[var(--border-subtle)]">
        <div className="mx-auto max-w-6xl px-6 py-6">
          <p className="font-mono text-xs text-[var(--text-muted)]">DocuSense AI</p>
        </div>
      </footer>

      <style>{`
        .docusense-hero-blob {
          width: 480px;
          height: 480px;
          border-radius: 9999px;
          filter: blur(90px);
          opacity: 0.14;
        }
        .docusense-hero-blob-a {
          top: -160px;
          left: -120px;
          background: radial-gradient(circle, rgba(var(--glow-rgb), 1) 0%, transparent 70%);
          animation: docusense-blob-drift-a 22s ease-in-out infinite;
        }
        .docusense-hero-blob-b {
          bottom: -200px;
          right: -140px;
          background: radial-gradient(circle, rgba(120, 200, 190, 1) 0%, transparent 70%);
          animation: docusense-blob-drift-b 26s ease-in-out infinite;
        }
        @keyframes docusense-blob-drift-a {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(40px, 30px) scale(1.08); }
        }
        @keyframes docusense-blob-drift-b {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(-30px, -25px) scale(1.06); }
        }

        .docusense-float {
          animation: docusense-float-y 6s ease-in-out infinite;
        }
        @keyframes docusense-float-y {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
        }

        .docusense-drawline {
          animation-name: docusense-drawline-in;
          animation-duration: 500ms;
          animation-timing-function: ease-out;
          animation-fill-mode: forwards;
        }
        @keyframes docusense-drawline-in {
          from { transform: scaleX(0); }
          to { transform: scaleX(1); }
        }

        .docusense-badge-pulse {
          animation: docusense-badge-pulse-kf 3.5s ease-in-out infinite;
          animation-delay: 1.2s;
        }
        @keyframes docusense-badge-pulse-kf {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.05); }
        }

        @media (prefers-reduced-motion: reduce) {
          .docusense-hero-blob,
          .docusense-float,
          .docusense-badge-pulse,
          .docusense-drawline {
            animation: none !important;
          }
        }
      `}</style>
    </main>
  );
}