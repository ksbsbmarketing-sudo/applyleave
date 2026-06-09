# Cutover — Firebase Auth & Role Enforcement

Do these in order. The live app keeps working as-is until step 6.

1. **Blaze:** Upgrade project `apply-leave-89ebb` to the Blaze plan (Firebase console → Usage and billing). Required for Cloud Functions.
2. **Enable Email/Password:** Firebase console → Authentication → Sign-in method → enable Email/Password. (Keep Anonymous enabled.)
3. **Seed role permissions (prod):** `node seed-role-permissions.js`
4. **Deploy the function:** `npx firebase deploy --only functions --project apply-leave-89ebb`
5. **Provision accounts:** `IT_ADMIN_PASSWORD='<choose-strong>' node provision-auth.js`
   - Verify in console → Authentication that users exist and `directory` is populated.
6. **Deploy rules + client together:**
   - `npm run build`
   - `npx firebase deploy --only firestore:rules,hosting --project apply-leave-89ebb`
7. **Verify (prod):**
   - Staff logs in (IC + password) ✓
   - Staff edits own PENDING leave → stays PENDING; edits a supported leave → resets to PENDING ✓
   - Approver approves a leave ✓
   - Staff CANNOT approve (button hidden; console-forced status write denied by rules) ✓
   - Old `superpassword` no longer works ✓
   - Break-glass `itadmin` logs in ✓
8. **Post-cutover cleanup (after a stable week):** remove the now-unused `password` field from staff docs with a one-off script (optional; the field is simply ignored).
