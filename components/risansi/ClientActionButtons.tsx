'use client';

import { useState, useEffect, type CSSProperties } from 'react';
import AssignVisitDrawer, { type DrawerRep } from './AssignVisitDrawer';
import { NewOpportunityModal } from './NewOpportunityModal';
import { ClientFormDrawer } from './ClientFormDrawer';
import { Toast } from './Toast';
import { PLAN_VISIT_LABEL } from '@/lib/risansi-utils';

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
  clientData:  any;
  contacts?:   any[];
  canEdit?:    boolean;
  currentUserName?:  string;
  currentUserRepId?: string | number | null;
  currentUserRole?:  string;
}

// ── Component ──────────────────────────────────────────────────

export function ClientActionButtons({
  clientId, clientName, clientCode, industry, repId, repName, reps, clientData, contacts, canEdit = false,
  currentUserName, currentUserRepId, currentUserRole,
}: Props) {
  const [isVisitOpen, setIsVisitOpen] = useState(false);
  const [isOppOpen,  setIsOppOpen]  = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Listen for the open-opp-drawer event (dispatched by PipelineOppBtn)
  useEffect(() => {
    function handleOppOpen()  { setIsOppOpen(true); }
    function handleEditOpen() { setIsEditOpen(true); }
    window.addEventListener(OPEN_OPP_DRAWER,  handleOppOpen);
    window.addEventListener(OPEN_EDIT_DRAWER, handleEditOpen);
    return () => {
      window.removeEventListener(OPEN_OPP_DRAWER,  handleOppOpen);
      window.removeEventListener(OPEN_EDIT_DRAWER, handleEditOpen);
    };
  }, []);

  function handleVisitSuccess() {
    setToast({ message: 'Visit scheduled successfully', type: 'success' });
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <button type="button" onClick={() => setIsVisitOpen(true)} style={BTN}>
          {PLAN_VISIT_LABEL}
        </button>
        <button type="button" onClick={() => setIsOppOpen(true)} style={BTN}>
          New Opportunity
        </button>
        {canEdit && (
          <button type="button" onClick={() => setIsEditOpen(true)} style={{ ...BTN, background: '#0A3D8F', color: '#fff', border: '1px solid #0A3D8F' }}>
            Edit Record
          </button>
        )}
      </div>

      {/* Visit drawer — opened directly via props (client pre-filled & locked),
          rep is locked to themselves when role === 'rep' */}
      <AssignVisitDrawer
        reps={reps}
        hideButton
        controlledOpen={isVisitOpen}
        onClose={() => setIsVisitOpen(false)}
        prefilledClient={{ id: String(clientId), code: clientCode, legal_name: clientName }}
        prefilledRepId={repId}
        lockClient
        onSuccess={handleVisitSuccess}
        role={currentUserRole}
        repId={currentUserRepId}
        currentUserName={currentUserName}
      />

      {/* Opportunity modal — shared with the Opportunities page, client locked here */}
      <NewOpportunityModal
        open={isOppOpen}
        onClose={() => setIsOppOpen(false)}
        lockClient
        clientId={clientId}
        clientName={clientName}
        clientCode={clientCode}
        clientIndustry={industry}
        clientPrimaryRepId={repId ? Number(repId) : null}
        clientPrimaryRepName={repName || null}
        currentUserName={currentUserName ?? ''}
        currentUserRepId={currentUserRepId ?? null}
        currentUserRole={currentUserRole ?? 'rep'}
      />

      {/* Edit client drawer — unified ClientFormDrawer in edit mode */}
      {isEditOpen && (
        <ClientFormDrawer
          mode="edit"
          client={clientData}
          existingContacts={contacts ?? []}
          onClose={() => setIsEditOpen(false)}
        />
      )}

      {toast && (
        <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />
      )}
    </>
  );
}

// ── Tiny button for the pipeline panel "New Opportunity" ─────

export function PipelineOppBtn() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent(OPEN_OPP_DRAWER))}
      style={GHOST_BTN}
    >
      New Opportunity
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
