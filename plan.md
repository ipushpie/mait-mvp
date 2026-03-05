# Contract RAG MVP — Plan

## What We're Building

A standalone MVP application where:
1. User uploads a contract document
2. System processes it (Kreuzberg clean → chunk → embed) in the background
3. User sees live processing status (Queued / Processing / Ready / Failed)
4. When Ready, user clicks "Analyze" — system runs RAG extraction with local Ollama
5. Extracted fields are stored in DB and displayed in UI

No cloud LLMs. Everything runs locally.

---

## Tech Stack

| Layer | Choice | Reason |
|-------|--------|--------|
| Backend | FastAPI (Python) | Kreuzberg is Python-native |
| Document cleaning | kreuzberg | Local PDF/DOCX text extraction |
| Chunking | langchain `RecursiveCharacterTextSplitter` | Simple, reliable |
| Embeddings | Ollama `nomic-embed-text` (768 dims) | Free, local, good quality |
| LLM generation | Ollama `llama3.2` | Local, no API cost |
| Database | PostgreSQL + pgvector | Vector search for RAG |
| ORM | SQLAlchemy + asyncpg | Async Python DB |
| Background jobs | FastAPI `BackgroundTasks` | No Redis needed for MVP |
| Frontend | Next.js (or plain React + Vite) | UI with polling |

---

## Ollama Setup (prerequisite)

```bash
ollama pull nomic-embed-text   # 768-dim embeddings
ollama pull llama3.2           # generation (or llama3.1:8b for better quality)
```

---

## Database Schema (3 tables)

### `documents`
| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | |
| filename | TEXT | original filename |
| mime_type | TEXT | application/pdf etc |
| status | TEXT | QUEUED / PROCESSING / READY / FAILED |
| progress | INT | 0–100 |
| error_message | TEXT nullable | failure reason |
| raw_text | TEXT nullable | cleaned text from Kreuzberg |
| created_at | TIMESTAMP | |
| updated_at | TIMESTAMP | |

### `chunks`
| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | |
| document_id | UUID FK → documents.id | |
| chunk_index | INT | order in document |
| content | TEXT | chunk text |
| page_start | INT nullable | citation |
| page_end | INT nullable | citation |
| section_title | TEXT nullable | heading if detected |
| metadata | JSONB nullable | extra info |
| embedding | vector(768) | pgvector embedding |

Index:
```sql
CREATE INDEX idx_chunks_embedding ON chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

### `document_analysis`
| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | |
| document_id | UUID FK → documents.id UNIQUE | one result per doc |
| status | TEXT | PENDING / RUNNING / DONE / FAILED |
| error_message | TEXT nullable | |
| result | JSONB nullable | extracted fields JSON |
| sources | JSONB nullable | chunk citations |
| model_name | TEXT | ollama model used |
| created_at | TIMESTAMP | |
| updated_at | TIMESTAMP | |

---

## Project Structure

```
mait-mvp/
├── backend/
│   ├── main.py                  # FastAPI app entry point
│   ├── database.py              # SQLAlchemy engine + session
│   ├── models.py                # SQLAlchemy models (3 tables)
│   ├── schemas.py               # Pydantic request/response schemas
│   ├── routers/
│   │   ├── documents.py         # upload, status, list endpoints
│   │   └── analysis.py          # analyze, get-result endpoints
│   ├── services/
│   │   ├── ingestion.py         # Kreuzberg clean → chunk → embed → store
│   │   ├── embedding.py         # Ollama embed calls
│   │   └── extraction.py        # RAG retrieval + Ollama generation
│   ├── prompts.py               # extraction prompt templates + field definitions
│   └── requirements.txt
├── frontend/
│   ├── (Next.js or Vite React app)
│   └── src/
│       ├── pages/ (or app/)
│       │   ├── index.tsx         # documents list with status
│       │   └── analysis/[id].tsx # analysis result view
│       └── components/
│           ├── DocumentList.tsx
│           ├── StatusBadge.tsx
│           └── AnalysisResult.tsx
├── docker-compose.yml           # postgres + pgvector only
└── plan.md                      # this file
```

---

## Implementation Steps

### Step 1 — Postgres + pgvector

`docker-compose.yml`:
```yaml
services:
  db:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_DB: mait_mvp
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

