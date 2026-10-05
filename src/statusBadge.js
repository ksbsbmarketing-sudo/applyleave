// Badge status permohonan cuti — satu sumber warna untuk semua skrin.
//
// Dulu setiap skrin ada warna sendiri (PENDING amber / kuning #eab308 / biru,
// malah CANCELLED berwarna hijau macam APPROVED dalam satu jadual). Semua
// paparan status kini melalui statusBadge() supaya warna sama di mana-mana.
//
// Tiada import DOM/Firebase di sini — boleh diuji unit seperti leaveReason.js.

// Varian → kelas CSS .status-badge.is-<varian> (lihat style.css)
//   pending   — menunggu Peringkat 1
//   progress  — lulus separa (HOD/TL), menunggu HR
//   approved  — lulus akhir
//   rejected  — ditolak
//   cancelled — dibatalkan
//   neutral   — status lain / tidak dikenali
export const statusVariant = (status) => {
  const s = String(status || '').trim().toUpperCase();
  if (s === 'APPROVED') return 'approved';
  if (s === 'PENDING') return 'pending';
  if (s === 'REJECTED') return 'rejected';
  if (s === 'CANCELLED') return 'cancelled';
  if (/^(HOD|TL) (APPROVED|RECOMMENDED)$/.test(s)) return 'progress';
  return 'neutral';
};

// Label ringkas untuk ruang sempit (sidebar "Aktiviti Terkini").
export const compactStatusLabel = (status) =>
  String(status || '')
    .replace('TL APPROVED', 'TL OK')
    .replace('HOD APPROVED', 'HOD OK')
    .replace('RECOMMENDED', 'RECOM');

const esc = (s) => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// opts: { compact: label ringkas + saiz kecil, label: teks ganti (contoh "Diluluskan") }
export const statusBadge = (status, opts = {}) => {
  const variant = statusVariant(status);
  const text = opts.label ?? (opts.compact ? compactStatusLabel(status) : String(status || '—'));
  return `<span class="status-badge is-${variant}${opts.compact ? ' sm' : ''}">${esc(text)}</span>`;
};
