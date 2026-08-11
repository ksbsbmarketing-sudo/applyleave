# Zone- and Branch-Scoped Master Logs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An HR sees only their own zone in Master Logs (Pahang HR cannot see Terengganu and vice versa), admin and super_admin see both, and records can be narrowed to one branch via sub-tabs.

**Architecture:** A new pure module `src/masterLogScope.js` holds the filter logic, with the branch→state resolver injected so it never imports the DOM or Firebase and stays unit-testable. `src/main.js` calls it from two places that currently render raw `leaveRecords`: the Master Logs table and the HR Reports PDF export. Two tab rows sit on top — state (admin only) and branch.

**Tech Stack:** Vanilla ES modules + Vite, Firebase Firestore. Tests are `node --test` on `.mjs` files — no test framework, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-11-master-logs-state-branch-scope-design.md`

## Global Constraints

- **All user-facing copy is Malay.** Match surrounding tone.
- **The zone filter is a security boundary and runs unconditionally.** `filterByScope` must apply it before it looks at the `state` or `branch` arguments, and must never let a tab value widen what a user can see. A test pins this.
- **Never hardcode a second `ROUTES_AS_PAHANG` list.** The Utama exception lives in `window.scopeStateOfBranch` (`src/main.js:1024`) and reaches the new module only through the injected `stateOfBranch` function. That constant is already duplicated in 3 files in this repo; do not make it 4.
- **Sentinel values**, used identically in the module, the tab state and the setters: `state: 'ALL'` = the SEMUA state tab; `branch: 'ALL'` = the Semua branch tab; `branch: '__NONE__'` = the Lain-lain tab.
- **Fail closed.** A user whose scope cannot be resolved (`getUserStateScope` returns `null`) sees no records. This is an audit log; showing nothing is the safe direction.
- **No new npm dependencies.**
- **No `firestore.rules` change.** Filtering is client-side only, matching every other zone boundary in this app. Spec §Limitation explains why; do not add server-side enforcement.
- **Do not touch the Locum Records tab** (`src/main.js:7697`) or `printAllLocum` (`:1362`). They have the same class of bug and are explicitly out of scope.
- Run tests with `node --test tests/masterLogScope.test.mjs`. There is no `npm test` script; do not add one.
- **Every `src/main.js` line number in this plan refers to the file before Task 2 begins.** Later tasks shift it. Locate each edit by the quoted code, not the number.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/masterLogScope.js` | The zone/state/branch filter. Pure — no DOM, no Firebase, resolver injected. | **Create** |
| `tests/masterLogScope.test.mjs` | Pins the zone boundary and the Utama rule | **Create** |
| `src/main.js` | App shell and all rendering. ~10k lines, monolithic — the established pattern; do not restructure beyond what this touches. | Import the module; scope the Master Logs table; scope the PDF export; add two tab rows |

## Task order rationale

Tasks 2 and 3 are the two security fixes and come before the tab UI in Task 4. If work stops early, both leaks are already closed and the screen still works — it simply has no tabs yet.

---

### Task 1: The `masterLogScope` module and its tests

Pure functions only. Nothing imports the module until Task 2, so this task changes no behaviour and is safe to land alone.

**Files:**
- Create: `src/masterLogScope.js`
- Create: `tests/masterLogScope.test.mjs`

**Interfaces:**
- Consumes: nothing
- Produces, for Tasks 2–4:
  - `ALL: 'ALL'`, `NO_BRANCH: '__NONE__'` — exported sentinels
  - `visibleStates(userScope) → string[]`
  - `branchOptions(branches, { userScope, state, stateOfBranch }) → string[]`
  - `filterByScope(records, { userScope, state, branch, stateOfBranch }) → record[]`
  - where `userScope` is `'all' | 'Pahang' | 'Terengganu' | null`, `branches` is an array of `{ name, state }`, `records` is an array of objects with a `.branch` string, and `stateOfBranch` is `(branchName) => 'Pahang' | 'Terengganu' | null`

- [ ] **Step 1: Write the failing tests**

