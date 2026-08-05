# Leave-Type Relabel + Cuti Ganti Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop leaking raw storage codes (`EL_EMG`, `ML_PL`) into the UI, settle on one set of Malay leave-type labels app-wide, and add a doctors-only "Cuti Ganti" (`RL`) leave type.

**Architecture:** The leave-type catalogue moves out of `src/main.js` into a new pure module `src/leaveTypes.js` (the pattern already used by `leaveDays.js`, `leaveBalance.js`, `nameFormat.js`). That module owns `LEAVE_CATEGORIES`, the full-name map, and a new short-code map, so the data becomes unit-testable with `node --test`. Everything else is call-site rewiring in `main.js`: ~20 spots that either print a raw code or hardcode an English label. Firestore is not touched — no migration, no rules change.

**Tech Stack:** Vanilla ES modules, Vite 8, Node built-in test runner (`node --test`). No Firebase emulator needed (the tested code is pure).

**Spec:** `docs/superpowers/specs/2026-08-05-leave-type-relabel-and-cuti-ganti-design.md`

## Global Constraints

- **Storage codes never change.** `EL_EMG` and `ML_PL` stay as `record.type` values in Firestore and as `id` in the catalogue. Staff fields `el_used_pre`, `el_used_sys_adj`, `el_pelarasan`, `ent_EL_EMG`, `ent_PL` are untouched. No migration script.
- **Label table** — these exact strings, everywhere:
  | Code | Full name | Short code shown |
  | --- | --- | --- |
  | `EL` | `Cuti Ehsan` | `EL` |
  | `EL_EMG` | `Cuti Kecemasan` | `EMG` |
  | `ML_PL` | `Cuti Paterniti (PL)` | `PL` |
  | `RL` | `Cuti Ganti` | `RL` |
- **`RL` is doctors-only** (`user.category === 'Doctor'`), **no quota** (`entitlement: 0`, never added to `FORMULA_B_TYPES`), **working days** (never added to `CALENDAR_DAY_LEAVE_TYPES`), **no Management Hub field** (never added to the `leaveTypes` array at `main.js:5121`).
- **`RL` colour:** `#14b8a6`.
- All user-facing copy is Malay. Do not introduce new English labels.
- Never write `'EL_EMG'` or `'ML_PL'` as display text. Route through `leaveTypeName()` or `leaveTypeShort()`.
- `src/leaveTypes.js` must have **zero imports** — it is a pure data module so `node --test` can load it without Vite, Firebase, or a DOM.

---

### Task 1: Pure leave-type catalogue module

**Files:**
- Create: `src/leaveTypes.js`
- Create: `tests/leaveTypes.test.mjs`
- Modify: `src/main.js:1-8` (import block), `src/main.js:605-622` (delete local catalogue)

**Interfaces:**
- Consumes: nothing.
- Produces — every later task imports from here:
  - `LEAVE_CATEGORIES: ReadonlyArray<{id, name, entitlement, icon, color, description}>` — 10 entries, order matters (it drives the leave-form picker order).
  - `LEAVE_TYPE_NAMES: Readonly<Record<string,string>>`
  - `leaveTypeName(code: string) => string` — full name, falls back to `code`.
  - `LEAVE_TYPE_SHORT: Readonly<Record<string,string>>`
  - `leaveTypeShort(code: string) => string` — short display code, falls back to `code`.
- In `main.js`, `const leaveCategories = LEAVE_CATEGORIES;` keeps the ~15 existing `leaveCategories.*` call sites working unchanged.

- [ ] **Step 1: Write the failing test**

