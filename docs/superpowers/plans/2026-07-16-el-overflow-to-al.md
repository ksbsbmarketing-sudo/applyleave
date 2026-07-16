# EL Overflow → Annual Leave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a staff member's 3-day Emergency/Compassionate Leave (`EL`) bucket is exhausted, deduct the excess days from their Annual Leave (`AL`) balance.

**Architecture:** Compute-only spillover (matching the existing AL→Unpaid "SPLIT LEAVE" pattern). A pure helper `computeElOverflow` in `src/leaveBalance.js` returns the overflow days; `getLeaveStats('AL')` subtracts it from the AL balance and exposes it as a new `elOverflow` field; the print form and the EL application handler consume that field/logic. No new leave records are created.

**Tech Stack:** Vanilla JS (ES modules, Vite), Node's built-in `node:test` runner for unit tests, Firebase Firestore (untouched here).

## Global Constraints

- **Scope: `EL` only** — `EL_EMG` (Kecemasan Am) is unchanged. Never add overflow logic for `EL_EMG`.
- **Overflow includes HR pelarasan** — overflow = `max(0, el_used_pre + el_used_sistem + el_pelarasan − ent_EL)`.
- **No auto-Unpaid cascade** — if AL is also insufficient, AL balance clamps at 0; do not create Unpaid records for EL overflow.
- **No new records, no record splitting** — EL records stay `type:'EL', days:full`.
- **Overflow is cumulative per leave year**, year-scoped like the existing `getLeaveStats`.
- Design reference: `docs/superpowers/specs/2026-07-16-el-overflow-to-al-design.md`.

---

### Task 1: Pure `computeElOverflow` helper (TDD)

**Files:**
- Modify: `src/leaveBalance.js` (add exported function alongside `recordBalances`)
- Test: `tests/leaveBalance.test.mjs` (append new tests)

**Interfaces:**
- Consumes: nothing (pure arithmetic).
- Produces: `computeElOverflow({ entEL, usedPre?, usedSys?, pelarasan? }) → number` (days beyond the EL bucket, clamped ≥ 0). All inputs coerced via the existing `num()` helper; omitted fields default to 0.

- [ ] **Step 1: Write the failing tests**

Append to `tests/leaveBalance.test.mjs`:

```javascript
import { computeElOverflow } from '../src/leaveBalance.js';

test('EL within the bucket → no overflow', () => {
  assert.strictEqual(computeElOverflow({ entEL: 3, usedSys: 2 }), 0);
});

test('EL exceeding the bucket → overflow is the excess', () => {
  assert.strictEqual(computeElOverflow({ entEL: 3, usedSys: 5 }), 2);
});

test('EL exactly at the bucket edge → no overflow', () => {
  assert.strictEqual(computeElOverflow({ entEL: 3, usedSys: 3 }), 0);
});

test('HR pelarasan counts toward overflow', () => {
  // usedPre 2 + pelarasan 2 = 4, ent 3 → overflow 1
  assert.strictEqual(computeElOverflow({ entEL: 3, usedPre: 2, pelarasan: 2 }), 1);
});

test('pre + system usage combine toward overflow', () => {
  // usedPre 1 + usedSys 3 = 4, ent 3 → overflow 1
  assert.strictEqual(computeElOverflow({ entEL: 3, usedPre: 1, usedSys: 3 }), 1);
});

test('overflow never goes negative', () => {
  assert.strictEqual(computeElOverflow({ entEL: 3 }), 0);
});

test('non-numeric / missing inputs are treated as zero', () => {
  assert.strictEqual(computeElOverflow({ entEL: 3, usedSys: 'x', pelarasan: null }), 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/leaveBalance.test.mjs`
Expected: FAIL — `SyntaxError`/`TypeError` because `computeElOverflow` is not exported.

- [ ] **Step 3: Implement the helper**

Add to `src/leaveBalance.js` (after `recordBalances`, before the `isBefore` helper — it reuses the existing module-local `num()`):

