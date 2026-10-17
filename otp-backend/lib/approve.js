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
const IC_RE = /^[A-Za-z0-9]{6,20}$/;
const nonEmptyString = (v) => typeof v === "string" && v.trim() !== "";

// Only a Google-only temporary user (no IC claim, no password provider, not an
// <ic>@ksb-leave.local account) may be treated as the registrant's identity or
// deleted. Anything else is a real staff account and must never be touched.
export function isThrowawayGoogleUser(u) {
  if (!u) return false;
  const providers = (u.providerData || []).map((p) => p.providerId);
  return providers.includes("google.com")
    && !providers.includes("password")
    && !(u.customClaims && u.customClaims.ic)
    && !String(u.email || "").endsWith(`@${AUTH_EMAIL_DOMAIN}`);
}

export async function approveRegistration({ db, auth, docId, name, now = Date.now() }) {
  const reqRef = db.doc(`registration_requests/${docId}`);
  const reqSnap = await reqRef.get();
  if (!reqSnap.exists) return { ok: false, status: 404, error: "not_found" };
  const r = reqSnap.data();
  if (!["pending", "approving"].includes(r.status)) return { ok: false, status: 409, error: "not_pending" };

  const ic = String(r.ic || "").trim();
  if (!IC_RE.test(ic) || !nonEmptyString(r.branch) || !nonEmptyString(r.category)) {
    return { ok: false, status: 400, error: "invalid_request" };
  }
  const staffName = String(name || r.name || "").trim();
  const staffRef = db.doc(`staff/${ic}`);
  const staffSnap = await staffRef.get();
  if (staffSnap.exists && staffSnap.data().registrationDocId !== docId) {
    await reqRef.update({ status: "rejected", rejectedAt: now, rejectedReason: "IC sudah wujud" });
    return { ok: false, status: 409, error: "ic_exists" };
  }

  await reqRef.update({ status: "approving" });

  // The Google identity comes from the registrant's Firebase user record, never
  // from the request doc (which the registrant can write). Resolve it once and
  // persist it before the temp user is deleted, so retries still have it.
  let verified = null;
  if (r.verifiedGoogleSub) {
    verified = { sub: r.verifiedGoogleSub, email: r.verifiedGoogleEmail || null };
  } else if (r.googleUid) {
    try {
      const tu = await auth.getUser(r.googleUid);
      // A provisioned account is not a registrant's temp user: no Google identity.
      const p = isThrowawayGoogleUser(tu) ? tu.providerData.find((x) => x.providerId === "google.com") : null;
      if (p) {
        verified = { sub: p.uid, email: p.email || null };
        await reqRef.update({ verifiedGoogleSub: verified.sub, verifiedGoogleEmail: verified.email });
      }
    } catch (e) { if (!isNotFound(e)) throw e; }
  }

  const googleEmail = verified ? verified.email : null;
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

  if (verified) {
    const fresh = await auth.getUserByEmail(emailForIC(ic));
    const linked = (fresh.providerData || []).some((p) => p.providerId === "google.com");
    if (!linked) {
      // A Google identity can belong to one Firebase user only: remove the
      // registrant's temporary user before linking it to the IC account.
      if (r.googleUid && r.googleUid !== user.uid) {
        try {
          const tu = await auth.getUser(r.googleUid);
          if (isThrowawayGoogleUser(tu)) await auth.deleteUser(r.googleUid);
        } catch (e) { if (!isNotFound(e)) throw e; }
      }
      await auth.updateUser(user.uid, {
        providerToLink: { providerId: "google.com", uid: verified.sub, email: verified.email, displayName: staffName },
      });
    }
  }

  await reqRef.update({ status: "approved", approvedAt: now });
  return { ok: true, ic, googleEmail };
}
