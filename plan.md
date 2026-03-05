# Contract RAG MVP — Plan

## What We're Building

A standalone MVP application where:
1. User uploads a contract document
2. System processes it (Kreuzberg clean → chunk → embed) in the background
3. User sees live processing status (Queued / Processing / Ready / Failed)
4. When Ready, user clicks "Analyze" — system runs RAG extraction with local Ollama
5. Extracted fields (fixed + dynamic + supplier-specific) are stored in DB and shown in UI

No cloud LLMs. Everything is local. Ollama runs on a remote server we own.
**Full TypeScript/Node.js stack — no Python required.**

---

## Ollama Server

```
Base URL:         http://148.113.1.127:11434
Embed model:      nomic-embed-text   (768 dims)
Generation model: gpt-oss            (verify exact name: GET /api/tags)
```

---

## Tech Stack

| Layer | Choice | Notes |
|-------|--------|-------|
| Backend | Express.js + TypeScript | Same as multistrat — familiar |
| Document cleaning | `@kreuzberg/node` | Native Node.js bindings, confirmed 85x faster than Docling |
| Chunking | `@langchain/textsplitters` | RecursiveCharacterTextSplitter |
| Embeddings | Ollama `nomic-embed-text` via HTTP | `fetch` to Ollama API |
| LLM generation | Ollama `gpt-oss` via HTTP | `fetch` to Ollama API |
| Database | PostgreSQL + pgvector | `pgvector/pgvector:pg16` Docker image |
| ORM | Prisma | Same as multistrat — familiar |
| Background tasks | Async fire-and-forget | No Redis needed for MVP |
| Frontend | Next.js | |

---

## Database Schema (3 tables via Prisma)

### `documents`
| Column | Type | Notes |
|--------|------|-------|
| id | String (UUID) PK | |
| filename | String | original filename |
| mimeType | String | application/pdf etc |
| fileData | Bytes | raw uploaded file — kept permanently for download |
| status | String | QUEUED / PROCESSING / READY / FAILED |
| progress | Int | 0–100 |
| errorMessage | String? | nullable |
| rawText | String? | cleaned text from Kreuzberg |
| createdAt | DateTime | |
| updatedAt | DateTime | |

> File size cap: 25MB enforced at upload. Supported types: PDF, DOCX only.

### `chunks`
| Column | Type | Notes |
|--------|------|-------|
| id | String (UUID) PK | |
| documentId | String (FK) | → documents.id |
| chunkIndex | Int | order in document |
| content | String | chunk text |
| pageStart | Int? | citation |
| pageEnd | Int? | citation |
| sectionTitle | String? | heading if detected |
| metadata | Json? | extra info |
| embedding | Unsupported("vector(768)") | pgvector — stored via raw SQL |

Vector index (hnsw — works from 0 rows, no row-count minimum):
```sql
CREATE INDEX idx_chunks_embedding ON chunks USING hnsw (embedding vector_cosine_ops);
```

### `document_analysis`
| Column | Type | Notes |
|--------|------|-------|
| id | String (UUID) PK | |
| documentId | String (FK) UNIQUE | → documents.id — one result per doc |
| status | String | PENDING / RUNNING / DONE / FAILED |
| errorMessage | String? | nullable |
| fixedFields | Json? | 20 extracted fields |
| dynamicFields | Json? | categorical clauses |
| specialFields | Json? | supplier-specific fields |
| sources | Json? | chunk citations |
| modelName | String? | which Ollama model was used |
| createdAt | DateTime | |
| updatedAt | DateTime | |

---

## Project Structure

