'use client';

import { useMemo, useState, useTransition, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { saveComplaintPage, lookupPump } from '@/app/actions/risansi-complaints-v2';
import {
  isFieldShown, missingOnPage, severityOf, SEVERITY_LABEL, SEVERITY_REQUIRES, SEVERITY_TONE, RISK_FIELDS,
  type ComplaintPage, type ComplaintField, type ComplaintValues, type Severity,
} from '@/lib/risansi-complaint-flow';

// One page of a complaint, drawn from the catalogue in lib/risansi-complaint-flow.
//
// Every page uses this: the fields come from PAGES, the dropdowns from the
// lookups table, the people from the users list. It is controlled, saves the
// whole page in one action, and hides a conditional field the moment its
// condition stops holding. Page 3 computes the severity live from the same
// severityOf the server uses, so what the form shows is what will be stored.

export interface UserOpt { id: number; name: string; role?: string | null; departments?: string[] }

export function ComplaintPageForm({ complaintId, clientId, page, initial, lookups, users, canEdit, whyNot }: {
  complaintId: number;
  clientId: number | null;
  page: ComplaintPage;
  initial: ComplaintValues;
  lookups: Record<string, string[]>;
  users: UserOpt[];
  canEdit: boolean;
  /** One sentence on why the page is read-only, when it is. */
  whyNot?: string | null;
}) {
  const router = useRouter();
  const [values, setValues] = useState<ComplaintValues>(() => {
    const v: ComplaintValues = {};
    for (const f of page.fields) v[f.name] = initial[f.name] ?? (f.type === 'bool' ? null : '');
    return v;
  });
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [looking, setLooking] = useState(false);

  const set = (name: string, v: unknown) => { setValues(cur => ({ ...cur, [name]: v })); setMsg(null); };

  // Page 3 only: what the answers so far make the severity.
  const liveSeverity: Severity | null = useMemo(
    () => (page.id === 3 ? severityOf(values as Parameters<typeof severityOf>[0]) : null), [page.id, values]);

  const missing = missingOnPage(page, values);

  const save = () => {
    setMsg(null);
    start(async () => {
      const out: Record<string, unknown> = {};
      for (const f of page.fields) out[f.name] = isFieldShown(f, values) ? values[f.name] : null;
      const res = await saveComplaintPage(complaintId, page.id, out);
      if (!res.ok) { setMsg({ ok: false, text: res.error }); return; }
      setMsg({ ok: true, text: `${page.title} saved.` });
      router.refresh();
    });
  };

  // Page 2: the installed base, by EC number or serial. Fills blanks only.
  const lookup = async (q: string) => {
    if (!q || q.trim().length < 3) return;
    setLooking(true);
    const res = await lookupPump(q, clientId);
    setLooking(false);
    if (!res.ok) { setMsg({ ok: false, text: res.error }); return; }
    if (!res.data) { setMsg({ ok: false, text: `Nothing in the installed base matches "${q}". Type the details in; they are saved as typed.` }); return; }
    const d = res.data;
    const fill: Record<string, unknown> = { so_no: d.so_no, ec_no: d.ec_no, pump_serial_no: d.pump_serial_no, pump_model: d.pump_model, liquid: d.liquid, head_pressure: d.head_pressure, quantity: d.quantity };
    let n = 0;
    setValues(cur => {
      const next = { ...cur };
      for (const [k, v] of Object.entries(fill)) if (v != null && v !== '' && (next[k] == null || next[k] === '')) { next[k] = v; n++; }
      return next;
    });
    setMsg({ ok: true, text: `Found ${d.client_name ? `on ${d.client_name}` : 'it'}${d.matches > 1 ? ` (${d.matches} rows, first used)` : ''}. Filled ${n} blank field${n === 1 ? '' : 's'} — check them.` });
  };

  const grid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: '12px 16px' };

  return (
    <div>
      {!canEdit && (
        <div style={{ ...NOTE, background: 'var(--bg-elev)', border: '1px solid var(--line)', color: 'var(--fg-2)' }}>
          <span aria-hidden>👁</span> Read only. {whyNot ?? `${page.title} is edited by ${page.owner}.`}
        </div>
      )}

      {page.id === 3 && (
        <div style={{ ...NOTE, background: liveSeverity ? `color-mix(in oklab, ${SEVERITY_TONE[liveSeverity]} 10%, transparent)` : 'var(--bg-elev)',
                      border: `1px solid ${liveSeverity ? SEVERITY_TONE[liveSeverity] : 'var(--line)'}` }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: liveSeverity ? SEVERITY_TONE[liveSeverity] : 'var(--fg-2)' }}>
            {liveSeverity ? SEVERITY_LABEL[liveSeverity] : 'Severity — answer the questions below'}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--fg-2)', marginTop: 2 }}>
            {liveSeverity ? SEVERITY_REQUIRES[liveSeverity] : 'Computed from the answers, never typed. The highest level with any Yes wins.'}
          </div>
        </div>
      )}

      <div style={grid}>
        {page.fields.map(f => {
          if (!isFieldShown(f, values)) return null;
          const wide = f.type === 'long';
          return (
            <div key={f.name} style={wide ? { gridColumn: '1 / -1' } : undefined}>
              <label style={LBL}>
                {f.label}{f.required && <span style={{ color: 'var(--neg)', marginLeft: 3 }}>*</span>}
                {page.id === 3 && (() => { const r = RISK_FIELDS.find(x => x.key === f.name); return r ? <span style={{ ...SEV, color: SEVERITY_TONE[r.level] }}>{r.level}</span> : null; })()}
              </label>
              <Field f={f} value={values[f.name]} onChange={v => set(f.name, v)} disabled={!canEdit || pending}
                lookups={lookups} users={users}
                onLookup={page.id === 2 && f.fromPump && (f.name === 'ec_no' || f.name === 'pump_serial_no') ? () => lookup(String(values[f.name] ?? '')) : undefined}
                looking={looking} />
              {f.hint && <div style={HINT}>{f.hint}</div>}
            </div>
          );
        })}
      </div>

      {msg && (
        <div style={{ ...NOTE, marginTop: 14, background: msg.ok ? 'var(--pos-soft)' : 'var(--neg-soft)', border: `1px solid ${msg.ok ? 'var(--pos)' : 'var(--neg)'}`, color: msg.ok ? 'var(--pos)' : 'var(--neg-strong, var(--neg))' }}>
          {msg.text}
        </div>
      )}

      {canEdit && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
          <button type="button" onClick={save} disabled={pending} style={{ ...PRIMARY, opacity: pending ? 0.6 : 1 }}>
            {pending ? 'Saving…' : `Save ${page.title}`}
          </button>
          <span style={{ fontSize: 11, color: missing.length ? 'var(--warn, #B45309)' : 'var(--fg-3)' }}>
            {missing.length ? `Still needed before this page counts as complete: ${missing.join(', ')}` : 'Every required field on this page is filled.'}
          </span>
        </div>
      )}
    </div>
  );
}

