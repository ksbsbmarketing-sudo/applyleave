# Firebase Auth Migration & Role Enforcement — Design

**Date:** 2026-06-09
**Status:** Approved design, pending spec review
**App:** KSB Leave Apply (Vite + Firebase PWA)

## Problem

Firestore security rules currently only require *any* authenticated session
(`allow read, write: if request.auth != null`). Login is performed entirely in
the browser — the app reads the whole `staff` collection, matches IC + password
in JavaScript, and stores the logged-in IC in `localStorage`. Firebase itself
only issues an **anonymous** sign-in token, which carries no identity and no
role. Consequences:

- Any authenticated (even anonymous) client can read every collection,
  including staff `password` fields stored in plaintext.
- Rules cannot enforce *who* may approve leave or *whose* leave a user may edit,
  because the token has no role and no identity. All approval gating is
  client-side only and therefore bypassable from the browser console.

Goal: move identity into Firebase Auth so rules can enforce roles. Specifically:

- **Staff** may edit *their own* leave's **date and reason**; doing so restarts
  the approval chain (re-approval).
- **Approval / status changes** are restricted to approver roles (Team Leader,
  Supervisor, HOD Balok, Doctor PIC, HR, Admin, Super Admin).

## Decisions (from brainstorming)

1. **Approach:** Migrate to real Firebase Auth + custom claims (the only way to
   enforce roles server-side).
2. **Claims sync:** Automatic, via a Cloud Function (project upgraded to Blaze).
3. **Login identity:** Hidden IC-based email `{ic}@ksb-leave.local`. Login UX is
   unchanged — staff still pick branch/name and type their password; they never
   see or type the email. Email addresses remain valid for possible future
   email notifications (out of scope now).
4. **Self-edit window:** Editing date/reason **resets the leave to `PENDING`**
   and restarts the approval chain (safest for integrity).
5. **Edit confirmation:** Before saving any staff edit, the app shows a
   before→after diff of exactly what changed plus a warning that approval
   restarts; the staff must confirm.
6. **Master password:** Remove the hardcoded `'superpassword'` backdoor
   (main.js:3343). Replace with a dedicated **super_admin "IT" break-glass
   account** (real Firebase Auth credentials, full claims) for the IT manager to
   set up/recover the system.

## Architecture

Five moving parts.

### 1. Firebase Auth (Email/Password + Anonymous)

- Enable the **Email/Password** provider. Each staff member gets an Auth account
  with email `{ic}@ksb-leave.local` and their existing password (default = IC).
- **Anonymous** sign-in is retained but demoted to a *bootstrap* role: it only
  allows the pre-login screen to read the sanitized `directory` collection (to
  populate branch/name pickers) and to create `registration_requests` (signup).
  Everything else requires a non-anonymous session.

### 2. Cloud Function (`functions/`, Blaze plan)

- **`onStaffWrite`** — Firestore trigger on `staff/{ic}`:
  - On create/update: create or update the Auth account for that IC; set custom
    claims `{ ic, canApprove, manageStaff }`; maintain the staff's `directory`
    entry (branch, name, ic).
  - `canApprove` and `manageStaff` are derived from a `config/rolePermissions`
    document (seeded from the current in-app RBAC matrix: `manage_pending` →
    `canApprove`, `manage_staff` → `manageStaff`). Reading from config keeps
    claims in sync with role changes and any custom roles.
  - If `inactive === true`: disable the Auth account (cannot sign in). If
    reactivated: re-enable.
- **`setStaffPassword`** — callable, gated by caller's `manageStaff` claim. Lets
  HR/admin set another staff's password (the browser cannot do this directly
  under Auth). Validates the target IC exists.

The Function uses the Admin SDK and therefore bypasses Firestore rules for its
own `directory`/claims writes.

### 3. One-time provisioning script (`provision-auth.js`, ADC)

Run once at cutover. For every existing `staff` doc:

- Create an Auth account (`{ic}@ksb-leave.local`, password = `staff.password ||
  staff.ic`).
- Set claims `{ ic, canApprove, manageStaff }`.
- Write the `directory` entry.
- If `inactive`, disable the account.

Also provisions the dedicated **super_admin IT break-glass** account.

Uses Application Default Credentials (matching existing `migrate_to_prod.js` /
`pull_from_prod.js`). Idempotent — safe to re-run.