Create `tests/leaveTypes.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert';
import {
  LEAVE_CATEGORIES, LEAVE_TYPE_NAMES, LEAVE_TYPE_SHORT,
  leaveTypeName, leaveTypeShort,
} from '../src/leaveTypes.js';
import { FORMULA_B_TYPES } from '../src/leaveBalance.js';

// Storage codes (EL_EMG, ML_PL) are frozen into every historical Firestore record.
// Only what a human READS changes. These tests pin that boundary.

test('storage ids are unchanged — renaming is a display concern only', () => {
  const ids = LEAVE_CATEGORIES.map(c => c.id);
  ['AL', 'MC', 'EL', 'EL_EMG', 'UP', 'HL', 'ML', 'ML_PL', 'CME'].forEach(id =>
    assert.ok(ids.includes(id), `${id} must survive — old records still use it`));
});

test('ids are unique', () => {
  const ids = LEAVE_CATEGORIES.map(c => c.id);
  assert.strictEqual(new Set(ids).size, ids.length);
});

test('the three renamed types read as agreed', () => {
  assert.strictEqual(leaveTypeName('EL'), 'Cuti Ehsan');
  assert.strictEqual(leaveTypeName('EL_EMG'), 'Cuti Kecemasan');
  assert.strictEqual(leaveTypeName('ML_PL'), 'Cuti Paterniti (PL)');
});

test('short codes never show the raw storage code', () => {
  assert.strictEqual(leaveTypeShort('EL_EMG'), 'EMG');
  assert.strictEqual(leaveTypeShort('ML_PL'), 'PL');
});

test('short codes stay unique — EMG exists so EL_EMG cannot collide with EL', () => {
  const shorts = LEAVE_CATEGORIES.map(c => leaveTypeShort(c.id));
  assert.strictEqual(new Set(shorts).size, shorts.length,
    `duplicate short code in ${shorts.join(',')}`);
});

test('no display string anywhere contains an underscore code', () => {
  LEAVE_CATEGORIES.forEach(c => {
    assert.ok(!c.name.includes('_'), `${c.id} name leaks a storage code: ${c.name}`);
    assert.ok(!leaveTypeShort(c.id).includes('_'), `${c.id} short code leaks an underscore`);
  });
});

// ── Cuti Ganti (RL) ───────────────────────────────────────────────────
test('RL exists, is called Cuti Ganti, and has no quota', () => {
  const rl = LEAVE_CATEGORIES.find(c => c.id === 'RL');
  assert.ok(rl, 'RL must be in the catalogue');
  assert.strictEqual(rl.name, 'Cuti Ganti');
  assert.strictEqual(rl.entitlement, 0, 'replacement leave is earned, not allocated');
});

test('RL is not a Formula B type — there is no balance to track', () => {
  assert.strictEqual(FORMULA_B_TYPES.includes('RL'), false);
});

// ── Fallbacks ─────────────────────────────────────────────────────────
test('legacy and unknown codes fall back to the raw code, not undefined', () => {
  assert.strictEqual(leaveTypeName('PL'), 'Cuti Paterniti (PL)'); // legacy alias, mapped
  assert.strictEqual(leaveTypeName('CF'), 'Cuti Bawa Ke Hadapan (CF)');
  assert.strictEqual(leaveTypeName('NONSENSE'), 'NONSENSE');
  assert.strictEqual(leaveTypeShort('NONSENSE'), 'NONSENSE');
});

test('the exported maps cannot be mutated by a caller', () => {
  const before = LEAVE_TYPE_SHORT.EL_EMG;
  try { LEAVE_TYPE_SHORT.EL_EMG = 'HACKED'; } catch { /* frozen throws in strict mode */ }
  assert.strictEqual(LEAVE_TYPE_SHORT.EL_EMG, before);
  try { LEAVE_TYPE_NAMES.EL = 'HACKED'; } catch { /* frozen */ }
  assert.strictEqual(LEAVE_TYPE_NAMES.EL, 'Cuti Ehsan');
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test tests/leaveTypes.test.mjs
```

Expected: FAIL — `Cannot find module '.../src/leaveTypes.js'`

- [ ] **Step 3: Create the module**

Create `src/leaveTypes.js`:

```js
// Leave-type catalogue and display labels. No Firebase/DOM dependencies so it is
// unit-testable — main.js cannot be, because it imports style.css, Firebase and Chart.js.
//
// SINGLE SOURCE OF TRUTH for what a leave type is CALLED. The `id` values are
// storage codes: they appear in every historical Firestore leave record and in staff
// fields like `ent_EL_EMG`, so they are effectively permanent. Renaming a leave type
// means changing `name` here, never `id`.

export const LEAVE_CATEGORIES = Object.freeze([
  { id: 'AL',     name: 'Annual Leave (AL)',   entitlement: 14, icon: 'icon-al',   color: '#3b82f6', description: 'Cuti Tahunan mengikut pro-rata bulan bekerja.' },
  { id: 'MC',     name: 'Medical Leave (MC)',  entitlement: 14, icon: 'icon-mc',   color: '#10b981', description: 'Cuti Sakit dengan Sijil Sakit (MC) yang sah.' },
  { id: 'EL',     name: 'Cuti Ehsan',          entitlement: 3,  icon: 'icon-el',   color: '#f59e0b', description: 'Cuti Ehsan — kematian keluarga terdekat.' },
  { id: 'EL_EMG', name: 'Cuti Kecemasan',      entitlement: 0,  icon: 'icon-emg',  color: '#ef4444', description: 'Cuti Kecemasan Am (bukan kematian).' },
  { id: 'UP',     name: 'Unpaid Leave (UL)',   entitlement: 0,  icon: 'icon-ul',   color: '#94a3b8', description: 'Cuti Tanpa Gaji (Setelah baki AL habis digunakan).' },
  { id: 'HL',     name: 'Hospitalization (HL)', entitlement: 60, icon: 'icon-hl',  color: '#06b6d4', description: 'Cuti Wad/Hospitalisasi (Maksimum 60 hari).' },
  { id: 'ML',     name: 'Cuti Bersalin',       entitlement: 98, icon: 'icon-ml',   color: '#ec4899', description: 'Cuti Bersalin (98 hari) — kakitangan wanita.' },
  { id: 'ML_PL',  name: 'Cuti Paterniti (PL)', entitlement: 7,  icon: 'icon-mlpl', color: '#6366f1', description: 'Cuti Bapa Isteri Bersalin (7 hari) — kakitangan lelaki.' },
  { id: 'CME',    name: 'Latihan CME',         entitlement: 5,  icon: 'icon-cme',  color: '#8b5cf6', description: 'Cuti Pendidikan Perubatan Berterusan (Doktor sahaja).' },
  { id: 'RL',     name: 'Cuti Ganti',          entitlement: 0,  icon: 'icon-rl',   color: '#14b8a6', description: 'Cuti ganti selepas menghadiri mesyuarat doktor (Doktor sahaja).' },
]);

// Full display names. Derived from the catalogue, plus legacy codes that appear in
// old records but are no longer applied for: PL (superseded by ML_PL) and CF
// (carry-forward, a balance bucket rather than a leave type).
export const LEAVE_TYPE_NAMES = Object.freeze({
  ...Object.fromEntries(LEAVE_CATEGORIES.map(c => [c.id, c.name])),
  PL: 'Cuti Paterniti (PL)',
  CF: 'Cuti Bawa Ke Hadapan (CF)',
});

export function leaveTypeName(code) {
  return LEAVE_TYPE_NAMES[code] || code;
}

// Short codes for table headers and summary chips, where the full name does not fit.
// EL_EMG becomes EMG rather than EL because Cuti Ehsan already owns EL and the two
// sit in adjacent columns. Codes absent here are shown as-is.
export const LEAVE_TYPE_SHORT = Object.freeze({
  EL_EMG: 'EMG',
  ML_PL: 'PL',
});

export function leaveTypeShort(code) {
  return LEAVE_TYPE_SHORT[code] || code;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test tests/leaveTypes.test.mjs
```

