'use client';

import { useState, useEffect, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { updateOpportunity, deleteOpportunity } from '@/app/actions/risansi';
import { PROBABILITY_CODES, probabilityCodeLabel } from '@/lib/risansi-probability-codes';
import { MonthYearSelect } from './MonthYearSelect';
import { SalesOrderList } from './SalesOrderList';
import { SalesOrderManager } from './SalesOrderManager';
import { PurchaseOrderManager } from './PurchaseOrderManager';
import { QuotationPdfManager } from './QuotationPdfManager';

// A quotation exists from Quoted onward — the PDF can be viewed/replaced/deleted
// at any of these stages (even a locked Won/Lost, if the viewer may edit).
const QUOTED_PLUS = ['Quoted', 'Negotiating', 'On Hold', 'Won', 'Lost', 'Dropped'];

export interface EditableOpp {
  id: string;
  client_id?: string;
  client_name: string;
  client_code: string;
  rep_name?: string | null;
  product: string;
  product_type?: string | null;
  unit_project?: string | null;
  stage: string;
  value_cr: number;
  probability?: number | null;
  probability_code?: string | null;
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
  quotation_link?: string | null;
  tour_name?: string | null;
  tour_people?: string | null;   // all reps + manager on the client's tour
}

interface QItem { id: number; pump_model: string | null; pump_qty: number | null; pump_speed: string | null; geared_motor_detail: string | null; motor_price: number | null; gearbox_vbelt_price: number | null; offer_value_inr: number | null; offer_value_usd: number | null; detailed_specifications: string | null; }
interface QMeta { market?: string | null; ril_rep?: string | null; qtn_prepared_by?: string | null; client_status_at_quote?: string | null; unit_project?: string | null; location?: string | null; qtr?: string | null; probability_code?: string | null; enquiry_no?: string | null; enquiry_date?: string | null; revised_offer_date?: string | null; revised_offer_value_inr?: number | null; quotation_link?: string | null; }

const STAGE_COLORS: Record<string, string> = {
  Suspect:     '#6B7FA3',
  Prospect:    '#1A5CB8',
  Quoted:      '#D97706',
  Negotiating: '#F97316',
  'On Hold':   '#7C3AED',
  Won:         '#0E9F6E',
  Lost:        '#E02424',
  Dropped:     '#64748B',
};

export function EditOppDrawer({ opp, onClose, canEdit = true }: { opp: EditableOpp; onClose: () => void; canEdit?: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [stage, setStage]     = useState(opp.stage);
  const [quoteItems, setQuoteItems] = useState<QItem[]>([]);
  const [quoteMeta, setQuoteMeta]   = useState<QMeta | null>(null);
  // Seeded SYNCHRONOUSLY from the opp row (it carries unit_project via SELECT
  // o.*). Seeding from the async quote-meta fetch instead would let an early
  // save write a blank over the stored value before the fetch resolved.
  const [unitProject, setUnitProject] = useState(opp.unit_project ?? '');
  // Final value is controlled so the Sales-Order coverage preview stays live
  // while the user types it during a Won transition. (value_cr/final_value_cr
  // are Crores; the field takes rupees.)
  const [finalInr, setFinalInr] = useState(() => {
    const cr = opp.final_value_cr != null && opp.final_value_cr !== '' ? opp.final_value_cr : opp.value_cr;
    return cr != null && cr !== '' ? String(Math.round(parseFloat(String(cr)) * 10_000_000)) : '';
  });

  // Load the quoted items + quote-level attributes for the read view.
  useEffect(() => {
    let active = true;
    fetch(`/api/risansi/opportunities/${opp.id}/items`)
      .then(r => (r.ok ? r.json() : { items: [], meta: null }))
      .then(d => { if (active) { setQuoteItems(d.items ?? []); setQuoteMeta(d.meta ?? null); } })
      .catch(() => {});
    return () => { active = false; };
  }, [opp.id]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const fd = new FormData(e.currentTarget);
      // Ownership is derived from the client's tour, not set here — the form
      // sends no rep_id, and updateOpportunity leaves the existing owner intact.
      await updateOpportunity(Number(opp.id), fd);
      router.refresh();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update opportunity');
      setLoading(false);
    }
  };

  // value_cr is stored in Crores; opportunity values are entered/shown as the
  // full rupee amount (1 Cr = ₹10,000,000). inrFrom → raw integer for number
  // inputs; inrLabel → grouped ₹ string for read-only display.
  const inrFrom = (cr: number | string | null | undefined) =>
    cr != null && cr !== '' ? String(Math.round(parseFloat(String(cr)) * 10_000_000)) : '';
  const inrLabel = (cr: number | string | null | undefined) =>
    cr != null && cr !== '' ? '₹' + Math.round(parseFloat(String(cr)) * 10_000_000).toLocaleString('en-IN') : '';

  const isLocked = opp.stage === 'Won' || opp.stage === 'Lost';
  // View-only when locked (Won/Lost) OR the viewer lacks edit rights.
  const readOnly = isLocked || !canEdit;

  return (
    <>
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(10,22,40,0.35)',
        backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)', zIndex: 300,
      }} />
      <div className="risansi-modal" style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        width: 520, maxWidth: 'calc(100vw - 32px)', maxHeight: '90vh',
        background: 'var(--bg-paper)', borderRadius: 12,
        zIndex: 301, display: 'flex', flexDirection: 'column',
        boxShadow: '0 20px 60px rgba(10,61,143,0.2)', overflow: 'hidden',
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
                  style={{
                    fontSize: 11, color: '#1A5CB8', textDecoration: 'none',
                    padding: '2px 7px', border: '1px solid rgba(26,92,184,0.3)',
                    borderRadius: 4, background: '#EBF1FB',
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                  }}
                >
                  View Client →
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
            🔒 This opportunity is {opp.stage} and locked.{opp.stage === 'Won' ? ' The deal is frozen, but you can still record Sales Orders below until they cover the final value.' : ' No further changes can be made.'}
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
            👁 View only — this opportunity is on the <strong>{opp.tour_name ?? 'client’s'}</strong> tour. Only reps on that tour (or an admin) can edit it.
          </div>
        )}

        {/* Read-only view for locked or view-only opps */}
        {readOnly ? (
          <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <ReadOnlyRow label="Stage" value={opp.stage} />
            <ReadOnlyRow label="Product" value={opp.product} />
            <ReadOnlyRow label="Product Type" value={opp.product_type ?? '—'} />
            <ReadOnlyRow label="Value" value={inrLabel(opp.value_cr) || '—'} />
            {opp.stage === 'Won' && (
              <>
                {opp.po_number && <ReadOnlyRow label="PO Number" value={opp.po_number} />}
                {/* Final value is editable inside the Sales Orders panel below. */}
                <SalesOrderManager
                  oppId={Number(opp.id)}
                  finalValueCr={opp.final_value_cr != null ? Number(opp.final_value_cr) : null}
                  canEdit={canEdit}
                />
                {/* Customer POs — a free-standing list (No / Date / Value). */}
                <PurchaseOrderManager oppId={Number(opp.id)} canEdit={canEdit} />
              </>
            )}
            {opp.stage === 'Lost' && (
              <>
                <ReadOnlyRow label="Lost To" value={opp.lost_to_competitor ?? '—'} />
                <ReadOnlyRow label="Lost Reason" value={opp.lost_reason ?? '—'} />
              </>
            )}
            <ReadOnlyRow label="Probability" value={(() => {
              const c = PROBABILITY_CODES.find(x => x.code === opp.probability_code);
              return c ? probabilityCodeLabel(c) : (opp.probability_code ?? '—');
            })()} />
            <ReadOnlyRow label="Expected Close" value={opp.eta_text ?? '—'} />
            <ReadOnlyRow label="Quote Ref" value={opp.quote_ref ?? '—'} />
            <ReadOnlyRow label="Tour" value={opp.tour_name ?? '—'} />
            <ReadOnlyRow label="Reps / Manager" value={opp.tour_people ?? opp.rep_name ?? '—'} />
            <ReadOnlyRow label="Notes" value={opp.notes ?? '—'} />
            {(QUOTED_PLUS.includes(opp.stage) || opp.quotation_link) && (
              <QuotationPdfManager oppId={Number(opp.id)} initialLink={opp.quotation_link ?? null} canEdit={canEdit} />
            )}
            <QuotedItemsSection items={quoteItems} meta={quoteMeta} />
          </div>
        ) : (
        /* Editable form */
        <form onSubmit={handleSubmit} style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* Stage */}
            <div>
              <label style={LABEL_STYLE}>Stage *</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {['Suspect', 'Prospect', 'Quoted', 'Negotiating', 'On Hold', 'Won', 'Lost', 'Dropped'].map(s => (
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

            {/* Product + Project — the two full-width identifiers, up top. */}
            <div>
              <label style={LABEL_STYLE}>Product / Description *</label>
              <input name="product" required defaultValue={opp.product ?? ''} style={INPUT_STYLE} />
            </div>

            <div>
              <label style={LABEL_STYLE}>Project Name / Unit</label>
              <input name="unit_project" value={unitProject} onChange={e => setUnitProject(e.target.value)}
                placeholder="e.g. Balrampur Chini — Unit 2, Spent Wash" style={INPUT_STYLE} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={LABEL_STYLE}>Product Type</label>
                <select name="product_type" defaultValue={opp.product_type ?? 'PCP'} style={INPUT_STYLE}>
                  {['PCP', 'MMP', 'Spares', 'Service', 'Other'].map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label style={LABEL_STYLE}>Probability</label>
                <select name="probability_code" defaultValue={opp.probability_code ?? ''} style={INPUT_STYLE}>
                  <option value="">—</option>
                  {PROBABILITY_CODES.map(c => <option key={c.code} value={c.code}>{probabilityCodeLabel(c)}</option>)}
                  {opp.probability_code && !PROBABILITY_CODES.some(c => c.code === opp.probability_code) && (
                    <option value={opp.probability_code}>{opp.probability_code}</option>
                  )}
                </select>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={LABEL_STYLE}>Value (₹)</label>
                <input name="value_inr" type="number" step="1" min="0" inputMode="numeric" defaultValue={inrFrom(opp.value_cr)} style={INPUT_STYLE} />
                <div style={{ fontSize: 10, color: 'var(--fg-3)', marginTop: 3 }}>Full amount in rupees</div>
              </div>
              <div>
                <label style={LABEL_STYLE}>Expected Close</label>
                <MonthYearSelect name="eta_text" value={opp.eta_text} />
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

            {/* Quotation PDF — manage it at any stage from Quoted onward. */}
            {(QUOTED_PLUS.includes(opp.stage) || opp.quotation_link) && (
              <QuotationPdfManager oppId={Number(opp.id)} initialLink={opp.quotation_link ?? null} canEdit />
            )}

            {/* Won fields */}
            {stage === 'Won' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={LABEL_STYLE}>Final Value (₹)</label>
                  <input name="final_value_inr" type="number" step="1" inputMode="numeric" value={finalInr} onChange={e => setFinalInr(e.target.value)} style={INPUT_STYLE} />
                  <div style={{ fontSize: 10, color: 'var(--fg-3)', marginTop: 3 }}>Full amount in rupees</div>
                </div>
                <div>
                  <label style={LABEL_STYLE}>PO Number</label>
                  <input name="po_number" defaultValue={opp.po_number ?? ''} style={INPUT_STYLE} />
                </div>
              </div>
            )}

            {/* Sales Orders — required to move this opportunity to Won. */}
            {stage === 'Won' && opp.stage !== 'Won' && (
              <SalesOrderList finalValueInr={parseFloat(finalInr) || null} />
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

            {/* Tour — an opportunity belongs to the client's tour and all its
                reps, not one owner, so there is no rep picker here. */}
            <div>
              <label style={LABEL_STYLE}>Tour · Reps / Manager</label>
              <div style={{ ...INPUT_STYLE, color: 'var(--fg-2)', display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-start', minHeight: 36, height: 'auto', padding: '8px 10px' }}>
                <span style={{ fontWeight: 600 }}>{opp.tour_name ?? '— no tour —'}</span>
                {opp.tour_people && <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>{opp.tour_people}</span>}
              </div>
              <div style={{ fontSize: 10, color: 'var(--fg-3)', marginTop: 3 }}>
                Belongs to the client&apos;s tour — all its reps can work it.
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

            <QuotedItemsSection items={quoteItems} meta={quoteMeta} />

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

function QuotedItemsSection({ items, meta }: { items: QItem[]; meta: QMeta | null }) {
  const inr = (v: number | null | undefined) => v != null ? '₹' + Math.round(v).toLocaleString('en-IN') : null;
  const facts: [string, string][] = [];
  if (meta) {
    const add = (l: string, v: unknown) => { const s = v == null ? '' : String(v).trim(); if (s && s !== '—') facts.push([l, s]); };
    add('Market', meta.market); add('Quarter', meta.qtr); add('RIL Rep', meta.ril_rep);
    add('Prepared By', meta.qtn_prepared_by); add('Client Status', meta.client_status_at_quote);
    add('Enquiry No', meta.enquiry_no); add('Enquiry Date', meta.enquiry_date);
    add('Location', meta.location);
    add('Probability', meta.probability_code); add('Revised Offer Date', meta.revised_offer_date);
    const rev = inr(meta.revised_offer_value_inr); if (rev) add('Revised Offer', rev);
  }
  if (!items.length && !facts.length) return null;
  return (
    <div style={{ marginTop: 4, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
      <div style={{ ...LABEL_STYLE, marginBottom: 8 }}>Quotation Details</div>
      {facts.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '7px 12px', marginBottom: items.length ? 12 : 0 }}>
          {facts.map(([l, v]) => (
            <div key={l}>
              <div style={{ fontSize: 9.5, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{l}</div>
              <div style={{ fontSize: 12.5, color: 'var(--fg)', marginTop: 1 }}>{v}</div>
            </div>
          ))}
        </div>
      )}
      {meta?.quotation_link && <a href={meta.quotation_link} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: '#1A5CB8', textDecoration: 'none' }}>Open quotation ↗</a>}
      {items.length > 0 && (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--fg-3)', margin: '12px 0 6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Quoted Items ({items.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {items.map(it => (
              <div key={it.id} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '9px 11px', background: 'var(--bg-elev)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, fontWeight: 600, color: 'var(--fg)', overflowWrap: 'anywhere' }}>{it.pump_model || '—'}</span>
                  {inr(it.offer_value_inr) && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: '#0A3D8F', flexShrink: 0 }}>{inr(it.offer_value_inr)}</span>}
                </div>
                <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 3, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {it.pump_qty != null && <span>Qty {it.pump_qty}</span>}
                  {it.pump_speed && <span>{it.pump_speed}</span>}
                  {inr(it.motor_price) && <span>Motor {inr(it.motor_price)}</span>}
                  {inr(it.gearbox_vbelt_price) && <span>GB/V-belt {inr(it.gearbox_vbelt_price)}</span>}
                </div>
                {it.geared_motor_detail && <div style={{ fontSize: 11, color: 'var(--fg-2)', marginTop: 4, whiteSpace: 'pre-wrap' }}>{it.geared_motor_detail}</div>}
                {it.detailed_specifications && <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 4, whiteSpace: 'pre-wrap' }}>{it.detailed_specifications}</div>}
              </div>
            ))}
          </div>
        </>
      )}
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
