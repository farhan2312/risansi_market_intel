import type { CSSProperties } from 'react';
import Link from 'next/link';
import { ChartPanel, StageKpi, NoData } from '@/components/risansi/StageCharts';
import { StatusChart } from './StatusChart';
import { SEVERITY_TONE, type Severity } from '@/lib/risansi-complaint-flow';
import type { ComplaintSummary, Bar, HolderBar, ClientBar } from '@/lib/risansi-complaint-stats';

// The dashboard above the complaints list.
//
// Server-rendered from summariseComplaints. Every bar is a link into the
// list's own filters, so clicking "QC" under Who holds them narrows the table
// to what QC is sitting on, the way the stage dashboards work. The page owns
// the URL and passes hrefFor; a chosen bar stays lit and the rest step back.

const fmtDays = (d: number | null | undefined) => (d == null ? '—' : d < 1 ? '<1d' : `${d.toFixed(d >= 10 ? 0 : 1)}d`);
const pct = (x: number | null) => (x == null ? '—' : `${Math.round(x * 100)}%`);

export function ComplaintStats({ s, href, sel }: {
  s: ComplaintSummary;
  /** Build the URL that toggles a filter key to a value. */
  href: (key: string, value: string) => string;
  /** The current value of each filter, to light the chosen bar. */
  sel: Record<string, string | undefined>;
}) {
  if (!s.total) return null;
  const net = s.raised30 - s.closed30;
  return (
    <div style={{ marginBottom: 14 }}>
      {/* r-grid-4: two tiles per row on a phone rather than eight in a column. */}
      <div className="r-grid-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 12 }}>
        <StageKpi label="Open" value={String(s.open)} sub={`of ${s.total} · ${s.closed} closed${s.legacy ? ` · ${s.legacy} legacy` : ''}`} />
        <StageKpi label="Overdue" value={String(s.overdue)} sub={s.overdue ? 'past their target completion date' : 'nothing past its target'}
          color={s.overdue ? 'var(--neg)' : undefined} alert={s.overdue > 0} />
        <StageKpi label="Avg age of open" value={fmtDays(s.avgOpenAge)} sub={s.oldestOpen != null ? `oldest ${s.oldestOpen}d` : undefined}
          color={s.avgOpenAge != null && s.avgOpenAge > 30 ? 'var(--warn, #B45309)' : undefined} />
        <StageKpi label="Avg time to close" value={fmtDays(s.avgTimeToClose)}
          sub={s.closedCount ? `median ${fmtDays(s.medianTimeToClose)} · ${s.closedCount} closed` : 'nothing closed yet'} />
        <StageKpi label="Last 30 days" value={`${s.raised30} / ${s.closed30}`}
          sub={`raised / closed · ${net > 0 ? `backlog +${net}` : net < 0 ? `backlog ${net}` : 'backlog flat'}`}
          color={net > 0 ? 'var(--warn, #B45309)' : net < 0 ? 'var(--pos)' : undefined} />
        <StageKpi label="Awaiting closure" value={String(s.resolvedAwaitingClose)} sub="resolved, not yet closed" />
        <StageKpi label="Repeat complaints" value={pct(s.repeatRate)}
          sub={s.repeatRate == null ? 'flagged at closure' : `${s.repeatCount} repeat${s.repeatCount === 1 ? '' : 's'} · ${s.reopened} reopened`}
          color={s.repeatRate != null && s.repeatRate >= 0.2 ? 'var(--neg)' : undefined} />
        <StageKpi label="Workflow" value={String(s.workflow)} sub={`on the new flow · ${s.legacy} legacy read-only`} />
      </div>

      <div className="stage-grid-4">
        <StatusChart
          anySelected={!!sel.state || !!sel.status}
          noteSummary="Still live against done. The same split the Open / Closed toggle above the list uses. Click a bar to filter."
          noteStages="Count in each stage now, and the average days a complaint spends there. Click a stage to filter."
          summary={[
            { key: 'open', label: 'Open', count: s.open, overdue: s.overdue,
              href: href('state', 'open'), on: sel.state === 'open',
              note: s.overdue ? `${s.overdue} overdue` : 'none overdue' },
            { key: 'closed', label: 'Closed', count: s.closed, done: true,
              href: href('state', 'closed'), on: sel.state === 'closed',
              note: s.resolvedAwaitingClose ? `${s.resolvedAwaitingClose} awaiting closure` : 'all closed out' },
          ]}
          stages={s.funnel.map(x => ({
            key: x.status, label: x.status, count: x.count,
            done: x.status === 'Resolved' || x.status === 'Closed',
            href: href('status', x.status), on: sel.status === x.status,
            note: x.stretches ? fmtDays(x.avgDays) : undefined,
          }))}
        />
        <ChartPanel title="Open by severity" note="Computed from the risk page. Red part is overdue. Click to filter.">
          <Bars rows={s.bySeverity.filter(b => b.count || b.key !== 'none')} href={v => href('sev', v)} selected={sel.sev}
            tone={b => (b.key === 'none' ? 'var(--fg-3)' : SEVERITY_TONE[b.key as Severity])} empty="No open complaints on the workflow." />
        </ChartPanel>
        <ChartPanel title="Who holds them now" sub="by department" note="Open complaints each department is sitting on, and the days they have held them in total. Click to filter.">
          <Holders rows={s.byHolderDept} href={v => href('dept', v)} selected={sel.dept} />
        </ChartPanel>
        <ChartPanel title="Who sits longest" sub="named holders" note="Days of open time each person has held, across every complaint. Longest first. Click to see theirs.">
          <Holders rows={s.byHolderPerson.slice(0, 8)} person href={v => href('holder', v)} selected={sel.holder} />
        </ChartPanel>
      </div>

      <div className="stage-grid-4">
        <ChartPanel title="Responsible department" sub="who caused it" note="From the registration page, corrected at investigation. Click to filter.">
          <Bars rows={s.byResponsible} href={v => href('resp', v)} selected={sel.resp} empty="Not recorded yet." />
        </ChartPanel>
        <ChartPanel title="Defect category" note="Click to filter.">
          <Bars rows={s.byCategory.slice(0, 8)} href={v => href('cat', v)} selected={sel.cat} empty="Not recorded yet." />
        </ChartPanel>
        <ChartPanel title="Type · open by rep" note="Technical goes to QC; Non-technical stays with the Complaint Team. Then who the open ones belong to.">
          <Bars rows={s.byType} href={v => href('type', v)} selected={sel.type} empty="Not recorded yet." />
          {s.byRep.length > 0 && (
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--line-2)' }}>
              <Bars rows={s.byRep.slice(0, 6)} href={undefined} selected={undefined} empty="" compact />
            </div>
          )}
        </ChartPanel>
        <ChartPanel title="Raised vs closed" sub="last 12 months" note="Raised by complaint date, closed by the month it was resolved or closed.">
          <PairBars points={s.months} />
        </ChartPanel>
      </div>

      {s.byClient.length > 0 && (
        <div className="stage-grid-4">
          <div className="stage-span-3">
            <ChartPanel title="Clients complaining most" sub={`${s.clientCount} client${s.clientCount === 1 ? '' : 's'}`}
              note="Every complaint in view, counted by account. Red is overdue. Click a client to see only theirs.">
              <Clients rows={s.byClient.slice(0, 10)} href={v => href('client', v)} selected={sel.client} />
            </ChartPanel>
          </div>
          <ChartPanel title="How concentrated" note="A handful of accounts usually carry most of the complaints. This says how far that goes.">
            <Concentration rows={s.byClient} total={s.total} />
          </ChartPanel>
        </div>
      )}

      {s.longestSitting.length > 0 && (
        <div style={{ ...PANEL, padding: '10px 14px', display: 'flex', gap: 14, alignItems: 'baseline', flexWrap: 'wrap', fontSize: 11.5 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-3)' }}>Sitting longest right now</span>
          {s.longestSitting.map(r => (
            <Link key={r.id} href={`/risansi/complaints/${r.id}`} style={{ color: 'inherit', textDecoration: 'none' }}
              title={`${r.client_name ?? ''} · ${r.status} · with ${r.holder_name ?? r.holder_department ?? 'Complaint Team'}`}>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-2)' }}>{r.complaint_no}</span>
              <span style={{ color: 'var(--fg-3)' }}> · {r.holder_name ?? r.holder_department}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: r.days_in_status > 7 ? 'var(--neg)' : 'var(--fg)', marginLeft: 4 }}>{fmtDays(r.days_in_status)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Plain count bars with an overdue part ──────────────────────

function Bars({ rows, href, selected, tone, empty, compact }: {
  rows: Bar[]; href?: (v: string) => string; selected?: string; tone?: (b: Bar) => string; empty: string; compact?: boolean;
}) {
  if (!rows.length) return empty ? <NoData msg={empty} /> : null;
  const max = Math.max(...rows.map(r => r.count), 1);
  const any = !!selected;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 4 : 6 }}>
      {rows.map(r => {
        const on = selected === r.key;
        const hue = tone ? tone(r) : 'var(--accent)';
        const inner = (
          <>
            <span style={{ ...LBL, flex: compact ? '0 1 110px' : '0 1 130px', fontSize: compact ? 10.5 : 11 }}>{r.label}</span>
            <div style={{ flex: 1, minWidth: 40, height: compact ? 10 : 14, background: 'var(--bg-sunk)', borderRadius: 4, overflow: 'hidden', display: 'flex' }}>
              {(r.overdue ?? 0) > 0 && <div style={{ width: `${((r.overdue ?? 0) / max) * 100}%`, background: 'var(--neg)' }} />}
              <div style={{ width: `${((r.count - (r.overdue ?? 0)) / max) * 100}%`, background: `color-mix(in oklab, ${hue} 60%, transparent)` }} />
            </div>
            <span style={NUM}>{r.count}</span>
            {!compact && <span style={{ ...NUM, width: 30, color: r.overdue ? 'var(--neg)' : 'var(--fg-4)', fontSize: 10.5 }}>{r.overdue || '·'}</span>}
          </>
        );
        const style: CSSProperties = { ...ROW, opacity: any && !on ? 0.4 : 1, outline: on ? '2px solid var(--accent)' : 'none' };
        return href ? <a key={r.key} href={href(r.key)} style={style} title={`${r.label}: ${r.count}${r.overdue ? ` · ${r.overdue} overdue` : ''}`}>{inner}</a>
          : <div key={r.key} style={style}>{inner}</div>;
      })}
    </div>
  );
}

// ── Clients: how many complaints each account has raised ───────

function Clients({ rows, href, selected }: { rows: ClientBar[]; href: (v: string) => string; selected?: string }) {
  if (!rows.length) return <NoData msg="No complaints against a client yet." />;
  const max = Math.max(...rows.map(r => r.count), 1);
  const any = !!selected;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {rows.map(r => {
        const on = selected === r.key;
        return (
          <a key={r.key} href={href(r.key)} style={{ ...ROW, opacity: any && !on ? 0.4 : 1, outline: on ? '2px solid var(--accent)' : 'none' }}
            title={`${r.label}${r.code ? ` (${r.code})` : ''}: ${r.count} complaint${r.count === 1 ? '' : 's'}${r.open ? ` · ${r.open} open` : ' · all closed'}${r.overdue ? ` · ${r.overdue} overdue` : ''}${r.repeats ? ` · ${r.repeats} flagged as a repeat` : ''} · last raised ${r.last || 'unknown'}`}>
            <span style={{ ...LBL, flex: '0 1 230px' }}>{r.label}</span>
            <div style={{ flex: 1, minWidth: 40, height: 14, background: 'var(--bg-sunk)', borderRadius: 4, overflow: 'hidden', display: 'flex' }}>
              {r.overdue > 0 && <div style={{ width: `${(r.overdue / max) * 100}%`, background: 'var(--neg)' }} />}
              {r.open - r.overdue > 0 && <div style={{ width: `${((r.open - r.overdue) / max) * 100}%`, background: 'color-mix(in oklab, var(--warn, #B45309) 60%, transparent)' }} />}
              <div style={{ width: `${((r.count - r.open) / max) * 100}%`, background: 'color-mix(in oklab, var(--pos) 40%, transparent)' }} />
            </div>
            {r.repeats > 0 && <span style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--neg)' }} title={`${r.repeats} flagged as a repeat of an earlier complaint`}>↻{r.repeats}</span>}
            <span style={NUM}>{r.count}</span>
            <span style={{ ...NUM, width: 30, fontSize: 10.5, color: r.open ? 'var(--warn, #B45309)' : 'var(--fg-4)' }}>{r.open || '·'}</span>
          </a>
        );
      })}
      <div style={{ display: 'flex', gap: 12, fontSize: 9.5, color: 'var(--fg-3)', marginTop: 2 }}>
        <span><Swatch c="var(--neg)" /> overdue</span>
        <span><Swatch c="var(--warn, #B45309)" /> open</span>
        <span><Swatch c="var(--pos)" /> closed</span>
        <span style={{ marginLeft: 'auto' }}>total · open</span>
      </div>
    </div>
  );
}

// How much of the total sits with the worst few accounts. One client with ten
// complaints is a different problem from ten clients with one each.
function Concentration({ rows, total }: { rows: ClientBar[]; total: number }) {
  if (!total) return <NoData msg="Nothing to count." />;
  const share = (n: number) => rows.slice(0, n).reduce((a, r) => a + r.count, 0);
  const repeatClients = rows.filter(r => r.count > 1).length;
  const lines: [string, string][] = [
    ['Top client', `${rows[0].count} of ${total} · ${Math.round((rows[0].count / total) * 100)}%`],
    ['Top 5', `${share(5)} of ${total} · ${Math.round((share(5) / total) * 100)}%`],
    ['Top 10', `${share(10)} of ${total} · ${Math.round((share(10) / total) * 100)}%`],
    ['More than one', `${repeatClients} client${repeatClients === 1 ? '' : 's'}`],
    ['Exactly one', `${rows.length - repeatClients} client${rows.length - repeatClients === 1 ? '' : 's'}`],
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      {lines.map(([l, v]) => (
        <div key={l} style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ ...LBL, flex: 1 }}>{l}</span>
          <span style={{ fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--fg)' }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

// ── Holders: open now (bar = days sitting) + historic total ────

function Holders({ rows, href, selected, person }: { rows: HolderBar[]; href: (v: string) => string; selected?: string; person?: boolean }) {
  if (!rows.length) return <NoData msg="Nothing on the workflow yet." />;
  const max = Math.max(...rows.map(r => Math.max(r.days, r.totalDays)), 1);
  const any = !!selected;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      {rows.map((r, i) => {
        const key = person ? String(r.userId ?? '') : r.department;
        const on = selected === key && key !== '';
        const link = !person || r.userId != null;
        const inner = (
          <>
            <span style={{ ...LBL, flex: '0 1 130px' }} title={r.label}>{r.label}</span>
            <div style={{ flex: 1, minWidth: 40, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ height: 9, background: 'var(--bg-sunk)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ width: `${(r.days / max) * 100}%`, height: '100%', background: i === 0 && r.days > 0 ? 'var(--neg)' : 'color-mix(in oklab, var(--accent) 60%, transparent)' }} />
              </div>
              <div style={{ height: 5, background: 'var(--bg-sunk)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ width: `${(r.totalDays / max) * 100}%`, height: '100%', background: 'color-mix(in oklab, var(--fg-3) 45%, transparent)' }} />
              </div>
            </div>
            <span style={{ ...NUM, width: 26 }}>{r.open}</span>
            <span style={{ ...NUM, width: 40, color: r.days > 14 ? 'var(--neg)' : 'var(--fg)' }}>{fmtDays(r.days)}</span>
            <span style={{ ...NUM, width: 40, color: 'var(--fg-3)', fontWeight: 400 }}>{fmtDays(r.totalDays)}</span>
          </>
        );
        const style: CSSProperties = { ...ROW, opacity: any && !on ? 0.4 : 1, outline: on ? '2px solid var(--accent)' : 'none' };
        const title = `${r.label}: ${r.open} open now, ${fmtDays(r.days)} sitting · ${fmtDays(r.totalDays)} held in all over ${r.stretches} stretch${r.stretches === 1 ? '' : 'es'} (avg ${fmtDays(r.avgDays)})`;
        return link ? <a key={r.key} href={href(key)} style={style} title={title}>{inner}</a> : <div key={r.key} style={style} title={title}>{inner}</div>;
      })}
      <div style={{ display: 'flex', fontSize: 9.5, color: 'var(--fg-3)', gap: 9, flexWrap: 'wrap' }}>
        <span style={{ flex: 1, minWidth: 140 }}><Swatch c="color-mix(in oklab, var(--accent) 60%, transparent)" /> sitting now <Swatch c="color-mix(in oklab, var(--fg-3) 45%, transparent)" /> held in all</span>
        <span style={{ width: 26, textAlign: 'right' }}>open</span><span style={{ width: 40, textAlign: 'right' }}>now</span><span style={{ width: 40, textAlign: 'right' }}>ever</span>
      </div>
    </div>
  );
}

// ── Two series per month ───────────────────────────────────────

function PairBars({ points, height = 100 }: { points: { key: string; label: string; raised: number; closed: number }[]; height?: number }) {
  const max = Math.max(...points.flatMap(p => [p.raised, p.closed]), 1);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: height + 36 }}>
        {points.map(p => (
          <div key={p.key} title={`${p.label}: ${p.raised} raised · ${p.closed} closed`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: 4, minWidth: 0 }}>
            <div style={{ display: 'flex', gap: 2, width: '100%', alignItems: 'flex-end', height }}>
              {[['raised', p.raised, 'var(--accent)'], ['closed', p.closed, 'var(--pos)']].map(([k, n, hue]) => (
                <div key={String(k)} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: 2 }}>
                  <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: n ? 'var(--fg-2)' : 'var(--fg-4)' }}>{Number(n) || ''}</span>
                  <div style={{ width: '100%', height: Math.max((Number(n) / max) * (height - 14), n ? 3 : 0), background: `color-mix(in oklab, ${hue} 22%, transparent)`, borderTop: `3px solid ${hue}`, borderRadius: '3px 3px 0 0' }} />
                </div>
              ))}
            </div>
            <span style={{ fontSize: 9.5, color: 'var(--fg-3)' }}>{p.label}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 12, fontSize: 9.5, color: 'var(--fg-3)', marginTop: 4 }}>
        <span><Swatch c="var(--accent)" /> raised</span><span><Swatch c="var(--pos)" /> closed</span>
      </div>
    </div>
  );
}

const Swatch = ({ c }: { c: string }) => <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: c, marginRight: 3, verticalAlign: 'middle' }} />;

const PANEL: CSSProperties = { background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)' };
const ROW: CSSProperties = { display: 'flex', alignItems: 'center', gap: 9, textDecoration: 'none', color: 'inherit', outlineOffset: 2, borderRadius: 4 };
const LBL: CSSProperties = { minWidth: 0, fontSize: 11, color: 'var(--fg-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const NUM: CSSProperties = { width: 34, flexShrink: 0, textAlign: 'right', fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--fg)' };
