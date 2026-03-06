-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column to Chunk table
ALTER TABLE "Chunk" ADD COLUMN IF NOT EXISTS embedding vector(768);

-- Add HNSW index for cosine similarity search
CREATE INDEX IF NOT EXISTS idx_chunks_embedding ON "Chunk" USING hnsw (embedding vector_cosine_ops);
