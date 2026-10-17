// Caller authorization for the admin endpoints (approve-registration, unlink-google).
// The browser sends its Firebase ID token as `Authorization: Bearer <token>`; we
// verify it with the Admin SDK and require the manageStaff claim.
//
// ⚠️ KEEP IN SYNC WITH firestore.rules subsidiaries() / isGroupAdmin() / companyOK().
// The rules guard the same boundary for writes made from the browser.

export const SUBSIDIARIES = ["KSB Pharma Sdn. Bhd."];
const GROUP_ADMIN_ROLES = ["admin", "super_admin"];

export function companyOK(caller, branch) {
  const isSubsidiaryUser = SUBSIDIARIES.includes(caller.branch);
  const isGroupAdmin = GROUP_ADMIN_ROLES.includes(caller.role);
  if (isSubsidiaryUser) return branch === caller.branch;
  return !SUBSIDIARIES.includes(branch) || isGroupAdmin;
}

export function bearerToken(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || "";
  const m = /^Bearer\s+(.+)$/.exec(h);
  return m ? m[1].trim() : null;
}

export async function requireManageStaff(req, { auth, db }) {
  const token = bearerToken(req);
  if (!token) return { ok: false, status: 401, error: "unauthenticated" };
  let decoded;
  try { decoded = await auth.verifyIdToken(token); }
  catch { return { ok: false, status: 401, error: "unauthenticated" }; }
  if (decoded.manageStaff !== true || typeof decoded.ic !== "string") {
    return { ok: false, status: 403, error: "forbidden" };
  }
  const snap = await db.doc(`staff/${decoded.ic}`).get();
  if (!snap.exists || snap.data().inactive) return { ok: false, status: 403, error: "forbidden" };
  const s = snap.data();
  return { ok: true, caller: { ic: decoded.ic, role: s.role, branch: s.branch } };
}
