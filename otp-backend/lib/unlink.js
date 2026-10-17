// Remove the Google provider from a staff member's IC account (HR/Admin action).
// Staff unlinking themselves do it in the browser; only cross-user unlink needs us.
import { emailForIC } from "./approve.js";

export async function unlinkGoogle({ db, auth, ic }) {
  let user;
  try { user = await auth.getUserByEmail(emailForIC(ic)); }
  catch (e) { if (e && e.code === "auth/user-not-found") return { ok: false, status: 404, error: "not_found" }; throw e; }
  await auth.updateUser(user.uid, { providersToUnlink: ["google.com"] });
  await db.doc(`staff/${ic}`).set({ googleEmail: null }, { merge: true });
  return { ok: true };
}
