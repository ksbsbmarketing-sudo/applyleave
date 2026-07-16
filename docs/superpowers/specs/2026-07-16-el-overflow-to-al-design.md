# EL Overflow → Annual Leave (Option B) — Design

**Date:** 2026-07-16
**Status:** Approved (design), pending implementation plan
**Author:** brainstorming session

## Problem

Emergency/Compassionate Leave (`EL`, "Kecemasan Ehsan") is modelled as its own
3-day yearly bucket, completely separate from Annual Leave (`AL`). When a staff
member takes EL, only the EL balance drops; AL is never touched. Clinic policy is
that **once the 3-day EL bucket is exhausted, further EL days should be deducted
from Annual Leave** (Option B: keep the EL bucket, spill the excess into AL).

Today `getLeaveStats(user, 'AL')` only sums records whose `type === 'AL'`
(`src/main.js:4044`), so EL records (`type === 'EL'`) never affect AL.

## Chosen approach: computed spillover (not record-split)

The existing AL → Unpaid ("SPLIT LEAVE DETECTED", `src/main.js:5290-5300`) split is
**compute-only**: it appends an informational note to the WhatsApp message but stores
the record whole (`type:'AL', days:full`) and lets the balance clamp at 0. No separate
Unpaid record is created.

EL → AL overflow follows the same model:

- EL leave records stay `type:'EL', days:full`. **No new records are created.**
- The "overflow" is derived inside `getLeaveStats` and subtracted from the AL balance.

Rejected alternative: splitting an EL application into an EL record + an AL record.
Rejected because it diverges from the established AL/Unpaid precedent, complicates the
approval/print/report flows, and would require reconciling two records per application.

## Scope

- **Applies to `EL` only** (Kecemasan Ehsan). `EL_EMG` (Kecemasan Am) is a separate
  bucket and is unchanged.
- Overflow spills **only into AL**. If AL is also insufficient, the AL balance simply
  clamps at 0 — there is **no** automatic cascade into Unpaid Leave for EL overflow
  (out of scope). The apply-time warning still surfaces this case (see §3).

## 1. Overflow formula

Overflow is computed **cumulatively per leave year** (EL is a yearly 3-day bucket),
year-scoped exactly like the current `getLeaveStats`.

Per the design decision, overflow includes **every** deduction that reduces the EL
balance — including HR `el_pelarasan`:

```
D_EL       = el_used_pre + el_used_sistem + el_pelarasan   // el_used_sistem = auto records OR manual adj, per autoSystemUsage
elOverflow = max(0, D_EL - ent_EL)                         // days beyond the 3-day bucket
```

Note: exactly one of `bal_EL` (> 0) or `elOverflow` (> 0) can be non-zero, because
`bal_EL = max(0, ent_EL - D_EL)` and `elOverflow = max(0, D_EL - ent_EL)`.

`D_EL` and `ent_EL` are already derivable from the existing `getLeaveStats(staff,'EL')`
return: `D_EL = usedPre + used + pelarasan`, `ent_EL = ent`.

## 2. Effect on AL balance

`getLeaveStats(staff, 'AL')` gains one additional deduction:

```
bal_AL = max(0, ent_AL_total - usedPre_AL - usedSys_AL - pelarasan_AL - elOverflow)
```

Implementation: within `getLeaveStats`, only when `type === 'AL'`, recursively call
`getLeaveStats(staff, 'EL', leaveYear)` (the EL branch never recurses back into AL, so
this terminates), derive `elOverflow`, and subtract it before the final clamp.

The AL stats object gains a new field `elOverflow` (default 0) so the dashboard, print
form and reports can display *why* AL dropped.

**No changes needed** in the consumers below — they read `getLeaveStats('AL').bal` and
therefore pick up the reduced balance automatically:
- SENARAI BILANGAN CUTI / HR Baki report
- Tutup Tahun year-end rollover & AL carry-forward (`src/yearEnd.js`,
  `computeYearEndRollover`)
- AL → Unpaid split at AL application time (`src/main.js:5290`) — now sees the reduced
  AL balance, so applying AL after an EL overflow behaves correctly.

## 3. Apply-time warning (EL application)

When a staff submits an `EL` application, before saving:

```
elBal  = getLeaveStats(user,'EL').bal      // remaining EL bucket (approved records only)
fromEL = min(diffDays, elBal)
toAL   = diffDays - fromEL                  // overflow into AL
```

- If `toAL > 0`: show an `alert` — e.g. *"Baki EL anda tinggal X hari. Permohonan Y hari
  ini akan ditolak Z hari dari EL dan W hari dari Cuti Tahunan (AL)."*
- Append an `*EL OVERFLOW*` note to `leaveBreakdown` (the WhatsApp `copyText`), mirroring
  the existing `*SPLIT LEAVE DETECTED*` AL pattern.
- If `toAL` also exceeds the current AL balance, add a line:
  *"⚠️ Baki AL juga tidak mencukupi (baki AL: N hari)."* — informational only; no
  Unpaid record is created, AL just clamps at 0.

This is informational only and does **not** block submission (consistent with the AL
flow today). `elBal` uses approved-records-only, consistent with how the AL split reads
its balance.

## 4. Print form (`src/leaveBalance.js` / `printLeave`)

- **EL form:** `BAKI CUTI` continues to clamp at 0 when the bucket is exhausted — correct,
  the EL bucket really is empty. No change.
- **AL form:** `printLeave` for an AL record folds `elOverflow` into the `alAdj` baseline,
  alongside the existing `usedPre` + `pelarasan`:
  ```js
  alAdj: (stats.usedPre||0) + (stats.pelarasan||0) + (stats.elOverflow||0)
         + (autoSystemUsage ? 0 : (stats.usedSysAdj||0))
  ```
  This keeps the printed AL `BAKI CUTI` consistent with the dashboard. `elOverflow` is
  treated as a flat baseline adjustment, exactly like `pelarasan` is treated today. The
  pre-existing "running balance is exact only for the most recent leave" caveat still
  applies (it is not a new regression).

## Testing

`src/leaveBalance.js` is pure and unit-testable. Add/extend unit coverage for:

1. EL usage within the 3-day bucket → `elOverflow === 0`, AL unchanged.
2. EL usage exceeding 3 days → `elOverflow === D_EL - ent_EL`, AL reduced by that amount.
3. `el_pelarasan` contributes to overflow (per decision).
4. EL overflow larger than AL balance → `bal_AL` clamps at 0, never negative.
5. Overflow is year-scoped (an EL record in a prior leave year does not spill into this
   year's AL).
6. Apply-time split math: `fromEL`/`toAL` for the boundary cases (exactly at bucket edge,
   fully over, fully within).

Where the overflow logic lives in `getLeaveStats` (DOM/Firebase-coupled), factor the pure
arithmetic into a small helper so it can be unit-tested without the browser, mirroring the
`recordBalances` split already used by `leaveBalance.js`.

## Out of scope

- EL_EMG overflow.
- Automatic Unpaid Leave cascade when AL is also exhausted by EL overflow.
- Any change to EL/AL entitlement values or the manual/auto usage toggle.
