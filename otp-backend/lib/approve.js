// Approve a registration request: create the staff record, the IC Auth account,
// its claims and login-directory entry, and — for a Google registration — move
// the Google identity from the registrant's temporary Firebase user onto the IC
// account. Replaces the client-side approveRegistration + manual provision-one.js.
//
// Every step is idempotent so HR can press "Lulus" again after a failure: the
// request is marked "approving" first, and a staff doc carrying this request's
// registrationDocId is treated as ours rather than as "IC already exists".
const AUTH_EMAIL_DOMAIN = "ksb-leave.local";
export const emailForIC = (ic) => `${String(ic).replace(/[^a-zA-Z0-9]/g, "")}@${AUTH_EMAIL_DOMAIN}`;

const isNotFound = (e) => e && e.code === "auth/user-not-found";

export async function approveRegistration({ db, auth, docId, name, now = Date.now() }) {
  const reqRef = db.doc(`registration_requests/${docId}`);
  const reqSnap = await reqRef.get();
  if (!reqSnap.exists) return { ok: false, status: 404, error: "not_found" };
  const r = reqSnap.data();
  if (!["pending", "approving"].includes(r.status)) return { ok: false, status: 409, error: "not_pending" };

  const ic = String(r.ic || "").trim();
  const staffName = String(name || r.name || "").trim();
  const staffRef = db.doc(`staff/${ic}`);
  const staffSnap = await staffRef.get();
  if (staffSnap.exists && staffSnap.data().registrationDocId !== docId) {
    await reqRef.update({ status: "rejected", rejectedAt: now, rejectedReason: "IC sudah wujud" });
    return { ok: false, status: 409, error: "ic_exists" };
  }

  await reqRef.update({ status: "approving" });

  const googleEmail = r.googleSub ? (r.googleEmail || null) : null;
  if (!staffSnap.exists) {
    await staffRef.set({
      name: staffName, ic, branch: r.branch, category: r.category,
      role: "staff", phone: r.phone, inactive: false,
      startDate: new Date(now).toISOString().split("T")[0],
      registrationDocId: docId,
      ...(googleEmail ? { googleEmail } : {}),
    });
  } else if (googleEmail) {
    await staffRef.set({ googleEmail }, { merge: true });
  }

  // Auth account (get-or-create; an existing account keeps its password).
  let user;
  try {
    user = await auth.getUserByEmail(emailForIC(ic));
  } catch (e) {
    if (!isNotFound(e)) throw e;
    const pwd = ic.length < 6 ? ic.padEnd(6, "0") : ic;
    user = await auth.createUser({ email: emailForIC(ic), password: pwd, displayName: staffName || ic });
  }

  const permsSnap = await db.doc("config/rolePermissions").get();
  const rp = (permsSnap.exists ? permsSnap.data() : {}).staff || { canApprove: false, manageStaff: false };
  await auth.setCustomUserClaims(user.uid, { ic, canApprove: !!rp.canApprove, manageStaff: !!rp.manageStaff });
  await auth.updateUser(user.uid, { disabled: false });
  await db.doc(`directory/${ic}`).set({ ic, name: staffName, branch: r.branch || "", inactive: false });

  if (r.googleSub) {
    const fresh = await auth.getUserByEmail(emailForIC(ic));
    const linked = (fresh.providerData || []).some((p) => p.providerId === "google.com");
    if (!linked) {
      // A Google identity can belong to one Firebase user only: remove the
      // registrant's temporary user before linking it to the IC account.
      if (r.googleUid && r.googleUid !== user.uid) {
        try { await auth.deleteUser(r.googleUid); } catch (e) { if (!isNotFound(e)) throw e; }
      }
      await auth.updateUser(user.uid, {
        providerToLink: { providerId: "google.com", uid: r.googleSub, email: r.googleEmail, displayName: staffName },
      });
    }
  }

  await reqRef.update({ status: "approved", approvedAt: now });
  return { ok: true, ic, googleEmail };
}
