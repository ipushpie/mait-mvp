import { Router, Request, Response } from 'express';
import multer from 'multer';
import { prisma } from '../database';
import { config } from '../config';
import { ingestDocument } from '../services/ingestion';

const router = Router();

// Multer memoryStorage — file never touches disk
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxFileSize },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}. Allowed: PDF, DOCX, TXT`));
    }
  },
});

// POST /documents — upload a document
router.post('/', upload.single('file'), async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const doc = await prisma.document.create({
      data: {
        filename: req.file.originalname,
        mimeType: req.file.mimetype,
        fileData: Buffer.from(req.file.buffer) as any,
        status: 'QUEUED',
        progress: 0,
      },
    });

    // Fire-and-forget ingestion
    void ingestDocument(doc.id);

    res.status(202).json({
      id: doc.id,
      filename: doc.filename,
      status: doc.status,
      message: 'Document queued for processing',
    });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Upload failed', details: String(err) });
  }
});

// GET /documents — list all documents
router.get('/', async (_req: Request, res: Response): Promise<void> => {
  try {
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
  } catch (err) {
    res.status(500).json({ error: 'Failed to list documents', details: String(err) });
  }
});

// GET /documents/:id — single document status
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
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
  } catch (err) {
    res.status(500).json({ error: 'Failed to get document', details: String(err) });
  }
});

// GET /documents/:id/download — download original file
router.get('/:id/download', async (req: Request, res: Response): Promise<void> => {
  try {
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
  } catch (err) {
    res.status(500).json({ error: 'Download failed', details: String(err) });
  }
});

// DELETE /documents/:id — delete a document
router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const docId = req.params.id as string;
    await prisma.document.delete({ where: { id: docId } });
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: 'Delete failed', details: String(err) });
  }
});

export default router;
