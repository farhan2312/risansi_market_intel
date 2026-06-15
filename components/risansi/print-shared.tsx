import type { CSSProperties, ReactNode } from 'react';

// Self-contained print stylesheet — literal colors so the PDF looks identical
// regardless of app theme. Hides the on-screen toolbar (.no-print) when printing
// and sets A4 margins.
export const PRINT_CSS = `
  @page { size: A4; margin: 14mm 12mm; }
  @media print {
    .no-print { display: none !important; }
    .print-root { background: #fff !important; }
    .avoid-break { break-inside: avoid; page-break-inside: avoid; }
  }
  .print-root { color: #0F172A; }
  .print-root a { color: #0A3D8F; text-decoration: none; }
`;

export const C = {
  ink: '#0F172A', fg2: '#334155', fg3: '#64748B',
  line: '#E2E8F0', accent: '#0A3D8F', accentSoft: '#EBF1FB',
  pos: '#047857', warn: '#B45309', neg: '#B91C1C', grey: '#94A3B8',
  bgElev: '#F8FAFC', bgSunk: '#F1F5F9',
};

export const ROOT: CSSProperties = {
  maxWidth: 820, margin: '0 auto', padding: '0 4px 40px',
  fontFamily: '"Helvetica Neue", Arial, system-ui, sans-serif',
  fontSize: 12, lineHeight: 1.5, color: C.ink,
};

export const PANEL: CSSProperties = {
  border: `1px solid ${C.line}`, borderRadius: 8,
  marginBottom: 12, overflow: 'hidden',
};

export const PANEL_H: CSSProperties = {
  padding: '8px 12px', background: C.bgElev,
  borderBottom: `1px solid ${C.line}`,
  fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '0.06em', color: C.fg2,
};

export const PANEL_BODY: CSSProperties = { padding: 12 };

export function Section({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div style={PANEL} className="avoid-break">
      <div style={{ ...PANEL_H, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>{title}</span>
        {right ? <span style={{ fontWeight: 500, textTransform: 'none', letterSpacing: 0, color: C.fg3 }}>{right}</span> : null}
      </div>
      <div style={PANEL_BODY}>{children}</div>
    </div>
  );
}

/** Label / value pair grid. Pass [label, value] tuples; nulls are skipped. */
export function Facts({ rows, cols = 2 }: { rows: Array<[string, ReactNode]>; cols?: number }) {
  const visible = rows.filter(([, v]) => v != null && v !== '' && v !== '—');
  if (visible.length === 0) return <div style={{ color: C.fg3 }}>—</div>;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: '10px 20px' }}>
      {visible.map(([label, value], i) => (
        <div key={i}>
          <div style={{ fontSize: 9, color: C.fg3, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>{label}</div>
          <div style={{ fontSize: 12, color: C.ink, marginTop: 1 }}>{value}</div>
        </div>
      ))}
    </div>
  );
}

/** Free-text block with a small uppercase label. Renders nothing when empty. */
export function TextBlock({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 9, color: C.fg3, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 12, color: C.ink, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{value}</div>
    </div>
  );
}

export const TH: CSSProperties = {
  padding: '6px 8px', textAlign: 'left', fontSize: 9,
  textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700,
  color: C.fg3, borderBottom: `1px solid ${C.line}`, background: C.bgElev,
};

export const TD: CSSProperties = {
  padding: '6px 8px', fontSize: 11, borderBottom: `1px solid ${C.line}`, verticalAlign: 'top',
};

/** Document header band used on both report types. */
export function DocHeader({ kind, title, subtitle, meta }: {
  kind: string; title: string; subtitle?: ReactNode; meta?: ReactNode;
}) {
  return (
    <div style={{ borderBottom: `2px solid ${C.accent}`, paddingBottom: 12, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 10, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.14em', fontWeight: 700 }}>
            Risansi Industries Ltd · {kind}
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: C.ink, marginTop: 4, lineHeight: 1.2 }}>{title}</div>
          {subtitle ? <div style={{ fontSize: 12, color: C.fg3, marginTop: 4 }}>{subtitle}</div> : null}
        </div>
        {meta ? <div style={{ textAlign: 'right', fontSize: 10, color: C.fg3 }}>{meta}</div> : null}
      </div>
    </div>
  );
}

const SKIP_KEYS = new Set([
  'id', 'visit_id', 'client_id', 'created_at', 'updated_at', 'deleted_at',
  'created_by', 'updated_by',
]);

/** Humanize snake_case → Title Case. */
function humanize(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/** Renders all non-null, non-system fields of an arbitrary report row as facts. */
export function RowFacts({ row }: { row: Record<string, unknown> | null | undefined }) {
  if (!row) return null;
  const rows: Array<[string, ReactNode]> = Object.entries(row)
    .filter(([k, v]) => !SKIP_KEYS.has(k) && v != null && v !== '' && typeof v !== 'object')
    .map(([k, v]) => [humanize(k), typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v)] as [string, ReactNode]);
  if (rows.length === 0) return null;
  return <Facts rows={rows} cols={2} />;
}
