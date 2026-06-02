'use client';

import { useState, useEffect, useTransition, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { updateClient } from '@/app/actions/risansi';
import { RepSelector } from './RepSelector';
import { Toast } from './Toast';

// ── Client shape needed by this drawer ─────────────────────────

export interface ClientForEdit {
  id:                   string;
  code:                 string;
  legal_name:           string;
  trade_name?:          string | null;
  group_name?:          string | null;
  industry?:            string | null;
  client_type?:         string | null;
  market_type?:         string | null;
  is_sugar?:            boolean | null;
  country?:             string | null;
  state?:               string | null;
  city?:                string | null;
  address?:             string | null;
  google_maps_url?:     string | null;
  capacity_bracket?:    string | null;
  tcd?:                 number | null;
  klpd?:                number | null;
  primary_rep_id?:      string | number | null;
  primary_rep_name?:    string | null;
  secondary_rep_id?:    string | number | null;
  secondary_rep_name?:  string | null;
  tour_name?:           string | null;
  since_year?:          string | number | null;
  status?:              string | null;
  tier?:                string | null;
  performance_feedback?: string | null;
  action_points?:       string | null;
  pcp_competitor?:      string | null;
  mgmt_intervention?:   string | boolean | null;
  constraints_notes?:   string | null;
  action_target_date_raw: string | null;
  mgmt_intervention2:     string | null;
  total_outstanding:      number | null;
  expected_to_spare:      number | null;
  expected_to_pump:       number | null;
  weightage_score:        number | null;
  competitors_observed:   string | null;
  open_remarks:           string | null;
  major_remarks:          string | null;
  ice_dispersal_by:       string | null;
  negotiation_by:         string | null;
}

// ── Props ──────────────────────────────────────────────────────

interface Props {
  client:  ClientForEdit;
  open:    boolean;
  onClose: () => void;
}

// ── Constants ──────────────────────────────────────────────────

const CLIENT_TYPES      = ['Sugar Mill', 'Distillery', 'OEM', 'Dealer', 'End User', 'EPC', 'Other'];
const MARKET_TYPES      = ['Domestic', 'Export'];
const CAPACITY_BRACKETS = ['< 1000 TCD', '1000–2500 TCD', '2500–5000 TCD', '> 5000 TCD'];
const STATUS_OPTIONS    = ['ACTIVE', 'INACTIVE', 'PROSPECTIVE', 'CLOSED'];
const TIER_OPTIONS      = ['Key', 'Standard', 'OEM/Trader'];
const FEEDBACK_OPTIONS  = ['Good', 'Average', 'Poor'];
const INTERVENTION_OPTS = ['YES', 'NO', 'NIL'];

// ── Component ──────────────────────────────────────────────────

export function EditClientDrawer({ client, open, onClose }: Props) {
  const router                         = useRouter();
  const [isPending, startTransition]   = useTransition();
  const [error, setError]              = useState('');
  const [success, setSuccess]          = useState(false);
  const [toast, setToast]              = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [industries, setIndustries]    = useState<string[]>([]);
  const [isSugar, setIsSugar]          = useState<boolean>(Boolean(client.is_sugar));
  const [selIndustry, setSelIndustry]  = useState(client.industry ?? '');

  useEffect(() => {
    fetch('/api/risansi/industries')
      .then(r => r.json())
      .then(setIndustries)
      .catch(() => {});
  }, []);

  // Reset form state when drawer opens with (potentially different) client
  useEffect(() => {
    if (open) {
      setIsSugar(Boolean(client.is_sugar));
      setSelIndustry(client.industry ?? '');
      setError('');
      setSuccess(false);
    }
  }, [open, client.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function close() {
    onClose();
    setError('');
    setSuccess(false);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    const fd = new FormData(e.currentTarget);
    fd.set('is_sugar', isSugar ? 'true' : 'false');

    startTransition(async () => {
      try {
        await updateClient(parseInt(client.id), fd);
        setSuccess(true);
        setToast({ message: 'Client updated', type: 'success' });
        router.refresh();
        setTimeout(() => { close(); setSuccess(false); }, 1800);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to update client';
        setError(msg);
        setToast({ message: msg, type: 'error' });
      }
    });
  }

  // Normalise mgmt_intervention to string for select default
  const mgmtVal =
    client.mgmt_intervention === true  ? 'YES' :
    client.mgmt_intervention === false ? 'NO'  :
    typeof client.mgmt_intervention === 'string' ? client.mgmt_intervention : '';

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          onClick={close}
          style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(10,22,40,0.35)' }}
        />
      )}

      {/* Slide-in drawer — 480px */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 480, zIndex: 50,
        background: '#fff',
        boxShadow: '-8px 0 40px rgba(10,22,40,0.14)',
        display: 'flex', flexDirection: 'column',
        transform: open ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.26s cubic-bezier(0.32,0,0.67,0)',
        pointerEvents: open ? 'auto' : 'none',
      }}>

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', borderBottom: '1px solid #DDE6F5', flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#0A3D8F', letterSpacing: '-0.01em' }}>
              Edit Client
              <span style={{ fontFamily: 'monospace', fontWeight: 400, color: '#6B7FA3', marginLeft: 8, fontSize: 13 }}>
                {client.code}
              </span>
            </div>
          </div>
          <button type="button" onClick={close} style={CLOSE_BTN}>✕</button>
        </div>

        {/* Scrollable form */}
        <form
          onSubmit={handleSubmit}
          style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 22 }}
        >

          {/* ── Identity ── */}
          <Section label="Identity">
            <Field label="Legal Name" required>
              <input
                type="text" name="legal_name" required
                defaultValue={client.legal_name} maxLength={200} style={INP}
              />
            </Field>
            <Row>
              <Field label="Trade Name">
                <input type="text" name="trade_name" defaultValue={client.trade_name ?? ''} maxLength={200} style={INP} />
              </Field>
              <Field label="Group Name">
                <input type="text" name="group_name" defaultValue={client.group_name ?? ''} maxLength={200} style={INP} />
              </Field>
            </Row>
          </Section>

          {/* ── Classification ── */}
          <Section label="Classification">
            <Row>
              <Field label="Industry" required>
                <select
                  name="industry"
                  required
                  style={INP}
                  value={selIndustry}
                  onChange={e => setSelIndustry(e.target.value)}
                >
                  <option value="">Select industry…</option>
                  {industries.length > 0
                    ? industries.map(ind => <option key={ind} value={ind}>{ind}</option>)
                    : client.industry
                    ? <option value={client.industry}>{client.industry}</option>
                    : null
                  }
                </select>
              </Field>
              <Field label="Client Type" required>
                <select name="client_type" required defaultValue={client.client_type ?? ''} style={INP}>
                  <option value="">Select type…</option>
                  {CLIENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
            </Row>
            <Row>
              <Field label="Market Type">
                <select name="market_type" defaultValue={client.market_type ?? 'Domestic'} style={INP}>
                  {MARKET_TYPES.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </Field>
              <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 2 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={isSugar}
                    onChange={e => setIsSugar(e.target.checked)}
                    style={{ width: 15, height: 15, accentColor: '#1A5CB8', cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: 13, color: '#2C3E5A' }}>Sugar / Cane</span>
                </label>
              </div>
            </Row>
          </Section>

          {/* ── Location ── */}
          <Section label="Location">
            <Row>
              <Field label="Country">
                <input type="text" name="country" defaultValue={client.country ?? 'India'} maxLength={100} style={INP} />
              </Field>
              <Field label="State">
                <input type="text" name="state" defaultValue={client.state ?? ''} maxLength={100} style={INP} />
              </Field>
            </Row>
            <Field label="City">
              <input type="text" name="city" defaultValue={client.city ?? ''} maxLength={100} style={INP} />
            </Field>
            <Field label="Address">
              <textarea
                name="address"
                defaultValue={client.address ?? ''}
                rows={2} maxLength={400}
                style={{ ...INP, height: 'auto', resize: 'vertical' as const, lineHeight: 1.5 }}
              />
            </Field>
            <Field label="Google Maps URL">
              <input
                type="url" name="google_maps_url"
                defaultValue={client.google_maps_url ?? ''}
                maxLength={500} placeholder="https://maps.google.com/…" style={INP}
              />
            </Field>
          </Section>

          {/* ── Plant Details ── */}
          <Section label="Plant Details">
            <Field label="Capacity Bracket">
              <select name="capacity_bracket" defaultValue={client.capacity_bracket ?? ''} style={INP}>
                <option value="">—</option>
                {CAPACITY_BRACKETS.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </Field>
            {isSugar && (
              <Field label="TCD (Tonnes Cane / Day)">
                <input
                  type="number" name="tcd"
                  defaultValue={client.tcd ?? ''}
                  min={0} step={1} placeholder="e.g. 2500" style={INP}
                />
              </Field>
            )}
            {selIndustry === 'Distillery' && (
              <Field label="KLPD Capacity">
                <input
                  type="number" name="klpd"
                  defaultValue={client.klpd ?? ''}
                  min={0} step={0.1} placeholder="e.g. 60" style={INP}
                />
              </Field>
            )}
          </Section>

          {/* ── Territory & Reps ── */}
          <Section label="Territory & Reps">
            <RepSelector
              label="Primary Rep"
              paramName="primary_rep_id"
              nameName="primary_rep_name"
              defaultId={client.primary_rep_id}
              defaultName={client.primary_rep_name}
            />
            <RepSelector
              label="Secondary Rep"
              paramName="secondary_rep_id"
              nameName="secondary_rep_name"
              defaultId={client.secondary_rep_id}
              defaultName={client.secondary_rep_name}
            />
            <Field label="Tour Name">
              <input type="text" name="tour_name" defaultValue={client.tour_name ?? ''} maxLength={100} style={INP} />
            </Field>
          </Section>

          {/* ── Commercial ── */}
          <Section label="Commercial">
            <Row>
              <Field label="Since Year">
                <input
                  type="text" name="since_year"
                  defaultValue={client.since_year != null ? String(client.since_year) : ''}
                  maxLength={10} placeholder="e.g. 2018" style={INP}
                />
              </Field>
              <Field label="Status">
                <select name="status" defaultValue={client.status ?? 'ACTIVE'} style={INP}>
                  {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
            </Row>
            <Field label="Tier">
              <select name="tier" defaultValue={client.tier ?? 'Standard'} style={INP}>
                {TIER_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
          </Section>

          {/* ── Intel ── */}
          <Section label="Intel">
            <Row>
              <Field label="Performance Feedback">
                <select name="performance_feedback" defaultValue={client.performance_feedback ?? ''} style={INP}>
                  <option value="">—</option>
                  {FEEDBACK_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </Field>
              <Field label="Mgmt Intervention">
                <select name="mgmt_intervention" defaultValue={mgmtVal} style={INP}>
                  <option value="">—</option>
                  {INTERVENTION_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </Field>
            </Row>
            <Field label="Action Points">
              <textarea
                name="action_points"
                defaultValue={client.action_points ?? ''}
                rows={3} maxLength={1000}
                style={{ ...INP, height: 'auto', resize: 'vertical' as const, lineHeight: 1.5 }}
              />
            </Field>
            <Field label="PCP Competitor">
              <input type="text" name="pcp_competitor" defaultValue={client.pcp_competitor ?? ''} maxLength={200} style={INP} />
            </Field>
            <Field label="Constraints">
              <textarea
                name="constraints_notes"
                defaultValue={client.constraints_notes ?? ''}
                rows={2} maxLength={500}
                style={{ ...INP, height: 'auto', resize: 'vertical' as const, lineHeight: 1.5 }}
              />
            </Field>
          </Section>

          {/* ── Field Intelligence (extended) ── */}
          <Section label="Field Intelligence">
            <Field label="Action Target Date">
              <input name="action_target_date_raw" defaultValue={client.action_target_date_raw ?? ''} style={INP} placeholder="e.g. Q3 FY26, Mar 2026" />
            </Field>
            <Field label="Mgmt Intervention 2">
              <input name="mgmt_intervention2" defaultValue={client.mgmt_intervention2 ?? ''} style={INP} placeholder="Secondary intervention note" />
            </Field>
            <Row>
              <Field label="Total Outstanding (₹)">
                <input name="total_outstanding" type="number" defaultValue={client.total_outstanding ?? ''} style={INP} placeholder="Raw INR amount" />
              </Field>
              <Field label="Weightage Score">
                <input name="weightage_score" type="number" step="0.01" defaultValue={client.weightage_score ?? ''} style={INP} placeholder="0-100" />
              </Field>
            </Row>
            <Row>
              <Field label="Expected to Pump (₹)">
                <input name="expected_to_pump" type="number" defaultValue={client.expected_to_pump ?? ''} style={INP} placeholder="Raw INR" />
              </Field>
              <Field label="Expected to Spare (₹)">
                <input name="expected_to_spare" type="number" defaultValue={client.expected_to_spare ?? ''} style={INP} placeholder="Raw INR" />
              </Field>
            </Row>
            <Field label="Competitors Observed">
              <input name="competitors_observed" defaultValue={client.competitors_observed ?? ''} style={INP} placeholder="Competitor names" />
            </Field>
            <Field label="Open Remarks">
              <textarea
                name="open_remarks"
                defaultValue={client.open_remarks ?? ''}
                rows={2}
                style={{ ...INP, height: 'auto', resize: 'vertical' as const, lineHeight: 1.5 }}
              />
            </Field>
            <Field label="Major Remarks">
              <textarea
                name="major_remarks"
                defaultValue={client.major_remarks ?? ''}
                rows={2}
                style={{ ...INP, height: 'auto', resize: 'vertical' as const, lineHeight: 1.5 }}
              />
            </Field>
            <Row>
              <Field label="ICE Dispersal By">
                <input name="ice_dispersal_by" defaultValue={client.ice_dispersal_by ?? ''} style={INP} placeholder="Name / team" />
              </Field>
              <Field label="Negotiation By">
                <input name="negotiation_by" defaultValue={client.negotiation_by ?? ''} style={INP} placeholder="Name / team" />
              </Field>
            </Row>
          </Section>

          {error && (
            <div style={{
              padding: '9px 12px',
              background: '#FEE2E2', border: '1px solid rgba(220,38,38,0.20)',
              borderRadius: 5, fontSize: 12, color: '#9B1C1C',
            }}>
              {error}
            </div>
          )}

          {success && (
            <div style={{
              padding: '12px 16px', background: '#D1FAE5',
              border: '1px solid #6EE7B7', borderRadius: 6,
              fontSize: 13, color: '#065F46', textAlign: 'center', fontWeight: 600,
            }}>
              ✓ Client updated!
            </div>
          )}

          {!success && (
            <button
              type="submit"
              disabled={isPending}
              style={{
                ...SUBMIT_BTN,
                opacity: isPending ? 0.55 : 1,
                cursor: isPending ? 'not-allowed' : 'pointer',
              }}
            >
              {isPending ? 'Saving…' : 'Save Changes'}
            </button>
          )}

        </form>
      </div>

      {toast && (
        <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />
      )}
    </>
  );
}

// ── Sub-components ─────────────────────────────────────────────

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{
        fontSize: 10, fontWeight: 700, color: '#0A3D8F',
        textTransform: 'uppercase', letterSpacing: '0.10em',
        marginBottom: 12, paddingBottom: 6, borderBottom: '1px solid #DDE6F5',
      }}>
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

// ── Styles ─────────────────────────────────────────────────────

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
