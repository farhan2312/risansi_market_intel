'use client';

import { useState, useRef, useCallback, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { saveVisitField, checkInVisit, addEquipment } from '@/app/actions/risansi-visits';
import { FormErrorBoundary } from './FormErrorBoundary';

// ── Types ──────────────────────────────────────────────────────

interface VisitData {
  id: string; client_id: string; rep_id: string | null;
  visit_date: string;
  check_in_time: string | null; check_in_lat: number | null;
  check_in_lng: number | null; check_in_accuracy_m: number | null;
  gps_within_radius: boolean | null; manual_checkin: boolean | null;
  purpose: string | null; outcome: string | null; summary: string | null;
  industry_format: string | null; is_unplanned: boolean | null;
  unplanned_reason: string | null;
  competitor_activity_observed: boolean | null;
  sample_or_gift_given: boolean | null; sample_gift_detail: string | null;
  sample_gift_value: number | null; follow_up_required: boolean | null;
  follow_up_text: string | null; follow_up_due_date: string | null;
  next_visit_recommendation: string | null;
  performance_feedback: string | null; pcp_competitor: string | null;
  mgmt_intervention: string | null; action_points: string | null;
  open_remarks: string | null; status: string; submitted_at: string | null;
  legal_name: string; code: string; industry: string | null;
  is_sugar: boolean; city: string | null;
}

interface Contact {
  id: number; name: string; designation: string | null;
  phone: string | null; is_primary: boolean;
}

// ── Props ──────────────────────────────────────────────────────

interface Props {
  visit:          VisitData;
  contacts:       Contact[];
  equipment:      Record<string, unknown>[];
  sugarReport:    Record<string, unknown> | null;
  nonsugarReport: Record<string, unknown> | null;
  opportunities:  Record<string, unknown>[];
  tasks:          Record<string, unknown>[];
  isClosed:       boolean;
  isSugar:        boolean;
}

// ── Auto-save hook ─────────────────────────────────────────────

function useAutoSave(visitId: string) {
  const [saveState, setSaveState] = useState<'idle' | 'pending' | 'saving' | 'saved' | 'error'>('idle');
  const saveTimer  = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending    = useRef<Record<string, unknown>>({});

  const queueSave = useCallback((field: string, value: unknown) => {
    pending.current[field] = value;
    setSaveState('pending');
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaveState('saving');
      try {
        await saveVisitField(visitId, pending.current);
        pending.current = {};
        setSaveState('saved');
        setTimeout(() => setSaveState('idle'), 3000);
      } catch {
        setSaveState('error');
      }
    }, 5000);
  }, [visitId]);

  return { saveState, queueSave };
}

// ── Main Component ─────────────────────────────────────────────

