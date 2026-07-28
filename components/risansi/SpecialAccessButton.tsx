'use client';

import { useState, useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import {
  listClientAccess, grantClientAccess, revokeClientAccess, type SpecialRep,
} from '@/app/actions/risansi-access';

export interface GrantableRep { id: string; name: string; role: string; zone: string | null }

// Admin-only control on the Client Master page: grant one or more reps direct
// access to a client, independent of the client's tour. A granted rep sees the
// client everywhere they'd see a tour client and can plan visits + create
// opportunities for it. The row shows a key with a live grant count; the modal
// lists current grants (each removable) and a searchable picker to add more.
export function SpecialAccessButton({
  clientId, clientName, clientCode, reps, initialCount,
}: {
  clientId:   number;
  clientName: string;
  clientCode: string;
  reps:       GrantableRep[];
  initialCount: number;
}) {
  const router = useRouter();
  const [open, setOpen]       = useState(false);
  const [mounted, setMounted] = useState(false);
  const [grants, setGrants]   = useState<SpecialRep[] | null>(null);
  const [q, setQ]             = useState('');
  const [busy, setBusy]       = useState<number | 'load' | null>(null);
  const [err, setErr]         = useState('');
  const dirty = useRef(false);

  useEffect(() => setMounted(true), []);

  // Load current grants each time the modal opens (kept fresh across sessions).
  useEffect(() => {
    if (!open) return;
    let active = true;
    setBusy('load'); setErr('');
    listClientAccess(clientId)
      .then(rows => { if (active) setGrants(rows); })
      .catch(() => { if (active) { setGrants(null); setErr('Could not load current access.'); } })
      .finally(() => { if (active) setBusy(null); });
    return () => { active = false; };
  }, [open, clientId]);

  // Escape closes; body scroll locked while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const count = grants ? grants.length : initialCount;

  const grantedIds = useMemo(
    () => new Set((grants ?? []).map(g => g.rep_id)),
    [grants],
  );

  const available = useMemo(() => {
    const s = q.trim().toLowerCase();
    return reps
      .filter(r => !grantedIds.has(Number(r.id)))
      .filter(r => !s || [r.name, r.zone, r.role].some(v => (v ?? '').toLowerCase().includes(s)));
  }, [reps, grantedIds, q]);

  function close() {
    setOpen(false); setQ(''); setErr(''); setGrants(null);
    if (dirty.current) { dirty.current = false; router.refresh(); }
  }

  const grant = async (repId: number) => {
    setBusy(repId); setErr('');
    try {
      const rows = await grantClientAccess(clientId, repId);
      setGrants(rows); dirty.current = true; setQ('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not grant access.');
    } finally { setBusy(null); }
  };

  const revoke = async (repId: number) => {
    setBusy(repId); setErr('');
    try {
      const rows = await revokeClientAccess(clientId, repId);
      setGrants(rows); dirty.current = true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not revoke access.');
    } finally { setBusy(null); }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Special access"
        style={{
          ...PILL,
          borderColor: count > 0 ? 'var(--accent)' : 'var(--line-strong)',
          color:       count > 0 ? 'var(--accent)' : 'var(--fg-3)',
        }}
      >
        <KeyIcon />
        {count > 0 && <span style={{ fontWeight: 700 }}>{count}</span>}
      </button>

      {open && mounted && createPortal(
        <div style={OVERLAY} onMouseDown={close}>
          <div style={CARD} onMouseDown={e => e.stopPropagation()}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 4 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--fg)' }}>Special Access</div>
                <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 2 }}>
                  <span style={{ fontFamily: 'var(--font-mono)' }}>{clientCode}</span> · {clientName}
                </div>
              </div>
              <button type="button" onClick={close} style={XBTN} aria-label="Close">×</button>
            </div>

            <p style={{ fontSize: 12, color: 'var(--fg-2)', margin: '6px 0 14px', lineHeight: 1.5 }}>
              Grant reps direct access to this client, independent of its tour. A granted rep sees it
              in their lists and can plan visits and create opportunities for it.
            </p>

            {err && <div style={ERR}>{err}</div>}

            {/* Current grants */}
            <div style={SECLABEL}>Reps with access</div>
            <div style={{ marginBottom: 16 }}>
              {busy === 'load' ? (
                <div style={{ fontSize: 12, color: 'var(--fg-3)', padding: '8px 0' }}>Loading…</div>
              ) : grants === null ? (
                <div style={{ fontSize: 12, color: 'var(--fg-3)', padding: '4px 0' }}>Couldn’t load access — close and reopen to retry.</div>
              ) : (grants.length > 0) ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {grants.map(g => (
                    <div key={g.rep_id} style={GRANTROW}>
                      <div style={{ minWidth: 0 }}>
                        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg)' }}>{g.name}</span>
                        <span style={{ fontSize: 10, color: 'var(--fg-3)', marginLeft: 7, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          {g.role}{g.zone ? ` · ${g.zone}` : ''}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => revoke(g.rep_id)}
                        disabled={busy != null}
                        style={REMOVE}
                      >
                        {busy === g.rep_id ? '…' : 'Remove'}
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--fg-3)', padding: '4px 0' }}>No special access granted yet.</div>
              )}
            </div>

            {/* Add a rep */}
            <div style={SECLABEL}>Grant access to a rep</div>
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Search rep, zone, or role…"
              style={INP}
              disabled={grants === null}
            />
            <div style={LIST}>
              {available.length === 0 ? (
                <div style={{ padding: '12px', fontSize: 12, color: 'var(--fg-3)', textAlign: 'center' }}>
                  {reps.length === 0 ? 'No reps available.' : q.trim() ? 'No matching reps.' : 'All reps already have access.'}
                </div>
              ) : available.slice(0, 60).map(r => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => grant(Number(r.id))}
                  disabled={busy != null}
                  style={ADDROW}
                >
                  <span style={{ fontSize: 13, color: 'var(--fg)', minWidth: 0 }}>{r.name}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
                    <span style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      {r.role}{r.zone ? ` · ${r.zone}` : ''}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>
                      {busy === Number(r.id) ? '…' : '+ Grant'}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

function KeyIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="7.5" cy="15.5" r="4.5" />
      <path d="M11 12l7-7" />
      <path d="M15.5 7.5l2.5 2.5" />
      <path d="M18 5l2.5 2.5" />
    </svg>
  );
}

const PILL: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  height: 24, padding: '0 8px',
  border: '1px solid var(--line-strong)', borderRadius: 12,
  background: 'var(--bg-paper)', cursor: 'pointer',
  fontSize: 11, fontFamily: 'inherit', lineHeight: 1,
};
const OVERLAY: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 20, zIndex: 1000,
};
const CARD: CSSProperties = {
  width: '100%', maxWidth: 440, maxHeight: '85vh', overflowY: 'auto',
  background: 'var(--bg-paper)', border: '1px solid var(--line)',
  borderRadius: 12, padding: 20, boxShadow: '0 20px 50px rgba(0,0,0,0.25)',
};
const XBTN: CSSProperties = {
  border: 'none', background: 'transparent', cursor: 'pointer',
  fontSize: 22, lineHeight: 1, color: 'var(--fg-3)', padding: 0, marginTop: -2,
};
const SECLABEL: CSSProperties = {
  fontSize: 10, fontWeight: 700, color: 'var(--fg-3)',
  textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 7,
};
const GRANTROW: CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
  padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 7, background: 'var(--bg-elev)',
};
const REMOVE: CSSProperties = {
  border: '1px solid var(--line-strong)', background: 'var(--bg-paper)',
  color: '#9B1C1C', borderRadius: 6, fontSize: 11, fontWeight: 600,
  padding: '4px 9px', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
};
const INP: CSSProperties = {
  display: 'block', width: '100%', padding: '8px 10px',
  border: '1px solid var(--line-strong)', borderRadius: 6, fontSize: 13,
  fontFamily: 'inherit', background: 'var(--bg-elev)', color: 'var(--fg)',
  outline: 'none', boxSizing: 'border-box', marginBottom: 6,
};
const LIST: CSSProperties = {
  border: '1px solid var(--line-strong)', borderRadius: 8,
  maxHeight: 220, overflowY: 'auto', background: 'var(--bg-paper)',
};
const ADDROW: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
  textAlign: 'left', padding: '9px 12px', border: 'none',
  borderBottom: '1px solid var(--line)', background: 'transparent',
  cursor: 'pointer', fontFamily: 'inherit',
};
const ERR: CSSProperties = {
  marginBottom: 12, padding: '7px 10px', background: '#FEE2E2',
  border: '1px solid rgba(220,38,38,0.2)', borderRadius: 6, fontSize: 12, color: '#9B1C1C',
};
