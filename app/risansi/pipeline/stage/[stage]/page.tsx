import type { CSSProperties } from 'react';
import { notFound } from 'next/navigation';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { Topbar } from '@/components/risansi';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser, clientScopeSql } from '@/lib/risansi-auth';
import { fmtCr, fmtUsdFromCr } from '@/lib/risansi-utils';
import { getUsdRate } from '@/lib/risansi-settings';
import { fmtUsdFromInr } from '@/lib/risansi-offer-revisions';
import { parseOppFilters, buildOppFilter, oppFilterQuery } from '@/lib/risansi-opp-filters';
import { quotationHref, isLegacyQuotation, quotationLinkCount } from '@/lib/risansi-quotation-link';
import { LegacyMark } from '@/components/risansi/QuotationLinkView';
import {
  stageFromSlug, STAGE_COLOR, STAGE_BLURB, STAGE_COLUMNS, ageBasisSql, summariseStage,
} from '@/lib/risansi-stage-dashboard';
import {
  ChartPanel, BarList, AgeingBars, StackedBar, TrendBars, OfferMovement, StageKpi,
  NoData, CHART_GRID,
} from '@/components/risansi/StageCharts';

// A dashboard for one pipeline stage: what sits here, what shape it's in, and
// the full list underneath. Reached by clicking a column header on the board.
//
// Every number on the page — tiles, charts, table — is derived from ONE query
// for the stage's rows. Aggregating in JS rather than issuing a query per chart
// costs nothing at these volumes (907 rows in the largest stage) and buys the
// guarantee that a chart can never disagree with the table below it.

export const dynamic = 'force-dynamic';

interface Row {
  id: string; product: string; product_type: string | null; stage: string;
  value_cr: number; final_cr: number | null;
  quote_ref: string | null; quote_date: string | null; market: string | null;
  client_id: string; client_name: string; client_code: string;
  industry: string | null; client_type: string | null;
  rep_name: string | null; tour_name: string | null;
  offer_inr: number | null; revised_inr: number | null; revised_on: string | null; rev_count: number;
  so_sum_cr: number; so_numbers: string | null; po_number: string | null;
  lost_to_competitor: string | null; lost_reason: string | null; drop_reason: string | null;
  quotation_link: string | null;
  doc_count: number;
  age_days: number | null;
}

const PAGE_SIZE = 100;