### 4. Client changes (`src/main.js`)

- **Login** (renderLogin / login handler ~3329):
  - Anonymous bootstrap on load → read `directory` to populate branch/name
    picker.
  - On submit: resolve the selected staff's IC → `signInWithEmailAndPassword(
    `{ic}@ksb-leave.local`, password)`. This replaces the anonymous session with
    the real identity (carrying claims).
  - Remove in-browser plaintext password matching.
  - Remove the hardcoded `'superpassword'` / `'ksb-super-2026'` master logins.
- **Password change** (~1133): switch to Firebase Auth `updatePassword` after
  reauthentication; stop writing `staff.password`.
- **Admin "set password"** (management): call the `setStaffPassword` callable.
- **New staff self-edit UI**: on a staff member's *own* leave, an
  "Edit Tarikh/Sebab" action editing **date(s) and reason only**. On save:
  1. Show a before→after diff confirm dialog (what changed) + warning that
     approval restarts.
  2. On confirm: write `startDate`/`endDate`/`reason` (+ recomputed `days`) with
     `status: 'PENDING'`; re-notify approvers (WhatsApp + inbox) as on a new
     submission.
- **Remove `password` field** from staff docs going forward (no longer needed;
  stop writing it on add-staff / registration approval).

### 5. Firestore rules (role-aware)

Helper predicates:

- `signedIn()` — `request.auth != null && request.auth.token.firebase.sign_in_provider != 'anonymous'`
- `myIC()` — `request.auth.token.ic`
- `canApprove()` — `request.auth.token.canApprove == true`
- `manageStaff()` — `request.auth.token.manageStaff == true`

| Collection | Read | Create | Update | Delete |
|---|---|---|---|---|
| `directory` | `request.auth != null` (incl. anon) | function only | function only | function only |
| `registration_requests` | `manageStaff()` | `request.auth != null` (signup, incl. anon) | `manageStaff()` | `manageStaff()` |
| `staff` | `signedIn()` | `manageStaff()` | `manageStaff()` | `manageStaff()` |
| `leaves` | `signedIn()` | owner or approver (see below) | owner self-edit or `canApprove()` (see below) | `canApprove()` |
| `config/*` | `signedIn()` | `canApprove()` | `canApprove()` | `canApprove()` |
| messenger, inbox, waLogs, notifications | `signedIn()` | `signedIn()` | `signedIn()` | `signedIn()` |

**`leaves` create:** allowed if
`signedIn() && (canApprove() || (request.resource.data.ic == myIC() &&
request.resource.data.status in ['PENDING','HOD APPROVED']))`.
The `HOD APPROVED` allowance covers the existing Pahang **MC-direct-to-HR** flow.

**Full collection ruleset** (the app uses these collections; default is
deny). `signedIn()` = non-anonymous:

| Collection | Read | Create | Update | Delete |
|---|---|---|---|---|
| `directory` | `request.auth != null` | deny (function only) | deny | deny |
| `registration_requests` | `manageStaff()` | `request.auth != null` | `manageStaff()` | `manageStaff()` |
| `staff` | `signedIn()` | `manageStaff()` | `manageStaff()` **or** owner self-profile (`myIC()==id`, only `phone`/`email`/`address` changed) | `manageStaff()` |
| `leaves` | `signedIn()` | owner or `canApprove()` | owner self-edit or `canApprove()` | `canApprove()` |
| `branches` | `signedIn()` | `manageStaff()` | `manageStaff()` | `manageStaff()` |
| `config`, `system_config`, `settings` | `signedIn()` | `canApprove()` | `canApprove()` | `canApprove()` |
| `sessions` | `signedIn()` | `myIC()==id` | `myIC()==id` | `signedIn()` |
| `messenger_rooms`, `messenger_messages`, `notifications`, `user_presence` | `signedIn()` | `signedIn()` | `signedIn()` | `signedIn()` |
| `audit_logs`, `wa_logs` | `signedIn()` | `signedIn()` | deny | `manageStaff()` |

**`staff` self-profile:** `saveSelfProfile` (phone/email/address) must keep
working for ordinary staff, so the owner may update only those three fields of
their own doc. `changePassword` stops writing `staff.password` (password moves
to Auth `updatePassword`).

**`leaves` update:** allowed if `signedIn()` and either
- **approver:** `canApprove()` — full management (status transitions, locum
  fields, etc.); or
- **owner self-edit:** `resource.data.ic == myIC()` **and**
  `request.resource.data.status == 'PENDING'` **and** `ic`, `name`, `branch`,
  `type` unchanged **and** only `startDate`/`endDate`/`reason`/`days`/`status`
  differ from the existing doc.

This forces a self-edit to reset the leave to `PENDING` (re-approval) and
prevents staff from self-approving or editing fields other than date/reason.

## Security boundary (explicit)

- **Server (rules):** enforce the *role class* — only approvers change approval
  status; staff may edit only their own leave and only its date/reason, which
  resets approval; only `manageStaff` users touch staff records/passwords.
- **Client (`canManageRequest`, already hardened):** enforce *fine-grained
  routing* — which branch's supervisor, which approval stage. Rules deliberately
  do not replicate branch/stage routing (it would be a much larger build and
  would duplicate the editable in-app RBAC). This combination closes the real
  hole (any logged-in user approving anything) while keeping routing
  maintainable.

## Known tradeoffs

- **MC-direct create:** a staff could, in principle, self-submit a non-MC leave
  with status `HOD APPROVED` to skip stage-1 support. Final `APPROVED` still
  requires an approver, so it cannot be self-approved. Accepted; can be tightened
  later if needed.
- **Coarse approver class:** any approver-role user passes the server `canApprove`
  check for any leave; branch/stage limits remain client-side. Accepted per the
  security boundary above.
- **Directory exposure:** the `directory` exposes staff name + branch + IC to
  pre-login visitors (needed to build the login email). This is *less* exposed
  than today (passwords are currently world-readable to any anon token). Accepted
  per decision to keep IC-based identity.

## Cutover sequence

1. Upgrade the Firebase project to Blaze.
2. Enable Email/Password auth provider.
3. Seed `config/rolePermissions` from the current RBAC matrix.
4. Deploy the Cloud Function.
5. Run `provision-auth.js` (creates all Auth accounts + claims + directory +
   the IT break-glass account).
6. Deploy the new Firestore rules **and** the new client together.
7. Verify: a staff logs in and edits own pending leave (resets to PENDING); an
   approver approves; a staff cannot approve (rules deny); console-forged
   approval by a staff token is denied.

## Out of scope

- Email-based notifications (the Auth emails are left valid for future use).
- Replicating full branch/stage routing in Firestore rules.
- Migrating messenger/inbox to per-user-restricted reads (kept at `signedIn()`).

## Testing

- **Rules:** Firebase emulator unit tests for `leaves` (owner self-edit resets to
  PENDING; owner cannot change status to APPROVED; owner cannot edit others;
  approver can change status; anonymous can read only `directory` + create
  `registration_requests`) and `staff` (only `manageStaff` writes).
- **Cloud Function:** emulator test that a staff write sets the expected claims
  and directory entry; inactive disables the account.
- **Client:** manual cutover verification per the sequence above.

## Addendum (2026-06-10) — No-Blaze / manual-sync revision

The project will **not** enable the Blaze plan, so the claim-sync **Cloud Function
is not deployed**. Everything else in this design is unchanged (Firebase Auth,
custom claims, role-aware rules all run on the free Spark plan). The Function's
job is done manually instead:

- **Claim/account/directory sync:** run `provision-auth.js` (idempotent) from an
  IT machine after adding staff, approving a registration, changing a role, or
  marking someone inactive. It creates Auth accounts (default password = IC),
  refreshes claims from `config/rolePermissions`, updates `directory`, and
  disables inactive accounts. After a role change, the user must re-login to get
  the new claim.
- **Admin password reset:** `reset-password.js <ic> <newPassword>` (IT machine,
  Admin SDK). The in-app admin "set password" control gracefully detects the
  missing callable and points to this script.
- **`functions/` is kept** in the repo (unused) so automatic sync can be enabled
  later by upgrading to Blaze and deploying it — no code changes required.

Operational caveat: new staff / newly-approved registrations cannot log in until
IT runs `provision-auth.js`; the app reminds the admin of this on success. See
`docs/CUTOVER-firebase-auth.md` for the revised, Blaze-free cutover.
