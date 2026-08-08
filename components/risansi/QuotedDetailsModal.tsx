'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { saveQuotedDetails } from '@/app/actions/risansi';
import { PROBABILITY_CODES, probabilityCodeLabel } from '@/lib/risansi-probability-codes';
import { PRODUCT_TYPES } from '@/lib/risansi-opportunity-fields';
import { OfferRevisionsField } from './OfferRevisionsField';
import { fmtUsdFromInr, type OfferRevision } from '@/lib/risansi-offer-revisions';

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

const QUOTED = '#c69347';

type ItemRow = { pump_model: string; pump_qty: string; pump_speed: string; geared_motor_detail: string; motor_price: string; gearbox_vbelt_price: string; offer_value_inr: string; offer_value_usd: string; detailed_specifications: string };
const blankItem = (): ItemRow => ({ pump_model: '', pump_qty: '', pump_speed: '', geared_motor_detail: '', motor_price: '', gearbox_vbelt_price: '', offer_value_inr: '', offer_value_usd: '', detailed_specifications: '' });
const str = (v: unknown) => (v == null ? '' : String(v));
const mapItem = (it: Partial<QuotedItem>): ItemRow => ({
  pump_model: str(it.pump_model), pump_qty: str(it.pump_qty), pump_speed: str(it.pump_speed),
  geared_motor_detail: str(it.geared_motor_detail), motor_price: str(it.motor_price),
  gearbox_vbelt_price: str(it.gearbox_vbelt_price), offer_value_inr: str(it.offer_value_inr),
  offer_value_usd: str(it.offer_value_usd), detailed_specifications: str(it.detailed_specifications),
});

interface ParsedQuoteResponse {
  ok?: boolean; error?: string; link?: string; fileName?: string;
  meta?: Record<string, string | number | null>;
  items?: Partial<QuotedItem>[];
}

