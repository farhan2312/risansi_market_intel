'use client';

import { useState, type CSSProperties } from 'react';
import { saveQuotedDetails } from '@/app/actions/risansi';

// Shown when a card is dragged into the Quoted column — captures the quotation
// details (mirrors OppCompletionModal for Won/Lost). Cancel reverts the move.
export interface QuotedOpp {
  id: string;
  client_name: string;
  product: string;
  product_type?: string | null;
  value_cr?: number | null;
  quote_ref?: string | null;
  quote_date?: string | null;
  enquiry_no?: string | null;
  quotation_link?: string | null;
  offer_value_inr?: number | null;
  offer_value_usd?: number | null;
  pump_model?: string | null;
  pump_qty?: number | null;
  notes?: string | null;
}

const PRODUCT_TYPES = ['PCP', 'MMP', 'SPARE', 'OBL'];
const QUOTED = '#c69347';

export function QuotedDetailsModal({ opp, onSave, onCancel }: {
  opp: QuotedOpp; onSave: () => void; onCancel: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const offerInrDefault = opp.offer_value_inr != null ? String(opp.offer_value_inr)
    : (opp.value_cr != null ? String(Math.round(opp.value_cr * 10_000_000)) : '');

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      await saveQuotedDetails(Number(opp.id), new FormData(e.currentTarget));
      onSave();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
      setLoading(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div className="risansi-modal" style={{
        width: 560, maxHeight: '90vh', overflowY: 'auto', background: 'var(--bg-paper)', color: 'var(--fg)',
        borderRadius: 12, boxShadow: '0 24px 64px rgba(0,0,0,0.35)',
      }}>
        <div style={{ padding: '18px 22px', background: QUOTED, color: '#fff' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700 }}>Quotation details</div>
              <div style={{ fontSize: 12, opacity: 0.9, marginTop: 3 }}>{opp.client_name} · {opp.product}</div>
            </div>
            <button type="button" onClick={onCancel} aria-label="Cancel" style={{ background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer', width: 28, height: 28, fontSize: 16, lineHeight: 1 }}>×</button>
          </div>
          <div style={{ marginTop: 8, fontSize: 11, opacity: 0.8, fontStyle: 'italic' }}>Press × to cancel and move the card back</div>
        </div>

        <form onSubmit={submit}>
          <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Quote No."><input name="quote_ref" defaultValue={opp.quote_ref ?? ''} placeholder="RIL/QT/…" style={INP} /></Field>
              <Field label="Quote Date"><input name="quote_date" type="date" defaultValue={opp.quote_date ?? ''} style={INP} /></Field>
              <Field label="Enquiry No."><input name="enquiry_no" defaultValue={opp.enquiry_no ?? ''} placeholder="RIL/EN/…" style={INP} /></Field>
              <Field label="Product Category">
                <select name="product_type" defaultValue={opp.product_type ?? 'PCP'} style={INP}>
                  {PRODUCT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Offer Value (₹)"><input name="offer_value_inr" type="number" step="0.01" min="0" inputMode="decimal" defaultValue={offerInrDefault} placeholder="e.g. 250000" style={INP} /></Field>
              <Field label="Offer Value (USD)"><input name="offer_value_usd" type="number" step="0.01" min="0" defaultValue={opp.offer_value_usd != null ? String(opp.offer_value_usd) : ''} placeholder="optional" style={INP} /></Field>
              <Field label="Pump Qty"><input name="pump_qty" type="number" step="1" min="0" defaultValue={opp.pump_qty != null ? String(opp.pump_qty) : ''} style={INP} /></Field>
              <Field label="Quotation Link"><input name="quotation_link" type="url" defaultValue={opp.quotation_link ?? ''} placeholder="https://…" style={INP} /></Field>
            </div>
            <Field label="Pump Model"><input name="pump_model" defaultValue={opp.pump_model ?? ''} placeholder="e.g. RTOH2140ABBN" style={INP} /></Field>
            <Field label="Specifications / Notes"><textarea name="notes" rows={3} defaultValue={opp.notes ?? ''} placeholder="Liquid, capacity, head, etc." style={{ ...INP, resize: 'vertical' }} /></Field>
            {error && <div style={{ padding: '8px 12px', background: 'var(--neg-soft)', border: '1px solid var(--neg)', borderRadius: 6, color: 'var(--neg-strong)', fontSize: 12 }}>{error}</div>}
          </div>

          <div style={{ padding: '12px 22px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--line)' }}>
            <button type="button" onClick={onCancel} style={{ padding: '8px 14px', borderRadius: 6, border: '1px solid var(--line-strong)', background: 'var(--bg-paper)', cursor: 'pointer', fontSize: 13, color: 'var(--fg-3)', fontFamily: 'inherit' }}>← Go back (revert move)</button>
            <button type="submit" disabled={loading} style={{ padding: '8px 20px', borderRadius: 6, background: QUOTED, color: '#fff', border: 'none', cursor: loading ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', opacity: loading ? 0.7 : 1 }}>{loading ? 'Saving…' : 'Save · move to Quoted'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label style={LABEL}>{label}</label>{children}</div>;
}
const LABEL: CSSProperties = { fontSize: 11, fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 4 };
const INP: CSSProperties = { width: '100%', padding: '8px 10px', border: '1px solid var(--line-strong)', borderRadius: 6, fontSize: 13, background: 'var(--bg-sunk)', color: 'var(--fg)', boxSizing: 'border-box', fontFamily: 'inherit' };
