// Email content for leave status changes, sent to the applicant.
// Pure functions (no I/O) so they can be unit-tested; api/notify-leave-email.js
// does the Firestore reads and the SMTP send.
//
// The email kind is derived from the record's CURRENT status, never from the
// caller, so a caller cannot make the server send a message that is untrue.

const APP_URL = "https://cuti-staff.ksbsb.com.my";

// Keep in sync with leaveCategories in src/main.js (names shown to staff).
const LEAVE_TYPE_NAMES = {
  AL: "Cuti Tahunan (AL)",
  MC: "Cuti Sakit (MC)",
  EL: "Cuti Ehsan",
  EL_EMG: "Cuti Kecemasan",
  UP: "Cuti Tanpa Gaji",
  HL: "Cuti Hospitalisasi",
  ML: "Cuti Bersalin",
  ML_PL: "Cuti Paterniti",
  CME: "Cuti CME",
  RL: "Cuti Ganti",
  CF: "Baki Dibawa (CF)",
};

// status → email kind. PENDING (and anything unknown) sends nothing.
export const STATUS_KIND = {
  "TL APPROVED": "stage_tl",
  "HOD APPROVED": "stage_p1",
  "HOD RECOMMENDED": "stage_p1",
  APPROVED: "approved",
  REJECTED: "rejected",
  CANCELLED: "cancelled",
};

export function kindForStatus(status) {
  return STATUS_KIND[String(status || "")] || null;
}

export function leaveTypeName(code) {
  return LEAVE_TYPE_NAMES[code] || String(code || "-");
}

export function escapeHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const KINDS = {
  stage_tl: {
    subject: "Permohonan cuti anda disokong Team Leader",
    title: "Disokong Team Leader",
    color: "#2563eb",
    icon: "📋",
    lead: (n, by) => `Permohonan cuti anda telah <b>disokong oleh ${by || "Team Leader"}</b>. Ia kini menunggu penilaian Supervisor.`,
  },
  stage_p1: {
    subject: "Permohonan cuti anda disokong Peringkat 1",
    title: "Disokong Peringkat 1",
    color: "#2563eb",
    icon: "📋",
    lead: (n, by) => `Permohonan cuti anda telah <b>dinilai dan disokong${by ? ` oleh ${by}` : ""}</b>. Ia kini menunggu kelulusan akhir HR/Admin.`,
  },
  approved: {
    subject: "✅ Cuti anda telah DILULUSKAN",
    title: "Cuti Diluluskan",
    color: "#059669",
    icon: "✅",
    lead: (n, by) => `Permohonan cuti anda telah <b>DILULUSKAN</b>${by ? ` oleh ${by}` : ""}. Selamat bercuti! 🎉`,
  },
  rejected: {
    subject: "❌ Permohonan cuti anda DITOLAK",
    title: "Cuti Ditolak",
    color: "#dc2626",
    icon: "❌",
    lead: (n, by) => `Maaf, permohonan cuti anda telah <b>DITOLAK</b>${by ? ` oleh ${by}` : ""}. Sila hubungi HR/Admin untuk maklumat lanjut.`,
  },
  cancelled: {
    subject: "🚩 Cuti anda telah DIBATALKAN",
    title: "Cuti Dibatalkan",
    color: "#d97706",
    icon: "🚩",
    lead: (n, by) => `Permohonan cuti anda telah <b>DIBATALKAN</b>${by ? ` oleh ${by}` : ""}. Baki cuti anda telah dikembalikan.`,
  },
};

// record: Firestore leave doc. opts: { recipientName, actorName, isTest, originalName }
export function buildLeaveEmail(record, kind, opts = {}) {
  const k = KINDS[kind];
  if (!k) throw new Error(`unknown email kind: ${kind}`);
  const name = opts.recipientName || record.name || "";
  const by = opts.actorName ? escapeHtml(opts.actorName) : "";
  const type = leaveTypeName(record.type);
  const testTag = opts.isTest ? "[UJIAN] " : "";
  const rows = [
    ["Jenis Cuti", type],
    ["Tarikh", `${record.startDate || "-"} → ${record.endDate || "-"}`],
    ["Tempoh", `${record.days ?? "-"} hari`],
    ["Sebab", record.reason || "-"],
  ];
  const testNote = opts.isTest
    ? `<p style="margin:0 0 16px;padding:10px 12px;border-radius:8px;background:#fffbeb;color:#92400e;font-size:13px;">🧪 E-mel ujian (Mod Test). Asalnya untuk: <b>${escapeHtml(opts.originalName || record.name || "-")}</b></p>`
    : "";

  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f1f5f9;font-family:Segoe UI,Arial,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
    <tr><td style="background:${k.color};padding:20px 24px;color:#fff;">
      <div style="font-size:13px;opacity:.85;">Klinik Syed Badaruddin — Sistem Permohonan Cuti</div>
      <div style="font-size:22px;font-weight:800;margin-top:4px;">${k.icon} ${k.title}</div>
    </td></tr>
    <tr><td style="padding:24px;">
      ${testNote}
      <p style="margin:0 0 12px;font-size:15px;">Salam <b>${escapeHtml(name)}</b>,</p>
      <p style="margin:0 0 18px;font-size:15px;line-height:1.55;">${k.lead(name, by)}</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:12px;font-size:14px;">
        ${rows.map(([l, v], i) => `<tr><td style="padding:10px 14px;color:#64748b;width:120px;${i ? "border-top:1px solid #f1f5f9;" : ""}">${l}</td><td style="padding:10px 14px;font-weight:600;${i ? "border-top:1px solid #f1f5f9;" : ""}">${escapeHtml(v)}</td></tr>`).join("")}
      </table>
      <p style="margin:22px 0 0;"><a href="${APP_URL}" style="display:inline-block;background:#9b2c2c;color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:10px;font-size:14px;">Log masuk ke sistem</a></p>
    </td></tr>
    <tr><td style="padding:14px 24px;background:#f8fafc;color:#94a3b8;font-size:12px;">E-mel automatik daripada KSB Leave System. Jangan balas e-mel ini.</td></tr>
  </table></body></html>`;

  const text = [
    `Salam ${name},`,
    "",
    k.lead(name, opts.actorName || "").replace(/<[^>]+>/g, ""),
    "",
    ...rows.map(([l, v]) => `${l}: ${v}`),
    "",
    `Log masuk: ${APP_URL}`,
    "— KSB Leave System",
  ].join("\n");

  return { subject: `${testTag}${k.subject}`, html, text };
}