```
mait-mvp/
├── backend/
│   ├── src/
│   │   ├── index.ts              # Express app entry, CORS, routes
│   │   ├── database.ts           # Prisma client singleton
│   │   ├── config.ts             # env vars
│   │   ├── routes/
│   │   │   ├── documents.ts      # upload, list, status, download
│   │   │   └── analysis.ts       # analyze, get-result
│   │   └── services/
│   │       ├── ingestion.ts      # Kreuzberg → chunk → embed → store
│   │       ├── embedding.ts      # Ollama embed calls
│   │       ├── extraction.ts     # RAG retrieval + Ollama generation (3 passes)
│   │       └── prompts.ts        # all prompt templates
│   ├── prisma/
│   │   └── schema.prisma
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   └── src/
│       ├── app/
│       │   ├── page.tsx                   # documents list
│       │   └── documents/[id]/page.tsx    # analysis result
│       └── components/
│           ├── DocumentList.tsx
│           ├── StatusBadge.tsx
│           └── AnalysisResult.tsx
├── docker-compose.yml
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
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/mait_mvp
OLLAMA_BASE_URL=http://148.113.1.127:11434
EMBED_MODEL=nomic-embed-text
GENERATION_MODEL=gpt-oss
PORT=8000
```

`backend/package.json` dependencies:
```json
{
  "dependencies": {
    "@kreuzberg/node": "latest",
    "@langchain/textsplitters": "latest",
    "@prisma/client": "latest",
    "express": "^5.1.0",
    "multer": "latest",
    "cors": "latest",
    "dotenv": "latest",
    "uuid": "latest"
  },
  "devDependencies": {
    "prisma": "latest",
    "typescript": "latest",
    "@types/express": "latest",
    "@types/multer": "latest",
    "@types/cors": "latest",
    "@types/uuid": "latest",
    "tsx": "latest"
  }
}
```

---

### Step 3 — Prisma Schema

`backend/prisma/schema.prisma`:
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Document {
  id           String    @id @default(uuid())
  filename     String
  mimeType     String
  fileData     Bytes
  status       String    @default("QUEUED")
  progress     Int       @default(0)
  errorMessage String?
  rawText      String?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  chunks   Chunk[]
  analysis DocumentAnalysis?
}

model Chunk {
  id           String   @id @default(uuid())
  documentId   String
  chunkIndex   Int
  content      String
  pageStart    Int?
  pageEnd      Int?
  sectionTitle String?
  metadata     Json?
  // embedding stored via raw SQL: vector(768)
  document     Document @relation(fields: [documentId], references: [id])

  @@index([documentId])
}

model DocumentAnalysis {
  id            String   @id @default(uuid())
  documentId    String   @unique
  status        String   @default("PENDING")
  errorMessage  String?
  fixedFields   Json?
  dynamicFields Json?
  specialFields Json?
  sources       Json?
  modelName     String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  document Document @relation(fields: [documentId], references: [id])
}
```

After schema is defined, run:
```bash
npx prisma migrate dev --name init
```

Then add the vector extension, column and index manually (Prisma can't manage `vector` type).
Connect to Postgres and run **in order**:
```sql
-- 1. Enable pgvector extension (must run before vector column can be created)
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Add embedding column
ALTER TABLE "Chunk" ADD COLUMN IF NOT EXISTS embedding vector(768);

-- 3. Add HNSW index (works from 0 rows — no row-count minimum unlike ivfflat)
CREATE INDEX IF NOT EXISTS idx_chunks_embedding ON "Chunk" USING hnsw (embedding vector_cosine_ops);
```

Quick one-liner via psql:
```bash
psql postgresql://postgres:postgres@localhost:5432/mait_mvp \
  -c "CREATE EXTENSION IF NOT EXISTS vector;" \
  -c "ALTER TABLE \"Chunk\" ADD COLUMN IF NOT EXISTS embedding vector(768);" \
  -c "CREATE INDEX IF NOT EXISTS idx_chunks_embedding ON \"Chunk\" USING hnsw (embedding vector_cosine_ops);"
```

---

### Step 4 — Ingestion Service (`services/ingestion.ts`)

Called as fire-and-forget after upload (`void ingestDocument(id)` — no await).

```typescript
import { extractBytes } from '@kreuzberg/node';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { embed } from './embedding';
import { prisma } from '../database';

