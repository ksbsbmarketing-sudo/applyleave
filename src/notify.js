// Toast & dialog pengesahan — ganti alert()/confirm() browser.
//
// alert()/confirm() asal nampak kuno dan dalam APK (TWA) seolah-olah sistem
// rosak. showToast() tidak menyekat; showConfirm() pulangkan Promise<boolean>
// jadi pemanggil mesti `await`.
//
// Toast disimpan sebentar dalam sessionStorage supaya mesej yang dipaparkan
// sejurus sebelum window.location.reload() masih kelihatan selepas muat semula
// (alert() dulu menyekat reload sehingga staf tekan OK).

const STORE_KEY = 'ksb_pending_toasts';
const TITLES = { success: 'Berjaya', error: 'Ralat', warning: 'Perhatian', info: 'Makluman' };

// Teka jenis toast daripada teks mesej (mesej sedia ada sudah guna emoji/kata kunci).
export const classifyToast = (msg) => {
  const s = String(msg || '');
  const lead = s.trimStart().slice(0, 3);
  // Emoji di depan mesej paling boleh dipercayai — semak dahulu.
  if (/[❌⛔🔴🚫]/u.test(lead)) return 'error';
  if (/[✅🎉✔]/u.test(lead)) return 'success';
  if (/[⚠]/u.test(lead)) return 'warning';
  const head = s.slice(0, 80).toLowerCase();
  if (/\b(ralat|gagal|error|tidak sah)\b/.test(head)) return 'error';
  if (/\b(berjaya|disimpan|dihantar|dikemas ?kini|dipadam|diluluskan)\b/.test(head)) return 'success';
  if (/\b(sila|amaran|perhatian|belum|tiada|hanya|tidak)\b/.test(head)) return 'warning';
  return 'info';
};

// Lebih panjang mesej, lebih lama dipaparkan (ralat lebih lama lagi).
export const toastDuration = (msg, type) => {
  const base = Math.min(12000, 3500 + String(msg || '').length * 45);
  return type === 'error' ? base + 2000 : base;
};

const esc = (s) => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ICONS = {
  success: '<path d="M20 6 9 17l-5-5"/>',
  error:   '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/>',
  warning: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  info:    '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
};
const icon = (type) =>
  `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${ICONS[type]}</svg>`;

const readStore = () => {
  try { return JSON.parse(sessionStorage.getItem(STORE_KEY) || '[]'); } catch { return []; }
};
const writeStore = (list) => {
  try { sessionStorage.setItem(STORE_KEY, JSON.stringify(list)); } catch { /* private mode */ }
};

const container = () => {
  let el = document.getElementById('toast-stack');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast-stack';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  return el;
};

const mount = ({ id, msg, type, expires }) => {
  const remaining = expires - Date.now();
  if (remaining <= 0) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `
    <div class="toast-icon">${icon(type)}</div>
    <div class="toast-body"><div class="toast-title">${TITLES[type]}</div><div class="toast-msg">${esc(msg)}</div></div>
    <button class="toast-close" aria-label="Tutup">&times;</button>
    <div class="toast-bar" style="animation-duration:${remaining}ms"></div>`;
  const dismiss = () => {
    writeStore(readStore().filter(t => t.id !== id));
    el.classList.add('toast-out');
    setTimeout(() => el.remove(), 250);
  };
  el.addEventListener('click', dismiss);
  setTimeout(dismiss, remaining);
  container().appendChild(el);
};

// Buang emoji status di depan mesej — ikon toast sudah tunjuk jenisnya.
export const stripLeadEmoji = (msg) =>
  String(msg ?? '').replace(/^\s*(?:[❌⛔🔴🚫✅🎉✔⚠ℹ📲]️?\s*)+/u, '');

export const showToast = (msg, type) => {
  const t = type || classifyToast(msg);
  const entry = { id: Date.now() + Math.random(), msg: stripLeadEmoji(msg), type: t, expires: Date.now() + toastDuration(msg, t) };
  writeStore([...readStore().filter(x => x.expires > Date.now()), entry]);
  if (document.body) mount(entry);
};

// Papar semula toast yang belum tamat (dipanggil sekali semasa app dimuat).
export const restorePendingToasts = () => {
  const live = readStore().filter(t => t.expires > Date.now());
  writeStore(live);
  live.forEach(mount);
};

// opts: { okText, cancelText, danger }
export const showConfirm = (msg, opts = {}) => new Promise((resolve) => {
  const danger = opts.danger ?? /padam|buang|batal|tolak|reset|delete|bypass|tidak boleh dibatalkan/i.test(String(msg));
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML = `
    <div class="confirm-box" role="alertdialog" aria-modal="true">
      <div class="confirm-icon ${danger ? 'is-danger' : ''}">${icon(danger ? 'warning' : 'info')}</div>
      <div class="confirm-msg">${esc(msg)}</div>
      <div class="confirm-actions">
        <button class="confirm-cancel">${esc(opts.cancelText || 'Batal')}</button>
        <button class="confirm-ok ${danger ? 'is-danger' : ''}">${esc(opts.okText || 'Teruskan')}</button>
      </div>
    </div>`;
  let done = false;
  const close = (val) => {
    if (done) return;
    done = true;
    document.removeEventListener('keydown', onKey);
    overlay.classList.add('confirm-out');
    setTimeout(() => overlay.remove(), 180);
    resolve(val);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close(false);
    // Tindakan berbahaya tidak boleh disahkan dengan Enter secara tidak sengaja.
    if (e.key === 'Enter' && !danger) { e.preventDefault(); close(true); }
  };
  overlay.querySelector('.confirm-cancel').onclick = () => close(false);
  overlay.querySelector('.confirm-ok').onclick = () => close(true);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  overlay.querySelector(danger ? '.confirm-cancel' : '.confirm-ok').focus();
});
