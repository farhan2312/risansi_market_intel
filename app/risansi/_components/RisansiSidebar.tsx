'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_MAIN = [
  { href: '/risansi',            label: 'Dashboard',      icon: IconDash },
  { href: '/risansi/clients',    label: 'Clients',         icon: IconClient },
  { href: '/risansi/visits',     label: 'Visit Plan',      icon: IconCal },
  { href: '/risansi/map',        label: 'Coverage Map',    icon: IconMap },
  { href: '/risansi/pipeline',   label: 'Pipeline',        icon: IconPipeline },
  { href: '/risansi/competitive',label: 'Competitive',     icon: IconTower },
  { href: '/risansi/revenue',    label: 'Revenue',         icon: IconBag },
];

const NAV_INTEL = [
  { href: '/risansi/reports', label: 'Reports', icon: IconNote },
  { href: '/risansi/admin',   label: 'Admin',   icon: IconCog },
];

// System Admin — sysadmin only
const NAV_SYSADMIN = [
  { href: '/risansi/admin/users',      label: 'User Management', icon: IconClient },
  { href: '/risansi/admin/tours',      label: 'Tour Mapping',    icon: IconMap },
  { href: '/risansi/admin/unassigned', label: 'Unassigned',      icon: IconNote },
  { href: '/risansi/admin/audit',      label: 'Audit Log',       icon: IconNote },
];

interface SidebarUser {
  name: string;
  email: string;
  initials: string;
  role?: string;
}

