export default function Loading() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Topbar placeholder */}
      <div style={{ height: 52, background: '#fff', borderBottom: '1px solid #DDE6F5', flexShrink: 0 }} />

      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: '#F4F7FC' }}>

        {/* Page header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <div className="skeleton" style={{ height: 26, width: 160, marginBottom: 8, borderRadius: 4 }} />
            <div className="skeleton" style={{ height: 14, width: 240, borderRadius: 4 }} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div className="skeleton" style={{ height: 30, width: 170, borderRadius: 16 }} />
            <div className="skeleton" style={{ height: 30, width: 110, borderRadius: 16 }} />
            <div className="skeleton" style={{ height: 30, width: 120, borderRadius: 6 }} />
          </div>
        </div>

        {/* Tab bar */}
        <div style={{ display: 'flex', gap: 2, marginBottom: 20, borderBottom: '2px solid #DDE6F5', paddingBottom: 0 }}>
          <div className="skeleton" style={{ height: 34, width: 100, borderRadius: '4px 4px 0 0' }} />
          <div className="skeleton" style={{ height: 34, width: 150, borderRadius: '4px 4px 0 0', opacity: 0.5 }} />
        </div>

        {/* Calendar grid */}
        <div style={{ background: '#fff', border: '1px solid #DDE6F5', borderRadius: 8, overflow: 'hidden' }}>

          {/* Header row */}
          <div style={{ display: 'grid', gridTemplateColumns: '140px repeat(7, 1fr)' }}>
            <div style={{ padding: 12, background: '#EBF1FB', borderRight: '1px solid #DDE6F5', borderBottom: '1px solid #DDE6F5' }} />
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} style={{
                padding: '10px 12px', background: '#EBF1FB',
                borderRight: i < 6 ? '1px solid #DDE6F5' : 'none',
                borderBottom: '1px solid #DDE6F5',
              }}>
                <div className="skeleton" style={{ height: 9, width: '55%', marginBottom: 5, borderRadius: 3 }} />
                <div className="skeleton" style={{ height: 14, width: '38%', borderRadius: 3 }} />
              </div>
            ))}
          </div>

          {/* Rep rows */}
          {Array.from({ length: 4 }).map((_, row) => (
            <div key={row} style={{
              display: 'grid', gridTemplateColumns: '140px repeat(7, 1fr)',
              borderBottom: row < 3 ? '1px solid #DDE6F5' : 'none',
              minHeight: 88,
            }}>
              <div style={{
                padding: 12, borderRight: '1px solid #DDE6F5',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, justifyContent: 'center',
              }}>
                <div className="skeleton" style={{ width: 32, height: 32, borderRadius: 6 }} />
                <div className="skeleton" style={{ height: 10, width: '60%', borderRadius: 3 }} />
              </div>
              {Array.from({ length: 7 }).map((_, col) => (
                <div key={col} style={{ padding: 6, borderRight: col < 6 ? '1px solid #DDE6F5' : 'none' }}>
                  {(row * 7 + col) % 3 === 0 && (
                    <div className="skeleton" style={{ height: 52, borderRadius: 4 }} />
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}