```javascript
// EL overflow into Annual Leave: how many EL days were consumed beyond the EL
// entitlement (the 3-day bucket). Everything that reduces the EL balance counts —
// prior-system usage, in-system usage, and HR pelarasan — matching Formula B.
// Returns days ≥ 0. Consumed by getLeaveStats('AL') to reduce the AL balance.
export function computeElOverflow({ entEL, usedPre = 0, usedSys = 0, pelarasan = 0 }) {
  const total = num(usedPre) + num(usedSys) + num(pelarasan);
  return Math.max(0, total - num(entEL));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/leaveBalance.test.mjs`
Expected: PASS — all prior tests plus the 7 new ones (18 total).

- [ ] **Step 5: Commit**

```bash
git add src/leaveBalance.js tests/leaveBalance.test.mjs
git commit -m "feat(leave): add computeElOverflow helper for EL→AL spillover"
```

---

### Task 2: Subtract EL overflow from the AL balance in `getLeaveStats`

**Files:**
- Modify: `src/main.js:3` (import), `src/main.js:4037-4094` (`getLeaveStats`)

**Interfaces:**
- Consumes: `computeElOverflow` from Task 1; the EL stats produced by a recursive `getLeaveStats(staff, 'EL', leaveYear)` call (fields `ent`, `usedPre`, `used`, `pelarasan`).
- Produces: `getLeaveStats(...)` return object gains `elOverflow: number` (0 for every type except `AL`); `bal` for `AL` now also subtracts that overflow. Consumed by Tasks 3 and 4 and by all existing `getLeaveStats('AL')` readers.

- [ ] **Step 1: Extend the import**

Change `src/main.js:3` from:

```javascript
import { recordBalances } from './leaveBalance.js';
```

to:

```javascript
import { recordBalances, computeElOverflow } from './leaveBalance.js';
```

- [ ] **Step 2: Compute overflow and fold it into the AL balance**

In `getLeaveStats` (`src/main.js`), replace the final `return` block (currently at ~`src/main.js:4082-4093`):

```javascript
  const usedSys = autoSystemUsage ? recordsUsed : usedSysAdj;

  return {
    used: usedSys,
    usedFromRecords: recordsUsed,
    usedSysAdj: usedSysAdj,
    usedPre: usedPre,
    pelarasan: pelarasan,
    adj: pelarasan,
    ent: ent,
    bal: Math.max(0, ent - usedPre - usedSys - pelarasan)
  };
```

with:

```javascript
  const usedSys = autoSystemUsage ? recordsUsed : usedSysAdj;

  // EL overflow: once the 3-day EL bucket is exhausted, the excess EL days are
  // deducted from Annual Leave (Option B). Only AL absorbs the spillover; the
  // recursive EL call never re-enters this branch (type === 'EL'), so it terminates.
  let elOverflow = 0;
  if (type === 'AL') {
    const el = window.getLeaveStats(staff, 'EL', leaveYear);
    elOverflow = computeElOverflow({
      entEL: el.ent, usedPre: el.usedPre, usedSys: el.used, pelarasan: el.pelarasan
    });
  }

  return {
    used: usedSys,
    usedFromRecords: recordsUsed,
    usedSysAdj: usedSysAdj,
    usedPre: usedPre,
    pelarasan: pelarasan,
    adj: pelarasan,
    ent: ent,
    elOverflow: elOverflow,
    bal: Math.max(0, ent - usedPre - usedSys - pelarasan - elOverflow)
  };
```

- [ ] **Step 3: Verify the build compiles (imports resolve, no syntax errors)**

Run: `npm run build`
Expected: build completes with no error; `dist/` is produced. (There is no unit harness for `getLeaveStats` — it is coupled to `window`/`leaveRecords` — so a green build plus the manual check in Step 4 is the verification.)

- [ ] **Step 4: Manual behavior verification**

Run: `npm run dev`, log in as a staff member (or Super Admin viewing a staff), and confirm on the personal dashboard / HR Baki report:
- Staff with ≤ 3 EL days used and no overflow: AL balance unchanged from before this change.
- Staff with an approved EL record pushing EL usage past 3 days: AL balance drops by exactly `(total EL used − 3)`; EL bucket shows 0.
- Prior-year EL records do **not** reduce this year's AL (year-scoped): pick a staff whose only over-3 EL usage is dated in a previous year and confirm AL is untouched.

- [ ] **Step 5: Commit**

