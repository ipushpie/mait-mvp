# Contract RAG MVP — Plan

## What We're Building

A standalone MVP application where:
1. User uploads a contract document
2. System processes it (Kreuzberg clean → chunk → embed) in the background
3. User sees live processing status (Queued / Processing / Ready / Failed)
4. When Ready, user clicks "Analyze" — system runs RAG extraction with local Ollama
5. Extracted fields (fixed + dynamic + supplier-specific) are stored in DB and shown in UI

No cloud LLMs. Everything is local. Ollama runs on a remote server we own.

---

## Ollama Server

```
Base URL: http://148.113.1.127:11434
Embed model: nomic-embed-text     (768 dims)
Generation model: gpt-oss         (verify exact name via GET /api/tags)
```

To verify available models:
```bash
curl http://148.113.1.127:11434/api/tags
```

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Backend | FastAPI (Python) — Kreuzberg is Python-native |
| Document cleaning | kreuzberg |
| Chunking | langchain `RecursiveCharacterTextSplitter` |
| Embeddings | Ollama `nomic-embed-text` via HTTP |
| LLM generation | Ollama `gpt-oss` via HTTP |
| Database | PostgreSQL + pgvector |
| ORM | SQLAlchemy + asyncpg |
| Background tasks | FastAPI `BackgroundTasks` (no Redis needed for MVP) |
| Frontend | Next.js |

---

## Database Schema (3 tables)

### `documents`

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| filename | TEXT | original filename |
| mime_type | TEXT | application/pdf etc |
| file_data | BYTEA | raw uploaded file bytes (MVP: store in DB) |
| status | TEXT | QUEUED / PROCESSING / READY / FAILED |
| progress | INT | 0–100 |
| error_message | TEXT nullable | |
| raw_text | TEXT nullable | cleaned text from Kreuzberg |
| created_at | TIMESTAMP | |
| updated_at | TIMESTAMP | |

> **File size cap**: Enforce 25MB max at upload. Supported types: PDF, DOCX only (check mime_type).

### `chunks`

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| document_id | UUID FK | → documents.id |
| chunk_index | INT | order in doc |
| content | TEXT | chunk text |
| page_start | INT nullable | for citations |
| page_end | INT nullable | for citations |
| section_title | TEXT nullable | heading if detected |
| metadata | JSONB nullable | extra info |
| embedding | vector(768) | pgvector |

Required index (use hnsw — no row-count minimum, works from day 1):
```sql
CREATE INDEX idx_chunks_embedding ON chunks USING hnsw (embedding vector_cosine_ops);
```

> Do NOT use `ivfflat` — it requires enough rows to set `lists` correctly and breaks on small datasets.

### `document_analysis`

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| document_id | UUID FK UNIQUE | → documents.id (one result per doc) |
| status | TEXT | PENDING / RUNNING / DONE / FAILED |
| error_message | TEXT nullable | |
| fixed_fields | JSONB nullable | 20 extracted fields |
| dynamic_fields | JSONB nullable | categorical clauses |
| special_fields | JSONB nullable | supplier-specific fields |
| sources | JSONB nullable | chunk citations per field group |
| model_name | TEXT | which Ollama model was used |
| created_at | TIMESTAMP | |
| updated_at | TIMESTAMP | |

---

## Project Structure

```
mait-mvp/
├── backend/
│   ├── main.py
│   ├── database.py          # SQLAlchemy async engine + session
│   ├── models.py            # 3 SQLAlchemy models
│   ├── schemas.py           # Pydantic request/response models
│   ├── config.py            # env vars (OLLAMA_BASE_URL, DB URL, models)
│   ├── routers/
│   │   ├── documents.py     # upload, list, status
│   │   └── analysis.py     # analyze, get-result
│   ├── services/
│   │   ├── ingestion.py    # Kreuzberg → chunk → embed → store
│   │   ├── embedding.py    # Ollama embed calls
│   │   └── extraction.py  # RAG retrieval + Ollama generation (3 passes)
│   ├── prompts.py           # ALL prompt templates (copied from ContractAIService.ts)
│   └── requirements.txt
├── frontend/
│   └── src/
│       ├── app/
│       │   ├── page.tsx               # documents list
│       │   └── documents/[id]/page.tsx # analysis result
│       └── components/
│           ├── DocumentList.tsx
│           ├── StatusBadge.tsx
│           └── AnalysisResult.tsx
├── docker-compose.yml       # postgres + pgvector only
└── plan.md
```

