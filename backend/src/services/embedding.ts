import { config } from '../utils/config';
import { logger } from '../utils/logger';

const TAG = 'Embed';
const EMBED_RETRIES = 3;
const EMBED_RETRY_DELAY_MS = 5000;

export async function embed(text: string): Promise<number[]> {
  for (let attempt = 1; attempt <= EMBED_RETRIES; attempt++) {
    const t0 = Date.now();
    try {
      const response = await fetch(`${config.ollamaBaseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: config.embedModel, prompt: text }),
        signal: AbortSignal.timeout(120_000),
      });

      if (!response.ok) {
        throw new Error(`Ollama embed HTTP ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as { embedding: number[] };
      if (!data.embedding || data.embedding.length === 0) {
        throw new Error(`Ollama embed returned empty embedding for model "${config.embedModel}"`);
      }
      logger.debug(TAG, `Embedded`, { dims: data.embedding.length, ms: Date.now() - t0, attempt });
      return data.embedding;
    } catch (err) {
      if (attempt === EMBED_RETRIES) {
        logger.error(TAG, `All ${EMBED_RETRIES} attempts failed`, err, { textSnippet: text?.slice(0, 60) ?? '(undefined text)' });
        throw err;
      }
      logger.warn(TAG, `Attempt ${attempt}/${EMBED_RETRIES} failed, retrying in ${EMBED_RETRY_DELAY_MS}ms`, { error: String(err) });
      await new Promise((r) => setTimeout(r, EMBED_RETRY_DELAY_MS));
    }
  }
  throw new Error('Unreachable');
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  const CONCURRENCY = 8;
  const results: number[][] = new Array(texts.length);

  let idx = 0;
  const workers: Promise<void>[] = [];

  const worker = async () => {
    while (true) {
      const i = idx++;
      if (i >= texts.length) return;
      results[i] = await embed(texts[i]);
    }
  };

  for (let w = 0; w < Math.min(CONCURRENCY, texts.length); w++) {
    workers.push(worker());
  }

  await Promise.all(workers);
  return results;
}
