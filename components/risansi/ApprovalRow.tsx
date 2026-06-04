'use client';

import { useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { approveUser, rejectUser, createRepFromApproval } from '@/app/actions/admin';

export interface ApprovalRequest {
  id: number;
  email: string;
  display_name: string;
  requested_role: string;
  requested_at: string | null;
}

export interface RepOption {
  id: number;
  name: string;
  zone: string | null;
  route: string | null;
  rep_email: string | null;
  is_active: boolean;
  is_unlinked: boolean;
}

export function ApprovalRow({ request, reps }: { request: ApprovalRequest; reps: RepOption[] }) {
  const router = useRouter();
  const [role, setRole]             = useState(request.requested_role ?? 'rep');
  const [repId, setRepId]           = useState('');
  const [loading, setLoading]       = useState(false);
  const [showNewRep, setShowNewRep] = useState(false);
  const [error, setError]           = useState('');

  const isRep = role === 'rep';

  const handleApprove = async () => {
    if (isRep && !repId) {
      setError('Please link to an existing rep or create a new one');
      return;
    }
    setLoading(true); setError('');
    try {
      const fd = new FormData();
      fd.set('id', String(request.id));
      fd.set('role', role);
      if (isRep && repId) fd.set('rep_id', repId);
      await approveUser(fd);
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
      setLoading(false);
    }
  };

  const handleReject = async () => {
    setLoading(true);
    try {
      const fd = new FormData();
      fd.set('id', String(request.id));
      await rejectUser(fd);
      router.refresh();
    } catch {
      setLoading(false);
    }
  };

  return (
    <tr style={{ borderBottom: '1px solid #EBF1FB', verticalAlign: 'top' }}>
      {/* Name + email */}
      <td style={TD}>
        <div style={{ fontWeight: 600, fontSize: 13, color: '#0D1B2E' }}>{request.display_name}</div>
        <div style={{ fontSize: 11, color: '#6B7F96', marginTop: 2, fontFamily: 'monospace' }}>{request.email}</div>
        <div style={{ fontSize: 10, color: '#6B7F96', marginTop: 2 }}>
          Requested: {request.requested_at ? new Date(request.requested_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
        </div>
      </td>

      {/* Requested role */}
      <td style={TD}>
        <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 10, background: '#F3F4F6', color: '#374151' }}>
          {request.requested_role ?? 'rep'}
        </span>
      </td>

      {/* Assign role */}
      <td style={TD}>
        <select
          value={role}
          onChange={e => { setRole(e.target.value); setRepId(''); setShowNewRep(false); setError(''); }}
          style={{ padding: '6px 8px', border: '1px solid #CBD5E1', borderRadius: 5, fontSize: 12, width: '100%', minWidth: 120, background: '#F4F6FB', fontFamily: 'inherit' }}
        >
          <option value="rep">Field Rep</option>
          <option value="manager">Sales Manager</option>
          <option value="admin">Admin</option>
          <option value="sysadmin">System Admin</option>
        </select>
      </td>

      {/* Link to rep */}
      <td style={{ ...TD, minWidth: 240 }}>
        {isRep ? (
          <div>
            {!showNewRep ? (
              <>
                <select
                  value={repId}
                  onChange={e => { setRepId(e.target.value); setError(''); }}
                  style={{ padding: '6px 8px', border: `1px solid ${error && !repId ? '#DC2626' : '#CBD5E1'}`, borderRadius: 5, fontSize: 12, width: '100%', background: '#F4F6FB', fontFamily: 'inherit' }}
                >
                  <option value="">— Select existing rep —</option>
                  <optgroup label="✓ Unlinked reps">
                    {reps.filter(r => r.is_unlinked).map(r => (
                      <option key={r.id} value={r.id}>{r.name}{r.zone ? ` · ${r.zone}` : ''}{r.route ? ` · ${r.route}` : ''}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Already linked">
                    {reps.filter(r => !r.is_unlinked).map(r => (
                      <option key={r.id} value={r.id}>{r.name}{r.rep_email ? ` · ${r.rep_email}` : ''}</option>
                    ))}
                  </optgroup>
                </select>
                <button
                  type="button"
                  onClick={() => { setShowNewRep(true); setRepId(''); }}
                  style={{ marginTop: 6, fontSize: 11, color: '#1A5CB8', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0, fontFamily: 'inherit' }}
                >
                  + Create new rep instead
                </button>
              </>
            ) : (
              <NewRepInlineForm
                defaultName={request.display_name}
                onCancel={() => setShowNewRep(false)}
                onCreated={(id) => { setRepId(String(id)); setShowNewRep(false); router.refresh(); }}
              />
            )}
            {error && <div style={{ marginTop: 4, fontSize: 11, color: '#DC2626' }}>{error}</div>}
          </div>
        ) : (
          <span style={{ fontSize: 11, color: '#6B7F96', fontStyle: 'italic' }}>Not applicable</span>
        )}
      </td>

      {/* Actions */}
      <td style={{ ...TD, whiteSpace: 'nowrap' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={handleApprove} disabled={loading}
            style={{ padding: '6px 14px', borderRadius: 5, background: '#059669', color: 'white', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 500, opacity: loading ? 0.7 : 1, fontFamily: 'inherit' }}
          >
            {loading ? '…' : '✓ Approve'}
          </button>
          <button
            onClick={handleReject} disabled={loading}
            style={{ padding: '6px 12px', borderRadius: 5, background: 'white', color: '#DC2626', border: '1px solid #F87171', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}
          >
            ✗ Reject
          </button>
        </div>
      </td>
    </tr>
  );
}

function NewRepInlineForm({ defaultName, onCancel, onCreated }: {
  defaultName: string; onCancel: () => void; onCreated: (repId: number) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const fd = new FormData(e.currentTarget);
      const newRepId = await createRepFromApproval(fd);
      onCreated(newRepId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleCreate}>
      <div style={{ padding: 10, background: '#F4F6FB', borderRadius: 7, border: '1px solid #DDE6F5', display: 'flex', flexDirection: 'column', gap: 7 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#1A5CB8', marginBottom: 2 }}>Create New Rep</div>
        <input name="name" required defaultValue={defaultName} placeholder="Full name" style={MINI_INPUT} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <select name="zone" required defaultValue="" style={MINI_INPUT}>
            <option value="">Zone *</option>
            {['North', 'Central', 'West', 'South', 'Export'].map(z => <option key={z} value={z}>{z}</option>)}
          </select>
          <input name="route" placeholder="Route (optional)" style={MINI_INPUT} />
        </div>
        <input name="target_cr" type="number" step="0.5" min="0" placeholder="Annual target (₹ Cr)" style={MINI_INPUT} />
        {error && <div style={{ fontSize: 10, color: '#DC2626' }}>{error}</div>}
        <div style={{ display: 'flex', gap: 5, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onCancel} style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #CBD5E1', background: 'white', cursor: 'pointer', fontSize: 10, fontFamily: 'inherit' }}>Cancel</button>
          <button type="submit" disabled={loading} style={{ padding: '4px 10px', borderRadius: 4, background: '#1A5CB8', color: 'white', border: 'none', cursor: 'pointer', fontSize: 10, fontWeight: 500, fontFamily: 'inherit' }}>
            {loading ? '…' : 'Create Rep'}
          </button>
        </div>
      </div>
    </form>
  );
}

const TD: CSSProperties = { padding: '12px 14px', verticalAlign: 'top' };
const MINI_INPUT: CSSProperties = {
  width: '100%', padding: '5px 7px', border: '1px solid #CBD5E1',
  borderRadius: 4, fontSize: 11, background: 'white', color: '#0D1B2E',
  boxSizing: 'border-box', fontFamily: 'inherit',
};
