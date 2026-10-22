// Cawangan tersembunyi — wujud untuk akaun ujian (cth. reviewer Google Play di
// cawangan DEMO), bukan untuk operasi. Hanya Admin / Super Admin yang nampak
// rekodnya; HR dan peranan lain tidak nampak cawangan, staf, cuti, pendaftaran
// atau log audit cawangan ini. Staf DALAM cawangan itu masih nampak rekod
// sendiri, jika tidak akaun ujian tidak boleh berfungsi.
//
// Ini penapis paparan sahaja (firestore.rules tidak diubah) — memadai untuk
// menyorok data ujian daripada laporan dan senarai HR.
//
// Senarai log masuk (sebelum log masuk) sengaja TIDAK ditapis: reviewer perlu
// memilih DEMO di situ.
//
// Tiada import DOM/Firebase di sini — boleh diuji unit seperti notifyPrefs.js.

export const HIDDEN_BRANCHES = ['DEMO'];

const norm = s => String(s == null ? '' : s).trim().toLowerCase();
const HIDDEN = new Set(HIDDEN_BRANCHES.map(norm));

export function isHiddenBranch(branch) {
  return HIDDEN.has(norm(branch));
}

// Admin / Super Admin nampak semua; staf cawangan tersembunyi nampak cawangannya.
export function canSeeHiddenBranches(viewer) {
  if (!viewer) return false;
  if (['admin', 'super_admin'].includes(viewer.role)) return true;
  return isHiddenBranch(viewer.branch);
}

// Buang rekod cawangan tersembunyi. `field` ialah medan nama cawangan
// ('branch' untuk staf/cuti/log, 'name' untuk dokumen cawangan).
export function filterHiddenBranches(records, viewer, field = 'branch') {
  const list = Array.isArray(records) ? records : [];
  if (canSeeHiddenBranches(viewer)) return list;
  return list.filter(r => !(r && isHiddenBranch(r[field])));
}
