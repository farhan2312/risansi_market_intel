import type { CSSProperties, ReactNode } from 'react';
import { parseQuotationLink } from '@/lib/risansi-quotation-link';

// How a stored quotation_link is shown, everywhere it is shown.
//
// No 'use client' on purpose: it holds no state and no handlers, so it renders
// inside the server-rendered client page and pipeline table as happily as it
// does inside the Edit drawer. One component means the pipeline row, Client 360
// and the drawer can no longer disagree about what a value means — which they
// did, in three different ways, before this existed.
//
// The three things it fixes, all of them silent until you look at the data:
//   · a document name with no url is text, not an <a>. It used to be linked, and
//     because the name is not a url the browser resolved it against the current
//     page — 'For Panpat.pdf' on a client page went to /risansi/clients/For%20Panpat.pdf.
//   · a value holding two urls shows two links. It used to be one href with the
//     blank lines still in it, so the second quotation was unreachable.
//   · a legacy record says it is legacy, so nobody reads a SharePoint url on
//     someone's OneDrive as a document this portal holds.

export function QuotationLinkView({ value, compact, label }: {
  value: string | null | undefined;
  /** Table-cell sizing: one line, no wrapping, smaller type. */
  compact?: boolean;
  /** Text for the primary link. Defaults to something describing the kind. */
  label?: ReactNode;
}) {
  const q = parseQuotationLink(value);
  if (q.kind === 'none') return null;

  const size = compact ? 11 : 12.5;

  if (q.kind === 'upload') {
    return (
      <a href={q.appPath!} target="_blank" rel="noreferrer"
        style={{ ...LINK, fontSize: size }}>
        {label ?? 'Quotation'} ↗
      </a>
    );
  }

  // A name with no address. Shown, never linked — the whole point is that there
  // is nothing to open, and a link that 404s is worse than plain text because it
  // reads as though the document is one click away.
  if (q.kind === 'legacy-name') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: compact ? 'nowrap' : 'wrap' }}>
        <span
          title={`On record as “${q.label}”. No file was ever attached and no address was recorded, so there is nothing to open.`}
          style={{
            fontSize: size, color: 'var(--fg-2)',
            ...(compact ? { maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } : {}),
          }}>
          {q.label}
        </span>
        <Chip tone="muted">no file</Chip>
      </span>
    );
  }

  // One or more external urls.
  const many = q.urls.length > 1;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {q.urls.map((u, i) => (
        <a key={u} href={u} target="_blank" rel="noopener noreferrer"
          title={q.label ? `${q.label} — ${u}` : u}
          style={{ ...LINK, fontSize: size }}>
          {many ? `Link ${i + 1}` : (label ?? 'Quotation')} ↗
        </a>
      ))}
      <Chip tone="legacy">legacy</Chip>
    </span>
  );
}

function Chip({ children, tone }: { children: ReactNode; tone: 'legacy' | 'muted' }) {
  return (
    <span style={{
      ...CHIP,
      color: tone === 'legacy' ? 'var(--warn-strong, #92400E)' : 'var(--fg-3)',
      borderColor: tone === 'legacy' ? 'var(--warn-strong, #92400E)' : 'var(--line-strong)',
      opacity: tone === 'legacy' ? 0.85 : 1,
    }}>
      {children}
    </span>
  );
}

const LINK: CSSProperties = {
  color: 'var(--brand-blue, #1A5CB8)', textDecoration: 'none', fontWeight: 600,
};
const CHIP: CSSProperties = {
  fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
  border: '1px solid', borderRadius: 4, padding: '1px 4px', lineHeight: 1.5, whiteSpace: 'nowrap',
};
