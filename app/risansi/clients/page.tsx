import type { CSSProperties } from 'react';
import Link from 'next/link';
import { Topbar, Tag, StatusDot, MultiSelectFilter, ActiveFilterBar, SortableTH } from '@/components/risansi';
import { MobileSort } from '@/components/risansi/MobileSort';
import risansiPool from '@/lib/db-risansi';
import { formatLastVisitShort } from '@/lib/risansi-utils';
import { getCurrentUser, clientVisibilitySql } from '@/lib/risansi-auth';
import { OWNERS_SUBQUERY, REV_JOIN, REV_BUCKETS, VISIT_BUCKETS, buildClientFilter } from '@/lib/risansi-client-filter';
import { clientStatusLabel, statusDotKind, CLIENT_STATUS_FILTER_OPTIONS, CLIENT_STATUS_LABELS, PROSPECTIVE_STATUSES } from '@/lib/risansi-client-status';
import { FilterBar } from './FilterBar';

const PAGE_SIZE = 50;

// Only columns confirmed to exist are listed here
const SORT_MAP: Record<string, string> = {
  code:       'c.code',
  name:       'c.legal_name',
  industry:   'c.industry',
  zone:       'tr.zone',
  last_visit: 'c.last_visit_date',
  status:     'c.status',
  tier:       'c.tier',
  rep:        'rep_name',
};

