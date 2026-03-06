# Contract RAG MVP

Upload contracts → extract text → chunk → embed → analyze with local Ollama LLM.

## Prerequisites

- Docker & Docker Compose
- Ollama server running at `http://148.113.1.127:11434` with models:
  - `nomic-embed-text` (embeddings)
  - `gpt-oss` (generation)

## Run

```bash
docker compose up --build -d
```

That's it. This single command:

1. Starts **PostgreSQL 16 + pgvector** (with healthcheck)
2. Builds & starts the **backend** (Express.js + TypeScript)
   - Runs Prisma migrations automatically
   - Sets up pgvector extension, embedding column, and HNSW index
   - Resets any stuck analyses from previous runs
3. Builds & starts the **frontend** (Next.js)

| Service  | URL                          |
|----------|------------------------------|
| Frontend | http://localhost:3000         |
| Backend  | http://localhost:8000         |
| Health   | http://localhost:8000/health  |
| Database | localhost:5432               |

## Usage

1. Open http://localhost:3000
2. Upload a PDF or DOCX contract (max 25MB)
3. Wait for processing (QUEUED → PROCESSING → READY)
4. Click **Analyze** — runs 3-pass RAG extraction
5. View extracted fields with confidence scores

## Stop

```bash
docker compose down
```

To also remove the database volume:

```bash
docker compose down -v
```

## Development (without Docker)

```bash
# Terminal 1 — Database
docker compose up db -d

# Terminal 2 — Backend
cd backend
npm install
npx prisma migrate deploy
npm run dev

# Terminal 3 — Frontend
cd frontend
npm install
npm run dev
```

## Architecture

```
┌──────────┐     ┌──────────┐     ┌──────────────┐     ┌────────┐
│ Frontend │────▶│ Backend  │────▶│ PostgreSQL   │     │ Ollama │
│ Next.js  │     │ Express  │     │ + pgvector   │     │ Server │
│ :3000    │     │ :8000    │     │ :5432        │     │ :11434 │
└──────────┘     └────┬─────┘     └──────────────┘     └────┬───┘
                      │                                      │
                      │  embed / generate (HTTP)             │
                      └──────────────────────────────────────┘
```

### Analysis Pipeline

1. **Upload** → file stored in DB as bytes
2. **Ingestion** (async): Kreuzberg text extraction → chunking (600 chars) → Ollama embeddings → pgvector storage
3. **Analysis** (on demand): 3 sequential RAG passes via Ollama:
   - Pass 1: 20 fixed fields (provider, dates, amounts, etc.)
   - Pass 2: Dynamic clauses by category (legal, commercial, data protection, etc.)
   - Pass 3: Supplier-specific fields (Oracle/Microsoft/SAP)

## Environment Variables

All configured in `docker-compose.yml` — no `.env` file needed for Docker.

| Variable           | Default                              | Description              |
|--------------------|--------------------------------------|--------------------------|
| DATABASE_URL       | postgresql://postgres:postgres@db:5432/mait_mvp | Postgres connection |
| OLLAMA_BASE_URL    | http://148.113.1.127:11434          | Ollama server            |
| EMBED_MODEL        | nomic-embed-text                     | Embedding model          |
| GENERATION_MODEL   | gpt-oss                              | LLM generation model     |
| PORT               | 8000                                 | Backend port             |
