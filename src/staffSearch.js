// Carian staf untuk kotak "Cari staf" di Laporan & Log.
//
// Tiada import DOM/Firebase di sini — boleh diuji unit. Skop (zon HR, Kuantan
// sahaja, cawangan sendiri) ditapis oleh pemanggil SEBELUM senarai sampai ke sini;
// fungsi ini hanya memadankan teks.

const norm = s => String(s || '').toUpperCase();
const digits = s => String(s || '').replace(/\D/g, '');

// Setiap perkataan carian mesti ada dalam nama (ikut apa-apa susunan), ATAU carian
// ialah sebahagian IC (sengkang/ruang diabaikan). Nama yang bermula dengan carian
// disenarai dahulu, kemudian ikut abjad.
export function searchStaff(staff, query, { branch = 'SEMUA', limit = 8 } = {}) {
  const q = norm(query).trim();
  if (!q) return [];
  const words = q.split(/\s+/);
  const qDigits = digits(q);
  const isIcQuery = qDigits.length >= 3 && qDigits.length === q.replace(/[\s-]/g, '').length;

  return (staff || [])
    .filter(s => branch === 'SEMUA' || s.branch === branch)
    .filter(s => isIcQuery
      ? digits(s.ic).includes(qDigits)
      : words.every(w => norm(s.name).includes(w)))
    .sort((a, b) => {
      const pa = norm(a.name).startsWith(q) ? 0 : 1;
      const pb = norm(b.name).startsWith(q) ? 0 : 1;
      return pa - pb || norm(a.name).localeCompare(norm(b.name));
    })
    .slice(0, limit);
}
