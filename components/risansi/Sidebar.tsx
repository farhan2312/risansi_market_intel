'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { CSSProperties } from 'react';
import { UserMenu } from './UserMenu';

// ── Types ─────────────────────────────────────────────────────

export type SidebarRole = 'rep' | 'manager' | 'exec' | 'admin';

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
  /** Active nav item id. Omit to derive from current URL. */
  active?: string;
  role: SidebarRole;
  user: SidebarUser;
  alerts?: SidebarAlerts;
}

// ── Nav item definitions ───────────────────────────────────────

interface NavItem {
  id: string;
  href: string;
  label: string;
  Icon: () => React.JSX.Element;
  alertKey?: keyof SidebarAlerts;
}

const MAIN_NAV: NavItem[] = [
  { id: 'dash',      href: '/risansi',              label: 'Dashboard',    Icon: IcDash },
  { id: 'clients',   href: '/risansi/clients',      label: 'Clients',      Icon: IcClient },
  { id: 'visits',    href: '/risansi/visits',       label: 'Visit Plan',   Icon: IcCal },
  { id: 'map',       href: '/risansi/visits/coverage', label: 'Coverage Map', Icon: IcMap },
  { id: 'pipeline',  href: '/risansi/pipeline',     label: 'Pipeline',     Icon: IcPipeline },
  { id: 'compete',   href: '/risansi/compete',      label: 'Competitive',  Icon: IcTower, alertKey: 'compete' },
  { id: 'revenue',   href: '/risansi/revenue',      label: 'Revenue',      Icon: IcBag },
];

const REP_NAV: NavItem[] = [
  { id: 'today',    href: '/risansi/today',    label: 'Today',       Icon: IcCal },
  { id: 'clients',  href: '/risansi/clients',  label: 'My Clients',  Icon: IcClient },
  { id: 'visits',   href: '/risansi/visits',   label: 'Visits',      Icon: IcCar },
  { id: 'tasks',    href: '/risansi/tasks',    label: 'Tasks',       Icon: IcCheck, alertKey: 'tasks' },
  { id: 'pipeline', href: '/risansi/pipeline', label: 'My Pipeline', Icon: IcPipeline },
];

const INTEL_NAV: NavItem[] = [
  { id: 'reports', href: '/risansi/reports', label: 'Reports', Icon: IcNote },
  { id: 'admin',   href: '/risansi/admin',   label: 'Admin',   Icon: IcCog, alertKey: 'admin' },
];

// Path → id mapping for URL-based active derivation
const PATH_TO_ID: [string, string][] = [
  ['/risansi/compete',          'compete'],
  ['/risansi/clients',          'clients'],
  ['/risansi/pipeline',         'pipeline'],
  ['/risansi/revenue',          'revenue'],
  ['/risansi/visits/coverage',  'map'],      // must come before /risansi/visits
  ['/risansi/visits',           'visits'],
  ['/risansi/reports',          'reports'],
  ['/risansi/admin',       'admin'],
  ['/risansi/map',         'map'],
  ['/risansi/tasks',       'tasks'],
  ['/risansi/today',       'today'],
  ['/risansi',             'dash'],
];

function deriveActive(pathname: string): string {
  for (const [path, id] of PATH_TO_ID) {
    if (pathname === path || pathname.startsWith(path + '/')) return id;
  }
  return '';
}

// ── Component ─────────────────────────────────────────────────

