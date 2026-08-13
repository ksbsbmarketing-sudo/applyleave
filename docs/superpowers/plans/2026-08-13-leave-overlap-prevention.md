# Leave Overlap Prevention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop a staff member from holding two live leave applications whose dates overlap, and surface the duplicates already sitting in the pending queue.

**Architecture:** A new pure module `src/leaveOverlap.js` (no DOM, no Firebase — unit-testable like `leaveDays.js` and `masterLogScope.js`) answers "does this date range collide with anything live for this person?". Four call sites in `src/main.js` consume it: the apply form, the edit form, and the approval card. A separate submit-button lock closes the double-click race that an overlap check alone cannot see.

**Tech Stack:** Vanilla ES modules, Vite 8, Firebase Web SDK v12 (Firestore), `node:test` for unit tests. No new dependencies.

## Global Constraints

- **Deny-list, never allow-list.** `NON_BLOCKING_STATUSES = ['REJECTED', 'CANCELLED']`. Every other status blocks, including statuses that do not exist yet. Never rewrite this as a list of blocking statuses.
- **Dates are `'YYYY-MM-DD'` strings.** Compare them as strings. Do not introduce `new Date(...)` anywhere in this feature — that is how timezone bugs get in.
- **Hard block, no override for any role.** HR, admin and super_admin get the same block as a staff member. There is no "continue anyway" button anywhere in this feature.
- **Records missing `startDate`/`endDate` are skipped, never treated as overlapping.** A corrupt old record must not permanently lock someone out of applying.
- **No `firestore.rules` change.** Rules cannot run queries; this is client-side by design.
- **No cleanup migration.** Do not write a script that deletes or merges existing duplicate records.
- **UI copy is Bahasa Malaysia**, matching the surrounding alerts. Code comments in this codebase are Malay or English — follow whichever the file already uses (`main.js` uses Malay for feature comments).
- **Existing `leaveRecords` is already in memory** (`src/main.js:3708`, `onSnapshot` over the whole `leaves` collection). Never add a Firestore query for this feature — the project is on the Spark plan and has exhausted its daily quota before.
- **Test command:** `node --test tests/<file>.test.mjs`. There is no `npm test` script; do not add one.
- **Build check:** `npm run build` must succeed after every task that touches `src/main.js`.
- **Line numbers drift.** Every `src/main.js` line number in this plan is measured against `HEAD` before Task 1. Each task inserts lines, so later tasks' numbers shift downward by whatever earlier tasks added. Every insertion point is also given as a **verbatim code anchor** — locate by the anchor text, treat the line number as a hint.

**Spec:** `docs/superpowers/specs/2026-08-13-leave-overlap-prevention-design.md`

## File Structure

| File | Responsibility |
|---|---|
| `src/leaveOverlap.js` *(new)* | Pure overlap matching. Exports `NON_BLOCKING_STATUSES`, `isBlockingStatus`, `datesOverlap`, `findOverlappingLeaves`, `overlapsOtherLeaves`, `describeOverlaps`. No imports at all. |
| `tests/leaveOverlap.test.mjs` *(new)* | Unit tests for the above. |
| `src/main.js` *(modify)* | Four integration points: import block (~7–9), apply-form block (~4933), submit lock (~446, ~4921, ~5013, ~5148), approval-card badge (~7230), edit-form block (~5298). |

`src/main.js` is a ~11,000-line file. It is the established shape of this codebase and this plan does **not** restructure it — every change here is additive and local.

---

### Task 1: The `leaveOverlap` module

**Files:**
- Create: `src/leaveOverlap.js`
- Test: `tests/leaveOverlap.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces — the exact signatures Tasks 2, 4 and 5 rely on:
  - `NON_BLOCKING_STATUSES: readonly string[]` — frozen `['REJECTED', 'CANCELLED']`
  - `isBlockingStatus(status: string): boolean`
  - `datesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean`
  - `findOverlappingLeaves(records: object[], ic: string, startDate: string, endDate: string, opts?: { excludeId?: string|number }): object[]`
  - `overlapsOtherLeaves(records: object[], record: object): object[]`
  - `describeOverlaps(records: object[], labelOf?: (code: string) => string): string`

- [ ] **Step 1: Write the failing test**

Create `tests/leaveOverlap.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert';
import {
  NON_BLOCKING_STATUSES, isBlockingStatus, datesOverlap,
  findOverlappingLeaves, overlapsOtherLeaves, describeOverlaps,
} from '../src/leaveOverlap.js';

