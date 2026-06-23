'use client';

import { useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { ComplaintFormModal, type UserOpt } from './ComplaintFormModal';

// Drop-in "raise a complaint for this client" launcher. Used from the visit
// forms and Client 360. Fetches the assignable-users list on first open.
export function LogComplaintButton({ clientId, clientName, style, label = '⚠ Log Complaint' }: {
  clientId: number; clientName: string; style?: CSSProperties; label?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState<UserOpt[] | null>(null);

  function launch() {
    setOpen(true);
    if (!users) {
      fetch('/api/risansi/assignable-users').then(r => r.ok ? r.json() : []).then(setUsers).catch(() => setUsers([]));
    }
  }

  return (
    <>
      <button type="button" onClick={launch} style={{ ...BTN, ...style }}>{label}</button>
      {open && (
        <ComplaintFormModal
          fixedClient={{ id: clientId, name: clientName }}
          users={users ?? []}
          onClose={() => setOpen(false)}
          onSaved={() => { setOpen(false); router.refresh(); }}
        />
      )}
    </>
  );
}

const BTN: CSSProperties = {
  padding: '8px 14px', fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
  background: 'var(--bg-paper)', color: 'var(--neg)', border: '1px solid rgba(220,38,38,0.35)',
  borderRadius: 6, cursor: 'pointer',
};
