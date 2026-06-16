// POST /api/confirm-otp  { ic, otp, newPassword }
// Verifies the one-time code and, on success, sets the new Firebase Auth password
// via the Admin SDK (the only way to reset a forgotten password without Blaze).
import { db, auth } from "../lib/firebase.js";
import { applyCors, readBody } from "../lib/cors.js";
import { verifyOtp, MAX_ATTEMPTS } from "../lib/otp.js";

const AUTH_EMAIL_DOMAIN = "ksb-leave.local";
const emailForIC = (ic) => `${String(ic).replace(/[^a-zA-Z0-9]/g, "")}@${AUTH_EMAIL_DOMAIN}`;

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    const body = readBody(req);
    const ic = String(body.ic ?? "").replace(/[^a-zA-Z0-9]/g, "");
    const otp = String(body.otp ?? "").trim();
    const newPassword = String(body.newPassword ?? "");
    if (!ic || !otp) return res.status(400).json({ error: "missing_fields" });
    if (newPassword.length < 6) return res.status(400).json({ error: "weak_password" });

    const firestore = db();
    const resetRef = firestore.doc(`password_resets/${ic}`);
    const existing = (await resetRef.get()).data() || null;

    const result = verifyOtp(existing, otp, Date.now());
    if (!result.ok) {
      if (result.code === "mismatch") {
        await resetRef.update({ attempts: result.attempts });
        return res.status(400).json({ error: "mismatch", attemptsLeft: Math.max(0, MAX_ATTEMPTS - result.attempts) });
      }
      if (result.code === "too_many_attempts") await resetRef.delete().catch(() => {});
      return res.status(400).json({ error: result.code });
    }

    let user;
    try {
      user = await auth().getUserByEmail(emailForIC(ic));
    } catch {
      return res.status(404).json({ error: "no_account" });
    }
    await auth().updateUser(user.uid, { password: newPassword });
    await resetRef.delete().catch(() => {});

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("confirm-otp error:", e);
    return res.status(500).json({ error: "server_error" });
  }
}
