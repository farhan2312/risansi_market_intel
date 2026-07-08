'use client';

import { useState, useEffect, type CSSProperties } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { MultiSelectFilter } from './MultiSelectFilter';
import { ActiveFilterBar } from './ActiveFilterBar';
import { DateRangeFilter } from './DateRangeFilter';

// One filter row shared across the Field Activity tabs. Zone / Tour / Rep (non-rep)
// and — on the Visit Reports tab — Search + Purpose sit on the left; the date range
// is right-aligned. All are URL params (server-side), so they work from this single
// row above the tabs, and Search/Purpose scope the whole reports query (not just the
// loaded page). Reports use rsearch/rpurpose/rfrom/rto; the feed uses ffrom/fto.

const CTRL: CSSProperties = {
  padding: '6px 10px', borderRadius: 6, border: '1px solid var(--line-strong)',
  fontSize: 12, fontFamily: 'inherit', background: 'var(--bg-paper)', color: 'var(--fg)',
  outline: 'none', boxSizing: 'border-box',
};

export function FieldFilterBar({ tab, isRep, opts, sel, purposes, search, purpose }: {
  tab: string;
  isRep: boolean;
  opts: { zones: string[]; tours: string[]; reps: string[] };
  sel:  { zones: string[]; tours: string[]; reps: string[] };
  purposes: string[];
  search: string;
  purpose: string;
}) {
  const showReports = tab === 'reports';
  const showDate    = tab === 'reports' || tab === 'feed';
  const fromParam   = tab === 'feed' ? 'ffrom' : 'rfrom';
  const toParam     = tab === 'feed' ? 'fto'   : 'rto';

  const router       = useRouter();
  const pathname     = usePathname();
  const searchParams = useSearchParams();

  const setParam = (key: string, val: string, replace = false) => {
    const p = new URLSearchParams(searchParams.toString());
    if (val) p.set(key, val); else p.delete(key);
    (replace ? router.replace : router.push)(`${pathname}?${p.toString()}`);
  };

  // Debounced search → rsearch (replace, so typing doesn't spam history).
  const [q, setQ] = useState(search);
  useEffect(() => { setQ(search); }, [search]);
  useEffect(() => {
    const t = setTimeout(() => { if (q !== search) setParam('rsearch', q, true); }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const dateFrom = searchParams.get(fromParam) ?? '';
  const dateTo   = searchParams.get(toParam) ?? '';

  // Nothing to show for a rep on the non-report/feed tabs → render nothing.
  if (isRep && !showReports && !showDate) return null;

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginRight: 2 }}>
          Filter
        </span>
        {!isRep && (
          <>
            <MultiSelectFilter param="zone" label="Zone" options={opts.zones} selected={sel.zones} />
            <MultiSelectFilter param="tour" label="Tour" options={opts.tours} selected={sel.tours} />
            <MultiSelectFilter param="rep"  label="Rep"  options={opts.reps}  selected={sel.reps} />
          </>
        )}
        {showReports && (
          <>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search client or code…" style={{ ...CTRL, minWidth: 190 }} />
            <select value={purpose} onChange={e => setParam('rpurpose', e.target.value)} style={CTRL} aria-label="Purpose">
              <option value="">All Purposes</option>
              {purposes.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </>
        )}
        {showDate && (
          <div style={{ marginLeft: 'auto' }}>
            <DateRangeFilter fromParam={fromParam} toParam={toParam} from={dateFrom} to={dateTo} />
          </div>
        )}
      </div>
      {!isRep && (sel.zones.length + sel.tours.length + sel.reps.length > 0) && (
        <ActiveFilterBar filters={[
          { param: 'zone', label: 'Zone', values: sel.zones },
          { param: 'tour', label: 'Tour', values: sel.tours },
          { param: 'rep',  label: 'Rep',  values: sel.reps },
        ]} />
      )}
    </div>
  );
}
