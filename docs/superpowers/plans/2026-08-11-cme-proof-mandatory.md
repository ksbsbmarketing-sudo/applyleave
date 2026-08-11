# Mandatory CME Proof Upload — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Applying for Latihan CME requires uploading a proof file (surat jemputan / slip pendaftaran, JPG/PNG/PDF) — no file, no application.

**Architecture:** The "this leave type needs proof" rule is currently spelled out in four places in `src/main.js`, no two alike. This plan moves it into a single frozen `LEAVE_PROOF` map in `src/leaveTypes.js` and turns all four sites into lookups, so CME becomes a data entry rather than a fifth copy. One shared `renderProofSection()` replaces the three near-identical upload UI blocks.

**Tech Stack:** Vanilla ES modules + Vite, Firebase Firestore, Cloudinary unsigned upload. Tests are `node --test` on `.mjs` files — no test framework, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-11-cme-proof-mandatory-design.md`

## Global Constraints

- **All user-facing copy is Malay.** Match the surrounding tone (e.g. "Sila muat naik…", "MAAF, Borang ditolak.").
- **Existing MC / EL / EL_EMG copy moves verbatim.** This work changes where strings live, not what they say. Three deliberate exceptions, all in Task 1:
  - EL and EL_EMG gain a `notice` string. Neither has one today, because neither renders a notice bar today.
  - EL's section title becomes `'Surat Kematian'`, dropping the trailing "— Wajib Muat Naik". The shared renderer puts a "★ WAJIB" chip beside every title, so keeping the words would read "Surat Kematian — Wajib Muat Naik ★ WAJIB".
- **Storage codes are frozen.** `MC`, `EL`, `EL_EMG`, `CME` appear in every historical Firestore record. Never rename an id.
- **RL (Cuti Ganti) is deliberately NOT given mandatory proof.** This is a decision, not an oversight — Task 1 pins it with a test.
- **No new npm dependencies.**
- **No `firestore.rules` change.** Validation is client-side only, matching the existing posture for MC/EL/EL_EMG. Spec §6 explains why.
- Proof uploads go to **Cloudinary**, not Firebase Storage (Storage is not provisioned on this project). Folder `leave-proofs/{ic}`, 10 MB cap, `accept="image/jpeg,image/png,image/jpg,application/pdf"`.
- Run tests with `node --test tests/leaveTypes.test.mjs`. There is no `npm test` script; do not add one.
- **Every `src/main.js` line number in this plan refers to the file as it stands before Task 1.** Task 2 Step 2 inserts ~35 lines near line 1188, which shifts everything below it. Locate each edit by the quoted code, not the number — the numbers are a hint, the quoted code is the anchor.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/leaveTypes.js` | Single source of truth for what a leave type *is* and now what it *requires*. No DOM/Firebase imports, so it stays unit-testable. | Add `LEAVE_PROOF`, `PROOF_REQUIRED_TYPES`, `proofRequirement()`, `hexToRgbTriple()` |
| `tests/leaveTypes.test.mjs` | Pins the catalogue's frozen boundary | Add a `LEAVE_PROOF` describe-block worth of tests |
| `src/main.js` | Everything else (app shell, forms, renderers). Huge and monolithic — this is the established pattern; do not restructure it. | Add `renderProofSection()`; convert 4 call sites to lookups |

---

### Task 1: The `LEAVE_PROOF` map and its tests

Pure data + two pure functions. No behaviour changes anywhere yet — nothing reads the map until Task 2. This task is safe to land on its own.

**Files:**
- Modify: `src/leaveTypes.js` (append after `leaveTypeShort`, ~line 47)
- Test: `tests/leaveTypes.test.mjs` (append)

**Interfaces:**
- Consumes: `LEAVE_CATEGORIES` (already in this file)
- Produces, for Tasks 2–4:
  - `LEAVE_PROOF` — frozen object, keys are leave-type ids, values have `{ inputId, title, hint, buttonLabel, barFrom, barTo, boxColor, notice, error }` (all strings)
  - `PROOF_REQUIRED_TYPES: readonly string[]`
  - `proofRequirement(code: string) → entry | null`
  - `hexToRgbTriple(hex: string) → string` e.g. `'#3b82f6' → '59,130,246'`

- [ ] **Step 1: Write the failing tests**

Append to `tests/leaveTypes.test.mjs`. Also add the four new names to the existing import block at the top of the file:

