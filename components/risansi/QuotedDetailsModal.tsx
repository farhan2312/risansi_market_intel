'use client';

import { useState, type CSSProperties } from 'react';
import { saveQuotedDetails } from '@/app/actions/risansi';

// Shown when a card is dragged into the Quoted column — captures the full
// quotation (all attributes + a dynamic list of quoted items). Cancel reverts.
export interface QuotedItem {
  pump_model?: string | null; pump_qty?: number | null; pump_speed?: string | null;
  geared_motor_detail?: string | null; motor_price?: number | null; gearbox_vbelt_price?: number | null;
  offer_value_inr?: number | null; offer_value_usd?: number | null; detailed_specifications?: string | null;
}
export interface QuotedOpp {
  id: string; client_name: string; product: string;
  product_type?: string | null; value_cr?: number | null;
  quote_ref?: string | null; quote_date?: string | null; enquiry_no?: string | null; enquiry_date?: string | null;
  revised_offer_date?: string | null; quotation_link?: string | null;
  offer_value_inr?: number | null; offer_value_usd?: number | null;
  revised_offer_value_inr?: number | null; revised_offer_value_usd?: number | null;
  market?: string | null; ril_rep?: string | null; qtn_prepared_by?: string | null; client_status_at_quote?: string | null;
  unit_project?: string | null; location?: string | null; qtr?: string | null; probability_code?: string | null;
  pump_model?: string | null; pump_qty?: number | null; notes?: string | null;
  items?: QuotedItem[];
}

const PRODUCT_TYPES = ['PCP', 'MMP', 'SPARE', 'OBL'];
const QUOTED = '#c69347';

type ItemRow = { pump_model: string; pump_qty: string; pump_speed: string; geared_motor_detail: string; motor_price: string; gearbox_vbelt_price: string; offer_value_inr: string; offer_value_usd: string; detailed_specifications: string };
const blankItem = (): ItemRow => ({ pump_model: '', pump_qty: '', pump_speed: '', geared_motor_detail: '', motor_price: '', gearbox_vbelt_price: '', offer_value_inr: '', offer_value_usd: '', detailed_specifications: '' });
const str = (v: unknown) => (v == null ? '' : String(v));