```bash
git add src/main.js
git commit -m "feat(leave): deduct EL overflow from Annual Leave balance"
```

---

### Task 3: Reflect EL overflow on the printed AL leave form

**Files:**
- Modify: `src/main.js:2019-2026` (the `recordBalances({...})` call inside `printLeave`)

**Interfaces:**
- Consumes: `stats.elOverflow` from Task 2.
- Produces: no new interface; the printed AL form's `BAKI CUTI` now matches the dashboard AL balance.

- [ ] **Step 1: Fold `elOverflow` into the print `alAdj` baseline**

In `printLeave` (`src/main.js`), change the `alAdj` line (currently `src/main.js:2023`) from:

```javascript
      alAdj: (stats.usedPre || 0) + (stats.pelarasan || 0) + (autoSystemUsage ? 0 : (stats.usedSysAdj || 0)),
```

to:

```javascript
      // elOverflow is 0 for every type except AL, so this is a no-op on other forms;
      // on AL it shifts the printed baseline down so BAKI CUTI matches the dashboard.
      alAdj: (stats.usedPre || 0) + (stats.pelarasan || 0) + (stats.elOverflow || 0) + (autoSystemUsage ? 0 : (stats.usedSysAdj || 0)),
```

- [ ] **Step 2: Verify the build compiles**

Run: `npm run build`
Expected: build completes with no error.

- [ ] **Step 3: Manual verification**

Run `npm run dev`; for a staff member with EL overflow, open an approved **AL** record and click print. Confirm the AL form's `BAKI CUTI` equals the dashboard AL balance (i.e. reduced by the overflow). Print an **EL** record and confirm its `BAKI CUTI` reads 0 once the bucket is exhausted (unchanged behavior).

- [ ] **Step 4: Commit**

```bash
git add src/main.js
git commit -m "feat(leave): show EL overflow in printed Annual Leave balance"
```

---

### Task 4: Apply-time warning when EL overflows into AL

**Files:**
- Modify: `src/main.js:5289-5300` (the `leaveBreakdown` / AL-split area in the leave submit handler)

**Interfaces:**
- Consumes: `getLeaveStats(user, 'EL')` and `getLeaveStats(user, 'AL')` (Task 2 balances).
- Produces: sets `leaveBreakdown` (already threaded into the WhatsApp `copyText` at `src/main.js:5396`) with an `*EL OVERFLOW*` note; shows an informational `alert`. Does not block submission.

- [ ] **Step 1: Add the EL overflow warning block**

In the submit handler, immediately after the existing AL block that ends at `src/main.js:5300` (the closing `}` of `if (selectedLeaveType === 'AL') { ... }`), insert:

```javascript
      if (selectedLeaveType === 'EL') {
          // EL bucket first; once exhausted the excess is deducted from Annual Leave.
          const elBal = window.getLeaveStats(user, 'EL').bal;
          const fromEL = Math.min(diffDays, elBal);
          const toAL = diffDays - fromEL;
          if (toAL > 0) {
              const alBal = window.getLeaveStats(user, 'AL').bal;
              leaveBreakdown = "\n*EL OVERFLOW*\nEL Bucket Used: " + fromEL + " days\nAnnual Leave (AL) Used: " + toAL + " days\n(EL bucket exhausted → overflow deducted from AL)";
              let elMsg = "Notis: Baki EL anda tinggal " + elBal.toFixed(2) + " hari. Permohonan " + diffDays + " hari akan ditolak " + fromEL + " hari dari EL dan " + toAL + " hari dari Cuti Tahunan (AL).";
              if (toAL > alBal) {
                  elMsg += "\n\n⚠️ Baki AL juga tidak mencukupi (baki AL: " + alBal.toFixed(2) + " hari).";
              }
              alert(elMsg);
          }
      }
```

- [ ] **Step 2: Verify the build compiles**

Run: `npm run build`
Expected: build completes with no error.

- [ ] **Step 3: Manual verification**

