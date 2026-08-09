# HOD Cawangan — branch-scoped leave editing

**Date:** 2026-08-09
**Status:** design approved, awaiting implementation plan

## Problem

NURUL AIN BINTI MOHD FAUZI (`900701115518`) is HOD Cawangan for Klinik Rakyat dan X-Ray Dungun. She could not edit leave for staff at her own branch: the Save button appeared and every save failed with a permissions error.

The cause is that this app has **two permission stores that nothing keeps in sync**:

| Store | Decides | Value for `hod_cawangan` |
|---|---|---|
| `settings/rbac` | which buttons and tabs the UI renders | `manage_staff: true` (switched on in the Access Control screen) |
| `config/rolePermissions` | the `canApprove` / `manageStaff` custom claims that `firestore.rules` enforces | `manageStaff: false` |

`src/main.js` never reads or writes `config/rolePermissions`, so toggling Access Control revealed the UI without granting the right. The failure surfaced as a Firestore permission error, which reads like a broken app rather than a permission problem.

An interim fix on 2026-08-09 set `config/rolePermissions.hod_cawangan.manageStaff = true`. That worked but was **too broad**: `manageStaff` is a global boolean, so it also allowed writes to staff at every other branch, plus `config/*`, `settings/*`, `system_config/*` and staff deletes. It has since been revoked (both HOD Cawangan accounts re-provisioned back to `manageStaff: false`), which returns the accounts to a safe state and restores the original symptom until this design lands.

## Goal

A HOD Cawangan can edit leave data for staff **of their own branch only**, enforced server-side.

## Non-goals

- HOD Cawangan does **not** join the approval chain. Leave applications continue to route Staff → Doctor PIC → HR. Klinik Rakyat Dungun already has two Doctor PIC approvers (NORSYAHIDA, SUZIYANA) and they keep that role.
- No change to `config/approvalRouting` or `getRoutingP1Approvers`.
- No ability to edit staff identity or standing: role, branch, category, active status, password, phone, start date stay HR/Admin-only.

## Key decision: enforce in rules, not in claims

A custom claim cannot express "only my branch" — it is one global boolean baked into the token. But **security rules can read the caller's own staff document** and compare branches. That pattern already exists in this file: the `config/publicHolidays` rule reads `role` straight off `staff/{myIC()}`.

So the grant moves out of the claim and into the rule. Two consequences worth stating:

- `hod_cawangan` keeps `manageStaff: false`. Nothing to re-provision when the design lands.
- A later role change takes effect on the next write, with no provisioning step — the same property the `publicHolidays` rule was written for, and it matters because `onStaffWrite` is not deployed.

Cost: one extra document read per HOD write. The project is on Spark and quota has bitten before, but this fires only when a HOD saves, which is rare. The existing rules already accept this trade-off.

### Shared rule helpers

```
function selfStaff() {
  return get(/databases/$(database)/documents/staff/$(myIC())).data;
}
function isBranchHodOf(branch) {
  return signedIn()
    && exists(/databases/$(database)/documents/staff/$(myIC()))
    && selfStaff().role == 'hod_cawangan'
    && selfStaff().branch == branch;
}
```

## Design

### 1. `staff/{ic}` — leave fields only, own branch only

Added as a third OR-branch alongside the existing `manageStaff()` and self-edit grants:

```
|| ( isBranchHodOf(resource.data.branch)
     && myIC() != ic
     && request.resource.data.diff(resource.data).affectedKeys().hasOnly(HOD_LEAVE_FIELDS) )
```

`HOD_LEAVE_FIELDS` (22 keys) — entitlements plus the Formula B buckets:

```
ent_AL, ent_MC, ent_EL, ent_EL_EMG, ent_HL, ent_ML, ent_PL, ent_CF, ent_UP, ent_CME
al_used_pre,      mc_used_pre,      el_used_pre,      cme_used_pre
al_used_sys_adj,  mc_used_sys_adj,  el_used_sys_adj,  cme_used_sys_adj
al_pelarasan,     mc_pelarasan,     el_pelarasan,     cme_pelarasan
```

The entitlement list mirrors the `leaveTypes` array in the edit modal (`main.js`); the Formula B list is `FORMULA_B_TYPES` (`AL`, `MC`, `EL`, `CME`) lowercased and crossed with the three suffixes.