```js
import {
  LEAVE_CATEGORIES, LEAVE_TYPE_NAMES, LEAVE_TYPE_SHORT,
  leaveTypeName, leaveTypeShort,
  LEAVE_PROOF, PROOF_REQUIRED_TYPES, proofRequirement, hexToRgbTriple,
} from '../src/leaveTypes.js';
```

```js
// ── Proof requirement ─────────────────────────────────────────────────
// LEAVE_PROOF is the ONLY list of which leave types demand a document.
// Four call sites in main.js read it; none of them keeps its own copy.

test('CME requires proof — a doctor cannot apply without an invitation letter', () => {
  const cme = proofRequirement('CME');
  assert.ok(cme, 'CME must require proof');
  assert.strictEqual(cme.inputId, 'cme-upload');
});

test('the three original proof types still require proof', () => {
  ['MC', 'EL', 'EL_EMG'].forEach(id =>
    assert.ok(proofRequirement(id), `${id} required proof before this change and still must`));
});

test('RL requires NO proof — deliberate, do not "fix" this', () => {
  // Cuti Ganti is the other doctors-only claimed-after-the-fact type, so it
  // looks like an omission. It is not: it was excluded on purpose (spec
  // 2026-08-11, "Non-goals"). Adding it is a policy decision, not a bugfix.
  assert.strictEqual(proofRequirement('RL'), null);
});

test('types with no document requirement return null, not undefined', () => {
  ['AL', 'UP', 'HL', 'ML', 'ML_PL', 'NONSENSE'].forEach(id =>
    assert.strictEqual(proofRequirement(id), null, `${id} must not demand proof`));
});

test('every proof key is a real leave type — a typo would silently never fire', () => {
  const ids = LEAVE_CATEGORIES.map(c => c.id);
  PROOF_REQUIRED_TYPES.forEach(id =>
    assert.ok(ids.includes(id), `${id} is not in LEAVE_CATEGORIES`));
});

test('every entry is complete — a half-added type fails here, not in the browser', () => {
  const fields = ['inputId', 'title', 'hint', 'buttonLabel', 'barFrom', 'barTo', 'boxColor', 'notice', 'error'];
  PROOF_REQUIRED_TYPES.forEach(id => {
    fields.forEach(f => {
      const v = LEAVE_PROOF[id][f];
      assert.strictEqual(typeof v, 'string', `${id}.${f} must be a string`);
      assert.ok(v.length > 0, `${id}.${f} must not be empty`);
    });
  });
});

test('inputIds are unique and end in -upload — renderProofSection derives ids from them', () => {
  const inputs = PROOF_REQUIRED_TYPES.map(id => LEAVE_PROOF[id].inputId);
  assert.strictEqual(new Set(inputs).size, inputs.length, 'duplicate inputId');
  inputs.forEach(i => assert.ok(i.endsWith('-upload'),
    `${i} must end in -upload: the renderer builds the filename/notice element ids from that stem`));
});

test('colours are 6-digit hex — hexToRgbTriple assumes it', () => {
  PROOF_REQUIRED_TYPES.forEach(id => {
    ['barFrom', 'barTo', 'boxColor'].forEach(f =>
      assert.match(LEAVE_PROOF[id][f], /^#[0-9a-f]{6}$/, `${id}.${f}`));
  });
});

test('hexToRgbTriple converts to the comma triple CSS rgba() needs', () => {
  assert.strictEqual(hexToRgbTriple('#3b82f6'), '59,130,246');
  assert.strictEqual(hexToRgbTriple('#ef4444'), '239,68,68');
  assert.strictEqual(hexToRgbTriple('#f97316'), '249,115,22');
  assert.strictEqual(hexToRgbTriple('#8b5cf6'), '139,92,246');
  assert.strictEqual(hexToRgbTriple('#000000'), '0,0,0');
  assert.strictEqual(hexToRgbTriple('#ffffff'), '255,255,255');
});

test('CME proof copy names the document a doctor actually has', () => {
  // CME is applied for BEFORE attending, so the certificate does not exist yet.
  // The invitation letter or registration slip does. Both hint and error say so.
  const cme = proofRequirement('CME');
  assert.match(cme.hint, /jemputan|pendaftaran/i);
  assert.match(cme.error, /jemputan|pendaftaran/i);
});

test('LEAVE_PROOF cannot be mutated by a caller', () => {
  const before = LEAVE_PROOF.CME.inputId;
  try { LEAVE_PROOF.CME = 'HACKED'; } catch { /* frozen throws in strict mode */ }
  assert.strictEqual(LEAVE_PROOF.CME.inputId, before);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/leaveTypes.test.mjs`
