// Semakan pertindihan tarikh cuti — halang staff memohon dua kali untuk
// tarikh yang sama (jenis cuti tidak penting: MC 5-7 Ogos menghalang AL 6 Ogos).
//
// Tiada import DOM/Firebase di sini — itulah yang menjadikannya boleh diuji
// unit, sama seperti leaveDays.js dan masterLogScope.js.
//
// NON_BLOCKING_STATUSES sengaja DENY-LIST, bukan allow-list: status baharu
// yang ditambah kemudian akan menghalang secara lalai, bukan diam-diam
// membuka lubang. Jangan tulis semula sebagai senarai status yang menghalang.

export const NON_BLOCKING_STATUSES = Object.freeze(['REJECTED', 'CANCELLED']);

function norm(v) {
  return typeof v === 'string' ? v.trim() : '';
}

export function isBlockingStatus(status) {
  return !NON_BLOCKING_STATUSES.includes(norm(status).toUpperCase());
}

// Tarikh disimpan 'YYYY-MM-DD', jadi perbandingan string IALAH perbandingan
// tarikh. Tiada `new Date(...)` di sini → tiada kelas pepijat zon waktu.
export function datesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart <= bEnd && bStart <= aEnd;
}

// Rekod hidup milik `ic` yang bertindih dengan [startDate, endDate].
export function findOverlappingLeaves(records, ic, startDate, endDate, opts = {}) {
  const wantIc = norm(ic);
  const start = norm(startDate);
  const end = norm(endDate);
  // Pengesahan input ialah tanggungjawab pemanggil. Modul ini tidak boleh
  // menjadi pengesah kedua yang senyap.
  if (!wantIc || !start || !end) return [];

  const excludeId = opts.excludeId == null ? null : String(opts.excludeId);

  return (records || []).filter(r => {
    if (!r) return false;
    if (norm(r.ic) !== wantIc) return false;
    if (excludeId !== null && String(r.id) === excludeId) return false;
    if (!isBlockingStatus(r.status)) return false;
    const rStart = norm(r.startDate);
    const rEnd = norm(r.endDate);
    // Rekod tanpa tarikh DILANGKAU, bukan dikira bertindih — rekod lama yang
    // rosak tidak boleh mengunci staff daripada memohon selama-lamanya.
    if (!rStart || !rEnd) return false;
    return datesOverlap(start, end, rStart, rEnd);
  });
}

// Adakah rekod ini bertindih dengan rekod HIDUP LAIN milik staff yang sama?
// Digunakan untuk lencana amaran pada kad kelulusan.
export function overlapsOtherLeaves(records, record) {
  if (!record || !isBlockingStatus(record.status)) return [];
  return findOverlappingLeaves(
    records, record.ic, record.startDate, record.endDate, { excludeId: record.id }
  );
}

// Senarai boleh dibaca manusia untuk alert atau lencana. `labelOf` disuntik
// (bukan di-import) supaya modul ini kekal bebas daripada keadaan aplikasi.
export function describeOverlaps(records, labelOf) {
  const label = typeof labelOf === 'function' ? labelOf : (code) => code;
  return (records || []).map(r => {
    const period = r.endDate === r.startDate ? r.startDate : `${r.startDate} → ${r.endDate}`;
    return `• ${label(r.type)} — ${period} (${r.status})`;
  }).join('\n');
}
