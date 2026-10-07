'use client';

import { useEffect, useMemo, useState, useTransition, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { createComplaintV2, lookupPump, listClientPumps, type ClientPumpOption } from '@/app/actions/risansi-complaints-v2';
import { pageById, isFieldShown, type ComplaintValues, type CascadingLookups } from '@/lib/risansi-complaint-flow';
import { Field, LBL, HINT, INPUT, NOTE, PRIMARY, GHOST, type UserOpt, type OemOpt } from './ComplaintPageForm';

// Raising a complaint: pick the client, fill page 1, and — if the details are
// to hand — page 2. Everything else happens on the complaint itself, where the
// Complaint Team takes it.
//
// Photos and videos attach here, not only later (decision 12). The requirement
// is that Marketing can register a complaint with the evidence in hand, and a
// complaint has no id to hang a file on until it is saved, so the files are
// held on this screen and posted the moment the record exists. Attaching later,
// on the complaint's own page, is unchanged.

export interface ClientOpt { id: number; code: string; name: string }

/**
 * The slots a complaint can be registered with — the same two page 1 shows on
 * the complaint itself. The rest (CAPA, customer correspondence) belong to
 * stages that have not happened yet when a complaint is being raised.
 *
 * The upload route accepts images, PDF, Word, Excel and plain text. Video is
 * not among them, so the labels say photos.
 */
const AT_REGISTRATION: { key: string; label: string; hint: string }[] = [
  { key: 'complaint', label: 'Complaint attachments', hint: 'Emails, documents, the customer’s own report.' },
  { key: 'photo', label: 'Photos', hint: 'Of the part, the site, the damage.' },
];

export function NewComplaintForm({ clients, preselect, lookups, cascades, users, oems = [] }: {
  clients: ClientOpt[]; preselect?: number | null; lookups: Record<string, string[]>;
  cascades?: CascadingLookups;
  users: UserOpt[];
  oems?: OemOpt[];
}) {
  const router = useRouter();
  const page1 = pageById(1)!, page2 = pageById(2)!;
  const [clientId, setClientId] = useState<number | ''>(preselect && clients.some(c => c.id === preselect) ? preselect : '');
  const [search, setSearch] = useState('');
  const [values, setValues] = useState<ComplaintValues>(() => {
    const v: ComplaintValues = { complaint_date: new Date().toISOString().slice(0, 10) };
    for (const f of [...page1.fields, ...page2.fields]) v[f.name] ??= f.type === 'bool' ? null : f.type === 'multi' ? [] : '';
    return v;
  });
  const [more, setMore] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [looking, setLooking] = useState(false);
  const [staged, setStaged] = useState<{ key: string; file: File }[]>([]);
  const [pumps, setPumps] = useState<ClientPumpOption[]>([]);

  const set = (name: string, v: unknown) => {
    const next: ComplaintValues = { ...values, [name]: v };
    let note: string | null = null;
    // The parent of a cascade moved: the child it was holding is orphaned.
    for (const f of [...page1.fields, ...page2.fields]) if (f.parentField === name && next[f.name]) next[f.name] = '';
    // An SO brings its EC with it, out of the installed base.
    if (name === 'so_no' && v) {
      const hit = pumps.find(p => (p.so_number ?? '').trim().toUpperCase() === String(v).trim().toUpperCase());
      if (hit) {
        const filled: string[] = [];
        if (hit.ec_number && !next.ec_no) { next.ec_no = hit.ec_number; filled.push(`EC ${hit.ec_number}`); }
        if (hit.ec_date && !next.ec_date) { next.ec_date = hit.ec_date; filled.push(`EC date ${hit.ec_date}`); }
        if (filled.length) note = `Filled from the installed base: ${filled.join(', ')}.`;
      }
    }
    setValues(next);
    setMsg(note ? { ok: true, text: note } : null);
  };

  // SO / EC / serial off this client's installed base, offered rather than typed blind.
  useEffect(() => {
    if (!clientId) { setPumps([]); return; }
    let live = true;
    listClientPumps(Number(clientId)).then(res => {
      if (!live) return;
      if (res.ok) setPumps(res.data);
    });
    return () => { live = false; };
  }, [clientId]);

  const suggestions = useMemo(() => {
    const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x && x.trim() !== '').map(x => x.trim()))].slice(0, 300);
    return {
      so_no: uniq(pumps.map(p => p.so_number)),
      ec_no: uniq(pumps.map(p => p.ec_number)),
      pump_serial_no: uniq(pumps.map(p => p.pump_sl_no)),
      pump_model: uniq(pumps.map(p => p.pump_model_plate)),
    } as Record<string, string[]>;
  }, [pumps]);

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
      // The complaint exists now, so the evidence held on this screen has
      // somewhere to go. A file that will not upload does not lose the
      // registration — the complaint is saved either way and the page says which
      // ones to attach again.
      const failed: string[] = [];
      for (const { key, file } of staged) {
        const fd = new FormData();
        fd.set('file', file); fd.set('category', key);
        const up = await fetch(`/api/risansi/complaints/${res.data.id}/attachments`, { method: 'POST', body: fd });
        if (!up.ok) failed.push(file.name);
      }
      const q = failed.length ? `&files=${encodeURIComponent(failed.join('|'))}` : '';
      router.push(`/risansi/complaints/${res.data.id}?page=registration${q}`);
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
    const fill: Record<string, unknown> = { so_no: d.so_no, ec_no: d.ec_no, ec_date: d.ec_date, pump_serial_no: d.pump_serial_no, pump_model: d.pump_model };
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
              <div key={f.name} style={f.type === 'long' || f.type === 'multi' ? { gridColumn: '1 / -1' } : undefined}>
                <label style={LBL}>{f.label}{f.required && <span style={{ color: 'var(--neg)', marginLeft: 3 }}>*</span>}</label>
                <Field f={f} value={values[f.name]} onChange={v => set(f.name, v)} disabled={pending}
                  lookups={lookups} cascades={cascades} values={values} users={users} oems={oems} />
                {f.hint && <div style={HINT}>{f.hint}</div>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Evidence, at registration. Held here and posted the moment the
          complaint has an id of its own to hang them on. */}
      <section style={PANEL}>
        <div style={HEAD}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Photos, videos & documents</span>
          <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>attached as soon as the complaint is registered</span>
          {staged.length > 0 && <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>{staged.length}</span>}
        </div>
        <div style={{ padding: '14px 16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
          {AT_REGISTRATION.map(slot => {
            const mine = staged.filter(s => s.key === slot.key);
            return (
              <div key={slot.key} style={SLOT}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{slot.label}</div>
                <div style={{ fontSize: 10.5, color: 'var(--fg-3)', marginTop: 2, lineHeight: 1.4 }}>{slot.hint}</div>
                <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {mine.map((s, i) => (
                    <li key={`${s.file.name}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.file.name}>
                        {/^image\//.test(s.file.type) ? '🖼' : /^video\//.test(s.file.type) ? '🎬' : '📎'} {s.file.name}
                      </span>
                      <span style={{ fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>{Math.max(1, Math.round(s.file.size / 1e3))} KB</span>
                      <button type="button" disabled={pending} onClick={() => setStaged(cur => cur.filter(x => x !== s))} title="Remove" style={X}>×</button>
                    </li>
                  ))}
                </ul>
                <label style={{ ...UP, marginTop: 8, cursor: pending ? 'wait' : 'pointer' }}>
                  ⤒ Choose file
                  <input type="file" multiple disabled={pending} style={{ display: 'none' }}
                    onChange={e => { const picked = Array.from(e.target.files ?? []); e.target.value = ''; setStaged(cur => [...cur, ...picked.map(file => ({ key: slot.key, file }))]); }} />
                </label>
              </div>
            );
          })}
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
                <div key={f.name} style={f.type === 'long' || f.type === 'multi' ? { gridColumn: '1 / -1' } : undefined}>
                  <label style={LBL}>{f.label}</label>
                  <Field f={f} value={values[f.name]} onChange={v => set(f.name, v)} disabled={pending}
                    lookups={lookups} cascades={cascades} values={values} users={users} oems={oems}
                    suggestions={suggestions[f.name]}
                    onLookup={f.fromPump && (f.name === 'ec_no' || f.name === 'pump_serial_no' || f.name === 'so_no') ? () => lookup(String(values[f.name] ?? '')) : undefined} looking={looking} />
                  {f.hint && <div style={HINT}>{f.hint}</div>}
                </div>
              ))}
            </div>
            <div style={{ ...HINT, marginTop: 12 }}>
              Part details — which parts, their MOC and their ECs — are entered on the complaint itself, on page 2, where rows can be added one per part.
            </div>
          </div>
        )}
      </section>

      {msg && (
        <div style={{ ...NOTE, marginBottom: 0, background: msg.ok ? 'var(--pos-soft)' : 'var(--neg-soft)', border: `1px solid ${msg.ok ? 'var(--pos)' : 'var(--neg)'}`, color: msg.ok ? 'var(--pos)' : 'var(--neg-strong, var(--neg))' }}>{msg.text}</div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button type="button" onClick={submit} disabled={pending || !clientId || missing.length > 0} style={{ ...PRIMARY, opacity: pending || !clientId || missing.length ? 0.6 : 1 }}>
          {pending ? (staged.length ? 'Registering & attaching…' : 'Registering…') : 'Register complaint'}
        </button>
        <span style={{ fontSize: 11, color: missing.length || !clientId ? 'var(--warn, #B45309)' : 'var(--fg-3)' }}>
          {!clientId ? 'Pick the client.' : missing.length ? `Still needed: ${missing.join(', ')}`
            : staged.length ? `${staged.length} file${staged.length === 1 ? '' : 's'} will be attached. More can be added on the complaint afterwards.`
            : 'Photos, emails and documents can also be attached on the next screen.'}
        </span>
      </div>
    </div>
  );
}

const PANEL: CSSProperties = { background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)' };
const HEAD: CSSProperties = { display: 'flex', alignItems: 'baseline', gap: 10, padding: '11px 16px', borderBottom: '1px solid var(--line)' };
const SLOT: CSSProperties = { padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--bg-paper)' };
const UP: CSSProperties = { display: 'inline-block', padding: '5px 10px', fontSize: 11.5, fontWeight: 600, border: '1px solid var(--line-strong)', borderRadius: 6, background: 'var(--bg-paper)', color: 'var(--fg)' };
const X: CSSProperties = { border: 'none', background: 'transparent', color: 'var(--fg-3)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '0 2px' };