Expected: PASS — 10 tests.

- [ ] **Step 5: Wire main.js to the module**

In `src/main.js`, add the import after line 6 (`import { formatPersonName } from './nameFormat.js';`):

```js
import { LEAVE_CATEGORIES, LEAVE_TYPE_NAMES, leaveTypeName, leaveTypeShort } from './leaveTypes.js';
```

Then delete the local catalogue at `src/main.js:605-622` — everything from `const leaveCategories = [` through `function leaveTypeName(code) { ... }` — and replace it with:

```js
// Katalog jenis cuti + label paparan: src/leaveTypes.js (modul tulen, ada ujian).
// Alias tempatan supaya ~15 tapak panggilan `leaveCategories` sedia ada kekal.
const leaveCategories = LEAVE_CATEGORIES;
```

Note: several functions declare a **local** `const leaveTypeName = leaveCategories.find(...)` (`main.js:2390`, `:2570`, `:2606`, `:2627`, `:2652`, `:4800`). Those shadow the import inside their own scope and are legal — leave them alone.

- [ ] **Step 6: Verify the app still builds**

```bash
npm run build
```

Expected: build succeeds, no "leaveTypeName is not defined" or duplicate-declaration error.

- [ ] **Step 7: Commit**

```bash
git add src/leaveTypes.js tests/leaveTypes.test.mjs src/main.js
git commit -m "refactor(leave): extract the leave-type catalogue into a testable module

Renames EL_EMG to Cuti Kecemasan and ML_PL to Cuti Paterniti (PL), and
adds a short-code map so raw storage codes stop reaching the screen.
Storage ids are unchanged, so no record is affected.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Retire the print-report-only label patch, register RL in reports

**Files:**
- Modify: `src/main.js:2873-2879` (colour map, type list, `leaveReportLabel`), `src/main.js:2947`, `src/main.js:2992`

**Interfaces:**
- Consumes: `leaveTypeName()` from Task 1.
- Produces: `ALL_LEAVE_TYPES` now includes `'RL'`; `LEAVE_TYPE_COLOR.RL === '#14b8a6'`. Later tasks assume `leaveReportLabel` no longer exists.

`leaveReportLabel()` existed only because print reports wanted "Cuti Ehsan"/"Cuti Kecemasan" while the catalogue still said "Emergency (Non-Ehsan)". Task 1 made the catalogue say the right thing, so the patch is now dead weight.

- [ ] **Step 1: Replace the colour map and type list**

`src/main.js:2873-2874` — replace:

```js
const LEAVE_TYPE_COLOR = { AL:'#3b82f6', MC:'#10b981', EL:'#f59e0b', EL_EMG:'#ef4444', HL:'#06b6d4', ML:'#ec4899', ML_PL:'#6366f1', CME:'#8b5cf6', UP:'#64748b' };
const ALL_LEAVE_TYPES = ['AL','MC','EL','EL_EMG','HL','ML','ML_PL','CME','UP'];
```

with:

```js
const LEAVE_TYPE_COLOR = { AL:'#3b82f6', MC:'#10b981', EL:'#f59e0b', EL_EMG:'#ef4444', HL:'#06b6d4', ML:'#ec4899', ML_PL:'#6366f1', CME:'#8b5cf6', RL:'#14b8a6', UP:'#64748b' };
const ALL_LEAVE_TYPES = ['AL','MC','EL','EL_EMG','HL','ML','ML_PL','CME','RL','UP'];
```

- [ ] **Step 2: Delete `leaveReportLabel`**

`src/main.js:2875-2879` — delete these five lines entirely:

```js
// Report-only display labels. Overrides the technical LEAVE_TYPE_NAMES for the two
// emergency types so printed reports read EHSAN / KECEMASAN (dashboard/analytics unchanged).
function leaveReportLabel(type) {
  return ({ EL: 'Cuti Ehsan', EL_EMG: 'Cuti Kecemasan' })[type] || LEAVE_TYPE_NAMES[type] || type;
}
```

- [ ] **Step 3: Update both call sites**

`src/main.js:2947` — replace `${leaveReportLabel(type)}` with `${leaveTypeName(type)}`.

`src/main.js:2992` — replace:

```js
  const typeName = leaveReportLabel(type);
