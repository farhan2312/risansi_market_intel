'use client';

import { useState, useRef, type CSSProperties } from 'react';

// View / replace / delete the quotation PDF for an opportunity, available at any
// stage from Quoted onward (including a locked Won/Lost — PDF management bypasses
// the deal lock, like Sales Orders). Uploads/deletes go straight to the
// opportunity's quotation route; the deal form around it is untouched.
export function QuotationPdfManager({ oppId, initialLink, canEdit }: {
  oppId: number;
  initialLink: string | null;
  canEdit: boolean;
}) {
  const [link, setLink] = useState<string | null>(initialLink);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg]   = useState('');
  const [err, setErr]   = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const url = `/api/risansi/opportunities/${oppId}/quotation`;

  const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';                 // let the user re-pick the same file
    if (!f) return;
    setBusy(true); setMsg(''); setErr(false);
    try {
      const fd = new FormData(); fd.append('file', f);
      const res  = await fetch(url, { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Upload failed');
      setLink(data.link || url); setName(data.fileName || f.name);
      setMsg(`Uploaded “${data.fileName || f.name}”.`);
    } catch (e2) { setErr(true); setMsg(e2 instanceof Error ? e2.message : 'Upload failed.'); }
    finally { setBusy(false); }
  };

  const del = async () => {
    if (typeof window !== 'undefined' && !window.confirm('Delete the quotation PDF for this opportunity?')) return;
    setBusy(true); setMsg(''); setErr(false);
    try {
      const res  = await fetch(url, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Delete failed');
      setLink(null); setName(''); setMsg('Quotation PDF removed.');
    } catch (e2) { setErr(true); setMsg(e2 instanceof Error ? e2.message : 'Delete failed.'); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
      <div style={HEAD}>Quotation PDF</div>
      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {link ? (
          <a href={link} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}>
            📄 View quotation PDF{name ? ` · ${name}` : ''}
          </a>
        ) : (
          <span style={{ fontSize: 12, color: 'var(--fg-3)' }}>No quotation PDF uploaded.</span>
        )}

        {canEdit && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input ref={fileRef} type="file" accept="application/pdf,.pdf" onChange={upload} style={{ display: 'none' }} />
            <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} style={BTN}>
              {busy ? 'Working…' : link ? '⤒ Replace PDF' : '⤒ Upload PDF'}
            </button>
            {link && (
              <button type="button" onClick={del} disabled={busy} style={DEL_BTN}>Delete</button>
            )}
          </div>
        )}

        {msg && <span style={{ fontSize: 11, color: err ? '#9B1C1C' : '#0A7D34' }}>{msg}</span>}
      </div>
    </div>
  );
}

const HEAD: CSSProperties = {
  padding: '9px 14px', background: 'var(--bg-elev)', borderBottom: '1px solid var(--line)',
  fontSize: 12, fontWeight: 700, color: 'var(--fg-2)', textTransform: 'uppercase', letterSpacing: '0.05em',
};
const BTN: CSSProperties = {
  border: '1px solid var(--line-strong)', background: 'var(--bg-paper)', color: 'var(--fg)',
  borderRadius: 6, fontSize: 12, fontWeight: 600, padding: '7px 12px', cursor: 'pointer', fontFamily: 'inherit',
};
const DEL_BTN: CSSProperties = {
  border: '1px solid var(--line-strong)', background: 'var(--bg-paper)', color: '#9B1C1C',
  borderRadius: 6, fontSize: 12, fontWeight: 600, padding: '7px 12px', cursor: 'pointer', fontFamily: 'inherit',
};
