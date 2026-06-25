import type { CSSProperties } from 'react';
import Link from 'next/link';
import { Topbar, Tag } from '@/components/risansi';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser } from '@/lib/risansi-auth';
import { AccessDenied } from '../_components/AccessDenied';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

async function q<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch (err) { console.error('[admin/audit]', err); return fallback; }
}

type Tab = 'usage' | 'logins' | 'activity' | 'changes';
const TABS: { id: Tab; label: string }[] = [
  { id: 'usage',    label: 'Usage & Time' },
  { id: 'logins',   label: 'Logins & Sessions' },
  { id: 'activity', label: 'Activity' },
  { id: 'changes',  label: 'Ownership Changes' },
];

// Time windows for the Usage tab.
const WINDOWS: { id: string; label: string; interval: string | null }[] = [
  { id: '1d',  label: 'Today',   interval: '1 day' },
  { id: '7d',  label: '7 days',  interval: '7 days' },
  { id: '30d', label: '30 days', interval: '30 days' },
  { id: 'all', label: 'All',     interval: null },
];

// Friendly labels for normalised page paths (ActivityTracker stores :id paths).
const PAGE_LABELS: Record<string, string> = {
  '/risansi': 'Dashboard',
  '/risansi/clients': 'Client 360 · list',
  '/risansi/clients/:id': 'Client 360 · detail',
  '/risansi/field': 'Field Activity',
  '/risansi/revenue': 'Revenue',
  '/risansi/pipeline': 'Opportunities',
  '/risansi/compete': 'Competition',
  '/risansi/complaints': 'Complaints',
  '/risansi/visits/:id': 'Visit detail',
  '/risansi/mobile': 'Mobile dashboard',
  '/risansi/admin/reps': 'Tours & Reps',
  '/risansi/admin/clients': 'Client Master',
  '/risansi/admin/revenue': 'Revenue Upload',
  '/risansi/admin/audit': 'Audit Log',
  '/risansi/admin/settings': 'Settings',
  '/admin': 'Users & Access',
};
function pageLabel(path: string): string { return PAGE_LABELS[path] ?? path; }

const LOGIN_EVENTS = ['login', 'login_failed', 'logout', 'password_changed'];
const ACTIVITY_ACTIONS = ['create', 'update', 'delete', 'submit', 'assign', 'export', 'activity'];