Create `tests/masterLogScope.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert';
import {
  ALL, NO_BRANCH, visibleStates, branchOptions, filterByScope,
} from '../src/masterLogScope.js';

// Mirrors the real branch collection closely enough to be meaningful. Utama's
// `state` is Terengganu but it routes through Balok HQ, so the resolver below
// reports it as Pahang — exactly like window.scopeStateOfBranch in main.js.
const BRANCHES = [
  { name: 'Klinik Syed Badaruddin Balok (HQ)', state: 'Pahang' },
  { name: 'Klinik Syed Badaruddin Beserah',    state: 'Pahang' },
  { name: 'Klinik Syed Badaruddin Utama',      state: 'Terengganu' },
  { name: 'Klinik Syed Badaruddin Kerteh',     state: 'Terengganu' },
  { name: 'Klinik Rakyat dan X-Ray Dungun',    state: 'Terengganu' },
];

const ROUTES_AS_PAHANG = ['Klinik Syed Badaruddin Utama'];
const stateOfBranch = (name) => {
  if (ROUTES_AS_PAHANG.includes(name)) return 'Pahang';
  const b = BRANCHES.find(x => x.name === name);
  return b ? b.state : null;
};

const RECORDS = [
  { id: 1, branch: 'Klinik Syed Badaruddin Balok (HQ)' },
  { id: 2, branch: 'Klinik Syed Badaruddin Beserah' },
  { id: 3, branch: 'Klinik Syed Badaruddin Utama' },
  { id: 4, branch: 'Klinik Syed Badaruddin Kerteh' },
  { id: 5, branch: 'Klinik Rakyat dan X-Ray Dungun' },
  { id: 6, branch: 'Klinik Yang Sudah Ditutup' },   // stranded: not in BRANCHES
];

const ids = (recs) => recs.map(r => r.id).sort((a, b) => a - b);
const run = (opts) => filterByScope(RECORDS, { stateOfBranch, ...opts });

// ── The zone boundary ─────────────────────────────────────────────────
test('Utama belongs to the Pahang zone, not Terengganu', () => {
  // The decision this whole feature turns on: the split follows who MANAGES
  // a branch, not where the building is.
  assert.deepStrictEqual(ids(run({ userScope: 'Pahang' })), [1, 2, 3]);
});

test('a Pahang HR never receives a Terengganu record', () => {
  const got = run({ userScope: 'Pahang' });
  assert.ok(got.every(r => ![4, 5].includes(r.id)), 'Kerteh/Dungun leaked to Pahang');
});

test('a Terengganu HR never receives a Pahang record, and never sees Utama', () => {
  assert.deepStrictEqual(ids(run({ userScope: 'Terengganu' })), [4, 5]);
});

test('the zone filter does not trust the state tab — the tab cannot widen scope', () => {
  // A Pahang HR asking for Terengganu gets nothing, NOT Terengganu's records.
  assert.deepStrictEqual(run({ userScope: 'Pahang', state: 'Terengganu' }), []);
  assert.deepStrictEqual(run({ userScope: 'Terengganu', state: 'Pahang' }), []);
});

test('the zone filter does not trust the branch tab either', () => {
  assert.deepStrictEqual(
    run({ userScope: 'Pahang', branch: 'Klinik Syed Badaruddin Kerteh' }), []);
});

test('admin sees both zones', () => {
  assert.deepStrictEqual(ids(run({ userScope: 'all' })), [1, 2, 3, 4, 5, 6]);
});

test('an unresolvable scope sees nothing — fail closed', () => {
  assert.deepStrictEqual(run({ userScope: null }), []);
  assert.deepStrictEqual(run({ userScope: undefined }), []);
});

// ── Tab narrowing, on top of the zone ─────────────────────────────────
test('the state tab narrows an admin to one zone', () => {
  assert.deepStrictEqual(ids(run({ userScope: 'all', state: 'Pahang' })), [1, 2, 3]);
  assert.deepStrictEqual(ids(run({ userScope: 'all', state: 'Terengganu' })), [4, 5]);
});

test('the branch tab narrows to one branch', () => {
  assert.deepStrictEqual(
    ids(run({ userScope: 'all', state: 'Pahang', branch: 'Klinik Syed Badaruddin Beserah' })),
    [2]);
});

test('omitted state and branch default to ALL', () => {
  assert.deepStrictEqual(
    ids(run({ userScope: 'Terengganu' })),
    ids(run({ userScope: 'Terengganu', state: ALL, branch: ALL })));
});

// ── Stranded records ──────────────────────────────────────────────────
test('a stranded record is hidden from both HRs', () => {
  assert.ok(!ids(run({ userScope: 'Pahang' })).includes(6));
  assert.ok(!ids(run({ userScope: 'Terengganu' })).includes(6));
});

test('a stranded record reaches admin via SEMUA and via the Lain-lain tab', () => {
  assert.ok(ids(run({ userScope: 'all', state: ALL, branch: ALL })).includes(6));
  assert.deepStrictEqual(ids(run({ userScope: 'all', state: ALL, branch: NO_BRANCH })), [6]);
});

test('a stranded record does not appear under a named state — it has no state', () => {
  assert.ok(!ids(run({ userScope: 'all', state: 'Pahang' })).includes(6));
  assert.ok(!ids(run({ userScope: 'all', state: 'Terengganu' })).includes(6));
});

test('the Lain-lain tab shows ONLY stranded records, never real ones', () => {
  const got = run({ userScope: 'all', state: ALL, branch: NO_BRANCH });
  assert.ok(got.every(r => r.id === 6));
});

// ── visibleStates ─────────────────────────────────────────────────────
test('visibleStates: admin gets both, an HR gets only their own, null gets none', () => {
  assert.deepStrictEqual(visibleStates('all'), ['Pahang', 'Terengganu']);
  assert.deepStrictEqual(visibleStates('Pahang'), ['Pahang']);
  assert.deepStrictEqual(visibleStates('Terengganu'), ['Terengganu']);
  assert.deepStrictEqual(visibleStates(null), []);
});

test('visibleStates never returns the ALL sentinel — the caller renders that tab', () => {
  assert.ok(!visibleStates('all').includes(ALL));
});

// ── branchOptions ─────────────────────────────────────────────────────
test('branchOptions returns only in-zone branches', () => {
  assert.deepStrictEqual(
    branchOptions(BRANCHES, { userScope: 'Terengganu', state: ALL, stateOfBranch }),
    ['Klinik Syed Badaruddin Kerteh', 'Klinik Rakyat dan X-Ray Dungun']);
});

test('branchOptions puts Utama in the Pahang list', () => {
  const got = branchOptions(BRANCHES, { userScope: 'Pahang', state: ALL, stateOfBranch });
  assert.ok(got.includes('Klinik Syed Badaruddin Utama'));
});

test('branchOptions narrows to the selected state for an admin', () => {
  assert.deepStrictEqual(
    branchOptions(BRANCHES, { userScope: 'all', state: 'Terengganu', stateOfBranch }),
    ['Klinik Syed Badaruddin Kerteh', 'Klinik Rakyat dan X-Ray Dungun']);
});

test('branchOptions survives an empty or missing branch list — first paint', () => {
  // Firestore has not delivered `branches` yet. Must not throw.
  assert.deepStrictEqual(branchOptions([], { userScope: 'all', state: ALL, stateOfBranch }), []);
  assert.deepStrictEqual(branchOptions(undefined, { userScope: 'all', state: ALL, stateOfBranch }), []);
});

test('branchOptions returns nothing for an unresolvable scope', () => {
  assert.deepStrictEqual(branchOptions(BRANCHES, { userScope: null, state: ALL, stateOfBranch }), []);
});

// ── Robustness ────────────────────────────────────────────────────────
test('a missing record list does not throw', () => {
  assert.deepStrictEqual(filterByScope(undefined, { userScope: 'all', stateOfBranch }), []);
});

test('a record with no branch field is treated as stranded, not as a crash', () => {
  const odd = [{ id: 9 }, { id: 10, branch: '' }];
  assert.deepStrictEqual(filterByScope(odd, { userScope: 'Pahang', stateOfBranch }), []);
  assert.strictEqual(filterByScope(odd, { userScope: 'all', stateOfBranch }).length, 2);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/masterLogScope.test.mjs`
