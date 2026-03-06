import { Request, Response } from 'express';
import { prisma } from '../utils/database';
import { ingestDocument } from '../services/ingestion';
import { logger } from '../utils/logger';
import { acquireLock, releaseLock } from '../utils/jobLock';

const TAG = 'DocumentsCtrl';

export const uploadDocument = async (req: Request, res: Response): Promise<void> => {
  if (!req.file) {
    logger.warn(TAG, 'Upload rejected — no file in request');
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  logger.info(TAG, `Upload received`, { filename: req.file.originalname, mimeType: req.file.mimetype, sizeBytes: req.file.size });

  const doc = await prisma.document.create({
    data: {
      filename: req.file.originalname,
      mimeType: req.file.mimetype,
      fileData: Buffer.from(req.file.buffer) as any,
      status: 'QUEUED',
      progress: 0,
    },
  });

  logger.info(TAG, `Document created, queuing ingestion`, { documentId: doc.id, filename: doc.filename });
  acquireLock(`ingest:${doc.id}`);
  void ingestDocument(doc.id).finally(() => releaseLock(`ingest:${doc.id}`));

  res.status(202).json({
    id: doc.id,
    filename: doc.filename,
    status: doc.status,
    message: 'Document queued for processing',
  });
};

export const listDocuments = async (_req: Request, res: Response): Promise<void> => {
  const docs = await prisma.document.findMany({
    select: {
      id: true,
      filename: true,
      mimeType: true,
      status: true,
      progress: true,
      errorMessage: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(docs);
};

export const getDocument = async (req: Request, res: Response): Promise<void> => {
  const docId = req.params.id as string;
  const doc = await prisma.document.findUnique({
    where: { id: docId },
    select: {
      id: true,
      filename: true,
      mimeType: true,
      status: true,
      progress: true,
      errorMessage: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!doc) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }
  res.json(doc);
};

export const downloadDocument = async (req: Request, res: Response): Promise<void> => {
  const docId = req.params.id as string;
  const doc = await prisma.document.findUnique({
    where: { id: docId },
    select: { filename: true, mimeType: true, fileData: true },
  });
  if (!doc) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }
  res.setHeader('Content-Type', doc.mimeType);
  res.setHeader('Content-Disposition', `attachment; filename="${doc.filename}"`);
  res.send(doc.fileData);
};

export const deleteDocument = async (req: Request, res: Response): Promise<void> => {
  const docId = req.params.id as string;
  await prisma.document.delete({ where: { id: docId } });
  res.status(204).end();
};

export default {
  uploadDocument,
  listDocuments,
  getDocument,
  downloadDocument,
  deleteDocument,
};
