@'
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

/**
 * Lazily loads pdfjs-dist and configures its worker, exactly once.
 * Safe to call multiple times — subsequent calls reuse the same
 * in-flight/resolved promise.
 */
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

/**
 * Load a PDF from a URL (e.g. your document's file_url / a presigned
 * S3 link) or from raw bytes (e.g. straight after upload, before you've
 * persisted it anywhere — useful given store_original() is still a
 * stub).
 */
export async function loadPdf(
  source: string | ArrayBuffer
): Promise<PDFDocumentProxy> {
  const pdfjsLib = await getPdfjsLib();
  const loadingTask =
    typeof source === "string"
      ? pdfjsLib.getDocument({ url: source })
      : pdfjsLib.getDocument({ data: source });

  return loadingTask.promise;
}
'@ | Set-Content -Path .\pdf.ts -Encoding utf8