`hasOnly(...)` is what blocks privilege escalation: `role` and `branch` are not on the list, so a HOD cannot promote anyone, cannot move staff between branches, and cannot deactivate or re-password an account.

`myIC() != ic` stops a HOD editing their **own** balance. HR retains that.

### 2. `leaves/{id}` — correct and cancel, never approve

```
|| ( isBranchHodOf(resource.data.branch)
     && resource.data.ic != myIC()
     && request.resource.data.status in ['PENDING', 'CANCELLED']
     && request.resource.data.ic == resource.data.ic
     && request.resource.data.branch == resource.data.branch
     && request.resource.data.diff(resource.data).affectedKeys()
          .hasOnly(['startDate', 'endDate', 'reason', 'days', 'status', 'type']) )
```

The status allowlist is what enforces the non-goal above. Correcting a record resets it to `PENDING` for re-endorsement (the path non-admin editors already take in `main.js`), and cancelling writes `CANCELLED`. Writing `APPROVED` is rejected by the rules, so a HOD cannot approve even if a future UI change offered the button.

`resource.data.ic != myIC()` keeps separation of duties, matching the existing `canManageRequest` check.

Delete stays `canApprove()`-only. Cancelling is a status update, not a delete, so nothing needs to change there.

### 3. Client (`src/main.js`)

The client is UX, not security — the rules above stand alone. These changes stop the UI offering actions that would be rejected:

- **Staff list** in Management filters to the caller's own branch when `role === 'hod_cawangan'`.
- **Edit Staff modal** renders only the leave blocks for this role. Not rendered: role, branch, category, status, phone, password, start date, **`apply_prorate` and `leaveAsAdmin`** — the last two are easy to miss because they sit near the leave settings, but they are not in `HOD_LEAVE_FIELDS`, so leaving either control in place would make every HOD save fail `hasOnly`. The submit handler builds `updates` from whichever DOM elements exist (`if (branchSelect) …`), so not rendering a control already excludes its key from the write — the client then matches `HOD_LEAVE_FIELDS` exactly, with no second allowlist to drift out of sync.
- **Add / delete staff** buttons hidden for this role.
- **New helper `canCorrectBranchLeave(user, req)`** — true when `user.role === 'hod_cawangan'`, `req.branch === user.branch`, and `req.ic !== user.ic`. Used to show the Edit Cuti and Batal buttons and to gate their handlers.

`hod_cawangan` is deliberately **not** added to `canManageRequest()`. That function also drives the approve/reject controls, so widening it would quietly make the HOD an approver — exactly the non-goal.

`settings/rbac.hod_cawangan.manage_staff` stays `true`, and the code default in `window.rbacMatrix` stays aligned with it, so the two permission stores no longer disagree for this role.

### 4. Tests

`tests/rules.test.mjs` runs against the Firestore emulator (`firebase emulators:exec --only firestore "node --test tests/rules.test.mjs"`; needs the JDK PATH prefix). New cases:

| Case | Expected |
|---|---|
| HOD edits `ent_AL` for staff at own branch | succeeds |
| HOD edits `ent_AL` for staff at another branch | fails |
| HOD changes `role` on an own-branch staff doc | fails |
| HOD changes `branch` on an own-branch staff doc | fails |
| HOD edits their own balance | fails |
| HOD corrects dates on own-branch leave, status `PENDING` | succeeds |
| HOD cancels own-branch leave (`CANCELLED`) | succeeds |
| HOD sets own-branch leave to `APPROVED` | fails |
| HOD edits a leave at another branch | fails |
| HOD edits their own leave record | fails |
| Plain `staff` role attempts any of the above | fails |

The seed data in `beforeEach` needs a `hod_cawangan` staff doc at "Klinik A" and a second branch to test the negative cases.

## Scope of effect

This is keyed on role, not on person, so **KHAIRANI BINTI KASIM@ABDUL GHAFAR** (`780416115136`, HOD Cawangan, Klinik Syed Badaruddin Paka) gains the same rights over her own branch. Confirmed as intended.

## Risks

- **Extra reads.** One `get` per HOD write, on a Spark quota that has been exhausted before. Low volume; precedent exists.
- **Two stores still desync in general.** This design fixes `hod_cawangan` but the underlying trap remains: the Access Control screen can still grant any other role a permission the claims do not back, with no warning. Worth addressing separately — out of scope here.
- **Token lag.** The revoked `manageStaff` claim persists in already-issued ID tokens for up to an hour, or until the user signs in again.
