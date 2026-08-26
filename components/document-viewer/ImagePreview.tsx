"use client";

import { useEffect, useRef, useState } from "react";
import type { PageHighlight } from "./PdfViewer";

interface ImagePreviewProps {
  fileBytes: ArrayBuffer;
  mimeType: string;
  highlights?: PageHighlight[];
  className?: string;
}

/**
 * Preview pane for directly-uploaded images (png/jpg). PdfViewer is
 * PDF.js-only and can't render these at all — this is a plain <img>
 * instead, so there's no zoom/rotation/thumbnail rail here.
 *
 * What it DOES support: real citation highlighting. Direct image
 * uploads get genuine per-word OCR bounding boxes (see ocr.py's
 * extract_text_from_image), so clicking a chat/summary citation draws
 * the same amber rectangle PdfViewer draws for PDFs — just placed with
 * plain CSS percentages against the image's own box. Our bbox
 * convention (top-left origin, 0-1 fractions, y grows downward)
 * already matches how CSS positions things, so none of PdfViewer's
 * PDF.js bottom-up coordinate flip is needed here.
 *
 * Known gap: the text-selection 4-pill toolbar isn't wired up for
 * images (that needs a positioned, selectable text-layer overlay like
 * PdfViewer builds for PDFs — real work, not done here). Chat,
 * Summary, and Highlights all still work fully from the OCR'd text.
 */
export default function ImagePreview({
  fileBytes,
  mimeType,
  highlights,
  className,
}: ImagePreviewProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    const blob = new Blob([fileBytes], { type: mimeType || "image/png" });
    const url = URL.createObjectURL(blob);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [fileBytes, mimeType]);

  // Direct image uploads are always a single logical page (page_num=1
  // in documents.py), so every highlight that comes through belongs
  // to this one image — no per-page filtering needed like PdfViewer.
  const rects = highlights ?? [];

  if (!objectUrl) return null;

  return (
    <div className={`overflow-auto bg-neutral-950 ${className ?? ""}`}>
      <div className="flex items-center justify-center min-h-full p-6">
        <div className="relative inline-block shadow-md">
          <img
            ref={imgRef}
            src={objectUrl}
            alt="Uploaded document"
            className="block max-w-full h-auto select-none"
          />
          {rects.map((h, idx) => (
            <div
              key={idx}
              className="pointer-events-none absolute rounded-sm border-2 border-amber-400 bg-amber-300/25"
              style={{
                left: `${h.bbox.x0 * 100}%`,
                top: `${h.bbox.y0 * 100}%`,
                width: `${(h.bbox.x1 - h.bbox.x0) * 100}%`,
                height: `${(h.bbox.y1 - h.bbox.y0) * 100}%`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}