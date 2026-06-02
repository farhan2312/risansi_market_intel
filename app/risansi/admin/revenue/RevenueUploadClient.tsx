'use client';

import { useState, useRef, useCallback } from 'react';
import { uploadRevenue } from '@/app/actions/risansi-admin-revenue';

interface ParsedRow {
  client_code:  string;
  client_name:  string;
  month:        string;
  pump_value:   number;
  spare_value:  number;
  total_value:  number;
  status:       'found' | 'not_found' | 'duplicate';
  client_id?:   number;
}

interface UploadResult { inserted: number; skipped: number; }

const MONTHS: Record<string, string> = {
  jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',
  jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12',
};

function fmtInr(n: number) {
  if (n === 0) return '—';
  if (n >= 1e7) return `₹${(n/1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `₹${(n/1e5).toFixed(2)} L`;
  return `₹${n.toLocaleString('en-IN')}`;
}

export function RevenueUploadClient({ existingCodes }: { existingCodes: Set<string> }) {
  const [rows,    setRows]    = useState<ParsedRow[] | null>(null);
  const [file,    setFile]    = useState<File | null>(null);
  const [saving,  setSaving]  = useState(false);
  const [result,  setResult]  = useState<UploadResult | null>(null);
  const [error,   setError]   = useState('');
  const [dragging,setDragging]= useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(async (f: File) => {
    setFile(f);
    setRows(null);
    setResult(null);
    setError('');
    try {
      const XLSX = await import('xlsx');
      const buf  = await f.arrayBuffer();
      const wb   = XLSX.read(buf, { type: 'array' });
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const raw  = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });

      const parsed: ParsedRow[] = raw.map(r => {
        const code       = String(r['Code'] ?? r['code'] ?? '').trim().toUpperCase();
        const clientName = String(r['Client Name'] ?? r['client_name'] ?? '').trim();
        const month      = String(r['Month'] ?? r['month'] ?? '').trim();
        const pump       = Number(r['Pump Value (₹)'] ?? r['pump_value'] ?? 0) || 0;
        const spare      = Number(r['Spare Value (₹)'] ?? r['spare_value'] ?? 0) || 0;
        const total      = pump + spare;
        const found      = existingCodes.has(code);
        return {
          client_code: code,
          client_name: clientName,
          month,
          pump_value:  pump,
          spare_value: spare,
          total_value: total,
          status: found ? 'found' : 'not_found',
        };
      }).filter(r => r.client_code);

      setRows(parsed);
    } catch (err) {
      setError(`Failed to parse file: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }, [existingCodes]);

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) processFile(f);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) processFile(f);
  }

  async function handleSave() {
    if (!rows) return;
    const toSave = rows.filter(r => r.status === 'found');
    setSaving(true); setError('');
    try {
      const res = await uploadRevenue(toSave.map(r => ({
        client_code:  r.client_code,
        month:        r.month,
        pump_value:   r.pump_value,
        spare_value:  r.spare_value,
      })));
      setResult(res);
      setRows(null); setFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const validRows   = rows?.filter(r => r.status === 'found').length ?? 0;
  const invalidRows = rows?.filter(r => r.status === 'not_found').length ?? 0;

  return (
    <div>
      {/* Template download */}
      <div style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
        <a
          href="/revenue_upload_template.xlsx"
          download
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '7px 14px', fontSize: 12, fontWeight: 500,
            background: 'var(--bg-elev)', border: '1px solid var(--line-strong)',
            borderRadius: 5, color: 'var(--fg)', textDecoration: 'none',
          }}
        >
          ⬇ Download Template
        </a>
        <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>
          Expected columns: Code · Client Name · Month · Pump Value (₹) · Spare Value (₹) &nbsp;·&nbsp; Month format: May-2026
        </span>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        style={{
          border: `2px dashed ${dragging ? 'var(--accent)' : 'var(--line-strong)'}`,
          borderRadius: 8, padding: '32px 24px', textAlign: 'center',
          background: dragging ? 'var(--accent-soft)' : 'var(--bg)',
          cursor: 'pointer', transition: 'all 0.15s', marginBottom: 16,
        }}
      >
        <input ref={inputRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={onFileChange} />
        <div style={{ fontSize: 32, marginBottom: 8 }}>📤</div>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg)' }}>
          {file ? file.name : 'Drag and drop or click to upload .xlsx'}
        </div>
        <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 4 }}>Supports .xlsx and .xls files</div>
      </div>

      {/* Success result */}
      {result && (
        <div style={{
          padding: '12px 16px', marginBottom: 16,
          background: 'var(--pos-soft)', border: '1px solid rgba(5,150,105,0.25)',
          borderRadius: 6, fontSize: 13, color: '#065F46',
        }}>
          ✓ {result.inserted} row{result.inserted !== 1 ? 's' : ''} saved
          {result.skipped > 0 && `, ${result.skipped} skipped (code not found)`}
        </div>
      )}

      {error && (
        <div style={{
          padding: '10px 14px', marginBottom: 16,
          background: 'var(--neg-soft)', border: '1px solid rgba(220,38,38,0.2)',
          borderRadius: 6, fontSize: 12, color: '#991B1B',
        }}>
          {error}
        </div>
      )}

      {/* Preview table */}
      {rows && rows.length > 0 && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>
              Preview — {rows.length} rows
              {invalidRows > 0 && (
                <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--neg)' }}>
                  {invalidRows} code{invalidRows !== 1 ? 's' : ''} not found
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => { setRows(null); setFile(null); }} style={{
                padding: '6px 14px', fontSize: 12, fontFamily: 'inherit',
                border: '1px solid var(--line-strong)', borderRadius: 5,
                background: 'transparent', cursor: 'pointer', color: 'var(--fg)',
              }}>
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || validRows === 0}
                style={{
                  padding: '6px 16px', fontSize: 12, fontFamily: 'inherit', fontWeight: 500,
                  background: (saving || validRows === 0) ? '#9CA3AF' : '#1A5CB8',
                  color: '#fff', border: 'none', borderRadius: 5,
                  cursor: (saving || validRows === 0) ? 'not-allowed' : 'pointer',
                }}
              >
                {saving ? 'Saving…' : `Confirm & Save ${validRows} row${validRows !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: 'var(--bg-elev)' }}>
                  {['Code', 'Client Name', 'Month', 'Pump ₹', 'Spare ₹', 'Total ₹', 'Status'].map(h => (
                    <th key={h} style={{
                      padding: '8px 12px', textAlign: 'left', fontSize: 10,
                      textTransform: 'uppercase', letterSpacing: '0.07em',
                      color: 'var(--fg-3)', borderBottom: '1px solid var(--line)',
                      whiteSpace: 'nowrap',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--line)' }}>
                    <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)' }}>
                      {row.client_code}
                    </td>
                    <td style={{ padding: '8px 12px' }}>{row.client_name || '—'}</td>
                    <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{row.month}</td>
                    <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', textAlign: 'right' }}>{fmtInr(row.pump_value)}</td>
                    <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', textAlign: 'right' }}>{fmtInr(row.spare_value)}</td>
                    <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', textAlign: 'right', fontWeight: 500 }}>{fmtInr(row.total_value)}</td>
                    <td style={{ padding: '8px 12px' }}>
                      {row.status === 'found'     && <span style={{ color: 'var(--pos)', fontSize: 11, fontWeight: 500 }}>✓ Client found</span>}
                      {row.status === 'not_found' && <span style={{ color: 'var(--neg)', fontSize: 11, fontWeight: 500 }}>✗ Code not found</span>}
                      {row.status === 'duplicate' && <span style={{ color: 'var(--warn)', fontSize: 11, fontWeight: 500 }}>⚠ Duplicate</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