---

## Implementation Steps

### Step 1 — Docker: Postgres + pgvector

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

```bash
docker compose up -d
```

---

### Step 2 — Backend Config

`backend/.env`:
```
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/mait_mvp
OLLAMA_BASE_URL=http://148.113.1.127:11434
EMBED_MODEL=nomic-embed-text
GENERATION_MODEL=gpt-oss
```

`requirements.txt`:
```
fastapi
uvicorn[standard]
sqlalchemy[asyncio]
asyncpg
pgvector
kreuzberg[ocr]
langchain-text-splitters
httpx
python-multipart
python-dotenv
alembic
```

---

### Step 3 — Database Init

Run migrations with Alembic or just use SQLAlchemy `create_all` for MVP.

Raw SQL for pgvector:
```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

---

### Step 4 — Ingestion Service (`services/ingestion.py`)

Triggered as `BackgroundTasks` task after upload.

```
async def ingest_document(document_id):
    try:
        1. db: fetch document (get file_data, mime_type, filename)
        2. db: set status=PROCESSING, progress=5
        3. kreuzberg: extract clean text
           # Kreuzberg is SYNCHRONOUS — run in thread to not block async event loop
           result = await asyncio.to_thread(kreuzberg.extract_text, file_data, mime_type)
           store result in documents.raw_text
        4. db: progress=30
        5. chunk: RecursiveCharacterTextSplitter(chunk_size=800, chunk_overlap=80)
           chunks = splitter.split_text(raw_text)
        6. db: progress=50
        7. delete existing chunks for document_id (re-upload idempotency)
        8. for each chunk (batch embeds in groups of 10 to avoid timeout):
           - embedding = await embed(chunk_text)
           - insert row into chunks table
        9. db: progress=90
       10. db: status=READY, progress=100
    except Exception as e:
        db: status=FAILED, error_message=str(e)
```

> **Kreuzberg API note**: Check the exact function signature before implementing — it may be `extract_text(file_path)` rather than bytes. If so, write `file_data` to a temp file first via `tempfile.NamedTemporaryFile`.

---

### Step 5 — Embedding Service (`services/embedding.py`)

```python
async def embed(text: str) -> list[float]:
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{OLLAMA_BASE_URL}/api/embeddings",
            json={"model": EMBED_MODEL, "prompt": text},
            timeout=30
        )
    return response.json()["embedding"]
```

Store vector in Postgres using pgvector raw SQL (SQLAlchemy `execute`):
```python
await db.execute(
    text('UPDATE chunks SET embedding = :emb::vector WHERE id = :id'),
    {"emb": f"[{','.join(map(str, embedding))}]", "id": chunk_id}
)
```

---

### Step 6 — Extraction Service (`services/extraction.py`)

Three sequential passes when user clicks "Analyze":

```
async def analyze_document(document_id):
    1. upsert document_analysis: status=RUNNING
    2. fetch document.raw_text (used in context + for the supplier detection)
    3. run Pass 1 (fixed fields)
    4. run Pass 2 (dynamic fields)
    5. run Pass 3 (supplier/special fields)
    6. merge results, store in document_analysis
    7. status=DONE
    on error: status=FAILED
```

**For each pass:**
```
query_text = <field-group-specific query string>
query_embedding = await embed(query_text)
chunks = pgvector SELECT top 10 by cosine similarity WHERE document_id=:id
context = join chunk contents
response = await ollama_generate(prompt_template.format(context=context))
result = parse_json(response)
```

pgvector retrieval SQL:
```sql
SELECT id, content, metadata
FROM chunks
WHERE document_id = :doc_id
ORDER BY embedding <-> :query_vec::vector
LIMIT 10
```

Ollama generate call:
```python
async def ollama_generate(prompt: str) -> str:
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{OLLAMA_BASE_URL}/api/generate",
            json={"model": GENERATION_MODEL, "prompt": prompt, "stream": False, "format": "json"},
            timeout=120
        )
    return response.json()["response"]

