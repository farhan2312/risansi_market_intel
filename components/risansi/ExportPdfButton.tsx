'use client';

export function ExportPdfButton() {
  return (
    <button
      onClick={() => window.print()}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 11px',
        fontSize: 12,
        fontFamily: 'inherit',
        fontWeight: 500,
        background: 'var(--bg-paper)',
        border: '1px solid var(--line-strong)',
        color: 'var(--fg)',
        borderRadius: 5,
        cursor: 'pointer',
      }}
    >
      <svg width={12} height={12} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 10H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1h-1"/>
        <rect x="4" y="11" width="8" height="4" rx="0.5"/>
        <path d="M4 6V2h8v4"/>
        <circle cx="12" cy="8" r="0.5" fill="currentColor" stroke="none"/>
      </svg>
      Export PDF
    </button>
  );
}
