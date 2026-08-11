// Leave-type catalogue and display labels. No Firebase/DOM dependencies so it is
// unit-testable — main.js cannot be, because it imports style.css, Firebase and Chart.js.
//
// SINGLE SOURCE OF TRUTH for what a leave type is CALLED. The `id` values are
// storage codes: they appear in every historical Firestore leave record and in staff
// fields like `ent_EL_EMG`, so they are effectively permanent. Renaming a leave type
// means changing `name` here, never `id`.

export const LEAVE_CATEGORIES = Object.freeze([
  { id: 'AL',     name: 'Annual Leave (AL)',   entitlement: 14, icon: 'icon-al',   color: '#3b82f6', description: 'Cuti Tahunan mengikut pro-rata bulan bekerja.' },
  { id: 'MC',     name: 'Medical Leave (MC)',  entitlement: 14, icon: 'icon-mc',   color: '#10b981', description: 'Cuti Sakit dengan Sijil Sakit (MC) yang sah.' },
  { id: 'EL',     name: 'Cuti Ehsan',          entitlement: 3,  icon: 'icon-el',   color: '#f59e0b', description: 'Cuti Ehsan — kematian keluarga terdekat.' },
  { id: 'EL_EMG', name: 'Cuti Kecemasan',      entitlement: 0,  icon: 'icon-emg',  color: '#ef4444', description: 'Cuti Kecemasan Am (bukan kematian).' },
  { id: 'UP',     name: 'Unpaid Leave (UL)',   entitlement: 0,  icon: 'icon-ul',   color: '#94a3b8', description: 'Cuti Tanpa Gaji (Setelah baki AL habis digunakan).' },
  { id: 'HL',     name: 'Hospitalization (HL)', entitlement: 60, icon: 'icon-hl',  color: '#06b6d4', description: 'Cuti Wad/Hospitalisasi (Maksimum 60 hari).' },
  { id: 'ML',     name: 'Cuti Bersalin',       entitlement: 98, icon: 'icon-ml',   color: '#ec4899', description: 'Cuti Bersalin (98 hari) — kakitangan wanita.' },
  { id: 'ML_PL',  name: 'Cuti Paterniti (PL)', entitlement: 7,  icon: 'icon-mlpl', color: '#6366f1', description: 'Cuti Bapa Isteri Bersalin (7 hari) — kakitangan lelaki.' },
  { id: 'CME',    name: 'Latihan CME',         entitlement: 5,  icon: 'icon-cme',  color: '#8b5cf6', description: 'Cuti Pendidikan Perubatan Berterusan (Doktor sahaja).' },
  { id: 'RL',     name: 'Cuti Ganti',          entitlement: 0,  icon: 'icon-rl',   color: '#14b8a6', description: 'Cuti ganti selepas menghadiri mesyuarat doktor (Doktor sahaja).' },
]);

// Full display names. Derived from the catalogue, plus legacy codes that appear in
// old records but are no longer applied for: PL (superseded by ML_PL) and CF
// (carry-forward, a balance bucket rather than a leave type).
export const LEAVE_TYPE_NAMES = Object.freeze({
  ...Object.fromEntries(LEAVE_CATEGORIES.map(c => [c.id, c.name])),
  PL: 'Cuti Paterniti (PL)',
  CF: 'Cuti Bawa Ke Hadapan (CF)',
});

export function leaveTypeName(code) {
  return LEAVE_TYPE_NAMES[code] || code;
}

// Short codes for table headers and summary chips, where the full name does not fit.
// EL becomes EHSAN because the bare letters read as "Emergency Leave" — EL is Cuti Ehsan
// (bereavement); the general-emergency type is EL_EMG, shown as EMG. Codes absent here
// are shown as-is.
export const LEAVE_TYPE_SHORT = Object.freeze({
  EL:     'EHSAN',
  EL_EMG: 'EMG',
  ML_PL:  'PL',
});

export function leaveTypeShort(code) {
  return LEAVE_TYPE_SHORT[code] || code;
}

