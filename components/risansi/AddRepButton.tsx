'use client';

import { useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { createRep } from '@/app/actions/risansi-reps';

export function AddRepButton() {
  const [open, setOpen]       = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const fd = new FormData(e.currentTarget);
      await createRep(fd);
      setOpen(false);
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
      setLoading(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        style={{ padding: '7px 14px', borderRadius: 6, background: '#0A3D8F', color: 'white', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 500, fontFamily: 'inherit' }}
      >
        + Add Rep
      </button>

      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(10,22,40,0.35)', zIndex: 300 }} />
          <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 480, background: 'white', borderRadius: 12, zIndex: 301, boxShadow: '0 20px 60px rgba(10,61,143,0.2)', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>Add New Rep</span>
              <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--fg-3)', lineHeight: 1 }}>×</button>
            </div>

            <form onSubmit={handleSubmit} style={{ padding: 20 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={LABEL}>Full Name *</label>
                    <input name="name" required style={INPUT} placeholder="e.g. Akshay Awasthi" />
                  </div>
                  <div>
                    <label style={LABEL}>Rep Code *</label>
                    <input name="rep_code" required style={INPUT} placeholder="e.g. r-aksh-awas" />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={LABEL}>Zone *</label>
                    <select name="zone" required style={INPUT} defaultValue="">
                      <option value="">— Select —</option>
                      {['North', 'Central', 'West', 'South', 'Export'].map(z => <option key={z} value={z}>{z}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={LABEL}>Route</label>
                    <input name="route" style={INPUT} placeholder="e.g. U.P. East" />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={LABEL}>Email</label>
                    <input name="email" type="email" style={INPUT} placeholder="name@risansi.com" />
                  </div>
                  <div>
                    <label style={LABEL}>Annual Target (₹ Cr)</label>
                    <input name="target_cr" type="number" step="0.5" min="0" style={INPUT} placeholder="e.g. 4" />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={LABEL}>Role</label>
                    <select name="role" style={INPUT} defaultValue="rep">
                      <option value="rep">Field Rep</option>
                      <option value="manager">Sales Manager</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                  <div>
                    <label style={LABEL}>Initials *</label>
                    <input name="initials" required style={INPUT} maxLength={5} placeholder="e.g. AA" />
                  </div>
                </div>

                {error && (
                  <div style={{ padding: '8px 12px', background: '#FDE8E8', border: '1px solid #F87171', borderLeft: '3px solid #E02424', borderRadius: 5, color: '#9B1C1C', fontSize: 12 }}>
                    {error}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button type="button" onClick={() => setOpen(false)} style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid var(--line-strong)', background: 'white', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}>
                    Cancel
                  </button>
                  <button type="submit" disabled={loading} style={{ padding: '8px 20px', borderRadius: 6, background: '#0A3D8F', color: 'white', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500, fontFamily: 'inherit', opacity: loading ? 0.7 : 1 }}>
                    {loading ? 'Adding…' : 'Add Rep'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </>
      )}
    </>
  );
}

const LABEL: CSSProperties = {
  fontSize: 11, fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase',
  letterSpacing: '0.06em', display: 'block', marginBottom: 5,
};
const INPUT: CSSProperties = {
  width: '100%', padding: '8px 10px', border: '1px solid var(--line-strong)',
  borderRadius: 6, fontSize: 13, background: 'white', color: 'var(--fg)',
  boxSizing: 'border-box', fontFamily: 'inherit',
};