// Mirrors the real `leaves` collection: numeric `id` (Date.now()), `ic` as the
// staff key, 'YYYY-MM-DD' dates, uppercase status strings.
const REC = (over) => ({
  id: 1, ic: '900101015555', type: 'MC',
  startDate: '2026-08-05', endDate: '2026-08-07', status: 'PENDING', ...over,
});

const ids = (recs) => recs.map(r => r.id).sort((a, b) => a - b);
const find = (records, over = {}) => {
  const q = { ic: '900101015555', startDate: '2026-08-05', endDate: '2026-08-07', ...over };
  return findOverlappingLeaves(records, q.ic, q.startDate, q.endDate, q.opts);
};

// ── Date arithmetic ───────────────────────────────────────────────────
test('identical ranges overlap', () => {
  assert.strictEqual(datesOverlap('2026-08-05', '2026-08-07', '2026-08-05', '2026-08-07'), true);
});

test('a range overlapping only at its tail counts', () => {
  assert.strictEqual(datesOverlap('2026-08-05', '2026-08-07', '2026-08-07', '2026-08-09'), true);
});

test('a range overlapping only at its head counts', () => {
  assert.strictEqual(datesOverlap('2026-08-05', '2026-08-07', '2026-08-03', '2026-08-05'), true);
});

test('a range fully containing another overlaps', () => {
  assert.strictEqual(datesOverlap('2026-08-01', '2026-08-31', '2026-08-05', '2026-08-07'), true);
});

test('adjacent but separate ranges do NOT overlap', () => {
  // The off-by-one that would wrongly block legitimate back-to-back leave.
  assert.strictEqual(datesOverlap('2026-08-05', '2026-08-07', '2026-08-08', '2026-08-10'), false);
});

test('single-day leave overlaps a range containing it', () => {
  assert.strictEqual(datesOverlap('2026-08-06', '2026-08-06', '2026-08-05', '2026-08-07'), true);
});

test('dates compare as strings across a year boundary', () => {
  assert.strictEqual(datesOverlap('2026-12-31', '2027-01-02', '2027-01-01', '2027-01-01'), true);
});

// ── Which statuses block ──────────────────────────────────────────────
test('REJECTED and CANCELLED never block', () => {
  assert.strictEqual(isBlockingStatus('REJECTED'), false);
  assert.strictEqual(isBlockingStatus('CANCELLED'), false);
  assert.deepStrictEqual(find([REC({ id: 1, status: 'REJECTED' }), REC({ id: 2, status: 'CANCELLED' })]), []);
});

test('every live status blocks', () => {
  for (const status of ['PENDING', 'TL APPROVED', 'HOD APPROVED', 'HOD RECOMMENDED', 'APPROVED']) {
    assert.strictEqual(isBlockingStatus(status), true, `${status} should block`);
  }
});

test('an unknown or future status blocks by default', () => {
  // Deny-list behaviour, asserted rather than assumed: a status added later
  // must not silently open a hole.
  assert.strictEqual(isBlockingStatus('HR REVIEWING'), true);
  assert.strictEqual(isBlockingStatus(''), true);
  assert.strictEqual(isBlockingStatus(undefined), true);
});

test('status matching tolerates case and whitespace', () => {
  assert.strictEqual(isBlockingStatus(' rejected '), false);
  assert.strictEqual(isBlockingStatus('Cancelled'), false);
});

test('NON_BLOCKING_STATUSES is frozen against a caller mutating it', () => {
  assert.strictEqual(Object.isFrozen(NON_BLOCKING_STATUSES), true);
  assert.throws(() => { NON_BLOCKING_STATUSES.push('APPROVED'); });
});

// ── findOverlappingLeaves ─────────────────────────────────────────────
test('a live record on the same dates is returned', () => {
  assert.deepStrictEqual(ids(find([REC({ id: 7 })])), [7]);
});

test('overlap is checked regardless of leave type', () => {
  // Holding MC for 5-7 Aug blocks AL for 6 Aug.
  const got = find([REC({ id: 7, type: 'MC' })], { startDate: '2026-08-06', endDate: '2026-08-06' });
  assert.deepStrictEqual(ids(got), [7]);
});

