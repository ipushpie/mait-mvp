import { Router } from 'express';
import upload from '../middlewares/upload';
import asyncHandler from '../middlewares/asyncHandler';
import documentsController from '../controllers/documentsController';

const router = Router();

// POST /documents — upload a document
router.post('/', upload.single('file'), asyncHandler(documentsController.uploadDocument));

// GET /documents — list all documents
router.get('/', asyncHandler(documentsController.listDocuments));

// GET /documents/:id — single document status
router.get('/:id', asyncHandler(documentsController.getDocument));

// GET /documents/:id/download — download original file
router.get('/:id/download', asyncHandler(documentsController.downloadDocument));

// DELETE /documents/:id — delete a document
router.delete('/:id', asyncHandler(documentsController.deleteDocument));

export default router;
