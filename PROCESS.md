# MAIT MVP Process

## 1. What This Project Is
A contract analysis MVP with this flow:
1. User uploads a contract file.
2. Backend ingests file asynchronously (extract text, chunk, embed, store vectors).
3. User triggers analysis when document is ready.
4. Backend runs RAG-based extraction with Ollama (fixed fields, dynamic fields, supplier fields).
5. Frontend shows processing/analysis state and extracted results.

## 2. Tech Stack In Use
- Frontend: Next.js (App Router) + React + TypeScript
- Backend: Express + TypeScript
- DB: PostgreSQL 16 + `pgvector`
- ORM: Prisma
- Document extraction: `@kreuzberg/node`
- Chunking: `@langchain/textsplitters`
- Embeddings: Ollama `/api/embeddings` (`nomic-embed-text`)
- Generation: Ollama `/api/chat` (`gpt-oss` by default)
- Containers: Docker Compose

## 3. Runtime Topology
- `frontend` container on `:3000`
- `backend` container on `:8000`
- `db` container on `:5432`
- Ollama is external/remote (`OLLAMA_BASE_URL` from `.env`)

Data path:
- Browser -> Frontend (`:3000`) -> Backend API (`:8000`) -> Postgres + Ollama

## 4. Environment Configuration
Source of truth is root `.env` + `docker-compose.yml`.

Important vars used by backend config:
- `PORT`
- `DATABASE_URL`
- `OLLAMA_BASE_URL`
- `EMBED_MODEL`
- `GENERATION_MODEL`
- `WARMUP_MODEL`
- `INCLUDE_ALL_CHUNKS`
- `TARGET_CHUNKS`
- `LLM_TIMEOUT_MS`
- `LLM_NUM_PREDICT`
- `LLM_NUM_CTX`
- `LLM_TEMPERATURE`
- `MAX_FILE_SIZE` (declared in `.env`, but backend currently hardcodes 25MB in config)

Frontend var:
- `NEXT_PUBLIC_API_URL`

## 5. How It Starts (Docker)
Command:
```bash
docker compose up --build -d
```

Startup behavior:
1. `db` starts with healthcheck.
2. `backend` starts after DB healthy.
3. Backend entrypoint runs:
   - `prisma migrate deploy`
   - `CREATE EXTENSION vector`
   - add `embedding vector(768)` column
   - create HNSW index on embeddings
   - starts `node dist/index.js`
4. `frontend` starts after backend.

Stop:
```bash
docker compose down
```

## 6. Backend Structure and Responsibilities
- `backend/src/index.ts`
  - Express app setup, CORS, JSON body parsing
  - Route registration
  - Health endpoint: `GET /health`
  - Resets stuck analyses (`RUNNING`/`PARTIAL` -> `FAILED`) on startup
  - Optional model warmup (`WARMUP_MODEL=true`)

- `backend/src/controllers/documentsController.ts`
  - Upload/list/get/download/delete document endpoints
  - Upload immediately returns `202` and triggers async ingestion

- `backend/src/controllers/analysisController.ts`
  - Starts async analysis (`202`) only if document is `READY`
  - Prevents concurrent analysis using DB status + in-memory lock

- `backend/src/services/ingestion.ts`
  - Fetch file bytes from DB
  - Kreuzberg extraction
  - Dynamic chunk-size computation based on `TARGET_CHUNKS`
  - Embedding in batches (parallelized)
  - Bulk inserts chunk rows including vector values
  - Progress updates: `QUEUED -> PROCESSING -> READY`

- `backend/src/services/extraction.ts`
  - Analysis status row upsert to `RUNNING`
  - Combined pass optimization (fixed + dynamic in one call when possible)
  - Fallback/pass resume behavior for saved partial data
  - Supplier-specific pass using `mapping.json`
  - Uses Ollama `/api/chat` with strict JSON system prompt
  - Robust JSON parsing with repair attempt when output is malformed
  - Final status `DONE`, or `FAILED` on error

- `backend/src/services/embedding.ts`
  - Calls Ollama embeddings API with retries
  - Supports concurrent `embedBatch`

## 7. Database Model (Prisma)
Tables mapped as:
- `Document`
  - file bytes (`fileData`), status/progress, extracted `rawText`
- `Chunk`
  - chunk text + `embedding vector(768)` (raw SQL column)
- `DocumentAnalysis`
  - analysis status, `fixedFields`, `dynamicFields`, `specialFields`, `sources`, model metadata

Vector search:
- HNSW index with cosine ops on `Chunk.embedding`

## 8. API Endpoints (Current)
Document APIs:
- `POST /documents` (multipart upload field name: `file`)
- `GET /documents`
- `GET /documents/:id`
- `GET /documents/:id/download`
- `DELETE /documents/:id`

Analysis APIs:
- `POST /documents/:id/analyze`
- `GET /documents/:id/analysis`

## 9. Frontend Behavior
Main page (`/`):
- Upload UI and documents table
- Polls every 3s while any document is `QUEUED`/`PROCESSING`
- Shows progress and actions (`Analyze`, `View`, `Delete`)

Detail page (`/documents/[id]`):
- Loads document + analysis
- Polls while analysis is `RUNNING`/`PENDING`/`PARTIAL` or doc still processing
- Shows analysis cards for fixed, dynamic, and supplier-specific fields

## 10. File Types and Limits
Current upload middleware accepts:
- PDF
- DOCX
- TXT

Current max size:
- 25 MB (backend config hardcoded)

## 11. Operational Notes
- In-memory locks (`jobLock.ts`) prevent duplicate concurrent ingestion/analysis in a single backend process.
- Analysis can enter `PARTIAL` state while passes are being saved.
- Startup resets stuck analysis rows to avoid indefinite `RUNNING`/`PARTIAL`.
- Backend logs are structured (`logger.ts`) and include elapsed timings.

## 12. Common Commands
Run locally without full stack containerization:
```bash
# DB
docker compose up db -d

# Backend
cd backend
npm install
npx prisma migrate deploy
npm run dev

# Frontend
cd frontend
npm install
npm run dev
```

Build checks:
```bash
npm -C backend run build
npm -C frontend run build
```

## 13. Quick Troubleshooting
- Backend cannot reach Ollama:
  - verify `OLLAMA_BASE_URL`
  - test `GET <OLLAMA_BASE_URL>/api/tags`
- Upload accepted but never progresses:
  - check backend logs for extraction/embedding errors
  - verify pgvector setup completed in entrypoint
- Analysis stuck/retry needed:
  - restart backend (stuck RUNNING/PARTIAL rows auto-mark FAILED)
  - retrigger `/documents/:id/analyze`

---
This document reflects the code currently present in the repository (not only plan intent).
