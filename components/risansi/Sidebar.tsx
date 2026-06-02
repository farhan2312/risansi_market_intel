'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { CSSProperties } from 'react';
import { UserMenu } from './UserMenu';

// ── Types ─────────────────────────────────────────────────────

export type SidebarRole = 'rep' | 'manager' | 'exec' | 'admin' | 'sysadmin';

export interface SidebarUser {
  name: string;
  initials: string;
  role: string;
  email: string;
}

export interface SidebarAlerts {
  tasks?: number;
  compete?: number;
  admin?: number;
}

export interface SidebarProps {
  active?: string;
  role: SidebarRole;
  user: SidebarUser;
  alerts?: SidebarAlerts;
  pendingCount?: number;
}

// ── Nav item definitions ───────────────────────────────────────

interface NavItem {
  id: string;
  href: string;
  label: string;
  Icon: () => React.JSX.Element;
  alertKey?: keyof SidebarAlerts;
  isAlert?: boolean;
}

// Rep: My Dashboard, Client 360, Field Activity, My Pipeline
const REP_NAV: NavItem[] = [
  { id: 'dash',     href: '/risansi',            label: 'My Dashboard',   Icon: IcDash },
  { id: 'client360',href: '/risansi/clients',    label: 'Client 360',     Icon: IcClient },
  { id: 'field',    href: '/risansi/field',      label: 'Field Activity', Icon: IcMap },
  { id: 'pipeline', href: '/risansi/pipeline',   label: 'My Pipeline',    Icon: IcPipeline },
];

// Manager: same as Rep + Competitive
const MANAGER_NAV: NavItem[] = [
  { id: 'dash',     href: '/risansi',            label: 'Dashboard',      Icon: IcDash },
  { id: 'client360',href: '/risansi/clients',    label: 'Client 360',     Icon: IcClient },
  { id: 'field',    href: '/risansi/field',      label: 'Field Activity', Icon: IcMap },
  { id: 'pipeline', href: '/risansi/pipeline',   label: 'Pipeline',       Icon: IcPipeline },
  { id: 'compete',  href: '/risansi/compete',    label: 'Competitive',    Icon: IcTower, alertKey: 'compete' },
];

// Admin / Sysadmin: same as Manager (same main nav)
const ADMIN_MAIN_NAV: NavItem[] = [
  { id: 'dash',     href: '/risansi',            label: 'Dashboard',      Icon: IcDash },
  { id: 'client360',href: '/risansi/clients',    label: 'Client 360',     Icon: IcClient },
  { id: 'field',    href: '/risansi/field',      label: 'Field Activity', Icon: IcMap },
  { id: 'pipeline', href: '/risansi/pipeline',   label: 'Pipeline',       Icon: IcPipeline },
  { id: 'compete',  href: '/risansi/compete',    label: 'Competitive',    Icon: IcTower, alertKey: 'compete' },
];

// Admin section (only for admin/sysadmin)
const ADMIN_NAV: NavItem[] = [
  { id: 'clients-admin', href: '/risansi/admin/clients', label: 'Client Master',   Icon: IcList },
  { id: 'revenue-admin', href: '/risansi/admin/revenue', label: 'Revenue Upload',  Icon: IcBag },
  { id: 'reps-admin',    href: '/risansi/admin/reps',    label: 'Reps & Routes',   Icon: IcUser },
  { id: 'access',        href: '/admin',                 label: 'Access Approval', Icon: IcKey, isAlert: true },
];

// Path → id mapping for URL-based active derivation
const PATH_TO_ID: [string, string][] = [
  ['/admin',                    'access'],
  ['/risansi/admin/clients',    'clients-admin'],
  ['/risansi/admin/revenue',    'revenue-admin'],
  ['/risansi/admin/reps',       'reps-admin'],
  ['/risansi/compete',          'compete'],
  ['/risansi/clients',          'client360'],
  ['/risansi/pipeline',         'pipeline'],
  ['/risansi/field',            'field'],
  ['/risansi',                  'dash'],
];

function deriveActive(pathname: string): string {
  for (const [path, id] of PATH_TO_ID) {
    if (pathname === path || pathname.startsWith(path + '/')) return id;
  }
  return '';
}

// ── Component ─────────────────────────────────────────────────

export function Sidebar({ active, role, user, alerts = {}, pendingCount = 0 }: SidebarProps) {
  const pathname = usePathname();
  const resolvedActive = active ?? deriveActive(pathname);

  const isAdmin = role === 'admin' || role === 'sysadmin';
  const mainItems = role === 'rep' ? REP_NAV : isAdmin ? ADMIN_MAIN_NAV : MANAGER_NAV;

  return (
    <aside style={ASIDE}>
      {/* Brand */}
      <div style={LOGO_CARD}>
        <div style={{ background: '#fff', borderRadius: 8, padding: '6px 10px', display: 'inline-flex', alignItems: 'center' }}>
          <img src="/logo.png" alt="Risansi Industries Ltd" style={{ height: '40px', width: 'auto', objectFit: 'contain', display: 'block' }} />
        </div>
      </div>

      {/* Sales group */}
      <NavGroup label="Sales">
        {mainItems.map((item) => (
          <NavLink
            key={item.id}
            item={item}
            isActive={item.id === resolvedActive}
            badge={item.alertKey ? alerts[item.alertKey] : undefined}
          />
        ))}
      </NavGroup>

      {/* Admin group — admin/sysadmin only */}
      {isAdmin && (
        <NavGroup label="Admin">
          {ADMIN_NAV.map((item) => (
            <NavLink
              key={item.id}
              item={item}
              isActive={item.id === resolvedActive}
              badge={
                item.id === 'access'
                  ? (pendingCount > 0 ? pendingCount : undefined)
                  : item.alertKey ? alerts[item.alertKey] : undefined
              }
            />
          ))}
        </NavGroup>
      )}

      {/* Intelligence group (future) */}
      <NavGroup label="Intelligence">
        <NavLink
          item={{ id: 'reports', href: '/risansi/reports', label: 'Reports', Icon: IcNote }}
          isActive={'reports' === resolvedActive}
        />
      </NavGroup>

      {/* User */}
      <UserMenu name={user.name} email={user.email} />
    </aside>
  );
}