export function QuotedDetailsModal({ opp, usdRate = 86, onSave, onCancel }: { opp: QuotedOpp; usdRate?: number; onSave: () => void; onCancel: () => void }) {
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

  const formRef = useRef<HTMLFormElement>(null);

  // Mirrored in state purely so the USD sub-text tracks what's typed. The input
  // stays uncontrolled (defaultValue) because the PDF auto-fill writes to the
  // DOM node directly — hence syncOfferFromDom after a fill.
  const [offerInr, setOfferInr] = useState(offerInrDefault);
  const syncOfferFromDom = () => {
    const el = formRef.current?.elements.namedItem('offer_value_inr') as HTMLInputElement | null;
    if (el) setOfferInr(el.value);
  };

  // Existing revised offers. The board only carries the card's summary fields,
  // so the history comes from the same endpoint the drawer reads.
  //
  // The editor is held back until the fetch resolves, and a FAILED fetch keeps
  // it hidden rather than showing an empty list: an empty editor submits an
  // empty offer_revisions_json, which the server reads as "the user deleted
  // them all" and would wipe a history the request simply never saw.
  const [revisions, setRevisions] = useState<OfferRevision[] | 'loading' | 'failed'>('loading');
  useEffect(() => {
    let active = true;
    fetch(`/api/risansi/opportunities/${opp.id}/items`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(d => { if (active) setRevisions(Array.isArray(d.revisions) ? d.revisions : []); })
      .catch(() => { if (active) setRevisions('failed'); });
    return () => { active = false; };
  }, [opp.id]);

  // ── Upload PDF + auto-fill (blanks only) ─────────────────────
  const [link, setLink]           = useState(str(opp.quotation_link));
  const [fileName, setFileName]   = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');
  const [uploadErr, setUploadErr] = useState(false);

  // The default values we rendered. A field still equal to its default (or empty)
  // counts as "not typed by the user", so it is safe to auto-fill; anything the
  // user has changed is left untouched.
  const initial: Record<string, string> = {
    quote_ref: str(opp.quote_ref), quote_date: str(opp.quote_date), enquiry_no: str(opp.enquiry_no),
    enquiry_date: str(opp.enquiry_date), qtr: str(opp.qtr), product_type: opp.product_type ?? 'PCP',
    market: str(opp.market), ril_rep: str(opp.ril_rep),
    offer_value_inr: offerInrDefault,
  };
  const fillEmpty = (name: string, val: unknown): boolean => {
    if (val == null || val === '') return false;
    const el = formRef.current?.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null;
    if (!el) return false;
    if (el.value === '' || el.value === (initial[name] ?? '')) { el.value = String(val); return true; }
    return false;
  };
  const itemsAllBlank = (rows: ItemRow[]) => rows.every(r =>
    !r.pump_model && !r.pump_qty && !r.pump_speed && !r.geared_motor_detail &&
    !r.motor_price && !r.gearbox_vbelt_price && !r.offer_value_inr && !r.offer_value_usd && !r.detailed_specifications);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = ''; // let the user re-pick the same file
    if (!f) return;
    setUploading(true); setUploadMsg(''); setUploadErr(false);
    try {
      const fd = new FormData(); fd.append('file', f);
      const res  = await fetch(`/api/risansi/opportunities/${opp.id}/quotation`, { method: 'POST', body: fd });
      const data = (await res.json()) as ParsedQuoteResponse;
      if (!res.ok) throw new Error(data?.error || 'Upload failed');
      setLink(data.link || ''); setFileName(data.fileName || f.name);

      const meta = data.meta || {};
      // 'qtr' dropped with the Quarter field and 'offer_value_usd' with the USD
      // input — there is no longer an element to fill for either.
      const keys = ['quote_ref', 'quote_date', 'enquiry_no', 'enquiry_date', 'product_type', 'market', 'offer_value_inr'];
      let filled = 0;
      for (const k of keys) if (fillEmpty(k, meta[k])) filled++;
      syncOfferFromDom();   // fillEmpty writes the DOM directly; onChange never fires

      const pItems = Array.isArray(data.items) ? data.items : [];
      let filledItems = 0;
      setItems(cur => {
        if (pItems.length && itemsAllBlank(cur)) { filledItems = pItems.length; return pItems.map(mapItem); }
        return cur;
      });
      setUploadMsg(`Saved “${data.fileName || f.name}”. Auto-filled ${filled} blank field${filled === 1 ? '' : 's'}${filledItems ? ` + ${filledItems} item${filledItems === 1 ? '' : 's'}` : ''} — review before saving.`);
    } catch (err) {
      setUploadErr(true);
      setUploadMsg(err instanceof Error ? err.message : 'Upload failed');
    } finally { setUploading(false); }
  };

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

        <form onSubmit={submit} ref={formRef}>
          <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Quote-level attributes, ordered: the project it's for, then the
                quote identity, then commercials, then the PDF. Project Name /
                Unit leads as a full-width box, matching the create form. */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <Field label="Project Name / Unit"><input name="unit_project" defaultValue={opp.unit_project ?? ''} placeholder="e.g. Balrampur Chini — Unit 2, Spent Wash" style={INP} /></Field>
              </div>
              <Field label="Quote No."><input name="quote_ref" defaultValue={opp.quote_ref ?? ''} placeholder="RIL/QT/…" style={INP} /></Field>
              <Field label="Quote Date"><input name="quote_date" type="date" defaultValue={opp.quote_date ?? ''} style={INP} /></Field>
              <Field label="Enquiry No."><input name="enquiry_no" defaultValue={opp.enquiry_no ?? ''} placeholder="RIL/EN/…" style={INP} /></Field>
              <Field label="Enquiry Date"><input name="enquiry_date" type="date" defaultValue={opp.enquiry_date ?? ''} style={INP} /></Field>
              <Field label="Market"><select name="market" defaultValue={opp.market ?? ''} style={INP}><option value="">—</option>{['DOMESTIC', 'EXPORT'].map(m => <option key={m} value={m}>{m}</option>)}</select></Field>
              <Field label="Product Category"><select name="product_type" defaultValue={opp.product_type ?? 'PCP'} style={INP}>{PRODUCT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></Field>
              <Field label="Probability Code">
                <select name="probability_code" defaultValue={opp.probability_code ?? ''} style={INP}>
                  <option value="">—</option>
                  {PROBABILITY_CODES.map(c => (
                    <option key={c.code} value={c.code}>{probabilityCodeLabel(c)}</option>
                  ))}
                  {/* Preserve any legacy value that isn't one of the standard codes. */}
                  {opp.probability_code && !PROBABILITY_CODES.some(c => c.code === opp.probability_code) && (
                    <option value={opp.probability_code}>{opp.probability_code}</option>
                  )}
                </select>
              </Field>
              <Field label="Total Offer (₹)">
                <input
                  name="offer_value_inr" type="number" step="0.01" min="0"
                  defaultValue={offerInrDefault} placeholder="auto-sums items if blank"
                  onChange={e => setOfferInr(e.target.value)} style={INP}
                />
                <div style={{ fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', marginTop: 3 }}>
                  {offerInr.trim() ? `≈ ${fmtUsdFromInr(parseFloat(offerInr), usdRate)}` : `at ₹${usdRate}/$`}
                </div>
              </Field>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={LABEL}>Quotation PDF</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <label style={{ ...UPLOAD_BTN, opacity: uploading ? 0.6 : 1, cursor: uploading ? 'wait' : 'pointer' }}>
                    {uploading ? 'Reading…' : (link ? '⤒ Replace PDF' : '⤒ Upload PDF')}
                    <input type="file" accept="application/pdf,.pdf" onChange={onFile} disabled={uploading} style={{ display: 'none' }} />
                  </label>
                  {link && <a href={link} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--title)', textDecoration: 'underline' }}>View{fileName ? ` · ${fileName}` : ''}</a>}
                  {uploadMsg && <span style={{ fontSize: 11, color: uploadErr ? 'var(--neg-strong)' : 'var(--fg-3)' }}>{uploadMsg}</span>}
                </div>
                <input type="hidden" name="quotation_link" value={link} />
                <div style={{ fontSize: 10, color: 'var(--fg-3)', marginTop: 5 }}>Upload the quote PDF to store it and auto-fill any blank fields below. It never overwrites what you&apos;ve already typed.</div>
              </div>
            </div>

            {/* Revised offers — a timestamped history, not a single field. */}
            {revisions === 'loading' ? (
              <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>Loading revised offers…</div>
            ) : revisions === 'failed' ? (
              <div style={{
                fontSize: 11, color: 'var(--warn-strong, #92400E)', padding: '8px 11px',
                background: 'var(--warn-soft, #FEF3C7)', border: '1px solid var(--warn, #F59E0B)', borderRadius: 6,
              }}>
                Couldn&apos;t load the revised-offer history, so it isn&apos;t editable here. Saving will
                leave it exactly as it is — reopen the card to try again.
              </div>
            ) : (
              <OfferRevisionsField
                initial={revisions}
                baseOfferInr={offerInr.trim() ? parseFloat(offerInr) : null}
                usdRate={usdRate}
              />
            )}

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
                      <ItemField label="Item Offer ($)"><input value={it.offer_value_usd} onChange={e => setItem(idx, 'offer_value_usd', e.target.value)} style={INP} /></ItemField>
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
const UPLOAD_BTN: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', fontSize: 12.5, fontWeight: 600, background: 'var(--accent-soft)', color: 'var(--title)', border: '1px dashed var(--accent-line)', borderRadius: 6, fontFamily: 'inherit' };
const DEL_BTN: CSSProperties = { padding: '3px 9px', fontSize: 11, background: 'none', border: '1px solid var(--line-strong)', color: 'var(--neg)', borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit' };