Run:
```bash
docker compose up -d
```

---

### Step 2 — Backend Setup

`requirements.txt`:
```
fastapi
uvicorn[standard]
sqlalchemy[asyncio]
asyncpg
pgvector
kreuzberg
langchain
langchain-text-splitters
httpx
python-multipart
python-dotenv
alembic
```

`backend/.env`:
```
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/mait_mvp
OLLAMA_BASE_URL=http://localhost:11434
EMBED_MODEL=nomic-embed-text
GENERATION_MODEL=llama3.2
```

---

### Step 3 — Database Models (`models.py`)

```python
from sqlalchemy import Column, String, Integer, Text, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, JSONB
from pgvector.sqlalchemy import Vector
import uuid, datetime

class Document(Base):
    __tablename__ = "documents"
    id = Column(UUID, primary_key=True, default=uuid.uuid4)
    filename = Column(String, nullable=False)
    mime_type = Column(String)
    status = Column(String, default="QUEUED")  # QUEUED|PROCESSING|READY|FAILED
    progress = Column(Integer, default=0)
    error_message = Column(Text)
    raw_text = Column(Text)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, onupdate=datetime.datetime.utcnow)

class Chunk(Base):
    __tablename__ = "chunks"
    id = Column(UUID, primary_key=True, default=uuid.uuid4)
    document_id = Column(UUID, ForeignKey("documents.id"))
    chunk_index = Column(Integer)
    content = Column(Text)
    page_start = Column(Integer)
    page_end = Column(Integer)
    section_title = Column(Text)
    metadata = Column(JSONB)
    embedding = Column(Vector(768))

class DocumentAnalysis(Base):
    __tablename__ = "document_analysis"
    id = Column(UUID, primary_key=True, default=uuid.uuid4)
    document_id = Column(UUID, ForeignKey("documents.id"), unique=True)
    status = Column(String, default="PENDING")  # PENDING|RUNNING|DONE|FAILED
    error_message = Column(Text)
    result = Column(JSONB)
    sources = Column(JSONB)
    model_name = Column(String)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, onupdate=datetime.datetime.utcnow)
```

---

### Step 4 — Ingestion Service (`services/ingestion.py`)

Called as a background task after upload.

```
async def ingest_document(document_id: str, file_bytes: bytes, filename: str):
    1. Update status → PROCESSING, progress = 5
    2. Use kreuzberg to extract clean text from file_bytes
       - result = await kreuzberg.extract_text(file_bytes, mime_type)
       - Store in documents.raw_text
    3. Update progress = 30
    4. Chunk the raw_text using RecursiveCharacterTextSplitter
       - chunk_size=800, chunk_overlap=80
    5. Update progress = 50
    6. For each chunk:
       - Call Ollama embed: POST /api/embeddings { model, prompt: chunk_text }
       - Insert row into chunks table with embedding vector
    7. Update progress = 90
    8. status → READY, progress = 100
    On any exception: status → FAILED, error_message = str(e)
```

---

### Step 5 — Extraction Service (`services/extraction.py`)

Called when user clicks "Analyze".

```
async def analyze_document(document_id: str):
    1. Upsert document_analysis row: status = RUNNING
    2. For each field group (3 groups, see below):
       a. Build query string for the group
       b. Embed query via Ollama
       c. pgvector similarity search:
          SELECT * FROM chunks
          WHERE document_id = :id
          ORDER BY embedding <-> :query_vec
          LIMIT 10
       d. Pack chunk texts into context
       e. Call Ollama generate with prompt (see prompts.py)
       f. Parse JSON response
    3. Merge all group results into one JSON object
    4. Store in document_analysis.result + sources
    5. status → DONE
    On error: status → FAILED
```

**Field groups + query strings:**
- Group A (identity): `"agreement type parties client supplier provider product"` → fields: agreement_type, provider, client, product, contract_id, contract_classification
- Group B (financials + dates): `"start date end date payment terms total amount annual value contract term"` → fields: start_date, end_date, contract_term, contract_status, total_amount, annual_amount, payment_terms
- Group C (renewal + ownership): `"auto renewal notice period renewal duration customer owner supplier owner relationships"` → fields: auto_renewal, renewal_notice_period, renewal_duration_period, relationships, customer_owner, supplier_owner