Expected: FAIL — `Cannot find module` / `does not provide an export named 'ALL'`

- [ ] **Step 3: Write the implementation**

Create `src/masterLogScope.js`:

```js
// Skop Master Logs — negeri (zon) & cawangan.
//
// ZON IALAH SEMPADAN KESELAMATAN: HR Pahang tidak boleh nampak rekod
// Terengganu, dan sebaliknya. Tab negeri/cawangan hanyalah NAVIGASI di atas
// zon itu — `filterByScope` sengaja TIDAK mempercayai nilai tab, supaya nilai
// tab yang salah (atau diubah) tidak boleh meluaskan apa yang seseorang nampak.
//
// Tiada import DOM/Firebase di sini — itulah yang menjadikannya boleh diuji
// unit. Peleraian cawangan → negeri disuntik sebagai `stateOfBranch` kerana ia
// bergantung pada koleksi `branches` yang hidup dalam main.js, DAN kerana ia
// membawa pengecualian Utama (ROUTES_AS_PAHANG). Jangan salin senarai itu
// ke sini — ia sudah wujud dalam 3 fail.

export const ALL = 'ALL';
export const NO_BRANCH = '__NONE__';

// Negeri yang pengguna ini dibenarkan lihat. Sentinel ALL tiada di sini —
// tab SEMUA dilukis oleh pemanggil, dan hanya untuk skop 'all'.
export function visibleStates(userScope) {
  if (!userScope) return [];
  if (userScope === 'all') return ['Pahang', 'Terengganu'];
  return [userScope];
}

// Nama cawangan untuk baris tab cawangan, dalam zon pengguna dan (jika tab
// negeri dipilih) dalam negeri itu sahaja.
export function branchOptions(branches, { userScope, state = ALL, stateOfBranch }) {
  if (!userScope) return [];
  const allowed = visibleStates(userScope);
  return (branches || [])
    .filter(b => {
      const s = stateOfBranch(b.name);
      if (!s || !allowed.includes(s)) return false;
      if (state !== ALL && s !== state) return false;
      return true;
    })
    .map(b => b.name);
}

export function filterByScope(records, { userScope, state = ALL, branch = ALL, stateOfBranch }) {
  if (!userScope) return [];                       // gagal-tertutup
  const allowed = visibleStates(userScope);
  return (records || []).filter(r => {
    const s = stateOfBranch(r.branch);

    // Rekod tersadai — cawangan tiada dalam koleksi (ditukar nama/dipadam).
    // Hanya admin nampak, hanya pada tab negeri SEMUA, melalui tab cawangan
    // Semua atau Lain-lain. Ia tiada negeri, jadi ia bukan milik mana-mana
    // tab negeri bernama.
    if (!s) {
      if (userScope !== 'all') return false;
      if (state !== ALL) return false;
      return branch === ALL || branch === NO_BRANCH;
    }

    if (!allowed.includes(s)) return false;        // ← SEMPADAN ZON
    if (state !== ALL && s !== state) return false;
    if (branch === NO_BRANCH) return false;        // rekod ini ada cawangan
    if (branch !== ALL && r.branch !== branch) return false;
    return true;
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/masterLogScope.test.mjs`
Expected: PASS, 23 tests, 0 fail

