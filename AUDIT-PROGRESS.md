# Audit progress

**Status: INCOMPLETE — stopped by session usage limit (resets 20:20 Asia/Dubai).**
Read-only audit. No code was modified.

The parallel audit workflow launched 22 mappers/auditors + 4 verifiers + 1 critic.
26 of 27 died on the session limit within ~5 minutes (2.2M tokens consumed). One
auditor completed: the dedicated pass over `app/actions/risansi.ts`. Its findings
were salvaged from the workflow journal and the four HIGH ones were then
re-verified by hand against the live code (not taken on the agent's word).

## Batch status

| Batch | Scope | Status |
|---|---|---|
| audit:actions-core | app/actions/risansi.ts (2048 ln) | **REVIEWED** — 23 findings, salvaged |
| map:arch | architecture as built | PENDING (died on limit) |
| map:data | data model vs live schema | PENDING |
| map:journeys | user journeys | PENDING |
| map:authx | auth model + secrets | PENDING |
| audit:actions-rest | app/actions/* except risansi.ts | PENDING |
| audit:api-platform | auth/cron/debug-db routes | PENDING |
| audit:api-domain | app/api/risansi/** (~26 routes) | PENDING |
| audit:pages-shell | layouts, root, admin shell | PENDING |
| audit:pages-dashboard | dashboard, field, registry | PENDING |
| audit:pages-clients | clients list + [id] 360 | PENDING |
| audit:pages-pipeline | pipeline board, stage, compete | PENDING |
| audit:pages-ops | revenue, exec-review, visits, print, mobile | PENDING |
| audit:pages-admin | app/risansi/admin/** | PENDING |
| audit:comp-1..4 | components/risansi/** (A–Z) | PENDING |
| audit:comp-ui | components/ui/** | PENDING |
| audit:lib-1..2 | lib/** | PENDING |
| audit:infra | migrations, scripts, config | PENDING |

319 source files total; 1 reviewed. **~0.3% coverage. This is not a completed audit.**

## Confirmed findings so far (all in app/actions/risansi.ts)

Re-verified by hand against the current code:

1. **HIGH · IDOR on contact PII** — `addContact` / `updateContact` / `deleteContact`
   (~L315) call only `requireSession()`. `deleteContact(contactId, clientId)` runs
   `DELETE FROM contacts WHERE id = $1` with no `canViewClient(clientId)` check and
   no check the contact belongs to the client. Any authenticated rep can read,
   edit or delete any client's contact by guessing an integer id. CONFIRMED.

2. **HIGH · Unauthenticated data exposure** — `listSalesOrders(oppId)` (L1432) and
   `listPurchaseOrders(oppId)` (~L1507) are exported `'use server'` actions with
   NO session check and NO ownership check. Every server action is a callable
   endpoint, so anyone can enumerate SO/PO commercial data by opportunity id.
   CONFIRMED.

3. **HIGH→MEDIUM · Won/Lost deletable, cascades to SOs** — `deleteOpportunity`
   (L1568) DOES check `userCanEditOpp` (the finding's authz framing was wrong —
   downgraded), but has no Won/Lost stage guard. Every edit path locks Won/Lost;
   delete does not. `opportunity_sales_orders` is `ON DELETE CASCADE` (migration
   0029), so an editable Won deal and all its Sales Orders can be hard-deleted,
   irreversibly, bypassing the lock. Data-integrity, not authz. CONFIRMED (repro
   path), severity adjusted.

4. **MEDIUM · updateOpportunity NULL-wipe on partial forms** — `candidates` (L1334+)
   defaults almost every column to `null` when the form omits it
   (`quote_ref: formData.get('quote_ref') || null`, etc.). A partial submitter
   (e.g. OppCompletionModal) would blank fields it doesn't send. Same class as the
   quotation COALESCE fix already shipped. CONFIRMED pattern; NEEDS-CHECK on which
   live callers submit partial forms (OppCompletionModal re-sends several fields,
   suggesting a fragile existing workaround).

Full salvaged list (23: 4 HIGH, 10 MEDIUM, 9 LOW) is in the workflow journal at
`.claude/.../subagents/workflows/wf_73573011-6ba/` and the scratchpad copy
`audit-actions-core.json`.

## How to resume

After the limit resets (20:20 Asia/Dubai), resume with the null-bug already fixed:

```
Workflow({ scriptPath: ".../workflows/scripts/full-codebase-audit-wf_73573011-6ba.js", resumeFromRunId: "wf_73573011-6ba" })
```

Resume replays the one cached agent (actions-core) instantly and re-runs the ~40
others live. **Caveat:** a full run is ~2.2M tokens and re-tripped the same limit.
Better to split into 3–4 smaller Workflow runs (e.g. maps+actions first, then
api+pages, then components+lib+infra), each well under the limit, and merge.
