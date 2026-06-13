'use client';

import { useState, useEffect, useTransition, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { addClient, updateClient } from '@/app/actions/risansi';
import { OwnerSelector } from './RepSelector';

// ── Types ──────────────────────────────────────────────────────

type ContactRow = {
  id?: number;          // exists for saved contacts
  name: string;
  designation: string;
  phone: string;
  email: string;
  whatsapp: string;
  is_primary: boolean;
  isNew?: boolean;      // true for unsaved rows
};

interface Props {
  mode: 'create' | 'edit';
  client?: any;                 // pre-filled data (edit mode only)
  existingContacts?: any[];     // live (non-imported) contacts for edit mode
  onClose: () => void;
}

// ── Option lists ───────────────────────────────────────────────

const CLIENT_TYPES      = ['End User', 'OEM', 'Trader', 'Group (Mills)', 'Merchant Exporter'];
const MARKET_TYPES      = ['Domestic', 'Export'];
const CAPACITY_BRACKETS = ['0-5000', '5001-9000', '9001 & above'];
const STATUS_OPTIONS    = ['ACTIVE', 'INACTIVE', 'PROSPECTIVE', 'CLOSED', 'DUPLICATE'];
const TIER_OPTIONS      = ['Key', 'Standard', 'OEM/Trader'];
const SUGAR_INDUSTRIES  = ['Sugar', 'Distillery', 'Jaggery', 'Sugar + Distillery', 'Sugar & Distillery'];
const MAX_CONTACTS      = 10;

// Make sure a pre-existing DB value still shows in a fixed-option select
function withCurrent(opts: string[], current: unknown): string[] {
  const v = typeof current === 'string' ? current.trim() : '';
  return v && !opts.includes(v) ? [v, ...opts] : opts;
}

// ── Component ──────────────────────────────────────────────────

export function ClientFormDrawer({ mode, client, existingContacts, onClose }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [visible, setVisible] = useState(false);
  const [error, setError]     = useState('');

  const [industries, setIndustries] = useState<string[]>([]);
  const [industry, setIndustry]     = useState<string>(client?.industry ?? '');
  const [isSugar, setIsSugar]       = useState<boolean>(Boolean(client?.is_sugar));
  const [mapsUrl, setMapsUrl]       = useState<string>(client?.google_maps_url ?? '');

  // Tours (dropdown bound to tour_routes) + current owners (multi-owner picker)
  const [tours, setTours]   = useState<Array<{ id: string; name: string; zone: string | null }>>([]);
  const [tourId, setTourId] = useState<string>(client?.tour_id != null ? String(client.tour_id) : '');
  const [ownerIds, setOwnerIds] = useState<number[]>([]);

  const [contacts, setContacts] = useState<ContactRow[]>(
    (existingContacts ?? []).map((c: any) => ({
      id:          c.id,
      name:        c.name ?? '',
      designation: c.designation ?? '',
      phone:       c.phone ?? '',
      email:       c.email ?? '',
      whatsapp:    c.whatsapp ?? '',
      is_primary:  Boolean(c.is_primary),
      isNew:       false,
    })),
  );
  const [deletedContactIds, setDeletedContactIds] = useState<number[]>([]);

  // Slide-in on mount (component is rendered only while open)
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 10);
    return () => clearTimeout(t);
  }, []);

  // Fetch industry options
  useEffect(() => {
    fetch('/api/risansi/industries')
      .then(r => r.json())
      .then(d => setIndustries(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, []);

  // Fetch tour routes for the dropdown
  useEffect(() => {
    fetch('/api/risansi/tours')
      .then(r => r.json())
      .then(d => setTours(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, []);

  // On edit, prefill the current owners from client_assignments
  useEffect(() => {
    if (mode !== 'edit' || !client?.id) return;
    fetch(`/api/risansi/client-owners?clientId=${client.id}`)
      .then(r => r.json())
      .then(d => setOwnerIds(Array.isArray(d?.owner_ids) ? d.owner_ids : []))
      .catch(() => {});
  }, [mode, client?.id]);

  function handleIndustryChange(val: string) {
    setIndustry(val);
    setIsSugar(SUGAR_INDUSTRIES.some(s => val.toUpperCase().includes(s.toUpperCase())));
  }

  function close() {
    setVisible(false);
    setTimeout(onClose, 240);
  }

  // ── Contact row helpers ──────────────────────────────────────

  function addContactRow() {
    setContacts(cs => cs.length >= MAX_CONTACTS ? cs : [
      ...cs,
      { name: '', designation: '', phone: '', email: '', whatsapp: '', is_primary: false, isNew: true },
    ]);
  }

  function removeContactRow(idx: number) {
    setContacts(cs => {
      const row = cs[idx];
      if (row?.id && !row.isNew) setDeletedContactIds(ids => [...ids, row.id!]);
      return cs.filter((_, i) => i !== idx);
    });
  }

  function patchContact(idx: number, patch: Partial<ContactRow>) {
    setContacts(cs => cs.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  }

  // Only one contact may be primary at a time
  function setPrimary(idx: number, checked: boolean) {
    setContacts(cs => cs.map((c, i) => ({ ...c, is_primary: i === idx ? checked : false })));
  }

  // ── Submit ───────────────────────────────────────────────────

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    const fd = new FormData(e.currentTarget);
    fd.set('contacts_json', JSON.stringify(contacts));
    fd.set('deleted_contact_ids', JSON.stringify(deletedContactIds));
    fd.set('is_sugar', String(isSugar));

    startTransition(async () => {
      try {
        if (mode === 'create') {
          await addClient(fd);
        } else {
          await updateClient(Number(client.id), fd);
        }
        router.refresh();
        close();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save client');
      }
    });
  }

  const isDistillery   = industry.toUpperCase().includes('DISTILLERY');
  const industryOpts   = withCurrent(industries, client?.industry);
  const clientTypeOpts = withCurrent(CLIENT_TYPES, client?.client_type);
  const capacityOpts   = withCurrent(CAPACITY_BRACKETS, client?.capacity_bracket);
  const statusOpts     = withCurrent(STATUS_OPTIONS, client?.status);
  const tierOpts       = withCurrent(TIER_OPTIONS, client?.tier);

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={close}
        style={{
          position: 'fixed', inset: 0, zIndex: 40,
          background: 'rgba(10,22,40,0.35)',
          opacity: visible ? 1 : 0, transition: 'opacity 0.24s ease',
        }}
      />

      {/* Slide-in drawer — 560px */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 560, maxWidth: '100vw', zIndex: 50,
        background: '#fff',
        boxShadow: '-8px 0 40px rgba(10,22,40,0.14)',
        display: 'flex', flexDirection: 'column',
        transform: visible ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.26s cubic-bezier(0.32,0,0.67,0)',
      }}>

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', borderBottom: '1px solid #DDE6F5', flexShrink: 0,
        }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#0A3D8F', letterSpacing: '-0.01em' }}>
            {mode === 'create' ? 'New Client' : 'Edit Client'}
            {mode === 'edit' && (
              <span style={{ fontFamily: 'monospace', fontWeight: 400, color: '#6B7FA3', marginLeft: 8, fontSize: 13 }}>
                · {client?.code}
              </span>
            )}
          </div>
          <button type="button" onClick={close} style={CLOSE_BTN}>✕</button>
        </div>

        {/* Scrollable form */}
        <form
          onSubmit={handleSubmit}
          style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 20 }}
        >

          {/* ── 1. Identity ── */}
          <Section label="Identity">
            <Field label="Client Code" required>
              {mode === 'create' ? (
                <>
                  <input
                    type="text" name="code" required maxLength={20}
                    placeholder="e.g. PUNE01A162" style={INP}
                    onChange={e => (e.currentTarget.value = e.currentTarget.value.toUpperCase())}
                  />
                  <div style={HINT}>e.g. PUNE01A162</div>
                </>
              ) : (
                <>
                  <div style={{
                    padding: '9px 12px',
                    background: 'var(--bg-sunk)',
                    border: '1px solid var(--line)',
                    borderRadius: 6, fontSize: 13,
                    color: 'var(--fg-2)',
                    fontFamily: 'var(--font-mono)',
                  }}>
                    {client?.code}
                  </div>
                  <input type="hidden" name="code" value={client?.code ?? ''} />
                </>
              )}
            </Field>
            <Field label="Legal Name" required>
              <input type="text" name="legal_name" required maxLength={200}
                defaultValue={client?.legal_name ?? ''} placeholder="Full legal entity name" style={INP} />
            </Field>
            <Row>
              <Field label="Trade Name">
                <input type="text" name="trade_name" maxLength={200}
                  defaultValue={client?.trade_name ?? ''} style={INP} />
              </Field>
              <Field label="Group Name">
                <input type="text" name="group_name" maxLength={200}
                  defaultValue={client?.group_name ?? ''} style={INP} />
              </Field>
            </Row>
          </Section>

          {/* ── 2. Classification ── */}
          <Section label="Classification">
            <Row>
              <Field label="Industry" required>
                <select name="industry" required style={INP}
                  value={industry} onChange={e => handleIndustryChange(e.target.value)}>
                  <option value="">Select industry…</option>
                  {industryOpts.map(ind => <option key={ind} value={ind}>{ind}</option>)}
                </select>
              </Field>
              <Field label="Client Type" required>
                <select name="client_type" required style={INP} defaultValue={client?.client_type ?? ''}>
                  <option value="">Select type…</option>
                  {clientTypeOpts.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
            </Row>
            <Row>
              <Field label="Market Type">
                <select name="market_type" style={INP} defaultValue={client?.market_type ?? 'Domestic'}>
                  {MARKET_TYPES.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </Field>
              <Field label="Sugar / Non-Sugar">
                <div style={{ display: 'flex', gap: 6 }}>
                  <Pill active={isSugar} onClick={() => setIsSugar(true)}>Sugar</Pill>
                  <Pill active={!isSugar} onClick={() => setIsSugar(false)}>Non-Sugar</Pill>
                </div>
              </Field>
            </Row>
            <label style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer' }}>
              <input type="checkbox" name="is_tender" value="true"
                defaultChecked={Boolean(client?.is_tender)}
                style={{ width: 15, height: 15, accentColor: '#1A5CB8', cursor: 'pointer' }} />
              <span style={{ fontSize: 13, color: '#2C3E5A' }}>Tender account</span>
            </label>
            <Field label="Capacity Bracket">
              <select name="capacity_bracket" style={INP} defaultValue={client?.capacity_bracket ?? ''}>
                <option value="">—</option>
                {capacityOpts.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </Field>
            {isSugar && (
              <Field label="TCD (Tonnes Cane/Day)">
                <input type="number" name="tcd" min={0} step={1}
                  defaultValue={client?.tcd ?? ''} placeholder="e.g. 2500" style={INP} />
              </Field>
            )}
            {isDistillery && (
              <Field label="KLPD">
                <input type="number" name="klpd" min={0} step={1}
                  defaultValue={client?.klpd ?? ''} placeholder="e.g. 60" style={INP} />
              </Field>
            )}
          </Section>

          {/* ── 3. Location ── */}
          <Section label="Location">
            <Row>
              <Field label="Country">
                <input type="text" name="country" maxLength={100}
                  defaultValue={client?.country ?? 'India'} style={INP} />
              </Field>
              <Field label="State">
                <input type="text" name="state" maxLength={100}
                  defaultValue={client?.state ?? ''} style={INP} />
              </Field>
            </Row>
            <Field label="City">
              <input type="text" name="city" maxLength={100}
                defaultValue={client?.city ?? ''} style={INP} />
            </Field>
            <Field label="Address">
              <textarea name="address" rows={3} maxLength={400}
                defaultValue={client?.address ?? ''}
                style={{ ...INP, height: 'auto', resize: 'vertical' as const, lineHeight: 1.5 }} />
            </Field>
            <Field label="Google Maps URL">
              <input type="text" name="google_maps_url" maxLength={500}
                value={mapsUrl} onChange={e => setMapsUrl(e.target.value)}
                placeholder="https://maps.google.com/…" style={INP} />
              {/^https?:/i.test(mapsUrl.trim()) && (
                <a href={mapsUrl.trim()} target="_blank" rel="noreferrer"
                  style={{ ...HINT, color: 'var(--accent, #1A5CB8)', display: 'inline-flex', gap: 4, textDecoration: 'none' }}>
                  📍 Preview
                </a>
              )}
            </Field>
          </Section>

          {/* ── 4. Territory ── */}
          <Section label="Territory">
            <Row>
              <Field label="Status">
                <select name="status" style={INP} defaultValue={client?.status ?? 'ACTIVE'}>
                  {statusOpts.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="Tier">
                <select name="tier" style={INP} defaultValue={client?.tier ?? 'Standard'}>
                  {tierOpts.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
            </Row>
            <Row>
              <Field label="Tour">
                <select name="tour_id" style={INP}
                  value={tourId} onChange={e => setTourId(e.target.value)}>
                  <option value="">— No tour —</option>
                  {tours.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.name}{t.zone ? ` · ${t.zone}` : ''}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Since Year">
                <input type="text" name="since_year" maxLength={10}
                  defaultValue={client?.since_year != null ? String(client.since_year) : ''}
                  placeholder='e.g. 2019 or 21-22' style={INP} />
              </Field>
            </Row>
            <OwnerSelector
              label="Owners"
              paramName="owner_ids"
              defaultIds={ownerIds}
            />
          </Section>

          {/* ── 5. Contacts ── */}
          <Section label="Contacts" count={contacts.length}>
            {contacts.length === 0 && (
              <div style={{ fontSize: 12, color: '#94A3B8', fontStyle: 'italic' }}>
                No contacts yet — add up to {MAX_CONTACTS}.
              </div>
            )}
            {contacts.map((c, i) => (
              <div key={i} style={{
                display: 'grid',
                gridTemplateColumns: '1.5fr 1fr 1fr 1fr auto',
                gap: 6, alignItems: 'center',
                padding: '6px 0',
                borderBottom: '1px solid var(--line-2, #EEF2F8)',
              }}>
                <input placeholder="Name *" value={c.name}
                  onChange={e => patchContact(i, { name: e.target.value })} style={SMALL_INP} />
                <input placeholder="Designation" value={c.designation}
                  onChange={e => patchContact(i, { designation: e.target.value })} style={SMALL_INP} />
                <input placeholder="Phone" value={c.phone}
                  onChange={e => patchContact(i, { phone: e.target.value })} style={SMALL_INP} />
                <input placeholder="Email" value={c.email}
                  onChange={e => patchContact(i, { email: e.target.value })} style={SMALL_INP} />
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <input type="checkbox" title="Set as primary" checked={c.is_primary}
                    onChange={e => setPrimary(i, e.target.checked)}
                    style={{ width: 14, height: 14, accentColor: '#1A5CB8', cursor: 'pointer' }} />
                  <button type="button" title="Remove" onClick={() => removeContactRow(i)} style={CONTACT_DEL}>×</button>
                </div>
              </div>
            ))}
            <button type="button" onClick={addContactRow} disabled={contacts.length >= MAX_CONTACTS}
              style={{ ...ADD_CONTACT_BTN, opacity: contacts.length >= MAX_CONTACTS ? 0.5 : 1 }}>
              + Add Contact
            </button>
          </Section>

          {error && (
            <div style={{
              padding: '9px 12px', background: '#FEE2E2',
              border: '1px solid rgba(220,38,38,0.20)', borderRadius: 5,
              fontSize: 12, color: '#9B1C1C',
            }}>
              {error}
            </div>
          )}

          <button type="submit" disabled={isPending}
            style={{ ...SUBMIT_BTN, opacity: isPending ? 0.55 : 1, cursor: isPending ? 'not-allowed' : 'pointer' }}>
            {isPending ? 'Saving…' : mode === 'create' ? 'Create Client' : 'Save Changes'}
          </button>
        </form>
      </div>
    </>
  );
}

// ── Entry-point trigger for the Client Master page ─────────────

export function AddClientButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} style={PRIMARY_BTN}>
        + Add Client
      </button>
      {open && <ClientFormDrawer mode="create" onClose={() => setOpen(false)} />}
    </>
  );
}

// ── Sub-components ─────────────────────────────────────────────

function Section({ label, count, children }: { label: string; count?: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button type="button" onClick={() => setOpen(o => !o)} style={SECTION_HEADER}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {label}
          {count != null && count > 0 && <span style={COUNT_BADGE}>{count}</span>}
        </span>
        <span style={{ fontSize: 11, color: '#6B7FA3' }}>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
          {children}
        </div>
      )}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>{children}</div>;
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label style={LBL}>
        {label}
        {required && <span style={{ color: '#E02424', marginLeft: 2 }}>*</span>}
      </label>
      {children}
    </div>
  );
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} style={{
      flex: 1, padding: '8px 10px', fontSize: 13, fontFamily: 'inherit',
      fontWeight: active ? 600 : 500, cursor: 'pointer', borderRadius: 6,
      background: active ? '#0A3D8F' : '#F8FAFC',
      color:      active ? '#fff' : '#2C3E5A',
      border: `1px solid ${active ? '#0A3D8F' : '#CBD5E1'}`,
    }}>
      {children}
    </button>
  );
}