export async function ingestDocument(documentId: string): Promise<void> {
  try {
    // 1. Fetch document from DB
    const doc = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });

    // 2. Set PROCESSING
    await prisma.document.update({ where: { id: documentId }, data: { status: 'PROCESSING', progress: 5 } });

    // 3. Extract text — extractBytes takes Uint8Array + mimeType, returns result.content
    const result = await extractBytes(new Uint8Array(doc.fileData), doc.mimeType);
    const rawText = result.content;
    await prisma.document.update({ where: { id: documentId }, data: { rawText, progress: 30 } });

    // 4. Chunk
    const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 600, chunkOverlap: 100 });
    const chunks = await splitter.splitText(rawText);
    await prisma.document.update({ where: { id: documentId }, data: { progress: 50 } });

    // 5. Delete old chunks (idempotency)
    await prisma.chunk.deleteMany({ where: { documentId } });

    // 6. Embed and store each chunk
    for (let i = 0; i < chunks.length; i++) {
      const chunkText = chunks[i];
      const embedding = await embed(chunkText);
      const chunk = await prisma.chunk.create({
        data: { documentId, chunkIndex: i, content: chunkText },
      });
      // Store embedding via raw SQL (Prisma can't handle vector type)
      await prisma.$executeRawUnsafe(
        `UPDATE "Chunk" SET embedding = $1::vector WHERE id = $2`,
        `[${embedding.join(',')}]`,
        chunk.id
      );
    }

    // 7. Done
    await prisma.document.update({ where: { id: documentId }, data: { status: 'READY', progress: 100 } });
  } catch (err) {
    await prisma.document.update({
      where: { id: documentId },
      data: { status: 'FAILED', errorMessage: String(err) },
    });
  }
}
```

---

### Step 5 — Embedding Service (`services/embedding.ts`)

```typescript
import { OLLAMA_BASE_URL, EMBED_MODEL } from '../config';

export async function embed(text: string): Promise<number[]> {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
    signal: AbortSignal.timeout(30_000),
  });
  const data = await response.json() as { embedding: number[] };
  return data.embedding;
}
```

---

### Step 6 — Extraction Service (`services/extraction.ts`)

Three sequential passes when user clicks "Analyze".

```typescript
export async function analyzeDocument(documentId: string): Promise<void> {
  try {
    // Upsert analysis row → RUNNING
    await prisma.documentAnalysis.upsert({
      where: { documentId },
      create: { documentId, status: 'RUNNING' },
      update: { status: 'RUNNING', errorMessage: null },
    });

    // Run 3 passes
    const fixedFields = await runPass(documentId, FIXED_QUERY, FIXED_PROMPT);
    const dynamicFields = await runPass(documentId, DYNAMIC_QUERY, DYNAMIC_PROMPT);

    // Pass 3: detect supplier from Pass 1 result, build targeted query/prompt
    const supplier = fixedFields?.fixed_fields?.provider?.value ?? null;
    const specialFields = await runSupplierPass(documentId, supplier);

    await prisma.documentAnalysis.update({
      where: { documentId },
      data: { status: 'DONE', fixedFields, dynamicFields, specialFields, modelName: GENERATION_MODEL },
    });
  } catch (err) {
    await prisma.documentAnalysis.update({
      where: { documentId },
      data: { status: 'FAILED', errorMessage: String(err) },
    });
  }
}

