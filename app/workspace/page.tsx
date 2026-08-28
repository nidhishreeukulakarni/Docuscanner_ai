"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import Navbar from "@/components/Navbar";
import PdfViewer, { type PageHighlight, type SelectionAction } from "@/components/document-viewer/PdfViewer";
import { useAuth } from "@/lib/AuthContext";
import {
  uploadDocument,
  sendChatMessage,
  sendMultiDocChatMessage,
  summarizeDocument,
  getChatHistory,
  getMultiDocChatHistory,
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
import {
  downloadMarkdown,
  copySummaryToClipboard,
  exportSummaryAsPdf,
} from "@/lib/exportSummary";

type RightTab = "chat" | "summary" | "highlights";
type IngestStatus = "idle" | "uploading" | "ready" | "error";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  streaming?: boolean;
}

interface OpenDocument {
  id: string;
  title: string;
  fileBytes: ArrayBuffer;
  pageCount: number;
  chunkCount: number;
}

type ChatScope = "single" | "all";

const TABS: { id: RightTab; label: string }[] = [
  { id: "chat", label: "Chat" },
  { id: "summary", label: "Summary" },
  { id: "highlights", label: "Highlights" },
];

type SelectionPreset = SelectionAction;

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

interface SavedHighlight {
  id: string;
  annoId: string | null;
  text: string;
  page: number;
  preset: SelectionPreset;
  createdAt: number;
}

