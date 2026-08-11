# Cuti CME — bukti wajib sebelum boleh dipohon

**Date:** 2026-08-11
**Status:** design approved, awaiting implementation plan

## Problem

A doctor can apply for Latihan CME (`CME`, 5 days' entitlement, doctors only) and have it approved without ever showing that a CME programme exists. Nothing in the apply form asks for a document, and nothing on the record proves the leave was earned.

The intent was already written down. `src/main.js:4908` reads:

> Cuti tak boleh dirancang (MC sakit, Kecemasan, Ehsan/kematian) + CME dan Cuti Ganti (dituntut selepas mesyuarat) dikecualikan dari polisi notis awal (3/7 hari) — tetapi tetap perlu pelulus + **bukti**.

The exemption from the notice policy was built; the "tetapi tetap perlu bukti" half never was. This closes that gap.

## Goal

Applying for CME requires a proof file (JPG / PNG / PDF). No file, no application — the same hard block MC, Cuti Ehsan and Cuti Kecemasan already have.

The document is the **surat jemputan / slip pendaftaran** for the programme, because CME is applied for *before* attending. The hint text and the rejection alert both name that document, so a blocked doctor knows what to go and find.

## Non-goals

- **Cuti Ganti (RL) is deliberately excluded.** It is the other doctors-only, claimed-after-the-fact type, and the same argument would apply, but it was not asked for and changing it would change how doctors use RL today. The design makes adding it later a six-line data entry.
- **CME stays exempt from the 3/7-day notice policy.** A CME invitation can arrive at short notice; requiring both proof and advance notice would make the type nearly unusable.
- No change to CME's entitlement (5), its doctors-only visibility, or its membership in `FORMULA_B_TYPES`.
- No change to the upload mechanism: Cloudinary unsigned upload, folder `leave-proofs/{ic}`, 10 MB cap, `accept="image/jpeg,image/png,image/jpg,application/pdf"`.
- No `firestore.rules` change — see [Limitation](#limitation).

## Current state

Three types require proof. The rule is spelled out separately in four places, and no two of them are written the same way:

| `src/main.js` | What it does | How it names the types |
|---|---|---|
| ~4857 | Blocks submit when no file is chosen | `if / else if` chain, one branch per type |
| ~4921 | Picks which `<input>` to read the file from | three-branch ternary |
| ~6348–6404 | Renders the upload UI | three near-identical HTML blocks behind `isMC` / `isEhsan` / `isEMG` |
| ~7648 | Shows HR's re-upload button in Master Logs | `['MC','EL','EL_EMG'].includes(r.type)` |

Adding CME by hand means a fifth place that has to agree with the other four. This codebase has been bitten by exactly that before — see the RBAC-table and `ROUTES_AS_PAHANG` notes — so the list becomes data instead.

## Design

### 1. `LEAVE_PROOF` in `src/leaveTypes.js`

`src/leaveTypes.js` already declares itself the single source of truth for what a leave type *is*, and imports neither Firebase nor the DOM, so it is unit-testable. The proof rule joins it as a frozen map — one entry per type that requires proof, holding everything all four call sites need:

```js
export const LEAVE_PROOF = Object.freeze({
  MC: {
    inputId: 'mc-upload',
    title: 'Dokumen Wajib',
    hint: 'Sila muat naik MC yang dikeluarkan oleh doktor',
    buttonLabel: 'PILIH FAIL MC',
    accent: '#10b981', accentTo: '#3b82f6',
    notice: 'MC BELUM DIMUAT NAIK — WAJIB SEBELUM HANTAR',
    error: '🔴 WAJIB: Sila muat naik Sijil Sakit (MC) yang dikeluarkan oleh doktor sebelum menghantar permohonan.\n\nFormat yang diterima: Gambar (JPG/PNG) atau PDF.',
  },
  EL:     { /* Surat Kematian — existing copy preserved */ },
  EL_EMG: { /* Bukti Kecemasan — existing copy preserved */ },
  CME: {
    inputId: 'cme-upload',
    title: 'Bukti CME',
    hint: 'Sila muat naik surat jemputan / slip pendaftaran program CME',
    buttonLabel: 'PILIH FAIL BUKTI CME',
    accent: '#8b5cf6',
    notice: 'BUKTI CME BELUM DIMUAT NAIK — WAJIB SEBELUM HANTAR',
    error: '🔴 WAJIB: Sila muat naik surat jemputan atau slip pendaftaran program CME sebelum menghantar permohonan.\n\nFormat yang diterima: Gambar (JPG/PNG) atau PDF.',
  },
});

export const PROOF_REQUIRED_TYPES = Object.freeze(Object.keys(LEAVE_PROOF));
export function proofRequirement(code) { return LEAVE_PROOF[code] || null; }
```

`accent` is single-colour; `accentTo` is optional and only present where the existing UI draws a two-stop gradient on the section bar. CME's `#8b5cf6` is the colour already assigned to CME in `LEAVE_CATEGORIES`, so the upload box matches its leave-type card.

The existing MC / EL / EL_EMG wording moves across **verbatim**. This step changes where the strings live, not what they say.

### 2. The four call sites become lookups

```
4857  const need = proofRequirement(selectedLeaveType);
      if (need && !hasFile(need.inputId)) { alert(need.error); return; }

4921  const _proofInput = need ? document.getElementById(need.inputId) : null;

6348  ${renderProofSection(selectedLeaveType)}     // '' when the type needs no proof

7648  ${PROOF_REQUIRED_TYPES.includes(r.type) && ['admin','hr','super_admin'].includes(user.role) ? …}
```

`renderProofSection(code)` is a new local helper in `src/main.js` (it emits inline-styled HTML, so it belongs with the other renderers rather than in `leaveTypes.js`). It returns the empty string when `proofRequirement(code)` is null, which is what makes the three `isMC` / `isEhsan` / `isEMG` flags and their conditional blocks disappear. `isEhsan` and `isEMG` are used nowhere else and are deleted; `isMC` has other uses in the form and stays.

The Master Logs change means HR's "Muat Naik Bukti" button appears on **existing** CME records too, so the CME leave already in Firestore without proof can be backfilled rather than left stranded.

### 3. Consequences for the three existing types

Rendering all four from one template makes the existing three consistent, which is a visible change to two of them:

- **Cuti Ehsan and Cuti Kecemasan gain the red "BELUM DIMUAT NAIK — WAJIB SEBELUM HANTAR" bar** that only MC has today. No new behaviour is needed: `window.handleFileSelect(input, displayId, noticeId)` already turns that bar green and rewrites it to "DOKUMEN TELAH DIMUAT NAIK - SEDIA UNTUK DIHANTAR" when a file is picked (`src/main.js:1177`). Today Ehsan and EMG simply never pass the third argument. The shared renderer always passes it.
- **Cuti Ehsan gains the section header and ★ WAJIB chip** that MC and Kecemasan already have. Its current flatter layout is the odd one out.
- **MC is unchanged** — it is the template the other three converge on.

### 4. Data flow

Unchanged from the existing types, and CME inherits all of it:

1. Doctor picks CME → `renderProofSection('CME')` emits the upload box.
2. File chosen → `handleFileSelect` enforces the 10 MB cap, shows the filename, flips the notice green.
3. Submit → validation at 4857 blocks if no file.
4. Upload at 4921 → Cloudinary `auto/upload`, folder `leave-proofs/{ic}`.
5. `secure_url` and filename saved on the leave record as `proofUrl` / `proofName` (4974).
6. Approvers see "📎 Lihat Bukti" on the approval card — **already unconditional on `req.proofUrl` at `src/main.js:7210`, so no work is needed there**. HR sees the same link in Master Logs.

### 5. Error handling

- **No file chosen** → the type's own `error` alert, submit aborted. CME's names the invitation letter and registration slip specifically.
- **Cloudinary upload fails** → existing alert at 4946, submit aborted. Because the input picker at 4921 is now data-driven, CME inherits this abort automatically: a CME record can never be written with the proof silently dropped.
- **File over 10 MB** → `handleFileSelect` rejects it and clears the input before submit is ever reached.

### 6. Limitation

Validation is client-side only. `firestore.rules` does not require `proofUrl` on a leave write, so a determined user with devtools could still create a CME record without one.

This is the same posture MC, Cuti Ehsan and Cuti Kecemasan have had since the proof feature shipped in June 2026, and it is accepted here rather than overlooked. A rules check could only assert that a string is present — it cannot verify the file is a real CME invitation, which is what the approver's review is for. Tightening rules for all four types at once is a reasonable future change; doing it for CME alone would be inconsistent for no gain.

## Testing

**Unit — `tests/leaveTypes.test.mjs`:**

- `CME` is present in `LEAVE_PROOF`, and `RL` is asserted **absent** with a comment marking that as deliberate, so nobody "fixes" it by accident.
- Every `LEAVE_PROOF` key is a real id in `LEAVE_CATEGORIES` — a typo'd code cannot silently create a rule that never fires.
- Every entry has `inputId`, `title`, `hint`, `buttonLabel`, `accent`, `notice` and `error` non-empty — a half-added type fails the suite rather than rendering a broken box.
- `inputId` values are unique; the map is frozen against mutation by a caller.

**Manual, after deploy** (clear the service worker cache first — stale SW has masked deploys here before):

1. As a doctor, apply CME with no file → blocked, alert names the invitation letter.
2. Attach a JPG, then a PDF → both upload; record carries `proofUrl` / `proofName`.
3. Approver's card shows "📎 Lihat Bukti"; the link opens.
4. Master Logs shows the proof icon, and shows HR's re-upload button on an **old** CME record that has no proof.
5. Regression: MC, Cuti Ehsan and Cuti Kecemasan still block without a file, still upload, and all three now show the red notice bar that turns green on selection.
