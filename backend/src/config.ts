import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '8000', 10),
  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/mait_mvp',
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://148.113.1.127:11434',
  embedModel: process.env.EMBED_MODEL || 'nomic-embed-text',
  generationModel: process.env.GENERATION_MODEL || 'gpt-oss',
  maxFileSize: 25 * 1024 * 1024, // 25MB
} as const;
