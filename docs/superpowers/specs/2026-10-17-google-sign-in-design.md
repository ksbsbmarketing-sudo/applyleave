# Log masuk dengan Google — Google sign-in alongside IC + password

**Date:** 2026-10-17
**Status:** design approved, awaiting spec review

## Problem

Staff log in by picking their name (which resolves to their IC) and typing a password. The Firebase Auth account behind it is a synthetic `<ic>@ksb-leave.local` email/password user, provisioned by `provision-one.js` / `provision-auth.js` (Spark plan — `functions/onStaffWrite` is not deployed). Staff want to log in with their Google account instead of remembering a password, and new hires want to register with Google.

## Goal

1. An **existing** staff member logs in once with IC + password, links their Google account in **Tetapan Akaun**, and from then on can log in with **"Log masuk dengan Google"**. Logging in with the password keeps working.
2. A **new** hire taps **"Daftar dengan Google"**, fills the existing registration form (name prefilled), HR approves, and they can log in with Google immediately — no IT step.
3. Staff can unlink their own Google account; HR/Admin can unlink any staff member's within their company scope, and see each staff member's Google status.

## Non-goals

- No removal of IC + password login. It stays the fallback for every account.
- No Google-only accounts. Every staff member has exactly one Firebase Auth user — the `<ic>@ksb-leave.local` one — and Google is a linked provider on it.
- No Cloud Functions / Blaze. Server-side work goes to the existing Vercel `otp-backend`.
- No change to leave routing, balances, roles, RBAC matrix or WhatsApp templates (other than one line in the welcome message).
- No migration: nobody is linked on day one; staff opt in.

## Decisions

| Question | Decision |
|---|---|
| How is Google tied to a staff member? | **One Firebase user per staff (Cara 1).** Google is linked onto the existing IC account, so `uid`, claims, `sync-claims.js`, deactivation, OTP reset and session control keep working unchanged. Rejected: a separate Google user carrying the same `ic` claim — every script would have to handle two accounts, and a missed one leaves a deactivated staff able to log in via Google. |
| Existing staff verification | Being logged in with IC + password **is** the verification. Linking only happens from Tetapan for the signed-in user. |
| New staff verification | **HR approval.** A Google registrant has no access until approved. |
| Activation after HR approval | **Automatic**, via a new `otp-backend` endpoint. Applies to every registration (with or without Google); `provision-one.js` is no longer needed for approved registrations. |
| Who can unlink | Staff themselves (client-side) **and** HR/Admin for others (server-side, company-scoped). |
| HR visibility | Google status (email or "Belum dipautkan") shown in the staff list/edit, with an **"Buang pautan"** button. |

## Security fix first — `signedIn()` must mean "a provisioned staff member"

`firestore.rules` currently defines:

```
function signedIn() {
  return request.auth != null
    && request.auth.token.firebase.sign_in_provider != 'anonymous';
}
```

Any non-anonymous Firebase user passes, whether or not they are staff. Today that is only safe if nobody can create a non-anonymous account themselves. Enabling the Google provider breaks that: **any Gmail user** becomes `signedIn()` and can read `config/*`, `system_config`, `settings`, `audit_logs`, `wa_logs` (a no-`ic` user is not `isSubsidiaryUser()`), and create audit/wa log entries. The same exposure exists today if Email/Password **sign-up** is left enabled in the Firebase console, since the API key is public.

Change:

```
function signedIn() {
  return request.auth != null
    && request.auth.token.firebase.sign_in_provider != 'anonymous'
    && request.auth.token.get('ic', null) is string;
}
```

This ships **before** the Google provider is enabled. Every legitimately provisioned user already carries the `ic` claim (`provision-one.js`, `provision-auth.js`, `sync-claims.js`), so no current user loses access. Rules that use bare `request.auth != null` (`directory` read, `registration_requests` create, others) are reviewed during implementation; those that must stay open to the anonymous login screen or a pending registrant stay as they are.

`registration_requests` create gains a constraint:

```
allow create: if request.auth != null
  && ( !('googleUid' in request.resource.data)
       || request.resource.data.googleUid == request.auth.uid );
```

so nobody can submit a registration carrying someone else's Google identity.

`staff/{ic}` self-update allowlist gains `googleEmail`, so the client can record the linked address after `linkWithPopup` / clear it after `unlink`.

## Architecture

