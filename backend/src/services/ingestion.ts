import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { embed } from './embedding';
import { prisma } from '../database';

export async function ingestDocument(documentId: string): Promise<void> {
  try {
    // 1. Fetch document from DB
    const doc = await prisma.document.findUniqueOrThrow({
      where: { id: documentId },
    });

    // 2. Set PROCESSING
    await prisma.document.update({
      where: { id: documentId },
      data: { status: 'PROCESSING', progress: 5 },
    });

    // 3. Extract text - basic text extraction from buffer
    let rawText: string;
    try {
      rawText = await extractText(Buffer.from(doc.fileData), doc.mimeType);
    } catch (extractErr) {
      console.error(`Text extraction failed for ${documentId}:`, extractErr);
      throw new Error(`Text extraction failed: ${extractErr}`);
    }

    if (!rawText || rawText.trim().length === 0) {
      throw new Error('No text could be extracted from the document');
    }

    await prisma.document.update({
      where: { id: documentId },
      data: { rawText, progress: 30 },
    });

    // 4. Chunk
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 600,
      chunkOverlap: 100,
    });
    const chunks = await splitter.splitText(rawText);
    await prisma.document.update({
      where: { id: documentId },
      data: { progress: 50 },
    });

    // 5. Delete old chunks (idempotency)
    await prisma.chunk.deleteMany({ where: { documentId } });

    // 6. Embed and store each chunk
    const totalChunks = chunks.length;
    for (let i = 0; i < totalChunks; i++) {
      const chunkText = chunks[i];
      const embeddingVector = await embed(chunkText);

      const chunk = await prisma.chunk.create({
        data: {
          documentId,
          chunkIndex: i,
          content: chunkText,
        },
      });

      // Store embedding via raw SQL (Prisma can't handle vector type)
      await prisma.$executeRawUnsafe(
        `UPDATE "Chunk" SET embedding = $1::vector WHERE id = $2`,
        `[${embeddingVector.join(',')}]`,
        chunk.id
      );

      // Update progress (50-95 range for embedding)
      const progress = 50 + Math.floor((i / totalChunks) * 45);
      await prisma.document.update({
        where: { id: documentId },
        data: { progress },
      });
    }

    // 7. Done
    await prisma.document.update({
      where: { id: documentId },
      data: { status: 'READY', progress: 100 },
    });

    console.log(`Document ${documentId} ingestion complete. ${totalChunks} chunks created.`);
  } catch (err) {
    console.error(`Ingestion failed for ${documentId}:`, err);
    await prisma.document.update({
      where: { id: documentId },
      data: { status: 'FAILED', errorMessage: String(err) },
    }).catch(console.error);
  }
}

/**
 * Basic text extraction. Tries @kreuzberg/node if available, falls back to raw buffer decoding.
 */
async function extractText(fileData: Buffer, mimeType: string): Promise<string> {
  // Try kreuzberg first
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const kreuzberg: any = await import('@kreuzberg/node' as string);
    const extractBytes = kreuzberg.extractBytes || kreuzberg.default?.extractBytes;
    if (extractBytes) {
      const result = await extractBytes(new Uint8Array(fileData), mimeType);
      if (result?.content && result.content.trim().length > 0) {
        return result.content;
      }
    }
  } catch {
    console.log('Kreuzberg not available, using fallback text extraction');
  }

  // Fallback: for text-based formats, try direct buffer decoding
  if (mimeType === 'text/plain') {
    return fileData.toString('utf-8');
  }

  // For PDF: try basic text extraction from buffer
  const text = fileData.toString('utf-8');
  // Extract readable text segments (basic approach)
  const readable = text
    .replace(/[^\x20-\x7E\n\r\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (readable.length > 100) {
    return readable;
  }

  throw new Error(`Cannot extract text from ${mimeType}. Install @kreuzberg/node for full support.`);
}