async function runPass(documentId: string, queryText: string, promptTemplate: string) {
  const queryEmbedding = await embed(queryText);
  // pgvector cosine similarity search
  const chunks = await prisma.$queryRawUnsafe<{ id: string; content: string }[]>(
    `SELECT id, content FROM "Chunk"
     WHERE "documentId" = $1
     ORDER BY embedding <-> $2::vector
     LIMIT 15`,
    documentId,
    `[${queryEmbedding.join(',')}]`
  );
  const context = chunks.map((c, i) => `[${i + 1}] ${c.content}`).join('\n\n');
  const prompt = promptTemplate.replace('{context}', context);
  const raw = await ollamaGenerate(prompt);
  return parseLLMJson(raw);
}
```

Ollama generate:
```typescript
async function ollamaGenerate(prompt: string): Promise<string> {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: GENERATION_MODEL, prompt, stream: false, format: 'json' }),
    signal: AbortSignal.timeout(120_000),
  });
  const data = await response.json() as { response: string };
  return data.response;
}
```

`runSupplierPass` — detects supplier from Pass 1 result, looks up field definitions in `mapping.json`, runs Pass 3 (or returns `{}` if supplier unknown):
```typescript
const SUPPLIER_QUERIES: Record<string, string> = {
  oracle:    'oracle license entitlement ULA CSI metric support level',
  microsoft: 'microsoft license EA enrollment product terms Azure',
  sap:       'SAP license named user engine metric',
};

async function runSupplierPass(documentId: string, supplierRaw: string | null): Promise<unknown> {
  if (!supplierRaw) return {};
  const key = Object.keys(SUPPLIER_QUERIES).find(k =>
    supplierRaw.toLowerCase().includes(k)
  );
  if (!key) return {}; // unknown supplier — skip Pass 3

  const mapping = await import('../data/mapping.json', { assert: { type: 'json' } });
  const supplierData = (mapping as Record<string, unknown>)[key];
  if (!supplierData) return {};

  const fieldList = JSON.stringify(supplierData, null, 2);
  const query = SUPPLIER_QUERIES[key];
  const prompt = SUPPLIER_PROMPT
    .replace('{SUPPLIER_NAME}', key)
    .replace('{SUPPLIER_FIELD_LIST}', fieldList)
    .replace('{context}', '{context}'); // runPass handles context injection

  return runPass(documentId, query, prompt);
}
```

Robust JSON parser (LLMs often wrap output in markdown fences):
```typescript
function parseLLMJson(raw: string): unknown {
  raw = raw.trim();
  // Strip markdown code fences
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error(`Cannot parse LLM JSON: ${raw.slice(0, 200)}`);
  }
}
```

> **Always use `parseLLMJson()`** on every Ollama response — never `JSON.parse()` directly.

---

### Step 7 — Prompts (`services/prompts.ts`)

**Source**: Adapted directly from
`/Users/pushpendersharma/Documents/multistrat/backend/src/api/services/ContractAIService.ts`

---

#### PASS 1: Fixed Fields

**Query string**: `"contract parties provider client supplier product agreement type start date end date payment terms total amount renewal"`

**Prompt** (from ContractAIService.ts lines 351–540):
```
You are an expert contract analysis system. Extract ONLY the following 20 fixed fields.

FIXED FIELDS:
1. agreement_type — MSA, NDA, SOW, PO, SLA, DPA, BAA, EULA, SCHEDULE, INVOICE, ORDER, etc.
2. provider — supplier/vendor company name
3. client — customer/client company name
4. product — primary product or service
5. total_amount — "CURRENCY_CODE:AMOUNT" e.g. "USD:150000.00". Exclude taxes.
6. annual_amount — "Year 1: USD:X, Year 2: USD:Y" or calculated annual rate. "N/A" if unknown.
7. start_date — YYYY-MM-DD
8. end_date — YYYY-MM-DD
9. contract_id — contract number or reference
10. contract_classification — SAAS|IAAS|PAAS|PROFESSIONAL_SERVICES|MANAGED_SERVICES|HARDWARE|RESELLER|NETWORK|OTHER
11. contract_status — "Active" / "Inactive" / "Unknown"
12. contract_term — e.g. "24 months". Calculate from dates if not stated. "N/A" if unknown.
13. payment_terms — "X Days | Advanced" or "X Days | Arrears". Default to Arrears if timing not stated. "N/A" if absent.
14. auto_renewal — "Yes" or "No". Default "No" if unclear.
15. renewal_notice_period — "X months" only. 30d=1mo, 60d=2mo, 90d=3mo. ONLY the period to prevent auto-renewal. "N/A" if absent.
16. renewal_duration_period — "X months" only. Duration of each renewal cycle. "N/A" if auto_renewal=No.
17. relationships — comma-separated references to other documents. "N/A" if none.
18. customer_owner — client-side owner. "Name (Contact)" if available. "N/A" if not found.
19. supplier_owner — supplier-side owner. "Name (Contact)" if available. "N/A" if not found.
20. original_filename — the document filename

