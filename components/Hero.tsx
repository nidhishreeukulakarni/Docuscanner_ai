"use client";

import { useEffect, useState } from "react";
import CitationChip from "./CitationChip";

/**
 * Hero (v1 — CSS version)
 * ------------------------------------------------------------
 * Same concept as the eventual 3D hero — a highlighter beam
 * sweeps a document, a citation resolves on the right — built
 * with plain CSS + a bit of JS timing instead of WebGL. This
 * proves out the layout, copy, and design tokens first.
 * Swap the left panel for <DocumentStack /> later without
 * touching anything else on this page.
 * ------------------------------------------------------------
 */
export default function Hero() {
  const [citationKey, setCitationKey] = useState(0);

  useEffect(() => {
    // Matches the CSS sweep animation duration (5.2s) below.
    const interval = setInterval(() => {
      setCitationKey((k) => k + 1);
    }, 5200);
    return () => clearInterval(interval);
  }, []);

  return (
    <section className="relative w-full min-h-[90vh] bg-ink-950 text-paper-50 grid grid-cols-1 md:grid-cols-2 overflow-hidden">
      {/* Left pane — static document mockup with CSS beam sweep */}
      <div className="relative flex items-center justify-center py-16 md:py-0">
        <div className="relative w-72 h-96 -rotate-6">
          {/* Stacked page shadows for depth, without 3D */}
          <div className="absolute inset-0 translate-x-2 translate-y-2 rounded-lg bg-paper-100/40" />
          <div className="absolute inset-0 translate-x-1 translate-y-1 rounded-lg bg-paper-100/70" />

          {/* Top page */}
          <div className="absolute inset-0 rounded-lg bg-paper-50 shadow-page overflow-hidden">
            <div className="p-6 space-y-3">
              {Array.from({ length: 9 }).map((_, i) => (
                <div
                  key={i}
                  className="h-2.5 rounded-sm bg-ink-950/10"
                  style={{ width: `${85 - (i % 3) * 12}%` }}
                />
              ))}
            </div>
            {/* The sweeping highlighter beam */}
            <div className="absolute left-6 right-6 h-3 bg-highlight-400/80 rounded-sm shadow-beam animate-beam-sweep" />
          </div>
        </div>
      </div>

      {/* Right pane — copy + live citation */}
      <div className="flex flex-col justify-center gap-6 px-8 py-16 md:px-16">
        <span className="font-mono text-xs tracking-widest text-slate-400 uppercase">
          DocuSense AI
        </span>

        <h1 className="font-display text-4xl md:text-5xl leading-[1.08] text-paper-50">
          Every answer,
          <br />
          traced to its source.
        </h1>

        <p className="font-body text-base md:text-lg text-slate-400 max-w-md">
          Upload a contract, brief, or spec. DocuSense reads it, answers
          questions about it, and shows you the exact line it got the
          answer from — every time.
        </p>

        <div className="flex items-center gap-4 pt-2">
          <a
            href="/workspace"
            className="font-body font-medium rounded-md bg-highlight-400 text-ink-950
                       px-5 py-2.5 hover:bg-highlight-500 transition-colors"
          >
            Try a document
          </a>
          <a href="#how-it-works" className="font-body text-slate-400 hover:text-paper-50 transition-colors">
            See how citations work →
          </a>
        </div>

        <div className="pt-6 border-t border-white/10 max-w-sm">
          <p className="font-mono text-xs text-slate-400 mb-2">
            live from a real session
          </p>
          <p className="font-body text-sm text-paper-50/90 mb-3">
            &ldquo;Termination requires 60 days&rsquo; written notice.&rdquo;
          </p>
          <CitationChip activeKey={citationKey} />
        </div>
      </div>
    </section>
  );
}