// lib/pdf.ts
//
// Central place to configure pdfjs-dist for use in a Next.js app-router
// project. The import itself is lazy (dynamic import(), not a static
// top-level import) because pdfjs-dist touches DOMMatrix at module-load
// time, which doesn't exist during Next.js's server-side module
// evaluation of client components. A static import crashes SSR with
// "DOMMatrix is not defined" even inside a "use client" file.
//
// npm install pdfjs-dist

import type * as PdfjsLibType from "pdfjs-dist";

export type PDFDocumentProxy = PdfjsLibType.PDFDocumentProxy;
export type PDFPageProxy = PdfjsLibType.PDFPageProxy;

let pdfjsLibPromise: Promise<typeof PdfjsLibType> | null = null;

function getPdfjsLib(): Promise<typeof PdfjsLibType> {
  if (typeof window === "undefined") {
    return Promise.reject(
      new Error("pdfjs-dist can only be loaded in the browser")
    );
  }
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import("pdfjs-dist").then((pdfjsLib) => {
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
      return pdfjsLib;
    });
  }
  return pdfjsLibPromise;
}

export async function loadPdf(
  source: string | ArrayBuffer
): Promise<PDFDocumentProxy> {
  const pdfjsLib = await getPdfjsLib();
  const loadingTask =
    typeof source === "string"
      ? pdfjsLib.getDocument({ url: source })
      : pdfjsLib.getDocument({ data: source.slice(0) });

  return loadingTask.promise;
}

/**
 * Renders pdf.js's TextLayer (a DOM layer of positioned, transparent
 * <span>s matching the glyphs on the canvas) into `container`, so the
 * browser's native text selection works over the rendered page —
 * needed for Step 8's "select text, ask about it" flow.
 *
 * Caller is responsible for setting the --scale-factor and
 * --total-scale-factor CSS custom properties on `container` before
 * calling this (see PdfViewer.tsx) — the TextLayer's own calc()
 * expressions depend on them and it does not set them itself.
 */
export async function renderTextLayer(
  page: PDFPageProxy,
  container: HTMLDivElement,
  viewport: PdfjsLibType.PageViewport
): Promise<void> {
  const pdfjsLib = await getPdfjsLib();
  container.replaceChildren();
  const textLayer = new pdfjsLib.TextLayer({
    textContentSource: page.streamTextContent(),
    container,
    viewport,
  });
  await textLayer.render();
}