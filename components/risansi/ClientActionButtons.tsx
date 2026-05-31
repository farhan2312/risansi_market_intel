'use client';

import { useState, useEffect, type CSSProperties } from 'react';
import AssignVisitDrawer, { OPEN_VISIT_DRAWER, type DrawerRep } from './AssignVisitDrawer';
import { NewOpportunityDrawer } from './NewOpportunityDrawer';
import { Toast } from './Toast';

// ── Event name used by the pipeline "+ New Opportunity" button ─

export const OPEN_OPP_DRAWER = 'risansi:open-opp-drawer';

// ── Props ──────────────────────────────────────────────────────

interface Props {
  clientId:    string;
  clientName:  string;
  clientCode:  string;
  industry:    string;
  repId:       string | null;
  repName:     string;
  reps:        DrawerRep[];
}

// ── Component ──────────────────────────────────────────────────

export function ClientActionButtons({
  clientId, clientName, clientCode, industry, repId, repName, reps,
}: Props) {
  const [isOppOpen, setIsOppOpen]   = useState(false);
  const [toast, setToast]           = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Listen for the open-opp-drawer event (dispatched by PipelineOppBtn)
  useEffect(() => {
    function handleOppOpen() { setIsOppOpen(true); }
    window.addEventListener(OPEN_OPP_DRAWER, handleOppOpen);
    return () => window.removeEventListener(OPEN_OPP_DRAWER, handleOppOpen);
  }, []);

  function openPlanVisit() {
    window.dispatchEvent(new CustomEvent(OPEN_VISIT_DRAWER, {
      detail: {
        clientId,
        clientName,
        clientCode,
        repId: repId ?? undefined,
        lockClient: true,
      },
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
      </div>

      {/* Visit drawer — hidden button variant, listens for event */}
      <AssignVisitDrawer
        reps={reps}
        hideButton
        onSuccess={handleVisitSuccess}
      />

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

      {/* Toast */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onDismiss={() => setToast(null)}
        />
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
