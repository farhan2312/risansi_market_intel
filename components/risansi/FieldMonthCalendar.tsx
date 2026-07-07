import type { CSSProperties } from 'react';

// Month / Quarter calendar for Field Activity. Each day box holds *every* rep's
// visits for that day, colour-coded by rep (the week grid stays as a separate
// view). `month` renders one full-detail grid; `quarter` renders three compact
// month grids side by side (dots instead of chips — a zoomed-out load view).

export interface CalDayVisit {
  id:          string;
  visit_date:  string;   // 'YYYY-MM-DD'
  status:      string;
  purpose:     string;
  client_name: string;
  client_code: string;
  rep_id:      string;
  rep_name:    string;
}

// Distinct, reasonably distinguishable hues. Reps map to a colour by their index
// in the (stable, name-sorted) colour basis, cycling if there are more than 16.
const REP_PALETTE = [
  '#2563EB', '#0E9F6E', '#D97706', '#7C3AED', '#DB2777', '#0891B2',
  '#65A30D', '#DC2626', '#4F46E5', '#EA580C', '#0D9488', '#9333EA',
  '#CA8A04', '#E11D48', '#0369A1', '#15803D',
];

const pad2  = (n: number) => String(n).padStart(2, '0');
const isoOf = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

// Weeks (Mon-first) covering `m0` (0-indexed month) of `year`, including the
// leading/trailing days from adjacent months so every row is full. Trailing
// all-other-month weeks are trimmed.
function monthWeeks(year: number, m0: number) {
  const first    = new Date(year, m0, 1);
  const startOff = (first.getDay() + 6) % 7;              // 0 = Mon
  const start    = new Date(year, m0, 1 - startOff);
  const weeks: { date: string; dayNum: number; om: boolean }[][] = [];
  for (let w = 0; w < 6; w++) {
    const days: { date: string; dayNum: number; om: boolean }[] = [];
    for (let d = 0; d < 7; d++) {
      const dd = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + d);
      days.push({ date: isoOf(dd), dayNum: dd.getDate(), om: dd.getMonth() !== m0 });
    }
    weeks.push(days);
  }
  while (weeks.length > 4 && weeks[weeks.length - 1].every(x => x.om)) weeks.pop();
  return weeks;
}

const WD_FULL  = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function FieldMonthCalendar({
  view, months, visits, reps, todayISO, purposeColors,
}: {
  view:          'month' | 'quarter';
  months:        { year: number; month: number; label: string }[];
  visits:        CalDayVisit[];
  reps:          { id: string; name: string }[];   // stable colour basis
  todayISO:      string;
  purposeColors: Record<string, string>;
}) {
  const compact  = view === 'quarter';
  const repIndex = new Map(reps.map((r, i) => [r.id, i]));
  const repColor = (id: string) => REP_PALETTE[(repIndex.get(id) ?? 0) % REP_PALETTE.length];

  // Group visits by day, and collect the reps that actually appear (for the legend).
  const byDate = new Map<string, CalDayVisit[]>();
  const seen   = new Map<string, string>();   // rep_id → rep_name
  for (const v of visits) {
    const arr = byDate.get(v.visit_date) ?? [];
    arr.push(v);
    byDate.set(v.visit_date, arr);
    if (v.rep_id) seen.set(v.rep_id, v.rep_name);
  }
  const legendReps = [...seen.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const cellCap = compact ? 6 : 3;

  const renderMonth = (mo: { year: number; month: number; label: string }) => (
    <div key={`${mo.year}-${mo.month}`}>
      {compact && (
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)', marginBottom: 6 }}>{mo.label}</div>
      )}
      <div style={{
        background: 'var(--bg-paper)', border: '1px solid var(--line)',
        borderRadius: 'var(--radius)', overflow: 'hidden',
      }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid var(--line)' }}>
          {WD_FULL.map(d => (
            <div key={d} style={{
              padding: compact ? '5px 4px' : '7px 6px', textAlign: 'center',
              fontSize: 10, fontWeight: 600, color: 'var(--fg-3)',
              textTransform: 'uppercase', letterSpacing: '0.05em', background: 'var(--bg-elev)',
            }}>
              {compact ? d[0] : d}
            </div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
          {monthWeeks(mo.year, mo.month).flat().map(day => {
            const dv      = byDate.get(day.date) ?? [];
            const isToday = day.date === todayISO;
            return (
              <div key={day.date} style={{
                minHeight: compact ? 46 : 98,
                borderRight: '1px solid var(--line)', borderBottom: '1px solid var(--line)',
                padding: compact ? '3px 4px' : '4px 5px',
                background: day.om ? 'var(--bg-elev)' : 'var(--bg-paper)',
                display: 'flex', flexDirection: 'column', gap: compact ? 2 : 3,
                opacity: day.om ? 0.55 : 1,
              }}>
                <div style={{
                  fontSize: 10, fontWeight: 600, alignSelf: 'flex-end', lineHeight: 1.4,
                  color: day.om ? 'var(--fg-3)' : 'var(--fg-2)',
                }}>
                  {isToday
                    ? <span style={{ background: '#0A3D8F', color: '#fff', borderRadius: 999, padding: '0 6px' }}>{day.dayNum}</span>
                    : day.dayNum}
                </div>

                {compact ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, alignContent: 'flex-start' }}>
                    {dv.slice(0, cellCap).map(v => (
                      <span key={v.id} title={`${v.client_name} · ${v.rep_name}`} style={{
                        width: 8, height: 8, borderRadius: 999, background: repColor(v.rep_id), flexShrink: 0,
                      }} />
                    ))}
                    {dv.length > cellCap && (
                      <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--fg-3)', lineHeight: '8px' }}>+{dv.length - cellCap}</span>
                    )}
                  </div>
                ) : (
                  <>
                    {dv.slice(0, cellCap).map(v => (
                      <div key={v.id}
                        title={`${v.client_name} · ${v.rep_name} · ${v.purpose || 'Routine'}`}
                        style={{
                          borderLeft: `3px solid ${repColor(v.rep_id)}`, background: 'var(--bg-elev)',
                          padding: '2px 5px', overflow: 'hidden',
                        }}>
                        <div style={{
                          fontSize: 12, color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: 4,
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                          <span style={{
                            width: 6, height: 6, borderRadius: 999, flexShrink: 0,
                            background: purposeColors[v.purpose] ?? '#6B7FA3',
                          }} />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.client_name}</span>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--fg-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {v.rep_name}
                        </div>
                      </div>
                    ))}
                    {dv.length > cellCap && (
                      <div style={{ fontSize: 11, fontWeight: 500, color: '#1A5CB8', paddingLeft: 2 }}>+{dv.length - cellCap} more</div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  const gridStyle: CSSProperties = compact
    ? { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }
    : { display: 'block' };

  return (
    <div>
      <div style={gridStyle}>
        {months.map(renderMonth)}
      </div>

      {legendReps.length > 0 && (
        <div style={{
          marginTop: 12, padding: '10px 14px', background: 'var(--bg-elev)',
          border: '1px solid var(--line)', borderRadius: 'var(--radius)',
          display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center',
        }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Reps</span>
          {legendReps.map(r => (
            <span key={r.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--fg-2)' }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: repColor(r.id), flexShrink: 0 }} />
              {r.name}
            </span>
          ))}
          <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: 'var(--fg-3)' }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: '#6B7FA3', flexShrink: 0 }} />
            dot = visit purpose
          </span>
        </div>
      )}
    </div>
  );
}
