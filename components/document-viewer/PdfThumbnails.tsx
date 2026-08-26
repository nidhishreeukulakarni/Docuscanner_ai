"use client";

// components/document-viewer/PdfThumbnails.tsx
//
// Left rail of small page previews. Renders lazily (only when scrolled
// into view) so a 300-page document doesn't render 300 canvases up front.

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "@/lib/pdf";

interface PdfThumbnailsProps {
  pdf: PDFDocumentProxy | null;
  numPages: number;
  currentPage: number;
  onSelect: (page: number) => void;
}

const THUMB_WIDTH = 110;

export default function PdfThumbnails({
  pdf,
  numPages,
  currentPage,
  onSelect,
}: PdfThumbnailsProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const activeThumbRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    activeThumbRef.current?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }, [currentPage]);

  return (
    <div
      ref={containerRef}
      className="w-32 shrink-0 overflow-y-auto border-r border-neutral-200 bg-neutral-50 px-2 py-3"
    >
      <div className="flex flex-col items-center gap-3">
        {Array.from({ length: numPages }, (_, i) => i + 1).map((pageNum) => (
          <Thumbnail
            key={pageNum}
            ref={pageNum === currentPage ? activeThumbRef : undefined}
            pdf={pdf}
            pageNum={pageNum}
            isActive={pageNum === currentPage}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

interface ThumbnailProps {
  pdf: PDFDocumentProxy | null;
  pageNum: number;
  isActive: boolean;
  onSelect: (page: number) => void;
}

function Thumbnail({ pdf, pageNum, isActive, onSelect, ref }: ThumbnailProps & { ref?: React.Ref<HTMLButtonElement> }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapperRef = useRef<HTMLButtonElement | null>(null);
  const [inView, setInView] = useState(false);
  const [rendered, setRendered] = useState(false);

  // Only render once the thumbnail scrolls near the visible rail.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setInView(true);
      },
      { rootMargin: "200px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!inView || rendered || !pdf) return;
    let cancelled = false;

    (async () => {
      const page = await pdf.getPage(pageNum);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = THUMB_WIDTH / baseViewport.width;
      const viewport = page.getViewport({ scale });

      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      if (!cancelled) setRendered(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [inView, rendered, pdf, pageNum]);

  return (
    <button
      ref={(el) => {
        wrapperRef.current = el;
        if (typeof ref === "function") ref(el);
        else if (ref) (ref as React.MutableRefObject<HTMLButtonElement | null>).current = el;
      }}
      onClick={() => onSelect(pageNum)}
      className={`flex w-full flex-col items-center gap-1 rounded p-1 transition-colors ${
        isActive
          ? "bg-white ring-2 ring-neutral-900"
          : "hover:bg-neutral-100"
      }`}
    >
      <div
        className="flex items-center justify-center bg-white shadow-sm"
        style={{ width: THUMB_WIDTH, minHeight: THUMB_WIDTH * 1.3 }}
      >
        <canvas ref={canvasRef} />
      </div>
      <span className="text-[10px] text-neutral-500">{pageNum}</span>
    </button>
  );
}