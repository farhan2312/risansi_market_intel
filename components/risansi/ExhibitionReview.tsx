'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { fmtInr, fmtInrFull, type ExhibitionStatus } from '@/lib/risansi-exhibition-fields';
import {
  updateMeetingCompany, setMeetingFollowUp,
  reviewExhibitionExpenses, closeExhibition, reopenExhibition, saveExhibitionReview,
  type FollowUpType,
} from '@/app/actions/risansi-exhibitions';
import type { MeetingRow, ExpenseRow, ReviewRow } from './ExhibitionDetail';
import type { UserOpt } from './ExhibitionsClient';

/**
 * The post-event review, worked meeting by meeting.
 *
 * Three things happen here and they happen in order: every meeting gets a
 * decision, the expenses get signed off, and then the exhibition is closed for
 * good. Only the person who proposed the exhibition may do it — they are the one
 * accountable for what it cost and what it produced.
 */

export interface ReviewMeeting extends MeetingRow {
  follow_up_type: FollowUpType | null;
  follow_up_owner_id: number | null;
  follow_up_owner_name: string | null;
  follow_up_note: string | null;
  linked_visit_id: number | null;
  linked_task_id: number | null;
  linked_opportunity_id: number | null;
}

const DISPOSITIONS: { value: FollowUpType; label: string; needsClient: boolean; hint: string }[] = [
  { value: 'None',        label: 'No follow-up needed', needsClient: false, hint: 'Closes this meeting off with no further work.' },
  { value: 'Visit',       label: 'Schedule a visit',    needsClient: true,  hint: 'Creates a planned visit in the Field calendar.' },
  { value: 'Action',      label: 'Assign an action',    needsClient: false, hint: 'Creates a task in their Action Registry.' },
  { value: 'Opportunity', label: 'Raise an opportunity', needsClient: true, hint: 'Creates a Suspect-stage opportunity in the pipeline.' },
];