export function Sidebar({ active, role, user, alerts = {} }: SidebarProps) {
  const pathname = usePathname();
  const resolvedActive = active ?? deriveActive(pathname);

  const mainItems = role === 'rep' ? REP_NAV : MAIN_NAV;
  const showIntel  = role !== 'rep';

  return (
    <aside style={ASIDE}>
      {/* Brand */}
      <div style={LOGO_CARD}>
        <div style={{ width: 32, height: 32, background: '#00B4D8', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 700, color: '#071E47', flexShrink: 0 }}>
          R
        </div>
        <div style={{ marginLeft: 10 }}>
          <div style={{ color: '#FFFFFF', fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em', lineHeight: 1.1 }}>Risansi</div>
          <div style={{ color: '#5B7FA8', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.12em', marginTop: 1 }}>Industries Ltd</div>
        </div>
      </div>

      {/* Operate / Field */}
      <NavGroup label={role === 'rep' ? 'Field' : 'Operate'}>
        {mainItems.map((item) => (
          <NavLink
            key={item.id}
            item={item}
            isActive={item.id === resolvedActive}
            badge={item.alertKey ? alerts[item.alertKey] : undefined}
            isAlert={false}
          />
        ))}
      </NavGroup>

      {/* Intelligence */}
      {showIntel && (
        <NavGroup label="Intelligence">
          {INTEL_NAV.map((item) => (
            <NavLink
              key={item.id}
              item={item}
              isActive={item.id === resolvedActive}
              badge={item.alertKey ? alerts[item.alertKey] : undefined}
              isAlert={item.id === 'admin'}
            />
          ))}
        </NavGroup>
      )}

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

function NavLink({ item, isActive, badge, isAlert }: {
  item: NavItem;
  isActive: boolean;
  badge?: number;
  isAlert: boolean;
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
            background: isAlert ? '#DC2626' : 'rgba(255,255,255,0.12)',
          }}>{badge}</span>
        )}
      </div>
    </Link>
  );
}

// ── Static styles ─────────────────────────────────────────────

const ASIDE: CSSProperties = {
  width: 240,
  flexShrink: 0,
  background: '#0A1628',
  color: '#B8C9E8',
  display: 'flex',
  flexDirection: 'column',
  padding: 0,
  paddingBottom: 18,
  borderRight: '1px solid rgba(255,255,255,0.06)',
  height: '100%',
  overflowX: 'hidden',
  overflowY: 'auto',
};

const LOGO_CARD: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: '16px 16px 12px',
};

const GROUP_LABEL: CSSProperties = {
  margin: '20px 0 6px 8px',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.12em',
  color: '#00B4D8',
  fontWeight: 600,
};

const LINK_BASE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '7px 10px',
  borderRadius: 5,
  fontSize: 13.5,
  fontWeight: 500,
  letterSpacing: '0.01em',
  position: 'relative',
  cursor: 'pointer',
};

const ACTIVE_BAR: CSSProperties = {
  position: 'absolute',
  left: -8,
  top: 6,
  bottom: 6,
  width: 3,
  borderRadius: 2,
  background: '#00B4D8',
};

const BADGE: CSSProperties = {
  color: '#fff',
  padding: '1px 6px',
  borderRadius: 8,
  fontSize: 10,
  fontFamily: 'var(--font-mono)',
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
function IcCal()      { return ic(<><rect x="2" y="3" width="12" height="11" rx="1"/><path d="M2 6h12M5 2v3M11 2v3"/></>)(); }
function IcMap()      { return ic(<><path d="M2 4l4-1 4 1 4-1v9l-4 1-4-1-4 1z"/><path d="M6 3v10M10 4v10"/></>)(); }
function IcPipeline() { return ic(<path d="M3 4h10M4 8h8M5 12h6"/>)(); }
function IcTower()    { return ic(<><path d="M2 14V8l6-5 6 5v6"/><circle cx="8" cy="9" r="1.5"/></>)(); }
function IcBag()      { return ic(<><path d="M3 6h10l-1 8H4z"/><path d="M6 6V4a2 2 0 0 1 4 0v2"/></>)(); }
function IcNote()     { return ic(<><path d="M3 2h7l3 3v9H3z"/><path d="M10 2v3h3M5 8h6M5 11h4"/></>)(); }
function IcCog()      { return ic(<><circle cx="8" cy="8" r="2"/><path d="M8 2v1.5M8 12.5V14M2 8h1.5M12.5 8H14M3.5 3.5l1 1M11.5 11.5l1 1M3.5 12.5l1-1M11.5 4.5l1-1"/></>)(); }
function IcCar()      { return ic(<><path d="M2 11V8l1.5-3h9L14 8v3"/><path d="M2 11h12v2H2z"/><circle cx="5" cy="13" r=".8" fill="currentColor"/><circle cx="11" cy="13" r=".8" fill="currentColor"/></>)(); }
function IcCheck()    { return ic(<path d="M3 8l3.5 3.5L13 5"/>)(); }
