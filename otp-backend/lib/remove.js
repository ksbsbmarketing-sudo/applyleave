// Remove a staff member from the system: the IC Auth account (with any linked
// Google sign-in), the login-directory entry and the staff record. The client
// used to delete only staff/{ic}, leaving a working login account and the name
// on the login screen behind.
//
// Order matters for retries: the Auth account goes first so login stops at once,
// and the staff doc goes last because the handler needs it for the company check.
import { emailForIC } from "./approve.js";

export async function removeStaff({ db, auth, ic }) {
  try {
    const user = await auth.getUserByEmail(emailForIC(ic));
    await auth.deleteUser(user.uid);
  } catch (e) { if (!(e && e.code === "auth/user-not-found")) throw e; }
  await db.doc(`directory/${ic}`).delete();
  await db.doc(`sessions/${ic}`).delete();
  await db.doc(`staff/${ic}`).delete();
  return { ok: true };
}