Run `npm run dev`, log in as a staff member whose EL bucket is nearly/fully used, and start an EL application spanning more days than the remaining EL balance. Confirm:
- The alert states the EL-vs-AL split (e.g. "…ditolak 1 hari dari EL dan 2 hari dari Cuti Tahunan (AL)").
- When AL is also short, the extra "⚠️ Baki AL juga tidak mencukupi…" line appears.
- Submission still proceeds (warning is informational), and the WhatsApp copy text contains the `*EL OVERFLOW*` block.
- A staff member with EL balance ≥ requested days sees **no** warning.

- [ ] **Step 4: Commit**

```bash
git add src/main.js
git commit -m "feat(leave): warn on EL application that overflows into Annual Leave"
```

---

### Task 5: Reflect EL overflow in the HR staff-edit modal

**Files:**
- Modify: `src/main.js:1922-1940` (`window._recalcLeaveBalance` — live recompute)
- Modify: `src/main.js:10570-10579` (server-render `_modalAlBalance`)
- Modify: `src/main.js:~10745-10751` (the "Baki AL Sebenar" display block — add a note span)

**Interfaces:**
- Consumes: `computeElOverflow` from Task 1 (already imported into `main.js` by Task 2).
- Produces: no new interface. The modal's "Baki AL Sebenar" (both initial render and live-on-edit) now subtracts EL overflow and shows a note when overflow > 0.

**Why:** The HR staff-edit modal recomputes the AL balance from its own fields
(`_modalAlBalance`, `_recalcLeaveBalance`) instead of calling `getLeaveStats`, so after
Task 2 it would show an AL number inconsistent with the dashboard/reports whenever EL
overflow > 0. Per the approved decision, align it and show why AL dropped. EL field IDs in
this modal follow the same pattern as AL: `ent-EL`, `el-used-pre-input`,
`el-sys-used-display` (auto) / `el-sys-adj-input` (manual), `el-pelarasan-input`.

- [ ] **Step 1: Fold EL overflow into the server-rendered `_modalAlBalance`**

In `src/main.js`, replace the single line (currently `src/main.js:10579`):

```javascript
  const _modalAlBalance = Math.max(0, _modalTotalAL - _modalAlUsedPre - (autoSystemUsage ? _modalSysUsedAL : _modalAlUsedSysAdj) - _modalAlPelarasan);
```

with:

```javascript
  // EL overflow into AL (mirror getLeaveStats): excess EL usage beyond the EL bucket is
  // deducted from AL here too, so the modal's "Baki AL Sebenar" matches the dashboard.
  const _modalElSys      = _modalSysUsed('EL');
  const _modalElEnt      = (staff.ent_EL !== undefined && staff.ent_EL !== null) ? parseFloat(staff.ent_EL) : 3;
  const _modalElOverflow = computeElOverflow({
    entEL: _modalElEnt,
    usedPre: parseFloat(staff.el_used_pre || 0),
    usedSys: autoSystemUsage ? _modalElSys : parseFloat(staff.el_used_sys_adj || 0),
    pelarasan: parseFloat(staff.el_pelarasan || 0)
  });
  const _modalAlBalance = Math.max(0, _modalTotalAL - _modalAlUsedPre - (autoSystemUsage ? _modalSysUsedAL : _modalAlUsedSysAdj) - _modalAlPelarasan - _modalElOverflow);
```

- [ ] **Step 2: Add the note span under "Baki AL Sebenar"**

In `src/main.js`, find the descriptor span inside the "Baki AL Sebenar" block (currently
`src/main.js:10750`):

```javascript
                <span style="font-size: 0.68rem; color: var(--text-muted); margin-top: 0.35rem;">Jumlah − Guna Sebelum − Guna Sistem − Pelarasan HR</span>
```

Insert immediately AFTER it:

```javascript
                <span id="al-el-overflow-note" style="font-size: 0.68rem; color: #f59e0b; font-weight: 700; margin-top: 0.35rem; display: ${_modalElOverflow > 0 ? 'block' : 'none'};">${_modalElOverflow > 0 ? `− ${_modalElOverflow.toFixed(1)} hari ditolak dari limpahan EL` : ''}</span>
```

- [ ] **Step 3: Fold EL overflow into the live recompute `_recalcLeaveBalance`**

In `src/main.js`, replace the tail of `window._recalcLeaveBalance` (currently
`src/main.js:1933-1940`):

