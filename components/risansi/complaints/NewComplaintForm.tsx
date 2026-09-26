'use client';

import { useMemo, useState, useTransition, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { createComplaintV2, lookupPump } from '@/app/actions/risansi-complaints-v2';
import { pageById, isFieldShown, type ComplaintValues } from '@/lib/risansi-complaint-flow';
import { Field, LBL, HINT, INPUT, NOTE, PRIMARY, GHOST, type UserOpt, type OemOpt } from './ComplaintPageForm';

// Raising a complaint: pick the client, fill page 1, and — if the details are
// to hand — page 2. Everything else happens on the complaint itself, where
// the Complaint Team takes it. Saves through createComplaintV2 and lands on
// the new record, where photos and emails can be attached.

export interface ClientOpt { id: number; code: string; name: string }

export function NewComplaintForm({ clients, preselect, lookups, users, oems = [] }: {
  clients: ClientOpt[]; preselect?: number | null; lookups: Record<string, string[]>; users: UserOpt[];
  oems?: OemOpt[];
}) {
  const router = useRouter();
  const page1 = pageById(1)!, page2 = pageById(2)!;
  const [clientId, setClientId] = useState<number | ''>(preselect && clients.some(c => c.id === preselect) ? preselect : '');
  const [search, setSearch] = useState('');
  const [values, setValues] = useState<ComplaintValues>(() => {
    const v: ComplaintValues = { complaint_date: new Date().toISOString().slice(0, 10) };
    for (const f of [...page1.fields, ...page2.fields]) v[f.name] ??= f.type === 'bool' ? null : '';
    return v;
  });
  const [more, setMore] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [looking, setLooking] = useState(false);

  const set = (name: string, v: unknown) => { setValues(cur => ({ ...cur, [name]: v })); setMsg(null); };
  // Names match at word starts: "des" finds DESAI and AQUA DESIGNS, not
  // anandESHwar. Codes match anywhere, since a code is one token and people
  // remember its tail ("A152") as often as its head ("KANP"). Every typed word
  // must match; an exact code comes first, then names beginning with the
  // query, then code prefixes, then the rest.
  const shown = useMemo(() => {
    const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return clients.slice(0, 80);
    const scored: { c: ClientOpt; rank: number }[] = [];
    for (const c of clients) {
      const name = c.name.toLowerCase(), code = c.code.toLowerCase();
      const wordStart = (w: string) => name.startsWith(w) || /[\s(\-./&,]/.test(name) && new RegExp(`[\\s(\\-./&,]${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(name);
      if (!words.every(w => wordStart(w) || code.includes(w))) continue;
      const q = words.join(' ');
      const rank = code === q ? 0 : name.startsWith(words[0]) ? 1 : code.startsWith(words[0]) ? 2 : code.includes(words[0]) ? 3 : 4;
      scored.push({ c, rank });
    }
    return scored.sort((a, b) => a.rank - b.rank || a.c.name.localeCompare(b.c.name)).slice(0, 80).map(x => x.c);
  }, [clients, search]);
  const chosen = clients.find(c => c.id === clientId) ?? null;
  const missing = page1.fields.filter(f => f.required && (values[f.name] == null || values[f.name] === '')).map(f => f.label);

  const submit = () => {
    setMsg(null);
    if (!clientId) { setMsg({ ok: false, text: 'Pick the client first.' }); return; }
    start(async () => {
      const out: Record<string, unknown> = {};
      for (const f of page1.fields) out[f.name] = isFieldShown(f, values) ? values[f.name] : null;
      if (more) for (const f of page2.fields) out[f.name] = isFieldShown(f, values) ? values[f.name] : null;
      const res = await createComplaintV2({ client_id: Number(clientId), values: out });
      if (!res.ok) { setMsg({ ok: false, text: res.error }); return; }
      router.push(`/risansi/complaints/${res.data.id}?page=registration`);
    });
  };

  const lookup = async (q: string) => {
    if (!q || q.trim().length < 3) return;
    setLooking(true);
    const res = await lookupPump(q, clientId ? Number(clientId) : null);
    setLooking(false);
    if (!res.ok) { setMsg({ ok: false, text: res.error }); return; }
    if (!res.data) { setMsg({ ok: false, text: `Nothing in the installed base matches "${q}". Type the details in.` }); return; }
    const d = res.data;
    const fill: Record<string, unknown> = { so_no: d.so_no, ec_no: d.ec_no, pump_serial_no: d.pump_serial_no, pump_model: d.pump_model, liquid: d.liquid, head_pressure: d.head_pressure, quantity: d.quantity };
    let n = 0;
    setValues(cur => { const next = { ...cur }; for (const [k, v] of Object.entries(fill)) if (v != null && v !== '' && (next[k] == null || next[k] === '')) { next[k] = v; n++; } return next; });
    setMsg({ ok: true, text: `Found it. Filled ${n} blank field${n === 1 ? '' : 's'} — check them.` });
  };

  const grid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: '12px 16px' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <section style={PANEL}>
        <div style={HEAD}><span style={{ fontSize: 13, fontWeight: 600 }}>Client</span><span style={{ fontSize: 11, color: 'var(--fg-3)' }}>{clients.length} you can raise for</span></div>
        <div style={{ padding: '14px 16px' }}>
          {chosen ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{chosen.name}</div>
                <div style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>{chosen.code}</div>
              </div>
              <button type="button" onClick={() => setClientId('')} style={{ ...GHOST, marginLeft: 'auto' }}>Change</button>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 320px) 1fr', gap: 12, alignItems: 'start' }}>
              <div>
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Type a client name or code…" autoFocus style={INPUT}
                  onKeyDown={e => { if (e.key === 'Enter' && shown.length) { e.preventDefault(); setClientId(shown[0].id); } }} />
                <div style={HINT}>{search.trim() ? `${shown.length}${shown.length === 80 ? '+' : ''} match${shown.length === 1 ? '' : 'es'} — click one, or press Enter for the first.` : 'Matches the start of any word in the name, or any part of the code.'}</div>
              </div>
              <select size={Math.min(8, Math.max(3, shown.length))} value={clientId} onChange={e => setClientId(Number(e.target.value))}
                style={{ ...INPUT, height: 'auto', padding: 4 }}>
                {shown.map(c => <option key={c.id} value={c.id} style={{ padding: '4px 6px' }}>{c.name} · {c.code}</option>)}
                {!shown.length && <option disabled>No client matches</option>}
              </select>
            </div>
          )}
        </div>
      </section>

      <section style={PANEL}>
        <div style={HEAD}><span style={{ fontSize: 13, fontWeight: 600 }}>1. {page1.title}</span><span style={{ fontSize: 11, color: 'var(--fg-3)' }}>owner: {page1.owner}</span></div>
        <div style={{ padding: '14px 16px' }}>
          <div style={grid}>
            {page1.fields.map(f => isFieldShown(f, values) && (
              <div key={f.name} style={f.type === 'long' ? { gridColumn: '1 / -1' } : undefined}>
                <label style={LBL}>{f.label}{f.required && <span style={{ color: 'var(--neg)', marginLeft: 3 }}>*</span>}</label>
                <Field f={f} value={values[f.name]} onChange={v => set(f.name, v)} disabled={pending} lookups={lookups} users={users} oems={oems} />
                {f.hint && <div style={HINT}>{f.hint}</div>}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section style={PANEL}>
        <div style={{ ...HEAD, cursor: 'pointer' }} onClick={() => setMore(m => !m)}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>2. {page2.title}</span>
          <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>optional now — the Complaint Team completes it</span>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--accent)', fontWeight: 600 }}>{more ? 'Hide' : 'Add now'}</span>
        </div>
        {more && (
          <div style={{ padding: '14px 16px' }}>
            <div style={grid}>
              {page2.fields.map(f => isFieldShown(f, values) && (
                <div key={f.name} style={f.type === 'long' ? { gridColumn: '1 / -1' } : undefined}>
                  <label style={LBL}>{f.label}</label>
                  <Field f={f} value={values[f.name]} onChange={v => set(f.name, v)} disabled={pending} lookups={lookups} users={users} oems={oems}
                    onLookup={f.fromPump && (f.name === 'ec_no' || f.name === 'pump_serial_no') ? () => lookup(String(values[f.name] ?? '')) : undefined} looking={looking} />
                  {f.hint && <div style={HINT}>{f.hint}</div>}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {msg && (
        <div style={{ ...NOTE, marginBottom: 0, background: msg.ok ? 'var(--pos-soft)' : 'var(--neg-soft)', border: `1px solid ${msg.ok ? 'var(--pos)' : 'var(--neg)'}`, color: msg.ok ? 'var(--pos)' : 'var(--neg-strong, var(--neg))' }}>{msg.text}</div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button type="button" onClick={submit} disabled={pending || !clientId || missing.length > 0} style={{ ...PRIMARY, opacity: pending || !clientId || missing.length ? 0.6 : 1 }}>
          {pending ? 'Registering…' : 'Register complaint'}
        </button>
        <span style={{ fontSize: 11, color: missing.length || !clientId ? 'var(--warn, #B45309)' : 'var(--fg-3)' }}>
          {!clientId ? 'Pick the client.' : missing.length ? `Still needed: ${missing.join(', ')}` : 'Photos, emails and documents can be attached on the next screen.'}
        </span>
      </div>
    </div>
  );
}

const PANEL: CSSProperties = { background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)' };
const HEAD: CSSProperties = { display: 'flex', alignItems: 'baseline', gap: 10, padding: '11px 16px', borderBottom: '1px solid var(--line)' };
