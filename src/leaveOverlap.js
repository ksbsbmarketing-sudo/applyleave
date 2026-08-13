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

// Rekod yang SUDAH DILULUSKAN dan bertindih. Sekatan kelulusan guna ini —
// hanya APPROVED yang menghalang, bukan sekadar rekod hidup: dua permohonan
// yang sama-sama MENUNGGU tidak menghalang satu sama lain, kerana HR yang
// memilih mana satu untuk diluluskan dan mana satu untuk ditolak.
export function findApprovedOverlaps(records, ic, startDate, endDate, opts = {}) {
  return findOverlappingLeaves(records, ic, startDate, endDate, opts)
    .filter(r => norm(r.status).toUpperCase() === 'APPROVED');
}

// Semua pertindihan dalam satu koleksi, dikumpulkan sekali gus.
// Map: id rekod → senarai rekod LAIN yang bertindih dengannya.
//
// Wujud untuk PRESTASI, bukan kemudahan. Memanggil overlapsOtherLeaves bagi
// setiap baris Master Logs mengimbas seluruh koleksi bagi SETIAP baris —
// O(n²) pada SETIAP render, dan render() berjalan pada setiap snapshot
// Firestore. Di sini rekod dikumpul ikut `ic` dalam satu laluan, kemudian
// dibandingkan berpasangan dalam setiap staff sahaja (seorang staff ada
// sedikit rekod), jadi kosnya hampir lelurus. Ini pengajaran yang sama yang
// sudah dicatat pada kaunter tab Master Logs dalam main.js.
export function findOverlapGroups(records) {
  // Laluan 1: kumpul rekod hidup yang bertarikh sah, ikut ic.
  const byIc = new Map();
  for (const r of records || []) {
    if (!r) continue;
    // Tanpa id, beberapa rekod akan runtuh ke satu kunci `undefined` yang
    // sama dalam peta keluaran — dan has(r.id) kemudian jadi true untuk
    // SETIAP baris berid undefined, termasuk staf lain. Langkau terus.
    if (r.id == null) continue;
    const ic = norm(r.ic);
    if (!ic) continue;
    if (!isBlockingStatus(r.status)) continue;
    // Rekod tanpa tarikh dilangkau, sama seperti findOverlappingLeaves —
    // rekod lama yang rosak tidak boleh menandakan orang secara palsu.
    if (!norm(r.startDate) || !norm(r.endDate)) continue;
    if (!byIc.has(ic)) byIc.set(ic, []);
    byIc.get(ic).push(r);
  }

  // Laluan 2: berpasangan dalam setiap staff sahaja.
  const out = new Map();
  for (const list of byIc.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (!datesOverlap(norm(a.startDate), norm(a.endDate),
                          norm(b.startDate), norm(b.endDate))) continue;
        if (!out.has(a.id)) out.set(a.id, []);
        if (!out.has(b.id)) out.set(b.id, []);
        out.get(a.id).push(b);
        out.get(b.id).push(a);
      }
    }
  }
  return out;
}