Expected: FAIL — `SyntaxError: The requested module '../src/leaveTypes.js' does not provide an export named 'LEAVE_PROOF'`

- [ ] **Step 3: Implement the map**

Append to `src/leaveTypes.js`:

```js
// ── Proof requirement ─────────────────────────────────────────────────
// SINGLE SOURCE OF TRUTH for which leave types cannot be submitted without a
// document. Four places in main.js read this: the submit-time block, the file
// input picker, the upload UI renderer, and HR's re-upload button in Master
// Logs. Adding a type here wires up all four — do not re-list codes elsewhere.
//
// Cuti Ganti (RL) is absent ON PURPOSE. See tests/leaveTypes.test.mjs.
//
// `barFrom`/`barTo` colour the section header bar's gradient; `boxColor` is the
// dashed upload box's border, tint and button. The filename and notice element
// ids are derived from `inputId` by swapping the `-upload` suffix.
export const LEAVE_PROOF = Object.freeze({
  MC: Object.freeze({
    inputId:     'mc-upload',
    title:       'Dokumen Wajib',
    hint:        'Sila muat naik MC yang dikeluarkan oleh doktor <strong>(JPG/PNG/PDF, maks 10MB)</strong>',
    buttonLabel: 'PILIH FAIL MC',
    barFrom:     '#10b981',
    barTo:       '#3b82f6',
    boxColor:    '#3b82f6',
    notice:      'MC BELUM DIMUAT NAIK — WAJIB SEBELUM HANTAR',
    error:       '🔴 WAJIB: Sila muat naik Sijil Sakit (MC) yang dikeluarkan oleh doktor sebelum menghantar permohonan.\n\nFormat yang diterima: Gambar (JPG/PNG) atau PDF.',
  }),
  EL: Object.freeze({
    inputId:     'ehsan-upload',
    title:       'Surat Kematian',
    hint:        'Cuti Ehsan hanya untuk kematian ayah, ibu, suami, isteri, atau anak. Had: 3 hari sahaja. <strong>(JPG/PNG/PDF, maks 10MB)</strong>',
    buttonLabel: 'PILIH FAIL',
    barFrom:     '#ef4444',
    barTo:       '#f43f5e',
    boxColor:    '#ef4444',
    notice:      'SURAT KEMATIAN BELUM DIMUAT NAIK — WAJIB SEBELUM HANTAR',
    error:       'MAAF, Borang ditolak. Anda WAJIB memuat naik Salinan Sijil Kematian bagi permohonan Cuti Ehsan.',
  }),
  EL_EMG: Object.freeze({
    inputId:     'emg-upload',
    title:       'Bukti Kecemasan',
    hint:        'Sila muat naik gambar/bukti berkaitan (contoh: gambar banjir, kerosakan kenderaan dll) <strong>(JPG/PNG/PDF, maks 10MB)</strong>',
    buttonLabel: 'PILIH FAIL BUKTI',
    barFrom:     '#ef4444',
    barTo:       '#f97316',
    boxColor:    '#f97316',
    notice:      'BUKTI KECEMASAN BELUM DIMUAT NAIK — WAJIB SEBELUM HANTAR',
    error:       'MAAF, Borang ditolak. Anda WAJIB memuat naik dokumen/gambar bukti bagi permohonan Cuti Kecemasan.',
  }),
  // CME is applied for BEFORE attending, so the attendance certificate does not
  // exist yet — the invitation letter or registration slip is what the doctor has.
  CME: Object.freeze({
    inputId:     'cme-upload',
    title:       'Bukti CME',
    hint:        'Sila muat naik surat jemputan atau slip pendaftaran program CME <strong>(JPG/PNG/PDF, maks 10MB)</strong>',
    buttonLabel: 'PILIH FAIL BUKTI CME',
    barFrom:     '#8b5cf6',
    barTo:       '#a78bfa',
    boxColor:    '#8b5cf6',   // same violet as CME in LEAVE_CATEGORIES
    notice:      'BUKTI CME BELUM DIMUAT NAIK — WAJIB SEBELUM HANTAR',
    error:       '🔴 WAJIB: Sila muat naik surat jemputan atau slip pendaftaran program CME sebelum menghantar permohonan.\n\nFormat yang diterima: Gambar (JPG/PNG) atau PDF.',
  }),
});

export const PROOF_REQUIRED_TYPES = Object.freeze(Object.keys(LEAVE_PROOF));

export function proofRequirement(code) {
  return LEAVE_PROOF[code] || null;
}

// '#3b82f6' → '59,130,246', for building rgba() strings at a chosen alpha.
export function hexToRgbTriple(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/leaveTypes.test.mjs`
Expected: PASS, 21 tests (10 existing + 11 new), 0 fail

