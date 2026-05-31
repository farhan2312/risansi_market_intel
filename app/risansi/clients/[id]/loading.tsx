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
        {/* Client name + badges */}
        <div style={{ marginBottom: 20 }}>
          <div className="shimmer" style={{ width: 280, height: 28, borderRadius: 4, marginBottom: 10 }} />
          <div style={{ display: 'flex', gap: 8 }}>
            {[70, 90, 60, 80].map((w, i) => (
              <div key={i} className="shimmer" style={{ width: w, height: 20, borderRadius: 3 }} />
            ))}
          </div>
        </div>

        {/* Two-column layout */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          {/* Left column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="shimmer" style={{ height: 180, borderRadius: 6 }} />
            <div className="shimmer" style={{ height: 220, borderRadius: 6 }} />
            <div className="shimmer" style={{ height: 140, borderRadius: 6 }} />
          </div>
          {/* Right column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="shimmer" style={{ height: 160, borderRadius: 6 }} />
            <div className="shimmer" style={{ height: 260, borderRadius: 6 }} />
            <div className="shimmer" style={{ height: 120, borderRadius: 6 }} />
          </div>
        </div>
      </div>
    </div>
  );
}
