# Approved Duplicate Leave — Block and Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop any new approved duplicate leave from being created, and make the approved duplicates already in Firestore visible to HR in Master Logs.

**Architecture:** Two new pure functions in the existing `src/leaveOverlap.js` — `findApprovedOverlaps` for the block, `findOverlapGroups` for the display. Two integration points in `src/main.js`: a guard at the very top of `window.finalizeLeave`, and a row marker plus filter button in the Master Logs table.

**Tech Stack:** Vanilla ES modules, Vite 8, Firebase Web SDK v12 (Firestore), `node:test`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-13-approved-duplicate-leave-design.md`
**Parent feature:** `docs/superpowers/plans/2026-08-13-leave-overlap-prevention.md` — already implemented on this branch. Do not modify what it built.

## Global Constraints

- **Deny-list, never allow-list.** `NON_BLOCKING_STATUSES = ['REJECTED', 'CANCELLED']` in `src/leaveOverlap.js`. Every other status is "live". Never rewrite it as a list of blocking statuses.
- **`src/leaveOverlap.js` is a pure module — no imports at all.** Both new functions go in it and must keep it that way.
- **Dates are `'YYYY-MM-DD'` strings.** Compare them as strings. **No `new Date(...)` anywhere in this feature.**
- **Only `APPROVED` blocks an approval.** Two competing *pending* applications must not block each other — HR approves the right one and rejects the other.
- **Hard block, no override for any role**, HR and super_admin included.
- **Never add a Firestore query or read.** `leaveRecords` is already in memory via an existing `onSnapshot`. The project is on the Firebase Spark plan and has exhausted its daily quota before.
- **Zone scoping must be respected.** Master Logs overlap counts and rows come from `_mlRecords` (already scoped), never from raw `leaveRecords`. A Pahang HR must never see a Terengganu count.
- **No `firestore.rules` change.** Rules cannot run queries.
- **No cleanup migration.** Nothing deletes or merges records automatically.
- **UI copy is Bahasa Malaysia.** Comments in both files are Malay.
- **Test command:** `node --test tests/<file>.test.mjs`. There is no `npm test` script — do not add one.
- **Build check:** `npm run build` must succeed after every task touching `src/main.js`.
- **Line numbers drift.** Every `src/main.js` line number below is measured against `HEAD` before Task 1. Task 2 inserts ~18 lines above Task 3's anchors. **Locate every insertion point by its verbatim code anchor; treat the line number as a hint.**

## File Structure

| File | Responsibility |
|---|---|
| `src/leaveOverlap.js` *(modify)* | Gains `findApprovedOverlaps` and `findOverlapGroups`. Stays pure. Currently 69 lines, 6 exports. |
| `tests/leaveOverlap.test.mjs` *(modify)* | Gains 13 tests for the two new functions. Currently 32 tests. |
| `src/main.js` *(modify)* | Approval guard at `~2479`; Master Logs state var at `~491`, toggle at `~1615`, overlap map at `~7710`, filter button at `~7789`, row marker at `~7806-7815`, empty message at `~7847`. |

---

### Task 1: The two matcher functions

**Files:**
- Modify: `src/leaveOverlap.js`
- Test: `tests/leaveOverlap.test.mjs`

**Interfaces:**
- Consumes: the module's existing internals — `norm()` (module-private), `isBlockingStatus`, `datesOverlap`, `findOverlappingLeaves`.
- Produces — exact signatures Tasks 2 and 3 rely on:
  - `findApprovedOverlaps(records: object[], ic: string, startDate: string, endDate: string, opts?: { excludeId?: string|number }): object[]`
  - `findOverlapGroups(records: object[]): Map<any, object[]>` — keys are raw `record.id` values (numbers in this codebase); values are the other records that record overlaps.

- [ ] **Step 1: Write the failing tests**

Add to `tests/leaveOverlap.test.mjs`. First extend the import at the top of the file — it currently reads:

```js
import {
  NON_BLOCKING_STATUSES, isBlockingStatus, datesOverlap,
  findOverlappingLeaves, overlapsOtherLeaves, describeOverlaps,
} from '../src/leaveOverlap.js';
```

Replace with:

```js
import {
  NON_BLOCKING_STATUSES, isBlockingStatus, datesOverlap,
  findOverlappingLeaves, overlapsOtherLeaves, describeOverlaps,
  findApprovedOverlaps, findOverlapGroups,
} from '../src/leaveOverlap.js';
```

Then append these tests at the end of the file. The existing `REC()` factory and `ids()` helper are already defined at the top of the file and are reused here.

```js
// ── findApprovedOverlaps ──────────────────────────────────────────────
// Same default query as `find`, but through the approved-only matcher.
const findAppr = (records, over = {}) => {
  const q = { ic: '900101015555', startDate: '2026-08-05', endDate: '2026-08-07', ...over };
  return findApprovedOverlaps(records, q.ic, q.startDate, q.endDate, q.opts);
};

