const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export interface DocumentItem {
  id: string;
  filename: string;
  mimeType: string;
  status: string;
  progress: number;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AnalysisResult {
  id: string;
  documentId: string;
  status: string;
  errorMessage: string | null;
  fixedFields: Record<string, FieldValue> | { fixed_fields: Record<string, FieldValue> } | null;
  dynamicFields: Record<string, Record<string, FieldValue>> | { dynamic_fields: Record<string, Record<string, FieldValue>> } | null;
  specialFields: Record<string, unknown> | null;
  sources: unknown;
  modelName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FieldValue {
  value: string;
  description?: string;
  confidence?: number;
}

export async function fetchDocuments(): Promise<DocumentItem[]> {
  const res = await fetch(`${API_URL}/documents`);
  if (!res.ok) throw new Error('Failed to fetch documents');
  return res.json();
}

export async function uploadDocument(file: File): Promise<{ id: string }> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${API_URL}/documents`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Upload failed');
  }
  return res.json();
}

export async function triggerAnalysis(documentId: string): Promise<void> {
  const res = await fetch(`${API_URL}/documents/${documentId}/analyze`, {
    method: 'POST',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to start analysis');
  }
}

export async function fetchAnalysis(documentId: string): Promise<AnalysisResult | null> {
  const res = await fetch(`${API_URL}/documents/${documentId}/analysis`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('Failed to fetch analysis');
  return res.json();
}

export async function fetchDocument(id: string): Promise<DocumentItem> {
  const res = await fetch(`${API_URL}/documents/${id}`);
  if (!res.ok) throw new Error('Failed to fetch document');
  return res.json();
}

export async function deleteDocument(id: string): Promise<void> {
  const res = await fetch(`${API_URL}/documents/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete document');
}
