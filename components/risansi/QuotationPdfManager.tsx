'use client';

import { useRef, type CSSProperties } from 'react';
import { useQuotationDocs, QuotationDocList } from './QuotationDocs';

// View / add / remove the quotation documents for an opportunity, available at
// any stage from Quoted onward (including a locked Won/Lost — document
// management bypasses the deal lock, like Sales Orders). Uploads and deletes go
// straight to the opportunity's quotation routes; the deal form around it is
// untouched.
export function QuotationPdfManager({ oppId, initialLink, canEdit }: {
  oppId: number;
  initialLink: string | null;
  canEdit: boolean;
}) {
  const { docs, link, loading, busy, msg, err, upload, remove } =
    useQuotationDocs(oppId, { initialLink });
  const fileRef = useRef<HTMLInputElement>(null);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = '';               // let the user re-pick the same file
    await upload(picked);
  };

  // A legacy external url — a link typed in before uploads existed — has no row
  // in the documents table, so it is shown on its own rather than being lost.
  const externalOnly = !loading && docs.length === 0 && !!link && !link.startsWith('/api/');

  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
      <div style={HEAD}>
        Quotation documents{docs.length > 1 ? ` · ${docs.length}` : ''}
      </div>
      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {externalOnly ? (
          <a href={link} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}>
            🔗 Open quotation link
          </a>
        ) : (
          <QuotationDocList oppId={oppId} docs={docs} loading={loading} busy={busy}
            canEdit={canEdit} onRemove={remove} emptyText="No quotation documents attached." />
        )}

        {canEdit && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input ref={fileRef} type="file" accept="application/pdf,.pdf" multiple
              onChange={onPick} style={{ display: 'none' }} />
            <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} style={BTN}>
              {busy ? 'Working…' : docs.length ? '⤒ Add more PDFs' : '⤒ Upload PDFs'}
            </button>
            <span style={{ fontSize: 10.5, color: 'var(--fg-3)' }}>PDF only · up to 15 MB each · pick several at once</span>
          </div>
        )}

        {msg && <span style={{ fontSize: 11, color: err ? 'var(--neg-strong)' : 'var(--pos-strong)' }}>{msg}</span>}
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