interface LoginRow { id: number; event: string; email: string | null; role: string | null; ip: string | null; user_agent: string | null; reason: string | null; created_at: string; }
interface ActivityRow { id: number; actor_email: string | null; actor_role: string | null; action: string; entity_type: string | null; entity_id: string | null; entity_label: string | null; summary: string | null; ip: string | null; created_at: string; }
interface ChangeRow { id: number; entity_type: string; entity_id: string; action: string; old_value: unknown; new_value: unknown; changed_by: string | null; changed_at: string; }
interface UsageUser { email: string; role: string | null; total: number; sessions: number; pages: number; last_active: string; }
interface UsagePage { path: string; total: number; hits: number; last: string; }
interface UsageSession { session_id: string; started: string; ended: string; active: number; }

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
  const tab: Tab = (typeof sp.tab === 'string' && TABS.some(t => t.id === sp.tab) ? sp.tab : 'usage') as Tab;
  const win = typeof sp.win === 'string' && WINDOWS.some(w => w.id === sp.win) ? sp.win : '7d';
  const winInterval = WINDOWS.find(w => w.id === win)?.interval ?? null;
  const winClause = winInterval ? `AND occurred_at >= NOW() - INTERVAL '${winInterval}'` : '';
  const selUser = typeof sp.user === 'string' ? sp.user.trim().toLowerCase() : '';
  const qStr = typeof sp.q === 'string' ? sp.q.trim() : '';
  const evt  = typeof sp.event === 'string' ? sp.event : '';
  const act  = typeof sp.action === 'string' ? sp.action : '';
  const pageNum = Math.max(1, parseInt(typeof sp.page === 'string' ? sp.page : '1', 10) || 1);
  const offset = (pageNum - 1) * PAGE_SIZE;

  // ── Top stats (security/overview) ──
  const stats = await q(async () => {
    const { rows } = await risansiPool.query<{ logins24: string; failed24: string; users24: string; acts24: string }>(`
      SELECT
        (SELECT COUNT(*) FROM auth_audit WHERE event='login'        AND created_at >= NOW() - INTERVAL '24 hours')::text AS logins24,
        (SELECT COUNT(*) FROM auth_audit WHERE event='login_failed' AND created_at >= NOW() - INTERVAL '24 hours')::text AS failed24,
        (SELECT COUNT(DISTINCT lower(email)) FROM auth_audit WHERE event='login' AND created_at >= NOW() - INTERVAL '24 hours')::text AS users24,
        (SELECT COUNT(*) FROM audit_log WHERE created_at >= NOW() - INTERVAL '24 hours')::text AS acts24
    `);
    return rows[0] ?? { logins24: '0', failed24: '0', users24: '0', acts24: '0' };
  }, { logins24: '0', failed24: '0', users24: '0', acts24: '0' });

  // ── Tab data ──
  let total = 0;
  let logins: LoginRow[] = [], activity: ActivityRow[] = [], changes: ChangeRow[] = [];
  let usageUsers: UsageUser[] = [], usagePages: UsagePage[] = [], usageSessions: UsageSession[] = [];

  if (tab === 'usage') {
    if (selUser) {
      [usagePages, usageSessions] = await Promise.all([
        q<UsagePage[]>(async () => (await risansiPool.query<UsagePage>(
          `SELECT path, SUM(active_seconds)::int total, COUNT(*)::int hits, MAX(occurred_at)::text last
             FROM page_activity WHERE lower(user_email) = $1 ${winClause}
            GROUP BY path ORDER BY total DESC`, [selUser])).rows, []),
        q<UsageSession[]>(async () => (await risansiPool.query<UsageSession>(
          `SELECT COALESCE(session_id,'(unknown)') AS session_id, MIN(occurred_at)::text AS started,
                  MAX(occurred_at)::text AS ended, SUM(active_seconds)::int AS active
             FROM page_activity WHERE lower(user_email) = $1 ${winClause}
            GROUP BY session_id ORDER BY MIN(occurred_at) DESC LIMIT 50`, [selUser])).rows, []),
      ]);
    } else {
      usageUsers = await q<UsageUser[]>(async () => (await risansiPool.query<UsageUser>(
        `SELECT lower(user_email) AS email, MAX(role) AS role, SUM(active_seconds)::int AS total,
                COUNT(DISTINCT session_id)::int AS sessions, COUNT(DISTINCT path)::int AS pages,
                MAX(occurred_at)::text AS last_active
           FROM page_activity WHERE user_email IS NOT NULL ${winClause}
          GROUP BY lower(user_email) ORDER BY total DESC LIMIT 200`)).rows, []);
    }
  } else if (tab === 'logins') {
    const conds: string[] = [], params: (string)[] = [];
    if (qStr) { params.push(`%${qStr.toLowerCase()}%`); conds.push(`(lower(email) LIKE $${params.length} OR ip LIKE $${params.length})`); }
    if (LOGIN_EVENTS.includes(evt)) { params.push(evt); conds.push(`event = $${params.length}`); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    [logins, total] = await Promise.all([
      q<LoginRow[]>(async () => (await risansiPool.query<LoginRow>(
        `SELECT id, event, email, role, ip, user_agent, reason, created_at::text FROM auth_audit ${where} ORDER BY created_at DESC LIMIT ${PAGE_SIZE} OFFSET ${offset}`, params)).rows, []),
      q<number>(async () => Number((await risansiPool.query<{ c: string }>(`SELECT COUNT(*)::text c FROM auth_audit ${where}`, params)).rows[0]?.c ?? 0), 0),
    ]);
  } else if (tab === 'activity') {
    const conds: string[] = [], params: (string)[] = [];
    if (qStr) { params.push(`%${qStr.toLowerCase()}%`); conds.push(`(lower(actor_email) LIKE $${params.length} OR lower(COALESCE(entity_label,'')) LIKE $${params.length} OR lower(COALESCE(summary,'')) LIKE $${params.length})`); }
    if (ACTIVITY_ACTIONS.includes(act)) { params.push(act); conds.push(`action = $${params.length}`); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    [activity, total] = await Promise.all([
      q<ActivityRow[]>(async () => (await risansiPool.query<ActivityRow>(
        `SELECT id, actor_email, actor_role, action, entity_type, entity_id, entity_label, summary, ip, created_at::text FROM audit_log ${where} ORDER BY created_at DESC LIMIT ${PAGE_SIZE} OFFSET ${offset}`, params)).rows, []),
      q<number>(async () => Number((await risansiPool.query<{ c: string }>(`SELECT COUNT(*)::text c FROM audit_log ${where}`, params)).rows[0]?.c ?? 0), 0),
    ]);
  } else {
    const conds: string[] = [], params: (string)[] = [];
    if (qStr) { params.push(`%${qStr.toLowerCase()}%`); conds.push(`(lower(COALESCE(changed_by,'')) LIKE $${params.length} OR lower(entity_type) LIKE $${params.length})`); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    [changes, total] = await Promise.all([
      q<ChangeRow[]>(async () => (await risansiPool.query<ChangeRow>(
        `SELECT id, entity_type, entity_id, action, old_value, new_value, changed_by, changed_at::text FROM assignment_audit ${where} ORDER BY changed_at DESC LIMIT ${PAGE_SIZE} OFFSET ${offset}`, params)).rows, []),
      q<number>(async () => Number((await risansiPool.query<{ c: string }>(`SELECT COUNT(*)::text c FROM assignment_audit ${where}`, params)).rows[0]?.c ?? 0), 0),
    ]);
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);

  function url(over: Record<string, string | number | undefined>): string {
    const base: Record<string, string> = { tab };
    if (qStr) base.q = qStr;
    if (evt)  base.event = evt;
    if (act)  base.action = act;
    base.page = String(pageNum);
    const merged = { ...base, ...Object.fromEntries(Object.entries(over).map(([k, v]) => [k, v == null ? undefined : String(v)])) };
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) if (v != null && v !== '') p.set(k, v);
    return `/risansi/admin/audit?${p.toString()}`;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <Topbar crumbs={['System Admin', 'Audit Log']} />
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: 'var(--bg)' }} className="r-page">
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--fg)' }}>Audit Log</div>
          <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 3 }}>
            Full activity trail · who signed in, when, and everything they did
          </div>
        </div>

        {/* Stat strip */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }} className="r-grid-4">
          <Stat label="Logins · 24h"  value={stats.logins24} />
          <Stat label="Failed · 24h"  value={stats.failed24} accent={Number(stats.failed24) > 0 ? 'var(--neg)' : undefined} />
          <Stat label="Active users · 24h" value={stats.users24} />
          <Stat label="Actions · 24h" value={stats.acts24} />
        </div>

        {/* Tabs */}
        <div className="field-tabs" style={{ display: 'flex', gap: 2, marginBottom: 14, borderBottom: '1px solid var(--line)', overflowX: 'auto' }}>
          {TABS.map(t => (
            <Link key={t.id} href={`/risansi/admin/audit?tab=${t.id}`} aria-current={tab === t.id} style={{
              display: 'block', padding: '9px 16px', fontSize: 13, whiteSpace: 'nowrap', flexShrink: 0,
              fontWeight: tab === t.id ? 600 : 400, color: tab === t.id ? 'var(--accent)' : 'var(--fg-3)',
              textDecoration: 'none', borderBottom: tab === t.id ? '2px solid var(--accent)' : '2px solid transparent', marginBottom: -1,
            }}>{t.label}</Link>
          ))}
        </div>

        {tab === 'usage' ? (
          <UsageView users={usageUsers} pages={usagePages} sessions={usageSessions} selUser={selUser} win={win} />
        ) : (<>
        {/* Search + filters */}
        <form method="GET" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          <input type="hidden" name="tab" value={tab} />
          <input name="q" defaultValue={qStr} placeholder={tab === 'logins' ? 'Search email or IP…' : 'Search user, entity, action…'}
            style={{ flex: '1 1 220px', minWidth: 180, padding: '8px 12px', fontSize: 13, fontFamily: 'inherit', background: 'var(--bg-paper)', border: '1px solid var(--line-strong)', borderRadius: 8, color: 'var(--fg)' }} />
          {tab === 'logins' && (
            <select name="event" defaultValue={evt} style={SELECT}>
              <option value="">All events</option>
              {LOGIN_EVENTS.map(e => <option key={e} value={e}>{e}</option>)}
            </select>
          )}
          {tab === 'activity' && (
            <select name="action" defaultValue={act} style={SELECT}>
              <option value="">All actions</option>
              {ACTIVITY_ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          )}
          <button type="submit" style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, background: '#1A5CB8', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit' }}>Search</button>
          {(qStr || evt || act) && <Link href={`/risansi/admin/audit?tab=${tab}`} style={{ fontSize: 12, color: 'var(--fg-3)' }}>Clear</Link>}
        </form>

        <div style={{ fontSize: 12, color: 'var(--fg-3)', marginBottom: 8 }}>{total.toLocaleString('en-IN')} entr{total !== 1 ? 'ies' : 'y'} · newest first</div>

        {/* Table */}
        <div style={PANEL}>
          <div style={{ overflowX: 'auto' }}>
            {tab === 'logins' && <LoginsTable rows={logins} />}
            {tab === 'activity' && <ActivityTable rows={activity} />}
            {tab === 'changes' && <ChangesTable rows={changes} />}
          </div>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 }}>
            <span style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
              Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total.toLocaleString('en-IN')}
            </span>
            <div style={{ display: 'flex', gap: 4 }}>
              {pageNum > 1 && <Link href={url({ page: pageNum - 1 })} style={PAGE_BTN}>← Prev</Link>}
              <span style={{ ...PAGE_BTN, ...PAGE_ACTIVE }}>{pageNum}</span>
              {pageNum < totalPages && <Link href={url({ page: pageNum + 1 })} style={PAGE_BTN}>Next →</Link>}
            </div>
          </div>
        )}
        </>)}
      </div>
    </div>
  );
}

