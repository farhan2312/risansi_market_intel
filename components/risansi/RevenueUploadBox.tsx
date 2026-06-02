'use client';

import { useState, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { uploadRevenue } from '@/app/actions/risansi-revenue';
import type { UploadResult } from '@/app/actions/risansi-revenue';

// ── Types ──────────────────────────────────────────────────────

type RowStatus = 'valid' | 'invalid_code' | 'invalid_month' | 'checking';

interface UploadRow {
  code:          string;
  clientName:    string;   // from Excel (display only)
  month:         string;   // raw "May-2026"
  pump:          number;
  spare:         number;
  total:         number;
  status:        RowStatus;
  statusMsg:     string;
  dbClientId?:   string;
  dbClientName?: string;
}

type Stage = 'empty' | 'validating' | 'preview' | 'saving' | 'done';

// ── Month parsing ──────────────────────────────────────────────

const MONTHS: Record<string, string> = {
  Jan:'01', Feb:'02', Mar:'03', Apr:'04',
  May:'05', Jun:'06', Jul:'07', Aug:'08',
  Sep:'09', Oct:'10', Nov:'11', Dec:'12',
};

function parseMonth(raw: string): string | null {
  const parts = raw?.trim().split('-');
  if (parts?.length !== 2) return null;
  const mon = MONTHS[parts[0]];
  const yr  = parts[1];
  if (!mon || !/^\d{4}$/.test(yr)) return null;
  return `${yr}-${mon}-01`;
}

// ── Styles ─────────────────────────────────────────────────────

const TH = {
  padding: '9px 12px', fontSize: 11, fontWeight: 600,
  color: 'var(--fg-3)', textTransform: 'uppercase' as const,
  letterSpacing: '0.06em', borderBottom: '2px solid var(--line)',
  whiteSpace: 'nowrap' as const, background: 'var(--bg-elev)',
};

// ── Component ─────────────────────────────────────────────────

export function RevenueUploadBox() {
  const [dragOver, setDragOver] = useState(false);
  const [rows,     setRows]     = useState<UploadRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [stage,    setStage]    = useState<Stage>('empty');
  const [result,   setResult]   = useState<UploadResult | null>(null);
  const [error,    setError]    = useState('');

  // ── File processing ──────────────────────────────────────────

  const processFile = useCallback(async (file: File) => {
    if (!file) return;
    setFileName(file.name);
    setStage('validating');
    setError('');
    setRows([]);

    try {
      const buffer = await file.arrayBuffer();
      const wb     = XLSX.read(buffer, { type: 'array' });
      const ws     = wb.Sheets[wb.SheetNames[0]];
      const raw    = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' }) as unknown[][];

      if (!raw || raw.length < 2) {
        setError('File appears empty or unreadable.');
        setStage('empty');
        return;
      }

      // Validate headers
      const headers = (raw[0] as string[]).map(h => h?.toString().trim().toLowerCase());
      const colCode  = headers.findIndex(h => h.includes('code'));
      const colName  = headers.findIndex(h => h.includes('name'));
      const colMonth = headers.findIndex(h => h.includes('month'));
      const colPump  = headers.findIndex(h => h.includes('pump'));
      const colSpare = headers.findIndex(h => h.includes('spare'));

      if (colCode < 0 || colMonth < 0 || colPump < 0 || colSpare < 0) {
        setError(
          'Wrong template format. Expected columns: Client Code, Client Name, Month, Pump Value, Spare Value. ' +
          'Please download and use the official template.',
        );
        setStage('empty');
        return;
      }

      // Parse data rows
      const dataRows = raw.slice(1).filter(row => {
        const arr = row as string[];
        return arr[colCode]?.toString().trim();
      }) as string[][];

      if (dataRows.length === 0) {
        setError('No data rows found. Please fill in the template and try again.');
        setStage('empty');
        return;
      }

      if (dataRows.length > 500) {
        setError('Too many rows. Maximum 500 rows per upload.');
        setStage('empty');
        return;
      }

      const parsed: UploadRow[] = dataRows.map(row => {
        const code  = row[colCode]?.toString().trim().toUpperCase() ?? '';
        const month = row[colMonth]?.toString().trim() ?? '';
        const pump  = parseFloat(row[colPump]?.toString().replace(/,/g, '')) || 0;
        const spare = parseFloat(row[colSpare]?.toString().replace(/,/g, '')) || 0;
        return {
          code,
          clientName: row[colName]?.toString().trim() ?? '',
          month,
          pump,
          spare,
          total: pump + spare,
          status:    'checking' as const,
          statusMsg: 'Validating…',
        };
      });

      setRows(parsed);

      // Validate codes against DB
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

      const validated = parsed.map(row => {
        if (!parseMonth(row.month)) {
          return {
            ...row,
            status:    'invalid_month' as const,
            statusMsg: `Invalid month format "${row.month}". Use May-2026`,
          };
        }
        if (notFound.includes(row.code)) {
          return {
            ...row,
            status:    'invalid_code' as const,
            statusMsg: `Code "${row.code}" not found in system`,
          };
        }
        const db = found[row.code];
        return {
          ...row,
          status:        'valid' as const,
          statusMsg:     'Ready to import',
          dbClientId:    db.id,
          dbClientName:  db.legal_name,
        };
      });

      setRows(validated);
      setStage('preview');

    } catch (err: unknown) {
      setError('Failed to parse file: ' + (err instanceof Error ? err.message : 'Unknown error'));
      setStage('empty');
    }
  }, []);

  // ── Handlers ─────────────────────────────────────────────────

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
        month:       r.month,
        pump_value:  r.pump,
        spare_value: r.spare,
        filename:    fileName,
      }));
      const res = await uploadRevenue(payload);
      setResult(res);
      setStage('done');
    } catch (err: unknown) {
      setError('Save failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
      setStage('preview');
    }
  };

  const reset = () => {
    setRows([]);
    setFileName('');
    setStage('empty');
    setResult(null);
    setError('');
  };

  // ── Stage: empty / validating ─────────────────────────────────

  if (stage === 'empty' || stage === 'validating') {
    return (
      <div style={{
        background: 'var(--bg-paper)', border: '1px solid var(--line)',
        borderRadius: 'var(--radius)', marginBottom: 16,
      }}>
        <div style={{
          padding: '14px 20px', borderBottom: '1px solid var(--line)',
          fontSize: 14, fontWeight: 600, color: 'var(--fg)',
        }}>
          Upload Revenue Data
        </div>

        {error && (
          <div style={{
            margin: '16px 20px 0', padding: '10px 14px',
            background: '#FDE8E8', border: '1px solid #F87171',
            borderLeft: '3px solid #E02424', borderRadius: 6,
            color: '#9B1C1C', fontSize: 13,
          }}>
            ⚠ {error}
          </div>
        )}

        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => document.getElementById('rev-file-input')?.click()}
          style={{
            margin: 20,
            border: `2px dashed ${dragOver ? 'var(--accent)' : 'var(--line-strong, #CBD5E1)'}`,
            borderRadius: 10,
            padding: '48px 24px',
            textAlign: 'center',
            background: dragOver ? 'var(--accent-soft, #EBF1FB)' : 'var(--bg-elev)',
            transition: 'all 200ms',
            cursor: stage === 'validating' ? 'default' : 'pointer',
          }}
        >
          <div style={{ fontSize: 32, marginBottom: 8 }}>📊</div>
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--fg-2)' }}>
            {stage === 'validating'
              ? 'Validating…'
              : 'Drop your Excel file here or click to browse'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 6 }}>
            Accepts .xlsx files only · Max 500 rows
          </div>
          <input
            id="rev-file-input"
            type="file"
            accept=".xlsx"
            style={{ display: 'none' }}
            onChange={handleFileInput}
          />
        </div>
      </div>
    );
  }

  // ── Stage: preview ────────────────────────────────────────────

  if (stage === 'preview') {
    const validCount   = rows.filter(r => r.status === 'valid').length;
    const invalidCount = rows.length - validCount;
    const totalPump    = rows.filter(r => r.status === 'valid').reduce((s, r) => s + r.pump, 0);
    const totalSpare   = rows.filter(r => r.status === 'valid').reduce((s, r) => s + r.spare, 0);

    return (
      <div style={{
        background: 'var(--bg-paper)', border: '1px solid var(--line)',
        borderRadius: 'var(--radius)', marginBottom: 16,
      }}>
        {/* Header */}
        <div style={{
          padding: '12px 20px', borderBottom: '1px solid var(--line)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Preview · {fileName}</span>
            <span style={{ marginLeft: 12, fontSize: 12, color: 'var(--fg-3)' }}>
              {rows.length} rows parsed
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={reset} style={{
              padding: '7px 14px', borderRadius: 6, fontFamily: 'inherit',
              border: '1px solid var(--line-strong, #CBD5E1)',
              background: 'white', cursor: 'pointer', fontSize: 13,
            }}>
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={validCount === 0}
              style={{
                padding: '7px 16px', borderRadius: 6, fontFamily: 'inherit',
                background: validCount > 0 ? '#0A3D8F' : 'var(--bg-sunk)',
                color: validCount > 0 ? 'white' : 'var(--fg-3)',
                border: 'none',
                cursor: validCount > 0 ? 'pointer' : 'not-allowed',
                fontSize: 13, fontWeight: 500,
              }}
            >
              Save {validCount} row{validCount !== 1 ? 's' : ''}
            </button>
          </div>
        </div>

        {/* Summary chips */}
        <div style={{
          padding: '10px 20px', borderBottom: '1px solid var(--line)',
          display: 'flex', gap: 8, flexWrap: 'wrap',
        }}>
          <span style={{
            padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 500,
            background: '#D1FAE5', color: '#065F46',
          }}>
            ✓ {validCount} ready to import
          </span>
          {invalidCount > 0 && (
            <span style={{
              padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 500,
              background: '#FDE8E8', color: '#9B1C1C',
            }}>
              ✗ {invalidCount} will be skipped
            </span>
          )}
          <span style={{
            padding: '4px 10px', borderRadius: 20, fontSize: 12,
            background: 'var(--bg-elev)', color: 'var(--fg-2)',
            fontFamily: 'var(--font-mono)',
          }}>
            Pump: ₹{(totalPump / 100000).toFixed(2)}L ·{' '}
            Spare: ₹{(totalSpare / 100000).toFixed(2)}L ·{' '}
            Total: ₹{((totalPump + totalSpare) / 100000).toFixed(2)}L
          </span>
        </div>

        {/* Preview table */}
        <div style={{ overflowX: 'auto', maxHeight: 420, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
              <tr>
                <th style={{ ...TH, textAlign: 'left' }}>Status</th>
                <th style={{ ...TH, textAlign: 'left' }}>Code</th>
                <th style={{ ...TH, textAlign: 'left' }}>Client (from DB)</th>
                <th style={{ ...TH, textAlign: 'left' }}>Month</th>
                <th style={{ ...TH, textAlign: 'right' }}>Pump ₹</th>
                <th style={{ ...TH, textAlign: 'right' }}>Spare ₹</th>
                <th style={{ ...TH, textAlign: 'right' }}>Total ₹</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} style={{
                  background: row.status !== 'valid' ? '#FFF8F8' : 'white',
                  borderBottom: '1px solid var(--line)',
                }}>
                  <td style={{ padding: '8px 12px' }}>
                    {row.status === 'valid' ? (
                      <span style={{ color: '#065F46', fontSize: 11, fontWeight: 600 }}>✓ Ready</span>
                    ) : (
                      <span
                        title={row.statusMsg}
                        style={{ color: '#9B1C1C', fontSize: 11, fontWeight: 600, cursor: 'help' }}
                      >
                        ✗ {row.status === 'invalid_code' ? 'Code not found' : 'Invalid month'}
                      </span>
                    )}
                  </td>
                  <td style={{
                    padding: '8px 12px', fontFamily: 'var(--font-mono)', fontSize: 11,
                    color: row.status !== 'valid' ? '#9B1C1C' : 'var(--fg)',
                  }}>
                    {row.code}
                  </td>
                  <td style={{ padding: '8px 12px', color: 'var(--fg-2)' }}>
                    {row.dbClientName ?? (
                      <span style={{ color: '#9B1C1C', fontStyle: 'italic', fontSize: 11 }}>
                        {row.statusMsg}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                    {row.month}
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                    {row.pump > 0 ? row.pump.toLocaleString('en-IN') : '—'}
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                    {row.spare > 0 ? row.spare.toLocaleString('en-IN') : '—'}
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                    {row.total > 0 ? row.total.toLocaleString('en-IN') : '—'}
                  </td>
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
      <div style={{
        background: 'var(--bg-paper)', border: '1px solid var(--line)',
        borderRadius: 'var(--radius)', marginBottom: 16,
        padding: '48px 24px', textAlign: 'center',
      }}>
        <div style={{ fontSize: 28, marginBottom: 12 }}>⏳</div>
        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--fg)' }}>
          Saving revenue data…
        </div>
      </div>
    );
  }

  // ── Stage: done ───────────────────────────────────────────────

  if (stage === 'done' && result) {
    return (
      <div style={{
        background: 'var(--bg-paper)', border: '1px solid var(--line)',
        borderRadius: 'var(--radius)', marginBottom: 16,
        padding: '32px 24px', textAlign: 'center',
      }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>✅</div>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>Upload Complete</div>
        <div style={{ fontSize: 13, color: 'var(--fg-3)', marginBottom: 4 }}>
          <span style={{ color: '#065F46', fontWeight: 600 }}>{result.inserted}</span> inserted ·{' '}
          <span style={{ color: '#1E40AF', fontWeight: 600 }}>{result.updated}</span> updated ·{' '}
          <span style={{ color: result.skipped > 0 ? '#9B1C1C' : 'var(--fg-3)', fontWeight: result.skipped > 0 ? 600 : 400 }}>
            {result.skipped}
          </span> skipped
        </div>
        {result.skippedCodes.length > 0 && (
          <div style={{ marginTop: 8, fontSize: 12, color: '#9B1C1C' }}>
            Codes not found: {result.skippedCodes.join(', ')}
          </div>
        )}
        <button
          onClick={() => window.location.reload()}
          style={{
            marginTop: 20, padding: '8px 20px', borderRadius: 6, fontFamily: 'inherit',
            background: '#0A3D8F', color: 'white',
            border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500,
          }}
        >
          Upload Another File
        </button>
      </div>
    );
  }

  return null;
}
