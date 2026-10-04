// Sebab permohonan cuti — wajib diisi dengan perkataan sebenar.
//
// Staf sering hantar sebab seperti `""`, `''`, `-` atau `...` sahaja, jadi
// pelulus tidak tahu kenapa cuti dimohon. Sebab mesti ada sekurang-kurangnya
// REASON_MIN_LETTERS huruf (A–Z, termasuk huruf bahasa lain); simbol, nombor
// dan ruang kosong tidak dikira.
//
// Tiada import DOM/Firebase di sini — boleh diuji unit seperti leaveNotice.js.

// 2, bukan 3 — supaya "MC" sahaja diterima (diputuskan 2026-10-04).
export const REASON_MIN_LETTERS = 2;

export const countReasonLetters = (text) =>
  (String(text || '').match(/\p{L}/gu) || []).length;

// Pulangkan mesej ralat, atau null jika sebab sah.
export const validateLeaveReason = (text) => {
  const trimmed = String(text || '').trim();
  if (!trimmed) {
    return '🔴 SEBAB CUTI WAJIB DIISI\n\nSila nyatakan sebab permohonan cuti anda.';
  }
  if (countReasonLetters(trimmed) < REASON_MIN_LETTERS) {
    return '🔴 SEBAB CUTI TIDAK SAH\n\n' +
           'Sebab mesti ditulis dengan perkataan (sekurang-kurangnya ' + REASON_MIN_LETTERS + ' huruf), ' +
           'bukan simbol atau tanda baca sahaja.\n\n' +
           'Contoh: "Demam", "Urusan keluarga", "Balik kampung".';
  }
  return null;
};