export function RisansiSidebar({ user }: { user: SidebarUser }) {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === '/risansi' ? pathname === '/risansi' : pathname.startsWith(href);

  return (
    <aside style={{
      width: 240,
      flexShrink: 0,
      background: '#0A1628',
      color: '#d9d4c8',
      display: 'flex',
      flexDirection: 'column',
      padding: '18px 0',
      borderRight: '1px solid rgba(255,255,255,0.06)',
      overflowY: 'auto',
    }}>

      {/* Brand */}
      <div style={{ padding: '6px 20px 22px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 28, height: 28, borderRadius: 4,
          background: '#1A5CB8',
          color: '#fff',
          display: 'grid', placeItems: 'center',
          fontFamily: "'Instrument Serif', Georgia, serif",
          fontSize: 19, lineHeight: 1,
          flexShrink: 0,
        }}>R</div>
        <div>
          <div style={{ fontWeight: 600, letterSpacing: '-0.01em', color: '#fff' }}>Risansi</div>
          <div style={{ fontSize: 10, color: '#837e74', textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 1 }}>
            Sales Intel · v1.0
          </div>
        </div>
      </div>

      {/* Operate group */}
      <div style={{ padding: '14px 12px 4px' }}>
        <div style={{ padding: '0 8px 6px', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#6b665c', fontWeight: 500 }}>
          Operate
        </div>
        {NAV_MAIN.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} style={{ textDecoration: 'none' }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '7px 10px',
              borderRadius: 5,
              fontSize: 13,
              color: isActive(href) ? '#fff' : '#b7b1a3',
              background: isActive(href) ? 'rgba(255,255,255,0.06)' : 'transparent',
              position: 'relative',
              cursor: 'pointer',
            }}>
              {isActive(href) && (
                <span style={{
                  position: 'absolute', left: -12, top: 6, bottom: 6,
                  width: 2, borderRadius: 1,
                  background: '#1A5CB8',
                }}/>
              )}
              <Icon />
              <span>{label}</span>
            </div>
          </Link>
        ))}
      </div>

      {/* Intelligence group */}
      <div style={{ padding: '14px 12px 4px' }}>
        <div style={{ padding: '0 8px 6px', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#6b665c', fontWeight: 500 }}>
          Intelligence
        </div>
        {NAV_INTEL.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} style={{ textDecoration: 'none' }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '7px 10px',
              borderRadius: 5,
              fontSize: 13,
              color: isActive(href) ? '#fff' : '#b7b1a3',
              background: isActive(href) ? 'rgba(255,255,255,0.06)' : 'transparent',
              position: 'relative',
              cursor: 'pointer',
            }}>
              {isActive(href) && (
                <span style={{
                  position: 'absolute', left: -12, top: 6, bottom: 6,
                  width: 2, borderRadius: 1,
                  background: '#1A5CB8',
                }}/>
              )}
              <Icon />
              <span>{label}</span>
            </div>
          </Link>
        ))}
      </div>

      {/* System Admin group — sysadmin only */}
      {user.role === 'sysadmin' && (
        <div style={{ padding: '14px 12px 4px' }}>
          <div style={{ padding: '0 8px 6px', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#00B4D8', fontWeight: 500 }}>
            System Admin
          </div>
          {NAV_SYSADMIN.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} style={{ textDecoration: 'none' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '7px 10px', borderRadius: 5, fontSize: 13,
                color: isActive(href) ? '#fff' : '#b7b1a3',
                background: isActive(href) ? 'rgba(255,255,255,0.06)' : 'transparent',
                position: 'relative', cursor: 'pointer',
              }}>
                {isActive(href) && (
                  <span style={{ position: 'absolute', left: -12, top: 6, bottom: 6, width: 2, borderRadius: 1, background: '#1A5CB8' }} />
                )}
                <Icon />
                <span>{label}</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* User */}
      <div style={{
        marginTop: 'auto',
        padding: '14px 20px 4px',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', gap: 10, alignItems: 'center',
      }}>
        <div style={{
          width: 30, height: 30, borderRadius: 4, flexShrink: 0,
          background: 'linear-gradient(135deg, #1A5CB8, #00A3C4)',
          display: 'grid', placeItems: 'center',
          fontSize: 12, color: '#fff', fontWeight: 500,
        }}>
          {user.initials}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user.name}
          </div>
          <div style={{ fontSize: 10, color: '#6b665c', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            {user.role ?? 'User'}
          </div>
        </div>
      </div>

    </aside>
  );
}

/* ─── Inline icons (stroke, currentColor, 15×15) ─── */
function IconDash() {
  return <svg width={15} height={15} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="5" height="6" rx="1"/><rect x="9" y="2" width="5" height="4" rx="1"/><rect x="2" y="10" width="5" height="4" rx="1"/><rect x="9" y="8" width="5" height="6" rx="1"/></svg>;
}
function IconClient() {
  return <svg width={15} height={15} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M2 14V6l6-3 6 3v8"/><path d="M6 14V9h4v5"/></svg>;
}
function IconCal() {
  return <svg width={15} height={15} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="12" height="11" rx="1"/><path d="M2 6h12M5 2v3M11 2v3"/></svg>;
}
function IconMap() {
  return <svg width={15} height={15} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M2 4l4-1 4 1 4-1v9l-4 1-4-1-4 1z"/><path d="M6 3v10M10 4v10"/></svg>;
}
function IconPipeline() {
  return <svg width={15} height={15} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M3 4h10M4 8h8M5 12h6"/></svg>;
}
function IconTower() {
  return <svg width={15} height={15} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M2 14V8l6-5 6 5v6"/><circle cx="8" cy="9" r="1.5"/></svg>;
}
function IconBag() {
  return <svg width={15} height={15} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h10l-1 8H4z"/><path d="M6 6V4a2 2 0 0 1 4 0v2"/></svg>;
}
function IconNote() {
  return <svg width={15} height={15} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M3 2h7l3 3v9H3z"/><path d="M10 2v3h3M5 8h6M5 11h4"/></svg>;
}
function IconCog() {
  return <svg width={15} height={15} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="8" r="2"/><path d="M8 2v1.5M8 12.5V14M2 8h1.5M12.5 8H14M3.5 3.5l1 1M11.5 11.5l1 1M3.5 12.5l1-1M11.5 4.5l1-1"/></svg>;
}