// ── Sub-components ────────────────────────────────────────────

function NavGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: '0 8px 4px' }}>
      <div style={GROUP_LABEL}>{label}</div>
      {children}
    </div>
  );
}

function NavLink({ item, isActive, badge }: {
  item: NavItem;
  isActive: boolean;
  badge?: number;
}) {
  const { href, label, Icon } = item;
  return (
    <Link href={href} style={{ textDecoration: 'none', display: 'block' }}>
      <div style={{
        ...LINK_BASE,
        color:      isActive ? '#FFFFFF' : '#B8C9E8',
        background: isActive ? '#1A5CB8' : 'transparent',
      }}>
        {isActive && <span style={ACTIVE_BAR} />}
        <Icon />
        <span style={{ flex: 1 }}>{label}</span>
        {badge != null && (
          <span style={{
            ...BADGE,
            background: item.isAlert ? '#DC2626' : 'rgba(255,255,255,0.12)',
          }}>{badge}</span>
        )}
      </div>
    </Link>
  );
}

// ── Styles ─────────────────────────────────────────────────────

const ASIDE: CSSProperties = {
  width: 240, flexShrink: 0,
  background: '#0A1628', color: '#B8C9E8',
  display: 'flex', flexDirection: 'column',
  padding: 0, paddingBottom: 18,
  borderRight: '1px solid rgba(255,255,255,0.06)',
  height: '100%', overflowX: 'hidden', overflowY: 'auto',
};

const LOGO_CARD: CSSProperties = {
  display: 'flex', alignItems: 'center', padding: '16px 16px 12px',
};

const GROUP_LABEL: CSSProperties = {
  margin: '20px 0 6px 8px', fontSize: 10,
  textTransform: 'uppercase', letterSpacing: '0.12em',
  color: '#00B4D8', fontWeight: 600,
};

const LINK_BASE: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10,
  padding: '7px 10px', borderRadius: 5,
  fontSize: 13.5, fontWeight: 500, letterSpacing: '0.01em',
  position: 'relative', cursor: 'pointer',
};

const ACTIVE_BAR: CSSProperties = {
  position: 'absolute', left: -8, top: 6, bottom: 6,
  width: 3, borderRadius: 2, background: '#00B4D8',
};

const BADGE: CSSProperties = {
  color: '#fff', padding: '1px 6px', borderRadius: 8,
  fontSize: 10, fontFamily: 'var(--font-mono)',
};

// ── Icons ─────────────────────────────────────────────────────

const ic = (path: React.ReactNode) => () => (
  <svg width={15} height={15} viewBox="0 0 16 16" fill="none"
       stroke="currentColor" strokeWidth={1.5}
       strokeLinecap="round" strokeLinejoin="round">
    {path}
  </svg>
);

function IcDash()     { return ic(<><rect x="2" y="2" width="5" height="6" rx="1"/><rect x="9" y="2" width="5" height="4" rx="1"/><rect x="2" y="10" width="5" height="4" rx="1"/><rect x="9" y="8" width="5" height="6" rx="1"/></>)(); }
function IcClient()   { return ic(<><path d="M2 14V6l6-3 6 3v8"/><path d="M6 14V9h4v5"/></>)(); }
function IcMap()      { return ic(<><path d="M2 4l4-1 4 1 4-1v9l-4 1-4-1-4 1z"/><path d="M6 3v10M10 4v10"/></>)(); }
function IcPipeline() { return ic(<path d="M3 4h10M4 8h8M5 12h6"/>)(); }
function IcTower()    { return ic(<><path d="M2 14V8l6-5 6 5v6"/><circle cx="8" cy="9" r="1.5"/></>)(); }
function IcBag()      { return ic(<><path d="M3 6h10l-1 8H4z"/><path d="M6 6V4a2 2 0 0 1 4 0v2"/></>)(); }
function IcList()     { return ic(<><path d="M3 4h10M3 8h10M3 12h6"/></>)(); }
function IcUser()     { return ic(<><circle cx="8" cy="6" r="3"/><path d="M2 14c0-3 2.7-5 6-5s6 2 6 5"/></>)(); }
function IcNote()     { return ic(<><path d="M3 2h7l3 3v9H3z"/><path d="M10 2v3h3M5 8h6M5 11h4"/></>)(); }
function IcKey()      { return ic(<><circle cx="6.5" cy="9.5" r="3.5"/><path d="M10 6l4-4M12 4l2 2M10 8l1.5-1.5"/></>)(); }
