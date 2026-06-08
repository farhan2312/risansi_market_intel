'use client';

import { useState, useEffect, type CSSProperties } from 'react';
import { updateOpportunity } from '@/app/actions/risansi';
import type { EditableOpp } from './EditOppDrawer';

interface Competitor { id: string; name: string; }

export function OppCompletionModal({ opp, stage, onSave, onCancel }: {
  opp: EditableOpp;
  stage: 'Won' | 'Lost';
  onSave: () => void;
  onCancel: () => void;
}) {
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState('');
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const isWon  = stage === 'Won';
  const isLost = stage === 'Lost';

  useEffect(() => {
    if (!isLost) return;
    fetch('/api/risansi/competitors')
      .then(r => r.json())
      .then(d => setCompetitors(Array.isArray(d) ? d : []))
      .catch(() => setCompetitors([]));
  }, [isLost]);

  const lakhs = (cr: number | string | null | undefined) =>
    cr != null && cr !== '' ? (parseFloat(String(cr)) * 100).toFixed(1) : '';

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const fd = new FormData(e.currentTarget);
      fd.set('stage', stage);
      fd.set('product', opp.product);
      fd.set('product_type', opp.product_type ?? 'PCP');
      fd.set('value_lakh', lakhs(opp.value_cr) || '0');
      await updateOpportunity(Number(opp.id), fd);
      onSave();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save');
      setLoading(false);
    }
  };

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 400 }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        width: 480, background: 'white', borderRadius: 12,
        boxShadow: '0 24px 64px rgba(0,0,0,0.2)', zIndex: 401, overflow: 'hidden',
      }}>
        {/* Coloured header */}
        <div style={{ padding: '20px 24px', background: isWon ? '#065F46' : '#9B1C1C', color: 'white' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 20, marginBottom: 4 }}>{isWon ? '🎉' : '❌'}</div>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>
                {isWon ? 'Mark as Won' : 'Mark as Lost'}
              </div>
              <div style={{ fontSize: 13, opacity: 0.85 }}>{opp.client_name} · {opp.product}</div>
            </div>
            <button onClick={onCancel} style={{
              background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: 6,
              color: 'white', cursor: 'pointer', width: 28, height: 28, fontSize: 16, lineHeight: 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>×</button>
          </div>
          <div style={{ marginTop: 10, fontSize: 11, opacity: 0.7, fontStyle: 'italic' }}>
            Press × to cancel and move the card back
          </div>
        </div>

        {/* Form body */}
        <form onSubmit={handleSubmit}>
          <div style={{ padding: '20px 24px' }}>
            {isWon && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={LABEL}>Final Value (₹ Lakhs) *</label>
                    <input
                      name="final_value_lakh" type="number" step="0.1" min="0" required
                      defaultValue={lakhs(opp.final_value_cr) || lakhs(opp.value_cr)}
                      placeholder="e.g. 12.5" style={INPUT}
                    />
                  </div>
                  <div>
                    <label style={LABEL}>PO Number</label>
                    <input name="po_number" defaultValue={opp.po_number ?? ''} placeholder="e.g. PO-2024-0182" style={INPUT} />
                    <p style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 4 }}>
                      Optional — can be added later by editing the opportunity
                    </p>
                  </div>
                </div>
                <div>
                  <label style={LABEL}>Notes (optional)</label>
                  <textarea name="notes" rows={3} defaultValue={opp.notes ?? ''} placeholder="Any notes about the win…" style={{ ...INPUT, resize: 'vertical' }} />
                </div>
                <div style={{ padding: '10px 14px', background: '#D1FAE5', borderRadius: 7, fontSize: 12, color: '#065F46' }}>
                  ✓ Once saved, this opportunity will be locked and cannot be edited further.
                </div>
              </div>
            )}

            {isLost && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={LABEL}>Lost To Competitor *</label>
                  <select name="lost_to_competitor" required style={INPUT}>
                    <option value="">— Select competitor —</option>
                    {competitors.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                    <option value="Price — No specific competitor">Price (no specific competitor)</option>
                    <option value="OEM Tied">OEM Tied</option>
                    <option value="Budget Cancelled">Budget Cancelled</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div>
                  <label style={LABEL}>Lost Reason *</label>
                  <select name="lost_reason" required style={INPUT}>
                    <option value="">— Select reason —</option>
                    <option value="Price — Too expensive">Price — Too expensive</option>
                    <option value="Technical — Spec mismatch">Technical — Spec mismatch</option>
                    <option value="OEM Tied — Forced preference">OEM Tied — Forced preference</option>
                    <option value="Relationship — Existing supplier">Relationship — Existing supplier</option>
                    <option value="Budget — Project cancelled">Budget — Project cancelled</option>
                    <option value="Delivery — Timeline mismatch">Delivery — Timeline mismatch</option>
                    <option value="No decision — Deferred">No decision — Deferred</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div>
                  <label style={LABEL}>Additional Notes (optional)</label>
                  <textarea name="notes" rows={3} defaultValue={opp.notes ?? ''} placeholder="What could we have done differently?" style={{ ...INPUT, resize: 'vertical' }} />
                </div>
                <div style={{ padding: '10px 14px', background: '#FDE8E8', borderRadius: 7, fontSize: 12, color: '#9B1C1C' }}>
                  ✗ Once saved, this opportunity will be locked. Lost data feeds the Win Rate and Competitor analysis.
                </div>
              </div>
            )}

            {error && (
              <div style={{ marginTop: 12, padding: '8px 12px', background: '#FDE8E8', border: '1px solid #F87171', borderLeft: '3px solid #E02424', borderRadius: 5, color: '#9B1C1C', fontSize: 12 }}>
                {error}
              </div>
            )}
          </div>

          {/* Footer */}
          <div style={{ padding: '12px 24px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--line)' }}>
            <button type="button" onClick={onCancel} style={{ padding: '8px 14px', borderRadius: 6, border: '1px solid var(--line-strong)', background: 'white', cursor: 'pointer', fontSize: 13, color: 'var(--fg-3)', fontFamily: 'inherit' }}>
              ← Go back (revert move)
            </button>
            <button type="submit" disabled={loading} style={{
              padding: '8px 20px', borderRadius: 6, background: isWon ? '#065F46' : '#9B1C1C',
              color: 'white', border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: 13, fontWeight: 500, fontFamily: 'inherit', opacity: loading ? 0.7 : 1,
            }}>
              {loading ? 'Saving…' : isWon ? '🎉 Confirm Won' : '❌ Confirm Lost'}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

const LABEL: CSSProperties = {
  fontSize: 11, fontWeight: 600, color: 'var(--fg-3)',
  textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 5,
};

const INPUT: CSSProperties = {
  width: '100%', padding: '8px 10px', border: '1px solid var(--line-strong)',
  borderRadius: 6, fontSize: 13, background: 'white', color: 'var(--fg)',
  boxSizing: 'border-box', fontFamily: 'inherit',
};
