# Cutover — Firebase Auth & Role Enforcement (No-Blaze / Manual Sync)

This project does **not** use Cloud Functions (the Blaze plan is not enabled).
Firebase Auth, custom claims, and the Firestore rules all run on the free Spark
plan. The claim/account sync that a Cloud Function would automate is done
**manually** by running `provision-auth.js` from your computer.

Do these in order. The live app keeps working as-is until step 5.

## One-time cutover

1. **Enable Email/Password:** Firebase console → Authentication → Sign-in method →
   enable Email/Password. (Keep Anonymous enabled — it powers the pre-login picker.)
2. **Authenticate for Admin SDK (ADC)** on your machine, pointed at the project:
   `gcloud auth application-default login` (or `firebase login`).
3. **Seed role permissions (prod):** `node seed-role-permissions.js`
4. **Provision accounts:** create Auth accounts, claims, and the `directory` for all
   staff, plus the break-glass IT super_admin:
   - PowerShell: `$env:IT_ADMIN_PASSWORD='<choose-strong>'; node provision-auth.js`
   - Verify in console → Authentication that users exist and the `directory`
     collection is populated.
5. **Deploy rules + client together** (must come AFTER step 4, or users are locked out
   — anonymous sessions can only read `directory`):
   - `npm run build`
   - `npx firebase deploy --only firestore:rules,hosting --project apply-leave-89ebb`
6. **Verify (prod):**
   - Staff logs in (IC + password) ✓
   - Staff edits own PENDING leave → stays PENDING; edits a supported leave → resets to PENDING ✓
   - Approver approves a leave ✓
   - Staff CANNOT approve (button hidden; console-forced status write denied by rules) ✓
   - Old `superpassword` no longer works ✓
   - Break-glass `itadmin` logs in ✓

> Cloud Functions are NOT deployed. `functions/` stays in the repo so you can switch
> to automatic sync later (enable Blaze, `firebase deploy --only functions`), but it
> is unused for now.

## Ongoing operations (IT — run from your machine, ADC required)

Because there is no Cloud Function trigger, the live Firestore `staff` collection and
the Auth/claims/`directory` can drift. Re-sync after any of these:

- **Added a staff / approved a registration / changed a role / set someone inactive**
  in the app → run `node provision-auth.js` again (idempotent). This creates any new
  Auth accounts (default password = IC), refreshes everyone's claims from
  `config/rolePermissions`, updates the `directory`, and disables inactive accounts.
  - After a role change, the affected user must **log out and back in** to receive the
    refreshed claim in their token.
- **Reset a staff's password:** `node reset-password.js <ic> <newPassword>` (min 6 chars).
  - In the app, the admin "set password" control will show a message pointing here
    when the Function isn't deployed.

## Notes

- New staff and newly-approved registrations cannot log in until you run
  `provision-auth.js` — the app reminds the admin of this on success.
- Post-cutover cleanup (optional, after a stable week): the legacy `password` field on
  staff docs is unused and can be removed with a one-off script; it is otherwise ignored.
