#!/bin/sh
set -e

echo "Running Prisma migrations..."
npx prisma migrate deploy

echo "Setting up pgvector extension and columns..."
# Use node to run the vector setup SQL
node -e "
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function setup() {
  await prisma.\$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS vector;');
  await prisma.\$executeRawUnsafe('ALTER TABLE \"Chunk\" ADD COLUMN IF NOT EXISTS embedding vector(768);');
  await prisma.\$executeRawUnsafe('CREATE INDEX IF NOT EXISTS idx_chunks_embedding ON \"Chunk\" USING hnsw (embedding vector_cosine_ops);');
  console.log('Vector setup complete');
  await prisma.\$disconnect();
}
setup().catch(e => { console.error(e); process.exit(1); });
"

echo "Starting backend server..."
exec node dist/index.js
