import { config } from '../config';
import { prisma } from '../database';
import { embed } from './embedding';
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
};

export async function analyzeDocument(documentId: string): Promise<void> {
  const t0 = Date.now();
  try {
    // Upsert analysis row → RUNNING
    await prisma.documentAnalysis.upsert({
      where: { documentId },
      create: { documentId, status: 'RUNNING' },
      update: { status: 'RUNNING', errorMessage: null },
    });

    // Passes run sequentially — parallel requests cause GPU contention on Ollama
    console.log(`[Analysis] Starting analysis for ${documentId}`);
    const fixedFields = await timedPass('Pass 1 Fixed', () =>
      runPass(documentId, FIXED_QUERY, FIXED_PROMPT)
    );
    const dynamicFields = await timedPass('Pass 2 Dynamic', () =>
      runPass(documentId, DYNAMIC_QUERY, DYNAMIC_PROMPT)
    );

    // Pass 3: Supplier-specific fields (depends on Pass 1 result)
    console.log(`[Analysis] Pass 3 - Supplier fields for ${documentId}`);
    const provider = extractProviderValue(fixedFields);
    const specialFields = await timedPass('Pass 3 Supplier', () =>
      runSupplierPass(documentId, provider)
    );

    await prisma.documentAnalysis.update({
      where: { documentId },
      data: {
        status: 'DONE',
        fixedFields: fixedFields as any,
        dynamicFields: dynamicFields as any,
        specialFields: specialFields as any,
        modelName: config.generationModel,
      },
    });

    console.log(`[Analysis] Complete for ${documentId} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } catch (err) {
    console.error(`[Analysis] Failed for ${documentId} after ${((Date.now() - t0) / 1000).toFixed(1)}s:`, err);
    await prisma.documentAnalysis.update({
      where: { documentId },
      data: { status: 'FAILED', errorMessage: String(err) },
    }).catch(console.error);
  }
}

async function timedPass<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  console.log(`[Analysis] ${label} started`);
  const result = await fn();
  console.log(`[Analysis] ${label} completed in ${((Date.now() - start) / 1000).toFixed(1)}s`);
  return result;
}

async function runPass(
  documentId: string,
  queryText: string,
  promptTemplate: string
): Promise<unknown> {
  const queryEmbedding = await embed(queryText);

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
  const prompt = promptTemplate.replace('{context}', context);

  const raw = await ollamaChatWithRetry(prompt);
  return parseLLMJson(raw);
}

async function runSupplierPass(
  documentId: string,
  supplierRaw: string | null
): Promise<unknown> {
  if (!supplierRaw) return {};

  const key = Object.keys(SUPPLIER_QUERIES).find((k) =>
    supplierRaw.toLowerCase().includes(k)
  );
  if (!key) return {}; // Unknown supplier — skip Pass 3

  let supplierData: Record<string, unknown> = {};
  try {
    const mapping = await import('../data/mapping.json');
    const mappingData = mapping.default || mapping;
    supplierData = (mappingData as Record<string, unknown>)[key] as Record<string, unknown> || {};
  } catch {
    console.log(`No mapping.json found or no data for supplier "${key}". Skipping Pass 3.`);
    return {};
  }

  if (Object.keys(supplierData).length === 0) return {};

  const fieldList = JSON.stringify(supplierData, null, 2);
  const query = SUPPLIER_QUERIES[key];
  const prompt = SUPPLIER_PROMPT
    .replace('{SUPPLIER_NAME}', key)
    .replace('{SUPPLIER_FIELD_LIST}', fieldList);

  return runPass(documentId, query, prompt);
}

const MAX_RETRIES = 2;

async function ollamaChatWithRetry(userPrompt: string): Promise<string> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const content = await ollamaChat(userPrompt);
    if (content.length > 0) return content;
    console.warn(`[Ollama] Empty response on attempt ${attempt}/${MAX_RETRIES}, retrying...`);
  }
  throw new Error('Ollama returned empty response after all retries');
}

async function ollamaChat(userPrompt: string): Promise<string> {
  const systemPrompt =
    'You are a contract analysis JSON extraction engine. You MUST respond with ONLY valid JSON. ' +
    'No explanations, no reasoning, no markdown fences, no text before or after the JSON. ' +
    'Your entire response must be a single JSON object that can be parsed by JSON.parse().';

  const response = await fetch(`${config.ollamaBaseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.generationModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      stream: false,
      format: 'json',
      options: {
        temperature: 0.1,
        num_predict: 4096,
      },
    }),
    signal: AbortSignal.timeout(900_000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Ollama chat failed: ${response.status} ${response.statusText} - ${body}`);
  }

  const data = (await response.json()) as { message?: { content: string }; response?: string };
  const content = data.message?.content || data.response || '';
  console.log(`[Ollama] Response length: ${content.length} chars`);
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

  // 4. Find the outermost JSON object in the text
  //    (handles reasoning text before/after the JSON)
  const startIdx = raw.indexOf('{');
  if (startIdx !== -1) {
    let depth = 0;
    let endIdx = -1;
    for (let i = startIdx; i < raw.length; i++) {
      if (raw[i] === '{') depth++;
      else if (raw[i] === '}') {
        depth--;
        if (depth === 0) { endIdx = i; break; }
      }
    }
    if (endIdx !== -1) {
      const jsonStr = raw.slice(startIdx, endIdx + 1);
      try {
        return JSON.parse(jsonStr);
      } catch {
        // ignore
      }
    }
  }

  // 5. Last resort: regex match
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch {
      // ignore
    }
  }

  console.error(`[parseLLMJson] Failed to parse. Raw (first 500 chars): ${raw.slice(0, 500)}`);
  throw new Error(`Cannot parse LLM JSON: ${raw.slice(0, 200)}`);
}

function extractProviderValue(fixedFields: unknown): string | null {
  if (!fixedFields || typeof fixedFields !== 'object') return null;
  const ff = fixedFields as Record<string, unknown>;
  const fields = (ff.fixed_fields || ff) as Record<string, unknown>;
  const provider = fields.provider as { value?: string } | undefined;
  return provider?.value ?? null;
}
