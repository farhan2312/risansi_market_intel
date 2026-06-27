'use client';

import { useState, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { uploadPumps } from '@/app/actions/risansi-pumps';
import type { PumpUploadResult } from '@/app/actions/risansi-pumps';

// ── Types ──────────────────────────────────────────────────────

type RowStatus = 'valid' | 'invalid_code' | 'checking';

interface UploadRow {
  code:        string;
  clientName:  string;   // from Excel (display only)
  model:       string;
  quantity:    number;
  srNo:        string;
  ecNo:        string;
  ecDate:      string;   // ISO 'YYYY-MM-DD' or ''
  soDate:      string;
  liquid:      string;
  capacity:    string;
  head:        string;
  supplier:    string;
  status:      RowStatus;
  statusMsg:   string;
  dbClientName?: string;
}

type Stage = 'empty' | 'validating' | 'preview' | 'saving' | 'done';

// ── Helpers ────────────────────────────────────────────────────

// Normalise an Excel cell to an ISO date string. Handles JS Date (cellDates),
// Excel serial numbers, and DD/MM/YYYY · DD-MM-YYYY · YYYY-MM-DD strings.
function toIsoDate(v: unknown): string {
  if (v == null || v === '') return '';
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return '';
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  if (typeof v === 'number') {
    const dt = new Date(Math.round((v - 25569) * 86400 * 1000));
    return isNaN(dt.getTime()) ? '' : dt.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) {
    const dd = m[1].padStart(2, '0');
    const mm = m[2].padStart(2, '0');
    const yy = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${yy}-${mm}-${dd}`;
  }
  return '';
}

const cell = (v: unknown) => (v == null ? '' : String(v).trim());

// ── Styles ─────────────────────────────────────────────────────

const TH = {
  padding: '9px 12px', fontSize: 11, fontWeight: 600,
  color: 'var(--fg-3)', textTransform: 'uppercase' as const,
  letterSpacing: '0.06em', borderBottom: '2px solid var(--line)',
  whiteSpace: 'nowrap' as const, background: 'var(--bg-elev)',
};

// ── Component ─────────────────────────────────────────────────

export function PumpUploadBox() {
  const [dragOver, setDragOver] = useState(false);
  const [rows,     setRows]     = useState<UploadRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [stage,    setStage]    = useState<Stage>('empty');
  const [result,   setResult]   = useState<PumpUploadResult | null>(null);
  const [error,    setError]    = useState('');

  const processFile = useCallback(async (file: File) => {
    if (!file) return;
    setFileName(file.name);
    setStage('validating');
    setError('');
    setRows([]);

    try {
      const buffer = await file.arrayBuffer();
      const wb     = XLSX.read(buffer, { type: 'array', cellDates: true });
      const ws     = wb.Sheets[wb.SheetNames[0]];
      const raw    = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' }) as unknown[][];

      if (!raw || raw.length < 2) {
        setError('File appears empty or unreadable.');
        setStage('empty');
        return;
      }

      const headers = (raw[0] as string[]).map(h => h?.toString().trim().toLowerCase());
      const find = (pred: (h: string) => boolean) => headers.findIndex(h => pred(h));

      const colCode     = find(h => h.includes('code'));
      const colName     = find(h => h.includes('name'));
      const colModel    = find(h => h.includes('model'));
      const colQty      = find(h => h.includes('qty') || h.includes('quantity'));
      const colSr       = find(h => h.includes('sr') || h.includes('serial') || h.includes('sl no'));
      const colEcDate   = find(h => h.includes('ec') && h.includes('date'));
      const colSoDate   = find(h => h.includes('so') && h.includes('date'));
      const colEcNo     = find(h => h.includes('ec') && (h.includes('no') || h.includes('number')) && !h.includes('date'));
      const colLiquid   = find(h => h.includes('liquid'));
      const colCapacity = find(h => h.includes('capacity'));
      const colHead     = find(h => h.includes('head'));
      const colSupplier = find(h => h.includes('supplier'));

      if (colCode < 0 || colModel < 0) {
        setError(
          'Wrong template format. Expected columns: Client Code, Client Name, Model, Quantity, SR No, ' +
          'EC No, EC Date, SO Date, Liquid, Capacity, Head, Supplier. Please use the official template.',
        );
        setStage('empty');
        return;
      }

      const dataRows = raw.slice(1).filter(row => (row as unknown[])[colCode]?.toString().trim());
      if (dataRows.length === 0) {
        setError('No data rows found. Please fill in the template and try again.');
        setStage('empty');
        return;
      }
      if (dataRows.length > 1000) {
        setError('Too many rows. Maximum 1000 pumps per upload.');
        setStage('empty');
        return;
      }

      const at = (row: unknown[], i: number) => (i >= 0 ? row[i] : '');
      const parsed: UploadRow[] = dataRows.map(r => {
        const row = r as unknown[];
        const qtyNum = parseInt(cell(at(row, colQty)).replace(/[^0-9]/g, ''), 10);
        return {
          code:       cell(at(row, colCode)).toUpperCase(),
          clientName: cell(at(row, colName)),
          model:      cell(at(row, colModel)),
          quantity:   Number.isFinite(qtyNum) && qtyNum > 0 ? qtyNum : 1,
          srNo:       cell(at(row, colSr)),
          ecNo:       cell(at(row, colEcNo)),
          ecDate:     toIsoDate(at(row, colEcDate)),
          soDate:     toIsoDate(at(row, colSoDate)),
          liquid:     cell(at(row, colLiquid)),
          capacity:   cell(at(row, colCapacity)),
          head:       cell(at(row, colHead)),
          supplier:   cell(at(row, colSupplier)),
          status:     'checking' as const,
          statusMsg:  'Validating…',
        };
      });

      setRows(parsed);

      // Validate client codes against the DB (reuses the generic codes endpoint).
      const codes = [...new Set(parsed.map(r => r.code))];
      const res   = await fetch('/api/risansi/validate-revenue-codes', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ codes }),
      });
      const { found, notFound } = await res.json() as {
        found:    Record<string, { id: string; legal_name: string }>;
        notFound: string[];
      };

      setRows(parsed.map(row => {
        if (notFound.includes(row.code)) {
          return { ...row, status: 'invalid_code' as const, statusMsg: `Code "${row.code}" not found in system` };
        }
        return { ...row, status: 'valid' as const, statusMsg: 'Ready to import', dbClientName: found[row.code]?.legal_name };
      }));
      setStage('preview');

    } catch (err: unknown) {
      setError('Failed to parse file: ' + (err instanceof Error ? err.message : 'Unknown error'));
      setStage('empty');
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [processFile]);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const handleSave = async () => {
    const validRows = rows.filter(r => r.status === 'valid');
    if (validRows.length === 0) return;
    setStage('saving');
    try {
      const payload = validRows.map(r => ({
        client_code: r.code,
        model:       r.model,
        quantity:    r.quantity,
        sr_no:       r.srNo,
        ec_no:       r.ecNo,
        ec_date:     r.ecDate,
        so_date:     r.soDate,
        liquid:      r.liquid,
        capacity:    r.capacity,
        head:        r.head,
        supplier:    r.supplier,
        filename:    fileName,
      }));
      const res = await uploadPumps(payload);
      setResult(res);
      setStage('done');
    } catch (err: unknown) {
      setError('Save failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
      setStage('preview');
    }
  };

  const reset = () => {
    setRows([]); setFileName(''); setStage('empty'); setResult(null); setError('');
  };

  // ── Stage: empty / validating ─────────────────────────────────

  if (stage === 'empty' || stage === 'validating') {
    return (
      <div style={{ background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', marginBottom: 16 }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--line)', fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>
          Upload Installed Pumps
        </div>

        {error && (
          <div style={{ margin: '16px 20px 0', padding: '10px 14px', background: '#FDE8E8', border: '1px solid #F87171', borderLeft: '3px solid #E02424', borderRadius: 6, color: '#9B1C1C', fontSize: 13 }}>
            ⚠ {error}
          </div>
        )}

        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => document.getElementById('pump-file-input')?.click()}
          style={{
            margin: 20,
            border: `2px dashed ${dragOver ? 'var(--accent)' : 'var(--line-strong, #CBD5E1)'}`,
            borderRadius: 10, padding: '48px 24px', textAlign: 'center',
            background: dragOver ? 'var(--accent-soft, #EBF1FB)' : 'var(--bg-elev)',
            transition: 'all 200ms', cursor: stage === 'validating' ? 'default' : 'pointer',
          }}
        >
          <div style={{ fontSize: 32, marginBottom: 8 }}>⚙️</div>
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--fg-2)' }}>
            {stage === 'validating' ? 'Validating…' : 'Drop your Excel file here or click to browse'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 6 }}>
            Accepts .xlsx files only · Max 1000 pumps
          </div>
          <input id="pump-file-input" type="file" accept=".xlsx" style={{ display: 'none' }} onChange={handleFileInput} />
        </div>
      </div>
    );
  }

  // ── Stage: preview ────────────────────────────────────────────

  if (stage === 'preview') {
    const validCount   = rows.filter(r => r.status === 'valid').length;
    const invalidCount = rows.length - validCount;
    const totalPumps   = rows.filter(r => r.status === 'valid').reduce((s, r) => s + r.quantity, 0);

    return (
      <div style={{ background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', marginBottom: 16 }}>
        <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Preview · {fileName}</span>
            <span style={{ marginLeft: 12, fontSize: 12, color: 'var(--fg-3)' }}>{rows.length} rows parsed</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={reset} style={{ padding: '7px 14px', borderRadius: 6, fontFamily: 'inherit', border: '1px solid var(--line-strong, #CBD5E1)', background: 'white', cursor: 'pointer', fontSize: 13 }}>
              Cancel
            </button>
            <button onClick={handleSave} disabled={validCount === 0} style={{
              padding: '7px 16px', borderRadius: 6, fontFamily: 'inherit',
              background: validCount > 0 ? '#0A3D8F' : 'var(--bg-sunk)',
              color: validCount > 0 ? 'white' : 'var(--fg-3)', border: 'none',
              cursor: validCount > 0 ? 'pointer' : 'not-allowed', fontSize: 13, fontWeight: 500,
            }}>
              Save {validCount} pump{validCount !== 1 ? 's' : ''}
            </button>
          </div>
        </div>

        <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--line)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 500, background: '#D1FAE5', color: '#065F46' }}>
            ✓ {validCount} ready to import
          </span>
          {invalidCount > 0 && (
            <span style={{ padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 500, background: '#FDE8E8', color: '#9B1C1C' }}>
              ✗ {invalidCount} will be skipped
            </span>
          )}
          <span style={{ padding: '4px 10px', borderRadius: 20, fontSize: 12, background: 'var(--bg-elev)', color: 'var(--fg-2)', fontFamily: 'var(--font-mono)' }}>
            {totalPumps} pump unit{totalPumps !== 1 ? 's' : ''} total
          </span>
        </div>

        <div style={{ overflowX: 'auto', maxHeight: 420, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
              <tr>
                <th style={{ ...TH, textAlign: 'left' }}>Status</th>
                <th style={{ ...TH, textAlign: 'left' }}>Code</th>
                <th style={{ ...TH, textAlign: 'left' }}>Client (from DB)</th>
                <th style={{ ...TH, textAlign: 'left' }}>Model</th>
                <th style={{ ...TH, textAlign: 'right' }}>Qty</th>
                <th style={{ ...TH, textAlign: 'left' }}>SR No</th>
                <th style={{ ...TH, textAlign: 'left' }}>EC No</th>
                <th style={{ ...TH, textAlign: 'left' }}>Liquid</th>
                <th style={{ ...TH, textAlign: 'left' }}>Supplier</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} style={{ background: row.status !== 'valid' ? '#FFF8F8' : 'white', borderBottom: '1px solid var(--line)' }}>
                  <td style={{ padding: '8px 12px' }}>
                    {row.status === 'valid'
                      ? <span style={{ color: '#065F46', fontSize: 11, fontWeight: 600 }}>✓ Ready</span>
                      : <span title={row.statusMsg} style={{ color: '#9B1C1C', fontSize: 11, fontWeight: 600, cursor: 'help' }}>✗ Code not found</span>}
                  </td>
                  <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', fontSize: 11, color: row.status !== 'valid' ? '#9B1C1C' : 'var(--fg)' }}>{row.code}</td>
                  <td style={{ padding: '8px 12px', color: 'var(--fg-2)' }}>
                    {row.dbClientName ?? <span style={{ color: '#9B1C1C', fontStyle: 'italic', fontSize: 11 }}>{row.statusMsg}</span>}
                  </td>
                  <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{row.model || '—'}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{row.quantity}</td>
                  <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{row.srNo || '—'}</td>
                  <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{row.ecNo || '—'}</td>
                  <td style={{ padding: '8px 12px', color: 'var(--fg-2)' }}>{row.liquid || '—'}</td>
                  <td style={{ padding: '8px 12px', color: 'var(--fg-2)' }}>{row.supplier || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // ── Stage: saving ─────────────────────────────────────────────

  if (stage === 'saving') {
    return (
      <div style={{ background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', marginBottom: 16, padding: '48px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: 28, marginBottom: 12 }}>⏳</div>
        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--fg)' }}>Saving pump data…</div>
      </div>
    );
  }

  // ── Stage: done ───────────────────────────────────────────────

  if (stage === 'done' && result) {
    return (
      <div style={{ background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', marginBottom: 16, padding: '32px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>✅</div>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>Upload Complete</div>
        <div style={{ fontSize: 13, color: 'var(--fg-3)', marginBottom: 4 }}>
          <span style={{ color: '#065F46', fontWeight: 600 }}>{result.inserted}</span> inserted ·{' '}
          <span style={{ color: '#1E40AF', fontWeight: 600 }}>{result.updated}</span> updated ·{' '}
          <span style={{ color: result.skipped > 0 ? '#9B1C1C' : 'var(--fg-3)', fontWeight: result.skipped > 0 ? 600 : 400 }}>{result.skipped}</span> skipped
        </div>
        {result.skippedCodes.length > 0 && (
          <div style={{ marginTop: 8, fontSize: 12, color: '#9B1C1C' }}>Codes not found: {result.skippedCodes.join(', ')}</div>
        )}
        <button onClick={() => window.location.reload()} style={{ marginTop: 20, padding: '8px 20px', borderRadius: 6, fontFamily: 'inherit', background: '#0A3D8F', color: 'white', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>
          Upload Another File
        </button>
      </div>
    );
  }

  return null;
}
