// POST /api/request-otp  { ic }
// Looks up the staff's registered WhatsApp number, generates a one-time code,
// stores it hashed in Firestore, and sends it via Fonnte. Pre-login / public —
// so it is rate-limited and never reveals the OTP or whether send succeeded
// beyond a masked phone hint.
import { db } from "../lib/firebase.js";
import { sendWhatsApp } from "../lib/fonnte.js";
import { applyCors, readBody } from "../lib/cors.js";
import {
  generateOtp, makeSalt, hashOtp, canSend, recordSend,
  normalizeMyPhone, maskPhone, OTP_TTL_MS,
} from "../lib/otp.js";

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    const ic = String(readBody(req).ic ?? "").replace(/[^a-zA-Z0-9]/g, "");
    if (!ic) return res.status(400).json({ error: "ic_required" });

    const firestore = db();
    const staff = await firestore.doc(`staff/${ic}`).get();
    if (!staff.exists) return res.status(404).json({ error: "not_found" });
    if (staff.data().inactive) return res.status(403).json({ error: "inactive" });

    const phone = normalizeMyPhone(staff.data().phone);
    if (!phone) return res.status(422).json({ error: "no_phone" });

    const resetRef = firestore.doc(`password_resets/${ic}`);
    const existing = (await resetRef.get()).data() || null;
    const now = Date.now();

    const gate = canSend(existing, now);
    if (!gate.ok) return res.status(429).json({ error: gate.code, retryAfterMs: gate.retryAfterMs });

    const otp = generateOtp();
    const salt = makeSalt();
    await resetRef.set({
      otpHash: hashOtp(otp, salt),
      salt,
      expiresAt: now + OTP_TTL_MS,
      attempts: 0,
      lastSentAt: now,
      sendTimestamps: recordSend(existing, now),
      createdAt: existing?.createdAt || now,
    });

    const msg =
      `🔐 *KSB Leave — Set Semula Kata Laluan*\n\n` +
      `Kod pengesahan anda: *${otp}*\n\n` +
      `Sah selama 10 minit. JANGAN kongsi kod ini dengan sesiapa.\n` +
      `_Jika anda tidak memintanya, abaikan mesej ini._`;

    const sent = await sendWhatsApp(process.env.FONNTE_TOKEN, phone, msg);
    if (!sent.ok) {
      // Roll back so a failed send doesn't consume the cooldown/attempt window.
      await resetRef.delete().catch(() => {});
      console.error("request-otp send failed for", ic, "→", sent.error);
      if (sent.selfSend) return res.status(422).json({ error: "self_send" });
      return res.status(502).json({ error: "send_failed" });
    }

    return res.status(200).json({ ok: true, phoneHint: maskPhone(phone) });
  } catch (e) {
    console.error("request-otp error:", e);
    return res.status(500).json({ error: "server_error" });
  }
}
