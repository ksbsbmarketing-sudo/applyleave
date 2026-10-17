// POST /api/unlink-google  { ic }   (Authorization: Bearer <idToken>)
// HR/Admin removes the Google sign-in from a staff member's account, e.g. after a
// lost phone or a Gmail linked by mistake. Company-scoped like the Firestore rules.
import { db as getDb, auth as getAuth } from "../lib/firebase.js";
import { applyCors, readBody } from "../lib/cors.js";
import { requireManageStaff, companyOK } from "../lib/authz.js";
import { unlinkGoogle } from "../lib/unlink.js";

export function makeUnlinkHandler(deps) {
  return async function handler(req, res) {
    if (applyCors(req, res)) return;
    if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
    try {
      const { db, auth } = deps();
      const authz = await requireManageStaff(req, { db, auth });
      if (!authz.ok) return res.status(authz.status).json({ error: authz.error });

      const ic = String(readBody(req).ic ?? "").replace(/[^a-zA-Z0-9]/g, "");
      if (!ic) return res.status(400).json({ error: "missing_fields" });

      const target = await db.doc(`staff/${ic}`).get();
      if (!target.exists) return res.status(404).json({ error: "not_found" });
      if (!companyOK(authz.caller, target.data().branch || "")) return res.status(403).json({ error: "forbidden" });

      const result = await unlinkGoogle({ db, auth, ic });
      if (!result.ok) return res.status(result.status).json({ error: result.error });
      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error("unlink-google error:", e);
      return res.status(500).json({ error: "server_error" });
    }
  };
}

export default makeUnlinkHandler(() => ({ db: getDb(), auth: getAuth() }));
