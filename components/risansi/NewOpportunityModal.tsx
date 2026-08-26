'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { createPipelineOpportunity } from '@/app/actions/risansi';
import {
  fieldsNewAt, requiredFieldNames, labelsFor, STAGE_HINT,
} from '@/lib/risansi-opportunity-fields';
import { OppStageSections } from './OppStageSections';
import type { FieldValues } from './OppFields';

// Raising an opportunity.
//
// It always starts as a PROSPECT — an enquiry has arrived. That is the only way
// in, so the form no longer opens with a stage picker; there is nothing to pick.
// A deal that is already quoted or already won is created here and then moved
// on, which takes one click and leaves an honest trail through the stage log
// rather than a record that claims to have been born Won.
//
// The old form was a two-step wizard whose second step appeared or vanished
// depending on the stage chosen on the first. With one entry stage there is one
// step, and the questions are the six that describe an enquiry.

interface ClientResult {
  id: string; legal_name: string; code: string;
  city: string | null; industry: string | null;
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
  /** ₹ per $1 from the settings page — drives the USD sub-text on money fields. */
  usdRate?: number;
}

export function NewOpportunityModal(props: NewOpportunityModalProps) {
  const { open, onClose, lockClient, usdRate = 86 } = props;

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

  const [selected, setSelected] = useState<ClientResult | null>(lockedClient);
  const [search, setSearch]     = useState('');
  const [results, setResults]   = useState<ClientResult[]>([]);

  useEffect(() => { if (open && lockedClient) setSelected(lockedClient); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open, props.clientId]);

  // Out-of-order guard: typing quickly fires several searches and the slowest
  // must not overwrite the newest.
  const seq = useRef(0);
  useEffect(() => {
    if (!open || lockClient) return;
    const term = search.trim();
    if (term.length < 2) { setResults([]); return; }
    const mine = ++seq.current;
    const t = setTimeout(() => {
      fetch(`/api/risansi/clients-search?q=${encodeURIComponent(term)}`)
        .then(r => r.ok ? r.json() : [])
        .then((rows: ClientResult[]) => { if (mine === seq.current) setResults(rows.slice(0, 10)); })
        .catch(() => { if (mine === seq.current) setResults([]); });
    }, 220);
    return () => clearTimeout(t);
  }, [search, open, lockClient]);

  const reset = () => { onClose(); setSearch(''); setResults([]); if (!lockClient) setSelected(null); };

  if (!open) return null;

  return (
    <div onClick={e => { if (e.target === e.currentTarget) reset(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(10,22,40,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}>
      <div className="risansi-modal" style={{
        width: 640, maxWidth: '100%', maxHeight: '92vh', overflowY: 'auto',
        background: 'var(--bg-paper)', color: 'var(--fg)', borderRadius: 12,
        boxShadow: '0 24px 64px rgba(10,61,143,0.25)',
      }}>
        <div style={{ padding: '16px 20px', background: '#0A3D8F', color: '#fff', position: 'sticky', top: 0, zIndex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>New Opportunity</div>
          <div style={{ fontSize: 11.5, opacity: 0.9, marginTop: 3 }}>
            Opens as a Prospect — {STAGE_HINT.Prospect}
          </div>
        </div>

        <div style={{ padding: '18px 20px' }}>
          {!selected ? (
            <ClientPicker
              search={search} setSearch={setSearch} results={results}
              onPick={setSelected} onCancel={reset}
            />
          ) : (
            <NewOppForm
              client={selected} lockClient={!!lockClient} usdRate={usdRate}
              onBack={() => { if (!lockClient) { setSelected(null); setResults([]); } }}
              onSuccess={reset}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function ClientPicker({ search, setSearch, results, onPick, onCancel }: {
  search: string; setSearch: (v: string) => void;
  results: ClientResult[]; onPick: (c: ClientResult) => void; onCancel: () => void;
}) {
  return (
    <div>
      <label style={LBL}>Client</label>
      <input
        autoFocus value={search} onChange={e => setSearch(e.target.value)}
        placeholder="Search by name or client code — at least 2 characters"
        style={INPUT}
      />
      {results.length > 0 && (
        <ul style={{ listStyle: 'none', margin: '10px 0 0', padding: 0, border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' }}>
          {results.map(c => (
            <li key={c.id}>
              <button type="button" onClick={() => onPick(c)} style={ROW}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>{c.legal_name}</div>
                <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>
                  <span style={{ fontFamily: 'var(--font-mono)' }}>{c.code}</span>
                  {c.city ? ` · ${c.city}` : ''}{c.industry ? ` · ${c.industry}` : ''}
                  {c.owner_name ? ` · ${c.owner_name}` : ''}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      {search.trim().length >= 2 && results.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 10 }}>No client matches that.</div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
        <button type="button" onClick={onCancel} style={GHOST}>Cancel</button>
      </div>
    </div>
  );
}

function NewOppForm({ client, lockClient, usdRate, onBack, onSuccess }: {
  client: ClientResult; lockClient: boolean; usdRate: number;
  onBack: () => void; onSuccess: () => void;
}) {
  const router = useRouter();
  const [values, setValues] = useState<FieldValues>({});
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState('');

  const onChange = useCallback((name: string, value: string) => {
    setValues(v => ({ ...v, [name]: value }));
    setError('');
  }, []);

  const required = requiredFieldNames('Prospect');
  const missing  = required.filter(n => !values[n]?.trim());

  const submit = async () => {
    if (missing.length) {
      setError(`Fill the required field${missing.length > 1 ? 's' : ''}: ${labelsFor(missing).join(', ')}.`);
      return;
    }
    setBusy(true); setError('');
    try {
      const fd = new FormData();
      fd.set('client_id', client.id);
      fd.set('stage', 'Prospect');
      for (const f of fieldsNewAt('Prospect')) fd.set(f.name, values[f.name] ?? '');
      await createPipelineOpportunity(fd);
      onSuccess();
      router.refresh();
    } catch (err) {
      const raw = err instanceof Error ? err.message : '';
      const redacted = !raw || /unexpected response/i.test(raw) || Boolean((err as { digest?: string })?.digest);
      setError(redacted ? 'Could not create the opportunity.' : raw);
      setBusy(false);
    }
  };

  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16,
        padding: '9px 12px', borderRadius: 8, background: 'var(--bg-elev)', border: '1px solid var(--line)',
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, overflowWrap: 'anywhere' }}>{client.legal_name}</div>
          <div style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>{client.code}</div>
        </div>
        {!lockClient && (
          <button type="button" onClick={onBack} style={{ ...LINK, marginLeft: 'auto' }}>Change</button>
        )}
      </div>

      {/* readOnlyCarried: nothing precedes a Prospect, so there is no context
          section to draw — only the questions this stage asks. */}
      <OppStageSections
        stage="Prospect" values={values} onChange={onChange}
        usdRate={usdRate} readOnlyCarried
      />

      {error && <div style={ERR}>{error}</div>}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
        <button type="button" onClick={onSuccess} disabled={busy} style={GHOST}>Cancel</button>
        <button type="button" onClick={submit} disabled={busy} style={{ ...PRIMARY, opacity: busy ? 0.6 : 1 }}>
          {busy ? 'Creating…' : 'Create Opportunity'}
        </button>
      </div>
    </div>
  );
}

const LBL: CSSProperties = {
  display: 'block', fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '0.05em', color: 'var(--fg-3)', marginBottom: 5,
};
const INPUT: CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '9px 11px', fontSize: 13,
  fontFamily: 'inherit', background: 'var(--bg-sunk)', border: '1px solid var(--line-strong)',
  borderRadius: 6, color: 'var(--fg)', outline: 'none',
};
const ROW: CSSProperties = {
  width: '100%', textAlign: 'left', border: 'none', background: 'none',
  padding: '9px 12px', cursor: 'pointer', fontFamily: 'inherit',
  borderBottom: '1px solid var(--line-2)',
};
const GHOST: CSSProperties = {
  border: '1px solid var(--line-strong)', background: 'var(--bg-paper)', color: 'var(--fg)',
  borderRadius: 6, fontSize: 13, fontWeight: 600, padding: '9px 16px', cursor: 'pointer', fontFamily: 'inherit',
};
const PRIMARY: CSSProperties = {
  border: 'none', background: '#0A3D8F', color: '#fff', borderRadius: 6,
  fontSize: 13, fontWeight: 600, padding: '9px 18px', cursor: 'pointer', fontFamily: 'inherit',
};
const LINK: CSSProperties = {
  background: 'none', border: 'none', color: '#1A5CB8', cursor: 'pointer',
  fontSize: 11.5, fontWeight: 600, fontFamily: 'inherit', textDecoration: 'underline',
};
const ERR: CSSProperties = {
  marginTop: 14, padding: '9px 12px', background: 'var(--neg-soft)',
  border: '1px solid var(--neg)', borderLeft: '3px solid var(--neg)',
  borderRadius: 6, color: 'var(--neg-strong)', fontSize: 12, lineHeight: 1.5,
};
