"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import PdfViewer, { type PageHighlight, type SelectionAction } from "@/components/document-viewer/PdfViewer";
import ImagePreview from "@/components/document-viewer/ImagePreview";
import UnsupportedPreview from "@/components/document-viewer/UnsupportedPreview";
import { useAuth } from "@/lib/AuthContext";
import {
  uploadDocument,
  sendChatMessage,
  summarizeDocument,
  getChatHistory,
  saveAnnotation,
  listAnnotations,
  deleteAnnotation,
  ApiError,
  type UploadDocumentResponse,
  type ChatHistoryTurn,
  type Citation,
  type DocumentSummary,
  type AnnotationRecord,
} from "@/lib/api";

/**
 * Workspace (v4 — real viewer + real upload + real chat)
 * ------------------------------------------------------------
 * Split-pane layout per SRS FR-02.3: left panel hosts the
 * Document Viewer, right panel hosts Chat / Summary / Highlights.
 *
 * Upload does two things at once on file select:
 *   1. Reads the file into memory client-side and hands it straight
 *      to <PdfViewer fileBytes={...}> so rendering doesn't wait on
 *      the network — instant feedback.
 *   2. POSTs the same file to POST /documents/upload, which runs
 *      OCR + chunking + embedding synchronously and returns
 *      { document_id, file_key, page_count, chunk_count, status }.
 *      document_id is what Step 6 chat is scoped to.
 *
 * Chat (Step 6) streams from POST /chat/{document_id} via SSE:
 *   - "citations" event arrives first with the chunk(s) — page_num +
 *     bbox — the answer will be grounded in
 *   - "token" events stream the answer text incrementally
 *   - "done" closes out the turn
 * See lib/api.ts (sendChatMessage) for the parsing.
 *
 * file_key from the upload response is NOT a usable URL yet —
 * store_original() in the backend is still a stub, so there's
 * nothing to fetch back. PdfViewer keeps using the in-memory bytes
 * until real storage exists.
 * ------------------------------------------------------------
 */

type RightTab = "chat" | "summary" | "highlights";
type IngestStatus = "idle" | "uploading" | "ready" | "error";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  streaming?: boolean;
}

const TABS: { id: RightTab; label: string }[] = [
  { id: "chat", label: "Chat" },
  { id: "summary", label: "Summary" },
  { id: "highlights", label: "Highlights" },
];

/** SelectionAction is defined once in PdfViewer.tsx (the file that owns
 * the floating toolbar and actually calls onAskAboutSelection) and
 * imported here, so the two files can never drift out of sync again.
 * Kept as a local alias so nothing else below has to be renamed. */
type SelectionPreset = SelectionAction;

/** Fixed prompts for the 3 auto-send pills. "ask" isn't listed here —
 * it leaves the chat input free-text for the user to fill in. */
const PRESET_PROMPTS: Record<Exclude<SelectionPreset, "ask">, string> = {
  explain: "Explain this passage simply, in plain language a beginner could follow.",
  summarize: "Summarize this selected passage concisely.",
  risks: "Identify any risks, obligations, deadlines, or red flags in this passage.",
};

const PRESET_LABELS: Record<SelectionPreset, string> = {
  ask: "Ask about this",
  explain: "Explain Simply",
  summarize: "Summarize Selection",
  risks: "Identify Risks",
};

/** One saved passage the user acted on via a selection pill — shown
 * in the Highlights tab. `annoId` is set once the backend confirms
 * the save (Step 9); until then, or if the save fails, the highlight
 * still shows locally with annoId left null. */
interface SavedHighlight {
  id: string;
  annoId: string | null;
  text: string;
  page: number;
  preset: SelectionPreset;
  createdAt: number;
}

const PRESET_KEYS: SelectionPreset[] = ["ask", "explain", "summarize", "risks"];

/** Recovers a saved highlight from a backend AnnotationRecord —
 * ai_notes carries the preset key as a plain string. Falls back to
 * "explain" for any older/unrecognized value so rendering never breaks. */
