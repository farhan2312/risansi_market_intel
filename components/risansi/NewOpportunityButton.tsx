'use client';

import { useState, useEffect, useRef, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { createPipelineOpportunity } from '@/app/actions/risansi';

interface Rep { id: string; name: string; zone: string | null; route: string | null; }

interface ClientResult {
  id: string; legal_name: string; code: string;
  city: string | null; industry: string | null;
  primary_rep_id: number | null; secondary_rep_id: number | null;
  primary_rep_name: string | null; secondary_rep_name: string | null;
}

const PROB: Record<string, number> = { Suspect: 20, Prospect: 40, Quoted: 60, Negotiating: 75 };

export function NewOpportunityButton() {
  const [open, setOpen]         = useState(false);
  const [search, setSearch]     = useState('');
  const [results, setResults]   = useState<ClientResult[]>([]);
  const [selected, setSelected] = useState<ClientResult | null>(null);
  const [searching, setSearching] = useState(false);

  const reset = () => { setOpen(false); setSelected(null); setSearch(''); setResults([]); };

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

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={TRIGGER_BTN}>
        + New Opportunity
      </button>
    );
  }

  return (
    <>
      <div onClick={reset} style={{ position: 'fixed', inset: 0, background: 'rgba(10,22,40,0.35)', zIndex: 200 }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        width: 520, maxHeight: '90vh', background: '#fff', borderRadius: 12,
        boxShadow: '0 20px 60px rgba(10,61,143,0.2)', zIndex: 201, overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid var(--line)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--fg)' }}>New Opportunity</span>
          <button onClick={reset} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--fg-3)', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: '16px 20px', overflowY: 'auto' }}>
          {!selected ? (
            <div>
              <label style={LBL}>Select Client *</label>
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
            <NewOppForm client={selected} onBack={() => setSelected(null)} onSuccess={reset} />
          )}
        </div>
      </div>
    </>
  );
}

