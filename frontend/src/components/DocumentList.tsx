'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { DocumentItem, fetchDocuments, uploadDocument, triggerAnalysis, deleteDocument } from '@/lib/api';
import { StatusBadge } from './StatusBadge';

export function DocumentList() {
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadDocuments = useCallback(async () => {
    try {
      const docs = await fetchDocuments();
      setDocuments(docs);
    } catch (err) {
      console.error('Failed to load documents:', err);
    }
  }, []);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  // Poll while any document is QUEUED or PROCESSING
  useEffect(() => {
    const hasActive = documents.some(
      (d) => d.status === 'QUEUED' || d.status === 'PROCESSING'
    );
    if (!hasActive) return;

    const interval = setInterval(loadDocuments, 3000);
    return () => clearInterval(interval);
  }, [documents, loadDocuments]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);
    try {
      await uploadDocument(file);
      await loadDocuments();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleAnalyze = async (docId: string) => {
    setError(null);
    try {
      await triggerAnalysis(docId);
      // Navigate to analysis page
      window.location.href = `/documents/${docId}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start analysis');
    }
  };

  const handleDelete = async (docId: string) => {
    if (!confirm('Delete this document?')) return;
    try {
      await deleteDocument(docId);
      await loadDocuments();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString();
  };

  return (
    <div>
      {/* Upload zone */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div
          className="upload-zone"
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.txt"
            onChange={handleUpload}
            style={{ display: 'none' }}
          />
          {uploading ? (
            <div>
              <div className="spinner" style={{ marginBottom: '0.5rem' }} />
              <p>Uploading...</p>
            </div>
          ) : (
            <div>
              <p style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>
                Click to upload a contract
              </p>
              <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
                PDF, DOCX, or TXT — max 25MB
              </p>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="error-box">{error}</div>
      )}

      {/* Documents table */}
      {documents.length === 0 ? (
        <div className="empty-state">
          <p>No documents uploaded yet.</p>
          <p style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>
            Upload a contract to get started.
          </p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table>
            <thead>
              <tr>
                <th>Filename</th>
                <th>Uploaded</th>
                <th>Status</th>
                <th>Progress</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <tr key={doc.id}>
                  <td style={{ fontWeight: 500 }}>{doc.filename}</td>
                  <td style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
                    {formatDate(doc.createdAt)}
                  </td>
                  <td>
                    <StatusBadge status={doc.status} />
                  </td>
                  <td style={{ width: '120px' }}>
                    <div className="progress-bar">
                      <div
                        className="progress-fill"
                        style={{ width: `${doc.progress}%` }}
                      />
                    </div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
                      {doc.progress}%
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      {doc.status === 'READY' && (
                        <button
                          className="btn btn-success"
                          onClick={() => handleAnalyze(doc.id)}
                        >
                          Analyze
                        </button>
                      )}
                      {doc.status === 'READY' && (
                        <a
                          href={`/documents/${doc.id}`}
                          className="btn btn-primary"
                        >
                          View
                        </a>
                      )}
                      <button
                        className="btn btn-danger"
                        onClick={() => handleDelete(doc.id)}
                        style={{ fontSize: '0.8rem', padding: '0.4rem 0.7rem' }}
                      >
                        ✕
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