| Unit | Change |
|---|---|
| `firestore.rules` | `signedIn()` tightened; `registration_requests` `googleUid` check; `googleEmail` in staff self-update allowlist. |
| `src/googleAuth.js` (new) | Thin wrapper around the Firebase calls: `googleProvider()`, `signInWithGoogle()` (popup, falling back to redirect on `auth/popup-blocked` / `auth/operation-not-supported-in-this-environment`), `linkGoogle(user)`, `unlinkGoogle(user)`, `googleIdentityOf(user)` → `{ sub, email, displayName } \| null`. Pure helpers (error-code → Malay message) are unit-tested. |
| `src/main.js` — login | Post-login steps (staff doc read, inactive check, `user =`, `initData`, session id, localStorage, session doc, inbox, notif, reminders, view) move out of the `#login-form` handler into `completeLogin(ic, { viaGoogle })`. Both the IC form and the Google button call it. `showFirstLoginWarning` is only evaluated for password logins. |
| `src/main.js` — login screen | **"Log masuk dengan Google"** button under the existing form. |
| `src/main.js` — Daftar Baharu | **"Daftar dengan Google"** button; after Google sign-in the existing registration form opens with name prefilled and the request is saved with `googleUid`, `googleSub`, `googleEmail`. |
| `src/main.js` — Tetapan Akaun | New **"Akaun Google"** card: not linked → "Pautkan akaun Google"; linked → "✅ Dipautkan: x@gmail.com" + "Buang pautan". |
| `src/main.js` — HR staff list / edit | Google status column/line and "Buang pautan" (calls the backend). |
| `src/main.js` — `approveRegistration` | Calls `POST /api/approve-registration` instead of writing `staff/{ic}` itself. WhatsApp welcome stays client-side. |
| `otp-backend/lib/authz.js` (new) | `requireCaller(req)` → verifies `Authorization: Bearer <idToken>` with `auth().verifyIdToken`, returns claims; `assertManageStaffFor(callerStaff, branch)` mirrors the rules' `companyOK` (subsidiary isolation, group-admin override). Pure, unit-tested. |
| `otp-backend/api/approve-registration.js` (new) | See flow D. |
| `otp-backend/api/unlink-google.js` (new) | See flow E. |
| `otp-backend/lib/cors.js` | `Access-Control-Allow-Headers` adds `Authorization`. |

Vercel Hobby allows 12 functions; this takes the backend from 3 to 5.

## Data flows

### A. Existing staff links Google (Tetapan)
1. Signed-in staff taps "Pautkan akaun Google" → `linkWithPopup(auth.currentUser, GoogleAuthProvider)`.
2. Success → `updateDoc(staff/{ic}, { googleEmail })` → toast "Akaun Google berjaya dipautkan".
3. `auth/credential-already-in-use` → "Akaun Google ini sudah digunakan oleh akaun lain." (another staff member, or a pending registration).
4. `auth/provider-already-linked` → re-render; already linked.

### B. Log in with Google
1. `signInWithGoogle()` (replaces the anonymous bootstrap session).
2. `getIdTokenResult(true)`:
   - **has `ic`** → `completeLogin(claims.ic, { viaGoogle: true })` — same inactive check, session, dashboard as password login.
   - **no `ic`**, and a `registration_requests` doc with `googleUid == uid` and `status == 'pending'` exists → "Permohonan anda sedang disemak HR." → sign out → anonymous bootstrap.
   - **no `ic`**, no pending request → `auth.currentUser.delete()` (allowed: fresh sign-in) → "Akaun Google ini belum dipautkan. Log masuk dengan IC dahulu dan pautkan di Tetapan, atau daftar sebagai staf baru." → anonymous bootstrap. Deleting matters: a leftover Google-only user would otherwise make a later link fail with `credential-already-in-use`.
3. The pending-request lookup needs a read path for a no-`ic` user: `registration_requests` gets `allow get: if request.auth != null && resource.data.get('googleUid', null) == request.auth.uid` (a single-doc read of their own request, queried by `googleUid`; implementation may use `allow list` with the same condition).

### C. Restore on reload
The bootstrap IIFE treats any non-anonymous user as a real session. It now first reads the token: a non-anonymous user **without `ic`** is handled exactly as B2's no-`ic` branches (pending message or delete), then falls through to the anonymous bootstrap. `restoreSessionUser` is otherwise unchanged — after `completeLogin` writes `ksb_logged_in_ic` / `_sid`, a Google session restores the same way a password session does.

