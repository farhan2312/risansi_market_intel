'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { updateTaskStatus } from '@/app/actions/risansi-tasks';

// Asking what was done, at the moment an action is closed.
//
// Shared by every surface that can close an action — the registry, the dashboard
// queue, Field → Activities, the Client 360 register and the visit report — so
// the requirement cannot be sidestepped by closing it somewhere else.

export interface ResolvingAction {
  id: number;
  title: string;
  /** Non-null when the action already carries a note from an earlier closure. */
  existingNote?: string | null;
}

export function ResolveActionDialog({ action, onCancel, onDone }: {
  action: ResolvingAction;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  // The note is written once. A reopened action being closed again keeps the
  // original, so there is nothing to type and the dialog only confirms.
  const locked = !!action.existingNote;

  useEffect(() => { if (!locked) ref.current?.focus(); }, [locked]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel, busy]);

  const submit = async () => {
    if (!locked && !note.trim()) { setErr('Say what was done before closing this.'); return; }
    setBusy(true); setErr('');
    try {
      await updateTaskStatus(action.id, 'completed', note.trim());
      onDone();
    } catch (e) {
      const raw = e instanceof Error ? e.message : '';
      const redacted = !raw || /unexpected response/i.test(raw) || Boolean((e as { digest?: string })?.digest);
      setErr(redacted ? 'Could not close this action.' : raw);
      setBusy(false);
    }
  };

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget && !busy) onCancel(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div className="risansi-modal" role="dialog" aria-modal="true" aria-label="Close action"
        style={{
          width: 460, maxWidth: '100%', background: 'var(--bg-paper)', color: 'var(--fg)',
          borderRadius: 12, boxShadow: '0 24px 64px rgba(0,0,0,0.35)', overflow: 'hidden',
        }}>
        <div style={{ padding: '14px 18px', background: '#0A3D8F', color: '#fff' }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>
            {locked ? 'Close this action' : 'What was done?'}
          </div>
          <div style={{ fontSize: 11.5, opacity: 0.9, marginTop: 3 }}>{action.title}</div>
        </div>

        <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {locked ? (
            <>
              <div style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>
                This action already has a resolution note from when it was first closed. It stays as it is.
              </div>
              <div style={{
                fontSize: 12.5, whiteSpace: 'pre-wrap', padding: '9px 11px', borderRadius: 6,
                background: 'var(--bg-elev)', border: '1px solid var(--line)',
              }}>{action.existingNote}</div>
            </>
          ) : (
            <>
              <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--fg-3)' }}>
                Resolution note
              </label>
              <textarea
                ref={ref} value={note} rows={4}
                onChange={e => { setNote(e.target.value); if (err) setErr(''); }}
                placeholder="e.g. Sent the revised offer on 18 Aug; client confirmed receipt and will revert after the board meeting."
                style={{
                  width: '100%', boxSizing: 'border-box', padding: '9px 11px', fontSize: 13,
                  fontFamily: 'inherit', lineHeight: 1.5, resize: 'vertical',
                  background: 'var(--bg-sunk)', border: '1px solid var(--line-strong)',
                  borderRadius: 6, color: 'var(--fg)', outline: 'none',
                }}
              />
              <div style={{ fontSize: 10.5, color: 'var(--fg-3)' }}>
                Saved against the action and shown wherever it appears. It cannot be edited afterwards.
              </div>
            </>
          )}

          {err && (
            <div style={{
              fontSize: 11.5, color: 'var(--neg-strong)', background: 'var(--neg-soft)',
              border: '1px solid var(--neg)', borderRadius: 6, padding: '7px 10px',
            }}>{err}</div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 2 }}>
            <button type="button" onClick={onCancel} disabled={busy} style={GHOST}>Cancel</button>
            <button type="button" onClick={submit}
              disabled={busy || (!locked && !note.trim())}
              style={{ ...PRIMARY, opacity: busy || (!locked && !note.trim()) ? 0.5 : 1 }}>
              {busy ? 'Closing…' : locked ? 'Close action' : 'Submit and close'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The note on an action that is already closed. Older actions have none. */
export function ResolutionNote({ note, compact }: { note?: string | null; compact?: boolean }) {
  if (!note) return null;
  return (
    <div style={{
      marginTop: 5, fontSize: compact ? 11 : 11.5, lineHeight: 1.5, whiteSpace: 'pre-wrap',
      color: 'var(--fg-2)', background: 'var(--pos-soft, #ECFDF5)',
      border: '1px solid var(--pos, #A7F3D0)', borderLeft: '3px solid var(--pos, #10B981)',
      borderRadius: 5, padding: '6px 9px',
    }}>
      <span style={{ fontWeight: 700, fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--fg-3)' }}>
        Resolution
      </span>
      <div style={{ marginTop: 2 }}>{note}</div>
    </div>
  );
}

const GHOST: CSSProperties = {
  border: '1px solid var(--line-strong)', background: 'var(--bg-paper)', color: 'var(--fg)',
  borderRadius: 6, fontSize: 12.5, fontWeight: 600, padding: '8px 14px', cursor: 'pointer', fontFamily: 'inherit',
};
const PRIMARY: CSSProperties = {
  border: 'none', background: '#0A3D8F', color: '#fff',
  borderRadius: 6, fontSize: 12.5, fontWeight: 600, padding: '8px 16px', cursor: 'pointer', fontFamily: 'inherit',
};
