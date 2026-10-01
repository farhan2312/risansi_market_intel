'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react';

// Closing a form that has been filled in.
//
// A rep lost a long quotation to a stray click: every opportunity modal closed
// on a backdrop click and threw the state away, and the move form had no × at
// all, so the only deliberate way out was a Cancel button below a screenful of
// fields. This is the shared answer, so the three forms behave the same way.
//
// The rules, in order of how often they are hit:
//
//   • Backdrop click on a touched form does nothing except point at the ×. It is
//     the accident, so it cannot be the thing that closes.
//   • Backdrop click on an untouched form closes it at once — there is nothing
//     to protect and being trapped in an empty modal is its own annoyance.
//   • The × and Escape ask once when there is something to lose, and close
//     immediately when there is not.
//
// Nothing here discards anything by itself: the draft hook has already written
// what was typed, so "Close" means "put it away", not "lose it".

export function useCloseGuard({ dirty, onClose, enabled = true }: {
  dirty: boolean;
  onClose: () => void;
  /** False while a save is in flight, or while a form on top of this one owns Escape. */
  enabled?: boolean;
}) {
  const [asking, setAsking] = useState(false);
  const [hint, setHint]     = useState(false);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const requestClose = useCallback(() => {
    if (!enabled) return;
    if (dirty) { setAsking(true); return; }
    onClose();
  }, [dirty, enabled, onClose]);

  const onBackdropClick = useCallback((e: MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || !enabled) return;
    if (!dirty) { onClose(); return; }
    setHint(true);
    clearTimeout(hintTimer.current);
    // Long enough to read a sentence without being a thing to dismiss.
    hintTimer.current = setTimeout(() => setHint(false), 6000);
  }, [dirty, enabled, onClose]);

  // Escape is the same route as the ×, down to the question it asks. Registered
  // on the window rather than on the dialog so it works wherever focus is, and
  // disabled by the caller when a form above this one is open, so one key press
  // does not close both.
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, requestClose]);

  useEffect(() => () => clearTimeout(hintTimer.current), []);

  return {
    /** The confirm is up — the form should not also be closing. */
    asking,
    /** A backdrop click was ignored; say where the close is. */
    hint,
    requestClose,
    onBackdropClick,
    confirmClose: () => { setAsking(false); onClose(); },
    keepEditing: () => setAsking(false),
  };
}

/**
 * The × in a form's header, sticky with it so it is reachable without scrolling
 * past every field to the Cancel at the bottom. `tone` picks white for the deep
 * blue header bars and the foreground token everywhere else.
 */
export function CloseX({ onClick, tone = 'light', title = 'Close' }: {
  onClick: () => void;
  tone?: 'light' | 'onDark';
  title?: string;
}) {
  return (
    <button
      type="button" onClick={onClick} aria-label="Close" title={title}
      style={{
        flexShrink: 0, width: 32, height: 32, display: 'inline-flex',
        alignItems: 'center', justifyContent: 'center',
        background: tone === 'onDark' ? 'rgba(255,255,255,0.14)' : 'transparent',
        border: tone === 'onDark' ? '1px solid rgba(255,255,255,0.3)' : '1px solid var(--line)',
        borderRadius: 7, cursor: 'pointer', fontSize: 19, lineHeight: 1,
        color: tone === 'onDark' ? '#fff' : 'var(--fg-2)', fontFamily: 'inherit', padding: 0,
      }}
    >×</button>
  );
}

/** Asked once, in the header, when closing would walk away from typing. */
export function CloseConfirm({ message, onConfirm, onCancel, tone = 'light' }: {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  tone?: 'light' | 'onDark';
}) {
  const onDark = tone === 'onDark';
  return (
    <div role="alertdialog" aria-label="Close this form?" style={{
      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
      marginTop: 10, padding: '8px 10px', borderRadius: 7,
      background: onDark ? 'rgba(255,255,255,0.12)' : 'var(--warn-soft, #FEF3C7)',
      border: `1px solid ${onDark ? 'rgba(255,255,255,0.35)' : 'var(--warn, #F59E0B)'}`,
      fontSize: 11.5, lineHeight: 1.45,
      color: onDark ? '#fff' : 'var(--warn-strong, #92400E)',
    }}>
      <span style={{ minWidth: 0 }}>{message}</span>
      <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
        <button type="button" onClick={onCancel} autoFocus style={{
          ...CONFIRM_BTN,
          background: onDark ? 'rgba(255,255,255,0.16)' : 'var(--bg-paper)',
          border: `1px solid ${onDark ? 'rgba(255,255,255,0.4)' : 'var(--line-strong)'}`,
          color: onDark ? '#fff' : 'var(--fg)',
        }}>Keep editing</button>
        <button type="button" onClick={onConfirm} style={{
          ...CONFIRM_BTN,
          background: onDark ? '#fff' : 'var(--warn-strong, #92400E)',
          border: '1px solid transparent',
          color: onDark ? '#0A3D8F' : 'var(--bg-paper)',
        }}>Close</button>
      </div>
    </div>
  );
}

/** Shown for a few seconds after a backdrop click that was deliberately ignored. */
export function KeepOpenHint({ tone = 'light' }: { tone?: 'light' | 'onDark' }) {
  return (
    <div role="status" style={{
      marginTop: 8, fontSize: 11, lineHeight: 1.4,
      color: tone === 'onDark' ? 'rgba(255,255,255,0.9)' : 'var(--fg-2)',
    }}>
      Clicking outside no longer closes this form — everything you typed is kept. Use × when you are done.
    </div>
  );
}

const CONFIRM_BTN: CSSProperties = {
  borderRadius: 6, fontSize: 11.5, fontWeight: 700, padding: '5px 11px',
  cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
};