function NewOppForm({ client, onBack, onSuccess }: {
  client: ClientResult; onBack: () => void; onSuccess: () => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [stage, setStage]     = useState('Suspect');
  const [prob, setProb]       = useState(PROB.Suspect);
  const [reps, setReps]       = useState<Rep[]>([]);
  const [primaryRepId, setPrimaryRepId]     = useState<string>(client.primary_rep_id != null ? String(client.primary_rep_id) : '');
  const [secondaryRepId, setSecondaryRepId] = useState<string>(client.secondary_rep_id != null ? String(client.secondary_rep_id) : '');
  const repsLoaded = useRef(false);

  useEffect(() => {
    if (repsLoaded.current) return;
    repsLoaded.current = true;
    fetch('/api/risansi/reps')
      .then(r => r.json())
      .then(data => setReps(Array.isArray(data) ? data : []))
      .catch(() => setReps([]));
    // Don't reset primaryRepId/secondaryRepId — seeded from client in useState init.
  }, []);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const fd = new FormData(e.currentTarget);
      fd.set('client_id', String(client.id));
      fd.set('rep_id', primaryRepId);
      fd.set('secondary_rep_id', secondaryRepId);
      await createPipelineOpportunity(fd);
      onSuccess();
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create opportunity');
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      {/* Selected client chip */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 12px', marginBottom: 16, background: '#EBF1FB',
        borderRadius: 6, border: '1px solid rgba(26,92,184,0.2)',
      }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#1A5CB8' }}>{client.legal_name}</div>
          <div style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
            {client.code}{client.industry ? ` · ${client.industry}` : ''}
          </div>
        </div>
        <button type="button" onClick={onBack} style={{ background: 'none', border: 'none', fontSize: 11, color: '#1A5CB8', cursor: 'pointer', textDecoration: 'underline' }}>
          Change
        </button>
      </div>

      {/* Rep assignment — pre-filled from client, editable per opportunity */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
        {/* Primary Rep */}
        <div>
          <label style={LBL}>Primary Rep *</label>
          {reps.length === 0 ? (
            <div style={{ ...INP, color: 'var(--fg-3)', fontStyle: 'italic' }}>Loading reps…</div>
          ) : (
            <select
              name="rep_id"
              value={primaryRepId}
              onChange={e => setPrimaryRepId(e.target.value)}
              required
              style={{ ...INP, borderColor: !primaryRepId ? 'var(--warn)' : 'var(--line-strong)' }}
            >
              <option value="">— Select Primary Rep —</option>
              {reps.map(r => (
                <option key={r.id} value={String(r.id)}>
                  {r.name}{r.zone ? ` · ${r.zone}` : ''}{r.route ? ` · ${r.route}` : ''}
                </option>
              ))}
            </select>
          )}
          {!client.primary_rep_id ? (
            <div style={{ fontSize: 10, color: 'var(--warn)', marginTop: 3, fontStyle: 'italic' }}>
              ⚠ No rep assigned to this client
            </div>
          ) : (
            <div style={{ fontSize: 10, color: 'var(--fg-3)', marginTop: 3 }}>
              Default: {client.primary_rep_name}
              {' · '}
              <span style={{ fontStyle: 'italic' }}>changes only affect this opportunity</span>
            </div>
          )}
        </div>

        {/* Secondary Rep */}
        <div>
          <label style={LBL}>
            Secondary Rep
            <span style={{ fontWeight: 400, marginLeft: 4, textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
          </label>
          {reps.length === 0 ? (
            <div style={{ ...INP, color: 'var(--fg-3)', fontStyle: 'italic' }}>Loading reps…</div>
          ) : (
            <select name="secondary_rep_id" value={secondaryRepId} onChange={e => setSecondaryRepId(e.target.value)} style={INP}>
              <option value="">— None —</option>
              {reps.map(r => (
                <option key={r.id} value={String(r.id)}>
                  {r.name}{r.zone ? ` · ${r.zone}` : ''}
                </option>
              ))}
            </select>
          )}
          {client.secondary_rep_id && (
            <div style={{ fontSize: 10, color: 'var(--fg-3)', marginTop: 3 }}>
              Default: {client.secondary_rep_name}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={LBL}>Product / Description *</label>
          <input name="product" required placeholder="e.g. PCP × 3 MX-80 · Spent Wash" style={INP} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={LBL}>Product Type</label>
            <select name="product_type" style={INP}>
              {['PCP', 'MMP', 'Spares', 'Service', 'Other'].map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label style={LBL}>Stage</label>
            <select name="stage" value={stage} onChange={e => { setStage(e.target.value); setProb(PROB[e.target.value] ?? 20); }} style={INP}>
              {['Suspect', 'Prospect', 'Quoted', 'Negotiating'].map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={LBL}>Value (₹ Lakhs)</label>
            <input name="value_lakh" type="number" step="0.1" min="0" placeholder="e.g. 12.5" style={INP} />
            <div style={{ fontSize: 10, color: 'var(--fg-3)', marginTop: 3 }}>
              Enter in Lakhs (₹12.5L = ₹0.125 Cr stored)
            </div>
          </div>
          <div>
            <label style={LBL}>Probability %</label>
            <input name="probability" type="number" min="0" max="100" value={prob} onChange={e => setProb(parseInt(e.target.value) || 0)} style={INP} />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={LBL}>Expected Close</label>
            <input name="eta_text" placeholder="e.g. Jun 2026 or Q3 FY27" style={INP} />
          </div>
          <div>
            <label style={LBL}>Quote Reference</label>
            <input name="quote_ref" placeholder="e.g. Q-2024-018" style={INP} />
          </div>
        </div>

        <div>
          <label style={LBL}>Notes</label>
          <textarea name="notes" rows={3} placeholder="Key context, contacts involved, next steps…" style={{ ...INP, height: 'auto', resize: 'vertical', lineHeight: 1.5 }} />
        </div>

        {error && (
          <div style={{ padding: '8px 12px', background: '#FDE8E8', border: '1px solid #F87171', borderLeft: '3px solid #E02424', borderRadius: 5, color: '#9B1C1C', fontSize: 12 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 4 }}>
          <button type="button" onClick={onBack} style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid var(--line-strong)', background: 'var(--bg-paper)', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}>
            Back
          </button>
          <button type="submit" disabled={loading} style={{ padding: '8px 20px', borderRadius: 6, background: '#0A3D8F', color: 'white', border: 'none', cursor: loading ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 500, fontFamily: 'inherit', opacity: loading ? 0.7 : 1 }}>
            {loading ? 'Creating…' : 'Create Opportunity'}
          </button>
        </div>
      </div>
    </form>
  );
}

const TRIGGER_BTN: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px',
  background: '#0A3D8F', color: 'white', border: 'none', borderRadius: 7,
  fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
};

const LBL: CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 700, color: '#2C3E5A',
  textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6,
};

const INP: CSSProperties = {
  display: 'block', width: '100%', padding: '8px 10px',
  border: '1px solid var(--line-strong)', borderRadius: 6, fontSize: 13,
  fontFamily: 'inherit', background: 'var(--bg-elev)', color: 'var(--fg)',
  outline: 'none', boxSizing: 'border-box',
};
