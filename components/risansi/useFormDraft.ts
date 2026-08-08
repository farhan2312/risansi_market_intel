'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// Keep what someone typed, even if they never pressed Save.
//
// The visit report already had this idea (useAutoSave in VisitReportForm), but
// only the visit report. Everywhere else, closing a modal, a stray refresh or a
// dropped connection threw the entry away — which is what people were hitting on
// the quotation form.
//
// Two shapes of form need two different answers:
//
//   • A form editing a row that already exists can save field by field to the
//     server. That is the visit report's model.
//   • A form that is STAGING something — the quotation modal, whose Cancel is
//     supposed to revert the card's move, and the create wizard, which has no
//     row until it submits — must not write to the server as you type. Doing so
//     would commit a decision the user hasn't made. Those keep a local draft
//     instead, and restore it when the form is reopened.
//
// This hook is the second kind. It reads the form through FormData, so it covers
// every named input without any of them having to become controlled, and it
// takes an `extra` callback for the parts held in React state (line items, offer
// revisions) that ride in hidden inputs.

export type DraftState = 'idle' | 'saving' | 'saved';

interface Stored<E> { fields: Record<string, string>; extra?: E; at: number }

/** Drafts older than this are stale enough to be more confusing than useful. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function useFormDraft<E = unknown>(
  formRef: React.RefObject<HTMLFormElement | null>,
  key: string | null,
  opts?: {
    /** React-state values that aren't plain inputs (items, revisions). */
    extra?: () => E;
    /** Put those values back when a draft is restored. */
    onRestore?: (extra: E | undefined) => void;
    /** Names never worth keeping (file inputs, hidden ids). */
    skip?: string[];
    debounceMs?: number;
  },
) {
  const [state, setState]       = useState<DraftState>('idle');
  const [restored, setRestored] = useState(false);
  const timer   = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const settle  = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Held in a ref so `capture` stays stable across renders — it's wired to the
  // form's onInput, and a new identity every keystroke would rebind the handler
  // constantly. Updated in an effect, not during render.
  const optsRef = useRef(opts);
  useEffect(() => { optsRef.current = opts; });

  const debounce = opts?.debounceMs ?? 600;

  const clear = useCallback(() => {
    if (!key) return;
    try { localStorage.removeItem(key); } catch { /* private mode / quota */ }
    setState('idle');
  }, [key]);

  /** Snapshot the form. Called on every input, debounced. */
  const capture = useCallback(() => {
    if (!key) return;
    const form = formRef.current;
    if (!form) return;
    setState('saving');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      try {
        const fd = new FormData(form);
        const skip = new Set(optsRef.current?.skip ?? []);
        const fields: Record<string, string> = {};
        for (const [k, v] of fd.entries()) {
          if (skip.has(k) || typeof v !== 'string' || v === '') continue;
          fields[k] = v;
        }
        const payload: Stored<E> = { fields, extra: optsRef.current?.extra?.(), at: Date.now() };
        localStorage.setItem(key, JSON.stringify(payload));
        setState('saved');
        clearTimeout(settle.current);
        settle.current = setTimeout(() => setState('idle'), 2200);
      } catch {
        // A full or unavailable localStorage must not break typing.
        setState('idle');
      }
    }, debounce);
  }, [key, formRef, debounce]);

  // Restore once, after the form has mounted and rendered its defaults.
  useEffect(() => {
    if (!key) return;
    let raw: string | null = null;
    try { raw = localStorage.getItem(key); } catch { return; }
    if (!raw) return;

    let stored: Stored<E> | null = null;
    try { stored = JSON.parse(raw) as Stored<E>; } catch { /* corrupt */ }
    if (!stored || !stored.fields) { try { localStorage.removeItem(key); } catch {} return; }
    if (Date.now() - (stored.at ?? 0) > MAX_AGE_MS) { try { localStorage.removeItem(key); } catch {} return; }

    const form = formRef.current;
    if (!form) return;
    let put = 0;
    for (const [name, value] of Object.entries(stored.fields)) {
      const el = form.elements.namedItem(name);
      if (!el) continue;
      // A RadioNodeList (repeated names) isn't safely restorable by position.
      if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) continue;
      if (el.type === 'file') continue;
      // Only fill what the form itself left blank or at its default — never
      // clobber a value the server just supplied with a stale local one.
      // HTMLSelectElement has no defaultValue, so fall back to its value.
      const dflt = el instanceof HTMLSelectElement ? el.value : el.defaultValue;
      if (el.value === '' || el.value === dflt) { el.value = value; put++; }
    }
    optsRef.current?.onRestore?.(stored.extra);
    if (put > 0 || stored.extra !== undefined) setRestored(true);
    // key identifies the record; re-running on anything else would re-restore
    // over live typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => () => { clearTimeout(timer.current); clearTimeout(settle.current); }, []);

  return { state, restored, capture, clear, dismissRestored: () => setRestored(false) };
}
