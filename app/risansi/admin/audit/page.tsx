import type { CSSProperties } from 'react';
import Link from 'next/link';
import { Topbar, Tag } from '@/components/risansi';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser } from '@/lib/risansi-auth';
import { AccessDenied } from '../_components/AccessDenied';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;
const ENTITY_TYPES = ['client_owner', 'client_tour', 'tour_assignment', 'user'];

async function q<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch (err) { console.error('[admin/audit]', err); return fallback; }
}

interface AuditRow {
  id:          number;
  entity_type: string;
  entity_id:   string;
  action:      string;
  old_value:   unknown;
  new_value:   unknown;
  changed_by:  string | null;
  changed_at:  string;
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const me = await getCurrentUser();
  if (me.role !== 'sysadmin') {
    return <AccessDenied crumbs={['System Admin', 'Audit Log']} />;
  }

  const sp = await searchParams;
  const entityFilter = typeof sp.entity === 'string' && ENTITY_TYPES.includes(sp.entity) ? sp.entity : '';
  const pageNum = Math.max(1, parseInt(typeof sp.page === 'string' ? sp.page : '1', 10) || 1);
  const offset = (pageNum - 1) * PAGE_SIZE;

  const where = entityFilter ? 'WHERE entity_type = $1' : '';
  const filterParams = entityFilter ? [entityFilter] : [];

  const [rows, total] = await Promise.all([
    q<AuditRow[]>(async () => {
      const { rows } = await risansiPool.query<AuditRow>(
        `SELECT id, entity_type, entity_id, action, old_value, new_value, changed_by, changed_at::text
         FROM assignment_audit
         ${where}
         ORDER BY changed_at DESC
         LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
        filterParams,
      );
      return rows;
    }, []),
    q<number>(async () => {
      const { rows } = await risansiPool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM assignment_audit ${where}`,
        filterParams,
      );
      return Number(rows[0]?.count ?? 0);
    }, 0),
  ]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  function pageHref(p: number): string {
    const params = new URLSearchParams();
    if (entityFilter) params.set('entity', entityFilter);
    params.set('page', String(p));
    return `/risansi/admin/audit?${params.toString()}`;
  }
  function filterHref(e: string): string {
    const params = new URLSearchParams();
    if (e) params.set('entity', e);
    return `/risansi/admin/audit?${params.toString()}`;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <Topbar crumbs={['System Admin', 'Audit Log']} />
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: 'var(--bg)' }}>
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--fg)' }}>
            Audit Log
          </div>
          <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 3 }}>
            {total.toLocaleString('en-IN')} entr{total !== 1 ? 'ies' : 'y'} · newest first
          </div>
        </div>

        {/* Entity-type filter */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          <Link href={filterHref('')} style={{ ...PILL, ...(entityFilter === '' ? PILL_ACTIVE : {}) }}>All</Link>
          {ENTITY_TYPES.map(e => (
            <Link key={e} href={filterHref(e)} style={{ ...PILL, ...(entityFilter === e ? PILL_ACTIVE : {}) }}>{e}</Link>
          ))}
        </div>

        <div style={PANEL}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: 'var(--bg-elev)' }}>
                  {['When', 'Entity', 'ID', 'Action', 'Old → New', 'By'].map(h => <th key={h} style={TH}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={6} style={{ padding: '40px 0', textAlign: 'center', color: 'var(--fg-3)' }}>No audit entries</td></tr>
                ) : rows.map((r, i) => (
                  <tr key={r.id} style={{ borderBottom: i < rows.length - 1 ? '1px solid var(--line)' : 'none' }}>
                    <td style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)', whiteSpace: 'nowrap' }}>
                      {r.changed_at ? new Date(r.changed_at).toLocaleString('en-IN', {
                        day: '2-digit', month: 'short', year: '2-digit',
                        hour: '2-digit', minute: '2-digit', hour12: false,
                      }) : '—'}
                    </td>
                    <td style={TD}><Tag>{r.entity_type}</Tag></td>
                    <td style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)' }}>{r.entity_id}</td>
                    <td style={TD}><Tag kind={actionKind(r.action)}>{r.action}</Tag></td>
                    <td style={{ ...TD, maxWidth: 360 }}>
                      <div style={DIFF}>
                        <span style={{ color: 'var(--neg)' }}>{fmtVal(r.old_value)}</span>
                        <span style={{ color: 'var(--fg-3)' }}>→</span>
                        <span style={{ color: 'var(--pos)' }}>{fmtVal(r.new_value)}</span>
                      </div>
                    </td>
                    <td style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)' }}>{r.changed_by ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 }}>
            <span style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
              Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total.toLocaleString('en-IN')}
            </span>
            <div style={{ display: 'flex', gap: 4 }}>
              {pageNum > 1 && <Link href={pageHref(pageNum - 1)} style={PAGE_BTN}>← Prev</Link>}
              <span style={{ ...PAGE_BTN, ...PAGE_ACTIVE }}>{pageNum}</span>
              {pageNum < totalPages && <Link href={pageHref(pageNum + 1)} style={PAGE_BTN}>Next →</Link>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function actionKind(action: string): 'pos' | 'neg' | 'warn' | undefined {
  if (action === 'create' || action === 'add') return 'pos';
  if (action === 'delete' || action === 'remove') return 'neg';
  if (action === 'update') return 'warn';
  return undefined;
}

function fmtVal(v: unknown): string {
  if (v == null) return '∅';
  if (typeof v === 'object') {
    const s = JSON.stringify(v);
    return s.length > 120 ? s.slice(0, 117) + '…' : s;
  }
  return String(v);
}

const PANEL: CSSProperties = { background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', overflow: 'hidden' };
const TH: CSSProperties = { padding: '9px 12px', textAlign: 'left', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, color: 'var(--fg-3)', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' };
const TD: CSSProperties = { padding: '10px 12px', verticalAlign: 'middle' };
const DIFF: CSSProperties = { display: 'flex', gap: 6, alignItems: 'center', fontFamily: 'var(--font-mono)', fontSize: 11, overflow: 'hidden' };
const PILL: CSSProperties = { padding: '5px 12px', fontSize: 12, fontFamily: 'inherit', background: 'var(--bg-paper)', border: '1px solid var(--line-strong)', borderRadius: 16, color: 'var(--fg-2)', textDecoration: 'none', cursor: 'pointer' };
const PILL_ACTIVE: CSSProperties = { background: 'var(--accent)', color: '#fff', border: '1px solid var(--accent)' };
const PAGE_BTN: CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 30, height: 28, padding: '0 8px', fontSize: 12, fontFamily: 'var(--font-mono)', background: 'var(--bg-paper)', border: '1px solid var(--line-strong)', borderRadius: 5, color: 'var(--fg)', textDecoration: 'none' };
const PAGE_ACTIVE: CSSProperties = { background: 'var(--accent)', color: '#fff', border: '1px solid var(--accent)', fontWeight: 500 };
