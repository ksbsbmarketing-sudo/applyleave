// Helper paparan Inbox — masa relatif, kumpulan ikut hari, penapis dan ikon jenis.
//
// Dulu Inbox guna emoji (rupa lain ikut telefon), garis tepi pelbagai warna dan
// tarikh penuh pada setiap kad. Logik tulen di sini (tiada DOM/Firebase) supaya
// boleh diuji unit; HTML dibina dalam main.js (case 'inbox').

const DAY_MS = 86400000;
const BULAN = ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ogo', 'Sep', 'Okt', 'Nov', 'Dis'];
const HARI = ['Ahd', 'Isn', 'Sel', 'Rab', 'Kha', 'Jum', 'Sab'];

const pad = (n) => String(n).padStart(2, '0');
const startOfDay = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
// Bilangan hari kalendar antara ts dan now (0 = hari ini, 1 = semalam, …)
const daysAgo = (ts, now) => Math.round((startOfDay(now) - startOfDay(ts)) / DAY_MS);

export const relativeTime = (ts, now = Date.now()) => {
  const d = new Date(ts);
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const days = daysAgo(ts, now);
  if (days <= 0) {
    const mins = Math.floor((now - ts) / 60000);
    if (mins < 1) return 'Baru tadi';
    if (mins < 60) return `${mins} minit lalu`;
    return `${Math.floor(mins / 60)} jam lalu`;
  }
  if (days === 1) return `Semalam ${hm}`;
  if (days < 7) return `${HARI[d.getDay()]} ${hm}`;
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return `${d.getDate()} ${BULAN[d.getMonth()]}${sameYear ? '' : ' ' + d.getFullYear()}`;
};

// Senarai (sudah tersusun terbaru dahulu) → [{ label, items }], kumpulan kosong dibuang.
export const groupNotifs = (list, now = Date.now()) => {
  const groups = [
    { label: 'Hari Ini', items: [] },
    { label: 'Semalam', items: [] },
    { label: 'Minggu Ini', items: [] },
    { label: 'Lebih Awal', items: [] },
  ];
  (list || []).forEach(n => {
    const days = daysAgo(n.createdAt, now);
    groups[days <= 0 ? 0 : days === 1 ? 1 : days < 7 ? 2 : 3].items.push(n);
  });
  return groups.filter(g => g.items.length);
};

export const filterNotifs = (list, filter) =>
  filter === 'unread' ? (list || []).filter(n => !n.read) : (list || []);

// Ikon SVG (laluan dalam viewBox 24) + tona warna, ikut jenis notifikasi.
const PATHS = {
  check: '<polyline points="20 6 9 17 4 12"/>',
  x:     '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  doc:   '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
  down:  '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  step:  '<polyline points="9 18 15 12 9 6"/>',
  bell:  '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  alert: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  info:  '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
};
const KINDS = {
  leave_submitted:   { icon: 'doc',   tone: 'info' },
  leave_approved:    { icon: 'check', tone: 'ok' },
  approval_made:     { icon: 'check', tone: 'ok' },
  leave_rejected:    { icon: 'x',     tone: 'bad' },
  leave_p1_approved: { icon: 'step',  tone: 'warn' },
  leave_tl_approved: { icon: 'step',  tone: 'warn' },
  leave_to_approve:  { icon: 'down',  tone: 'action' },
  reminder_start:    { icon: 'bell',  tone: 'action' },
  reminder_balance:  { icon: 'alert', tone: 'warn' },
  system:            { icon: 'info',  tone: 'muted' },
};

export const notifKind = (type) => {
  const k = KINDS[type] || KINDS.system;
  return { tone: k.tone, svg: PATHS[k.icon] };
};
