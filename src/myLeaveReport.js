// Data untuk "Cetak Semua" dalam Semua Rekod Permohonan (dashboard peribadi).
// HTML cetakan dibina dalam main.js (window.printMyLeaveRecords); logik tulen di
// sini tanpa DOM/Firebase supaya boleh diuji unit.

// Terbaru dahulu ikut tarikh mula cuti; tarikh sama → permohonan terkini (id) dahulu.
export const sortMyRecords = (records) =>
  [...(records || [])].sort((a, b) =>
    String(b.startDate || '').localeCompare(String(a.startDate || '')) || (Number(b.id) || 0) - (Number(a.id) || 0));

const STATUS_MS = {
  'APPROVED': 'Diluluskan',
  'PENDING': 'Menunggu',
  'TL APPROVED': 'Disokong TL',
  'HOD APPROVED': 'Disokong Peringkat 1',
  'REJECTED': 'Ditolak',
  'CANCELLED': 'Dibatalkan',
};
export const statusTextMs = (status) => {
  const s = String(status || '').trim().toUpperCase();
  return STATUS_MS[s] || String(status || '—');
};

// [[jenis, jumlah hari diluluskan], …] — terbanyak dahulu, kemudian ikut abjad jenis.
export const approvedDaysByType = (records) => {
  const totals = {};
  (records || []).forEach(r => {
    if (String(r.status || '').toUpperCase() !== 'APPROVED') return;
    totals[r.type] = (totals[r.type] || 0) + (parseFloat(r.days) || 0);
  });
  return Object.entries(totals).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
};

// Sebab dalam senarai cetakan — dipendekkan supaya satu sebab panjang (cth.
// keterangan program CME) tidak memanjangkan baris hingga separuh muka surat.
// Sebab penuh masih ada dalam borang cetak satu-satu.
export const shortReason = (text, max = 90) => {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return '—';
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + '…';
};