def parse_llm_json(raw: str) -> dict:
    """Robust JSON parser — LLMs often wrap output in markdown code fences."""
    raw = raw.strip()
    # Strip markdown code blocks if present
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        # Last resort: find first { ... } block
        match = re.search(r'\{[\s\S]*\}', raw)
        if match:
            return json.loads(match.group())
        raise ValueError(f"Could not parse JSON from LLM response: {raw[:200]}")
```

> Always use `parse_llm_json()` on every Ollama response — never `json.loads()` directly.

---

### Step 7 — Prompts (`prompts.py`)

**Source**: All prompts are adapted directly from
`/Users/pushpendersharma/Documents/multistrat/backend/src/api/services/ContractAIService.ts`

---

#### PASS 1: Fixed Fields

**Retrieval query strings** (3 pgvector searches, merge top 10 from each):
- `"contract parties provider client supplier product agreement type"`
- `"start date end date payment terms total amount annual value contract term"`
- `"auto renewal notice period renewal duration owner relationships contract id"`

**Prompt** (adapted from ContractAIService.ts lines 351–540):

```
You are an expert contract analysis system. Extract ONLY the following 20 fixed fields.

FIXED FIELDS:
1. agreement_type - standardized abbreviations: MSA, NDA, SOW, PO, SLA, DPA, BAA, EULA, SCHEDULE, INVOICE, ORDER, etc.
2. provider - service/product provider company name (supplier/vendor)
3. client - customer/client company name
4. product - primary product or service being contracted
5. total_amount - format "CURRENCY_CODE:AMOUNT" e.g. "USD:150000.00". Exclude taxes/VAT.
6. annual_amount - year-by-year breakdown or calculated. Format "Year 1: USD:X, Year 2: USD:Y". "N/A" if undetermined.
7. start_date - YYYY-MM-DD format
8. end_date - YYYY-MM-DD format
9. contract_id - unique identifier, contract number, reference number
10. contract_classification - one of: SAAS|IAAS|PAAS|PROFESSIONAL_SERVICES|MANAGED_SERVICES|HARDWARE|RESELLER|NETWORK|OTHER
11. contract_status - "Active" if currently in effect, "Inactive" if expired/not started, "Unknown" if unclear
12. contract_term - e.g. "24 months". Calculate from dates if not stated. "N/A" if cannot determine.
13. payment_terms - format "X Days | Advanced" or "X Days | Arrears". e.g. "30 Days | Arrears". Default timing to Arrears if only duration given. "N/A" if not specified.
14. auto_renewal - "Yes" or "No". Default "No" if unclear.
15. renewal_notice_period - format "X months" only. e.g. "3 months". Convert days: 30d=1mo, 60d=2mo, 90d=3mo. ONLY the period to prevent auto-renewal, NOT general termination notice. "N/A" if not specified.
16. renewal_duration_period - format "X months" only. Duration of each renewal cycle. "N/A" if auto_renewal=No or not stated.
17. relationships - comma-separated references to other documents mentioned. "N/A" if none.
18. customer_owner - person who owns agreement on client side. Format "Name (Contact Info)" if available. "N/A" if not found.
19. supplier_owner - person who owns agreement on supplier side. Format "Name (Contact Info)" if available. "N/A" if not found.
20. original_filename - the uploaded document filename

CONFIDENCE SCORING (weighted):
- OCR Quality (31%): 0.9-1.0 clear text, 0.7-0.9 minor artifacts, 0.5-0.7 some errors, 0.3-0.5 poor, 0.1-0.3 severe
- Contradiction Check (28%): 0.9-1.0 no contradiction, 0.7-0.9 minor, 0.5-0.7 moderate, 0.3-0.5 significant, 0.1-0.3 major
- Inference Level (23%): 0.9-1.0 explicit, 0.7-0.9 mostly explicit, 0.5-0.7 interpreted, 0.3-0.5 assumed, 0.1-0.3 speculative
- Expected Location (18%): 0.9-1.0 standard section, 0.7-0.9 related section, 0.5-0.7 unusual, 0.3-0.5 very unusual
- Formula: (OCR×0.31) + (Contradiction×0.28) + (Inference×0.23) + (Location×0.18), round to 2 decimals

