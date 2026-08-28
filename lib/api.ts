// lib/api.ts
//
// Thin client for the FastAPI backend. Matches the actual response
// shape of POST /documents/upload in app/routers/documents.py:
//   { document_id, file_key, page_count, chunk_count, status }
//
// Set NEXT_PUBLIC_API_BASE_URL in .env.local if the backend isn't on
// localhost:8000 (e.g. a different port or a deployed URL later).

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

// ---------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------
//
// The token is kept in memory (via AuthContext) and mirrored into
// sessionStorage so a page refresh doesn't force a re-login. It's read
// here through a getter so this module doesn't need to import React —
// AuthContext calls setAuthToken() whenever login/logout happens.

let currentToken: string | null = null;

export function setAuthToken(token: string | null) {
  currentToken = token;
}

function authHeaders(): Record<string, string> {
  return currentToken ? { Authorization: `Bearer ${currentToken}` } : {};
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user_id: string;
  email: string;
}

async function parseErrorDetail(res: Response): Promise<string> {
  let detail = res.statusText;
  try {
    const body = await res.json();
    detail = body.detail ?? detail;
  } catch {
    // not JSON — keep statusText
  }
  return detail;
}

export async function registerUser(
  email: string,
  password: string
): Promise<AuthResponse> {
  const res = await fetch(`${API_BASE_URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new ApiError(res.status, await parseErrorDetail(res));
  return res.json();
}

export async function loginUser(
  email: string,
  password: string
): Promise<AuthResponse> {
  const res = await fetch(`${API_BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new ApiError(res.status, await parseErrorDetail(res));
  return res.json();
}

export interface UploadDocumentResponse {
  document_id: string;
  file_key: string;
  page_count: number;
  chunk_count: number;
  status: "ready" | "processing" | string;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

/**
 * Uploads a file to the ingestion pipeline. The backend currently
 * runs OCR, chunking, and embedding synchronously before responding,
 * so this can take a few seconds on larger documents — the caller
 * should show a loading state for the duration of the await.
 */
export async function uploadDocument(
  file: File
): Promise<UploadDocumentResponse> {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(`${API_BASE_URL}/documents/upload`, {
    method: "POST",
    headers: authHeaders(),
    body: formData,
  });

  if (!res.ok) {
    throw new ApiError(res.status, await parseErrorDetail(res));
  }

  return res.json();
}

// ---------------------------------------------------------------------
// Chat (Step 6)
// ---------------------------------------------------------------------
//
// POST /chat/{document_id} returns a Server-Sent Events stream from
// app/routers/chat.py. EventSource can't do POST bodies, so this reads
// the fetch() ReadableStream by hand and parses "event: x\ndata: y\n\n"
// frames as they arrive.

export interface ChatHistoryTurn {
  role: "user" | "assistant";
  content: string;
}

/** A normalized bounding box: fractions (0-1) of the page's own width/
 * height, top-left origin. Multiply by whatever size the page is
 * currently rendered at to get real pixel coordinates. */
export interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Citation {
  chunk_id: string;
  page_num: number;
  /** Null for chunks ingested before bbox extraction existed. */
  bbox: BBox | null;
  /** Only present on citations from POST /chat-all (Day 2) — identifies
   * which of the user's documents this excerpt came from, since a
   * multi-document answer may cite several different files. */
  doc_id?: string;
  doc_title?: string;
}

export interface ChatStreamHandlers {
  /** Fired once, before any tokens, with the chunks the answer is grounded in. */
  onCitations?: (citations: Citation[]) => void;
  /** Fired for each streamed token/text chunk from the model. */
  onToken: (text: string) => void;
  /** Fired once the stream completes normally. */
  onDone?: () => void;
  /** Fired on network errors or non-2xx responses. */
  onError?: (error: ApiError | Error) => void;
}

/**
 * Sends a question about one document and streams the answer back via
 * SSE, invoking the relevant handler as each event arrives. Returns an
 * AbortController the caller can use to cancel an in-flight stream
 * (e.g. if the user navigates away or sends a new message).
 */
export function sendChatMessage(
  documentId: string,
  question: string,
  history: ChatHistoryTurn[],
  handlers: ChatStreamHandlers,
  /** Step 8: when set, the backend skips retrieval and answers from
   * just this passage instead of the whole document. */
  scopedSelection?: { text: string; page: number }
): AbortController {
  const controller = new AbortController();

  (async () => {
    let res: Response;
    try {
      res = await fetch(`${API_BASE_URL}/chat/${documentId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          question,
          history,
          highlighted_text: scopedSelection?.text,
          highlighted_page: scopedSelection?.page,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      handlers.onError?.(
        err instanceof Error ? err : new Error("Network error")
      );
      return;
    }

    if (!res.ok || !res.body) {
      let detail = res.statusText;
      try {
        const body = await res.json();
        detail = body.detail ?? detail;
      } catch {
        // not JSON — keep statusText
      }
      handlers.onError?.(new ApiError(res.status, detail));
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE frames are separated by a blank line.
        let boundary: number;
        while ((boundary = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);

          let event = "message";
          let data = "";
          for (const line of frame.split("\n")) {
            if (line.startsWith("event: ")) event = line.slice(7);
            else if (line.startsWith("data: ")) data = line.slice(6);
          }
          if (!data) continue;

          const parsed = JSON.parse(data);
          if (event === "citations") {
            handlers.onCitations?.(parsed.citations ?? []);
          } else if (event === "token") {
            handlers.onToken(parsed.text ?? "");
          } else if (event === "done") {
            handlers.onDone?.();
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        handlers.onError?.(
          err instanceof Error ? err : new Error("Stream error")
        );
      }
    }
  })();

  return controller;
}

// ---------------------------------------------------------------------
// Multi-document chat (Day 2) — POST /chat-all
// ---------------------------------------------------------------------
//
// Same SSE shape as sendChatMessage, but not scoped to one document_id
// — the backend (app/routers/chat_all.py) searches across all of the
// current user's "ready" documents. Citations here carry doc_id +
// doc_title so the frontend can show which file each excerpt came
// from and, if clicked, switch the viewer to that document.

export function sendMultiDocChatMessage(
  question: string,
  history: ChatHistoryTurn[],
  handlers: ChatStreamHandlers
): AbortController {
  const controller = new AbortController();

  (async () => {
    let res: Response;
    try {
      res = await fetch(`${API_BASE_URL}/chat-all`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ question, history }),
        signal: controller.signal,
      });
    } catch (err) {
      handlers.onError?.(
        err instanceof Error ? err : new Error("Network error")
      );
      return;
    }

    if (!res.ok || !res.body) {
      let detail = res.statusText;
      try {
        const body = await res.json();
        detail = body.detail ?? detail;
      } catch {
        // not JSON — keep statusText
      }
      handlers.onError?.(new ApiError(res.status, detail));
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let boundary: number;
        while ((boundary = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);

          let event = "message";
          let data = "";
          for (const line of frame.split("\n")) {
            if (line.startsWith("event: ")) event = line.slice(7);
            else if (line.startsWith("data: ")) data = line.slice(6);
          }
          if (!data) continue;

          const parsed = JSON.parse(data);
          if (event === "citations") {
            handlers.onCitations?.(parsed.citations ?? []);
          } else if (event === "token") {
            handlers.onToken(parsed.text ?? "");
          } else if (event === "done") {
            handlers.onDone?.();
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        handlers.onError?.(
          err instanceof Error ? err : new Error("Stream error")
        );
      }
    }
  })();

  return controller;
}

export async function getMultiDocChatHistory(): Promise<ChatHistoryMessage[]> {
  const res = await fetch(`${API_BASE_URL}/chat-all/history`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new ApiError(res.status, await parseErrorDetail(res));
  const body = await res.json();
  return body.messages ?? [];
}

// ---------------------------------------------------------------------
// Summary (Step 7)
// ---------------------------------------------------------------------
//
// POST /summary/{document_id} streams SSE frames from
// app/services/summarization.py. Unlike chat's stream, every frame is
// a plain "data: {...}\n\n" line (no "event:" line) — the JSON payload
// itself carries a "type" field: "status" | "progress" | "complete" | "error".

export interface DocumentSummary {
  overview: string;
  key_points: string[];
  entities: string[];
}

export interface SummaryStreamHandlers {
  /** Fired for human-readable progress messages, e.g. "Summarizing 4 section(s)...". */
  onStatus?: (message: string) => void;
  /** Fired after each map-reduce batch completes. */
  onProgress?: (completed: number, total: number) => void;
  /** Fired once with the final structured summary. */
  onComplete: (summary: DocumentSummary) => void;
  /** Fired on network errors, non-2xx responses, or a backend "error" frame. */
  onError?: (error: ApiError | Error) => void;
}

/**
 * Streams a document summary via SSE. Returns an AbortController the
 * caller can use to cancel an in-flight stream (e.g. switching tabs
 * away before it finishes, or requesting a fresh document).
 */
export function summarizeDocument(
  documentId: string,
  handlers: SummaryStreamHandlers
): AbortController {
  const controller = new AbortController();

  (async () => {
    let res: Response;
    try {
      res = await fetch(`${API_BASE_URL}/summary/${documentId}`, {
        method: "POST",
        headers: { ...authHeaders() },
        signal: controller.signal,
      });
    } catch (err) {
      handlers.onError?.(
        err instanceof Error ? err : new Error("Network error")
      );
      return;
    }

    if (!res.ok || !res.body) {
      let detail = res.statusText;
      try {
        const body = await res.json();
        detail = body.detail ?? detail;
      } catch {
        // not JSON — keep statusText
      }
      handlers.onError?.(new ApiError(res.status, detail));
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let boundary: number;
        while ((boundary = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);

          let data = "";
          for (const line of frame.split("\n")) {
            if (line.startsWith("data: ")) data = line.slice(6);
          }
          if (!data) continue;

          const parsed = JSON.parse(data);
          if (parsed.type === "status") {
            handlers.onStatus?.(parsed.message ?? "");
          } else if (parsed.type === "progress") {
            handlers.onProgress?.(parsed.completed, parsed.total);
          } else if (parsed.type === "complete") {
            handlers.onComplete(parsed.summary);
          } else if (parsed.type === "error") {
            handlers.onError?.(new Error(parsed.message ?? "Summary failed"));
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        handlers.onError?.(
          err instanceof Error ? err : new Error("Stream error")
        );
      }
    }
  })();

  return controller;
}
// ---------------------------------------------------------------------
// Chat history (Step 9)
// ---------------------------------------------------------------------
//
// GET /chat/{document_id}/history replays a saved conversation so the
// Chat tab can hydrate on load instead of starting blank.

export interface ChatHistoryMessage {
  role: "user" | "assistant";
  content: string;
  citations: Citation[] | null;
  created_at: string;
}

export async function getChatHistory(
  documentId: string
): Promise<ChatHistoryMessage[]> {
  const res = await fetch(`${API_BASE_URL}/chat/${documentId}/history`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new ApiError(res.status, await parseErrorDetail(res));
  const body = await res.json();
  return body.messages ?? [];
}

// ---------------------------------------------------------------------
// Annotations (Step 9)
// ---------------------------------------------------------------------
//
// Persists the passages saved via the 4-pill toolbar so the
// Highlights tab survives a refresh. Matches app/routers/annotations.py.

/** A normalized {x0,y0,x1,y1} fraction-of-page bbox, same convention
 * as BBox on chat citations — optional since a raw text selection
 * doesn't always resolve to a single box. */
export type RectCoords = BBox;

export interface AnnotationRecord {
  anno_id: string;
  doc_id: string;
  page_num: number;
  selected_text: string;
  rect_coords: RectCoords | null;
  /** Reused to carry which preset pill produced this highlight
   * ("explain" | "summarize" | "risks"). */
  ai_notes: string | null;
  created_at: string;
}

export async function saveAnnotation(
  documentId: string,
  annotation: {
    page_num: number;
    selected_text: string;
    rect_coords?: RectCoords | null;
    ai_notes?: string | null;
  }
): Promise<AnnotationRecord> {
  const res = await fetch(`${API_BASE_URL}/annotations/${documentId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(annotation),
  });
  if (!res.ok) throw new ApiError(res.status, await parseErrorDetail(res));
  return res.json();
}

export async function listAnnotations(
  documentId: string
): Promise<AnnotationRecord[]> {
  const res = await fetch(`${API_BASE_URL}/annotations/${documentId}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new ApiError(res.status, await parseErrorDetail(res));
  return res.json();
}

export async function deleteAnnotation(
  documentId: string,
  annoId: string
): Promise<void> {
  const res = await fetch(
    `${API_BASE_URL}/annotations/${documentId}/${annoId}`,
    { method: "DELETE", headers: authHeaders() }
  );
  if (!res.ok) throw new ApiError(res.status, await parseErrorDetail(res));
}