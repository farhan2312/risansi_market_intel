'use client';

import { useState, useEffect, useRef, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { createPipelineOpportunity } from '@/app/actions/risansi';
import { PROBABILITY_CODES, probabilityCodeLabel } from '@/lib/risansi-probability-codes';
import {
  CREATE_STAGES, STAGE_HINT,
  LOST_COMPETITOR_TAIL, isFieldRequired, fieldsForStep, stageHasQuoteStep,
  requiredFieldNames, requiredFieldNamesForStep, labelsFor,
  type CreateStage, type OppFieldDef,
} from '@/lib/risansi-opportunity-fields';

interface ClientResult {
  id: string; legal_name: string; code: string;
  city: string | null; industry: string | null;
  /** The single resolved owner, or null when the tour cannot decide. */
  owner_name: string | null;
}

export interface NewOpportunityModalProps {
  open: boolean;
  onClose: () => void;
  // Pre-filled & locked when launched from Client 360
  lockClient?: boolean;
  clientId?: string;
  clientName?: string;
  clientCode?: string;
  clientIndustry?: string | null;
  clientOwnerName?: string | null;
}

export function NewOpportunityModal(props: NewOpportunityModalProps) {
  const { open, onClose, lockClient } = props;

  const lockedClient: ClientResult | null = lockClient && props.clientId
    ? {
        id: props.clientId,
        legal_name: props.clientName ?? '',
        code: props.clientCode ?? '',
        city: null,
        industry: props.clientIndustry ?? null,
        owner_name: props.clientOwnerName ?? null,
      }
    : null;

  const [search, setSearch]       = useState('');
  const [results, setResults]     = useState<ClientResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected]   = useState<ClientResult | null>(lockedClient);

  useEffect(() => {
    if (lockClient && props.clientId) setSelected(lockedClient);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockClient, props.clientId, open]);

  const reset = () => { onClose(); setSearch(''); setResults([]); if (!lockClient) setSelected(null); };

  const searchClients = async (qStr: string) => {
    setSearch(qStr);
    if (qStr.length < 2) { setResults([]); return; }
    setSearching(true);
    try {
      const res  = await fetch(`/api/risansi/clients-search?q=${encodeURIComponent(qStr)}`);
      const data = await res.json();
      setResults(Array.isArray(data) ? data : []);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  if (!open) return null;

  return (
    <>
      {/* Blurred, dimmed backdrop — click to close. */}
      <div onClick={reset} style={{
        position: 'fixed', inset: 0, background: 'rgba(10,22,40,0.35)',
        backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)', zIndex: 200,
      }} />
      {/* Centered floating modal. */}
      <div className="risansi-modal" style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        width: 600, maxWidth: 'calc(100vw - 32px)', maxHeight: '90vh', background: 'var(--bg-paper)', borderRadius: 12,
        boxShadow: '0 20px 60px rgba(10,61,143,0.2)', zIndex: 201, overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--fg)' }}>New Opportunity</span>
          <button onClick={reset} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--fg-3)', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: '16px 20px', overflowY: 'auto' }}>
          {!selected ? (
            <div>
              <label style={LBL}>Select Client / Lead *</label>
              <input
                type="text" placeholder="Search by name or code…"
                value={search} onChange={e => searchClients(e.target.value)}
                autoFocus style={INP}
              />
              {results.length > 0 && (
                <div style={{ marginTop: 4, border: '1px solid var(--line)', borderRadius: 6, overflow: 'hidden', maxHeight: 240, overflowY: 'auto' }}>
                  {results.map(r => (
                    <div
                      key={r.id}
                      onClick={() => { setSelected(r); setResults([]); }}
                      style={{ padding: '10px 12px', cursor: 'pointer', borderBottom: '1px solid var(--line)', fontSize: 13, background: 'var(--bg-paper)' }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-elev)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'var(--bg-paper)')}
                    >
                      <div style={{ fontWeight: 500 }}>{r.legal_name}</div>
                      <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
                        {r.code}{r.city ? ` · ${r.city}` : ''}{r.industry ? ` · ${r.industry}` : ''}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {searching && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--fg-3)' }}>Searching…</div>}
            </div>
          ) : (
            <NewOppForm
              client={selected}
              lockClient={!!lockClient}
              onBack={() => setSelected(null)}
              onSuccess={reset}
            />
          )}
        </div>
      </div>
    </>
  );
}

interface ItemRow {
  pump_model: string; pump_qty: string; pump_speed: string; geared_motor_detail: string;
  motor_price: string; gearbox_vbelt_price: string; offer_value_inr: string;
  offer_value_usd: string; detailed_specifications: string;
}
const EMPTY_ITEM: ItemRow = {
  pump_model: '', pump_qty: '', pump_speed: '', geared_motor_detail: '',
  motor_price: '', gearbox_vbelt_price: '', offer_value_inr: '', offer_value_usd: '', detailed_specifications: '',
};
const itemHasData = (it: ItemRow) => !!(it.pump_model.trim() || it.offer_value_inr.trim() || it.pump_qty.trim() || it.detailed_specifications.trim());

// Is a field satisfied? Mirrors the server: the Total Offer counts line items;
// a money field of 0 is not "filled".
function fieldFilled(fd: FormData, name: string, itemsOfferSum: number): boolean {
  if (name === 'offer_value_inr') {
    const d = parseFloat(String(fd.get('offer_value_inr') ?? ''));
    return (Number.isFinite(d) && d > 0) || itemsOfferSum > 0;
  }
  const v = fd.get(name);
  if (v == null || String(v).trim() === '') return false;
  if (name === 'value_inr' || name === 'final_value_inr') return parseFloat(String(v)) > 0;
  return true;
}

function NewOppForm({ client, lockClient, onBack, onSuccess }: {
  client: ClientResult;
  lockClient: boolean;
  onBack: () => void;
  onSuccess: () => void;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [stage, setStage]     = useState<CreateStage>('Suspect');
  const [step, setStep]       = useState<1 | 2>(1);
  const [items, setItems]     = useState<ItemRow[]>([]);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [competitors, setCompetitors] = useState<string[]>([]);

  const hasStep2 = stageHasQuoteStep(stage);
  const noOwner  = !client.owner_name;
  const step1Fields = fieldsForStep(stage, 1);
  const step2Fields = fieldsForStep(stage, 2);

  // Competitor list only matters on the Lost branch.
  useEffect(() => {
    if (stage !== 'Lost' || competitors.length) return;
    fetch('/api/risansi/competitors')
      .then(r => (r.ok ? r.json() : []))
      .then((d: { name: string }[]) => setCompetitors(Array.isArray(d) ? d.map(c => c.name) : []))
      .catch(() => setCompetitors([]));
  }, [stage, competitors.length]);

  // Switching stage always returns to step 1 — the stage decides whether a
  // step 2 even exists, so staying on a now-missing step 2 makes no sense.
  const onStage = (next: CreateStage) => { setStage(next); setStep(1); };
  const setItem = (i: number, k: keyof ItemRow, v: string) =>
    setItems(prev => prev.map((it, idx) => (idx === i ? { ...it, [k]: v } : it)));

  const itemsOfferSum = () => items.filter(itemHasData).reduce((a, it) => {
    const f = parseFloat(String(it.offer_value_inr).replace(/[^0-9.\-]/g, ''));
    return a + (Number.isFinite(f) ? f : 0);
  }, 0);

  // Step 1 → 2. Validate only step 1's required fields before advancing.
  const goNext = () => {
    setError('');
    const form = formRef.current;
    if (!form) return;
    const fd = new FormData(form);
    const missing = requiredFieldNamesForStep(stage, 1).filter(n => !fieldFilled(fd, n, itemsOfferSum()));
    if (missing.length) {
      setError(`Fill the required field${missing.length > 1 ? 's' : ''} first: ${labelsFor(missing).join(', ')}.`);
      return;
    }
    setStep(2);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const fd = new FormData(e.currentTarget);
      fd.set('client_id', String(client.id));
      fd.set('stage', stage);
      const activeItems = items.filter(itemHasData);
      if (hasStep2) fd.set('items_json', JSON.stringify(activeItems));

      // Full required gate, mirroring the server (the authority), across BOTH steps.
      const sum = itemsOfferSum();
      const missing = requiredFieldNames(stage).filter(n => !fieldFilled(fd, n, sum));
      if (missing.length) {
        // Bounce to the step that owns the first missing field.
        const firstStep1 = requiredFieldNamesForStep(stage, 1).some(n => missing.includes(n));
        setStep(firstStep1 ? 1 : 2);
        setError(`Fill the required field${missing.length > 1 ? 's' : ''}: ${labelsFor(missing).join(', ')}.`);
        setLoading(false);
        return;
      }

      // Catch the common upload rejection (oversize) BEFORE creating, so the
      // form can say so inline instead of dropping the PDF after the fact.
      if (pdfFile && pdfFile.size > 15 * 1024 * 1024) {
        setError('The quotation PDF is larger than 15 MB. Choose a smaller file, or create now and attach it from the card.');
        setLoading(false);
        return;
      }

      const created = await createPipelineOpportunity(fd);

      // Attach the quotation PDF to the record we just created — the reason the
      // form has a second step. The opportunity is already saved, so a failed
      // upload is non-fatal, but it must NOT be swallowed: the step-2 copy
      // promised the PDF was attached, so surface any failure plainly.
      if (pdfFile && created?.id) {
        let attachError = '';
        try {
          const pf = new FormData();
          pf.set('file', pdfFile);
          const up = await fetch(`/api/risansi/opportunities/${created.id}/quotation`, { method: 'POST', body: pf });
          if (!up.ok) {
            const j = await up.json().catch(() => ({} as { error?: string }));
            attachError = j?.error || `upload failed (${up.status})`;
          }
        } catch {
          attachError = 'a network error';
        }
        if (attachError) {
          window.alert(`Opportunity created, but the quotation PDF could not be attached (${attachError}). You can add it from the opportunity card.`);
        }
      }

      onSuccess();
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create opportunity');
      setLoading(false);
    }
  };

  const renderField = (f: OppFieldDef) => {
    const required = isFieldRequired(f, stage);
    // Native `required` only on the CURRENT step (a hidden required field would
    // make submit throw "not focusable"), and never on the Total Offer (line
    // items can satisfy it — the submit guard enforces the real rule).
    const htmlRequired = required && f.step === step && f.name !== 'offer_value_inr';
    const label = <label style={LBL}>{f.label}{required ? ' *' : ''}</label>;
    const reqStyle: CSSProperties = required ? { border: '1px solid var(--warn)' } : {};
    let control: React.ReactNode;

    if (f.kind === 'select') {
      const opts = f.name === 'lost_to_competitor' ? [...competitors, ...LOST_COMPETITOR_TAIL] : (f.options ?? []);
      control = (
        <select name={f.name} required={htmlRequired} defaultValue="" style={{ ...INP, ...reqStyle }}>
          <option value="">—</option>
          {opts.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    } else if (f.kind === 'prob_code') {
      control = (
        <select name={f.name} defaultValue="" style={INP}>
          <option value="">—</option>
          {PROBABILITY_CODES.map(c => <option key={c.code} value={c.code}>{probabilityCodeLabel(c)}</option>)}
        </select>
      );
    } else if (f.kind === 'textarea') {
      control = <textarea name={f.name} rows={3} required={htmlRequired} placeholder={f.placeholder}
        style={{ ...INP, height: 'auto', resize: 'vertical', lineHeight: 1.5, ...reqStyle }} />;
    } else if (f.kind === 'date') {
      control = <input name={f.name} type="date" required={htmlRequired} style={{ ...INP, ...reqStyle }} />;
    } else if (f.kind === 'inr' || f.kind === 'number' || f.kind === 'usd') {
      control = <input name={f.name} type="number" step={f.kind === 'inr' ? '1' : '0.01'} min="0"
        inputMode="numeric" required={htmlRequired} placeholder={f.placeholder} style={{ ...INP, ...reqStyle }} />;
    } else {
      control = <input name={f.name} type="text" required={htmlRequired} placeholder={f.placeholder} style={{ ...INP, ...reqStyle }} />;
    }

    return (
      <div key={f.name} style={f.full ? { gridColumn: '1 / -1' } : undefined}>
        {label}
        {control}
        {f.help && <div style={{ fontSize: 10, color: 'var(--fg-3)', marginTop: 3 }}>{f.help}</div>}
      </div>
    );
  };

  const gridStyle: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'start' };

  return (
    <form ref={formRef} onSubmit={handleSubmit}>
      {/* Selected client chip */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 12px', marginBottom: 14, background: 'var(--accent-soft)',
        borderRadius: 6, border: '1px solid var(--brand-blue)',
      }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--brand-blue)' }}>{client.legal_name}</div>
          <div style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
            {client.code}{client.industry ? ` · ${client.industry}` : ''}
          </div>
        </div>
        {!lockClient && step === 1 && (
          <button type="button" onClick={onBack} style={{ background: 'none', border: 'none', fontSize: 11, color: 'var(--brand-blue)', cursor: 'pointer', textDecoration: 'underline' }}>
            Change
          </button>
        )}
      </div>

      {/* Owner (derived from the tour) or a block if the tour can't name one. */}
      {client.owner_name ? (
        <div style={{ fontSize: 11, color: 'var(--fg-3)', marginBottom: 14 }}>
          Owner: <span style={{ color: 'var(--fg-2)', fontWeight: 500 }}>{client.owner_name}</span>
          <span style={{ fontStyle: 'italic' }}> · from this client&apos;s tour</span>
        </div>
      ) : (
        <div style={{
          fontSize: 11.5, lineHeight: 1.5, color: 'var(--warn-strong, #92400E)',
          background: 'var(--warn-soft, #FEF3C7)', border: '1px solid var(--warn, #F59E0B)',
          borderRadius: 6, padding: '8px 10px', marginBottom: 14,
        }}>
          This client isn&apos;t on a tour with an assigned rep, so a new opportunity would have
          no owner. Put the client on a tour first, then come back.
        </div>
      )}

      {/* Step indicator (only when there are two steps). */}
      {hasStep2 && (
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
          Step {step} of 2 · {step === 1 ? 'The deal' : 'Quotation'}
        </div>
      )}

      {/* ── Step 1 · the deal ── (kept mounted so values survive a trip to step 2) */}
      <div style={{ display: step === 1 ? 'block' : 'none' }}>
        {/* The stage drives everything below it. */}
        <div style={{ marginBottom: 12 }}>
          <label style={LBL}>Stage *</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {CREATE_STAGES.map(sName => {
              const active = stage === sName;
              return (
                <button
                  key={sName} type="button" onClick={() => onStage(sName)}
                  style={{
                    padding: '6px 12px', borderRadius: 20, fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
                    background: active ? '#0A3D8F' : 'var(--bg-elev)',
                    color: active ? '#fff' : 'var(--fg-2)',
                    border: `1px solid ${active ? '#0A3D8F' : 'var(--line-strong)'}`,
                  }}
                >
                  {sName}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{
          fontSize: 11, lineHeight: 1.5, color: 'var(--fg-2)', marginBottom: 14,
          padding: '7px 10px', background: 'var(--bg-sunk)', borderRadius: 6, borderLeft: '3px solid var(--brand-blue)',
        }}>
          {STAGE_HINT[stage]}
        </div>

        <div style={gridStyle}>{step1Fields.map(renderField)}</div>
      </div>

      {/* ── Step 2 · the quotation ── */}
      {hasStep2 && (
        <div style={{ display: step === 2 ? 'block' : 'none' }}>
          <div style={gridStyle}>{step2Fields.map(renderField)}</div>

          {/* Line items */}
          <div style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg)' }}>Quoted Items ({items.length})</span>
              <button type="button" onClick={() => setItems(p => [...p, { ...EMPTY_ITEM }])} style={ADD_BTN}>+ Add item</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {items.map((it, idx) => (
                <div key={idx} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 10, background: 'var(--bg-elev)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-3)' }}>Item {idx + 1}</span>
                    <button type="button" onClick={() => setItems(p => p.filter((_, i) => i !== idx))} style={DEL_BTN}>Remove</button>
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
            <div style={{ fontSize: 10, color: 'var(--fg-3)', marginTop: 6 }}>
              Optional. Leave the Total Offer blank to auto-sum from item offers.
            </div>
          </div>

          {/* Quotation PDF — attached to the opportunity as soon as it is created. */}
          <div style={{ marginTop: 16 }}>
            <label style={LBL}>Quotation PDF</label>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <label style={UPLOAD_BTN}>
                {pdfFile ? '⤒ Replace PDF' : '⤒ Choose PDF'}
                <input type="file" accept="application/pdf,.pdf"
                  onChange={e => setPdfFile(e.target.files?.[0] ?? null)}
                  style={{ display: 'none' }} />
              </label>
              {pdfFile
                ? <span style={{ fontSize: 11.5, color: 'var(--fg-2)' }}>{pdfFile.name}</span>
                : <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>Attached on create — no need to visit the card.</span>}
              {pdfFile && (
                <button type="button" onClick={() => setPdfFile(null)} style={{ background: 'none', border: 'none', color: 'var(--neg)', cursor: 'pointer', fontSize: 11 }}>Remove</button>
              )}
            </div>
          </div>
        </div>
      )}

      {error && (
        <div style={{ marginTop: 14, padding: '8px 12px', background: 'var(--neg-soft)', border: '1px solid var(--neg)', borderLeft: '3px solid var(--neg)', borderRadius: 5, color: 'var(--neg-strong)', fontSize: 12 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center', paddingTop: 16 }}>
        {step === 2 && (
          <button type="button" onClick={() => { setError(''); setStep(1); }} style={{ marginRight: 'auto', padding: '8px 16px', borderRadius: 6, border: '1px solid var(--line-strong)', background: 'var(--bg-paper)', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}>
            ← Back
          </button>
        )}
        {step === 1 && hasStep2 ? (
          <button type="button" onClick={goNext} disabled={noOwner} style={{ padding: '8px 20px', borderRadius: 6, background: '#0A3D8F', color: 'white', border: 'none', cursor: noOwner ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 500, fontFamily: 'inherit', opacity: noOwner ? 0.6 : 1 }}>
            Next → Quotation
          </button>
        ) : (
          <button type="submit" disabled={loading || noOwner} style={{ padding: '8px 20px', borderRadius: 6, background: '#0A3D8F', color: 'white', border: 'none', cursor: loading || noOwner ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 500, fontFamily: 'inherit', opacity: loading || noOwner ? 0.6 : 1 }}>
            {loading ? 'Creating…' : `Create · ${stage}`}
          </button>
        )}
      </div>
    </form>
  );
}

function ItemField({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label style={{ ...LBL, fontSize: 9.5, marginBottom: 3 }}>{label}</label>{children}</div>;
}

const LBL: CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--fg-2)',
  textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6,
};

const INP: CSSProperties = {
  display: 'block', width: '100%', padding: '8px 10px',
  border: '1px solid var(--line-strong)', borderRadius: 6, fontSize: 13,
  fontFamily: 'inherit', background: 'var(--bg-elev)', color: 'var(--fg)',
  outline: 'none', boxSizing: 'border-box',
};

const ADD_BTN: CSSProperties = {
  marginLeft: 'auto', padding: '5px 11px', fontSize: 12, fontWeight: 600,
  background: 'var(--accent-soft)', color: 'var(--title)', border: '1px solid var(--accent-line)',
  borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
};
const DEL_BTN: CSSProperties = {
  marginLeft: 'auto', padding: '3px 9px', fontSize: 11, background: 'none',
  border: '1px solid var(--line-strong)', color: 'var(--neg)', borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit',
};
const UPLOAD_BTN: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', fontSize: 12.5, fontWeight: 600,
  background: 'var(--accent-soft)', color: 'var(--title)', border: '1px dashed var(--accent-line)',
  borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
};
