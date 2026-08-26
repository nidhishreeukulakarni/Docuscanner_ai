"use client";

// components/document-viewer/PdfViewer.tsx
//
// Continuous-scroll viewer: every page is stacked vertically in one
// scrollable column (like a normal PDF reader), instead of showing a
// single page at a time with a flip transition. Pages render lazily
// as they scroll near the viewport. "Current page" (shown in the page
// number box, and used to highlight the active thumbnail) is derived
// from whichever page occupies the most of the visible viewport as
// you scroll, via IntersectionObserver.
//
// Usage:
//   <PdfViewer fileUrl={document.file_url} />
//   // or, right after upload before you have a persisted URL:
//   <PdfViewer fileBytes={arrayBufferFromUpload} />

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { loadPdf, renderTextLayer, type PDFDocumentProxy, type PDFPageProxy } from "@/lib/pdf";
import type { BBox } from "@/lib/api";
import PdfThumbnails from "./PdfThumbnails";

type FitMode = "custom" | "width" | "page";

export interface PageHighlight {
  page_num: number;
  bbox: BBox;
}

/** FR-05.1: the four floating-toolbar actions available on a text
 * selection. "ask" leaves the question up to the user (opens the
 * chat input scoped to the passage); the other three fire a preset
 * question immediately. Shared with app/workspace/page.tsx, which
 * imports this type rather than declaring its own — keep the two
 * files in sync by editing only here. */
export type SelectionAction = "explain" | "summarize" | "risks" | "ask";

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PdfViewerProps {
  fileUrl?: string;
  fileBytes?: ArrayBuffer;
  /** Called whenever the page most in view changes, so a parent (e.g.
   * the right-panel citation handler) can react. */
  onPageChange?: (page: number) => void;
  /** Imperative jump target — bump this from outside (e.g. a clicked
   * citation "[Page 4, §2.1]") to scroll the viewer there. */
  jumpToPage?: number;
  /** Boxes to highlight — e.g. the chunk(s) a chat answer or summary
   * point was grounded in. Each box is drawn on its own page_num,
   * wherever that page currently is in the scroll. */
  highlights?: PageHighlight[];
  /** FR-05.1: fired when the user selects text and taps one of the
   * four floating-toolbar pills. */
  onAskAboutSelection?: (text: string, page: number, action: SelectionAction) => void;
  className?: string;
}

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.1;

