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
// EL_EMG becomes EMG rather than EL because Cuti Ehsan already owns EL and the two
// sit in adjacent columns. Codes absent here are shown as-is.
export const LEAVE_TYPE_SHORT = Object.freeze({
  EL_EMG: 'EMG',
  ML_PL: 'PL',
});

export function leaveTypeShort(code) {
  return LEAVE_TYPE_SHORT[code] || code;
}
