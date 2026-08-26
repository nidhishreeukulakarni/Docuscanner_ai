interface UnsupportedPreviewProps {
  fileName: string | null;
  className?: string;
}

/**
 * Shown for formats that have real backend support (chat/summary/
 * search all work) but no side-by-side visual preview — currently
 * .docx and .txt, since neither has page/layout geometry to render
 * (see text_extract.py). Deliberately not routed through PdfViewer,
 * which would otherwise show a misleading "corrupted or unsupported"
 * error for a file that's actually fine.
 */
export default function UnsupportedPreview({
  fileName,
  className,
}: UnsupportedPreviewProps) {
  return (
    <div className={`flex items-center justify-center p-10 ${className ?? ""}`}>
      <div className="max-w-sm text-center space-y-2">
        <p className="font-body text-sm text-slate-300">
          No visual preview is available for {fileName ?? "this file"} yet.
        </p>
        <p className="font-body text-xs text-slate-500">
          Chat, Summary, and Highlights below all work fully from the
          extracted text — only the side-by-side page preview isn&apos;t
          built for this format.
        </p>
      </div>
    </div>
  );
}