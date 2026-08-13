# Duplikat cuti yang sudah diluluskan — halang dan dedahkan

**Date:** 2026-08-13
**Status:** design approved, awaiting implementation plan
**Builds on:** `2026-08-13-leave-overlap-prevention-design.md` (branch `feat/leave-overlap-prevention`)

## Problem

The overlap guard shipped on `feat/leave-overlap-prevention` blocks new duplicate applications and flags duplicates in the pending queue. It does not reach duplicates that are already `APPROVED`.

The approval-card badge is the feature's only remediation surface, and the pending grid filters `APPROVED` out (`src/main.js` pending-tab filter). So an approved duplicate is invisible everywhere.

This is not hypothetical. Running the matcher over the 138 records in `data/leaves.json` finds exactly one overlapping pair, and it is approved on both sides:

```
ADRIANA ATHIRAH BINTI AZMI — EL_EMG 2026-07-18 → 2026-07-18 (APPROVED)
                           — EL_EMG 2026-07-18 → 2026-07-18 (APPROVED)
```

One day, two records, both approved. The double-click signature described in the parent spec.

That pair is harmless to balances — `EL_EMG` is not in `FORMULA_B_TYPES` (`src/leaveBalance.js`). An approved duplicate `AL`, `MC`, `EL` or `CME` pair would not be: `getLeaveStats` sums approved records, so the staff member would be charged twice for one absence.

## Goal

Two halves, both required. Either alone leaves the problem live:

1. **Prevent.** No new approved duplicate can be created. Advancing a leave record whose dates overlap an already-approved leave is blocked.
2. **Surface.** The approved duplicates already in Firestore are visible where HR actually looks, so a human can cancel one.

Surfacing without preventing means HR cleans up while new ones keep arriving. Preventing without surfacing leaves the ADRIANA pair hidden until someone stumbles on it.

## Non-goals

- **No cleanup migration.** Consistent with the parent spec: nothing deletes or merges records automatically. HR decides which of a pair survives, using the existing audit-trailed cancel action.
- **No change to the parent feature.** The apply-form block, submit lock, approval-card badge and edit-form block all stay exactly as built.
- **No new Management tab.** The RBAC table is a hardcoded `roles[]` array, so a new tab needs an RBAC entry to be visible at all. Master Logs already exists, is already zone-scoped, and is already where HR reviews approved records.
- **No `firestore.rules` change**, for the reason given in the parent spec: rules cannot run queries.

## Decisions

Settled during design:

| Question | Decision |
|---|---|
| Prevent, surface, or both? | **Both.** |
| What triggers the block? | Overlap with a record that is already **`APPROVED`** — not merely live. Two competing *pending* applications do not block each other; HR approves the right one and rejects the other. |
| Override for HR? | **None.** Consistent with the apply form and edit form. |
| Which approval stages are blocked? | **All of them** — see below. |
| Where do existing duplicates surface? | **Master Logs**: a row marker plus a filter button. |

### Why the block covers every stage, not just final approval

`window.finalizeLeave` (`src/main.js:2470`) is the single entry point for every approval transition — Team Leader support (`TL APPROVED`), HOD/Supervisor support (`HOD APPROVED`), and HR's final `APPROVED`.

The natural place for a "final approval only" guard is after `newStatus` is computed, just before the write at `src/main.js:2617`. **That is too late.** The stage branches send WhatsApp before the write — `src/main.js:2503` (to Supervisors), `:2512` and `:2598` (to the applicant). A guard there would block the database write *after* the applicant had already received "cuti anda telah diluluskan" on WhatsApp. The system would have told a staff member their leave was approved and then not approved it.

So the guard goes at the **top of the function**, before any branch and before any notification. At that point `newStatus` does not exist yet, which means the guard cannot distinguish stages — and does not need to. If a record overlaps an already-approved leave, advancing it is wrong at every stage; a Team Leader supporting it is the same error caught earlier. Blocking early is both simpler and safer than restructuring the notification order.

Consequence, accepted deliberately: a TL or HOD who hits this block cannot resolve it themselves — only HR can cancel the conflicting record. The alert says so.

## Current state

