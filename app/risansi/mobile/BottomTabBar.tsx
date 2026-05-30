'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { CSSProperties } from 'react';

const BASE = '/risansi/mobile';

export function BottomTabBar() {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === BASE ? pathname === BASE : pathname.startsWith(href);

  return (
    <nav style={{
      position: 'fixed',
      bottom: 0,
      left: '50%',
      transform: 'translateX(-50%)',
      width: '100%',
      maxWidth: 430,
      height: 68,
      background: 'var(--bg-paper)',
      borderTop: '1px solid var(--line)',
      display: 'flex',
      alignItems: 'stretch',
      zIndex: 100,
      paddingBottom: 'env(safe-area-inset-bottom, 0px)',
    }}>
      <TabItem href={BASE}               label="Today"   icon={<TodayIcon />}   active={isActive(BASE)} />
      <TabItem href={`${BASE}/clients`}  label="Clients" icon={<ListIcon />}    active={isActive(`${BASE}/clients`)} />
      <FabItem href={`${BASE}/visit/new`} label="Visit" />
      <TabItem href={`${BASE}/tasks`}    label="Tasks"   icon={<CheckIcon />}   active={isActive(`${BASE}/tasks`)} />
      <TabItem href={`${BASE}/me`}       label="Me"      icon={<UserIcon />}    active={isActive(`${BASE}/me`)} />
    </nav>
  );
}

function TabItem({ href, label, icon, active }: {
  href: string; label: string; icon: React.ReactNode; active?: boolean;
}) {
  const color = active ? 'var(--accent)' : 'var(--fg-3)';
  return (
    <Link href={href} style={{ ...TAB_LINK, color }}>
      <span style={{ opacity: active ? 1 : 0.7 }}>{icon}</span>
      <span style={{ fontSize: 10, fontWeight: active ? 500 : 400, lineHeight: 1 }}>{label}</span>
    </Link>
  );
}

function FabItem({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} style={{ ...TAB_LINK, justifyContent: 'flex-end', paddingBottom: 10 }}>
      <div style={{
        width: 50, height: 50, borderRadius: 14,
        background: 'var(--accent)', color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 2px 10px oklch(0.55 0.16 50 / 0.45)',
        marginTop: -14,
      }}>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M10 4v12M4 10h12"/>
        </svg>
      </div>
      <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--accent)', lineHeight: 1 }}>{label}</span>
    </Link>
  );
}

// ── Icons ──────────────────────────────────────────────────────

function TodayIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="14" height="14" rx="2"/>
      <path d="M3 8h14M7 2v4M13 2v4"/>
    </svg>
  );
}

function ListIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="5" cy="6" r="1.5" fill="currentColor" stroke="none"/>
      <path d="M9 6h8M9 10h8M9 14h8"/>
      <circle cx="5" cy="10" r="1.5" fill="currentColor" stroke="none"/>
      <circle cx="5" cy="14" r="1.5" fill="currentColor" stroke="none"/>
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="14" height="14" rx="2"/>
      <path d="M7 10l2.5 2.5L13 8"/>
    </svg>
  );
}

function UserIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="7" r="3.5"/>
      <path d="M3 17c0-3.3 3.1-6 7-6s7 2.7 7 6"/>
    </svg>
  );
}

// ── Style constants ────────────────────────────────────────────

const TAB_LINK: CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 3,
  textDecoration: 'none',
  padding: '4px 0',
  color: 'var(--fg-3)',
};
