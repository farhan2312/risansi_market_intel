'use client';

import {
  useState, useEffect, useRef, useTransition, type CSSProperties,
} from 'react';
import { assignVisit } from '@/app/actions/risansi';

// ── Types ──────────────────────────────────────────────────────

export interface DrawerRep {
  id: string;
  name: string;
  route?: string | null;
}

interface ClientResult {
  id: string;
  code: string;
  legal_name: string;
  city: string | null;
  state: string | null;
  industry: string | null;
}

interface DrawerPayload {
  clientId?: string;
  clientName?: string;
  clientCode?: string;
  repId?: string;
}

const OPEN_EVENT = 'risansi:open-assign-drawer';

const PURPOSES = [
  'Routine',
  'Quote Follow-up',
  'Complaint Resolution',
  'New Opportunity',
  'Equipment Assessment',
  'Management Relationship Visit',
];

// ── Row button — dispatches event to open the drawer ──────────

export function AssignVisitRowBtn({
  clientId, clientName, clientCode, repId,
}: DrawerPayload) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent(OPEN_EVENT, {
        detail: { clientId, clientName, clientCode, repId },
      }))}
      style={ROW_BTN}
    >
      Assign Visit →
    </button>
  );
}

// ── Main drawer ────────────────────────────────────────────────

