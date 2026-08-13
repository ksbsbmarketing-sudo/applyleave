# Halang permohonan cuti bertindih — same dates applied twice

**Date:** 2026-08-13
**Status:** design approved, awaiting implementation plan

## Problem

Staff can submit the same leave twice. HR is currently looking at a pending queue that contains duplicate MC applications — same dates, same reason, same proof document — from the same person.

Nothing stops it. The submit handler at `src/main.js:4919` validates dates, balances, approvers and proof, then writes straight to Firestore at `src/main.js:5073` without ever looking at what the applicant has already applied for.

There are two distinct ways a duplicate gets in, and only fixing one of them leaves the other open:

1. **Accidental double-submit.** The submit button is never disabled. Between the click and the write there is a Cloudinary upload (`src/main.js:5028`) that takes seconds on a clinic connection, with no spinner and no visual feedback. A second click during that window runs the whole handler again. Both runs read the same `leaveRecords` snapshot, both pass every check, and both write — with different `id: Date.now()` values, so nothing collides. This produces exactly the signature HR reported: identical dates, identical reason, and a proof file that is the same document uploaded twice.
2. **Deliberate or forgetful re-application.** Staff applies Monday, sees nothing happen (or forgets), applies again Wednesday for the same dates.

An overlap check alone does not fix (1) — two handler runs racing inside the same second both read a `leaveRecords` array that predates either write. A submit lock alone does not fix (2). Both are needed.

## Goal

A staff member cannot hold two live leave applications whose dates overlap. Attempting it is blocked at the form with a message naming the application that is in the way. Duplicates that are **already** in the pending queue are flagged on the approver's card so HR can find and reject the extras.

## Non-goals