export function QuotedDetailsModal({ opp, onSave, onCancel }: { opp: QuotedOpp; onSave: () => void; onCancel: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [items, setItems]     = useState<ItemRow[]>(() => {
    if (opp.items?.length) return opp.items.map(it => ({ pump_model: str(it.pump_model), pump_qty: str(it.pump_qty), pump_speed: str(it.pump_speed), geared_motor_detail: str(it.geared_motor_detail), motor_price: str(it.motor_price), gearbox_vbelt_price: str(it.gearbox_vbelt_price), offer_value_inr: str(it.offer_value_inr), offer_value_usd: str(it.offer_value_usd), detailed_specifications: str(it.detailed_specifications) }));
    return [{ ...blankItem(), pump_model: str(opp.pump_model), pump_qty: str(opp.pump_qty), offer_value_inr: str(opp.offer_value_inr) }];
  });

  const setItem = (idx: number, key: keyof ItemRow, val: string) => setItems(rows => rows.map((r, i) => i === idx ? { ...r, [key]: val } : r));
  const addItem = () => setItems(r => [...r, blankItem()]);
  const removeItem = (idx: number) => setItems(r => r.length > 1 ? r.filter((_, i) => i !== idx) : r);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true); setError('');
    const fd = new FormData(e.currentTarget);
    fd.set('items_json', JSON.stringify(items));
    try { await saveQuotedDetails(Number(opp.id), fd); onSave(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to save'); setLoading(false); }
  };

  const offerInrDefault = opp.offer_value_inr != null ? String(opp.offer_value_inr) : (opp.value_cr != null ? String(Math.round(opp.value_cr * 10_000_000)) : '');

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div className="risansi-modal" style={{ width: 720, maxHeight: '92vh', overflowY: 'auto', background: 'var(--bg-paper)', color: 'var(--fg)', borderRadius: 12, boxShadow: '0 24px 64px rgba(0,0,0,0.35)' }}>
        <div style={{ padding: '18px 22px', background: QUOTED, color: '#fff', position: 'sticky', top: 0, zIndex: 1 }}>
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
          <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Quote-level attributes */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              <Field label="Quote No."><input name="quote_ref" defaultValue={opp.quote_ref ?? ''} placeholder="RIL/QT/…" style={INP} /></Field>
              <Field label="Quote Date"><input name="quote_date" type="date" defaultValue={opp.quote_date ?? ''} style={INP} /></Field>
              <Field label="Revised Offer Date"><input name="revised_offer_date" type="date" defaultValue={opp.revised_offer_date ?? ''} style={INP} /></Field>
              <Field label="Enquiry No."><input name="enquiry_no" defaultValue={opp.enquiry_no ?? ''} placeholder="RIL/EN/…" style={INP} /></Field>
              <Field label="Enquiry Date"><input name="enquiry_date" type="date" defaultValue={opp.enquiry_date ?? ''} style={INP} /></Field>
              <Field label="Quarter"><select name="qtr" defaultValue={opp.qtr ?? ''} style={INP}><option value="">—</option>{['Q1', 'Q2', 'Q3', 'Q4'].map(q => <option key={q} value={q}>{q}</option>)}</select></Field>
              <Field label="Product Category"><select name="product_type" defaultValue={opp.product_type ?? 'PCP'} style={INP}>{PRODUCT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></Field>
              <Field label="Market"><select name="market" defaultValue={opp.market ?? ''} style={INP}><option value="">—</option>{['DOMESTIC', 'EXPORT'].map(m => <option key={m} value={m}>{m}</option>)}</select></Field>
              <Field label="Client Status"><select name="client_status_at_quote" defaultValue={opp.client_status_at_quote ?? ''} style={INP}><option value="">—</option>{['NEW', 'EXISTING'].map(m => <option key={m} value={m}>{m}</option>)}</select></Field>
              <Field label="RIL Rep"><input name="ril_rep" defaultValue={opp.ril_rep ?? ''} placeholder="e.g. NI" style={INP} /></Field>
              <Field label="Qtn. Prepared By"><input name="qtn_prepared_by" defaultValue={opp.qtn_prepared_by ?? ''} style={INP} /></Field>
              <Field label="Probability Code"><input name="probability_code" defaultValue={opp.probability_code ?? ''} style={INP} /></Field>
              <Field label="Unit / Project"><input name="unit_project" defaultValue={opp.unit_project ?? ''} style={INP} /></Field>
              <Field label="Location"><input name="location" defaultValue={opp.location ?? ''} style={INP} /></Field>
              <Field label="Quotation Link"><input name="quotation_link" type="url" defaultValue={opp.quotation_link ?? ''} placeholder="https://…" style={INP} /></Field>
              <Field label="Total Offer (₹)"><input name="offer_value_inr" type="number" step="0.01" min="0" defaultValue={offerInrDefault} placeholder="auto-sums items if blank" style={INP} /></Field>
              <Field label="Total Offer (USD)"><input name="offer_value_usd" type="number" step="0.01" min="0" defaultValue={opp.offer_value_usd != null ? String(opp.offer_value_usd) : ''} style={INP} /></Field>
              <Field label="Revised Offer (₹)"><input name="revised_offer_value_inr" type="number" step="0.01" min="0" defaultValue={opp.revised_offer_value_inr != null ? String(opp.revised_offer_value_inr) : ''} style={INP} /></Field>
              <Field label="Revised Offer (USD)"><input name="revised_offer_value_usd" type="number" step="0.01" min="0" defaultValue={opp.revised_offer_value_usd != null ? String(opp.revised_offer_value_usd) : ''} style={INP} /></Field>
            </div>

            {/* Dynamic quoted items */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg)' }}>Quoted Items ({items.length})</span>
                <button type="button" onClick={addItem} style={{ ...ADD_BTN, marginLeft: 'auto' }}>+ Add item</button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {items.map((it, idx) => (
                  <div key={idx} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 10, background: 'var(--bg-elev)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-3)' }}>Item {idx + 1}</span>
                      {items.length > 1 && <button type="button" onClick={() => removeItem(idx)} style={{ ...DEL_BTN, marginLeft: 'auto' }}>Remove</button>}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 8 }}>
                      <ItemField label="Pump Model"><input value={it.pump_model} onChange={e => setItem(idx, 'pump_model', e.target.value)} style={INP} /></ItemField>
                      <ItemField label="Qty"><input value={it.pump_qty} onChange={e => setItem(idx, 'pump_qty', e.target.value)} style={INP} /></ItemField>
                      <ItemField label="Speed (RPM)"><input value={it.pump_speed} onChange={e => setItem(idx, 'pump_speed', e.target.value)} style={INP} /></ItemField>
                      <ItemField label="Motor Price (₹)"><input value={it.motor_price} onChange={e => setItem(idx, 'motor_price', e.target.value)} style={INP} /></ItemField>
                      <ItemField label="Gearbox / V-Belt (₹)"><input value={it.gearbox_vbelt_price} onChange={e => setItem(idx, 'gearbox_vbelt_price', e.target.value)} style={INP} /></ItemField>
                      <ItemField label="Item Offer (₹)"><input value={it.offer_value_inr} onChange={e => setItem(idx, 'offer_value_inr', e.target.value)} style={INP} /></ItemField>
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <ItemField label="Geared Motor Detail"><input value={it.geared_motor_detail} onChange={e => setItem(idx, 'geared_motor_detail', e.target.value)} style={INP} /></ItemField>
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <ItemField label="Detailed Specifications"><textarea value={it.detailed_specifications} onChange={e => setItem(idx, 'detailed_specifications', e.target.value)} rows={2} style={{ ...INP, resize: 'vertical' }} /></ItemField>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {error && <div style={{ padding: '8px 12px', background: 'var(--neg-soft)', border: '1px solid var(--neg)', borderRadius: 6, color: 'var(--neg-strong)', fontSize: 12 }}>{error}</div>}
          </div>

          <div style={{ padding: '12px 22px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--line)', position: 'sticky', bottom: 0, background: 'var(--bg-paper)' }}>
            <button type="button" onClick={onCancel} style={{ padding: '8px 14px', borderRadius: 6, border: '1px solid var(--line-strong)', background: 'var(--bg-paper)', cursor: 'pointer', fontSize: 13, color: 'var(--fg-3)', fontFamily: 'inherit' }}>← Go back (revert move)</button>
            <button type="submit" disabled={loading} style={{ padding: '8px 20px', borderRadius: 6, background: QUOTED, color: '#fff', border: 'none', cursor: loading ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', opacity: loading ? 0.7 : 1 }}>{loading ? 'Saving…' : 'Save · move to Quoted'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div><label style={LABEL}>{label}</label>{children}</div>; }
function ItemField({ label, children }: { label: string; children: React.ReactNode }) { return <div><label style={{ ...LABEL, fontSize: 9.5, marginBottom: 3 }}>{label}</label>{children}</div>; }
const LABEL: CSSProperties = { fontSize: 10.5, fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 4 };
const INP: CSSProperties = { width: '100%', padding: '7px 9px', border: '1px solid var(--line-strong)', borderRadius: 6, fontSize: 12.5, background: 'var(--bg-sunk)', color: 'var(--fg)', boxSizing: 'border-box', fontFamily: 'inherit' };
const ADD_BTN: CSSProperties = { padding: '5px 11px', fontSize: 12, fontWeight: 600, background: 'var(--accent-soft)', color: 'var(--title)', border: '1px solid var(--accent-line)', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' };
const DEL_BTN: CSSProperties = { padding: '3px 9px', fontSize: 11, background: 'none', border: '1px solid var(--line-strong)', color: 'var(--neg)', borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit' };
