'use client';

import type { CSSProperties } from 'react';

export interface TopbarProps {
  crumbs: string[];
  primaryAction?: string;
  period?: string;
}

export function Topbar({ crumbs, primaryAction, period = 'FY 25–26' }: TopbarProps) {
  return (
    <header style={TOPBAR}>
      {/* Breadcrumbs */}
      <nav style={CRUMBS}>
        {crumbs.map((c, i) => (
          <span key={i} style={{ display: 'contents' }}>
            {i > 0 && <IcChevRight />}
            {i === crumbs.length - 1
              ? <strong style={{ color: '#1A5CB8', fontWeight: 600 }}>{c}</strong>
              : <span style={{ color: 'var(--fg-3)' }}>{c}</span>
            }
          </span>
        ))}
      </nav>

      {/* Live indicator */}
      <div style={LIVE_WRAP}>
        <span style={LIVE_DOT} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>Live · synced 2s ago</span>
      </div>

      {/* Search */}
      <div style={SEARCH_WRAP}>
        <IcSearch />
        <input
          placeholder="Search clients, codes, contacts…"
          style={SEARCH_INPUT}
        />
        <kbd style={KBD}>⌘K</kbd>
      </div>

      {/* Period */}
      <TbBtn>
        <IcCal />{period}<IcChevDown />
      </TbBtn>

      {/* Bell */}
      <TbBtn><IcBell /></TbBtn>

      {/* Primary action */}
      {primaryAction && (
        <TbBtn primary>
          <IcPlus />{primaryAction}
        </TbBtn>
      )}
    </header>
  );
}

function TbBtn({ children, primary }: { children: React.ReactNode; primary?: boolean }) {
  return (
    <button style={{
      display: 'flex', alignItems: 'center', gap: 6,
      fontSize: 12,
      padding: '5px 10px',
      borderRadius: 5,
      cursor: 'pointer',
      fontFamily: 'inherit',
      fontWeight: primary ? 500 : 400,
      background: primary ? '#1A5CB8' : 'transparent',
      color: primary ? '#fff' : 'var(--fg-2)',
      border: primary ? '1px solid #1A5CB8' : '1px solid transparent',
    }}>
      {children}
    </button>
  );
}

// ── Styles ────────────────────────────────────────────────────

const TOPBAR: CSSProperties = {
  height: 52,
  background: '#FFFFFF',
  borderBottom: '1px solid var(--line)',
  display: 'flex',
  alignItems: 'center',
  padding: '0 24px',
  gap: 12,
  flexShrink: 0,
};

const CRUMBS: CSSProperties = {
  display: 'flex',
  gap: 6,
  alignItems: 'center',
  fontSize: 13,
  color: 'var(--fg-3)',
};

const LIVE_WRAP: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
  color: 'var(--fg-3)',
  padding: '5px 10px',
  borderRadius: 5,
};

const LIVE_DOT: CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: '50%',
  background: '#059669',
  boxShadow: '0 0 0 3px rgba(5, 150, 105, 0.20)',
  flexShrink: 0,
};

const SEARCH_WRAP: CSSProperties = {
  marginLeft: 'auto',
  flex: '0 1 340px',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 10px',
  background: 'var(--bg)',
  border: '1px solid var(--line)',
  borderRadius: 5,
  color: 'var(--fg-3)',
};

const SEARCH_INPUT: CSSProperties = {
  border: 0,
  background: 'transparent',
  outline: 'none',
  flex: 1,
  fontFamily: 'inherit',
  fontSize: 12,
  color: 'var(--fg)',
  minWidth: 0,
};

const KBD: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  padding: '1px 4px',
  background: 'var(--bg-elev)',
  border: '1px solid var(--line)',
  borderRadius: 3,
  color: 'var(--fg-3)',
  flexShrink: 0,
};

// ── Icons ─────────────────────────────────────────────────────

function IcSearch() {
  return (
    <svg width={13} height={13} viewBox="0 0 16 16" fill="none"
         stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7" cy="7" r="5"/><path d="M14 14l-3.5-3.5"/>
    </svg>
  );
}
function IcChevRight() {
  return (
    <svg width={11} height={11} viewBox="0 0 16 16" fill="none"
         stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"
         style={{ opacity: 0.4 }}>
      <path d="M6 4l4 4-4 4"/>
    </svg>
  );
}
function IcChevDown() {
  return (
    <svg width={11} height={11} viewBox="0 0 16 16" fill="none"
         stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6.5 8 10.5 12 6.5"/>
    </svg>
  );
}
function IcCal() {
  return (
    <svg width={13} height={13} viewBox="0 0 16 16" fill="none"
         stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="12" height="11" rx="1"/><path d="M2 6h12M5 2v3M11 2v3"/>
    </svg>
  );
}
function IcBell() {
  return (
    <svg width={15} height={15} viewBox="0 0 16 16" fill="none"
         stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6.5a4 4 0 1 1 8 0c0 3 1 4 1 4H3s1-1 1-4z"/>
      <path d="M6.5 13.5a1.5 1.5 0 0 0 3 0"/>
    </svg>
  );
}
function IcPlus() {
  return (
    <svg width={12} height={12} viewBox="0 0 16 16" fill="none"
         stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3v10M3 8h10"/>
    </svg>
  );
}
