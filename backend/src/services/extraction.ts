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

    // Passes: try to combine Pass 1 + Pass 2 into a single LLM call when
    // neither has been performed yet. This reduces total model latency.
    let fixedFields: unknown = null;
    let dynamicFields: unknown = null;

    if (!hasPass1 && !hasPass2) {
      const combined = await timedPass('Combined Pass 1+2', () => runCombinedPass(documentId));
      // Normalize LLM output shapes so frontend always receives FieldValue objects
      const rawFixed = (combined as any)?.fixed_fields ?? null;
      const rawDynamic = (combined as any)?.dynamic_fields ?? null;
      const normalizedFixed = normalizeFixedFields(rawFixed);
      const normalizedDynamic = normalizeDynamicFields(rawDynamic);
      fixedFields = normalizedFixed;
      dynamicFields = normalizedDynamic;
      await prisma.documentAnalysis.update({
        where: { documentId },
        data: {
          fixedFields: normalizedFixed as any,
          dynamicFields: normalizedDynamic as any,
          modelName: config.generationModel,
          status: Object.keys(normalizedDynamic || {}).length > 0 ? 'PARTIAL' : 'RUNNING',
        },
      });
      logger.info(TAG, `Combined pass saved`, { documentId });
    } else {
      // Existing behavior: load or run Pass 1
      if (hasPass1) {
        fixedFields = prior!.fixedFields;
        logger.info(TAG, `Pass 1 skipped — using existing fixedFields`, { documentId });
      } else {
        const rawFixed = await timedPass('Pass 1 Fixed', () => runPassWithAutoExpand(documentId, FIXED_QUERY, FIXED_PROMPT));
        const normalizedFixed = normalizeFixedFields(rawFixed);
        fixedFields = normalizedFixed;
        await prisma.documentAnalysis.update({ where: { documentId }, data: { fixedFields: normalizedFixed as any, modelName: config.generationModel } });
        logger.info(TAG, `Pass 1 saved`, { documentId });
      }

      // Pass 2: Dynamic fields (skip if already saved)
      if (hasPass2) {
        dynamicFields = prior!.dynamicFields;
        logger.info(TAG, `Pass 2 skipped — using existing dynamicFields`, { documentId });
      } else {
        const rawDynamic = await timedPass('Pass 2 Dynamic', () => runPassWithAutoExpand(documentId, DYNAMIC_QUERY, DYNAMIC_PROMPT));
        const normalizedDynamic = normalizeDynamicFields(rawDynamic);
        dynamicFields = normalizedDynamic;
        await prisma.documentAnalysis.update({ where: { documentId }, data: { status: Object.keys(normalizedDynamic || {}).length > 0 ? 'PARTIAL' : 'RUNNING', dynamicFields: normalizedDynamic as any } });
        logger.info(TAG, `Pass 2 saved (PARTIAL)`, { documentId });
      }
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
  promptTemplate: string,
  options?: { includeAllChunks?: boolean; chunkTruncate?: number; timeoutMs?: number; chunkLimit?: number }
): Promise<unknown> {
  const queryEmbedding = await getCachedEmbedding(queryText);

  if (!queryEmbedding || queryEmbedding.length === 0) {
    throw new Error(`Embedding returned empty vector for query: "${queryText.slice(0, 80)}"`);
  }

  let chunks: { id: string; content: string }[] = [];
  const includeAll = options?.includeAllChunks ?? config.includeAllChunksInPrompt;
  const overrideTruncate = options?.chunkTruncate;

  if (includeAll) {
    // Include all chunks from the document (ordered) when the flag is enabled.
    chunks = await prisma.$queryRawUnsafe<{ id: string; content: string }[]>(
      `SELECT id, content FROM "Chunk"
       WHERE "documentId" = $1
       ORDER BY "chunkIndex" ASC`,
      documentId
    );
  } else {
    // pgvector cosine similarity search (default) — return top-N chunks
    const limit = options?.chunkLimit ?? (config as any).targetChunks ?? 15;
    chunks = await prisma.$queryRawUnsafe<{ id: string; content: string }[]>(
      `SELECT id, content FROM "Chunk"
       WHERE "documentId" = $1
       ORDER BY embedding <=> $2::vector
       LIMIT $3`,
      documentId,
      `[${queryEmbedding.join(',')}]`,
      limit
    );
  }

  if (chunks.length === 0) {
    throw new Error('No chunks found for document. Has it been ingested?');
  }

  // Truncate chunk content to limit prompt size and speed up model inference
  const CHUNK_TRUNCATE = overrideTruncate ?? 800; // chars per chunk included in prompt
  const context = chunks
    .map((c, i) => `[${i + 1}] ${String(c.content).slice(0, CHUNK_TRUNCATE)}`)
    .join('\n\n');
  const currentDate = new Date().toISOString().split('T')[0];
  const prompt = promptTemplate
    .replace('{currentDate}', currentDate)
    .replace('{exclusionText}', '')
    .replace('{context}', context);

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const raw = await ollamaGenerateWithRetry(prompt, options?.timeoutMs);
    try {
      return parseLLMJson(raw);
    } catch (err) {
      logger.warn(TAG, `JSON parse failed`, { attempt, maxRetries: MAX_RETRIES });
      // Print raw model output to console for debugging
      // eslint-disable-next-line no-console
      console.error('LLM raw response (parse failed):\n', raw);

      // Try a repair pass: give the model its original prompt and its
      // previous output and ask it to return ONLY the valid JSON object.
      try {
        const repairPrompt = `Original prompt:\n${prompt}\n\nModel output:\n${raw}\n\n` +
          'Your task: Return ONLY a single valid JSON object that satisfies the Original prompt. ' +
          'Do NOT include any explanation, markdown, or extra text. Return a single JSON object starting with { and ending with }.';
        const repaired = await ollamaGenerateWithRetry(repairPrompt, options?.timeoutMs);
        // Print repair response to console as well
        // eslint-disable-next-line no-console
        console.error('LLM repair response:\n', repaired);
        try {
          return parseLLMJson(repaired);
        } catch (repairErr) {
          logger.warn(TAG, `Repair attempt failed to produce valid JSON`, { repairPreview: repaired.slice(0, 400) });
        }
      } catch (repairCallErr) {
        logger.warn(TAG, `Repair attempt failed (LLM)`, { error: String(repairCallErr) });
      }

      if (attempt === MAX_RETRIES) throw err;
    }
  }
  throw new Error('Unreachable');
}