Return ONLY valid JSON:
{
  "fixed_fields": {
    "agreement_type": { "value": "...", "description": "...", "confidence": 0.0 },
    "provider": { "value": "...", "description": "...", "confidence": 0.0 },
    ... (all 20 fields)
  }
}

Context from contract:
{context}
```

---

#### PASS 2: Dynamic Fields

**Retrieval query string**:
`"contract clauses terms conditions liability data protection payment commercial legal use restrictions"`

**Prompt** (adapted from ContractAIService.ts lines 693–827):

```
You are an expert contract analysis system. Extract ONLY dynamic contract-specific fields organized into categories. Do NOT extract the 20 fixed fields.

Extract EVERY relevant clause and organize into:

- Use rights & restrictions: usage limits, access restrictions, permitted/prohibited uses, geographic restrictions, feature restrictions
- General: SLAs, performance metrics, uptime, support levels, maintenance, delivery timelines, force majeure, insurance, business continuity, auto-renewal provisions, transition requirements. ALWAYS include "contract_description" here.
- Legal terms: liability limitations, indemnification, confidentiality periods, GDPR/privacy compliance, governing law, jurisdiction, dispute resolution, IP rights, warranties
- Commercial terms: payment schedules, billing frequency, late fees, pricing models, cost escalation, discounts, credits, service level credits
- Data protection: data privacy, retention policies, data transfer restrictions, breach notification, encryption, data deletion obligations

MANDATORY: Always include "contract_description" in General:
- value: Comprehensive description of the contract — purpose, scope, key obligations, deliverables, business context
- description: "Detailed contract description with supporting information"
- confidence: 0.0-1.0

EXTRACTION RULES:
- Only extract when 95%+ confident the clause genuinely exists
- Must have significant business impact (time, cost, obligation, legal risk)
- Must be explicitly stated, not implied
- Do NOT extract vague references or boilerplate without specifics
- For monetary values always use "CURRENCY:AMOUNT" format

Return ONLY valid JSON:
{
  "dynamic_fields": {
    "Use rights & restrictions": {
      "field_name": { "value": "...", "description": "...", "confidence": 0.0 }
    },
    "General": {
      "contract_description": { "value": "...", "description": "Detailed contract description", "confidence": 0.0 }
    },
    "Legal terms": {},
    "Commercial terms": {},
    "Data protection": {}
  }
}

Context from contract:
{context}
```

---

#### PASS 3: Special / Supplier Fields

**Retrieval query string**: Built dynamically based on supplier name.
- Oracle: `"oracle license entitlement metric ULA CSI support level"`
- Microsoft: `"microsoft license EA enrollment product terms Azure"`
- SAP: `"SAP license user type named user engine metrics"`
- Generic fallback: `"software license entitlement terms usage metric support"`

**Prompt** (adapted from SupplierMappingService pattern):

After detecting the supplier from fixed_fields.provider (Pass 1 result), build a targeted prompt:

```
You are an expert contract analysis system specializing in {SUPPLIER_NAME} contracts.
Extract the following supplier-specific fields from the contract.

Fields to extract:
{SUPPLIER_FIELD_LIST}  ← from mapping.json in the multistrat project

Each field: { "value": "...", "description": "...", "confidence": 0.0 }
Return null for fields not found.

Return ONLY valid JSON:
{
  "special_fields": {
    "{SUPPLIER_NAME}": {
      "{category}": {
        "field_name": { "value": "...", "description": "...", "confidence": 0.0 }
      }
    }
  }
}