- [ ] **Step 5: Commit**

```bash
git add src/leaveTypes.js tests/leaveTypes.test.mjs
git commit -m "feat(leave): add LEAVE_PROOF as the single list of types needing a document

CME joins MC, Cuti Ehsan and Cuti Kecemasan. Nothing reads the map yet;
main.js still carries its four hardcoded copies. RL is excluded on purpose
and a test pins that so it is not 'fixed' later by mistake.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: One shared upload-box renderer

Replaces the three near-identical HTML blocks with one call. After this task the CME upload box **appears** but is not yet enforced — that is Task 3. This intermediate state is safe: an optional upload box changes nothing about how CME behaves today.

**Files:**
- Modify: `src/main.js:7` (import), after `window.handleFileSelect` ~line 1187 (new function), `src/main.js:6104-6107` (flags), `src/main.js:6348-6404` (the three blocks)

**Interfaces:**
- Consumes: `proofRequirement`, `hexToRgbTriple` from Task 1
- Produces: module-scope `renderProofSection(code) → string` (HTML, or `''` when the type needs no proof)

- [ ] **Step 1: Extend the import on `src/main.js:7`**

```js
import { LEAVE_CATEGORIES, LEAVE_TYPE_NAMES, leaveTypeName, leaveTypeShort,
         proofRequirement, hexToRgbTriple, PROOF_REQUIRED_TYPES } from './leaveTypes.js';
