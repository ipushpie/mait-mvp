'use client';

import { FieldValue, SpecialFieldEntry, SpecialFieldsData } from '@/lib/api';

interface AnalysisResultProps {
  fixedFields: Record<string, FieldValue> | { fixed_fields: Record<string, FieldValue> } | null;
  dynamicFields:
    | Record<string, Record<string, FieldValue>>
    | { dynamic_fields: Record<string, Record<string, FieldValue>> }
    | null;
  specialFields: SpecialFieldsData | { special_fields: SpecialFieldsData } | null;
}

function ConfidenceDot({ confidence }: { confidence?: number }) {
  if (confidence === undefined || confidence === null) return null;
  let cls = 'confidence-dot ';
  if (confidence >= 0.8) cls += 'confidence-high';
  else if (confidence >= 0.5) cls += 'confidence-medium';
  else cls += 'confidence-low';
  return (
    <span title={`Confidence: ${(confidence * 100).toFixed(0)}%`}>
      <span className={cls} />
      <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
        {(confidence * 100).toFixed(0)}%
      </span>
    </span>
  );
}

function FieldRow({ label, field }: { label: string; field: FieldValue }) {
  return (
    <div className="field-grid" style={{ padding: '0.5rem 0', borderBottom: '1px solid var(--border)' }}>
      <div className="field-label">{label.replace(/_/g, ' ')}</div>
      <div className="field-value">{field.value || 'N/A'}</div>
      <div><ConfidenceDot confidence={field.confidence} /></div>
    </div>
  );
}

export function AnalysisResultView({ fixedFields, dynamicFields, specialFields }: AnalysisResultProps) {
  // Unwrap nested structure from LLM response
  const fixed = fixedFields
    ? (fixedFields as { fixed_fields?: Record<string, FieldValue> }).fixed_fields || fixedFields
    : null;

  const dynamic = dynamicFields
    ? (dynamicFields as { dynamic_fields?: Record<string, Record<string, FieldValue>> }).dynamic_fields || dynamicFields
    : null;

  const special = specialFields
    ? (specialFields as { special_fields?: SpecialFieldsData }).special_fields || (specialFields as SpecialFieldsData)
    : null;

  return (
    <div>
      {/* Fixed Fields */}
      {fixed && Object.keys(fixed).length > 0 && (
        <div className="card">
          <h2>Fixed Fields</h2>
          {Object.entries(fixed as Record<string, FieldValue>).map(([key, field]) => (
            <FieldRow key={key} label={key} field={field} />
          ))}
        </div>
      )}

      {/* Dynamic Fields */}
      {dynamic && Object.keys(dynamic).length > 0 && (
        <div className="card">
          <h2>Dynamic Fields</h2>
          {Object.entries(dynamic as Record<string, Record<string, FieldValue>>).map(
            ([category, fields]) => (
              <div key={category} style={{ marginBottom: '1.5rem' }}>
                <h3>{category}</h3>
                {fields && typeof fields === 'object' && Object.keys(fields).length > 0 ? (
                  Object.entries(fields).map(([key, field]) => (
                    <FieldRow key={key} label={key} field={field} />
                  ))
                ) : (
                  <p style={{ color: 'var(--muted)', fontSize: '0.85rem', padding: '0.5rem 0' }}>
                    No fields extracted
                  </p>
                )}
              </div>
            )
          )}
        </div>
      )}

      {/* Special Fields */}
      {special && Object.keys(special).length > 0 && (
        <div className="card">
          <h2>Supplier-Specific Fields</h2>
          {Object.entries(special as SpecialFieldsData).map(([supplierName, fields]) => (
            <div key={supplierName} style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ textTransform: 'capitalize', marginBottom: '0.75rem' }}>
                {supplierName} Entitlement Fields
              </h3>
              {fields && typeof fields === 'object' && Object.keys(fields).length > 0 ? (
                Object.entries(fields).map(([key, field]) => {
                  const f = field as SpecialFieldEntry;
                  return (
                    <div
                      key={key}
                      className="field-grid"
                      style={{ padding: '0.5rem 0', borderBottom: '1px solid var(--border)' }}
                    >
                      <div className="field-label">{key.replace(/_/g, ' ')}</div>
                      <div className="field-value">
                        {f.value !== null && f.value !== undefined && f.value !== ''
                          ? String(f.value)
                          : 'N/A'}
                        {f.description && (
                          <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '0.2rem' }}>
                            {f.description}
                          </div>
                        )}
                      </div>
                      <div><ConfidenceDot confidence={f.confidence} /></div>
                    </div>
                  );
                })
              ) : (
                <p style={{ color: 'var(--muted)', fontSize: '0.85rem', padding: '0.5rem 0' }}>
                  No supplier-specific fields extracted
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {(!fixed || Object.keys(fixed).length === 0) &&
        (!dynamic || Object.keys(dynamic).length === 0) &&
        (!special || Object.keys(special).length === 0) && (
          <div className="empty-state">
            <p>No analysis results available.</p>
          </div>
        )}
    </div>
  );
}