const PRESET_KEYS: SelectionPreset[] = ["ask", "explain", "summarize", "risks"];

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

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  const [activeTab, setActiveTab] = useState<RightTab>("chat");

  const [documents, setDocuments] = useState<OpenDocument[]>([]);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const activeDoc = documents.find((d) => d.id === activeDocId) ?? null;
  const fileBytes = activeDoc?.fileBytes ?? null;
  const fileName = activeDoc?.title ?? null;
  const ingestResult: UploadDocumentResponse | null = activeDoc
    ? {
        document_id: activeDoc.id,
        file_key: "",
        page_count: activeDoc.pageCount,
        chunk_count: activeDoc.chunkCount,
        status: "ready",
      }
    : null;

  const [ingestStatus, setIngestStatus] = useState<IngestStatus>("idle");
  const [ingestError, setIngestError] = useState<string | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatStreaming, setChatStreaming] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const chatAbortRef = useRef<AbortController | null>(null);
  const [chatScope, setChatScope] = useState<ChatScope>("single");

  const [jumpToPage, setJumpToPage] = useState<number | undefined>(
    undefined
  );

  const [activeHighlights, setActiveHighlights] = useState<PageHighlight[]>(
    []
  );

  const [scopedSelection, setScopedSelection] = useState<{
    text: string;
    page: number;
  } | null>(null);

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
  const summaryDocIdRef = useRef<string | null>(null);

  const [savedHighlights, setSavedHighlights] = useState<SavedHighlight[]>(
    []
  );

  const handleFileSelected = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    await processFile(file);
  };

  const processFile = async (file: File) => {
    if (chatScope === "single") {
      chatAbortRef.current?.abort();
      setChatMessages([]);
      setChatError(null);
      setChatStreaming(false);
    }
    setActiveHighlights([]);

    summaryAbortRef.current?.abort();
    summaryDocIdRef.current = null;
    setSummaryStatus("idle");
    setSummaryMessage(null);
    setSummaryProgress(null);
    setSummaryResult(null);
    setSummaryError(null);
    setSavedHighlights([]);

    setActiveDocId(null);
    setIngestStatus("uploading");
    setIngestError(null);

    try {
      const bytes = await file.arrayBuffer();
      const result = await uploadDocument(file);
      const opened: OpenDocument = {
        id: result.document_id,
        title: file.name,
        fileBytes: bytes,
        pageCount: result.page_count,
        chunkCount: result.chunk_count,
      };
      setDocuments((prev) => [...prev, opened]);
      setActiveDocId(opened.id);
      setIngestStatus("ready");
      hydrateDocumentState(result.document_id, { loadChatHistory: chatScope === "single" });
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : "Couldn't reach the backend. Is uvicorn running on :8000?";
      setIngestError(message);
      setIngestStatus("error");
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!isDraggingFile) setIsDraggingFile(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.currentTarget === e.target) setIsDraggingFile(false);
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingFile(false);
    const file = e.dataTransfer.files?.[0];
    if (file) await processFile(file);
  };

  const handleSwitchDocument = (docId: string) => {
    if (docId === activeDocId) return;

    summaryAbortRef.current?.abort();
    setActiveHighlights([]);
    summaryDocIdRef.current = null;
    setSummaryStatus("idle");
    setSummaryMessage(null);
    setSummaryProgress(null);
    setSummaryResult(null);
    setSummaryError(null);
    setSavedHighlights([]);
    setIngestStatus("ready");
    setIngestError(null);

    if (chatScope === "single") {
      chatAbortRef.current?.abort();
      setChatMessages([]);
      setChatError(null);
      setChatStreaming(false);
    }

    setActiveDocId(docId);
    hydrateDocumentState(docId, { loadChatHistory: chatScope === "single" });
  };

  const handleRemoveDocument = (docId: string) => {
    const remaining = documents.filter((d) => d.id !== docId);
    setDocuments(remaining);

    if (docId !== activeDocId) return;

    summaryAbortRef.current?.abort();
    setActiveHighlights([]);
    summaryDocIdRef.current = null;
    setSummaryStatus("idle");
    setSummaryMessage(null);
    setSummaryProgress(null);
    setSummaryResult(null);
    setSummaryError(null);
    setSavedHighlights([]);

    if (chatScope === "single") {
      chatAbortRef.current?.abort();
      setChatMessages([]);
      setChatError(null);
      setChatStreaming(false);
    }

    if (remaining.length > 0) {
      const next = remaining[remaining.length - 1];
      setActiveDocId(next.id);
      setIngestStatus("ready");
      setIngestError(null);
      if (chatScope === "single") {
        hydrateDocumentState(next.id, { loadChatHistory: true });
      }
    } else {
      setActiveDocId(null);
      setIngestStatus("idle");
      setIngestError(null);
    }
  };

  const hydrateDocumentState = async (
    documentId: string,
    opts: { loadChatHistory?: boolean } = {}
  ) => {
    if (opts.loadChatHistory ?? true) {
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
          console.warn("Couldn't persist highlight:", err);
        });
    }

    handleSendChat(PRESET_PROMPTS[preset], { text, page });
  };

  const handleChatScopeChange = (scope: ChatScope) => {
    if (scope === chatScope) return;
    chatAbortRef.current?.abort();
    setChatStreaming(false);
    setChatError(null);
    setScopedSelection(null);
    setChatScope(scope);
    setChatMessages([]);

    if (scope === "all") {
      getMultiDocChatHistory()
        .then((history) => {
          if (history.length > 0) {
            setChatMessages(
              history.map((m) => ({
                role: m.role,
                content: m.content,
                citations: m.citations ?? undefined,
              }))
            );
          }
        })
        .catch((err) => console.warn("Couldn't load multi-doc chat history:", err));
    } else if (activeDocId) {
      hydrateDocumentState(activeDocId, { loadChatHistory: true });
    }
  };

  const handleSendChat = (
    questionOverride?: string,
    scopedOverride?: { text: string; page: number }
  ) => {
    const question = (questionOverride ?? chatInput).trim();
    const usingAllDocsScope = chatScope === "all" && !scopedOverride && !scopedSelection;
    if (!question || chatStreaming) return;
    if (!usingAllDocsScope && !ingestResult) return;

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

    const handlers = {
      onCitations: (citations: Citation[]) => {
        setChatMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = { ...next[next.length - 1], citations };
          return next;
        });
      },
      onToken: (text: string) => {
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
      onError: (err: ApiError | Error) => {
        const message =
          err instanceof ApiError
            ? err.message
            : "Lost connection to the chat backend.";
        setChatError(message);
        setChatStreaming(false);
        setChatMessages((prev) => prev.filter((m) => !m.streaming));
      },
    };

    if (usingAllDocsScope) {
      chatAbortRef.current = sendMultiDocChatMessage(question, history, handlers);
    } else {
      chatAbortRef.current = sendChatMessage(
        ingestResult!.document_id,
        question,
        history,
        handlers,
        sendingScopedTo ?? undefined
      );
    }
  };

  const handleCitationClick = (
    page: number,
    citations: Citation[],
    docId?: string
  ) => {
    if (docId && docId !== activeDocId) {
      handleSwitchDocument(docId);
    }
    setJumpToPage(page);
    setActiveHighlights(
      citations
        .filter(
          (c) => c.page_num === page && c.bbox && (!docId || c.doc_id === docId)
        )
        .map((c) => ({ page_num: c.page_num, bbox: c.bbox! }))
    );
  };

  const handleChatKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendChat();
    }
  };

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

  const handleJumpToHighlight = (h: SavedHighlight) => {
    setJumpToPage(h.page);
    setActiveHighlights([]);
  };

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
      <main className="min-h-screen bg-[var(--bg)] text-[var(--text)] flex flex-col">
        <Navbar />
        <div className="flex-1 flex items-center justify-center">
          <p className="font-body text-sm text-[var(--text-muted)]">
            {loading ? "Loading…" : "Redirecting to login…"}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen md:h-screen bg-[var(--bg)] text-[var(--text)] flex flex-col md:overflow-hidden">
      <Navbar />

      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 min-h-0 md:overflow-hidden">
        {/* Left panel — Document Viewer */}
        <section
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`relative border-b md:border-b-0 md:border-r border-[var(--border-subtle)] flex flex-col min-h-[50vh] md:min-h-0 transition-colors ${
            isDraggingFile ? "bg-[var(--accent)]/5 ring-2 ring-inset ring-[var(--accent)]/40" : ""
          }`}
        >
          {isDraggingFile && (
            <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none bg-[var(--bg)]/60 backdrop-blur-[1px]">
              <p className="font-body text-sm text-[var(--accent)] border border-[var(--accent)]/40 rounded-md px-4 py-2 bg-[var(--bg)]/80">
                Drop to upload
              </p>
            </div>
          )}

          <div className="px-6 py-4 border-b border-[var(--border-subtle)] flex items-center justify-between gap-3">
            <span className="font-mono text-xs tracking-widest text-[var(--text-muted)] uppercase truncate">
              {fileName ?? "Document Viewer"}
            </span>
            <IngestStatusBadge status={ingestStatus} result={ingestResult} />
          </div>

          {documents.length > 0 && (
            <div className="px-4 py-2 border-b border-[var(--border-subtle)] flex items-center gap-1.5 overflow-x-auto">
              {documents.map((doc) => (
                <div
                  key={doc.id}
                  className={`group shrink-0 flex items-center rounded-full border max-w-[180px]
                              transition-all duration-200 ease-out hover:scale-[1.03] ${
                    doc.id === activeDocId
                      ? "bg-[var(--accent)]/15 border-[var(--accent)]/40 text-[var(--accent)]"
                      : "bg-[var(--surface-2)] border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--border-subtle)]"
                  }`}
                >
                  <button
                    onClick={() => handleSwitchDocument(doc.id)}
                    title={doc.title}
                    className="font-mono text-[11px] pl-2.5 py-1 truncate"
                  >
                    {doc.title}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveDocument(doc.id);
                    }}
                    title="Remove document"
                    aria-label={`Remove ${doc.title}`}
                    className="shrink-0 pl-1 pr-2 py-1 font-mono text-[11px] leading-none
                               opacity-0 group-hover:opacity-100 hover:text-red-300
                               hover:scale-125 active:scale-90 transition-all"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                onClick={() => fileInputRef.current?.click()}
                title="Upload another document"
                disabled={ingestStatus === "uploading"}
                className="shrink-0 font-mono text-[11px] px-2.5 py-1 rounded-full border border-dashed
                           border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--border-subtle)]
                           hover:scale-[1.05] active:scale-[0.95] transition-all disabled:opacity-40
                           disabled:hover:scale-100"
              >
                + Add
              </button>
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
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
              <PdfViewer
                fileBytes={fileBytes}
                jumpToPage={jumpToPage}
                highlights={activeHighlights}
                onAskAboutSelection={handleAskAboutSelection}
                className="h-full"
              />
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
                  No document loaded yet — drag and drop a PDF, DOCX, or
                  image here, or upload one.
                </p>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="font-body text-sm font-medium rounded-md bg-highlight-400 text-ink-950
                             px-4 py-2 hover:bg-highlight-500 hover:scale-[1.03] active:scale-[0.97]
                             transition-all mt-2"
                >
                  Upload document
                </button>
              </div>
            </div>
          )}
        </section>

        {/* Right panel — Chat / Summary / Highlights */}
        <section className="flex flex-col min-h-[50vh] md:min-h-0">
          <div className="px-6 border-b border-[var(--border-subtle)] flex items-center gap-1">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`font-body text-sm px-4 py-3 border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? "border-[var(--accent)] text-[var(--text)]"
                    : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)]"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === "chat" && (
            <ChatPanel
              ready={
                chatScope === "all"
                  ? documents.length > 0
                  : ingestResult?.status === "ready"
              }
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
              chatScope={chatScope}
              onChatScopeChange={handleChatScopeChange}
              multiDocAvailable={documents.length > 1}
              documentCount={documents.length}
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
              documentTitle={fileName ?? "Document"}
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
      <span className="font-mono text-xs text-[var(--text-muted)]">25% – 500%</span>
    );
  }
  if (status === "uploading") {
    return (
      <span className="font-mono text-xs text-[var(--accent)] animate-pulse">
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
  chatScope,
  onChatScopeChange,
  multiDocAvailable,
  documentCount,
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
  onCitationClick: (page: number, citations: Citation[], docId?: string) => void;
  scopedSelection: { text: string; page: number } | null;
  onClearScoped: () => void;
  chatScope: ChatScope;
  onChatScopeChange: (scope: ChatScope) => void;
  multiDocAvailable: boolean;
  documentCount: number;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const messageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const userQuestions = messages
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => m.role === "user");

  const jumpToMessage = (i: number) => {
    setShowHistory(false);
    messageRefs.current[i]?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const scopeToggle = documentCount > 0 && (
    <div className="px-4 pt-3 pb-1 flex items-center justify-between gap-1.5">
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => onChatScopeChange("single")}
          className={`font-mono text-[11px] px-2.5 py-1 rounded-full border transition-all
                      hover:scale-[1.04] active:scale-[0.96] ${
            chatScope === "single"
              ? "bg-[var(--accent)]/15 border-[var(--accent)]/40 text-[var(--accent)]"
              : "bg-[var(--surface-2)] border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text)]"
          }`}
        >
          This document
        </button>
        <button
          onClick={() => onChatScopeChange("all")}
          title={
            multiDocAvailable
              ? undefined
              : "Upload another document to get more out of this mode"
          }
          className={`font-mono text-[11px] px-2.5 py-1 rounded-full border transition-all
                      hover:scale-[1.04] active:scale-[0.96] ${
            chatScope === "all"
              ? "bg-[var(--accent)]/15 border-[var(--accent)]/40 text-[var(--accent)]"
              : "bg-[var(--surface-2)] border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text)]"
          }`}
        >
          All documents{documentCount > 0 ? ` (${documentCount})` : ""}
        </button>
      </div>

      {messages.length > 0 && (
        <button
          onClick={() => setShowHistory((v) => !v)}
          title="Past questions in this thread"
          className={`shrink-0 inline-flex items-center gap-1 font-mono text-[11px] px-2.5 py-1
                      rounded-full border transition-all hover:scale-[1.04] active:scale-[0.96] ${
            showHistory
              ? "bg-[var(--accent)]/15 border-[var(--accent)]/40 text-[var(--accent)]"
              : "bg-[var(--surface-2)] border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text)]"
          }`}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 3" />
          </svg>
          History
        </button>
      )}
    </div>
  );

  if (!ready) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        {scopeToggle}
        <div className="flex-1 flex items-center justify-center p-10">
          <p className="font-body text-sm text-[var(--text-muted)] text-center max-w-xs">
            Ask a question about your document once it's uploaded. Answers will
            cite the exact page they came from.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {scopeToggle}
      <div className="relative flex-1 flex flex-col min-h-0">
        {showHistory && (
          <div className="absolute inset-x-4 top-2 z-20 max-h-72 overflow-y-auto
                           rounded-md border border-[var(--border-subtle)] bg-[var(--surface)] shadow-page">
            <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-subtle)]">
              <span className="font-mono text-[10px] tracking-widest text-[var(--text-muted)] uppercase">
                Past questions
              </span>
              <button
                onClick={() => setShowHistory(false)}
                className="font-mono text-xs text-[var(--text-muted)] hover:text-[var(--text)]
                           hover:scale-125 active:scale-90 transition-all"
                aria-label="Close history"
              >
                ✕
              </button>
            </div>
            {userQuestions.length === 0 ? (
              <p className="font-body text-xs text-[var(--text-muted)] px-3 py-3">
                No questions yet — ask something to start building history.
              </p>
            ) : (
              userQuestions.map(({ m, i }) => (
                <button
                  key={i}
                  onClick={() => jumpToMessage(i)}
                  className="block w-full text-left font-body text-xs text-[var(--text-muted)] hover:bg-[var(--surface-2)]
                             px-3 py-2 border-b border-[var(--border-subtle)] last:border-b-0 truncate"
                >
                  {m.content}
                </button>
              ))
            )}
          </div>
        )}
      {messages.length === 0 ? (
        <div className="flex-1 flex items-center justify-center p-10">
          <p className="font-body text-sm text-[var(--text-muted)] text-center max-w-xs">
            {chatScope === "all"
              ? `Searching across ${documentCount} document${documentCount === 1 ? "" : "s"}. Ask anything — answers will say which document they came from.`
              : chunkCount != null && pageCount != null
              ? `Ready — ${chunkCount} chunks indexed across ${pageCount} pages. Ask anything about this document.`
              : "Document indexed. Ask anything about it."}
          </p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-4">
          {messages.map((m, i) => (
            <div
              key={i}
              ref={(el) => {
                messageRefs.current[i] = el;
              }}
              className={`flex ${
                m.role === "user" ? "justify-end" : "justify-start"
              }`}
            >
              <div
                className={`max-w-[85%] rounded-lg px-4 py-2 font-body text-sm ${
                  m.role === "user"
                    ? "bg-highlight-400 text-ink-950 whitespace-pre-wrap"
                    : "bg-[var(--surface-2)] text-[var(--text)]"
                }`}
              >
                {m.role === "assistant" ? (
                  m.content ? (
                    <div
                      className="prose prose-sm prose-invert max-w-none
                                 prose-p:my-2 prose-p:leading-relaxed
                                 prose-headings:font-display prose-headings:mt-3 prose-headings:mb-1.5
                                 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5
                                 prose-strong:text-[var(--text)] prose-strong:font-semibold
                                 prose-code:text-[var(--accent)] prose-code:before:content-none prose-code:after:content-none
                                 prose-pre:bg-black/30 prose-pre:my-2
                                 prose-a:text-[var(--accent)] prose-blockquote:border-[var(--accent)]/40"
                    >
                      <ReactMarkdown>{m.content}</ReactMarkdown>
                    </div>
                  ) : m.streaming ? (
                    <span className="text-[var(--text-muted)]">…</span>
                  ) : null
                ) : (
                  m.content
                )}
                {m.citations && m.citations.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {Array.from(
                      new Map(
                        m.citations.map((c) => [`${c.doc_id ?? ""}::${c.page_num}`, c])
                      ).values()
                    )
                      .sort((a, b) => a.page_num - b.page_num)
                      .map((c) => (
                        <button
                          key={`${c.doc_id ?? ""}-${c.page_num}`}
                          onClick={() => onCitationClick(c.page_num, m.citations!, c.doc_id)}
                          className="inline-flex items-center gap-1 font-mono text-[10px] leading-none
                                     px-2 py-1 rounded-full bg-[var(--accent)]/10 text-[var(--accent)]
                                     border border-[var(--accent)]/30
                                     hover:bg-[var(--accent)]/20 hover:border-[var(--accent)]/50
                                     hover:scale-[1.05] active:scale-[0.95]
                                     transition-all cursor-pointer max-w-[180px]"
                          title={
                            c.doc_title
                              ? `${c.doc_title} — jump to page ${c.page_num}`
                              : `Jump to page ${c.page_num}`
                          }
                        >
                          <svg
                            width="9"
                            height="9"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            className="shrink-0"
                          >
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <path d="M14 2v6h6" />
                          </svg>
                          {c.doc_title && (
                            <span className="truncate">{c.doc_title}, </span>
                          )}
                          p.&nbsp;{c.page_num}
                        </button>
                      ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      </div>

      {error && (
        <div className="px-6 py-2 bg-red-500/10 border-t border-red-500/20 text-red-300 text-xs font-body">
          {error}
        </div>
      )}

      {scopedSelection && (
        <div className="mx-4 mt-2 px-3 py-2 rounded-md bg-[var(--accent)]/10 border border-[var(--accent)]/30 flex items-start justify-between gap-2">
          <p className="font-body text-xs text-[var(--text-muted)]">
            <span className="text-[var(--accent)] font-medium">
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
            className="font-mono text-xs text-[var(--text-muted)] hover:text-[var(--text)] shrink-0"
            title="Ask about the whole document instead"
          >
            ✕
          </button>
        </div>
      )}

      <div className="border-t border-[var(--border-subtle)] p-4 flex items-end gap-2">
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
          className="flex-1 resize-none rounded-md bg-[var(--surface-2)] border border-[var(--border-subtle)] px-3 py-2
                     font-body text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]
                     focus:outline-none focus:ring-1 focus:ring-highlight-400"
        />
        <button
          onClick={onSend}
          disabled={streaming || !input.trim()}
          className="font-body text-sm font-medium rounded-md bg-highlight-400 text-ink-950
                     px-4 py-2 hover:bg-highlight-500 hover:scale-[1.03] active:scale-[0.97]
                     transition-all disabled:opacity-40 disabled:cursor-not-allowed
                     disabled:hover:scale-100"
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
  documentTitle,
}: {
  ready: boolean;
  status: "idle" | "loading" | "ready" | "error";
  message: string | null;
  progress: { completed: number; total: number } | null;
  result: DocumentSummary | null;
  error: string | null;
  onGenerate: () => void;
  documentTitle: string;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle"
  );
  const [pdfError, setPdfError] = useState<string | null>(null);

  const handleCopy = async () => {
    if (!result) return;
    const ok = await copySummaryToClipboard(documentTitle, result);
    setCopyState(ok ? "copied" : "failed");
    setTimeout(() => setCopyState("idle"), 2000);
  };

  const handleMarkdown = () => {
    if (!result) return;
    downloadMarkdown(documentTitle, result);
  };

  const handlePdf = () => {
    if (!result) return;
    setPdfError(null);
    try {
      exportSummaryAsPdf(documentTitle, result);
    } catch (err) {
      setPdfError(
        err instanceof Error ? err.message : "Couldn't open the print window."
      );
    }
  };

  if (!ready) {
    return (
      <div className="flex-1 flex items-center justify-center p-10">
        <p className="font-body text-sm text-[var(--text-muted)] text-center max-w-xs">
          An executive summary and key takeaways will appear here once your
          document finishes uploading.
        </p>
      </div>
    );
  }

  if (status === "idle") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 p-10">
        <p className="font-body text-sm text-[var(--text-muted)] text-center max-w-xs">
          Generate an executive summary, key points, and named entities for
          this document.
        </p>
        <button
          onClick={onGenerate}
          className="font-body text-sm font-medium rounded-md bg-highlight-400 text-ink-950
                     px-4 py-2 hover:bg-highlight-500 hover:scale-[1.03] active:scale-[0.97]
                     transition-all"
        >
          Generate Summary
        </button>
      </div>
    );
  }

  if (status === "loading") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 p-10">
        <span className="font-mono text-xs text-[var(--accent)] animate-pulse">
          {message ?? "Working…"}
        </span>
        {progress && (
          <span className="font-mono text-xs text-[var(--text-muted)]">
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
          className="font-body text-sm font-medium rounded-md bg-[var(--surface-2)] text-[var(--text)]
                     px-4 py-2 hover:bg-[var(--surface)] hover:scale-[1.03] active:scale-[0.97]
                     transition-all"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!result) return null;
  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-6">
      <div>
        <h3 className="font-mono text-xs tracking-widest text-[var(--text-muted)] uppercase mb-2">
          Overview
        </h3>
        <p className="font-body text-sm text-[var(--text)] leading-relaxed">
          {result.overview}
        </p>
      </div>

      {result.key_points.length > 0 && (
        <div>
          <h3 className="font-mono text-xs tracking-widest text-[var(--text-muted)] uppercase mb-2">
            Key Points
          </h3>
          <ul className="space-y-1.5">
            {result.key_points.map((point, i) => (
              <li
                key={i}
                className="font-body text-sm text-[var(--text)] leading-relaxed flex gap-2"
              >
                <span className="text-[var(--accent)] shrink-0">•</span>
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.entities.length > 0 && (
        <div>
          <h3 className="font-mono text-xs tracking-widest text-[var(--text-muted)] uppercase mb-2">
            Entities
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {result.entities.map((entity, i) => (
              <span
                key={i}
                className="font-mono text-xs px-2 py-1 rounded bg-[var(--surface-2)] text-[var(--text-muted)]"
              >
                {entity}
              </span>
            ))}
          </div>
        </div>
      )}

      <div>
        <h3 className="font-mono text-xs tracking-widest text-[var(--text-muted)] uppercase mb-2">
          Export
        </h3>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleMarkdown}
            className="font-body text-xs font-medium rounded-md bg-[var(--surface-2)] text-[var(--text)]
                       px-3 py-1.5 hover:bg-[var(--surface)] hover:scale-[1.03] active:scale-[0.97]
                       transition-all"
          >
            Export Markdown
          </button>
          <button
            onClick={handleCopy}
            className="font-body text-xs font-medium rounded-md bg-[var(--surface-2)] text-[var(--text)]
                       px-3 py-1.5 hover:bg-[var(--surface)] hover:scale-[1.03] active:scale-[0.97]
                       transition-all"
          >
            {copyState === "copied"
              ? "Copied!"
              : copyState === "failed"
              ? "Copy failed"
              : "Copy to Clipboard"}
          </button>
          <button
            onClick={handlePdf}
            className="font-body text-xs font-medium rounded-md bg-[var(--surface-2)] text-[var(--text)]
                       px-3 py-1.5 hover:bg-[var(--surface)] hover:scale-[1.03] active:scale-[0.97]
                       transition-all"
          >
            Export PDF
          </button>
        </div>
        {pdfError && (
          <p className="font-body text-xs text-red-300 mt-2">{pdfError}</p>
        )}
      </div>

      <button
        onClick={onGenerate}
        className="font-body text-xs text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
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
        <p className="font-body text-sm text-[var(--text-muted)] text-center max-w-xs">
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
          className="group relative w-full text-left rounded-md bg-[var(--surface-2)] hover:bg-[var(--surface)]
                     transition-all duration-200 ease-out hover:scale-[1.01] p-3"
        >
          <button onClick={() => onJump(h)} className="w-full text-left">
            <div className="flex items-center justify-between gap-2 mb-1.5 pr-5">
              <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent)]/20 text-[var(--accent)] uppercase tracking-wide">
                {PRESET_LABELS[h.preset]}
              </span>
              <span className="font-mono text-[10px] text-[var(--text-muted)]">
                p. {h.page}
              </span>
            </div>
            <p className="font-body text-xs text-[var(--text-muted)] leading-relaxed line-clamp-3">
              {h.text}
            </p>
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(h);
            }}
            title="Remove highlight"
            className="absolute top-2.5 right-2.5 font-mono text-xs text-[var(--text-muted)] hover:text-red-300
                       opacity-0 group-hover:opacity-100 hover:scale-125 active:scale-90 transition-all"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}