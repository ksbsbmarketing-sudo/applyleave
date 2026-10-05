// Paparan "tiada data" dan skeleton loading — dikongsi semua skrin.
//
// Dulu jadual kosong cuma tunjuk teks kecil "Tiada rekod" (nampak macam ralat),
// dan sebelum data Firestore sampai, kad statistik tunjuk 0 — staf sangka baki
// cuti mereka kosong. Tiada import DOM/Firebase di sini — boleh diuji unit.

const esc = (s) => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ICONS = {
  inbox:    '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  check:    '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  search:   '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  users:    '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  file:     '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
};

// opts: { icon, title, text, action: { label, onclick }, compact }
// `action.onclick` ialah kod JS inline (dipercayai, ditulis dalam kod — bukan input pengguna).
export const emptyState = (opts = {}) => {
  const icon = ICONS[opts.icon] || ICONS.inbox;
  return `<div class="empty-state${opts.compact ? ' compact' : ''}">
    <div class="empty-state-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${icon}</svg></div>
    ${opts.title ? `<div class="empty-state-title">${esc(opts.title)}</div>` : ''}
    ${opts.text ? `<div class="empty-state-text">${esc(opts.text)}</div>` : ''}
    ${opts.action ? `<button class="btn-primary empty-state-action" onclick="${opts.action.onclick}">${esc(opts.action.label)}</button>` : ''}
  </div>`;
};

// Baris jadual kosong: <tr><td colspan=N>…</td></tr>
export const emptyRow = (colspan, opts) =>
  `<tr><td colspan="${Number(colspan) || 1}" style="padding:0;">${emptyState({ compact: true, ...opts })}</td></tr>`;

// Rangka dashboard semasa data cuti belum sampai dari Firestore.
export const dashboardSkeleton = () => `
  <div class="skeleton-wrap" aria-busy="true" aria-label="Memuatkan data">
    <div class="sk sk-title"></div>
    <div class="sk-grid">${'<div class="sk sk-card"></div>'.repeat(4)}</div>
    <div class="sk-panel">
      ${'<div class="sk-row"><div class="sk sk-dot"></div><div class="sk sk-line"></div><div class="sk sk-pill"></div></div>'.repeat(5)}
    </div>
  </div>`;
