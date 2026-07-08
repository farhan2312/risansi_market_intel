'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { fmtCr } from '@/lib/risansi-utils';
import { EditOppDrawer, type EditableOpp } from './EditOppDrawer';
import { OppCompletionModal } from './OppCompletionModal';
import { QuotedDetailsModal } from './QuotedDetailsModal';

export interface KanbanOpp extends EditableOpp {
  value_cr:   number;
  probability: number | null;
  eta_text:   string | null;
  rep_name:   string | null;
  can_edit?:  boolean;
}

const STAGES = ['Suspect', 'Prospect', 'Quoted', 'Negotiating', 'Won', 'Lost', 'Dropped'] as const;

const STAGE_COLOR: Record<string, string> = {
  Suspect:     'var(--info)',
  Prospect:    '#5a86c2',
  Quoted:      '#c69347',
  Negotiating: 'var(--accent)',
  Won:         'var(--pos)',
  Lost:        'var(--neg)',
  Dropped:     '#64748B',
};

// Friendlier column headers (timeframe hints / clarifications).
const STAGE_LABEL: Record<string, string> = {
  Suspect:  'Suspect (1-2 years +)',
  Prospect: 'Prospect (6 months +)',
  Dropped:  'Dropped (cancelled by client)',
};

export function OpportunityKanban({ initialOpps }: { initialOpps: KanbanOpp[] }) {
  const router = useRouter();
  const [opps, setOpps]           = useState(initialOpps);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [dragId, setDragId]       = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);
  const [editOpp, setEditOpp]     = useState<KanbanOpp | null>(null);
  const [completion, setCompletion] = useState<{
    opp: KanbanOpp; stage: 'Won' | 'Lost'; previousStage: string;
  } | null>(null);
  const [quotedFor, setQuotedFor] = useState<{ opp: KanbanOpp; previousStage: string } | null>(null);
  const [notice, setNotice]       = useState('');

  // Sync from server when the underlying data actually changes (e.g. after create/edit).
  // Signature keyed on id+stage so optimistic drag state isn't clobbered by unrelated renders.
  const signature = initialOpps.map(o => `${o.id}:${o.stage}`).join('|');
  useEffect(() => {
    setOpps(initialOpps);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const handleDrop = (oppId: string, newStage: string) => {
    const current = opps.find(o => o.id === oppId);
    if (!current || current.stage === newStage) return;
    // Ownership guard (server also enforces). Non-editable cards can't move.
    if (current.can_edit === false) return;

    // Gate: Quoted is a mandatory gateway — a card can't skip to Negotiating / Won /
    // Lost without being Quoted first (so it can never jump straight to Won/Lost).
    if (['Negotiating', 'Won', 'Lost'].includes(newStage) && !['Quoted', 'Negotiating'].includes(current.stage)) {
      setNotice('Move this card through Quoted first.');
      setTimeout(() => setNotice(''), 4000);
      return;
    }

    // Moving to Quoted needs the quotation details — open modal, don't save yet.
    if (newStage === 'Quoted') {
      const previousStage = current.stage;
      setOpps(p => p.map(o => (o.id === oppId ? { ...o, stage: newStage } : o)));
      setQuotedFor({ opp: { ...current, stage: newStage }, previousStage });
      return;
    }

    // Moving to Won/Lost needs completion details — open modal, don't save yet
    if (newStage === 'Won' || newStage === 'Lost') {
      const previousStage = current.stage;
      // Optimistic: move the card into the column visually
      setOpps(p => p.map(o => (o.id === oppId ? { ...o, stage: newStage } : o)));
      setCompletion({ opp: { ...current, stage: newStage }, stage: newStage, previousStage });
      return;
    }

    updateStage(oppId, newStage);
  };

  const updateStage = async (oppId: string, newStage: string) => {
    const prev = opps;
    setOpps(p => p.map(o => (o.id === oppId ? { ...o, stage: newStage } : o)));
    setSaveState('saving');

    try {
      const res = await fetch(`/api/risansi/opportunities/${oppId}/stage`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: newStage }),
      });
      if (!res.ok) throw new Error('failed');
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 2000);
      router.refresh();
    } catch {
      setOpps(prev); // revert
      setSaveState('error');
      setTimeout(() => setSaveState('idle'), 3000);
    }
  };

  const handleCompletionCancel = () => {
    if (!completion) return;
    const { opp, previousStage } = completion;
    setOpps(p => p.map(o => (o.id === opp.id ? { ...o, stage: previousStage } : o)));
    setCompletion(null);
  };

  const handleCompletionSave = () => {
    setCompletion(null);
    router.refresh();
  };

  const handleQuotedCancel = () => {
    if (!quotedFor) return;
    const { opp, previousStage } = quotedFor;
    setOpps(p => p.map(o => (o.id === opp.id ? { ...o, stage: previousStage } : o)));
    setQuotedFor(null);
  };

  const handleQuotedSave = () => {
    setQuotedFor(null);
    router.refresh();
  };

  const byStage: Record<string, KanbanOpp[]> = {};
  for (const s of STAGES) byStage[s] = opps.filter(o => o.stage === s);

  return (
    <div>
      {/* Save indicator */}
      <div style={{ height: 16, textAlign: 'right', marginBottom: 4 }}>
        <span style={{
          fontSize: 11, fontStyle: 'italic',
          color: saveState === 'saved' ? 'var(--pos)' : saveState === 'error' ? 'var(--neg)' : 'var(--fg-3)',
        }}>
          {saveState === 'saving' && 'Saving…'}
          {saveState === 'saved'  && '✓ Saved'}
          {saveState === 'error'  && '⚠ Failed — try again'}
        </span>
      </div>

      <div className="r-kanban" style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 10 }}>
        {STAGES.map(stage => {
          const items = byStage[stage] ?? [];
          const stageTotal = items.reduce((s, o) => s + o.value_cr, 0);
          const color = STAGE_COLOR[stage];
          const isOver = overStage === stage;
          return (
            <div
              key={stage}
              onDragOver={e => { e.preventDefault(); setOverStage(stage); }}
              onDragLeave={() => setOverStage(s => (s === stage ? null : s))}
              onDrop={e => {
                e.preventDefault();
                setOverStage(null);
                if (dragId) handleDrop(dragId, stage);
                setDragId(null);
              }}
              style={{
                background: isOver ? 'var(--bg-elev)' : 'var(--bg-paper)',
                border: isOver ? '1px dashed var(--accent)' : '1px solid var(--line)',
                borderRadius: 6, display: 'flex', flexDirection: 'column',
                transition: 'background 120ms, border-color 120ms',
              }}
            >
              <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 11, fontWeight: 500, color, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {STAGE_LABEL[stage] ?? stage}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
                    {items.length}
                  </span>
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--fg)', marginTop: 4 }}>
                  {stageTotal > 0 ? fmtCr(stageTotal) : '—'}
                </div>
              </div>
              {/* Cards scroll within each column so a huge column (e.g. Quoted) stays
                  usable instead of ballooning the whole board. Header/total stay fixed. */}
              <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minHeight: 60, maxHeight: '68vh', overflowY: 'auto' }}>
                {items.map(opp => {
                  const isWon  = opp.stage === 'Won';
                  const isLost = opp.stage === 'Lost';
                  const canEdit = opp.can_edit !== false;
                  const canDrag = canEdit && !isWon && !isLost;
                  return (
                  <div
                    key={opp.id}
                    draggable={canDrag}
                    onDragStart={() => { if (canDrag) setDragId(opp.id); }}
                    onDragEnd={() => { setDragId(null); setOverStage(null); }}
                    onClick={() => setEditOpp(opp)}
                    style={{
                      position: 'relative',
                      background: isWon ? 'var(--won-bg)' : isLost ? 'var(--bg-sunk)' : 'var(--bg-elev)',
                      border: '1px solid var(--line)',
                      borderLeft: `3px solid ${isWon ? '#0E9F6E' : isLost ? '#9CA3AF' : STAGE_COLOR[opp.stage] ?? 'var(--line)'}`,
                      borderRadius: 4, padding: 10, cursor: 'pointer',
                      opacity: dragId === opp.id ? 0.4 : !canEdit ? 0.85 : isLost ? 0.75 : 1,
                    }}
                  >
                    {!canEdit && !isWon && !isLost && (
                      <div
                        title="View only — assigned to another rep"
                        style={{ position: 'absolute', top: 6, right: 6, fontSize: 11, color: 'var(--fg-3)', opacity: 0.6 }}
                      >
                        👁
                      </div>
                    )}
                    <div style={{ fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', display: 'flex', justifyContent: 'space-between', gap: 6, marginBottom: 4 }}>
                      <span style={{ flexShrink: 0 }}>{opp.client_code}</span>
                      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }}>{opp.rep_name || '—'}</span>
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 500, lineHeight: 1.3, marginBottom: 4, color: 'var(--fg)', overflowWrap: 'anywhere' }}>{opp.client_name}</div>
                    <div style={{ fontSize: 11, color: 'var(--fg-2)', marginBottom: 6, lineHeight: 1.35, overflowWrap: 'anywhere' }}>{opp.product}</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: 'var(--brand-blue)' }}>
                        {opp.value_cr ? `₹${(opp.value_cr * 100).toFixed(1)}L` : '—'}
                      </span>
                      <span style={{ fontSize: 10, color: 'var(--fg-3)' }}>
                        {opp.probability != null ? `${opp.probability}%` : ''}
                        {opp.eta_text ? ` · ${opp.eta_text}` : ''}
                      </span>
                    </div>
                    {isWon && (
                      <div style={{ marginTop: 6, fontSize: 10, color: 'var(--pos)' }}>
                        🎉 Won
                        {opp.final_value_cr ? ` · ₹${(parseFloat(String(opp.final_value_cr)) * 100).toFixed(1)}L` : ''}
                        {opp.po_number ? ` · ${opp.po_number}` : ''}
                      </div>
                    )}
                    {isLost && (
                      <div style={{ marginTop: 6, fontSize: 10, color: 'var(--neg)' }}>
                        ❌ Lost{opp.lost_to_competitor ? ` · ${opp.lost_to_competitor}` : ''}
                      </div>
                    )}
                    {!isWon && !isLost && opp.auto_created && (
                      <div style={{ marginTop: 5, display: 'inline-block', fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: 4, background: 'var(--accent-soft)', color: 'var(--brand-blue)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        ⚡ Auto
                      </div>
                    )}
                  </div>
                  );
                })}
                {items.length === 0 && (
                  <div style={{ fontSize: 10, color: 'var(--fg-3)', textAlign: 'center', padding: 20 }}>
                    {isOver ? 'Drop here' : 'No opps'}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {editOpp && <EditOppDrawer opp={editOpp} canEdit={editOpp.can_edit !== false} onClose={() => setEditOpp(null)} />}

      {completion && (
        <OppCompletionModal
          opp={completion.opp}
          stage={completion.stage}
          onSave={handleCompletionSave}
          onCancel={handleCompletionCancel}
        />
      )}

      {quotedFor && (
        <QuotedDetailsModal
          opp={quotedFor.opp}
          onSave={handleQuotedSave}
          onCancel={handleQuotedCancel}
        />
      )}

      {notice && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 500,
          padding: '10px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500,
          background: 'var(--warn-soft)', color: 'var(--warn)', border: '1px solid var(--warn)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
        }}>
          {notice}
        </div>
      )}
    </div>
  );
}