export function Field({ f, value, onChange, disabled, lookups, users, onLookup, looking }: {
  f: ComplaintField; value: unknown; onChange: (v: unknown) => void; disabled: boolean;
  lookups: Record<string, string[]>; users: UserOpt[]; onLookup?: () => void; looking?: boolean;
}) {
  const s = value == null ? '' : String(value);
  switch (f.type) {
    case 'long':
      return <textarea value={s} onChange={e => onChange(e.target.value)} disabled={disabled} rows={3} style={{ ...INPUT, height: 'auto', resize: 'vertical', lineHeight: 1.5 }} />;
    case 'date':
      return <input type="date" value={s.slice(0, 10)} onChange={e => onChange(e.target.value)} disabled={disabled} style={INPUT} />;
    case 'number':
      return <input type="number" value={s} onChange={e => onChange(e.target.value)} disabled={disabled} style={INPUT} />;
    case 'money':
      return <input inputMode="decimal" value={s} onChange={e => onChange(e.target.value)} disabled={disabled} placeholder="₹" style={INPUT} />;
    case 'bool':
      return (
        <div style={{ display: 'flex', gap: 6 }}>
          {[['Yes', true], ['No', false]].map(([lbl, v]) => (
            <button key={String(lbl)} type="button" disabled={disabled} onClick={() => onChange(value === v ? null : v)}
              style={{ ...CHOICE, ...(value === v ? (v ? CHOICE_YES : CHOICE_NO) : {}) }}>{lbl as string}</button>
          ))}
        </div>
      );
    case 'yesno4':
      return <Choices value={s} onChange={onChange} disabled={disabled} options={['Yes', 'No', 'Issued', 'NA']} />;
    case 'paid':
      return <Choices value={s} onChange={onChange} disabled={disabled} options={['Paid', 'To Pay']} />;
    case 'select': {
      const opts = lookups[f.lookup ?? ''] ?? [];
      const has = !s || opts.includes(s);
      return (
        <select value={s} onChange={e => onChange(e.target.value)} disabled={disabled} style={INPUT}>
          <option value="">—</option>
          {!has && <option value={s}>{s} (not on the list)</option>}
          {opts.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    }
    case 'user': {
      const id = value == null || value === '' ? '' : String(value);
      return (
        <select value={id} onChange={e => onChange(e.target.value ? Number(e.target.value) : null)} disabled={disabled} style={INPUT}>
          <option value="">—</option>
          {users.map(u => <option key={u.id} value={u.id}>{u.name}{u.departments?.length ? ` · ${u.departments.join(', ')}` : u.role ? ` · ${u.role}` : ''}</option>)}
        </select>
      );
    }
    default:
      return (
        <div style={{ display: 'flex', gap: 6 }}>
          <input value={s} onChange={e => onChange(e.target.value)} disabled={disabled} style={INPUT}
            onKeyDown={e => { if (e.key === 'Enter' && onLookup) { e.preventDefault(); onLookup(); } }} />
          {onLookup && (
            <button type="button" onClick={onLookup} disabled={disabled || looking || s.trim().length < 3} title="Look this up in the installed base and fill what it knows"
              style={{ ...GHOST, whiteSpace: 'nowrap', opacity: s.trim().length < 3 ? 0.5 : 1 }}>{looking ? '…' : 'Look up'}</button>
          )}
        </div>
      );
  }
}

function Choices({ value, onChange, disabled, options }: { value: string; onChange: (v: unknown) => void; disabled: boolean; options: string[] }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {options.map(o => (
        <button key={o} type="button" disabled={disabled} onClick={() => onChange(value === o ? '' : o)}
          style={{ ...CHOICE, ...(value === o ? CHOICE_ON : {}) }}>{o}</button>
      ))}
    </div>
  );
}

export const LBL: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--fg-3)', marginBottom: 4 };
export const SEV: CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 9.5, fontWeight: 700, textTransform: 'none', letterSpacing: 0 };
export const HINT: CSSProperties = { fontSize: 10.5, color: 'var(--fg-3)', marginTop: 3, lineHeight: 1.4 };
export const INPUT: CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '8px 10px', fontSize: 13, fontFamily: 'inherit',
  background: 'var(--bg-sunk)', border: '1px solid var(--line-strong)', borderRadius: 6, color: 'var(--fg)', outline: 'none', height: 36,
};
export const NOTE: CSSProperties = { padding: '9px 12px', borderRadius: 6, fontSize: 12, marginBottom: 14, lineHeight: 1.5 };
const CHOICE: CSSProperties = {
  padding: '7px 12px', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', borderRadius: 6, cursor: 'pointer',
  background: 'var(--bg-paper)', color: 'var(--fg-2)', border: '1px solid var(--line-strong)',
};
const CHOICE_ON: CSSProperties = { background: '#0A3D8F', color: '#fff', borderColor: '#0A3D8F' };
// A chosen Yes is navy like any other choice; a chosen No is grey. Yes is not
// "bad" everywhere — "customer confirmed the fix" is a good Yes.
const CHOICE_YES: CSSProperties = CHOICE_ON;
const CHOICE_NO: CSSProperties = { background: 'var(--fg-3)', color: '#fff', borderColor: 'var(--fg-3)' };
export const PRIMARY: CSSProperties = { border: 'none', background: '#0A3D8F', color: '#fff', borderRadius: 6, fontSize: 13, fontWeight: 600, padding: '9px 18px', cursor: 'pointer', fontFamily: 'inherit' };
export const GHOST: CSSProperties = { border: '1px solid var(--line-strong)', background: 'var(--bg-paper)', color: 'var(--fg)', borderRadius: 6, fontSize: 12, fontWeight: 600, padding: '7px 12px', cursor: 'pointer', fontFamily: 'inherit' };
