# Design: Split HOD role + rename PIC HOD → Doctor PIC

**Date:** 2026-06-08
**App:** KSB Leave Apply (`src/main.js`, Firebase project `apply-leave-89ebb`)
**Status:** Approved (design); pending implementation plan

## Context

Today there is a single `hod` role that both **oversees a branch** and **approves
leave (P1)**. There is also a `pic_hod` role (another branch P1 approver). The
clinic wants to separate "oversight" from "approval authority", and to give the
branch approvers a name that reflects reality (they are doctors-in-charge).

Approval routing is driven by `getStaffGroup()` → a group key → `approvalRouting`
config (flags `p1_hod` / `p1_pic_hod` / `p1_supervisor` / `needs_p2`). RBAC
permissions live in `rbacMatrix` keyed by role. Roles are listed in `CORE_ROLES`
and labelled in `staffConfig.roleLabels`. Both RBAC and routing are also persisted
in Firestore (`settings/rbac`, `config/approvalRouting`) which **override** code
defaults on load.

## Goals

1. Rename role key `pic_hod` → `doctor_pic` ("Doctor PIC") — the branch P1 approver.
2. Rename role key `hod` → `hod_cawangan` ("HOD Cawangan") — **view-only**, no leave approval.
3. Add a new role `hod_balok` ("HOD Balok") — P1 approver for Balok HQ admin staff
   (and any other groups enabled later via the routing matrix).
4. Migrate existing Firestore staff records to the new role keys.

Non-goals: changing P2 (HR) behaviour, the Supervisor/Balok flows, doctor-Pahang
routing, or the MC flow.

## Roles (final)

| Old key | New key | Label | Approves leave? |
|---|---|---|---|
| `pic_hod` | `doctor_pic` | Doctor PIC | Yes — branch P1 |
| `hod` | `hod_cawangan` | HOD Cawangan | **No** — monitor only |
| *(new)* | `hod_balok` | HOD Balok | Yes — P1 (Balok HQ) |

### Permissions (`rbacMatrix`)
- **`hod_cawangan`** — copy of current `hod` permissions but `manage_pending: false`
  (cannot approve). Keeps `dashboard:'branch'`, `branch_analisa:true`,
  `manage_reports:true`, `report_own_branch_only:true`, `manage_holidays:true`,
  `can_cancel` etc. (own-branch view, like a branch monitor).
- **`doctor_pic`** — identical to current `pic_hod` permissions (P1 approver,
  `manage_pending:true`). Key + label change only.
- **`hod_balok`** — based on a branch approver: `dashboard:'branch'`,
  `manage_pending:true`, `manage_reports:true`, branch-scoped view for Balok HQ.

## Approval routing

### Routing matrix columns (`approvalRouting` flags + UI)
- Remove `p1_hod` (HOD no longer approves).
- Rename `p1_pic_hod` → `p1_doctor_pic` (label "Doctor PIC").
- Add `p1_hod_balok` (label "HOD Balok").
- Keep `needs_tl`, `p1_supervisor`, `needs_p2`.

### Groups & defaults (`ROUTING_DEFAULTS` + `getStaffGroup`)
| Group | P1 approver (new) | needs_p2 |
|---|---|---|
| `pahang_lain` (non-Balok admin + Bentong/MCKIP doctors) | Doctor PIC | true |
| `admin_balok` **(new)** — Admin Staff at Balok HQ | **HOD Balok** | true |
| `terengganu` | **Doctor PIC only** (was HOD+PIC) | false |
| `doctor_pahang` | Supervisor Balok *(unchanged)* | true |
| `operation_balok` | TL → Supervisor *(unchanged)* | true |
| `xray_sono_balok` | Supervisor Balok *(unchanged)* | true |
| `juru_audio_balok` | **HOD Balok** (was HOD) | true |

`getStaffGroup()` gains a rule: **Admin Staff at "Klinik Syed Badaruddin Balok (HQ)"
→ `admin_balok`** (checked before the `pahang_lain` fallback; after the
operation/paramedic Balok checks). `juru_audio_balok` keeps its group but its
default flips to `p1_hod_balok`.

"Other staff later" = the admin toggles the **HOD Balok** column on for any group
in the routing matrix; no code change needed.

## Code touch-points (for the plan)
- `rbacMatrix`: rename `pic_hod`→`doctor_pic`, `hod`→`hod_cawangan` (set
  `manage_pending:false`), add `hod_balok`.
- `CORE_ROLES`, `staffConfig.roleLabels`: update keys + labels.
- `ROUTING_DEFAULTS`: rename/add flags, add `admin_balok`, flip `juru_audio_balok`,
  set `terengganu` to doctor_pic only.
- `getStaffGroup()`: add `admin_balok` rule.
- `getRoutingP1Approvers()`: map `p1_doctor_pic`→`doctor_pic`, `p1_hod_balok`→
  `hod_balok` (branch = Balok HQ), drop `p1_hod`.
- `canManageRequest()`: approver role set becomes `['doctor_pic','hod_balok','supervisor']`
  (HOD removed); `isP1` flag mapping updated.
- Routing matrix UI (3 tables + `getP1Label` + column/row defs): relabel columns,
  add HOD Balok, add `admin_balok` row.
- Leave-form approver dropdown role labels (`rl` map) + step-flow text (the
  `isDoctor`/branch block) referencing HOD/PIC.
- `waNotifRbac` default role arrays referencing `hod`/`pic_hod` (review).
- **Firestore migration script**: `staff` docs `role:'pic_hod'`→`'doctor_pic'`,
  `role:'hod'`→`'hod_cawangan'`. Also reconcile saved `settings/rbac` and
  `config/approvalRouting` to the new keys (or re-save from code defaults).

## Migration & rollout
1. Ship code with new roles/keys.
2. Run one-off Firestore migration: staff role remap (above) + update
   `settings/rbac` and `config/approvalRouting` to new keys.
3. Admin assigns the specific Balok HQ approver person(s) to `hod_balok` via Urus
   Staf. Existing HODs are now `hod_cawangan` (view-only) automatically.

## Risks
- **Key rename is broad**: every code reference to `'pic_hod'`/`'hod'` and routing
  flags must change together, plus a data migration; a missed reference silently
  breaks approval. Mitigate with a full grep sweep + verify in the running app.
- Saved Firestore config overriding code defaults (known gotcha) — must remap the
  saved docs, not just code.

## Out of scope
P2/HR logic, Supervisor/Balok operation flow, doctor-Pahang routing, MC flow.
