import { Request, Response } from 'express';
import { prisma } from '../utils/database';
import { analyzeDocument } from '../services/extraction';
import { logger } from '../utils/logger';
import { acquireLock, releaseLock } from '../utils/jobLock';

const TAG = 'AnalysisCtrl';

export const startAnalysis = async (req: Request, res: Response): Promise<void> => {
  const docId = req.params.id as string;
  logger.info(TAG, `Analysis requested`, { documentId: docId });

  const doc = await prisma.document.findUnique({
    where: { id: docId },
    select: { id: true, status: true },
  });

  if (!doc) {
    logger.warn(TAG, `Document not found`, { documentId: docId });
    res.status(404).json({ error: 'Document not found' });
    return;
  }

  if (doc.status !== 'READY') {
    logger.warn(TAG, `Document not ready`, { documentId: docId, status: doc.status });
    res.status(400).json({ error: `Document is not ready for analysis. Current status: ${doc.status}` });
    return;
  }

  const existing = await prisma.documentAnalysis.findUnique({ where: { documentId: doc.id } });
  // Only block if actively running — PARTIAL/DONE/FAILED can all be re-triggered
  if (existing?.status === 'RUNNING') {
    logger.warn(TAG, `Analysis already running (DB check)`, { documentId: docId });
    res.status(409).json({ error: 'Analysis is already running' });
    return;
  }

  // In-memory lock — prevents race condition when two requests arrive before the DB row is created
  if (!acquireLock(`analysis:${doc.id}`)) {
    logger.warn(TAG, `Analysis already running (in-memory lock)`, { documentId: docId });
    res.status(409).json({ error: 'Analysis is already running' });
    return;
  }

  logger.info(TAG, `Queuing analysis`, { documentId: docId, previousStatus: existing?.status ?? 'none' });
  void analyzeDocument(doc.id).finally(() => releaseLock(`analysis:${doc.id}`));

  res.status(202).json({ documentId: doc.id, status: 'RUNNING', message: 'Analysis started' });
};

export const getAnalysis = async (req: Request, res: Response): Promise<void> => {
  const docId = req.params.id as string;
  const analysis = await prisma.documentAnalysis.findUnique({ where: { documentId: docId } });
  if (!analysis) {
    res.status(404).json({ error: 'No analysis found for this document' });
    return;
  }

  res.json({
    id: analysis.id,
    documentId: analysis.documentId,
    status: analysis.status,
    errorMessage: analysis.errorMessage,
    fixedFields: analysis.fixedFields,
    dynamicFields: analysis.dynamicFields,
    specialFields: analysis.specialFields,
    sources: analysis.sources,
    modelName: analysis.modelName,
    createdAt: analysis.createdAt,
    updatedAt: analysis.updatedAt,
  });
};

export default { startAnalysis, getAnalysis };