export function VisitReportForm({
  visit, contacts, equipment, sugarReport, nonsugarReport,
  opportunities, tasks, isClosed, isSugar: initialIsSugar,
}: Props) {
  const { saveState, queueSave } = useAutoSave(visit.id);
  const router = useRouter();

  // Local state for conditional fields
  const [isSugar, setIsSugar]         = useState(initialIsSugar);
  const [purpose, setPurpose]         = useState(visit.purpose ?? '');
  const [outcome, setOutcome]         = useState(visit.outcome ?? '');
  const [isUnplanned, setIsUnplanned] = useState(!!visit.is_unplanned);
  const [sampleGiven, setSampleGiven] = useState(!!visit.sample_or_gift_given);
  const [followUp, setFollowUp]       = useState(!!visit.follow_up_required);
  const [compActivity, setCompActivity] = useState(!!visit.competitor_activity_observed);

  // Sugar-specific state
  const [hasExpansion, setHasExpansion]   = useState(!!(sugarReport?.has_expansion));
  const [hasComplaints, setHasComplaints] = useState(!!(sugarReport?.has_complaints));

  // Equipment
  const [eqTab, setEqTab]   = useState<'ril' | 'competitor'>('ril');
  const [showEqForm, setShowEqForm] = useState(false);
  const [newEq, setNewEq] = useState({
    pump_type: 'PCP', supplier: '', model: '', qty: 1,
    application: '', condition: 'Good', is_ril: true,
    reason_for_competitor: '', competitor_activity_type: '',
    performance_feedback: '',
  });

  const disabled = isClosed;

  // Derived preview data
  const rilEquipment  = equipment.filter(e => e.is_ril);
  const compEquipment = equipment.filter(e => !e.is_ril);
  const dispOpps      = equipment.filter(e => e.is_opportunity);
  const willPreview   = hasExpansion || followUp || dispOpps.length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* Auto-save indicator */}
      <div style={{ textAlign: 'right', height: 16 }}>
        <span style={{
          fontSize: 11, fontStyle: 'italic',
          color: saveState === 'saved' ? '#059669' : saveState === 'error' ? '#DC2626' : '#9CA3AF',
          transition: 'color 300ms',
        }}>
          {saveState === 'saving' && 'Saving…'}
          {saveState === 'saved'  && '✓ Saved'}
          {saveState === 'error'  && '⚠ Save failed — check connection'}
        </span>
      </div>

      {/* ── SECTION 1: Check In ────────────────────────────── */}
      <FormSection title="Check In" icon="📍">
        {visit.check_in_time ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: 'var(--pos-soft)', borderRadius: 8, fontSize: 13 }}>
            <span>✓</span>
            <div>
              <div style={{ fontWeight: 600 }}>
                Checked in at {new Date(visit.check_in_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
              </div>
              {visit.check_in_lat != null && visit.check_in_lng != null && (
                <div style={{ fontSize: 11, color: 'var(--pos)' }}>
                  {/* numeric columns arrive as strings from pg — coerce before toFixed */}
                  GPS: {Number(visit.check_in_lat).toFixed(4)}, {Number(visit.check_in_lng).toFixed(4)}
                  {visit.check_in_accuracy_m != null && ` · ±${Math.round(Number(visit.check_in_accuracy_m))}m`}
                  {' · '}
                  <a
                    href={`https://www.google.com/maps?q=${visit.check_in_lat},${visit.check_in_lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: 'var(--pos)', textDecoration: 'underline', cursor: 'pointer' }}
                  >
                    📍 View location
                  </a>
                </div>
              )}
              {visit.manual_checkin && (
                <div style={{ fontSize: 11, color: 'var(--warn)' }}>Manual check-in recorded</div>
              )}
            </div>
          </div>
        ) : !disabled ? (
          <FormErrorBoundary>
            <CheckInButton visitId={visit.id} onDone={() => router.refresh()} />
          </FormErrorBoundary>
        ) : (
          <div style={{ fontSize: 13, color: 'var(--fg-3)', padding: '8px 0' }}>No check-in recorded</div>
        )}
      </FormSection>

      {/* ── SECTION 2: Visit Details ───────────────────────── */}
      <FormSection title="Visit Details" icon="📋">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label style={LBL}>Purpose</label>
            <select
              value={purpose} disabled={disabled}
              onChange={e => { setPurpose(e.target.value); queueSave('purpose', e.target.value); }}
              style={INP}
            >
              <option value="">— Select —</option>
              {['Routine','Quote Follow-up','Complaint Resolution','New Opportunity','Equipment Assessment','Management Relationship Visit'].map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={LBL}>Outcome</label>
            <select
              value={outcome} disabled={disabled}
              onChange={e => { setOutcome(e.target.value); queueSave('outcome', e.target.value); }}
              style={INP}
            >
              <option value="">— Select —</option>
              {['Very Positive','Positive','Neutral','Needs Attention','Escalation Required'].map(o => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Industry format toggle */}
        <div style={{ marginBottom: 12 }}>
          <label style={LBL}>Industry Format</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {[['sugar', 'Sugar'], ['non-sugar', 'Non-Sugar']].map(([val, label]) => (
              <button
                key={val}
                disabled={disabled}
                onClick={() => {
                  setIsSugar(val === 'sugar');
                  queueSave('industry_format', val);
                }}
                style={{
                  padding: '6px 16px', borderRadius: 6, fontSize: 13,
                  fontFamily: 'inherit', cursor: disabled ? 'default' : 'pointer',
                  border: (isSugar ? 'sugar' : 'non-sugar') === val ? '2px solid var(--toggle-sel-border)' : '1px solid var(--line-strong)',
                  background: (isSugar ? 'sugar' : 'non-sugar') === val ? 'var(--toggle-sel-bg)' : 'var(--bg-paper)',
                  color: (isSugar ? 'sugar' : 'non-sugar') === val ? 'var(--toggle-sel-fg)' : 'var(--fg-3)',
                  fontWeight: (isSugar ? 'sugar' : 'non-sugar') === val ? 600 : 400,
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Unplanned */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: disabled ? 'default' : 'pointer', marginBottom: 8 }}>
          <input
            type="checkbox" checked={isUnplanned} disabled={disabled}
            onChange={e => { setIsUnplanned(e.target.checked); queueSave('is_unplanned', e.target.checked); }}
            style={{ width: 14, height: 14 }}
          />
          <span style={{ fontSize: 13 }}>Unplanned visit</span>
        </label>
        {isUnplanned && (
          <div style={{ marginBottom: 8 }}>
            <label style={LBL}>Reason for unplanned visit</label>
            <input
              type="text"
              defaultValue={visit.unplanned_reason ?? ''}
              disabled={disabled}
              onChange={e => queueSave('unplanned_reason', e.target.value)}
              style={INP}
              placeholder="e.g. Client called urgently"
            />
          </div>
        )}

        {/* Contacts */}
        {contacts.length > 0 && (
          <div>
            <label style={LBL}>Contacts Met</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {contacts.map(c => (
                <div key={c.id} style={{
                  padding: '5px 10px', borderRadius: 20, fontSize: 12,
                  border: '1px solid var(--line-strong)', background: 'var(--bg-elev)',
                  color: 'var(--fg-2)',
                }}>
                  {c.name}{c.designation ? ` · ${c.designation}` : ''}
                  {c.is_primary && <span style={{ marginLeft: 4, color: '#0A3D8F', fontSize: 10, fontWeight: 600 }}>PRIMARY</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </FormSection>

      {/* ── SECTION 3: Sugar Form ──────────────────────────── */}
      {isSugar && (
        <FormSection title="Sugar Industry Report" icon="🍬" defaultOpen={false}>
          <SugarSection
            report={sugarReport}
            visitId={visit.id}
            disabled={disabled}
            queueSave={queueSave}
            hasExpansion={hasExpansion}
            setHasExpansion={setHasExpansion}
            hasComplaints={hasComplaints}
            setHasComplaints={setHasComplaints}
          />
        </FormSection>
      )}

      {/* ── SECTION 4: Non-Sugar Form ──────────────────────── */}
      {!isSugar && (
        <FormSection title="Non-Sugar Report" icon="🏭" defaultOpen={false}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={LBL}>Deal In (products)</label>
              <input
                type="text"
                defaultValue={String(nonsugarReport?.deal_in ?? '')}
                disabled={disabled}
                onChange={e => queueSave('deal_in', e.target.value)}
                style={INP}
                placeholder="e.g. PCP, MMP, Spares"
              />
            </div>
            <div>
              <label style={LBL}>Valves / Equipment Observed</label>
              <textarea
                defaultValue={String(nonsugarReport?.valves_observed_notes ?? '')}
                disabled={disabled}
                onChange={e => queueSave('valves_observed_notes', e.target.value)}
                rows={3}
                style={{ ...INP, height: 'auto', resize: 'vertical', lineHeight: 1.5 }}
                placeholder="Notes on valves and equipment observed…"
              />
            </div>
          </div>
        </FormSection>
      )}

      {/* ── SECTION 5: Equipment Assessment ───────────────── */}
      <FormSection title="Equipment Assessment" icon="⚙️" defaultOpen={false}>
        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--line)', marginBottom: 12 }}>
          {[['ril', 'RIL Equipment'], ['competitor', 'Competitor Equipment']].map(([id, label]) => (
            <button
              key={id}
              onClick={() => { setEqTab(id as 'ril' | 'competitor'); setShowEqForm(false); }}
              style={{
                padding: '7px 16px', border: 'none', background: 'none',
                fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
                fontWeight: eqTab === id ? 600 : 400,
                color: eqTab === id ? '#0A3D8F' : 'var(--fg-3)',
                borderBottom: eqTab === id ? '2px solid #0A3D8F' : '2px solid transparent',
                marginBottom: -1,
              }}
            >
              {label}
              {id === 'ril' && rilEquipment.length > 0 && (
                <span style={{ marginLeft: 6, fontSize: 10, background: '#EBF1FB', color: '#0A3D8F', padding: '1px 5px', borderRadius: 8 }}>
                  {rilEquipment.length}
                </span>
              )}
              {id === 'competitor' && compEquipment.length > 0 && (
                <span style={{ marginLeft: 6, fontSize: 10, background: '#FEE2E2', color: '#991B1B', padding: '1px 5px', borderRadius: 8 }}>
                  {compEquipment.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Equipment list */}
        {(eqTab === 'ril' ? rilEquipment : compEquipment).length === 0 ? (
          <div style={{ textAlign: 'center', padding: '16px', color: 'var(--fg-3)', fontSize: 13 }}>
            No {eqTab === 'ril' ? 'RIL' : 'competitor'} equipment recorded
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 12 }}>
            <thead>
              <tr style={{ background: 'var(--bg-elev)' }}>
                {['Type', 'Supplier/Model', 'Application', 'Qty', 'Condition', eqTab === 'ril' ? 'Feedback' : 'Reason'].map(h => (
                  <th key={h} style={{ padding: '7px 10px', textAlign: 'left', fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--fg-3)', borderBottom: '1px solid var(--line)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(eqTab === 'ril' ? rilEquipment : compEquipment).map((e, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--line)' }}>
                  <td style={{ padding: '8px 10px' }}>{String(e.pump_type ?? '—')}</td>
                  <td style={{ padding: '8px 10px' }}>{String(e.supplier ?? '')} {String(e.model ?? '')}</td>
                  <td style={{ padding: '8px 10px', color: 'var(--fg-3)' }}>{String(e.application ?? '—')}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'center' }}>{String(e.qty ?? 1)}</td>
                  <td style={{ padding: '8px 10px' }}>
                    <span style={{
                      fontSize: 11, padding: '2px 6px', borderRadius: 4,
                      background: e.condition === 'EOL' ? '#FEE2E2' : e.condition === 'Good' ? '#D1FAE5' : '#FEF3C7',
                      color: e.condition === 'EOL' ? '#991B1B' : e.condition === 'Good' ? '#065F46' : '#92400E',
                    }}>
                      {String(e.condition ?? '—')}
                    </span>
                    {Boolean(e.is_opportunity) && <span style={{ marginLeft: 4, fontSize: 10, color: '#7C3AED' }}>⚡ Opp</span>}
                  </td>
                  <td style={{ padding: '8px 10px', color: 'var(--fg-3)', fontSize: 11 }}>
                    {eqTab === 'ril' ? String(e.performance_feedback ?? '—') : String(e.reason_for_competitor ?? '—')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Add equipment form */}
        {!disabled && !showEqForm && (
          <button
            onClick={() => { setShowEqForm(true); setNewEq(prev => ({ ...prev, is_ril: eqTab === 'ril', supplier: eqTab === 'ril' ? 'RIL' : '' })); }}
            style={{ fontSize: 12, color: '#0A3D8F', background: 'none', border: '1px dashed #0A3D8F', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            + Add {eqTab === 'ril' ? 'RIL' : 'Competitor'} Equipment
          </button>
        )}

        {showEqForm && !disabled && (
          <div style={{ padding: 14, background: 'var(--bg-elev)', borderRadius: 8, border: '1px solid var(--line)', marginTop: 8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 10 }}>
              <div>
                <label style={LBL}>Pump Type</label>
                <select value={newEq.pump_type} onChange={e => setNewEq(p => ({ ...p, pump_type: e.target.value }))} style={INP}>
                  {['PCP', 'MMP', 'Rota', 'Centrifugal', 'Other'].map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              {eqTab === 'competitor' && (
                <div>
                  <label style={LBL}>Supplier / Make</label>
                  <input type="text" value={newEq.supplier} onChange={e => setNewEq(p => ({ ...p, supplier: e.target.value }))} style={INP} placeholder="e.g. Netzsch" />
                </div>
              )}
              <div>
                <label style={LBL}>Model</label>
                <input type="text" value={newEq.model} onChange={e => setNewEq(p => ({ ...p, model: e.target.value }))} style={INP} />
              </div>
              <div>
                <label style={LBL}>Application</label>
                <input type="text" value={newEq.application} onChange={e => setNewEq(p => ({ ...p, application: e.target.value }))} style={INP} />
              </div>
              <div>
                <label style={LBL}>Qty</label>
                <input type="number" min={1} value={newEq.qty} onChange={e => setNewEq(p => ({ ...p, qty: parseInt(e.target.value) || 1 }))} style={INP} />
              </div>
              <div>
                <label style={LBL}>Condition</label>
                <select value={newEq.condition} onChange={e => setNewEq(p => ({ ...p, condition: e.target.value }))} style={INP}>
                  {['Good', 'Requires Maintenance', 'EOL'].map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
            </div>

            {newEq.condition === 'EOL' && eqTab === 'competitor' && (
              <div style={{ padding: '8px 12px', background: '#EDE9FE', borderRadius: 6, fontSize: 12, color: '#5B21B6', marginBottom: 10 }}>
                ⚡ EOL detected — a displacement opportunity will be flagged on submit
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={async () => {
                  await addEquipment(visit.id, visit.client_id, { ...newEq });
                  setShowEqForm(false);
                  setNewEq({ pump_type: 'PCP', supplier: '', model: '', qty: 1, application: '', condition: 'Good', is_ril: true, reason_for_competitor: '', competitor_activity_type: '', performance_feedback: '' });
                }}
                style={{ padding: '7px 14px', background: '#0A3D8F', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}
              >
                Save Equipment
              </button>
              <button
                onClick={() => setShowEqForm(false)}
                style={{ padding: '7px 14px', background: 'none', border: '1px solid var(--line-strong)', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </FormSection>

      {/* ── SECTION 6: Visit Summary ───────────────────────── */}
      <FormSection title="Visit Summary" icon="📝">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div>
              <label style={LBL}>Performance Feedback</label>
              <select defaultValue={visit.performance_feedback ?? ''} disabled={disabled} onChange={e => queueSave('performance_feedback', e.target.value)} style={{ ...INP, appearance: 'none' }}>
                <option value="">—</option>
                {['Good', 'Average', 'Poor'].map(f => <option key={f}>{f}</option>)}
              </select>
            </div>
            <div>
              <label style={LBL}>Mgmt Intervention</label>
              <select defaultValue={visit.mgmt_intervention ?? ''} disabled={disabled} onChange={e => queueSave('mgmt_intervention', e.target.value)} style={{ ...INP, appearance: 'none' }}>
                <option value="">—</option>
                {['YES', 'NO', 'NIL'].map(m => <option key={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label style={LBL}>PCP Competitor</label>
              <input type="text" defaultValue={visit.pcp_competitor ?? ''} disabled={disabled} onChange={e => queueSave('pcp_competitor', e.target.value)} style={INP} />
            </div>
          </div>

          {/* Boolean flags */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <CheckboxField
              label="Competitor activity observed?"
              checked={compActivity}
              disabled={disabled}
              onChange={v => { setCompActivity(v); queueSave('competitor_activity_observed', v); }}
            />
            <CheckboxField
              label="Sample / gift given?"
              checked={sampleGiven}
              disabled={disabled}
              onChange={v => { setSampleGiven(v); queueSave('sample_or_gift_given', v); }}
            />
            {sampleGiven && (
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10, paddingLeft: 22 }}>
                <div>
                  <label style={LBL}>Sample/Gift Detail</label>
                  <input type="text" defaultValue={visit.sample_gift_detail ?? ''} disabled={disabled} onChange={e => queueSave('sample_gift_detail', e.target.value)} style={INP} />
                </div>
                <div>
                  <label style={LBL}>Value (₹)</label>
                  <input type="number" defaultValue={visit.sample_gift_value ?? ''} disabled={disabled} onChange={e => queueSave('sample_gift_value', e.target.value)} style={INP} />
                </div>
              </div>
            )}
            <CheckboxField
              label="Follow-up required?"
              checked={followUp}
              disabled={disabled}
              onChange={v => { setFollowUp(v); queueSave('follow_up_required', v); }}
            />
            {followUp && (
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10, paddingLeft: 22 }}>
                <div>
                  <label style={LBL}>Follow-up details</label>
                  <input type="text" defaultValue={visit.follow_up_text ?? ''} disabled={disabled} onChange={e => queueSave('follow_up_text', e.target.value)} style={INP} placeholder="What needs to be done?" />
                </div>
                <div>
                  <label style={LBL}>Due date</label>
                  <input type="date" defaultValue={visit.follow_up_due_date ?? ''} disabled={disabled} onChange={e => queueSave('follow_up_due_date', e.target.value)} style={INP} />
                </div>
              </div>
            )}
          </div>

          {/* Next visit */}
          <div>
            <label style={LBL}>Next Visit Recommendation</label>
            <input type="date" defaultValue={visit.next_visit_recommendation ?? ''} disabled={disabled} onChange={e => queueSave('next_visit_recommendation', e.target.value)} style={{ ...INP, maxWidth: 200 }} />
          </div>

          {/* Summary text */}
          <div>
            <label style={LBL}>Visit Summary *</label>
            <SummaryTextarea
              defaultValue={visit.summary ?? ''}
              disabled={disabled}
              onSave={(v) => queueSave('summary', v)}
              maxLength={1000}
            />
          </div>

          <div>
            <label style={LBL}>Action Points</label>
            <textarea defaultValue={visit.action_points ?? ''} disabled={disabled} onChange={e => queueSave('action_points', e.target.value)} rows={3} style={{ ...INP, height: 'auto', resize: 'vertical', lineHeight: 1.5 }} />
          </div>

          <div>
            <label style={LBL}>Open Remarks</label>
            <textarea defaultValue={visit.open_remarks ?? ''} disabled={disabled} onChange={e => queueSave('open_remarks', e.target.value)} rows={2} style={{ ...INP, height: 'auto', resize: 'vertical', lineHeight: 1.5 }} />
          </div>
        </div>
      </FormSection>

      {/* ── SECTION 7: Preview (before submit) ────────────── */}
      {!isClosed && willPreview && (
        <div style={{
          border: '1px solid #1A5CB8', borderRadius: 8, padding: 16,
          background: '#EBF1FB',
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#0A3D8F', marginBottom: 10 }}>
            On Submit, the following will be created:
          </div>
          {hasExpansion && (
            <div style={{ fontSize: 12, marginBottom: 6 }}>
              🎯 Opportunity from expansion plan (Suspect stage, auto-created)
            </div>
          )}
          {followUp && (
            <div style={{ fontSize: 12, marginBottom: 6 }}>
              ✅ Follow-up task for {visit.legal_name}
              {visit.follow_up_due_date ? ` · due ${visit.follow_up_due_date}` : ''}
            </div>
          )}
          {dispOpps.length > 0 && (
            <div style={{ fontSize: 12, marginBottom: 6 }}>
              ⚡ {dispOpps.length} displacement opportunit{dispOpps.length === 1 ? 'y' : 'ies'} from EOL competitor equipment
            </div>
          )}
        </div>
      )}

      {/* Existing auto-created items */}
      {(opportunities.length > 0 || tasks.length > 0) && (
        <FormSection title="Auto-Created Items" icon="⚡" defaultOpen={false}>
          {opportunities.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--fg-3)', marginBottom: 8 }}>Opportunities</div>
              {opportunities.map((o, i) => (
                <div key={i} style={{ padding: '8px 10px', background: 'var(--bg-elev)', borderRadius: 6, fontSize: 12, marginBottom: 4 }}>
                  <span style={{ fontWeight: 500 }}>{String(o.product ?? '—')}</span>
                  <span style={{ color: 'var(--fg-3)', marginLeft: 8 }}>{String(o.stage ?? '')} · {String(o.auto_source ?? '')}</span>
                </div>
              ))}
            </div>
          )}
          {tasks.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--fg-3)', marginBottom: 8 }}>Tasks</div>
              {tasks.map((t, i) => (
                <div key={i} style={{ padding: '8px 10px', background: 'var(--bg-elev)', borderRadius: 6, fontSize: 12, marginBottom: 4 }}>
                  <span style={{ fontWeight: 500 }}>{String(t.title ?? '—')}</span>
                  {Boolean(t.due_date) && <span style={{ color: 'var(--fg-3)', marginLeft: 8 }}>due {String(t.due_date)}</span>}
                </div>
              ))}
            </div>
          )}
        </FormSection>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────

function FormSection({
  title, icon, children, defaultOpen = true,
}: {
  title: string; icon?: string; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)' }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          padding: '12px 16px', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', cursor: 'pointer',
          borderBottom: open ? '1px solid var(--line)' : 'none',
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: 8 }}>
          {icon} {title}
        </span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke="var(--fg-3)" strokeWidth="2"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: '200ms', flexShrink: 0 }}>
          <polyline points="18 15 12 9 6 15" />
        </svg>
      </div>
      {open && <div style={{ padding: 16 }}>{children}</div>}
    </div>
  );
}

function CheckInButton({ visitId, onDone }: { visitId: string; onDone: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  // Single entry point that always catches — the server action can never
  // produce an unhandled rejection that crashes the page.
  const doCheckIn = async (
    lat: number | null, lng: number | null, accuracy: number | null,
    manual: boolean, manualNote: string | null,
  ) => {
    try {
      await checkInVisit({ visitId, lat, lng, accuracy, manual, manualNote: manualNote ?? undefined });
      onDone();
    } catch (err: unknown) {
      console.error('Check-in error:', err);
      setError(err instanceof Error ? err.message : 'Check-in failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handle = async () => {
    setLoading(true); setError('');

    // Geolocation may be absent (insecure context / unsupported webview) —
    // fall back to a manual check-in instead of throwing.
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      await doCheckIn(null, null, null, true, 'GPS not supported on this device');
      return;
    }

    try {
      const pos = await new Promise<GeolocationPosition>((res, rej) =>
        navigator.geolocation.getCurrentPosition(
          res, rej,
          { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
        ),
      );
      await doCheckIn(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, false, null);
    } catch (gpsErr: unknown) {
      const code = (gpsErr as GeolocationPositionError)?.code;
      console.error('GPS error:', code, (gpsErr as Error)?.message);
      const reason =
        code === 1 ? 'Location permission denied'
        : code === 2 ? 'Location unavailable'
        : code === 3 ? 'Location request timed out'
        : 'GPS error: ' + ((gpsErr as Error)?.message ?? 'unknown');
      // Graceful fallback — record a manual check-in so the visit can still start.
      await doCheckIn(null, null, null, true, reason);
    }
  };

  const manualCheckIn = () => {
    setLoading(true); setError('');
    return doCheckIn(null, null, null, true, 'Manual check-in');
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <button
          onClick={handle} disabled={loading}
          style={{
            padding: '10px 20px', background: '#0A3D8F', color: 'white',
            border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 500,
            cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? 'Getting location…' : '📍 Start Visit'}
        </button>
        <span style={{ fontSize: 11, color: 'var(--fg-3)', fontStyle: 'italic' }}>
          Your GPS coordinates will be recorded
        </span>
      </div>
      {error && (
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: '#D97706' }}>{error}</span>
          <button
            type="button" onClick={manualCheckIn} disabled={loading}
            style={{
              padding: '5px 12px', borderRadius: 6, border: '1px solid var(--line-strong)',
              background: 'var(--bg-paper)', cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: 12, fontFamily: 'inherit', color: 'var(--fg-2)',
            }}
          >
            Check in without GPS
          </button>
        </div>
      )}
    </div>
  );
}

function SugarSection({
  report, visitId, disabled, queueSave, hasExpansion, setHasExpansion, hasComplaints, setHasComplaints,
}: {
  report: Record<string, unknown> | null;
  visitId: string; disabled: boolean;
  queueSave: (field: string, value: unknown) => void;
  hasExpansion: boolean; setHasExpansion: (v: boolean) => void;
  hasComplaints: boolean; setHasComplaints: (v: boolean) => void;
}) {
  const SCREW_APPS = ['molasses', 'magma', 'syrup', 'massecuite', 'melt', 'dosing', 'other'];
  const ROTA_APPS  = ['magma', 'massecuite'];

  const sugarField = (col: string) => Number(report?.[col] ?? 0);

  // Each Yes/No toggle needs its OWN controlled state — binding `value` to the
  // static report data left these stuck on their initial value when clicked.
  const [hasOutstanding, setHasOutstanding] = useState(!!(report?.has_outstanding_issues));
  const [pricesCaptured, setPricesCaptured] = useState(!!(report?.competitor_prices_captured));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* RIL Screw counts */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#0A3D8F', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>RIL Screw Pumps Installed</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {SCREW_APPS.map(app => (
            <div key={app} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'capitalize', marginBottom: 4 }}>{app}</div>
              <input
                type="number" min={0}
                defaultValue={sugarField(`ril_screw_${app}`)}
                disabled={disabled}
                onChange={e => queueSave(`ril_screw_${app}`, parseInt(e.target.value) || 0)}
                style={{ ...INP, width: 60, textAlign: 'center' }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* RIL Rota counts */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#0A3D8F', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>RIL Rota Pumps Installed</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {ROTA_APPS.map(app => (
            <div key={app} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'capitalize', marginBottom: 4 }}>{app}</div>
              <input
                type="number" min={0}
                defaultValue={sugarField(`ril_rota_${app}`)}
                disabled={disabled}
                onChange={e => queueSave(`ril_rota_${app}`, parseInt(e.target.value) || 0)}
                style={{ ...INP, width: 60, textAlign: 'center' }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Commercial discussion */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#0A3D8F', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Commercial Discussion</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Expansion */}
          <YesNoField
            label="Plans for expansion or new installation?"
            value={hasExpansion}
            disabled={disabled}
            onChange={v => { setHasExpansion(v); queueSave('has_expansion', v); }}
            detailLabel="Expansion details"
            defaultDetail={String(report?.expansion_detail ?? '')}
            onDetailChange={v => queueSave('expansion_detail', v)}
            warningIfYes="⚡ An opportunity (Suspect stage) will auto-create on submit"
          />
          {/* Complaints */}
          <YesNoField
            label="Running complaints?"
            value={hasComplaints}
            disabled={disabled}
            onChange={v => { setHasComplaints(v); queueSave('has_complaints', v); }}
            detailLabel="Complaint details"
            defaultDetail={String(report?.complaints_detail ?? '')}
            onDetailChange={v => queueSave('complaints_detail', v)}
          />
          {/* Outstanding */}
          <YesNoField
            label="Outstanding payment / commercial issues?"
            value={hasOutstanding}
            disabled={disabled}
            onChange={v => { setHasOutstanding(v); queueSave('has_outstanding_issues', v); }}
            detailLabel="Details"
            defaultDetail={String(report?.outstanding_detail ?? '')}
            onDetailChange={v => queueSave('outstanding_detail', v)}
          />
        </div>
      </div>

      {/* Purchasing route */}
      <div>
        <label style={LBL}>Purchasing Route</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <select
            defaultValue={String(report?.purchasing_route ?? '')}
            disabled={disabled}
            onChange={e => queueSave('purchasing_route', e.target.value)}
            style={{ ...INP, maxWidth: 200, appearance: 'none' }}
          >
            <option value="">— Select —</option>
            {['Direct', 'Through OEM', 'Trader'].map(r => <option key={r}>{r}</option>)}
          </select>
          <input
            type="text"
            defaultValue={String(report?.purchasing_route_detail ?? '')}
            disabled={disabled}
            onChange={e => queueSave('purchasing_route_detail', e.target.value)}
            style={{ ...INP, flex: 1 }}
            placeholder="Details…"
          />
        </div>
      </div>

      {/* Competitor prices */}
      <CheckboxField
        label="Competitor prices captured during visit?"
        checked={pricesCaptured}
        disabled={disabled}
        onChange={v => { setPricesCaptured(v); queueSave('competitor_prices_captured', v); }}
      />
    </div>
  );
}

function CheckboxField({
  label, checked, disabled, onChange,
}: {
  label: string; checked: boolean; disabled: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: disabled ? 'default' : 'pointer' }}>
      <input
        type="checkbox" checked={checked} disabled={disabled}
        onChange={e => onChange(e.target.checked)}
        style={{ width: 14, height: 14 }}
      />
      <span style={{ fontSize: 13 }}>{label}</span>
    </label>
  );
}

function YesNoField({
  label, value, disabled, onChange, detailLabel, defaultDetail, onDetailChange, warningIfYes,
}: {
  label: string; value: boolean; disabled: boolean; onChange: (v: boolean) => void;
  detailLabel: string; defaultDetail: string; onDetailChange: (v: string) => void;
  warningIfYes?: string;
}) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: value ? 8 : 0 }}>
        <span style={{ fontSize: 13, flex: 1 }}>{label}</span>
        <div style={{ display: 'flex', gap: 4 }}>
          {[true, false].map(v => (
            <button
              key={String(v)}
              disabled={disabled}
              onClick={() => onChange(v)}
              style={{
                padding: '4px 12px', borderRadius: 5, fontSize: 12, cursor: disabled ? 'default' : 'pointer',
                fontFamily: 'inherit', border: value === v ? '2px solid #0A3D8F' : '1px solid var(--line-strong)',
                background: value === v ? '#EBF1FB' : 'var(--bg-paper)',
                color: value === v ? '#0A3D8F' : 'var(--fg-3)', fontWeight: value === v ? 600 : 400,
              }}
            >
              {v ? 'Yes' : 'No'}
            </button>
          ))}
        </div>
      </div>
      {value && (
        <>
          {warningIfYes && (
            <div style={{ fontSize: 11, color: '#92400E', background: '#FEF3C7', padding: '4px 8px', borderRadius: 4, marginBottom: 6 }}>
              {warningIfYes}
            </div>
          )}
          <textarea
            defaultValue={defaultDetail}
            disabled={disabled}
            onChange={e => onDetailChange(e.target.value)}
            rows={2}
            placeholder={`${detailLabel}…`}
            style={{ ...INP, height: 'auto', resize: 'vertical', lineHeight: 1.5 }}
          />
        </>
      )}
    </div>
  );
}

function SummaryTextarea({
  defaultValue, disabled, onSave, maxLength,
}: {
  defaultValue: string; disabled: boolean; onSave: (v: string) => void; maxLength: number;
}) {
  const [val, setVal] = useState(defaultValue);
  return (
    <div>
      <textarea
        value={val}
        disabled={disabled}
        onChange={e => { setVal(e.target.value); onSave(e.target.value); }}
        rows={4}
        maxLength={maxLength}
        style={{ ...INP, height: 'auto', resize: 'vertical', lineHeight: 1.5 }}
        placeholder="Summarise the key points discussed and outcomes of the visit…"
      />
      <div style={{ textAlign: 'right', fontSize: 10, color: val.length > maxLength * 0.9 ? 'var(--neg)' : 'var(--fg-3)', marginTop: 2 }}>
        {val.length} / {maxLength}
      </div>
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────

const LBL: CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 700, color: '#2C3E5A',
  textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 5,
};

const INP: CSSProperties = {
  display: 'block', width: '100%', padding: '8px 10px',
  border: '1px solid var(--line-strong)', borderRadius: 6,
  fontSize: 13, fontFamily: 'inherit', background: 'var(--bg-paper)',
  color: 'var(--fg)', outline: 'none', boxSizing: 'border-box',
};
