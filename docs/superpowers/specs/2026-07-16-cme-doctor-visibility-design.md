# CME Leave Visibility for Doctors — Design

**Date:** 2026-07-16
**Status:** Approved (design), pending implementation plan
**Author:** brainstorming session

## Problem

CME (Continuing Medical Education) leave is **doctors-only**, max 5 days per calendar
year (`leaveCategories` id `CME`, entitlement 5, `src/main.js:656`). But there is no clear
"used vs remaining" view:

- **Hidden entitlement bug.** `getLeaveStats('CME')` falls back to the generic
  `leaveCategories` entitlement (5) for **any** staff when `ent_CME` is unset — so
  non-doctors get a phantom 5-day CME bucket, while doctors whose record was ever saved
  through the HR modal get `ent_CME = 0` written (the modal input defaults to 0,
  `src/main.js:10829`), which zeroes their balance and **hides the dashboard card**
  (the card only renders when `stats.ent > 0`, `src/main.js:6343`).
- **No HR breakdown.** Unlike AL/MC/EL, CME shows only a bare entitlement input in the HR
  modal's "other leaves" grid — HR cannot see used vs remaining.
- **No annual balance in reports.** The `SENARAI BILANGAN CUTI` report shows CME only as a
  *monthly* count column for doctors, never the annual balance.
- **No dedicated CME report.** There is no printable, doctor-focused CME report.

## Scope & decisions

- **CME is doctors-only** (`category === 'Doctor'`). Non-doctors: entitlement 0, no card, no
  modal block, not in the CME report.
- **Simple model (not Formula B).** Per decision, CME keeps a plain model: entitlement −
  in-system approved usage. **No** `cme_used_pre` / `cme_pelarasan` fields are introduced.
  `getLeaveStats('CME').used` continues to reflect approved CME records (AUTO mode; prod is
  AUTO). This is unchanged behavior — only the entitlement source and the surfaces change.
- **Data migration** clears stale `ent_CME` so the formula governs (mirrors the earlier
  `clear-ent-mc.js` precedent).
- **CME report is detailed** (per-doctor record-level dates), year-scoped to the current
  leave year.

## 1. `getEntitlementCME` + entitlement fix

New helper mirroring `getEntitlementMC` (`src/main.js:3994`):

```js
window.getEntitlementCME = function(staff) {
  if (!staff) return 0;
  if (staff.ent_CME !== undefined && staff.ent_CME !== null) return parseFloat(staff.ent_CME);
  return staff.category === 'Doctor' ? 5 : 0;
};
```

- `getLeaveStats` gains a `type === 'CME'` branch that sets `ent = window.getEntitlementCME(staff)`
  instead of the generic `leaveCategories` fallback. This fixes the non-doctor phantom-5 bug
  and gives doctors 5 by default.
- The HR modal's CME input default changes from `0` to `getEntitlementCME(staff)` so saving no
  longer clobbers a doctor's entitlement to 0.

### Migration: `fix-cme.js` (repo root)

One-off script (same shape as existing `clear-ent-mc.js`): for every staff doc, **delete the
`ent_CME` field** when `ent_CME === 0` **OR** `category !== 'Doctor'`. This lets
`getEntitlementCME` govern (doctors → 5, non-doctors → 0) and immediately restores doctors'
CME visibility. Doctors with an explicit custom override (`ent_CME > 0`) are left untouched.
Support a `--commit` flag (dry-run by default), printing affected docs.

## 2. Simple CME breakdown block in the HR modal (doctors only)

Replace the bare `ent-CME` input in the modal's "other leaves" grid (`src/main.js:10827-10830`)
with a small CME block, rendered **only when `getEntitlementCME(staff) > 0`** (i.e. doctors):

- **Peruntukan** — editable input `id="ent-CME"`, default `getEntitlementCME(staff)`,
  `oninput="window._recalcLeaveBalance('cme')"`.
- **Guna Dalam Sistem** — read-only, value = approved CME days this leave year
  (the same year-scoped count `getLeaveStats('CME').used` uses), carried in
  `id="cme-sys-used-display"` with `data-used="<n>"`.
