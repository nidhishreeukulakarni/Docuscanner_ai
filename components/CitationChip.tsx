"use client";

import { AnimatePresence, motion } from "framer-motion";

const CITATIONS = [
  "Page 4, §2.1",
  "Page 11, §3.4",
  "Page 2, §1.2",
  "Page 19, §5.1",
];

export default function CitationChip({ activeKey }: { activeKey: number }) {
  const label = CITATIONS[activeKey % CITATIONS.length];

  return (
    <div className="relative h-16">
      <AnimatePresence mode="wait">
        <motion.div
          key={activeKey}
          initial={{ opacity: 0, x: -24, scale: 0.9 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: 12, scale: 0.95 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="inline-flex items-center gap-2 rounded-md border border-highlight-400/40
                     bg-ink-900/60 px-3 py-1.5 font-mono text-sm text-highlight-400"
        >
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-verify-500" aria-hidden />
          <span>[{label}]</span>
          <span className="text-verify-500">verified</span>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}