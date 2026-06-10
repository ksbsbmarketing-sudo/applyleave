# Working-Day Leave Counting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Count Admin Staff leave by working days only (skip Sat/Sun + public holidays); all other staff keep counting every calendar day.

**Architecture:** A pure, dependency-free core (`src/leaveDays.js`, unit-tested with `node --test`) does the date math. A thin app wrapper `window.computeLeaveDays(start, end, staff)` in `src/main.js` resolves "is Admin Staff" and the right state holiday list from app state, then delegates to the core. Three call sites (leave submit, staff self-edit, admin leave-edit modal) route through the wrapper and block Admin ranges that contain zero working days.

**Tech Stack:** Vanilla ES modules, Vite, Node built-in test runner (`node --test`). No Firebase emulator needed (the tested code is pure).

**Spec:** `docs/superpowers/specs/2026-06-10-working-day-leave-counting-design.md`

**Conventions:** All work happens on branch `feat/working-day-leave-counting` (already checked out). The block message used at every entry point is exactly:
`Tarikh yang dipilih tiada hari bekerja untuk staf pentadbiran. Sila pilih tarikh yang merangkumi hari bekerja (Isnin–Jumaat).`

---

## Task 1: Pure working-day core + unit tests (TDD)

**Files:**
- Create: `src/leaveDays.js`
- Create: `tests/leaveDays.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/leaveDays.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert';
import { countLeaveDays } from '../src/leaveDays.js';

// 2026-07-03 Fri, 04 Sat, 05 Sun, 06 Mon, 07 Tue, 08 Wed, 10 Fri (verified)

test('non-admin counts all calendar days (Fri->Mon = 4)', () => {
  assert.strictEqual(countLeaveDays('2026-07-03', '2026-07-06', false), 4);
});

test('admin skips weekend (Fri->Mon = 2)', () => {
  assert.strictEqual(countLeaveDays('2026-07-03', '2026-07-06', true), 2);
});

test('admin full work week (Mon->Fri = 5)', () => {
  assert.strictEqual(countLeaveDays('2026-07-06', '2026-07-10', true), 5);
});

test('admin excludes a public holiday in range (Mon..Wed, Tue holiday = 2)', () => {
  assert.strictEqual(countLeaveDays('2026-07-06', '2026-07-08', true, ['2026-07-07']), 2);
});

test('admin weekend-only range = 0', () => {
  assert.strictEqual(countLeaveDays('2026-07-04', '2026-07-05', true), 0);
});

test('single weekday = 1 for both admin and non-admin', () => {
  assert.strictEqual(countLeaveDays('2026-07-06', '2026-07-06', true), 1);
  assert.strictEqual(countLeaveDays('2026-07-06', '2026-07-06', false), 1);
});

test('end before start = 0 (defensive)', () => {
  assert.strictEqual(countLeaveDays('2026-07-06', '2026-07-01', true), 0);
  assert.strictEqual(countLeaveDays('2026-07-06', '2026-07-01', false), 0);
});

test('holidayDates accepts a Set', () => {
  assert.strictEqual(countLeaveDays('2026-07-06', '2026-07-08', true, new Set(['2026-07-07'])), 2);
});

test('non-admin ignores holidays (Mon..Wed with Tue holiday = 3)', () => {
  assert.strictEqual(countLeaveDays('2026-07-06', '2026-07-08', false, ['2026-07-07']), 3);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/leaveDays.test.mjs`
Expected: FAIL — `Cannot find module '.../src/leaveDays.js'` (the module doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/leaveDays.js`:
```js
// Pure leave-day counting. No Firebase/DOM dependencies so it is unit-testable.
//
// countLeaveDays(startDate, endDate, isAdminStaff, holidayDates):
//   - isAdminStaff false → inclusive calendar-day count (legacy behaviour)
//   - isAdminStaff true  → only Mon–Fri days that are not public holidays
//   - holidayDates: array or Set of 'YYYY-MM-DD' strings (the staff's state holidays)
//   - returns 0 when the range is invalid (end before start)
export function countLeaveDays(startDate, endDate, isAdminStaff, holidayDates = []) {
  const start = parseYMD(startDate);
  const end = parseYMD(endDate);
  if (!start || !end || end < start) return 0;

  if (!isAdminStaff) {
    return Math.round((end - start) / 86400000) + 1; // inclusive calendar days
  }

  const holidays = holidayDates instanceof Set ? holidayDates : new Set(holidayDates);
  let count = 0;
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const day = d.getDay();               // 0=Sun … 6=Sat (local)
    if (day === 0 || day === 6) continue; // weekend
    if (holidays.has(fmtYMD(d))) continue; // public holiday
    count++;
  }
  return count;
}

// Build dates from Y/M/D parts at LOCAL midnight so getDay()/formatting are not
// skewed by UTC conversion. Inputs come from <input type="date"> ('YYYY-MM-DD').
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

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/leaveDays.test.mjs`
Expected: all tests PASS (`tests 9 | pass 9 | fail 0`).

- [ ] **Step 5: Commit**

```bash
git add src/leaveDays.js tests/leaveDays.test.mjs
git commit -m "feat(leave): pure working-day counting core + unit tests"
```

---

## Task 2: App wrapper `window.computeLeaveDays`

**Files:**
- Modify: `src/main.js` (import near the top; define wrapper near the existing `window.editLeave`/`window.staffEditOwnLeave` area)

- [ ] **Step 1: Add the import**

At the very top of `src/main.js`, directly below the existing first line `import './style.css'`, add:
```js
import { countLeaveDays } from './leaveDays.js';
```

- [ ] **Step 2: Define the wrapper**

There is an existing `window.staffEditOwnLeave = async function(id) { ... }` in `src/main.js`. Immediately BEFORE that function (or right after `window.editLeave`), add:
```js
// Chargeable leave-day count for a staff member over a date range.
// Admin Staff (Mon–Fri) skip weekends + their state's public holidays;
// everyone else counts all calendar days. Returns whole days (callers apply half-day).
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