test('findApprovedOverlaps returns an overlapping approved record', () => {
  assert.deepStrictEqual(ids(findAppr([REC({ id: 7, status: 'APPROVED' })])), [7]);
});

test('findApprovedOverlaps ignores overlapping records not yet fully approved', () => {
  // Two competing PENDING applications must not block each other — HR
  // approves the right one and rejects the other.
  const records = [
    REC({ id: 1, status: 'PENDING' }),
    REC({ id: 2, status: 'TL APPROVED' }),
    REC({ id: 3, status: 'HOD APPROVED' }),
    REC({ id: 4, status: 'HOD RECOMMENDED' }),
  ];
  assert.deepStrictEqual(findAppr(records), []);
});

test('findApprovedOverlaps ignores rejected and cancelled records', () => {
  const records = [REC({ id: 1, status: 'REJECTED' }), REC({ id: 2, status: 'CANCELLED' })];
  assert.deepStrictEqual(findAppr(records), []);
});

test('findApprovedOverlaps returns [] for a NON-overlapping approved record', () => {
  // Mutation-killer: an implementation that ignored dates would pass the
  // rest of this section. Default query is 08-05..08-07; this is adjacent.
  const rec = REC({ id: 7, status: 'APPROVED', startDate: '2026-08-08', endDate: '2026-08-10' });
  assert.deepStrictEqual(findAppr([rec]), []);
});

test('findApprovedOverlaps honours excludeId', () => {
  assert.deepStrictEqual(findAppr([REC({ id: 7, status: 'APPROVED' })], { opts: { excludeId: 7 } }), []);
});

test('findApprovedOverlaps tolerates lowercase and padded status', () => {
  assert.deepStrictEqual(ids(findAppr([REC({ id: 7, status: ' approved ' })])), [7]);
});

test('findApprovedOverlaps never matches another staff member', () => {
  assert.deepStrictEqual(findAppr([REC({ id: 7, status: 'APPROVED', ic: '880202025555' })]), []);
});

// ── findOverlapGroups ─────────────────────────────────────────────────
test('findOverlapGroups maps both members of a pair to each other', () => {
  const a = REC({ id: 1 }), b = REC({ id: 2 });
  const m = findOverlapGroups([a, b]);
  assert.strictEqual(m.size, 2);
  assert.deepStrictEqual(ids(m.get(1)), [2]);
  assert.deepStrictEqual(ids(m.get(2)), [1]);
});

test('findOverlapGroups returns an empty Map when nothing overlaps', () => {
  const m = findOverlapGroups([REC({ id: 1 }), REC({ id: 2, startDate: '2026-09-01', endDate: '2026-09-02' })]);
  assert.strictEqual(m.size, 0);
});

test('findOverlapGroups does NOT group adjacent-but-separate ranges', () => {
  // The boundary that decides whether legitimate back-to-back leave gets
  // wrongly flagged for every staff member in Master Logs.
  const m = findOverlapGroups([REC({ id: 1 }), REC({ id: 2, startDate: '2026-08-08', endDate: '2026-08-10' })]);
  assert.strictEqual(m.size, 0);
});

test('findOverlapGroups never groups records belonging to different staff', () => {
  const m = findOverlapGroups([REC({ id: 1 }), REC({ id: 2, ic: '880202025555' })]);
  assert.strictEqual(m.size, 0);
});

