import { Router } from 'express';
import analysisController from '../controllers/analysisController';

const router = Router();

// POST /documents/:id/analyze — trigger analysis
router.post('/:id/analyze', analysisController.startAnalysis);

// GET /documents/:id/analysis — get analysis result
router.get('/:id/analysis', analysisController.getAnalysis);

export default router;