CONFIDENCE SCORING (weighted average, round to 2 decimals):
- OCR Quality (31%): 1.0 clear text → 0.1 severe issues
- Contradiction Check (28%): 1.0 no conflict → 0.1 major contradiction
- Inference Level (23%): 1.0 explicit → 0.1 speculative
- Expected Location (18%): 1.0 standard section → 0.1 not where expected

Return ONLY valid JSON — no markdown, no explanation:
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

**Query string**: `"contract clauses terms conditions liability data protection payment commercial legal use restrictions SLA confidentiality"`

**Prompt** (from ContractAIService.ts lines 693–827):
```
You are an expert contract analysis system. Extract dynamic contract-specific clauses organized into categories. Do NOT extract the 20 fixed fields.

Categories:
- Use rights & restrictions: usage limits, geographic restrictions, feature restrictions, prohibited activities
- General: SLAs, uptime, support levels, maintenance, force majeure, business continuity. ALWAYS include "contract_description".
- Legal terms: liability cap, indemnification, confidentiality, governing law, jurisdiction, dispute resolution, IP rights
- Commercial terms: billing frequency, late fees, pricing models, cost escalation, credits, discounts
- Data protection: retention policy, data transfer, breach notification, encryption, deletion obligations

MANDATORY — always include "contract_description" in General:
- value: Purpose, scope, key obligations, deliverables, business context
- description: "Detailed contract description"

EXTRACTION RULES:
- Only extract when 95%+ confident the clause genuinely exists
- Must have significant business impact
- Must be explicitly stated — not implied or assumed
- Monetary values: always use "CURRENCY:AMOUNT" format

Return ONLY valid JSON:
{
  "dynamic_fields": {
    "Use rights & restrictions": { "field_name": { "value": "...", "description": "...", "confidence": 0.0 } },
    "General": { "contract_description": { "value": "...", "description": "Detailed contract description", "confidence": 0.0 } },
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

**Query string** — built dynamically from supplier detected in Pass 1:
- Oracle → `"oracle license entitlement ULA CSI metric support level"`
- Microsoft → `"microsoft license EA enrollment product terms Azure"`
- SAP → `"SAP license named user engine metric"`
- Unknown supplier → skip Pass 3, return `{}`

**Setup**: Copy `mapping.json` from multistrat into this project:
```bash
cp /Users/pushpendersharma/Documents/multistrat/backend/src/data/mapping.json \
   /Users/pushpendersharma/Documents/mait-mvp/backend/src/data/mapping.json
```
The file is referenced at runtime via `import mapping from '../data/mapping.json'`.

**Prompt**: targeted extraction using field definitions from `mapping.json`

```
You are a contract analysis specialist for {SUPPLIER_NAME} contracts.
Extract the following supplier-specific fields. Return null for any not found.

Fields:
{SUPPLIER_FIELD_LIST}

Return ONLY valid JSON:
{
  "special_fields": {
    "{SUPPLIER_NAME}": {
      "{category}": { "field_name": { "value": "...", "description": "...", "confidence": 0.0 } }
    }
  }
}