// ── Proof requirement ─────────────────────────────────────────────────
// SINGLE SOURCE OF TRUTH for which leave types cannot be submitted without a
// document. Four places in main.js read this: the submit-time block, the file
// input picker, the upload UI renderer, and HR's re-upload button in Master
// Logs. Adding a type here wires up all four — do not re-list codes elsewhere.
//
// Cuti Ganti (RL) is absent ON PURPOSE. See tests/leaveTypes.test.mjs.
//
// `barFrom`/`barTo` colour the section header bar's gradient; `boxColor` is the
// dashed upload box's border, tint and button. The filename and notice element
// ids are derived from `inputId` by swapping the `-upload` suffix.
export const LEAVE_PROOF = Object.freeze({
  MC: Object.freeze({
    inputId:     'mc-upload',
    title:       'Dokumen Wajib',
    hint:        'Sila muat naik MC yang dikeluarkan oleh doktor <strong>(JPG/PNG/PDF, maks 10MB)</strong>',
    buttonLabel: 'PILIH FAIL MC',
    barFrom:     '#10b981',
    barTo:       '#3b82f6',
    boxColor:    '#3b82f6',
    notice:      'MC BELUM DIMUAT NAIK — WAJIB SEBELUM HANTAR',
    error:       '🔴 WAJIB: Sila muat naik Sijil Sakit (MC) yang dikeluarkan oleh doktor sebelum menghantar permohonan.\n\nFormat yang diterima: Gambar (JPG/PNG) atau PDF.',
  }),
  EL: Object.freeze({
    inputId:     'ehsan-upload',
    title:       'Surat Kematian',
    hint:        'Cuti Ehsan hanya untuk kematian ayah, ibu, suami, isteri, atau anak. Had: 3 hari sahaja. <strong>(JPG/PNG/PDF, maks 10MB)</strong>',
    buttonLabel: 'PILIH FAIL',
    barFrom:     '#ef4444',
    barTo:       '#f43f5e',
    boxColor:    '#ef4444',
    notice:      'SURAT KEMATIAN BELUM DIMUAT NAIK — WAJIB SEBELUM HANTAR',
    error:       'MAAF, Borang ditolak. Anda WAJIB memuat naik Salinan Sijil Kematian bagi permohonan Cuti Ehsan.',
  }),
  EL_EMG: Object.freeze({
    inputId:     'emg-upload',
    title:       'Bukti Kecemasan',
    hint:        'Sila muat naik gambar/bukti berkaitan (contoh: gambar banjir, kerosakan kenderaan dll) <strong>(JPG/PNG/PDF, maks 10MB)</strong>',
    buttonLabel: 'PILIH FAIL BUKTI',
    barFrom:     '#ef4444',
    barTo:       '#f97316',
    boxColor:    '#f97316',
    notice:      'BUKTI KECEMASAN BELUM DIMUAT NAIK — WAJIB SEBELUM HANTAR',
    error:       'MAAF, Borang ditolak. Anda WAJIB memuat naik dokumen/gambar bukti bagi permohonan Cuti Kecemasan.',
  }),
  // CME is applied for BEFORE attending, so the attendance certificate does not
  // exist yet — the invitation letter or registration slip is what the doctor has.
  CME: Object.freeze({
    inputId:     'cme-upload',
    title:       'Bukti CME',
    hint:        'Sila muat naik surat jemputan atau slip pendaftaran program CME <strong>(JPG/PNG/PDF, maks 10MB)</strong>',
    buttonLabel: 'PILIH FAIL BUKTI CME',
    barFrom:     '#8b5cf6',
    barTo:       '#a78bfa',
    boxColor:    '#8b5cf6',   // same violet as CME in LEAVE_CATEGORIES
    notice:      'BUKTI CME BELUM DIMUAT NAIK — WAJIB SEBELUM HANTAR',
    error:       '🔴 WAJIB: Sila muat naik surat jemputan atau slip pendaftaran program CME sebelum menghantar permohonan.\n\nFormat yang diterima: Gambar (JPG/PNG) atau PDF.',
  }),
});

export const PROOF_REQUIRED_TYPES = Object.freeze(Object.keys(LEAVE_PROOF));

export function proofRequirement(code) {
  return LEAVE_PROOF[code] || null;
}

// '#3b82f6' → '59,130,246', for building rgba() strings at a chosen alpha.
export function hexToRgbTriple(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}
