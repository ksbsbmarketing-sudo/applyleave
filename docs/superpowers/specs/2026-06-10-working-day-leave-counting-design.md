# Working-Day Leave Counting — Design

**Date:** 2026-06-10
**Status:** Approved design, pending spec review
**App:** KSB Leave Apply (Vite + Firebase PWA)

## Problem

Leave days are currently counted as **every calendar day** in the range,
inclusive (`src/main.js:4480-4484`), regardless of who applies:

```js
const diffTime = Math.abs(end - start);
let diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
if (applyHalfDay) diffDays -= 0.5;
```

But **Admin Staff work Monday–Friday** (weekends and public holidays off), while
all other staff (Operation Staff, Doctor, etc.) work the full week. So an Admin
Staff member taking leave Friday→Monday is absent from work only Friday and
Monday (2 days), yet the system charges 4. This over-charges Admin Staff leave
balances.

The same calendar-day count is duplicated in the staff self-edit recompute
(`src/main.js:~1843`), and the admin edit-leave modal (`~4783`) does **not**
recompute `days` at all when an admin changes the dates — so balances can drift.

## Decisions (from brainstorming)

1. **Admin Staff** (`category === 'Admin Staff'` or `=== 'Admin'`): count only
   **work days** — exclude Saturdays, Sundays, and public holidays inside the
   range.
2. **All other staff:** count **every calendar day** (unchanged).
3. Applies to **all leave types**.
4. Public holidays come from the existing `publicHolidays` config, selected by
   the **staff's state** (from their branch: Pahang → `publicHolidays.pahang`,
   Terengganu → `publicHolidays.terengganu`, other states → no holiday list, so
   only weekends are excluded).
5. **Half-day** still subtracts 0.5, applied by the caller after the working-day
   count.
6. An Admin Staff range that contains **zero work days** (e.g. only Sat–Sun) is
   **blocked** at submit/edit with a friendly message, not recorded as 0 days.

## Architecture

### Component 1 — pure, testable core: `src/leaveDays.js` (new)

A tiny standalone module with no Firebase/DOM dependencies, so it can be unit
tested directly.

```js
// src/leaveDays.js
// Count chargeable leave days for a date range.
// - isAdminStaff false → inclusive calendar-day count (unchanged behaviour)
// - isAdminStaff true  → only Mon–Fri days that are not public holidays
// holidayDates: array/Set of 'YYYY-MM-DD' strings (the staff's state holidays)
export function countLeaveDays(startDate, endDate, isAdminStaff, holidayDates = []) {
  const start = parseYMD(startDate);
  const end   = parseYMD(endDate);
  if (!start || !end || end < start) return 0;

  if (!isAdminStaff) {
    return Math.round((end - start) / 86400000) + 1; // inclusive calendar days
  }

  const holidays = holidayDates instanceof Set ? holidayDates : new Set(holidayDates);
  let count = 0;
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const day = d.getDay();                 // 0=Sun … 6=Sat (local)
    if (day === 0 || day === 6) continue;   // weekend
    if (holidays.has(fmtYMD(d))) continue;   // public holiday
    count++;
  }
  return count;
}

// Build dates from Y/M/D parts at LOCAL midnight to avoid timezone drift in
// getDay()/formatting (inputs are 'YYYY-MM-DD' from <input type=date>).
function parseYMD(s) {
  if (!s) return null;
  const [y, m, d] = String(s).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}
function fmtYMD(dt) {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
```

### Component 2 — app-facing wrapper: `window.computeLeaveDays`

Lives in `src/main.js`. Resolves "is this person Admin Staff" and "which holiday
list" from app state (`branches`, `publicHolidays`), then delegates to the pure
core. Returns the **whole** working-day count (callers apply half-day).

```js
import { countLeaveDays } from './leaveDays.js';

window.computeLeaveDays = function(startDate, endDate, staff) {
  const isAdmin = !!staff && (staff.category === 'Admin Staff' || staff.category === 'Admin');
  let holidayDates = [];
  if (isAdmin) {
    const branchObj = branches.find(b => b.name === (staff.branch || ''));
    const state = branchObj ? branchObj.state : null;
    const list = state === 'Terengganu' ? publicHolidays.terengganu
               : state === 'Pahang'     ? publicHolidays.pahang
               : [];
    holidayDates = (list || []).map(h => h.date);
  }
  return countLeaveDays(startDate, endDate, isAdmin, holidayDates);
};
```

### Call sites updated (all route through `window.computeLeaveDays`)

1. **Leave submit** (`src/main.js:4480-4484`): replace the inline calendar math
   with `let diffDays = window.computeLeaveDays(leaveStartDate, leaveEndDate, user); if (applyHalfDay) diffDays -= 0.5;`. After computing, if `diffDays <= 0`
   (Admin range with no work days), alert and return without submitting:
   *"Tarikh yang dipilih tiada hari bekerja untuk staf pentadbiran. Sila pilih
   tarikh yang merangkumi hari bekerja (Isnin–Jumaat)."*
2. **Staff self-edit recompute** (`src/main.js:~1843`, in `staffEditOwnLeave`):
   replace the inline fallback with `const days = window.computeLeaveDays(newStart, newEnd, staffList.find(s => s.ic === rec.ic) || user);` and, if `days <= 0`,
   alert the same message and abort the edit (no write).
3. **Admin edit-leave modal** (`src/main.js:~4783`): currently writes
   `startDate`/`endDate` without recomputing `days`. Add `days:
   window.computeLeaveDays(<el-start>, <el-end>, staffList.find(s => s.ic === rec.ic))` to the `updates` object so admin date edits keep the balance correct. If
   the result is `<= 0`, alert and abort the save.

The AL split-leave / balance logic already consumes the resulting `days` value;
no change needed there.

## Edge cases

- **Zero work days (Admin):** blocked at all three entry points (above).
- **Non-Admin unchanged:** `countLeaveDays(..., false, ...)` returns the same
  inclusive calendar count as today.
- **Unknown state / no holiday list:** Admin staff still get weekends excluded;
  holidays simply aren't subtracted (empty list).
- **Half-day:** applied by the caller (`-0.5`) after the whole-day count, as today.
- **Timezone:** dates are parsed from `YYYY-MM-DD` parts at local midnight, so
  `getDay()` and holiday matching are not skewed by UTC conversion.

## Out of scope

- Changing how public holidays are configured (uses the existing list).
- Per-staff custom work schedules beyond the Admin vs full-week split.
- Recounting historical/already-approved leave records (only new submissions and
  subsequent edits use the new count).

## Testing

`countLeaveDays` is pure, so unit-test it directly with Node's test runner
(`tests/leaveDays.test.mjs`, no emulator needed):

- Admin Fri→Mon (2026-07-03 Fri → 2026-07-06 Mon) = **2**.
- Non-Admin same range = **4**.
- Admin Mon→Fri single week (2026-07-06 → 2026-07-10) = **5**.
- Admin range containing a public holiday (holiday list includes a weekday in
  range) excludes it (e.g. Mon–Wed with Tue a holiday = **2**).
- Admin Sat→Sun only = **0** (drives the block).
- Single weekday, Admin and non-Admin = **1**.
- `end < start` → **0** (defensive).

Manual check: in the running app, an Admin Staff applying Fri→Mon shows 2 days
and deducts 2 from balance; an Operation Staff applying the same shows 4.