```

with:

```js
  const typeName = leaveTypeName(type);
```

- [ ] **Step 4: Verify no references remain**

```bash
grep -rn "leaveReportLabel" src/
```

Expected: no output.

- [ ] **Step 5: Verify the build**

```bash
npm run build
```

Expected: success.

- [ ] **Step 6: Commit**

```bash
git add src/main.js
git commit -m "refactor(reports): drop leaveReportLabel, register RL in report maps

The catalogue now carries the Malay names the print reports were
patching in, so one label source is enough.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Stop printing raw codes in analytics and HR report tables

**Files:**
- Modify: `src/main.js:3256`, `src/main.js:3265`, `src/main.js:8195`, `src/main.js:8219`, `src/main.js:8244-8245`, `src/main.js:8385`

**Interfaces:**
- Consumes: `leaveTypeShort()` from Task 1.
- Produces: nothing new.

- [ ] **Step 1: Add RL to both colour maps**

`src/main.js:3256` and `src/main.js:8195` contain the **same** line. Replace both occurrences of:

```js
{ AL:'#3b82f6', MC:'#10b981', EL:'#f59e0b', EL_EMG:'#ef4444', UP:'#94a3b8', HL:'#06b6d4', ML:'#ec4899', ML_PL:'#6366f1', CME:'#8b5cf6' };
```

with:

```js
{ AL:'#3b82f6', MC:'#10b981', EL:'#f59e0b', EL_EMG:'#ef4444', UP:'#94a3b8', HL:'#06b6d4', ML:'#ec4899', ML_PL:'#6366f1', CME:'#8b5cf6', RL:'#14b8a6' };
```

(Use a replace-all edit; the surrounding `const typeColors =` / `const typeColorMap =` prefixes differ but the object literal is identical.)

- [ ] **Step 2: Fix the print-report summary chip**

`src/main.js:3265` — replace:

```js
          <div style="font-size:9px;font-weight:700;text-transform:uppercase;color:${c};">${t}</div>
```

with:

```js
          <div style="font-size:9px;font-weight:700;text-transform:uppercase;color:${c};">${leaveTypeShort(t)}</div>
```

- [ ] **Step 3: Fix the on-screen summary chip**

`src/main.js:8219` — replace:

```js
                  <div style="font-size:0.65rem;font-weight:800;text-transform:uppercase;letter-spacing:0.5px;color:${c};">${t}</div>
```

with:

```js
                  <div style="font-size:0.65rem;font-weight:800;text-transform:uppercase;letter-spacing:0.5px;color:${c};">${leaveTypeShort(t)}</div>
```

- [ ] **Step 4: Fix the cross-tab column header**

`src/main.js:8244-8245` — replace:

```js
                          <div>${t}</div>
                          <div style="font-size:0.58rem;font-weight:500;color:var(--text-muted);margin-top:0.15rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:68px;">${cat?cat.name.split(' ')[0]:''}</div>
```

with:

```js
                          <div>${leaveTypeShort(t)}</div>
                          <div style="font-size:0.58rem;font-weight:500;color:var(--text-muted);margin-top:0.15rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:68px;">${cat?cat.name:''}</div>
```

The `.split(' ')[0]` took the first word of the old English names ("Annual", "Emergency"). Now that most names start with "Cuti", it would render "Cuti" under every column. The full name is used instead — the element already truncates with an ellipsis at `max-width:68px`.

- [ ] **Step 5: Fix the balance-report type dropdown**

`src/main.js:8385` — replace:

```js
                ${leaveCategories.map(c=>`<option value="${c.id}" ${balanceReportType===c.id?'selected':''}>${c.id} — ${c.name}</option>`).join('')}
```

with:

```js
                ${leaveCategories.map(c=>`<option value="${c.id}" ${balanceReportType===c.id?'selected':''}>${leaveTypeShort(c.id)} — ${c.name}</option>`).join('')}
```

- [ ] **Step 6: Verify no raw codes remain in these views**

```bash
npm run build
grep -n "cat.name.split" src/main.js
```

Expected: build succeeds; grep returns no output.

- [ ] **Step 7: Commit**

```bash
git add src/main.js
git commit -m "fix(reports): show EMG/PL in tables instead of the raw storage codes

Column headers and summary chips printed record.type verbatim, so HR
read "EL_EMG" and "ML_PL". Also drops a first-word truncation that would
have labelled every column "Cuti" after the rename.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Staff-facing labels — dashboard and analytics ranking

**Files:**
- Modify: `src/main.js:5456`, `src/main.js:5548`, `src/main.js:5841-5843`

**Interfaces:**
- Consumes: nothing beyond Task 1's renames.
- Produces: nothing new.

- [ ] **Step 1: Fix the analytics ranking card**

`src/main.js:5456` — replace:

```js
          {type:'EL_EMG',label:'Emergency Leave', short:'EL',  grad:'linear-gradient(135deg,#dc2626,#f97316)', glow:'rgba(239,68,68,0.3)',   icon:'<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'},
