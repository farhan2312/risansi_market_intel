'use client';

import { useState, useEffect, useRef, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { updateOpportunity, deleteOpportunity } from '@/app/actions/risansi';

interface Rep { id: string; name: string; zone?: string | null; }

export interface EditableOpp {
  id: string;
  client_id?: string;
  client_name: string;
  client_code: string;
  rep_name?: string | null;
  product: string;
  product_type?: string | null;
  stage: string;
  value_cr: number;
  probability?: number | null;
  eta_text?: string | null;
  quote_ref?: string | null;
  quote_date?: string | null;
  negotiation_notes?: string | null;
  notes?: string | null;
  rep_id?: number | null;
  secondary_rep_id?: number | null;
  auto_created?: boolean | null;
  auto_source?: string | null;
  po_number?: string | null;
  final_value_cr?: number | string | null;
  lost_to_competitor?: string | null;
  lost_reason?: string | null;
}

const STAGE_COLORS: Record<string, string> = {
  Suspect:     '#6B7FA3',
  Prospect:    '#1A5CB8',
  Quoted:      '#D97706',
  Negotiating: '#F97316',
  Won:         '#0E9F6E',
  Lost:        '#E02424',
};

export function EditOppDrawer({ opp, onClose, canEdit = true }: { opp: EditableOpp; onClose: () => void; canEdit?: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [stage, setStage]     = useState(opp.stage);
  const [reps, setReps]       = useState<Rep[]>([]);
  const [primaryRepId, setPrimaryRepId]     = useState<string>(opp.rep_id != null ? String(opp.rep_id) : '');
  const [secondaryRepId, setSecondaryRepId] = useState<string>(opp.secondary_rep_id != null ? String(opp.secondary_rep_id) : '');
  const repsLoaded = useRef(false);

  useEffect(() => {
    if (repsLoaded.current) return;
    repsLoaded.current = true;
    fetch('/api/risansi/reps')
      .then(r => r.json())
      .then(d => setReps(Array.isArray(d) ? d : []))
      .catch(() => setReps([]));
    // Don't touch primaryRepId/secondaryRepId — they're already seeded from opp.
  }, []);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const fd = new FormData(e.currentTarget);
      // Controlled rep selects — sync from state to be safe
      fd.set('rep_id', primaryRepId);
      fd.set('secondary_rep_id', secondaryRepId);
      await updateOpportunity(Number(opp.id), fd);
      router.refresh();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update opportunity');
      setLoading(false);
    }
  };

  const lakhsFrom = (cr: number | string | null | undefined) =>
    cr != null && cr !== '' ? (parseFloat(String(cr)) * 100).toFixed(1) : '';

  const isLocked = opp.stage === 'Won' || opp.stage === 'Lost';
  // View-only when locked (Won/Lost) OR the viewer lacks edit rights.
  const readOnly = isLocked || !canEdit;

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(10,22,40,0.35)', zIndex: 300 }} />
      <div style={{
        position: 'fixed', top: 0, right: 0, width: 480, height: '100vh',
        background: 'white', zIndex: 301, display: 'flex', flexDirection: 'column',
        boxShadow: '-4px 0 24px rgba(10,61,143,0.15)',
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid var(--line)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--fg)' }}>
              {readOnly ? 'Opportunity' : 'Edit Opportunity'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {opp.client_name}
              <span style={{ color: 'var(--line-strong)' }}>·</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{opp.client_code}</span>
              {opp.client_id && (
                <a
                  href={`/risansi/clients/${opp.client_id}`}
                  target="_blank" rel="noopener noreferrer"
                  style={{
                    fontSize: 11, color: '#1A5CB8', textDecoration: 'none',
                    padding: '2px 7px', border: '1px solid rgba(26,92,184,0.3)',
                    borderRadius: 4, background: '#EBF1FB',
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                  }}
                >
                  View Client ↗
                </a>
              )}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--fg-3)', lineHeight: 1 }}>×</button>
        </div>

        {/* Auto-created notice */}
        {opp.auto_created && (
          <div style={{ padding: '8px 20px', background: '#EBF1FB', borderBottom: '1px solid rgba(26,92,184,0.15)', fontSize: 12, color: '#1A5CB8' }}>
            ⚡ Auto-created from visit
            {opp.auto_source === 'expansion_plan' ? ' (expansion plan)'
              : opp.auto_source === 'displacement' ? ' (competitor displacement)' : ''}
          </div>
        )}

        {/* Lock notice */}
        {isLocked && (
          <div style={{
            padding: '10px 16px',
            background: opp.stage === 'Won' ? '#D1FAE5' : '#FDE8E8',
            borderBottom: '1px solid var(--line)', fontSize: 12,
            color: opp.stage === 'Won' ? '#065F46' : '#9B1C1C',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            🔒 This opportunity is {opp.stage} and locked. No further changes can be made.
          </div>
        )}

        {/* View-only notice — editable stage, but not the viewer's to edit */}
        {!canEdit && !isLocked && (
          <div style={{
            padding: '10px 16px', background: 'var(--warn-soft, #FEF3C7)',
            borderBottom: '1px solid var(--line)', fontSize: 12,
            color: 'var(--warn, #92400E)', fontWeight: 500,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            👁 View only — assigned to <strong>{opp.rep_name ?? 'another rep'}</strong>. Only they or their tour manager can edit.
          </div>
        )}

        {/* Read-only view for locked or view-only opps */}
        {readOnly ? (
          <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <ReadOnlyRow label="Stage" value={opp.stage} />
            <ReadOnlyRow label="Product" value={opp.product} />
            <ReadOnlyRow label="Product Type" value={opp.product_type ?? '—'} />
            <ReadOnlyRow label="Value (₹ Lakhs)" value={lakhsFrom(opp.value_cr) || '—'} />
            {opp.stage === 'Won' && (
              <>
                <ReadOnlyRow label="Final Value (₹ Lakhs)" value={lakhsFrom(opp.final_value_cr) || '—'} />
                <ReadOnlyRow label="PO Number" value={opp.po_number ?? '—'} />
              </>
            )}
            {opp.stage === 'Lost' && (
              <>
                <ReadOnlyRow label="Lost To" value={opp.lost_to_competitor ?? '—'} />
                <ReadOnlyRow label="Lost Reason" value={opp.lost_reason ?? '—'} />
              </>
            )}
            <ReadOnlyRow label="Probability %" value={opp.probability != null ? String(opp.probability) : '—'} />
            <ReadOnlyRow label="Expected Close" value={opp.eta_text ?? '—'} />
            <ReadOnlyRow label="Quote Ref" value={opp.quote_ref ?? '—'} />
            <ReadOnlyRow label="Rep" value={opp.rep_name ?? '—'} />
            <ReadOnlyRow label="Notes" value={opp.notes ?? '—'} />
          </div>
        ) : (
        /* Editable form */
        <form onSubmit={handleSubmit} style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* Stage */}
            <div>
              <label style={LABEL_STYLE}>Stage *</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {['Suspect', 'Prospect', 'Quoted', 'Negotiating', 'Won', 'Lost'].map(s => (
                  <button
                    key={s} type="button" onClick={() => setStage(s)}
                    style={{
                      padding: '6px 12px', borderRadius: 20,
                      border: `1px solid ${stage === s ? STAGE_COLORS[s] : 'var(--line-strong)'}`,
                      background: stage === s ? STAGE_COLORS[s] : 'white',
                      color: stage === s ? 'white' : 'var(--fg-3)',
                      fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  >{s}</button>
                ))}
              </div>
              <input type="hidden" name="stage" value={stage} />
              {(stage === 'Won' || stage === 'Lost') && (
                <div style={{
                  marginTop: 8, padding: '8px 12px', borderRadius: 6, fontSize: 12,
                  background: stage === 'Won' ? '#D1FAE5' : '#FDE8E8',
                  color: stage === 'Won' ? '#065F46' : '#9B1C1C',
                }}>
                  {stage === 'Won' ? '🎉 Mark as Won — add final value below' : '❌ Mark as Lost — add reason below'}
                </div>
              )}
            </div>

            {/* Product */}
            <div>
              <label style={LABEL_STYLE}>Product / Description *</label>
              <input name="product" required defaultValue={opp.product ?? ''} style={INPUT_STYLE} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={LABEL_STYLE}>Product Type</label>
                <select name="product_type" defaultValue={opp.product_type ?? 'PCP'} style={INPUT_STYLE}>
                  {['PCP', 'MMP', 'Spares', 'Service', 'Other'].map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label style={LABEL_STYLE}>Probability %</label>
                <input name="probability" type="number" min="0" max="100" defaultValue={opp.probability ?? ''} style={INPUT_STYLE} />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={LABEL_STYLE}>Value (₹ Lakhs)</label>
                <input name="value_lakh" type="number" step="0.1" min="0" defaultValue={lakhsFrom(opp.value_cr)} style={INPUT_STYLE} />
                <div style={{ fontSize: 10, color: 'var(--fg-3)', marginTop: 3 }}>Enter in Lakhs</div>
              </div>
              <div>
                <label style={LABEL_STYLE}>Expected Close</label>
                <input name="eta_text" defaultValue={opp.eta_text ?? ''} placeholder="Jun 2026 or Q3 FY27" style={INPUT_STYLE} />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={LABEL_STYLE}>Quote Ref</label>
                <input name="quote_ref" defaultValue={opp.quote_ref ?? ''} style={INPUT_STYLE} />
              </div>
              <div>
                <label style={LABEL_STYLE}>Quote Date</label>
                <input name="quote_date" type="date" defaultValue={opp.quote_date ?? ''} style={INPUT_STYLE} />
              </div>
            </div>

            {/* Won fields */}
            {stage === 'Won' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={LABEL_STYLE}>Final Value (₹ Lakhs)</label>
                  <input name="final_value_lakh" type="number" step="0.1" defaultValue={lakhsFrom(opp.final_value_cr)} style={INPUT_STYLE} />
                </div>
                <div>
                  <label style={LABEL_STYLE}>PO Number</label>
                  <input name="po_number" defaultValue={opp.po_number ?? ''} style={INPUT_STYLE} />
                </div>
              </div>
            )}

            {/* Lost fields */}
            {stage === 'Lost' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={LABEL_STYLE}>Lost To (competitor)</label>
                  <input name="lost_to_competitor" defaultValue={opp.lost_to_competitor ?? ''} placeholder="e.g. Roto, Netzsch" style={INPUT_STYLE} />
                </div>
                <div>
                  <label style={LABEL_STYLE}>Lost Reason</label>
                  <input name="lost_reason" defaultValue={opp.lost_reason ?? ''} placeholder="Price / Technical / OEM tied" style={INPUT_STYLE} />
                </div>
              </div>
            )}

            {/* Reps — controlled so the value survives the async reps fetch */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={LABEL_STYLE}>Primary Rep *</label>
                {reps.length === 0 ? (
                  <div style={{ ...INPUT_STYLE, color: 'var(--fg-3)', fontStyle: 'italic' }}>Loading reps…</div>
                ) : (
                  <select name="rep_id" required value={primaryRepId} onChange={e => setPrimaryRepId(e.target.value)} style={INPUT_STYLE}>
                    <option value="">— Select Primary Rep —</option>
                    {reps.map(r => <option key={r.id} value={String(r.id)}>{r.name}{r.zone ? ` · ${r.zone}` : ''}</option>)}
                  </select>
                )}
              </div>
              <div>
                <label style={LABEL_STYLE}>Secondary Rep</label>
                {reps.length === 0 ? (
                  <div style={{ ...INPUT_STYLE, color: 'var(--fg-3)', fontStyle: 'italic' }}>Loading reps…</div>
                ) : (
                  <select name="secondary_rep_id" value={secondaryRepId} onChange={e => setSecondaryRepId(e.target.value)} style={INPUT_STYLE}>
                    <option value="">— None —</option>
                    {reps.map(r => <option key={r.id} value={String(r.id)}>{r.name}{r.zone ? ` · ${r.zone}` : ''}</option>)}
                  </select>
                )}
              </div>
            </div>

            <div>
              <label style={LABEL_STYLE}>Negotiation Notes</label>
              <textarea name="negotiation_notes" rows={3} defaultValue={opp.negotiation_notes ?? ''} style={{ ...INPUT_STYLE, resize: 'vertical' }} />
            </div>

            <div>
              <label style={LABEL_STYLE}>Notes</label>
              <textarea name="notes" rows={3} defaultValue={opp.notes ?? ''} style={{ ...INPUT_STYLE, resize: 'vertical' }} />
            </div>

            {error && (
              <div style={{ padding: '8px 12px', background: '#FDE8E8', border: '1px solid #F87171', borderLeft: '3px solid #E02424', borderRadius: 5, color: '#9B1C1C', fontSize: 12 }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', paddingTop: 4 }}>
              <DeleteOppButton oppId={Number(opp.id)} onDeleted={() => { onClose(); router.refresh(); }} />
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={onClose} style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid var(--line-strong)', background: 'white', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}>
                  Cancel
                </button>
                <button type="submit" disabled={loading} style={{ padding: '8px 20px', borderRadius: 6, background: '#0A3D8F', color: 'white', border: 'none', cursor: loading ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 500, fontFamily: 'inherit', opacity: loading ? 0.7 : 1 }}>
                  {loading ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </form>
        )}
      </div>
    </>
  );
}

function ReadOnlyRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <label style={LABEL_STYLE}>{label}</label>
      <div style={{
        padding: '8px 10px', background: 'var(--bg-elev)',
        border: '1px solid var(--line)', borderRadius: 6,
        fontSize: 13, color: 'var(--fg)', whiteSpace: 'pre-wrap',
      }}>
        {value || '—'}
      </div>
    </div>
  );
}

function DeleteOppButton({ oppId, onDeleted }: { oppId: number; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading]       = useState(false);

  if (confirming) {
    return (
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: 'var(--neg)' }}>Delete permanently?</span>
        <button
          type="button" disabled={loading}
          onClick={async () => { setLoading(true); await deleteOpportunity(oppId); onDeleted(); }}
          style={{ padding: '5px 10px', borderRadius: 5, background: '#E02424', color: 'white', border: 'none', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}
        >
          {loading ? '…' : 'Yes, Delete'}
        </button>
        <button type="button" onClick={() => setConfirming(false)} style={{ padding: '5px 10px', borderRadius: 5, border: '1px solid var(--line-strong)', background: 'white', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}>
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button type="button" onClick={() => setConfirming(true)} style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid #F87171', background: 'white', color: '#E02424', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}>
      Delete
    </button>
  );
}

const LABEL_STYLE: CSSProperties = {
  fontSize: 11, fontWeight: 600, color: 'var(--fg-3)',
  textTransform: 'uppercase', letterSpacing: '0.06em',
  display: 'block', marginBottom: 5,
};

const INPUT_STYLE: CSSProperties = {
  width: '100%', padding: '8px 10px', border: '1px solid var(--line-strong)',
  borderRadius: 6, fontSize: 13, background: 'var(--bg-elev)', color: 'var(--fg)',
  boxSizing: 'border-box', fontFamily: 'inherit',
};
