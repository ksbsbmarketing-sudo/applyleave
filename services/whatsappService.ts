/**
 * WhatsApp Notification Service — Klinik Syed Badaruddin
 *
 * SENDER NUMBER: +60129444295
 *
 * Menggunakan FONNTE (https://fonnte.com) — servis WA Malaysia.
 * Nombor +60129444295 akan menjadi nombor PENGHANTAR semua notifikasi.
 *
 * ── CARA SETUP FONNTE (Satu Kali Sahaja) ───────────────────────────────────
 *  1. Daftar di https://fonnte.com (percuma/berbayar)
 *  2. Tambah device → Install app Fonnte di telefon +60129444295
 *  3. Imbas QR code → nombor tersambung
 *  4. Pergi Dashboard → API Token → salin token
 *  5. Masukkan token dalam VITE_FONNTE_TOKEN di .env.local
 *
 * Fonnte pricing: ~RM10/bulan untuk 1000 mesej
 *
 * ── FALLBACK: wa.me LINK ────────────────────────────────────────────────────
 * Jika Fonnte belum dikonfigurasi, sistem akan log amaran sahaja.
 * Gunakan buildWALink() untuk jana link manual jika perlu.
 */

export const SENDER_PHONE = '60129444295';

export const FONNTE_TOKEN = import.meta.env.VITE_FONNTE_TOKEN ?? '';
const SYSTEM_URL = import.meta.env.VITE_SYSTEM_URL ?? 'https://ksbsb-leave-tracker.web.app';

const FONNTE_API = 'https://api.fonnte.com/send';

// ── Helper: normalize Malaysian phone numbers ─────────────────────────────
function normalizePhone(phone: string): string {
  let p = phone.replace(/\D/g, '');
  if (p.startsWith('0')) p = '60' + p.slice(1);
  return p;
}

// ── Helper: format tarikh ─────────────────────────────────────────────────
function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('ms-MY', {
      day: '2-digit', month: 'long', year: 'numeric'
    });
  } catch {
    return dateStr;
  }
}

// ── Jenis Cuti ────────────────────────────────────────────────────────────
export const leaveTypeWA: Record<string, string> = {
  AL: 'Cuti Tahunan (AL)',
  MC: 'Cuti Sakit (MC)',
  HL: 'Cuti Hospitalisasi (HL)',
  ML: 'Cuti Bersalin (ML)',
  PL: 'Cuti Isteri Bersalin (PL)',
  EL: 'Cuti Kecemasan (EL)',
  BL: 'Cuti Ehsan (BL)',
  RL: 'Cuti Ganti (RL)',
  UL: 'Cuti Tanpa Gaji (UL)',
  CME: 'CME Leave',
};