function highlightFromAnnotation(a: AnnotationRecord): SavedHighlight {
  const preset = PRESET_KEYS.includes(a.ai_notes as SelectionPreset)
    ? (a.ai_notes as SelectionPreset)
    : "explain";
  return {
    id: a.anno_id,
    annoId: a.anno_id,
    text: a.selected_text,
    page: a.page_num,
    preset,
    createdAt: new Date(a.created_at).getTime(),
  };
}

export default function WorkspacePage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  // Bounce to /login if there's no session — checked after the initial
  // sessionStorage restore in AuthProvider finishes (avoids redirecting
  // a refreshed page before the token's had a chance to load).
  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  const [activeTab, setActiveTab] = useState<RightTab>("chat");
  const [fileBytes, setFileBytes] = useState<ArrayBuffer | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileMimeType, setFileMimeType] = useState<string | null>(null);
  const [ingestStatus, setIngestStatus] = useState<IngestStatus>("idle");
  const [ingestResult, setIngestResult] =
    useState<UploadDocumentResponse | null>(null);
  const [ingestError, setIngestError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // --- chat state ---
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatStreaming, setChatStreaming] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const chatAbortRef = useRef<AbortController | null>(null);

  // Setting this jumps <PdfViewer> to a page when a citation chip is
  // clicked. PdfViewer's jump effect only fires when the value
  // changes, so clicking the same page chip twice in a row won't
  // re-scroll — acceptable for now.
  const [jumpToPage, setJumpToPage] = useState<number | undefined>(
    undefined
  );

  // The bbox(es) to draw over the document — set when a citation chip
  // is clicked, alongside jumpToPage. A single chip can carry more than
  // one chunk on the same page, so this is a list.
  const [activeHighlights, setActiveHighlights] = useState<PageHighlight[]>(
    []
  );

  // Step 8: set when the user selects text in the viewer and taps "Ask
  // about this" — the next chat message is scoped to just this passage
  // instead of the whole document. Cleared after that message sends.
  const [scopedSelection, setScopedSelection] = useState<{
    text: string;
    page: number;
  } | null>(null);

  // --- summary state (Step 7 frontend wiring) ---
  const [summaryStatus, setSummaryStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [summaryMessage, setSummaryMessage] = useState<string | null>(null);
  const [summaryProgress, setSummaryProgress] = useState<{
    completed: number;
    total: number;
  } | null>(null);
  const [summaryResult, setSummaryResult] = useState<DocumentSummary | null>(
    null
  );
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const summaryAbortRef = useRef<AbortController | null>(null);
  // Which document_id the current summary belongs to, so switching
  // documents doesn't show a stale summary under the new one.
  const summaryDocIdRef = useRef<string | null>(null);

  // --- highlights state (pairs with the 4-pill toolbar) ---
  const [savedHighlights, setSavedHighlights] = useState<SavedHighlight[]>(
    []
  );

  const handleFileSelected = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;

    // 1. Render immediately from the raw bytes, independent of the network call.
    const bytes = await file.arrayBuffer();
    setFileBytes(bytes);
    setFileName(file.name);
    setFileMimeType(file.type);

    // 2. Reset chat — a new document means a new conversation.
    chatAbortRef.current?.abort();
    setChatMessages([]);
    setChatError(null);
    setChatStreaming(false);
    setActiveHighlights([]);

    // Reset summary + saved highlights too — they belonged to the old document.
    summaryAbortRef.current?.abort();
    summaryDocIdRef.current = null;
    setSummaryStatus("idle");
    setSummaryMessage(null);
    setSummaryProgress(null);
    setSummaryResult(null);
    setSummaryError(null);
    setSavedHighlights([]);

    // 3. Kick off real ingestion in parallel.
    setIngestStatus("uploading");
    setIngestError(null);
    setIngestResult(null);

    try {
      const result = await uploadDocument(file);
      setIngestResult(result);
      setIngestStatus("ready");
      hydrateDocumentState(result.document_id);
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : "Couldn't reach the backend. Is uvicorn running on :8000?";
      setIngestError(message);
      setIngestStatus("error");
    }
  };

  // Step 9: loads any previously-saved chat turns and highlights for
  // this document_id. For a brand-new upload these will always come
  // back empty (each upload gets a fresh document_id — reopening a
  // past document isn't wired up yet), but this is what makes chat +
  // highlights durable once that gap closes. Failures here are
  // non-fatal — the workspace still works, just starts blank.
  const hydrateDocumentState = async (documentId: string) => {
    try {
      const history = await getChatHistory(documentId);
      if (history.length > 0) {
        setChatMessages(
          history.map((m) => ({
            role: m.role,
            content: m.content,
            citations: m.citations ?? undefined,
          }))
        );
      }
    } catch (err) {
      console.warn("Couldn't load chat history:", err);
    }

    try {
      const annotations = await listAnnotations(documentId);
      if (annotations.length > 0) {
        setSavedHighlights(annotations.map(highlightFromAnnotation));
      }
    } catch (err) {
      console.warn("Couldn't load saved highlights:", err);
    }
  };

  // Step 8/toolbar: fired by PdfViewer when the user selects text and
  // taps one of the 4 preset pills. "ask" just populates the scoped
  // selection and lets the user type their own question, same as
  // before. The other 3 pills save the passage to the Highlights tab
  // (Step 9: persisted to the backend Annotation table, with an
  // optimistic local entry shown immediately) and send a fixed prompt
  // through the same chat pipeline.
  const handleAskAboutSelection = (
    text: string,
    page: number,
    preset: SelectionPreset
  ) => {
    setActiveTab("chat");

    if (preset === "ask") {
      setScopedSelection({ text, page });
      return;
    }

    const tempId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setSavedHighlights((prev) => [
      { id: tempId, annoId: null, text, page, preset, createdAt: Date.now() },
      ...prev,
    ]);

    if (ingestResult) {
      saveAnnotation(ingestResult.document_id, {
        page_num: page,
        selected_text: text,
        ai_notes: preset,
      })
        .then((saved) => {
          setSavedHighlights((prev) =>
            prev.map((h) =>
              h.id === tempId ? { ...h, id: saved.anno_id, annoId: saved.anno_id } : h
            )
          );
        })
        .catch((err) => {
          // Non-fatal — the highlight still shows locally for this
          // session, it just won't survive a refresh.
          console.warn("Couldn't persist highlight:", err);
        });
    }

    handleSendChat(PRESET_PROMPTS[preset], { text, page });
  };

  /**
   * Sends a chat turn. Defaults to whatever's typed in the input box
   * and the current scopedSelection state, so the Send button and
   * Enter key can keep calling it with no arguments. The 3 auto-send
   * preset pills pass an explicit question + selection instead so
   * they don't depend on (or clobber) whatever the user was typing.
   */
  const handleSendChat = (
    questionOverride?: string,
    scopedOverride?: { text: string; page: number }
  ) => {
    const question = (questionOverride ?? chatInput).trim();
    if (!question || !ingestResult || chatStreaming) return;

    const history: ChatHistoryTurn[] = chatMessages
      .filter((m) => !m.streaming)
      .map((m) => ({ role: m.role, content: m.content }));

    setChatMessages((prev) => [
      ...prev,
      { role: "user", content: question },
      { role: "assistant", content: "", streaming: true },
    ]);
    if (questionOverride === undefined) setChatInput("");
    setChatError(null);
    setChatStreaming(true);

    const sendingScopedTo = scopedOverride ?? scopedSelection;
    setScopedSelection(null);

    chatAbortRef.current = sendChatMessage(
      ingestResult.document_id,
      question,
      history,
      {
        onCitations: (citations) => {
          setChatMessages((prev) => {
            const next = [...prev];
            next[next.length - 1] = { ...next[next.length - 1], citations };
            return next;
          });
        },
        onToken: (text) => {
          setChatMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            next[next.length - 1] = {
              ...last,
              content: last.content + text,
            };
            return next;
          });
        },
        onDone: () => {
          setChatMessages((prev) => {
            const next = [...prev];
            next[next.length - 1] = {
              ...next[next.length - 1],
              streaming: false,
            };
            return next;
          });
          setChatStreaming(false);
        },
        onError: (err) => {
          const message =
            err instanceof ApiError
              ? err.message
              : "Lost connection to the chat backend.";
          setChatError(message);
          setChatStreaming(false);
          // Drop the empty assistant bubble that was streaming.
          setChatMessages((prev) => prev.filter((m) => !m.streaming));
        },
      },
      sendingScopedTo ?? undefined
    );
  };

  // Fired when a citation chip is clicked: jump the viewer to that page
  // and light up every chunk box on it that this answer was grounded in.
  const handleCitationClick = (page: number, citations: Citation[]) => {
    setJumpToPage(page);
    setActiveHighlights(
      citations
        .filter((c) => c.page_num === page && c.bbox)
        .map((c) => ({ page_num: c.page_num, bbox: c.bbox! }))
    );
  };

  const handleChatKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendChat();
    }
  };

  // Step 7 frontend: kicks off POST /summary/{document_id}. Safe to
  // call again after a failure (retry) — it just restarts the stream.
  const handleGenerateSummary = () => {
    if (!ingestResult || summaryStatus === "loading") return;

    summaryAbortRef.current?.abort();
    summaryDocIdRef.current = ingestResult.document_id;
    setSummaryStatus("loading");
    setSummaryMessage("Starting…");
    setSummaryProgress(null);
    setSummaryResult(null);
    setSummaryError(null);

    summaryAbortRef.current = summarizeDocument(ingestResult.document_id, {
      onStatus: (message) => setSummaryMessage(message),
      onProgress: (completed, total) => setSummaryProgress({ completed, total }),
      onComplete: (summary) => {
        setSummaryResult(summary);
        setSummaryStatus("ready");
      },
      onError: (err) => {
        const message =
          err instanceof ApiError ? err.message : "Couldn't generate a summary.";
        setSummaryError(message);
        setSummaryStatus("error");
      },
    });
  };

  // Jumps the viewer to a saved highlight's page (no bbox stored for
  // free-text selections, so this just scrolls — it doesn't draw a box).
  const handleJumpToHighlight = (h: SavedHighlight) => {
    setJumpToPage(h.page);
    setActiveHighlights([]);
  };

  // Step 9: removes a saved highlight. Updates local state immediately;
  // if it was already persisted (annoId set) also deletes it on the
  // backend so it doesn't reappear on the next reload.
  const handleDeleteHighlight = (h: SavedHighlight) => {
    setSavedHighlights((prev) => prev.filter((x) => x.id !== h.id));
    if (h.annoId && ingestResult) {
      deleteAnnotation(ingestResult.document_id, h.annoId).catch((err) => {
        console.warn("Couldn't delete highlight on the backend:", err);
      });
    }
  };

  if (loading || !user) {
    return (
      <main className="min-h-screen bg-ink-950 text-paper-50 flex flex-col">
        <Navbar />
        <div className="flex-1 flex items-center justify-center">
          <p className="font-body text-sm text-slate-400">
            {loading ? "Loading…" : "Redirecting to login…"}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen md:h-screen bg-ink-950 text-paper-50 flex flex-col md:overflow-hidden">
      <Navbar />

      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 min-h-0 md:overflow-hidden">
        {/* Left panel — Document Viewer */}
        <section className="relative border-b md:border-b-0 md:border-r border-white/10 flex flex-col min-h-[50vh] md:min-h-0">
          <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between gap-3">
            <span className="font-mono text-xs tracking-widest text-slate-400 uppercase truncate">
              {fileName ?? "Document Viewer"}
            </span>
            <IngestStatusBadge status={ingestStatus} result={ingestResult} />
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.txt,.png,.jpg,.jpeg"
            className="hidden"
            onChange={handleFileSelected}
          />

          {ingestError && (
            <div className="px-6 py-2 bg-red-500/10 border-b border-red-500/20 text-red-300 text-xs font-body">
              Upload failed: {ingestError}
            </div>
          )}

          {fileBytes ? (
            <div className="flex-1 min-h-0">
              {fileMimeType === "application/pdf" ? (
                <PdfViewer
                  fileBytes={fileBytes}
                  jumpToPage={jumpToPage}
                  highlights={activeHighlights}
                  onAskAboutSelection={handleAskAboutSelection}
                  className="h-full"
                />
              ) : fileMimeType?.startsWith("image/") ? (
                <ImagePreview
                  fileBytes={fileBytes}
                  mimeType={fileMimeType}
                  highlights={activeHighlights}
                  className="h-full"
                />
              ) : (
                <UnsupportedPreview fileName={fileName} className="h-full" />
              )}
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center p-10">
              <div className="w-full max-w-sm aspect-3/4 rounded-lg bg-paper-50 shadow-page flex flex-col items-center justify-center gap-3 text-ink-950/40">
                <svg
                  width="40"
                  height="40"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <path d="M14 2v6h6" />
                </svg>
                <p className="font-body text-sm text-center px-8">
                  No document loaded yet — upload a PDF, DOCX, or image to get
                  started.
                </p>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="font-body text-sm font-medium rounded-md bg-highlight-400 text-ink-950
                             px-4 py-2 hover:bg-highlight-500 transition-colors mt-2"
                >
                  Upload document
                </button>
              </div>
            </div>
          )}
        </section>

        {/* Right panel — Chat / Summary / Highlights */}
        <section className="flex flex-col min-h-[50vh] md:min-h-0">
          <div className="px-6 border-b border-white/10 flex items-center gap-1">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`font-body text-sm px-4 py-3 border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? "border-highlight-400 text-paper-50"
                    : "border-transparent text-slate-400 hover:text-paper-50"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === "chat" && (
            <ChatPanel
              ready={ingestResult?.status === "ready"}
              chunkCount={ingestResult?.chunk_count}
              pageCount={ingestResult?.page_count}
              messages={chatMessages}
              input={chatInput}
              streaming={chatStreaming}
              error={chatError}
              onInputChange={setChatInput}
              onSend={handleSendChat}
              onKeyDown={handleChatKeyDown}
              onCitationClick={handleCitationClick}
              scopedSelection={scopedSelection}
              onClearScoped={() => setScopedSelection(null)}
            />
          )}

          {activeTab === "summary" && (
            <SummaryPanel
              ready={ingestResult?.status === "ready"}
              status={summaryStatus}
              message={summaryMessage}
              progress={summaryProgress}
              result={summaryResult}
              error={summaryError}
              onGenerate={handleGenerateSummary}
            />
          )}

          {activeTab === "highlights" && (
            <HighlightsPanel
              highlights={savedHighlights}
              onJump={handleJumpToHighlight}
              onDelete={handleDeleteHighlight}
            />
          )}
        </section>
      </div>
    </main>
  );
}

function IngestStatusBadge({
  status,
  result,
}: {
  status: IngestStatus;
  result: UploadDocumentResponse | null;
}) {
  if (status === "idle") {
    return (
      <span className="font-mono text-xs text-slate-600">25% – 500%</span>
    );
  }
  if (status === "uploading") {
    return (
      <span className="font-mono text-xs text-highlight-400 animate-pulse">
        Processing…
      </span>
    );
  }
  if (status === "error") {
    return <span className="font-mono text-xs text-red-400">Failed</span>;
  }
  return (
    <span className="font-mono text-xs text-emerald-400">
      {result ? `${result.chunk_count} chunks` : "Ready"}
    </span>
  );
}

function ChatPanel({
  ready,
  chunkCount,
  pageCount,
  messages,
  input,
  streaming,
  error,
  onInputChange,
  onSend,
  onKeyDown,
  onCitationClick,
  scopedSelection,
  onClearScoped,
}: {
  ready: boolean;
  chunkCount?: number;
  pageCount?: number;
  messages: ChatMessage[];
  input: string;
  streaming: boolean;
  error: string | null;
  onInputChange: (v: string) => void;
  onSend: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onCitationClick: (page: number, citations: Citation[]) => void;
  scopedSelection: { text: string; page: number } | null;
  onClearScoped: () => void;
}) {
  if (!ready) {
    return (
      <div className="flex-1 flex items-center justify-center p-10">
        <p className="font-body text-sm text-slate-400 text-center max-w-xs">
          Ask a question about your document once it's uploaded. Answers will
          cite the exact page they came from.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {messages.length === 0 ? (
        <div className="flex-1 flex items-center justify-center p-10">
          <p className="font-body text-sm text-slate-400 text-center max-w-xs">
            {chunkCount != null && pageCount != null
              ? `Ready — ${chunkCount} chunks indexed across ${pageCount} pages. Ask anything about this document.`
              : "Document indexed. Ask anything about it."}
          </p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-4">
          {messages.map((m, i) => (
            <div
              key={i}
              className={`flex ${
                m.role === "user" ? "justify-end" : "justify-start"
              }`}
            >
              <div
                className={`max-w-[85%] rounded-lg px-4 py-2 font-body text-sm whitespace-pre-wrap ${
                  m.role === "user"
                    ? "bg-highlight-400 text-ink-950"
                    : "bg-white/5 text-paper-50"
                }`}
              >
                {m.content || (m.streaming ? "…" : "")}
                {m.citations && m.citations.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {/* One chip per distinct page cited, even though the
                        answer may be grounded in several chunks on that
                        page — clicking it highlights all of them. */}
                    {Array.from(new Set(m.citations.map((c) => c.page_num)))
                      .sort((a, b) => a - b)
                      .map((p) => (
                        <button
                          key={p}
                          onClick={() => onCitationClick(p, m.citations!)}
                          className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-black/20 text-slate-300
                                     hover:bg-black/40 hover:text-paper-50 transition-colors cursor-pointer"
                          title={`Jump to page ${p}`}
                        >
                          p. {p}
                        </button>
                      ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="px-6 py-2 bg-red-500/10 border-t border-red-500/20 text-red-300 text-xs font-body">
          {error}
        </div>
      )}

      {scopedSelection && (
        <div className="mx-4 mt-2 px-3 py-2 rounded-md bg-highlight-400/10 border border-highlight-400/30 flex items-start justify-between gap-2">
          <p className="font-body text-xs text-slate-300">
            <span className="text-highlight-400 font-medium">
              Asking about this passage (p. {scopedSelection.page}):
            </span>{" "}
            "
            {scopedSelection.text.length > 140
              ? scopedSelection.text.slice(0, 140) + "…"
              : scopedSelection.text}
            "
          </p>
          <button
            onClick={onClearScoped}
            className="font-mono text-xs text-slate-400 hover:text-paper-50 shrink-0"
            title="Ask about the whole document instead"
          >
            ✕
          </button>
        </div>
      )}

      <div className="border-t border-white/10 p-4 flex items-end gap-2">
        <textarea
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={
            scopedSelection
              ? "Ask about the highlighted passage…"
              : "Ask about this document…"
          }
          rows={1}
          className="flex-1 resize-none rounded-md bg-white/5 border border-white/10 px-3 py-2
                     font-body text-sm text-paper-50 placeholder:text-slate-500
                     focus:outline-none focus:ring-1 focus:ring-highlight-400"
        />
        <button
          onClick={onSend}
          disabled={streaming || !input.trim()}
          className="font-body text-sm font-medium rounded-md bg-highlight-400 text-ink-950
                     px-4 py-2 hover:bg-highlight-500 transition-colors
                     disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {streaming ? "…" : "Send"}
        </button>
      </div>
    </div>
  );
}

function SummaryPanel({
  ready,
  status,
  message,
  progress,
  result,
  error,
  onGenerate,
}: {
  ready: boolean;
  status: "idle" | "loading" | "ready" | "error";
  message: string | null;
  progress: { completed: number; total: number } | null;
  result: DocumentSummary | null;
  error: string | null;
  onGenerate: () => void;
}) {
  if (!ready) {
    return (
      <div className="flex-1 flex items-center justify-center p-10">
        <p className="font-body text-sm text-slate-400 text-center max-w-xs">
          An executive summary and key takeaways will appear here once your
          document finishes uploading.
        </p>
      </div>
    );
  }

  if (status === "idle") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 p-10">
        <p className="font-body text-sm text-slate-400 text-center max-w-xs">
          Generate an executive summary, key points, and named entities for
          this document.
        </p>
        <button
          onClick={onGenerate}
          className="font-body text-sm font-medium rounded-md bg-highlight-400 text-ink-950
                     px-4 py-2 hover:bg-highlight-500 transition-colors"
        >
          Generate Summary
        </button>
      </div>
    );
  }

  if (status === "loading") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 p-10">
        <span className="font-mono text-xs text-highlight-400 animate-pulse">
          {message ?? "Working…"}
        </span>
        {progress && (
          <span className="font-mono text-xs text-slate-500">
            {progress.completed} / {progress.total} section(s)
          </span>
        )}
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 p-10">
        <p className="font-body text-sm text-red-300 text-center max-w-xs">
          {error ?? "Couldn't generate a summary."}
        </p>
        <button
          onClick={onGenerate}
          className="font-body text-sm font-medium rounded-md bg-white/10 text-paper-50
                     px-4 py-2 hover:bg-white/20 transition-colors"
        >
          Try again
        </button>
      </div>
    );
  }

  // status === "ready"
  if (!result) return null;
  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-6">
      <div>
        <h3 className="font-mono text-xs tracking-widest text-slate-400 uppercase mb-2">
          Overview
        </h3>
        <p className="font-body text-sm text-paper-50 leading-relaxed">
          {result.overview}
        </p>
      </div>

      {result.key_points.length > 0 && (
        <div>
          <h3 className="font-mono text-xs tracking-widest text-slate-400 uppercase mb-2">
            Key Points
          </h3>
          <ul className="space-y-1.5">
            {result.key_points.map((point, i) => (
              <li
                key={i}
                className="font-body text-sm text-paper-50 leading-relaxed flex gap-2"
              >
                <span className="text-highlight-400 shrink-0">•</span>
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.entities.length > 0 && (
        <div>
          <h3 className="font-mono text-xs tracking-widest text-slate-400 uppercase mb-2">
            Entities
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {result.entities.map((entity, i) => (
              <span
                key={i}
                className="font-mono text-xs px-2 py-1 rounded bg-white/5 text-slate-300"
              >
                {entity}
              </span>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={onGenerate}
        className="font-body text-xs text-slate-400 hover:text-paper-50 transition-colors"
      >
        Regenerate summary
      </button>
    </div>
  );
}

function HighlightsPanel({
  highlights,
  onJump,
  onDelete,
}: {
  highlights: SavedHighlight[];
  onJump: (h: SavedHighlight) => void;
  onDelete: (h: SavedHighlight) => void;
}) {
  if (highlights.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-10">
        <p className="font-body text-sm text-slate-400 text-center max-w-xs">
          Select text in the document and tap "Explain Simply," "Summarize
          Selection," or "Identify Risks" to save a highlight here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-2">
      {highlights.map((h) => (
        <div
          key={h.id}
          className="group relative w-full text-left rounded-md bg-white/5 hover:bg-white/10 transition-colors p-3"
        >
          <button onClick={() => onJump(h)} className="w-full text-left">
            <div className="flex items-center justify-between gap-2 mb-1.5 pr-5">
              <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-highlight-400/20 text-highlight-400 uppercase tracking-wide">
                {PRESET_LABELS[h.preset]}
              </span>
              <span className="font-mono text-[10px] text-slate-500">
                p. {h.page}
              </span>
            </div>
            <p className="font-body text-xs text-slate-300 leading-relaxed line-clamp-3">
              {h.text}
            </p>
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(h);
            }}
            title="Remove highlight"
            className="absolute top-2.5 right-2.5 font-mono text-xs text-slate-500 hover:text-red-300
                       opacity-0 group-hover:opacity-100 transition-opacity"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}