import type { ReactNode } from 'react';
import { BottomTabBar } from './BottomTabBar';

// Auth is already enforced by the parent app/risansi/layout.tsx.
// This layout overlays the desktop shell via position:fixed to give a clean
// full-screen mobile experience without touching the parent layout.

export default function MobileLayout({ children }: { children: ReactNode }) {
  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 50,
      background: 'var(--bg)',
      overflowY: 'auto',
      overflowX: 'hidden',
      WebkitOverflowScrolling: 'touch',
    } as React.CSSProperties}>
      <div style={{
        maxWidth: 430,
        margin: '0 auto',
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
      }}>
        <main style={{ flex: 1, paddingBottom: 72 }}>
          {children}
        </main>
        <BottomTabBar />
      </div>
    </div>
  );
}