// ── FONNTE: Hantar WA dari nombor +60129444295 ────────────────────────────
async function sendFonnte(targetPhone: string, message: string): Promise<boolean> {
  if (!FONNTE_TOKEN) {
    console.warn('[WhatsApp] VITE_FONNTE_TOKEN not set — message skipped for', targetPhone);
    return false;
  }
  try {
    const body = new FormData();
    body.append('target', normalizePhone(targetPhone));
    body.append('message', message);
    body.append('countryCode', '60');

    const res = await fetch(FONNTE_API, {
      method: 'POST',
      headers: { 'Authorization': FONNTE_TOKEN },
      body,
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.status === false) {
      console.warn('[WhatsApp/Fonnte] Gagal hantar:', data);
      return false;
    }
    console.log(`[WhatsApp/Fonnte] Dihantar ke ${normalizePhone(targetPhone)}`);
    return true;
  } catch (err) {
    console.warn('[WhatsApp/Fonnte] Network error:', err);
    return false;
  }
}

// ── wa.me LINK: untuk manual fallback ────────────────────────────────────
export function buildWALink(recipientPhone: string, message: string): string {
  const p = normalizePhone(recipientPhone);
  return `https://wa.me/${p}?text=${encodeURIComponent(message)}`;
}

export function openWA(phone: string, message: string): void {
  window.open(buildWALink(phone, message), '_blank');
}

// ── Fungsi pembantu hantar ke satu penerima ───────────────────────────────
async function sendToRecipient(phone: string, message: string): Promise<boolean> {
  if (!phone) return false;
  return await sendFonnte(phone, message);
}

// =============================================================================
// NOTIFICATION FUNCTIONS — Sender: +60129444295
// =============================================================================

// ── 1. Notify HOD: Staff mohon cuti ──────────────────────────────────────
export async function waNotifyHOD(params: {
  hodPhone: string;
  hodWaKey?: string;
  hodName: string;
  applicantName: string;
  leaveType: string;
  duration: number;
  startDate: string;
  endDate: string;
  reason: string;
  branch: string;
}): Promise<{ auto: boolean; waLink: string }> {
  const type = leaveTypeWA[params.leaveType] ?? params.leaveType;
  const msg =
    `🏥 *KLINIK SYED BADARUDDIN*\n` +
    `📋 *PERMOHONAN CUTI BAHARU*\n\n` +
    `👤 Pemohon: *${params.applicantName}*\n` +
    `🏢 Cawangan: ${params.branch}\n` +
    `📅 Jenis: *${type}*\n` +
    `⏳ Tempoh: *${params.duration} hari*\n` +
    `📆 Dari: ${formatDate(params.startDate)}\n` +
    `📆 Hingga: ${formatDate(params.endDate)}\n` +
    `💬 Sebab: ${params.reason}\n\n` +
    `Sila log masuk untuk lulus/tolak:\n` +
    `🔗 ${SYSTEM_URL}`;

  const auto = await sendToRecipient(params.hodPhone, msg);
  return { auto, waLink: buildWALink(params.hodPhone, msg) };
}

// ── 2. Notify Admin: HOD telah lulus ─────────────────────────────────────
export async function waNotifyAdmin(params: {
  adminPhone: string;
  adminWaKey?: string;
  adminName: string;
  applicantName: string;
  leaveType: string;
  duration: number;
  startDate: string;
  endDate: string;
  hodName: string;
  branch: string;
}): Promise<{ auto: boolean; waLink: string }> {
  const type = leaveTypeWA[params.leaveType] ?? params.leaveType;
  const msg =
    `🏥 *KLINIK SYED BADARUDDIN*\n` +
    `✅ *HOD TELAH MELULUSKAN CUTI*\n\n` +
    `👤 Pemohon: *${params.applicantName}*\n` +
    `🏢 Cawangan: ${params.branch}\n` +
    `📅 Jenis: *${type}*\n` +
    `⏳ Tempoh: *${params.duration} hari*\n` +
    `📆 Dari: ${formatDate(params.startDate)}\n` +
    `📆 Hingga: ${formatDate(params.endDate)}\n` +
    `👨‍💼 HOD: ${params.hodName}\n\n` +
    `⚠️ Menunggu kelulusan *ADMIN*.\n` +
    `🔗 ${SYSTEM_URL}`;

  const auto = await sendToRecipient(params.adminPhone, msg);
  return { auto, waLink: buildWALink(params.adminPhone, msg) };
}

// ── 3. Notify Applicant: Keputusan akhir ─────────────────────────────────
export async function waNotifyApplicant(params: {
  applicantPhone: string;
  applicantWaKey?: string;
  applicantName: string;
  leaveType: string;
  duration: number;
  startDate: string;
  endDate: string;
  status: 'approved' | 'rejected';
  approvedBy: string;
  rejectionReason?: string;
  remainingBalance?: number;
}): Promise<{ auto: boolean; waLink: string }> {
  const type = leaveTypeWA[params.leaveType] ?? params.leaveType;
  const isApproved = params.status === 'approved';
  const statusIcon = isApproved ? '✅' : '❌';
  const statusText = isApproved ? 'DILULUSKAN' : 'DITOLAK';

  const msg =
    `🏥 *KLINIK SYED BADARUDDIN*\n` +
    `${statusIcon} *PERMOHONAN CUTI ${statusText}*\n\n` +
    `👤 Nama: *${params.applicantName}*\n` +
    `📅 Jenis: *${type}*\n` +
    `⏳ Tempoh: *${params.duration} hari*\n` +
    `📆 Dari: ${formatDate(params.startDate)}\n` +
    `📆 Hingga: ${formatDate(params.endDate)}\n` +
    `👨‍💼 Oleh: ${params.approvedBy}\n` +
    (isApproved && params.remainingBalance !== undefined
      ? `📝 Baki Cuti Terkini: *${params.remainingBalance} hari*\n`
      : '') +
    (params.rejectionReason ? `\n📝 Sebab Tolak: ${params.rejectionReason}\n` : '') +
    `\n🔗 ${SYSTEM_URL}`;

  const auto = await sendToRecipient(params.applicantPhone, msg);
  return { auto, waLink: buildWALink(params.applicantPhone, msg) };
}

// ── 4. Notify Applicant: HOD telah luluskan — tunggu Admin ───────────────
export async function waNotifyApplicantHODApproved(params: {
  applicantPhone: string;
  applicantName: string;
  leaveType: string;
  duration: number;
  startDate: string;
  endDate: string;
  hodName: string;
}): Promise<{ auto: boolean; waLink: string }> {
  const type = leaveTypeWA[params.leaveType] ?? params.leaveType;
  const msg =
    `🏥 *KLINIK SYED BADARUDDIN*\n` +
    `🟡 *CUTI DILULUSKAN HOD — MENUNGGU ADMIN*\n\n` +
    `👤 Nama: *${params.applicantName}*\n` +
    `📅 Jenis: *${type}*\n` +
    `⏳ Tempoh: *${params.duration} hari*\n` +
    `📆 Dari: ${formatDate(params.startDate)}\n` +
    `📆 Hingga: ${formatDate(params.endDate)}\n` +
    `👨‍💼 Diluluskan HOD: ${params.hodName}\n\n` +
    `⏳ Permohonan anda sedang menunggu kelulusan ADMIN.\n` +
    `🔗 ${SYSTEM_URL}`;

  const auto = await sendToRecipient(params.applicantPhone, msg);
  return { auto, waLink: buildWALink(params.applicantPhone, msg) };
}
