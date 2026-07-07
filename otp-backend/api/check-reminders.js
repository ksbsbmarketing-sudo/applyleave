// GET /api/check-reminders  — Vercel Cron job (daily 01:00 UTC = 09:00 MYT).
// Sends WhatsApp reminders to approvers for leave applications that have been
// pending >= OVERDUE_DAYS. Server-side replacement for the old in-browser
// scheduler in src/main.js (which only ran while someone had the app open).
//
// Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` automatically
// when the CRON_SECRET env var is set. We reject anything without it, so the
// public URL cannot be used to trigger reminder blasts.
//
// Dry-run: GET ...?dryRun=1 resolves recipients and returns them WITHOUT
// sending WhatsApp or writing lastReminderSent — for verifying who'd be messaged.
import { db } from "../lib/firebase.js";
import { sendWhatsApp } from "../lib/fonnte.js";
import {
  ROUTING_DEFAULTS, shouldSkipP1, getRoutingP1Approvers,
} from "../lib/routing.js";

const OVERDUE_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const BALOK_HQ = "Klinik Syed Badaruddin Balok (HQ)";
const HR_ROLES = ["hr", "admin", "super_admin"];
const PENDING_STATUSES = ["PENDING", "TL APPROVED", "HOD APPROVED"];

function normPhone(p) {
  let phone = String(p || "").replace(/\D/g, "");
  if (phone.startsWith("0")) phone = "6" + phone;
  return phone;
}

function buildReminderMsg(record, ageDays, peringkat) {
  const stage = peringkat === 1
    ? "Sokongan Peringkat 1 *(HOD / PIC HOD / Supervisor)*"
    : "Kelulusan Akhir Peringkat 2 *(HR / Admin)*";
  return (
    `⏰ *PERINGATAN — KELULUSAN CUTI TERTANGGUH*\n\n` +
    `Permohonan berikut masih menunggu ${stage} selama *${ageDays} hari*:\n\n` +
    `👤 Pemohon : *${record.name}*\n` +
    `🏢 Cawangan : ${record.branch || "—"}\n` +
    `📋 Jenis Cuti : ${record.type || ""}\n` +
    `📅 Tarikh : ${record.startDate} → ${record.endDate}\n` +
    `⏱ Tempoh : ${record.days} hari\n\n` +
    `Sila log masuk dan ambil tindakan segera:\n` +
    `🌐 https://apply-leave-89ebb.web.app\n\n` +
    `_— KSB Leave System (Peringatan Automatik)_`
  );
}

// Resolve the approvers who should be reminded for one overdue record.
// Mirrors the status-based branching of the old client checkOverduePendingReminders.
function resolveRecipients(record, applicant, staffList, branches, approvalRouting) {
  const active = (s) => s && !s.inactive && s.phone;

  if (record.status === "PENDING") {
    if (record.hodIC) {
      // A specific approver was chosen at submission time.
      return staffList.filter((s) => s.ic === record.hodIC && active(s));
    }
    if (record.directHR || (applicant && shouldSkipP1(applicant))) {
      // Straight-to-HR (skip P1).
      return staffList.filter((s) => HR_ROLES.includes(s.role) && active(s));
    }
    // Auto-routed → derive Peringkat-1 approvers.
    if (!applicant) return [];
    return getRoutingP1Approvers(applicant, staffList, branches, approvalRouting).filter(active);
  }

  if (record.status === "TL APPROVED") {
    // Awaiting Balok Supervisor.
    return staffList.filter((s) =>
      s.role === "supervisor" && (s.branch || "").includes("Balok") && active(s));
  }

  if (record.status === "HOD APPROVED") {
    // Awaiting final HR/Admin approval (Peringkat 2).
    return staffList.filter((s) => HR_ROLES.includes(s.role) && active(s));
  }

  return [];
}

export default async function handler(req, res) {
  // Auth guard.
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const dryRun = String(req.query?.dryRun || "") === "1";

  try {
    const firestore = db();

    // Load supporting data once.
    const [staffSnap, branchSnap, routingSnap] = await Promise.all([
      firestore.collection("staff").get(),
      firestore.collection("branches").get(),
      firestore.doc("config/approvalRouting").get(),
    ]);
    const staffList = staffSnap.docs.map((d) => ({ ...d.data(), ic: d.data().ic || d.id }));
    const branches = branchSnap.docs.map((d) => d.data());
    const approvalRouting = routingSnap.exists
      ? { ...ROUTING_DEFAULTS, ...routingSnap.data() }
      : ROUTING_DEFAULTS;

    // Pending leaves only.
    const leavesSnap = await firestore
      .collection("leaves")
      .where("status", "in", PENDING_STATUSES)
      .get();

    const now = Date.now();
    const OVERDUE_MS = OVERDUE_DAYS * DAY_MS;

    const overdue = leavesSnap.docs
      .map((d) => ({ ...d.data(), docId: d.id }))
      .filter((r) => {
        const age = now - (r.id || 0);
        if (age < OVERDUE_MS) return false;
        const lastSent = r.lastReminderSent || 0;
        return now - lastSent >= DAY_MS;
      });

    const summary = { checked: leavesSnap.size, overdue: overdue.length, sent: 0, recipients: [] };

    for (const record of overdue) {
      const ageDays = Math.floor((now - record.id) / DAY_MS);
      const applicant = staffList.find((s) => s.ic === record.ic) || null;
      const recipients = resolveRecipients(record, applicant, staffList, branches, approvalRouting);
      const peringkat = record.status === "HOD APPROVED" ? 2 : 1;

      const sentPhones = new Set();
      const sentNames = [];
      for (const person of recipients) {
        const phone = normPhone(person.phone);
        if (!phone || sentPhones.has(phone)) continue;
        sentPhones.add(phone);
        sentNames.push(person.name || phone);

        if (dryRun) continue;

        const out = await sendWhatsApp(process.env.FONNTE_TOKEN, phone, buildReminderMsg(record, ageDays, peringkat));
        if (out.ok) {
          summary.sent += 1;
          // Keep the in-app WhatsApp log complete.
          await firestore.collection("wa_logs").add({
            ts: now,
            phone,
            name: person.name || phone,
            preview: `Peringatan cuti tertangguh — ${record.name} (${ageDays} hari)`,
            sentBy: "System (Cron)",
            status: "sent",
          }).catch(() => {});
        } else {
          await firestore.collection("wa_logs").add({
            ts: now,
            phone,
            name: person.name || phone,
            preview: `Peringatan cuti tertangguh — ${record.name} (${ageDays} hari)`,
            sentBy: "System (Cron)",
            status: "failed",
            error: out.error || "unknown",
          }).catch(() => {});
        }
      }

      summary.recipients.push({ docId: record.docId, applicant: record.name, ageDays, to: sentNames });

      // Dedupe: mark reminded so it re-sends at most once per 24h.
      if (!dryRun && sentPhones.size > 0) {
        await firestore.doc(`leaves/${record.docId}`).update({ lastReminderSent: now }).catch(() => {});
      }
    }

    return res.status(200).json({ ok: true, dryRun, ...summary });
  } catch (e) {
    console.error("check-reminders error:", e);
    return res.status(500).json({ error: "server_error", message: e.message });
  }
}
