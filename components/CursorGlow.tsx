"use client";

import { useEffect, useRef } from "react";

export default function CursorGlow() {
  const glowRef = useRef<HTMLDivElement>(null);
  const pos = useRef({ x: 0, y: 0 });      // current rendered position
  const target = useRef({ x: 0, y: 0 });   // actual mouse position
  const raf = useRef<number | null>(null);
  const reduceMotion = useRef(false);

  useEffect(() => {
    reduceMotion.current = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    if (reduceMotion.current) return;

    const handleMove = (e: MouseEvent) => {
      target.current.x = e.clientX;
      target.current.y = e.clientY;
    };
    window.addEventListener("mousemove", handleMove);

    // Spring/lerp toward the target each frame — this lag is what
    // makes it feel "magnetic" instead of glued to the cursor.
    const EASE = 0.12;
    const tick = () => {
      pos.current.x += (target.current.x - pos.current.x) * EASE;
      pos.current.y += (target.current.y - pos.current.y) * EASE;
      if (glowRef.current) {
        glowRef.current.style.transform =
          `translate(${pos.current.x}px, ${pos.current.y}px)`;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener("mousemove", handleMove);
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, []);

  if (reduceMotion.current) return null;

  return (
    <div
      aria-hidden="true"
      className="docusense-cursor-glow pointer-events-none fixed inset-0 z-40 overflow-hidden"
    >
      <div ref={glowRef} className="docusense-glow-orb" />
    </div>
  );
}