- [ ] **Step 5: Commit**

```bash
git add src/masterLogScope.js tests/masterLogScope.test.mjs
git commit -m "feat(logs): add masterLogScope — zone/state/branch filter for Master Logs

The zone filter is the security boundary and runs before the tab arguments
are looked at, so a tab value can never widen what a user sees. Utama
reaches the Pahang zone through the injected resolver rather than a fourth
copy of ROUTES_AS_PAHANG. Nothing imports this yet.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Scope the Master Logs table

The security fix. After this task a Terengganu HR stops seeing Pahang records. No tabs yet — the screen otherwise looks exactly as it does today.

**Files:**
- Modify: `src/main.js:7` (import), `src/main.js:7574` (open the Master Logs block), `src/main.js:7602` (the table body)

**Interfaces:**
- Consumes: `filterByScope` from Task 1; `window.getUserStateScope(user)` and `window.scopeStateOfBranch(name)`, both already in `src/main.js`

- [ ] **Step 1: Add the import**

`src/main.js:7` currently reads:

```js
import { LEAVE_CATEGORIES, LEAVE_TYPE_NAMES, leaveTypeName, leaveTypeShort, proofRequirement, hexToRgbTriple, PROOF_REQUIRED_TYPES } from './leaveTypes.js';
```

Add a second import statement immediately below it:

```js
import { ALL as SCOPE_ALL, NO_BRANCH, visibleStates, branchOptions, filterByScope } from './masterLogScope.js';
```

`SCOPE_ALL`, `NO_BRANCH`, `visibleStates` and `branchOptions` are unused until Task 4. Import them now so the import line is touched once.

- [ ] **Step 2: Convert the Master Logs block to an IIFE so it can compute before rendering**

`src/main.js:7574` currently opens the block as:

```js
        ${managementTab === 'master_audit' ? `
```

Change it to the IIFE form already used by the `locum_records` block at `src/main.js:7697` and the `hr_reports` block at `:7944`:

```js
        ${managementTab === 'master_audit' ? (() => {
          const _mlScope = window.getUserStateScope(user);
          const _mlRecords = filterByScope(leaveRecords, {
            userScope: _mlScope,
            stateOfBranch: window.scopeStateOfBranch,
          });
          return `
```

Then find the end of that block — the closing `` ` : ''}`` that terminates the `master_audit` conditional (it sits just before the `${managementTab === 'locum_records'` block) — and change it to:

