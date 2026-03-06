import { Router } from 'express';
import validator from '../middlewares/validator';
import documentsController from '../controllers/documentsController';

const router = Router();

// POST /documents — upload a document
// POST /documents — bulk upload files (multipart form field name: `files`)
// Multipart is parsed inside the controller; no upload middleware used in route.
router.post('/', validator, documentsController.uploadDocument);

// GET /documents — list all documents
router.get('/', documentsController.listDocuments);

// GET /documents/:id — single document status
router.get('/:id', documentsController.getDocument);

// GET /documents/:id/download — download original file
router.get('/:id/download', documentsController.downloadDocument);

// DELETE /documents/:id — delete a document
router.delete('/:id', documentsController.deleteDocument);

export default router;