- **Baki CME** — read-only `id="cme-balance-display"`.

This reuses the **existing** `window._recalcLeaveBalance(prefix)` (`src/main.js:1922`)
unchanged: for `prefix='cme'` it reads `ent-CME` (total), finds no `cme-used-pre-input` /
`cme-sys-adj-input` / `cme-pelarasan-input` (→ 0), reads `cme-sys-used-display`'s `data-used`,
and writes `max(0, total − 0 − used − 0)` into `cme-balance-display`. No new DB fields; the
save handler already persists `ent-CME`. Non-doctors: the block is not rendered at all.

## 3. "Baki CME" column in `SENARAI BILANGAN CUTI` (doctor section)

Both the print builder `generateAttendanceReport` (`renderRows`/`renderSection`,
`src/main.js:2783-2841`) and the on-screen `renderAttSection` (~`src/main.js:9034`) gain an
`isDoctor`-only extra column **Baki CME** after **Baki MC**:

- Header: append `${isDoctor ? '<th>Baki CME</th>' : ''}`.
- Row: compute `cmeSt = getLeaveStats(s, 'CME')` when `isDoctor`; append
  `${isDoctor ? '<td>' + fmtBal(cmeSt.bal, cmeSt.ent) + '</td>' : ''}` using the same
  `fmtBal` helper as Baki Cuti / Baki MC.
- `tfoot` colspan is adjusted so the footer spans the doctor section's extra column.

The non-doctor section is unchanged (no CME column).

## 4. Printable detailed CME report

New `window.printCMEReport()` and a **"🎓 Cetak Laporan CME"** button placed beside the
existing `SENARAI BILANGAN CUTI` print control in the HR reports area.

- Uses `window.printHeaderHTML({ title: 'LAPORAN CUTI CME — DOKTOR' })` (shared maroon
  corporate header — never hand-roll a header).
- Year scope: current leave year (`window.getCurrentLeaveYear()`), matching `getLeaveStats`.
- Iterates active doctors (`staffList.filter(s => s.category === 'Doctor' && !s.inactive)`),
  sorted by branch, then name.
- Per doctor:
  - Header line: `NAMA — Cawangan · Kelayakan: {ent} · Guna: {used} · Baki: {bal}`
    from `getEntitlementCME(s)` and `getLeaveStats(s, 'CME')`.
  - The doctor's **approved** CME records for the year (`leaveRecords` filtered by
    `ic`, `type === 'CME'`, `status === 'APPROVED'`, `leaveYearOf(r) === year`), each as
    `startDate–endDate · (N hari) · reason`. If none: `(tiada cuti CME direkodkan)`.
- Footer summary: total doctors, total CME days used, total CME balance.
- Opens a print window the same way the existing report print does.

## Testing

The pure, testable surface is small (main.js is DOM-coupled). Where practical:

- If `getEntitlementCME` can be exercised in isolation, add a unit test for the three cases
  (explicit override, doctor default 5, non-doctor 0). Otherwise verify via the app.
- Everything else (getLeaveStats CME branch, modal block, report column, print report,
  migration dry-run) is verified via `npm run build` plus manual checks in the running app,
  because these are DOM/Firestore-coupled.

Manual verification checklist:
1. Doctor with no saved `ent_CME` → dashboard shows CME 5/5; after an approved 2-day CME,
   shows 3/5; modal shows Peruntukan 5 / Guna 2 / Baki 3.
2. Non-doctor → no CME card, no CME modal block, not in CME report.
3. `SENARAI BILANGAN CUTI` doctor section shows a Baki CME column that matches the dashboard.
4. `printCMEReport()` lists each active doctor with correct Kelayakan/Guna/Baki and their
   dated CME records; doctors with no CME show the empty note.
5. `fix-cme.js` dry-run lists the docs it would change; `--commit` clears them and doctors
   immediately show 5.

## Out of scope

- CME Formula B fields (pre-system usage / HR pelarasan) — explicitly not wanted.
- CME for non-doctors.
- Changing the `autoSystemUsage` model.
