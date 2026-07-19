'use client';

import { useState, useEffect, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { createPipelineOpportunity } from '@/app/actions/risansi';

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

const PROB: Record<string, number> = { Suspect: 20, Prospect: 40, Quoted: 60, Negotiating: 75 };

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

  const [search, setSearch]     = useState('');
  const [results, setResults]   = useState<ClientResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<ClientResult | null>(lockedClient);

  // Keep the locked client in sync if props change between opens
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
      <div onClick={reset} style={{ position: 'fixed', inset: 0, background: 'rgba(10,22,40,0.35)', zIndex: 200 }} />
      <div className="risansi-modal" style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        width: 520, maxHeight: '90vh', background: 'var(--bg-paper)', borderRadius: 12,
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

function NewOppForm({ client, lockClient, onBack, onSuccess }: {
  client: ClientResult;
  lockClient: boolean;
  onBack: () => void;
  onSuccess: () => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [stage, setStage]     = useState('Suspect');
  const [prob, setProb]       = useState(PROB.Suspect);
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const fd = new FormData(e.currentTarget);
      fd.set('client_id', String(client.id));
      // Ownership is derived server-side from the client's tour.
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
        padding: '8px 12px', marginBottom: 16, background: 'var(--accent-soft)',
        borderRadius: 6, border: '1px solid var(--brand-blue)',
      }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--brand-blue)' }}>{client.legal_name}</div>
          <div style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
            {client.code}{client.industry ? ` · ${client.industry}` : ''}
          </div>
        </div>
        {!lockClient && (
          <button type="button" onClick={onBack} style={{ background: 'none', border: 'none', fontSize: 11, color: 'var(--brand-blue)', cursor: 'pointer', textDecoration: 'underline' }}>
            Change
          </button>
        )}
      </div>

      {/* No rep picker: the client is already on a tour, and the tour says who
          owns it. Asking again only invited a second, contradictory answer.
          `owner_name` is the resolved owner — the same ladder the server uses.
          It is NOT client.primary_rep_name, which is a comma-joined roster of
          everyone on the tour, managers included, and so would name people the
          server is not going to assign. Null means the tour cannot decide, and
          the server will refuse — so say that here rather than at submit. */}
      {client.owner_name ? (
        <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: -6, marginBottom: 14 }}>
          Owner: <span style={{ color: 'var(--fg-2)', fontWeight: 500 }}>{client.owner_name}</span>
          <span style={{ fontStyle: 'italic' }}> · from this client&apos;s tour</span>
        </div>
      ) : (
        <div style={{
          fontSize: 11.5, lineHeight: 1.5, color: 'var(--warn-strong, #92400E)',
          background: 'var(--warn-soft, #FEF3C7)', border: '1px solid var(--warn, #F59E0B)',
          borderRadius: 6, padding: '8px 10px', marginTop: -6, marginBottom: 14,
        }}>
          This client isn&apos;t on a tour with an assigned rep, so a new opportunity would have
          no owner. Put the client on a tour first, then come back.
        </div>
      )}

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
            <label style={LBL}>Value (₹)</label>
            <input name="value_inr" type="number" step="1" min="0" inputMode="numeric" placeholder="e.g. 2500000" style={INP} />
            <div style={{ fontSize: 10, color: 'var(--fg-3)', marginTop: 3 }}>Full amount in rupees</div>
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
          <div style={{ padding: '8px 12px', background: 'var(--neg-soft)', border: '1px solid var(--neg)', borderLeft: '3px solid var(--neg)', borderRadius: 5, color: 'var(--neg-strong)', fontSize: 12 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 4 }}>
          {!lockClient && (
            <button type="button" onClick={onBack} style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid var(--line-strong)', background: 'var(--bg-paper)', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}>
              Back
            </button>
          )}
          <button type="submit" disabled={loading} style={{ padding: '8px 20px', borderRadius: 6, background: '#0A3D8F', color: 'white', border: 'none', cursor: loading ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 500, fontFamily: 'inherit', opacity: loading ? 0.7 : 1 }}>
            {loading ? 'Creating…' : 'Create Opportunity'}
          </button>
        </div>
      </div>
    </form>
  );
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