test('another staff member never blocks', () => {
  assert.deepStrictEqual(find([REC({ id: 7, ic: '880202025555' })]), []);
});

test('ic matching tolerates surrounding whitespace', () => {
  assert.deepStrictEqual(ids(find([REC({ id: 7, ic: ' 900101015555 ' })])), [7]);
});

test('excludeId removes the record itself, given a number', () => {
  assert.deepStrictEqual(find([REC({ id: 7 })], { opts: { excludeId: 7 } }), []);
});

test('excludeId removes the record itself, given a string', () => {
  // Call sites pass ids from both numeric records and string doc ids.
  assert.deepStrictEqual(find([REC({ id: 7 })], { opts: { excludeId: '7' } }), []);
});

test('excludeId does not remove a different record', () => {
  assert.deepStrictEqual(ids(find([REC({ id: 7 }), REC({ id: 8 })], { opts: { excludeId: 8 } })), [7]);
});

test('records missing dates are skipped, not matched and not thrown on', () => {
  const records = [
    REC({ id: 7, startDate: undefined }),
    REC({ id: 8, endDate: '' }),
    REC({ id: 9, startDate: null, endDate: null }),
  ];
  assert.deepStrictEqual(find(records), []);
});

test('a null entry in the record list does not throw', () => {
  assert.deepStrictEqual(ids(find([null, undefined, REC({ id: 7 })])), [7]);
});

test('a missing record list returns empty', () => {
  assert.deepStrictEqual(findOverlappingLeaves(undefined, '900101015555', '2026-08-05', '2026-08-07'), []);
});

test('an incomplete query returns empty rather than matching everything', () => {
  // Callers own their own validation; this module must not become a second,
  // silent validator that blocks on garbage input.
  const records = [REC({ id: 7 })];
  assert.deepStrictEqual(findOverlappingLeaves(records, '', '2026-08-05', '2026-08-07'), []);
  assert.deepStrictEqual(findOverlappingLeaves(records, '900101015555', '', '2026-08-07'), []);
  assert.deepStrictEqual(findOverlappingLeaves(records, '900101015555', '2026-08-05', ''), []);
});

// ── overlapsOtherLeaves ───────────────────────────────────────────────
test('overlapsOtherLeaves finds the twin of a duplicate pair', () => {
  const a = REC({ id: 1 });
  const b = REC({ id: 2 });
  assert.deepStrictEqual(ids(overlapsOtherLeaves([a, b], a)), [2]);
  assert.deepStrictEqual(ids(overlapsOtherLeaves([a, b], b)), [1]);
});

test('overlapsOtherLeaves never matches the record against itself', () => {
  const a = REC({ id: 1 });
  assert.deepStrictEqual(overlapsOtherLeaves([a], a), []);
});

test('a cancelled record is not flagged as overlapping', () => {
  const a = REC({ id: 1, status: 'CANCELLED' });
  const b = REC({ id: 2 });
  assert.deepStrictEqual(overlapsOtherLeaves([a, b], a), []);
});

test('overlapsOtherLeaves survives a missing record', () => {
  assert.deepStrictEqual(overlapsOtherLeaves([REC({ id: 1 })], null), []);
});

// ── describeOverlaps ──────────────────────────────────────────────────
test('describeOverlaps names type, dates and status on one line each', () => {
  const labelOf = (code) => ({ MC: 'Cuti Sakit (MC)', AL: 'Cuti Tahunan' }[code] || code);
  const got = describeOverlaps([REC({ id: 1 }), REC({ id: 2, type: 'AL', startDate: '2026-08-09', endDate: '2026-08-09' })], labelOf);
  assert.strictEqual(got,
    '• Cuti Sakit (MC) — 2026-08-05 → 2026-08-07 (PENDING)\n' +
    '• Cuti Tahunan — 2026-08-09 (PENDING)');
});

test('describeOverlaps falls back to the raw type code with no resolver', () => {
  assert.strictEqual(describeOverlaps([REC({ id: 1 })]), '• MC — 2026-08-05 → 2026-08-07 (PENDING)');
});

