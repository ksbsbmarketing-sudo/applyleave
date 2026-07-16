# All-Leave Printable Report (sectioned by type) — Design

**Date:** 2026-07-16
**Status:** Approved (design), pending implementation plan

## Problem

There is a dedicated printable CME report (`window.printCMEReport`), but no single printable
report that covers **all** leave types. HR wants one printout that lists, **separately per
leave type**, the staff who took that leave with their dated records — same detail level as
the CME report.

## Solution

A new `window.printAllLeaveReport()` plus a **"Semua Cuti"** toolbar button beside the existing
CME/attendance buttons. It opens one print window with one section per leave type.

Mirrors `printCMEReport` in structure, scoping, and header — so the two stay visually and
behaviourally consistent.

### Structure

- Header: `window.printHeaderHTML({ isReport: true, branch, title: 'LAPORAN CUTI KAKITANGAN', meta: [...] })`
  (shared maroon corporate header — never hand-roll one). Year scope in `meta`.
- Year scope: current leave year (`window.getCurrentLeaveYear()`), consistent with `getLeaveStats`.
- Staff scope: active staff within the current user's report scope — the **same predicate** as
  `generateAttendanceReport` / `printCMEReport` (`getUserReportBranch`, `getUserReportDaerah`,
  `getUserStateScope`, `attendanceReportBranch`, `branches`).
- **One section per leave type**, in this fixed order:
  `AL, MC, EL, EL_EMG, HL, ML, ML_PL, CME, UP`. Section title = the type's display name from
  `LEAVE_TYPE_NAMES` (e.g. `Annual Leave (AL)`, `Unpaid Leave (UL)`).
- Within a section, list **only staff with ≥ 1 APPROVED record of that type in the year**
  (not every staff member), sorted by branch then name. Per staff:
  - Header line: `NAMA — Cawangan · Kelayakan: {ent} · Guna: {used} · Baki: {bal}` from
    `getLeaveStats(s, type)`. This keeps balances consistent with the dashboard/reports,
    including AL/MC/EL Formula-B deductions and EL→AL overflow, and CME's doctor entitlement.
  - For types where `ent === 0` (EL_EMG, UP): show **`Guna: {used}` only** — no
    Kelayakan/Baki (there is no meaningful entitlement).
  - The staff's approved records for that type/year, each: `startDate–endDate · (N hari) · reason`.
- **Empty sections are skipped** — a type nobody took this year is not rendered.
- Footer: total approved leave days across all types/staff in scope for the year, plus staff/section counts.

### Reuse

- Same date formatting, record filtering (`type`, `status === 'APPROVED'`, `leaveYearOf(r) === year`),
  scope predicate, and print-window mechanics as `printCMEReport`. Where the two share logic,
  keep them parallel; do not refactor `printCMEReport`.

## Testing

`printAllLeaveReport` is DOM/print-coupled — verified via `npm run build` plus manual checks:
1. Button "Semua Cuti" appears beside the CME/PDF buttons (gated by `report_attendance`).
2. Clicking opens the print window with the maroon header and one section per type that has
   records; empty types are absent.
3. A staff member's per-type Kelayakan/Guna/Baki matches their dashboard; EL_EMG/UP sections
   show Guna only.
4. Dated records under each staff match the approved leaves for that type/year.
5. A branch-restricted HR sees only their scope's staff.

## Out of scope

- CF (carry-forward) is not a leave taken — excluded.
- No new leave data model or fields; read-only over existing records/entitlements.
- No change to `printCMEReport` or other reports.
