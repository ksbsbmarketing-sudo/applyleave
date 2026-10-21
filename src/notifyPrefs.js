// Saluran notifikasi kelulusan cuti yang dipilih staf (Tetapan Akaun → Notifikasi).
// staff.notifyChannel: 'whatsapp' | 'email' | 'both'. Tiada nilai = 'both'.
// Ini hanya mengawal mesej kepada PEMOHON tentang cutinya sendiri; mesej kepada
// pelulus (HOD/HR) sentiasa melalui WhatsApp seperti biasa.
//
// ⚠️ SELARI DENGAN otp-backend/api/notify-leave-email.js (sisi e-mel).

export const NOTIFY_CHANNELS = ['whatsapp', 'email', 'both'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email) {
  return EMAIL_RE.test(String(email || '').trim());
}

export function notifyChannelOf(staff) {
  const c = staff && staff.notifyChannel;
  return NOTIFY_CHANNELS.includes(c) ? c : 'both';
}

// WhatsApp kepada pemohon dihantar KECUALI dia pilih e-mel sahaja dan memang ada
// e-mel sah — tanpa e-mel, WhatsApp kekal supaya notifikasi tidak terlepas.
export function wantsWhatsApp(staff) {
  return notifyChannelOf(staff) !== 'email' || !isValidEmail(staff && staff.email);
}