```javascript
    const pre = parseFloat(document.getElementById(prefix + '-used-pre-input')?.value || 0);
    const sysAuto = parseFloat(document.getElementById(prefix + '-sys-used-display')?.dataset.used || 0);
    const sysManual = parseFloat(document.getElementById(prefix + '-sys-adj-input')?.value || 0);
    const sys = autoSystemUsage ? sysAuto : sysManual;
    const pel = parseFloat(document.getElementById(prefix + '-pelarasan-input')?.value || 0);
    const balEl = document.getElementById(prefix + '-balance-display');
    if (balEl) balEl.value = Math.max(0, total - pre - sys - pel).toFixed(1);
};
```

with:

```javascript
    const pre = parseFloat(document.getElementById(prefix + '-used-pre-input')?.value || 0);
    const sysAuto = parseFloat(document.getElementById(prefix + '-sys-used-display')?.dataset.used || 0);
    const sysManual = parseFloat(document.getElementById(prefix + '-sys-adj-input')?.value || 0);
    const sys = autoSystemUsage ? sysAuto : sysManual;
    const pel = parseFloat(document.getElementById(prefix + '-pelarasan-input')?.value || 0);
    // AL absorbs EL overflow: read the live EL fields from the same modal so the displayed
    // AL balance stays consistent with the dashboard (getLeaveStats). Only AL is affected.
    let elOv = 0;
    if (prefix === 'al') {
        const elEnt = parseFloat(document.getElementById('ent-EL')?.value || 0);
        const elPre = parseFloat(document.getElementById('el-used-pre-input')?.value || 0);
        const elSysAuto = parseFloat(document.getElementById('el-sys-used-display')?.dataset.used || 0);
        const elSysManual = parseFloat(document.getElementById('el-sys-adj-input')?.value || 0);
        const elPel = parseFloat(document.getElementById('el-pelarasan-input')?.value || 0);
        elOv = computeElOverflow({ entEL: elEnt, usedPre: elPre, usedSys: autoSystemUsage ? elSysAuto : elSysManual, pelarasan: elPel });
        const noteEl = document.getElementById('al-el-overflow-note');
        if (noteEl) {
            noteEl.textContent = elOv > 0 ? `− ${elOv.toFixed(1)} hari ditolak dari limpahan EL` : '';
            noteEl.style.display = elOv > 0 ? 'block' : 'none';
        }
    }
    const balEl = document.getElementById(prefix + '-balance-display');
    if (balEl) balEl.value = Math.max(0, total - pre - sys - pel - elOv).toFixed(1);
    // Editing EL fields must refresh the AL balance, since AL absorbs EL overflow.
    if (prefix === 'el') window._recalcLeaveBalance('al');
};
```

- [ ] **Step 4: Verify the build compiles**

Run: `npm run build`
Expected: build completes with no error.

- [ ] **Step 5: Manual verification**

Run `npm run dev`, open the HR staff-edit modal for a staff member with EL overflow. Confirm:
- "Baki AL Sebenar" matches that staff's dashboard AL balance, and the amber note "− X hari ditolak dari limpahan EL" appears.
- Editing an EL field (e.g. EL Pelarasan HR, or EL Guna Sebelum Sistem) live-updates the AL balance and the note.
- A staff member with no EL overflow shows no note and an unchanged AL balance.

- [ ] **Step 6: Commit**

```bash
git add src/main.js
git commit -m "feat(leave): reflect EL overflow in HR staff-edit AL balance"
```

---

## Self-Review Notes

- **Spec coverage:** §1 overflow formula → Task 1; §2 AL balance + reports (automatic via `.bal`) → Task 2; §3 apply-time warning → Task 4; §4 print form → Task 3; scope/global constraints → Global Constraints block. All spec sections mapped.
- **Year-scoped overflow (spec test 5):** enforced by the existing year filter inside `getLeaveStats` (the EL stats are computed for `leaveYear`), not by the pure helper — covered by Task 2 Step 4 manual check rather than a unit test, since `getLeaveStats` is not unit-testable in isolation.
- **Type consistency:** `computeElOverflow` signature/field names (`entEL`, `usedPre`, `usedSys`, `pelarasan`) and the `elOverflow` return field are identical across Tasks 1–4.