export function ExhibitionReviewWorkbench({
  exhibitionId, status, meetings, expenses, users,
  expensesReviewedAt, closedAt, closedByName, isOwner, isSysadmin, blockers, hasReview, review,
}: {
  exhibitionId: number; status: ExhibitionStatus;
  meetings: ReviewMeeting[]; expenses: ExpenseRow[]; users: UserOpt[];
  expensesReviewedAt: string | null; closedAt: string | null; closedByName: string | null;
  isOwner: boolean; isSysadmin: boolean; blockers: string[]; hasReview: boolean;
  review: ReviewRow | null;
}) {
  const closed = status === 'Closed';
  const decided = meetings.filter(m => m.follow_up_type != null).length;

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      {closed && <ClosedBanner closedAt={closedAt} closedByName={closedByName}
        exhibitionId={exhibitionId} isSysadmin={isSysadmin} />}

      {!isOwner && !closed && (
        <div style={{ ...NOTE, background: 'var(--bg-elev)', border: '1px solid var(--line)' }}>
          Only the person who proposed this exhibition can complete the review. You can read it here.
        </div>
      )}

      {/* Step 1 — meetings */}
      <section>
        <StepHead n={1} title="Decide each meeting"
          done={meetings.length > 0 && decided === meetings.length}
          sub={`${decided} of ${meetings.length} decided`} />
        {meetings.length === 0 ? (
          <div style={PANEL}><div style={BLANK}>No meetings were captured at this exhibition.</div></div>
        ) : (
          <div style={PANEL}>
            <div style={{ overflowX: 'auto' }}>
              <table className="exh-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>{['Company', 'Contact', 'Interest', 'Potential', 'Follow-up', 'Assigned to', 'Result'].map(h => (
                    <th key={h} style={TH}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {meetings.map(m => (
                    <MeetingReviewRow key={m.id} exhibitionId={exhibitionId} meeting={m}
                      users={users} editable={isOwner && !closed} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* Step 2 — expenses */}
      <section>
        <StepHead n={2} title="Sign off the expenses" done={!!expensesReviewedAt}
          sub={expensesReviewedAt ? `Signed off ${expensesReviewedAt.slice(0, 10)}` : `${expenses.length} line(s)`} />
        <ExpenseSignOff exhibitionId={exhibitionId} expenses={expenses}
          reviewedAt={expensesReviewedAt} editable={isOwner && !closed} />
      </section>

      {/* Step 3 — the summary, last because it summarises the two steps above */}
      <section>
        <StepHead n={3} title="Final summary" done={hasReview}
          sub={hasReview ? 'Saved' : 'Pre-filled from the records above'} />
        <SummaryForm exhibitionId={exhibitionId} review={review} meetings={meetings}
          editable={isOwner && !closed} />
      </section>

      {/* Step 4 — close */}
      <section>
        <StepHead n={4} title="Close the exhibition" done={closed}
          sub={closed ? 'Closed — read only' : 'Locks everything for good'} />
        <ClosePanel exhibitionId={exhibitionId} blockers={blockers} hasReview={hasReview}
          closed={closed} editable={isOwner && !closed} />
      </section>
    </div>
  );
}

// ── One meeting ──────────────────────────────────────────────────

function MeetingReviewRow({ exhibitionId, meeting: m, users, editable }: {
  exhibitionId: number; meeting: ReviewMeeting; users: UserOpt[]; editable: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');
  const [type, setType] = useState<FollowUpType>(m.follow_up_type ?? 'None');
  const [owner, setOwner] = useState<string>(m.follow_up_owner_id ? String(m.follow_up_owner_id) : '');
  const [due, setDue]   = useState(m.follow_up_date ?? '');
  const [note, setNote] = useState(m.follow_up_note ?? '');
  const [value, setValue] = useState(m.potential_value_inr != null ? String(m.potential_value_inr) : '');

  const def = DISPOSITIONS.find(d => d.value === type)!;
  const blockedNoClient = def.needsClient && m.client_id == null;

  async function save() {
    setBusy(true); setErr('');
    try {
      await setMeetingFollowUp(exhibitionId, m.id, {
        type, ownerId: owner ? Number(owner) : null,
        dueDate: due || null, note: note || null,
        valueInr: value ? Number(String(value).replace(/[₹,\s]/g, '')) : null,
      });
      setOpen(false); router.refresh();
    } catch (e) {
      const raw = e instanceof Error ? e.message : '';
      const redacted = !raw || /unexpected response|Server Components render/i.test(raw)
        || Boolean((e as { digest?: string })?.digest);
      setErr(redacted ? 'Could not save this follow-up.' : raw);
    } finally { setBusy(false); }
  }

  const result = m.linked_visit_id ? 'Visit planned'
    : m.linked_task_id ? 'Action assigned'
    : m.linked_opportunity_id ? 'Opportunity raised'
    : m.follow_up_type === 'None' ? 'No follow-up'
    : null;

  return (
    <>
      <tr style={{ borderTop: '1px solid var(--line)' }}>
        <td data-label="Company" style={{ ...TD, minWidth: 200 }}>
          <CompanyCell exhibitionId={exhibitionId} meeting={m} editable={editable} />
        </td>
        <td data-label="Contact"  style={TD}>{m.contact_person || '—'}</td>
        <td data-label="Interest" style={TD}>{m.interest || '—'}</td>
        <td data-label="Potential" style={{ ...TD, fontFamily: 'var(--font-mono)' }}>{fmtInr(m.potential_value_inr)}</td>
        <td data-label="Follow-up" style={TD}>
          {m.follow_up_type
            ? <span style={{ fontWeight: 600 }}>{DISPOSITIONS.find(d => d.value === m.follow_up_type)?.label ?? m.follow_up_type}</span>
            : <span style={{ color: 'var(--neg)' }}>Not decided</span>}
        </td>
        <td data-label="Assigned to" style={TD}>{m.follow_up_owner_name || '—'}</td>
        <td data-label="Result" style={TD}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {result && <span style={DONE_PILL}>{result}</span>}
            {editable && (
              <button onClick={() => setOpen(o => !o)} style={LINK_BTN}>
                {open ? 'Close' : m.follow_up_type ? 'Change' : 'Decide'}
              </button>
            )}
          </div>
        </td>
      </tr>

      {open && (
        <tr>
          <td colSpan={7} style={{ padding: 0 }}>
            <div style={{ padding: 14, background: 'var(--bg-elev)', borderTop: '1px solid var(--line)' }}>
              <div className="exh-2col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={LABEL}>What happens next</label>
                  <select value={type} onChange={e => { setType(e.target.value as FollowUpType); setErr(''); }} style={INPUT}>
                    {DISPOSITIONS.map(d => (
                      <option key={d.value} value={d.value}
                        disabled={d.needsClient && m.client_id == null}>
                        {d.label}{d.needsClient && m.client_id == null ? ' — needs a known client' : ''}
                      </option>
                    ))}
                  </select>
                  <p style={HINT}>{def.hint}</p>
                </div>
                {type !== 'None' && (
                  <div>
                    <label style={LABEL}>Assign to</label>
                    <select value={owner} onChange={e => setOwner(e.target.value)} style={INPUT}>
                      <option value="">— Select —</option>
                      {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </div>
                )}
              </div>

              {(type === 'Visit' || type === 'Action') && (
                <div className="exh-2col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
                  <div>
                    <label style={LABEL}>{type === 'Visit' ? 'Visit date' : 'Due date'}</label>
                    <input type="date" value={due} onChange={e => setDue(e.target.value)} style={INPUT} />
                  </div>
                  <div>
                    <label style={LABEL}>{type === 'Action' ? 'What to do' : 'Note'}</label>
                    <input value={note} onChange={e => setNote(e.target.value)} style={INPUT}
                      placeholder={type === 'Action' ? 'e.g. Send the spares quotation' : 'Optional'} />
                  </div>
                </div>
              )}

              {type === 'Opportunity' && (
                <div className="exh-2col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
                  <div>
                    <label style={LABEL}>What they want</label>
                    <input value={note} onChange={e => setNote(e.target.value)} style={INPUT}
                      placeholder="e.g. 2 × PCP for molasses" />
                  </div>
                  <div>
                    <label style={LABEL}>Estimated value (₹)</label>
                    <input value={value} onChange={e => setValue(e.target.value)} inputMode="decimal" style={INPUT} />
                    <p style={HINT}>Starts at Suspect — a stand conversation is a lead, not a quotation.</p>
                  </div>
                </div>
              )}

              {blockedNoClient && (
                <div style={{ ...ERR, marginTop: 10 }}>
                  {m.company_name} is not in the client master, so a {type.toLowerCase()} cannot be raised.
                  Correct the company name above until it matches, or assign an action instead.
                </div>
              )}
              {err && <div style={{ ...ERR, marginTop: 10 }}>{err}</div>}

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                <button onClick={() => setOpen(false)} style={BTN_GHOST}>Cancel</button>
                <button onClick={save} disabled={busy || blockedNoClient || (type !== 'None' && !owner)}
                  style={{ ...BTN_PRIMARY, opacity: busy || blockedNoClient || (type !== 'None' && !owner) ? 0.55 : 1 }}>
                  {busy ? 'Saving…' : 'Save follow-up'}
                </button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * The company name, correctable here. A name typed badly at a stand is also a
 * missed match, so fixing it is the moment the meeting can finally be linked to
 * the client it always belonged to — which is what unlocks a visit or an
 * opportunity for it.
 */
function CompanyCell({ exhibitionId, meeting: m, editable }: {
  exhibitionId: number; meeting: ReviewMeeting; editable: boolean;
}) {
  const router = useRouter();
  const [edit, setEdit] = useState(false);
  const [name, setName] = useState(m.company_name);
  const [clientId, setClientId] = useState<number | null>(m.client_id);
  const [matched, setMatched] = useState<string | null>(m.client_code);
  const [hits, setHits] = useState<Array<{ id: number; code: string | null; legal_name: string; city: string | null; exact: boolean }>>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!edit) return;
    if (timer.current) clearTimeout(timer.current);
    const q = name.trim();
    if (q.length < 2) { setHits([]); return; }
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/risansi/exhibitions/client-lookup?q=${encodeURIComponent(q)}`);
        if (!res.ok) { setHits([]); return; }
        const d = await res.json();
        setHits(Array.isArray(d.matches) ? d.matches : []);
      } catch { setHits([]); }
    }, 250);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [name, edit]);

  async function save() {
    setBusy(true); setErr('');
    try {
      await updateMeetingCompany(exhibitionId, m.id, name, clientId);
      setEdit(false); router.refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not save.'); }
    finally { setBusy(false); }
  }

  if (!edit) {
    return (
      <div>
        <div style={{ fontWeight: 600, color: 'var(--title)' }}>{m.company_name}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
          {m.client_id != null
            ? <span style={KNOWN_PILL}>✓ {m.client_code ?? 'client'}</span>
            : <span style={NEW_PILL}>not in client master</span>}
          {editable && <button onClick={() => setEdit(true)} style={LINK_BTN}>rename</button>}
        </div>
      </div>
    );
  }

  return (
    <div>
      <input value={name} onChange={e => { setName(e.target.value); setClientId(null); setMatched(null); }}
        style={{ ...INPUT, minWidth: 190 }} autoFocus aria-label="Company name" />
      {matched && <div style={{ marginTop: 4 }}><span style={KNOWN_PILL}>✓ linked · {matched}</span></div>}
      {!matched && hits.length > 0 && (
        <div style={{ marginTop: 4, maxHeight: 150, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 6 }}>
          {hits.slice(0, 5).map(h => (
            <button key={h.id} type="button"
              onClick={() => { setClientId(h.id); setMatched(h.code ?? h.legal_name); setName(h.legal_name); setHits([]); }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 8px',
                       background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}>
              {h.legal_name}<span style={{ color: 'var(--fg-3)' }}>{h.code ? ` · ${h.code}` : ''}</span>
            </button>
          ))}
        </div>
      )}
      {err && <div style={{ ...ERR, marginTop: 6 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <button onClick={save} disabled={busy} style={{ ...BTN_PRIMARY, padding: '5px 10px', fontSize: 12 }}>
          {busy ? '…' : 'Save'}
        </button>
        <button onClick={() => { setEdit(false); setName(m.company_name); setClientId(m.client_id); setMatched(m.client_code); }}
          style={{ ...BTN_GHOST, padding: '5px 10px', fontSize: 12 }}>Cancel</button>
      </div>
    </div>
  );
}

// ── Final summary ────────────────────────────────────────────────

/**
 * Sits last, because it summarises the two steps above it.
 *
 * The countable fields arrive already filled from the records themselves: leads
 * worth pursuing is how many meetings were given a real follow-up, opportunities
 * raised is how many actually became one, and potential business is the sum of
 * what was captured at the stand. Nobody should be re-counting rows they have
 * just finished working through — and a hand-typed count would be the number that
 * quietly disagrees with the table above it.
 *
 * Every prefilled value stays editable: the derived figure is a starting point,
 * not a verdict. Only what genuinely cannot be derived — business actually won,
 * footfall, and the written judgement — starts blank.
 */
function SummaryForm({ exhibitionId, review, meetings, editable }: {
  exhibitionId: number; review: ReviewRow | null; meetings: ReviewMeeting[]; editable: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');
  const [edit, setEdit] = useState(!review);

  const derived = {
    // "Worth pursuing" = we decided to do something about it.
    newLeads: meetings.filter(m => m.follow_up_type && m.follow_up_type !== 'None').length,
    opportunities: meetings.filter(m => m.linked_opportunity_id != null).length,
    potential: meetings.reduce((s, m) => s + Number(m.potential_value_inr ?? 0), 0),
  };
  // A saved review wins over the derived figure — someone may have corrected it.
  const val = (saved: number | null | undefined, auto: number) =>
    saved != null ? String(saved) : auto ? String(auto) : '';

  if (!editable && !review) {
    return <div style={PANEL}><div style={BLANK}>The summary has not been filled in yet.</div></div>;
  }

  if (!edit && review) {
    return (
      <div style={{ ...PANEL, padding: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
          <Fig label="New leads"       v={review.new_leads?.toString() ?? '—'} />
          <Fig label="Opportunities"   v={review.opportunities?.toString() ?? '—'} />
          <Fig label="Potential"       v={review.potential_value_inr != null ? fmtInrFull(review.potential_value_inr) : '—'} />
          <Fig label="Business won"    v={review.business_won_inr != null ? fmtInrFull(review.business_won_inr) : '—'} />
          <Fig label="Footfall"        v={review.footfall?.toString() ?? '—'} />
          <Fig label="Attend next year" v={review.attend_next_year ?? '—'} />
        </div>
        <div style={{ display: 'grid', gap: 8, marginTop: 14 }}>
          <Note k="Worked well"  v={review.what_worked} />
          <Note k="Did not work" v={review.what_did_not} />
          <Note k="Learnings"    v={review.key_learnings} />
          <Note k="Competitors"  v={review.competitor_notes} />
        </div>
        <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 12 }}>
          Saved by {review.reviewed_by_name ?? '—'}{review.reviewed_at ? ` on ${review.reviewed_at.slice(0, 10)}` : ''}
        </div>
        {editable && <button onClick={() => setEdit(true)} style={{ ...BTN_GHOST, marginTop: 10 }}>Edit summary</button>}
      </div>
    );
  }

  return (
    <div style={{ ...PANEL, padding: 16 }}>
      <form className="exh-form" action={async fd => {
        setBusy(true); setErr('');
        try { await saveExhibitionReview(exhibitionId, fd); setEdit(false); router.refresh(); }
        catch (e) {
          const raw = e instanceof Error ? e.message : '';
          const redacted = !raw || /unexpected response|Server Components render/i.test(raw)
            || Boolean((e as { digest?: string })?.digest);
          setErr(redacted ? 'Could not save the summary.' : raw);
        } finally { setBusy(false); }
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>
            The counts below are filled in from the meetings and expenses you just worked through.
            Change any of them if you disagree.
          </div>

          <div className="exh-2col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Fld label="New leads worth pursuing" hint={`${derived.newLeads} meeting(s) given a follow-up`}>
              <input name="new_leads" inputMode="numeric" style={INPUT}
                defaultValue={val(review?.new_leads, derived.newLeads)} />
            </Fld>
            <Fld label="Opportunities raised" hint={`${derived.opportunities} raised from this review`}>
              <input name="opportunities" inputMode="numeric" style={INPUT}
                defaultValue={val(review?.opportunities, derived.opportunities)} />
            </Fld>
          </div>

          <div className="exh-2col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Fld label="Potential business (₹)" hint="Summed from what was captured at the stand">
              <input name="potential_value_inr" inputMode="decimal" style={INPUT}
                defaultValue={val(review?.potential_value_inr, derived.potential)} />
            </Fld>
            <Fld label="Business actually won (₹)" hint="Leave blank until something closes">
              <input name="business_won_inr" inputMode="decimal" style={INPUT}
                defaultValue={review?.business_won_inr ?? ''} />
            </Fld>
          </div>

          <Fld label="Stand footfall"><input name="footfall" inputMode="numeric" style={INPUT} defaultValue={review?.footfall ?? ''} /></Fld>
          <Fld label="What worked well"><textarea name="what_worked" rows={2} style={{ ...INPUT, resize: 'vertical' }} defaultValue={review?.what_worked ?? ''} /></Fld>
          <Fld label="What did not work"><textarea name="what_did_not" rows={2} style={{ ...INPUT, resize: 'vertical' }} defaultValue={review?.what_did_not ?? ''} /></Fld>
          <Fld label="Key learnings"><textarea name="key_learnings" rows={2} style={{ ...INPUT, resize: 'vertical' }} defaultValue={review?.key_learnings ?? ''} /></Fld>
          <Fld label="Competitors seen"><textarea name="competitor_notes" rows={2} style={{ ...INPUT, resize: 'vertical' }} defaultValue={review?.competitor_notes ?? ''} /></Fld>

          <div className="exh-2col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Fld label="Attend next year?">
              <select name="attend_next_year" defaultValue={review?.attend_next_year ?? ''} style={INPUT}>
                <option value="">— Select —</option>
                {['Yes', 'No', 'Undecided'].map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </Fld>
            <Fld label="Notes for next year">
              <input name="next_year_notes" style={INPUT} defaultValue={review?.next_year_notes ?? ''} />
            </Fld>
          </div>

          {err && <div style={ERR}>{err}</div>}
          <div className="exh-actions" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            {review && <button type="button" onClick={() => setEdit(false)} style={BTN_GHOST}>Cancel</button>}
            <button type="submit" disabled={busy} style={BTN_PRIMARY}>{busy ? 'Saving…' : 'Save summary'}</button>
          </div>
        </div>
      </form>
    </div>
  );
}

function Fld({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={LABEL}>{label}</label>
      {children}
      {hint && <p style={HINT}>{hint}</p>}
    </div>
  );
}

function Note({ k, v }: { k: string; v: string | null }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{k}</div>
      <div style={{ fontSize: 12, color: 'var(--fg-2)', whiteSpace: 'pre-wrap' }}>
        {v || <span style={{ color: 'var(--fg-3)' }}>—</span>}
      </div>
    </div>
  );
}

// ── Expenses + close ─────────────────────────────────────────────

function ExpenseSignOff({ exhibitionId, expenses, reviewedAt, editable }: {
  exhibitionId: number; expenses: ExpenseRow[]; reviewedAt: string | null; editable: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');
  const n = (v: unknown) => { const x = Number(v ?? 0); return Number.isFinite(x) ? x : 0; };
  const est = expenses.reduce((s, x) => s + n(x.estimated_inr), 0);
  const act = expenses.reduce((s, x) => s + n(x.actual_inr), 0);
  const paid = expenses.reduce((s, x) => s + n(x.paid_inr), 0);
  const unpaid = expenses.filter(x => n(x.actual_inr) > n(x.paid_inr));
  const noInvoice = expenses.filter(x => !x.has_invoice);

  return (
    <div style={{ ...PANEL, padding: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, marginBottom: 12 }}>
        <Fig label="Estimated" v={fmtInrFull(est)} />
        <Fig label="Actual"    v={fmtInrFull(act)} />
        <Fig label="Paid"      v={fmtInrFull(paid)} />
        <Fig label="Outstanding" v={fmtInrFull(Math.max(0, act - paid))} warn={act > paid} />
      </div>

      {(unpaid.length > 0 || noInvoice.length > 0) && (
        <div style={{ ...NOTE, background: 'var(--neg-soft)', border: '1px solid var(--neg)', marginBottom: 12 }}>
          <b>These block closing:</b>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {unpaid.map(x => <li key={`u${x.id}`}>{x.category} — {fmtInrFull(n(x.actual_inr) - n(x.paid_inr))} still unpaid</li>)}
            {noInvoice.map(x => <li key={`i${x.id}`}>{x.category} — no invoice attached</li>)}
          </ul>
        </div>
      )}

      {reviewedAt ? (
        <div style={{ fontSize: 12, color: 'var(--pos-strong)' }}>✓ Expenses signed off on {reviewedAt.slice(0, 10)}</div>
      ) : editable ? (
        <>
          {err && <div style={{ ...ERR, marginBottom: 8 }}>{err}</div>}
          <button disabled={busy || unpaid.length > 0 || noInvoice.length > 0}
            title={unpaid.length || noInvoice.length ? 'Settle the lines listed above first' : undefined}
            onClick={async () => {
              setBusy(true); setErr('');
              try { await reviewExhibitionExpenses(exhibitionId); router.refresh(); }
              catch (e) { setErr(e instanceof Error ? e.message : 'Could not sign off.'); }
              finally { setBusy(false); }
            }}
            style={{ ...BTN_PRIMARY, opacity: busy || unpaid.length || noInvoice.length ? 0.55 : 1 }}>
            {busy ? 'Saving…' : '✓ Confirm these figures'}
          </button>
        </>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>Not signed off yet.</div>
      )}
    </div>
  );
}

function ClosePanel({ exhibitionId, blockers, hasReview, closed, editable }: {
  exhibitionId: number; blockers: string[]; hasReview: boolean; closed: boolean; editable: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');
  const [confirm, setConfirm] = useState(false);

  if (closed) return null;

  return (
    <div style={{ ...PANEL, padding: 16 }}>
      {blockers.length > 0 ? (
        <>
          <div style={{ fontSize: 13, color: 'var(--fg-2)', marginBottom: 8 }}>Still to do before closing:</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--fg-2)' }}>
            {blockers.map(b => <li key={b}>{b}</li>)}
          </ul>
        </>
      ) : !editable ? (
        <div style={{ fontSize: 13, color: 'var(--fg-3)' }}>Everything is ready. The exhibition owner can close it.</div>
      ) : !confirm ? (
        <>
          <div style={{ fontSize: 13, color: 'var(--fg-2)', marginBottom: 10 }}>
            Everything is done{hasReview ? '' : ' except the review'}. Closing locks the meetings,
            expenses and review permanently — only a sysadmin can reopen it.
          </div>
          <button onClick={() => setConfirm(true)} style={BTN_PRIMARY}>Close exhibition</button>
        </>
      ) : (
        <>
          <div style={{ fontSize: 13, color: 'var(--fg-2)', marginBottom: 10 }}>
            <b>Close this exhibition for good?</b> Nothing can be edited afterwards.
          </div>
          {err && <div style={{ ...ERR, marginBottom: 8 }}>{err}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setConfirm(false)} style={BTN_GHOST}>Cancel</button>
            <button disabled={busy} onClick={async () => {
              setBusy(true); setErr('');
              try { await closeExhibition(exhibitionId); router.refresh(); }
              catch (e) { setErr(e instanceof Error ? e.message : 'Could not close.'); setBusy(false); }
            }} style={BTN_PRIMARY}>{busy ? 'Closing…' : 'Yes, close it'}</button>
          </div>
        </>
      )}
    </div>
  );
}

function ClosedBanner({ closedAt, closedByName, exhibitionId, isSysadmin }: {
  closedAt: string | null; closedByName: string | null; exhibitionId: number; isSysadmin: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <div style={{ ...NOTE, background: 'var(--bg-elev)', border: '1px solid var(--line-strong)' }}>
      <b>🔒 Closed{closedAt ? ` on ${closedAt.slice(0, 10)}` : ''}{closedByName ? ` by ${closedByName}` : ''}.</b>
      {' '}Meetings, expenses and the review are read-only.
      {isSysadmin && (
        open ? (
          <div style={{ marginTop: 10 }}>
            <input value={reason} onChange={e => setReason(e.target.value)} style={INPUT}
              placeholder="Why is this being reopened? (recorded in the history)" />
            {err && <div style={{ ...ERR, marginTop: 8 }}>{err}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button onClick={() => setOpen(false)} style={BTN_GHOST}>Cancel</button>
              <button disabled={busy || !reason.trim()} onClick={async () => {
                setBusy(true); setErr('');
                try { await reopenExhibition(exhibitionId, reason); router.refresh(); }
                catch (e) { setErr(e instanceof Error ? e.message : 'Could not reopen.'); setBusy(false); }
              }} style={BTN_PRIMARY}>{busy ? 'Reopening…' : 'Reopen'}</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setOpen(true)} style={{ ...LINK_BTN, marginLeft: 8 }}>Reopen</button>
        )
      )}
    </div>
  );
}

// ── Bits ─────────────────────────────────────────────────────────

function StepHead({ n, title, sub, done }: { n: number; title: string; sub?: string; done?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
      <span style={{
        width: 22, height: 22, borderRadius: 999, display: 'inline-flex', alignItems: 'center',
        justifyContent: 'center', fontSize: 11, fontWeight: 700,
        background: done ? 'var(--pos-soft)' : 'var(--bg-elev)',
        color: done ? 'var(--pos-strong)' : 'var(--fg-3)',
      }}>{done ? '✓' : n}</span>
      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--title)' }}>{title}</span>
      {sub && <span style={{ fontSize: 12, color: 'var(--fg-3)' }}>· {sub}</span>}
    </div>
  );
}

function Fig({ label, v, warn }: { label: string; v: string; warn?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, marginTop: 2, color: warn ? 'var(--neg)' : 'var(--fg)' }}>{v}</div>
    </div>
  );
}

const PANEL: CSSProperties = { background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' };
const NOTE: CSSProperties = { padding: 12, borderRadius: 8, fontSize: 13, color: 'var(--fg-2)' };
const BLANK: CSSProperties = { padding: 26, textAlign: 'center', fontSize: 13, color: 'var(--fg-3)' };
const TH: CSSProperties = { padding: '9px 12px', textAlign: 'left', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500, color: 'var(--fg-3)', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' };
const TD: CSSProperties = { padding: '10px 12px', verticalAlign: 'top' };
const INPUT: CSSProperties = { width: '100%', padding: '8px 10px', border: '1px solid var(--line-strong)', borderRadius: 6, fontSize: 13, background: 'var(--bg-paper)', color: 'var(--fg)', boxSizing: 'border-box', fontFamily: 'inherit' };
const LABEL: CSSProperties = { fontSize: 11, fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 5 };
const HINT: CSSProperties = { fontSize: 11, color: 'var(--fg-3)', marginTop: 4 };
const BTN_PRIMARY: CSSProperties = { padding: '8px 16px', borderRadius: 6, background: '#0A3D8F', color: 'white', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500, fontFamily: 'inherit' };
const BTN_GHOST: CSSProperties = { padding: '8px 16px', borderRadius: 6, border: '1px solid var(--line-strong)', background: 'var(--bg-paper)', color: 'var(--fg-2)', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' };
const LINK_BTN: CSSProperties = { background: 'none', border: 'none', padding: 0, color: 'var(--accent)', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', textDecoration: 'underline' };
const ERR: CSSProperties = { padding: '8px 12px', background: 'var(--neg-soft)', border: '1px solid var(--neg)', borderLeft: '3px solid var(--neg)', borderRadius: 5, color: 'var(--neg-strong)', fontSize: 12 };
const KNOWN_PILL: CSSProperties = { padding: '1px 7px', borderRadius: 999, fontSize: 10, fontWeight: 600, background: 'var(--pos-soft)', color: 'var(--pos-strong)' };
const NEW_PILL: CSSProperties = { padding: '1px 7px', borderRadius: 999, fontSize: 10, background: 'var(--bg-elev)', color: 'var(--fg-3)' };
const DONE_PILL: CSSProperties = { padding: '1px 7px', borderRadius: 999, fontSize: 10, background: 'var(--accent-soft)', color: 'var(--title)' };
