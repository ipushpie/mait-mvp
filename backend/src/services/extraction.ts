import { config } from '../utils/config';
import { prisma } from '../utils/database';
import { embed } from './embedding';
import { logger, elapsed } from '../utils/logger';

const TAG = 'Analysis';
import {
  FIXED_QUERY,
  FIXED_PROMPT,
  DYNAMIC_QUERY,
  DYNAMIC_PROMPT,
  SUPPLIER_PROMPT,
} from './prompts';

// Supplier-specific query strings
const SUPPLIER_QUERIES: Record<string, string> = {
  oracle: 'oracle license entitlement ULA CSI metric support level',
  microsoft: 'microsoft license EA enrollment product terms Azure',
  sap: 'SAP license named user engine metric',
  'red-hat': 'red hat subscription SKU support tier renewal audit',
  salesforce: 'salesforce subscription order form MSA edition org license',
  servicenow: 'servicenow subscription unit order form instance SLA support',
};

// In-memory cache for static query embeddings — these strings never change so
// we only embed them once per server lifetime instead of once per analysis.
const embeddingCache = new Map<string, number[]>();

async function getCachedEmbedding(text: string): Promise<number[]> {
  const cached = embeddingCache.get(text);
  if (cached) return cached;
  const vector = await embed(text);
  embeddingCache.set(text, vector);
  logger.debug(TAG, `EmbedCache: stored new embedding`, { preview: text.slice(0, 60) });
  return vector;
}

export async function analyzeDocument(documentId: string): Promise<void> {
  const t0 = Date.now();
  try {
    // Read any existing partial results so we can resume from the right pass
    const prior = await prisma.documentAnalysis.findUnique({ where: { documentId } });
    const hasPass1 = prior?.fixedFields != null && prior.fixedFields !== null;
    const hasPass2 = prior?.dynamicFields != null && prior.dynamicFields !== null;

    // Upsert analysis row → RUNNING
    await prisma.documentAnalysis.upsert({
      where: { documentId },
      create: { documentId, status: 'RUNNING' },
      update: { status: 'RUNNING', errorMessage: null },
    });

    logger.info(TAG, `Starting analysis`, { documentId, resumeFrom: hasPass2 ? 'Pass 3' : hasPass1 ? 'Pass 2' : 'Pass 1' });

    // Pass 1: Fixed fields (skip if already saved)
    let fixedFields: unknown;
    if (hasPass1) {
      fixedFields = prior!.fixedFields;
      logger.info(TAG, `Pass 1 skipped — using existing fixedFields`, { documentId });
    } else {
      fixedFields = await timedPass('Pass 1 Fixed', () =>
        runPass(documentId, FIXED_QUERY, FIXED_PROMPT)
      );
      await prisma.documentAnalysis.update({
        where: { documentId },
        data: { fixedFields: fixedFields as any, modelName: config.generationModel },
      });
      logger.info(TAG, `Pass 1 saved`, { documentId });
    }

    // Pass 2: Dynamic fields (skip if already saved)
    if (hasPass2) {
      logger.info(TAG, `Pass 2 skipped — using existing dynamicFields`, { documentId });
    } else {
      const dynamicFields = await timedPass('Pass 2 Dynamic', () =>
        runPass(documentId, DYNAMIC_QUERY, DYNAMIC_PROMPT)
      );
      await prisma.documentAnalysis.update({
        where: { documentId },
        data: { status: 'PARTIAL', dynamicFields: dynamicFields as any },
      });
      logger.info(TAG, `Pass 2 saved (PARTIAL)`, { documentId });
    }

    // Pass 3: Supplier-specific fields — non-fatal if it fails
    logger.info(TAG, `Pass 3 starting — supplier fields`, { documentId });
    const provider = extractProviderValue(fixedFields);
    let specialFields: unknown = {};
    try {
      specialFields = await timedPass('Pass 3 Supplier', () =>
        runSupplierPass(documentId, provider)
      );
    } catch (err) {
      logger.warn(TAG, `Pass 3 failed (non-fatal), skipping supplier fields`, { documentId, err: String(err) });
    }

    await prisma.documentAnalysis.update({
      where: { documentId },
      data: {
        status: 'DONE',
        specialFields: specialFields as any,
      },
    });

    logger.info(TAG, `Analysis complete`, { documentId, elapsed: elapsed(t0) });
  } catch (err) {
    logger.error(TAG, `Analysis failed`, err as Error, { documentId, elapsed: elapsed(t0) });
    await prisma.documentAnalysis.update({
      where: { documentId },
      data: { status: 'FAILED', errorMessage: String(err) },
    }).catch((dbErr) => logger.error(TAG, 'DB error updating to FAILED', dbErr as Error, { documentId }));
  }
}

async function timedPass<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  logger.info(TAG, `${label} started`);
  const result = await fn();
  logger.info(TAG, `${label} completed`, { elapsed: elapsed(start) });
  return result;
}

