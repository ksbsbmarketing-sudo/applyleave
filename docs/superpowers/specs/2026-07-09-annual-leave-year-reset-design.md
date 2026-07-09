# Annual Leave-Year Reset ("Tutup Tahun")

**Date:** 2026-07-09
**Area:** Leave balance engine + HR management ("Tutup Tahun" action)
**Files:** `src/main.js` (getLeaveStats, HR UI, Firestore writes), new `src/yearEnd.js`
(pure rollover logic), `src/leaveBalance.js` (year-scope printed-form balances)

## Problem

Leave balances never reset per year. `getLeaveStats` counts "Guna Dalam Sistem"
from **all approved records ever**, and the per-staff balance fields
(`al_used_pre`, `al_pelarasan`, `al_used_sys_adj`, `ent_CF`, legacy `al_adj`) are a
**single set**, not per-year. So when 2027 begins, each staff's AL balance would still
be reduced by their 2026 usage, and entitlement would not refresh. The system started
in 2026, so this has not bitten yet — but it will at the first year rollover.

## Goal

Balances refresh each calendar year, with a controlled, HR-triggered year-end close
that carries forward unused AL (capped) and resets baselines for the new year.

## Policy (confirmed with user)

- **Leave year = calendar year (Jan–Dec).**
- **Usage is counted per leave year** (the year a leave is *taken*, by `startDate`).
- **AL carry-forward: max 3 days.** `ent_CF(next) = min(closingAL, 3)`; anything above
  3 is forfeited (hangus).
- **No carry-forward for any other type** (MC, EL, EL_EMG, CME, ML, ML_PL, HL, UP…):
  they start fresh each year with their annual entitlement.
- **Trigger = HR "Tutup Tahun" button** (not automatic). HR reviews a preview, then
  confirms. Not double-runnable for the same year.

## Design

### 1. Current leave year + year-scoped usage

- Add `getCurrentLeaveYear()` → `new Date().getFullYear()` (single source of truth).
- `getLeaveStats(staff, type, year = getCurrentLeaveYear())`:
  - The approved-records sum (`recordsUsed`) is filtered to records whose **leave year**
    (`new Date(r.startDate).getFullYear()`) equals `year`.
  - Everything else (entitlement, `ent_CF`, `used_pre`, `pelarasan`, `used_sys_adj`)
    is unchanged.
  - **Safety:** because every existing record is 2026 and the default year is 2026,
    the 2026 numbers are byte-for-byte identical to today. This is the critical
    regression check.
- `recordBalances()` in `leaveBalance.js` gains an optional same-leave-year constraint
  so a printed form's "prior used" only sums leaves from the **same year** as the record
  being printed. For 2026 records this is unchanged.

### 2. Baseline fields are the *current-year* baseline

`al_used_pre` / `al_pelarasan` / `al_used_sys_adj` / `al_adj` (and MC/EL equivalents)
represent the current leave year's opening baseline (originally the 2026 adoption
baseline). The "Tutup Tahun" action **zeroes them** so the new year starts clean. The
system relies on Tutup Tahun being run at each year boundary; the UI surfaces whether
the year has been closed (see §4).

### 3. `src/yearEnd.js` — pure rollover module

Self-contained, Firebase/DOM-free, unit-testable, and structured so future year-end
features can be added as more exports.

```
computeYearEndRollover({ staffList, getStats, year }) -> {
  year,
  rows: [{ ic, name, branch, closingAL, cfNext, forfeited }],
  totals: { staff, totalCF, totalForfeited }
}
```
- `closingAL` = `getStats(staff, 'AL', year).bal` for each active staff.
- `cfNext` = `min(closingAL, CF_CAP)` where `CF_CAP = 3`.
- `forfeited` = `max(0, closingAL - CF_CAP)`.
- Also exports `CF_CAP` and `buildStaffRolloverPatch(row)` →
  the Firestore field patch for one staff:
  `{ ent_CF: row.cfNext, al_used_pre:0, al_pelarasan:0, al_used_sys_adj:0, al_adj:0,
     mc_used_pre:0, mc_pelarasan:0, mc_used_sys_adj:0,
     el_used_pre:0, el_pelarasan:0, el_used_sys_adj:0, balanceYear: row_year+1 }`.
- No writes here — main.js applies the patch.

### 4. HR "Tutup Tahun" UI (in `src/main.js`)

- A card/button in the HR management area (People/Config, gated by an HR/admin
  permission such as `manage_reports` or super_admin) labelled **"Tutup Tahun {YYYY}"**,
  where `{YYYY}` is the year being closed (the current or a selected prior year).
- Clicking opens a **preview modal**: the `rows` table (staf, baki AL, CF dibawa,
  hangus) + totals, plus a clear warning that baselines will reset. HR must confirm.
- On confirm: for each row, apply `buildStaffRolloverPatch` to the staff's Firestore
  doc (batched/sequential update, reuse the existing staff-update path). Then set a
  global marker `config/leaveYear.lastClosed = {YYYY}` (or equivalent) and show a
  success summary.
- **Guard:** if `lastClosed >= {YYYY}`, disable the button and show "Sudah ditutup".
  Confirmation dialog states the action is irreversible.

### 5. Affected call sites (must verify unchanged for 2026)

`getLeaveStats` is used across staff dashboard, approvals (balance check when applying/
approving leave), People tables, balance report, and the printed leave form via
`recordBalances`. All keep working because the default year is the current year and all
current data is 2026. Approval-time balance checks use the leave's own year.

## Testing / verification

- **Unit (`yearEnd.js`):** `computeYearEndRollover` with sample staff/records — closing
  balance 5 → cfNext 3, forfeited 2; closing 2 → cfNext 2, forfeited 0; closing 0 →
  cfNext 0. Totals correct. `buildStaffRolloverPatch` zeroes baselines and sets ent_CF.
- **Regression (critical):** a `getLeaveStats` harness with 2026-only records shows the
  year-scoped version returns identical `used`/`bal` to the current lifetime version for
  year 2026.
- **Manual:** open HR → Tutup Tahun preview renders; confirm writes ent_CF and zeroes
  baselines for a test staff; button then shows "Sudah ditutup"; staff dashboard for the
  new year shows fresh entitlement + carried CF.

## Out of scope

- Per-year historical balance documents / full multi-year balance history UI.
- Prorata entitlement.
- Automatic (cron) year rollover or year-end notifications.
- Changing carry-forward for non-AL types.

## Future ("modul untuk tambahan")

`src/yearEnd.js` is the home for later year-end additions (e.g. year-end summary PDF,
MC/EL usage reset reports, reminders) — added as new exports without touching the
balance engine.