test('describeOverlaps returns empty string for no overlaps', () => {
  assert.strictEqual(describeOverlaps([]), '');
  assert.strictEqual(describeOverlaps(undefined), '');
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --test tests/leaveOverlap.test.mjs
```

Expected: FAIL — `Cannot find module '.../src/leaveOverlap.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/leaveOverlap.js`:

```js
// Semakan pertindihan tarikh cuti — halang staff memohon dua kali untuk
// tarikh yang sama (jenis cuti tidak penting: MC 5-7 Ogos menghalang AL 6 Ogos).
//
// Tiada import DOM/Firebase di sini — itulah yang menjadikannya boleh diuji
// unit, sama seperti leaveDays.js dan masterLogScope.js.
//
// NON_BLOCKING_STATUSES sengaja DENY-LIST, bukan allow-list: status baharu
// yang ditambah kemudian akan menghalang secara lalai, bukan diam-diam
// membuka lubang. Jangan tulis semula sebagai senarai status yang menghalang.

export const NON_BLOCKING_STATUSES = Object.freeze(['REJECTED', 'CANCELLED']);

function norm(v) {
  return typeof v === 'string' ? v.trim() : '';
}

export function isBlockingStatus(status) {
  return !NON_BLOCKING_STATUSES.includes(norm(status).toUpperCase());
}

// Tarikh disimpan 'YYYY-MM-DD', jadi perbandingan string IALAH perbandingan
// tarikh. Tiada `new Date(...)` di sini → tiada kelas pepijat zon waktu.
export function datesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart <= bEnd && bStart <= aEnd;
}

// Rekod hidup milik `ic` yang bertindih dengan [startDate, endDate].
export function findOverlappingLeaves(records, ic, startDate, endDate, opts = {}) {
  const wantIc = norm(ic);
  const start = norm(startDate);
  const end = norm(endDate);
  // Pengesahan input ialah tanggungjawab pemanggil. Modul ini tidak boleh
  // menjadi pengesah kedua yang senyap.
  if (!wantIc || !start || !end) return [];

  const excludeId = opts.excludeId == null ? null : String(opts.excludeId);

  return (records || []).filter(r => {
    if (!r) return false;
    if (norm(r.ic) !== wantIc) return false;
    if (excludeId !== null && String(r.id) === excludeId) return false;
    if (!isBlockingStatus(r.status)) return false;
    const rStart = norm(r.startDate);
    const rEnd = norm(r.endDate);
    // Rekod tanpa tarikh DILANGKAU, bukan dikira bertindih — rekod lama yang
    // rosak tidak boleh mengunci staff daripada memohon selama-lamanya.
    if (!rStart || !rEnd) return false;
    return datesOverlap(start, end, rStart, rEnd);
  });
}

// Adakah rekod ini bertindih dengan rekod HIDUP LAIN milik staff yang sama?
// Digunakan untuk lencana amaran pada kad kelulusan.
export function overlapsOtherLeaves(records, record) {
  if (!record || !isBlockingStatus(record.status)) return [];
  return findOverlappingLeaves(
    records, record.ic, record.startDate, record.endDate, { excludeId: record.id }
  );
}

// Senarai boleh dibaca manusia untuk alert atau lencana. `labelOf` disuntik
// (bukan di-import) supaya modul ini kekal bebas daripada keadaan aplikasi.
export function describeOverlaps(records, labelOf) {
  const label = typeof labelOf === 'function' ? labelOf : (code) => code;
  return (records || []).map(r => {
    const period = r.endDate === r.startDate ? r.startDate : `${r.startDate} → ${r.endDate}`;
    return `• ${label(r.type)} — ${period} (${r.status})`;
  }).join('\n');
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node --test tests/leaveOverlap.test.mjs
```

Expected: PASS, 0 failures. Confirm the summary line reads `fail 0` before continuing.

- [ ] **Step 5: Commit**

```bash
git add src/leaveOverlap.js tests/leaveOverlap.test.mjs
git commit -m "feat(leave): add pure overlap-detection module

Answers 'does this date range collide with anything live for this
person?' against the in-memory leaveRecords array. Statuses are a
deny-list of REJECTED/CANCELLED so a status added later blocks by
default. Dates compare as YYYY-MM-DD strings, never parsed as Date.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Block the apply form

**Files:**
- Modify: `src/main.js:7-9` (imports), `src/main.js:4933` (insertion point)

**Interfaces:**
- Consumes: `findOverlappingLeaves`, `describeOverlaps` from Task 1.
- Produces: nothing for later tasks. Task 4 and Task 5 add their own imports to the same statement, so the import line is written once here with everything all three need.

**Why here and nowhere else:** the check goes immediately after the working-days check and **before** the AL/EL balance dialogs (`src/main.js:4936-4961`), the approver checks, and the Cloudinary upload (`src/main.js:5019`). The applicant must not click through three `alert()` dialogs only to be rejected at the end, and no file may be uploaded for an application that will never exist.

- [ ] **Step 1: Add the imports**

`src/main.js` lines 7–8 currently read:

```js
import { LEAVE_CATEGORIES, LEAVE_TYPE_NAMES, leaveTypeName, leaveTypeShort,
         proofRequirement, hexToRgbTriple, PROOF_REQUIRED_TYPES } from './leaveTypes.js';
```

Replace with (note the second alias — see Step 2 for why):

```js
import { LEAVE_CATEGORIES, LEAVE_TYPE_NAMES, leaveTypeName, leaveTypeName as leaveTypeLabel,
         leaveTypeShort, proofRequirement, hexToRgbTriple, PROOF_REQUIRED_TYPES } from './leaveTypes.js';
```

Then add a new import immediately after the `masterLogScope.js` import on line 9:

```js
import { findOverlappingLeaves, overlapsOtherLeaves, describeOverlaps } from './leaveOverlap.js';
```

`overlapsOtherLeaves` is unused until Task 4. That is deliberate — it keeps the import statement stable across tasks. Vite does not fail on an unused import.

- [ ] **Step 2: Understand the shadowing trap before writing the call**

`leaveTypeName` is a **function** `(code) => string`. But inside the submit handler it is shadowed by a local `const` holding the *current* application's name as a **string**:

```js
// src/main.js:4922 — inside the submit callback
const leaveTypeName = leaveCategories.find(c => c.id === selectedLeaveType)?.name || selectedLeaveType;
```

Passing that to `describeOverlaps` would label every conflicting record with the wrong type. This is why Step 1 imports the same binding a second time as `leaveTypeLabel` — that name is not shadowed anywhere. **Inside this handler, use `leaveTypeLabel`, never `leaveTypeName`.**

(The same shadowing pattern exists at `src/main.js:2479`, `2659`, `2695`, `2716`, `2741`. It does **not** exist in `renderView()`, which is why Task 4 can use `leaveTypeName` directly.)

- [ ] **Step 3: Insert the block**

In `src/main.js`, find this line inside the submit handler (currently line 4933, right after the `diffDays <= 0` guard closes):

```js
      if (applyHalfDay) diffDays -= 0.5;
```

Insert immediately **before** it:

```js
      // ── Halang permohonan bertindih ──
      // Diletakkan SEBELUM dialog baki AL/EL, semakan pelulus dan muat naik
      // Cloudinary: pemohon tidak perlu klik tiga dialog sebelum ditolak, dan
      // tiada fail dimuat naik untuk permohonan yang takkan wujud.
      // Guna leaveTypeLabel (fungsi), BUKAN leaveTypeName — yang itu dilindungi
      // oleh const tempatan di atas yang memegang nama jenis cuti semasa.
      const _overlaps = findOverlappingLeaves(leaveRecords, user.ic, startDate, endDate);
      if (_overlaps.length > 0) {
        alert('🔴 PERMOHONAN BERTINDIH\n\n' +
              'Anda sudah ada permohonan cuti untuk tarikh ini:\n\n' +
              describeOverlaps(_overlaps, leaveTypeLabel) + '\n\n' +
              'Permohonan baharu tidak boleh dihantar. Sila batalkan permohonan asal ' +
              'terlebih dahulu jika anda perlu mengubah tarikh.');
        return;
      }
```

- [ ] **Step 4: Verify the build and the existing suite**

```bash
npm run build
node --test tests/leaveOverlap.test.mjs tests/leaveDays.test.mjs tests/leaveTypes.test.mjs
```

Expected: `✓ built in …` with no error, and `fail 0` from the tests.

- [ ] **Step 5: Verify by hand in the running app**

```bash
npm run dev
```

Log in as any staff account, then:

1. Apply MC for 5–7 Aug 2026 → succeeds.
2. Apply AL for 6 Aug 2026 → **blocked**. The alert names the MC record, its dates and `PENDING`, and the leave type shown is *Cuti Sakit (MC)* — not the AL you were applying for. A wrong label here means Step 2's alias was not applied.
3. Apply AL for 8 Aug 2026 (adjacent, not overlapping) → succeeds.
4. Watch the Network tab during step 2: **no request to `api.cloudinary.com`** fires. If one does, the block was inserted after the upload rather than before it.

- [ ] **Step 6: Commit**

```bash
git add src/main.js
git commit -m "feat(leave): block overlapping applications at the apply form

Checks the in-memory leaveRecords before the balance dialogs and before
the Cloudinary upload, so a blocked applicant sees one alert and no file
is uploaded for an application that will never exist.

Imports leaveTypeName a second time as leaveTypeLabel: the handler has a
local const of the same name holding the current type as a string, which
would mislabel every conflicting record.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Lock the submit button

**Files:**
- Modify: `src/main.js:446` (flag), `src/main.js:4921` (guard), `src/main.js:5013` (lock + `try`), `src/main.js:5148-5151` (`finally`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: nothing for later tasks.

**Why this is the real fix:** two clicks in the same second both read a `leaveRecords` array that predates either write, so **both pass Task 2's overlap check**. The lock is what stops the accidental duplicate; Task 2 is what stops the deliberate one. Neither substitutes for the other.

- [ ] **Step 1: Add the module-level flag**

`src/main.js:446` currently reads:

```js
let duplicateSessionDetected = false;
```

Insert immediately after it:

```js
// Kunci hantar borang cuti. Muat naik bukti ke Cloudinary ambil beberapa saat;
// tanpa kunci ini, klik kedua menjalankan semula seluruh handler dan menulis
// rekod kedua. Semakan pertindihan TIDAK dapat menangkapnya — kedua-dua larian
// membaca leaveRecords yang sama, sebelum mana-mana tulisan mendarat.
let leaveSubmitting = false;
```

- [ ] **Step 2: Add the re-entry guard**

In the submit handler, `src/main.js:4920-4921` currently read:

```js
      e.preventDefault();
      
      const leaveTypeName = leaveCategories.find(c => c.id === selectedLeaveType)?.name || selectedLeaveType;
```

Insert the guard between them:

```js
      e.preventDefault();
      if (leaveSubmitting) return;

      const leaveTypeName = leaveCategories.find(c => c.id === selectedLeaveType)?.name || selectedLeaveType;
```

- [ ] **Step 3: Engage the lock and open the `try`**

Find the Cloudinary upload comment block (currently `src/main.js:5013`):

```js
      // ── Muat naik fail bukti (MC / Kecemasan / Ehsan / CME) ke Cloudinary ──
```

Insert immediately **before** that comment:

```js
      // ── Kunci hantar ──
      // Ditetapkan SELEPAS semua pengesahan lulus: kalau diletak di awal,
      // kegagalan pengesahan akan mengunci borang sampai render seterusnya.
      // `finally` di hujung memulihkan butang walau upload/tulisan gagal —
      // jangan tukar kepada pemulihan manual di setiap `return`.
      leaveSubmitting = true;
      const _submitBtn = leaveForm.querySelector('button[type="submit"]');
      const _submitBtnHTML = _submitBtn ? _submitBtn.innerHTML : '';
      if (_submitBtn) {
        _submitBtn.disabled = true;
        _submitBtn.style.opacity = '0.6';
        _submitBtn.style.cursor = 'not-allowed';
        _submitBtn.textContent = 'MENGHANTAR…';
      }
      try {
```

- [ ] **Step 4: Close the `try` with a `finally`**

The handler currently ends at `src/main.js:5148-5152`:

```js
      navigator.clipboard.writeText(copyText).catch(() => {});
      alert(statusMsg);
      view = 'dashboard';
      render();
    });
  }
```

Replace with:

```js
        navigator.clipboard.writeText(copyText).catch(() => {});
        alert(statusMsg);
        view = 'dashboard';
        render();
      } finally {
        leaveSubmitting = false;
        if (_submitBtn) {
          _submitBtn.disabled = false;
          _submitBtn.style.opacity = '';
          _submitBtn.style.cursor = '';
          _submitBtn.innerHTML = _submitBtnHTML;
        }
      }
    });
  }
```

- [ ] **Step 5: Re-indent the wrapped body**

Indent every line from the Cloudinary comment (Step 3's insertion point) down to the line above `} finally {` by **two additional spaces**, so the body sits inside the `try`. Step 4's replacement block already shows its four lines at their final indentation — do not indent those a second time. The two `return` statements inside the body (`src/main.js:5041` on upload failure, `src/main.js:5079` on write failure) are unaffected — `finally` runs on `return` as well as on throw, which is exactly why the block is a `try/finally` rather than manual restore calls.

- [ ] **Step 6: Verify nothing but indentation moved**

```bash
npm run build
git diff -w -- src/main.js
```

`git diff -w` ignores whitespace changes, so the output must show **only** the flag, the guard, the lock block, and the `finally` block — no other altered lines. If any unrelated line appears, the re-indent damaged something. `npm run build` must also print `✓ built in …`; an unbalanced brace fails here.

- [ ] **Step 7: Verify by hand**

```bash
npm run dev
```

1. Open DevTools → Network → set throttling to "Slow 3G" (this widens the upload window the bug lives in).
2. Apply MC with a proof image attached. Click **HANTAR PERMOHONAN** as fast as you can, five or six times.
3. Expected: the button greys out and reads `MENGHANTAR…` on the first click; **exactly one** record appears in the pending list afterwards.
4. Now go offline mid-upload (Network → Offline) and submit again. Expected: the upload-failure alert appears, the button returns to `HANTAR PERMOHONAN` and is clickable, and going back online lets the retry succeed. A permanently dead button here means the `finally` is misplaced.

- [ ] **Step 8: Commit**

```bash
git add src/main.js
git commit -m "fix(leave): lock the submit button during application submit

The Cloudinary upload takes seconds with no feedback and the button was
never disabled, so a second click re-ran the whole handler and wrote a
second record. The overlap check cannot catch this: both runs read the
same leaveRecords snapshot before either write lands.

Flag is set after validation passes so a rejected submit does not leave
the form locked, and released in a finally so an upload or write failure
returns the button to the applicant.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Overlap badge on the approval card

**Files:**
- Modify: `src/main.js:7230` (insertion point, inside `renderView()`)

**Interfaces:**
- Consumes: `overlapsOtherLeaves`, `describeOverlaps` from Task 1; both already imported in Task 2 Step 1.
- Produces: nothing for later tasks.

**Why this matters:** it is the only part of this feature that helps with the duplicates **already** in the pending queue. The badge appears on both cards of a duplicate pair — the approver sees two flagged cards and rejects one. No migration required.

- [ ] **Step 1: Insert the badge**

In `renderView()`, the approval card renders a stage-indicator strip that closes at `src/main.js:7229`, followed by a blank line and the Days/Period grid at `src/main.js:7231`:

```js
                  </div>

                  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.5rem;">
```

Insert between them:

```js
                  </div>

                  ${(() => {
                      // Lencana ini yang mendedahkan duplikat yang SUDAH ada dalam
                      // barisan menunggu — ia muncul pada KEDUA-DUA kad pasangan
                      // duplikat, jadi pelulus nampak dua kad bertanda dan tolak satu.
                      const _ov = overlapsOtherLeaves(leaveRecords, req);
                      if (_ov.length === 0) return '';
                      return `
                  <div style="padding: 0.5rem 0.75rem; border-radius: 8px; margin-bottom: 1rem; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); color: #dc2626; font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">
                      ⚠️ Bertindih — staf ini ada permohonan lain untuk tarikh yang sama
                      <div style="margin-top: 0.35rem; font-weight: 600; text-transform: none; letter-spacing: 0; white-space: pre-line;">${describeOverlaps(_ov, leaveTypeName)}</div>
                  </div>`;
                  })()}

                  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.5rem;">
```

`leaveTypeName` here is the imported **function** and is correct — `renderView()` has no local shadow of that name (unlike the submit handler in Task 2). The styling mirrors the stage-indicator strip directly above it (same padding, radius, font size and letter-spacing) with the danger palette, so it reads as a warning rather than another stage label.

- [ ] **Step 2: Verify the build**

```bash
npm run build
```

Expected: `✓ built in …`. A broken template literal or unbalanced brace fails here.

- [ ] **Step 3: Verify by hand**

```bash
npm run dev
```

1. Log in as an account that can see the pending queue (HR, admin, super_admin, or the relevant HOD) and open **Management → Pending**.
2. The existing duplicate MC pair reported by HR must now show the red ⚠️ strip on **both** cards, each naming the other's type, dates and status.
3. Reject one → the badge disappears from the survivor on the next render, because `REJECTED` no longer blocks.
4. A staff member with only one pending application shows **no** badge.

- [ ] **Step 4: Commit**

```bash
git add src/main.js
git commit -m "feat(leave): flag overlapping applications on the approval card

Duplicates already in the pending queue predate the apply-form block, so
they need surfacing rather than preventing. The badge renders on both
cards of a pair; the approver rejects one and it clears itself.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Block the edit form

**Files:**
- Modify: `src/main.js:5298` (insertion point, inside the edit-leave modal handler)

**Interfaces:**
- Consumes: `findOverlappingLeaves`, `describeOverlaps` from Task 1; already imported in Task 2 Step 1.
- Produces: nothing.

**Why:** the edit modal can move a record's dates onto another live application, which would recreate the exact problem Task 2 blocks. `excludeId` keeps a record from conflicting with itself.

- [ ] **Step 1: Insert the check**

In the edit-leave submit handler, `src/main.js:5296-5299` currently read:

```js
              if (!(elDays > 0)) {
                  alert('Bilangan hari mesti lebih daripada 0. Sila betulkan.'); return;
              }
              const updates = {
```

Insert between the closing brace and `const updates = {`:

```js
              if (!(elDays > 0)) {
                  alert('Bilangan hari mesti lebih daripada 0. Sila betulkan.'); return;
              }
              // `rec.ic` bukan `user.ic` — HR dan pelulus mengedit rekod orang lain di sini.
              // `excludeId` menghalang rekod daripada bertindih dengan dirinya sendiri.
              const _editOverlaps = findOverlappingLeaves(leaveRecords, rec.ic, elStart, elEnd,
                                                          { excludeId: editingLeaveId });
              if (_editOverlaps.length > 0) {
                  alert('🔴 TARIKH BERTINDIH\n\n' +
                        'Staf ini sudah ada permohonan cuti lain untuk tarikh tersebut:\n\n' +
                        describeOverlaps(_editOverlaps, leaveTypeName) + '\n\n' +
                        'Sila batalkan permohonan berkenaan terlebih dahulu.');
                  return;
              }
              const updates = {
```

`leaveTypeName` is the imported function here and is correct — the shadow at `src/main.js:4922` is scoped to the *apply* handler's callback, not this one.

- [ ] **Step 2: Verify the build and run the full pure-module suite**

```bash
npm run build
node --test tests/leaveOverlap.test.mjs tests/leaveDays.test.mjs tests/leaveBalance.test.mjs tests/leaveTypes.test.mjs tests/masterLogScope.test.mjs tests/nameFormat.test.mjs tests/phoneFormat.test.mjs tests/formulaBTypes.test.mjs tests/loginBranches.test.mjs
```

Expected: `✓ built in …` and `fail 0`.

- [ ] **Step 3: Verify by hand**

```bash
npm run dev
```

1. As HR, with a staff member holding MC 5–7 Aug and AL 15 Aug, open the AL record and change its dates to 6–8 Aug → **blocked**, alert names the MC record, modal stays open with the entered values intact.
2. Change them to 20–21 Aug instead → saves.
3. Open the MC record and save it **without changing the dates** → saves. Blocking here would mean `excludeId` is not wired up, and would make every existing record uneditable.
4. Regression: editing a record still resets it to `PENDING` for a non-admin editor and still fires the "perlu sokongan semula" WhatsApp/Inbox notifications.

- [ ] **Step 4: Commit**

```bash
git add src/main.js
git commit -m "feat(leave): block edits that move a record onto overlapping dates

The edit modal could recreate exactly what the apply form now prevents.
Uses rec.ic rather than user.ic because HR and approvers edit other
people's records here, and excludeId so a record never conflicts with
itself.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Post-implementation

After all five tasks, before considering this shipped:

- [ ] Run the full pure-module suite one final time (command in Task 5 Step 2) — `fail 0`.
- [ ] `npm run build` — `✓ built`.
- [ ] Deploy, then **hard-refresh and clear the service worker cache** before testing on the live site. A stale service worker has masked deploys on this project before, and "still broken" reports after a deploy are usually cache, not code.
- [ ] Walk the manual checklist in the spec's Testing section (`docs/superpowers/specs/2026-08-13-leave-overlap-prevention-design.md`) against the live site, in particular the double-click test on a real phone over mobile data — that is where the original duplicates came from.
- [ ] Tell HR the badge exists and what it means, so the existing duplicate pair in the queue actually gets resolved. The code surfaces them; a human still has to reject one.