async function runPass(
  documentId: string,
  queryText: string,
  promptTemplate: string
): Promise<unknown> {
  const queryEmbedding = await getCachedEmbedding(queryText);

  if (!queryEmbedding || queryEmbedding.length === 0) {
    throw new Error(`Embedding returned empty vector for query: "${queryText.slice(0, 80)}"`);
  }

  // pgvector cosine similarity search
  const chunks = await prisma.$queryRawUnsafe<{ id: string; content: string }[]>(
    `SELECT id, content FROM "Chunk"
     WHERE "documentId" = $1
     ORDER BY embedding <=> $2::vector
     LIMIT 5`,
    documentId,
    `[${queryEmbedding.join(',')}]`
  );

  if (chunks.length === 0) {
    throw new Error('No chunks found for document. Has it been ingested?');
  }

  const context = chunks.map((c, i) => `[${i + 1}] ${c.content}`).join('\n\n');
  const currentDate = new Date().toISOString().split('T')[0];
  const prompt = promptTemplate
    .replace('{currentDate}', currentDate)
    .replace('{exclusionText}', '')
    .replace('{context}', context);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const raw = await ollamaGenerateWithRetry(prompt);
    try {
      return parseLLMJson(raw);
    } catch (err) {
      if (attempt === MAX_RETRIES) throw err;
      logger.warn(TAG, `JSON parse failed, retrying`, { attempt, maxRetries: MAX_RETRIES });
    }
  }
  throw new Error('Unreachable');
}

async function runSupplierPass(
  documentId: string,
  supplierRaw: string | null
): Promise<unknown> {
  if (!supplierRaw) return {};

  const providerLower = supplierRaw.toLowerCase();
  const key = Object.keys(SUPPLIER_QUERIES).find((k) => providerLower.includes(k)) ?? 'general';

  let supplierData: Record<string, unknown> = {};
  try {
    const mapping = await import('../data/mapping.json');
    const mappingData = mapping.default || mapping;
    supplierData = (mappingData as Record<string, unknown>)[key] as Record<string, unknown> || {};
    // If specific supplier has no data, fall back to general
    if (Object.keys(supplierData).length === 0) {
      supplierData = (mappingData as Record<string, unknown>)['general'] as Record<string, unknown> || {};
    }
  } catch {
    logger.warn(TAG, `No mapping data for supplier, skipping Pass 3`, { key });
    return {};
  }

  if (Object.keys(supplierData).length === 0) return {};

  const fieldList = JSON.stringify(supplierData, null, 2);
  const query = SUPPLIER_QUERIES[key];
  // No query defined for this key (e.g. 'general') — skip Pass 3
  if (!query) {
    logger.warn(TAG, `No supplier query for key, skipping Pass 3`, { key });
    return {};
  }
  const prompt = SUPPLIER_PROMPT
    .replace('{SUPPLIER_NAME}', key)
    .replace('{SUPPLIER_FIELD_LIST}', fieldList);

  return runPass(documentId, query, prompt);
}

const MAX_RETRIES = 2;

async function ollamaGenerateWithRetry(prompt: string): Promise<string> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const content = await ollamaGenerate(prompt);
    if (content.length > 0) return content;
    logger.warn(TAG, `Empty LLM response, retrying`, { attempt, maxRetries: MAX_RETRIES });
  }
  throw new Error('Ollama returned empty response after all retries');
}

async function ollamaGenerate(prompt: string): Promise<string> {
  const response = await fetch(`${config.ollamaBaseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.generationModel,
      prompt,
      stream: false,
      format: 'json',
      keep_alive: -1,
      options: {
        temperature: 0.1,
        num_ctx: 8192,
        num_predict: 8192,
      },
    }),
    signal: AbortSignal.timeout(900_000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Ollama generate failed: ${response.status} ${response.statusText} - ${body}`);
  }

  const data = (await response.json()) as { response?: string };
  const content = data.response || '';
  logger.info(TAG, `Ollama response received`, { chars: content.length });
  return content;
}

function parseLLMJson(raw: string): unknown {
  raw = raw.trim();

  // 1. Strip <think>...</think> blocks (reasoning models like qwen/deepseek)
  raw = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // 2. Strip markdown code fences
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  raw = raw.trim();

  // 3. Try direct parse
  try {
    return JSON.parse(raw);
  } catch {
    // ignore
  }

  // 4. Find the outermost JSON object — scan forward from first { and also
  //    backwards from last } (reasoning models often put JSON at the end)
  const extractJson = (text: string): unknown | null => {
    // Forward scan: first { to matching }
    const fwd = text.indexOf('{');
    if (fwd !== -1) {
      let depth = 0;
      for (let i = fwd; i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') {
          depth--;
          if (depth === 0) {
            try { return JSON.parse(text.slice(fwd, i + 1)); } catch { break; }
          }
        }
      }
    }
    // Backward scan: last } to matching {
    const bwd = text.lastIndexOf('}');
    if (bwd !== -1) {
      let depth = 0;
      for (let i = bwd; i >= 0; i--) {
        if (text[i] === '}') depth++;
        else if (text[i] === '{') {
          depth--;
          if (depth === 0) {
            try { return JSON.parse(text.slice(i, bwd + 1)); } catch { break; }
          }
        }
      }
    }
    return null;
  };

  const extracted = extractJson(raw);
  if (extracted !== null) return extracted;

  logger.error(TAG, `Failed to parse LLM JSON`, undefined, { rawPreview: raw.slice(0, 500) });
  throw new Error(`Cannot parse LLM JSON: ${raw.slice(0, 200)}`);  
}

function extractProviderValue(fixedFields: unknown): string | null {
  if (!fixedFields || typeof fixedFields !== 'object') return null;
  const ff = fixedFields as Record<string, unknown>;
  const fields = (ff.fixed_fields || ff) as Record<string, unknown>;
  const provider = fields.provider as { value?: string } | undefined;
  return provider?.value ?? null;
}
