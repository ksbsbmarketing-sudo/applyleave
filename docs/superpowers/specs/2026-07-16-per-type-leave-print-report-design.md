# Per-Type Leave Printable Reports — Design

**Date:** 2026-07-16
**Status:** Approved (design), pending implementation plan

## Problem

`printAllLeaveReport` prints ALL leave types in one document (sectioned). HR also wants to
print a report for **one** leave type at a time — "AL untuk AL, MC untuk MC" — in the same
detailed format. The combined report stays; this adds single-type reports.

## Solution

1. **Refactor** the just-shipped `window.printAllLeaveReport` to extract shared, reusable
   helpers (DRY) — with its rendered output **byte-identical** to today.
2. **New** `window.printLeaveTypeReport(type)` — a single-type detailed report reusing those
   helpers.
3. **One toolbar button per type** (`AL, MC, EL, EL_EMG, HL, ML, ML_PL, UP`) in the Rekod
   Kedatangan toolbar; each click prints that type's report.

CME is **not** given a new button — it already has its dedicated `printCMEReport` button
(which lists all doctors, incl. those with zero CME). Toolbar becomes:
`PDF · CME · Semua Cuti · AL · MC · EL · EL_EMG · HL · ML · ML_PL · UP`. The buttons wrap
(the header container at `src/main.js:8615` is `flex-wrap:wrap`).

### Shared helpers (extracted from `printAllLeaveReport`)

Module-level, placed just before `window.printAllLeaveReport`:

- `getReportStaffPool()` — active staff within the current user's report scope (the exact
  predicate currently inlined in `printAllLeaveReport`: `getUserReportBranch`,
  `attendanceReportBranch`, `getUserStateScope`, `getUserReportDaerah`, `branches`).
- `fmtLeaveDate(d)` / `fmtLeaveRange(r)` — the date/range formatters currently inlined.
- `renderLeaveSections(types, pool, year) → { html, sectionCount, grandTotal, staffCount }`
  — builds one section per type (only staff with ≥1 approved record of that type/year, sorted
  by branch then name; per-staff `Kelayakan/Guna/Baki` from `getLeaveStats(s, type)`, or
  `Guna` only when `ent === 0`; dated records; empty sections skipped). The section/block HTML
  strings are copied verbatim from the current inline code so output does not change.
- A shared `LEAVE_TYPE_COLOR` map and `ALL_LEAVE_TYPES` list.

`printAllLeaveReport` becomes: `pool = getReportStaffPool()`,
`{html, sectionCount, grandTotal} = renderLeaveSections(ALL_LEAVE_TYPES, pool, year)`, then its
**existing** print-window wrapper/footer unchanged.

### `printLeaveTypeReport(type)`

- `year = getCurrentLeaveYear()`, `pool = getReportStaffPool()`,
  `{html, sectionCount, grandTotal, staffCount} = renderLeaveSections([type], pool, year)`.
- Opens a print window (same shell as `printAllLeaveReport`) with title
  `LAPORAN ${LEAVE_TYPE_NAMES[type] || type}` and a footer showing staff count + total days.
- Empty (nobody took that type this year) → the same "Tiada rekod…" empty message.

### Buttons

After the "Semua Cuti" button (inside the `userPerms.report_attendance ? … : ''` branch),
render 8 compact buttons via a `.map` over `['AL','MC','EL','EL_EMG','HL','ML','ML_PL','UP']`,
each `onclick="window.printLeaveTypeReport('<T>')"` with the label `<T>`.

## Testing

DOM/print-coupled — `npm run build` + manual:
1. `printAllLeaveReport` output is unchanged (same sections, footer, header).
2. Each type button prints a report titled for that type, listing only staff who took it, with
   correct Kelayakan/Guna/Baki (or Guna only for EL_EMG/UP) + dated records.
3. A type nobody took → empty-state message.
4. Branch-restricted HR sees only their scope's staff. Buttons wrap on narrow widths.

## Out of scope

- No change to `printCMEReport` (CME keeps its dedicated button/behaviour).
- No new leave data model/fields; read-only.
