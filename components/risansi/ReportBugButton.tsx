'use client';

import { useState, useRef, useEffect, type CSSProperties } from 'react';
import { BUG_SEVERITIES, BUG_SEVERITY_LABELS, type BugSeverity } from '@/lib/risansi-bugs';

// "Report a Bug" — any signed-in user describes an issue, optionally attaches a
// screenshot, and files it. Posts multipart to /api/risansi/bugs; the system
// admin then works it through the pipeline on /risansi/admin/bugs.
export function ReportBugButton() {
  const [open, setOpen]           = useState(false);
  const [title, setTitle]         = useState('');
  const [description, setDesc]    = useState('');
  const [severity, setSeverity]   = useState<BugSeverity>('medium');
  const [pageUrl, setPageUrl]     = useState('');
  const [file, setFile]           = useState<File | null>(null);
  const [preview, setPreview]     = useState<string | null>(null);
  const [submitting, setSubmit]   = useState(false);
  const [error, setError]         = useState('');
  const [done, setDone]           = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Prefill the page the user is on when they open the dialog.
  useEffect(() => {
    if (open && !pageUrl) setPageUrl(window.location.pathname + window.location.search);
  }, [open, pageUrl]);

  // Manage the object URL for the screenshot preview.
  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const reset = () => {
    setTitle(''); setDesc(''); setSeverity('medium'); setPageUrl('');
    setFile(null); setError(''); setDone(false); setSubmit(false);
    if (fileRef.current) fileRef.current.value = '';
  };
  const close = () => { setOpen(false); reset(); };

  const onPickFile = (f: File | null) => {
    setError('');
    if (f && !/^image\/(png|jpe?g|gif|webp|bmp)$/i.test(f.type)) {
      setError('Screenshot must be a PNG, JPG, GIF, WebP or BMP image.'); return;
    }
    if (f && f.size > 8 * 1024 * 1024) { setError('Screenshot is too large (max 8 MB).'); return; }
    setFile(f);
  };

  const submit = async () => {
    if (!title.trim()) { setError('Please add a short title.'); return; }
    setSubmit(true); setError('');
    try {
      const fd = new FormData();
      fd.set('title', title.trim());
      fd.set('description', description.trim());
      fd.set('page_url', pageUrl.trim());
      fd.set('severity', severity);
      if (file) fd.set('screenshot', file);
      const res = await fetch('/api/risansi/bugs', { method: 'POST', body: fd });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || 'Could not file the bug. Please try again.');
      }
      setDone(true);
      setTimeout(close, 1600);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
      setSubmit(false);
    }
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} style={TRIGGER} title="Report a bug">
        <svg width={13} height={13} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" aria-hidden>
          <path d="M5.5 6.5a2.5 2.5 0 0 1 5 0v3a2.5 2.5 0 0 1-5 0z" />
          <path d="M8 4V2.5M6 4.8 4.6 3.4M10 4.8l1.4-1.4M5.3 8H2.8M10.7 8h2.5M5.3 11 3.9 12.4M10.7 11l1.4 1.4" />
        </svg>
        Report a Bug
      </button>

      {open && (
        <div style={OVERLAY} onClick={close}>
          <div style={MODAL} onClick={e => e.stopPropagation()}>
            <div style={HEAD}>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>🐞 Report a Bug</span>
              <button type="button" onClick={close} aria-label="Close" style={CLOSE}>×</button>
            </div>

            {done ? (
              <div style={{ padding: '36px 20px', textAlign: 'center' }}>
                <div style={{ fontSize: 30, marginBottom: 8 }}>✓</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--pos)' }}>Bug reported — thank you!</div>
                <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 4 }}>The system admin will pick it up.</div>
              </div>
            ) : (
              <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <Field label="Title" required>
                  <input value={title} onChange={e => setTitle(e.target.value)} maxLength={200}
                    placeholder="Short summary of the issue" style={INP} autoFocus />
                </Field>

                <Field label="What happened?">
                  <textarea value={description} onChange={e => setDesc(e.target.value)} rows={4} maxLength={5000}
                    placeholder="Steps to reproduce, what you expected, what actually happened…"
                    style={{ ...INP, resize: 'vertical', minHeight: 80 }} />
                </Field>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 12 }}>
                  <Field label="Severity">
                    <select value={severity} onChange={e => setSeverity(e.target.value as BugSeverity)} style={INP}>
                      {BUG_SEVERITIES.map(s => <option key={s} value={s}>{BUG_SEVERITY_LABELS[s]}</option>)}
                    </select>
                  </Field>
                  <Field label="Page / where">
                    <input value={pageUrl} onChange={e => setPageUrl(e.target.value)} maxLength={500}
                      placeholder="/risansi/…" style={INP} />
                  </Field>
                </div>

                <Field label="Screenshot (optional)">
                  {preview ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={preview} alt="Screenshot preview"
                        style={{ height: 56, width: 84, objectFit: 'cover', borderRadius: 5, border: '1px solid var(--line)' }} />
                      <div style={{ fontSize: 11, color: 'var(--fg-3)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {file?.name}
                      </div>
                      <button type="button" onClick={() => onPickFile(null)} style={LINK_BTN}>Remove</button>
                    </div>
                  ) : (
                    <label style={DROP}>
                      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/bmp" style={{ display: 'none' }}
                        onChange={e => onPickFile(e.target.files?.[0] ?? null)} />
                      <span style={{ fontSize: 12, color: 'var(--fg-3)' }}>📎 Click to attach an image</span>
                    </label>
                  )}
                </Field>

                {error && <div style={{ fontSize: 12, color: 'var(--neg)' }}>{error}</div>}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                  <button type="button" onClick={close} style={BTN_GHOST}>Cancel</button>
                  <button type="button" onClick={submit} disabled={submitting} style={{ ...BTN_PRIMARY, opacity: submitting ? 0.6 : 1 }}>
                    {submitting ? 'Filing…' : 'Submit Bug'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-2)', marginBottom: 4 }}>
        {label}{required && <span style={{ color: 'var(--neg)' }}> *</span>}
      </div>
      {children}
    </label>
  );
}

