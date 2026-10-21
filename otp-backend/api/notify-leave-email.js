// POST /api/notify-leave-email  { leaveId }   (Authorization: Bearer <idToken>)
// Emails the applicant about their leave's CURRENT status (stage support,
// approved, rejected, cancelled). The browser calls this right after it writes
// the new status; the email kind and content come from the Firestore record,
// not from the caller.
//
// Abuse guards: the caller must be a signed-in, active staff member in the
// same company as the record; each status is emailed at most once per
// RESEND_WINDOW_MS (tracked in leaves/{id}.emailLog); PENDING sends nothing.
// Test records (isTest) go to the caller's own email, never to the applicant.
import { db as getDb, auth as getAuth } from "../lib/firebase.js";
import { applyCors, readBody } from "../lib/cors.js";
import { bearerToken, companyOK } from "../lib/authz.js";
import { buildLeaveEmail, kindForStatus } from "../lib/leaveEmail.js";
import { sendMail as gmailSend, mailConfigured } from "../lib/mailer.js";

export const RESEND_WINDOW_MS = 10 * 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function makeNotifyLeaveEmailHandler(deps) {
  return async function handler(req, res) {
    if (applyCors(req, res)) return;
    if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
    try {
      const { db, auth, sendMail, configured, now } = deps();

      const token = bearerToken(req);
      if (!token) return res.status(401).json({ error: "unauthenticated" });
      let decoded;
      try { decoded = await auth.verifyIdToken(token); }
      catch { return res.status(401).json({ error: "unauthenticated" }); }
      if (typeof decoded.ic !== "string") return res.status(403).json({ error: "forbidden" });
      const callerSnap = await db.doc(`staff/${decoded.ic}`).get();
      if (!callerSnap.exists || callerSnap.data().inactive) return res.status(403).json({ error: "forbidden" });
      const caller = callerSnap.data();

      const leaveId = String(readBody(req).leaveId ?? "");
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(leaveId)) return res.status(400).json({ error: "missing_fields" });
      const ref = db.doc(`leaves/${leaveId}`);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: "not_found" });
      const record = snap.data();
      if (!companyOK({ branch: caller.branch, role: caller.role }, record.branch || "")) {
        return res.status(403).json({ error: "forbidden" });
      }

      const kind = kindForStatus(record.status);
      if (!kind) return res.status(200).json({ sent: false, reason: "no_email_for_status" });

      const logKey = String(record.status).replace(/\s+/g, "_");   // "TL APPROVED" → "TL_APPROVED"
      const last = (record.emailLog || {})[logKey];
      if (last && now() - last < RESEND_WINDOW_MS) return res.status(200).json({ sent: false, reason: "already_sent" });

      let to, recipientName;
      if (record.isTest) {
        to = caller.email; recipientName = caller.name;
      } else {
        const applicant = await db.doc(`staff/${record.ic}`).get();
        const a = applicant.exists ? applicant.data() : {};
        to = a.email; recipientName = a.name || record.name;
      }
      to = String(to || "").trim();
      if (!EMAIL_RE.test(to)) return res.status(200).json({ sent: false, reason: "no_email" });
      if (!configured()) return res.status(200).json({ sent: false, reason: "mail_not_configured" });

      const mail = buildLeaveEmail(record, kind, {
        recipientName, actorName: caller.name, isTest: !!record.isTest, originalName: record.name,
      });
      await sendMail({ to, ...mail });
      await ref.update({ [`emailLog.${logKey}`]: now() });
      return res.status(200).json({ sent: true, kind });
    } catch (e) {
      console.error("notify-leave-email error:", e);
      return res.status(500).json({ error: "server_error" });
    }
  };
}

export default makeNotifyLeaveEmailHandler(() => ({
  db: getDb(), auth: getAuth(), sendMail: gmailSend, configured: mailConfigured, now: Date.now,
}));
