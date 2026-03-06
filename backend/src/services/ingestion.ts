import { extractBytes } from '@kreuzberg/node';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { embed, embedBatch } from './embedding';
import { config } from '../utils/config';
import { prisma } from '../utils/database';
import { logger, elapsed } from '../utils/logger';
import crypto from 'crypto';

const TAG = 'Ingestion';

export async function ingestDocument(documentId: string): Promise<void> {
  const t0 = Date.now();
  logger.info(TAG, `Started`, { documentId });
  try {
    // 1. Fetch document from DB
    const doc = await prisma.document.findUniqueOrThrow({
      where: { id: documentId },
    });
    logger.info(TAG, `Document fetched`, { documentId, filename: doc.filename, mimeType: doc.mimeType, sizeBytes: doc.fileData.length });

    // 2. Set PROCESSING
    await prisma.document.update({
      where: { id: documentId },
      data: { status: 'PROCESSING', progress: 5 },
    });

    // 3. Extract text via Kreuzberg
    const t1 = Date.now();
    logger.info(TAG, `Extracting text...`, { documentId });
    const result = await extractBytes(new Uint8Array(doc.fileData), doc.mimeType);
    const rawText = result.content;

    if (!rawText || rawText.trim().length === 0) {
      throw new Error('No text could be extracted from the document');
    }
    logger.info(TAG, `Text extracted`, { documentId, chars: rawText.length, elapsed: elapsed(t1) });

    await prisma.document.update({
      where: { id: documentId },
      data: { rawText, progress: 30 },
    });

    // 4. Chunk — compute chunk size to produce approximately TARGET_CHUNKS
    const t2 = Date.now();
    const target = Math.max(1, (config as any).targetChunks || 15);
    const estimatedChunkSize = Math.max(200, Math.floor(rawText.length / target));
    const chunkOverlap = Math.min( Math.floor(estimatedChunkSize * 0.15), 200 );
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: estimatedChunkSize,
      chunkOverlap,
    });
    const chunks = await splitter.splitText(rawText);
    const totalChunks = chunks.length;
    logger.info(TAG, `Chunked`, { documentId, totalChunks, elapsed: elapsed(t2) });

    await prisma.document.update({
      where: { id: documentId },
      data: { progress: 50 },
    });

    // 5. Delete old chunks (idempotency)
    await prisma.chunk.deleteMany({ where: { documentId } });

    // 6. Embed and store each chunk
    const progressMilestones = new Set([
      Math.floor(totalChunks * 0.25),
      Math.floor(totalChunks * 0.5),
      Math.floor(totalChunks * 0.75),
    ]);

    const t3 = Date.now();
    logger.info(TAG, `Embedding ${totalChunks} chunks...`, { documentId });

    const BATCH = 8; // number of chunks to embed in parallel per batch
    for (let i = 0; i < totalChunks; i += BATCH) {
      const end = Math.min(i + BATCH, totalChunks);
      const batchTexts = chunks.slice(i, end);
      // get embeddings in parallel (limited by embedBatch concurrency)
      const embeddingVectors = await embedBatch(batchTexts);

        // Bulk insert this batch including embedding to avoid create + update per-row roundtrips.
        const placeholders: string[] = [];
        const params: any[] = [];
        for (let j = 0; j < embeddingVectors.length; j++) {
          const idx = i + j;
          const chunkText = batchTexts[j];
          const id = crypto.randomUUID();
          const paramBase = params.length + 1;
          // ($n,$n+1,$n+2,$n+3,$n+4::vector)
          placeholders.push(`($${paramBase}, $${paramBase + 1}, $${paramBase + 2}, $${paramBase + 3}, $${paramBase + 4}::vector)`);
          params.push(id, documentId, idx, chunkText, `[${embeddingVectors[j].join(',')}]`);
        }
        const insertSql = `INSERT INTO "Chunk" (id, "documentId", "chunkIndex", content, embedding) VALUES ${placeholders.join(',')}`;
        await prisma.$executeRawUnsafe(insertSql, ...params);

      // progress update based on last index in batch
      const lastIdx = end - 1;
      if (progressMilestones.has(lastIdx) || end === totalChunks) {
        const progress = 50 + Math.floor((end / totalChunks) * 45);
        await prisma.document.update({ where: { id: documentId }, data: { progress } });
        logger.info(TAG, `Embedding progress`, { documentId, chunk: end, totalChunks, progress });
      }
    }
    logger.info(TAG, `All chunks embedded`, { documentId, totalChunks, elapsed: elapsed(t3) });

    // 7. Done
    await prisma.document.update({
      where: { id: documentId },
      data: { status: 'READY', progress: 100 },
    });

    logger.info(TAG, `Complete`, { documentId, totalChunks, totalElapsed: elapsed(t0) });
  } catch (err) {
    logger.error(TAG, `Failed`, err, { documentId, elapsed: elapsed(t0) });
    await prisma.document.update({
      where: { id: documentId },
      data: { status: 'FAILED', errorMessage: String(err) },
    }).catch((e) => logger.error(TAG, 'Failed to update status to FAILED', e, { documentId }));
  }
}