Context from contract:
{context}
```

For MVP, copy the field definitions from:
`/Users/pushpendersharma/Documents/multistrat/backend/src/data/mapping.json`

If supplier is not recognized → skip Pass 3, return empty `special_fields: {}`.

---

### Step 8 — API Endpoints

**`routers/documents.py`**:

| Method | Path | Body | Response |
|--------|------|------|----------|
| POST | `/documents` | multipart file | `202 { document_id, status: "QUEUED" }` |
| GET | `/documents` | — | list of documents with status |
| GET | `/documents/{id}` | — | single doc with status + progress |

**`routers/analysis.py`**:

| Method | Path | Response |
|--------|------|----------|
| POST | `/documents/{id}/analyze` | `202 { message: "Analysis started" }` |
| GET | `/documents/{id}/analysis` | analysis result JSON |

---

### Step 9 — Frontend (Next.js)

**Documents List (`/`)**:
- Table: Filename | Uploaded | Status badge | Progress % | Action
- Status badge colors: QUEUED=gray, PROCESSING=amber, READY=green, FAILED=red
- While any doc is QUEUED or PROCESSING: poll `GET /documents` every 3 seconds
- "Analyze" button: enabled only when READY → POST `/documents/{id}/analyze` → navigate to `/documents/{id}`

**Analysis Result (`/documents/[id]`)**:
- On load: poll `GET /documents/{id}/analysis` every 3 seconds while `status === "RUNNING"`
- Show spinner while RUNNING, show results when DONE, show error message when FAILED
- Three sections: Fixed Fields, Dynamic Fields (by category), Special Fields
- Each field row: Label | Value | Confidence dot (green ≥0.8, yellow ≥0.5, red <0.5)
- Source chunks shown at bottom as collapsible citations

---

## Response Shapes

### `GET /documents`
```json
[
  { "id": "uuid", "filename": "contract.pdf", "status": "READY", "progress": 100, "created_at": "..." }
]
```

### `GET /documents/{id}/analysis`
```json
{
  "status": "DONE",
  "fixed_fields": {
    "start_date": { "value": "2024-01-01", "description": "...", "confidence": 0.95 },
    "provider":   { "value": "Acme Corp",  "description": "...", "confidence": 0.92 }
  },
  "dynamic_fields": {
    "General": {
      "contract_description": { "value": "...", "description": "...", "confidence": 0.88 }
    },
    "Legal terms": { ... },
    "Commercial terms": { ... }
  },
  "special_fields": {},
  "sources": [
    { "pass": "fixed", "chunk_id": "uuid", "preview": "..." }
  ]
}
```

---

## Verification Checklist

- [ ] `docker compose up` starts postgres with pgvector
- [ ] Upload PDF → 202 returned immediately, status=QUEUED shown in UI
- [ ] Status transitions: QUEUED → PROCESSING (with progress %) → READY
- [ ] `chunks` table has rows with non-null `embedding` column
- [ ] Click Analyze → analysis status: RUNNING → DONE
- [ ] `GET /documents/{id}/analysis` returns populated fixed_fields + dynamic_fields JSON
- [ ] UI displays all three field sections with confidence dots
- [ ] Ollama at http://148.113.1.127:11434 is reachable from backend

---

## Start Order

```bash
# 1. Start Postgres
docker compose up -d

# 2. Start backend
cd backend
pip install -r requirements.txt
# create tables (alembic or sqlalchemy create_all on startup)
uvicorn main:app --reload --port 8000

# 3. Start frontend
cd frontend
npm install
npm run dev
```

Backend CORS must allow frontend origin (localhost:3000).

Add to `main.py`:
```python
from fastapi.middleware.cors import CORSMiddleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)
```

---

## Suggested Additions for Better Success Rate

These are not required for the MVP to function, but each one meaningfully improves output quality:

### 1. Ollama Connection Health Check on Startup
Before accepting any uploads, verify Ollama is reachable:
```python
@app.on_event("startup")
async def check_ollama():
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(f"{OLLAMA_BASE_URL}/api/tags", timeout=5)
            r.raise_for_status()
    except Exception as e:
        logger.warning(f"Ollama not reachable: {e}")
```

### 2. Chunk Size Tuning for Legal Docs
The default `chunk_size=800` is generic. For contracts, try `chunk_size=600, chunk_overlap=100`. Legal clauses are typically 100–400 tokens; smaller chunks give more precise retrieval per field.

### 3. Retrieve More, Not Less
Start with `LIMIT 15` in the pgvector query (not 10). More context = fewer missed fields. You can always reduce later if the LLM context overflows.

### 4. Fail Gracefully on Pass 3 (Supplier Fields)
If supplier is not recognized (not Oracle/Microsoft/SAP/etc.), skip Pass 3 completely and store `special_fields: {}`. Do NOT let an unknown supplier break the whole analysis.

### 5. Download Endpoint
Since `file_data` is kept permanently in the DB, expose a download endpoint so users can retrieve the original file:

```
GET /documents/{id}/download
→ Returns file_data as binary response with correct Content-Type and Content-Disposition: attachment; filename="{filename}"
```
