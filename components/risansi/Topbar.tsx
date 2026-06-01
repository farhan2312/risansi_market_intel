'use client';

import type { CSSProperties } from 'react';

export interface TopbarProps {
  crumbs: string[];
  primaryAction?: string;
  primaryActionHref?: string;
}

export function Topbar({ crumbs, primaryAction, primaryActionHref }: TopbarProps) {
  return (
    <header style={TOPBAR}>
      {/* Breadcrumbs */}
      <nav style={CRUMBS}>
        {crumbs.map((c, i) => (
          <span key={i} style={{ display: 'contents' }}>
            {i > 0 && <IcChevRight />}
            {i === crumbs.length - 1
              ? <strong style={{ color: '#0A3D8F', fontWeight: 600 }}>{c}</strong>
              : <span style={{ color: 'var(--fg-3)' }}>{c}</span>
            }
          </span>
        ))}
      </nav>

      {/* Live indicator — pushed right by marginLeft: auto */}
      <div style={LIVE_WRAP}>
        <span style={LIVE_DOT} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>Live · synced 2s ago</span>
      </div>

      {/* Bell */}
      <TbBtn><IcBell /></TbBtn>

      {/* Primary action */}
      {primaryAction && primaryActionHref && (
        <a href={primaryActionHref} style={{
          display: 'flex', alignItems: 'center', gap: 6,
          fontSize: 12, padding: '5px 10px', borderRadius: 5,
          cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500,
          background: '#1A5CB8', color: '#fff',
          border: '1px solid #1A5CB8', textDecoration: 'none',
        }}>
          <IcPlus />{primaryAction}
        </a>
      )}
      {primaryAction && !primaryActionHref && (
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
  borderBottom: '1px solid #DDE6F5',
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
  marginLeft: 'auto',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
  color: '#0E9F6E',
  padding: '5px 10px',
  borderRadius: 5,
};

const LIVE_DOT: CSSProperties = {
  width: 7,
  height: 7,
  borderRadius: '50%',
  background: '#0E9F6E',
  animation: 'pulse-dot 2s ease-in-out infinite',
  flexShrink: 0,
};

// ── Icons ─────────────────────────────────────────────────────

function IcChevRight() {
  return (
    <svg width={11} height={11} viewBox="0 0 16 16" fill="none"
         stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"
         style={{ opacity: 0.4 }}>
      <path d="M6 4l4 4-4 4"/>
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
