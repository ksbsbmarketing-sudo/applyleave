// POST /api/delete-staff  { ic }   (Authorization: Bearer <idToken>)
// HR/Admin removes a staff member: staff record, login-directory entry and the
// login account (so a linked Gmail is freed too). Company-scoped like the
// Firestore rules for staff deletes. Leave history is kept.
import { db as getDb, auth as getAuth } from "../lib/firebase.js";
import { applyCors, readBody } from "../lib/cors.js";
import { requireManageStaff, companyOK } from "../lib/authz.js";
import { removeStaff } from "../lib/remove.js";

export function makeDeleteStaffHandler(deps) {
  return async function handler(req, res) {
    if (applyCors(req, res)) return;
    if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
    try {
      const { db, auth } = deps();
      const authz = await requireManageStaff(req, { db, auth });
      if (!authz.ok) return res.status(authz.status).json({ error: authz.error });

      const ic = String(readBody(req).ic ?? "").replace(/[^a-zA-Z0-9]/g, "");
      if (!ic) return res.status(400).json({ error: "missing_fields" });
      if (ic === authz.caller.ic) return res.status(400).json({ error: "self_delete" });

      const target = await db.doc(`staff/${ic}`).get();
      if (!target.exists) return res.status(404).json({ error: "not_found" });
      if (!companyOK(authz.caller, target.data().branch || "")) return res.status(403).json({ error: "forbidden" });

      return res.status(200).json(await removeStaff({ db, auth, ic }));
    } catch (e) {
      console.error("delete-staff error:", e);
      return res.status(500).json({ error: "server_error" });
    }
  };
}

export default makeDeleteStaffHandler(() => ({ db: getDb(), auth: getAuth() }));