// Helper: run the pass and if parsed fixed fields are mostly empty, retry
// once with the full document included to give the model more context.
async function runPassWithAutoExpand(
  documentId: string,
  queryText: string,
  promptTemplate: string
): Promise<unknown> {
  // Always use the configured target chunk count for a single pass. Do not
  // retry or restart the model run based on how many fields are empty.
  const target = (config as any).targetChunks ?? 15;
  return runPass(documentId, queryText, promptTemplate, { chunkLimit: target });
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

async function runCombinedPass(documentId: string): Promise<unknown> {
  const combinedQuery = `${FIXED_QUERY} ${DYNAMIC_QUERY}`;

  // A concise, unambiguous combined prompt that asks for a single JSON
  // object containing `fixed_fields` and `dynamic_fields`. Keep the
  // structure explicit to reduce the model producing explanation text.
  const combinedPromptTemplate = `You are a contract analysis JSON extraction engine. The current date is {currentDate}.

You MUST respond with ONLY a single valid JSON object and nothing else. The JSON object MUST have exactly two top-level keys: "fixed_fields" and "dynamic_fields".

"fixed_fields" should be an object containing the standard fixed fields (agreement_type, provider, client, product, total_amount, annual_amount, contract_term, start_date, end_date, payment_terms, renewal, termination, governing_law, notice_address). For any missing value, use null. For numeric amounts, use the format "CURRENCY:AMOUNT" where possible.

"dynamic_fields" should be an object or array containing extracted clause summaries (key: short summary or extracted clause text).

Use the following CONTEXT to extract values. If a field cannot be found, set it to null. Do NOT output any explanation, lists, or markdown — return only the JSON object.

Context:
{context}
`;

  // Pass the template (with {context}) to runPassWithAutoExpand so it can
  // insert the actual retrieved chunks as context. The auto-expand helper
  // will retry with all chunks if the first pass returns mostly empty fields.
  return runPassWithAutoExpand(documentId, combinedQuery, combinedPromptTemplate);
}

const MAX_RETRIES = 2;

async function ollamaGenerateWithRetry(prompt: string, overrideTimeoutMs?: number): Promise<string> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const content = await ollamaGenerate(prompt, overrideTimeoutMs);
    if (content.length > 0) return content;
    logger.warn(TAG, `Empty LLM response, retrying`, { attempt, maxRetries: MAX_RETRIES });
  }
  throw new Error('Ollama returned empty response after all retries');
}
async function ollamaGenerate(prompt: string, overrideTimeoutMs?: number): Promise<string> {
  // Enforce JSON-only responses using a system prompt and the chat API.
  const systemPrompt =
    'You are a contract analysis JSON extraction engine. ' +
    'You MUST respond with ONLY a single valid JSON object and nothing else. ' +
    'Do NOT explain, do not add any markdown or text. Return a single JSON object starting with { and ending with }.';

  const response = await fetch(`${config.ollamaBaseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.generationModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      stream: false,
      keep_alive: -1,
      options: {
        temperature: config.llmTemperature,
        num_ctx: config.llmNumCtx,
        num_predict: config.llmNumPredict,
      },
    }),
    signal: AbortSignal.timeout(overrideTimeoutMs ?? config.llmTimeoutMs),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Ollama chat failed: ${response.status} ${response.statusText} - ${body}`);
  }

  const data = (await response.json()) as { message?: { content: string }; response?: string };
  const content = data.message?.content || data.response || '';
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