```

with:

```js
          {type:'EL_EMG',label:'Cuti Kecemasan', short:'EMG', grad:'linear-gradient(135deg,#dc2626,#f97316)', glow:'rgba(239,68,68,0.3)',   icon:'<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'},
```

- [ ] **Step 2: Fix the ranking modal header**

`src/main.js:5548` — replace:

```js
          'EL_EMG': { label:'Emergency Leave', grad:'linear-gradient(135deg,#dc2626,#f97316)', glow:'rgba(239,68,68,0.3)' },
```

with:

```js
          'EL_EMG': { label:'Cuti Kecemasan', grad:'linear-gradient(135deg,#dc2626,#f97316)', glow:'rgba(239,68,68,0.3)' },
```

- [ ] **Step 3: Fix the "Baki Cuti Lain" card labels**

`src/main.js:5841-5843` — replace:

```js
    { label: 'Cuti Paterniti', stats: mlPlStats, color: '#6366f1' },
    { label: 'Kecemasan Ehsan (EL)', stats: elStats, color: '#f59e0b' },
    { label: 'Kecemasan Am (EL_EMG)', stats: elEmgStats, color: '#ef4444' },
```

with:

```js
    { label: 'Cuti Paterniti (PL)', stats: mlPlStats, color: '#6366f1' },
    { label: 'Cuti Ehsan', stats: elStats, color: '#f59e0b' },
    { label: 'Cuti Kecemasan', stats: elEmgStats, color: '#ef4444' },
```

`RL` is deliberately not added to this list: the list filters on `stats.ent > 0` and Cuti Ganti has no entitlement, so there is no balance to show.

- [ ] **Step 4: Verify the build**

```bash
npm run build
```

Expected: success.

- [ ] **Step 5: Commit**

```bash
git add src/main.js
git commit -m "fix(dashboard): use the agreed Malay leave labels on staff-facing cards

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Cuti Ganti in the leave application form

**Files:**
- Modify: `src/main.js:4893`, `src/main.js:6036-6043`, `src/main.js:6049`, `src/main.js:6062-6077`

**Interfaces:**
- Consumes: `LEAVE_CATEGORIES` entry for `RL` from Task 1.
- Produces: `RL` becomes selectable by doctors and submittable end-to-end.

- [ ] **Step 1: Gate RL to doctors and add the safety fallback**

`src/main.js:6036-6043` — replace:

```js
      if (selectedLeaveType === 'ML' && gender === 'Male') selectedLeaveType = 'AL';
      if (selectedLeaveType === 'ML_PL' && gender === 'Female') selectedLeaveType = 'AL';

      const filteredCategories = leaveCategories.filter(cat => {
          if (cat.id === 'ML') return gender === 'Female';
          if (cat.id === 'ML_PL') return gender === 'Male';
          return true;
      });
```

with:

```js
      // Cuti Ganti ialah cuti gantian selepas mesyuarat doktor — doktor sahaja,
      // sama seperti CME. Kategori disemak, bukan peranan.
      const isDoctorApplicant = user.category === 'Doctor';

      if (selectedLeaveType === 'ML' && gender === 'Male') selectedLeaveType = 'AL';
      if (selectedLeaveType === 'ML_PL' && gender === 'Female') selectedLeaveType = 'AL';
      if (selectedLeaveType === 'RL' && !isDoctorApplicant) selectedLeaveType = 'AL';

      const filteredCategories = leaveCategories.filter(cat => {
          if (cat.id === 'ML') return gender === 'Female';
          if (cat.id === 'ML_PL') return gender === 'Male';
          if (cat.id === 'RL') return isDoctorApplicant;
          return true;
      });
```

- [ ] **Step 2: Exempt RL from the advance-notice policy (form-render copy)**

`src/main.js:6049` — replace:

```js
      const isNoticeExempt = ['MC', 'EL_EMG', 'EL', 'CME'].includes(selectedLeaveType);
```

with:

```js
      const isNoticeExempt = ['MC', 'EL_EMG', 'EL', 'CME', 'RL'].includes(selectedLeaveType);
```

- [ ] **Step 3: Exempt RL from the advance-notice policy (submit validation)**

`src/main.js:4893` — replace:

```js
      const _noticeExempt = ['MC', 'EL_EMG', 'EL', 'CME'].includes(selectedLeaveType);
```

with:

```js
      const _noticeExempt = ['MC', 'EL_EMG', 'EL', 'CME', 'RL'].includes(selectedLeaveType);
```

Also update the comment on `src/main.js:4892` to mention Cuti Ganti:

```js
      // Cuti tak boleh dirancang (MC sakit, Kecemasan, Ehsan/kematian) + CME dan Cuti Ganti (dituntut selepas mesyuarat) dikecualikan dari polisi notis awal (3/7 hari) — tetapi tetap perlu pelulus + bukti.
```