---

### Step 6 — Prompts (`prompts.py`)

One prompt template per group. Example for Group B:

```python
SYSTEM_PROMPT = """You are a contract analysis assistant.
Use ONLY the provided context chunks from the contract.
If a field is not found in the context, return null for that field.
Return ONLY valid JSON. No explanation, no markdown."""

GROUP_B_PROMPT = """Extract the following fields from the contract context below.

Fields to extract:
- start_date: Contract start date (YYYY-MM-DD format)
- end_date: Contract end date (YYYY-MM-DD format)
- contract_term: Duration e.g. "24 months"
- contract_status: "Active", "Inactive", or "Unknown"
- total_amount: Format as "CURRENCY_CODE:AMOUNT" e.g. "USD:150000.00"
- annual_amount: Year-by-year breakdown or calculated annual rate
- payment_terms: Format as "X Days | Advanced" or "X Days | Arrears"

Return JSON:
{
  "start_date": {"value": "...", "confidence": 0.0-1.0},
  "end_date": {"value": "...", "confidence": 0.0-1.0},
  ...
}

Context:
{context}
"""
```

(Adapt field definitions directly from `ContractAIService.ts` lines 362–390 in the multistrat project)

---

### Step 7 — API Endpoints (`routers/documents.py`, `routers/analysis.py`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/documents` | Upload file → 202, starts background ingestion |
| GET | `/documents` | List all documents with status |
| GET | `/documents/{id}` | Single document status + progress |
| POST | `/documents/{id}/analyze` | Start RAG extraction → 202 |
| GET | `/documents/{id}/analysis` | Get analysis result |

---

### Step 8 — Frontend

**Documents list page (`/`)**:
- Table columns: Filename, Uploaded At, Status badge, Progress bar, Action button
- Status badge colors: QUEUED=gray, PROCESSING=yellow, READY=green, FAILED=red
- Poll `GET /documents` every 3s while any doc is QUEUED or PROCESSING
- Action button: disabled unless READY → "Analyze" → POST `/documents/{id}/analyze` → poll analysis

**Analysis result page (`/documents/[id]/analysis`)**:
- Show extracted fields in a card layout
- Each field: label + value + confidence score (as colored dot: green > 0.8, yellow > 0.5, red otherwise)
- Show source chunks (citations) at bottom

---

## API Response Shapes

### `GET /documents`
```json
[
  {
    "id": "uuid",
    "filename": "contract.pdf",
    "status": "READY",
    "progress": 100,
    "created_at": "2026-03-05T10:00:00Z"
  }
]
```

### `GET /documents/{id}/analysis`
```json
{
  "status": "DONE",
  "result": {
    "start_date": { "value": "2024-01-01", "confidence": 0.95 },
    "end_date": { "value": "2026-12-31", "confidence": 0.92 },
    "provider": { "value": "Acme Corp", "confidence": 0.98 },
    "total_amount": { "value": "USD:150000.00", "confidence": 0.87 },
    "payment_terms": { "value": "30 Days | Arrears", "confidence": 0.76 }
  },
  "sources": [
    { "chunk_id": "uuid", "content_preview": "...", "similarity": 0.91 }
  ]
}
```

---

## Verification Checklist

- [ ] `docker compose up` starts postgres with pgvector
- [ ] Upload a PDF → 202 returned immediately
- [ ] `GET /documents/{id}` shows status transitioning QUEUED → PROCESSING → READY
- [ ] `chunks` table has rows with non-null `embedding` column
- [ ] Click Analyze → `document_analysis.status` goes RUNNING → DONE
- [ ] `GET /documents/{id}/analysis` returns populated `result` JSON
- [ ] UI displays extracted fields with confidence scores

---

## Start Order

```bash
# 1. Start DB
docker compose up -d

# 2. Start Ollama (must be running)
ollama serve

# 3. Pull models (first time)
ollama pull nomic-embed-text
ollama pull llama3.2

# 4. Start backend
cd backend
pip install -r requirements.txt
alembic upgrade head
uvicorn main:app --reload

# 5. Start frontend
cd frontend
npm install
npm run dev
```
