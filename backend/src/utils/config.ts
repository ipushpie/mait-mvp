import dotenv from 'dotenv';
dotenv.config();

// Fail-fast: required in production
if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required in production');
}

export const config = {
  port: parseInt(process.env.PORT || '8000', 10),
  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/mait_mvp',
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
  embedModel: process.env.EMBED_MODEL || 'nomic-embed-text',
  generationModel: process.env.GENERATION_MODEL || 'gpt-oss',
  warmupModel: process.env.WARMUP_MODEL === 'true' || false,
  includeAllChunksInPrompt: process.env.INCLUDE_ALL_CHUNKS === 'true' || false,
  // LLM runtime and size settings
  llmTimeoutMs: parseInt(process.env.LLM_TIMEOUT_MS || '600000', 10),
  llmNumPredict: parseInt(process.env.LLM_NUM_PREDICT || '8192', 10),
  llmNumCtx: parseInt(process.env.LLM_NUM_CTX || '8192', 10),
  llmTemperature: parseFloat(process.env.LLM_TEMPERATURE || '0.0'),
  maxFileSize: 25 * 1024 * 1024, // 25MB
  // Target approximate number of chunks to split each document into
  targetChunks: parseInt(process.env.TARGET_CHUNKS || '15', 10),
} as const;
