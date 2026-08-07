# EL Label Clarity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the UI showing the bare storage code `EL`, which readers parse as "Emergency Leave" when it actually means Cuti Ehsan.

**Architecture:** Display-string changes only. One data change — a new entry in the frozen `LEAVE_TYPE_SHORT` map in `src/leaveTypes.js` — propagates to every caller of `leaveTypeShort()`. The rest are literal HTML/alert strings inside `src/main.js`. No balance arithmetic, no Firestore field, and no leave-type `id` is touched.

**Tech Stack:** Vanilla JS ES modules (Vite), `node:test` built-in test runner, Firebase Firestore (untouched).

## Global Constraints

- Never change any `id` in `LEAVE_CATEGORIES`. `EL` and `EL_EMG` appear in every historical Firestore leave record and in staff fields `ent_EL` / `ent_EL_EMG`.
- Never change balance arithmetic. Cuti Ehsan keeps its 3-day bucket; only the excess overflows to AL via `computeElOverflow` in `src/leaveBalance.js`.
- Display language is Malay. `EL` becomes `Cuti Ehsan` in prose, `EHSAN` in short-code positions.
- `EL_EMG` keeps its short code `EMG` and its name `Cuti Kecemasan`.
- Run tests with `node --test tests/leaveTypes.test.mjs`. Do **not** run the whole `tests/` directory — the Firestore-rules tests there need a JDK on PATH and an emulator.
- Design reference: `docs/superpowers/specs/2026-08-07-el-label-clarity-design.md`.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/leaveTypes.js` | Single source of truth for what a leave type is called | Add `EL: 'EHSAN'` to `LEAVE_TYPE_SHORT` |
| `tests/leaveTypes.test.mjs` | Pins the storage-code/display-name boundary | Extend the existing short-code test |
| `src/main.js` | The whole app (Firebase + DOM + rendering) | Four independent clusters of literal strings — one per task below |

`src/main.js` is ~11k lines and does everything; the codebase pattern is to edit it in place. Splitting it is out of scope for a label fix.

---

### Task 1: `EHSAN` short code

**Files:**
- Modify: `src/leaveTypes.js:38-41`
- Modify: `src/main.js:7977` (drop the now-redundant local override)
- Test: `tests/leaveTypes.test.mjs:29-32`

**Interfaces:**
- Consumes: nothing.
- Produces: `leaveTypeShort('EL') === 'EHSAN'`. Every later task assumes this already holds.

- [ ] **Step 1: Write the failing test**

In `tests/leaveTypes.test.mjs`, replace the existing `short codes never show the raw storage code` test (lines 29-32) with:

```javascript
test('short codes never show the raw storage code', () => {
  assert.strictEqual(leaveTypeShort('EL'), 'EHSAN');
  assert.strictEqual(leaveTypeShort('EL_EMG'), 'EMG');
  assert.strictEqual(leaveTypeShort('ML_PL'), 'PL');
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --test tests/leaveTypes.test.mjs
```

Expected: FAIL on `short codes never show the raw storage code` — actual `'EL'`, expected `'EHSAN'`.

- [ ] **Step 3: Add the short code**

In `src/leaveTypes.js`, replace lines 35-41:

```javascript
// Short codes for table headers and summary chips, where the full name does not fit.
// EL becomes EHSAN because the bare letters read as "Emergency Leave" — EL is Cuti Ehsan
// (bereavement); the general-emergency type is EL_EMG, shown as EMG. Codes absent here
// are shown as-is.
export const LEAVE_TYPE_SHORT = Object.freeze({
  EL:     'EHSAN',
  EL_EMG: 'EMG',
  ML_PL:  'PL',
});
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node --test tests/leaveTypes.test.mjs
```

Expected: PASS, all tests. In particular `short codes stay unique` must still pass — `EHSAN` and `EMG` do not collide.

- [ ] **Step 5: Drop the local override in the print-report buttons**

`src/main.js:7977` builds the per-type print buttons with its own label map. Change:

```javascript
const lbl={EL:'EHSAN',EL_EMG:'KECEMASAN',ML_PL:'PL'}[t]||t;
```

to:

```javascript
const lbl={EL_EMG:'KECEMASAN'}[t]||leaveTypeShort(t);
```

`EL_EMG` keeps its override because that button deliberately wants the full word `KECEMASAN`, not `EMG`. `leaveTypeShort` is already imported at `src/main.js:7`.

- [ ] **Step 6: Commit**

```bash
git add src/leaveTypes.js src/main.js tests/leaveTypes.test.mjs
git commit -m "fix(leave): show EL as EHSAN so it stops reading as Emergency Leave"
```

---

### Task 2: Edit-staff modal in Management Hub

**Files:**
- Modify: `src/main.js:10142` (helper signature), `:10169` (balance label), `:10327` (EL block title)
- Modify: `src/main.js:10321` and `src/main.js:2008` (overflow note — two copies of one sentence)

**Interfaces:**
- Consumes: nothing from Task 1 (these are literal strings, not `leaveTypeShort` calls).
- Produces: `_leaveBreakdownHTML(prefix, typeId, title, annualDefault, accent, balanceLabel = typeId)` — a sixth optional parameter. Existing 5-argument calls keep their current behaviour.

- [ ] **Step 1: Add the `balanceLabel` parameter**

`src/main.js:10142` — change:

```javascript
  const _leaveBreakdownHTML = (prefix, typeId, title, annualDefault, accent) => {
```

to:

```javascript
  // balanceLabel: what the "Baki … Sebenar" field calls this type. Defaults to the storage
  // code, which reads fine for MC and CME. EL passes "Cuti Ehsan" — the bare code misleads.
  const _leaveBreakdownHTML = (prefix, typeId, title, annualDefault, accent, balanceLabel = typeId) => {
```

- [ ] **Step 2: Use it in the balance label**

`src/main.js:10169` — change:

```javascript
            <label style="font-size: 0.75rem; margin-bottom: 0.5rem; color: #10b981; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">Baki ${typeId} Sebenar</label>
```

to:

```javascript
            <label style="font-size: 0.75rem; margin-bottom: 0.5rem; color: #10b981; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">Baki ${balanceLabel} Sebenar</label>
```

- [ ] **Step 3: Retitle the EL block**

`src/main.js:10327` — change:

```javascript
          ${_leaveBreakdownHTML('el', 'EL', 'EL — Cuti Ehsan', 3, '#f59e0b')}
```

to:

```javascript
          ${_leaveBreakdownHTML('el', 'EL', 'Cuti Ehsan (Kematian Keluarga Terdekat)', 3, '#f59e0b', 'Cuti Ehsan')}
```

Leave the MC call on `:10326` and the CME call on `:10329` untouched.

- [ ] **Step 4: Fix the overflow note — render path**

`src/main.js:10321` — inside the `al-el-overflow-note` span, change the template literal:

```javascript
`− ${_modalElOverflow.toFixed(1)} hari ditolak dari limpahan EL`
```

to:

```javascript
`− ${_modalElOverflow.toFixed(1)} hari ditolak dari limpahan Cuti Ehsan`
```

- [ ] **Step 5: Fix the overflow note — live-recalc path**

`src/main.js:2008` — change:

```javascript
            noteEl.textContent = elOv > 0 ? `− ${elOv.toFixed(1)} hari ditolak dari limpahan EL` : '';
```

to:

```javascript
            noteEl.textContent = elOv > 0 ? `− ${elOv.toFixed(1)} hari ditolak dari limpahan Cuti Ehsan` : '';
```

Both copies must change. `:10321` paints the note when the modal opens; `:2008` repaints it on every keystroke. If only one changes, the wording flips as soon as the user types.

- [ ] **Step 6: Verify the bundle still builds**

```bash
npm run build
```

Expected: build succeeds with no errors. (There is no unit test for `main.js` — it imports `style.css`, Firebase and Chart.js, so it cannot load under `node --test`.)

- [ ] **Step 7: Commit**

```bash
git add src/main.js
git commit -m "fix(leave): name the Cuti Ehsan block properly in the staff edit modal"
```

---

### Task 3: Policy section says EL is Cuti Kecemasan — it is not

**Files:**
- Modify: `src/main.js:9826`, `:9831`, `:9844`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing consumed later.

This is a factual error, not a wording preference: since the 2026-08-05 relabel, `EL` is Cuti Ehsan and `EL_EMG`/`EMG` is Cuti Kecemasan. The table has them backwards.

- [ ] **Step 1: Fix the heading**

`src/main.js:9826` — change:

```html
3. Perbandingan: Cuti Kecemasan (EL) vs Cuti Ehsan
```

to:

```html
3. Perbandingan: Cuti Kecemasan (EMG) vs Cuti Ehsan (EL)
```

- [ ] **Step 2: Fix the column header**

`src/main.js:9831` — change the `<th>` text `Cuti Kecemasan (EL)` to `Cuti Kecemasan (EMG)`. Leave the neighbouring `Cuti Ehsan (Compassionate)` header on `:9832` alone.

- [ ] **Step 3: Make the "Tolak Baki Cuti?" row tell the whole truth**

`src/main.js:9844` — the Cuti Ehsan cell currently reads `Tambahan Percuma (Tanpa tolak AL)`, which is only true for the first 3 days. Change that cell's text to:

```html
Tambahan percuma untuk 3 hari pertama. Lebihan melebihi 3 hari ditolak dari AL.
```

Leave the Cuti Kecemasan cell on `:9843` (`Ya. Ditolak dari Annual Leave (AL)`) unchanged.

- [ ] **Step 4: Verify the bundle still builds**

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/main.js
git commit -m "fix(policy): EL is Cuti Ehsan, EMG is Cuti Kecemasan — the table had them swapped"
```

---

### Task 4: Attendance-table column and the apply-time overflow alert

**Files:**
- Modify: `src/main.js:8588` (on-screen attendance table header)
- Modify: `src/main.js:3161` (print attendance table header)
- Modify: `src/main.js:4828` (alert shown when an EL application overflows into AL)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing consumed later.

The column labelled `EL` sums **both** types — `(ml['EL']||0)+(ml['EL_EMG']||0)` at `:8545` and `:8569` on screen, `:3131` and `:3175` in print. It stays combined; only the label and tooltip change, so the header must name both.

- [ ] **Step 1: Fix the on-screen header and its wrong tooltip**

`src/main.js:8588` — change:

```html
<th style="padding:0.55rem 0.5rem;text-align:center;font-size:0.63rem;font-weight:700;color:#f59e0b;min-width:42px;" title="Emergency Leave">EL</th>
```

to:

```html
<th style="padding:0.55rem 0.5rem;text-align:center;font-size:0.63rem;font-weight:700;color:#f59e0b;min-width:42px;" title="Cuti Ehsan + Cuti Kecemasan">EHSAN+KEC</th>
```

- [ ] **Step 2: Fix the print header**

`src/main.js:3161` — change:

```html
<th style="padding:7px 6px;text-align:center;font-size:10px;color:#d97706;">EL</th>
```

to:

```html
<th style="padding:7px 6px;text-align:center;font-size:10px;color:#d97706;">EHSAN+KEC</th>
```

- [ ] **Step 3: Fix the apply-time alert**

`src/main.js:4828` — change:

```javascript
              let elMsg = "Notis: Baki EL anda tinggal " + elBal.toFixed(2) + " hari. Permohonan " + diffDays + " hari akan ditolak " + fromEL.toFixed(1) + " hari dari EL dan " + toAL.toFixed(1) + " hari dari Cuti Tahunan (AL).";
```

to:

```javascript
              let elMsg = "Notis: Baki Cuti Ehsan anda tinggal " + elBal.toFixed(2) + " hari. Permohonan " + diffDays + " hari akan ditolak " + fromEL.toFixed(1) + " hari dari Cuti Ehsan dan " + toAL.toFixed(1) + " hari dari Cuti Tahunan (AL).";
```

Leave `leaveBreakdown` on `:4827` alone. That is the English `*EL OVERFLOW*` block in the WhatsApp copy-text, deliberately mirroring the `*SPLIT LEAVE DETECTED*` marker on `:4816`; it already explains itself ("EL bucket exhausted → overflow deducted from AL").

- [ ] **Step 4: Verify the bundle still builds**

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/main.js
git commit -m "fix(reports): label the combined Ehsan+Kecemasan column honestly"
```

---

### Task 5: Confirm no bare `EL` remains in user-facing Malay text

**Files:**
- Inspect only: `src/main.js`, `src/leaveTypes.js`

**Interfaces:**
- Consumes: the output of Tasks 1-4.
- Produces: nothing.

- [ ] **Step 1: Sweep for leftovers**

```bash
grep -n "Baki EL\|limpahan EL\|EL —\|(EL)\|>EL<" src/main.js src/leaveTypes.js
```

Expected remaining hits, all correct:
- `src/main.js:9826` — `Cuti Ehsan (EL)`, the glossary-style heading added in Task 3.
- `src/main.js:526` — `{ code:'EL', name:'Compassionate Leave (Cuti Ehsan)' }`, the help-bot glossary that deliberately maps the code to its name.

Any other hit is a miss — fix it and re-run.

- [ ] **Step 2: Confirm no balance logic moved**

```bash
git diff eb0f852..HEAD -- src/leaveBalance.js src/yearEnd.js
```

Expected: empty. Those files hold the balance arithmetic and must be untouched.

- [ ] **Step 3: Run the unit tests one final time**

```bash
node --test tests/leaveTypes.test.mjs tests/leaveBalance.test.mjs
```

Expected: PASS. `leaveBalance.test.mjs` is the regression net proving the Cuti Ehsan → AL overflow maths is unchanged.

- [ ] **Step 4: Commit if the sweep changed anything**

```bash
git add -A
git commit -m "fix(leave): mop up remaining bare EL labels"
```

Skip this step if the sweep found nothing.

## Manual verification (after all tasks)

1. Management Hub → edit a staff member. The block reads **"Cuti Ehsan (Kematian Keluarga Terdekat) — Peruntukan & Baki"** and the balance field reads **"Baki Cuti Ehsan Sebenar"**.
2. In that modal, type a `Guna Sebelum Sistem` value above 3 in the Cuti Ehsan block. The note under "Baki AL Sebenar" reads **"ditolak dari limpahan Cuti Ehsan"** — and still reads that after further typing (proves both `:2008` and `:10321` were changed).
3. The lower grid still reads **"EMG — Cuti Kecemasan"** and still saves to `ent_EL_EMG`.
4. Panduan / Polisi → section 3 reads **"Cuti Kecemasan (EMG) vs Cuti Ehsan (EL)"**.
5. HR Reports → attendance table column reads **EHSAN+KEC**; hovering shows "Cuti Ehsan + Cuti Kecemasan". Print it — the same header appears and the totals are unchanged.
6. Pick one staff member and compare their AL / MC / Cuti Ehsan balances before and after. They must be identical.