- **No cleanup migration.** Existing duplicates in Firestore are not deleted or merged by a script. The approver badge surfaces them; a human decides which one survives. Bulk-deleting leave records on a hunch is not something this design will do.
- **No `firestore.rules` change.** See [Limitation](#limitation).
- **No change to approval routing, balances, notice policy, or WhatsApp/Inbox notifications.** This design only adds a gate before the existing flow and a badge on top of it.
- **No overlap check across different staff.** Two nurses on leave the same week is a staffing question, not a duplicate. Out of scope.

## Decisions

Settled during design, recorded here so the implementation does not re-litigate them:

| Question | Decision |
|---|---|
| What counts as a duplicate? | **Any date overlap** — not just an exact date match, and not scoped to the same leave type. Having MC for 5–7 Aug blocks AL for 6 Aug. |
| Which existing records block? | **All statuses except `REJECTED` and `CANCELLED`.** A rejected application must not stop the staff member from re-applying. |
| Hard block or warn-and-continue? | **Hard block, no override**, for every role. The message tells the applicant to cancel the original first. |
| Approver-side warning? | **Yes** — a badge on the approval card, because it is the only thing that helps with the duplicates already sitting in the queue. |

Statuses in use are `PENDING`, `TL APPROVED`, `HOD APPROVED`, `HOD RECOMMENDED` (legacy), `APPROVED`, `REJECTED`, `CANCELLED`. The rule is written as a **deny-list of two**, not an allow-list of five, so a status added later blocks by default instead of silently opening a hole.

## Current state

`leaveRecords` is a module-level array in `src/main.js`, kept live by an `onSnapshot` over the whole `leaves` collection (`src/main.js:3708`). Every record the check needs is already in memory. The check costs no Firestore read and no quota — which matters on this project, where the daily Spark quota has been exhausted before.

The relevant points in the submit handler, in order:

| `src/main.js` | What happens |
|---|---|
| 4919 | `submit` listener starts; reads dates, reason, handover |
| 4928–4932 | `computeLeaveDays`, aborts if no working days |
| 4936–4961 | AL split / EL overflow `alert()` dialogs |
| 4966–4973 | Proof-file required check |
| 4987–5001 | TL / HOD approver required checks |
| 5007–5011 | Advance-notice policy |
| 5019–5043 | **Cloudinary upload** — the slow part |
| 5073 | `setDoc` |

## Design

### 1. New module `src/leaveOverlap.js`

A pure module — no Firebase, no DOM — following `src/leaveDays.js` and `src/masterLogScope.js`, which are pure for exactly this reason: they can be unit-tested without an emulator.

```js
// Statuses that do NOT block a new application. Deliberately a deny-list:
// a new status added later blocks by default rather than opening a hole.
export const NON_BLOCKING_STATUSES = Object.freeze(['REJECTED', 'CANCELLED']);

export function isBlockingStatus(status) { … }

// Dates are stored as 'YYYY-MM-DD', so string comparison is date comparison.
// No Date parsing, and therefore no timezone class of bug.
export function datesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart <= bEnd && bStart <= aEnd;
}

// Live records for `ic` whose dates overlap [startDate, endDate].
export function findOverlappingLeaves(records, ic, startDate, endDate, { excludeId } = {}) { … }

// Does this record overlap any OTHER live record of the same staff member?
export function overlapsOtherLeaves(records, record) { … }

// Human-readable list for an alert or a badge. `labelOf` maps a type code to
// its display name — injected, not imported, to keep this module app-free.
export function describeOverlaps(records, labelOf) { … }
```

Guard conditions, each of which has to be deliberate rather than incidental:

- A record missing `startDate` or `endDate` is **skipped, not treated as overlapping**. Old or partially-written records must not permanently lock a staff member out of applying.
- `ic` is compared as a trimmed string; `status` is uppercased and trimmed before the deny-list test.
- `excludeId` compares as a string (`id` is a number in records but arrives as a string from some call sites).
- If `ic`, `startDate` or `endDate` is missing from the *query*, the function returns `[]` — the caller's own validation is responsible for those, and this module must not become a second, silent validator.

`describeOverlaps` takes the type-label resolver as an argument rather than importing `leaveCategories`, keeping the module free of app state.

### 2. Block the apply form

The call goes in the submit handler **immediately after the `diffDays <= 0` check (`src/main.js:4932`)** — before the AL/EL balance dialogs, before the approver checks, and critically **before the Cloudinary upload**.

Placement is the whole point:

- The applicant does not click through two or three `alert()` dialogs about split leave and approvers only to be rejected at the end.
- No file is uploaded to Cloudinary for an application that will never exist. A blocked submit costs nothing.

```js
const _overlaps = findOverlappingLeaves(leaveRecords, user.ic, startDate, endDate);
if (_overlaps.length > 0) {
  alert('🔴 PERMOHONAN BERTINDIH\n\n' +
        'Anda sudah ada permohonan cuti untuk tarikh ini:\n\n' +
        describeOverlaps(_overlaps, _typeLabel) + '\n\n' +
        'Permohonan baharu tidak boleh dihantar. Sila batalkan permohonan asal ' +
        'terlebih dahulu jika anda perlu mengubah tarikh.');
  return;
}
```

The message names the blocking record's type, dates and status, so the applicant knows what to go and cancel instead of guessing.

**Trap to avoid:** `leaveTypeName` is a *function* imported from `src/leaveTypes.js` (`src/main.js:7`), but inside this handler it is shadowed by a local `const leaveTypeName` holding the **current** application's name as a string (`src/main.js:4922`). Passing it to `describeOverlaps` would label every conflicting record with the wrong type. The label resolver must be bound outside the shadow — e.g. `const _typeLabel = (code) => leaveCategories.find(c => c.id === code)?.name || code;` defined at module scope, or the imported `leaveTypeName` aliased at import. The same shadowing exists at `src/main.js:2479`, `2659`, `2695`, `2716` and `2741`.

### 3. Lock the submit button

A module-level `leaveSubmitting` flag plus a disabled button. The leave form's submit button is at `src/main.js:6685`.

```js
if (leaveSubmitting) return;          // top of the handler, before anything else
…                                     // all validation, all early returns
leaveSubmitting = true;               // set only once submission is certain
const _btn = leaveForm.querySelector('button[type="submit"]');
if (_btn) { _btn.disabled = true; _btn.style.opacity = '0.6'; _btn.textContent = 'Menghantar…'; }
try {
  …                                   // Cloudinary upload, setDoc, notifications
} finally {
  leaveSubmitting = false;
  if (_btn) { _btn.disabled = false; _btn.style.opacity = ''; }
}
```

Two details that decide whether this actually works:

- The flag is set **after** all validation, not at the top of the handler. Setting it early means a validation failure leaves the form locked until re-render.
- The reset lives in `finally`, so a Cloudinary failure or a Firestore error returns the button to the applicant. The happy path ends in `render()` (`src/main.js:5151`), which rebuilds the DOM and discards the button anyway — the `finally` exists for the failure paths.

This is what closes the race that the overlap check cannot: two clicks in the same second both read a `leaveRecords` array that predates either write, so both pass the overlap check. The lock is the real fix for the reported symptom; the overlap check is the fix for the deliberate case.

### 4. Overlap badge on the approval card

On the approval card (`src/main.js:7197–7229`, rendered per record in the `managementTab === 'pending'` grid), call `overlapsOtherLeaves(leaveRecords, req)`. When it returns matches, render a red strip below the existing stage indicator:

```
⚠️ BERTINDIH — staf ini ada permohonan lain untuk tarikh sama:
   MC 2026-08-05 → 2026-08-07 (PENDING)
```

Styled to match the existing indicator strip at `src/main.js:7217` — same padding, radius and typography, with the danger palette (`rgba(239,68,68,0.1)` background, `#dc2626` text) so it reads as a warning and not as another stage label.

The badge appears on **both** sides of a duplicate pair, which is correct: the approver sees two cards, both flagged, and rejects one. This is what resolves the duplicates already in the queue today, and it needs no migration.

### 5. Edit form

The edit modal's save path (`src/main.js:5280–5314`) can move a record's dates onto another live application. It runs the same check with `excludeId: editingLeaveId`, so a record never conflicts with itself:

```js
const _editOverlaps = findOverlappingLeaves(leaveRecords, rec.ic, elStart, elEnd,
                                            { excludeId: editingLeaveId });
```

Placed after the existing `elDays > 0` check (`src/main.js:5296`) and before `updates` is built. The `ic` comes from `rec.ic`, not `user.ic` — HR and approvers edit other people's records here.

The same hard block applies. HR was not given an override: the design decision was "no override for any role", and an HR user who genuinely needs overlapping records can cancel one first.

### 6. Data flow

1. Applicant fills the form and submits.
2. Working-days check passes.
3. **Overlap check against `leaveRecords` (in memory, zero reads).** Blocked → alert naming the conflicting record, handler returns, nothing uploaded, nothing written.
4. Balance / approver / notice / proof validation as today.
5. **Submit lock engages**; button disabled.
6. Cloudinary upload → `setDoc` → notifications, as today.
7. `onSnapshot` (`src/main.js:3708`) delivers the new record; the next application by the same staff member sees it.
8. Approver opens Management → Pending; any card overlapping another live record of the same staff member carries the ⚠️ badge.

### 7. Error handling

- **Overlap found on apply** → alert, `return`. No Cloudinary call, no Firestore write, no notification. The form keeps its values so the applicant can change the dates.
- **Overlap found on edit** → alert, `return`, modal stays open with values intact.
- **Malformed records** (missing dates, missing `ic`) → skipped by the matcher. Worst case they fail to block something; they can never lock a staff member out of applying.
- **Cloudinary or Firestore failure after the lock engages** → existing alerts (`src/main.js:5040`, `src/main.js:5078`); `finally` re-enables the button so the applicant can retry.

## Limitation

The check is client-side only. `firestore.rules` cannot express it: rules can `get()` a single known document but cannot run a **query**, and finding overlapping leave for a staff member is inherently a query. Enforcing it server-side would need either a maintained per-staff index document (an extra write on every application, on a Spark quota that has been exhausted twice) or a Cloud Function (Blaze only — this project is on Spark).

This is accepted, not overlooked. It matches the posture of HR zone scoping and the proof-file requirement, both of which are client-side. The realistic threat here is a tired staff member double-clicking a button, not someone opening DevTools to forge a duplicate MC that an approver will see flagged anyway.

## Testing

**Unit — `tests/leaveOverlap.test.mjs`** (`node --test`, following `tests/masterLogScope.test.mjs`):

- Identical dates overlap; partial overlap at either end overlaps; a range fully containing another overlaps.
- Adjacent-but-separate ranges (`…-07` then `…-08`) do **not** overlap — the off-by-one that would block legitimate back-to-back leave.
- Single-day leave overlaps a range containing it.
- `REJECTED` and `CANCELLED` records never block; `PENDING`, `TL APPROVED`, `HOD APPROVED`, `HOD RECOMMENDED` and `APPROVED` all block.
- An unknown/new status blocks (deny-list behaviour is asserted, not assumed).
- Status matching tolerates lowercase and surrounding whitespace.
- A different `ic` never blocks.
- `excludeId` removes the record itself, given both a numeric and a string id.
- Records missing `startDate`/`endDate` are skipped rather than throwing or matching.
- Empty/missing query arguments return `[]`.
- `NON_BLOCKING_STATUSES` is frozen against mutation by a caller.

**Manual, after deploy** — clear the service worker cache first; stale SW has masked deploys on this project before:

1. Apply MC 5–7 Aug → succeeds. Apply AL 6 Aug → blocked, alert names the MC record and its status.
2. Cancel the MC, re-apply AL 6 Aug → succeeds.
3. Have an approver reject an application, then re-apply the same dates → succeeds.
4. Double-click submit hard on a slow connection with a proof file attached → exactly one record created, button visibly disabled during the upload.
5. Break the network mid-upload → error alert, button re-enabled, retry works.
6. Open Management → Pending on an account that can see the existing duplicate MC pair → both cards show the ⚠️ badge naming the other. Reject one → the badge disappears from the survivor.
7. Edit an existing application's dates onto another live application → blocked. Edit it onto free dates → succeeds.
8. Regression: a normal single application still uploads proof, writes, and fires the WhatsApp/Inbox notifications unchanged.