### D. New staff registers with Google → HR approves
1. "Daftar dengan Google" → `signInWithGoogle()` → registration form, name prefilled from `displayName` (still editable; title-cased on approval as today).
2. Submit writes the request as today plus `googleUid`, `googleSub` (Google provider uid), `googleEmail`. Rules enforce `googleUid == auth.uid`.
3. HR taps Lulus → `POST /api/approve-registration { docId }` with the HR's ID token.
4. Server:
   1. `requireCaller` → claims must have `manageStaff`; load caller's `staff/{ic}`; `assertManageStaffFor(caller, request.branch)`.
   2. Load the request; must be `pending` (or `approving` — see retry). IC must not already exist in `staff` (else mark `rejected`, reason "IC sudah wujud", as the client does today).
   3. Mark the request `approving`.
   4. Create `staff/{ic}` (same fields as today's client `newStaff`, plus `registrationDocId: docId`).
   5. Get-or-create the Auth user `<ic>@ksb-leave.local` (password = IC padded to 6, as `provision-one.js`), set claims `{ ic, canApprove, manageStaff }` from `config/rolePermissions`, write `directory/{ic}`.
   6. If `googleSub`: delete the temporary Google user `googleUid` (ignore not-found), then `updateUser(icUid, { providerToLink: { providerId: 'google.com', uid: googleSub, email: googleEmail } })`; write `staff/{ic}.googleEmail`.
   7. Mark the request `approved`, `approvedAt`.
5. Client shows the existing toast (minus the "IT perlu jalankan provision" line) and sends the WhatsApp welcome, adding "Anda juga boleh log masuk dengan Google" when `googleEmail` is set.

**Retry:** every step is idempotent (get-or-create user, `set` docs, delete-if-exists, link skipped if the IC user already has `google.com`). A request stuck in `approving` can be approved again; the "IC already exists" check is skipped when the existing `staff/{ic}` was created by this same request (`staff.registrationDocId == docId`).

### E. Unlink
- **Self:** Tetapan → `unlink(auth.currentUser, 'google.com')` → `updateDoc(staff/{ic}, { googleEmail: null })`. Allowed only if the account still has the password provider (always true under Cara 1).
- **HR/Admin:** `POST /api/unlink-google { ic }` → `requireCaller` + `manageStaff` + `assertManageStaffFor(caller, target.branch)` → `updateUser(uid, { providersToUnlink: ['google.com'] })` → clear `staff/{ic}.googleEmail`.

## Error handling

- Popup closed by user (`auth/popup-closed-by-user`, `auth/cancelled-popup-request`) → silent.
- Popup blocked / unsupported → redirect flow; `getRedirectResult` is checked in the bootstrap.
- Backend unreachable / 5xx → "Tidak dapat menghubungi pelayan. Sila cuba lagi." Nothing is half-written in a way that blocks a retry (D-retry).
- Backend 403 → "Anda tiada kebenaran untuk tindakan ini."
- All messages Malay, via the existing `showToast`.

## Testing

- **Rules (`tests/rules.test.mjs`, emulator):**
  - a Google user with no `ic` claim is denied `config`, `audit_logs`, `wa_logs`, `staff`, `leaves`;
  - such a user may create a `registration_requests` doc with their own `googleUid`, and is denied one with another uid;
  - such a user may read their own request by `googleUid`, not others';
  - staff may set/clear their own `googleEmail` and nothing else new;
  - all existing 50 tests still pass.
- **otp-backend (`node --test`):** `authz.js` (missing/invalid token, no `manageStaff`, subsidiary isolation both ways, group admin override) and the approve/unlink handlers against a mocked `firebase.js` (happy path, Google and non-Google, idempotent retry, IC already exists).
- **Client unit (`tests/googleAuth.test.mjs`):** error-code → message mapping, `googleIdentityOf`.
- **Manual (web + APK/TWA):** link → logout → Google login; unlinked Gmail login is refused and leaves no stray user; Google register → pending message → HR approve → Google login; self unlink; HR unlink; deactivated staff refused via Google; reload restores a Google session.

## Rollout (order matters)

1. Deploy `firestore.rules` with the tightened `signedIn()` (+ new rules). Verify normal login still works.
2. Deploy `otp-backend` (new endpoints, CORS header).
3. Firebase console → Authentication → Sign-in method: enable **Google**. Confirm `cuti-staff.ksbsb.com.my` is in Authorized domains.
4. Deploy the app (version bump as usual).

Do **not** turn off "Enable create (sign-up)" under Authentication → Settings → User actions: it blocks client-side creation of *every* new user, including the temporary Google user a new hire signs in with (flow D) and the one flow B creates before deleting it. After step 1, a self-created account without the `ic` claim has no data access, so leaving sign-up on is safe.
