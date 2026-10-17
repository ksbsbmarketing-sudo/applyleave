// POST /api/approve-registration  { docId, name }   (Authorization: Bearer <idToken>)
// HR/Admin approves a registration request. Creates the staff record and login
// account (and links Google when the request came from "Daftar dengan Google"),
// so the new staff can log in straight away — no provision-one.js run needed.
import { db as getDb, auth as getAuth } from "../lib/firebase.js";
import { applyCors, readBody } from "../lib/cors.js";
import { requireManageStaff, companyOK } from "../lib/authz.js";
import { approveRegistration } from "../lib/approve.js";

export function makeApproveHandler(deps) {
  return async function handler(req, res) {
    if (applyCors(req, res)) return;
    if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
    try {
      const { db, auth } = deps();
      const authz = await requireManageStaff(req, { db, auth });
      if (!authz.ok) return res.status(authz.status).json({ error: authz.error });

      const body = readBody(req);
      const docId = String(body.docId ?? "").trim();
      if (!docId) return res.status(400).json({ error: "missing_fields" });

      const reqSnap = await db.doc(`registration_requests/${docId}`).get();
      if (!reqSnap.exists) return res.status(404).json({ error: "not_found" });
      if (!companyOK(authz.caller, reqSnap.data().branch || "")) return res.status(403).json({ error: "forbidden" });

      const result = await approveRegistration({ db, auth, docId, name: body.name });
      if (!result.ok) return res.status(result.status).json({ error: result.error });
      return res.status(200).json(result);
    } catch (e) {
      console.error("approve-registration error:", e);
      return res.status(500).json({ error: "server_error" });
    }
  };
}

export default makeApproveHandler(() => ({ db: getDb(), auth: getAuth() }));