// ── Styles ─────────────────────────────────────────────────────

const PRIMARY_BTN: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '7px 14px', fontSize: 13, fontFamily: 'inherit',
  fontWeight: 600, background: '#0A3D8F', color: '#fff',
  border: 'none', borderRadius: 6, cursor: 'pointer',
  letterSpacing: '-0.005em', flexShrink: 0,
};

const CLOSE_BTN: CSSProperties = {
  width: 28, height: 28, display: 'grid', placeItems: 'center',
  background: 'transparent', border: 'none', cursor: 'pointer',
  fontSize: 16, color: '#6B7FA3', borderRadius: 4,
};

const SECTION_HEADER: CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  width: '100%', padding: '0 0 6px', cursor: 'pointer',
  background: 'transparent', border: 'none', borderBottom: '1px solid #DDE6F5',
  fontSize: 10, fontWeight: 700, color: '#0A3D8F',
  textTransform: 'uppercase', letterSpacing: '0.10em',
  fontFamily: 'inherit',
};

const COUNT_BADGE: CSSProperties = {
  background: '#EFF6FF', color: '#1D4ED8', borderRadius: 10,
  padding: '0 7px', fontSize: 11, fontWeight: 700, letterSpacing: 0,
};

const LBL: CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 700, color: '#2C3E5A',
  textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 5,
};