function normalizeFixedFields(raw: unknown): Record<string, { value: string; description?: string; confidence?: number }> {
  if (!raw) return {};
  // If wrapped under fixed_fields key, unwrap
  const data = (raw as any).fixed_fields ?? raw;
  if (!data || typeof data !== 'object') return {};
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (v === null || v === undefined) {
      out[k] = { value: '' };
    } else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      out[k] = { value: String(v) };
    } else if (typeof v === 'object') {
      const vv = v as Record<string, unknown>;
      if ('value' in vv) {
        out[k] = { value: vv.value == null ? '' : String(vv.value), description: vv.description as string | undefined, confidence: typeof vv.confidence === 'number' ? vv.confidence : undefined };
      } else {
        // Fallback: stringify object
        out[k] = { value: JSON.stringify(vv) };
      }
    } else {
      out[k] = { value: String(v) };
    }
  }
  return out;
}

function normalizeDynamicFields(raw: unknown): Record<string, Record<string, { value: string; description?: string; confidence?: number }>> {
  if (!raw) return {};
  const data = (raw as any).dynamic_fields ?? raw;
  if (!data) return {};
  // If it's an array of strings, turn into { clauses: { '0': {value: ...}, ... } }
  if (Array.isArray(data)) {
    const out: Record<string, Record<string, any>> = { clauses: {} };
    (data as any[]).forEach((item, i) => {
      out.clauses[String(i)] = typeof item === 'string' ? { value: item } : { value: JSON.stringify(item) };
    });
    return out;
  }
  if (typeof data === 'object') {
    const out: Record<string, Record<string, any>> = {};
    for (const [section, fields] of Object.entries(data as Record<string, unknown>)) {
      if (Array.isArray(fields)) {
        out[section] = {};
        (fields as any[]).forEach((f, i) => {
          out[section][String(i)] = typeof f === 'string' ? { value: f } : 'value' in (f as any) ? { value: (f as any).value ?? '' } : { value: JSON.stringify(f) };
        });
      } else if (typeof fields === 'object') {
        out[section] = {};
        for (const [k, v] of Object.entries(fields as Record<string, unknown>)) {
          if (v === null || v === undefined) out[section][k] = { value: '' };
          else if (typeof v === 'string') out[section][k] = { value: v };
          else if (typeof v === 'object' && 'value' in (v as any)) out[section][k] = { value: (v as any).value ?? '' };
          else out[section][k] = { value: JSON.stringify(v) };
        }
      } else {
        out[section] = { '0': { value: String(fields) } };
      }
    }
    return out;
  }
  return {};
}
