'use client';

import { useState, useTransition, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { saveVisitContacts, saveEquipmentEntries, submitVisitReport } from '@/app/actions/risansi';
import type { ReportInitialData } from './page';

// ── Constants ──────────────────────────────────────────────────

const VISIT_TYPES = ['Sugar Plant', 'Distillery', 'Dairy', 'Paper & Pulp', 'Brewery', 'Other'];

const SUGAR_APPS = [
  'Cane Prep', 'Juice Sulphitation', 'Juice Heating',
  'Molasses Transfer', 'Massecuite Transfer', 'Melt Transfer',
  'Dosing', 'Boiler Feed', 'Effluent (ETP)', 'Other',
];
const NON_SUGAR_APPS = ['Process Transfer', 'Dosing', 'Effluent', 'Utility', 'Boiler Feed', 'Other'];

const CONDITIONS = ['Good', 'Needs Attention', 'End of Life', 'No Pump'];
const COMP_CONDITIONS = ['Good', 'Needs Attention', 'End of Life'];

const COMMERCIAL_Qs = [
  { key: 'purchasingRoute',    label: 'Purchasing route confirmed or updated' },
  { key: 'expansionPlans',     label: 'Expansion or new project plans' },
  { key: 'pendingOffers',      label: 'Pending offer or quotation to discuss' },
  { key: 'complaints',         label: 'Complaints or after-service issues' },
  { key: 'returnableMaterial', label: 'Returnable material to collect / arrange' },
  { key: 'outstandingPayment', label: 'Outstanding payment to follow up' },
  { key: 'performanceCert',    label: 'Performance certificate required' },
];

const OUTCOMES = ['Very Positive', 'Positive', 'Neutral', 'Needs Attention', 'Escalation'];

const STEP_LABELS = ['Identity', 'Contacts', 'RIL Equip', 'Competitors', 'Commercial'];

// ── Types ──────────────────────────────────────────────────────

interface EquipEntry {
  application: string;
  qty: number;
  model: string;
  condition: string;
  notes: string;
}

interface CompEntry {
  supplier: string;
  application: string;
  model: string;
  qty: number;
  condition: string;
  notes: string;
}

interface CommercialState {
  [key: string]: boolean | string;
}

// ── Main component ─────────────────────────────────────────────

export function VisitReportClient({ initialData: d }: { initialData: ReportInitialData }) {
  const router = useRouter();
  const [saving, startSave] = useTransition();

  const [step, setStep] = useState(d.status === 'completed' ? 4 : 0);

  // Step 1
  const [visitType, setVisitType] = useState('Sugar Plant');
  const [contactIds, setContactIds] = useState<string[]>(d.priorContactIds);

  // Step 2
  const [newContacts, setNewContacts] = useState<Array<{ name: string; designation: string; phone: string }>>([]);

  // Step 3 — RIL equipment
  const isSugar = visitType === 'Sugar Plant';
  const appList = isSugar ? SUGAR_APPS : NON_SUGAR_APPS;
  const [rilEquip, setRilEquip] = useState<Record<string, EquipEntry>>(() =>
    Object.fromEntries(appList.map(a => [a, { application: a, qty: 0, model: '', condition: 'Good', notes: '' }]))
  );

  // Step 4 — Competitor equipment
  const [compEquip, setCompEquip] = useState<CompEntry[]>([]);

  // Step 5 — Commercial
  const [commercial, setCommercial] = useState<CommercialState>(() =>
    Object.fromEntries(COMMERCIAL_Qs.flatMap(q => [[q.key, false], [`${q.key}Detail`, '']]))
  );
  const [outcome, setOutcome] = useState('Positive');
  const [summary, setSummary] = useState('');
  const [opportunityProduct, setOpportunityProduct] = useState('');
  const [opportunityValue, setOpportunityValue] = useState('');

  // ── Step navigation ──────────────────────────────────────────

  const goNext = () => {
    if (step === 0) {
      // Save step 1 + 2 contacts to DB
      startSave(async () => {
        await saveVisitContacts(d.visitId, visitType, contactIds, newContacts);
        setStep(1);
      });
    } else if (step === 1) {
      setStep(2);
    } else if (step === 2) {
      // Save RIL equipment
      const entries = Object.values(rilEquip)
        .filter(e => e.qty > 0 || e.model.trim())
        .map(e => ({ ...e, supplier: 'RIL', isRil: true }));
      startSave(async () => {
        if (entries.length > 0) await saveEquipmentEntries(d.visitId, d.clientId, entries);
        setStep(3);
      });
    } else if (step === 3) {
      // Save competitor equipment
      const entries = compEquip
        .filter(e => e.supplier.trim())
        .map(e => ({ ...e, isRil: false }));
      startSave(async () => {
        if (entries.length > 0) await saveEquipmentEntries(d.visitId, d.clientId, entries);
        setStep(4);
      });
    }
  };

  const goBack = () => {
    if (step > 0) setStep(s => s - 1);
    else router.back();
  };

  const handleSubmit = () => {
    startSave(async () => {
      await submitVisitReport(d.visitId, {
        outcome,
        summary,
        commercial,
        createOpportunity: commercial.expansionPlans === true && opportunityProduct.trim() !== '',
        opportunityProduct: opportunityProduct.trim(),
        opportunityValue: parseFloat(opportunityValue) || 0,
      });
      router.push('/risansi/mobile');
    });
  };

  // ── Render ────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Sticky header */}
      <div style={HEADER}>
        <button onClick={goBack} style={ICON_BTN} aria-label="Back">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4L6 9l5 5"/>
          </svg>
        </button>
        <div style={{ flex: 1, textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--fg)', lineHeight: 1.2 }}>Visit Report</div>
          <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 1 }}>
            {d.clientName}
          </div>
        </div>
        <div style={{ width: 32 }} />
      </div>

      {/* Step indicator */}
      <div style={{ padding: '10px 16px', background: 'var(--bg-paper)', borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {STEP_LABELS.map((label, i) => (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
              <div style={{
                height: 3, borderRadius: 2, width: '100%',
                background: i <= step ? 'var(--accent)' : 'var(--bg-sunk)',
                transition: 'background 0.2s',
              }} />
              <span style={{ fontSize: 9, color: i === step ? 'var(--accent)' : 'var(--fg-3)', fontWeight: i === step ? 600 : 400, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Step content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
        {step === 0 && <Step1Identity
          visitType={visitType} setVisitType={setVisitType}
          contactIds={contactIds} setContactIds={setContactIds}
          contacts={d.contacts}
          clientName={d.clientName} clientCode={d.clientCode}
          industry={d.industry} tcd={d.tcd} klpd={d.klpd}
        />}
        {step === 1 && <Step2Contacts
          newContacts={newContacts} setNewContacts={setNewContacts}
          metContacts={d.contacts.filter(c => contactIds.includes(c.id))}
        />}
        {step === 2 && <Step3RilEquip
          visitType={visitType}
          rilEquip={rilEquip} setRilEquip={setRilEquip}
          appList={appList}
          existing={d.existingEquipment.filter(e => e.supplier === 'RIL')}
        />}
        {step === 3 && <Step4CompEquip
          compEquip={compEquip} setCompEquip={setCompEquip}
          existing={d.existingEquipment.filter(e => e.supplier !== 'RIL')}
        />}
        {step === 4 && <Step5Commercial
          commercial={commercial} setCommercial={setCommercial}
          outcome={outcome} setOutcome={setOutcome}
          summary={summary} setSummary={setSummary}
          opportunityProduct={opportunityProduct} setOpportunityProduct={setOpportunityProduct}
          opportunityValue={opportunityValue} setOpportunityValue={setOpportunityValue}
        />}
      </div>

      {/* Bottom action bar */}
      <div style={{
        padding: '12px 16px',
        background: 'var(--bg-paper)', borderTop: '1px solid var(--line)',
        display: 'flex', gap: 10,
        paddingBottom: 'calc(12px + env(safe-area-inset-bottom, 0px))',
      }}>
        {step < 4 ? (
          <button onClick={goNext} disabled={saving} style={{
            flex: 1, padding: '13px', fontSize: 15, fontFamily: 'inherit',
            fontWeight: 600, background: saving ? 'var(--bg-sunk)' : 'var(--accent)',
            color: saving ? 'var(--fg-3)' : '#fff',
            border: 'none', borderRadius: 12, cursor: saving ? 'not-allowed' : 'pointer',
          }}>
            {saving ? 'Saving…' : `Next: ${STEP_LABELS[step + 1]}`}
          </button>
        ) : (
          <button onClick={handleSubmit} disabled={saving} style={{
            flex: 1, padding: '13px', fontSize: 15, fontFamily: 'inherit',
            fontWeight: 600, background: saving ? 'var(--bg-sunk)' : 'var(--pos)',
            color: saving ? 'var(--fg-3)' : '#fff',
            border: 'none', borderRadius: 12, cursor: saving ? 'not-allowed' : 'pointer',
          }}>
            {saving ? 'Submitting…' : 'Submit Report'}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Step 1: Identity ───────────────────────────────────────────

function Step1Identity({
  visitType, setVisitType, contactIds, setContactIds, contacts,
  clientName, clientCode, industry, tcd, klpd,
}: {
  visitType: string; setVisitType: (v: string) => void;
  contactIds: string[]; setContactIds: (ids: string[]) => void;
  contacts: ReportInitialData['contacts'];
  clientName: string; clientCode: string; industry: string;
  tcd: number | null; klpd: number | null;
}) {
  const toggleContact = (id: string) => {
    const next = contactIds.includes(id)
      ? contactIds.filter(x => x !== id)
      : [...contactIds, id];
    setContactIds(next);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Client summary */}
      <div style={{ background: 'var(--bg-elev)', borderRadius: 10, padding: '12px 14px', border: '1px solid var(--line)' }}>
        <div style={{ fontSize: 14, fontWeight: 500 }}>{clientName}</div>
        <div style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
          {clientCode} · {industry}
          {tcd ? ` · ${tcd} TCD` : ''}
          {klpd ? ` · ${klpd} KLPD` : ''}
        </div>
      </div>

      {/* Visit type */}
      <div>
        <label style={LABEL}>Visit Type</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
          {VISIT_TYPES.map(vt => (
            <button key={vt} onClick={() => setVisitType(vt)} style={{
              padding: '8px 14px', borderRadius: 20, fontSize: 12,
              fontFamily: 'inherit', cursor: 'pointer', fontWeight: visitType === vt ? 500 : 400,
              background: visitType === vt ? 'var(--accent)' : 'var(--bg-elev)',
              color: visitType === vt ? '#fff' : 'var(--fg)',
              border: visitType === vt ? '1px solid var(--accent)' : '1px solid var(--line)',
            }}>
              {vt}
            </button>
          ))}
        </div>
      </div>

      {/* Contacts met */}
      <div>
        <label style={LABEL}>Contacts Met</label>
        {contacts.length === 0 ? (
          <div style={{ marginTop: 8, fontSize: 13, color: 'var(--fg-3)' }}>No contacts on record — add in next step</div>
        ) : (
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {contacts.map(c => {
              const checked = contactIds.includes(c.id);
              return (
                <button key={c.id} onClick={() => toggleContact(c.id)} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 12px', borderRadius: 8,
                  background: checked ? 'var(--accent-soft)' : 'var(--bg-elev)',
                  border: checked ? '1px solid var(--accent-line)' : '1px solid var(--line)',
                  cursor: 'pointer', textAlign: 'left',
                }}>
                  <div style={{
                    width: 20, height: 20, borderRadius: 5, flexShrink: 0,
                    background: checked ? 'var(--accent)' : 'var(--bg-paper)',
                    border: `1.5px solid ${checked ? 'var(--accent)' : 'var(--line-strong)'}`,
                    display: 'grid', placeItems: 'center',
                  }}>
                    {checked && (
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2 6l3 3 5-5"/>
                      </svg>
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg)' }}>{c.name}</div>
                    {c.designation && <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 1 }}>{c.designation}</div>}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Step 2: Contacts ───────────────────────────────────────────

function Step2Contacts({
  newContacts, setNewContacts, metContacts,
}: {
  newContacts: Array<{ name: string; designation: string; phone: string }>;
  setNewContacts: (v: Array<{ name: string; designation: string; phone: string }>) => void;
  metContacts: ReportInitialData['contacts'];
}) {
  const addRow = () => setNewContacts([...newContacts, { name: '', designation: '', phone: '' }]);
  const update = (i: number, field: string, val: string) => {
    const next = newContacts.map((c, j) => j === i ? { ...c, [field]: val } : c);
    setNewContacts(next);
  };
  const remove = (i: number) => setNewContacts(newContacts.filter((_, j) => j !== i));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Confirmed contacts summary */}
      {metContacts.length > 0 && (
        <div>
          <label style={LABEL}>Confirmed Contacts</label>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {metContacts.map(c => (
              <div key={c.id} style={{ padding: '8px 12px', background: 'var(--bg-elev)', borderRadius: 8, fontSize: 12 }}>
                <span style={{ fontWeight: 500 }}>{c.name}</span>
                {c.designation && <span style={{ color: 'var(--fg-3)' }}> · {c.designation}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add new contacts */}
      <div>
        <label style={LABEL}>Add New Contacts</label>
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {newContacts.map((c, i) => (
            <div key={i} style={{ background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  Contact {i + 1}
                </span>
                <button onClick={() => remove(i)} style={{ background: 'none', border: 'none', color: 'var(--fg-3)', fontSize: 18, cursor: 'pointer', padding: 0, lineHeight: 1 }}>×</button>
              </div>
              <input placeholder="Name *" value={c.name} onChange={e => update(i, 'name', e.target.value)} style={{ ...INPUT, marginBottom: 8 }} />
              <input placeholder="Designation" value={c.designation} onChange={e => update(i, 'designation', e.target.value)} style={{ ...INPUT, marginBottom: 8 }} />
              <input placeholder="Phone" value={c.phone} onChange={e => update(i, 'phone', e.target.value)} style={INPUT} type="tel" />
            </div>
          ))}
        </div>
        <button onClick={addRow} style={{
          marginTop: 12, width: '100%', padding: '12px',
          background: 'var(--bg-elev)', border: '1px dashed var(--line-strong)',
          borderRadius: 10, fontSize: 13, color: 'var(--fg-2)', fontFamily: 'inherit', cursor: 'pointer',
        }}>
          + Add contact
        </button>
      </div>
    </div>
  );
}

// ── Step 3: RIL Equipment ──────────────────────────────────────

function Step3RilEquip({
  visitType, rilEquip, setRilEquip, appList, existing,
}: {
  visitType: string;
  rilEquip: Record<string, EquipEntry>;
  setRilEquip: (v: Record<string, EquipEntry>) => void;
  appList: string[];
  existing: ReportInitialData['existingEquipment'];
}) {
  const updateEntry = (app: string, field: keyof EquipEntry, val: string | number) => {
    setRilEquip({ ...rilEquip, [app]: { ...rilEquip[app], [field]: val } });
  };

  // Existing data for reference display
  const existingByStation: Record<string, typeof existing[0]> = {};
  for (const e of existing) if (e.station) existingByStation[e.station] = e;

  return (
    <div>
      <div style={{ fontSize: 13, color: 'var(--fg-2)', marginBottom: 16, lineHeight: 1.5 }}>
        Record RIL pump installations for this {visitType} visit. Leave qty at 0 if no RIL pump at an application.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {appList.map(app => {
          const e = rilEquip[app] ?? { application: app, qty: 0, model: '', condition: 'Good', notes: '' };
          const ref = existingByStation[app];
          return (
            <div key={app} style={{ background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg)' }}>{app}</span>
                {ref && (
                  <span style={{ fontSize: 10, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
                    Prev: {ref.model ?? '—'} ({ref.condition})
                  </span>
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr', gap: 8, marginBottom: 8 }}>
                <input
                  type="number" min="0" max="99"
                  value={e.qty || ''}
                  onChange={ev => updateEntry(app, 'qty', Number(ev.target.value))}
                  placeholder="Qty"
                  style={{ ...INPUT, height: 38, textAlign: 'center' }}
                />
                <input
                  value={e.model}
                  onChange={ev => updateEntry(app, 'model', ev.target.value)}
                  placeholder="Model / series"
                  style={{ ...INPUT, height: 38 }}
                />
              </div>
              {e.qty > 0 && (
                <>
                  <select value={e.condition} onChange={ev => updateEntry(app, 'condition', ev.target.value)} style={{ ...INPUT, height: 38, marginBottom: 8 }}>
                    {CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <input
                    value={e.notes}
                    onChange={ev => updateEntry(app, 'notes', ev.target.value)}
                    placeholder="Feedback / notes (optional)"
                    style={{ ...INPUT, height: 38 }}
                  />
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Step 4: Competitor Equipment ───────────────────────────────

function Step4CompEquip({
  compEquip, setCompEquip, existing,
}: {
  compEquip: CompEntry[];
  setCompEquip: (v: CompEntry[]) => void;
  existing: ReportInitialData['existingEquipment'];
}) {
  const addRow = () => setCompEquip([...compEquip, { supplier: '', application: '', model: '', qty: 1, condition: 'Good', notes: '' }]);
  const update = (i: number, field: keyof CompEntry, val: string | number) => {
    setCompEquip(compEquip.map((e, j) => j === i ? { ...e, [field]: val } : e));
  };
  const remove = (i: number) => setCompEquip(compEquip.filter((_, j) => j !== i));

  return (
    <div>
      <div style={{ fontSize: 13, color: 'var(--fg-2)', marginBottom: 16, lineHeight: 1.5 }}>
        Record any competitor pumps observed. Each entry creates a displacement opportunity record.
      </div>

      {existing.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={LABEL}>Previously Recorded</div>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {existing.slice(0, 5).map((e, i) => (
              <div key={i} style={{ padding: '8px 12px', background: 'var(--bg-elev)', borderRadius: 6, fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
                {e.supplier} · {e.station ?? '—'} · {e.model ?? '—'} · {e.condition}
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {compEquip.map((e, i) => (
          <div key={i} style={{ background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 10, padding: '12px 14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Competitor pump {i + 1}
              </span>
              <button onClick={() => remove(i)} style={{ background: 'none', border: 'none', color: 'var(--fg-3)', fontSize: 18, cursor: 'pointer', padding: 0 }}>×</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
              <input placeholder="Make / Brand *" value={e.supplier} onChange={ev => update(i, 'supplier', ev.target.value)} style={{ ...INPUT, height: 38 }} />
              <input placeholder="Application" value={e.application} onChange={ev => update(i, 'application', ev.target.value)} style={{ ...INPUT, height: 38 }} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px', gap: 8, marginBottom: 8 }}>
              <input placeholder="Model" value={e.model} onChange={ev => update(i, 'model', ev.target.value)} style={{ ...INPUT, height: 38 }} />
              <input type="number" min="1" max="99" placeholder="Qty" value={e.qty} onChange={ev => update(i, 'qty', Number(ev.target.value))} style={{ ...INPUT, height: 38, textAlign: 'center' }} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <select value={e.condition} onChange={ev => update(i, 'condition', ev.target.value)} style={{ ...INPUT, height: 38 }}>
                {COMP_CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <input placeholder="Notes" value={e.notes} onChange={ev => update(i, 'notes', ev.target.value)} style={{ ...INPUT, height: 38 }} />
            </div>
          </div>
        ))}
      </div>
      <button onClick={addRow} style={{
        marginTop: 12, width: '100%', padding: '12px',
        background: 'var(--bg-elev)', border: '1px dashed var(--line-strong)',
        borderRadius: 10, fontSize: 13, color: 'var(--fg-2)', fontFamily: 'inherit', cursor: 'pointer',
      }}>
        + Add competitor pump
      </button>
    </div>
  );
}

// ── Step 5: Commercial Discussion ─────────────────────────────

function Step5Commercial({
  commercial, setCommercial, outcome, setOutcome,
  summary, setSummary,
  opportunityProduct, setOpportunityProduct,
  opportunityValue, setOpportunityValue,
}: {
  commercial: CommercialState; setCommercial: (v: CommercialState) => void;
  outcome: string; setOutcome: (v: string) => void;
  summary: string; setSummary: (v: string) => void;
  opportunityProduct: string; setOpportunityProduct: (v: string) => void;
  opportunityValue: string; setOpportunityValue: (v: string) => void;
}) {
  const toggle = (key: string) => setCommercial({ ...commercial, [key]: !commercial[key] });
  const setDetail = (key: string, val: string) => setCommercial({ ...commercial, [`${key}Detail`]: val });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Yes/No matrix */}
      <div>
        <label style={LABEL}>Discussion Points</label>
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {COMMERCIAL_Qs.map(({ key, label }) => {
            const isYes = commercial[key] === true;
            return (
              <div key={key} style={{ background: 'var(--bg-paper)', border: `1px solid ${isYes ? 'var(--accent-line)' : 'var(--line)'}`, borderRadius: 10, overflow: 'hidden' }}>
                <button onClick={() => toggle(key)} style={{
                  display: 'flex', alignItems: 'center', gap: 12, width: '100%',
                  padding: '11px 14px', background: isYes ? 'var(--accent-soft)' : 'none',
                  border: 'none', cursor: 'pointer', textAlign: 'left',
                }}>
                  {/* Toggle pill */}
                  <div style={{
                    width: 36, height: 20, borderRadius: 10, flexShrink: 0,
                    background: isYes ? 'var(--accent)' : 'var(--bg-sunk)',
                    position: 'relative', transition: 'background 0.2s',
                  }}>
                    <div style={{
                      position: 'absolute', top: 2, left: isYes ? 18 : 2,
                      width: 16, height: 16, borderRadius: 8,
                      background: '#fff', transition: 'left 0.2s',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                    }} />
                  </div>
                  <span style={{ fontSize: 13, color: 'var(--fg)', flex: 1, lineHeight: 1.3 }}>{label}</span>
                </button>
                {isYes && (
                  <div style={{ padding: '0 14px 12px' }}>
                    <input
                      value={(commercial[`${key}Detail`] as string) ?? ''}
                      onChange={e => setDetail(key, e.target.value)}
                      placeholder="Add details…"
                      style={{ ...INPUT, height: 38 }}
                    />
                    {/* Expansion opportunity sub-form */}
                    {key === 'expansionPlans' && (
                      <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                        <input
                          value={opportunityProduct}
                          onChange={e => setOpportunityProduct(e.target.value)}
                          placeholder="Product / application"
                          style={{ ...INPUT, height: 38, flex: 2 }}
                        />
                        <input
                          type="number" min="0" step="0.5"
                          value={opportunityValue}
                          onChange={e => setOpportunityValue(e.target.value)}
                          placeholder="₹ Cr"
                          style={{ ...INPUT, height: 38, flex: 1 }}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Outcome */}
      <div>
        <label style={LABEL}>Overall Outcome</label>
        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          {OUTCOMES.map(o => (
            <button key={o} onClick={() => setOutcome(o)} style={{
              padding: '7px 12px', borderRadius: 20, fontSize: 12,
              fontFamily: 'inherit', cursor: 'pointer', fontWeight: outcome === o ? 500 : 400,
              background: outcome === o ? 'var(--accent)' : 'var(--bg-elev)',
              color: outcome === o ? '#fff' : 'var(--fg)',
              border: outcome === o ? '1px solid var(--accent)' : '1px solid var(--line)',
            }}>
              {o}
            </button>
          ))}
        </div>
      </div>

      {/* Summary */}
      <div>
        <label style={LABEL}>Visit Summary</label>
        <textarea
          value={summary}
          onChange={e => setSummary(e.target.value)}
          placeholder="Key takeaways, follow-up actions, next steps…"
          rows={4}
          style={{
            ...INPUT, height: 'auto', padding: '10px 12px', resize: 'vertical',
            marginTop: 8, lineHeight: 1.5,
          }}
        />
      </div>

    </div>
  );
}

// ── Style constants ────────────────────────────────────────────

const HEADER: CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '12px 16px',
  background: 'var(--bg-paper)', borderBottom: '1px solid var(--line)',
  position: 'sticky', top: 0, zIndex: 10,
};

const ICON_BTN: CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 32, height: 32, borderRadius: 8,
  background: 'var(--bg-elev)', border: '1px solid var(--line)',
  color: 'var(--fg)', cursor: 'pointer',
};

const LABEL: CSSProperties = {
  fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
  letterSpacing: '0.10em', color: 'var(--fg-3)',
};

const INPUT: CSSProperties = {
  width: '100%', height: 44, padding: '0 12px',
  fontSize: 14, fontFamily: 'inherit',
  background: 'var(--bg-paper)', border: '1px solid var(--line-strong)',
  borderRadius: 8, color: 'var(--fg)', outline: 'none',
  boxSizing: 'border-box', display: 'block',
};