export default async function StageDashboardPage({ params, searchParams }: {
  params: Promise<{ stage: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { stage: slug } = await params;
  const stage = stageFromSlug(slug);
  if (!stage) notFound();

  const sp = await searchParams;

  // ── Scope, exactly as the board does it ──────────────────────
  const session = await getServerSession(authOptions);
  const role    = session?.user?.role ?? 'rep';
  let currentRepId: number | null = session?.user?.repId ?? null;
  if (role === 'rep' && currentRepId == null && session?.user?.email) {
    const r = await risansiPool.query<{ id: number }>(
      'SELECT id FROM users WHERE lower(email) = lower($1) LIMIT 1', [session.user.email]);
    currentRepId = r.rows[0]?.id ?? null;
  }

  // The board's filters ride in on the URL, minus `stage` — this page IS the
  // stage, so a stage param from the board would fight it.
  const filters = parseOppFilters({ ...sp, stage: undefined });
  const showAll = filters.showAllReps || role !== 'rep';
  const scopedRepId = !showAll && filters.rep.length === 0 ? currentRepId : null;
  const built = buildOppFilter(filters, scopedRepId);

  const visUser = await getCurrentUser();
  const ownerVis = clientScopeSql(visUser, 'o.client_id');
  const where = [`o.stage = $${built.nextIdx}`, ...built.conds, ...(ownerVis ? [ownerVis] : [])].join(' AND ');
  const vals: (string | number | string[])[] = [...built.vals, stage];

  const [rows, usdRate] = await Promise.all([
    risansiPool.query<Row>(`
      SELECT o.id, o.product, o.product_type, o.stage,
             COALESCE(o.value_cr, 0)::float8       AS value_cr,
             o.final_value_cr::float8              AS final_cr,
             o.quote_ref, o.quote_date::text       AS quote_date, o.market,
             o.client_id, c.legal_name AS client_name, c.code AS client_code,
             c.industry, c.client_type,
             COALESCE(r.name, '—') AS rep_name,
             (SELECT tr.name FROM tour_routes tr WHERE tr.id = c.tour_id) AS tour_name,
             o.offer_value_inr::float8             AS offer_inr,
             o.revised_offer_value_inr::float8     AS revised_inr,
             o.revised_offer_date::text            AS revised_on,
             (SELECT count(*) FROM opportunity_offer_revisions v WHERE v.opportunity_id = o.id)::int AS rev_count,
             (SELECT COALESCE(SUM(s.so_value_cr), 0) FROM opportunity_sales_orders s WHERE s.opportunity_id = o.id)::float8 AS so_sum_cr,
             (SELECT string_agg(s.so_number, ', ' ORDER BY s.so_date, s.id) FROM opportunity_sales_orders s WHERE s.opportunity_id = o.id) AS so_numbers,
             o.po_number, o.lost_to_competitor, o.lost_reason, o.drop_reason, o.quotation_link,
             (SELECT count(*) FROM opportunity_quotation_files qf WHERE qf.opportunity_id = o.id)::int AS doc_count,
             -- Age from the stage's own reference date. opportunity_stage_log is
             -- empty today (migration 0042 created it after years of swallowed
             -- writes), so 'entered' degrades to created_at rather than to null.
             CASE WHEN ${ageBasisSql(stage)} IS NULL THEN NULL
                  ELSE (CURRENT_DATE - ${ageBasisSql(stage)})::int END AS age_days
        FROM opportunities o
        JOIN clients c ON c.id = o.client_id
        LEFT JOIN users r ON r.id = o.rep_id
       WHERE ${where}
       ORDER BY o.value_cr DESC NULLS LAST, o.id`,
      vals as (string | number)[],
    ).then(r => r.rows.map(x => ({ ...x, value_cr: Number(x.value_cr ?? 0) }))).catch(() => [] as Row[]),
    getUsdRate(),
  ]);

  // ── Aggregates ───────────────────────────────────────────────
  // All of it lives in summariseStage (pure, exported, testable) rather than
  // inline here, so the numbers can be exercised against real rows without a
  // session — this page is auth-gated and renders empty without one.
  const A = summariseStage(rows);
  const {
    n, totalCr, avgCr, clients, avgAge, oldest, ageBuckets, stale, staleCr,
    inHandCr, soCr, withSo, moved, avgMove, totalRevs, trend, group, unrecorded,
  } = A;

  // ── Paging ───────────────────────────────────────────────────
  const page  = Math.max(1, parseInt(typeof sp.page === 'string' ? sp.page : '1', 10) || 1);
  const pages = Math.max(1, Math.ceil(n / PAGE_SIZE));
  const slice = rows.slice((Math.min(page, pages) - 1) * PAGE_SIZE, Math.min(page, pages) * PAGE_SIZE);

  const boardQuery  = oppFilterQuery(sp, ['stage']);
  const backHref    = `/risansi/pipeline${boardQuery.toString() ? `?${boardQuery}` : ''}`;
  const exportQuery = oppFilterQuery(sp, ['stage']); exportQuery.set('stage', stage);
  const pageHref = (p: number) => {
    const q = oppFilterQuery(sp, ['stage']); if (p > 1) q.set('page', String(p));
    return `?${q.toString()}`;
  };

  const hue = STAGE_COLOR[stage];
  const inr = (v: number | null | undefined) => (v == null ? '—' : '₹' + Math.round(v).toLocaleString('en-IN'));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <Topbar crumbs={[{ label: 'Opportunities', href: backHref }, stage]} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: 'var(--bg)' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 14, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 280 }}>
            <a href={backHref} style={{ fontSize: 11.5, color: 'var(--fg-3)', textDecoration: 'none' }}>← Opportunities board</a>
            <h1 style={{ fontSize: 22, fontWeight: 600, margin: '5px 0 3px', display: 'flex', alignItems: 'center', gap: 9 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: hue, display: 'inline-block' }} />
              {stage}
            </h1>
            <div style={{ fontSize: 12, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
              {n} opportunit{n === 1 ? 'y' : 'ies'} · {fmtCr(totalCr)} · ≈ {fmtUsdFromCr(totalCr, usdRate)}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--fg-3)', marginTop: 5, maxWidth: 640, lineHeight: 1.5 }}>{STAGE_BLURB[stage]}</div>
          </div>
          <a href={`/api/risansi/opportunities/export?${exportQuery}`} style={EXPORT_BTN}>⤓ Export Excel</a>
        </div>

        {n === 0 ? (
          <div style={{ ...PANEL, padding: 40, textAlign: 'center', color: 'var(--fg-3)', fontSize: 13 }}>
            Nothing sits in {stage} right now{boardQuery.toString() ? ' with the filters carried over from the board' : ''}.
          </div>
        ) : (
          <>
            {/* KPI tiles — the four questions this stage actually raises */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10, marginBottom: 14 }}>
              {stage === 'Won' ? (
                <>
                  <StageKpi label="Won" value={String(n)} sub={`${clients} client${clients === 1 ? '' : 's'}`} />
                  <StageKpi label="Won value" value={fmtCr(totalCr)} sub={`≈ ${fmtUsdFromCr(totalCr, usdRate)}`} color="var(--pos)" />
                  <StageKpi label="Order in hand" value={fmtCr(inHandCr)} sub="won · no SO raised yet" color="var(--warn)" alert={inHandCr > 0} />
                  <StageKpi label="SO created" value={fmtCr(soCr)} sub={`${withSo} of ${n} covered`} color="var(--pos)" />
                </>
              ) : stage === 'Negotiating' ? (
                <>
                  <StageKpi label="In negotiation" value={String(n)} sub={`${clients} client${clients === 1 ? '' : 's'}`} />
                  <StageKpi label="Value on the table" value={fmtCr(totalCr)} sub={`≈ ${fmtUsdFromCr(totalCr, usdRate)}`} color="var(--accent)" />
                  <StageKpi label="Avg move from original" value={avgMove == null ? '—' : `${avgMove > 0 ? '+' : ''}${avgMove.toFixed(1)}%`}
                    sub={moved.length ? `across ${moved.length} re-priced` : 'nothing re-priced yet'}
                    color={avgMove == null ? undefined : avgMove >= 0 ? 'var(--pos)' : 'var(--neg)'} />
                  <StageKpi label="Revisions logged" value={String(totalRevs)} sub="offer changes on record" />
                </>
              ) : stage === 'Lost' ? (
                <>
                  <StageKpi label="Lost" value={String(n)} sub={`${clients} client${clients === 1 ? '' : 's'}`} />
                  <StageKpi label="Value lost" value={fmtCr(totalCr)} sub={`≈ ${fmtUsdFromCr(totalCr, usdRate)}`} color="var(--neg)" />
                  <StageKpi label="Reason recorded" value={`${n - unrecorded(r => r.lost_reason)} of ${n}`}
                    sub="needed for win-rate analysis" alert={unrecorded(r => r.lost_reason) > 0} />
                  <StageKpi label="Competitor recorded" value={`${n - unrecorded(r => r.lost_to_competitor)} of ${n}`}
                    sub="needed for competitive analysis" alert={unrecorded(r => r.lost_to_competitor) > 0} />
                </>
              ) : stage === 'Dropped' ? (
                <>
                  <StageKpi label="Dropped" value={String(n)} sub={`${clients} client${clients === 1 ? '' : 's'}`} />
                  <StageKpi label="Value dropped" value={fmtCr(totalCr)} sub={`≈ ${fmtUsdFromCr(totalCr, usdRate)}`} color="var(--fg-2)" />
                  <StageKpi label="Reason recorded" value={`${n - unrecorded(r => r.drop_reason)} of ${n}`}
                    sub="chosen when the card is dropped" alert={unrecorded(r => r.drop_reason) > 0} />
                  <StageKpi label="Avg age at drop" value={avgAge == null ? '—' : `${avgAge}d`} sub={oldest != null ? `oldest ${oldest}d` : undefined} />
                </>
              ) : (
                <>
                  <StageKpi label={stage === 'Quoted' ? 'Quotes out' : 'Opportunities'} value={String(n)} sub={`${clients} client${clients === 1 ? '' : 's'}`} />
                  <StageKpi label={stage === 'Quoted' ? 'Quoted value' : 'Total value'} value={fmtCr(totalCr)} sub={`≈ ${fmtUsdFromCr(totalCr, usdRate)}`} color={hue} />
                  <StageKpi label="Average deal" value={fmtCr(avgCr)} sub={avgAge != null ? `avg age ${avgAge}d` : undefined} />
                  <StageKpi
                    label={stage === 'Quoted' ? 'Going stale (60d+)' : 'Sitting 60d+'}
                    value={String(stale.length)} sub={`${fmtCr(staleCr)} needs chasing`}
                    color="var(--neg)" alert={stale.length > 0}
                  />
                </>
              )}
            </div>

            {/* Charts */}
            <div style={CHART_GRID}>
              {stage === 'Won' ? (
                <>
                  <ChartPanel title="Sales-Order coverage" sub={`${withSo} of ${n} have an SO`}
                    note="Order in hand is won value with no Sales Order against it — the raise-an-SO to-do list.">
                    <StackedBar parts={[
                      { label: 'SO created', value: soCr, color: 'var(--pos)', sub: `${withSo} opps` },
                      { label: 'Awaiting SO', value: inHandCr, color: 'var(--warn, #F59E0B)', sub: `${n - withSo} opps` },
                    ]} />
                  </ChartPanel>
                  <ChartPanel title="Won by month" sub="by quote date, last 12">
                    <TrendBars points={trend} />
                  </ChartPanel>
                  <ChartPanel title="Product mix"><BarList rows={group(r => r.product_type)} /></ChartPanel>
                  <ChartPanel title="Top clients" sub="by won value"><BarList rows={group(r => r.client_name, 8)} /></ChartPanel>
                </>
              ) : stage === 'Negotiating' ? (
                <>
                  <ChartPanel title="Offer movement" sub={`${moved.length} re-priced`}
                    note="Original is the quoted offer; current is the newest revision on record.">
                    <OfferMovement rows={rows.map(r => ({
                      id: r.id, label: `${r.client_name} · ${r.quote_ref ?? r.product}`,
                      original: r.offer_inr, current: r.revised_inr, revisions: r.rev_count,
                    }))} />
                  </ChartPanel>
                  <ChartPanel title="Days since quote"><AgeingBars buckets={ageBuckets} /></ChartPanel>
                </>
              ) : stage === 'Lost' ? (
                <>
                  <ChartPanel title="Why we lost" sub={`${unrecorded(r => r.lost_reason)} unrecorded`}
                    note={unrecorded(r => r.lost_reason) > 0 ? 'Unrecorded rows are shown as their own bar rather than dropped — an empty chart would read as "no reason", not "nobody filled it in".' : undefined}>
                    <BarList rows={group(r => r.lost_reason)} />
                  </ChartPanel>
                  <ChartPanel title="Lost to" sub={`${unrecorded(r => r.lost_to_competitor)} unrecorded`}>
                    <BarList rows={group(r => r.lost_to_competitor)} />
                  </ChartPanel>
                  <ChartPanel title="Product mix"><BarList rows={group(r => r.product_type)} /></ChartPanel>
                </>
              ) : stage === 'Dropped' ? (
                <>
                  <ChartPanel title="Why it was dropped" sub={`${unrecorded(r => r.drop_reason)} unrecorded`}
                    note={unrecorded(r => r.drop_reason) === n ? 'The drop-reason field is newer than these rows, so none carry one yet. It is asked for whenever a card is moved to Dropped from now on.' : undefined}>
                    <BarList rows={group(r => r.drop_reason)} />
                  </ChartPanel>
                  <ChartPanel title="Product mix"><BarList rows={group(r => r.product_type)} /></ChartPanel>
                </>
              ) : (
                <>
                  <ChartPanel
                    title={stage === 'Quoted' ? 'Quote ageing' : 'Ageing'}
                    sub={stale.length ? `${stale.length} over 60 days` : 'all fresh'}
                    note={stage === 'Quoted' ? 'Days since the quotation went out. Anything past 60 days needs a call.' : undefined}>
                    <AgeingBars buckets={ageBuckets} />
                  </ChartPanel>
                  <ChartPanel title="Product mix"><BarList rows={group(r => r.product_type)} /></ChartPanel>
                  {stage === 'Quoted' && (
                    <ChartPanel title="Domestic vs Export">
                      <StackedBar parts={(() => {
                        const g = group(r => r.market);
                        const pick = (l: string) => g.find(x => x.label === l)?.value ?? 0;
                        return [
                          { label: 'Domestic', value: pick('DOMESTIC'), color: '#0A3D8F', sub: `${g.find(x => x.label === 'DOMESTIC')?.count ?? 0} opps` },
                          { label: 'Export',   value: pick('EXPORT'),   color: '#c69347', sub: `${g.find(x => x.label === 'EXPORT')?.count ?? 0} opps` },
                          { label: 'Unrecorded', value: pick('Unrecorded'), color: 'var(--fg-3)' },
                        ];
                      })()} />
                    </ChartPanel>
                  )}
                  <ChartPanel title="By rep" sub="tour owner"><BarList rows={group(r => r.rep_name, 8)} /></ChartPanel>
                  {(stage === 'Prospect' || stage === 'Quoted') && (
                    <ChartPanel title="Top clients"><BarList rows={group(r => r.client_name, 8)} /></ChartPanel>
                  )}
                </>
              )}
            </div>

            {/* The list */}
            <div style={PANEL}>
              <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 12, fontWeight: 500 }}>All {stage} opportunities</span>
                <span style={{ fontSize: 11, color: 'var(--fg-3)', marginLeft: 'auto', fontFamily: 'var(--font-mono)' }}>
                  {pages > 1 ? `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, n)} of ${n}` : `${n} rows`}
                </span>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr>
                      {STAGE_COLUMNS[stage].map(col => (
                        <th key={col.key} style={{
                          ...TH, textAlign: col.num ? 'right' : 'left',
                          width: col.width, minWidth: col.width,
                        }}>{col.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {slice.map((r, i) => (
                      <tr key={r.id} style={{ borderTop: i === 0 ? 'none' : '1px solid var(--line)' }}>
                        {STAGE_COLUMNS[stage].map(col => (
                          <td key={col.key} style={{
                            ...TD, textAlign: col.num ? 'right' : 'left',
                            fontFamily: col.num ? 'var(--font-mono)' : 'inherit',
                          }}>
                            {renderCell(r, col.key, usdRate, inr)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {slice.length === 0 && <NoData msg="No rows on this page." />}
              </div>
              {pages > 1 && (
                <div style={{ padding: '10px 14px', borderTop: '1px solid var(--line)', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  {page > 1 && <a href={pageHref(page - 1)} style={PAGE_BTN}>← Prev</a>}
                  <span style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>Page {Math.min(page, pages)} of {pages}</span>
                  {page < pages && <a href={pageHref(page + 1)} style={PAGE_BTN}>Next →</a>}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Cell rendering ─────────────────────────────────────────────

function renderCell(r: Row, key: string, usdRate: number, inr: (v: number | null | undefined) => string) {
  switch (key) {
    case 'client_name':
      return <a href={`/risansi/clients/${r.client_id}`} style={{ color: 'var(--fg)', textDecoration: 'none', fontWeight: 500 }}>{r.client_name}</a>;
    case 'quote_ref': {
      // The quote reference is the label; the stored link decides whether it is
      // one. A document name with no address used to be linked here too, and
      // since it is not a url the browser resolved it against the stage page.
      // An attached PDF wins over a legacy url, because syncQuotationLink will
      // not overwrite one — so an opportunity that had a SharePoint link and has
      // since had its quotation uploaded still stores the SharePoint url. Reading
      // the link alone would send the rep to OneDrive past a PDF sitting right here.
      const attached = r.doc_count > 0;
      const href = attached ? `/api/risansi/opportunities/${r.id}/quotation` : quotationHref(r.quotation_link);
      const legacy = !attached && isLegacyQuotation(r.quotation_link);
      const ref = <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{r.quote_ref ?? '—'}</span>;
      if (!href) return legacy ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>{ref}<LegacyMark noFile /></span> : ref;
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <a href={href} target="_blank" rel="noreferrer"
            title={legacy ? 'Legacy quotation link — opens SharePoint' : 'Open the attached quotation'}
            style={{ color: 'var(--brand-blue, #1A5CB8)', textDecoration: 'none', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
            {r.quote_ref ?? '—'} ↗
          </a>
          {legacy && <LegacyMark count={quotationLinkCount(r.quotation_link)} />}
        </span>
      );
    }
    case 'value_cr':
      return fmtCr(r.value_cr);
    case 'final_cr':
      return r.final_cr == null ? '—' : fmtCr(Number(r.final_cr));
    case 'so_sum_cr':
      return r.so_sum_cr > 0 ? fmtCr(r.so_sum_cr) : '—';
    case 'so_status': {
      // Matches wonSubStatus: Open while the SOs don't yet cover the final value.
      const base = r.final_cr != null ? Number(r.final_cr) : r.value_cr;
      const covered = base > 0 && r.so_sum_cr >= base;
      return (
        <span style={{ fontSize: 10.5, fontWeight: 600, color: covered ? 'var(--pos)' : 'var(--warn, #B45309)' }}>
          {covered ? 'Closed' : 'Open'}
        </span>
      );
    }
    case 'offer_inr':
      return r.offer_inr == null ? '—' : (
        <span title={`≈ ${fmtUsdFromInr(r.offer_inr, usdRate)}`}>{inr(r.offer_inr)}</span>
      );
    case 'revised_inr': {
      if (r.revised_inr == null) return <span style={{ color: 'var(--fg-3)' }}>—</span>;
      const d = r.offer_inr && r.offer_inr > 0 ? ((r.revised_inr - r.offer_inr) / r.offer_inr) * 100 : null;
      return (
        <span title={`≈ ${fmtUsdFromInr(r.revised_inr, usdRate)}${r.rev_count > 1 ? ` · ${r.rev_count} revisions` : ''}`}>
          {inr(r.revised_inr)}
          {d != null && Math.abs(d) >= 0.05 && (
            <span style={{ marginLeft: 5, fontSize: 10, color: d > 0 ? 'var(--pos)' : 'var(--neg)' }}>
              {d > 0 ? '▲' : '▼'}{Math.abs(d).toFixed(0)}%
            </span>
          )}
        </span>
      );
    }
    case 'age_days':
      if (r.age_days == null) return <span style={{ color: 'var(--fg-3)' }}>—</span>;
      return <span style={{ color: r.age_days > 90 ? 'var(--neg)' : r.age_days > 60 ? 'var(--warn, #B45309)' : 'inherit' }}>{r.age_days}d</span>;
    case 'rev_count':
      return r.rev_count || '—';
    default: {
      const v = (r as unknown as Record<string, unknown>)[key];
      const s = v == null ? '' : String(v).trim();
      return s ? s : <span style={{ color: 'var(--fg-3)' }}>—</span>;
    }
  }
}

// ── Styles ─────────────────────────────────────────────────────

const PANEL: CSSProperties = { background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)' };
const TH: CSSProperties = {
  padding: '9px 10px', fontSize: 10, fontWeight: 700, color: 'var(--fg-3)',
  textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--line)',
  whiteSpace: 'nowrap', background: 'var(--bg-sunk)',
};
const TD: CSSProperties = { padding: '8px 10px', verticalAlign: 'top', overflowWrap: 'anywhere' };
const EXPORT_BTN: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px',
  background: 'var(--bg-paper)', border: '1px solid var(--line-strong)', borderRadius: 7,
  fontSize: 12.5, color: 'var(--fg-2)', textDecoration: 'none', flexShrink: 0,
};
const PAGE_BTN: CSSProperties = {
  padding: '4px 11px', fontSize: 11.5, border: '1px solid var(--line-strong)',
  borderRadius: 6, color: 'var(--fg-2)', textDecoration: 'none',
};
