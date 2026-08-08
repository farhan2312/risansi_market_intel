'use client';

import type { CSSProperties } from 'react';
import type { DraftState } from './useFormDraft';

// The small "saving… / saved ✓" that sits top-right of a form.
//
// Deliberately tiny and unanimated: it is reassurance, not an announcement. It
// holds a blank line's worth of space when idle so the header doesn't jump every
// time it appears and disappears.
//
// role="status" so a screen reader hears it without the focus being stolen
// mid-typing, which is exactly what would happen with an alert.

export function SaveIndicator({ state, label = 'Draft' }: { state: DraftState; label?: string }) {
  return (
    <span role="status" aria-live="polite" style={{
      ...BASE,
      color: state === 'saved' ? 'var(--pos)' : 'var(--fg-3)',
      opacity: state === 'idle' ? 0 : 1,
    }}>
      {state === 'saving' && <>⟳ Saving…</>}
      {state === 'saved'  && <>✓ {label} saved</>}
    </span>
  );
}

const BASE: CSSProperties = {
  fontSize: 10.5, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap',
  transition: 'opacity 220ms, color 220ms', minWidth: 78, textAlign: 'right',
  display: 'inline-block', pointerEvents: 'none',
};

/** The "we brought your typing back" banner shown once after a restore. */
export function DraftRestoredBanner({ onDismiss, what }: { onDismiss: () => void; what: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '7px 11px', marginBottom: 10,
      background: 'var(--accent-soft, #EBF1FB)', border: '1px solid var(--accent-line, #BFDBFE)',
      borderRadius: 6, fontSize: 11.5, color: 'var(--title, #0A3D8F)',
    }}>
      <span>Restored the {what} you had typed but not saved.</span>
      <button type="button" onClick={onDismiss} style={{
        marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer',
        color: 'inherit', fontSize: 15, lineHeight: 1, padding: 0,
      }} aria-label="Dismiss">×</button>
    </div>
  );
}