export default function PdfViewer({
  fileUrl,
  fileBytes,
  onPageChange,
  jumpToPage,
  highlights,
  onAskAboutSelection,
  className = "",
}: PdfViewerProps) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [zoom, setZoom] = useState(1); // 1 = 100%
  const [fitMode, setFitMode] = useState<FitMode>("width");
  const [rotation, setRotation] = useState(0); // 0 | 90 | 180 | 270
  const [error, setError] = useState<string | null>(null);
  const [showThumbnails, setShowThumbnails] = useState(true);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pageElsRef = useRef<Map<number, HTMLDivElement>>(new Map());

  // ---- Step 8: text selection -> "Ask about this" popover ----------------
  // Kept at the viewer level (not per-page) since only one selection can
  // be active at a time, and it needs to know which page it landed on.
  const [selectionPopover, setSelectionPopover] = useState<{
    text: string;
    page: number;
    x: number;
    y: number;
  } | null>(null);

  // ---- load the document -------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    setError(null);
    setPdf(null);
    setCurrentPage(1);
    setPageInput("1");
    pageElsRef.current.clear();

    const source = fileBytes ?? fileUrl;
    if (!source) return;

    loadPdf(source)
      .then((doc) => {
        if (cancelled) return;
        setPdf(doc);
        setNumPages(doc.numPages);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Failed to load PDF:", err);
        setError(
          "Couldn't render this document. It may be corrupted or an unsupported format."
        );
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileUrl, fileBytes]);

  // ---- fit-to-width / fit-to-page scale computation ----------------------
  // Based on page 1's dimensions — pages are assumed to be a uniform
  // size, same simplification the single-page version made.
  const computeFitScale = useCallback(
    async (mode: Exclude<FitMode, "custom">) => {
      if (!pdf || !scrollRef.current) return 1;
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 1, rotation });
      const containerWidth = scrollRef.current.clientWidth - 48;
      const containerHeight = scrollRef.current.clientHeight - 48;

      if (mode === "width") {
        return containerWidth / viewport.width;
      }
      return Math.min(
        containerWidth / viewport.width,
        containerHeight / viewport.height
      );
    },
    [pdf, rotation]
  );

  useEffect(() => {
    if (fitMode === "custom") return;
    computeFitScale(fitMode).then((scale) => {
      if (scale > 0) setZoom(scale);
    });
  }, [fitMode, computeFitScale]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (fitMode !== "custom") {
        computeFitScale(fitMode).then((scale) => {
          if (scale > 0) setZoom(scale);
        });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [fitMode, computeFitScale]);

  // ---- track which page is "current" as the user scrolls -----------------
  useEffect(() => {
    const root = scrollRef.current;
    if (!pdf || !root || numPages === 0) return;

    const ratios = new Map<number, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const pageNum = Number(
            (entry.target as HTMLElement).dataset.pageNumber
          );
          if (!pageNum) return;
          ratios.set(pageNum, entry.intersectionRatio);
        });

        let best = currentPage;
        let bestRatio = 0;
        ratios.forEach((ratio, pageNum) => {
          if (ratio > bestRatio) {
            bestRatio = ratio;
            best = pageNum;
          }
        });
        if (bestRatio > 0 && best !== currentPage) {
          setCurrentPage(best);
          setPageInput(String(best));
        }
      },
      { root, threshold: [0, 0.25, 0.5, 0.75, 1] }
    );

    pageElsRef.current.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf, numPages]);

  useEffect(() => {
    onPageChange?.(currentPage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage]);

  // ---- scroll to a given page --------------------------------------------
  const scrollToPage = useCallback((page: number) => {
    const el = pageElsRef.current.get(page);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  const goToPage = useCallback(
    (page: number) => {
      const clamped = Math.min(Math.max(1, page), numPages || 1);
      setPageInput(String(clamped));
      scrollToPage(clamped);
    },
    [numPages, scrollToPage]
  );

  const nextPage = () => goToPage(currentPage + 1);
  const prevPage = () => goToPage(currentPage - 1);

  // ---- imperative jump-to-page (e.g. from a clicked citation) ------------
  useEffect(() => {
    if (jumpToPage && jumpToPage >= 1 && jumpToPage <= numPages) {
      scrollToPage(jumpToPage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpToPage]);

  // ---- keyboard navigation (left/right arrows) ---------------------------
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;
      if (e.key === "ArrowRight") nextPage();
      else if (e.key === "ArrowLeft") prevPage();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, numPages]);

  const handlePageInputCommit = () => {
    const parsed = parseInt(pageInput, 10);
    if (!Number.isNaN(parsed)) {
      goToPage(parsed);
    } else {
      setPageInput(String(currentPage));
    }
  };

  const setZoomClamped = (next: number) => {
    setFitMode("custom");
    setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next)));
  };

  const rotate = (dir: 1 | -1) => {
    setRotation((r) => ((r + dir * 90) % 360 + 360) % 360);
  };

  // ---- text selection -> popover (delegated up from whichever page) ------
  const handleSelection = useCallback((text: string, page: number, x: number, y: number) => {
    setSelectionPopover({ text, page, x, y });
  }, []);

  const handleAskAboutSelection = (action: SelectionAction) => {
    if (!selectionPopover) return;
    onAskAboutSelection?.(selectionPopover.text, selectionPopover.page, action);
    window.getSelection()?.removeAllRanges();
    setSelectionPopover(null);
  };

  // ---- empty / error states ----------------------------------------------
  if (!fileUrl && !fileBytes) {
    return (
      <div
        className={`flex h-full items-center justify-center bg-neutral-50 text-neutral-400 ${className}`}
      >
        <p className="text-sm">No document loaded</p>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={`flex h-full items-center justify-center bg-neutral-50 ${className}`}
      >
        <p className="max-w-xs text-center text-sm text-red-600">{error}</p>
      </div>
    );
  }

  return (
    <div className={`flex h-full flex-col bg-neutral-100 ${className}`}>
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-neutral-200 bg-white px-3 py-2 text-sm">
        <button
          onClick={() => setShowThumbnails((s) => !s)}
          className="rounded p-1.5 text-neutral-600 hover:bg-neutral-100"
          title="Toggle thumbnails"
          aria-label="Toggle thumbnails"
        >
          <PanelIcon />
        </button>

        <div className="mx-1 h-5 w-px bg-neutral-200" />

        <button
          onClick={prevPage}
          disabled={currentPage <= 1}
          className="rounded p-1.5 text-neutral-600 hover:bg-neutral-100 disabled:opacity-30"
          aria-label="Previous page"
          title="Previous page"
        >
          <ChevronLeftIcon />
        </button>
        <div className="flex items-center gap-1">
          <input
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value)}
            onBlur={handlePageInputCommit}
            onKeyDown={(e) => e.key === "Enter" && handlePageInputCommit()}
            className="w-10 rounded border border-neutral-200 px-1 py-0.5 text-center text-sm"
            inputMode="numeric"
            aria-label="Page number"
          />
          <span className="text-neutral-400">/ {numPages || "–"}</span>
        </div>
        <button
          onClick={nextPage}
          disabled={currentPage >= numPages}
          className="rounded p-1.5 text-neutral-600 hover:bg-neutral-100 disabled:opacity-30"
          aria-label="Next page"
          title="Next page"
        >
          <ChevronRightIcon />
        </button>

        <div className="mx-1 h-5 w-px bg-neutral-200" />

        <button
          onClick={() => setZoomClamped(zoom - ZOOM_STEP)}
          className="rounded p-1.5 text-neutral-600 hover:bg-neutral-100"
          aria-label="Zoom out"
        >
          –
        </button>
        <span className="w-12 text-center tabular-nums text-neutral-600">
          {Math.round(zoom * 100)}%
        </span>
        <button
          onClick={() => setZoomClamped(zoom + ZOOM_STEP)}
          className="rounded p-1.5 text-neutral-600 hover:bg-neutral-100"
          aria-label="Zoom in"
        >
          +
        </button>

        <div className="mx-1 h-5 w-px bg-neutral-200" />

        <button
          onClick={() => setFitMode("width")}
          className={`rounded px-2 py-1 text-xs ${
            fitMode === "width"
              ? "bg-neutral-900 text-white"
              : "text-neutral-600 hover:bg-neutral-100"
          }`}
        >
          Fit width
        </button>
        <button
          onClick={() => setFitMode("page")}
          className={`rounded px-2 py-1 text-xs ${
            fitMode === "page"
              ? "bg-neutral-900 text-white"
              : "text-neutral-600 hover:bg-neutral-100"
          }`}
        >
          Fit page
        </button>

        <div className="mx-1 h-5 w-px bg-neutral-200" />

        <button
          onClick={() => rotate(-1)}
          className="rounded p-1.5 text-neutral-600 hover:bg-neutral-100"
          aria-label="Rotate left"
        >
          <RotateLeftIcon />
        </button>
        <button
          onClick={() => rotate(1)}
          className="rounded p-1.5 text-neutral-600 hover:bg-neutral-100"
          aria-label="Rotate right"
        >
          <RotateRightIcon />
        </button>
      </div>

      {/* Body: thumbnails rail (own scrollbar) + continuous page column (own scrollbar) */}
      <div className="flex min-h-0 flex-1">
        {showThumbnails && (
          <PdfThumbnails
            pdf={pdf}
            numPages={numPages}
            currentPage={currentPage}
            onSelect={(p) => scrollToPage(p)}
          />
        )}

        {!pdf && (
          <div className="flex flex-1 items-center justify-center text-sm text-neutral-400">
            Loading document…
          </div>
        )}

        {pdf && (
          <div
            ref={scrollRef}
            className="relative flex-1 overflow-y-auto overflow-x-auto px-4 py-4"
            onMouseUp={() => {
              const selection = window.getSelection();
              const text = selection?.toString().trim() ?? "";
              const container = scrollRef.current;
              if (!text || !selection || selection.rangeCount === 0 || !container) {
                setSelectionPopover(null);
                return;
              }
              const range = selection.getRangeAt(0);
              if (!container.contains(range.commonAncestorContainer)) {
                setSelectionPopover(null);
                return;
              }
              // Walk up from the selection to find which page it's on.
              let node: Node | null = range.commonAncestorContainer;
              let pageEl: HTMLElement | null = null;
              while (node) {
                if (node instanceof HTMLElement && node.dataset.pageNumber) {
                  pageEl = node;
                  break;
                }
                node = node.parentNode;
              }
              if (!pageEl) {
                setSelectionPopover(null);
                return;
              }
              const rect = range.getBoundingClientRect();
              const containerRect = container.getBoundingClientRect();
              handleSelection(
                text,
                Number(pageEl.dataset.pageNumber),
                rect.left - containerRect.left + rect.width / 2 + container.scrollLeft,
                rect.top - containerRect.top + container.scrollTop
              );
            }}
          >
            <div className="mx-auto flex w-fit flex-col items-center gap-4">
              {Array.from({ length: numPages }, (_, i) => i + 1).map((pageNum) => (
                <PageView
                  key={pageNum}
                  pdf={pdf}
                  pageNumber={pageNum}
                  zoom={zoom}
                  rotation={rotation}
                  scrollRoot={scrollRef.current}
                  registerRef={(n, el) => {
                    if (el) pageElsRef.current.set(n, el);
                    else pageElsRef.current.delete(n);
                  }}
                  highlights={highlights}
                />
              ))}
            </div>

            {selectionPopover && (
              <div
                style={{
                  position: "absolute",
                  left: selectionPopover.x,
                  top: selectionPopover.y,
                  transform: "translate(-50%, calc(-100% - 8px))",
                  zIndex: 30,
                }}
                className="flex items-center gap-1 whitespace-nowrap rounded-md bg-neutral-900 p-1 shadow-lg"
              >
                <SelectionPill label="Explain Simply" onClick={() => handleAskAboutSelection("explain")} />
                <SelectionPill label="Summarize" onClick={() => handleAskAboutSelection("summarize")} />
                <SelectionPill label="Identify Risks" onClick={() => handleAskAboutSelection("risks")} />
                <SelectionPill label="Ask about this" onClick={() => handleAskAboutSelection("ask")} />
              </div>
            )}
          </div>
        )}
      </div>

      <style jsx global>{`
        .textLayer {
          position: absolute;
          inset: 0;
          overflow: hidden;
          line-height: 1;
          text-align: initial;
          -webkit-text-size-adjust: none;
          text-size-adjust: none;
          forced-color-adjust: none;
          transform-origin: 0 0;
          z-index: 2;
          --min-font-size: 1;
          --text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size));
          --min-font-size-inv: calc(1 / var(--min-font-size));
        }
        .textLayer span,
        .textLayer br {
          color: transparent;
          position: absolute;
          white-space: pre;
          cursor: text;
          transform-origin: 0% 0%;
          user-select: text;
        }
        .textLayer > :not(.markedContent),
        .textLayer .markedContent span:not(.markedContent) {
          --font-height: 0;
          font-size: calc(var(--text-scale-factor) * var(--font-height));
        }
        .textLayer .markedContent {
          display: contents;
        }
        .textLayer ::selection {
          background: rgba(59, 130, 246, 0.35);
        }
        .textLayer br::selection {
          background: transparent;
        }
        .textLayer .endOfContent {
          display: block;
          position: absolute;
          inset: 100% 0 0;
          z-index: -1;
          cursor: default;
          user-select: none;
        }
      `}</style>
    </div>
  );
}

