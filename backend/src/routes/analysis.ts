import { Router } from 'express';
import asyncHandler from '../middlewares/asyncHandler';
import analysisController from '../controllers/analysisController';

const router = Router();

// POST /documents/:id/analyze — trigger analysis
router.post('/:id/analyze', asyncHandler(analysisController.startAnalysis));

// GET /documents/:id/analysis — get analysis result
router.get('/:id/analysis', asyncHandler(analysisController.getAnalysis));

export default router;
