# Leave Proof Storage & Viewing — Design

**Date:** 2026-06-11
**Status:** Approved

## Problem

When staff submit MC, Cuti Ehsan (EL), or Cuti Kecemasan (EL_EMG), the form requires
a proof file (image/PDF) to be *selected* — but the file is only validated for presence
(`files.length === 0`) and then discarded. It is never uploaded to Firebase Storage and
never stored on the leave record (`newRecord` has no proof field). Result: HR/approvers
have nowhere to view the proof; it is lost on submit.

## Goal

Actually persist the proof and let HR view it later from the **Master Logs** table, as a
permanent reference. Approval-card display is explicitly out of scope.

## Design

### 1. Upload on submit (`src/main.js`, submit handler ~line 4580)
After all validations pass and before building `newRecord`, upload the selected proof file
to Firebase Storage using the same pattern as messenger (`uploadBytes` + `getDownloadURL`):
- Applies to leave types `MC`, `EL`, `EL_EMG` only.
- Path: `leave-proofs/{ic}/{timestamp}_{filename}`.
- On upload failure: alert the user and abort submit (proof is mandatory for these types).

### 2. Store reference on the leave record
Add `proofUrl` and `proofName` to `newRecord`. Older records lack these fields; the UI only
renders the link when `proofUrl` is present.

### 3. View in Master Logs (`src/main.js` ~line 7164, Actions column)
Add a "Lihat Bukti" icon link in each row's Actions cell, shown only when `r.proofUrl`
exists. Opens the file in a new tab (`target="_blank"`). The Master Logs tab is already
gated by the `manage_audit` permission, so only HR/management can see it.

## Out of scope (YAGNI)
- No attachment in the printed PDF.
- No proof for other leave types.
- No in-app thumbnail/preview — a new-tab link only.

## Risk to verify
No `storage.rules` exists in the repo (rules are console-managed). Messenger uploads work,
so authenticated writes are allowed, but the rules may be scoped to specific paths. After
deploy, test a real upload to `leave-proofs/**`; if it fails with a permission error, add
and deploy a `storage.rules` that permits authenticated access to this path.