// ── Tables ──────────────────────────────────────────────────────

function LoginsTable({ rows }: { rows: LoginRow[] }) {
  return (
    <table className="r-cards" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead><tr style={{ background: 'var(--bg-elev)' }}>{['When', 'Event', 'User', 'Role', 'IP', 'Device', 'Reason'].map(h => <th key={h} style={TH}>{h}</th>)}</tr></thead>
      <tbody>
        {rows.length === 0 ? <tr><td colSpan={7} style={EMPTY}>No login events yet</td></tr> : rows.map((r, i) => (
          <tr key={r.id} style={{ borderBottom: i < rows.length - 1 ? '1px solid var(--line)' : 'none' }}>
            <td data-label="When" style={MONO}>{fmtWhen(r.created_at)}</td>
            <td data-label="Event" style={TD}><Tag kind={eventKind(r.event)} dot>{eventLabel(r.event)}</Tag></td>
            <td data-label="" style={{ ...TD, fontWeight: 500 }}>{r.email ?? '—'}</td>
            <td data-label="Role" style={TD}>{r.role ? <Tag kind={r.role === 'sysadmin' || r.role === 'admin' ? 'accent' : undefined}>{r.role}</Tag> : '—'}</td>
            <td data-label="IP" style={MONO}>{r.ip ?? '—'}</td>
            <td data-label="Device" style={{ ...TD, fontSize: 11, color: 'var(--fg-3)', maxWidth: 220 }} title={r.user_agent ?? ''}>{deviceOf(r.user_agent)}</td>
            <td data-label="Reason" style={{ ...TD, fontSize: 11, color: r.reason ? 'var(--neg)' : 'var(--fg-3)' }}>{r.reason ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ActivityTable({ rows }: { rows: ActivityRow[] }) {
  return (
    <table className="r-cards" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead><tr style={{ background: 'var(--bg-elev)' }}>{['When', 'Actor', 'Action', 'Entity', 'What', 'IP'].map(h => <th key={h} style={TH}>{h}</th>)}</tr></thead>
      <tbody>
        {rows.length === 0 ? <tr><td colSpan={6} style={EMPTY}>No activity recorded yet</td></tr> : rows.map((r, i) => (
          <tr key={r.id} style={{ borderBottom: i < rows.length - 1 ? '1px solid var(--line)' : 'none' }}>
            <td data-label="When" style={MONO}>{fmtWhen(r.created_at)}</td>
            <td data-label="" style={{ ...TD, fontWeight: 500 }}>{r.actor_email ?? '—'}{r.actor_role ? <span style={{ color: 'var(--fg-3)', fontWeight: 400, fontSize: 11 }}> · {r.actor_role}</span> : null}</td>
            <td data-label="Action" style={TD}><Tag kind={actionKind(r.action)}>{r.action}</Tag></td>
            <td data-label="Entity" style={{ ...TD, fontSize: 11 }}>{r.entity_type ?? '—'}{r.entity_id ? <span style={{ color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}> #{r.entity_id}</span> : null}</td>
            <td data-label="What" style={{ ...TD, maxWidth: 360 }}>{r.summary ?? r.entity_label ?? '—'}</td>
            <td data-label="IP" style={MONO}>{r.ip ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ChangesTable({ rows }: { rows: ChangeRow[] }) {
  return (
    <table className="r-cards" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead><tr style={{ background: 'var(--bg-elev)' }}>{['When', 'Entity', 'ID', 'Action', 'Old → New', 'By'].map(h => <th key={h} style={TH}>{h}</th>)}</tr></thead>
      <tbody>
        {rows.length === 0 ? <tr><td colSpan={6} style={EMPTY}>No ownership changes</td></tr> : rows.map((r, i) => (
          <tr key={r.id} style={{ borderBottom: i < rows.length - 1 ? '1px solid var(--line)' : 'none' }}>
            <td data-label="When" style={MONO}>{fmtWhen(r.changed_at)}</td>
            <td data-label="Entity" style={TD}><Tag>{r.entity_type}</Tag></td>
            <td data-label="ID" style={MONO}>{r.entity_id}</td>
            <td data-label="Action" style={TD}><Tag kind={actionKind(r.action)}>{r.action}</Tag></td>
            <td data-label="Old → New" style={{ ...TD, maxWidth: 360 }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontFamily: 'var(--font-mono)', fontSize: 11, overflow: 'hidden' }}>
                <span style={{ color: 'var(--neg)' }}>{fmtVal(r.old_value)}</span>
                <span style={{ color: 'var(--fg-3)' }}>→</span>
                <span style={{ color: 'var(--pos)' }}>{fmtVal(r.new_value)}</span>
              </div>
            </td>
            <td data-label="By" style={MONO}>{r.changed_by ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Helpers ─────────────────────────────────────────────────────

function fmtWhen(s: string): string {
  if (!s) return '—';
  return new Date(s).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}
function eventLabel(e: string): string { return e === 'login_failed' ? 'failed login' : e === 'password_changed' ? 'password change' : e; }
function eventKind(e: string): 'pos' | 'neg' | 'warn' | undefined { return e === 'login' ? 'pos' : e === 'login_failed' ? 'neg' : e === 'password_changed' ? 'warn' : undefined; }
function actionKind(a: string): 'pos' | 'neg' | 'warn' | 'accent' | undefined { return a === 'create' ? 'pos' : a === 'delete' ? 'neg' : a === 'update' ? 'warn' : a === 'submit' || a === 'assign' ? 'accent' : undefined; }
function deviceOf(ua: string | null): string {
  if (!ua) return '—';
  const os = /Windows/.test(ua) ? 'Windows' : /iPhone|iPad|iOS/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  const br = /Edg/.test(ua) ? 'Edge' : /Chrome/.test(ua) ? 'Chrome' : /Firefox/.test(ua) ? 'Firefox' : /Safari/.test(ua) ? 'Safari' : '';
  return [br, os].filter(Boolean).join(' · ') || ua.slice(0, 28);
}
function fmtVal(v: unknown): string {
  if (v == null) return '∅';
  if (typeof v === 'object') { const s = JSON.stringify(v); return s.length > 100 ? s.slice(0, 97) + '…' : s; }
  return String(v);
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ ...PANEL, padding: 12 }}>
      <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 600, color: accent ?? 'var(--fg)', marginTop: 4 }}>{Number(value).toLocaleString('en-IN')}</div>
    </div>
  );
}

function fmtDuration(sec: number): string {
  if (!sec || sec < 0) return '0m';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

// ── Usage & Time tab ────────────────────────────────────────────

function UsageView({ users, pages, sessions, selUser, win }: {
  users: UsageUser[]; pages: UsagePage[]; sessions: UsageSession[]; selUser: string; win: string;
}) {
  const link = (over: Record<string, string>) => {
    const p = new URLSearchParams({ tab: 'usage', win, ...over });
    return `/risansi/admin/audit?${p.toString()}`;
  };
  const windowPills = (
    <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
      {WINDOWS.map(w => (
        <Link key={w.id} href={link({ ...(selUser ? { user: selUser } : {}), win: w.id })} style={{
          padding: '5px 12px', fontSize: 12, fontWeight: 600, borderRadius: 999, textDecoration: 'none',
          border: `1px solid ${w.id === win ? '#0A3D8F' : 'var(--line-strong)'}`,
          background: w.id === win ? '#0A3D8F' : 'var(--bg-paper)', color: w.id === win ? '#fff' : 'var(--fg-3)',
        }}>{w.label}</Link>
      ))}
    </div>
  );

  // ── Per-user drill-down ──
  if (selUser) {
    const totalActive = pages.reduce((s, p) => s + p.total, 0);
    const maxPage = Math.max(1, ...pages.map(p => p.total));
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
          <Link href={link({})} style={{ fontSize: 12, color: 'var(--accent)', textDecoration: 'none' }}>← All users</Link>
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--fg)' }}>{selUser}</span>
          <span style={{ ...DUR_BADGE }}>{fmtDuration(totalActive)} active</span>
          <span style={{ fontSize: 12, color: 'var(--fg-3)' }}>· {sessions.length} session{sessions.length !== 1 ? 's' : ''}</span>
        </div>
        {windowPills}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.3fr) minmax(0,1fr)', gap: 14 }} className="r-grid-2">
          {/* Time per page */}
          <div style={PANEL}>
            <div style={SECTION_H}>Time per page</div>
            <table className="r-cards" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr style={{ background: 'var(--bg-elev)' }}>{['Page', 'Active time', 'Visits'].map(h => <th key={h} style={TH}>{h}</th>)}</tr></thead>
              <tbody>
                {pages.length === 0 ? <tr><td colSpan={3} style={EMPTY}>No page activity</td></tr> : pages.map((p, i) => (
                  <tr key={i} style={{ borderBottom: i < pages.length - 1 ? '1px solid var(--line)' : 'none' }}>
                    <td data-label="" style={{ ...TD, fontWeight: 500 }}>
                      {pageLabel(p.path)}
                      <div style={{ height: 3, marginTop: 4, borderRadius: 2, background: 'var(--accent)', width: `${Math.round((p.total / maxPage) * 100)}%`, minWidth: 4, opacity: 0.5 }} />
                    </td>
                    <td data-label="Active time" style={{ ...MONO, color: 'var(--fg)' }}>{fmtDuration(p.total)}</td>
                    <td data-label="Visits" style={MONO}>{p.hits}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Sessions */}
          <div style={PANEL}>
            <div style={SECTION_H}>Sessions</div>
            <table className="r-cards" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr style={{ background: 'var(--bg-elev)' }}>{['Started', 'Active', 'Span'].map(h => <th key={h} style={TH}>{h}</th>)}</tr></thead>
              <tbody>
                {sessions.length === 0 ? <tr><td colSpan={3} style={EMPTY}>No sessions</td></tr> : sessions.map((s, i) => {
                  const span = Math.max(0, Math.round((new Date(s.ended).getTime() - new Date(s.started).getTime()) / 1000));
                  return (
                    <tr key={i} style={{ borderBottom: i < sessions.length - 1 ? '1px solid var(--line)' : 'none' }}>
                      <td data-label="" style={MONO}>{fmtWhen(s.started)}</td>
                      <td data-label="Active" style={{ ...MONO, color: 'var(--fg)' }}>{fmtDuration(s.active)}</td>
                      <td data-label="Span" style={MONO}>{fmtDuration(span)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // ── Per-user summary ──
  const grandTotal = users.reduce((s, u) => s + u.total, 0);
  return (
    <div>
      {windowPills}
      <div style={{ fontSize: 12, color: 'var(--fg-3)', marginBottom: 8 }}>
        {users.length} user{users.length !== 1 ? 's' : ''} active · {fmtDuration(grandTotal)} total active time · click a user for the page breakdown
      </div>
      <div style={PANEL}>
        <div style={{ overflowX: 'auto' }}>
          <table className="r-cards" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr style={{ background: 'var(--bg-elev)' }}>{['User', 'Role', 'Active time', 'Sessions', 'Pages', 'Last active'].map(h => <th key={h} style={TH}>{h}</th>)}</tr></thead>
            <tbody>
              {users.length === 0 ? (
                <tr><td colSpan={6} style={EMPTY}>No activity recorded yet in this window. Data appears once users browse the portal.</td></tr>
              ) : users.map((u, i) => (
                <tr key={i} style={{ borderBottom: i < users.length - 1 ? '1px solid var(--line)' : 'none' }}>
                  <td data-label="" style={{ ...TD, fontWeight: 500 }}>
                    <Link href={link({ user: u.email })} style={{ color: 'var(--accent)', textDecoration: 'none' }}>{u.email}</Link>
                  </td>
                  <td data-label="Role" style={TD}>{u.role ? <Tag kind={u.role === 'sysadmin' || u.role === 'admin' ? 'accent' : undefined}>{u.role}</Tag> : '—'}</td>
                  <td data-label="Active time" style={{ ...MONO, color: 'var(--fg)', fontWeight: 600 }}>{fmtDuration(u.total)}</td>
                  <td data-label="Sessions" style={MONO}>{u.sessions}</td>
                  <td data-label="Pages" style={MONO}>{u.pages}</td>
                  <td data-label="Last active" style={MONO}>{fmtWhen(u.last_active)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const PANEL: CSSProperties = { background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', overflow: 'hidden' };
const SECTION_H: CSSProperties = { padding: '10px 14px', borderBottom: '1px solid var(--line)', fontSize: 11, fontWeight: 700, color: '#0A3D8F', textTransform: 'uppercase', letterSpacing: '0.07em' };
const DUR_BADGE: CSSProperties = { padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600, background: 'var(--accent-soft, #EBF1FB)', color: '#0A3D8F', fontFamily: 'var(--font-mono)' };
const TH: CSSProperties = { padding: '9px 12px', textAlign: 'left', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, color: 'var(--fg-3)', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' };
const TD: CSSProperties = { padding: '10px 12px', verticalAlign: 'middle' };
const MONO: CSSProperties = { ...TD, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)', whiteSpace: 'nowrap' };
const EMPTY: CSSProperties = { padding: '40px 0', textAlign: 'center', color: 'var(--fg-3)' };
const SELECT: CSSProperties = { padding: '8px 12px', fontSize: 13, fontFamily: 'inherit', background: 'var(--bg-paper)', border: '1px solid var(--line-strong)', borderRadius: 8, color: 'var(--fg)' };
const PAGE_BTN: CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 30, height: 28, padding: '0 8px', fontSize: 12, fontFamily: 'var(--font-mono)', background: 'var(--bg-paper)', border: '1px solid var(--line-strong)', borderRadius: 5, color: 'var(--fg)', textDecoration: 'none' };
const PAGE_ACTIVE: CSSProperties = { background: 'var(--accent)', color: '#fff', border: '1px solid var(--accent)', fontWeight: 500 };
