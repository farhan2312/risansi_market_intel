'use client';

import { useState, useRef, useEffect, useCallback, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { saveVisitField, checkInVisit, addEquipment, updateEquipment, deleteEquipment, saveExpansionOpportunity } from '@/app/actions/risansi-visits';
import { ClientPumpEditor } from './ClientPumpEditor';
import { LogComplaintButton } from './LogComplaintButton';
import { updateTaskStatus, deleteTask } from '@/app/actions/risansi-tasks';
import { AddActionForm } from './AddActionForm';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FormErrorBoundary } from './FormErrorBoundary';
import { AddContactButton } from './AddContactButton';
import { EditContactButton } from './EditContactButton';
import { SubmitVisitButton } from './SubmitVisitButton';
import { VisitPhotos } from './VisitPhotos';
import { VISIT_EDIT_WINDOW_DAYS } from '@/lib/risansi-visit-edit-window';

// Major competitor makes for the Competitor Equipment dropdown. Mirrors the
// per-maker columns tracked in competitor_installed_base. Pick "Other" to type
// a make that isn't listed.
const COMPETITOR_MAKES = [
  'Roto', 'Rotomac', 'Gita', 'PSP', 'Syno', 'Ropman', 'Myto', 'Vikas',
  'Newpumps', 'Indopump', 'Tushaco', 'Yaswant', 'Shivam', 'Saksham', 'Alpha',
  'Gajanan', 'Chandra Helicon', 'Netzsch', 'Akanshi', 'Pragati', 'Ropar',
  'Rotor Flow', 'Naishit', 'Delta', 'Varun', 'NPI', 'Hydroprocav', 'SRE',
  'Span Engg', 'Pandey', 'Mahalaxmi', 'Ravalgoan',
];

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
  email: string | null; whatsapp: string | null; notes: string | null;
}

interface TaskItem {
  id: number;
  title: string;
  description: string | null;
  due_date: string | null;
  priority: string | null;
  status: string;
  assigned_to_rep: number | null;
  assigned_to_external: string | null;
  assigned_rep_name: string | null;
  created_by: string | null;
}

interface TaskRep { id: number; name: string; zone: string | null }

interface ExpansionOpp {
  id: number;
  product: string | null;
  product_type: string | null;
  stage: string | null;
  value_cr: string | number | null;
  probability: number | null;
  eta_text: string | null;
  quote_ref: string | null;
  notes: string | null;
}

// ── Props ──────────────────────────────────────────────────────

interface Props {
  visit:          VisitData;
  contacts:       Contact[];
  equipment:      Record<string, unknown>[];
  sugarReport:    Record<string, unknown> | null;
  nonsugarReport: Record<string, unknown> | null;
  opportunities:  Record<string, unknown>[];
  tasks:          TaskItem[];
  reps:           TaskRep[];
  expansionOpp:   ExpansionOpp | null;
  isSubmitted:    boolean;          // the report has been closed (submitted_at set)
  canEditVisit:   boolean;          // this viewer is allowed to edit at all (role)
  canReopen:      boolean;          // …and it's still inside the 30-day window
  closedDate:     string | null;    // formatted first-closed date
  daysLeft:       number;           // whole days left in the re-open window
  isSugar:        boolean;
}

// ── Auto-save hook ─────────────────────────────────────────────

function useAutoSave(visitId: string) {
  const draftKey = `risansi_visit_draft_${visitId}`;
  const [saveState, setSaveState] = useState<'idle' | 'pending' | 'saving' | 'saved' | 'error'>('idle');
  // True when a previous session left unsynced field changes in localStorage
  // (e.g. the rep lost signal in the field before the 5s auto-save fired).
  const [hasDraft, setHasDraft] = useState(false);
  const saveTimer  = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending    = useRef<Record<string, unknown>>({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey);
      const obj = raw ? JSON.parse(raw) : null;
      if (obj && typeof obj === 'object' && Object.keys(obj).length > 0) setHasDraft(true);
    } catch { /* ignore */ }
  }, [draftKey]);

  const queueSave = useCallback((field: string, value: unknown) => {
    pending.current[field] = value;
    // Persist immediately so a dropped connection / closed tab can't lose entry.
    try { localStorage.setItem(draftKey, JSON.stringify(pending.current)); } catch { /* ignore */ }
    setSaveState('pending');
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaveState('saving');
      try {
        await saveVisitField(visitId, pending.current);
        pending.current = {};
        try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
        setHasDraft(false);
        setSaveState('saved');
        setTimeout(() => setSaveState('idle'), 3000);
      } catch {
        setSaveState('error');   // draft stays in localStorage for recovery
      }
    }, 5000);
  }, [visitId, draftKey]);

  // Re-send a recovered draft (the "Sync now" banner action).
  const syncDraft = useCallback(async () => {
    try {
      const raw = localStorage.getItem(draftKey);
      const obj = raw ? JSON.parse(raw) : null;
      if (!obj || Object.keys(obj).length === 0) { setHasDraft(false); return; }
      setSaveState('saving');
      await saveVisitField(visitId, obj);
      try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
      setHasDraft(false);
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 3000);
    } catch {
      setSaveState('error');
    }
  }, [visitId, draftKey]);

  return { saveState, queueSave, hasDraft, syncDraft };
}

// ── Main Component ─────────────────────────────────────────────