Without this, the 7-day-notice rule for non-Admin staff rejects every Cuti Ganti application, because the leave is claimed *after* the meeting has already happened.

- [ ] **Step 4: Add the RL icon and short label**

`src/main.js:6071` — after the `'CME':` line inside `leaveIcons`, add:

```js
        'RL':          '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>',
```

`src/main.js:6073-6077` — replace:

```js
      const leaveShort = {
        'AL':'Tahunan','MC':'Sakit','EL':'Ehsan','EL_EMG':'Kecemasan',
        'UP':'Tanpa Gaji','HL':'Hospital','ML':'Bersalin','ML_PL':'Paterniti',
        'CME':'CME'
      };
```

with:

```js
      const leaveShort = {
        'AL':'Tahunan','MC':'Sakit','EL':'Ehsan','EL_EMG':'Kecemasan',
        'UP':'Tanpa Gaji','HL':'Hospital','ML':'Bersalin','ML_PL':'Paterniti',
        'CME':'CME','RL':'Ganti'
      };
```

- [ ] **Step 5: Verify the build**

```bash
npm run build
```

Expected: success.

- [ ] **Step 6: Manual check in the running app**

```bash
npm run dev
```

Log in as a doctor. Open *Mohon Cuti*. Confirm:
- "Cuti Ganti" appears in the leave-type picker with the description "Cuti ganti selepas menghadiri mesyuarat doktor (Doktor sahaja)."
- Selecting it shows no advance-notice warning.
- Submitting a date range in the past or within 7 days is accepted (no "Policy Violation" alert).

Log in as a non-doctor. Confirm "Cuti Ganti" is absent from the picker.

- [ ] **Step 7: Commit**

```bash
git add src/main.js
git commit -m "feat(leave): add Cuti Ganti (RL) for doctors

Replacement leave claimed after a doctors' meeting. Doctors-only, no
quota, and exempt from the advance-notice policy — the leave is by
definition claimed after the event, so the 7-day rule would reject
every application.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Fix the misleading Management Hub entitlement labels

**Files:**
- Modify: `src/main.js:10340-10347`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

This is the bug that prompted the work: the field bound to `ent-EL_EMG` is labelled "EL", but `EL` is a different leave type with its own Formula B block higher up the same modal. HR filling in "EL" here has been setting the Cuti Kecemasan entitlement.

- [ ] **Step 1: Relabel both fields**

`src/main.js:10340-10347` — replace:

```js
            <div style="display: flex; flex-direction: column;">
               <label style="font-size: 0.85rem; margin-bottom: 0.5rem; color: var(--text-muted); font-weight: 500;">PL &mdash; Cuti Isteri Bersalin</label>
               <input type="number" id="ent-PL" class="neu-inset" value="${staff.ent_PL !== undefined ? staff.ent_PL : 7}">
            </div>
            <div style="display: flex; flex-direction: column;">
               <label style="font-size: 0.85rem; margin-bottom: 0.5rem; color: var(--text-muted); font-weight: 500;">EL &mdash; Cuti Kecemasan</label>
               <input type="number" id="ent-EL_EMG" class="neu-inset" value="${staff.ent_EL_EMG !== undefined ? staff.ent_EL_EMG : 0}">
            </div>
```

with:

```js
            <div style="display: flex; flex-direction: column;">
               <label style="font-size: 0.85rem; margin-bottom: 0.5rem; color: var(--text-muted); font-weight: 500;">PL &mdash; Cuti Paterniti</label>
               <input type="number" id="ent-PL" class="neu-inset" value="${staff.ent_PL !== undefined ? staff.ent_PL : 7}">
            </div>
            <div style="display: flex; flex-direction: column;">
               <!-- EMG, bukan EL: medan ini menetapkan ent_EL_EMG (Cuti Kecemasan).
                    Cuti Ehsan (EL) ada blok Formula B tersendiri di atas. -->
               <label style="font-size: 0.85rem; margin-bottom: 0.5rem; color: var(--text-muted); font-weight: 500;">EMG &mdash; Cuti Kecemasan</label>
               <input type="number" id="ent-EL_EMG" class="neu-inset" value="${staff.ent_EL_EMG !== undefined ? staff.ent_EL_EMG : 0}">
            </div>
```

The input `id`s are unchanged — `ent-PL` and `ent-EL_EMG` are read by the save loop at `src/main.js:5121-5131` and by `getLeaveStats` via the `ent_PL` legacy key mapping at `src/main.js:4453`.

- [ ] **Step 2: Verify the ids still match the save loop**

```bash
grep -n "ent-PL\|ent-EL_EMG\|'PL', 'EL_EMG'\|ent_PL" src/main.js
```

Expected: `ent-PL` and `ent-EL_EMG` each appear once in the modal; `leaveTypes` at `:5121` still lists `'PL'` and `'EL_EMG'`; `:4453-4454` still maps `ML_PL` → `ent_PL`.

- [ ] **Step 3: Verify the build**

```bash
npm run build
```

Expected: success.

- [ ] **Step 4: Manual check**

Open Management Hub → edit a staff member. Confirm the lower grid reads "PL — Cuti Paterniti" and "EMG — Cuti Kecemasan", that the Formula B block above still reads "EL — Cuti Ehsan", and that saving a value in the EMG field persists after reopening the modal.

- [ ] **Step 5: Commit**

```bash
git add src/main.js
git commit -m "fix(hub): label the EL_EMG entitlement field EMG, not EL

