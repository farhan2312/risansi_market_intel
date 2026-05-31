export default function Loading() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Topbar placeholder */}
      <div style={{
        height: 52, flexShrink: 0,
        background: '#fff',
        borderBottom: '1px solid var(--line)',
      }} />

      <div style={{ flex: 1, padding: '22px 24px 40px', background: 'var(--bg)', overflowY: 'auto' }}>
        {/* Page title */}
        <div className="shimmer" style={{ width: 100, height: 26, borderRadius: 4, marginBottom: 8 }} />
        <div className="shimmer" style={{ width: 160, height: 14, borderRadius: 4, marginBottom: 16 }} />

        {/* Filter bar */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          {[200, 130, 110, 100, 100, 140].map((w, i) => (
            <div key={i} className="shimmer" style={{ width: w, height: 30, borderRadius: 5 }} />
          ))}
        </div>

        {/* Table */}
        <div style={{
          background: 'var(--bg-paper)',
          border: '1px solid var(--line)',
          borderRadius: 6,
          overflow: 'hidden',
        }}>
          {/* Header */}
          <div className="shimmer" style={{ height: 36, borderRadius: 0 }} />
          {/* Rows */}
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} style={{
              display: 'flex', gap: 12, padding: '10px 12px',
              borderTop: '1px solid var(--line)',
              alignItems: 'center',
            }}>
              <div className="shimmer" style={{ width: 60, height: 14, borderRadius: 3, flexShrink: 0 }} />
              <div className="shimmer" style={{ width: 160, height: 14, borderRadius: 3, flexShrink: 0 }} />
              <div className="shimmer" style={{ width: 70, height: 20, borderRadius: 3, flexShrink: 0 }} />
              <div className="shimmer" style={{ width: 90, height: 20, borderRadius: 3, flexShrink: 0 }} />
              <div className="shimmer" style={{ width: 80, height: 14, borderRadius: 3, flexShrink: 0 }} />
              <div className="shimmer" style={{ flex: 1, height: 14, borderRadius: 3 }} />
              <div className="shimmer" style={{ width: 60, height: 14, borderRadius: 3, flexShrink: 0 }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