export function VisitReportForm({
  visit, contacts, equipment, sugarReport, nonsugarReport,
  opportunities, tasks, reps, expansionOpp,
  isSubmitted, canEditVisit, canReopen, closedDate, daysLeft, isSugar: initialIsSugar,
}: Props) {
  const { saveState, queueSave, hasDraft, syncDraft } = useAutoSave(visit.id);
  const router = useRouter();

  const handleCompleteTask = async (taskId: number, status: 'open' | 'completed') => {
    await updateTaskStatus(taskId, status);
    router.refresh();
  };
  const handleDeleteTask = async (taskId: number) => {
    if (typeof window !== 'undefined' && !window.confirm('Delete this action point? This cannot be undone.')) return;
    await deleteTask(taskId);
    router.refresh();
  };

  // Local state for conditional fields
  const [isSugar, setIsSugar]         = useState(initialIsSugar);
  const [purpose, setPurpose]         = useState(visit.purpose ?? '');
  const [outcome, setOutcome]         = useState(visit.outcome ?? '');
  const [isUnplanned, setIsUnplanned] = useState(!!visit.is_unplanned);
  const [sampleGiven, setSampleGiven] = useState(!!visit.sample_or_gift_given);
  const [followUp, setFollowUp]       = useState(!!visit.follow_up_required);
  const [compActivity, setCompActivity] = useState(!!visit.competitor_activity_observed);

  // Sugar-specific state
  const [hasComplaints, setHasComplaints] = useState(!!(sugarReport?.has_complaints));

  // Equipment
  const [eqTab, setEqTab]   = useState<'ril' | 'competitor'>('ril');
  // Live count of the client's installed pumps (client_pumps), reported by the
  // RIL editor, so the RIL tab badge matches what that tab actually shows.
  const [rilPumpCount, setRilPumpCount] = useState<number | null>(null);
  const [showEqForm, setShowEqForm] = useState(false);
  // id of the equipment row being edited (null = adding a new row)
  const [editingEqId, setEditingEqId] = useState<number | null>(null);
  // true when the competitor make isn't in COMPETITOR_MAKES (free-text entry)
  const [supplierOther, setSupplierOther] = useState(false);
  const [newEq, setNewEq] = useState({
    pump_type: 'PCP', supplier: '', model: '', qty: 1,
    application: '', condition: 'Good', is_ril: true,
    reason_for_competitor: '', competitor_activity_type: '',
    performance_feedback: '',
  });

  // A submitted report shows as Closed and is read-only until the viewer
  // re-opens it (allowed only when canReopen). A draft is editable straight away
  // by anyone authorised. `reopened` is intentionally session-only: reload and
  // it's Closed again, so an edit is always a deliberate act.
  const [reopened, setReopened] = useState(false);
  const disabled = isSubmitted ? !reopened : !canEditVisit;

  // ── Wizard step state ───────────────────────────────────────
  // Each step shows a slice of the (always-mounted) sections via display
  // toggling, so auto-save and field state are never lost on navigation.
  // Keyed steps — small, focused screens so each fits without much scrolling.
  // Sugar visits get two industry sub-steps; non-sugar gets one. Filtered list
  // drives the stepper; `curKey` drives which section block is shown.
  const [stepIdx, setStepIdx] = useState(0);
  const allSteps = [
    { key: 'checkin',   label: 'Check-in',  title: 'Check in',              desc: 'Confirm your GPS check-in for this visit.', show: true },
    { key: 'details',   label: 'Details',   title: 'Visit details',         desc: 'Purpose and outcome of the visit.',         show: true },
    { key: 'contacts',  label: 'Contacts',  title: 'Contacts',              desc: 'People you met / manage at this client.',   show: true },
    { key: 'sugar1',    label: 'Pumps',     title: 'RIL pump install base', desc: 'Screw & rota pumps installed at the plant.', show: isSugar },
    { key: 'sugar2',    label: 'Commercial',title: 'Commercial discussion', desc: 'Complaints, payments and purchasing.',       show: isSugar },
    { key: 'nonsugar',  label: 'Industry',  title: 'Industry report',       desc: 'Products dealt and equipment observed.',     show: !isSugar },
    { key: 'equipment', label: 'Equipment', title: 'Equipment & competition', desc: 'RIL and competitor pumps seen.',           show: true },
    { key: 'opps',      label: 'Opportunities', title: 'Opportunities',     desc: 'Expansion plans and new business.',          show: true },
    { key: 'summary',   label: 'Summary',   title: 'Visit summary',         desc: 'Performance, feedback and remarks.',         show: true },
    { key: 'photos',    label: 'Photos',    title: 'Site photos',           desc: 'Capture site / equipment photos — camera or gallery.', show: true },
    { key: 'actions',   label: 'Actions',   title: 'Action register',       desc: 'Add action points, then submit the report.', show: true },
  ];
  const steps = allSteps.filter(s => s.show);
  const LAST = steps.length - 1;
  const step = Math.min(stepIdx, LAST);
  const curKey = steps[step]?.key ?? 'checkin';
  const goStep = (n: number) => {
    setStepIdx(Math.max(0, Math.min(LAST, n)));
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Derived preview data
  const rilEquipment  = equipment.filter(e => e.is_ril);
  const compEquipment = equipment.filter(e => !e.is_ril);
  const dispOpps      = equipment.filter(e => e.is_opportunity);
  const willPreview   = followUp || dispOpps.length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* ── Closed / re-open banner (submitted reports only) ───────── */}
      {isSubmitted && !reopened && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
          padding: '11px 16px', borderRadius: 12,
          background: 'var(--bg-elev)', border: '1px solid var(--line-strong)',
        }}>
          <div style={{ fontSize: 12.5, color: 'var(--fg-2)', minWidth: 0 }}>
            <b style={{ color: 'var(--fg)' }}>Closed{closedDate ? ` on ${closedDate}` : ''}.</b>{' '}
            {canReopen
              ? `Corrections are still possible — ${daysLeft} day${daysLeft === 1 ? '' : 's'} left in the ${VISIT_EDIT_WINDOW_DAYS}-day window. Re-open to edit; changes are logged to the client's activity.`
              : canEditVisit
                ? `The ${VISIT_EDIT_WINDOW_DAYS}-day correction window has passed — this report is now locked.`
                : 'View only.'}
          </div>
          {canReopen && (
            <button type="button" onClick={() => setReopened(true)} style={{
              flexShrink: 0, padding: '7px 16px', borderRadius: 8, fontSize: 12.5, fontWeight: 600,
              background: '#0A3D8F', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            }}>
              Re-open to edit
            </button>
          )}
        </div>
      )}

      {/* Re-opened: editing an otherwise-closed report. */}
      {isSubmitted && reopened && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
          padding: '11px 16px', borderRadius: 12,
          background: 'var(--accent-soft, #EBF1FB)', border: '1px solid var(--accent-line, #C7D9F5)',
        }}>
          <div style={{ fontSize: 12.5, color: 'var(--title, #0A3D8F)', minWidth: 0 }}>
            <b>Re-opened for editing.</b> Changes save automatically and are logged to the client&apos;s activity.
            This report stays Closed{closedDate ? ` (${closedDate})` : ''}.
          </div>
          <button type="button" onClick={() => setReopened(false)} style={{
            flexShrink: 0, padding: '7px 16px', borderRadius: 8, fontSize: 12.5, fontWeight: 600,
            background: 'var(--bg-paper)', color: 'var(--title, #0A3D8F)', border: '1px solid var(--title, #0A3D8F)', cursor: 'pointer', fontFamily: 'inherit',
          }}>
            Done
          </button>
        </div>
      )}

      {/* ── Progress header: slim stepper + current step title ─────── */}
      <div style={{ background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 14, padding: '16px 16px 14px' }}>
        {/* Dots-only progress track (scales to any number of steps) */}
        <div style={{ display: 'flex', alignItems: 'center', position: 'relative' }}>
          <div style={{ position: 'absolute', left: 8, right: 8, height: 3, background: 'var(--line)', borderRadius: 2 }} />
          <div style={{ position: 'absolute', left: 8, width: `calc((100% - 16px) * ${LAST > 0 ? step / LAST : 0})`, height: 3, background: '#1A5CB8', borderRadius: 2, transition: 'width 280ms ease' }} />
          {steps.map((s, i) => {
            const active = i === step, done = i < step;
            return (
              <button key={s.key} type="button" className="r-step-dot" onClick={() => goStep(i)} aria-current={active} title={s.title}
                style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 0', position: 'relative', zIndex: 1 }}>
                <span style={{
                  width: active ? 26 : 16, height: active ? 26 : 16, borderRadius: '50%', display: 'grid', placeItems: 'center',
                  fontSize: 11, fontWeight: 700, transition: 'all 200ms',
                  background: active || done ? '#1A5CB8' : 'var(--bg-paper)',
                  color: '#fff',
                  border: active || done ? '2px solid #1A5CB8' : '2px solid var(--line-strong)',
                  boxShadow: active ? '0 0 0 4px var(--accent-soft)' : 'none',
                }}>{active ? i + 1 : done ? '✓' : ''}</span>
              </button>
            );
          })}
        </div>

        {/* Current step title + description + save status */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--fg-3)', textTransform: 'uppercase' }}>
              Step {step + 1} of {steps.length}
            </div>
            <div style={{ fontSize: 17, fontWeight: 600, color: 'var(--fg)', marginTop: 2, letterSpacing: '-0.01em' }}>{steps[step]?.title}</div>
            <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 2 }}>{steps[step]?.desc}</div>
          </div>
          <span style={{ fontSize: 11, fontWeight: 500, flexShrink: 0, whiteSpace: 'nowrap',
            color: saveState === 'saved' ? 'var(--pos)' : saveState === 'error' ? 'var(--neg)' : 'var(--fg-3)', transition: 'color 300ms' }}>
            {saveState === 'saving' && '⟳ Saving…'}
            {saveState === 'saved'  && '✓ Saved'}
            {saveState === 'error'  && '⚠ Save failed'}
          </span>
        </div>
      </div>

      {/* Draft recovery — unsynced changes survived a closed tab / dropped signal. */}
      {hasDraft && !disabled && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          background: 'var(--warn-soft)', border: '1px solid #FCD34D', borderRadius: 12,
          padding: '10px 14px', fontSize: 12, color: 'var(--warn)',
        }}>
          <span style={{ flex: 1, minWidth: 160 }}>
            Unsynced changes from an earlier session were found on this device.
          </span>
          <button
            type="button"
            onClick={async () => { await syncDraft(); router.refresh(); }}
            style={{
              padding: '8px 14px', minHeight: 40, borderRadius: 8, border: 'none',
              background: '#92400E', color: '#fff', fontWeight: 600, fontSize: 12,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            Sync now
          </button>
        </div>
      )}

      {/* ══ STEP: Check-in ══ */}
      <div style={{ display: curKey === 'checkin' ? 'flex' : 'none', flexDirection: 'column', gap: 12 }}>

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

      </div>{/* end STEP 0 */}

      {/* ══ STEP: Visit Details ══ */}
      <div style={{ display: curKey === 'details' ? 'flex' : 'none', flexDirection: 'column', gap: 12 }}>

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
                  {c.is_primary && <span style={{ marginLeft: 4, color: 'var(--title)', fontSize: 10, fontWeight: 600 }}>PRIMARY</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </FormSection>

      </div>{/* end details */}

      {/* ══ STEP: Contacts ══ */}
      <div style={{ display: curKey === 'contacts' ? 'flex' : 'none', flexDirection: 'column', gap: 12 }}>

      {/* ── SECTION: Contacts (live client contacts — synced with Client 360) ── */}
      <FormSection title="Contacts" icon="👤">
        <div style={{ fontSize: 11, color: 'var(--fg-3)', marginBottom: 12 }}>
          {disabled
            ? 'This visit is closed — contacts are read-only.'
            : 'Add, update, or remove the client’s contacts here — changes save to the client and appear in Client 360 automatically.'}
        </div>
        {contacts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '16px', color: 'var(--fg-3)', fontSize: 13 }}>
            No contacts on file yet.
          </div>
        ) : (
          <div style={{ marginBottom: 12 }}>
            {contacts.map((c, i) => (
              <div
                key={c.id}
                style={{
                  padding: '10px 0',
                  borderBottom: i < contacts.length - 1 ? '1px solid var(--line)' : 'none',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{c.name}</span>
                  {c.is_primary && (
                    <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--title)', background: 'var(--accent-soft)', border: '1px solid var(--accent-line)', borderRadius: 10, padding: '1px 7px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Primary</span>
                  )}
                  {c.designation && <span style={{ fontSize: 12, color: 'var(--fg-3)' }}>· {c.designation}</span>}
                </div>
                <div style={{ display: 'flex', gap: 14, marginTop: 4, flexWrap: 'wrap', fontSize: 12, color: 'var(--fg-2)' }}>
                  {c.phone && <span>📞 {c.phone}</span>}
                  {c.email && <span>✉ {c.email}</span>}
                  {c.whatsapp && <span>💬 {c.whatsapp}</span>}
                </div>
                {c.notes && <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 4, fontStyle: 'italic', lineHeight: 1.4 }}>{c.notes}</div>}
                {!disabled && (
                  <EditContactButton
                    contact={{ id: c.id, name: c.name, designation: c.designation, phone: c.phone, email: c.email, whatsapp: c.whatsapp, notes: c.notes, is_primary: c.is_primary }}
                    clientId={Number(visit.client_id)}
                  />
                )}
              </div>
            ))}
          </div>
        )}
        {!disabled && <AddContactButton clientId={Number(visit.client_id)} clientCode={visit.code} />}
      </FormSection>

      </div>{/* end contacts */}


      {/* ══ STEP: Sugar — RIL pump install base ══ */}
      <div style={{ display: curKey === 'sugar1' ? 'flex' : 'none', flexDirection: 'column', gap: 12 }}>
        {isSugar && (
          <FormSection title="RIL Pump Install Base" icon="🍬">
            <SugarSection report={sugarReport} visitId={visit.id} disabled={disabled} queueSave={queueSave} hasComplaints={hasComplaints} setHasComplaints={setHasComplaints} part="pumps" />
          </FormSection>
        )}
      </div>{/* end sugar1 */}

      {/* ══ STEP: Sugar — Commercial discussion ══ */}
      <div style={{ display: curKey === 'sugar2' ? 'flex' : 'none', flexDirection: 'column', gap: 12 }}>
        {isSugar && (
          <FormSection title="Commercial Discussion" icon="💬">
            <SugarSection report={sugarReport} visitId={visit.id} disabled={disabled} queueSave={queueSave} hasComplaints={hasComplaints} setHasComplaints={setHasComplaints} part="commercial" />
          </FormSection>
        )}
      </div>{/* end sugar2 */}

      {/* ══ STEP: Non-Sugar Report ══ */}
      <div style={{ display: curKey === 'nonsugar' ? 'flex' : 'none', flexDirection: 'column', gap: 12 }}>
        {!isSugar && (
          <FormSection title="Non-Sugar Report" icon="🏭">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={LBL}>Deal In (products)</label>
                <input type="text" defaultValue={String(nonsugarReport?.deal_in ?? '')} disabled={disabled} onChange={e => queueSave('deal_in', e.target.value)} style={INP} placeholder="e.g. PCP, MMP, Spares" />
              </div>
              <div>
                <label style={LBL}>Valves / Equipment Observed</label>
                <textarea defaultValue={String(nonsugarReport?.valves_observed_notes ?? '')} disabled={disabled} onChange={e => queueSave('valves_observed_notes', e.target.value)} rows={3} style={{ ...INP, height: 'auto', resize: 'vertical', lineHeight: 1.5 }} placeholder="Notes on valves and equipment observed…" />
              </div>
            </div>
          </FormSection>
        )}
      </div>{/* end nonsugar */}

      {/* ══ STEP: Equipment & Competition ══ */}
      <div style={{ display: curKey === 'equipment' ? 'flex' : 'none', flexDirection: 'column', gap: 12 }}>

      {/* ── SECTION 5: Equipment Assessment ───────────────── */}
      <FormSection title="Equipment Assessment" icon="⚙️">
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
                color: eqTab === id ? 'var(--title)' : 'var(--fg-3)',
                borderBottom: eqTab === id ? '2px solid var(--title)' : '2px solid transparent',
                marginBottom: -1,
              }}
            >
              {label}
              {id === 'ril' && (rilPumpCount ?? 0) > 0 && (
                <span style={{ marginLeft: 6, fontSize: 10, background: 'var(--accent-soft)', color: 'var(--title)', padding: '1px 5px', borderRadius: 8 }}>
                  {rilPumpCount}
                </span>
              )}
              {id === 'competitor' && compEquipment.length > 0 && (
                <span style={{ marginLeft: 6, fontSize: 10, background: 'var(--neg-soft)', color: 'var(--neg-strong)', padding: '1px 5px', borderRadius: 8 }}>
                  {compEquipment.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* RIL tab → editable client pumps (writes to client_pumps directly).
            Competitor tab → the existing equipment capture. */}
        {eqTab === 'ril' && <ClientPumpEditor clientId={visit.client_id} onCount={setRilPumpCount} />}

        {/* cast avoids narrowing eqTab to 'competitor' so the inner tab checks still type-check */}
        {(eqTab as string) === 'competitor' && (<>
        {/* Equipment list */}
        {(eqTab === 'ril' ? rilEquipment : compEquipment).length === 0 ? (
          <div style={{ textAlign: 'center', padding: '16px', color: 'var(--fg-3)', fontSize: 13 }}>
            No {eqTab === 'ril' ? 'RIL' : 'competitor'} equipment recorded
          </div>
        ) : (
          <table className="r-cards" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 12 }}>
            <thead>
              <tr style={{ background: 'var(--bg-elev)' }}>
                {['Type', 'Supplier/Model', 'Application', 'Qty', 'Condition', eqTab === 'ril' ? 'Feedback' : 'Reason'].map(h => (
                  <th key={h} style={{ padding: '7px 10px', textAlign: 'left', fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--fg-3)', borderBottom: '1px solid var(--line)' }}>{h}</th>
                ))}
                {!disabled && <th style={{ padding: '7px 10px', borderBottom: '1px solid var(--line)' }} />}
              </tr>
            </thead>
            <tbody>
              {(eqTab === 'ril' ? rilEquipment : compEquipment).map((e, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--line)' }}>
                  <td data-label="" style={{ padding: '8px 10px' }}>{String(e.supplier ?? '')} {String(e.model ?? '')}</td>
                  <td data-label="Type" style={{ padding: '8px 10px' }}>{String(e.pump_type ?? '—')}</td>
                  <td data-label="Application" style={{ padding: '8px 10px', color: 'var(--fg-3)' }}>{String(e.application ?? '—')}</td>
                  <td data-label="Qty" style={{ padding: '8px 10px', textAlign: 'center' }}>{String(e.qty ?? 1)}</td>
                  <td data-label="Condition" style={{ padding: '8px 10px' }}>
                    <span style={{
                      fontSize: 11, padding: '2px 6px', borderRadius: 4,
                      background: e.condition === 'EOL' ? 'var(--neg-soft)' : e.condition === 'Good' ? 'var(--pos-soft)' : 'var(--warn-soft)',
                      color: e.condition === 'EOL' ? 'var(--neg-strong)' : e.condition === 'Good' ? 'var(--pos-strong)' : 'var(--warn)',
                    }}>
                      {String(e.condition ?? '—')}
                    </span>
                    {Boolean(e.is_opportunity) && <span style={{ marginLeft: 4, fontSize: 10, color: 'var(--brand-blue)' }}>⚡ Opp</span>}
                  </td>
                  <td data-label={eqTab === 'ril' ? 'Feedback' : 'Reason'} style={{ padding: '8px 10px', color: 'var(--fg-3)', fontSize: 11 }}>
                    {eqTab === 'ril' ? String(e.performance_feedback ?? '—') : String(e.reason_for_competitor ?? '—')}
                  </td>
                  {!disabled && (
                    <td data-label="Actions" style={{ padding: '8px 10px', textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button
                        type="button"
                        onClick={() => {
                          const sup = String(e.supplier ?? '');
                          setEditingEqId(Number(e.id));
                          setShowEqForm(true);
                          setSupplierOther(eqTab === 'competitor' && sup !== '' && !COMPETITOR_MAKES.includes(sup));
                          setNewEq({
                            pump_type: String(e.pump_type ?? 'PCP'),
                            supplier: sup,
                            model: String(e.model ?? ''),
                            qty: Number(e.qty ?? 1),
                            application: String(e.application ?? ''),
                            condition: String(e.condition ?? 'Good'),
                            is_ril: Boolean(e.is_ril),
                            reason_for_competitor: String(e.reason_for_competitor ?? ''),
                            competitor_activity_type: String(e.competitor_activity_type ?? ''),
                            performance_feedback: String(e.performance_feedback ?? ''),
                          });
                        }}
                        className="r-tap"
                        style={{ fontSize: 11, color: 'var(--title)', background: 'none', border: '1px solid var(--title)', borderRadius: 5, padding: '3px 12px', cursor: 'pointer', fontFamily: 'inherit' }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          if (typeof window !== 'undefined' && !window.confirm('Delete this equipment entry? This cannot be undone.')) return;
                          if (editingEqId === Number(e.id)) { setShowEqForm(false); setEditingEqId(null); }
                          await deleteEquipment(Number(e.id), visit.id);
                        }}
                        className="r-tap"
                        style={{ fontSize: 11, color: 'var(--neg)', background: 'none', border: '1px solid var(--neg)', borderRadius: 5, padding: '3px 12px', cursor: 'pointer', fontFamily: 'inherit' }}
                      >
                        Delete
                      </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Add equipment form */}
        {!disabled && !showEqForm && (
          <button
            onClick={() => { setShowEqForm(true); setEditingEqId(null); setSupplierOther(false); setNewEq(prev => ({ ...prev, is_ril: eqTab === 'ril', supplier: eqTab === 'ril' ? 'RIL' : '' })); }}
            style={{ fontSize: 12, color: 'var(--title)', background: 'none', border: '1px dashed var(--title)', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontFamily: 'inherit' }}
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
                  <label style={LBL}>Competitor / Make</label>
                  <select
                    value={supplierOther ? '__other__' : newEq.supplier}
                    onChange={e => {
                      const v = e.target.value;
                      if (v === '__other__') { setSupplierOther(true); setNewEq(p => ({ ...p, supplier: '' })); }
                      else { setSupplierOther(false); setNewEq(p => ({ ...p, supplier: v })); }
                    }}
                    style={{ ...INP, appearance: 'none' }}
                  >
                    <option value="">Select competitor…</option>
                    {COMPETITOR_MAKES.map(m => <option key={m} value={m}>{m}</option>)}
                    <option value="__other__">Other (specify)…</option>
                  </select>
                  {supplierOther && (
                    <input
                      type="text"
                      value={newEq.supplier}
                      onChange={e => setNewEq(p => ({ ...p, supplier: e.target.value }))}
                      style={{ ...INP, marginTop: 6 }}
                      placeholder="Enter competitor name"
                    />
                  )}
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
                <input type="number" inputMode="numeric" min={1} value={newEq.qty} onChange={e => setNewEq(p => ({ ...p, qty: parseInt(e.target.value) || 1 }))} style={INP} />
              </div>
              <div>
                <label style={LBL}>Condition</label>
                <select value={newEq.condition} onChange={e => setNewEq(p => ({ ...p, condition: e.target.value }))} style={INP}>
                  {['Good', 'Requires Maintenance', 'EOL'].map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
            </div>

            {newEq.condition === 'EOL' && eqTab === 'competitor' && (
              <div style={{ padding: '8px 12px', background: 'var(--accent-soft)', borderRadius: 6, fontSize: 12, color: 'var(--brand-blue)', marginBottom: 10 }}>
                ⚡ EOL detected — a displacement opportunity will be flagged on submit
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={async () => {
                  if (editingEqId != null) {
                    await updateEquipment(editingEqId, visit.id, { ...newEq });
                  } else {
                    await addEquipment(visit.id, visit.client_id, { ...newEq });
                  }
                  setShowEqForm(false);
                  setEditingEqId(null);
                  setSupplierOther(false);
                  setNewEq({ pump_type: 'PCP', supplier: '', model: '', qty: 1, application: '', condition: 'Good', is_ril: true, reason_for_competitor: '', competitor_activity_type: '', performance_feedback: '' });
                }}
                style={{ padding: '7px 14px', background: '#0A3D8F', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}
              >
                {editingEqId != null ? 'Update Equipment' : 'Save Equipment'}
              </button>
              <button
                onClick={() => { setShowEqForm(false); setEditingEqId(null); setSupplierOther(false); }}
                style={{ padding: '7px 14px', background: 'none', border: '1px solid var(--line-strong)', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        </>)}
      </FormSection>

      </div>{/* end STEP 3 */}

      {/* ══ STEP: Opportunities ══ */}
      <div style={{ display: curKey === 'opps' ? 'flex' : 'none', flexDirection: 'column', gap: 12 }}>

      {/* ── SECTION: Expansion / New Business ───────────────── */}
      <FormSection title="Expansion / New Business" icon="⚡">
        <ExpansionOpportunityForm
          visitId={Number(visit.id)}
          clientId={Number(visit.client_id)}
          clientName={visit.legal_name}
          repId={visit.rep_id ? Number(visit.rep_id) : null}
          isClosed={disabled}
          existingOpp={expansionOpp}
        />
      </FormSection>

      {/* ── SECTION: Complaint ──────────────────────────────── */}
      <FormSection title="Complaint" icon="⚠">
        <div style={{ fontSize: 12, color: 'var(--fg-3)', marginBottom: 10 }}>
          Raise a service / product complaint for {visit.legal_name} and escalate it to a responsible person.
        </div>
        <LogComplaintButton clientId={Number(visit.client_id)} clientName={visit.legal_name} />
      </FormSection>

      </div>{/* end opps */}

      {/* ══ STEP: Visit Summary ══ */}
      <div style={{ display: curKey === 'summary' ? 'flex' : 'none', flexDirection: 'column', gap: 12 }}>

      {/* ── SECTION 6: Visit Summary ───────────────────────── */}
      <FormSection title="Visit Summary" icon="📝">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
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
                  <input type="number" inputMode="decimal" defaultValue={visit.sample_gift_value ?? ''} disabled={disabled} onChange={e => queueSave('sample_gift_value', e.target.value)} style={INP} />
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
            <label style={LBL}>Open Remarks</label>
            <textarea defaultValue={visit.open_remarks ?? ''} disabled={disabled} onChange={e => queueSave('open_remarks', e.target.value)} rows={2} style={{ ...INP, height: 'auto', resize: 'vertical', lineHeight: 1.5 }} />
          </div>
        </div>
      </FormSection>

      </div>{/* end summary */}

      {/* ══ STEP: Site Photos ══ */}
      <div style={{ display: curKey === 'photos' ? 'flex' : 'none', flexDirection: 'column', gap: 12 }}>
      <FormSection title="Site Photos" icon="📷">
        <VisitPhotos visitId={visit.id} disabled={disabled} />
      </FormSection>
      </div>{/* end photos */}

      {/* ══ STEP: Action Register ══ */}
      <div style={{ display: curKey === 'actions' ? 'flex' : 'none', flexDirection: 'column', gap: 12 }}>

      {/* ── SECTION: Action Points ─────────────────────────── */}
      <FormSection title="Action Register" icon="📋">
        {tasks.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '24px', color: 'var(--fg-3)', fontSize: 13 }}>
            No action points yet.{!disabled && ' Click "+ Add Action Point" to create one.'}
          </div>
        ) : (
          tasks.map(task => (
            <TaskRow
              key={task.id}
              task={task}
              isClosed={disabled}
              onComplete={handleCompleteTask}
              onDelete={handleDeleteTask}
            />
          ))
        )}
        {!disabled && (
          <AddActionForm
            visitId={Number(visit.id)}
            clientId={Number(visit.client_id)}
            reps={reps}
            onAdded={() => router.refresh()}
          />
        )}
      </FormSection>

      {/* ── SECTION 7: Preview (before submit) — drafts only ─────── */}
      {!isSubmitted && !disabled && willPreview && (
        <div style={{
          border: '1px solid var(--brand-blue)', borderRadius: 8, padding: 16,
          background: 'var(--accent-soft)',
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--title)', marginBottom: 10 }}>
            On Submit, the following will be created:
          </div>
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

      {/* Auto-created opportunities (tasks now live in the Action Points section above) */}
      {opportunities.length > 0 && (
        <FormSection title="Auto-Created Opportunities" icon="⚡" defaultOpen={false}>
          <div>
            {opportunities.map((o, i) => (
              <div key={i} style={{ padding: '8px 10px', background: 'var(--bg-elev)', borderRadius: 6, fontSize: 12, marginBottom: 4 }}>
                <span style={{ fontWeight: 500 }}>{String(o.product ?? '—')}</span>
                <span style={{ color: 'var(--fg-3)', marginLeft: 8 }}>{String(o.stage ?? '')} · {String(o.auto_source ?? '')}</span>
              </div>
            ))}
          </div>
        </FormSection>
      )}

      </div>{/* end actions */}

      {/* ── Sticky wizard navigation (pinned to the bottom of the page) ── */}
      <div className="wizard-nav" style={{
        position: 'sticky', bottom: 0, zIndex: 9, marginTop: 6,
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '12px 14px',
        background: 'var(--bg-paper)', border: '1px solid var(--line)',
        borderRadius: 12, boxShadow: '0 -4px 16px rgba(10, 22, 40, 0.06)',
      }}>
        <button
          type="button" onClick={() => goStep(step - 1)} disabled={step === 0}
          style={{
            padding: '11px 18px', borderRadius: 9, border: '1px solid var(--line-strong)',
            background: 'var(--bg-paper)', color: step === 0 ? 'var(--fg-3)' : 'var(--fg)',
            cursor: step === 0 ? 'not-allowed' : 'pointer', fontSize: 13, fontFamily: 'inherit',
            opacity: step === 0 ? 0.45 : 1, fontWeight: 600,
          }}
        >
          Back
        </button>
        <span style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
          {step + 1} / {steps.length}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}>
          {step < LAST ? (
            <button
              type="button" onClick={() => goStep(step + 1)}
              style={{
                padding: '11px 22px', borderRadius: 9, border: 'none', background: '#1A5CB8',
                color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
                boxShadow: '0 2px 8px rgba(26, 92, 184, 0.3)',
              }}
            >
              Next
            </button>
          ) : !isSubmitted ? (
            // A draft: submit to close it (if the viewer may edit).
            !disabled
              ? <SubmitVisitButton visitId={visit.id} />
              : <span style={{ fontSize: 12, color: 'var(--fg-3)' }}>🔒 View only</span>
          ) : reopened ? (
            // Already closed, re-opened for correction: no re-submit — just finish.
            <button
              type="button" onClick={() => setReopened(false)}
              style={{ padding: '11px 22px', borderRadius: 9, border: '1px solid var(--title, #0A3D8F)', background: 'var(--bg-paper)', color: 'var(--title, #0A3D8F)', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit' }}
            >
              Done editing
            </button>
          ) : (
            <span style={{ fontSize: 12, color: 'var(--fg-3)' }}>🔒 Closed{closedDate ? ` on ${closedDate}` : ''} — read only</span>
          )}
        </div>
      </div>
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
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-label={`${title} section, ${open ? 'expanded' : 'collapsed'}`}
        onClick={() => setOpen(!open)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o); } }}
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
          <span style={{ fontSize: 12, color: 'var(--warn)' }}>{error}</span>
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
  report, visitId, disabled, queueSave, hasComplaints, setHasComplaints, part = 'all',
}: {
  report: Record<string, unknown> | null;
  visitId: string; disabled: boolean;
  queueSave: (field: string, value: unknown) => void;
  hasComplaints: boolean; setHasComplaints: (v: boolean) => void;
  part?: 'all' | 'pumps' | 'commercial';
}) {
  const SCREW_APPS = ['molasses', 'magma', 'syrup', 'massecuite', 'melt', 'dosing', 'other'];
  const ROTA_APPS  = ['magma', 'massecuite'];

  const sugarField = (col: string) => Number(report?.[col] ?? 0);

  // Each Yes/No toggle needs its OWN controlled state — binding `value` to the
  // static report data left these stuck on their initial value when clicked.
  const [hasOutstanding, setHasOutstanding] = useState(!!(report?.has_outstanding_issues));
  const [pricesCaptured, setPricesCaptured] = useState(!!(report?.competitor_prices_captured));

  const showPumps = part === 'all' || part === 'pumps';
  const showCommercial = part === 'all' || part === 'commercial';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {showPumps && (<>
      {/* RIL Screw counts */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--title)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>RIL Screw Pumps Installed</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {SCREW_APPS.map(app => (
            <div key={app} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'capitalize', marginBottom: 4 }}>{app}</div>
              <input
                type="number" inputMode="numeric" min={0}
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
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--title)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>RIL Rota Pumps Installed</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {ROTA_APPS.map(app => (
            <div key={app} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'capitalize', marginBottom: 4 }}>{app}</div>
              <input
                type="number" inputMode="numeric" min={0}
                defaultValue={sugarField(`ril_rota_${app}`)}
                disabled={disabled}
                onChange={e => queueSave(`ril_rota_${app}`, parseInt(e.target.value) || 0)}
                style={{ ...INP, width: 60, textAlign: 'center' }}
              />
            </div>
          ))}
        </div>
      </div>
      </>)}

      {showCommercial && (<>
      {/* Commercial discussion */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--title)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Commercial Discussion</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
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
      </>)}
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
                fontFamily: 'inherit', border: value === v ? '2px solid var(--title)' : '1px solid var(--line-strong)',
                background: value === v ? 'var(--accent-soft)' : 'var(--bg-paper)',
                color: value === v ? 'var(--title)' : 'var(--fg-3)', fontWeight: value === v ? 600 : 400,
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
            <div style={{ fontSize: 11, color: 'var(--warn)', background: 'var(--warn-soft)', padding: '4px 8px', borderRadius: 4, marginBottom: 6 }}>
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

// ── Expansion / New Business ───────────────────────────────────

function ExpansionOpportunityForm({ visitId, clientId, clientName, repId, isClosed, existingOpp }: {
  visitId: number;
  clientId: number;
  clientName: string;
  repId: number | null;
  isClosed: boolean;
  existingOpp: ExpansionOpp | null;
}) {
  const [hasExpansion, setHasExpansion] = useState(!!existingOpp);
  const [product, setProduct]           = useState(existingOpp?.product ?? '');
  const [productType, setProductType]   = useState(existingOpp?.product_type ?? 'PCP');
  const [stage, setStage]               = useState(existingOpp?.stage ?? 'Suspect');
  const [valueInr, setValueInr]         = useState(
    existingOpp?.value_cr ? String(Math.round(parseFloat(String(existingOpp.value_cr)) * 10_000_000)) : '',
  );
  const [probability, setProbability]   = useState(existingOpp?.probability != null ? String(existingOpp.probability) : '20');
  const [etaText, setEtaText]           = useState(existingOpp?.eta_text ?? '');
  const [quoteRef, setQuoteRef]         = useState(existingOpp?.quote_ref ?? '');
  const [notes, setNotes]               = useState(existingOpp?.notes ?? '');

  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted   = useRef(false);

  // Debounced live upsert: the opportunity is created/updated as the form is
  // filled and deleted when toggled to No. Skips the initial mount so opening
  // an existing report doesn't immediately re-write it.
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    if (isClosed) return;
    clearTimeout(saveTimer.current);
    const snapshot = {
      visitId, clientId, repId, hasExpansion,
      product: product.trim() || `Expansion — ${clientName}`,
      productType, stage,
      valueInr: valueInr ? parseFloat(valueInr) : null,
      probability: probability ? parseInt(probability, 10) : 20,
      etaText: etaText || null,
      quoteRef: quoteRef || null,
      notes: notes || null,
    };
    saveTimer.current = setTimeout(() => { saveExpansionOpportunity(snapshot).catch(() => {}); }, 900);
    return () => clearTimeout(saveTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasExpansion, product, productType, stage, valueInr, probability, etaText, quoteRef, notes]);

  const toggleStyle = (active: boolean): CSSProperties => ({
    padding: '6px 16px', borderRadius: 6,
    border: `1px solid ${active ? 'var(--brand-blue)' : 'var(--line-strong)'}`,
    background: active ? 'var(--brand-blue)' : 'var(--bg-paper)',
    color: active ? '#fff' : 'var(--fg-2)',
    fontSize: 13, fontWeight: 500,
    cursor: isClosed ? 'default' : 'pointer',
  });

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 13, color: 'var(--fg)' }}>
          Any expansion plans or new installation opportunity?
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" disabled={isClosed} onClick={() => setHasExpansion(true)} style={toggleStyle(hasExpansion)}>Yes</button>
          <button type="button" disabled={isClosed} onClick={() => setHasExpansion(false)} style={toggleStyle(!hasExpansion)}>No</button>
        </div>
      </div>

      {hasExpansion && (
        <div style={{ padding: 16, background: 'var(--bg-elev)', borderRadius: 8, border: '1px solid var(--accent-line)', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ padding: '8px 12px', background: 'var(--accent-soft)', borderRadius: 6, fontSize: 12, color: 'var(--brand-blue)', fontWeight: 500 }}>
            ⚡ An opportunity in <strong>{stage}</strong> stage is saved automatically as you fill this in.
            {existingOpp && (
              <span style={{ marginLeft: 8, color: 'var(--pos)' }}>· Saved (OPP-{String(existingOpp.id).padStart(4, '0')})</span>
            )}
          </div>

          <div>
            <label style={LBL}>Product / Description</label>
            <Input
              placeholder="e.g. PCP × 3 MX-80 · Spent Wash (leave blank for auto-title)"
              value={product}
              onChange={e => setProduct(e.target.value)}
              disabled={isClosed}
            />
            <div style={{ fontSize: 10, color: 'var(--fg-3)', marginTop: 3 }}>
              Leave blank to use: &quot;Expansion — {clientName}&quot;
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={LBL}>Product Type</label>
              <select value={productType} onChange={e => setProductType(e.target.value)} disabled={isClosed} style={INP}>
                {['PCP', 'MMP', 'Spares', 'Service', 'Other'].map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label style={LBL}>Stage</label>
              <select value={stage} onChange={e => setStage(e.target.value)} disabled={isClosed} style={INP}>
                {['Suspect', 'Prospect', 'Quoted', 'Negotiating'].map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={LBL}>Value (₹)</label>
              <Input type="number" inputMode="numeric" step="1" min="0" placeholder="e.g. 2500000" value={valueInr} onChange={e => setValueInr(e.target.value)} disabled={isClosed} />
              <div style={{ fontSize: 10, color: 'var(--fg-3)', marginTop: 3 }}>Full amount in rupees</div>
            </div>
            <div>
              <label style={LBL}>Probability %</label>
              <Input type="number" inputMode="numeric" min="0" max="100" value={probability} onChange={e => setProbability(e.target.value)} disabled={isClosed} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={LBL}>Expected Close</label>
              <Input placeholder="e.g. Jun 2026 or Q3 FY27" value={etaText} onChange={e => setEtaText(e.target.value)} disabled={isClosed} />
            </div>
            <div>
              <label style={LBL}>Quote Reference</label>
              <Input placeholder="e.g. Q-2024-018" value={quoteRef} onChange={e => setQuoteRef(e.target.value)} disabled={isClosed} />
            </div>
          </div>

          <div>
            <label style={LBL}>Notes</label>
            <Textarea placeholder="Key context, next steps…" value={notes} onChange={e => setNotes(e.target.value)} disabled={isClosed} rows={2} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Action Points sub-components ───────────────────────────────

const TASK_PRIORITY_COLORS: Record<string, { bg: string; text: string }> = {
  High:   { bg: 'var(--neg-soft)',  text: 'var(--neg)'  },
  Medium: { bg: 'var(--warn-soft)', text: 'var(--warn)' },
  Low:    { bg: 'var(--pos-soft)',  text: 'var(--pos)'  },
};

function TaskRow({ task, isClosed, onComplete, onDelete }: {
  task: TaskItem;
  isClosed: boolean;
  onComplete: (id: number, status: 'open' | 'completed') => void;
  onDelete: (id: number) => void;
}) {
  const isOverdue = !!task.due_date && task.status === 'open' && new Date(task.due_date) < new Date();
  const pc = TASK_PRIORITY_COLORS[task.priority ?? 'Medium'] ?? TASK_PRIORITY_COLORS.Medium;

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 0',
      borderBottom: '1px solid var(--line-2)',
      opacity: task.status === 'completed' ? 0.6 : 1,
    }}>
      {!isClosed && (
        <input
          type="checkbox"
          checked={task.status === 'completed'}
          onChange={() => onComplete(task.id, task.status === 'open' ? 'completed' : 'open')}
          style={{ marginTop: 3, flexShrink: 0 }}
        />
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 500, color: 'var(--fg)',
          textDecoration: task.status === 'completed' ? 'line-through' : 'none',
        }}>
          {task.title}
        </div>
        {task.description && (
          <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 2 }}>{task.description}</div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 5, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 10, background: pc.bg, color: pc.text }}>
            {task.priority ?? 'Medium'}
          </span>
          {task.due_date && (
            <span style={{
              fontSize: 11, fontFamily: 'var(--font-mono)',
              color: isOverdue ? 'var(--neg)' : 'var(--fg-3)', fontWeight: isOverdue ? 600 : 400,
            }}>
              📅 {isOverdue ? 'Overdue · ' : ''}
              {new Date(task.due_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
            </span>
          )}
          <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>
            → {task.assigned_rep_name ?? task.assigned_to_external ?? 'Unassigned'}
          </span>
          {task.created_by === 'system' && (
            <span style={{ fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: 4, background: 'var(--accent-soft)', color: 'var(--brand-blue)' }}>
              AUTO
            </span>
          )}
        </div>
      </div>

      {!isClosed && task.status !== 'completed' && (
        <button
          type="button"
          onClick={() => onDelete(task.id)}
          aria-label="Delete action point"
          style={{ background: 'none', border: 'none', color: 'var(--fg-3)', cursor: 'pointer', fontSize: 16, padding: '0 4px', flexShrink: 0 }}
        >
          ×
        </button>
      )}
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────

const LBL: CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--fg-2)',
  textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 5,
};

const INP: CSSProperties = {
  display: 'block', width: '100%', padding: '8px 10px',
  border: '1px solid var(--line-strong)', borderRadius: 6,
  fontSize: 13, fontFamily: 'inherit', background: 'var(--bg-paper)',
  color: 'var(--fg)', outline: 'none', boxSizing: 'border-box',
};