export default function AssignVisitDrawer({ reps }: { reps: DrawerRep[] }) {
  const [open, setOpen]               = useState(false);
  const [isPending, startTransition]  = useTransition();
  const [formKey, setFormKey]         = useState(0);
  const [prefillRepId, setPrefillRepId] = useState('');

  // Client search
  const [query, setQuery]               = useState('');
  const [results, setResults]           = useState<ClientResult[]>([]);
  const [showResults, setShowResults]   = useState(false);
  const [selectedClient, setSelectedClient] = useState<ClientResult | null>(null);
  const [searching, setSearching]       = useState(false);

  // Feedback
  const [success, setSuccess] = useState(false);
  const [error, setError]     = useState('');

  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // ── Listen for row-button open events ─────────────────────

  useEffect(() => {
    function handleOpen(e: Event) {
      const p = (e as CustomEvent<DrawerPayload>).detail;
      setPrefillRepId(p.repId ?? '');
      if (p.clientId && p.clientName) {
        setSelectedClient({
          id: p.clientId, code: p.clientCode ?? '',
          legal_name: p.clientName,
          city: null, state: null, industry: null,
        });
        setQuery(p.clientName);
      } else {
        setSelectedClient(null);
        setQuery('');
      }
      setResults([]);
      setShowResults(false);
      setSuccess(false);
      setError('');
      setFormKey(k => k + 1);
      setOpen(true);
    }
    window.addEventListener(OPEN_EVENT, handleOpen);
    return () => window.removeEventListener(OPEN_EVENT, handleOpen);
  }, []);

  // ── Client search with debounce ────────────────────────────

  useEffect(() => {
    if (query.length < 2) { setResults([]); setSearching(false); return; }
    clearTimeout(searchTimer.current);
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const res  = await fetch(`/api/risansi/clients-search?q=${encodeURIComponent(query)}`);
        const data = await res.json() as ClientResult[];
        setResults(data);
        setShowResults(true);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(searchTimer.current);
  }, [query]);

  // ── Helpers ────────────────────────────────────────────────

  function openFresh() {
    setPrefillRepId('');
    setSelectedClient(null);
    setQuery('');
    setResults([]);
    setShowResults(false);
    setSuccess(false);
    setError('');
    setFormKey(k => k + 1);
    setOpen(true);
  }

  function close() { setOpen(false); }

  function nextWorkday(): string {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    if (d.getDay() === 6) d.setDate(d.getDate() + 2); // Sat → Mon
    if (d.getDay() === 0) d.setDate(d.getDate() + 1); // Sun → Mon
    return d.toISOString().slice(0, 10);
  }

  // ── Submit ─────────────────────────────────────────────────

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedClient) {
      setError('Please select a client from the search results.');
      return;
    }
    setError('');
    const fd = new FormData(e.currentTarget);
    fd.set('client_id', selectedClient.id);
    startTransition(async () => {
      try {
        await assignVisit(fd);
        setSuccess(true);
        setTimeout(() => { setOpen(false); setSuccess(false); }, 1500);
      } catch {
        setError('Failed to schedule visit — please try again.');
      }
    });
  }

  // ── Render ─────────────────────────────────────────────────

  return (
    <>
      {/* Header trigger button */}
      <button type="button" onClick={openFresh} style={PRIMARY_BTN}>
        + Assign Visit
      </button>

      {/* Backdrop */}
      {open && (
        <div
          onClick={close}
          style={{
            position: 'fixed', inset: 0, zIndex: 40,
            background: 'rgba(10,22,40,0.35)',
          }}
        />
      )}

      {/* Slide-in drawer */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 480, zIndex: 50,
        background: '#fff',
        boxShadow: '-8px 0 40px rgba(10,22,40,0.14)',
        display: 'flex', flexDirection: 'column',
        transform: open ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.26s cubic-bezier(0.32,0,0.67,0)',
      }}>

        {/* Drawer header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', borderBottom: '1px solid #DDE6F5', flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#0A3D8F', letterSpacing: '-0.01em' }}>
              Assign Visit
            </div>
            <div style={{ fontSize: 11, color: '#6B7FA3', marginTop: 2 }}>
              Schedule a planned visit for a rep
            </div>
          </div>
          <button type="button" onClick={close} style={CLOSE_BTN}>✕</button>
        </div>

        {/* Form — re-keyed each open so defaultValues apply fresh */}
        <form
          key={formKey}
          onSubmit={handleSubmit}
          style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}
        >

          {/* 1 · Client */}
          <div>
            <label style={LBL}>Client <Req /></label>
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                value={query}
                onChange={e => {
                  setQuery(e.target.value);
                  if (selectedClient) setSelectedClient(null);
                }}
                onFocus={() => { if (results.length > 0) setShowResults(true); }}
                onBlur={() => setTimeout(() => setShowResults(false), 180)}
                placeholder="Search by name, code, or city…"
                style={{
                  ...INP,
                  borderColor: query.length > 1 && !selectedClient ? '#F59E0B' : '#CBD5E1',
                }}
                autoComplete="off"
              />
              {searching && (
                <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: '#6B7FA3' }}>
                  searching…
                </span>
              )}
              {selectedClient && (
                <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: '#0E9F6E' }}>
                  ✓
                </span>
              )}
              {showResults && results.length > 0 && (
                <div style={DROP}>
                  {results.map(c => (
                    <button
                      key={c.id}
                      type="button"
                      onMouseDown={() => {
                        setSelectedClient(c);
                        setQuery(c.legal_name);
                        setShowResults(false);
                      }}
                      style={DROP_ITEM}
                    >
                      <span style={{ fontWeight: 500, fontSize: 13 }}>{c.legal_name}</span>
                      <span style={{ fontSize: 11, color: '#6B7FA3', marginTop: 2 }}>
                        {c.code}{c.city ? ` · ${c.city}` : ''}{c.industry ? ` · ${c.industry}` : ''}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <input type="hidden" name="client_id" value={selectedClient?.id ?? ''} />
            {selectedClient && (
              <div style={{ marginTop: 4, fontSize: 11, color: '#6B7FA3' }}>
                {selectedClient.code}
                {selectedClient.city ? ` · ${selectedClient.city}` : ''}
                {selectedClient.industry ? ` · ${selectedClient.industry}` : ''}
              </div>
            )}
          </div>

          {/* 2 · Rep */}
          <div>
            <label style={LBL}>Rep <Req /></label>
            <select name="rep_id" defaultValue={prefillRepId} style={INP} required>
              <option value="">Select a rep…</option>
              {reps.map(r => (
                <option key={r.id} value={r.id}>
                  {r.name}{r.route ? ` · ${r.route}` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* 3 · Visit Date */}
          <div>
            <label style={LBL}>Visit Date <Req /></label>
            <input
              type="date"
              name="visit_date"
              defaultValue={nextWorkday()}
              style={INP}
              required
            />
          </div>

          {/* 4 · Purpose */}
          <div>
            <label style={LBL}>Purpose <Req /></label>
            <select name="purpose" style={INP} required>
              {PURPOSES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>

          {/* 5 · Notes */}
          <div>
            <label style={LBL}>
              Notes{' '}
              <span style={{ color: '#6B7FA3', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
                (optional)
              </span>
            </label>
            <textarea
              name="notes"
              maxLength={500}
              rows={3}
              placeholder="Specific objectives, context, or talking points…"
              style={{ ...INP, height: 'auto', resize: 'vertical', paddingTop: 9, paddingBottom: 9, lineHeight: 1.5 }}
            />
          </div>

          {/* 6 · Planned checkbox */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer' }}>
            <input
              type="checkbox"
              name="is_planned"
              defaultChecked
              style={{ width: 15, height: 15, accentColor: '#1A5CB8', cursor: 'pointer' }}
            />
            <span style={{ fontSize: 13, color: '#2C3E5A' }}>Mark as planned visit</span>
          </label>

          {/* Error */}
          {error && (
            <div style={{
              padding: '9px 12px',
              background: '#FEE2E2', border: '1px solid rgba(220,38,38,0.20)',
              borderRadius: 5, fontSize: 12, color: '#9B1C1C',
            }}>
              {error}
            </div>
          )}

          {/* Success */}
          {success && (
            <div style={{
              padding: '12px 16px',
              background: '#D1FAE5', border: '1px solid #6EE7B7',
              borderRadius: 6, fontSize: 13, color: '#065F46',
              textAlign: 'center', fontWeight: 600,
            }}>
              ✓ Visit scheduled successfully!
            </div>
          )}

          {/* Submit */}
          {!success && (
            <button
              type="submit"
              disabled={isPending || !selectedClient}
              style={{
                ...SUBMIT_BTN,
                opacity: isPending || !selectedClient ? 0.55 : 1,
                cursor: isPending || !selectedClient ? 'not-allowed' : 'pointer',
              }}
            >
              {isPending ? 'Scheduling…' : 'Schedule Visit'}
            </button>
          )}
        </form>
      </div>
    </>
  );
}

function Req() {
  return <span style={{ color: '#E02424', marginLeft: 2 }}>*</span>;
}

// ── Styles ─────────────────────────────────────────────────────

const PRIMARY_BTN: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '7px 14px', fontSize: 13, fontFamily: 'inherit',
  fontWeight: 600, background: '#0A3D8F', color: '#fff',
  border: 'none', borderRadius: 6, cursor: 'pointer',
  letterSpacing: '-0.005em', flexShrink: 0,
};

const ROW_BTN: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '4px 10px', fontSize: 11, fontFamily: 'inherit',
  fontWeight: 500, background: 'transparent',
  border: '1px solid #CBD5E1', color: '#0A3D8F',
  borderRadius: 5, cursor: 'pointer', whiteSpace: 'nowrap',
};

const CLOSE_BTN: CSSProperties = {
  width: 28, height: 28, display: 'grid', placeItems: 'center',
  background: 'transparent', border: 'none', cursor: 'pointer',
  fontSize: 16, color: '#6B7FA3', borderRadius: 4,
};

const LBL: CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 700, color: '#2C3E5A',
  textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6,
};

const INP: CSSProperties = {
  display: 'block', width: '100%', padding: '9px 12px',
  fontSize: 13, fontFamily: 'inherit',
  background: '#F8FAFC', border: '1px solid #CBD5E1',
  borderRadius: 6, color: '#0D1B2A', outline: 'none',
  boxSizing: 'border-box',
};

const DROP: CSSProperties = {
  position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 60,
  background: '#fff', border: '1px solid #DDE6F5',
  borderRadius: 6, boxShadow: '0 4px 20px rgba(10,22,40,0.13)',
  maxHeight: 260, overflowY: 'auto', marginTop: 2,
};

const DROP_ITEM: CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
  width: '100%', padding: '10px 14px',
  background: 'transparent', border: 'none',
  borderBottom: '1px solid #EBF1FB',
  cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
};

const SUBMIT_BTN: CSSProperties = {
  width: '100%', padding: '12px 0',
  fontSize: 14, fontFamily: 'inherit', fontWeight: 600,
  background: '#0A3D8F', color: '#fff',
  border: 'none', borderRadius: 6,
  letterSpacing: '-0.005em', marginTop: 4,
};