```js
        `; })() : ''}
```

Be careful: this block contains several nested template literals. Verify with `npm run build` before committing.

- [ ] **Step 3: Map the filtered records**

`src/main.js:7602` currently reads:

```js
                          ${leaveRecords.map((r, index) => `
```

Change to:

```js
                          ${_mlRecords.map((r, index) => `
```

- [ ] **Step 4: Verify**

Run: `npm run build`
Expected: succeeds. This is the only automated check for `main.js`; it catches the template-literal breakage that is the realistic failure mode here.

Run: `grep -n "leaveRecords.map((r, index)" src/main.js`
Expected: no output — the raw map is gone.

- [ ] **Step 5: Commit**

```bash
git add src/main.js
git commit -m "fix(logs): scope the Master Logs table to the viewer's zone

Master Logs rendered the raw leave collection, so each HR saw the other's
zone -- the one screen that never called the scoping helpers every other
screen uses. Admin and super_admin still see everything.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Scope the HR Reports PDF export

The second leak. Without this, an HR blocked from seeing the other zone in the table can still download a PDF of it from the HR Reports tab.

**Files:**
- Modify: `src/main.js:3387-3408` (`window.generateLeaveReport`)

**Interfaces:**
- Consumes: `filterByScope` (imported in Task 2)

- [ ] **Step 1: Compute the scoped list at the top of the function**

`src/main.js:3387` currently reads:

```js
window.generateLeaveReport = function() {
   let printHTML = `
```

Change to:

```js
window.generateLeaveReport = function() {
   // Butang ini berlabel "Semua Rekod" — maksudnya semua rekod DALAM ZON
   // pengguna, bukan semua rekod dalam sistem. Tanpa tapisan ini HR boleh
   // muat turun PDF zon yang seorang lagi HR uruskan.
   const _rptRecords = filterByScope(leaveRecords, {
     userScope: window.getUserStateScope(user),
     stateOfBranch: window.scopeStateOfBranch,
   });
   let printHTML = `
```

The state and branch tabs are deliberately NOT passed: the button means everything-in-your-zone, not everything-in-the-tab-you-happen-to-be-looking-at.

- [ ] **Step 2: Map the scoped list**

`src/main.js:3408` currently reads:

```js
              ${leaveRecords.map(r => `
```

Change to:

```js
              ${_rptRecords.map(r => `
```

- [ ] **Step 3: Verify**

Run: `npm run build`
Expected: succeeds.

Run: `grep -n "leaveRecords.map(r => " src/main.js`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/main.js
git commit -m "fix(reports): scope the 'PDF - Semua Rekod' export to the viewer's zone

Closing Master Logs alone left the same data reachable one tab over as a
downloadable PDF. "Semua Rekod" now means everything in your zone.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: State and branch tab rows

The navigation. Both leaks are already closed by this point; this task adds the ability to narrow down.

**Files:**
- Modify: `src/main.js:482` (tab state), `src/main.js:1593` (setters), the Master Logs IIFE from Task 2

**Interfaces:**
- Consumes: `SCOPE_ALL`, `NO_BRANCH`, `visibleStates`, `branchOptions`, `filterByScope` (all imported in Task 2); `_mlScope` (declared in the Task 2 IIFE)

- [ ] **Step 1: Add the tab state**

`src/main.js:482` currently reads:

```js
let hrReportTab = 'all'; // 'all' | 'approved' | 'balance' | 'jenis'
```

Add immediately below:

```js
let masterLogState = 'ALL';   // 'ALL' | 'Pahang' | 'Terengganu'
let masterLogBranch = 'ALL';  // 'ALL' | '__NONE__' | nama cawangan
```

- [ ] **Step 2: Add the setters**

`src/main.js:1589-1593` currently reads:

```js
window.setManageTab = function(tab) {
  managementTab = tab;
  managementGroup = _tabToGroup[tab] || managementGroup;
  render();
};
```

Add immediately below:

```js
window.setMasterLogState = function(s) {
  masterLogState = s;
  // Tukar negeri mesti reset cawangan: kombinasi Pahang + Kerteh menghasilkan
  // jadual kosong yang nampak macam pepijat, bukan macam kombinasi mustahil.
  masterLogBranch = 'ALL';
  render();
};

window.setMasterLogBranch = function(b) {
  masterLogBranch = b;
  render();
};
```

- [ ] **Step 3: Extend the IIFE header with the tab values and counts**

In the Master Logs IIFE from Task 2, replace the whole header block:

```js
        ${managementTab === 'master_audit' ? (() => {
          const _mlScope = window.getUserStateScope(user);
          const _mlRecords = filterByScope(leaveRecords, {
            userScope: _mlScope,
            stateOfBranch: window.scopeStateOfBranch,
          });
          return `
```

with:

```js
        ${managementTab === 'master_audit' ? (() => {
          const _mlScope = window.getUserStateScope(user);
          const _mlRecords = filterByScope(leaveRecords, {
            userScope: _mlScope,
            state: masterLogState,
            branch: masterLogBranch,
            stateOfBranch: window.scopeStateOfBranch,
          });
          const _mlStates = visibleStates(_mlScope);
          const _mlBranchList = branchOptions(branches, {
            userScope: _mlScope,
            state: masterLogState,
            stateOfBranch: window.scopeStateOfBranch,
          });
          // Kiraan per-tab. Sengaja abaikan tab cawangan semasa supaya nombor
          // pada setiap tab kekal sama tak kira tab mana yang sedang dibuka.
          const _mlCount = (branch) => filterByScope(leaveRecords, {
            userScope: _mlScope,
            state: masterLogState,
            branch,
            stateOfBranch: window.scopeStateOfBranch,
          }).length;
          const _mlOrphans = (_mlScope === 'all' && masterLogState === SCOPE_ALL)
            ? _mlCount(NO_BRANCH) : 0;
          // Nama cawangan masuk ke dalam atribut onclick. encodeURIComponent
          // tidak melepaskan petik tunggal, jadi ia dikendalikan sendiri.
          const _mlArg = (v) => encodeURIComponent(v).replace(/'/g, '%27');
          return `
```

- [ ] **Step 4: Add the two tab rows**

In the Master Logs markup, immediately after the header `</div>` that closes the block containing `<h2 ...>Master Logs</h2>` and the Reset System Cache button (`src/main.js:7586` before Task 2's edit), and before `<section class="glass-card fade-in" ...>`, insert:

```html
          ${_mlScope === 'all' ? `
          <div style="display:flex;gap:0.5rem;margin-bottom:0.75rem;overflow-x:auto;padding-bottom:0.25rem;">
            <button class="neu-tab ${masterLogState === SCOPE_ALL ? 'active' : ''}" onclick="window.setMasterLogState('ALL')" style="border-radius:8px;white-space:nowrap;">SEMUA</button>
            ${_mlStates.map(s => `<button class="neu-tab ${masterLogState === s ? 'active' : ''}" onclick="window.setMasterLogState('${s}')" style="border-radius:8px;white-space:nowrap;">${s.toUpperCase()}</button>`).join('')}
          </div>
          ` : `
          <div style="display:flex;align-items:center;gap:0.4rem;background:rgba(56,189,248,0.1);border:1px solid rgba(56,189,248,0.35);border-radius:20px;padding:0.25rem 0.75rem;margin-bottom:0.75rem;width:fit-content;">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#0284c7" stroke-width="2.5"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
            <span style="font-size:0.68rem;font-weight:800;color:#0284c7;letter-spacing:0.3px;">Skop: ${_mlScope}</span>
          </div>
          `}

          <div style="display:flex;gap:0.5rem;margin-bottom:1.25rem;overflow-x:auto;padding-bottom:0.25rem;">
            <button class="neu-tab ${masterLogBranch === SCOPE_ALL ? 'active' : ''}" onclick="window.setMasterLogBranch('ALL')" style="border-radius:8px;white-space:nowrap;">Semua (${_mlCount(SCOPE_ALL)})</button>
            ${_mlBranchList.map(b => `<button class="neu-tab ${masterLogBranch === b ? 'active' : ''}" onclick="window.setMasterLogBranch(decodeURIComponent('${_mlArg(b)}'))" style="border-radius:8px;white-space:nowrap;">${b} (${_mlCount(b)})</button>`).join('')}
            ${_mlOrphans > 0 ? `<button class="neu-tab ${masterLogBranch === NO_BRANCH ? 'active' : ''}" onclick="window.setMasterLogBranch('__NONE__')" style="border-radius:8px;white-space:nowrap;color:#f59e0b;" title="Rekod dengan cawangan yang tiada dalam senarai cawangan — perlu dibetulkan">Lain-lain (${_mlOrphans})</button>` : ''}
          </div>
```

The HR chip reuses the styling of the "Skop:" chip at `src/main.js:7975-7977`. Both rows use `overflow-x:auto` because 10 Pahang branch tabs will not fit a phone.

- [ ] **Step 5: Add an empty state**

A branch tab with zero records currently renders an empty `<tbody>` with no explanation. Immediately after the closing `</table>` inside the `<section>`, add:

```html
                  ${_mlRecords.length === 0 ? `<div style="padding:2.5rem 1rem;text-align:center;font-size:0.8rem;color:var(--text-muted);">Tiada rekod untuk pilihan ini.</div>` : ''}
```

- [ ] **Step 6: Verify**

Run: `npm run build`
Expected: succeeds.

Run: `node --test tests/masterLogScope.test.mjs`
Expected: PASS, 23 tests.

- [ ] **Step 7: Commit**

```bash
git add src/main.js
git commit -m "feat(logs): add state and branch sub-tabs to Master Logs

Admin and super_admin get SEMUA/PAHANG/TERENGGANU; an HR gets a read-only
'Skop:' chip instead, because a one-option tab row is noise and a tab that
returns nothing reads as broken. Branch tabs carry record counts, and a
Lain-lain tab surfaces stranded records to admin only when any exist.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Post-deploy verification

**Hard-refresh first** — a stale service worker has masked deploys on this project before.

1. **Zahirah (Terengganu HR)** → Master Logs shows only Kerteh / Paka / Dungun records, a "Skop: Terengganu" chip, no state tab row, 3 branch tabs.
2. **Norhazlinah (Pahang HR)** → 10 branch tabs including Utama; no Terengganu record anywhere.
3. **super_admin** → state row present; SEMUA shows everything; switching to Terengganu resets the branch tab to Semua and shows 3 branches.
4. **HR Reports → "PDF — Semua Rekod" as Zahirah** contains no Pahang record.
5. Branch tab counts match the row counts in the table.
6. Pick a branch with no records → "Tiada rekod untuk pilihan ini." rather than a blank panel.