test('findOverlapGroups excludes rejected and cancelled records', () => {
  const m = findOverlapGroups([
    REC({ id: 1 }), REC({ id: 2, status: 'CANCELLED' }), REC({ id: 3, status: 'REJECTED' }),
  ]);
  assert.strictEqual(m.size, 0);
});

test('findOverlapGroups skips records missing dates', () => {
  const m = findOverlapGroups([REC({ id: 1 }), REC({ id: 2, endDate: '' })]);
  assert.strictEqual(m.size, 0);
});

test('findOverlapGroups links all three of a mutually overlapping trio', () => {
  const m = findOverlapGroups([REC({ id: 1 }), REC({ id: 2 }), REC({ id: 3 })]);
  assert.deepStrictEqual(ids(m.get(1)), [2, 3]);
  assert.deepStrictEqual(ids(m.get(2)), [1, 3]);
  assert.deepStrictEqual(ids(m.get(3)), [1, 2]);
});

test('findOverlapGroups survives a missing list and null entries', () => {
  assert.strictEqual(findOverlapGroups(undefined).size, 0);
  assert.strictEqual(findOverlapGroups([null, REC({ id: 1 })]).size, 0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
node --test tests/leaveOverlap.test.mjs
```

Expected: FAIL — `findApprovedOverlaps is not a function` / `findOverlapGroups is not a function` (or a SyntaxError about the missing export, depending on Node version). Either is the expected RED.

- [ ] **Step 3: Write the implementation**

Append both functions to the **end** of `src/leaveOverlap.js`, after `describeOverlaps`. Do not modify any existing function.

```js
// Rekod yang SUDAH DILULUSKAN dan bertindih. Sekatan kelulusan guna ini —
// hanya APPROVED yang menghalang, bukan sekadar rekod hidup: dua permohonan
// yang sama-sama MENUNGGU tidak menghalang satu sama lain, kerana HR yang
// memilih mana satu untuk diluluskan dan mana satu untuk ditolak.
export function findApprovedOverlaps(records, ic, startDate, endDate, opts = {}) {
  return findOverlappingLeaves(records, ic, startDate, endDate, opts)
    .filter(r => norm(r.status).toUpperCase() === 'APPROVED');
}

// Semua pertindihan dalam satu koleksi, dikumpulkan sekali gus.
// Map: id rekod → senarai rekod LAIN yang bertindih dengannya.
//
// Wujud untuk PRESTASI, bukan kemudahan. Memanggil overlapsOtherLeaves bagi
// setiap baris Master Logs mengimbas seluruh koleksi bagi SETIAP baris —
// O(n²) pada SETIAP render, dan render() berjalan pada setiap snapshot
// Firestore. Di sini rekod dikumpul ikut `ic` dalam satu laluan, kemudian
// dibandingkan berpasangan dalam setiap staff sahaja (seorang staff ada
// sedikit rekod), jadi kosnya hampir lelurus. Ini pengajaran yang sama yang
// sudah dicatat pada kaunter tab Master Logs dalam main.js.
export function findOverlapGroups(records) {
  // Laluan 1: kumpul rekod hidup yang bertarikh sah, ikut ic.
  const byIc = new Map();
  for (const r of records || []) {
    if (!r) continue;
    const ic = norm(r.ic);
    if (!ic) continue;
    if (!isBlockingStatus(r.status)) continue;
    // Rekod tanpa tarikh dilangkau, sama seperti findOverlappingLeaves —
    // rekod lama yang rosak tidak boleh menandakan orang secara palsu.
    if (!norm(r.startDate) || !norm(r.endDate)) continue;
    if (!byIc.has(ic)) byIc.set(ic, []);
    byIc.get(ic).push(r);
  }

  // Laluan 2: berpasangan dalam setiap staff sahaja.
  const out = new Map();
  for (const list of byIc.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (!datesOverlap(norm(a.startDate), norm(a.endDate),
                          norm(b.startDate), norm(b.endDate))) continue;
        if (!out.has(a.id)) out.set(a.id, []);
        if (!out.has(b.id)) out.set(b.id, []);
        out.get(a.id).push(b);
        out.get(b.id).push(a);
      }
    }
  }
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
node --test tests/leaveOverlap.test.mjs
```

Expected: PASS, `tests 45`, `fail 0` (32 existing + 13 new).

- [ ] **Step 5: Prove the new tests actually bite**

A test that passes under a broken implementation is worthless. Verify both new functions with a mutation, exactly as the parent feature's fix wave did:

1. In `src/leaveOverlap.js`, temporarily change `findApprovedOverlaps`' filter to `.filter(() => true)`. Run `node --test tests/leaveOverlap.test.mjs` — the "not yet fully approved", "rejected and cancelled" and "tolerates lowercase" tests must fail. Revert.
2. Temporarily change `findOverlapGroups`' `datesOverlap(...)` guard to `if (false) continue;`. Run again — "returns an empty Map", "does NOT group adjacent-but-separate ranges" and "skips records missing dates" must fail. Revert.
3. Confirm `git diff -- src/leaveOverlap.js` shows only your two added functions before committing.

If a mutation leaves the suite green, the tests do not close the hole — fix them before continuing.

- [ ] **Step 6: Run the full pure-module suite**

```bash
node --test tests/leaveOverlap.test.mjs tests/leaveDays.test.mjs tests/leaveBalance.test.mjs tests/leaveTypes.test.mjs tests/masterLogScope.test.mjs tests/nameFormat.test.mjs tests/phoneFormat.test.mjs tests/formulaBTypes.test.mjs tests/loginBranches.test.mjs
```

Expected: `tests 179`, `fail 0` (166 before, plus 13).

- [ ] **Step 7: Commit**

```bash
git add src/leaveOverlap.js tests/leaveOverlap.test.mjs
git commit -m "feat(leave): add approved-overlap and grouped-overlap matchers

findApprovedOverlaps backs the approval block: only APPROVED records
stop an approval, so two competing pending applications do not block
each other.

findOverlapGroups backs the Master Logs marker. Per-row scanning would
be O(n^2) over the whole collection on every render, and render() fires
on every Firestore snapshot; this groups by ic in one pass and compares
pairwise only within a staff member's own records.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Block approval of a record overlapping approved leave

**Files:**
- Modify: `src/main.js` — the `leaveOverlap` import (~line 10), and `window.finalizeLeave` (~line 2479)

**Interfaces:**
- Consumes: `findApprovedOverlaps` from Task 1; `describeOverlaps` (already imported by the parent feature).
- Produces: nothing for later tasks.

**Why the guard goes at the very top:** `window.finalizeLeave` (`src/main.js:2470`) is the single entry point for every approval transition — TL support, HOD support, and HR's final approval. The stage branches **send WhatsApp before the database write**: `src/main.js:2503` (to Supervisors), `:2512` and `:2598` (to the applicant), all before `updateDoc` at `:2617`. A guard placed after `newStatus` is computed would block the write *after* the applicant had already been told on WhatsApp that their leave was approved.

So the guard runs before any branch, which means `newStatus` does not exist yet and the block covers **all stages**. That is intended, not a compromise: supporting a record that overlaps already-approved leave is the same error caught earlier. A TL or HOD who hits the block cannot resolve it themselves — only HR can cancel the conflicting record — and the alert says so.

- [ ] **Step 1: Extend the import**

`src/main.js` line 10 currently reads:

```js
import { findOverlappingLeaves, overlapsOtherLeaves, describeOverlaps } from './leaveOverlap.js';
```

Replace with:

```js
import { findOverlappingLeaves, overlapsOtherLeaves, describeOverlaps,
         findApprovedOverlaps, findOverlapGroups } from './leaveOverlap.js';
```

`findOverlapGroups` is unused until Task 3. That is deliberate — it keeps the import statement stable across both tasks.

- [ ] **Step 2: Read this before writing the call — it will not be caught by the build**

Inside `finalizeLeave` there is a local declaration at `src/main.js:2490`:

```js
const leaveTypeName = leaveCategories.find(c => c.id === record.type)?.name || record.type;
```

It sits in the **same block** as your insertion point (both inside `if(record) {` which opens at `src/main.js:2472`). A `const` is in its **temporal dead zone** from the top of the block until its declaration executes. Referencing `leaveTypeName` at your insertion point — eleven lines *above* that declaration — throws:

```
ReferenceError: Cannot access 'leaveTypeName' before initialization
```

**`npm run build` will not catch this.** It is a runtime error, not a syntax error. The bundle builds, the tests pass, and every approval in the application breaks the moment anyone clicks Luluskan.

Use **`leaveTypeLabel`** instead — the un-shadowed alias of the same imported function, added to `src/main.js:7` by the parent feature. Confirm it is present in the import before you write the call.

- [ ] **Step 3: Insert the guard**

Find this in `window.finalizeLeave` — the end of the existing permission guard, followed by the applicant lookup (currently `src/main.js:2475-2479`):

```js
        if (!window.canManageRequest(user, record)) {
            alert('Anda tidak mempunyai kebenaran untuk meluluskan permohonan cawangan/staf ini.');
            return;
        }
        const applicant = staffList.find(s => s.ic === record.ic);
```

Insert between the closing `}` and `const applicant`:

```js
        if (!window.canManageRequest(user, record)) {
            alert('Anda tidak mempunyai kebenaran untuk meluluskan permohonan cawangan/staf ini.');
            return;
        }

        // ── Halang kelulusan yang bertindih dengan cuti yang SUDAH diluluskan ──
        // DI ATAS SEKALI, sebelum semua cabang peringkat. Cabang-cabang itu
        // menghantar WhatsApp SEBELUM tulisan (2503/2512/2598 vs updateDoc di
        // 2617), jadi sekatan yang diletak kemudian akan memberitahu pemohon
        // cutinya diluluskan, kemudian tidak meluluskannya.
        //
        // Kerana `newStatus` belum wujud di sini, sekatan ini meliputi SEMUA
        // peringkat (TL, HOD, HR) — itu memang niatnya: menyokong rekod yang
        // bertindih dengan cuti yang sudah diluluskan tetap salah, cuma salah
        // lebih awal.
        //
        // Guna leaveTypeLabel, BUKAN leaveTypeName — `const leaveTypeName` di
        // bawah (2490) berada dalam blok yang SAMA, jadi merujuknya di sini
        // melontar ReferenceError (temporal dead zone). Build tidak menangkapnya.
        const _apprDup = findApprovedOverlaps(
            leaveRecords, record.ic, record.startDate, record.endDate, { excludeId: record.id }
        );
        if (_apprDup.length > 0) {
            alert('⛔ TIDAK BOLEH DILULUSKAN — BERTINDIH\n\n' +
                  'Staf ini sudah ada cuti DILULUSKAN untuk tarikh yang sama:\n\n' +
                  describeOverlaps(_apprDup, leaveTypeLabel) + '\n\n' +
                  'Meluluskan permohonan ini akan menolak baki dua kali.\n' +
                  'Sila batalkan rekod yang bertindih itu terlebih dahulu.');
            return;
        }

        const applicant = staffList.find(s => s.ic === record.ic);
```

- [ ] **Step 4: Verify the build and the suite**

```bash
npm run build
node --test tests/leaveOverlap.test.mjs tests/leaveDays.test.mjs tests/leaveBalance.test.mjs tests/leaveTypes.test.mjs tests/masterLogScope.test.mjs tests/nameFormat.test.mjs tests/phoneFormat.test.mjs tests/formulaBTypes.test.mjs tests/loginBranches.test.mjs
```

Expected: `✓ built in …` and `tests 179`, `fail 0`.

- [ ] **Step 5: Verify the TDZ trap by reading, since the build cannot**

Grep your inserted block and confirm it contains **`leaveTypeLabel`** and **no bare `leaveTypeName`**:

```bash
git diff -- src/main.js | grep -n "leaveTypeName\|leaveTypeLabel"
```

Every added line matching `leaveTypeName` must be inside a comment. If `describeOverlaps(_apprDup, leaveTypeName)` appears in your added code, the approve button is broken — fix it before committing.

Also confirm the guard precedes the notifications: `grep -n "sendWhatsApp\|findApprovedOverlaps" src/main.js | head` must show `findApprovedOverlaps` at a **lower** line number than the first `sendWhatsApp` inside `finalizeLeave` (~2503).

- [ ] **Step 6: Commit**

```bash
git add src/main.js
git commit -m "feat(leave): block approving leave that overlaps approved leave

Guards the top of finalizeLeave, before every stage branch. It has to
sit there rather than beside the write: the branches send WhatsApp at
2503/2512/2598 and the write is at 2617, so a later guard would tell the
applicant their leave was approved and then not approve it.

newStatus does not exist that early, so the block covers TL and HOD
support too — supporting a record that collides with approved leave is
the same error caught sooner.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Master Logs row marker and overlap filter

**Files:**
- Modify: `src/main.js` — state var (~491), toggle function (~1615), overlap map (~7710), filter button (~7789), table body (~7806-7815), empty message (~7847)

**Interfaces:**
- Consumes: `findOverlapGroups` and `describeOverlaps` from Tasks 1 and 2 — both already imported by Task 2. Add no new import.
- Produces: nothing.

**Why this matters:** it is the only thing that reveals the duplicates already in the database. The snapshot in `data/leaves.json` contains exactly one overlapping pair — `ADRIANA ATHIRAH BINTI AZMI`, `EL_EMG`, both `2026-07-18`, both `APPROVED` — and it is invisible everywhere today.

**Zone scoping is load-bearing.** Everything below computes from `_mlRecords`, the list already narrowed by `filterByScope` for the viewer's zone and the selected state/branch tabs. Never from raw `leaveRecords`.

- [ ] **Step 1: Add the filter state variable**

`src/main.js:490-491` currently reads:

```js
let masterLogState = SCOPE_ALL;   // SCOPE_ALL | 'Pahang' | 'Terengganu'
let masterLogBranch = SCOPE_ALL;  // SCOPE_ALL | NO_BRANCH | nama cawangan
```

Insert after it:

```js
// Penapis "⚠️ Bertindih sahaja" pada Master Logs. Sengaja TIDAK di-reset oleh
// setMasterLogState/setMasterLogBranch — ia penyempitan pandangan di atas tab,
// bukan sebahagian daripada tab itu. Jadual kosong dilindungi oleh mesej
// khusus di bawah, bukan dengan mematikan penapis secara senyap.
let masterLogOverlapOnly = false;
```

- [ ] **Step 2: Add the toggle function**

`src/main.js:1612-1615` currently reads:

```js
window.setMasterLogBranch = function(b) {
  masterLogBranch = b;
  render();
};
```

Insert after it:

```js
window.toggleMasterLogOverlap = function() {
  masterLogOverlapOnly = !masterLogOverlapOnly;
  render();
};
```

- [ ] **Step 3: Compute the overlap map once per render**

In the `managementTab === 'master_audit'` block, find where `_mlRecords` is built and `_mlStates` follows (currently `src/main.js:7705-7711`):

```js
          const _mlRecords = filterByScope(leaveRecords, {
            userScope: _mlScope,
            state: masterLogState,
            branch: masterLogBranch,
            stateOfBranch: window.scopeStateOfBranch,
          });
          const _mlStates = visibleStates(_mlScope);
```

Insert between them:

```js
          const _mlRecords = filterByScope(leaveRecords, {
            userScope: _mlScope,
            state: masterLogState,
            branch: masterLogBranch,
            stateOfBranch: window.scopeStateOfBranch,
          });
          // Pertindihan dikira SEKALI setiap render, daripada _mlRecords yang
          // sudah ber-skop zon + tab negeri/cawangan. JANGAN guna leaveRecords
          // mentah di sini: kiraan HR Pahang tidak boleh termasuk rekod
          // Terengganu. Berbeza daripada kaunter tab cawangan di bawah yang
          // sengaja abaikan tab semasa — butang ini penapis ke atas pandangan
          // semasa, jadi "(N)" mesti bermaksud N baris yang anda sedang lihat.
          const _mlOverlaps = findOverlapGroups(_mlRecords);
          const _mlOverlapCount = _mlOverlaps.size;
          const _mlRows = masterLogOverlapOnly
            ? _mlRecords.filter(r => _mlOverlaps.has(r.id))
            : _mlRecords;
          const _mlStates = visibleStates(_mlScope);
```

- [ ] **Step 4: Add the filter button to the branch tab row**

Find the end of the branch tab row (currently `src/main.js:7789-7790`) — the "Lain-lain" orphan button followed by the closing `</div>`:

```js
            ${_mlOrphans > 0 ? `<button class="neu-tab ${masterLogBranch === NO_BRANCH ? 'active' : ''}" onclick="window.setMasterLogBranch('__NONE__')" style="border-radius:8px;white-space:nowrap;color:#f59e0b;" title="Rekod dengan cawangan yang tiada dalam senarai cawangan — perlu dibetulkan">Lain-lain (${_mlOrphans})</button>` : ''}
          </div>
```

Insert the new button between them:

```js
            ${_mlOrphans > 0 ? `<button class="neu-tab ${masterLogBranch === NO_BRANCH ? 'active' : ''}" onclick="window.setMasterLogBranch('__NONE__')" style="border-radius:8px;white-space:nowrap;color:#f59e0b;" title="Rekod dengan cawangan yang tiada dalam senarai cawangan — perlu dibetulkan">Lain-lain (${_mlOrphans})</button>` : ''}
            ${(_mlOverlapCount > 0 || masterLogOverlapOnly) ? `<button class="neu-tab ${masterLogOverlapOnly ? 'active' : ''}" onclick="window.toggleMasterLogOverlap()" style="border-radius:8px;white-space:nowrap;color:#dc2626;" title="Tunjuk hanya rekod yang bertindih dengan cuti lain staf yang sama">⚠️ Bertindih (${_mlOverlapCount})</button>` : ''}
          </div>
```

The button is hidden when there is nothing to show — `_mlOverlapCount > 0 || masterLogOverlapOnly` keeps it visible while the filter is on so it can be switched off again.

- [ ] **Step 5: Mark the overlapping rows**

The table body currently maps `_mlRecords` (`src/main.js:7806-7807`):

```js
                          ${_mlRecords.map((r, index) => `
                          <tr style="border-bottom: 1px solid rgba(255,255,255,0.03); transition: background 0.2s;">
```

Replace those two lines with:

```js
                          ${_mlRows.map((r, index) => `
                          <tr style="border-bottom: 1px solid rgba(255,255,255,0.03); transition: background 0.2s;${_mlOverlaps.has(r.id) ? ' border-left: 3px solid #dc2626; background: rgba(239,68,68,0.04);' : ''}">
```

Then the Employee cell (`src/main.js:7812-7815`):

```js
                              <td style="padding: 1.5rem 1rem;">
                                  <div style="font-weight: 700; font-size: 0.85rem; text-transform: uppercase; margin-bottom: 0.25rem;">${r.name}</div>
                                  <div style="font-size: 0.65rem; color: var(--primary); text-transform: uppercase; font-weight: 600;">${r.branch}</div>
                              </td>
```

Replace with:

```js
                              <td style="padding: 1.5rem 1rem;">
                                  <div style="font-weight: 700; font-size: 0.85rem; text-transform: uppercase; margin-bottom: 0.25rem;">${r.name}</div>
                                  <div style="font-size: 0.65rem; color: var(--primary); text-transform: uppercase; font-weight: 600;">${r.branch}</div>
                                  ${_mlOverlaps.has(r.id) ? `<div title="Bertindih dengan:&#10;${describeOverlaps(_mlOverlaps.get(r.id), leaveTypeName).replace(/"/g, '&quot;')}" style="display:inline-block;margin-top:0.35rem;font-size:0.58rem;font-weight:800;color:#dc2626;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:6px;padding:0.15rem 0.4rem;letter-spacing:0.3px;cursor:help;">⚠️ BERTINDIH</div>` : ''}
                              </td>
```

Two details here: `leaveTypeName` is the **imported function** and is correct in this scope — `renderView()` has no local shadow of it, unlike `finalizeLeave` in Task 2. And `describeOverlaps` output is placed in a `title` attribute, so double quotes are escaped; `&#10;` starts the tooltip's list on a new line.

- [ ] **Step 6: Fix the empty-state message**

Currently `src/main.js:7847`:

```js
                  ${_mlRecords.length === 0 ? `<div style="padding:2.5rem 1rem;text-align:center;font-size:0.8rem;color:var(--text-muted);">Tiada rekod untuk pilihan ini.</div>` : ''}
```

Replace with:

```js
                  ${_mlRows.length === 0 ? `<div style="padding:2.5rem 1rem;text-align:center;font-size:0.8rem;color:var(--text-muted);">${masterLogOverlapOnly ? 'Tiada rekod bertindih untuk pilihan ini.' : 'Tiada rekod untuk pilihan ini.'}</div>` : ''}
```

Without this, switching branch tabs with the filter on produces a blank table that reads as a bug.

- [ ] **Step 7: Verify the build, the suite, and that `_mlRecords` is fully retired from the render path**

```bash
npm run build
node --test tests/leaveOverlap.test.mjs tests/leaveDays.test.mjs tests/leaveBalance.test.mjs tests/leaveTypes.test.mjs tests/masterLogScope.test.mjs tests/nameFormat.test.mjs tests/phoneFormat.test.mjs tests/formulaBTypes.test.mjs tests/loginBranches.test.mjs
grep -n "_mlRecords\|_mlRows" src/main.js
```

Expected: `✓ built in …`; `tests 179`, `fail 0`; and the grep showing `_mlRecords` **only** at its declaration and in the `findOverlapGroups(_mlRecords)` / `_mlRecords.filter(...)` lines you added. If `_mlRecords` still appears at the table body or the empty-state check, Steps 5 or 6 were not applied and the filter silently does nothing.

- [ ] **Step 8: Verify against the real snapshot**

The repository has a Firestore snapshot at `data/leaves.json`. Confirm the matcher finds the known pair — this is the closest thing to end-to-end proof available without a browser:

```bash
node -e "
import('./src/leaveOverlap.js').then(m => {
  const recs = JSON.parse(require('fs').readFileSync('./data/leaves.json','utf8'));
  const groups = m.findOverlapGroups(recs);
  console.log('records:', recs.length, '| flagged:', groups.size);
  for (const [id, others] of groups) {
    const r = recs.find(x => x.id === id);
    console.log(' ', r.name, r.type, r.startDate, r.status, '<->', others.map(o => o.type + ' ' + o.startDate + ' ' + o.status).join(', '));
  }
});
"
```

Expected: `records: 138 | flagged: 2`, both lines naming `ADRIANA ATHIRAH BINTI AZMI`, `EL_EMG`, `2026-07-18`, `APPROVED`. A flagged count in the dozens means the matcher is over-flagging — stop and report rather than committing.

- [ ] **Step 9: Commit**

```bash
git add src/main.js
git commit -m "feat(leave): mark and filter overlapping records in Master Logs

Approved duplicates are filtered out of the pending grid, so the
approval-card badge never reaches them; Master Logs is where HR reviews
approved records. Rows in an overlap group get a red marker, and a
Bertindih (N) button narrows the table to them.

Both the count and the rows come from the already zone-scoped
_mlRecords, so a Pahang HR never sees a Terengganu count. The map is
built once per render rather than per row.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Post-implementation

- [ ] Full pure-module suite: `tests 179`, `fail 0`.
- [ ] `npm run build` → `✓ built`.
- [ ] Deploy, then **hard-refresh and clear the service worker cache** before testing. A stale service worker has masked deploys on this project before.
- [ ] Walk the spec's manual checklist (`docs/superpowers/specs/2026-08-13-approved-duplicate-leave-design.md`, Testing section). The one that matters most: approve one of two overlapping records, then try to approve the second — it must be blocked, **and the applicant must receive no WhatsApp for the blocked attempt**. That is the failure this task's guard placement exists to prevent, and only a live test proves it.
- [ ] Check the ⚠️ count as both a Pahang HR and a Terengganu HR — the zone boundary is the thing most likely to be got wrong and least likely to be noticed.
- [ ] Tell HR the ADRIANA pair exists and that one of the two needs cancelling. The code surfaces it; a human still has to act.