The field writes ent_EL_EMG (Cuti Kecemasan) but was labelled EL, which
is a different leave type with its own Formula B block in the same
modal. Storage keys unchanged.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Printed leave form and the help bot

**Files:**
- Modify: `src/main.js:2147-2153` (print form checkboxes), `src/main.js:525` (glossary), `src/main.js:669-670` (FAQ)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Add a Cuti Ganti checkbox to the printed leave form**

`src/main.js:2147-2153` — replace:

```js
        <div style="display: flex; justify-content: space-between; margin-bottom: 20px; font-size: 11px; font-weight: bold;">
            <span>[ ${record.type === 'AL' ? 'X' : ' '} ] CUTI TAHUNAN</span>
            <span>[ ${record.type === 'CME' ? 'X' : ' '} ] CUTI CME</span>
            <span>[ ${record.type === 'ML' ? 'X' : ' '} ] CUTI BERSALIN</span>
            <span>[ ${record.type === 'EL' ? 'X' : ' '} ] CUTI EHSAN</span>
            <span>[ ${record.type === 'UL' ? 'X' : ' '} ] TANPA GAJI</span>
        </div>
```

with:

```js
        <div style="display: flex; justify-content: space-between; margin-bottom: 20px; font-size: 11px; font-weight: bold;">
            <span>[ ${record.type === 'AL' ? 'X' : ' '} ] CUTI TAHUNAN</span>
            <span>[ ${record.type === 'CME' ? 'X' : ' '} ] CUTI CME</span>
            <span>[ ${record.type === 'RL' ? 'X' : ' '} ] CUTI GANTI</span>
            <span>[ ${record.type === 'ML' ? 'X' : ' '} ] CUTI BERSALIN</span>
            <span>[ ${record.type === 'EL' ? 'X' : ' '} ] CUTI EHSAN</span>
            <span>[ ${record.type === 'UL' ? 'X' : ' '} ] TANPA GAJI</span>
        </div>
```

- [ ] **Step 2: Correct the glossary entry for EL**

`src/main.js:525` — replace:

```js
    { code:'EL',  name:'Emergency Leave (Cuti Kecemasan)' },
```

with:

```js
    { code:'EL',  name:'Compassionate Leave (Cuti Ehsan)' },
    { code:'EMG', name:'Emergency Leave (Cuti Kecemasan)' },
```

The glossary already carries `RL — Replacement Leave (Cuti Ganti)` at `src/main.js:530`; that line is now accurate and needs no change.

- [ ] **Step 3: Add a Cuti Ganti FAQ entry**

`src/main.js:669` — after the `cme-submit` entry (the line ending `...Ketua Jabatan (HOD).' },`) and before the `locum-info` entry, insert:

```js
  { id:'ganti-submit', cat:'Cuti', keywords:['cuti ganti','ganti','replacement','rl','mesyuarat','meeting','doktor'],
    q:'Cuti Ganti (doktor) — apa itu & macam mana mohon?',
    a:'<strong>Cuti Ganti</strong> ialah cuti gantian untuk <strong>doktor sahaja</strong>, selepas menghadiri <strong>mesyuarat doktor</strong>. Ia <strong>tiada kuota tetap</strong> — hari diambil direkod dan dilaporkan, tetapi tiada baki tahunan. Mohon seperti biasa melalui <em>Mohon Cuti</em> → pilih <strong>Cuti Ganti</strong>; <strong>polisi notis awal tidak terpakai</strong> kerana cuti ini dituntut selepas mesyuarat berlangsung.',
    action:{ label:'Pergi ke Borang Cuti', view:'leave-form' } },
```

- [ ] **Step 4: Verify the build**

```bash
npm run build
```

Expected: success.

- [ ] **Step 5: Manual check**

In the running app, open the help bot and search "ganti" — the new entry should appear. Print any approved leave form and confirm the header row now shows six checkboxes without wrapping awkwardly.

- [ ] **Step 6: Commit**

```bash
git add src/main.js
git commit -m "feat(help): document Cuti Ganti, split EL/EMG in the glossary

Also adds a CUTI GANTI checkbox to the printed leave form.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Update the system manual generators

**Files:**
- Modify: `generate_manual_pdf.cjs:819`, `generate_manual_word.cjs:370`, `generate_manual_v2.cjs:500`, `generate_manual_v2.cjs:746`

**Interfaces:**
- Consumes: nothing (these are standalone generator scripts, not part of the app bundle).
- Produces: nothing.

These scripts build the printed system manual. They carry their own hardcoded leave-type tables that now disagree with the app.

- [ ] **Step 1: Fix `generate_manual_pdf.cjs`**

`generate_manual_pdf.cjs:819` — replace:

```js
      <tr><td><strong>EL_EMG</strong></td><td>Emergency (Non-Ehsan)</td><td>—</td><td>Kecemasan am (bukan kematian)</td></tr>