`src/leaveOverlap.js` is 69 lines with six exports and 32 passing tests:

```
NON_BLOCKING_STATUSES, isBlockingStatus, datesOverlap,
findOverlappingLeaves, overlapsOtherLeaves, describeOverlaps
```

Master Logs (`src/main.js:7703` onward) renders `_mlRecords` — `leaveRecords` passed through `filterByScope` for the viewer's zone and the selected state/branch tabs. The table body is at `src/main.js:7805-7845`, one `<tr>` per record.

**The edit path needs no work, and this was verified rather than assumed.** HR can set a status directly to `APPROVED` through the edit modal's dropdown (`src/main.js:5306`). But the overlap check added to that modal by the parent spec runs on *every* save and blocks on any live overlap regardless of which field changed — so flipping a duplicate's status to `APPROVED` there is already refused. `finalizeLeave` is the only unguarded route to `APPROVED`.

## Design

### 1. Two additions to `src/leaveOverlap.js`

The module stays pure — no imports, no app state.

```js
// Rekod yang SUDAH DILULUSKAN dan bertindih. Untuk sekatan kelulusan:
// hanya APPROVED yang menghalang, bukan sekadar rekod hidup.
export function findApprovedOverlaps(records, ic, startDate, endDate, opts = {}) { … }

// Semua rekod hidup yang bertindih, dikumpulkan sekali gus.
// Map: id rekod → senarai rekod lain yang bertindih dengannya.
export function findOverlapGroups(records) { … }
```

`findApprovedOverlaps` filters `findOverlappingLeaves`' result to `APPROVED`. It lives in the module rather than as a `.filter()` at the call site so that status normalisation — trimming and upper-casing, which the module already does — stays owned in one place.

`findOverlapGroups` exists for performance, and the reason is specific. Master Logs renders every in-scope record; calling `overlapsOtherLeaves` per row scans the entire `leaveRecords` array per row, which is O(n²) over the whole collection on **every render** — and `render()` fires on every Firestore snapshot. At 138 records that is invisible; at a few thousand it is not.

`findOverlapGroups` instead groups by `ic` in one pass, then compares pairwise only within each staff member's own records. Staff hold few records each, so the pairwise part is effectively linear in the collection.

This is the same correction the file already carries for the Master Logs branch counters, whose comment at `src/main.js:7717-7726` records the earlier lesson ("Kiraan per-tab dalam SATU laluan sahaja … bukan ~15 laluan penuh atas leaveRecords pada setiap render"). This design follows it rather than re-learning it.

Both functions inherit the module's existing rules unchanged: `REJECTED`/`CANCELLED` never participate, records missing dates are skipped rather than matched, dates compare as `'YYYY-MM-DD'` strings.

### 2. The approval block

At the very top of `window.finalizeLeave` (`src/main.js:2470`) — after the record is resolved, alongside the existing `canManageRequest` permission guard at `:2475`, and **before** the Doctor/locum check, before every stage branch, and before every WhatsApp call.

```
⛔ TIDAK BOLEH DILULUSKAN — BERTINDIH

Staf ini sudah ada cuti DILULUSKAN untuk tarikh yang sama:

  • Cuti Kecemasan — 2026-07-18 (APPROVED)

Meluluskan permohonan ini akan menolak baki dua kali.
Sila batalkan rekod yang bertindih itu terlebih dahulu.
```

The alert names the conflicting record's type, dates and status via the existing `describeOverlaps`, so the approver knows exactly what to go and cancel. Hard block, every role, no override.

### 3. Master Logs

**Row marker.** Rows whose id is in the overlap Map get a red left border and a `⚠️ BERTINDIH` chip under the staff name, in the row's existing Employee cell (`src/main.js:7812-7815`). The danger palette matches the approval-card badge from the parent feature, so the two read as the same warning.

**Filter button.** One button joins the existing branch tab row (`src/main.js:7788`): `⚠️ Bertindih (N)`, toggling a `masterLogOverlapOnly` flag that narrows the table to flagged rows. It sits with the branch tabs because it is the same kind of control — a view narrowing — and needs no new layout.

