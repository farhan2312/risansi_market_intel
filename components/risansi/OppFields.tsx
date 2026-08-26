'use client';

import { type CSSProperties } from 'react';
import { MoneyInput } from './MoneyInput';
import { MonthYearSelect } from './MonthYearSelect';
import { PROBABILITY_CODES, probabilityCodeLabel } from '@/lib/risansi-probability-codes';
import type { OppFieldDef } from '@/lib/risansi-opportunity-fields';

// One renderer for every opportunity field, driven by the catalogue.
//
// It exists because the same field was previously written out by hand in the
// create wizard, the Quoted modal and the edit drawer — three copies that drifted
// until a product type offered in one was rejected by another. A field is now
// described once and drawn once.

export interface FieldValues { [name: string]: string }

export function OppField({ field, value, onChange, disabled, usdRate, options }: {
  field: OppFieldDef;
  value: string;
  onChange: (name: string, value: string) => void;
  disabled?: boolean;
  usdRate?: number;
  /** Runtime options for lists the catalogue cannot know (competitors, drop reasons). */
  options?: readonly string[];
}) {
  const set = (v: string) => onChange(field.name, v);
  const opts = options ?? field.options ?? [];

  const common = { id: field.name, name: field.name, disabled, style: INPUT };

  const control = (() => {
    switch (field.kind) {
      case 'inr':
        return (
          <MoneyInput
            name={field.name} value={value} onChange={set}
            placeholder={field.placeholder} usdRate={usdRate} style={INPUT}
          />
        );
      case 'month':
        return <MonthYearSelect name={field.name} value={value} onChange={set} disabled={disabled} />;
      case 'date':
        return <input {...common} type="date" value={value} onChange={e => set(e.target.value)} />;
      case 'number':
        return <input {...common} type="number" value={value} onChange={e => set(e.target.value)} placeholder={field.placeholder} />;
      case 'textarea':
        return (
          <textarea
            {...common} rows={3} value={value} onChange={e => set(e.target.value)}
            placeholder={field.placeholder}
            style={{ ...INPUT, height: 'auto', resize: 'vertical', lineHeight: 1.5 }}
          />
        );
      case 'prob_code':
        return (
          <select {...common} value={value} onChange={e => set(e.target.value)} style={{ ...INPUT, cursor: 'pointer' }}>
            <option value="">—</option>
            {PROBABILITY_CODES.map(c => (
              <option key={c.code} value={c.code}>{probabilityCodeLabel(c)}</option>
            ))}
            {/* A legacy code that is no longer offered still has to render, or
                opening an old record silently rewrites it on the next save. */}
            {value && !PROBABILITY_CODES.some(c => c.code === value) && (
              <option value={value}>{value}</option>
            )}
          </select>
        );
      case 'select':
        return (
          <select {...common} value={value} onChange={e => set(e.target.value)} style={{ ...INPUT, cursor: 'pointer' }}>
            <option value="">—</option>
            {opts.map(o => <option key={o} value={o}>{o}</option>)}
            {value && !opts.includes(value) && <option value={value}>{value}</option>}
          </select>
        );
      default:
        return <input {...common} type="text" value={value} onChange={e => set(e.target.value)} placeholder={field.placeholder} />;
    }
  })();

  return (
    <div style={{ gridColumn: field.full ? '1 / -1' : undefined, minWidth: 0 }}>
      <label htmlFor={field.name} style={LBL}>
        {field.label}
        {field.requiredAt?.length ? <span style={{ color: 'var(--neg)', marginLeft: 3 }}>*</span> : null}
      </label>
      {control}
      {field.help && <div style={HELP}>{field.help}</div>}
    </div>
  );
}

/** A read-only line for the "already recorded" section. */
export function OppFieldRead({ field, value }: { field: OppFieldDef; value: string }) {
  const shown = value?.trim()
    ? (field.kind === 'inr' ? `₹${Number(value).toLocaleString('en-IN')}` : value)
    : '—';
  return (
    <div style={{ gridColumn: field.full ? '1 / -1' : undefined, minWidth: 0 }}>
      <div style={LBL}>{field.label}</div>
      <div style={{
        fontSize: 12.5, color: value?.trim() ? 'var(--fg)' : 'var(--fg-3)',
        padding: '7px 0', overflowWrap: 'anywhere',
      }}>{shown}</div>
    </div>
  );
}

export const FIELD_GRID: CSSProperties = {
  display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12,
};

const LBL: CSSProperties = {
  display: 'block', fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '0.05em', color: 'var(--fg-3)', marginBottom: 4,
};
const INPUT: CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '8px 10px', fontSize: 13,
  fontFamily: 'inherit', background: 'var(--bg-sunk)', border: '1px solid var(--line-strong)',
  borderRadius: 6, color: 'var(--fg)', outline: 'none', height: 36,
};
const HELP: CSSProperties = { fontSize: 10, color: 'var(--fg-3)', marginTop: 3 };
