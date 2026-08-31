# DocuSense AI

An intelligent document review and analysis platform — upload documents, get OCR-backed text extraction, ask questions via RAG-powered conversational chat (single-document and cross-document), generate map-reduce summaries, and query specific highlighted passages directly.

**Live app:** https://docuscanner-ai.onrender.com
**Backend API:** https://docuscanner-ai-api.onrender.com

> Note: both services run on Render's free tier and will spin down after inactivity — the first request after a period of idle time may take 50+ seconds to respond while the instance wakes up.

---

## Features

- **Document upload** with OCR fallback (Tesseract) for scanned documents
- **Semantic chunking + vector embeddings** (Gemini embeddings API, pgvector storage) for retrieval-augmented question answering
- **Single-document chat** — ask questions grounded in one document, with citations
- **Multi-document chat** — ask questions across all of a user's uploaded documents at once, with citations to source document + page
- **Highlight-to-ask** — select any passage in the PDF viewer and ask a question scoped to just that text, without full-document retrieval
- **Map-reduce summarization** — streamed, section-aware summaries of long documents
- **Summary export** — export summaries as Markdown, copy to clipboard, or download as PDF
- **Hallucination fallback** — the system detects when it can't ground an answer in the retrieved context and says so, rather than fabricating a response

---

## Tech Stack

**Frontend**
- Next.js (TypeScript)
- Tailwind CSS
- pdf.js for in-browser PDF rendering and text-layer selection

**Backend**
- FastAPI (Python)
- SQLAlchemy (sync)
- Tesseract OCR for scanned document fallback

**Data & AI**
- Supabase (Postgres + pgvector) for storage and vector search
- Gemini (via an OpenAI-compatible client) for both chat/RAG completions and embeddings

**Hosting**
- Render (free tier) — both frontend and backend deployed as separate web services

---

## Architecture Overview

1. A document is uploaded and OCR'd if needed (scanned files fall back to Tesseract; text-native files skip OCR).
2. The document is semantically chunked and each chunk is embedded via Gemini's embedding API, then stored in Supabase Postgres using the `pgvector` extension.
3. Chat questions retrieve the most relevant chunks (single-document or across all of a user's documents) and are answered by Gemini, grounded in that retrieved context, with page-level citations.
4. Selecting text in the PDF viewer and asking about it skips retrieval entirely — the selected passage is sent directly as the scoped context for that question.
5. Summarization uses a map-reduce approach: the document is summarized in sections, then those section summaries are combined into a final summary, streamed to the client as it's generated.

---

## Local Setup

### Prerequisites
- Node.js and npm (frontend)
- Python 3.11 and a virtual environment (backend)
- Docker (for local Postgres + pgvector, if not using a hosted Supabase instance for local dev)
- A Gemini API key

### Backend

```bash
cd docuscanner_ai_api
python -m venv venv
venv\Scripts\activate   # Windows
# source venv/bin/activate   # macOS/Linux
pip install -r requirements.txt
```

Create a `.env` file with (at minimum):

```
DATABASE_URL=postgresql://<user>:<password>@<host>:<port>/<db>
GEMINI_API_KEY=your-gemini-api-key
FRONTEND_ORIGIN=http://localhost:3000
```

Initialize the database (creates tables and enables the `pgvector` extension):

```bash
python init_db.py
```

Run the API:

```bash
uvicorn app.main:app --reload
```

### Frontend

```bash
cd docuscanner_ai
npm install
```

Create a `.env.local` file with:

```
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
```

Run the dev server:

```bash
npm run dev
```

The app will be available at `http://localhost:3000`.

---

## Deployment Notes

Both services are deployed on Render as separate web services from their respective GitHub repos.

- The **frontend** Dockerfile bakes `NEXT_PUBLIC_API_BASE_URL` into the build via a build-time `ARG`, since Next.js inlines `NEXT_PUBLIC_*` environment variables at build time, not runtime — this must point at the deployed backend URL, not `localhost`, for production builds.
- The **backend** reads its port from Render's `$PORT` environment variable rather than a hardcoded port.
- The backend's embedding pipeline uses Gemini's hosted embedding API rather than a locally-run `sentence-transformers`/`torch` model, to stay within Render free-tier memory limits. Gemini's embedding output (3072-dim) is truncated to 1024 dimensions to match the existing `pgvector` column.
- CORS is configured via a `FRONTEND_ORIGIN` environment variable on the backend, read at startup and added to the allowed origins list alongside `localhost:3000` for local development.
- Database connection strings with special characters in the password must be percent-encoded (e.g. `!` → `%21`, `&` → `%26`, `*` → `%2A`), or the connection string will fail to parse correctly.

---

## Deviations from SRS

The following scope decisions were made during development, deviating from or simplifying what's described in the original SRS:

- **Highlight-based querying was simplified.** Rather than a persisted, savable highlights system with a dedicated Highlights tab and database table, "Ask about this" is a lightweight, non-persistent flow: selecting text in the PDF viewer surfaces a floating "Ask about this" action that jumps to Chat with that passage scoped as context (shown as a dismissible banner above the chat input). Nothing about the highlight itself is saved.
- **Explicitly out of scope for this pass:** asynchronous document processing (Celery/Redis), retrieval re-ranking, document-to-document comparison, a document dashboard UI, sharing/collaboration between users, folders/tags for organizing documents, notifications, voice input, AI-assisted contract redlining, and UI theming/gamification.
- **No virus scanning on uploads** — file validation is limited to MIME type and size checks.
- **No automated CI pipeline** — testing is via a local pytest suite, run manually.
- **Multi-format ingestion is partial.** The 4-pill contextual toolbar (Explain Simply / Summarize / Identify Risks / Custom Question) currently only operates on PDF documents; image and DOCX ingestion exist but aren't wired into that toolbar yet.
- **S3-backed file storage exists in code but is untested against a real bucket** in the current deployment; documents are otherwise handled via the app's primary storage path.

---

## Known Limitations

- Free-tier hosting means both services spin down after inactivity, causing a delay on the first request.
- Partial text-drag selection in the PDF viewer occasionally snaps to the full paragraph rather than the exact dragged range (cosmetic issue, doesn't affect functionality).