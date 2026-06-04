'use client';

import { useState, type CSSProperties } from 'react';
import { NewOpportunityModal } from './NewOpportunityModal';

export function NewOpportunityButton({ currentUserName, currentUserRepId, currentUserRole }: {
  currentUserName: string;
  currentUserRepId: string | number | null;
  currentUserRole: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} style={TRIGGER_BTN}>
        New Opportunity
      </button>
      <NewOpportunityModal
        open={open}
        onClose={() => setOpen(false)}
        currentUserName={currentUserName}
        currentUserRepId={currentUserRepId}
        currentUserRole={currentUserRole}
      />
    </>
  );
}

const TRIGGER_BTN: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px',
  background: '#0A3D8F', color: 'white', border: 'none', borderRadius: 7,
  fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
};