export default async function ClientListPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const sp = await searchParams;

  const user = await getCurrentUser();

  // Tab — 'all' (default) or 'prospective'. The tab's status constraint lives in
  // buildClientFilter, so the list, the counts and the Excel export all agree.
  const tab       = sp.tab === 'prospective' ? 'prospective' : 'all';
  const q_str     = typeof sp.q        === 'string' ? sp.q.trim()        : '';
  const sugarFilt = typeof sp.sugar    === 'string' ? sp.sugar.trim()    : '';
  const sortKey   = typeof sp.sort     === 'string' ? sp.sort            : 'last_visit';
  const orderDir  = sp.order === 'desc'             ? 'DESC'             : 'ASC';
  const pageNum   = Math.max(1, parseInt(typeof sp.page === 'string' ? sp.page : '1', 10) || 1);
  const limit     = PAGE_SIZE;
  const offset    = (pageNum - 1) * limit;    // page 1 → offset 0  ✓

  // Multi-select filters — comma-separated in URL
  const indFilts  = typeof sp.industry === 'string' && sp.industry ? sp.industry.split(',').filter(Boolean) : [];
  const zoneFilts = typeof sp.zone     === 'string' && sp.zone     ? sp.zone.split(',').filter(Boolean)     : [];
  const tierFilts = typeof sp.tier     === 'string' && sp.tier     ? sp.tier.split(',').filter(Boolean)     : [];
  const ctypeFilts = typeof sp.ctype   === 'string' && sp.ctype    ? sp.ctype.split(',').filter(Boolean)    : [];
  const statFilts = typeof sp.status   === 'string' && sp.status   ? sp.status.split(',').filter(Boolean).map(s => s.toUpperCase()) : [];
  const repFilts  = typeof sp.rep      === 'string' && sp.rep      ? sp.rep.split(',').filter(Boolean)      : [];
  const fyFilts   = typeof sp.fy       === 'string' && sp.fy       ? sp.fy.split(',').filter(Boolean)       : [];
  const revFilts  = typeof sp.rev      === 'string' && sp.rev      ? sp.rev.split(',').filter(Boolean)      : [];
  const visitFilts = typeof sp.visit   === 'string' && sp.visit    ? sp.visit.split(',').filter(Boolean)    : [];

  const hasActiveFilters = !!(q_str || sugarFilt || indFilts.length || zoneFilts.length || tierFilts.length || ctypeFilts.length || statFilts.length || repFilts.length || fyFilts.length || revFilts.length || visitFilts.length);
  const sortCol = SORT_MAP[sortKey] ?? 'c.last_visit_date';

  // ── WHERE + params (shared with the Excel export so they always match) ──
  const { whereClause, params } = buildClientFilter(sp, user);
  const countParams = [...params]; // snapshot before limit/offset are pushed

  // Tab counts share every OTHER filter but not the tab's own status constraint,
  // so each label reads "how many rows would this tab show right now".
  const { whereClause: tabWhere, params: tabParams } = buildClientFilter({ ...sp, tab: undefined }, user);

  const limIdx = params.length + 1;
  const offIdx = params.length + 2;
  const mainParams = [...params, limit, offset];

  // ── Interfaces ─────────────────────────────────────────────────
  interface ClientRow {
    id:              string;
    code:            string;
    legal_name:      string;
    trade_name:      string | null;
    industry:        string;
    is_sugar:        boolean;
    state:           string | null;
    city:            string | null;
    status:          string;
    tier:            string | null;
    last_visit_date: Date | null;
    zone:            string | null;
    tour_name:       string | null;
    tour_zone:       string | null;
    rep_name:        string | null;
  }

  interface RepOption { rep_name: string; client_count: number; }

  // ── All queries in parallel ────────────────────────────────────
  const [clients, total, tabCounts, industries, zones, tiers, clientTypes, repOptions, fyYears, revBuckets, visitBuckets] = await Promise.all([

    (async (): Promise<ClientRow[]> => {
      try {
        const { rows } = await risansiPool.query<ClientRow>(
          `SELECT
             c.id, c.code, c.legal_name, c.trade_name,
             c.industry, c.is_sugar, c.state, c.city,
             c.status, c.tier,
             c.last_visit_date,
             c.zone,
             tr.name AS tour_name,
             tr.zone AS tour_zone,
             COALESCE(${OWNERS_SUBQUERY}, '—') AS rep_name
           FROM clients c
           LEFT JOIN tour_routes tr ON tr.id = c.tour_id
           ${REV_JOIN}
           WHERE ${whereClause}
           ORDER BY ${sortCol} ${orderDir} ${orderDir === 'ASC' ? 'NULLS FIRST' : 'NULLS LAST'}
           LIMIT  $${limIdx}
           OFFSET $${offIdx}`,
          mainParams as (string | number)[],
        );
        return rows;
      } catch (err) {
        console.error('[clients/page] main query failed:', err);
        return [];
      }
    })(),

    (async (): Promise<number> => {
      try {
        const { rows } = await risansiPool.query<{ count: string }>(
          `SELECT COUNT(DISTINCT c.id)::text AS count
           FROM clients c
           LEFT JOIN tour_routes tr ON tr.id = c.tour_id
           ${REV_JOIN}
           WHERE ${whereClause}`,
          countParams as (string | number)[],
        );
        return Number(rows[0]?.count ?? 0);
      } catch (err) {
        console.error('[clients/page] count query failed:', err);
        return 0;
      }
    })(),

    // Per-tab counts under the current non-tab filters (one pass, two FILTERs).
    (async (): Promise<{ all: number; prospective: number }> => {
      try {
        const { rows } = await risansiPool.query<{ all_n: string; prosp_n: string }>(
          `SELECT COUNT(DISTINCT c.id)::text AS all_n,
                  COUNT(DISTINCT c.id) FILTER (
                    WHERE UPPER(c.status) IN ('PROSPECTIVE_LEAD','PROSPECTIVE_CLIENT')
                  )::text AS prosp_n
           FROM clients c
           LEFT JOIN tour_routes tr ON tr.id = c.tour_id
           ${REV_JOIN}
           WHERE ${tabWhere}`,
          tabParams as (string | number)[],
        );
        return { all: Number(rows[0]?.all_n ?? 0), prospective: Number(rows[0]?.prosp_n ?? 0) };
      } catch (err) {
        console.error('[clients/page] tab count query failed:', err);
        return { all: 0, prospective: 0 };
      }
    })(),

    (async (): Promise<string[]> => {
      try {
        const { rows } = await risansiPool.query<{ industry: string }>(
          `SELECT DISTINCT industry FROM clients WHERE industry IS NOT NULL AND deleted_at IS NULL ORDER BY industry`,
        );
        return rows.map(r => r.industry);
      } catch { return []; }
    })(),

    (async (): Promise<string[]> => {
      try {
        const { rows } = await risansiPool.query<{ zone: string }>(
          `SELECT DISTINCT zone FROM tour_routes WHERE zone IS NOT NULL AND zone <> '' ORDER BY zone`,
        );
        return rows.map(r => r.zone);
      } catch { return []; }
    })(),

    (async (): Promise<string[]> => {
      try {
        const { rows } = await risansiPool.query<{ tier: string }>(
          `SELECT DISTINCT tier FROM clients WHERE tier IS NOT NULL AND deleted_at IS NULL ORDER BY tier`,
        );
        return rows.map(r => r.tier);
      } catch { return []; }
    })(),

    // Client-type options, derived from the data with counts. Deriving (rather
    // than using the CLIENT_TYPES picklist) keeps legacy values that predate it
    // — DIRECT MILL, TRADER, GROUP, CHANNEL PARTNER — filterable instead of
    // silently unreachable. Scoped to the clients this user may see.
    (async (): Promise<{ value: string; label: string; count: number }[]> => {
      try {
        const visForCt = clientVisibilitySql(user, 'c');
        const ctClause = visForCt ? `AND (${visForCt})` : '';
        const { rows } = await risansiPool.query<{ t: string; n: string }>(
          `SELECT c.client_type AS t, COUNT(*)::text AS n
             FROM clients c
            WHERE c.client_type IS NOT NULL AND btrim(c.client_type) <> '' AND c.deleted_at IS NULL ${ctClause}
            GROUP BY c.client_type ORDER BY COUNT(*) DESC`,
        );
        return rows.map(r => ({ value: r.t, label: r.t, count: Number(r.n) }));
      } catch { return []; }
    })(),

    (async (): Promise<RepOption[]> => {
      try {
        // Owner names sourced from users (active), counted via client_assignments,
        // restricted to the clients this user may see.
        const visForOptions = clientVisibilitySql(user, 'c');
        const ownerVisClause = visForOptions ? `AND (${visForOptions})` : '';
        const { rows } = await risansiPool.query<RepOption>(
          `SELECT u.name AS rep_name, COUNT(DISTINCT c.id)::int AS client_count
           FROM users u
           JOIN tour_assignments ta ON ta.rep_id = u.id
           JOIN clients c ON c.tour_id = ta.tour_id
           WHERE u.is_active = TRUE
             AND c.deleted_at IS NULL
             ${ownerVisClause}
           GROUP BY u.name
           ORDER BY client_count DESC
           LIMIT 30`,
        );
        return rows;
      } catch { return []; }
    })(),

    // Financial-year options from clients.since_year, shown as FY labels.
    (async (): Promise<{ value: string; label: string; count: number }[]> => {
      try {
        const { rows } = await risansiPool.query<{ y: string; n: string }>(
          `SELECT since_year AS y, COUNT(*)::text AS n FROM clients
           WHERE since_year IS NOT NULL AND since_year <> '' AND deleted_at IS NULL
           GROUP BY since_year ORDER BY since_year DESC`,
        );
        return rows.map(r => {
          const yr = parseInt(r.y, 10);
          const label = Number.isFinite(yr)
            ? `FY ${String(yr % 100).padStart(2, '0')}-${String((yr + 1) % 100).padStart(2, '0')}`
            : r.y;
          return { value: r.y, label, count: Number(r.n) };
        });
      } catch { return []; }
    })(),

    // Revenue-bucket option counts (lifetime revenue), scoped to visible clients.
    (async (): Promise<{ value: string; label: string; count: number }[]> => {
      try {
        const visForRev = clientVisibilitySql(user, 'c');
        const visClause = visForRev ? `AND (${visForRev})` : '';
        const selects = REV_BUCKETS
          .map((b, i) => `COUNT(*) FILTER (WHERE ${b.cond('r')}) AS b${i}`)
          .join(', ');
        const { rows } = await risansiPool.query<Record<string, string>>(
          `WITH rev AS (
             SELECT c.id,
                    COALESCE((SELECT SUM(total_value) FROM client_revenue_monthly m WHERE m.client_id = c.id), 0) AS r
             FROM clients c
             WHERE c.deleted_at IS NULL ${visClause})
           SELECT ${selects} FROM rev`,
        );
        const row = rows[0] ?? {};
        return REV_BUCKETS.map((b, i) => ({ value: b.value, label: b.value, count: Number(row[`b${i}`] ?? 0) }));
      } catch { return REV_BUCKETS.map(b => ({ value: b.value, label: b.value, count: 0 })); }
    })(),

    // Last-visit bucket option counts, scoped to visible clients.
    (async (): Promise<{ value: string; label: string; count: number }[]> => {
      try {
        const visForVisit = clientVisibilitySql(user, 'c');
        const visitClause = visForVisit ? `AND (${visForVisit})` : '';
        const selects = VISIT_BUCKETS
          .map((b, i) => `COUNT(*) FILTER (WHERE ${b.cond('c.last_visit_date')}) AS b${i}`)
          .join(', ');
        const { rows } = await risansiPool.query<Record<string, string>>(
          `SELECT ${selects} FROM clients c WHERE c.deleted_at IS NULL ${visitClause}`,
        );
        const row = rows[0] ?? {};
        return VISIT_BUCKETS.map((b, i) => ({ value: b.value, label: b.label, count: Number(row[`b${i}`] ?? 0) }));
      } catch { return VISIT_BUCKETS.map(b => ({ value: b.value, label: b.label, count: 0 })); }
    })(),
  ]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  function buildUrl(overrides: Record<string, string | number | undefined>): string {
    const base: Record<string, string> = {};
    if (tab !== 'all')      base.tab      = tab;
    if (q_str)              base.q        = q_str;
    if (indFilts.length)    base.industry = indFilts.join(',');
    if (zoneFilts.length)   base.zone     = zoneFilts.join(',');
    if (tierFilts.length)   base.tier     = tierFilts.join(',');
    if (ctypeFilts.length)  base.ctype    = ctypeFilts.join(',');
    if (statFilts.length)   base.status   = statFilts.join(',');
    if (repFilts.length)    base.rep      = repFilts.join(',');
    if (fyFilts.length)     base.fy       = fyFilts.join(',');
    if (revFilts.length)    base.rev      = revFilts.join(',');
    if (visitFilts.length)  base.visit    = visitFilts.join(',');
    if (sugarFilt)          base.sugar    = sugarFilt;
    if (sortKey)            base.sort     = sortKey;
    if (orderDir === 'DESC') base.order   = 'desc';
    base.page = String(pageNum);
    const merged = { ...base, ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [k, v == null ? undefined : String(v)])
    )};
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) {
      if (v != null && v !== '') p.set(k, v);
    }
    return `/risansi/clients?${p.toString()}`;
  }

  function tierKind(t: string | null): 'accent' | undefined {
    return t === 'Key' ? 'accent' : undefined;
  }

  const curSort = sortKey;
  const curDir  = orderDir === 'DESC' ? 'desc' : 'asc';

  // Switching tab keeps every other filter but clears `status` (the tab defines
  // the status scope, so carrying a pick across would silently narrow the other
  // tab) and `page` (the new result set has its own pagination).
  const tabHref = (id: 'all' | 'prospective') =>
    buildUrl({ tab: id === 'all' ? undefined : id, status: undefined, page: 1 });

  // Export link — carries the current filters so the .xlsx matches this view.
  const exportQs = new URLSearchParams();
  if (tab !== 'all')    exportQs.set('tab', tab);
  if (q_str)            exportQs.set('q', q_str);
  if (indFilts.length)  exportQs.set('industry', indFilts.join(','));
  if (zoneFilts.length) exportQs.set('zone', zoneFilts.join(','));
  if (tierFilts.length) exportQs.set('tier', tierFilts.join(','));
  if (ctypeFilts.length) exportQs.set('ctype', ctypeFilts.join(','));
  if (statFilts.length) exportQs.set('status', statFilts.join(','));
  if (repFilts.length)  exportQs.set('rep', repFilts.join(','));
  if (fyFilts.length)   exportQs.set('fy', fyFilts.join(','));
  if (revFilts.length)  exportQs.set('rev', revFilts.join(','));
  if (visitFilts.length) exportQs.set('visit', visitFilts.join(','));
  if (sugarFilt)        exportQs.set('sugar', sugarFilt);
  const exportHref = `/api/risansi/clients/export${exportQs.toString() ? `?${exportQs}` : ''}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Sticky topbar */}
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <Topbar crumbs={['Risansi', 'Clients']} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: 'var(--bg)' }}>

        {/* ── Page header ──────────────────────────────────────── */}
        <div style={{ marginBottom: 14, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--fg)' }}>
              Clients
            </div>
            <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 3 }}>
              {tab === 'prospective' ? 'Prospective leads & clients' : 'Client master'} · {total.toLocaleString('en-IN')} records
            </div>
          </div>
          <a
            href={exportHref}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0,
              padding: '8px 14px', borderRadius: 'var(--radius)', border: '1px solid var(--line-strong)',
              background: 'var(--bg-paper)', color: 'var(--fg)', fontSize: 12.5, fontWeight: 600,
              textDecoration: 'none', whiteSpace: 'nowrap',
            }}
            title={hasActiveFilters ? 'Export the filtered clients to Excel' : 'Export all visible clients to Excel'}
          >
            ⭳ Export{hasActiveFilters ? ' (filtered)' : ''} · {total.toLocaleString('en-IN')}
          </a>
        </div>

        {/* ── Tabs ─────────────────────────────────────────────── */}
        <div className="field-tabs" style={{
          display: 'flex', gap: 2, marginBottom: 12, borderBottom: '1px solid var(--line)',
          overflowX: 'auto', scrollSnapType: 'x proximity',
        }}>
          {([
            { id: 'all' as const,         label: 'All Clients',  n: tabCounts.all },
            { id: 'prospective' as const, label: 'Prospectives', n: tabCounts.prospective },
          ]).map(t => (
            <a key={t.id} href={tabHref(t.id)} aria-current={tab === t.id} style={{
              display: 'block', padding: '8px 16px', fontSize: 13,
              fontWeight: tab === t.id ? 600 : 400,
              color: tab === t.id ? 'var(--accent)' : 'var(--fg-3)',
              textDecoration: 'none', flexShrink: 0, whiteSpace: 'nowrap', scrollSnapAlign: 'center',
              borderBottom: tab === t.id ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom: -1, transition: 'color 0.1s',
            }}>
              {t.label} ({t.n.toLocaleString('en-IN')})
            </a>
          ))}
        </div>

        {/* ── Filter toolbar (search + filters, grouped) ────────── */}
        <div style={{
          background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)',
          padding: 12, marginBottom: 10, display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <FilterBar q={q_str} sugar={sugarFilt} />
          {/* Mobile-only sort (the sortable table headers are hidden in card view) */}
          <MobileSort currentSort={sortKey} currentOrder={orderDir === 'DESC' ? 'desc' : 'asc'} />
          <div className="r-filter-row" style={{
            display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center',
            paddingTop: 10, borderTop: '1px solid var(--line-2)',
          }}>
            <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--fg-3)', marginRight: 2 }}>Filter</span>
            <MultiSelectFilter param="industry" label="Industry"       options={industries}      selected={indFilts}  />
            <MultiSelectFilter param="zone"     label="Zone"           options={zones}           selected={zoneFilts} />
            <MultiSelectFilter param="tier"     label="Tier"           options={tiers}           selected={tierFilts} />
            <MultiSelectFilter param="ctype"    label="Client Type"    options={clientTypes}     selected={ctypeFilts} />
            {/* On the Prospectives tab the Status filter narrows WITHIN the tab
                (Lead vs Client), so it only offers those two — picking neither
                shows both. buildClientFilter enforces the same intersection. */}
            <MultiSelectFilter param="status"   label="Status"
              options={tab === 'prospective'
                ? CLIENT_STATUS_FILTER_OPTIONS.filter(o => (PROSPECTIVE_STATUSES as readonly string[]).includes(o.value))
                : CLIENT_STATUS_FILTER_OPTIONS}
              selected={statFilts} />
            <MultiSelectFilter param="rep"      label="Rep"            options={repOptions.map(r => ({ value: r.rep_name, label: r.rep_name, count: r.client_count }))} selected={repFilts} />
            <MultiSelectFilter param="fy"       label="Customer Since" options={fyYears}         selected={fyFilts} />
            <MultiSelectFilter param="rev"      label="Revenue"        options={revBuckets}      selected={revFilts}  />
            <MultiSelectFilter param="visit"    label="Last Visit"     options={visitBuckets}    selected={visitFilts} />
          </div>
        </div>

        {/* ── Active filter pills ───────────────────────────────── */}
        <ActiveFilterBar filters={[
          { param: 'industry', label: 'Industry', values: indFilts  },
          { param: 'zone',     label: 'Zone',     values: zoneFilts },
          { param: 'tier',     label: 'Tier',     values: tierFilts },
          { param: 'ctype',    label: 'Client Type', values: ctypeFilts },
          { param: 'status',   label: 'Status',   values: statFilts, valueLabels: CLIENT_STATUS_LABELS },
          { param: 'rep',      label: 'Rep',      values: repFilts  },
          { param: 'fy',       label: 'Customer Since', values: fyFilts },
          { param: 'rev',      label: 'Revenue',  values: revFilts },
          { param: 'visit',    label: 'Last Visit', values: visitFilts, valueLabels: Object.fromEntries(VISIT_BUCKETS.map(b => [b.value, b.label])) },
        ]} />

        {/* ── Table ────────────────────────────────────────────── */}
        <div style={{
          background:   'var(--bg-paper)',
          border:       '1px solid var(--line)',
          borderRadius: 'var(--radius)',
          overflow:     'hidden',
          marginTop:    8,
        }}>
          {clients.length === 0 ? (
            <div style={{ padding: '60px 24px', textAlign: 'center', color: 'var(--fg-3)' }}>
              {hasActiveFilters ? (
                <>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>🔍</div>
                  <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--fg-2)', marginBottom: 4 }}>
                    No clients match the current filters
                  </div>
                  <div style={{ fontSize: 13 }}>
                    Try removing some filters or clearing the search
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
                  <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--fg-2)', marginBottom: 4 }}>
                    No clients found
                  </div>
                  <div style={{ fontSize: 13 }}>
                    The client database appears to be empty
                  </div>
                </>
              )}
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="r-cards" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-elev)' }}>
                    <SortableTH col="code"       label="Code"         currentSort={curSort} currentDir={curDir} />
                    <SortableTH col="name"       label="Client"       currentSort={curSort} currentDir={curDir} />
                    <SortableTH col="industry"   label="Industry"     currentSort={curSort} currentDir={curDir} />
                    <SortableTH col="zone"       label="Zone / Route" currentSort={curSort} currentDir={curDir} />
                    <SortableTH col="rep"        label="Rep"          currentSort={curSort} currentDir={curDir} />
                    <SortableTH col="last_visit" label="Last Visit"   currentSort={curSort} currentDir={curDir} />
                    <SortableTH col="status"     label="Status"       currentSort={curSort} currentDir={curDir} />
                    <SortableTH col="tier"       label="Tier"         currentSort={curSort} currentDir={curDir} />
                  </tr>
                </thead>
                <tbody>
                  {clients.map((c, i) => {
                    const lv = formatLastVisitShort(
                      c.last_visit_date ? new Date(c.last_visit_date).toISOString() : null,
                    );

                    return (
                      <tr key={c.id} style={{ borderBottom: i < clients.length - 1 ? '1px solid var(--line)' : 'none' }}>

                        {/* Code */}
                        <td data-label="Code" style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)', whiteSpace: 'nowrap' }}>
                          {c.code}
                        </td>

                        {/* Client name */}
                        <td data-label="" style={{ ...TD, minWidth: 180 }}>
                          <Link
                            href={`/risansi/clients/${c.code}`}
                            style={{ fontWeight: 500, fontSize: 12, color: 'var(--fg)', textDecoration: 'none' }}
                          >
                            {c.legal_name}
                          </Link>
                          {c.trade_name && c.trade_name !== c.legal_name && (
                            <div style={{ fontSize: 10, color: 'var(--fg-3)', marginTop: 1 }}>{c.trade_name}</div>
                          )}
                        </td>

                        {/* Industry */}
                        <td data-label="Industry" style={TD}><Tag>{c.industry}</Tag></td>

                        {/* Zone / Route */}
                        <td data-label="Zone / Route" style={{ ...TD, whiteSpace: 'nowrap' }}>
                          <div style={{ fontSize: 12 }}>{c.zone || c.tour_zone || '—'}</div>
                          {c.tour_name && (
                            <div style={{ fontSize: 10, color: 'var(--fg-3)', marginTop: 1 }}>{c.tour_name}</div>
                          )}
                        </td>

                        {/* Rep */}
                        <td data-label="Rep" style={{ padding: '0 12px' }}>
                          <span style={{
                            fontSize: 12,
                            color: 'var(--fg-2)',
                            fontWeight: 500,
                          }}>
                            {c.rep_name || '—'}
                          </span>
                        </td>

                        {/* Last visit */}
                        <td data-label="Last Visit" style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 11, color: lv.color, whiteSpace: 'nowrap' }}>
                          <span style={{ fontWeight: lv.label === 'Never' ? 400 : 500 }}>{lv.label}</span>
                        </td>

                        {/* Status */}
                        <td data-label="Status" style={{ ...TD, whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <StatusDot s={statusDotKind(c.status)} />
                            <span style={{ fontSize: 11 }}>{clientStatusLabel(c.status)}</span>
                          </div>
                        </td>

                        {/* Tier */}
                        <td data-label="Tier" style={TD}>
                          {c.tier ? <Tag kind={tierKind(c.tier)}>{c.tier}</Tag> : null}
                        </td>

                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Pagination ────────────────────────────────────────── */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 }}>
            <span style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
              Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total.toLocaleString('en-IN')}
            </span>
            <div className="r-pager" style={{ display: 'flex', gap: 4 }}>
              {pageNum > 1 && (
                <a href={buildUrl({ page: pageNum - 1 })} style={PAGE_BTN}>← Prev</a>
              )}
              {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                let p = i + 1;
                if (totalPages > 7) {
                  const start = Math.max(1, Math.min(pageNum - 3, totalPages - 6));
                  p = start + i;
                }
                return (
                  <a key={p} href={buildUrl({ page: p })}
                    style={{ ...PAGE_BTN, ...(p === pageNum ? PAGE_ACTIVE : {}) }}>
                    {p}
                  </a>
                );
              })}
              {pageNum < totalPages && (
                <a href={buildUrl({ page: pageNum + 1 })} style={PAGE_BTN}>Next →</a>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

// ── Style constants ────────────────────────────────────────────

const TD: CSSProperties = {
  padding:       '10px 12px',
  verticalAlign: 'middle',
};

const PAGE_BTN: CSSProperties = {
  display:        'inline-flex',
  alignItems:     'center',
  justifyContent: 'center',
  minWidth:       30,
  height:         28,
  padding:        '0 8px',
  fontSize:       12,
  fontFamily:     'var(--font-mono)',
  background:     'var(--bg-paper)',
  border:         '1px solid var(--line-strong)',
  borderRadius:   5,
  color:          'var(--fg)',
  textDecoration: 'none',
  cursor:         'pointer',
};

const PAGE_ACTIVE: CSSProperties = {
  background: 'var(--accent)',
  color:      '#fff',
  border:     '1px solid var(--accent)',
  fontWeight: 500,
};