const TRIGGER: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '6px 11px', fontSize: 12, fontFamily: 'inherit', fontWeight: 500,
  background: 'var(--bg-paper)', border: '1px solid var(--line-strong)',
  color: 'var(--fg)', borderRadius: 5, cursor: 'pointer',
};
const OVERLAY: CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(15,23,42,0.45)',
  display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '8vh 16px 16px',
};
const MODAL: CSSProperties = {
  width: '100%', maxWidth: 480, background: 'var(--bg-paper)',
  border: '1px solid var(--line-strong)', borderRadius: 10,
  boxShadow: '0 20px 60px rgba(0,0,0,0.3)', maxHeight: '84vh', overflowY: 'auto',
};
const HEAD: CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '13px 16px', borderBottom: '1px solid var(--line)',
};
const CLOSE: CSSProperties = {
  background: 'none', border: 'none', fontSize: 22, lineHeight: 1, color: 'var(--fg-3)', cursor: 'pointer', padding: 0,
};
const INP: CSSProperties = {
  width: '100%', padding: '7px 10px', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box',
  background: 'var(--bg-paper)', color: 'var(--fg)', border: '1px solid var(--line-strong)', borderRadius: 5, outline: 'none',
};
const DROP: CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '14px',
  border: '1px dashed var(--line-strong)', borderRadius: 6, cursor: 'pointer', background: 'var(--bg-sunk)',
};
const LINK_BTN: CSSProperties = {
  background: 'none', border: 'none', color: 'var(--neg)', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
};
const BTN_GHOST: CSSProperties = {
  padding: '7px 14px', fontSize: 13, fontFamily: 'inherit', background: 'none',
  border: '1px solid var(--line-strong)', color: 'var(--fg-2)', borderRadius: 6, cursor: 'pointer',
};
const BTN_PRIMARY: CSSProperties = {
  padding: '7px 16px', fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
  background: '#0A3D8F', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer',
};
