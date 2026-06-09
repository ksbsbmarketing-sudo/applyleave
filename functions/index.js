import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";

admin.initializeApp();

const AUTH_EMAIL_DOMAIN = "ksb-leave.local";
const emailForIC = (ic) => `${String(ic).replace(/[^a-zA-Z0-9]/g, "")}@${AUTH_EMAIL_DOMAIN}`;

async function loadRolePerms() {
  const snap = await admin.firestore().doc("config/rolePermissions").get();
  return snap.exists ? snap.data() : {};
}

async function ensureAuthUser(email, password, name) {
  try {
    return await admin.auth().getUserByEmail(email);
  } catch {
    return await admin.auth().createUser({ email, password: password || "changeme00", displayName: name || email });
  }
}

// Keep custom claims + directory in sync with the staff collection.
export const onStaffWrite = onDocumentWritten("staff/{ic}", async (event) => {
  const ic = event.params.ic;
  const email = emailForIC(ic);
  const after = event.data?.after?.exists ? event.data.after.data() : null;

  // Deleted staff → disable auth account + drop directory entry.
  if (!after) {
    try {
      const u = await admin.auth().getUserByEmail(email);
      await admin.auth().updateUser(u.uid, { disabled: true });
    } catch { /* no auth account */ }
    await admin.firestore().doc(`directory/${ic}`).delete().catch(() => {});
    return;
  }

  const perms = await loadRolePerms();
  const rp = perms[after.role] || { canApprove: false, manageStaff: false };
  const claims = { ic, canApprove: !!rp.canApprove, manageStaff: !!rp.manageStaff };

  const u = await ensureAuthUser(email, after.password || String(ic), after.name);
  await admin.auth().setCustomUserClaims(u.uid, claims);
  await admin.auth().updateUser(u.uid, { disabled: !!after.inactive });

  await admin.firestore().doc(`directory/${ic}`).set({
    ic,
    name: after.name || "",
    branch: after.branch || "",
    inactive: !!after.inactive,
  });
});

// Admin/HR sets another staff's password (the browser cannot under Auth).
export const setStaffPassword = onCall(async (request) => {
  if (!request.auth || request.auth.token.manageStaff !== true) {
    throw new HttpsError("permission-denied", "Hanya HR/Admin boleh menetapkan kata laluan.");
  }
  const ic = request.data?.ic;
  const newPassword = request.data?.newPassword;
  if (!ic || !newPassword || String(newPassword).length < 6) {
    throw new HttpsError("invalid-argument", "IC dan kata laluan (min 6 aksara) diperlukan.");
  }
  const u = await admin.auth().getUserByEmail(emailForIC(ic));
  await admin.auth().updateUser(u.uid, { password: String(newPassword) });
  return { ok: true };
});
