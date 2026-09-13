// Polisi notis minimum permohonan cuti — berapa hari lebih awal permohonan
// mesti dihantar sebelum tarikh mula cuti.
//
// Tiada import DOM/Firebase di sini — itulah yang menjadikannya boleh diuji
// unit, sama seperti leaveDays.js dan leaveOverlap.js.
//
// Jadual polisi (dikemas kini 2026-08-24):
//   Staff Admin (mana-mana lokasi) ................................. 3 hari
//   Staff Operasi di CAWANGAN (Pahang & Terengganu) ................ 3 hari  ← polisi baru
//   Staff Operasi di Klinik Syed Badaruddin Balok (HQ) ............. 7 hari
//   Doktor (mana-mana lokasi, termasuk cawangan) ................... 7 hari
//
// Jenis cuti yang tidak boleh dirancang dikecualikan sepenuhnya daripada
// polisi ini — lihat NOTICE_EXEMPT_TYPES / isNoticeExempt() di bawah.

export const NOTICE_DAYS_SHORT = 3;
export const NOTICE_DAYS_LONG  = 7;

// Cuti yang mustahil dirancang lebih awal, jadi syarat notis 3/7 hari tidak
// terpakai langsung:
//   MC      — sakit
//   EL_EMG  — kecemasan
//   EL      — ehsan / kematian
//   CME     — dituntut selepas mesyuarat
//   RL      — cuti ganti, dituntut selepas bekerja
//   HL      — hospitalisasi/masuk wad (ditambah 2026-09-13)
// Pengecualian ini HANYA melonggarkan syarat *bila* boleh mohon. Pelulus dan
// muat naik bukti tetap wajib seperti biasa.
export const NOTICE_EXEMPT_TYPES = Object.freeze(
  ['MC', 'EL_EMG', 'EL', 'CME', 'RL', 'HL']);

export function isNoticeExempt(leaveType) {
  const t = (typeof leaveType === 'string' ? leaveType : '').trim().toUpperCase();
  return t !== '' && NOTICE_EXEMPT_TYPES.includes(t);
}

// Kesan Balok HQ dengan cara yang SAMA seperti getStaffGroup() di main.js:
// padanan substring 'Balok'. Hanya 'Klinik Syed Badaruddin Balok (HQ)' yang
// padan dalam senarai cawangan sebenar — 'Beserah' dsb. tidak.
const HQ_BRANCH_MARKERS = Object.freeze(['Balok', 'Management / HQ']);

function norm(v) {
  return (typeof v === 'string' ? v : '').trim().toLowerCase();
}

// Cawangan = klinik sebenar di luar HQ. Nama kosong TIDAK dikira cawangan:
// tanpa bukti lokasi, polisi yang lebih ketat (7 hari) terpakai.
export function isBranchClinic(branch) {
  const b = (typeof branch === 'string' ? branch : '').trim();
  if (!b) return false;
  return !HQ_BRANCH_MARKERS.some(m => b.toLowerCase().includes(m.toLowerCase()));
}

// Ikut KATEGORI sahaja, bukan jawatan — sama seperti peraturan asal sebelum
// 2026-08-24. Akaun berkategori 'Super Admin' TIDAK dikira Staff Admin.
export function isAdminCategory(staff) {
  const cat = norm(staff && staff.category);
  return cat === 'admin staff' || cat === 'admin';
}

export function getNoticeDays(staff) {
  if (!staff) return NOTICE_DAYS_LONG;

  if (isAdminCategory(staff)) return NOTICE_DAYS_SHORT;

  // Polisi baru: staf operasi di cawangan sahaja. Ikut KATEGORI, bukan
  // jawatan — juru x-ray/sonographer/pemandu berkategori 'Operation Staff'
  // di cawangan turut terpakai.
  if (norm(staff.category) === 'operation staff' && isBranchClinic(staff.branch)) {
    return NOTICE_DAYS_SHORT;
  }

  return NOTICE_DAYS_LONG;
}
