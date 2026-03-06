#!/bin/sh
set -e

echo "Running Prisma migrations..."
# Run migrations quietly to avoid duplicate Prisma CLI logs in Docker output
npx prisma migrate deploy >/dev/null

echo "Setting up pgvector extension and columns..."
# Use psql to run SQL directly to avoid loading Prisma in the entrypoint
if [ -z "$DATABASE_URL" ]; then
  echo "DATABASE_URL not set — skipping pgvector setup"
else
  # Run each statement; ignore errors for already-existing objects
  echo "CREATE EXTENSION IF NOT EXISTS vector;" | psql "$DATABASE_URL" || true
  echo 'ALTER TABLE "Chunk" ADD COLUMN IF NOT EXISTS embedding vector(768);' | psql "$DATABASE_URL" || true
  echo 'CREATE INDEX IF NOT EXISTS idx_chunks_embedding ON "Chunk" USING hnsw (embedding vector_cosine_ops);' | psql "$DATABASE_URL" || true
  echo "Vector setup complete"
fi

echo "Starting backend server... (entrypoint pid $$)"
exec node dist/index.js
