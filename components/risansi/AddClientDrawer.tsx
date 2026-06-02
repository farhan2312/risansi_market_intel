'use client';

import { useState, useEffect, useTransition, type CSSProperties } from 'react';
import { addClient } from '@/app/actions/risansi';
import { RepSelector } from './RepSelector';

const CLIENT_TYPES = ['Sugar Mill', 'Distillery', 'OEM', 'Dealer', 'End User', 'EPC', 'Other'];
const ZONES        = ['North', 'South', 'East', 'West', 'Central', 'Export'];
const TIERS        = ['A', 'B', 'C', 'D'];
const MARKET_TYPES = ['Domestic', 'Export'];
const BIZ_CATS     = ['New Business', 'Existing Business', 'Reactivation'];

// ── Main drawer ────────────────────────────────────────────────

export function AddClientDrawer() {
  const [open, setOpen]              = useState(false);
  const [formKey, setFormKey]        = useState(0);
  const [isPending, startTransition] = useTransition();

  // Data from APIs
  const [industries, setIndustries] = useState<string[]>([]);

  // Form-level feedback
  const [error, setError]    = useState('');
  const [success, setSuccess] = useState(false);

  // Conditional field state
  const [selectedIndustry, setSelectedIndustry] = useState('');
  const [isSugar, setIsSugar]                   = useState(false);

  // ── Fetch lookup data on mount ─────────────────────────────

  useEffect(() => {
    fetch('/api/risansi/industries').then(r => r.json()).then(setIndustries).catch(() => {});
  }, []);

  // ── Open / Close helpers ───────────────────────────────────

  function openFresh() {
    setError('');
    setSuccess(false);
    setSelectedIndustry('');
    setIsSugar(false);
    setFormKey(k => k + 1);
    setOpen(true);
  }

  function close() { setOpen(false); }

  // ── Submit ─────────────────────────────────────────────────

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      try {
        const result = await addClient(fd);
        if (result.error) {
          setError(result.error);
        } else {
          setSuccess(true);
          setTimeout(() => { setOpen(false); setSuccess(false); }, 2000);
        }
      } catch {
        setError('Failed to create client — please try again.');
      }
    });
  }

  // ── Render ─────────────────────────────────────────────────

  return (
    <>
      {/* Trigger button — same style as AssignVisitDrawer */}
      <button type="button" onClick={openFresh} style={PRIMARY_BTN}>
        + Add Client
      </button>

      {/* Backdrop */}
      {open && (
        <div
          onClick={close}
          style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(10,22,40,0.35)' }}
        />
      )}

      {/* Slide-in drawer */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 520, zIndex: 50,
        background: '#fff',
        boxShadow: '-8px 0 40px rgba(10,22,40,0.14)',
        display: 'flex', flexDirection: 'column',
        transform: open ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.26s cubic-bezier(0.32,0,0.67,0)',
      }}>

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', borderBottom: '1px solid #DDE6F5', flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#0A3D8F', letterSpacing: '-0.01em' }}>
              Add Client
            </div>
            <div style={{ fontSize: 11, color: '#6B7FA3', marginTop: 2 }}>
              Create a new client record in the master
            </div>
          </div>
          <button type="button" onClick={close} style={CLOSE_BTN}>✕</button>
        </div>

        {/* Form */}
        <form
          key={formKey}
          onSubmit={handleSubmit}
          style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 20 }}
        >

          {/* ── Section: Basic Info ── */}
          <Section label="Basic Info">
            <Row>
              <Field label="Client Code" required hint="Pattern: ABCD01E002">
                <input
                  type="text"
                  name="code"
                  required
                  maxLength={10}
                  pattern="[A-Za-z]{4}[0-9]{2}[A-Za-z][0-9]{3}"
                  placeholder="ABCD01E002"
                  style={INP}
                  onChange={e => e.currentTarget.value = e.currentTarget.value.toUpperCase()}
                />
              </Field>
              <Field label="Legal Name" required>
                <input type="text" name="legal_name" required minLength={3} maxLength={200} placeholder="Full legal entity name" style={INP} />
              </Field>
            </Row>
          </Section>

          {/* ── Section: Classification ── */}
          <Section label="Classification">
            <Row>
              <Field label="Industry" required>
                <select
                  name="industry"
                  required
                  style={INP}
                  value={selectedIndustry}
                  onChange={e => setSelectedIndustry(e.target.value)}
                >
                  <option value="">Select industry…</option>
                  {industries.length > 0
                    ? industries.map(ind => <option key={ind} value={ind}>{ind}</option>)
                    : CLIENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)
                  }
                </select>
              </Field>
              <Field label="Client Type" required>
                <select name="client_type" required style={INP}>
                  <option value="">Select type…</option>
                  {CLIENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
            </Row>
            <Row>
              <Field label="Tier">
                <select name="tier" style={INP}>
                  <option value="">—</option>
                  {TIERS.map(t => <option key={t} value={t}>Tier {t}</option>)}
                </select>
              </Field>
              <Field label="Business Category">
                <select name="business_category" style={INP}>
                  <option value="">—</option>
                  {BIZ_CATS.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </Field>
            </Row>

            {/* Sugar-specific */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer', marginTop: 4 }}>
              <input
                type="checkbox"
                name="is_sugar"
                value="true"
                checked={isSugar}
                onChange={e => setIsSugar(e.target.checked)}
                style={{ width: 14, height: 14, accentColor: '#1A5CB8', cursor: 'pointer' }}
              />
              <span style={{ fontSize: 13, color: '#2C3E5A' }}>Sugar mill / cane processing</span>
            </label>

            {isSugar && (
              <Field label="TCD (Tonnes Cane / Day)" hint="Only for sugar mills">
                <input type="number" name="tcd_klpd" min={0} step={0.1} placeholder="e.g. 2500" style={INP} />
              </Field>
            )}

            {selectedIndustry === 'Distillery' && (
              <Field label="KLPD Capacity" hint="Only for distilleries">
                <input type="number" name="klpd" min={0} step={0.1} placeholder="e.g. 60" style={INP} />
              </Field>
            )}
          </Section>

          {/* ── Section: Location ── */}
          <Section label="Location">
            <Row>
              <Field label="City">
                <input type="text" name="city" maxLength={100} placeholder="City" style={INP} />
              </Field>
              <Field label="State">
                <input type="text" name="state" maxLength={100} placeholder="State" style={INP} />
              </Field>
            </Row>
            <Row>
              <Field label="Pincode">
                <input type="text" name="pincode" maxLength={10} placeholder="110001" style={INP} />
              </Field>
              <Field label="Market Type">
                <select name="market_type" style={INP}>
                  <option value="">—</option>
                  {MARKET_TYPES.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </Field>
            </Row>
            <Field label="Address">
              <textarea name="address" maxLength={400} rows={2} placeholder="Street address…" style={{ ...INP, height: 'auto', resize: 'vertical' as const, lineHeight: 1.5 }} />
            </Field>
            <Field label="Google Maps URL">
              <input type="url" name="google_maps_url" maxLength={500} placeholder="https://maps.google.com/…" style={INP} />
            </Field>
          </Section>

          {/* ── Section: Contact Details ── */}
          <Section label="Contact Details">
            <Row>
              <Field label="Phone">
                <input type="tel" name="phone" maxLength={20} placeholder="+91 99999 99999" style={INP} />
              </Field>
              <Field label="Email">
                <input type="email" name="email" maxLength={200} placeholder="contact@company.com" style={INP} />
              </Field>
            </Row>
            <Field label="Website">
              <input type="url" name="website" maxLength={200} placeholder="https://…" style={INP} />
            </Field>
            <Field label="GSTIN">
              <input type="text" name="gstin" maxLength={15} placeholder="22AAAAA0000A1Z5" style={INP} />
            </Field>
          </Section>

          {/* ── Section: Territory ── */}
          <Section label="Territory">
            <Row>
              <Field label="Zone">
                <select name="zone" style={INP}>
                  <option value="">—</option>
                  {ZONES.map(z => <option key={z} value={z}>{z}</option>)}
                </select>
              </Field>
              <Field label="Route">
                <input type="text" name="route" maxLength={100} placeholder="Route / territory code" style={INP} />
              </Field>
            </Row>
            <RepSelector
              label="Assigned Rep"
              paramName="rep_id"
              nameName="rep_name"
            />
          </Section>

          {/* ── Section: Status ── */}
          <Section label="Status">
            <Field label="Account Status">
              <select name="status" defaultValue="ACTIVE" style={INP}>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
                <option value="PROSPECT">Prospect</option>
                <option value="BLACKLISTED">Blacklisted</option>
              </select>
            </Field>
          </Section>

          {/* Error */}
          {error && (
            <div style={{ padding: '9px 12px', background: '#FEE2E2', border: '1px solid rgba(220,38,38,0.20)', borderRadius: 5, fontSize: 12, color: '#9B1C1C' }}>
              {error}
            </div>
          )}

          {/* Success */}
          {success && (
            <div style={{ padding: '12px 16px', background: '#D1FAE5', border: '1px solid #6EE7B7', borderRadius: 6, fontSize: 13, color: '#065F46', textAlign: 'center', fontWeight: 600 }}>
              ✓ Client created successfully!
            </div>
          )}

          {/* Submit */}
          {!success && (
            <button
              type="submit"
              disabled={isPending}
              style={{ ...SUBMIT_BTN, opacity: isPending ? 0.55 : 1, cursor: isPending ? 'not-allowed' : 'pointer' }}
            >
              {isPending ? 'Creating…' : 'Create Client'}
            </button>
          )}
        </form>
      </div>
    </>
  );
}

// ── Sub-components ─────────────────────────────────────────────

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#0A3D8F', textTransform: 'uppercase', letterSpacing: '0.10em', marginBottom: 12, paddingBottom: 6, borderBottom: '1px solid #DDE6F5' }}>
        {label}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {children}
      </div>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      {children}
    </div>
  );
}

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={LBL}>
        {label}
        {required && <span style={{ color: '#E02424', marginLeft: 2 }}>*</span>}
        {hint && <span style={{ color: '#6B7FA3', fontWeight: 400, textTransform: 'none', letterSpacing: 0, marginLeft: 6 }}>({hint})</span>}
      </label>
      {children}
    </div>
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

const LBL: CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 700, color: '#2C3E5A',
  textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 5,
};

const INP: CSSProperties = {
  display: 'block', width: '100%', padding: '8px 10px',
  fontSize: 13, fontFamily: 'inherit',
  background: '#F8FAFC', border: '1px solid #CBD5E1',
  borderRadius: 6, color: '#0D1B2A', outline: 'none',
  boxSizing: 'border-box',
};

const SUBMIT_BTN: CSSProperties = {
  width: '100%', padding: '12px 0',
  fontSize: 14, fontFamily: 'inherit', fontWeight: 600,
  background: '#0A3D8F', color: '#fff',
  border: 'none', borderRadius: 6,
  letterSpacing: '-0.005em', marginTop: 4,
};
