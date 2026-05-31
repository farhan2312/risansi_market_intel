'use client';

import { useState, useEffect, type CSSProperties } from 'react';
import AssignVisitDrawer, { OPEN_VISIT_DRAWER, type DrawerRep } from './AssignVisitDrawer';
import { NewOpportunityDrawer } from './NewOpportunityDrawer';
import { EditClientDrawer, type ClientForEdit } from './EditClientDrawer';
import { AddContactDrawer, OPEN_ADD_CONTACT_DRAWER } from './AddContactDrawer';
import { Toast } from './Toast';

// ── Event names ────────────────────────────────────────────────

export const OPEN_OPP_DRAWER     = 'risansi:open-opp-drawer';
export const OPEN_EDIT_DRAWER    = 'risansi:open-edit-drawer';

// ── External trigger button (pencil) for edit drawer ───────────

export function EditDrawerTrigger({ label = '✎', style }: { label?: string; style?: CSSProperties }) {
  return (
    <button
      type="button"
      title="Edit client details"
      onClick={() => window.dispatchEvent(new CustomEvent(OPEN_EDIT_DRAWER))}
      style={style ?? PENCIL_BTN}
    >
      {label}
    </button>
  );
}

// ── Props ──────────────────────────────────────────────────────

interface Props {
  clientId:    string;
  clientName:  string;
  clientCode:  string;
  industry:    string;
  repId:       string | null;
  repName:     string;
  reps:        DrawerRep[];
  clientData:  ClientForEdit;
}

// ── Component ──────────────────────────────────────────────────

export function ClientActionButtons({
  clientId, clientName, clientCode, industry, repId, repName, reps, clientData,
}: Props) {
  const [isOppOpen,     setIsOppOpen]     = useState(false);
  const [isEditOpen,    setIsEditOpen]    = useState(false);
  const [isContactOpen, setIsContactOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Listen for the open-opp-drawer event (dispatched by PipelineOppBtn)
  useEffect(() => {
    function handleOppOpen()     { setIsOppOpen(true); }
    function handleEditOpen()    { setIsEditOpen(true); }
    function handleContactOpen() { setIsContactOpen(true); }
    window.addEventListener(OPEN_OPP_DRAWER,           handleOppOpen);
    window.addEventListener(OPEN_EDIT_DRAWER,          handleEditOpen);
    window.addEventListener(OPEN_ADD_CONTACT_DRAWER,   handleContactOpen);
    return () => {
      window.removeEventListener(OPEN_OPP_DRAWER,          handleOppOpen);
      window.removeEventListener(OPEN_EDIT_DRAWER,         handleEditOpen);
      window.removeEventListener(OPEN_ADD_CONTACT_DRAWER,  handleContactOpen);
    };
  }, []);

  function openPlanVisit() {
    window.dispatchEvent(new CustomEvent(OPEN_VISIT_DRAWER, {
      detail: { clientId, clientName, clientCode, repId: repId ?? undefined, lockClient: true },
    }));
  }

  function handleVisitSuccess() {
    setToast({ message: 'Visit scheduled successfully', type: 'success' });
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <button type="button" onClick={openPlanVisit} style={BTN}>
          Plan Visit
        </button>
        <button type="button" onClick={() => setIsOppOpen(true)} style={BTN}>
          + New Opportunity
        </button>
        <button type="button" onClick={() => setIsEditOpen(true)} style={{ ...BTN, background: '#0A3D8F', color: '#fff', border: '1px solid #0A3D8F' }}>
          Edit Record
        </button>
      </div>

      {/* Visit drawer */}
      <AssignVisitDrawer reps={reps} hideButton onSuccess={handleVisitSuccess} />

      {/* Opportunity drawer */}
      {isOppOpen && (
        <NewOpportunityDrawer
          clientId={clientId}
          clientName={clientName}
          clientCode={clientCode}
          industry={industry}
          onClose={() => setIsOppOpen(false)}
        />
      )}

      {/* Edit client drawer */}
      <EditClientDrawer
        client={clientData}
        open={isEditOpen}
        onClose={() => setIsEditOpen(false)}
      />

      {/* Add contact drawer */}
      <AddContactDrawer
        clientId={clientId}
        clientCode={clientCode}
        open={isContactOpen}
        onClose={() => setIsContactOpen(false)}
      />

      {toast && (
        <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />
      )}
    </>
  );
}

// ── Tiny button for the pipeline panel "+ New Opportunity" ─────

export function PipelineOppBtn() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent(OPEN_OPP_DRAWER))}
      style={GHOST_BTN}
    >
      + New Opportunity
    </button>
  );
}

// ── Styles ─────────────────────────────────────────────────────

const BTN: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  padding: '6px 11px', fontSize: 12, fontFamily: 'inherit',
  fontWeight: 500, background: 'var(--bg-paper, #fff)',
  border: '1px solid #CBD5E1', color: 'var(--fg, #0D1B2A)',
  borderRadius: 5, cursor: 'pointer',
};

const GHOST_BTN: CSSProperties = {
  display: 'inline-flex', alignItems: 'center',
  padding: '3px 8px', fontSize: 11, fontFamily: 'inherit',
  fontWeight: 500, background: 'transparent',
  border: '1px solid #CBD5E1', color: '#1A5CB8',
  borderRadius: 5, cursor: 'pointer',
};

const PENCIL_BTN: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 22, height: 22,
  background: 'transparent', border: '1px solid var(--line, #CBD5E1)',
  color: 'var(--fg-3, #6B7FA3)', borderRadius: 4,
  cursor: 'pointer', fontSize: 12,
};