Context from contract:
{context}
```

---

### Step 8 — API Endpoints

**`routes/documents.ts`**:

> Multer MUST use `memoryStorage` so `req.file.buffer` is available (file never touches disk):
> ```typescript
> const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
> // In upload handler: fileData = req.file.buffer
> ```

| Method | Path | Notes |
|--------|------|-------|
| POST | `/documents` | multer upload (memoryStorage) → save to DB → 202 → `void ingestDocument(id)` |
| GET | `/documents` | list with status + progress |
| GET | `/documents/:id` | single doc status |
| GET | `/documents/:id/download` | stream `fileData` with original filename |

**`routes/analysis.ts`**:

| Method | Path | Notes |
|--------|------|-------|
| POST | `/documents/:id/analyze` | check status=READY → 202 → `void analyzeDocument(id)` |
| GET | `/documents/:id/analysis` | returns DocumentAnalysis row |

---

### Step 9 — Frontend (Next.js)

**Documents List (`/`)**:
- Table: Filename | Uploaded | Status badge | Progress % | Action button
- Status badge: QUEUED=gray, PROCESSING=amber, READY=green, FAILED=red
- Poll `GET /documents` every 3s while any doc is QUEUED or PROCESSING
- Action: disabled unless READY → "Analyze" → `POST /documents/{id}/analyze` → navigate to `/documents/{id}`

**Analysis Result (`/documents/[id]`)**:
- Poll `GET /documents/{id}/analysis` every 3s while `status === "RUNNING"`
- Show spinner while RUNNING, results when DONE, error when FAILED
- Three sections: Fixed Fields | Dynamic Fields (by category) | Special Fields
- Each field row: Label | Value | Confidence dot (green ≥0.8, yellow ≥0.5, red <0.5)
- Source chunks collapsible at bottom

---

## Response Shapes

### `GET /documents`
```json
[{ "id": "uuid", "filename": "contract.pdf", "status": "READY", "progress": 100, "createdAt": "..." }]
```

### `GET /documents/:id/analysis`
```json
{
  "status": "DONE",
  "fixedFields": {
    "start_date": { "value": "2024-01-01", "description": "...", "confidence": 0.95 },
    "provider":   { "value": "Acme Corp",  "description": "...", "confidence": 0.92 }
  },
  "dynamicFields": {
    "General": { "contract_description": { "value": "...", "confidence": 0.88 } },
    "Legal terms": {},
    "Commercial terms": {}
  },
  "specialFields": {}
}
```

---

## CORS Config (`index.ts`)

```typescript
import cors from 'cors';
app.use(cors({ origin: 'http://localhost:3000' }));
```

---

## Verification Checklist

- [ ] `docker compose up` → Postgres with pgvector running
- [ ] Upload PDF → 202 returned immediately, status=QUEUED in UI
- [ ] Status transitions in UI: QUEUED → PROCESSING (with %) → READY
- [ ] `Chunk` table has rows with non-null `embedding` column
- [ ] Click Analyze → analysis status: RUNNING → DONE
- [ ] `GET /documents/:id/analysis` returns populated fixedFields + dynamicFields JSON
- [ ] UI shows all three sections with confidence dots
- [ ] Ollama at `http://148.113.1.127:11434` reachable from backend

---

## Start Order

```bash
# 1. Start Postgres
docker compose up -d

# 2. Start backend
cd backend
npm install
npx prisma migrate dev --name init
# Then run vector column SQL manually (see Step 3)
npm run dev   # tsx src/index.ts --watch

# 3. Start frontend
cd frontend
npm install
npm run dev
```

---

## Suggested Additions for Better Success Rate

Not required for MVP but meaningfully improve output quality:

### 1. Ollama Health Check on Startup
```typescript
app.listen(PORT, async () => {
  try {
    const r = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    console.log('Ollama reachable');
  } catch (e) {
    console.warn('Ollama not reachable:', e);
  }
});
```

### 2. Chunk Size Tuning
`chunkSize: 600, chunkOverlap: 100` — legal clauses are 100–400 tokens, smaller chunks = more precise retrieval.

### 3. Retrieve More Chunks
Use `LIMIT 15` instead of 10 — more context = fewer missed fields.

### 4. Graceful Skip on Unknown Supplier
If supplier not recognized → skip Pass 3, store `specialFields: {}`. Don't let Pass 3 break the whole analysis.

### 5. Download Endpoint
`GET /documents/:id/download` — stream `fileData` with `Content-Disposition: attachment; filename="..."`.