```

(`PROOF_REQUIRED_TYPES` is unused until Task 4. Import it now so the import line is touched once.)

- [ ] **Step 2: Add the renderer immediately after `window.handleFileSelect` (after line 1187)**

It goes here because it is the other half of that function: the renderer emits the notice element, `handleFileSelect` turns it green.

```js
// Kotak muat naik bukti — satu renderer untuk SEMUA jenis cuti yang perlukan
// dokumen (MC / Ehsan / Kecemasan / CME). Isi kandungan datang dari LEAVE_PROOF
// dalam leaveTypes.js; jangan tambah blok HTML baharu untuk jenis cuti baharu.
// Pulangkan '' jika jenis cuti itu tidak perlukan bukti.
function renderProofSection(code) {
  const need = proofRequirement(code);
  if (!need) return '';
  const stem = need.inputId.replace('-upload', '');   // 'mc-upload' → 'mc'
  const rgb = hexToRgbTriple(need.boxColor);
  return `
            <div style="margin-bottom:1.5rem;">
              <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.85rem;">
                <div style="width:4px;height:18px;border-radius:2px;background:linear-gradient(to bottom,${need.barFrom},${need.barTo});"></div>
                <span style="font-size:0.72rem;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);">${need.title}</span>
                <span style="font-size:0.65rem;background:rgba(239,68,68,0.12);color:#ef4444;border:1px solid rgba(239,68,68,0.2);border-radius:6px;padding:0.15rem 0.5rem;font-weight:700;">★ WAJIB</span>
              </div>
              <div style="padding:1rem;border-radius:12px;border:1.5px dashed rgba(${rgb},0.3);background:rgba(${rgb},0.03);">
                <div style="font-size:0.75rem;font-weight:600;color:var(--text-muted);margin-bottom:0.75rem;">${need.hint}</div>
                <div style="display:flex;align-items:center;gap:0.75rem;">
                  <input type="file" id="${need.inputId}" accept="image/jpeg,image/png,image/jpg,application/pdf" style="display:none;" onchange="window.handleFileSelect(this, '${stem}-filename', '${stem}-notice')">
                  <button type="button" onclick="document.getElementById('${need.inputId}').click()" style="padding:0.55rem 1rem;border-radius:8px;border:1px solid rgba(${rgb},0.3);background:rgba(${rgb},0.1);color:${need.boxColor};font-size:0.75rem;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:0.4rem;white-space:nowrap;">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                    ${need.buttonLabel}
                  </button>
                  <span id="${stem}-filename" style="font-size:0.72rem;color:var(--text-muted);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">Tiada fail dipilih</span>
                </div>
                <div id="${stem}-notice" style="margin-top:0.75rem;padding:0.6rem 0.85rem;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.18);border-radius:8px;font-size:0.72rem;color:#ef4444;display:flex;align-items:center;gap:0.5rem;font-weight:700;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12.01" y2="8"/><line x1="12" y1="12" x2="12" y2="16"/></svg>
                  ${need.notice}
                </div>
              </div>
            </div>`;
}
```

- [ ] **Step 3: Replace the three blocks at `src/main.js:6348-6404` with one call**

Delete everything from `${isMC ? \`` on line 6348 through the closing `` ` : ''}`` on line 6404 — that is the MC block, the `isEhsan` block, and the `isEMG` block, including the blank lines between them. Put this in their place:

```
            ${renderProofSection(selectedLeaveType)}
```

**Do not touch the other `isMC` block at line 6276** — that is the "MC goes straight to HR/HOD" info banner, unrelated to uploads.

- [ ] **Step 4: Delete the two now-unused flags**

At `src/main.js:6105` and `:6107`, remove:

```js
      const isEhsan = selectedLeaveType === 'EL';
      const isEMG = selectedLeaveType === 'EL_EMG';
```

Keep `const isMC` on line 6104 — line 6276 still uses it.

- [ ] **Step 5: Verify no orphan references remain**

Run: `grep -n "isEhsan\|isEMG" src/main.js`
Expected: no output. If anything prints, a reference was missed — fix it before continuing.

Run: `npm run build`
Expected: build succeeds. This is the only automated check available for `main.js`; it catches template-literal and syntax breakage, which is the realistic failure mode when deleting 57 lines of nested backticks.

- [ ] **Step 6: Check the four boxes render**

Run: `npm run dev`, log in, open Mohon Cuti, and select each of MC, Cuti Ehsan, Cuti Kecemasan and (as a doctor) Latihan CME.

Expected for all four: section header bar in the type's colour, "★ WAJIB" chip, dashed box, "PILIH FAIL…" button, "Tiada fail dipilih", and a red notice bar. Pick a file → filename appears and the bar turns green with "DOKUMEN TELAH DIMUAT NAIK - SEDIA UNTUK DIHANTAR".

Expected for AL / UP / HL / ML / ML_PL / RL: no upload box at all.

- [ ] **Step 7: Commit**

```bash
git add src/main.js
git commit -m "refactor(leave): render every proof upload box from one template

Three near-identical blocks become one renderProofSection() driven by
LEAVE_PROOF. Cuti Ehsan and Cuti Kecemasan gain the red 'belum dimuat naik'
notice bar that only MC had, and Ehsan gains the section header the other
two already had. The CME box now renders but is not yet enforced.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Enforce and upload

This is the task that delivers the actual requirement. Both call sites are in the submit handler.

**Files:**
- Modify: `src/main.js:4857-4876` (validation), `src/main.js:4920-4924` (input picker)

**Interfaces:**
- Consumes: `proofRequirement` (imported in Task 2), and the `inputId` values the Task 2 renderer put in the DOM

- [ ] **Step 1: Replace the validation chain at `src/main.js:4857-4876`**

Delete the whole `// Mandatory File Validations` block — the `if (selectedLeaveType === 'MC')` / `else if (EL_EMG)` / `else if (EL)` chain — and replace with:

```js
      // Bukti wajib — jenis cuti yang perlukan dokumen disenaraikan dalam
      // LEAVE_PROOF (leaveTypes.js). Termasuk CME: tanpa surat jemputan /
      // slip pendaftaran, permohonan tidak boleh dihantar.
      const _proofNeed = proofRequirement(selectedLeaveType);
      if (_proofNeed) {
          const _inp = document.getElementById(_proofNeed.inputId);
          if (!_inp || _inp.files.length === 0) {
              alert(_proofNeed.error);
              return;
          }
      }
```

- [ ] **Step 2: Replace the input picker at `src/main.js:4920-4924`**

Change:

```js
      let proofUrl = null, proofName = null;
      const _proofInput = selectedLeaveType === 'MC'     ? document.getElementById('mc-upload')
                        : selectedLeaveType === 'EL_EMG' ? document.getElementById('emg-upload')
                        : selectedLeaveType === 'EL'     ? document.getElementById('ehsan-upload')
                        : null;
```

to:

```js
      let proofUrl = null, proofName = null;
      const _proofInput = _proofNeed ? document.getElementById(_proofNeed.inputId) : null;
```

`_proofNeed` is in scope — Step 1 declared it earlier in the same handler. Leave the `if (_proofInput && _proofInput.files.length > 0) { … }` upload body below it completely unchanged; CME inherits the Cloudinary upload and its abort-on-failure guard for free.

Also update the comment on the line above `let proofUrl` (currently reads "Muat naik fail bukti (MC / Kecemasan / Ehsan)") to "(MC / Kecemasan / Ehsan / CME)".

- [ ] **Step 3: Verify no orphan references remain**

Run: `grep -n "'mc-upload'\|'emg-upload'\|'ehsan-upload'" src/main.js`
Expected: no output — all three literals now live only in `leaveTypes.js`.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Test the block and the upload**

Run `npm run dev` and, logged in as a doctor:

1. Mohon Cuti → Latihan CME → fill dates and reason → Hantar **without** a file.
   Expected: alert "🔴 WAJIB: Sila muat naik surat jemputan atau slip pendaftaran program CME…" and the form does **not** submit.
2. Attach a JPG → Hantar. Expected: submits. In Firestore, the new `leaves` doc has `proofUrl` (a `res.cloudinary.com` URL) and `proofName`.
3. Repeat with a PDF. Expected: same.
4. Regression: repeat step 1 for MC, Cuti Ehsan and Cuti Kecemasan — each must still block with its own original wording, and still upload when a file is attached.
5. Regression: apply AL with no file. Expected: submits normally, `proofUrl: null`.

- [ ] **Step 5: Commit**

```bash
git add src/main.js
git commit -m "feat(leave): require proof before a CME application can be submitted

main.js:4908 already said CME 'tetap perlu pelulus + bukti' — the notice
exemption was built, the proof half never was. Both the submit block and the
Cloudinary upload picker now read LEAVE_PROOF, so CME is enforced and its
file is stored on the record like every other proof type.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Let HR backfill proof on existing CME records

The last hardcoded copy. Without this, CME leave already in Firestore has no proof and no way to attach one.

**Files:**
- Modify: `src/main.js:7648` (Master Logs actions cell)

**Interfaces:**
- Consumes: `PROOF_REQUIRED_TYPES` (imported in Task 2)

- [ ] **Step 1: Replace the hardcoded array**

On `src/main.js:7648`, change:

```js
${['MC','EL','EL_EMG'].includes(r.type) && ['admin','hr','super_admin'].includes(user.role) ? `<button onclick="window.reuploadProof(${r.id})"
```

to:

```js
${PROOF_REQUIRED_TYPES.includes(r.type) && ['admin','hr','super_admin'].includes(user.role) ? `<button onclick="window.reuploadProof(${r.id})"
```

Leave the role array alone — that is a permission list, not a leave-type list.

- [ ] **Step 2: Update the stale comment on `window.reuploadProof`**

At `src/main.js:1190`, the comment reads "(MC / Cuti Kecemasan / Cuti Ehsan)". Change to "(lihat LEAVE_PROOF — MC / Kecemasan / Ehsan / CME)".

- [ ] **Step 3: Verify the last copy is gone**

Run: `grep -n "'MC','EL','EL_EMG'\|'MC', 'EL', 'EL_EMG'" src/main.js`
Expected: no output.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Test in Master Logs**

Log in as HR or super_admin, open Master Logs, find an **existing** CME record (one applied before this change, so it has no proof).

Expected: the amber upload button now appears on its row, titled "Muat Naik Bukti (JPG/PNG/PDF, maks 10MB)". Click it, pick a file. Expected: "✅ Bukti berjaya dimuat naik & disimpan", and the green document icon appears on that row. Click the icon → the file opens in a new tab.

- [ ] **Step 5: Full test suite and commit**

Run: `node --test tests/leaveTypes.test.mjs`
Expected: PASS, 21 tests, 0 fail

```bash
git add src/main.js
git commit -m "feat(leave): let HR attach proof to existing CME records

Master Logs' re-upload button now reads PROOF_REQUIRED_TYPES instead of its
own hardcoded list, so CME leave applied before proof was mandatory can be
backfilled rather than left without evidence. Last of the four copies.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Post-deploy verification

**Clear the service worker cache first.** A stale SW has hidden deploys on this project before — if CME still submits without a file after deploy, suspect the cache before re-reading the code.

Then walk the manual checks from spec §Testing on the live site: CME blocks without a file, uploads with one, the approver's card shows "📎 Lihat Bukti" (no code change was needed there — `src/main.js:7210` already renders it for any record with a `proofUrl`), and MC / Ehsan / Kecemasan are unchanged apart from their new notice bars.