> `branches` and `publicHolidays` are existing module-level globals in `src/main.js` (`publicHolidays` is `{ pahang: [...], terengganu: [...] }`, each entry `{ date: 'YYYY-MM-DD', name }`).

- [ ] **Step 3: Verify syntax and build**

Run: `node --check src/main.js` → exit 0.
Run: `npm run build` → succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/main.js
git commit -m "feat(leave): add window.computeLeaveDays wrapper (Admin Staff work-day aware)"
```

---

## Task 3: Route all three call sites through the wrapper + block zero-work-day ranges

**Files:**
- Modify: `src/main.js` — leave submit (~4480), `staffEditOwnLeave` (~1842), admin `#edit-leave-form` (~4822)

- [ ] **Step 1: Leave submit handler**

Find this block (around line 4480):
```js
      const start = new Date(leaveStartDate);
      const end = new Date(leaveEndDate);
      const diffTime = Math.abs(end - start);
      let diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
      if (applyHalfDay) diffDays -= 0.5;
```
Replace it with:
```js
      let diffDays = window.computeLeaveDays(leaveStartDate, leaveEndDate, user);
      if (diffDays <= 0) {
        alert('Tarikh yang dipilih tiada hari bekerja untuk staf pentadbiran. Sila pilih tarikh yang merangkumi hari bekerja (Isnin–Jumaat).');
        return;
      }
      if (applyHalfDay) diffDays -= 0.5;
```
(The local `start`/`end`/`diffTime` were only used for this count; nothing else in the handler references them. If `node --check` or build later reports `start`/`end` used elsewhere in this handler, re-add only what is referenced — but they are not.)

- [ ] **Step 2: Staff self-edit recompute**

In `window.staffEditOwnLeave`, find:
```js
  const days = window.computeLeaveDays ? window.computeLeaveDays(newStart, newEnd)
    : (Math.round((new Date(newEnd) - new Date(newStart)) / 86400000) + 1);
```
Replace it with:
```js
  const days = window.computeLeaveDays(newStart, newEnd, staffList.find(s => s.ic === rec.ic) || user);
  if (days <= 0) {
    alert('Tarikh yang dipilih tiada hari bekerja untuk staf pentadbiran. Sila pilih tarikh yang merangkumi hari bekerja (Isnin–Jumaat).');
    return;
  }
```

- [ ] **Step 3: Admin leave-edit modal (`#edit-leave-form`)**

Find this handler body (around line 4820):
```js
          const rec = leaveRecords.find(r => r.id === editingLeaveId);
          if(rec) {
              const updates = {
                status: document.querySelector('#el-status').value,
                type: document.querySelector('#el-type').value,
                reason: document.querySelector('#el-reason').value,
                startDate: document.querySelector('#el-start').value,
                endDate: document.querySelector('#el-end').value
              };
              
              try {
                  await updateDoc(doc(db, "leaves", editingLeaveId.toString()), updates);
```
Replace it with (recompute `days` so the balance stays correct, and block zero-work-day ranges):
```js
          const rec = leaveRecords.find(r => r.id === editingLeaveId);
          if(rec) {
              const elStart = document.querySelector('#el-start').value;
              const elEnd = document.querySelector('#el-end').value;
              const elDays = window.computeLeaveDays(elStart, elEnd, staffList.find(s => s.ic === rec.ic));
              if (elDays <= 0) {
                alert('Tarikh yang dipilih tiada hari bekerja untuk staf pentadbiran. Sila pilih tarikh yang merangkumi hari bekerja (Isnin–Jumaat).');
                return;
              }
              const updates = {
                status: document.querySelector('#el-status').value,
                type: document.querySelector('#el-type').value,
                reason: document.querySelector('#el-reason').value,
                startDate: elStart,
                endDate: elEnd,
                days: elDays
              };
              
              try {
                  await updateDoc(doc(db, "leaves", editingLeaveId.toString()), updates);
```

> Note: the admin modal does not have a half-day toggle, so `days` is the whole working-day count. This is a behaviour improvement — previously `days` was never recomputed on admin date edits.

- [ ] **Step 4: Verify syntax and build**

Run: `node --check src/main.js` → exit 0.
Run: `npm run build` → succeeds.

- [ ] **Step 5: Re-run the unit tests (unchanged, must still pass)**

Run: `node --test tests/leaveDays.test.mjs`
Expected: `tests 9 | pass 9 | fail 0`.

- [ ] **Step 6: Commit**

```bash
git add src/main.js
git commit -m "feat(leave): count Admin Staff leave by working days at submit/self-edit/admin-edit"
```

---

## Manual verification (after Task 3)

In the running app (or by reasoning over the code):
- An **Admin Staff** member applying Fri (2026-07-03) → Mon (2026-07-06) shows **2 days** and deducts 2 from balance.
- An **Operation Staff** member applying the same range shows **4 days**.
- An Admin Staff member selecting only Sat→Sun is **blocked** with the work-day message.
- A non-Admin's existing behaviour is unchanged.

## Notes for the implementer

- Do not change the `validateNotice` advance-notice calc at `src/main.js:3644` — that is a different calculation (days of notice before leave starts), not leave duration.
- Only new submissions and subsequent edits use the new count; historical records are not recomputed (per spec "Out of scope").
- `src/leaveDays.js` must stay free of Firebase/DOM imports so its tests run under plain `node --test`.