const HINT: CSSProperties = {
  fontSize: 11, color: '#6B7FA3', marginTop: 4,
};

const INP: CSSProperties = {
  display: 'block', width: '100%', padding: '8px 10px',
  fontSize: 13, fontFamily: 'inherit',
  background: '#F8FAFC', border: '1px solid #CBD5E1',
  borderRadius: 6, color: '#0D1B2A', outline: 'none',
  boxSizing: 'border-box',
};

const SMALL_INP: CSSProperties = {
  display: 'block', width: '100%', padding: '6px 8px',
  fontSize: 12, fontFamily: 'inherit',
  background: '#F8FAFC', border: '1px solid #CBD5E1',
  borderRadius: 5, color: '#0D1B2A', outline: 'none',
  boxSizing: 'border-box', minWidth: 0,
};

const CONTACT_DEL: CSSProperties = {
  width: 22, height: 22, display: 'grid', placeItems: 'center',
  background: 'transparent', border: '1px solid #E2E8F0',
  color: '#94A3B8', borderRadius: 5, cursor: 'pointer', fontSize: 14,
};

const ADD_CONTACT_BTN: CSSProperties = {
  alignSelf: 'flex-start', padding: '6px 12px', fontSize: 12,
  fontFamily: 'inherit', fontWeight: 500, cursor: 'pointer',
  background: '#EFF6FF', color: '#1D4ED8',
  border: '1px solid #BFDBFE', borderRadius: 6,
};

const SUBMIT_BTN: CSSProperties = {
  width: '100%', padding: '12px 0',
  fontSize: 14, fontFamily: 'inherit', fontWeight: 600,
  background: '#0A3D8F', color: '#fff',
  border: 'none', borderRadius: 6,
  letterSpacing: '-0.005em', marginTop: 4,
};
