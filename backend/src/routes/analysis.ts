import { Router, Request, Response } from 'express';
import { prisma } from '../database';
import { analyzeDocument } from '../services/extraction';

const router = Router();

// POST /documents/:id/analyze — trigger analysis
router.post('/:id/analyze', async (req: Request, res: Response): Promise<void> => {
  try {
    const docId = req.params.id as string;
    const doc = await prisma.document.findUnique({
      where: { id: docId },
      select: { id: true, status: true },
    });

    if (!doc) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    if (doc.status !== 'READY') {
      res.status(400).json({
        error: `Document is not ready for analysis. Current status: ${doc.status}`,
      });
      return;
    }

    // Check if already running
    const existing = await prisma.documentAnalysis.findUnique({
      where: { documentId: doc.id },
    });
    if (existing?.status === 'RUNNING') {
      res.status(409).json({ error: 'Analysis is already running' });
      return;
    }

    // Fire-and-forget analysis
    void analyzeDocument(doc.id);

    res.status(202).json({
      documentId: doc.id,
      status: 'RUNNING',
      message: 'Analysis started',
    });
  } catch (err) {
    console.error('Analyze error:', err);
    res.status(500).json({ error: 'Failed to start analysis', details: String(err) });
  }
});

// GET /documents/:id/analysis — get analysis result
router.get('/:id/analysis', async (req: Request, res: Response): Promise<void> => {
  try {
    const docId = req.params.id as string;
    const analysis = await prisma.documentAnalysis.findUnique({
      where: { documentId: docId },
    });

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
  } catch (err) {
    res.status(500).json({ error: 'Failed to get analysis', details: String(err) });
  }
});

export default router;
