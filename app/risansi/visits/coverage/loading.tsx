export default function Loading() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Topbar placeholder */}
      <div style={{ height: 52, background: '#fff', borderBottom: '1px solid #DDE6F5', flexShrink: 0 }} />

      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: '#F4F7FC' }}>

        {/* Page header */}
        <div style={{ marginBottom: 18 }}>
          <div className="skeleton" style={{ height: 26, width: 180, marginBottom: 8, borderRadius: 4 }} />
          <div className="skeleton" style={{ height: 13, width: 280, borderRadius: 4 }} />
        </div>

        {/* Stats strip */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
          {[120, 120, 130, 150].map((w, i) => (
            <div key={i} style={{ background: '#fff', border: '1px solid #DDE6F5', borderLeft: '3px solid #DDE6F5', borderRadius: 6, padding: '10px 16px', minWidth: w }}>
              <div className="skeleton" style={{ height: 9, width: 60, marginBottom: 8, borderRadius: 3 }} />
              <div className="skeleton" style={{ height: 22, width: 40, marginBottom: 5, borderRadius: 3 }} />
              <div className="skeleton" style={{ height: 9, width: 70, borderRadius: 3 }} />
            </div>
          ))}
        </div>

        {/* Map panel */}
        <div style={{ background: '#fff', border: '1px solid #DDE6F5', borderRadius: 6, overflow: 'hidden', marginBottom: 14 }}>
          <div style={{ height: 44, borderBottom: '1px solid #DDE6F5', padding: '12px 16px', display: 'flex', gap: 8, alignItems: 'center' }}>
            <div className="skeleton" style={{ height: 11, width: 180, borderRadius: 3 }} />
            <div className="skeleton" style={{ height: 11, width: 130, borderRadius: 3 }} />
          </div>
          <div style={{ padding: '16px 24px 8px' }}>
            {/* SVG skeleton */}
            <div className="skeleton" style={{ width: '100%', height: 400, borderRadius: 4 }} />
          </div>
        </div>

        {/* Route table panel */}
        <div style={{ background: '#fff', border: '1px solid #DDE6F5', borderRadius: 6, overflow: 'hidden' }}>
          <div style={{ height: 44, borderBottom: '1px solid #DDE6F5', padding: '12px 16px' }}>
            <div className="skeleton" style={{ height: 11, width: 140, borderRadius: 3 }} />
          </div>
          <div style={{ background: '#EBF1FB', height: 36, display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px' }}>
            {[120, 60, 80, 80, 120].map((w, i) => (
              <div key={i} className="skeleton" style={{ height: 9, width: w, borderRadius: 3 }} />
            ))}
          </div>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: i < 5 ? '1px solid #DDE6F5' : 'none' }}>
              {[120, 60, 80, 80, 120].map((w, j) => (
                <div key={j} className="skeleton" style={{ height: 12, width: w, borderRadius: 3 }} />
              ))}
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}