```

with:

```js
      <tr><td><strong>EMG</strong></td><td>Cuti Kecemasan</td><td>—</td><td>Kecemasan am (bukan kematian)</td></tr>
      <tr><td><strong>RL</strong></td><td>Cuti Ganti</td><td>—</td><td>Gantian selepas mesyuarat doktor (doktor sahaja)</td></tr>
```

- [ ] **Step 2: Fix `generate_manual_word.cjs`**

`generate_manual_word.cjs:370` — replace:

```js
      ['EL_EMG',      'Emergency (Non-Ehsan)',      '—',           'Kecemasan am (bukan kematian)'],
```

with:

```js
      ['EMG',         'Cuti Kecemasan',             '—',           'Kecemasan am (bukan kematian)'],
      ['RL',          'Cuti Ganti',                 '—',           'Gantian selepas mesyuarat doktor (doktor sahaja)'],
```

- [ ] **Step 3: Fix `generate_manual_v2.cjs`**

`generate_manual_v2.cjs:500` — replace:

```js
    <tr><td><span class="badge b-purple">ML_PL</span></td><td>Cuti Paterniti</td><td>7 hari</td><td>Kakitangan lelaki — isteri bersalin.</td></tr>
```

with:

```js
    <tr><td><span class="badge b-purple">PL</span></td><td>Cuti Paterniti</td><td>7 hari</td><td>Kakitangan lelaki — isteri bersalin.</td></tr>
    <tr><td><span class="badge b-purple">RL</span></td><td>Cuti Ganti</td><td>—</td><td>Doktor sahaja — gantian selepas mesyuarat doktor.</td></tr>
```

`generate_manual_v2.cjs:746` — replace:

```js
    <li><strong>Cuti Paterniti (ML_PL):</strong> 7 hari untuk kakitangan lelaki apabila isteri bersalin.</li>
```

with:

```js
    <li><strong>Cuti Paterniti (PL):</strong> 7 hari untuk kakitangan lelaki apabila isteri bersalin.</li>
    <li><strong>Cuti Ganti (RL):</strong> doktor sahaja — gantian selepas menghadiri mesyuarat doktor. Tiada kuota tetap.</li>
```

- [ ] **Step 4: Verify no stale codes remain in the generators**

```bash
grep -n "EL_EMG\|ML_PL\|Non-Ehsan" generate_manual_pdf.cjs generate_manual_word.cjs generate_manual_v2.cjs
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add generate_manual_pdf.cjs generate_manual_word.cjs generate_manual_v2.cjs
git commit -m "docs(manual): sync the generator leave-type tables with the app

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Full verification sweep

**Files:** none modified (verification only; fix and re-commit if something fails).

- [ ] **Step 1: Run the whole pure-module test suite**

```bash
node --test tests/leaveTypes.test.mjs tests/leaveBalance.test.mjs tests/formulaBTypes.test.mjs tests/leaveDays.test.mjs tests/nameFormat.test.mjs tests/phoneFormat.test.mjs tests/loginBranches.test.mjs
```

Expected: all pass. `tests/formulaBTypes.test.mjs` must pass **unmodified** — `RL` never enters Formula B, so nothing there should need touching. If it needed a change, the implementation drifted from the spec.

(`tests/rules.test.mjs` and `tests/functions.test.mjs` need the Firebase emulator and are unaffected by this work — skip them.)

- [ ] **Step 2: Confirm no raw storage code is used as display text**

```bash
grep -n "EL_EMG\|ML_PL" src/main.js
```

Expected: every remaining hit is **logic**, not display — array membership tests, colour-map keys, `getLeaveStats` calls, `CALENDAR_DAY_LEAVE_TYPES`, `_modalSysUsed`, comments. No hit should sit inside a template literal that renders to the screen. Review each one.

- [ ] **Step 3: Build**

```bash
npm run build
```

Expected: success.

- [ ] **Step 4: End-to-end manual check**

```bash
npm run dev
```

As a doctor: apply for Cuti Ganti with a start date two days out, submit, then approve it as HR. Then verify:
- **Analisa → Jenis Cuti**: an `RL` column exists with the day count, and the emergency column reads `EMG` not `EL_EMG`.
- **HR Reports → Semua Cuti** (print): a "Cuti Ganti" section appears; the emergency section reads "Cuti Kecemasan".
- **HR Reports → Baki** dropdown: options read `EMG — Cuti Kecemasan` and `PL — Cuti Paterniti (PL)`.
- **Print the leave form** for that record: the `[ X ] CUTI GANTI` box is ticked.
- **Staff dashboard → Baki Cuti Lain**: Cuti Ganti does **not** appear (no entitlement), and paternity/emergency rows read the new labels.

- [ ] **Step 5: Commit any fixes**

If steps 1–4 surfaced defects, fix them, re-run the sweep, and commit:

```bash
git add -A
git commit -m "fix(leave): address verification sweep findings

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Deployment note

This project auto-deploys to the cPanel subdomain on push to `main` via GitHub Actions. The PWA service worker caches aggressively — after deploying, a hard refresh (or waiting for the SW update) is needed before the new labels appear. A report of "labels didn't change" is far more likely to be a stale cache than a failed deploy.