**Zone scoping is not optional here.** The count `N` and the filtered rows are both computed from `_mlRecords` — the list already narrowed by the viewer's zone *and* by the selected state and branch tabs — never from raw `leaveRecords`. A Pahang HR must not see a Terengganu count. The last five commits on `main` before this work were all about zone-scoping Master Logs; this feature participates in that boundary rather than quietly stepping around it.

This deliberately differs from the existing branch-tab counters beside it, which ignore the current branch tab so their numbers stay stable as you click between tabs (`src/main.js:7717-7726`). The overlap button is not a per-tab counter but a filter on the current view: `N` means "of the rows you are looking at now, N overlap", and pressing it narrows to exactly those rows. Making it ignore the branch tab would produce a button reading `(2)` that filtered to nothing.

One consequence worth stating: pairing is computed within whatever is currently in view, so a pair split across two branches or two zones would not be detected while a narrowing tab is active. Staff belong to one branch, so overlapping records for one person share a branch and this is unreachable in practice — and the alternative, pairing across the whole collection, would leak record details across the zone boundary the parent work just established. The boundary wins.

### 4. Data flow

1. `onSnapshot` updates `leaveRecords` → `render()`.
2. Master Logs branch builds `_mlRecords` (zone-scoped) as it does today, then calls `findOverlapGroups(_mlRecords)` once.
3. The Map drives both the row markers and the filter count. Filtering re-uses the same Map — no second scan.
4. An approver clicks Luluskan → `finalizeLeave` → `findApprovedOverlaps` → blocked with the alert, or proceeds into the existing untouched flow.
5. HR cancels one of the pair → `CANCELLED` is non-blocking → the marker clears from the survivor and the approval unblocks, both on the next render.

### 5. Error handling

- **Block fires** → alert, `return`. No write, no WhatsApp, no Inbox notification, no audit entry — the guard precedes all of them.
- **Malformed records** (missing dates, missing `ic`) → skipped by the matcher, as in the parent feature. They can fail to flag something; they can never block an approval that should succeed.
- **Empty overlap Map** → the filter button shows `(0)`; no rows are marked.

## Limitation

Client-side, for the same reason as the parent feature: Firestore rules cannot run queries. Inherited knowingly, not overlooked.

One residual gap this design does **not** close: it prevents and surfaces, but does not repair. The ADRIANA pair stays double-recorded until a human cancels one. That is the deliberate choice from the parent spec — an automated cleanup that picks a survivor by rule would be guessing at which record is real.

## Testing

**Unit — added to `tests/leaveOverlap.test.mjs`** (`node --test`, joining the existing 32):

- `findApprovedOverlaps` returns an approved overlapping record; ignores overlapping `PENDING`, `TL APPROVED`, `HOD APPROVED` and `HOD RECOMMENDED` records; ignores `REJECTED`/`CANCELLED`; honours `excludeId`; tolerates lowercase and padded `'approved'`.
- `findApprovedOverlaps` returns `[]` for a **non-overlapping** approved record — the mutation-killing case. Without it, an implementation that ignored dates entirely would pass.
- `findOverlapGroups` maps both members of a pair to each other; returns an empty Map when nothing overlaps; never groups records belonging to different `ic` values; excludes `REJECTED`/`CANCELLED` from groups; skips records missing dates; and — the boundary that matters — does **not** group adjacent-but-separate ranges.
- `findOverlapGroups` handles a staff member with three mutually overlapping records, so each maps to the other two.

**Manual, after deploy** — clear the service worker cache first:

1. Open Master Logs as HR. The ADRIANA `EL_EMG` pair (18 July 2026) shows the ⚠️ marker on both rows.
2. The `⚠️ Bertindih (2)` button filters the table to exactly those two rows.
3. As Pahang HR and as Terengganu HR, confirm the count reflects only the viewer's own zone.
4. Cancel one of the pair → the marker clears from the other, and the count drops to 0.
5. Create two overlapping pending applications (via HR edit, since the apply form now blocks them), approve the first → succeeds. Approve the second → blocked, alert names the first, and confirm the applicant received **no** WhatsApp for the blocked attempt.
6. Regression: a normal single approval still advances through TL → HOD → HR with all its notifications intact.