// ---- one page in the continuous scroll column -----------------------------
// Fetches its own PDFPageProxy on mount, sizes itself immediately (so
// the scrollbar/layout doesn't jump around as pages render), and only
// actually renders its canvas + text layer + highlights once it comes
// near the viewport (IntersectionObserver with a lookahead margin) —
// otherwise a long document would render every page up front.
interface PageViewProps {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  zoom: number;
  rotation: number;
  scrollRoot: HTMLElement | null;
  registerRef: (pageNumber: number, el: HTMLDivElement | null) => void;
  highlights?: PageHighlight[];
}

function PageView({
  pdf,
  pageNumber,
  zoom,
  rotation,
  scrollRoot,
  registerRef,
  highlights,
}: PageViewProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const renderTaskRef = useRef<{ cancel: () => void; promise: Promise<any> } | null>(
    null
  );

  const [pageProxy, setPageProxy] = useState<PDFPageProxy | null>(null);
  const [inView, setInView] = useState(false);
  const [highlightRects, setHighlightRects] = useState<Rect[]>([]);

  // Fetch the page proxy once — cheap, pdf.js caches it internally.
  useEffect(() => {
    let cancelled = false;
    pdf.getPage(pageNumber).then((p) => {
      if (!cancelled) setPageProxy(p);
    });
    return () => {
      cancelled = true;
    };
  }, [pdf, pageNumber]);

  const viewport = useMemo(() => {
    if (!pageProxy) return null;
    return pageProxy.getViewport({ scale: zoom, rotation });
  }, [pageProxy, zoom, rotation]);

  // Lazy-render trigger: observe this page against the scroll container,
  // with a generous lookahead margin so scrolling feels instant.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el || !scrollRoot) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setInView(true);
        });
      },
      { root: scrollRoot, rootMargin: "800px 0px", threshold: 0.01 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [scrollRoot]);

  // Render the canvas once visible (and whenever zoom/rotation changes).
  useEffect(() => {
    if (!inView || !pageProxy || !viewport || !canvasRef.current) return;
    const canvas = canvasRef.current;

    (async () => {
      const prior = renderTaskRef.current;
      if (prior) {
        prior.cancel();
        try {
          await prior.promise;
        } catch {
          // expected: cancelled renders reject with RenderingCancelledException
        }
      }

      const outputScale = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const transform =
        outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined;

      const task = pageProxy.render({ canvas, canvasContext: ctx, viewport, transform });
      renderTaskRef.current = task;
      try {
        await task.promise;
      } catch (err: any) {
        if (err?.name !== "RenderingCancelledException") {
          console.error(`Failed to render page ${pageNumber}:`, err);
        }
      } finally {
        if (renderTaskRef.current === task) renderTaskRef.current = null;
      }
    })();
  }, [inView, pageProxy, viewport, pageNumber]);

  // Render the text layer once visible.
  useEffect(() => {
    if (!inView || !pageProxy || !viewport || !textLayerRef.current) return;
    let cancelled = false;
    const container = textLayerRef.current;
    container.style.setProperty("--scale-factor", String(viewport.scale));
    container.style.setProperty("--total-scale-factor", String(viewport.scale));
    renderTextLayer(pageProxy, container, viewport).catch((err) => {
      if (!cancelled) console.error(`Failed to render text layer for page ${pageNumber}:`, err);
    });
    return () => {
      cancelled = true;
    };
  }, [inView, pageProxy, viewport, pageNumber]);

  // Compute this page's highlight boxes (see PdfViewer's original notes
  // on the fraction -> PDF points -> viewport pixel conversion).
  useEffect(() => {
    const onThisPage = (highlights ?? []).filter((h) => h.page_num === pageNumber);
    if (!inView || !pageProxy || !viewport || onThisPage.length === 0) {
      setHighlightRects([]);
      return;
    }
    const [mx0, my0, mx1, my1] = pageProxy.view;
    const pageWidthPts = mx1 - mx0;
    const pageHeightPts = my1 - my0;

    const rects = onThisPage.map(({ bbox }) => {
      const pdfX0 = mx0 + bbox.x0 * pageWidthPts;
      const pdfX1 = mx0 + bbox.x1 * pageWidthPts;
      const pdfY0 = my0 + (1 - bbox.y1) * pageHeightPts;
      const pdfY1 = my0 + (1 - bbox.y0) * pageHeightPts;
      const [ax, ay] = viewport.convertToViewportPoint(pdfX0, pdfY0);
      const [bx, by] = viewport.convertToViewportPoint(pdfX1, pdfY1);
      return {
        x: Math.min(ax, bx),
        y: Math.min(ay, by),
        width: Math.abs(bx - ax),
        height: Math.abs(by - ay),
      };
    });
    setHighlightRects(rects);
  }, [inView, pageProxy, viewport, highlights, pageNumber]);

  // Fallback size (before the page proxy has loaded) so the column
  // doesn't jump around — assume a standard-ish page ratio at the
  // current zoom until we know the real dimensions.
  const fallbackWidth = 612 * zoom;
  const fallbackHeight = 792 * zoom;

  return (
    <div
      ref={(el) => {
        wrapperRef.current = el;
        registerRef(pageNumber, el);
      }}
      data-page-number={pageNumber}
      className="relative bg-white shadow-md"
      style={{
        width: viewport ? viewport.width : fallbackWidth,
        height: viewport ? viewport.height : fallbackHeight,
      }}
    >
      {viewport && (
        <>
          <canvas ref={canvasRef} />

          {highlightRects.map((r, idx) => (
            <div
              key={idx}
              className="pointer-events-none absolute rounded-sm border-2 border-amber-400 bg-amber-300/25 transition-opacity"
              style={{
                left: r.x,
                top: r.y,
                width: r.width,
                height: r.height,
                zIndex: 1,
              }}
            />
          ))}

          <div ref={textLayerRef} className="textLayer" />

          <span className="absolute bottom-1 right-1.5 rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-white">
            {pageNumber}
          </span>
        </>
      )}
    </div>
  );
}

// ---- tiny inline icons (avoids requiring lucide-react in the project) ----
function SelectionPill({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded px-2.5 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 transition-colors"
    >
      {label}
    </button>
  );
}

function PanelIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" />
      <line x1="5.5" y1="2.5" x2="5.5" y2="13.5" stroke="currentColor" />
    </svg>
  );
}
function ChevronLeftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M10 4l-4 4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function ChevronRightIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function RotateLeftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M7.5 2.5a5.5 5.5 0 105.2 3.7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M7.5 0.5v3.5h-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function RotateRightIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M8.5 2.5a5.5 5.5 0 10-5.2 3.7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M8.5 0.5v3.5h3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}