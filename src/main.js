import './style.css'
import { countLeaveDays } from './leaveDays.js';
import { recordBalances } from './leaveBalance.js';
import { loadSectionState, toggleSection, saveSectionState, isOpen as isMsgSectionOpen } from './msgSections.js';
import { applyEmoticons } from './emoticons.js';
import { PRESENCE_STATUSES, DEFAULT_STATUS, getStatusMeta, resolveStatus, isVisibleToOthers, normalizeMood } from './presenceStatus.js';
import { Chart, registerables } from 'chart.js';
Chart.register(...registerables);

import { initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";
import {
  getAuth,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
  EmailAuthProvider,
  reauthenticateWithCredential,
} from "firebase/auth";
import { getFunctions, httpsCallable } from "firebase/functions";
import { getAnalytics } from "firebase/analytics";
import {
  getFirestore,
  collection,
  onSnapshot,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  getDocs,
  writeBatch,
  query,
  where,
  orderBy,
  limit,
  documentId
} from "firebase/firestore";

// ── Reload-loop circuit breaker ─────────────────────────────────────────────
// If the page reloads itself many times in a few seconds (e.g. a stale service
// worker fighting a fresh deploy), break out: unregister service workers, clear
// caches, and show a one-tap recovery screen. It NEVER auto-reloads (that could
// re-loop) — recovery is a single user tap.
(function reloadLoopGuard() {
  try {
    const KEY = 'ksb_reload_ts', WINDOW_MS = 10000, MAX = 4;
    const now = Date.now();
    let stamps = [];
    try { stamps = JSON.parse(sessionStorage.getItem(KEY) || '[]'); } catch (_) {}
    stamps = stamps.filter(t => now - t < WINDOW_MS);
    stamps.push(now);
    sessionStorage.setItem(KEY, JSON.stringify(stamps));
    if (stamps.length < MAX) return;

    sessionStorage.removeItem(KEY); // reset so recovery isn't itself looped
    window.__reloadGuardTripped = true; // tells SW registration below to stand down
    console.warn('[reload-guard] reload loop detected — clearing service worker & caches');
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister())).catch(() => {});
    }
    if (window.caches && caches.keys) {
      caches.keys().then(keys => keys.forEach(k => caches.delete(k))).catch(() => {});
    }
    window.addEventListener('load', () => {
      if (document.getElementById('reload-guard-screen')) return;
      const s = document.createElement('div');
      s.id = 'reload-guard-screen';
      s.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#0f172a;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1.1rem;padding:2rem;text-align:center;font-family:Arial,sans-serif;';
      s.innerHTML = '<div style="font-size:1.15rem;font-weight:800;">✅ Cache lama dibersihkan</div>'
        + '<div style="font-size:0.9rem;color:#94a3b8;max-width:340px;line-height:1.5;">App tadi asyik muat semula kerana versi lama tersimpan dalam peranti. Ia sudah dibuang — tekan butang ini SEKALI untuk muat versi terkini.</div>'
        + '<button id="reload-guard-btn" style="background:#3b82f6;color:#fff;border:none;padding:0.85rem 1.7rem;border-radius:10px;font-weight:700;font-size:0.95rem;cursor:pointer;">Muat Versi Terkini</button>';
      document.body.appendChild(s);
      document.getElementById('reload-guard-btn').onclick = () => { try { sessionStorage.removeItem(KEY); } catch (_) {} location.reload(); };
    });
  } catch (_) { /* the guard must never break the app */ }
})();

const firebaseConfig = {
  apiKey: "AIzaSyDgGOyIRt3GdFM2JT8zHO3F_54HyxAS80U",
  authDomain: "apply-leave-89ebb.firebaseapp.com",
  projectId: "apply-leave-89ebb",
  storageBucket: "apply-leave-89ebb.firebasestorage.app",
  messagingSenderId: "803645713756",
  appId: "1:803645713756:web:f03a77fe607ce67381e599",
  measurementId: "G-LN4G3MGWXX"
};

const firebaseApp = initializeApp(firebaseConfig);

// App Check (reCAPTCHA v3) — pastikan hanya app ini boleh akses backend Firebase.
// Site key selamat didedah (ia memang untuk klien). Init di-skip selagi placeholder
// belum diganti, supaya deploy tidak pecah sebelum App Check disediakan di console.
const RECAPTCHA_V3_SITE_KEY = '6LdGQhUtAAAAAJlrLhFFMQ-cDERPTcbgdbzpSAga';
if (RECAPTCHA_V3_SITE_KEY && !RECAPTCHA_V3_SITE_KEY.startsWith('__')) {
  try {
    initializeAppCheck(firebaseApp, {
      provider: new ReCaptchaV3Provider(RECAPTCHA_V3_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (e) { console.error('App Check init failed:', e); }
}

const db = getFirestore(firebaseApp);
const auth = getAuth(firebaseApp);
const analytics = getAnalytics(firebaseApp);
const functions = getFunctions(firebaseApp);

// Cloudinary — hos bukti cuti (MC / Kecemasan / Ehsan). Firebase Storage TIDAK
// diaktifkan untuk projek ni (perlu Blaze), jadi bukti dimuat naik ke Cloudinary
// melalui "unsigned upload" (tiada backend/rahsia perlu — preset selamat didedah).
const CLOUDINARY_CLOUD_NAME = 'dgm3fozmu';
const CLOUDINARY_UPLOAD_PRESET = 'l1mrxwdx';
const AUTH_EMAIL_DOMAIN = 'ksb-leave.local';
const emailForIC = (ic) => `${String(ic).replace(/[^a-zA-Z0-9]/g, '')}@${AUTH_EMAIL_DOMAIN}`;

// Base URL of the free (no-Blaze) WhatsApp OTP password-reset backend on Vercel.
// Set this to the deployed Vercel URL (e.g. 'https://ksb-otp.vercel.app').
// While empty, "Lupa Kata Laluan?" tells the user the feature isn't configured yet.
const OTP_API_BASE = 'https://otp-backend-ochre.vercel.app';

// Pre-login directory (branch + name + ic) loaded under the anonymous bootstrap session.
let directoryList = [];
async function loadDirectory() {
  try {
    const snap = await getDocs(collection(db, 'directory'));
    directoryList = snap.docs.map(d => d.data()).filter(s => !s.inactive);
  } catch (e) { console.error('loadDirectory failed:', e); directoryList = []; }
}

const app = document.querySelector('#app')

// ============================================================
// WHATSAPP NOTIFICATION CONFIG (Fonnte.com)
// Daftar di: https://fonnte.com → sambungkan no. 0129444295
// ============================================================
let WHATSAPP_TOKEN = localStorage.getItem('ksb_wa_token') || '';
const WHATSAPP_SENDER = '60129444295'; // No. penghantar
const WHATSAPP_ENABLED = () => !!WHATSAPP_TOKEN;
// Nombor peranti penghantar Fonnte (cth. 60178998771). Diisi dari /device.
// WhatsApp tak boleh hantar kepada nombornya sendiri — kita guna ini untuk kesan & elak.
let WHATSAPP_DEVICE = '';
async function refreshWADevice() {
  if (!WHATSAPP_TOKEN) { WHATSAPP_DEVICE = ''; return; }
  try {
    const res = await fetch('https://api.fonnte.com/device', {
      method: 'POST', headers: { 'Authorization': WHATSAPP_TOKEN }
    });
    const d = await res.json();
    if (d && d.device) WHATSAPP_DEVICE = String(d.device).replace(/\D/g, '');
  } catch(_) { /* abaikan — guard self-send sekadar lapisan tambahan */ }
}

window.sendWhatsApp = async function(toPhone, message, throwOnError = false) {
  if (!WHATSAPP_ENABLED() || !toPhone) return;
  let phone = toPhone.replace(/\D/g, '');
  if (phone.startsWith('0')) phone = '6' + phone;

  const recipient = staffList.find(s => (s.phone || '').replace(/\D/g, '').replace(/^0/, '6') === phone);
  const logBase = {
    ts: Date.now(),
    phone,
    name: recipient ? recipient.name : phone,
    preview: message.replace(/[*_[\]]/g, '').replace(/\n/g, ' ').trim().substring(0, 120),
    sentBy: (typeof user !== 'undefined' && user) ? user.name : 'System',
  };

  let logStatus = 'sent', logErr = null;
  try {
    if (WHATSAPP_DEVICE && phone === WHATSAPP_DEVICE) {
      // Target = nombor peranti penghantar Fonnte sendiri. Fonnte akan pulangkan
      // status:true (queue) tetapi WhatsApp TIDAK boleh hantar kepada diri sendiri,
      // jadi mesej tak sampai. Log sebagai gagal supaya jelas, jangan tipu "sent".
      logStatus = 'failed';
      logErr = `Nombor penerima (${phone}) sama dengan nombor peranti penghantar Fonnte — WhatsApp tidak boleh hantar kepada diri sendiri. Guna nombor penghantar berasingan untuk sistem.`;
      if (throwOnError) throw new Error(logErr);
    } else {
      const res = await fetch('https://api.fonnte.com/send', {
        method: 'POST',
        headers: { 'Authorization': WHATSAPP_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: phone, message, countryCode: '60' })
      });
      let body = null;
      try { body = await res.json(); } catch(_) { /* respons bukan JSON */ }
      if (!res.ok) {
        logStatus = 'failed';
        logErr = `Fonnte HTTP ${res.status} — token mungkin tidak sah atau kuota habis`;
      } else if (body && body.status === false) {
        // Fonnte boleh pulangkan HTTP 200 dengan status:false (gagal sebenar) —
        // sebelum ini app tersilap log sebagai "sent".
        logStatus = 'failed';
        logErr = 'Fonnte gagal hantar: ' + (body.reason || JSON.stringify(body).substring(0, 140));
      }
      if (throwOnError && logStatus === 'failed') throw new Error(logErr || `Fonnte error: ${res.status}`);
    }
  } catch(err) {
    logStatus = 'failed';
    if (!logErr) logErr = err.message.includes('fetch') ? 'Tiada sambungan internet / Fonnte tidak dapat dihubungi' : err.message;
    if (throwOnError) throw err;
    console.warn('WhatsApp notification failed:', err);
  } finally {
    const entry = { ...logBase, status: logStatus };
    if (logErr) entry.error = logErr;
    addDoc(collection(db, 'wa_logs'), entry)
      .then(ref => {
        waLogs.unshift({ id: ref.id, ...entry });
        if (waLogs.length > 200) waLogs.pop();
        if (typeof user !== 'undefined' && user && managementTab === 'whatsapp_settings') render();
      })
      .catch(() => {});
  }
};

window.clearWALogs = async function() {
  if (!confirm('Padam semua log notifikasi WhatsApp? Tindakan ini tidak boleh dibatalkan.')) return;
  try {
    const snap = await getDocs(collection(db, 'wa_logs'));
    if (snap.empty) { alert('Tiada log untuk dipadam.'); return; }
    let batch = writeBatch(db), count = 0;
    const commits = [];
    snap.docs.forEach(d => {
      batch.delete(d.ref);
      if (++count % 500 === 0) { commits.push(batch.commit()); batch = writeBatch(db); }
    });
    if (count % 500 !== 0) commits.push(batch.commit());
    await Promise.all(commits);
    waLogs = [];
    render();
    alert('✅ Log WhatsApp berjaya dipadam.');
  } catch(e) { alert('Ralat memadam log: ' + e.message); }
};

window.saveWAToken = async function(token) {
  WHATSAPP_TOKEN = token;
  localStorage.setItem('ksb_wa_token', token);
  refreshWADevice(); // kemas kini nombor peranti untuk guard self-send
  try {
    await setDoc(doc(db, 'system_config', 'whatsapp'), { token });
  } catch(e) {
    console.warn('Failed to save WA token to Firestore:', e);
  }
  alert('✅ Token WhatsApp berjaya disimpan!');
};

// Self-service password reset via WhatsApp OTP. Runs pre-login, so it talks to
// the external (no-Blaze) backend at OTP_API_BASE — the browser cannot reset a
// forgotten Firebase Auth password itself. See otp-backend/.
const OTP_ERR_MS = {
  not_found: 'No. IC tidak dijumpai dalam sistem. Sila pilih nama anda dari senarai.',
  inactive: 'Akaun anda tidak aktif. Sila hubungi HR/Admin.',
  no_phone: 'Tiada nombor WhatsApp berdaftar untuk anda. Sila hubungi HR/Admin untuk set semula.',
  self_send: 'Nombor anda ialah nombor penghantar sistem, jadi OTP tidak boleh dihantar kepadanya. Sila hubungi IT untuk set semula kata laluan.',
  cooldown: 'Kod baru sahaja dihantar. Sila tunggu seminit sebelum meminta lagi.',
  rate_limited: 'Terlalu banyak permintaan. Sila cuba semula dalam satu jam atau hubungi HR/Admin.',
  send_failed: 'Gagal menghantar WhatsApp. Sila cuba lagi atau hubungi HR/Admin.',
  missing_fields: 'Sila masukkan kod OTP.',
  weak_password: 'Kata laluan mesti sekurang-kurangnya 6 aksara.',
  expired: 'Kod OTP telah tamat tempoh. Sila minta kod baharu.',
  too_many_attempts: 'Terlalu banyak percubaan salah. Sila minta kod baharu.',
  no_request: 'Tiada permintaan reset aktif. Sila minta kod dahulu.',
  no_account: 'Akaun log masuk tidak dijumpai. Sila hubungi HR/Admin.',
  server_error: 'Ralat sistem. Sila cuba lagi sebentar.',
};
const otpErrMsg = (data) => OTP_ERR_MS[data && data.error] || 'Ralat tidak dijangka. Sila cuba lagi.';

async function otpPost(path, payload) {
  const res = await fetch(`${OTP_API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  let data = {};
  try { data = await res.json(); } catch { /* non-JSON */ }
  return { ok: res.ok, status: res.status, data };
}

window.forgotPassword = async function() {
  const ic = (document.querySelector('#login-staff')?.value || selectedLoginStaffIC || '').trim();
  if (!ic) { alert('Sila pilih nama anda dari senarai (dropdown) dahulu, kemudian tekan "Lupa Kata Laluan?".'); return; }
  if (!OTP_API_BASE) {
    alert('ℹ️ Set semula kata laluan sendiri belum diaktifkan. Sila hubungi HR/Admin untuk reset kata laluan anda.');
    return;
  }

  // Build a self-contained overlay (no dependency on the render() pipeline).
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.55);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;z-index:99999;padding:1rem;';
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.body.appendChild(overlay);

  const card = (inner) => `
    <div style="background:var(--bg,#fff);border-radius:18px;max-width:380px;width:100%;padding:1.6rem;box-shadow:0 24px 60px rgba(0,0,0,0.35);">
      <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.4rem;">
        <span style="font-size:1.3rem;">🔐</span>
        <h3 style="margin:0;font-size:1.05rem;font-weight:800;color:var(--text,#0f172a);">Set Semula Kata Laluan</h3>
      </div>
      ${inner}
    </div>`;
  const note = (msg, color) => `<div id="otp-note" style="margin-top:0.8rem;font-size:0.78rem;font-weight:600;color:${color};min-height:1.1rem;">${msg || ''}</div>`;
  const btn = (id, label, bg) => `<button id="${id}" style="flex:1;padding:0.7rem;border:none;border-radius:10px;background:${bg};color:#fff;font-weight:800;font-size:0.85rem;cursor:pointer;">${label}</button>`;
  const ghost = `<button id="otp-cancel" style="flex:1;padding:0.7rem;border:1px solid rgba(148,163,184,0.4);border-radius:10px;background:transparent;color:var(--text-muted,#64748b);font-weight:700;font-size:0.85rem;cursor:pointer;">Batal</button>`;
  const field = 'width:100%;padding:0.7rem;border-radius:10px;border:1px solid rgba(148,163,184,0.4);font-size:0.9rem;box-sizing:border-box;';

  const renderStep1 = () => {
    overlay.innerHTML = card(`
      <p style="font-size:0.82rem;color:var(--text-muted,#64748b);margin:0.3rem 0 0;">Kami akan menghantar kod pengesahan (OTP) ke nombor WhatsApp anda yang berdaftar dengan HR.</p>
      ${note('', '#ef4444')}
      <div style="display:flex;gap:0.6rem;margin-top:1rem;">${ghost}${btn('otp-send', 'Hantar Kod', 'linear-gradient(135deg,#3b82f6,#2563eb)')}</div>
    `);
    overlay.querySelector('#otp-cancel').onclick = close;
    overlay.querySelector('#otp-send').onclick = async () => {
      const sendBtn = overlay.querySelector('#otp-send');
      const noteEl = overlay.querySelector('#otp-note');
      sendBtn.disabled = true; sendBtn.textContent = 'Menghantar…';
      try {
        const r = await otpPost('/api/request-otp', { ic });
        if (r.ok && r.data.ok) { renderStep2(r.data.phoneHint || ''); return; }
        noteEl.textContent = '⚠️ ' + otpErrMsg(r.data);
      } catch {
        noteEl.textContent = '⚠️ Tiada sambungan internet. Sila cuba lagi.';
      }
      sendBtn.disabled = false; sendBtn.textContent = 'Hantar Kod';
    };
  };

  const renderStep2 = (phoneHint) => {
    overlay.innerHTML = card(`
      <p style="font-size:0.82rem;color:var(--text-muted,#64748b);margin:0.3rem 0 0.9rem;">Kod telah dihantar ke WhatsApp <strong>${phoneHint}</strong>. Masukkan kod dan kata laluan baharu anda.</p>
      <div style="display:flex;flex-direction:column;gap:0.6rem;">
        <input id="otp-code" inputmode="numeric" maxlength="6" placeholder="Kod 6 digit" style="${field}letter-spacing:0.3em;text-align:center;font-weight:700;">
        <input id="otp-pw1" type="password" placeholder="Kata laluan baharu (min 6 aksara)" style="${field}">
        <input id="otp-pw2" type="password" placeholder="Sahkan kata laluan baharu" style="${field}">
      </div>
      ${note('', '#ef4444')}
      <div style="display:flex;gap:0.6rem;margin-top:1rem;">${ghost}${btn('otp-confirm', 'Set Semula', 'linear-gradient(135deg,#10b981,#059669)')}</div>
      <button id="otp-resend" style="margin-top:0.7rem;width:100%;background:none;border:none;color:var(--primary,#3b82f6);font-size:0.78rem;font-weight:600;cursor:pointer;text-decoration:underline;">Hantar semula kod</button>
    `);
    overlay.querySelector('#otp-cancel').onclick = close;
    overlay.querySelector('#otp-resend').onclick = renderStep1;
    overlay.querySelector('#otp-confirm').onclick = async () => {
      const noteEl = overlay.querySelector('#otp-note');
      const otp = overlay.querySelector('#otp-code').value.trim();
      const pw1 = overlay.querySelector('#otp-pw1').value;
      const pw2 = overlay.querySelector('#otp-pw2').value;
      if (!otp) { noteEl.textContent = '⚠️ Sila masukkan kod OTP.'; return; }
      if (pw1.length < 6) { noteEl.textContent = '⚠️ Kata laluan mesti sekurang-kurangnya 6 aksara.'; return; }
      if (pw1 !== pw2) { noteEl.textContent = '⚠️ Kata laluan tidak sepadan.'; return; }
      const cBtn = overlay.querySelector('#otp-confirm');
      cBtn.disabled = true; cBtn.textContent = 'Menyimpan…';
      try {
        const r = await otpPost('/api/confirm-otp', { ic, otp, newPassword: pw1 });
        if (r.ok && r.data.ok) {
          close();
          alert('✅ Kata laluan anda telah ditetapkan semula. Sila log masuk dengan kata laluan baharu.');
          const pf = document.querySelector('#password'); if (pf) pf.value = '';
          return;
        }
        if (r.data.error === 'mismatch') noteEl.textContent = `⚠️ Kod OTP salah. Baki percubaan: ${r.data.attemptsLeft ?? '?'}.`;
        else noteEl.textContent = '⚠️ ' + otpErrMsg(r.data);
      } catch {
        noteEl.textContent = '⚠️ Tiada sambungan internet. Sila cuba lagi.';
      }
      cBtn.disabled = false; cBtn.textContent = 'Set Semula';
    };
  };

  renderStep1();
};

window.testWANotification = async function() {
  const phone = document.getElementById('wa-test-phone')?.value;
  if (!phone) return alert('Sila masukkan nombor telefon untuk ujian.');
  if (!WHATSAPP_TOKEN) return alert('Sila simpan token Fonnte dahulu.');
  await window.sendWhatsApp(phone, `✅ *Ujian Notifikasi KSB Leave Apply*\n\nSistem notifikasi WhatsApp berfungsi dengan baik.\n\n\n🔗 *Log masuk:* https://apply-leave-89ebb.web.app\n_— KSB Leave System_`);
  alert('Mesej ujian telah dihantar ke ' + phone);
};

window.setWaSettingsSubTab = function(tab) {
  waSettingsSubTab = tab;
  render();
};

window.toggleWaNotifRole = function(zone, trigger, role) {
  const arr = waNotifRbac[zone][trigger] || [];
  const idx = arr.indexOf(role);
  if (idx === -1) arr.push(role);
  else arr.splice(idx, 1);
  waNotifRbac[zone][trigger] = arr;
  render();
};

window.saveWaNotifRbac = async function(zone) {
  try {
    await setDoc(doc(db, 'system_config', 'wa_notif_rbac'), { [zone]: waNotifRbac[zone] }, { merge: true });
    const btn = document.getElementById('save-rbac-' + zone);
    if (btn) { btn.textContent = '✅ Tersimpan'; btn.disabled = true; }
    setTimeout(() => render(), 1500);
  } catch(e) { alert('Ralat menyimpan: ' + e.message); }
};

// ============================================================
// PENGINGAT KELULUSAN TERTANGGUH (7 hari)
// ============================================================
let reminderCheckInterval = null;

function buildReminderMsg(record, ageDays, peringkat) {
  const stage = peringkat === 1
    ? 'Sokongan Peringkat 1 *(HOD / PIC HOD / Supervisor)*'
    : 'Kelulusan Akhir Peringkat 2 *(HR / Admin)*';
  const leaveTypeName = record.type || '';
  return (
    `⏰ *PERINGATAN — KELULUSAN CUTI TERTANGGUH*\n\n` +
    `Permohonan berikut masih menunggu ${stage} selama *${ageDays} hari*:\n\n` +
    `👤 Pemohon : *${record.name}*\n` +
    `🏢 Cawangan : ${record.branch || '—'}\n` +
    `📋 Jenis Cuti : ${leaveTypeName}\n` +
    `📅 Tarikh : ${record.startDate} → ${record.endDate}\n` +
    `⏱ Tempoh : ${record.days} hari\n\n` +
    `Sila log masuk dan ambil tindakan segera:\n` +
    `🌐 https://apply-leave-89ebb.web.app\n\n` +
    `_— KSB Leave System (Peringatan Automatik)_`
  );
}

window.checkOverduePendingReminders = async function() {
  if (!WHATSAPP_ENABLED()) return;
  if (!leaveRecords.length || !staffList.length) return;

  const now = Date.now();
  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
  const ONE_DAY    = 24 * 60 * 60 * 1000;

  const overdue = leaveRecords.filter(r => {
    if (r.status !== 'PENDING' && r.status !== 'TL APPROVED' && r.status !== 'HOD APPROVED') return false;
    const age = now - (r.id || 0);
    if (age < SEVEN_DAYS) return false;
    const lastSent = r.lastReminderSent || 0;
    return (now - lastSent) >= ONE_DAY;
  });

  if (!overdue.length) return;
  console.log(`[REMINDER] ${overdue.length} permohonan tertangguh melebihi 7 hari.`);

  for (const record of overdue) {
    const ageDays = Math.floor((now - record.id) / (1000 * 60 * 60 * 24));
    const sent = new Set();

    try {
      if (record.status === 'PENDING') {
        // ── Peringkat 1: cari pelulus berkaitan ──────────────────
        if (record.hodIC) {
          // Pelulus spesifik dipilih semasa permohonan
          const approver = staffList.find(s => s.ic === record.hodIC && !s.inactive);
          if (approver && approver.phone && !sent.has(approver.ic)) {
            await window.sendWhatsApp(approver.phone, buildReminderMsg(record, ageDays, 1));
            sent.add(approver.ic);
          }
        } else {
          // Guna routing config untuk cari pelulus
          const applicant = staffList.find(s => s.ic === record.ic);
          if (applicant) {
            const p1List = window.getRoutingP1Approvers ? window.getRoutingP1Approvers(applicant) : [];
            for (const approver of p1List) {
              if (approver.phone && !sent.has(approver.ic)) {
                await window.sendWhatsApp(approver.phone, buildReminderMsg(record, ageDays, 1));
                sent.add(approver.ic);
              }
            }
          }
        }
      } else if (record.status === 'TL APPROVED') {
        // ── Peringkat 1: hantar kepada Supervisor Balok ──────────
        const supList = staffList.filter(s =>
          !s.inactive && s.phone && s.role === 'supervisor' && (s.branch || '').includes('Balok')
        );
        for (const sup of supList) {
          if (!sent.has(sup.ic)) {
            await window.sendWhatsApp(sup.phone, buildReminderMsg(record, ageDays, 1));
            sent.add(sup.ic);
          }
        }
      } else if (record.status === 'HOD APPROVED') {
        // ── Peringkat 2: hantar kepada semua HR / Admin ──────────
        const p2List = staffList.filter(s =>
          !s.inactive && s.phone && ['hr', 'admin', 'super_admin'].includes(s.role)
        );
        for (const admin of p2List) {
          if (!sent.has(admin.ic)) {
            await window.sendWhatsApp(admin.phone, buildReminderMsg(record, ageDays, 2));
            sent.add(admin.ic);
          }
        }
      }

      // Kemaskini masa peringatan terakhir supaya tidak spam setiap hari
      if (sent.size > 0 && record.docId) {
        await updateDoc(doc(db, 'leaves', record.docId), { lastReminderSent: now });
      }
    } catch(err) {
      console.warn('[REMINDER] Gagal hantar peringatan untuk rekod', record.id, err);
    }
  }
};

function startReminderScheduler() {
  // Semak pertama kali selepas 15 saat (bagi masa data load)
  setTimeout(() => window.checkOverduePendingReminders(), 15000);
  // Kemudian semak setiap 2 jam
  if (reminderCheckInterval) clearInterval(reminderCheckInterval);
  reminderCheckInterval = setInterval(() => window.checkOverduePendingReminders(), 2 * 60 * 60 * 1000);
}

function stopReminderScheduler() {
  if (reminderCheckInterval) { clearInterval(reminderCheckInterval); reminderCheckInterval = null; }
}

// State
let user = null;
let currentSessionId = null;
let sessionUnsubscribe = null;
let duplicateSessionDetected = false;
let sessionKickHandled = false; // guard: auto-logout sesi lama hanya dicetus sekali
let view = 'login'; // 'login', 'dashboard', 'management', 'leave-form', 'policy', 'settings'
window.setView = function(v) {
  if (v === 'leave-form') {
      const today = new Date().toISOString().split('T')[0];
      leaveStartDate = today;
      leaveEndDate = today;
      selectedLeaveType = 'AL';
      applyHalfDay = false;
  }
  // Always reset messenger to rooms list when navigating away OR navigating into it
  if (messengerMsgUnsub) { messengerMsgUnsub(); messengerMsgUnsub = null; }
  messengerRoomId = null;
  messengerMessages = [];
  messengerView = 'rooms';
  messengerFileObj = null;
  view = v;
  render();
};

window.toggleHalfDay = function(val) {
    applyHalfDay = val;
    render();
};

window.updateLeaveDate = function(field, val) {
    if (field === 'start') leaveStartDate = val;
    if (field === 'end') leaveEndDate = val;
    
    // Safety: Ensure end is at least start
    const s = new Date(leaveStartDate);
    const e = new Date(leaveEndDate);
    if (!isNaN(s) && !isNaN(e) && e < s) {
        leaveEndDate = leaveStartDate;
    }
    render();
};
let manageBranchFilter = 'All';
let editingStaff = null;
let managementTab = 'pending';
let managementGroup = 'approvals'; // 'approvals' | 'people' | 'reports' | 'config'
let hrReportTab = 'all'; // 'all' | 'approved' | 'balance' | 'jenis'
let approvedReportBranch = 'SEMUA';
let approvedReportType = 'SEMUA';
let approvedReportYear = new Date().getFullYear().toString();
let balanceReportBranch = 'SEMUA';
let balanceReportType = 'AL';
let balanceReportYear = new Date().getFullYear().toString();
let balanceViewBranch = 'SEMUA';
let balanceViewSearch = '';
let jenisCutiYear = new Date().getFullYear().toString();
let jenisCutiBranch = 'SEMUA';
let attendanceReportMonth = String(new Date().getMonth() + 1);
let attendanceReportYear = new Date().getFullYear().toString();
let attendanceReportBranch = 'SEMUA';
let manageSearchQuery = '';
let manageRoleFilter = 'SEMUA';
let manageCategoryFilter = 'SEMUA';
let showInactiveStaff = false;
let editingLeaveId = null;
let dashboardTab = null; // 'personal' or 'analytics'
let showProfileSettings = false;
let selectedLeaveType = 'AL';
let analyticsFilterMonth = 0; // 0 = All Months, 1-12 = specific month
let analyticsCatFilter = 'SEMUA'; // 'SEMUA', 'Doktor', 'Admin Staff', 'Operation Staff'
let analyticsBranchFilter = 'SEMUA'; // 'SEMUA' or branch name
let branchDashboardMonth = 0; // 0 = all months, 1-12 = specific month for HOD/PIC branch view
let selectedLoginBranch = '';
let selectedLoginStaffIC = '';
let showRegisterModal = false;
let showFirstLoginWarning = false;
let showPhoneReminderModal = false;

let publicHolidays = { pahang: [], terengganu: [] };
let policyContent = {
  notice: '',
  glossary: [
    { code:'AL',  name:'Annual Leave (Cuti Tahunan)' },
    { code:'MC',  name:'Medical Leave (Cuti Sakit)' },
    { code:'CME', name:'Continuing Medical Education' },
    { code:'EL',  name:'Emergency Leave (Cuti Kecemasan)' },
    { code:'HL',  name:'Hospitalization Leave' },
    { code:'ML',  name:'Maternity Leave (Cuti Bersalin)' },
    { code:'PL',  name:'Paternity Leave (Cuti Isteri Bersalin)' },
    { code:'BL',  name:'Compassionate Leave (Cuti Ihsan)' },
    { code:'RL',  name:'Replacement Leave (Cuti Ganti)' },
    { code:'UL',  name:'Unpaid Leave (Cuti Tanpa Gaji)' }
  ],
  entitlementPahang:     [{ period:'Sehingga 5 tahun', days:'16 Hari' }, { period:'Lebih 5 Tahun ke atas', days:'20 Hari' }],
  entitlementTerengganu: [{ period:'Semua Tempoh', days:'16 Hari' }],
  entitlementDoktor:     [{ days:'25 Hari' }, { days:'20 Hari' }, { days:'10 Hari' }],
  entitlementMC:         [{ period:'Kurang dari 2 tahun', days:'14 Hari' }, { period:'2 tahun hingga kurang 5 tahun', days:'18 Hari' }, { period:'5 tahun ke atas', days:'22 Hari' }],
  rulesAL: [
    'Permohonan mesti dibuat sekurang-kurangnya <strong>3 hari</strong> sebelum tarikh percutian.',
    'Kelulusan adalah tertakluk kepada budi bicara pihak pengurusan/HOD mengikut kepada keperluan operasi klinik.',
    'Hanya maksimum baki sejumlah <strong>3 hari</strong> dibenarkan dibawa ke hadapan (carry forward) ke kalendar tahun berikutnya.'
  ],
  rulesMC: [
    'Sijil Cuti Sakit (MC) yang asal <strong>mesti</strong> diserahkan kepada pihak pengurusan pada hari pertama kembali bekerja.',
    'Staff wajib memaklumkan kepada pihak pengurusan atau HOD sekurang-kurangnya <strong>2 jam sebelum</strong> shift kerja bermula.'
  ],
  rulesCME: [
    'Kelayakan cuti CME ini ditetapkan sebanyak maksimum <strong>5 hari sahaja</strong> bagi setiap kalendar.',
    'Tujuannya dikhususkan semata-mata untuk melibatkan diri dalam kursus, seminar, dan latihan luaran berkaitan dengan skop kerja.',
    'Memerlukan surat sokongan bertulis berserta pengesahan daripada Pengurus dan Ketua Jabatan HOD.'
  ],
  rulesNotice: [
    'Notis penamatan kontrak pekerjaan mesti mematuhi garis panduan ditandatangani sewaktu penerimaan jawatan (1 atau 3 bulan lazimnya bergantung pada jawatan).',
    'Kegagalan untuk memberikan peringatan dan notis yang mencukupi bermaksud staff bersetuju untuk membayar denda kerugian / ganti rugi <i>(indemnity)</i> kepada pihak klinik mengikut kekurangan hari notis tersebut.'
  ]
};
let waLogs = [];
let inboxNotifs = [];
let inboxUnsub = null;
let waSettingsSubTab = 'token_log'; // 'token_log' | 'rbac_notif'
let waNotifRbac = {
  balok:      { p1_submit: ['team_leader','hod_balok'], tl_approved: ['supervisor'], p2_p1_approved: ['hr','admin','super_admin'], p3_final: [], overdue_reminder: ['team_leader','supervisor','hr'] },
  pahang:     { p1_submit: ['doctor_pic','hod_balok'], tl_approved: [],         p2_p1_approved: ['hr','admin'],              p3_final: [], overdue_reminder: ['hr','admin','doctor_pic'] },
  terengganu: { p1_submit: ['doctor_pic'], tl_approved: [],         p2_p1_approved: [],                          p3_final: [], overdue_reminder: ['doctor_pic'] }
};

const DEFAULT_HOLIDAYS_PAHANG = [
  { date: '2026-01-01', name: "Tahun Baru / New Year's Day" },
  { date: '2026-01-29', name: 'Tahun Baru Cina (Hari 1)' },
  { date: '2026-01-30', name: 'Tahun Baru Cina (Hari 2)' },
  { date: '2026-03-20', name: 'Hari Raya Puasa (Hari 1)' },
  { date: '2026-03-21', name: 'Hari Raya Puasa (Hari 2)' },
  { date: '2026-05-01', name: 'Hari Pekerja / Labour Day' },
  { date: '2026-05-07', name: 'Hari Hol Pahang' },
  { date: '2026-05-27', name: 'Hari Raya Haji' },
  { date: '2026-07-06', name: 'Awal Muharram' },
  { date: '2026-08-31', name: 'Hari Kebangsaan / National Day' },
  { date: '2026-09-14', name: 'Maulidur Rasul' },
  { date: '2026-09-16', name: 'Hari Malaysia' },
  { date: '2026-12-25', name: 'Krismas / Christmas Day' },
];

const DEFAULT_HOLIDAYS_TERENGGANU = [
  { date: '2026-01-01', name: "Tahun Baru / New Year's Day" },
  { date: '2026-01-29', name: 'Tahun Baru Cina (Hari 1)' },
  { date: '2026-01-30', name: 'Tahun Baru Cina (Hari 2)' },
  { date: '2026-03-04', name: 'Hari Ulang Tahun Sultan Terengganu' },
  { date: '2026-03-20', name: 'Hari Raya Puasa (Hari 1)' },
  { date: '2026-03-21', name: 'Hari Raya Puasa (Hari 2)' },
  { date: '2026-05-01', name: 'Hari Pekerja / Labour Day' },
  { date: '2026-05-27', name: 'Hari Raya Haji' },
  { date: '2026-07-06', name: 'Awal Muharram' },
  { date: '2026-08-31', name: 'Hari Kebangsaan / National Day' },
  { date: '2026-09-14', name: 'Maulidur Rasul' },
  { date: '2026-09-16', name: 'Hari Malaysia' },
  { date: '2026-12-25', name: 'Krismas / Christmas Day' },
];
let registrationRequests = [];
let leaveStartDate = '';
let leaveEndDate = '';
let applyHalfDay = false;
let mobileMenuOpen = false;
const showLocum2Set = new Set();

// ── Messenger State ──────────────────────────────────────────
let messengerRoomId = null;
let messengerRoomName = '';
let messengerRoomType = 'group';
let messengerMessages = [];
let messengerMsgUnsub = null;
let messengerFileObj = null;
let messengerView = 'rooms'; // 'rooms' | 'chat'
let messengerSending = false;
let messengerRoomLastMsg = {};
let messengerRoomsUnsub = null;
let messengerUnreadRooms = new Set(); // tracks which leave id has 2nd locum row visible
let onlineUsers = {}; // { [ic]: { name, branch, role, lastSeen } }
let presenceUnsub = null;
let presenceHeartbeatInterval = null;
let msgToasts = []; // [{ id, roomId, roomName, senderName, preview, isDM, createdAt, timer }]
// Messenger accordion (collapsible sections) — persisted per device.
let msgSections = loadSectionState(typeof localStorage !== 'undefined' ? localStorage : null);
// Yahoo-Messenger-style presence status + mood, persisted per device.
let myStatus = (typeof localStorage !== 'undefined' && localStorage.getItem('ksb_msg_status')) || DEFAULT_STATUS;
let myStatusMsg = (typeof localStorage !== 'undefined' && localStorage.getItem('ksb_msg_mood')) || '';
let messengerRoomsInitialLoad = true;
let msgNewMsgUnsub = null;
const leaveCategories = [
    { id: 'AL', name: 'Annual Leave (AL)', entitlement: 14, icon: 'icon-al', color: '#3b82f6', description: 'Cuti Tahunan mengikut pro-rata bulan bekerja.' },
    { id: 'MC', name: 'Medical Leave (MC)', entitlement: 14, icon: 'icon-mc', color: '#10b981', description: 'Cuti Sakit dengan Sijil Sakit (MC) yang sah.' },
    { id: 'EL', name: 'Emergency/Compassionate (EL)', entitlement: 3, icon: 'icon-el', color: '#f59e0b', description: 'Cuti Kecemasan atau Ehsan (Kematian keluarga terdekat).' },
    { id: 'EL_EMG', name: 'Emergency (Non-Ehsan)', entitlement: 0, icon: 'icon-emg', color: '#ef4444', description: 'Cuti Kecemasan Am (Bukan Kematian).' },
    { id: 'UP', name: 'Unpaid Leave (UL)', entitlement: 0, icon: 'icon-ul', color: '#94a3b8', description: 'Cuti Tanpa Gaji (Setelah baki AL habis digunakan).' },
    { id: 'HL', name: 'Hospitalization (HL)', entitlement: 60, icon: 'icon-hl', color: '#06b6d4', description: 'Cuti Wad/Hospitalisasi (Maksimum 60 hari).' },
    { id: 'ML', name: 'Cuti Bersalin', entitlement: 98, icon: 'icon-ml', color: '#ec4899', description: 'Cuti Bersalin (98 hari) — kakitangan wanita.' },
    { id: 'ML_PL', name: 'Cuti Paterniti', entitlement: 7, icon: 'icon-mlpl', color: '#6366f1', description: 'Cuti Bapa Isteri Bersalin (7 hari) — kakitangan lelaki.' },
    { id: 'CME', name: 'Latihan CME', entitlement: 5, icon: 'icon-cme', color: '#8b5cf6', description: 'Cuti Pendidikan Perubatan Berterusan (Doktor sahaja).' }
];

// ============================================================
// BOT BANTUAN — FAQ Pintar (rule-based, tiada backend)
// ============================================================
const HELP_SYNONYMS = {
  sakit:'mc', medical:'mc', sijil:'mc',
  tahunan:'al', annual:'al',
  emergency:'kecemasan',
  kematian:'ehsan',
  ganti:'locum',
  lulus:'kelulusan', pelulus:'kelulusan', approve:'kelulusan',
  baki:'balance',
  password:'kata laluan', lupa:'kata laluan',
  telefon:'profil', phone:'profil'
};

const HELP_FAQ = [
  { id:'al-submit', cat:'Cuti', popular:true, keywords:['al','tahunan','annual','cuti tahunan','mohon cuti','hantar cuti'],
    q:'Macam mana mohon Cuti Tahunan (AL)?',
    a:'<strong>Langkah mohon AL:</strong><br>1. Tekan <em>Mohon Cuti</em> → pilih jenis <strong>Annual Leave (AL)</strong>.<br>2. Pilih tarikh mula & tamat (boleh tanda <em>Half Day</em> untuk separuh hari).<br>3. Pilih <strong>Pelulus Peringkat 1</strong> dari senarai.<br>4. Tekan <strong>Hantar Permohonan</strong>.<br><br>⚠️ AL mesti dimohon awal: <strong>3 hari</strong> (Staff Admin) / <strong>7 hari</strong> (Operasi & Doktor) sebelum tarikh cuti. Baki AL ditolak automatik; jika tak cukup, lebihan jadi <em>Unpaid Leave</em>.',
    action:{ label:'Pergi ke Borang Cuti', view:'leave-form' } },
  { id:'mc-submit', cat:'Cuti', popular:true, keywords:['mc','sakit','medical','sijil','cuti sakit','hantar mc'],
    q:'Macam mana mohon Cuti Sakit (MC)?',
    a:'<strong>Langkah mohon MC:</strong><br>1. <em>Mohon Cuti</em> → pilih <strong>Medical Leave (MC)</strong>.<br>2. Pilih tarikh (boleh tarikh hari ini / ke belakang — <strong>tiada had notis 3/7 hari</strong> untuk MC).<br>3. <strong>WAJIB muat naik Sijil Sakit (MC)</strong> sebelum hantar.<br>4. Pilih <strong>Pelulus Peringkat 1</strong> (HOD/Supervisor) seperti permohonan AL.<br>5. Tekan Hantar.<br><br>MC kini <strong>mengikut step kelulusan penuh sama seperti AL</strong>: disokong Pelulus Peringkat 1 dahulu, kemudian diluluskan HR/Admin. Sijil Sakit masih wajib dimuat naik.',
    action:{ label:'Pergi ke Borang Cuti', view:'leave-form' } },
  { id:'emergency-submit', cat:'Cuti', keywords:['kecemasan','emergency','cuti kecemasan','el'],
    q:'Macam mana mohon Cuti Kecemasan?',
    a:'<strong>Cuti Kecemasan:</strong><br>1. <em>Mohon Cuti</em> → pilih <strong>Cuti Kecemasan</strong>.<br>2. <strong>WAJIB muat naik dokumen/gambar bukti</strong>.<br>3. Pilih pelulus & hantar.<br><br>Tanpa bukti, borang akan ditolak.',
    action:{ label:'Pergi ke Borang Cuti', view:'leave-form' } },
  { id:'ehsan-submit', cat:'Cuti', keywords:['ehsan','kematian','cuti ehsan','kematian keluarga'],
    q:'Cuti Ehsan (kematian) — macam mana & syarat?',
    a:'<strong>Cuti Ehsan</strong> hanya untuk kematian <strong>ayah, ibu, suami, isteri, atau anak</strong>. Had: <strong>3 hari</strong>. <strong>WAJIB muat naik Salinan Sijil Kematian</strong> semasa memohon.',
    action:{ label:'Pergi ke Borang Cuti', view:'leave-form' } },
  { id:'cme-submit', cat:'Cuti', keywords:['cme','latihan','kursus','seminar','doktor'],
    q:'Cuti CME (doktor) — macam mana?',
    a:'<strong>Cuti CME</strong> untuk <strong>doktor sahaja</strong>, maksimum <strong>5 hari setiap kalendar</strong>, khusus untuk kursus/seminar/latihan luaran berkaitan kerja. Perlu surat sokongan + pengesahan daripada Pengurus dan Ketua Jabatan (HOD).' },
  { id:'locum-info', cat:'Cuti', keywords:['locum','ganti','doktor locum','penggantian'],
    q:'Maklumat Locum untuk doktor',
    a:'Untuk doktor, maklumat <strong>Locum</strong> (nama, tarikh, masa penggantian) boleh diisi untuk rujukan. Ia biasanya dilengkapkan oleh HOD/Supervisor sebelum meluluskan, dan <strong>tidak diwajibkan</strong> untuk meluluskan permohonan.' },
  { id:'no-submit-approver', cat:'Masalah', popular:true, keywords:['tak boleh hantar','pelulus','wajib pilih','borang ditolak','peringkat 1'],
    q:'Borang tak boleh hantar — "Wajib pilih Pelulus"',
    a:'Anda perlu <strong>pilih Pelulus Peringkat 1</strong> dari menu dropdown sebelum hantar. Jika <strong>tiada pelulus berdaftar</strong> untuk cawangan/kategori anda, sistem akan benarkan hantar terus dan <strong>HR/Admin</strong> akan luluskan. (MC tidak perlu pilih pelulus.)' },
  { id:'no-submit-mc', cat:'Masalah', keywords:['mc tak hantar','sijil belum','muat naik mc','upload mc'],
    q:'MC tak boleh hantar — sijil belum dimuat naik',
    a:'Cuti Sakit (MC) <strong>wajib</strong> ada <strong>Sijil Sakit</strong> dimuat naik (gambar JPG/PNG atau PDF) sebelum boleh dihantar. Tekan kotak muat naik MC, pilih fail, kemudian hantar.' },
  { id:'notice-policy', cat:'Masalah', keywords:['notis','policy violation','3 hari','7 hari','days notice','terlalu lewat'],
    q:'Mesej "Policy Violation — days notice"',
    a:'Cuti Tahunan (AL) mesti dimohon awal: <strong>3 hari</strong> untuk Staff Admin, <strong>7 hari</strong> untuk Operasi & Doktor, sebelum tarikh cuti. <strong>MC, Cuti Kecemasan & Cuti Ehsan dikecualikan</strong> (boleh hari ini/ke belakang) — tetapi wajib pilih pelulus & muat naik bukti.' },
  { id:'balance-insufficient', cat:'Masalah', keywords:['baki tak cukup','unpaid','split','ul','kurang baki'],
    q:'Baki cuti tak cukup / jadi Unpaid Leave',
    a:'Jika hari AL yang dimohon <strong>melebihi baki</strong> anda, sistem akan <strong>bahagikan automatik</strong>: sebahagian sebagai AL (baki yang ada) dan selebihnya sebagai <strong>Unpaid Leave (UL)</strong>. Notis akan dipaparkan semasa hantar.' },
  { id:'half-day', cat:'Masalah', keywords:['separuh hari','half day','setengah hari'],
    q:'Macam mana mohon cuti separuh hari?',
    a:'Pada borang cuti, tanda kotak <strong>Half Day</strong>. Tempoh akan ditolak <strong>0.5 hari</strong> dari baki.' },
  { id:'who-approves', cat:'Kelulusan', popular:true, keywords:['pelulus','siapa lulus','kelulusan','siapa pelulus','approve cuti'],
    q:'Siapa pelulus cuti saya?',
    a: function(u) {
      const generic = 'Peringkat 1 bergantung peranan & cawangan: <strong>Doctor PIC</strong> (staf cawangan), <strong>HOD Balok</strong> (admin Balok HQ), atau <strong>Supervisor Balok</strong> (operasi Balok & doktor Pahang). Selepas itu <strong>HR/Admin</strong> beri kelulusan akhir (Peringkat 2). Terengganu 1 peringkat sahaja.';
      try {
        if (!u || typeof window.getRoutingP1Approvers !== 'function') return generic;
        const apps = window.getRoutingP1Approvers(u) || [];
        const names = apps.map(s => s.name).filter(Boolean);
        const who = names.length ? names.join(', ') : 'tiada pelulus berdaftar — permohonan akan terus ke HR/Admin';
        return 'Bagi anda (<strong>' + (u.name||'') + '</strong> — ' + (u.branch||'') + '):<br>🔹 <strong>Pelulus Peringkat 1:</strong> ' + who + '<br>🔹 <strong>Peringkat 2 (akhir):</strong> HR/Admin.<br><br>' + generic;
      } catch(e) { return generic; }
    },
  },
  { id:'stages', cat:'Kelulusan', keywords:['peringkat','stage','peringkat 1','peringkat 2','p1','p2'],
    q:'Apa maksud Peringkat 1 dan Peringkat 2?',
    a:'<strong>Peringkat 1</strong> = sokongan pelulus pertama (Doctor PIC / HOD Balok / Supervisor).<br><strong>Peringkat 2</strong> = kelulusan akhir oleh <strong>HR/Admin</strong>.<br>Cuti dikira <strong>SAH</strong> hanya selepas Peringkat 2 (kecuali cawangan Terengganu — 1 peringkat sahaja).' },
  { id:'status-pending', cat:'Kelulusan', keywords:['menunggu','pending','status','masih menunggu','lama tak lulus'],
    q:'Kenapa cuti saya masih "Menunggu"?',
    a:'Permohonan sedang menunggu pelulus (Peringkat 1) atau HR (Peringkat 2). Selepas <strong>7 hari</strong> tertangguh, peringatan WhatsApp dihantar automatik kepada pelulus. Anda boleh hubungi pelulus/HR untuk tindakan segera.' },
  { id:'mc-auto', cat:'Kelulusan', keywords:['mc lulus','mc terus','mc auto','mc hr'],
    q:'MC saya terus diluluskan?',
    a:'MC <strong>tidak</strong> auto-lulus sepenuhnya. Ia dihantar terus untuk semakan & kelulusan: cawangan <strong>Pahang → HR</strong>; <strong>Terengganu → HOD/PIC</strong> — tanpa melalui Peringkat 1 biasa. HR/HOD akan semak Sijil MC kemudian luluskan/tolak.' },
  { id:'forgot-password', cat:'Akaun', popular:true, keywords:['lupa','password','kata laluan','lupa kata laluan','reset'],
    q:'Lupa kata laluan',
    a:'Pilih nama anda dari senarai, kemudian tekan <strong>"Lupa Kata Laluan?"</strong> → satu <strong>kod OTP</strong> akan dihantar ke <strong>WhatsApp</strong> anda. Masukkan kod itu dan tetapkan kata laluan baharu terus di skrin. Pastikan nombor telefon anda telah didaftarkan oleh HR/Admin.' },
  { id:'update-phone', cat:'Akaun', keywords:['tukar telefon','profil','kemaskini','nombor telefon','tukar nombor'],
    q:'Tukar nombor telefon / kemas kini profil',
    a:'Nombor telefon & maklumat profil dikemas kini oleh <strong>HR/Admin</strong>. Sila hubungi mereka untuk sebarang perubahan.' },
  { id:'balance-check', cat:'Akaun', keywords:['baki','balance','berapa baki','baki cuti','baki saya'],
    q:'Berapa baki cuti saya?',
    a: function(u) {
      const generic = 'Lihat panel <strong>"Baki Cuti Anda"</strong> di borang Mohon Cuti (AL / MC / Hospitalisasi).';
      try {
        if (!u || typeof window.getLeaveStats !== 'function') return generic;
        const al = window.getLeaveStats(u, 'AL'); const mc = window.getLeaveStats(u, 'MC');
        // getLeaveStats returns { used, ent, bal } — use bal directly (already clamped to 0)
        const fmt = s => (s && s.ent !== undefined) ? (s.bal + ' hari (baki) / ' + s.ent + ' (kelayakan)') : '—';
        return 'Baki cuti anda (<strong>' + (u.name||'') + '</strong>):<br>• <strong>AL:</strong> ' + fmt(al) + '<br>• <strong>MC:</strong> ' + fmt(mc) + '<br><br>' + generic;
      } catch(e) { return generic; }
    },
  },
  { id:'contact-hr', cat:'Akaun', keywords:['hubungi','hr','admin','bantuan','contact'],
    q:'Macam mana hubungi HR/Admin?',
    a:'Anda boleh hubungi HR/Admin melalui <strong>Messenger</strong> dalam app ini, atau melalui nombor telefon rasmi yang disediakan oleh klinik.' }
];

function helpSearch(query) {
  const q = (query || '').toLowerCase().trim();
  if (!q) return HELP_FAQ.filter(e => e.popular);
  const tokens = q.split(/[^a-z0-9]+/).filter(t => t.length >= 2);
  const exp = new Set(tokens);
  tokens.forEach(t => { if (HELP_SYNONYMS[t]) HELP_SYNONYMS[t].split(' ').forEach(s => exp.add(s)); });
  return HELP_FAQ.map(e => {
    const hay = (e.keywords.join(' ') + ' ' + e.q).toLowerCase();
    let sc = 0;
    exp.forEach(t => { if (e.keywords.includes(t)) sc += 3; else if (hay.includes(t)) sc += 1; });
    return { e, sc };
  }).filter(x => x.sc > 0).sort((a, b) => b.sc - a.sc).slice(0, 6).map(x => x.e);
}

// ============================================================
// HELP WIDGET — floating button + searchable FAQ panel
// ============================================================
let helpOpen = false;
let helpQuery = '';
let helpSelectedId = null;

window.toggleHelp = function(v) { helpOpen = (v !== undefined) ? v : !helpOpen; if (!helpOpen) { helpQuery=''; helpSelectedId=null; } renderHelpWidget(); };
window.helpOnInput = function(val) { helpQuery = val; helpSelectedId = null; renderHelpWidget(); };
window.helpSelect = function(id) { helpSelectedId = id; renderHelpWidget(); };
window.helpBack = function() { helpSelectedId = null; renderHelpWidget(); };
window.helpAction = function(view) { helpOpen = false; helpSelectedId = null; renderHelpWidget(); if (typeof window.setView === 'function') window.setView(view); };

function helpAnswerHtml(entry) {
  return (typeof entry.a === 'function') ? entry.a(user) : entry.a;
}

function renderHelpWidget() {
  let host = document.getElementById('help-widget');
  if (!host) { host = document.createElement('div'); host.id = 'help-widget'; document.body.appendChild(host); }
  if (!user) { host.innerHTML = ''; return; }
  const robotIcon = `<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="3.4" r="1.15" fill="#fff" stroke="none"/><path d="M12 4.6V7"/><rect x="4.5" y="7" width="15" height="11" rx="3.6"/><path d="M3 11v3M21 11v3"/><circle cx="9.3" cy="12" r="1.45" fill="#fff" stroke="none"/><circle cx="14.7" cy="12" r="1.45" fill="#fff" stroke="none"/><path d="M9.6 15.3h4.8"/></svg>`;
  const btn = `<button onclick="window.toggleHelp()" aria-label="Bantuan" class="help-widget-btn">${helpOpen ? '×' : robotIcon}</button>`;
  let panel = '';
  if (helpOpen) {
    const sel = helpSelectedId ? HELP_FAQ.find(e => e.id === helpSelectedId) : null;
    let body;
    if (sel) {
      const act = sel.action ? `<button onclick="window.helpAction('${sel.action.view}')" style="margin-top:0.85rem;width:100%;padding:0.6rem;border:none;border-radius:10px;cursor:pointer;background:linear-gradient(135deg,#3b82f6,#8b5cf6);color:#fff;font-weight:700;font-size:0.82rem;">${sel.action.label}</button>` : '';
      body = `<button onclick="window.helpBack()" style="background:none;border:none;color:#3b82f6;cursor:pointer;font-size:0.78rem;font-weight:700;padding:0;margin-bottom:0.6rem;">← Kembali</button>
        <div style="font-size:0.9rem;font-weight:800;margin-bottom:0.5rem;color:var(--text);">${sel.q}</div>
        <div style="font-size:0.82rem;line-height:1.6;color:var(--text-muted);">${helpAnswerHtml(sel)}</div>${act}`;
    } else {
      const results = helpSearch(helpQuery);
      const list = results.length
        ? results.map(e => `<button onclick="window.helpSelect('${e.id}')" style="display:block;width:100%;text-align:left;background:rgba(163,177,198,0.08);border:1px solid rgba(163,177,198,0.2);border-radius:10px;padding:0.6rem 0.75rem;margin-bottom:0.4rem;cursor:pointer;font-size:0.8rem;color:var(--text);"><span style="font-size:0.62rem;color:#3b82f6;font-weight:700;text-transform:uppercase;">${e.cat}</span><br>${e.q}</button>`).join('')
        : `<div style="font-size:0.8rem;color:var(--text-muted);padding:0.5rem 0;">Tiada padanan. Cuba kata kunci lain (cth. "MC", "pelulus", "baki"), tekan topik popular, atau hubungi HR/Admin.</div>`;
      const hint = helpQuery ? '' : `<div style="font-size:0.66rem;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin:0.3rem 0 0.5rem;">Topik popular</div>`;
      body = `<input value="${helpQuery.replace(/"/g,'&quot;')}" oninput="window.helpOnInput(this.value)" placeholder="Taip soalan anda… cth. macam mana hantar MC" style="width:100%;padding:0.6rem 0.8rem;border-radius:10px;border:1.5px solid rgba(59,130,246,0.3);font-size:0.82rem;margin-bottom:0.6rem;color-scheme:light;">${hint}${list}`;
    }
    panel = `<div class="help-widget-panel">
      <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.75rem;"><span style="font-size:1.1rem;">👋</span><div style="font-size:0.9rem;font-weight:800;color:var(--text);">Bantuan KSB</div></div>
      ${body}</div>`;
  }
  host.innerHTML = btn + panel;
}
window.renderHelpWidget = renderHelpWidget;

window.rbacMatrix = {
    super_admin: {
        dashboard: 'analisa', branch_analisa: false, leave_request: true, management: true, policy: true, settings: true, wa_setting: true, messenger: true, inbox: true,
        manage_pending: true, manage_staff: true, manage_branches: true, manage_audit: true, manage_login_audit: true, manage_reports: true, manage_routing: true, manage_access: true, manage_roles_categories: true, manage_holidays: true, manage_policy: true,
        report_kuantan_only: false, report_own_branch_only: false, report_attendance: true,
        can_cancel: true, os_balok: true, os_pahang: true, locum_records: true
    },
    admin: {
        dashboard: 'analisa', branch_analisa: false, leave_request: true, management: true, policy: true, settings: true, wa_setting: false, messenger: true, inbox: true,
        manage_pending: true, manage_staff: true, manage_branches: true, manage_audit: true, manage_login_audit: true, manage_reports: true, manage_routing: true, manage_access: true, manage_roles_categories: true, manage_holidays: true, manage_policy: true,
        report_kuantan_only: false, report_own_branch_only: false, report_attendance: true,
        can_cancel: true, os_balok: true, os_pahang: true, locum_records: true
    },
    hr: {
        dashboard: 'staff', branch_analisa: false, leave_request: true, management: true, policy: true, settings: true, wa_setting: false, messenger: true, inbox: true,
        manage_pending: true, manage_staff: true, manage_branches: true, manage_audit: true, manage_login_audit: false, manage_reports: true, manage_routing: false, manage_access: false, manage_roles_categories: true, manage_holidays: true, manage_policy: true,
        report_kuantan_only: true, report_own_branch_only: false, report_attendance: true,
        can_cancel: true, os_balok: true, os_pahang: true, locum_records: true
    },
    hod_cawangan: {
        dashboard: 'branch', branch_analisa: true, leave_request: true, management: false, policy: true, settings: true, wa_setting: false, messenger: true, inbox: true,
        manage_pending: false, manage_staff: false, manage_branches: false, manage_audit: false, manage_login_audit: false, manage_reports: true, manage_routing: false, manage_access: false, manage_roles_categories: false, manage_holidays: true, manage_policy: false,
        report_kuantan_only: false, report_own_branch_only: true, report_attendance: true,
        can_cancel: true, os_balok: true, os_pahang: true, locum_records: false
    },
    hod_balok: {
        dashboard: 'branch', branch_analisa: true, leave_request: true, management: false, policy: true, settings: true, wa_setting: false, messenger: true, inbox: true,
        manage_pending: true, manage_staff: false, manage_branches: false, manage_audit: false, manage_login_audit: false, manage_reports: true, manage_routing: false, manage_access: false, manage_roles_categories: false, manage_holidays: true, manage_policy: false,
        report_kuantan_only: false, report_own_branch_only: true, report_attendance: true,
        can_cancel: true, os_balok: true, os_pahang: true, locum_records: false
    },
    doctor_pic: {
        dashboard: 'branch', branch_analisa: true, leave_request: true, management: false, policy: true, settings: true, wa_setting: false, messenger: true, inbox: true,
        manage_pending: true, manage_staff: false, manage_branches: false, manage_audit: false, manage_login_audit: false, manage_reports: false, manage_routing: false, manage_access: false, manage_roles_categories: false, manage_holidays: false, manage_policy: false,
        report_kuantan_only: false, report_own_branch_only: false, report_attendance: false,
        can_cancel: true, os_balok: true, os_pahang: true, locum_records: false
    },
    supervisor: {
        dashboard: 'staff', branch_analisa: false, leave_request: true, management: false, policy: true, settings: true, wa_setting: false, messenger: true, inbox: true,
        manage_pending: true, manage_staff: false, manage_branches: false, manage_audit: false, manage_login_audit: false, manage_reports: false, manage_routing: false, manage_access: false, manage_roles_categories: false, manage_holidays: false, manage_policy: false,
        report_kuantan_only: false, report_own_branch_only: false, report_attendance: false,
        can_cancel: true, os_balok: true, os_pahang: true, locum_records: true
    },
    team_leader: {
        dashboard: 'staff', branch_analisa: false, leave_request: true, management: false, policy: true, settings: true, wa_setting: false, messenger: true, inbox: true,
        manage_pending: true, manage_staff: false, manage_branches: false, manage_audit: false, manage_login_audit: false, manage_reports: false, manage_routing: false, manage_access: false, manage_roles_categories: false, manage_holidays: false, manage_policy: false,
        report_kuantan_only: false, report_own_branch_only: false, report_attendance: false,
        can_cancel: false, os_balok: true, os_pahang: false, locum_records: false
    },
    staff: {
        dashboard: 'staff', branch_analisa: false, leave_request: true, management: false, policy: true, settings: true, wa_setting: false, messenger: true, inbox: true,
        manage_pending: false, manage_staff: false, manage_branches: false, manage_audit: false, manage_login_audit: false, manage_reports: false, manage_routing: false, manage_access: false, manage_roles_categories: false, manage_holidays: false, manage_policy: false,
        report_kuantan_only: false, report_own_branch_only: false, report_attendance: false,
        can_cancel: false, os_balok: false, os_pahang: false, locum_records: false
    },
    juru_xray: {
        dashboard: 'staff', branch_analisa: false, leave_request: true, management: false, policy: true, settings: true, wa_setting: false, messenger: true, inbox: true,
        manage_pending: false, manage_staff: false, manage_branches: false, manage_audit: false, manage_login_audit: false, manage_reports: false, manage_routing: false, manage_access: false, manage_roles_categories: false, manage_holidays: false, manage_policy: false,
        report_kuantan_only: false, report_own_branch_only: false, report_attendance: false,
        can_cancel: false, os_balok: false, os_pahang: false, locum_records: false
    },
    sonographer: {
        dashboard: 'staff', branch_analisa: false, leave_request: true, management: false, policy: true, settings: true, wa_setting: false, messenger: true, inbox: true,
        manage_pending: false, manage_staff: false, manage_branches: false, manage_audit: false, manage_login_audit: false, manage_reports: false, manage_routing: false, manage_access: false, manage_roles_categories: false, manage_holidays: false, manage_policy: false,
        report_kuantan_only: false, report_own_branch_only: false, report_attendance: false,
        can_cancel: false, os_balok: false, os_pahang: false, locum_records: false
    },
    juru_audio: {
        dashboard: 'staff', branch_analisa: false, leave_request: true, management: false, policy: true, settings: true, wa_setting: false, messenger: true, inbox: true,
        manage_pending: false, manage_staff: false, manage_branches: false, manage_audit: false, manage_login_audit: false, manage_reports: false, manage_routing: false, manage_access: false, manage_roles_categories: false, manage_holidays: false, manage_policy: false,
        report_kuantan_only: false, report_own_branch_only: false, report_attendance: false,
        can_cancel: false, os_balok: false, os_pahang: false, locum_records: false
    },
    pemandu: {
        dashboard: 'staff', branch_analisa: false, leave_request: true, management: false, policy: true, settings: true, wa_setting: false, messenger: true, inbox: true,
        manage_pending: false, manage_staff: false, manage_branches: false, manage_audit: false, manage_login_audit: false, manage_reports: false, manage_routing: false, manage_access: false, manage_roles_categories: false, manage_holidays: false, manage_policy: false,
        report_kuantan_only: false, report_own_branch_only: false, report_attendance: false,
        can_cancel: false, os_balok: false, os_pahang: false, locum_records: false
    }
};

window.toggleRbac = function(role, module) {
    if (module === 'dashboard') {
        const cur = window.rbacMatrix[role].dashboard;
        window.rbacMatrix[role].dashboard = cur === 'analisa' ? 'branch' : cur === 'branch' ? 'staff' : 'analisa';
    } else {
        window.rbacMatrix[role][module] = !window.rbacMatrix[role][module];
    }
    render();
};

window.saveRbac = async function() {
    try {
        await setDoc(doc(db, "settings", "rbac"), window.rbacMatrix);
        alert('Kebenaran Akses (RBAC) berjaya disimpan ke Firestore!');
    } catch (e) {
        console.error("Error persisting RBAC Matrix:", e);
        alert('Ralat: Gagal menyimpan tetapan matrix. Sila semak sambungan internet.');
    }
    render();
};

// Togol mod "Guna Dalam Sistem": manual (HR isi sendiri) ↔ auto (kira dari rekod diluluskan).
window.toggleAutoSystemUsage = async function() {
    if (!['admin', 'super_admin'].includes(user?.role)) {
        alert('Hanya Super Admin / Admin boleh menukar tetapan ini.');
        return;
    }
    const turningOn = !autoSystemUsage;
    const msg = turningOn
        ? '⚠️ HIDUPKAN MOD AUTO?\n\nBaki "Guna Dalam Sistem" untuk AL/MC/EL akan dikira AUTOMATIK daripada rekod cuti yang DILULUSKAN dalam sistem. Nilai "Guna Dalam Sistem (Manual)" yang HR isi akan DIABAIKAN.\n\nPastikan SEMUA cuti sedia ada sudah direkod & diluluskan dalam sistem (sync penuh) sebelum hidupkan.\n\nTeruskan?'
        : '↩️ MATIKAN MOD AUTO (kembali manual)?\n\nBaki "Guna Dalam Sistem" akan kembali ikut nilai manual yang HR isi (rekod diluluskan TIDAK dikira automatik).\n\nTeruskan?';
    if (!confirm(msg)) return;
    try {
        await setDoc(doc(db, 'settings', 'leaveConfig'), { autoSystemUsage: turningOn, updatedAt: Date.now(), updatedBy: user.name || user.ic }, { merge: true });
        window.logSystemActivity(`Set AUTO "Guna Dalam Sistem" = ${turningOn ? 'ON (auto rekod)' : 'OFF (manual)'}`);
        alert(turningOn ? '✅ Mod AUTO dihidupkan. Baki kini dikira dari rekod diluluskan.' : '✅ Mod manual dihidupkan semula.');
    } catch (e) {
        console.error('Error toggling autoSystemUsage:', e);
        alert('Ralat: Gagal menyimpan tetapan. Sila semak sambungan internet.');
    }
};

const _rbacCodeDefaults = JSON.parse(JSON.stringify(window.rbacMatrix));

// Staff config — categories & role labels loaded from Firestore
const CORE_CATEGORIES = ['Admin Staff', 'Operation Staff', 'Doctor'];
const CORE_ROLES = ['super_admin', 'admin', 'hr', 'hod_cawangan', 'hod_balok', 'doctor_pic', 'supervisor', 'team_leader', 'staff', 'juru_xray', 'sonographer', 'juru_audio', 'pemandu'];
window.staffConfig = {
    staffCategories: [...CORE_CATEGORIES],
    roleLabels: { super_admin:'Super Admin', admin:'Admin', hr:'HR', hod_cawangan:'HOD Cawangan', hod_balok:'HOD Balok', doctor_pic:'Doctor PIC', supervisor:'Supervisor', team_leader:'Team Leader', staff:'Staff', juru_xray:'Juru X-Ray', sonographer:'Sonographer', juru_audio:'Juru Audio', pemandu:'Pemandu' },
    customRoles: []
};
window.resetRbac = function() {
    if (!confirm('Reset semua kebenaran ke nilai lalai kod? Perubahan yang belum disimpan akan hilang.')) return;
    window.rbacMatrix = JSON.parse(JSON.stringify(_rbacCodeDefaults));
    render();
};

window.setSelectedLeaveType = function(type) {
  selectedLeaveType = type;
  render();
};

window.setAnalyticsMonth = function(val) {
  analyticsFilterMonth = parseInt(val);
  render();
};

window.setAnalyticsCat = function(cat) {
  analyticsCatFilter = cat;
  render();
};

window.setAnalyticsBranch = function(val) {
  analyticsBranchFilter = val;
  render();
};

window.setBranchDashboardMonth = function(val) {
  branchDashboardMonth = parseInt(val);
  render();
};

window.setDashboardTab = function(tab) {
  dashboardTab = tab;
  render();
};

// Kembalikan skop negeri pengguna: 'all', 'Pahang', 'Terengganu', atau null
window.getUserReportDaerah = function(u) {
    if (!u) return null;
    const perms = window.rbacMatrix[u.role] || {};
    if (perms.report_kuantan_only) return 'Kuantan';
    return null;
};

window.getUserReportBranch = function(u) {
    if (!u) return null;
    const perms = window.rbacMatrix[u.role] || {};
    if (perms.report_own_branch_only) return u.branch || null;
    return null;
};

window.getUserStateScope = function(u) {
    if (!u) return null;
    if (['super_admin', 'admin'].includes(u.role)) return 'all';
    if (u.role === 'hr') return 'Pahang'; // HR kawalan Kuantan/Pahang sahaja
    const branchObj = branches.find(b => b.name === u.branch);
    return (branchObj && branchObj.state) ? branchObj.state : null;
};

window.canManageRequest = function(user, req) {
    if (!user || !req) return false;
    if (['super_admin', 'admin'].includes(user.role)) return true;
    if (user.role === 'hr') {
        const reqBranchObj = branches.find(b => b.name === req.branch);
        return !reqBranchObj || reqBranchObj.state === 'Pahang';
    }
    // Team Leader: hanya urus PENDING staf operasi Balok yang memilih TL ini (jika needs_tl aktif)
    if (user.role === 'team_leader') {
        if (!(approvalRouting['operation_balok'] || {}).needs_tl) return false;
        if (req.status !== 'PENDING') return false;
        const applicant = staffList.find(s => s.ic === req.ic);
        if (!applicant) return false;
        if (window.getStaffGroup(applicant) !== 'operation_balok') return false;
        if (!(user.branch || '').includes('Balok')) return false;
        // Jika rekod ada tlIC, hanya TL yang dipilih boleh urus
        if (req.tlIC) return req.tlIC === user.ic;
        return true; // rekod lama tanpa tlIC — semua TL Balok boleh urus
    }

    if (!['doctor_pic', 'hod_balok', 'supervisor'].includes(user.role)) return false;

    // Supervisor: jangan urus PENDING staf operasi Balok jika needs_tl aktif — mesti TL approve dulu
    if (user.role === 'supervisor' && req.status === 'PENDING') {
        const _ap = staffList.find(s => s.ic === req.ic);
        if (_ap && window.getStaffGroup(_ap) === 'operation_balok' &&
            (approvalRouting['operation_balok'] || {}).needs_tl) {
            return false;
        }
    }

    // Supervisor Balok: boleh urus TL APPROVED jika needs_tl aktif
    if (user.role === 'supervisor' && req.status === 'TL APPROVED') {
        if (!(approvalRouting['operation_balok'] || {}).needs_tl) return false;
        const applicant = staffList.find(s => s.ic === req.ic);
        if (!applicant) return false;
        return window.getStaffGroup(applicant) === 'operation_balok' && (user.branch || '').includes('Balok');
    }

    // Permohonan dengan pelulus spesifik — hanya pelulus itu sahaja
    if (req.hodIC) return req.hodIC === user.ic;

    // Guna routing config
    const applicant = staffList.find(s => s.ic === req.ic);
    if (!applicant) return false;
    const group = window.getStaffGroup(applicant);
    const cfg   = approvalRouting[group] || {};

    const isP1 = (
        (cfg.p1_doctor_pic && user.role === 'doctor_pic') ||
        (cfg.p1_hod_balok  && user.role === 'hod_balok') ||
        (cfg.p1_supervisor && user.role === 'supervisor')
    );
    if (!isP1) return false;

    // Semak cawangan
    if (cfg.p1_supervisor && user.role === 'supervisor') {
        const useBalok = group === 'operation_balok' || group === 'xray_sono_balok' || group === 'doctor_pahang';
        if (useBalok) return (user.branch || '').includes('Balok');
        return req.branch === user.branch;
    }
    if (cfg.p1_hod_balok && user.role === 'hod_balok') {
        return (user.branch || '') === 'Klinik Syed Badaruddin Balok (HQ)';
    }
    // Doctor PIC — cawangan sama dengan pemohon
    return req.branch === user.branch;
};

window.handleFileSelect = function(input, displayId, noticeId) {
    if (input.files.length > 0) {
        // Had saiz 10MB (selaras dengan had Cloudinary free tier).
        if (input.files[0].size > 10 * 1024 * 1024) {
            alert('Saiz fail terlalu besar. Had maksimum: 10MB');
            input.value = '';
            const _d = document.getElementById(displayId);
            if (_d) _d.innerText = 'Tiada fail dipilih';
            return;
        }
        document.getElementById(displayId).innerText = input.files[0].name;
        if (noticeId) {
            const noticeEl = document.getElementById(noticeId);
            noticeEl.style.background = 'rgba(34, 197, 94, 0.1)';
            noticeEl.style.color = '#34d399';
            noticeEl.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
                DOKUMEN TELAH DIMUAT NAIK - SEDIA UNTUK DIHANTAR
            `;
        }
    }
};

// Master Logs: HR/Admin muat naik atau ganti bukti untuk cuti yang perlukan bukti
// (MC / Cuti Kecemasan / Cuti Ehsan). Fail dimuat naik ke Cloudinary dan proofUrl/
// proofName dikemas kini pada rekod cuti. Berguna untuk rekod lama yang belum ada bukti.
window.reuploadProof = function(id) {
  const rec = leaveRecords.find(r => r.id === id);
  if (!rec) return;
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'image/jpeg,image/png,image/jpg,application/pdf';
  inp.onchange = async () => {
    const file = inp.files && inp.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { alert('Saiz fail terlalu besar. Had maksimum: 10MB'); return; }
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
      fd.append('folder', `leave-proofs/${rec.ic}`);
      const resp = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/auto/upload`, { method: 'POST', body: fd });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.secure_url) throw new Error((data.error && data.error.message) || ('Cloudinary HTTP ' + resp.status));
      await updateDoc(doc(db, 'leaves', rec.docId), { proofUrl: data.secure_url, proofName: file.name });
      if (window.logSystemActivity) window.logSystemActivity(`Re-uploaded proof for leave ${id} (${rec.type})`);
      alert('✅ Bukti berjaya dimuat naik & disimpan.');
    } catch (err) {
      console.error('Re-upload proof failed:', err);
      alert('🔴 Gagal memuat naik fail bukti. Sila cuba lagi atau semak sambungan internet anda.');
    }
  };
  inp.click();
};

window.updateLocumInfo = function(id, field, value) {
  const record = leaveRecords.find(r => r.id === id);
  if (record) {
    record[field] = value;
    render();
  }
};

window.toggleLocum2 = function(id) {
  if (showLocum2Set.has(id)) {
    showLocum2Set.delete(id);
    // clear locum2 data when removed
    const rec = leaveRecords.find(r => r.id === id);
    if (rec) { rec.locum2Name = ''; rec.locum2Phone = ''; rec.locum2Date = ''; rec.locum2TimeStart = ''; rec.locum2TimeEnd = ''; }
  } else {
    showLocum2Set.add(id);
  }
  render();
};

window.printLocumForm = function(id) {
    const r = leaveRecords.find(req => req.id === id);
    if (!r) return;

    const printWindow = window.open('', '_blank');
    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Locum Assignment Form - ${r.name}</title>
            <style>
                body { font-family: 'Arial', sans-serif; padding: 40px; color: #333; line-height: 1.6; }
                .watermark { position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%); width: 420px; opacity: 0.15; pointer-events: none; z-index: 0; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
                .header { display: flex; align-items: center; gap: 18px; border-bottom: 2px solid #333; padding-bottom: 20px; margin-bottom: 30px; }
                .header-center { flex: 1; text-align: center; }
                .logo { width: 72px; height: 72px; border-radius: 12px; object-fit: contain; box-shadow: 0 2px 8px rgba(0,0,0,0.12); flex-shrink: 0; }
                .title { font-size: 22px; font-weight: bold; text-transform: uppercase; margin: 0; }
                .subtitle { font-size: 13px; color: #666; margin-top: 5px; }
                .content { margin-top: 30px; }
                .row { display: flex; margin-bottom: 15px; border-bottom: 1px solid #eee; padding-bottom: 5px; }
                .label { width: 200px; font-weight: bold; color: #555; }
                .value { flex: 1; font-size: 16px; }
                .footer { margin-top: 100px; display: flex; justify-content: space-between; }
                .sign-box { text-align: center; width: 200px; border-top: 1px solid #333; padding-top: 10px; }
                @media print { .no-print { display: none; } }
            </style>
        </head>
        <body>
            <div class="no-print" style="margin-bottom: 20px; text-align: right;">
                <button onclick="window.print()" style="padding: 10px 20px; background: #3b82f6; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">PRINT FORM</button>
            </div>
            ${window.printHeaderHTML({ branch: r.branch, title: 'BORANG PELANTIKAN DOKTOR LOCUM' })}
            <div class="content">
                <div class="row"><div class="label">Doktor Bercuti:</div><div class="value">${(r.name || '').toUpperCase()}</div></div>
                <div class="row"><div class="label">Cawangan:</div><div class="value">${r.branch}</div></div>
                <div class="row"><div class="label">Jenis Cuti:</div><div class="value">${r.type}</div></div>
                <div class="row"><div class="label">Tempoh Cuti:</div><div class="value">${r.startDate} hingga ${r.endDate} (${r.days} Hari)</div></div>
                <div style="height: 20px;"></div>
                <div style="background: #f0f7ff; padding: 20px; border-radius: 8px; border: 1px solid #bfdbfe; margin-bottom: 16px;">
                    <h3 style="margin-top: 0; color: #1d4ed8; font-size: 15px;">LOCUM 1 — DOKTOR PENGGANTI PERTAMA</h3>
                    <div class="row"><div class="label">Nama Doktor Locum:</div><div class="value"><strong>${(r.locum1Name || '-').toUpperCase()}</strong></div></div>
                    <div class="row"><div class="label">No. Telefon:</div><div class="value">${r.locum1Phone || '-'}</div></div>
                    <div class="row"><div class="label">Tarikh Bertugas:</div><div class="value">${r.locum1Date || '-'}</div></div>
                    <div class="row"><div class="label">Masa Bertugas:</div><div class="value">${r.locum1TimeStart || '-'} — ${r.locum1TimeEnd || '-'}</div></div>
                </div>
                ${r.locum2Name ? `
                <div style="background: #faf5ff; padding: 20px; border-radius: 8px; border: 1px solid #ddd6fe; margin-bottom: 16px;">
                    <h3 style="margin-top: 0; color: #6d28d9; font-size: 15px;">LOCUM 2 — DOKTOR PENGGANTI KEDUA</h3>
                    <div class="row"><div class="label">Nama Doktor Locum:</div><div class="value"><strong>${(r.locum2Name).toUpperCase()}</strong></div></div>
                    <div class="row"><div class="label">No. Telefon:</div><div class="value">${r.locum2Phone || '-'}</div></div>
                    <div class="row"><div class="label">Tarikh Bertugas:</div><div class="value">${r.locum2Date || '-'}</div></div>
                    <div class="row"><div class="label">Masa Bertugas:</div><div class="value">${r.locum2TimeStart || '-'} — ${r.locum2TimeEnd || '-'}</div></div>
                </div>` : ''}
                <div style="margin-top: 30px; font-size: 12px; color: #666; border-top: 1px solid #eee; padding-top: 10px;">
                    * Borang ini dijana secara automatik oleh KSB Leave Apply System pada ${new Date().toLocaleString()}.
                </div>
            </div>
            <div class="footer">
                <div class="sign-box">Disediakan Oleh (Supervisor/HOD)</div>
                <div class="sign-box">Disahkan Oleh (HR/Admin)</div>
            </div>
        </body>
        </html>
    `;
    printWindow.document.write(html);
    printWindow.document.close();
};

window.printAllLocum = function() {
    const recs = leaveRecords.filter(r => r.locum1Name);
    if (recs.length === 0) { alert('Tiada rekod locum untuk dicetak.'); return; }
    const pw = window.open('', '_blank');
    const rows = recs.map(r => {
        const locums = [];
        if (r.locum1Name) locums.push({ n:1, ...{name:r.locum1Name,phone:r.locum1Phone,date:r.locum1Date,ts:r.locum1TimeStart,te:r.locum1TimeEnd} });
        if (r.locum2Name) locums.push({ n:2, ...{name:r.locum2Name,phone:r.locum2Phone,date:r.locum2Date,ts:r.locum2TimeStart,te:r.locum2TimeEnd} });
        return locums.map(l => {
            const hrs = (() => {
                if (!l.ts || !l.te) return '-';
                const [sh,sm] = l.ts.split(':').map(Number);
                const [eh,em] = l.te.split(':').map(Number);
                const h = ((eh*60+em)-(sh*60+sm))/60;
                return h > 0 ? h.toFixed(1) + ' jam' : '-';
            })();
            return `<tr>
                <td>${r.name}</td><td>${r.branch}</td><td>${r.type}</td>
                <td>${r.startDate}${r.startDate!==r.endDate?' → '+r.endDate:''}</td>
                <td>${l.n}</td><td>${l.name}</td><td>${l.phone||'-'}</td>
                <td>${l.date||'-'}</td><td>${l.ts||'-'} — ${l.te||'-'}</td><td>${hrs}</td>
                <td>${r.status}</td>
            </tr>`;
        }).join('');
    }).join('');
    pw.document.write(`<!DOCTYPE html><html><head><title>Rekod Locum KSB</title>
    <style>body{font-family:Arial;padding:24px;font-size:11px;}h1{font-size:16px;margin-bottom:4px;}
    table{width:100%;border-collapse:collapse;margin-top:16px;}
    th{background:#0d9488;color:#fff;padding:6px 8px;text-align:left;font-size:10px;}
    td{padding:5px 8px;border-bottom:1px solid #e2e8f0;vertical-align:top;}
    tr:nth-child(even)td{background:#f8fafc;}
    @media print{button{display:none;}}</style></head><body>
    ${window.printHeaderHTML({ isReport: true, title: 'REKOD LOCUM DOKTOR', meta: [{ label: 'Dicetak', value: new Date().toLocaleString('ms-MY') }] })}
    <table><thead><tr>
      <th>Doktor Bercuti</th><th>Cawangan</th><th>Jenis Cuti</th><th>Tempoh Cuti</th>
      <th>Locum</th><th>Nama Locum</th><th>Tel</th><th>Tarikh Bertugas</th><th>Masa</th><th>Jumlah Jam</th><th>Status</th>
    </tr></thead><tbody>${rows}</tbody></table>
    <br><button onclick="window.print()" style="padding:8px 20px;background:#0d9488;color:#fff;border:none;border-radius:4px;cursor:pointer;font-weight:bold;">PRINT</button>
    </body></html>`);
    pw.document.close();
};

window.saveLocumEdit = async function(id) {
  const record = leaveRecords.find(r => r.id === id);
  if (!record) return;
  const hasLocum2 = showLocum2Set.has(id) || record.locum2Name;
  if (hasLocum2 && record.locum2Name && (!record.locum2Phone || !record.locum2Date || !record.locum2TimeStart || !record.locum2TimeEnd)) {
      alert('⚠️ Locum 2 tidak lengkap. Sila isi semua maklumat atau buang Locum 2.');
      return;
  }
  try {
      const upd = {
          locum1Name: record.locum1Name, locum1Phone: record.locum1Phone,
          locum1Date: record.locum1Date, locum1TimeStart: record.locum1TimeStart, locum1TimeEnd: record.locum1TimeEnd,
          locum2Name: record.locum2Name || '', locum2Phone: record.locum2Phone || '',
          locum2Date: record.locum2Date || '', locum2TimeStart: record.locum2TimeStart || '', locum2TimeEnd: record.locum2TimeEnd || ''
      };
      await updateDoc(doc(db, 'leaves', id.toString()), upd);
      window.logSystemActivity(`Dikemaskini maklumat Locum untuk cuti ${record.name}`);
      alert('✅ Maklumat locum berjaya dikemaskini.');
  } catch(e) {
      alert('Ralat menyimpan: ' + e.message);
  }
};

window.setProfileSettings = function(state) {
  showProfileSettings = state;
  render();
};

window.changePassword = async function(event) {
  event.preventDefault();
  const current = document.getElementById('pwd-current')?.value;
  const next    = document.getElementById('pwd-new')?.value;
  const confirm  = document.getElementById('pwd-confirm')?.value;

  if (!user) { alert('Sesi tidak sah. Sila log masuk semula.'); return; }
  if (!auth.currentUser || auth.currentUser.isAnonymous) { alert('Sesi tidak sah. Sila log masuk semula.'); return; }
  if (next !== confirm) { alert('❌ Kata laluan baharu tidak sepadan. Sila cuba lagi.'); return; }
  if ((next || '').length < 6) { alert('❌ Kata laluan baharu mesti sekurang-kurangnya 6 aksara.'); return; }

  try {
    const cred = EmailAuthProvider.credential(emailForIC(user.ic), current);
    await reauthenticateWithCredential(auth.currentUser, cred);
    await updatePassword(auth.currentUser, next);
    alert('✅ Kata laluan berjaya ditukar!');
    document.getElementById('pwd-current').value = '';
    document.getElementById('pwd-new').value = '';
    document.getElementById('pwd-confirm').value = '';
  } catch (err) {
    console.error('changePassword error:', err);
    if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
      alert('❌ Kata laluan semasa tidak betul. Sila cuba lagi.');
    } else {
      alert('Ralat menukar kata laluan. Sila cuba lagi.');
    }
  }
};

window.adminSetPassword = async function(ic, newPassword) {
  if (!newPassword || newPassword.length < 6) { alert('Kata laluan mesti sekurang-kurangnya 6 aksara.'); return false; }
  // Setting another user's password needs the Admin SDK. If the Cloud Function is
  // deployed (Blaze), this works from the app. If NOT deployed (no-Blaze setup),
  // we fall back to guiding IT to use the local reset-password.js script.
  try {
    const fn = httpsCallable(functions, 'setStaffPassword');
    await fn({ ic, newPassword });
    alert('✅ Kata laluan staf berjaya ditetapkan.');
    return true;
  } catch (err) {
    console.error('adminSetPassword error:', err);
    if (['functions/not-found', 'functions/internal', 'functions/unavailable', 'functions/failed-precondition'].includes(err.code)) {
      alert(`ℹ️ Set kata laluan dari aplikasi tidak tersedia (Cloud Function tidak di-deploy).\n\nIT boleh reset kata laluan staf ini melalui skrip di komputer:\n\nnode reset-password.js ${ic} <kata-laluan-baharu>`);
    } else {
      alert('Ralat menetapkan kata laluan: ' + (err.message || err.code));
    }
    return false;
  }
};

window.saveSelfProfile = async function(event) {
    if (event) event.preventDefault();
    const phone   = document.getElementById('self-phone')?.value?.trim() || '';
    const email   = document.getElementById('self-email')?.value?.trim() || '';
    const address = document.getElementById('self-address')?.value?.trim() || '';

    if (!user || !user.ic) {
        alert('Ralat: Sesi tidak sah. Sila log masuk semula.');
        return;
    }

    const cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone && !cleanPhone.startsWith('6')) {
        alert('⚠️ Format nombor tidak sah.\n\nNombor WhatsApp MESTI bermula dengan 6.\n\nContoh: 60171234678\n(bukan 0171234678)');
        return;
    }
    if (cleanPhone && (cleanPhone.length < 10 || cleanPhone.length > 12)) {
        alert('⚠️ Nombor telefon tidak sah. Contoh format: 60171234678');
        return;
    }

    const s = staffList.find(i => i.ic === user.ic);
    if (s) {
        s.phone   = phone;
        s.email   = email;
        s.address = address;
        user.phone   = phone;
        user.email   = email;
        user.address = address;
    }

    try {
        await updateDoc(doc(db, "staff", user.ic), { phone, email, address });
    } catch (err) {
        console.error("Error saving profile:", err);
        alert('Ralat menyimpan profil ke pangkalan data.');
        return;
    }

    alert('✅ Profil berjaya dikemaskini!');
    window.setProfileSettings(false);
};

const _tabToGroup = {
  pending:'approvals',
  staff:'people', branches:'people', roles_categories:'people', reg_requests:'people',
  hr_reports:'reports', locum_records:'reports', master_audit:'reports', login_audit:'reports', balance_view:'reports',
  routing:'config', access_control:'config', public_holidays:'config', whatsapp_settings:'config', policy_editor:'config'
};
const _groupFirstTab = {
  approvals: ['pending'],
  people:    ['staff','branches','roles_categories','reg_requests'],
  reports:   ['hr_reports','locum_records','master_audit','login_audit'],
  config:    ['policy_editor','routing','access_control','public_holidays','whatsapp_settings']
};
const _tabPermMap = {
  pending:'manage_pending', staff:'manage_staff', branches:'manage_branches',
  roles_categories:'manage_roles_categories', hr_reports:'manage_reports',
  locum_records:'locum_records', master_audit:'manage_audit', login_audit:'manage_login_audit',
  balance_view:'manage_reports',
  routing:'manage_routing', access_control:'manage_access', public_holidays:'manage_holidays',
  whatsapp_settings:'wa_setting', policy_editor:'manage_policy'
};
window.setManageGroup = function(group) {
  managementGroup = group;
  const perms = window.rbacMatrix[user ? user.role : ''] || {};
  const tabs = _groupFirstTab[group] || [];
  for (const t of tabs) {
    if (t === 'reg_requests') { if (user && ['admin','hr','super_admin'].includes(user.role)) { managementTab = t; break; } }
    else if (!_tabPermMap[t] || perms[_tabPermMap[t]]) { managementTab = t; break; }
  }
  render();
};
window.setManageTab = function(tab) {
  managementTab = tab;
  managementGroup = _tabToGroup[tab] || managementGroup;
  render();
};

let showAddStaffModal = false;
window.openAddStaff = function() { showAddStaffModal = true; render(); };
window.closeAddStaff = function() { showAddStaffModal = false; render(); };

window.openRegisterModal = function() { showRegisterModal = true; render(); };
window.closeRegisterModal = function() { showRegisterModal = false; render(); };

window.submitRegister = async function(event) {
  event.preventDefault();
  const form = event.target;
  const name     = form.querySelector('#reg-name').value.trim().toUpperCase();
  const ic       = form.querySelector('#reg-ic').value.trim();
  const branch   = form.querySelector('#reg-branch').value;
  const category = form.querySelector('#reg-category').value;
  let phone = form.querySelector('#reg-phone').value.trim().replace(/\D/g, '');
  if (phone.startsWith('0')) phone = '6' + phone;
  else if (!phone.startsWith('6')) phone = '60' + phone;

  if (!name || !ic || !branch || !category || !phone) {
    alert('Sila lengkapkan semua maklumat yang diperlukan.');
    return;
  }
  if (staffList.find(s => s.ic === ic)) {
    alert('No. IC ini sudah berdaftar dalam sistem. Sila log masuk atau hubungi HR/Admin.');
    return;
  }
  const existing = registrationRequests.find(r => r.ic === ic && r.status === 'pending');
  if (existing) {
    alert('Permohonan anda sedang dalam semakan. Sila tunggu kelulusan daripada HR/Admin.');
    return;
  }

  const reqId = `reg_${ic}_${Date.now()}`;
  const reqData = { name, ic, branch, category, phone, status: 'pending', submittedAt: Date.now() };

  try {
    await setDoc(doc(db, 'registration_requests', reqId), reqData);

    // Notify admins via WhatsApp
    const admins = staffList.filter(s => ['admin', 'hr', 'super_admin'].includes(s.role) && s.phone);
    const msg = `📋 *PERMOHONAN DAFTAR BAHARU*\n\nNama: ${name}\nNo. IC: ${ic}\nCawangan: ${branch}\nKategori: ${category}\nNo. Tel: ${phone}\n\nSila log masuk ke sistem untuk meluluskan atau menolak permohonan ini.`;
    for (const admin of admins) {
      await window.sendWhatsApp(admin.phone, msg);
    }

    alert('✅ Permohonan anda telah dihantar!\n\nHR/Admin akan menyemak dan meluluskan akaun anda tidak lama lagi. Anda akan dihubungi melalui WhatsApp.');
    window.closeRegisterModal();
  } catch (err) {
    console.error('submitRegister error:', err);
    alert('Ralat menghantar permohonan. Sila cuba lagi.');
  }
};

window.approveRegistration = async function(docId) {
  const req = registrationRequests.find(r => r.docId === docId);
  if (!req) return;
  if (staffList.find(s => s.ic === req.ic)) {
    alert('No. IC ini sudah wujud dalam sistem.');
    await updateDoc(doc(db, 'registration_requests', docId), { status: 'rejected', rejectedAt: Date.now(), rejectedReason: 'IC sudah wujud' });
    return;
  }
  try {
    const newStaff = {
      name: req.name, ic: req.ic, branch: req.branch, category: req.category,
      role: 'staff', phone: req.phone, inactive: false,
      startDate: new Date().toISOString().split('T')[0]
    };
    await setDoc(doc(db, 'staff', req.ic), newStaff);
    await updateDoc(doc(db, 'registration_requests', docId), { status: 'approved', approvedAt: Date.now() });
    window.logSystemActivity(`Approved registration: ${req.name} (${req.ic})`);
    await window.sendWhatsApp(req.phone, `✅ *Selamat datang ke KSB Leave System!*\n\nNama: ${req.name}\nKata Laluan: ${req.ic}\n\nAkaun anda sedang diaktifkan. Sila log masuk sebentar lagi dan tukar kata laluan anda.`);
    alert(`✅ Permohonan ${req.name} telah diluluskan!\n\n⚠️ IT perlu jalankan "node provision-auth.js" untuk mengaktifkan akaun log masuk. Kata laluan awal ialah No. IC (${req.ic}).`);
  } catch (err) {
    console.error('approveRegistration error:', err);
    alert('Ralat meluluskan permohonan.');
  }
};

window.rejectRegistration = async function(docId) {
  const req = registrationRequests.find(r => r.docId === docId);
  if (!req) return;
  const reason = prompt(`Sebab penolakan untuk ${req.name} (boleh kosongkan):`);
  if (reason === null) return; // user cancelled
  try {
    await updateDoc(doc(db, 'registration_requests', docId), { status: 'rejected', rejectedAt: Date.now(), rejectedReason: reason || 'Tidak dinyatakan' });
    window.logSystemActivity(`Rejected registration: ${req.name} (${req.ic})`);
    await window.sendWhatsApp(req.phone, `❌ *Permohonan Daftar Ditolak*\n\nNama: ${req.name}\nSebab: ${reason || 'Tidak dinyatakan'}\n\nSila hubungi HR/Admin untuk maklumat lanjut.`);
    alert(`Permohonan ${req.name} telah ditolak.`);
  } catch (err) {
    console.error('rejectRegistration error:', err);
    alert('Ralat menolak permohonan.');
  }
};

window.submitAddStaff = async function(event) {
  event.preventDefault();
  const form = event.target;
  const name     = form.querySelector('#as-name').value.trim().toUpperCase();
  const ic       = form.querySelector('#as-ic').value.trim();
  const branch   = form.querySelector('#as-branch').value;
  const category = form.querySelector('#as-category').value;
  const role     = form.querySelector('#as-role').value;
  const phone    = form.querySelector('#as-phone').value.trim();
  const initialPassword = form.querySelector('#as-password')?.value || ic;

  if (!name || !ic || !branch) {
    alert('Sila lengkapkan Nama, No. IC, dan Cawangan.');
    return;
  }
  if (staffList.find(s => s.ic === ic)) {
    alert('No. IC ini sudah wujud dalam sistem. Sila semak semula.');
    return;
  }

  const newStaff = { name, ic, branch, category, role, phone, inactive: false, startDate: new Date().toISOString().split('T')[0] };

  try {
    await setDoc(doc(db, 'staff', ic), newStaff);
    window.logSystemActivity(`Added new staff: ${name}`);
    // No-Blaze setup: the login account is created when IT runs provision-auth.js.
    // Initial password defaults to the staff's IC; IT can change it via reset-password.js.
    alert(`✅ Staf baharu "${name}" berjaya ditambah!\n\n⚠️ IT perlu jalankan "node provision-auth.js" untuk mengaktifkan akaun log masuk. Kata laluan awal ialah No. IC (${ic}).`);
    window.closeAddStaff();
  } catch (err) {
    console.error('submitAddStaff error:', err);
    alert('Ralat menyimpan staf. Sila cuba lagi.');
  }
};

window.toggleInactive = function() {
  showInactiveStaff = !showInactiveStaff;
  render();
};

window.toggleBranch = function(id) {
  const content = document.getElementById('bc-' + id);
  const chevron = document.getElementById('bch-' + id);
  if (!content) return;
  const open = content.style.display !== 'none';
  content.style.display = open ? 'none' : 'block';
  if (chevron) chevron.style.transform = open ? 'rotate(0deg)' : 'rotate(180deg)';
};

window.toggleAllBranches = function(show) {
  document.querySelectorAll('[id^="bc-"]').forEach(function(el) { el.style.display = show ? 'block' : 'none'; });
  document.querySelectorAll('[id^="bch-"]').forEach(function(el) { el.style.transform = show ? 'rotate(180deg)' : 'rotate(0deg)'; });
};

const MY_STATES = ['Pahang','Terengganu','Kelantan','Perak','Selangor','Negeri Sembilan','Melaka','Johor','Kedah','Perlis','Pulau Pinang','Sabah','Sarawak','Kuala Lumpur','Putrajaya'];
const PAHANG_DAERAH = ['Kuantan','Bentong','Temerloh','Maran','Jerantut','Pekan','Rompin','Bera','Cameron Highlands','Lipis','Raub'];
const TERENGGANU_DAERAH = ['Kuala Terengganu','Kemaman','Dungun','Hulu Terengganu','Besut','Setiu','Marang','Kuala Nerus'];
const STATE_DAERAH = { Pahang: PAHANG_DAERAH, Terengganu: TERENGGANU_DAERAH };

// ============================================================
// APPROVAL ROUTING CONFIG
// ============================================================
const ROUTING_DEFAULTS = {
  terengganu:       { needs_tl: false, p1_doctor_pic: true,  p1_supervisor: false, p1_hod_balok: false, needs_p2: false },
  pahang_lain:      { needs_tl: false, p1_doctor_pic: true,  p1_supervisor: false, p1_hod_balok: false, needs_p2: true  },
  admin_balok:      { needs_tl: false, p1_doctor_pic: false, p1_supervisor: false, p1_hod_balok: true,  needs_p2: true  },
  doctor_pahang:    { needs_tl: false, p1_doctor_pic: false, p1_supervisor: true,  p1_hod_balok: false, needs_p2: true  },
  operation_balok:  { needs_tl: true,  p1_doctor_pic: false, p1_supervisor: true,  p1_hod_balok: false, needs_p2: true  },
  xray_sono_balok:  { needs_tl: false, p1_doctor_pic: false, p1_supervisor: true,  p1_hod_balok: false, needs_p2: true  },
  juru_audio_balok: { needs_tl: false, p1_doctor_pic: false, p1_supervisor: false, p1_hod_balok: true,  needs_p2: true  },
  pemandu_balok:    { needs_tl: false, p1_doctor_pic: false, p1_supervisor: true,  p1_hod_balok: false, needs_p2: true  },
};
let approvalRouting = JSON.parse(JSON.stringify(ROUTING_DEFAULTS));

window.getStaffGroup = function(s) {
  const branchObj  = branches.find(b => b.name === s.branch);
  const isTerengganu = branchObj && branchObj.state === 'Terengganu';
  const isBalok      = (s.branch || '').includes('Balok');

  // Peranan paramedik — laluan kelulusan khusus, hanya di Balok
  if (['juru_xray', 'sonographer'].includes(s.role) && isBalok) return 'xray_sono_balok';
  if (s.role === 'juru_audio'                        && isBalok) return 'juru_audio_balok';
  if (s.role === 'pemandu'                           && isBalok) return 'pemandu_balok';

  // Hanya Operation Staff di Balok → TL → Supervisor → HR
  if (isBalok && s.category === 'Operation Staff') return 'operation_balok';
  // Admin Staff di Balok HQ → HOD Balok
  if (isBalok && s.category === 'Admin Staff') return 'admin_balok';
  if (isTerengganu)  return 'terengganu';

  // Doktor di Pahang KECUALI Bentong & MCKIP → Supervisor Balok (HQ) → HR, bukan HOD
  if (s.category === 'Doctor' && branchObj && branchObj.state === 'Pahang'
      && branchObj.daerah !== 'Bentong'
      && s.branch !== 'Klinik Syed Badaruddin MCKIP') {
    return 'doctor_pahang';
  }

  return 'pahang_lain';
};

window.staffNeedsP2 = function(s) {
  if (!s) return true;
  const cfg = approvalRouting[window.getStaffGroup(s)];
  return cfg ? cfg.needs_p2 !== false : true;
};

window.getRoutingP1Approvers = function(staffMember) {
  const group = window.getStaffGroup(staffMember);
  const cfg   = approvalRouting[group] || {};
  let candidates = [];
  if (cfg.p1_supervisor) {
    const useBalok = group === 'operation_balok' || group === 'xray_sono_balok' || group === 'doctor_pahang';
    const supBranch = useBalok ? 'Klinik Syed Badaruddin Balok (HQ)' : staffMember.branch;
    candidates.push(...staffList.filter(s => s.role === 'supervisor' && s.branch === supBranch && !s.inactive && s.ic !== staffMember.ic));
  }
  if (cfg.p1_doctor_pic) {
    candidates.push(...staffList.filter(s => s.role === 'doctor_pic' && s.branch === staffMember.branch && !s.inactive && s.ic !== staffMember.ic));
  }
  if (cfg.p1_hod_balok) {
    // HOD Balok duduk di Balok HQ — pelulus pusat untuk admin Balok & juru audio Balok
    candidates.push(...staffList.filter(s => s.role === 'hod_balok' && s.branch === 'Klinik Syed Badaruddin Balok (HQ)' && !s.inactive && s.ic !== staffMember.ic));
  }
  return [...new Map(candidates.map(c => [c.ic, c])).values()];
};

window.toggleRouting = function(group, field) {
  approvalRouting[group][field] = !approvalRouting[group][field];
  render();
};

window.saveRouting = async function() {
  try {
    await setDoc(doc(db, 'config', 'approvalRouting'), approvalRouting);
    alert('✅ Laluan Kelulusan berjaya disimpan!');
  } catch(e) { alert('Ralat menyimpan: ' + e.message); }
};

window.buildStateSelect = function(selectedState, docId) {
  const opts = MY_STATES.map(s => '<option value="' + s + '"' + (s === selectedState ? ' selected' : '') + '>' + s + '</option>').join('');
  return '<select data-docid="' + docId + '" onchange="window.saveBranchState(this.dataset.docid, this.value)" style="padding:0.25rem 0.5rem;border-radius:8px;border:1px solid rgba(163,177,198,0.5);background:rgba(255,255,255,0.7);color:var(--text);font-size:0.8rem;cursor:pointer;color-scheme:light;max-width:160px;">' + opts + '</select>';
};

window.saveBranchState = async function(docId, newState) {
  try {
    await updateDoc(doc(db, 'branches', docId), { state: newState, daerah: '' });
    render();
  } catch(e) { alert('Gagal simpan negeri: ' + e.message); }
};

window.buildDaerahSelect = function(selectedDaerah, docId, state) {
  const list = STATE_DAERAH[state] || [];
  if (!list.length) return '';
  const opts = [''].concat(list).map(d => '<option value="' + d + '"' + (d === (selectedDaerah || '') ? ' selected' : '') + '>' + (d || '— Pilih Daerah —') + '</option>').join('');
  return '<select data-docid="' + docId + '" onchange="window.saveBranchDaerah(this.dataset.docid, this.value)" style="padding:0.25rem 0.5rem;border-radius:8px;border:1px solid rgba(163,177,198,0.5);background:rgba(255,255,255,0.7);color:var(--text);font-size:0.8rem;cursor:pointer;color-scheme:light;max-width:140px;">' + opts + '</select>';
};

window.saveBranchDaerah = async function(docId, daerah) {
  try {
    await updateDoc(doc(db, 'branches', docId), { daerah });
  } catch(e) { alert('Gagal simpan daerah: ' + e.message); }
};

window.updateDaerahOptions = function() {
  const stateEl  = document.getElementById('new-branch-state');
  const daerahEl = document.getElementById('new-branch-daerah');
  if (!stateEl || !daerahEl) return;
  const list = STATE_DAERAH[stateEl.value] || [];
  daerahEl.innerHTML = '<option value="">— Daerah (pilihan) —</option>'
    + list.map(d => '<option value="' + d + '">' + d + '</option>').join('');
};

window.addNewBranch = async function() {
  const nameEl   = document.getElementById('new-branch-name');
  const stateEl  = document.getElementById('new-branch-state');
  const daerahEl = document.getElementById('new-branch-daerah');
  if (!nameEl || !stateEl) return;
  const name   = nameEl.value.trim();
  const state  = stateEl.value;
  const daerah = daerahEl ? daerahEl.value : '';
  if (!name) { nameEl.focus(); return; }
  const id = name.replace(/[^a-zA-Z0-9]/g, '_').slice(0,40) + '_' + Date.now();
  try {
    await setDoc(doc(db, 'branches', id), { name, state, daerah, manager: user ? user.name : 'Admin' });
    nameEl.value = '';
    if (daerahEl) daerahEl.value = '';
  } catch(e) { alert('Gagal tambah: ' + e.message); }
};

window.deleteBranchById = async function(docId, name) {
  if (!confirm('Padam cawangan "' + name + '"?')) return;
  try {
    await deleteDoc(doc(db, 'branches', docId));
  } catch(e) { alert('Gagal padam: ' + e.message); }
};


window.setManageSearch = function(val) {
  manageSearchQuery = val;
  render();
};

window.setManageRoleFilter = function(val) {
  manageRoleFilter = val;
  render();
};

window.setManageCategoryFilter = function(val) {
  manageCategoryFilter = val;
  render();
};

async function saveStaffConfig() {
  await setDoc(doc(db, 'settings', 'staff_config'), {
    staffCategories: window.staffConfig.staffCategories,
    roleLabels: window.staffConfig.roleLabels,
    customRoles: window.staffConfig.customRoles
  });
}

window.addStaffCategory = async function() {
  const name = (prompt('Nama kategori baru:') || '').trim();
  if (!name) return;
  if (window.staffConfig.staffCategories.includes(name)) { alert('Kategori sudah wujud.'); return; }
  window.staffConfig.staffCategories.push(name);
  await saveStaffConfig();
  render();
};

window.deleteStaffCategory = async function(name) {
  if (CORE_CATEGORIES.includes(name)) { alert('Kategori teras tidak boleh dipadam.'); return; }
  if (!confirm('Padam kategori "' + name + '"?')) return;
  window.staffConfig.staffCategories = window.staffConfig.staffCategories.filter(c => c !== name);
  await saveStaffConfig();
  render();
};

window.addCustomRole = async function() {
  const key = (prompt('Kunci peranan (huruf kecil, tiada ruang, contoh: ketua_unit):') || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (!key) return;
  if (window.rbacMatrix[key]) { alert('Peranan sudah wujud.'); return; }
  const label = (prompt('Nama paparan peranan (contoh: Ketua Unit):') || '').trim();
  if (!label) return;
  // Add to rbacMatrix with zeroed permissions
  window.rbacMatrix[key] = { ...JSON.parse(JSON.stringify(_rbacCodeDefaults.staff)), manage_roles_categories: false };
  window.staffConfig.roleLabels[key] = label;
  window.staffConfig.customRoles.push({ key, label });
  await saveStaffConfig();
  await setDoc(doc(db, 'settings', 'rbac'), window.rbacMatrix);
  render();
};

window.deleteCustomRole = async function(key) {
  if (CORE_ROLES.includes(key)) { alert('Peranan teras tidak boleh dipadam.'); return; }
  if (!confirm('Padam peranan "' + key + '"? Staff dengan peranan ini perlu dikemas kini secara manual.')) return;
  delete window.rbacMatrix[key];
  delete window.staffConfig.roleLabels[key];
  window.staffConfig.customRoles = window.staffConfig.customRoles.filter(r => r.key !== key);
  await saveStaffConfig();
  await setDoc(doc(db, 'settings', 'rbac'), window.rbacMatrix);
  render();
};

window.setLoginBranch = function(branch) {
  selectedLoginBranch = branch;
  selectedLoginStaffIC = ''; // Reset staff selection when branch changes
  // Clear any existing search input UI state
  const searchInput = document.getElementById('staff-search-input');
  if (searchInput) searchInput.value = '';
  render();
};

window.setLoginStaff = function(ic) {
  selectedLoginStaffIC = ic;
  render();
};

window.setEditingStaff = function(ic) {
    editingStaff = ic;
    render();
};

window.deleteStaff = async function(ic) {
    const staff = staffList.find(s => s.ic === ic);
    if (!staff) return;
    const confirmed = confirm(`Adakah anda pasti untuk BUANG "${staff.name}" daripada sistem?\n\nTindakan ini tidak boleh dibatalkan.`);
    if (!confirmed) return;
    try {
        await deleteDoc(doc(db, 'staff', ic));
        window.logSystemActivity(`Deleted staff record: ${staff.name} (${ic})`);
        alert(`"${staff.name}" berjaya dibuang dari sistem.`);
    } catch (err) {
        console.error('deleteStaff error:', err);
        alert('Ralat semasa membuang rekod. Sila cuba lagi.');
    }
};

window.getServiceDurationText = function(dateStr) {
  if (!dateStr) return "-";
  const start = new Date(dateStr);
  const now = new Date();
  
  let years = now.getFullYear() - start.getFullYear();
  let months = now.getMonth() - start.getMonth();
  
  if (months < 0 || (months === 0 && now.getDate() < start.getDate())) {
    years--;
    months += 12;
  }
  
  // Day of month fractional adjustment
  if (now.getDate() < start.getDate() && months > 0) {
    months--;
  } else if (now.getDate() < start.getDate() && months === 0 && years > 0) {
    years--;
    months = 11;
  }

  const yPart = years > 0 ? `${years} TAHUN` : "";
  const mPart = months > 0 ? `${months} BULAN` : "";
  
  if (yPart && mPart) return `${yPart}, ${mPart}`;
  return yPart || mPart || "0 BULAN";
};

window.calculateYears = function(dateStr) {
    const text = window.getServiceDurationText(dateStr);
    const el = document.getElementById('years-badge-text');
    if(el) el.innerText = `${text} BERKHIDMAT`;
};

// Formula B: Baki = Jumlah − Guna Sebelum Sistem − Guna Dalam Sistem − Pelarasan HR.
// prefix: 'al' | 'mc' | 'el'. AL ada Jumlah = CF + ent_AL; MC/EL = ent terus.
window._recalcLeaveBalance = function(prefix) {
    let total;
    if (prefix === 'al') {
        const cf = parseFloat(document.getElementById('ent-CF')?.value || 0);
        const al = parseFloat(document.getElementById('ent-AL')?.value || 0);
        total = cf + al;
        const tEl = document.getElementById('al-total-display');
        if (tEl) tEl.value = total.toFixed(0);
    } else {
        total = parseFloat(document.getElementById('ent-' + prefix.toUpperCase())?.value || 0);
    }
    const pre = parseFloat(document.getElementById(prefix + '-used-pre-input')?.value || 0);
    const sysAuto = parseFloat(document.getElementById(prefix + '-sys-used-display')?.dataset.used || 0);
    const sysManual = parseFloat(document.getElementById(prefix + '-sys-adj-input')?.value || 0);
    const sys = autoSystemUsage ? sysAuto : sysManual;
    const pel = parseFloat(document.getElementById(prefix + '-pelarasan-input')?.value || 0);
    const balEl = document.getElementById(prefix + '-balance-display');
    if (balEl) balEl.value = Math.max(0, total - pre - sys - pel).toFixed(1);
};
window._updateAlTotal   = () => window._recalcLeaveBalance('al');
window._updateAlBalance = () => window._recalcLeaveBalance('al');

let systemAuditLogs = [];

window.logSystemActivity = async function(activityDesc, overrideUser) {
    const actUser = overrideUser || user;
    if (!actUser) return;
    
    const tzStr = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Unknown';
    const osInfo = navigator.userAgent.includes('Windows') ? 'Windows Web' : navigator.userAgent.includes('Mac') ? 'Mac OS Web' : 'Mobile/Web';
    
    const newLog = {
        id: Date.now().toString(),
        timestamp: new Date().toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' }),
        name: actUser.name,
        branch: actUser.branch || 'N/A',
        userId: actUser.ic,
        ip: osInfo,
        location: tzStr,
        activity: activityDesc,
        createdAt: Date.now()
    };
    
    try {
        await setDoc(doc(db, "audit_logs", newLog.id), newLog);
    } catch (err) {
        console.error("Error logging activity: ", err);
    }
};

let leaveRecords = [];
let staffList = [];

// Header korporat SERAGAM untuk SEMUA PDF/print. Gaya inline penuh supaya berfungsi
// dalam dokumen utama mahupun tetingkap window.open. Satu sumber tunggal.
//   opts.branch   — cawangan rekod/individu (borang). 'SEMUA'/kosong dianggap laporan.
//   opts.isReport — true untuk laporan agregat → guna main branch jika tiada cawangan.
//   opts.title    — tajuk dokumen (cth. BORANG PERMOHONAN CUTI).
//   opts.meta     — [{label,value}] baris kecil di bawah tajuk (cth. Tahun, Jenis, Jana).
window.printHeaderHTML = function(opts) {
    opts = opts || {};
    const branchLine = (opts.branch && opts.branch !== 'SEMUA')
        ? opts.branch
        : (opts.isReport ? 'Klinik Syed Badaruddin Sdn. Bhd.' : '—');
    const title = opts.title || '';
    const meta = Array.isArray(opts.meta) ? opts.meta.filter(m => m && m.value != null && m.value !== '') : [];
    const metaLine = meta.length
        ? `<div style="text-align:center;font-size:10px;color:#718096;margin:0 0 18px;position:relative;z-index:1;">${meta.map(m => `<strong style="color:#4a5568;">${m.label}:</strong> ${m.value}`).join(' &nbsp;·&nbsp; ')}</div>`
        : '';
    return `
        <img src="${logos.ksb}" style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:420px;opacity:0.12;pointer-events:none;z-index:0;print-color-adjust:exact;-webkit-print-color-adjust:exact;" alt="">
        <div style="display:flex;align-items:center;gap:18px;border-bottom:3px solid #9b2c2c;padding-bottom:14px;margin-bottom:18px;position:relative;z-index:1;">
            <img src="${logos.ksb}" style="width:66px;height:66px;border-radius:12px;object-fit:contain;flex-shrink:0;" alt="KSB Logo">
            <div style="flex:1;text-align:center;">
                <h1 style="color:#9b2c2c;font-size:21px;font-weight:bold;margin:0;letter-spacing:0.5px;">KLINIK SYED BADARUDDIN SDN. BHD.</h1>
                <p style="color:#7a3b3b;font-size:10px;letter-spacing:1.5px;margin:3px 0 0;text-transform:uppercase;">Servicing Community Since 1991</p>
                <p style="color:#4a5568;font-size:11px;font-weight:bold;margin:6px 0 0;">Cawangan: ${branchLine}</p>
            </div>
            <img src="${logos.ksb}" style="width:66px;height:66px;border-radius:12px;object-fit:contain;flex-shrink:0;" alt="KSB Logo">
        </div>
        ${title ? `<div style="text-align:center;margin-bottom:${metaLine ? '10px' : '20px'};position:relative;z-index:1;"><span style="border:2px solid #9b2c2c;display:inline-block;padding:5px 26px;font-weight:bold;letter-spacing:2px;font-size:13px;color:#9b2c2c;">${title}</span></div>` : ''}
        ${metaLine}
    `;
};

window.printLeave = function(id) {
    const record = leaveRecords.find(r => r.id === id);
    if (!record) return;

    // Kira nilai sebenar dari rekod staf + getLeaveStats (selari dengan Management Hub)
    const staffObj = staffList.find(s => s.ic === record.ic) || {};
    const startWork = staffObj.startDate || record.startDate || '—';
    const stats = window.getLeaveStats(staffObj, record.type);
    // BAKI CUTI TERDAHULU = baki SEBELUM cuti ini ditolak; BAKI CUTI = baki SELEPAS ditolak.
    // Kira baki berjalan pada saat cuti ini (jumlah cuti jenis-sama yang DILULUSKAN lebih
    // awal ikut tarikh mula), bukan baki semasa global — supaya betul untuk SETIAP cuti,
    // bukan hanya yang terakhir. Asas (stats.ent) sama dengan dashboard → kekal segerak.
    const { before: bakiTerdahulu, after: bakiSelepas } = recordBalances({
      record,
      ent: stats.ent,
      // Potongan bukan-rekod: Guna Sebelum + Pelarasan HR (+ Guna Sistem manual bila mod manual).
      alAdj: (stats.usedPre || 0) + (stats.pelarasan || 0) + (autoSystemUsage ? 0 : (stats.usedSysAdj || 0)),
      // Mod manual → jangan kira rekod diluluskan (selari dengan getLeaveStats).
      records: autoSystemUsage ? leaveRecords : [],
    });
    // KELAYAKAN CUTI TAHUNAN: untuk AL guna kelayakan tahunan penuh; jenis lain guna entitlement jenis itu.
    const kelayakan = record.type === 'AL' ? window.getEntitlementAL(staffObj) : stats.ent;
    const fmtHari = n => (Number.isFinite(n) ? (Math.round(n * 10) / 10).toString() : '0') + ' Hari';

    let printHTML = `
    <div id="print-container" style="font-family: Arial, sans-serif; padding: 40px; color: #841824;">
        ${window.printHeaderHTML({ branch: record.branch, title: 'BORANG PERMOHONAN CUTI' })}
        
        <div style="display: flex; justify-content: space-between; margin-bottom: 20px; font-size: 11px; font-weight: bold;">
            <span>[ ${record.type === 'AL' ? 'X' : ' '} ] CUTI TAHUNAN</span>
            <span>[ ${record.type === 'CME' ? 'X' : ' '} ] CUTI CME</span>
            <span>[ ${record.type === 'ML' ? 'X' : ' '} ] CUTI BERSALIN</span>
            <span>[ ${record.type === 'EL' ? 'X' : ' '} ] CUTI EHSAN</span>
            <span>[ ${record.type === 'UL' ? 'X' : ' '} ] TANPA GAJI</span>
        </div>
        
        <table style="width: 100%; border-collapse: separate; border-spacing: 0 10px; font-size: 12px; font-weight: bold;">
            <tr>
                <td style="width: 30%; color: #4a5568;">TARIKH MEMOHON CUTI</td>
                <td style="border: 2px solid #e53e3e; padding: 8px;">${record.startDate}</td>
            </tr>
            <tr>
                <td style="color: #4a5568;">NAMA PEMOHON</td>
                <td style="border: 2px solid #e53e3e; padding: 8px;">${record.name}</td>
            </tr>
            <tr>
                <td style="color: #4a5568;">NO. K/P</td>
                <td style="border: 2px solid #e53e3e; padding: 8px;">${record.ic}</td>
            </tr>
            <tr>
                <td style="color: #4a5568;">TARIKH MULA BEKERJA</td>
                <td style="border: 2px solid #e53e3e; padding: 8px;">${startWork}</td>
            </tr>
            <tr>
                <td style="color: #4a5568;">KELAYAKAN CUTI TAHUNAN</td>
                <td style="border: 2px solid #e53e3e; padding: 8px;">${fmtHari(kelayakan)}</td>
            </tr>
            <tr>
                <td style="color: #4a5568;">BAKI CUTI TERDAHULU</td>
                <td style="border: 2px solid #e53e3e; padding: 8px;">${fmtHari(bakiTerdahulu)}</td>
            </tr>
            <tr>
                <td style="color: #4a5568;">JUMLAH CUTI DIPOHON</td>
                <td>
                    <div style="display: flex; gap: 10px; align-items: center;">
                        <div style="border: 2px solid #e53e3e; padding: 8px; flex: 1; text-align: center;">${record.days} Hari</div>
                        <span style="color: #4a5568; font-size: 10px;">TARIKH:</span>
                        <div style="border: 2px solid #e53e3e; padding: 8px; flex: 3;">${record.startDate} to ${record.endDate}</div>
                    </div>
                </td>
            </tr>
            <tr>
                <td style="color: #4a5568;">BAKI CUTI</td>
                <td style="border: 2px solid #e53e3e; padding: 8px;">${fmtHari(bakiSelepas)}</td>
            </tr>
            <tr>
                <td style="color: #4a5568;">TUGASAN DIGANTI OLEH (LOCUM)</td>
                <td style="border: 1px solid #718096; padding: 8px; color: black;">${record.locumName || record.handoverName || 'Belum Ditentukan'}</td>
            </tr>
            <tr>
                <td></td>
                <td style="border: 2px solid #e53e3e; padding: 20px 8px; margin-top: 10px; font-style: italic; color: #4a5568;">
                    <span style="font-weight: bold; font-style: normal; display: inline-block; width: 80px;">SEBAB CUTI</span> ${record.reason}
                </td>
            </tr>
        </table>
        
        <table style="width: 100%; border-collapse: collapse; margin-top: 40px; text-align: center; font-size: 10px; font-weight: bold;">
            <tr>
                <td style="border: 1px solid black; padding: 5px;">T/TANGAN PEMOHON</td>
                <td style="border: 1px solid black; padding: 5px;">DISOKONG</td>
                <td style="border: 1px solid black; padding: 5px;">DILULUSKAN/TIDAK LULUS</td>
            </tr>
            <tr>
                <td style="border: 1px solid black; height: 80px;"></td>
                <td style="border: 1px solid black; height: 80px;"></td>
                <td style="border: 1px solid black; height: 80px;"></td>
            </tr>
        </table>
    </div>
    `;
    document.body.insertAdjacentHTML('beforeend', printHTML);
    window.print();
    document.getElementById('print-container').remove();
};

window.editLeave = function(id) {
    const rec = leaveRecords.find(r => r.id === id);
    if (!rec) return;
    const isAdminEditor = ['admin', 'hr', 'super_admin'].includes(user.role);
    const isOwner = rec.ic === user.ic;
    const isApprover = window.canManageRequest(user, rec);
    const finalized = ['APPROVED', 'REJECTED', 'CANCELLED'].includes(rec.status);
    // Staf/pelulus hanya boleh ubah semasa belum diluluskan muktamad; HR/Admin boleh bila-bila (pembetulan rekod).
    if (!isAdminEditor && finalized) { alert('Permohonan ini sudah selesai dan tidak boleh diubah.'); return; }
    if (!isAdminEditor && !isOwner && !isApprover) { alert('Anda tidak mempunyai kebenaran untuk mengubah permohonan ini.'); return; }
    editingLeaveId = id;
    render();
};

// Kira semula bilangan hari (cadangan) bila tarikh diubah dalam modal edit.
// Nilai boleh ditindih manual selepas ini.
window.recalcEditLeaveDays = function() {
    const rec = leaveRecords.find(r => r.id === editingLeaveId);
    if (!rec) return;
    const s = document.querySelector('#el-start')?.value;
    const e = document.querySelector('#el-end')?.value;
    const daysEl = document.querySelector('#el-days');
    if (!s || !e || !daysEl) return;
    daysEl.value = window.computeLeaveDays(s, e, staffList.find(x => x.ic === rec.ic));
};

// Chargeable leave-day count for a staff member over a date range.
// Admin Staff (Mon–Fri) skip weekends + their state's public holidays;
// everyone else counts all calendar days. Returns whole days (callers apply half-day).
window.computeLeaveDays = function(startDate, endDate, staff) {
  const isAdmin = !!staff && (staff.category === 'Admin Staff' || staff.category === 'Admin');
  let holidayDates = [];
  if (isAdmin) {
    const branchObj = branches.find(b => b.name === (staff.branch || ''));
    const state = branchObj ? branchObj.state : null;
    const list = state === 'Terengganu' ? publicHolidays.terengganu
               : state === 'Pahang'     ? publicHolidays.pahang
               : [];
    holidayDates = (list || []).map(h => h.date);
  }
  return countLeaveDays(startDate, endDate, isAdmin, holidayDates);
};

// Staff edits their OWN leave's dates/reason. Resets to PENDING (re-approval),
// after a before→after confirmation of exactly what changed.
window.staffEditOwnLeave = async function(id) {
  const rec = leaveRecords.find(r => r.id === id);
  if (!rec) return;
  if (rec.ic !== user.ic) { alert('Anda hanya boleh mengubah permohonan anda sendiri.'); return; }
  if (['APPROVED', 'REJECTED', 'CANCELLED'].includes(rec.status)) {
    alert('Permohonan ini sudah selesai dan tidak boleh diubah.'); return;
  }

  const newStart = prompt('Tarikh Mula (YYYY-MM-DD):', rec.startDate);
  if (newStart === null) return;
  const newEnd = prompt('Tarikh Akhir (YYYY-MM-DD):', rec.endDate);
  if (newEnd === null) return;
  const newReason = prompt('Sebab:', rec.reason);
  if (newReason === null) return;

  // Build a diff of only what changed.
  const changes = [];
  if (newStart !== rec.startDate) changes.push(`• Tarikh Mula: ${rec.startDate} → ${newStart}`);
  if (newEnd !== rec.endDate)     changes.push(`• Tarikh Akhir: ${rec.endDate} → ${newEnd}`);
  if (newReason !== rec.reason)   changes.push(`• Sebab: "${rec.reason}" → "${newReason}"`);
  if (!changes.length) { alert('Tiada perubahan dibuat.'); return; }

  const days = window.computeLeaveDays(newStart, newEnd, staffList.find(s => s.ic === rec.ic) || user);
  if (days <= 0) {
    alert('Tarikh yang dipilih tiada hari bekerja untuk staf pentadbiran. Sila pilih tarikh yang merangkumi hari bekerja (Isnin–Jumaat).');
    return;
  }

  const warn = rec.status !== 'PENDING'
    ? '\n\n⚠️ Permohonan ini telah disokong/diluluskan separa. Mengubahnya akan MENETAPKAN SEMULA status ke PENDING dan proses kelulusan akan bermula semula.'
    : '';
  if (!confirm(`Sahkan perubahan berikut?\n\n${changes.join('\n')}\n\nTempoh baharu: ${days} hari${warn}`)) return;

  try {
    await updateDoc(doc(db, 'leaves', id.toString()), {
      startDate: newStart, endDate: newEnd, reason: newReason, days, status: 'PENDING',
    });
    window.logSystemActivity(`Staff edited own leave ${id} (reset to PENDING)`);
    // Re-notify approvers that this needs (re-)action.
    const applicant = staffList.find(s => s.ic === rec.ic) || user;
    const approvers = window.getRoutingP1Approvers(applicant).filter(s => s.phone);
    const info = `\n\n👤 Pemohon: *${applicant.name}*\n📅 Tarikh: ${newStart} → ${newEnd}\n⏱ Tempoh: ${days} hari\n💬 Sebab: ${newReason}\n\n🔗 https://apply-leave-89ebb.web.app`;
    approvers.forEach(a => window.sendWhatsApp(a.phone, `🔁 *PERMOHONAN CUTI DIKEMASKINI — Perlu Sokongan Semula*${info}`));
    window.notifyApproversInbox(window.getRoutingP1Approvers(applicant),
      '🔁 Cuti Dikemaskini — Perlu Sokongan Semula',
      `${applicant.name} mengubah permohonan cuti (kini ${newStart} → ${newEnd}); memerlukan sokongan semula.`,
      id.toString(), rec.ic);
    alert('✅ Permohonan dikemaskini. Status ditetapkan semula ke PENDING untuk kelulusan semula.');
  } catch (err) {
    console.error('staffEditOwnLeave error:', err);
    alert('Ralat mengemaskini permohonan. (Mungkin status telah berubah — sila muat semula.)');
  }
};

window.deleteLeave = async function(id) {
    if(confirm("Are you sure you want to delete this leave record?")) {
        try {
            await deleteDoc(doc(db, "leaves", id.toString()));
            alert("Rekod cuti berjaya dipadam.");
        } catch (err) {
            console.error("Error deleting document: ", err);
            alert("Ralat memadam rekod.");
        }
    }
};

window.finalizeLeave = async function(id) {
    const record = leaveRecords.find(r => r.id === id);
    if(record) {
        // Kebenaran: hanya pelulus yang menguruskan staf/cawangan ini boleh meluluskan/menyokong.
        // Selari dengan tapisan UI senarai kelulusan dan guard rejectLeave/cancelLeave.
        if (!window.canManageRequest(user, record)) {
            alert('Anda tidak mempunyai kebenaran untuk meluluskan permohonan cawangan/staf ini.');
            return;
        }
        const applicant = staffList.find(s => s.ic === record.ic);
        if (applicant && applicant.category === 'Doctor') {
            const hasLocum2 = showLocum2Set.has(record.id) || record.locum2Name;
            if (hasLocum2 && record.locum2Name && (!record.locum2Phone || !record.locum2Date || !record.locum2TimeStart || !record.locum2TimeEnd)) {
                alert("⚠️ Locum Kedua tidak lengkap. Sila lengkapkan atau buang Locum Kedua sebelum meneruskan.");
                return;
            }
        }

        const isFullBoss = ['admin', 'hr', 'super_admin'].includes(user.role);
        const isHODApproved = record.status === 'HOD APPROVED' || record.status === 'HOD RECOMMENDED';
        const leaveTypeName = leaveCategories.find(c => c.id === record.type)?.name || record.type;
        let newStatus = "";
        let tlWaFeedback = '';
        let waFinalFeedback = '';
        let waHRFeedback = '';

        if (user.role === 'team_leader') {
            // Peringkat 0: Team Leader sokong → TL APPROVED, notify Supervisor Balok
            newStatus = 'TL APPROVED';
            const supervisors = staffList.filter(s =>
                s.role === 'supervisor' && (s.branch || '').includes('Balok') && s.phone && !s.inactive
            );
            const supMsg = `📋 *SOKONGAN TEAM LEADER — PERLU NILAI SUPERVISOR (Peringkat 1)*\n\nPermohonan cuti telah disokong oleh *${user.name} (TEAM LEADER)* dan menunggu penilaian anda.\n\n👤 Pemohon: *${record.name}*\n🏥 Cawangan: ${record.branch}\n📝 Jenis Cuti: ${leaveTypeName}\n📅 Tarikh: ${record.startDate} → ${record.endDate}\n⏱ Tempoh: ${record.days} hari\n💬 Sebab: ${record.reason}\n\n🔗 *Log masuk untuk menilai:* https://apply-leave-89ebb.web.app\n_— KSB Leave System_`;
            supervisors.forEach(sup => window.sendWhatsApp(sup.phone, supMsg));
            // Inbox kepada Supervisor Balok (selari dengan WhatsApp)
            window.notifyApproversInbox(
                staffList.filter(s => s.role === 'supervisor' && (s.branch || '').includes('Balok')),
                '📥 Cuti Perlu Penilaian Supervisor (Peringkat 1)',
                `${record.name} — ${leaveTypeName} (${record.startDate} → ${record.endDate}) telah disokong Team Leader; memerlukan penilaian anda.`,
                id.toString(), record.ic);
            if (applicant && applicant.phone) {
                const staffMsg = `📋 *DIKEMASKINI — Permohonan Cuti Anda*\n\nSalam ${applicant.name},\n\nPermohonan cuti anda telah *disokong oleh Team Leader*.\n\n• Jenis: ${leaveTypeName}\n• Tarikh: ${record.startDate} → ${record.endDate}\n\nPermohonan kini menunggu *penilaian Supervisor*. Anda akan dimaklumkan selepas kelulusan akhir.\n\n🔗 *Log masuk:* https://apply-leave-89ebb.web.app\n_— KSB Leave System_`;
                window.sendWhatsApp(applicant.phone, staffMsg);
            }
            if (!WHATSAPP_ENABLED()) {
                tlWaFeedback = '\n\n⚠️ Token WhatsApp belum dikonfigurasi — Supervisor TIDAK dapat notifikasi WA. Sila hubungi Super Admin untuk tetapkan token Fonnte.';
            } else if (supervisors.length === 0) {
                tlWaFeedback = '\n\n⚠️ Tiada Supervisor (dengan nombor telefon) dijumpai di cawangan Balok.\nNotifikasi WA KE SUPERVISOR TIDAK DIHANTAR.\nSila pastikan akaun Supervisor telah didaftarkan dengan nombor telefon dalam sistem.';
            } else {
                tlWaFeedback = `\n\n📲 Notifikasi WA dihantar kepada Supervisor:\n${supervisors.map(s => s.name).join(', ')}`;
            }
        } else if (isFullBoss) {
            // Peringkat 2: HR/Admin beri kelulusan akhir
            // Blok bypass TL APPROVED op-balok jika needs_tl aktif — mesti Supervisor lulus dulu
            if (record.status === 'TL APPROVED' && (approvalRouting['operation_balok'] || {}).needs_tl) {
                const _ap = applicant || staffList.find(s => s.ic === record.ic);
                if (_ap && window.getStaffGroup(_ap) === 'operation_balok') {
                    alert('⛔ Permohonan ini masih menunggu kelulusan Supervisor (Peringkat 1). HR/Admin hanya boleh luluskan selepas Supervisor lulus.');
                    return;
                }
            }
            // Jika PENDING, minta pengesahan — bezakan "tiada pelulus berdaftar" vs "bypass sengaja"
            if (record.status === 'PENDING') {
                const _ap = applicant || staffList.find(s => s.ic === record.ic);
                const _noP1 = !!(_ap && window.getRoutingP1Approvers(_ap).length === 0);
                const _confirmMsg = _noP1
                    ? `Staf ${record.name} tiada Pelulus Peringkat 1 (HOD/Supervisor) berdaftar untuk cawangan/kategori ini.\n\nLuluskan terus sebagai HR/Admin?`
                    : `⚠️ Permohonan ini BELUM dinilai oleh HOD/Supervisor.\n\nAdakah anda pasti mahu luluskan terus (bypass) bagi ${record.name}?`;
                if (!confirm(_confirmMsg)) return;
            }
            newStatus = "APPROVED";
            const approvedName = (applicant || {}).name || record.name;
            const approvedMsg = `✅ *CUTI DILULUSKAN — KSB Leave Apply*\n\nSalam ${approvedName},\n\nPermohonan cuti anda telah *DILULUSKAN SEPENUHNYA* oleh HR/Admin.\n\n📋 *Butiran Cuti:*\n• Jenis: ${leaveTypeName}\n• Tarikh: ${record.startDate} → ${record.endDate}\n• Tempoh: ${record.days} hari\n• Sebab: ${record.reason}\n\nTerima kasih. Selamat bercuti! 🎉\n\n🔗 *Log masuk:* https://apply-leave-89ebb.web.app\n_— KSB Leave System_`;
            if (!WHATSAPP_ENABLED()) {
                waFinalFeedback = `\n\n⚠️ Token WhatsApp belum dikonfigurasi — ${approvedName} TIDAK dapat notifikasi WA. Sila hubungi Super Admin untuk tetapkan token Fonnte.`;
            } else if (!applicant || !applicant.phone) {
                waFinalFeedback = `\n\n⚠️ Notifikasi WA TIDAK dihantar — ${approvedName} tiada nombor telefon dalam sistem. Sila kemaskini profil staf.`;
            } else {
                window.sendWhatsApp(applicant.phone, approvedMsg);
                waFinalFeedback = `\n\n📲 Notifikasi WA dihantar kepada ${approvedName} (${applicant.phone}).`;
            }
        } else {
            // Peringkat 1: HOD/PIC_HOD/Supervisor sokong
            const p2Required = window.staffNeedsP2(applicant || { branch: record.branch, category: record.category });

            // Supervisor menilai TL APPROVED untuk staf operasi Balok (Peringkat 1 selepas TL)
            const tlActive = !!(approvalRouting['operation_balok'] || {}).needs_tl;
            const isTLApprovedOperationBalok = tlActive && record.status === 'TL APPROVED' &&
                applicant && window.getStaffGroup(applicant) === 'operation_balok';

            if (isTLApprovedOperationBalok || p2Required) {
                // Perlu Peringkat 2 — notify HR/Admin
                newStatus = "HOD APPROVED";
                const admins = staffList.filter(s =>
                    ['admin', 'hr', 'super_admin'].includes(s.role) && s.phone && !s.inactive
                );
                const p1Label = isTLApprovedOperationBalok ? 'SUPERVISOR (selepas Team Leader)' : (user.role || '').toUpperCase();
                const p1Title = isTLApprovedOperationBalok ? 'SOKONGAN SUPERVISOR' : `SOKONGAN ${p1Label}`;
                const msg = `📋 *${p1Title} — PERLU KELULUSAN HR/ADMIN (Peringkat 2)*\n\nPermohonan cuti telah dinilai dan disokong oleh *${user.name} (${p1Label})* dan menunggu kelulusan akhir anda.\n\n👤 Pemohon: *${record.name}*\n🏥 Cawangan: ${record.branch}\n📝 Jenis Cuti: ${leaveTypeName}\n📅 Tarikh: ${record.startDate} → ${record.endDate}\n⏱ Tempoh: ${record.days} hari\n💬 Sebab: ${record.reason}\n\n🔗 *Log masuk untuk kelulusan akhir:* https://apply-leave-89ebb.web.app\n_— KSB Leave System_`;
                if (!WHATSAPP_ENABLED()) {
                    waHRFeedback = '\n\n⚠️ Token WhatsApp belum dikonfigurasi — HR/Admin TIDAK dapat notifikasi WA. Sila hubungi Super Admin untuk tetapkan token Fonnte.';
                } else if (admins.length === 0) {
                    waHRFeedback = '\n\n⚠️ Tiada HR/Admin (dengan nombor telefon) dijumpai dalam sistem.\nNotifikasi WA KE HR/ADMIN TIDAK DIHANTAR.\nSila pastikan akaun HR/Admin telah didaftarkan dengan nombor telefon dalam profil staf.';
                } else {
                    admins.forEach(admin => window.sendWhatsApp(admin.phone, msg));
                    waHRFeedback = `\n\n📲 Notifikasi WA dihantar kepada HR/Admin:\n${admins.map(a => a.name).join(', ')}`;
                }
                // Inbox kepada HR/Admin (selari dengan WhatsApp) — perlu kelulusan akhir
                window.notifyApproversInbox(
                    staffList.filter(s => ['admin', 'hr', 'super_admin'].includes(s.role)),
                    '📥 Cuti Perlu Kelulusan Akhir (Peringkat 2)',
                    `${record.name} — ${leaveTypeName} (${record.startDate} → ${record.endDate}) telah disokong ${p1Label}; memerlukan kelulusan akhir HR/Admin.`,
                    id.toString(), record.ic);
                if (applicant && applicant.phone) {
                    const staffMsg = `📋 *DIKEMASKINI — Permohonan Cuti Anda*\n\nSalam ${applicant.name},\n\nPermohonan cuti anda telah *dinilai dan disokong oleh ${user.name} (${p1Label})*.\n\n• Jenis: ${leaveTypeName}\n• Tarikh: ${record.startDate} → ${record.endDate}\n\nPermohonan kini sedang menunggu *kelulusan akhir HR/Admin*. Anda akan dimaklumkan selepas kelulusan akhir.\n\n🔗 *Log masuk:* https://apply-leave-89ebb.web.app\n_— KSB Leave System_`;
                    window.sendWhatsApp(applicant.phone, staffMsg);
                }
            } else {
                // Tiada Peringkat 2 — terus APPROVED
                newStatus = "APPROVED";
                const hodApprovedName = (applicant || {}).name || record.name;
                const hodApprovedMsg = `✅ *CUTI DILULUSKAN — KSB Leave Apply*\n\nSalam ${hodApprovedName},\n\nPermohonan cuti anda telah *DILULUSKAN* oleh *${user.name}* (${p1Label}).\n\n📋 *Butiran Cuti:*\n• Jenis: ${leaveTypeName}\n• Tarikh: ${record.startDate} → ${record.endDate}\n• Tempoh: ${record.days} hari\n• Sebab: ${record.reason}\n\nTerima kasih. Selamat bercuti! 🎉\n\n🔗 *Log masuk:* https://apply-leave-89ebb.web.app\n_— KSB Leave System_`;
                if (!WHATSAPP_ENABLED()) {
                    waFinalFeedback = `\n\n⚠️ Token WhatsApp belum dikonfigurasi — ${hodApprovedName} TIDAK dapat notifikasi WA. Sila hubungi Super Admin untuk tetapkan token Fonnte.`;
                } else if (!applicant || !applicant.phone) {
                    waFinalFeedback = `\n\n⚠️ Notifikasi WA TIDAK dihantar — ${hodApprovedName} tiada nombor telefon dalam sistem. Sila kemaskini profil staf.`;
                } else {
                    window.sendWhatsApp(applicant.phone, hodApprovedMsg);
                    waFinalFeedback = `\n\n📲 Notifikasi WA dihantar kepada ${hodApprovedName} (${applicant.phone}).`;
                }
            }
        }

        try {
            const updateData = { status: newStatus };
            if (record.locum1Name)      updateData.locum1Name      = record.locum1Name;
            if (record.locum1Phone)     updateData.locum1Phone     = record.locum1Phone;
            if (record.locum1Date)      updateData.locum1Date      = record.locum1Date;
            if (record.locum1TimeStart) updateData.locum1TimeStart = record.locum1TimeStart;
            if (record.locum1TimeEnd)   updateData.locum1TimeEnd   = record.locum1TimeEnd;
            if (record.locum2Name)      updateData.locum2Name      = record.locum2Name;
            if (record.locum2Phone)     updateData.locum2Phone     = record.locum2Phone;
            if (record.locum2Date)      updateData.locum2Date      = record.locum2Date;
            if (record.locum2TimeStart) updateData.locum2TimeStart = record.locum2TimeStart;
            if (record.locum2TimeEnd)   updateData.locum2TimeEnd   = record.locum2TimeEnd;

            await updateDoc(doc(db, "leaves", id.toString()), updateData);
            const isFinalApproval = newStatus === 'APPROVED';
            const isTLApproval = newStatus === 'TL APPROVED';
            window.logSystemActivity(
                isFinalApproval ? `Approved Leave (Final) for ${record.name}`
                : isTLApproval  ? `Team Leader Supported Leave (Peringkat 0) for ${record.name}`
                : `Supervisor Supported Leave (Peringkat 1) for ${record.name}`
            );
            if (isFinalApproval) {
                window.addNotification(record.ic, 'leave_approved', '✅ Cuti Diluluskan!', `Permohonan cuti anda (${leaveTypeName}, ${record.startDate} → ${record.endDate}, ${record.days} hari) telah DILULUSKAN sepenuhnya oleh ${user.name}.`, id.toString());
            } else if (isTLApproval) {
                window.addNotification(record.ic, 'leave_tl_approved', '📋 Cuti Disokong Team Leader', `Permohonan cuti anda (${leaveTypeName}, ${record.startDate} → ${record.endDate}) telah disokong oleh Team Leader dan sedang menunggu penilaian Supervisor.`, id.toString());
            } else {
                window.addNotification(record.ic, 'leave_p1_approved', '📋 Cuti Disokong Peringkat 1', `Permohonan cuti anda (${leaveTypeName}, ${record.startDate} → ${record.endDate}) telah disokong oleh ${user.name} dan sedang menunggu kelulusan akhir HR/Admin.`, id.toString());
            }

            // ── Rekod setiap kelulusan yang sudah dibuat ──
            const _actionLabel = isFinalApproval ? 'meluluskan (kelulusan akhir)'
                : isTLApproval ? 'menyokong (Peringkat 0 — Team Leader)'
                : 'menyokong (Peringkat 1)';
            const _leaveInfo = `${leaveTypeName} oleh ${record.name} (${record.startDate} → ${record.endDate}, ${record.days} hari)`;
            // (a) Approver yang buat tindakan — rekod dalam inboxnya sendiri
            window.addNotification(user.ic, 'approval_made', '🗂️ Tindakan Kelulusan Direkod',
                `Anda telah ${_actionLabel} permohonan ${_leaveInfo}.`, id.toString());
            // (b) HR/Admin — pemantauan setiap kelulusan (kecuali approver sendiri & pemohon)
            [...new Map(staffList
                .filter(s => ['admin', 'hr', 'super_admin'].includes(s.role) && !s.inactive && s.ic !== user.ic && s.ic !== record.ic)
                .map(s => [s.ic, s])).values()]
                .forEach(s => window.addNotification(s.ic, 'approval_made', '🗂️ Rekod Kelulusan',
                    `${user.name} telah ${_actionLabel} permohonan ${_leaveInfo}.`, id.toString()));

            alert(isFinalApproval
                ? `✅ Cuti Diluluskan!${waFinalFeedback}`
                : isTLApproval
                ? `📋 Sokongan Team Leader (Peringkat 0) Berjaya! Permohonan dihantar kepada Supervisor untuk dinilai.${tlWaFeedback}`
                : `📋 Sokongan Peringkat 1 Berjaya! Permohonan dihantar kepada HR/Admin untuk kelulusan akhir.${waHRFeedback}`);
        } catch (err) {
            console.error("Error updating document: ", err);
            alert("Ralat mengemaskini status cuti.");
        }
    }
};

window.resendApprovalWA = async function(id) {
    const record = leaveRecords.find(r => r.id === id);
    if (!record) return alert('Rekod tidak dijumpai.');
    if (record.status !== 'APPROVED') return alert('Hanya rekod yang sudah DILULUSKAN boleh dihantar semula.');

    const applicant = staffList.find(s => s.ic === record.ic);
    if (!applicant) return alert('Maklumat staf tidak dijumpai.');
    if (!applicant.phone) return alert(`Nombor telefon ${applicant.name} belum didaftarkan dalam sistem.\n\nSila kemaskini nombor telefon dalam profil staf.`);
    if (!WHATSAPP_ENABLED()) return alert('Token WhatsApp belum dikonfigurasi.\n\nPergi ke Pengurusan → Tetapan WhatsApp untuk simpan token Fonnte.');

    const leaveTypeName = leaveCategories.find(c => c.id === record.type)?.name || record.type;
    const msg = `✅ *CUTI DILULUSKAN — KSB Leave Apply*\n\nSalam ${applicant.name},\n\nPermohonan cuti anda telah *DILULUSKAN SEPENUHNYA* oleh HR/Admin.\n\n📋 *Butiran Cuti:*\n• Jenis: ${leaveTypeName}\n• Tarikh: ${record.startDate} → ${record.endDate}\n• Tempoh: ${record.days} hari\n• Sebab: ${record.reason}\n\nTerima kasih. Selamat bercuti! 🎉\n\n🔗 *Log masuk:* https://apply-leave-89ebb.web.app\n_— KSB Leave System_`;

    try {
        await window.sendWhatsApp(applicant.phone, msg, true);
        alert(`✅ Notifikasi WhatsApp berjaya dihantar semula kepada ${applicant.name}.`);
    } catch(err) {
        alert(`❌ Gagal menghantar WhatsApp.\n\nRalat: ${err.message}\n\nSila pastikan token Fonnte masih sah.`);
    }
};

window.cancelLeave = async function(id) {
    const req = leaveRecords.find(a => a.id === id);
    if (!req) return;

    const rKey = window.rbacMatrix[user.role] ? user.role : 'staff';
    const finalRbac = window.rbacMatrix[rKey] || {};
    if (!finalRbac.can_cancel) {
        alert('Anda tidak mempunyai kebenaran (RBAC) untuk membatalkan cuti ini.');
        return;
    }

    if (!window.canManageRequest(user, req)) {
        alert('Anda tidak mempunyai kebenaran untuk menguruskan cawangan/staf ini.');
        return;
    }

    if (!confirm(`Adakah anda pasti mahu MEMBATALKAN cuti ${req.name}?\nStatus akan ditukar ke BATAL.`)) return;

    try {
        await updateDoc(doc(db, "leaves", id.toString()), { status: 'CANCELLED' });
        window.logSystemActivity(`Cancelled Leave for ${req.name}`);
        alert(`Cuti ${req.name} berjaya dibatalkan.`);
        
        const staff = staffList.find(s => s.ic === req.ic);
        if (staff && staff.phone) {
            const leaveTypeName = leaveCategories.find(c => c.id === req.type)?.name || req.type;
            const msg = `🚩 *PEMBATALAN CUTI*\n\nPermohonan cuti anda (${leaveTypeName}) pada ${req.startDate} telah *DIBATALKAN* oleh ${(user.role || '').toUpperCase()}.\n\nBaki cuti anda telah dikembalikan.\n\n🔗 *Log masuk:* https://apply-leave-89ebb.web.app\n_— KSB Leave System_`;
            window.sendWhatsApp(staff.phone, msg);
        }
    } catch (err) {
        console.error("Error cancelling leave: ", err);
        alert("Ralat membatalkan cuti.");
    }
};

window.rejectLeave = async function(id) {
    const record = leaveRecords.find(r => r.id === id);
    if (!record) return;

    // Kebenaran: hanya pelulus yang menguruskan staf/cawangan ini boleh menolak.
    // canManageRequest membenarkan Team Leader menolak rekod PENDING op-Balok yang diuruskannya.
    if (!window.canManageRequest(user, record)) {
        alert('Anda tidak mempunyai kebenaran untuk menolak permohonan cawangan/staf ini.');
        return;
    }

    const leaveTypeName = leaveCategories.find(c => c.id === record.type)?.name || record.type;
    if (!confirm(`Adakah anda pasti mahu MENOLAK permohonan cuti ${record.name}?\n(${leaveTypeName}, ${record.startDate} → ${record.endDate})\n\nStatus akan ditukar ke DITOLAK dan pemohon akan dimaklumkan.`)) return;

    try {
        await updateDoc(doc(db, "leaves", id.toString()), { status: "REJECTED" });
        window.logSystemActivity(`Rejected Leave for ${record.name}`);
        window.addNotification(record.ic, 'leave_rejected', '❌ Cuti Ditolak', `Maaf, permohonan cuti anda (${leaveTypeName}, ${record.startDate} → ${record.endDate}) telah DITOLAK. Sila hubungi HR/Admin untuk maklumat lanjut.`, id.toString());

        // Notify applicant of rejection
        const applicant = staffList.find(s => s.ic === record.ic);
        if (applicant && applicant.phone) {
            const msg = `❌ *CUTI TIDAK DILULUSKAN — KSB Leave Apply*\n\nSalam ${applicant.name},\n\nMaaf, permohonan cuti anda telah *DITOLAK*.\n\n📋 *Butiran Cuti:*\n• Jenis: ${leaveTypeName}\n• Tarikh: ${record.startDate} → ${record.endDate}\n• Tempoh: ${record.days} hari\n\nSila hubungi HR/Admin untuk maklumat lanjut.\n\n🔗 *Log masuk:* https://apply-leave-89ebb.web.app\n_— KSB Leave System_`;
            window.sendWhatsApp(applicant.phone, msg);
        }
        alert(`Permohonan cuti ${record.name} telah ditolak.`);
    } catch (err) {
        console.error("Error rejecting leave: ", err);
        alert("Ralat menolak permohonan cuti.");
    }
};

window.resendLeaveWA = function(id) {
    const record = leaveRecords.find(r => r.id === id);
    if (!record) return;
    const applicant = staffList.find(s => s.ic === record.ic);
    const leaveTypeName = (leaveCategories.find(c => c.id === record.type) || {}).name || record.type;
    const info = `\n\n👤 Pemohon: *${record.name}*\n🏥 Cawangan: ${record.branch}\n📝 Jenis Cuti: ${leaveTypeName}\n📅 Tarikh: ${record.startDate} → ${record.endDate}\n⏱ Tempoh: ${record.days} hari\n💬 Sebab: ${record.reason}\n\n🔗 *Log masuk untuk meluluskan:* https://apply-leave-89ebb.web.app\n_— KSB Leave System_`;

    let recipients = [];
    let msg = '';

    if (record.status === 'PENDING') {
        const isOpBalok = applicant && window.getStaffGroup(applicant) === 'operation_balok';
        const tlActive = !!(approvalRouting['operation_balok'] || {}).needs_tl;
        if (isOpBalok && tlActive && record.tlIC) {
            // PENDING op-balok: peringatan kepada TL yang dipilih
            recipients = staffList.filter(s => s.ic === record.tlIC && s.phone);
            msg = `🔔 *PERINGATAN — Permohonan Cuti Menunggu Sokongan Anda (Peringkat 0)*\n\nPermohonan cuti di bawah masih menunggu sokongan *Team Leader*.${info}`;
        } else if (record.hodIC) {
            // PENDING dengan HOD dipilih: peringatan kepada HOD
            recipients = staffList.filter(s => s.ic === record.hodIC && s.phone);
            msg = `🔔 *PERINGATAN — Permohonan Cuti Menunggu Sokongan Anda (Peringkat 1)*\n\nPermohonan cuti di bawah masih menunggu sokongan anda.${info}`;
        } else {
            // PENDING routing auto: peringatan kepada semua P1 approver
            recipients = window.getRoutingP1Approvers(applicant || { branch: record.branch, category: record.category }).filter(s => s.phone);
            msg = `🔔 *PERINGATAN — Permohonan Cuti Menunggu Sokongan Anda (Peringkat 1)*\n\nPermohonan cuti di bawah masih menunggu sokongan anda.${info}`;
        }
    } else if (record.status === 'TL APPROVED') {
        // TL dah sokong — peringatan kepada Supervisor Balok
        recipients = staffList.filter(s => s.role === 'supervisor' && (s.branch || '').includes('Balok') && s.phone && !s.inactive);
        msg = `🔔 *PERINGATAN — Permohonan Cuti Menunggu Nilai Anda (Peringkat 1)*\n\nPermohonan cuti telah disokong Team Leader dan masih menunggu penilaian *Supervisor*.${info}`;
    } else if (record.status === 'HOD APPROVED' || record.status === 'HOD RECOMMENDED') {
        // Supervisor dah lulus — peringatan kepada HR/Admin
        recipients = staffList.filter(s => ['admin', 'hr', 'super_admin'].includes(s.role) && s.phone && !s.inactive);
        msg = `🔔 *PERINGATAN — Permohonan Cuti Menunggu Kelulusan Akhir Anda (Peringkat 2)*\n\nPermohonan cuti telah disokong dan masih menunggu kelulusan akhir *HR/Admin*.${info}`;
    }

    if (!recipients.length) {
        alert('⚠️ Tiada penerima dijumpai untuk dihantar peringatan WA.');
        return;
    }
    recipients.forEach(r => window.sendWhatsApp(r.phone, msg));
    const names = recipients.map(r => r.name).join(', ');
    alert(`📲 Peringatan WA dihantar semula kepada:\n${names}`);
};

window.setHrReportTab = function(tab) { hrReportTab = tab; render(); };
window.setApprovedReportBranch = function(val) { approvedReportBranch = val; render(); };
window.setApprovedReportType = function(val) { approvedReportType = val; render(); };
window.setApprovedReportYear = function(val) { approvedReportYear = val; render(); };
window.setBalanceReportBranch = function(val) { balanceReportBranch = val; render(); };
window.setBalanceViewBranch = function(val) { balanceViewBranch = val; render(); };
window.setBalanceViewSearch = function(val) { balanceViewSearch = val; render(); };
window.setBalanceReportType = function(val) { balanceReportType = val; render(); };
window.setBalanceReportYear = function(val) { balanceReportYear = val; render(); };
window.setJenisCutiYear = function(val) { jenisCutiYear = val; render(); };
window.setJenisCutiBranch = function(val) { jenisCutiBranch = val; render(); };
window.setAttendanceMonth = function(val) { attendanceReportMonth = val; render(); };
window.setAttendanceYear = function(val) { attendanceReportYear = val; render(); };
window.setAttendanceBranch = function(val) { attendanceReportBranch = val; render(); };

window.generateBalanceReport = function(rows, branchName, leaveType, year) {
  const MONTHS = ['Jan','Feb','Mac','Apr','Mei','Jun','Jul','Ogo','Sep','Okt','Nov','Dis'];
  const printHTML = `
  <div id="print-container" style="font-family:Arial,sans-serif;padding:20px;color:#111;background:#fff;">
    ${window.printHeaderHTML({ isReport: true, branch: branchName, title: 'LAPORAN BAKI CUTI BULANAN', meta: [{ label: 'Jenis', value: leaveType }, { label: 'Tahun', value: year }, { label: 'Jana', value: new Date().toLocaleString('ms-MY') }] })}
    <table style="width:100%;border-collapse:collapse;font-size:9px;">
      <thead>
        <tr style="background:#7c3aed;color:#fff;">
          <th style="padding:6px 8px;text-align:left;min-width:120px;">NAMA STAF</th>
          <th style="padding:6px 8px;text-align:left;font-size:8px;">CAWANGAN</th>
          ${MONTHS.map(m=>`<th style="padding:6px 4px;text-align:center;">${m}</th>`).join('')}
          <th style="padding:6px 6px;text-align:center;background:#5b21b6;">GUNA</th>
          <th style="padding:6px 6px;text-align:center;background:#4c1d95;">HAK</th>
          <th style="padding:6px 6px;text-align:center;background:#3b0764;">BAKI</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((r,i) => {
          const bal = r.entitlement - r.totalUsed;
          return `<tr style="border-bottom:1px solid #e2e8f0;background:${i%2===0?'#fff':'#faf5ff'};">
            <td style="padding:5px 8px;font-weight:700;font-size:9px;">${r.name}</td>
            <td style="padding:5px 8px;color:#6d28d9;font-size:8px;">${r.branch}</td>
            ${r.monthlyUsed.map(d=>`<td style="padding:5px 4px;text-align:center;${d>0?'font-weight:700;color:#059669;':''}">${d>0?d:''}</td>`).join('')}
            <td style="padding:5px 6px;text-align:center;font-weight:800;color:#7c3aed;">${r.totalUsed.toFixed(1)}</td>
            <td style="padding:5px 6px;text-align:center;font-weight:700;">${r.entitlement}</td>
            <td style="padding:5px 6px;text-align:center;font-weight:800;${bal<=0?'color:#dc2626;':'color:#059669;'}">${bal.toFixed(1)}</td>
          </tr>`;
        }).join('')}
      </tbody>
      <tfoot>
        <tr style="background:#f5f3ff;border-top:2px solid #7c3aed;">
          <td colspan="2" style="padding:6px 8px;font-weight:800;font-size:10px;">JUMLAH KESELURUHAN</td>
          ${Array.from({length:12},(_,i)=>{
            const total = rows.reduce((s,r)=>s+(r.monthlyUsed[i]||0),0);
            return `<td style="padding:6px 4px;text-align:center;font-weight:800;${total>0?'color:#7c3aed;':''}">${total>0?total.toFixed(1):''}</td>`;
          }).join('')}
          <td style="padding:6px 6px;text-align:center;font-weight:800;color:#7c3aed;">${rows.reduce((s,r)=>s+r.totalUsed,0).toFixed(1)}</td>
          <td style="padding:6px 6px;text-align:center;font-weight:800;">${rows.reduce((s,r)=>s+r.entitlement,0)}</td>
          <td style="padding:6px 6px;text-align:center;font-weight:800;color:#059669;">${rows.reduce((s,r)=>s+(r.entitlement-r.totalUsed),0).toFixed(1)}</td>
        </tr>
      </tfoot>
    </table>
    <div style="margin-top:12px;font-size:9px;color:#718096;border-top:1px solid #e2e8f0;padding-top:8px;">
      * Baki cuti dikira berdasarkan status APPROVED (selari dengan paparan dashboard staf). Breakdown bulanan berdasarkan tarikh permohonan. Entitlement AL dikira mengikut pro-rata jika berkaitan.
    </div>
    <button onclick="window.print()" style="margin-top:12px;padding:7px 18px;background:#7c3aed;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:700;">PRINT / SIMPAN PDF</button>
  </div>`;
  document.body.insertAdjacentHTML('beforeend', printHTML);
  window.print();
  document.getElementById('print-container').remove();
};

window.generateApprovedReport = function() {
  const recs = leaveRecords.filter(r => {
    if (r.status !== 'APPROVED') return false;
    if (approvedReportBranch !== 'SEMUA' && r.branch !== approvedReportBranch) return false;
    if (approvedReportType !== 'SEMUA' && r.type !== approvedReportType) return false;
    if (approvedReportYear !== 'SEMUA' && new Date(r.id).getFullYear().toString() !== approvedReportYear) return false;
    return true;
  });
  const totalDays = recs.reduce((s, r) => s + parseFloat(r.days || 0), 0);
  const printHTML = `
  <div id="print-container" style="font-family:Arial,sans-serif;padding:24px;color:#111;background:#fff;">
    ${window.printHeaderHTML({ isReport: true, branch: approvedReportBranch, title: 'LAPORAN CUTI DILULUSKAN', meta: [{ label: 'Jenis', value: approvedReportType === 'SEMUA' ? 'Semua' : approvedReportType }, { label: 'Tahun', value: approvedReportYear }, { label: 'Jana', value: new Date().toLocaleDateString('ms-MY',{day:'2-digit',month:'long',year:'numeric'}) }] })}
    <div style="display:flex;gap:16px;margin-bottom:24px;">
      <div style="flex:1;padding:12px 16px;background:#f0fdf4;border:1px solid #86efac;border-radius:8px;">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#059669;">Jumlah Rekod</div>
        <div style="font-size:28px;font-weight:800;color:#059669;">${recs.length}</div>
      </div>
      <div style="flex:1;padding:12px 16px;background:#eff6ff;border:1px solid #93c5fd;border-radius:8px;">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#2563eb;">Jumlah Hari</div>
        <div style="font-size:28px;font-weight:800;color:#2563eb;">${totalDays.toFixed(1)}</div>
      </div>
      <div style="flex:1;padding:12px 16px;background:#fefce8;border:1px solid #fde047;border-radius:8px;">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#ca8a04;">Staf Terlibat</div>
        <div style="font-size:28px;font-weight:800;color:#ca8a04;">${[...new Set(recs.map(r=>r.ic))].length}</div>
      </div>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:11px;">
      <thead>
        <tr style="background:#059669;color:#fff;">
          <th style="padding:8px 10px;text-align:left;">TARIKH</th>
          <th style="padding:8px 10px;text-align:left;">NAMA STAF</th>
          <th style="padding:8px 10px;text-align:left;">CAWANGAN</th>
          <th style="padding:8px 10px;text-align:left;">JENIS</th>
          <th style="padding:8px 10px;text-align:left;">SEBAB</th>
          <th style="padding:8px 10px;text-align:center;">HARI</th>
        </tr>
      </thead>
      <tbody>
        ${recs.map((r,i) => `
        <tr style="border-bottom:1px solid #e2e8f0;background:${i%2===0?'#fff':'#f8fafc'};">
          <td style="padding:7px 10px;font-weight:700;">${r.startDate}${r.startDate!==r.endDate?'<br><span style="color:#718096;font-weight:400;font-size:10px;">s/d '+r.endDate+'</span>':''}</td>
          <td style="padding:7px 10px;font-weight:700;">${r.name}<br><span style="color:#718096;font-size:10px;">${r.ic}</span></td>
          <td style="padding:7px 10px;font-size:10px;color:#3b82f6;">${r.branch}</td>
          <td style="padding:7px 10px;font-weight:700;color:#059669;">${r.type}</td>
          <td style="padding:7px 10px;font-style:italic;color:#718096;">${(r.reason||'').substring(0,50)}</td>
          <td style="padding:7px 10px;font-weight:800;text-align:center;font-size:14px;">${r.days}</td>
        </tr>`).join('')}
        <tr style="border-top:2px solid #059669;background:#f0fdf4;">
          <td colspan="5" style="padding:8px 10px;font-weight:800;text-align:right;">JUMLAH KESELURUHAN</td>
          <td style="padding:8px 10px;font-weight:800;font-size:16px;text-align:center;color:#059669;">${totalDays.toFixed(1)}</td>
        </tr>
      </tbody>
    </table>
    <div style="margin-top:20px;font-size:10px;color:#718096;border-top:1px solid #e2e8f0;padding-top:10px;">
      * Laporan ini dijana secara automatik oleh KSB Leave Apply System pada ${new Date().toLocaleString('ms-MY')}. Rekod yang dipaparkan adalah berstatus APPROVED sahaja.
    </div>
    <button onclick="window.print()" style="margin-top:16px;padding:8px 20px;background:#059669;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:700;">PRINT / SIMPAN PDF</button>
  </div>`;
  document.body.insertAdjacentHTML('beforeend', printHTML);
  window.print();
  document.getElementById('print-container').remove();
};

window.generateAttendanceReport = function() {
  const MONTHS_MS = ['Januari','Februari','Mac','April','Mei','Jun','Julai','Ogos','September','Oktober','November','Disember'];
  const monthLabel = MONTHS_MS[parseInt(attendanceReportMonth)-1] + ' ' + attendanceReportYear;
  const reportBranch = window.getUserReportBranch(user);
  const reportDaerah = window.getUserReportDaerah(user);
  const userStateScope = window.getUserStateScope(user);
  // baca terus dari state global yang dikemaskini oleh dropdown
  const activeBranch = attendanceReportBranch;

  const staffPool = staffList.filter(s => {
    if (s.inactive) return false;
    if (reportBranch && s.branch !== reportBranch) return false;
    if (activeBranch && activeBranch !== 'SEMUA' && s.branch !== activeBranch) return false;
    const bObj = branches.find(b => b.name === s.branch);
    if (!bObj && userStateScope !== 'all') return false;
    if (bObj && userStateScope !== 'all' && bObj.state !== userStateScope) return false;
    if (bObj && reportDaerah && bObj.daerah !== reportDaerah) return false;
    return true;
  });

  const getMonthLeave = ic => {
    const t = {}; leaveRecords.filter(r => r.ic===ic && r.status==='APPROVED' && new Date(r.id).getFullYear().toString()===attendanceReportYear && String(new Date(r.id).getMonth()+1)===attendanceReportMonth).forEach(r=>{ t[r.type]=(t[r.type]||0)+parseFloat(r.days||0); }); return t;
  };
  const getYTDLeave = ic => {
    const t = {}; leaveRecords.filter(r => r.ic===ic && r.status==='APPROVED' && new Date(r.id).getFullYear().toString()===attendanceReportYear).forEach(r=>{ t[r.type]=(t[r.type]||0)+parseFloat(r.days||0); }); return t;
  };
  const fmt = v => v>0 ? (v%1===0?v:v.toFixed(1)) : '-';
  const fmtBal = (rem,ent) => `${parseFloat(rem.toFixed(1))}/${Math.round(ent)}`;

  const renderRows = (arr, isDoctor) => arr.map((s,i) => {
    const ml = getMonthLeave(s.ic), yl = getYTDLeave(s.ic);
    // Baki Cuti = baki Formula B (getLeaveStats) / peruntukan setahun
    const alSt = window.getLeaveStats(s, 'AL');
    const alEnt = alSt.ent, alRem = alSt.bal;
    const mcSt = window.getLeaveStats(s, 'MC');
    const mcEnt = mcSt.ent, mcRem = mcSt.bal;
    const al = ml['AL']||0, mc = ml['MC']||0;
    const el = (ml['EL']||0)+(ml['EL_EMG']||0), up = ml['UP']||0;
    const last = isDoctor ? (ml['CME']||0) : ((ml['HL']||0)+(ml['ML']||0)+(ml['ML_PL']||0));
    return `<tr style="border-bottom:1px solid #e2e8f0;background:${i%2===0?'#fff':'#f8fafc'};">
      <td style="padding:5px 8px;text-align:center;font-size:10px;color:#718096;">${i+1}</td>
      <td style="padding:5px 8px;font-size:11px;font-weight:600;">${s.name}</td>
      <td style="padding:5px 6px;text-align:center;font-size:11px;font-weight:${al>0?700:400};color:${al>0?'#3b82f6':'#cbd5e1'};">${fmt(al)}</td>
      <td style="padding:5px 6px;text-align:center;font-size:11px;font-weight:${mc>0?700:400};color:${mc>0?'#059669':'#cbd5e1'};">${fmt(mc)}</td>
      <td style="padding:5px 6px;text-align:center;font-size:11px;font-weight:${el>0?700:400};color:${el>0?'#d97706':'#cbd5e1'};">${fmt(el)}</td>
      <td style="padding:5px 6px;text-align:center;font-size:11px;font-weight:${up>0?700:400};color:${up>0?'#64748b':'#cbd5e1'};">${fmt(up)}</td>
      <td style="padding:5px 6px;text-align:center;font-size:11px;font-weight:${last>0?700:400};color:${last>0?'#7c3aed':'#cbd5e1'};">${fmt(last)}</td>
      <td style="padding:5px 8px;text-align:center;font-size:10px;font-weight:700;color:#1d4ed8;border-left:1px solid #e2e8f0;">${fmtBal(alRem,alEnt)}</td>
      <td style="padding:5px 8px;text-align:center;font-size:10px;font-weight:700;color:#065f46;">${fmtBal(mcRem,mcEnt)}</td>
    </tr>`;
  }).join('');

  const renderSection = (title, arr, isDoctor) => {
    if (!arr.length) return '';
    const lastHdr = isDoctor ? 'CME' : 'LL';
    const lastColor = isDoctor ? '#7c3aed' : '#0891b2';
    return `
    <div style="margin-bottom:20px;">
      <div style="padding:8px 12px;background:#1e293b;color:#fff;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:1px;">${title}</div>
      <table style="width:100%;border-collapse:collapse;font-size:11px;">
        <thead>
          <tr style="background:#f1f5f9;border-bottom:2px solid #cbd5e1;">
            <th style="padding:7px 8px;text-align:center;font-size:10px;color:#64748b;width:30px;">Bil</th>
            <th style="padding:7px 8px;text-align:left;font-size:10px;color:#64748b;">Nama</th>
            <th style="padding:7px 6px;text-align:center;font-size:10px;color:#3b82f6;">AL</th>
            <th style="padding:7px 6px;text-align:center;font-size:10px;color:#059669;">MC</th>
            <th style="padding:7px 6px;text-align:center;font-size:10px;color:#d97706;">EL</th>
            <th style="padding:7px 6px;text-align:center;font-size:10px;color:#64748b;">UPL</th>
            <th style="padding:7px 6px;text-align:center;font-size:10px;color:${lastColor};">${lastHdr}</th>
            <th style="padding:7px 8px;text-align:center;font-size:10px;color:#1d4ed8;border-left:1px solid #e2e8f0;">Baki Cuti</th>
            <th style="padding:7px 8px;text-align:center;font-size:10px;color:#065f46;">Baki MC</th>
          </tr>
        </thead>
        <tbody>${renderRows(arr, isDoctor)}</tbody>
        <tfoot>
          <tr style="background:#f8fafc;border-top:2px solid #cbd5e1;font-weight:700;">
            <td colspan="2" style="padding:7px 8px;font-size:10px;color:#64748b;">Jumlah: ${arr.length} orang</td>
            <td style="padding:7px 6px;text-align:center;font-size:11px;color:#3b82f6;">${arr.reduce((s,x)=>s+(getMonthLeave(x.ic)['AL']||0),0).toFixed(1).replace('.0','')}</td>
            <td style="padding:7px 6px;text-align:center;font-size:11px;color:#059669;">${arr.reduce((s,x)=>s+(getMonthLeave(x.ic)['MC']||0),0).toFixed(1).replace('.0','')}</td>
            <td style="padding:7px 6px;text-align:center;font-size:11px;color:#d97706;">${arr.reduce((s,x)=>s+((getMonthLeave(x.ic)['EL']||0)+(getMonthLeave(x.ic)['EL_EMG']||0)),0).toFixed(1).replace('.0','')}</td>
            <td style="padding:7px 6px;text-align:center;">${arr.reduce((s,x)=>s+(getMonthLeave(x.ic)['UP']||0),0)||'-'}</td>
            <td style="padding:7px 6px;text-align:center;">${isDoctor ? (arr.reduce((s,x)=>s+(getMonthLeave(x.ic)['CME']||0),0)||'-') : (arr.reduce((s,x)=>s+((getMonthLeave(x.ic)['HL']||0)+(getMonthLeave(x.ic)['ML']||0)+(getMonthLeave(x.ic)['ML_PL']||0)),0)||'-')}</td>
            <td colspan="2"></td>
          </tr>
        </tfoot>
      </table>
    </div>`;
  };

  const kakitangan = staffPool.filter(s=>s.category!=='Doctor').sort((a,b)=>a.name.localeCompare(b.name));
  const doktor = staffPool.filter(s=>s.category==='Doctor').sort((a,b)=>a.name.localeCompare(b.name));
  const branchLabel = activeBranch === 'SEMUA' ? 'Semua Cawangan' : activeBranch;

  // Buka window baru untuk print (supaya tidak terkesan dengan main app)
  const pw = window.open('', '_blank');
  pw.document.write(`<!DOCTYPE html><html><head>
    <meta charset="UTF-8">
    <title>Rekod Kedatangan — ${branchLabel} — ${monthLabel}</title>
    <style>
      *{margin:0;padding:0;box-sizing:border-box;}
      body{font-family:Arial,sans-serif;padding:24px;color:#111;background:#fff;}
      .watermark{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:420px;opacity:0.12;pointer-events:none;z-index:0;print-color-adjust:exact;-webkit-print-color-adjust:exact;}
      table{width:100%;border-collapse:collapse;font-size:11px;}
      th{background:#f1f5f9;padding:7px 8px;font-size:10px;color:#64748b;border-bottom:2px solid #cbd5e1;}
      td{padding:5px 8px;border-bottom:1px solid #e2e8f0;}
      .section-hdr{padding:8px 12px;background:#1e293b;color:#fff;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-bottom:0;}
      .print-btn{margin:16px 0;text-align:right;}
      .print-btn button{padding:8px 20px;background:#1e293b;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:700;font-size:12px;}
      @media print{.print-btn{display:none;} body{padding:16px;}}
    </style>
  </head><body>
    <div class="print-btn"><button onclick="window.print()">🖨️ PRINT / SIMPAN PDF</button></div>
    ${window.printHeaderHTML({ isReport: true, branch: activeBranch, title: 'SENARAI BILANGAN CUTI, MC DAN EL KAKITANGAN', meta: [{ label: 'Bulan', value: monthLabel }, { label: 'Bilangan', value: staffPool.length + ' kakitangan' }] })}
    ${renderSection('KAKITANGAN', kakitangan, false)}
    ${renderSection('DOKTOR', doktor, true)}
    <div style="margin-top:20px;font-size:9px;color:#718096;border-top:1px solid #e2e8f0;padding-top:10px;">
      Laporan dijana oleh KSB Leave Apply System pada ${new Date().toLocaleString('ms-MY')}. Baki Cuti = sisa/hak (pro-rata). Rekod berstatus APPROVED.
    </div>
  </body></html>`);
  pw.document.close();
};

window.generateJenisCutiReport = function() {
  const reportBranch = window.getUserReportBranch(user);
  const reportDaerah = window.getUserReportDaerah(user);
  const userStateScope = window.getUserStateScope(user);
  const base = leaveRecords.filter(r => {
    if (r.status !== 'APPROVED') return false;
    if (jenisCutiYear !== 'SEMUA' && new Date(r.id).getFullYear().toString() !== jenisCutiYear) return false;
    if (jenisCutiBranch !== 'SEMUA' && r.branch !== jenisCutiBranch) return false;
    if (reportBranch && r.branch !== reportBranch) return false;
    if (reportDaerah) {
      const rb = branches.find(b => b.name === r.branch);
      if (!rb || rb.daerah !== reportDaerah) return false;
    } else if (userStateScope !== 'all') {
      const rb = branches.find(b => b.name === r.branch);
      if (!rb || rb.state !== userStateScope) return false;
    }
    return true;
  });
  const typeSet = leaveCategories.map(c => c.id);
  const branchSet = [...new Set(base.map(r=>r.branch).filter(Boolean))].sort();
  const matrix = {}, typeTotals = {}, branchTotals = {};
  let grand = 0, grandCount = 0;
  typeSet.forEach(t => { typeTotals[t] = {d:0,n:0}; });
  branchSet.forEach(b => { matrix[b] = {}; branchTotals[b] = {d:0,n:0}; typeSet.forEach(t => { matrix[b][t] = {d:0,n:0}; }); });
  base.forEach(r => {
    const b = r.branch; const t = r.type; const d = parseFloat(r.days||0);
    if (matrix[b] && matrix[b][t] !== undefined) {
      matrix[b][t].d += d; matrix[b][t].n += 1;
      branchTotals[b].d += d; branchTotals[b].n += 1;
      typeTotals[t].d += d; typeTotals[t].n += 1;
      grand += d; grandCount += 1;
    }
  });
  const activeTypes = typeSet.filter(t => typeTotals[t].d > 0);
  const typeColors = { AL:'#3b82f6', MC:'#10b981', EL:'#f59e0b', EL_EMG:'#ef4444', UP:'#94a3b8', HL:'#06b6d4', ML:'#ec4899', ML_PL:'#6366f1', CME:'#8b5cf6' };
  const printHTML = `
  <div id="print-container" style="font-family:Arial,sans-serif;padding:24px;color:#111;background:#fff;">
    ${window.printHeaderHTML({ isReport: true, branch: jenisCutiBranch, title: 'LAPORAN RINGKASAN MENGIKUT JENIS CUTI', meta: [{ label: 'Tahun', value: jenisCutiYear === 'SEMUA' ? 'Semua' : jenisCutiYear }, { label: 'Jana', value: new Date().toLocaleDateString('ms-MY',{day:'2-digit',month:'long',year:'numeric'}) }] })}
    <div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap;">
      ${activeTypes.map(t => {
        const c = typeColors[t]||'#64748b';
        const cat = leaveCategories.find(x=>x.id===t);
        return `<div style="padding:8px 14px;background:${c}18;border:1px solid ${c}44;border-radius:8px;min-width:80px;">
          <div style="font-size:9px;font-weight:700;text-transform:uppercase;color:${c};">${t}</div>
          <div style="font-size:20px;font-weight:800;color:${c};">${typeTotals[t].d.toFixed(1)}</div>
          <div style="font-size:9px;color:#718096;">${typeTotals[t].n} rekod</div>
        </div>`;
      }).join('')}
      <div style="padding:8px 14px;background:#1e293b;border-radius:8px;min-width:80px;">
        <div style="font-size:9px;font-weight:700;text-transform:uppercase;color:#94a3b8;">JUMLAH</div>
        <div style="font-size:20px;font-weight:800;color:#fff;">${grand.toFixed(1)}</div>
        <div style="font-size:9px;color:#94a3b8;">${grandCount} rekod</div>
      </div>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:10px;">
      <thead>
        <tr style="background:#1e293b;color:#fff;">
          <th style="padding:8px 10px;text-align:left;min-width:150px;">CAWANGAN</th>
          ${activeTypes.map(t => `<th style="padding:8px 6px;text-align:center;min-width:60px;">${t}</th>`).join('')}
          <th style="padding:8px 10px;text-align:center;background:#374151;">JUMLAH</th>
        </tr>
      </thead>
      <tbody>
        ${branchSet.map((b,i) => `
        <tr style="border-bottom:1px solid #e2e8f0;background:${i%2===0?'#fff':'#f8fafc'};">
          <td style="padding:7px 10px;font-weight:700;font-size:11px;">${b}</td>
          ${activeTypes.map(t => {
            const v = matrix[b][t];
            const c = typeColors[t]||'#64748b';
            return v.d > 0
              ? `<td style="padding:7px 6px;text-align:center;font-weight:700;color:${c};">${v.d.toFixed(1)}<br><span style="font-size:9px;color:#94a3b8;">${v.n}x</span></td>`
              : `<td style="padding:7px 6px;text-align:center;color:#cbd5e1;">—</td>`;
          }).join('')}
          <td style="padding:7px 10px;text-align:center;font-weight:800;background:#f1f5f9;">${branchTotals[b].d.toFixed(1)}</td>
        </tr>`).join('')}
      </tbody>
      <tfoot>
        <tr style="border-top:2px solid #1e293b;background:#f1f5f9;font-weight:800;">
          <td style="padding:8px 10px;font-weight:800;text-transform:uppercase;">JUMLAH KESELURUHAN</td>
          ${activeTypes.map(t => {
            const c = typeColors[t]||'#64748b';
            return `<td style="padding:8px 6px;text-align:center;font-weight:800;color:${c};">${typeTotals[t].d.toFixed(1)}</td>`;
          }).join('')}
          <td style="padding:8px 10px;text-align:center;font-weight:800;font-size:14px;">${grand.toFixed(1)}</td>
        </tr>
      </tfoot>
    </table>
    <div style="margin-top:20px;font-size:9px;color:#718096;border-top:1px solid #e2e8f0;padding-top:10px;">
      * Laporan ini dijana secara automatik oleh KSB Leave Apply System pada ${new Date().toLocaleString('ms-MY')}. Hanya rekod berstatus APPROVED diambil kira.
    </div>
    <button onclick="window.print()" style="margin-top:16px;padding:8px 20px;background:#f59e0b;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:700;">PRINT / SIMPAN PDF</button>
  </div>`;
  document.body.insertAdjacentHTML('beforeend', printHTML);
  window.print();
  document.getElementById('print-container').remove();
};

window.generateLeaveReport = function() {
   let printHTML = `
   <div id="print-container" style="font-family: Arial, sans-serif; padding: 20px; color: black; background: white;">
      ${window.printHeaderHTML({ isReport: true, title: 'LEDGER CUTI RASMI HR' })}
      <div style="display: flex; justify-content: space-between; font-size: 12px; font-weight: bold; margin-bottom: 40px; color: #4a5568;">
          <div>REPORT CATEGORY<br><span style="color: black; font-size: 14px;">All Classified Leave Records</span></div>
          <div style="text-align: right;">GENERATION DATE<br><span style="color: black; font-size: 14px;">${new Date().toLocaleDateString('en-GB', {day: '2-digit', month: 'long', year: 'numeric'})}</span></div>
      </div>
      
      <table style="width: 100%; border-collapse: collapse; font-size: 12px; text-align: left;">
          <thead>
              <tr style="border-bottom: 2px solid #cbd5e1; color: #718096;">
                  <th style="padding: 10px;">PERIOD</th>
                  <th style="padding: 10px;">EMPLOYEE</th>
                  <th style="padding: 10px;">TYPE</th>
                  <th style="padding: 10px;">REASON</th>
                  <th style="padding: 10px;">DAYS</th>
                  <th style="padding: 10px;">STATUS</th>
              </tr>
          </thead>
          <tbody>
              ${leaveRecords.map(r => `
              <tr style="border-bottom: 1px solid #e2e8f0;">
                  <td style="padding: 10px; font-weight: bold;">${r.startDate}<br><span style="color: #718096; font-weight: normal;">to ${r.endDate}</span></td>
                  <td style="padding: 10px; font-weight: bold;">${r.name}<br><span style="color: #3b82f6; font-size: 10px;">${r.branch}</span><br><span style="color: #718096; font-size: 10px;">${r.ic}</span></td>
                  <td style="padding: 10px; font-weight: bold; color: #059669;">${r.type}</td>
                  <td style="padding: 10px; font-style: italic;">${r.reason}</td>
                  <td style="padding: 10px; font-weight: bold; font-size: 14px;">${r.days}</td>
                  <td style="padding: 10px; font-weight: bold; text-transform: uppercase;">${r.status}</td>
              </tr>
              `).join('')}
          </tbody>
      </table>
   </div>
   `;
   document.body.insertAdjacentHTML('beforeend', printHTML);
   window.print();
   document.getElementById('print-container').remove();
};

// Full KSB Branch Network (12 Locations)
let branches = [
  { name: "Management / HQ",                        state: "Pahang",     daerah: "Kuantan",  manager: "Admin" },
  { name: "Klinik Syed Badaruddin Balok (HQ)",      state: "Pahang",     daerah: "Kuantan",  manager: "Admin" },
  { name: "Klinik Syed Badaruddin Beserah",         state: "Pahang",     daerah: "Kuantan",  manager: "Admin" },
  { name: "Klinik Syed Badaruddin Gebeng",          state: "Pahang",     daerah: "Kuantan",  manager: "Admin" },
  { name: "Klinik Syed Badaruddin Kempadang",       state: "Pahang",     daerah: "Kuantan",  manager: "Admin" },
  { name: "Uni Klinik Bentong",                     state: "Pahang",     daerah: "Bentong",  manager: "Admin" },
  { name: "Klinik Syed Badaruddin MCKIP",           state: "Pahang",     daerah: "Kuantan",  manager: "Admin" },
  { name: "Klinik Syed Badaruddin RPCM",            state: "Pahang",     daerah: "Kuantan",  manager: "Admin" },
  { name: "Klinik Syed Badaruddin Utama",           state: "Pahang",     daerah: "Kuantan",  manager: "Admin" },
  { name: "Klinik Syed Badaruddin Kerteh",          state: "Terengganu", daerah: "Kemaman",  manager: "Admin" },
  { name: "Klinik Syed Badaruddin Paka",            state: "Terengganu", daerah: "Dungun",   manager: "Admin" },
  { name: "Klinik Rakyat dan X-Ray Dungun",         state: "Terengganu", daerah: "Dungun",   manager: "Admin" },
];

async function initData() {
  if (initData._done) return;
  initData._done = true;
  console.log('Initializing Firestore listeners...');

  // Load WhatsApp token dari Firestore — supaya semua device guna token yang sama
  try {
    const waSnap = await getDoc(doc(db, 'system_config', 'whatsapp'));
    if (waSnap.exists() && waSnap.data().token) {
      WHATSAPP_TOKEN = waSnap.data().token;
      localStorage.setItem('ksb_wa_token', WHATSAPP_TOKEN);
    }
  } catch(e) { console.warn('WA token load failed:', e); }
  refreshWADevice(); // isi WHATSAPP_DEVICE untuk guard self-send (fire-and-forget)

  // Load policy content
  try {
    const pcSnap = await getDoc(doc(db, 'config', 'policyContent'));
    if (pcSnap.exists()) {
      const d = pcSnap.data();
      Object.keys(d).forEach(k => { if (k in policyContent) policyContent[k] = d[k]; });
    }
  } catch(e) { console.warn('policyContent load failed:', e); }

  // Load WA RBAC notification config
  try {
    const rbacSnap = await getDoc(doc(db, 'system_config', 'wa_notif_rbac'));
    if (rbacSnap.exists()) {
      const d = rbacSnap.data();
      ['balok','pahang','terengganu'].forEach(zone => {
        if (d[zone]) {
          waNotifRbac[zone] = { ...waNotifRbac[zone], ...d[zone] };
          if (!waNotifRbac[zone].tl_approved) waNotifRbac[zone].tl_approved = [];
        }
      });
    }
  } catch(e) { console.warn('wa_notif_rbac load failed:', e); }

  // Approval routing config — stay live (onSnapshot) so whatever the admin sets in
  // "Laluan Kelulusan" propagates to every open staff session immediately. Was a
  // one-time getDoc, which left already-open sessions on the old/default routing.
  onSnapshot(doc(db, 'config', 'approvalRouting'), (routingSnap) => {
    if (routingSnap.exists()) {
      const data = routingSnap.data();
      Object.keys(ROUTING_DEFAULTS).forEach(k => {
        approvalRouting[k] = data[k] ? { ...ROUTING_DEFAULTS[k], ...data[k] } : { ...ROUTING_DEFAULTS[k] };
      });
    }
    render();
  }, (e) => console.warn('Routing config sync failed:', e));

  // Load public holidays config
  try {
    const phSnap = await getDoc(doc(db, 'config', 'publicHolidays'));
    if (phSnap.exists()) {
      const d = phSnap.data();
      publicHolidays.pahang     = (d.pahang     && d.pahang.length)     ? d.pahang     : [...DEFAULT_HOLIDAYS_PAHANG];
      publicHolidays.terengganu = (d.terengganu && d.terengganu.length) ? d.terengganu : [...DEFAULT_HOLIDAYS_TERENGGANU];
    } else {
      publicHolidays.pahang     = [...DEFAULT_HOLIDAYS_PAHANG];
      publicHolidays.terengganu = [...DEFAULT_HOLIDAYS_TERENGGANU];
    }
  } catch(e) {
    console.warn('Public holidays load failed:', e);
    publicHolidays.pahang     = [...DEFAULT_HOLIDAYS_PAHANG];
    publicHolidays.terengganu = [...DEFAULT_HOLIDAYS_TERENGGANU];
  }

  // Load WA notification logs (latest 200)
  try {
    const logsSnap = await getDocs(query(collection(db, 'wa_logs'), orderBy('ts', 'desc'), limit(200)));
    waLogs = logsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch(e) { console.warn('WA logs load failed:', e); }

  // Branches — seed Firestore on first run, then stay live
  onSnapshot(collection(db, 'branches'), (snapshot) => {
    if (snapshot.empty) {
      branches.forEach(function(b) {
        const id = b.name.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 60);
        setDoc(doc(db, 'branches', id), { name: b.name, state: b.state, daerah: b.daerah || '', manager: 'Admin' });
      });
    } else {
      branches = snapshot.docs.map(function(d) {
        return Object.assign({}, d.data(), { docId: d.id });
      });
      // Auto-migrate: isi daerah untuk rekod lama yang tiada daerah
      branches.forEach(function(b) {
        if (!b.daerah && b.docId) {
          const seed = [
            { name: "Management / HQ", daerah: "Kuantan" },
            { name: "Klinik Syed Badaruddin Balok (HQ)", daerah: "Kuantan" },
            { name: "Klinik Syed Badaruddin Beserah", daerah: "Kuantan" },
            { name: "Klinik Syed Badaruddin Gebeng", daerah: "Kuantan" },
            { name: "Klinik Syed Badaruddin Kempadang", daerah: "Kuantan" },
            { name: "Uni Klinik Bentong", daerah: "Bentong" },
            { name: "Klinik Syed Badaruddin MCKIP", daerah: "Kuantan" },
            { name: "Klinik Syed Badaruddin RPCM", daerah: "Kuantan" },
            { name: "Klinik Syed Badaruddin Utama", daerah: "Kuantan" },
            { name: "Klinik Syed Badaruddin Kerteh", daerah: "Kemaman" },
            { name: "Klinik Syed Badaruddin Paka", daerah: "Dungun" },
            { name: "Klinik Rakyat dan X-Ray Dungun", daerah: "Dungun" },
          ];
          const match = seed.find(s => s.name === b.name);
          if (match) {
            b.daerah = match.daerah;
            updateDoc(doc(db, 'branches', b.docId), { daerah: match.daerah });
          }
        }
      });
      // Sort: Pahang first, then Terengganu, then others, alphabetically within each
      branches.sort(function(a, b) {
        const order = { Pahang: 0, Terengganu: 1 };
        const ao = order[a.state] !== undefined ? order[a.state] : 2;
        const bo = order[b.state] !== undefined ? order[b.state] : 2;
        return ao !== bo ? ao - bo : a.name.localeCompare(b.name);
      });
      render();
    }
  });

  // Real-time Staff List
  onSnapshot(collection(db, "staff"), (snapshot) => {
    staffList = snapshot.docs.map(doc => ({
      ...doc.data(),
      docId: doc.id
    }));
    
    // Safety Seed: Ensure at least one Super Admin exists in the list for dropdowns
    const hasSuper = staffList.some(s => s.role === 'super_admin' || s.ic === 'super-admin' || s.ic === 'Super Admin');
    if (!hasSuper) {
        staffList.push({
            name: 'Super Admin',
            ic: 'super-admin',
            role: 'super_admin',
            branch: 'Management / HQ',
            category: 'Super Admin'
        });
    }

    // Re-sync logged-in user so edits (e.g. ent_CME) are reflected immediately
    if (user) {
      const refreshed = staffList.find(s => s.ic === user.ic);
      if (refreshed) user = refreshed;
    }

    // Auto-restore session after page refresh (if user was logged in before)
    if (!user) {
      const savedIC  = localStorage.getItem('ksb_logged_in_ic');
      const savedSID = localStorage.getItem('ksb_logged_in_sid');
      if (savedIC && savedSID && auth.currentUser && !auth.currentUser.isAnonymous) {
        const storedSID  = localStorage.getItem('ksb_session_' + savedIC);
        const savedUser  = staffList.find(s => s.ic === savedIC && !s.inactive);
        if (savedUser && storedSID === savedSID) {
          user = savedUser;
          currentSessionId = savedSID;
          duplicateSessionDetected = false;
          sessionKickHandled = false;
          startSessionListener(savedIC, savedSID);
          window.initMessengerRooms();
          window.initInbox();
          window.initPresence();
          window.startNewMessageListener();
          window.requestNotifPermission();
          startReminderScheduler();
          const defaultView = window.rbacMatrix[user.role]?.dashboard ? 'dashboard' : 'leave-form';
          view = defaultView;
          console.log(`[AUTH] Session restored for ${user.name} (${user.ic})`);
        } else {
          // Session tidak sah — buang dan kekal di login
          localStorage.removeItem('ksb_logged_in_ic');
          localStorage.removeItem('ksb_logged_in_sid');
        }
      } else if (savedIC || savedSID) {
        localStorage.removeItem('ksb_logged_in_ic');
        localStorage.removeItem('ksb_logged_in_sid');
      }
    }

    console.log(`[SYSTEM] Staff list loaded: ${staffList.length} total.`);
    render();
  });

  // Real-time Audit Logs
  onSnapshot(collection(db, "audit_logs"), (snapshot) => {
    systemAuditLogs = snapshot.docs.map(doc => doc.data())
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    render();
  });

  // Real-time Leave Records
  onSnapshot(collection(db, "leaves"), (snapshot) => {
    leaveRecords = snapshot.docs.map(doc => ({
      ...doc.data(),
      docId: doc.id
    })).sort((a, b) => b.id - a.id);
    console.log('Leave records updated from Firestore');
    render();
  });

  // Real-time Registration Requests
  onSnapshot(collection(db, "registration_requests"), (snapshot) => {
    registrationRequests = snapshot.docs.map(d => ({ ...d.data(), docId: d.id }))
      .sort((a, b) => (b.submittedAt || 0) - (a.submittedAt || 0));
    render();
  });

  // Real-time RBAC Matrix
  // Staff config: categories & role labels
  onSnapshot(doc(db, 'settings', 'staff_config'), (snap) => {
    if (snap.exists()) {
      const d = snap.data();
      if (Array.isArray(d.staffCategories)) {
        window.staffConfig.staffCategories = [...new Set([...CORE_CATEGORIES, ...d.staffCategories])];
      }
      if (d.roleLabels && typeof d.roleLabels === 'object') {
        window.staffConfig.roleLabels = { ...window.staffConfig.roleLabels, ...d.roleLabels };
      }
      if (Array.isArray(d.customRoles)) {
        window.staffConfig.customRoles = d.customRoles;
        // Ensure custom roles exist in rbacMatrix
        d.customRoles.forEach(r => {
          if (!window.rbacMatrix[r.key]) {
            window.rbacMatrix[r.key] = { ...JSON.parse(JSON.stringify(_rbacCodeDefaults.staff)), manage_roles_categories: false };
          }
        });
      }
    }
    render();
  });

  // Flag "Auto Guna Dalam Sistem" — disegerakkan live ke semua peranti.
  // Lalai AUTO; hanya MANUAL bila config tetapkan autoSystemUsage === false secara eksplisit.
  onSnapshot(doc(db, 'settings', 'leaveConfig'), (snap) => {
    autoSystemUsage = !(snap.exists() && snap.data().autoSystemUsage === false);
    render();
  });

  onSnapshot(doc(db, "settings", "rbac"), (docSnap) => {
    if (docSnap.exists()) {
        const data = docSnap.data();
        // Migrate: upgrade hod/pic_hod from old 'staff' default to 'branch'
        let needsMigration = false;
        if (data.hod && data.hod.dashboard === 'staff') { data.hod.dashboard = 'branch'; needsMigration = true; }
        if (data.pic_hod && data.pic_hod.dashboard === 'staff') { data.pic_hod.dashboard = 'branch'; needsMigration = true; }
        // Migrate: add branch_analisa flag for roles missing it
        const _branchAnalisaDefaults = { super_admin: false, admin: false, hr: false, hod: true, pic_hod: true, supervisor: false, staff: false };
        for (const _role of Object.keys(_branchAnalisaDefaults)) {
            if (data[_role] && data[_role].branch_analisa === undefined) {
                data[_role].branch_analisa = _branchAnalisaDefaults[_role];
                needsMigration = true;
            }
        }
        // Migrate: add report_kuantan_only + enable manage_reports for hr
        const _reportKuantanDefaults = { super_admin: false, admin: false, hr: true, hod: false, pic_hod: false, supervisor: false, staff: false };
        for (const _role of Object.keys(_reportKuantanDefaults)) {
            if (data[_role] && data[_role].report_kuantan_only === undefined) {
                data[_role].report_kuantan_only = _reportKuantanDefaults[_role];
                needsMigration = true;
            }
        }
        // Migrate: add report_own_branch_only + enable manage_reports for hod
        const _reportOwnBranchDefaults = { super_admin: false, admin: false, hr: false, hod: true, pic_hod: false, supervisor: false, staff: false };
        for (const _role of Object.keys(_reportOwnBranchDefaults)) {
            if (data[_role] && data[_role].report_own_branch_only === undefined) {
                data[_role].report_own_branch_only = _reportOwnBranchDefaults[_role];
                needsMigration = true;
            }
        }
        // Migrate: add report_attendance
        const _reportAttendanceDefaults = { super_admin: true, admin: true, hr: true, hod: true, pic_hod: false, supervisor: false, staff: false };
        for (const _role of Object.keys(_reportAttendanceDefaults)) {
            if (data[_role] && data[_role].report_attendance === undefined) {
                data[_role].report_attendance = _reportAttendanceDefaults[_role];
                needsMigration = true;
            }
        }
        // Enable manage_reports for hr if still false (old default)
        if (data.hr && data.hr.manage_reports === false) {
            data.hr.manage_reports = true;
            needsMigration = true;
        }
        // Enable manage_reports for hod if still false (old default)
        if (data.hod && data.hod.manage_reports === false) {
            data.hod.manage_reports = true;
            needsMigration = true;
        }
        // Migrate: tambah peranan baru dari code defaults jika belum ada dalam Firestore
        for (const _role of Object.keys(_rbacCodeDefaults)) {
            if (!data[_role]) {
                data[_role] = JSON.parse(JSON.stringify(_rbacCodeDefaults[_role]));
                needsMigration = true;
            }
        }
        // Migrate: tambah field baru pada peranan sedia ada jika belum ada
        for (const _role of Object.keys(data)) {
            if (_rbacCodeDefaults[_role]) {
                for (const _field of Object.keys(_rbacCodeDefaults[_role])) {
                    if (data[_role][_field] === undefined) {
                        data[_role][_field] = _rbacCodeDefaults[_role][_field];
                        needsMigration = true;
                    }
                }
            }
        }
        window.rbacMatrix = data;
        if (needsMigration) setDoc(doc(db, "settings", "rbac"), data);
        console.log('RBAC matrix updated from Firestore');
        render();
    } else {
        console.warn('RBAC matrix not found in Firestore, using defaults');
        setDoc(doc(db, "settings", "rbac"), window.rbacMatrix);
    }
  });
}

// Migration helper removed as data is now live on Firestore.
console.log('[SYSTEM] Version 1.1.0 - First Login Warning + Policy Flow + System URL');

// Auth bootstrap. Returning users have a persisted real session (Firebase restores it
// across reloads) — for them we subscribe to data immediately. Otherwise we sign in
// anonymously ONLY to let the login screen read the `directory` collection; data
// listeners are NOT attached under the anonymous session (rules deny anonymous reads) —
// they are attached after a real login (see the #login-form handler) or here for a
// restored session.
(async () => {
  try {
    await auth.authStateReady();
    if (auth.currentUser && !auth.currentUser.isAnonymous) {
      console.log('[AUTH] Restored real session:', auth.currentUser.uid);
      await loadDirectory();
      initData();
    } else {
      if (!auth.currentUser) {
        await signInAnonymously(auth);
        console.log('[AUTH] Anonymous bootstrap OK:', auth.currentUser && auth.currentUser.uid);
      }
      await loadDirectory();
    }
  } catch (e) {
    console.error('[AUTH] bootstrap failed:', e.code || e.message);
  }
})();

const auditLogs = [
  { time: '2024-04-03 14:22', user: 'Super Admin', action: 'Approved Annual Leave', target: 'Ahmad bin Zaid' },
  { time: '2024-04-03 10:15', user: 'Siti Aminah', action: 'Logged In', target: '-' },
  { time: '2024-04-02 16:45', user: 'Super Admin', action: 'Added New Staff', target: 'Dr. Lee Wei' },
];

const recentActivity = [
  { name: 'MUHAMMAD LUKHMAN BIN ISMAIL', type: 'AL', date: '2026-03-25', status: 'REJECTED', duration: '1 Day' },
  { name: 'MUHAMMAD LUKHMAN BIN ISMAIL', type: 'AL', date: '2026-03-25 - 2026-03-26', status: 'REJECTED', duration: '2 Days' },
  { name: 'MUHAMMAD LUKHMAN BIN ISMAIL', type: 'AL', date: '2026-03-25 - 2026-03-26', status: 'REJECTED', duration: '2 Days' },
  { name: 'MUHAMMAD LUKHMAN BIN ISMAIL', type: 'AL', date: '2026-03-20', status: 'APPROVED', duration: '1 Day' },
];

// Self-hosted from /public so logos survive project migrations (the old
// ksbsb-leave-trcker.firebaseapp.com host was deleted, which broke every logo).
const logos = {
  ksb: '/logo-ksb.png',
  kr: '/logo-kr.png',
  bentong: '/logo-bentong.png'
};

// Chart.js instances
let _chartMonthly = null;
let _chartTypes = null;

function initCharts() {
  const data = window._analyticsData;
  if (!data) return;

  // Vibrant per-month color palette (Jan→Dec)
  const barPalette = [
    { bg: 'rgba(59,130,246,0.9)',   hl: '#3b82f6'  },
    { bg: 'rgba(99,102,241,0.9)',   hl: '#6366f1'  },
    { bg: 'rgba(139,92,246,0.9)',   hl: '#8b5cf6'  },
    { bg: 'rgba(168,85,247,0.9)',   hl: '#a855f7'  },
    { bg: 'rgba(236,72,153,0.9)',   hl: '#ec4899'  },
    { bg: 'rgba(239,68,68,0.9)',    hl: '#ef4444'  },
    { bg: 'rgba(249,115,22,0.9)',   hl: '#f97316'  },
    { bg: 'rgba(245,158,11,0.9)',   hl: '#f59e0b'  },
    { bg: 'rgba(234,179,8,0.9)',    hl: '#eab308'  },
    { bg: 'rgba(132,204,22,0.9)',   hl: '#84cc16'  },
    { bg: 'rgba(34,197,94,0.9)',    hl: '#22c55e'  },
    { bg: 'rgba(20,184,166,0.9)',   hl: '#14b8a6'  },
  ];

  const activeMonth = analyticsFilterMonth;
  const dimmed = (i) => barPalette[i].bg.replace('0.9)', '0.18)');

  // Monthly Bar Chart
  const mc = document.getElementById('chart-monthly');
  if (mc) {
    if (_chartMonthly) { _chartMonthly.destroy(); _chartMonthly = null; }
    _chartMonthly = new Chart(mc, {
      type: 'bar',
      data: {
        labels: data.monthsList,
        datasets: [{
          label: 'Permohonan',
          data: data.monthCounts,
          backgroundColor: data.monthCounts.map((_, i) =>
            activeMonth === 0 || activeMonth === i + 1 ? barPalette[i].bg : dimmed(i)
          ),
          borderColor: data.monthCounts.map((_, i) =>
            activeMonth === 0 || activeMonth === i + 1 ? barPalette[i].hl : 'transparent'
          ),
          borderWidth: 2,
          borderRadius: 10,
          borderSkipped: false,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(15,23,42,0.92)',
            titleColor: '#f1f5f9',
            bodyColor: '#94a3b8',
            borderColor: 'rgba(148,163,184,0.15)',
            borderWidth: 1,
            padding: 12,
            cornerRadius: 10,
            callbacks: {
              title: (items) => data.monthsList[items[0].dataIndex] + ' ' + new Date().getFullYear(),
              label: (item) => '  ' + item.raw + ' Permohonan',
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            border: { display: false },
            ticks: { color: '#64748b', font: { size: 10, weight: '600' } },
          },
          y: {
            grid: { color: 'rgba(163,177,198,0.12)', drawBorder: false },
            border: { display: false },
            ticks: { color: '#64748b', font: { size: 10 }, stepSize: 1 },
            beginAtZero: true,
          }
        },
        onClick: (e, elements) => {
          if (elements.length > 0) {
            const idx = elements[0].index;
            window.setAnalyticsMonth(analyticsFilterMonth === idx + 1 ? 0 : idx + 1);
          }
        }
      }
    });
  }

  // Donut Chart (Leave Types) with center-text plugin
  const tc = document.getElementById('chart-types');
  if (tc) {
    if (_chartTypes) { _chartTypes.destroy(); _chartTypes = null; }
    const entries = Object.entries(data.types);
    const palette = ['#3b82f6','#f59e0b','#10b981','#ef4444','#8b5cf6','#ec4899','#14b8a6','#f97316','#84cc16','#a855f7'];

    const centerPlugin = {
      id: 'centerLabel',
      afterDraw(chart) {
        const { ctx, chartArea: { left, top, width, height } } = chart;
        const cx = left + width / 2, cy = top + height / 2;
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 20px Outfit, sans-serif';
        ctx.fillStyle = '#1e293b';
        ctx.fillText(data.totalReqs, cx, cy - 9);
        ctx.font = '600 10px Outfit, sans-serif';
        ctx.fillStyle = '#94a3b8';
        ctx.letterSpacing = '1px';
        ctx.fillText('JUMLAH', cx, cy + 9);
        ctx.restore();
      }
    };

    _chartTypes = new Chart(tc, {
      type: 'doughnut',
      data: {
        labels: entries.map(([id]) => id),
        datasets: [{
          data: entries.map(([, c]) => c),
          backgroundColor: entries.map((_, i) => palette[i % palette.length]),
          borderWidth: 4,
          borderColor: '#e0e5ec',
          hoverBorderColor: '#fff',
          hoverOffset: 10,
        }]
      },
      plugins: [centerPlugin],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '70%',
        animation: { animateRotate: true, duration: 700 },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(15,23,42,0.92)',
            titleColor: '#f1f5f9',
            bodyColor: '#94a3b8',
            borderColor: 'rgba(148,163,184,0.15)',
            borderWidth: 1,
            padding: 12,
            cornerRadius: 10,
            callbacks: {
              label: (item) => `  ${item.raw} (${data.totalReqs > 0 ? Math.round(item.raw / data.totalReqs * 100) : 0}%)`,
            }
          }
        }
      }
    });
  }
}


function render() {
  try {
    // Safety: if no user, always show login
    if (!user && view !== 'login') { view = 'login'; }

    // Focus preservation for inputs
    const activeId = document.activeElement ? document.activeElement.id : null;
    const selectionStart = document.activeElement ? document.activeElement.selectionStart : null;
    const selectionEnd = document.activeElement ? document.activeElement.selectionEnd : null;

    if (view === 'login') {
        renderLogin();
    } else {
        renderDashboard();
    }

    // Restore focus and selection
    if (activeId) {
        const el = document.getElementById(activeId);
        if (el) {
            el.focus();
            if (selectionStart !== null && selectionEnd !== null && el.setSelectionRange) {
                el.setSelectionRange(selectionStart, selectionEnd);
            }
        }
    }

    // Activate Lucide icons
    if (window.lucide) window.lucide.createIcons();

    // Render Chart.js charts if analytics view is active
    requestAnimationFrame(() => { initCharts(); });

    // Help widget — lives outside #app so survives innerHTML swaps
    try { renderHelpWidget(); } catch(e) {}

  } catch (err) {
    console.error("[CRITICAL] Render error:", err);
    // Fallback to login if fatal error in dashboard
    if (view !== 'login') {
        alert("⚠️ Ralat Sistem: Gagal memaparkan dashboard. Memulakan semula...");
        view = 'login';
        render();
    }
  }
}

function renderLogin() {
  // Normalize comparison to prevent whitespace and case issues
  const normSelected = (selectedLoginBranch || "").trim().toLowerCase();
  // NOTE: do NOT filter out super_admin here — directory docs may carry a role
  // field (sync_directory.js writes one), and hiding it would lock the break-glass
  // super admin out of the login dropdown. The account must stay selectable.
  const filteredStaff = selectedLoginBranch
    ? directoryList.filter(s => (s.branch || "").trim().toLowerCase() === normSelected && !s.inactive)
    : [];

  console.log(`[DEBUG_LOGIN] Branch: "${selectedLoginBranch}", Total: ${directoryList.length}, Filtered: ${filteredStaff.length}`);
  
  app.innerHTML = `
    <div class="auth-container">
      <div class="glass-pane auth-card fade-in">
        <div class="logo-group">
          <div class="logo-circle"><img src="${logos.ksb}" alt="KSB"></div>
          <div class="logo-circle"><img src="${logos.kr}" alt="KR"></div>
          <div class="logo-circle"><img src="${logos.bentong}" alt="Bentong"></div>
        </div>
        <h1 class="auth-title">KLINIK SYED BADARUDDIN</h1>
        <p class="auth-subtitle">Leave Tracking System</p>

        <!-- System URL Badge -->
        <div style="margin-bottom:1rem;text-align:center;">
          <a href="https://apply-leave-89ebb.web.app" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:0.4rem;background:rgba(59,130,246,0.12);border:1px solid rgba(59,130,246,0.35);border-radius:999px;padding:0.35rem 0.9rem;font-size:0.78rem;color:var(--primary);font-weight:700;text-decoration:none;letter-spacing:0.3px;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
            apply-leave-89ebb.web.app
          </a>
        </div>
        
        <form id="login-form">
          <div class="form-group">
            <label>Cawangan (Branch)</label>
            <select id="login-branch" class="neu-inset" style="width: 100%; appearance: none; cursor: pointer; color-scheme: light; font-weight: 600;" onchange="window.setLoginBranch(this.value)" required>
              <option value="" disabled ${!selectedLoginBranch ? 'selected' : ''}>-- Pilih Cawangan --</option>
              ${branches.map(b => `<option value="${b.name}" ${selectedLoginBranch === b.name ? 'selected' : ''}>${b.name}</option>`).join('')}
            </select>
          </div>

          <div class="form-group" style="position: relative;">
            <label>Nama Pekerja (Staff Name)</label>
            <div style="position: relative;">
              <input
                type="text"
                id="staff-search-input"
                class="neu-inset"
                placeholder="${!selectedLoginBranch ? 'Pilih cawangan dahulu...' : 'Taip nama untuk cari...'}"
                autocomplete="off"
                ${!selectedLoginBranch ? 'disabled' : ''}
                style="width: 100%; padding-right: 2.5rem;"
                oninput="window.filterStaffDropdown(this.value)"
                onfocus="window.showStaffDropdown(); this.select();"
                onblur="setTimeout(() => window.hideStaffDropdown(), 300)"
                value="${selectedLoginStaffIC ? (directoryList.find(s=>s.ic===selectedLoginStaffIC)||{name:''}).name : ''}"
              >
              <div style="position: absolute; right: 1rem; top: 50%; transform: translateY(-50%); color: var(--text-muted); pointer-events: none;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              </div>
            </div>
            <div id="staff-dropdown" style="display: none; position: absolute; top: 100%; left: 0; right: 0; z-index: 999; background: #ffffff; border: 1px solid rgba(0,0,0,0.1); border-radius: 14px; box-shadow: 0 10px 30px rgba(0,0,0,0.2); max-height: 220px; overflow-y: auto; margin-top: 0.5rem;">
              ${filteredStaff.map(s => `
                <div class="staff-option" data-ic="${s.ic}" data-name="${s.name}" onmousedown="event.preventDefault(); window.selectLoginStaff('${s.ic}', '${s.name.replace(/'/g, String.fromCharCode(92)+"'")}')" style="padding: 0.85rem 1.25rem; cursor: pointer; font-size: 0.875rem; border-bottom: 1px solid rgba(0,0,0,0.05); display: flex; align-items: center; gap: 0.75rem; transition: background 0.15s;">
                  <div style="width: 32px; height: 32px; border-radius: 50%; background: linear-gradient(135deg, var(--primary), var(--secondary)); display: flex; align-items: center; justify-content: center; font-size: 1.05rem; font-weight: 700; flex-shrink: 0;">${s.name.charAt(0)}</div>
                  <div>
                    <div class="staff-opt-name" style="font-weight: 700; color: #1e293b;">${s.name}</div>
                    <div style="font-size: 0.7rem; color: #64748b; letter-spacing: 0.5px;">${s.role ? s.role.toUpperCase() : 'STAFF'}</div>
                  </div>
                </div>
              `).join('')}
            </div>
            <input type="hidden" id="login-staff" value="${selectedLoginStaffIC || ''}">
          </div>

          <div class="form-group">
            <label>Password</label>
            <div style="position: relative;">
              <input type="password" id="password" placeholder="••••••••" required style="width: 100%;">
            </div>
            <div style="text-align: right; margin-top: 0.5rem;">
              <button type="button" onclick="window.forgotPassword()" style="background: none; border: none; cursor: pointer; color: var(--primary); font-size: 1rem; font-weight: 600; text-decoration: underline; padding: 0; display: inline-flex; align-items: center; gap: 0.3rem;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                Lupa Kata Laluan?
              </button>
            </div>
          </div>
          <button type="submit" class="btn-primary">Login</button>
        </form>

        <div style="margin-top: 1.25rem; text-align: center;">
          <span style="font-size: 0.9rem; color: var(--text-muted);">Staf baharu?</span>
          <button type="button" onclick="window.openRegisterModal()" style="background: none; border: none; cursor: pointer; color: var(--primary); font-size: 0.9rem; font-weight: 700; text-decoration: underline; padding: 0 0.25rem; margin-left: 0.25rem;">
            Daftar di sini
          </button>
        </div>

        <div style="margin-top: 1.5rem; border-top: 1px solid var(--border); padding-top: 1.25rem; display: flex; flex-direction: column; gap: 0.75rem;">

           <!-- Tip: cara log masuk -->
           <div style="display:flex; align-items:flex-start; gap:0.6rem;">
             <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2" style="flex-shrink:0; margin-top:2px;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
             <p style="font-size:0.8rem; color:var(--text-muted); margin:0; line-height:1.5;">
               Pilih cawangan dan nama anda untuk log masuk. Admin boleh tetapkan kata laluan anda dalam bahagian <strong>Management</strong>.
             </p>
           </div>

           <!-- Tip: lupa kata laluan -->
           <div style="display:flex; align-items:flex-start; gap:0.6rem;">
             <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2" style="flex-shrink:0; margin-top:2px;"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
             <p style="font-size:0.8rem; color:var(--text-muted); margin:0; line-height:1.5;">
               Pilih nama anda, kemudian klik <strong style="color:var(--primary);">Lupa Kata Laluan?</strong> — kod OTP akan dihantar ke WhatsApp anda untuk menetapkan kata laluan baharu. Pastikan nombor telefon anda telah didaftarkan oleh HR/Admin.
             </p>
           </div>

           <!-- First-login reminder -->
           <div style="background:rgba(239,68,68,0.08); border:1px solid rgba(239,68,68,0.25); border-radius:0.75rem; padding:0.75rem 0.9rem; display:flex; align-items:flex-start; gap:0.6rem;">
             <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5" style="flex-shrink:0; margin-top:2px;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
             <p style="font-size:0.8rem; color:var(--text-muted); margin:0; line-height:1.5;">
               <strong style="color:#ef4444;">Log masuk pertama?</strong> Kata laluan awal anda adalah <strong>No. IC</strong>. Sistem akan minta anda menukar kata laluan selepas log masuk pertama bagi keselamatan akaun.
             </p>
           </div>
        </div>

        <!-- Hak Cipta -->
        <div style="margin-top:1.25rem;text-align:center;">
          <p style="font-size:0.72rem;color:var(--text-muted);letter-spacing:0.3px;margin:0;">© 2026 Hak Cipta Terpelihara · KSBSB IT @ LukhzzIsZa</p>
        </div>
      </div>
    </div>

    ${showRegisterModal ? `
    <div style="position: fixed; inset: 0; background: rgba(0,0,0,0.6); backdrop-filter: blur(4px); z-index: 9999; display: flex; align-items: center; justify-content: center; padding: 1rem;" onclick="if(event.target===this)window.closeRegisterModal()">
      <div class="glass-pane fade-in" style="width: 100%; max-width: 480px; padding: 2rem; border-radius: 1.5rem; position: relative; max-height: 90vh; overflow-y: auto;">
        <button onclick="window.closeRegisterModal()" style="position: absolute; top: 1rem; right: 1rem; background: rgba(255,255,255,0.08); border: none; border-radius: 50%; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--text-muted);">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
        <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1.5rem;">
          <div style="width: 40px; height: 40px; border-radius: 50%; background: linear-gradient(135deg, var(--primary), var(--secondary)); display: flex; align-items: center; justify-content: center;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><line x1="19" y1="8" x2="19" y2="14"></line><line x1="22" y1="11" x2="16" y2="11"></line></svg>
          </div>
          <div>
            <h2 style="font-size: 1.15rem; font-weight: 700; margin: 0;">Daftar Akaun Baharu</h2>
            <p style="font-size: 0.8rem; color: var(--text-muted); margin: 0;">Permohonan akan disemak oleh HR/Admin</p>
          </div>
        </div>
        <form onsubmit="window.submitRegister(event)">
          <div class="form-group">
            <label>Nama Penuh <span style="color:#ef4444;">*</span></label>
            <input type="text" id="reg-name" class="neu-inset" placeholder="NAMA SEPERTI DALAM IC" required style="width: 100%; text-transform: uppercase;" oninput="this.value=this.value.toUpperCase()">
          </div>
          <div class="form-group">
            <label>No. Kad Pengenalan (IC) <span style="color:#ef4444;">*</span></label>
            <input type="text" id="reg-ic" class="neu-inset" placeholder="Contoh: 901231045678" required style="width: 100%;">
          </div>
          <div class="form-group">
            <label>Cawangan <span style="color:#ef4444;">*</span></label>
            <select id="reg-branch" class="neu-inset" required style="width: 100%; appearance: none; cursor: pointer; color-scheme: light; font-weight: 600;">
              <option value="" disabled selected>-- Pilih Cawangan --</option>
              ${branches.filter(b => b.name !== 'Management / HQ').map(b => `<option value="${b.name}">${b.name}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>Kategori <span style="color:#ef4444;">*</span></label>
            <select id="reg-category" class="neu-inset" required style="width: 100%; appearance: none; cursor: pointer; color-scheme: light; font-weight: 600;">
              <option value="" disabled selected>-- Pilih Kategori --</option>
              ${window.staffConfig.staffCategories.map(c => `<option value="${c}">${c}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>No. WhatsApp <span style="color:#ef4444;">*</span></label>
            <input type="tel" id="reg-phone" class="neu-inset" placeholder="Contoh: 0123456789 atau 60123456789" required style="width: 100%;">
            <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 0.35rem;">Nombor akan disimpan dengan awalan 6 (contoh: 0123456789 → 60123456789)</div>
          </div>
          <div style="background: rgba(59,130,246,0.08); border: 1px solid rgba(59,130,246,0.2); border-radius: 0.75rem; padding: 0.85rem 1rem; margin-bottom: 1.25rem; font-size: 0.82rem; color: var(--text-muted); line-height: 1.5;">
            <strong style="color: var(--primary);">Nota:</strong> Setelah diluluskan, kata laluan awal anda adalah No. IC anda. Sila tukar kata laluan selepas log masuk pertama.
          </div>
          <button type="submit" class="btn-primary" style="width: 100%;">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align: middle; margin-right: 0.4rem;"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.62 3.36a2 2 0 0 1 2-2.18h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
            Hantar Permohonan
          </button>
        </form>
      </div>
    </div>
    ` : ''}
  `;

  document.querySelector('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const icField = document.querySelector('#login-staff');
    const pwdField = document.querySelector('#password');
    const searchInput = document.querySelector('#staff-search-input');

    let ic = (icField ? icField.value : "").trim();
    const pwd = (pwdField ? pwdField.value : "").trim();

    // Fallback: typed name without clicking the dropdown.
    if (!ic && searchInput && searchInput.value.trim()) {
      const typedName = searchInput.value.trim().toLowerCase();
      const matched = directoryList.find(s =>
        (s.branch || "").trim().toLowerCase() === (selectedLoginBranch || "").trim().toLowerCase() &&
        s.name.toLowerCase() === typedName);
      if (matched) ic = matched.ic;
    }

    if (!ic) { alert('Sila pilih nama anda dari senarai (dropdown) atau pastikan ejaan nama betul.'); return; }
    if (!pwd) { alert('Sila masukkan kata laluan.'); return; }

    try {
      await signInWithEmailAndPassword(auth, emailForIC(ic), pwd);
    } catch (err) {
      console.warn('[AUTH_FAIL]', err.code);
      if (err.code === 'auth/user-disabled') alert('⚠️ Akaun anda tidak aktif. Sila hubungi HR/Admin.');
      else alert('⚠️ RALAT: IC atau kata laluan tidak sah. Sila cuba lagi.');
      return;
    }

    // Load the staff profile for the now-authenticated user.
    const snap = await getDoc(doc(db, 'staff', ic));
    if (!snap.exists()) { alert('Profil staf tidak dijumpai. Sila hubungi HR/Admin.'); await signOut(auth); return; }
    user = snap.data();
    initData(); // subscribe to live data now that we have a real (non-anonymous) session

    showFirstLoginWarning = (pwd === (user.ic || '').trim());
    const _ph = (user.phone || '').replace(/\D/g, '');
    showPhoneReminderModal = !showFirstLoginWarning && (!_ph || !_ph.startsWith('6'));
    currentSessionId = Date.now().toString() + '_' + Math.random().toString(36).substring(2);
    duplicateSessionDetected = false;
    sessionKickHandled = false;
    localStorage.setItem('ksb_session_' + user.ic, currentSessionId);
    localStorage.setItem('ksb_logged_in_ic', user.ic);
    localStorage.setItem('ksb_logged_in_sid', currentSessionId);
    setDoc(doc(db, 'sessions', user.ic), {
      sessionId: currentSessionId, loginAt: Date.now(), name: user.name,
      device: navigator.userAgent.slice(0, 150)
    }).then(() => startSessionListener(user.ic, currentSessionId));
    window.logSystemActivity("Logged into system");
    window.initMessengerRooms();
    window.initInbox();
    window.initPresence();
    window.startNewMessageListener();
    window.requestNotifPermission();
    startReminderScheduler();
    view = 'dashboard';
    render();
  });
}

window.filterStaffDropdown = function(query) {
  const dropdown = document.getElementById('staff-dropdown');
  if (!dropdown) return;
  const options = dropdown.querySelectorAll('.staff-option');
  const q = query.toLowerCase().trim();
  let hasVisible = false;
  options.forEach(opt => {
    const name = (opt.dataset.name || "").toLowerCase();
    const nameEl = opt.querySelector('.staff-opt-name');
    if (!q || name.includes(q)) {
      opt.style.display = '';
      if (q && nameEl) {
        const idx = name.indexOf(q);
        const original = opt.dataset.name;
        nameEl.innerHTML = original.substring(0, idx) +
          `<mark style="background:rgba(59,130,246,0.35);color:white;border-radius:2px;padding:0 2px;">${original.substring(idx, idx+q.length)}</mark>` +
          original.substring(idx + q.length);
      } else if (nameEl) {
        nameEl.textContent = opt.dataset.name;
      }
      hasVisible = true;
    } else {
      opt.style.display = 'none';
    }
  });
  const hiddenInput = document.getElementById('login-staff');
  if (hiddenInput) hiddenInput.value = '';
  dropdown.style.display = hasVisible ? 'block' : 'none';
};

window.showStaffDropdown = function() {
  if (!selectedLoginBranch) return;
  const dropdown = document.getElementById('staff-dropdown');
  if (dropdown) {
    dropdown.style.display = 'block';
    // Attach hover styles dynamically
    dropdown.querySelectorAll('.staff-option').forEach(el => {
      el.onmouseenter = () => { el.style.background = 'rgba(59,130,246,0.08)'; };
      el.onmouseleave = () => { el.style.background = ''; };
    });
  }
};

window.hideStaffDropdown = function() {
  const dropdown = document.getElementById('staff-dropdown');
  if (dropdown) dropdown.style.display = 'none';
};

window.selectLoginStaff = function(ic, name) {
  const hiddenInput = document.getElementById('login-staff');
  const searchInput = document.getElementById('staff-search-input');
  const dropdown = document.getElementById('staff-dropdown');
  if (hiddenInput) hiddenInput.value = ic;
  if (searchInput) searchInput.value = name;
  if (dropdown) dropdown.style.display = 'none';
  window.setLoginStaff(ic);
};

// Auto-logout sesi lama: dicetus bila login baru dikesan (sessionId berbeza) pada peranti
// ini atau tab lain dalam pelayar yang sama. "Login terbaru menang" — sesi lama ditamatkan.
// Selamat: logout() tidak memadam doc sessions/{ic}, jadi rekod sesi baru kekal utuh.
function handleDuplicateSessionKick() {
  if (sessionKickHandled) return;
  sessionKickHandled = true;
  if (sessionUnsubscribe) { sessionUnsubscribe(); sessionUnsubscribe = null; }
  if (!document.getElementById('session-kick-overlay')) {
    const overlay = document.createElement('div');
    overlay.id = 'session-kick-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(15,23,42,0.92);display:flex;align-items:center;justify-content:center;padding:1.5rem;';
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:18px;max-width:380px;width:100%;padding:2rem 1.75rem;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.4);">
        <div style="width:64px;height:64px;border-radius:50%;background:linear-gradient(135deg,#dc2626,#991b1b);display:flex;align-items:center;justify-content:center;margin:0 auto 1.25rem;">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>
        </div>
        <div style="font-size:1.15rem;font-weight:800;color:#0f172a;margin-bottom:0.6rem;">Dilog Keluar</div>
        <div style="font-size:0.9rem;color:#475569;line-height:1.5;">Akaun ini telah dilog masuk di peranti atau lokasi lain. Atas sebab keselamatan, sesi ini akan ditamatkan.</div>
        <div style="font-size:0.8rem;color:#94a3b8;margin-top:1rem;">Membawa anda ke skrin log masuk…</div>
      </div>`;
    document.body.appendChild(overlay);
  }
  setTimeout(() => { window.logout(); }, 3000);
}

// Start Firestore session listener for cross-device detection
function startSessionListener(ic, sid) {
  if (sessionUnsubscribe) { sessionUnsubscribe(); sessionUnsubscribe = null; }
  sessionUnsubscribe = onSnapshot(doc(db, 'sessions', ic), (snap) => {
    if (!user || !snap.exists()) return;
    const data = snap.data();
    if (data && data.sessionId && data.sessionId !== sid) {
      handleDuplicateSessionKick();
    }
  });
}

// Same-browser multi-tab detection (localStorage)
window.addEventListener('storage', (e) => {
  if (user && e.key === 'ksb_session_' + user.ic) {
    if (e.newValue && e.newValue !== currentSessionId) {
      handleDuplicateSessionKick();
    }
  }
});

// Unified Entitlement Logic (Force Sync for Doctors & Branch Fallbacks)
window.getEntitlementAL = function(staffObj) {
  if (!staffObj) return 20;

  // 1. Manual override set by Admin (Highest Priority)
  // Membolehkan admin set cuti doc 10, 20, atau 25 secara manual dan dibaca oleh sistem
  if (staffObj.ent_AL !== undefined && staffObj.ent_AL !== null) {
      return parseFloat(staffObj.ent_AL);
  }

  // 2. Default fallback for Doctors (If not set manually)
  if (staffObj.category === 'Doctor') {
      const isSpecialDoctor = ['Dr. Rohana', 'Dr. Abdul Wahid', 'Dr. Zainal'].some(d => staffObj.name.toLowerCase().includes(d.toLowerCase()));
      if (isSpecialDoctor) return 25;
      return 20;
  }

  let years = 0;
  if (staffObj.startDate) {
     const start = new Date(staffObj.startDate);
     const now = new Date();
     years = now.getFullYear() - start.getFullYear();
     if (now.getMonth() < start.getMonth() || (now.getMonth() === start.getMonth() && now.getDate() < start.getDate())) {
         years--;
     }
  }

  // Fallback branch logic
  const branchObj = branches.find(b => b.name === (staffObj.branch || '').trim());
  if (branchObj && branchObj.state === 'Terengganu') return 16;

  // Pahang Logic
  return years >= 5 ? 20 : 16;
};

// Peruntukan MC setahun ikut tahun khidmat (Akta Kerja 1955 s.60F):
//   < 2 tahun = 14, 2–5 tahun = 18, > 5 tahun = 22.
// ent_MC kekal sebagai override HR (keutamaan tertinggi). Jika startDate tiada,
// jatuh ke 14 (tier terendah) — HR perlu isi startDate untuk peruntukan tepat.
window.getEntitlementMC = function(staffObj) {
  if (!staffObj) return 14;
  if (staffObj.ent_MC !== undefined && staffObj.ent_MC !== null) {
    return parseFloat(staffObj.ent_MC);
  }
  let years = 0;
  if (staffObj.startDate) {
    const start = new Date(staffObj.startDate);
    const now = new Date();
    years = now.getFullYear() - start.getFullYear();
    if (now.getMonth() < start.getMonth() || (now.getMonth() === start.getMonth() && now.getDate() < start.getDate())) {
      years--;
    }
  }
  return years >= 5 ? 22 : years >= 2 ? 18 : 14;
};

window.getMonthsWorkedThisYear = function(startDate) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 1-12
  
  if (!startDate) return currentMonth;
  
  const start = new Date(startDate);
  const startYear = start.getFullYear();
  const startMonth = start.getMonth() + 1;
  
  if (startYear < currentYear) {
    return currentMonth;
  } else if (startYear === currentYear) {
    return Math.max(0, currentMonth - startMonth + 1);
  } else {
    return 0;
  }
};

// AUTO mode "Guna Dalam Sistem":
//  • true  (auto)  : dikira automatik dari rekod cuti diluluskan; nilai manual diabai.
//  • false (manual): HR isi sendiri bilangan hari guna dalam sistem; rekod diluluskan diabai.
// Disimpan di Firestore (settings/leaveConfig). Toggle via butang dalam tab RBAC
// (window.toggleAutoSystemUsage). Lalai AUTO; hanya MANUAL bila config eksplisit false.
let autoSystemUsage = true;

window.getEarnedAL = function(staffObj) {
  if (!staffObj) return 0;
  // Jumlah Peruntukan AL = peruntukan tahunan (ent_AL) + baki dibawa (ent_CF).
  // Tiada prorata ÷12. Potongan (guna sebelum sistem, guna sistem, pelarasan HR)
  // dikira dalam getLeaveStats (Formula B).
  return window.getEntitlementAL(staffObj) + parseFloat(staffObj.ent_CF || 0);
};

window.getLeaveStats = function(staff, type) {
  if (!staff) return { used: 0, ent: 0, bal: 0 };

  const records = leaveRecords.filter(r => r.ic === staff.ic && r.status === 'APPROVED' && r.type === type);
  const recordsUsed = records.reduce((acc, r) => acc + parseFloat(r.days || 0), 0);

  let ent = 0;
  if (type === 'AL') {
    ent = window.getEarnedAL(staff); // Jumlah = ent_AL + CF
  } else if (type === 'MC') {
    ent = window.getEntitlementMC(staff); // peruntukan MC ikut tahun khidmat (14/18/22)
  } else {
    // ML_PL entitlement is saved as ent_PL by the HR form (legacy key)
    const entKey = type === 'ML_PL' ? 'ent_PL' : `ent_${type}`;
    const stored = staff[entKey];
    ent = (stored !== undefined && stored !== null)
      ? parseFloat(stored)
      : (leaveCategories.find(c => c.id === type)?.entitlement || 0);
  }

  // Formula B (AL/MC/EL): Baki = Jumlah − Guna Sebelum Sistem − Guna Dalam Sistem − Pelarasan HR.
  // "Guna Dalam Sistem" = rekod diluluskan (mod AUTO) ATAU nilai manual HR (mod manual).
  // Medan {jenis}_used_pre, {jenis}_used_sys_adj, {jenis}_pelarasan diisi HR (lalai 0).
  let usedPre = 0, pelarasan = 0, usedSysAdj = 0;
  if (type === 'AL' || type === 'MC' || type === 'EL') {
    const p = type.toLowerCase();
    usedPre    = parseFloat(staff[`${p}_used_pre`]     || 0);
    pelarasan  = parseFloat(staff[`${p}_pelarasan`]    || 0);
    usedSysAdj = parseFloat(staff[`${p}_used_sys_adj`] || 0);
  }
  // Fallback warisan (AL sahaja): sebelum Formula B, HR simpan "Baki AL Tinggal" dalam
  // medan al_adj. Jika medan Formula B belum diisi langsung, terjemah al_adj ke "Guna
  // Sebelum Sistem": usedPre = Jumlah − al_adj  ⇒  Baki = Jumlah − usedPre = al_adj.
  // Ini memulihkan baki sedia ada HR tanpa migrasi data; hilang sebaik HR simpan semula.
  // Nota: al_adj === 0 bermaksud "tidak dimigrasi" (guna peruntukan penuh), jadi fallback
  // hanya untuk al_adj > 0 — selari dengan model lama (baseline = al_adj jika > 0).
  if (type === 'AL' && staff.al_used_pre === undefined &&
      staff.al_pelarasan === undefined && parseFloat(staff.al_adj || 0) > 0) {
    usedPre = Math.max(0, ent - parseFloat(staff.al_adj || 0));
  }
  const usedSys = autoSystemUsage ? recordsUsed : usedSysAdj;

  return {
    used: usedSys,
    usedFromRecords: recordsUsed,
    usedSysAdj: usedSysAdj,
    usedPre: usedPre,
    pelarasan: pelarasan,
    adj: pelarasan,
    ent: ent,
    bal: Math.max(0, ent - usedPre - usedSys - pelarasan)
  };
};



function validateNotice(startDate, category) {
  const today = new Date();
  const start = new Date(startDate);
  const diffTime = start - today;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  const minDays = (category === 'Admin Staff' || category === 'Admin') ? 3 : 7;
  return diffDays >= minDays;
}

window.toggleMobileMenu = function(val) {
  mobileMenuOpen = (val !== undefined) ? val : !mobileMenuOpen;
  render();
};

window.logout = function() {
  localStorage.removeItem('ksb_logged_in_ic');
  localStorage.removeItem('ksb_logged_in_sid');
  if (sessionUnsubscribe) { sessionUnsubscribe(); sessionUnsubscribe = null; }
  if (messengerMsgUnsub) { messengerMsgUnsub(); messengerMsgUnsub = null; }
  if (messengerRoomsUnsub) { messengerRoomsUnsub(); messengerRoomsUnsub = null; }
  window.stopPresence();
  window.stopNewMessageListener();
  stopReminderScheduler();
  user = null;
  currentSessionId = null;
  duplicateSessionDetected = false;
  mobileMenuOpen = false;
  dashboardTab = null;
  analyticsFilterMonth = 0;
  analyticsCatFilter = 'SEMUA';
  analyticsBranchFilter = 'SEMUA';
  branchDashboardMonth = 0;
  messengerRoomId = null;
  messengerMessages = [];
  messengerRoomLastMsg = {};
  messengerUnreadRooms = new Set();
  messengerView = 'rooms';
  messengerFileObj = null;
  msgToasts.forEach(t => { if (t.timer) clearTimeout(t.timer); });
  msgToasts = [];
  view = 'login';
  render();
  signOut(auth).catch(() => {}).finally(() => window.location.reload());
};

// ============================================================
// MESSENGER MODULE
// ============================================================

function safeBranchId(branchName) {
  return 'branch_' + (branchName || '').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40);
}

function getDMRoomId(ic1, ic2) {
  return 'dm_' + [ic1, ic2].sort().join('__');
}

// ── Presence ──────────────────────────────────────────────
window.initPresence = async function() {
  if (!user) return;
  const presRef = doc(db, 'user_presence', user.ic);
  const writeOnline = () => setDoc(presRef, {
    ic: user.ic, name: user.name,
    branch: user.branch || '', role: user.role || '',
    online: true, lastSeen: Date.now(),
    status: myStatus, statusMsg: myStatusMsg
  }, { merge: true });

  await writeOnline();

  // Mark offline on tab close / navigation away
  window.addEventListener('beforeunload', () => {
    setDoc(presRef, { online: false, lastSeen: Date.now() }, { merge: true });
  });

  // Heartbeat every 30s
  presenceHeartbeatInterval = setInterval(writeOnline, 30000);

  // Listen for all presence changes
  if (presenceUnsub) { presenceUnsub(); presenceUnsub = null; }
  presenceUnsub = onSnapshot(collection(db, 'user_presence'), (snap) => {
    const now = Date.now();
    onlineUsers = {};
    snap.docs.forEach(d => {
      const data = d.data();
      // Visible to others = online + fresh + not invisible (status-aware).
      if (isVisibleToOthers(data, now)) {
        onlineUsers[data.ic] = data;
      }
    });
    if (view === 'messenger') render();
  });
};

// Set my own presence status (Available/Sibuk/Away/Invisible). Persists locally
// and pushes to Firestore immediately so others see it without waiting a beat.
window.setMyStatus = async function(status) {
  if (!getStatusMeta(status) || status !== getStatusMeta(status).id) return;
  myStatus = status;
  try { localStorage.setItem('ksb_msg_status', status); } catch (_) {}
  if (user) {
    try { await setDoc(doc(db, 'user_presence', user.ic), { status, online: true, lastSeen: Date.now() }, { merge: true }); } catch (_) {}
  }
  render();
};

// Set my mood / status message (free text under my name).
window.setMyMood = async function(text) {
  myStatusMsg = normalizeMood(text);
  try { localStorage.setItem('ksb_msg_mood', myStatusMsg); } catch (_) {}
  if (user) {
    try { await setDoc(doc(db, 'user_presence', user.ic), { statusMsg: myStatusMsg, lastSeen: Date.now() }, { merge: true }); } catch (_) {}
  }
  render();
};

window.stopPresence = async function() {
  if (presenceHeartbeatInterval) { clearInterval(presenceHeartbeatInterval); presenceHeartbeatInterval = null; }
  if (presenceUnsub) { presenceUnsub(); presenceUnsub = null; }
  if (user) {
    try { await setDoc(doc(db, 'user_presence', user.ic), { online: false, lastSeen: Date.now() }, { merge: true }); } catch(e) {}
  }
  onlineUsers = {};
};
// ────────────────────────────────────────────────────────────

// ── Bunyi notifikasi mesej (Web Audio API, tanpa fail audio) ──
function playMsgSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.35);
  } catch(e) {}
}

// ── Minta kebenaran Browser Notification ──
window.requestNotifPermission = function() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    Notification.requestPermission();
  }
};

// ── Inbox: tambah notifikasi ke Firestore ──
window.addNotification = async function(recipientIC, type, title, body, leaveId = null) {
  if (!recipientIC) return;
  try {
    const data = { recipientIC, type, title, body, read: false, createdAt: Date.now() };
    if (leaveId) data.leaveId = leaveId;
    await addDoc(collection(db, 'notifications'), data);
  } catch(e) { console.warn('addNotification failed:', e); }
};

// ── Inbox: notifikasi kepada senarai pelulus (selari dgn notifikasi WhatsApp) ──
// staffArr = senarai objek staff pelulus; auto buang yang inactif, tiada IC,
// dan pemohon sendiri (excludeIC), serta nyahduplikasi ikut IC.
window.notifyApproversInbox = function(staffArr, title, body, leaveId, excludeIC) {
  const uniq = [...new Map(
    (staffArr || [])
      .filter(s => s && s.ic && s.ic !== excludeIC && !s.inactive)
      .map(s => [s.ic, s])
  ).values()];
  uniq.forEach(s => window.addNotification(s.ic, 'leave_to_approve', title, body, leaveId));
};

// ── Inbox: mark as read ──
window.markNotifRead = async function(notifId) {
  try {
    await updateDoc(doc(db, 'notifications', notifId), { read: true });
  } catch(e) { console.warn('markNotifRead failed:', e); }
};

// ── Inbox: browser notification ──
function showInboxBrowserNotif(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const notif = new Notification(title, {
    body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: 'inbox-' + Date.now(),
  });
  notif.onclick = function() {
    window.focus();
    notif.close();
    window.setView('inbox');
    render();
  };
}

// ── Inbox: listener real-time ──
window.initInbox = function() {
  if (!user) return;
  if (inboxUnsub) { inboxUnsub(); inboxUnsub = null; }
  const q = query(
    collection(db, 'notifications'),
    where('recipientIC', '==', user.ic),
    orderBy('createdAt', 'desc'),
    limit(50)
  );
  let isFirst = true;
  inboxUnsub = onSnapshot(q, snap => {
    inboxNotifs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!isFirst) {
      snap.docChanges().forEach(change => {
        if (change.type === 'added' && !change.doc.data().read) {
          const n = change.doc.data();
          showInboxBrowserNotif(n.title, n.body);
        }
      });
    }
    isFirst = false;
    render();
  }, err => {
    // Jangan biarkan ralat senyap — index hilang / permission denied akan tunjuk di sini.
    console.error('Inbox listener error:', err);
  });
};

// ── Tunjuk Browser Notification (muncul walaupun tab tidak aktif) ──
function showBrowserNotif(senderName, roomName, text, roomId, roomType) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (document.visibilityState === 'visible') return; // sudah nampak toast, tak perlu double
  const title = roomType === 'dm' ? `💬 ${senderName}` : `💬 ${senderName} @ ${roomName}`;
  const preview = text.length > 100 ? text.slice(0, 100) + '…' : text;
  const notif = new Notification(title, {
    body: preview,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: roomId, // grupkan notif dari room yang sama
    renotify: true,
  });
  notif.onclick = function() {
    window.focus();
    notif.close();
    window.setView('messenger');
    render();
  };
}

// New-message toasts are now derived from the per-room metadata listener in
// initMessengerRooms (fireToasts). That avoids any global message query, so a
// DM between two other people can never reach this client. These remain as
// no-ops so existing call sites keep working.
window.startNewMessageListener = function() {};
window.stopNewMessageListener = function() {
  if (msgNewMsgUnsub) { msgNewMsgUnsub(); msgNewMsgUnsub = null; }
};
// ─────────────────────────────────────────────────────────────────────

function showMsgToast(roomId, roomName, roomType, senderName, text) {
  const existingTimer = (msgToasts.find(t => t.roomId === roomId) || {}).timer;
  if (existingTimer) clearTimeout(existingTimer);
  msgToasts = msgToasts.filter(t => t.roomId !== roomId);

  const id = Date.now() + '_' + Math.random().toString(36).slice(2);
  const preview = text.length > 70 ? text.slice(0, 70) + '…' : text;
  const isDM = roomType === 'dm';
  const createdAt = Date.now();

  const toast = { id, roomId, roomName, roomType, senderName, preview, isDM, createdAt };
  msgToasts.unshift(toast);
  if (msgToasts.length > 3) msgToasts = msgToasts.slice(0, 3);

  toast.timer = setTimeout(() => {
    msgToasts = msgToasts.filter(t => t.id !== id);
    render();
  }, 6000);

  render(); // toast is now part of render output
}

function renderActiveToasts() {
  if (msgToasts.length === 0) return '';
  const now = Date.now();
  return `<div style="position:fixed;bottom:1.25rem;right:1.25rem;z-index:99999;display:flex;flex-direction:column;gap:0.5rem;pointer-events:none;max-width:320px;width:calc(100vw - 2.5rem);">
    ${msgToasts.map(t => {
      const elapsedS = (now - t.createdAt) / 1000;
      const remainingS = Math.max(0.1, 6 - elapsedS);
      const isNew = elapsedS < 0.4;
      return `
      <div class="msg-toast" onclick="window.openMsgToast('${t.roomId}','${t.roomName.replace(/'/g,"\\'")}','${t.roomType}','${t.id}')" style="pointer-events:all;${isNew ? '' : 'animation:none;'}">
        <div class="msg-toast-avatar">${(t.senderName||'?')[0].toUpperCase()}</div>
        <div class="msg-toast-body">
          ${t.isDM ? '' : `<div style="font-size:0.65rem;color:rgba(255,255,255,0.65);margin-bottom:0.15rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"># ${t.roomName}</div>`}
          <div class="msg-toast-sender">${t.senderName}</div>
          <div class="msg-toast-text">${t.preview}</div>
        </div>
        <button class="msg-toast-close" onclick="event.stopPropagation();window.dismissMsgToast('${t.id}')">×</button>
        <div class="msg-toast-bar" style="animation-duration:${remainingS.toFixed(1)}s;"></div>
      </div>`;
    }).join('')}
  </div>`;
}

window.openMsgToast = function(roomId, roomName, roomType, toastId) {
  window.dismissMsgToast(toastId);
  window.setView('messenger');
  if (roomType === 'dm') {
    const otherIc = roomId.replace('dm_','').split('__').find(ic => ic !== (user ? user.ic : ''));
    if (otherIc) {
      const s = staffList.find(st => st.ic === otherIc);
      window.openDM(otherIc, s ? s.name : roomName);
    }
  } else {
    window.openRoom(roomId, roomName, roomType);
  }
};

window.dismissMsgToast = function(id) {
  const t = msgToasts.find(x => x.id === id);
  if (t && t.timer) clearTimeout(t.timer);
  msgToasts = msgToasts.filter(x => x.id !== id);
  render();
};

// The set of room ids THIS user may access: public group rooms + a DM room with
// every other active staff. Firestore rules authorise these by roomId, and we
// query them by documentId() so no global read of other people's DMs happens.
const MSG_ROLE_ROOM_IDS = ['role_doktor','role_admin_staff','role_operation_staff','role_management','role_hod','role_supervisor'];
function myMessengerRoomIds() {
  const ids = ['all_ksb', ...MSG_ROLE_ROOM_IDS];
  branches.forEach(b => ids.push(safeBranchId(b.name)));
  staffList
    .filter(s => s.ic !== user.ic && !s.inactive && s.role !== 'super_admin')
    .forEach(s => ids.push(getDMRoomId(user.ic, s.ic)));
  return [...new Set(ids)];
}

window.initMessengerRooms = function() {
  messengerRoomsInitialLoad = true;
  if (messengerRoomsUnsub) { messengerRoomsUnsub(); messengerRoomsUnsub = null; }
  if (!user) return;

  // Listen ONLY to rooms I can access, by document id (chunked — Firestore 'in'
  // allows max 30 ids per query). New-message toasts are derived from these room
  // metadata changes, so there is no global message query at all.
  const ids = myMessengerRoomIds();
  const chunks = [];
  for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));
  const caches = chunks.map(() => ({}));
  const seenTs = {};       // roomId -> last lastTimestamp we've toasted on
  let baselined = false;   // skip toasts on the very first snapshot batch

  const rebuild = () => {
    messengerRoomLastMsg = {};
    caches.forEach(c => Object.values(c).forEach(data => { messengerRoomLastMsg[data.id] = data; }));
    Object.values(messengerRoomLastMsg).forEach(data => {
      const lastSeen = parseInt(localStorage.getItem(`msg_seen_${user.ic}_${data.id}`) || '0');
      if (data.lastTimestamp && data.lastTimestamp > lastSeen && data.lastSenderIC !== user.ic) {
        messengerUnreadRooms.add(data.id);
      } else {
        messengerUnreadRooms.delete(data.id);
      }
    });
    messengerRoomsInitialLoad = false;
    render();
  };

  const fireToasts = () => {
    Object.values(messengerRoomLastMsg).forEach(data => {
      const rid = data.id;
      if (!data.lastTimestamp) return;
      const prev = seenTs[rid] || 0;
      if (baselined && data.lastTimestamp > prev && data.lastSenderIC && data.lastSenderIC !== user.ic) {
        const roomType = data.type || (rid.startsWith('dm_') ? 'dm' : 'group');
        const roomName = roomType === 'dm' ? (data.lastSenderName || 'Mesej') : (data.name || data.lastSenderName || '');
        const text = data.lastMessage || '📎 Mesej';
        playMsgSound();
        showMsgToast(rid, roomName, roomType, data.lastSenderName || '', text);
        showBrowserNotif(data.lastSenderName || '', roomName, text, rid, roomType);
      }
      seenTs[rid] = Math.max(prev, data.lastTimestamp || 0);
    });
    baselined = true;
  };

  const unsubs = chunks.map((chunk, idx) => onSnapshot(
    query(collection(db, 'messenger_rooms'), where(documentId(), 'in', chunk)),
    snap => {
      caches[idx] = {};
      snap.docs.forEach(d => { caches[idx][d.id] = { id: d.id, ...d.data() }; });
      rebuild();
      fireToasts();
    },
    e => console.warn('Rooms chunk listener:', e)
  ));
  messengerRoomsUnsub = () => unsubs.forEach(u => u());
};

window.openRoom = function(roomId, roomName, type) {
  if (messengerMsgUnsub) { messengerMsgUnsub(); messengerMsgUnsub = null; }
  messengerRoomId = roomId;
  messengerRoomName = roomName;
  messengerRoomType = type || 'group';
  messengerMessages = [];
  messengerView = 'chat';
  messengerFileObj = null;

  localStorage.setItem(`msg_seen_${user.ic}_${roomId}`, Date.now().toString());
  messengerUnreadRooms.delete(roomId);

  const roomRef = doc(db, 'messenger_rooms', roomId);
  getDoc(roomRef).then(snap => {
    if (!snap.exists()) {
      setDoc(roomRef, { id: roomId, name: roomName, type: messengerRoomType, lastMessage: '', lastTimestamp: 0, lastSenderName: '', lastSenderIC: '' });
    }
  });

  const q = query(collection(db, 'messenger_messages'), where('roomId', '==', roomId));
  messengerMsgUnsub = onSnapshot(q, (snap) => {
    messengerMessages = snap.docs.map(d => d.data()).sort((a, b) => a.timestamp - b.timestamp);
    localStorage.setItem(`msg_seen_${user.ic}_${roomId}`, Date.now().toString());
    messengerUnreadRooms.delete(roomId);
    if (view === 'messenger') {
      render();
      requestAnimationFrame(() => {
        const area = document.getElementById('msg-chat-area');
        if (area) area.scrollTop = area.scrollHeight;
      });
    }
  });

  render();
  requestAnimationFrame(() => {
    const area = document.getElementById('msg-chat-area');
    if (area) area.scrollTop = area.scrollHeight;
    const inp = document.getElementById('msg-text-input');
    if (inp) inp.focus();
  });
};

window.openDM = function(targetIC, targetName) {
  window.openRoom(getDMRoomId(user.ic, targetIC), targetName, 'dm');
};

window.backToRooms = function() {
  messengerView = 'rooms';
  render();
};

window.handleMessengerFile = function(input) {
  if (!input.files || !input.files[0]) return;
  const file = input.files[0];
  if (file.size > 10 * 1024 * 1024) {
    alert('Saiz fail terlalu besar. Had maksimum: 10MB');
    input.value = '';
    return;
  }
  messengerFileObj = { file, name: file.name, type: file.type, size: file.size };
  render();
};

window.cancelMessengerFile = function() {
  messengerFileObj = null;
  const inp = document.getElementById('msg-file-input');
  if (inp) inp.value = '';
  render();
};

window.sendMessage = async function(e) {
  if (e) e.preventDefault();
  if (messengerSending) return;
  const textEl = document.getElementById('msg-text-input');
  const text = (textEl ? textEl.value : '').trim();
  if (!text && !messengerFileObj) return;
  if (!messengerRoomId) return;

  messengerSending = true;
  render();

  try {
    let fileUrl = null, fileName = null, fileType = null, fileSize = null;
    if (messengerFileObj) {
      // Lampiran messenger ke Cloudinary (Firebase Storage tidak diaktifkan — perlu Blaze).
      // `auto` kesan sendiri gambar / PDF / fail lain (raw spt doc/xls). secure_url disimpan
      // pada mesej dan dibuka melalui pautan fail dalam chat.
      const _mfd = new FormData();
      _mfd.append('file', messengerFileObj.file);
      _mfd.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
      _mfd.append('folder', `messenger/${messengerRoomId}`);
      const _mresp = await fetch(
        `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/auto/upload`,
        { method: 'POST', body: _mfd }
      );
      const _mdata = await _mresp.json().catch(() => ({}));
      if (!_mresp.ok || !_mdata.secure_url) {
        throw new Error((_mdata.error && _mdata.error.message) || ('Cloudinary HTTP ' + _mresp.status));
      }
      fileUrl = _mdata.secure_url;
      fileName = messengerFileObj.name;
      fileType = messengerFileObj.type;
      fileSize = messengerFileObj.size;
    }
    const msgId = Date.now().toString() + '_' + Math.random().toString(36).substr(2, 6);
    await setDoc(doc(db, 'messenger_messages', msgId), {
      roomId: messengerRoomId, id: msgId,
      senderIC: user.ic, senderName: user.name, senderBranch: user.branch || '',
      text: text || '', fileUrl: fileUrl || null, fileName: fileName || null,
      fileType: fileType || null, fileSize: fileSize || null, timestamp: Date.now()
    });
    await setDoc(doc(db, 'messenger_rooms', messengerRoomId), {
      id: messengerRoomId, name: messengerRoomName, type: messengerRoomType,
      lastMessage: fileUrl ? `📎 ${fileName}` : text,
      lastTimestamp: Date.now(), lastSenderName: user.name, lastSenderIC: user.ic
    }, { merge: true });
    messengerFileObj = null;
    const fi = document.getElementById('msg-file-input');
    if (fi) fi.value = '';
    if (textEl) textEl.value = '';
  } catch(err) {
    console.error('Send message failed:', err);
    alert('Gagal menghantar mesej. Sila cuba lagi.');
  }
  messengerSending = false;
};

window.deleteMessage = async function(msgId) {
  if (!confirm('Padam mesej ini?')) return;
  try { await deleteDoc(doc(db, 'messenger_messages', msgId)); }
  catch(err) { alert('Gagal memadam mesej.'); }
};

window.filterMsgStaff = function(q) {
  const query = (q || '').toLowerCase().trim();
  document.querySelectorAll('#msg-staff-list .msg-room-item').forEach(item => {
    const name = item.dataset.staffName || '';
    item.style.display = (!query || name.includes(query)) ? '' : 'none';
  });
};

function formatMsgTime(ts) {
  if (!ts) return '';
  const d = new Date(ts), now = new Date();
  const diffDays = Math.floor((now - d) / 86400000);
  const time = d.toLocaleTimeString('ms-MY', { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 0) return time;
  if (diffDays === 1) return 'Semalam ' + time;
  return d.toLocaleDateString('ms-MY', { day: '2-digit', month: 'short' }) + ' ' + time;
}

function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function getFileIcon(fileType, fileName) {
  const t = (fileType || '').toLowerCase(), n = (fileName || '').toLowerCase();
  if (t.startsWith('image/')) return '🖼️';
  if (t === 'application/pdf' || n.endsWith('.pdf')) return '📄';
  if (t.includes('word') || n.endsWith('.doc') || n.endsWith('.docx')) return '📝';
  if (t.includes('excel') || t.includes('spreadsheet') || n.endsWith('.xls') || n.endsWith('.xlsx')) return '📊';
  if (t.startsWith('video/')) return '🎥';
  if (t.startsWith('audio/')) return '🎵';
  return '📎';
}

function escapeHtml(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderMessageBubble(msg) {
  const isOwn = msg.senderIC === user.ic;
  const isImage = msg.fileType && msg.fileType.startsWith('image/');
  return `
    <div class="msg-bubble-row ${isOwn ? 'own' : 'other'}">
      ${!isOwn ? `<div class="msg-avatar">${(msg.senderName || '?')[0]}</div>` : ''}
      <div class="msg-bubble-wrap">
        ${!isOwn && messengerRoomType !== 'dm' ? `<div class="msg-sender-name">${msg.senderName}${msg.senderBranch ? ` · <span style="color:var(--text-muted);font-size:0.7rem;">${msg.senderBranch}</span>` : ''}</div>` : ''}
        <div class="msg-bubble ${isOwn ? 'own' : 'other'}">
          ${msg.text ? `<div class="msg-text">${escapeHtml(applyEmoticons(msg.text))}</div>` : ''}
          ${msg.fileUrl ? (isImage ?
            `<a href="${msg.fileUrl}" target="_blank" rel="noopener"><img src="${msg.fileUrl}" class="msg-img" alt="${msg.fileName || 'image'}" loading="lazy"></a>` :
            `<a href="${msg.fileUrl}" target="_blank" rel="noopener" class="msg-file-link">
              <span class="msg-file-icon">${getFileIcon(msg.fileType, msg.fileName)}</span>
              <div class="msg-file-info">
                <div class="msg-file-name">${msg.fileName || 'Fail'}</div>
                <div class="msg-file-size">${formatFileSize(msg.fileSize)} · Tekan untuk muat turun</div>
              </div>
            </a>`) : ''}
        </div>
        <div class="msg-time ${isOwn ? 'own' : ''}">
          ${formatMsgTime(msg.timestamp)}
          ${isOwn ? `<button class="msg-delete-btn" onclick="window.deleteMessage('${msg.id}')" title="Padam">×</button>` : ''}
        </div>
      </div>
      ${isOwn ? `<div class="msg-avatar own">${(user.name || '?')[0]}</div>` : ''}
    </div>`;
}

function getRoomSubtitle(type) {
  if (type === 'dm') return 'Mesej Peribadi';
  if (type === 'branch') return 'Kumpulan Cawangan';
  if (type === 'role') return 'Kumpulan Peranan';
  return 'Kumpulan Semua Staf';
}

function getRoomHeaderIcon(type, name) {
  if (type === 'group') return '🏥';
  if (type === 'branch') return '🏢';
  if (type === 'role') return '👥';
  return (name || '?')[0];
}

function renderRoomItem(room) {
  const last = messengerRoomLastMsg[room.id] || {};
  const isUnread = messengerUnreadRooms.has(room.id);
  const isActive = messengerRoomId === room.id;
  const preview = last.lastMessage ? `${last.lastSenderName || ''}: ${last.lastMessage}` : room.subtitle;
  return `
  <div class="msg-room-item ${isActive ? 'active' : ''}" onclick="window.openRoom('${room.id}','${room.name.replace(/'/g,"\\'")}','${room.type}')">
    <div class="msg-room-icon-circle" style="${room.iconBg || 'background:linear-gradient(135deg,var(--primary),var(--secondary));'}">${room.icon}</div>
    <div class="msg-room-info">
      <div class="msg-room-name">${room.name}${isUnread ? '<span class="msg-unread-dot"></span>' : ''}</div>
      <div class="msg-room-last">${preview}</div>
    </div>
    ${last.lastTimestamp ? `<div class="msg-room-time">${formatMsgTime(last.lastTimestamp)}</div>` : ''}
  </div>`;
}

// Short, human role label for the buddy list secondary line (avoids repeating
// the full branch name on every row).
function shortRoleLabel(role) {
  const map = {
    staff: 'Staf', doctor: 'Doktor', doctor_pic: 'Doktor',
    hod_cawangan: 'HOD', hod_balok: 'HOD', supervisor: 'Supervisor',
    team_leader: 'Ketua Pasukan', juru_xray: 'Juru X-Ray',
    sonographer: 'Sonografer', juru_audio: 'Juru Audio',
    admin: 'Admin', hr: 'HR', super_admin: 'Super Admin',
  };
  if (map[role]) return map[role];
  return (role || 'Staf').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// Clickable accordion header for a messenger rooms section. `count` optional.
// `accent` colours the count badge (defaults to muted). Chevron points down
// when open, right when collapsed.
function msgSectionHeader(key, label, count, accent) {
  const open = isMsgSectionOpen(msgSections, key);
  const badge = (count !== undefined && count !== null)
    ? `<span class="msg-section-count" ${accent ? `style="background:${accent.bg};color:${accent.fg};"` : ''}>${count}</span>`
    : '';
  return `<button type="button" class="msg-section-toggle" aria-expanded="${open}" onclick="window.toggleMsgSection('${key}')">
    <svg class="msg-section-chev${open ? ' open' : ''}" id="msg-section-chev-${key}" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="6 9 12 15 18 9"></polyline></svg>
    <span class="msg-section-toggle-label">${label}</span>${badge}
  </button>`;
}

// Toggle a section open/closed without a full re-render (keeps search box focus
// & scroll position), then persist the new state.
window.toggleMsgSection = function(key) {
  msgSections = toggleSection(msgSections, key);
  saveSectionState(localStorage, msgSections);
  const open = isMsgSectionOpen(msgSections, key);
  const body = document.getElementById('msg-section-body-' + key);
  const chev = document.getElementById('msg-section-chev-' + key);
  if (body) body.style.display = open ? '' : 'none';
  if (chev) {
    chev.classList.toggle('open', open);
    const btn = chev.closest('.msg-section-toggle');
    if (btn) btn.setAttribute('aria-expanded', String(open));
  }
};

function renderMessengerView() {
  // Safety: if no room is open, always show rooms list
  if (!messengerRoomId) messengerView = 'rooms';

  const myMeta = getStatusMeta(myStatus);

  const otherStaff = staffList.filter(s => s.ic !== user.ic && !s.inactive && s.role !== 'super_admin')
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  const branchRooms = branches.map(b => ({
    id: safeBranchId(b.name),
    name: b.name,
    type: 'branch',
    icon: '🏢',
    iconBg: 'background:linear-gradient(135deg,#0891b2,#0e7490);',
    subtitle: b.state || 'Cawangan'
  }));

  const roleRooms = [
    { id: 'role_doktor',          name: 'Semua Doktor',      type: 'role', icon: '👨‍⚕️', iconBg: 'background:linear-gradient(135deg,#059669,#047857);', subtitle: 'Kumpulan Doktor KSB' },
    { id: 'role_admin_staff',     name: 'Staff Admin',       type: 'role', icon: '💼',   iconBg: 'background:linear-gradient(135deg,#7c3aed,#6d28d9);', subtitle: 'Kumpulan Staff Admin' },
    { id: 'role_operation_staff', name: 'Staff Operasi',     type: 'role', icon: '⚙️',   iconBg: 'background:linear-gradient(135deg,#d97706,#b45309);', subtitle: 'Kumpulan Staff Operasi' },
    { id: 'role_management',      name: 'Management',        type: 'role', icon: '👑',   iconBg: 'background:linear-gradient(135deg,#dc2626,#b91c1c);', subtitle: 'Admin, HR & Super Admin' },
    { id: 'role_hod',             name: 'HOD & PIC HOD',     type: 'role', icon: '🏅',   iconBg: 'background:linear-gradient(135deg,#4361ee,#3451d1);', subtitle: 'Head of Department' },
    { id: 'role_supervisor',      name: 'Supervisor',        type: 'role', icon: '👔',   iconBg: 'background:linear-gradient(135deg,#0891b2,#0e7490);', subtitle: 'Kumpulan Supervisor' },
  ];

  return `
  <div class="messenger-layout">
    <!-- Rooms panel -->
    <div class="msg-rooms-panel ${messengerView === 'chat' ? 'msg-hide-mobile' : ''}">
      <div class="msg-rooms-header">
        <h2 style="font-size:1.2rem;display:flex;align-items:center;gap:0.5rem;margin:0 0 0.6rem 0;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
          Messenger
        </h2>

        <!-- My status (Yahoo Messenger style) -->
        <div class="msg-mystatus">
          <div class="msg-mystatus-avatar">
            ${(user.name || '?')[0]}
            <span class="msg-status-dot" style="background:${myMeta.color};"></span>
          </div>
          <div class="msg-mystatus-info">
            <div class="msg-mystatus-name">${user.name}</div>
            <select class="msg-mystatus-select" title="Tukar status" style="color:${myMeta.color};background-color:${myMeta.color}1a;" onchange="window.setMyStatus(this.value)">
              ${PRESENCE_STATUSES.map(s => `<option value="${s.id}" ${s.id === myStatus ? 'selected' : ''}>${s.dot} ${s.label}</option>`).join('')}
            </select>
            <input class="msg-mystatus-mood" type="text" maxlength="60"
              value="${(myStatusMsg || '').replace(/"/g,'&quot;')}"
              placeholder="✎ Set mesej status…"
              onchange="window.setMyMood(this.value)"
              onkeydown="if(event.key==='Enter')this.blur();">
          </div>
        </div>

        ${(function() {
          const onlineOthers = Object.values(onlineUsers).filter(u => u.ic !== user.ic && u.role !== 'super_admin');
          if (onlineOthers.length === 0) return '';
          const onlineOpen = isMsgSectionOpen(msgSections, 'online');
          return `<div class="msg-online-chips-bar">
            <button type="button" class="msg-section-toggle msg-section-toggle-online" aria-expanded="${onlineOpen}" onclick="window.toggleMsgSection('online')">
              <svg class="msg-section-chev${onlineOpen ? ' open' : ''}" id="msg-section-chev-online" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="3"><polyline points="6 9 12 15 18 9"></polyline></svg>
              <span class="msg-online-pulse"></span>
              <span style="font-size:0.72rem;font-weight:800;text-transform:uppercase;letter-spacing:0.8px;color:#16a34a;">Sedang Aktif</span>
              <span style="font-size:0.65rem;color:#16a34a;background:rgba(34,197,94,0.1);padding:0.05rem 0.4rem;border-radius:10px;font-weight:700;">${onlineOthers.length}</span>
            </button>
            <div class="msg-online-chips-scroll" id="msg-section-body-online" style="${onlineOpen ? '' : 'display:none;'}">
              ${onlineOthers.map(u => {
                const firstName = (u.name || '?').split(' ')[0];
                const cm = resolveStatus(u);
                return `<button class="msg-online-chip" onclick="window.openDM('${u.ic}','${(u.name||'').replace(/'/g,"\\'")}');event.stopPropagation();" title="${(u.name||'').replace(/"/g,'&quot;')} — ${cm.label}${u.statusMsg ? ': ' + u.statusMsg.replace(/"/g,'&quot;') : ''}"><span style="width:7px;height:7px;border-radius:50%;background:${cm.color};flex-shrink:0;display:inline-block;"></span>${firstName}</button>`;
              }).join('')}
            </div>
          </div>`;
        })()}
      </div>

      <div class="msg-rooms-scroll">
        <!-- Global -->
        <div class="msg-section-static"><span class="msg-section-chev-spacer"></span><span class="msg-section-toggle-label">Umum</span></div>
        ${renderRoomItem({ id: 'all_ksb', name: 'Semua Staf KSB', type: 'group', icon: '🏥', iconBg: 'background:linear-gradient(135deg,var(--primary),var(--secondary));', subtitle: 'Semua kakitangan KSB' })}

        <!-- By Branch -->
        ${msgSectionHeader('branch', 'Mengikut Cawangan', branchRooms.length, { bg: 'rgba(67,97,238,0.12)', fg: 'var(--primary)' })}
        <div id="msg-section-body-branch" style="${isMsgSectionOpen(msgSections, 'branch') ? '' : 'display:none;'}">
          ${branchRooms.map(renderRoomItem).join('')}
        </div>

        <!-- By Role -->
        ${msgSectionHeader('role', 'Mengikut Peranan', roleRooms.length, { bg: 'rgba(124,58,237,0.12)', fg: 'var(--secondary)' })}
        <div id="msg-section-body-role" style="${isMsgSectionOpen(msgSections, 'role') ? '' : 'display:none;'}">
          ${roleRooms.map(renderRoomItem).join('')}
        </div>

        <!-- Direct Messages -->
        ${msgSectionHeader('dm', 'Mesej Terus')}
        <div id="msg-section-body-dm" style="${isMsgSectionOpen(msgSections, 'dm') ? '' : 'display:none;'}">
        <div style="position:relative;margin:0 0.75rem 0.5rem;">
          <input type="text" placeholder="Cari staf..." id="msg-staff-search"
            oninput="window.filterMsgStaff(this.value)"
            style="width:100%;padding:0.6rem 0.75rem 0.6rem 2.1rem;border-radius:10px;border:none;background:rgba(163,177,198,0.15);box-shadow:var(--shadow-inset-sm);font-size:0.85rem;color:var(--text);outline:none;font-family:inherit;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2" style="position:absolute;left:0.55rem;top:50%;transform:translateY(-50%);pointer-events:none;"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
        </div>
        <div id="msg-staff-list">
          ${otherStaff.map(s => {
            const dmId = getDMRoomId(user.ic, s.ic);
            const last = messengerRoomLastMsg[dmId] || {};
            const isUnread = messengerUnreadRooms.has(dmId);
            const isActive = messengerRoomId === dmId;
            const pres = onlineUsers[s.ic];
            const isOnline = !!pres;
            const sm = isOnline ? resolveStatus(pres) : null;
            // Buddy-list status line (YM): online → status label / mood; offline → last msg or short role.
            // Branch is intentionally NOT shown here (it repeats for everyone in the same clinic).
            const statusLine = isOnline
              ? `<span style="color:${sm.color};font-weight:600;">${sm.dot} ${pres.statusMsg ? pres.statusMsg : sm.label}</span>`
              : (last.lastMessage || shortRoleLabel(s.role));
            return `
            <div class="msg-room-item ${isActive ? 'active' : ''} ${isOnline ? '' : 'msg-room-offline'}" data-staff-name="${(s.name||'').toLowerCase()}" onclick="window.openDM('${s.ic}','${s.name.replace(/'/g,"\\'")}')">
              <div style="position:relative;flex-shrink:0;">
                <div class="msg-room-avatar">${(s.name||'?')[0]}</div>
                ${isOnline ? `<span class="msg-online-dot" style="background:${sm.color};box-shadow:0 0 0 1px ${sm.color}55;"></span>` : ''}
              </div>
              <div class="msg-room-info">
                <div class="msg-room-name">${s.name}${isUnread ? '<span class="msg-unread-dot"></span>' : ''}</div>
                <div class="msg-room-last">${statusLine}</div>
              </div>
              ${last.lastTimestamp ? `<div class="msg-room-time">${formatMsgTime(last.lastTimestamp)}</div>` : ''}
            </div>`;
          }).join('')}
        </div>
        </div><!-- /msg-section-body-dm -->
      </div>
    </div>

    <!-- Chat panel -->
    <div class="msg-chat-panel ${messengerView === 'rooms' ? 'msg-hide-mobile' : ''}">
      ${messengerRoomId ? `
        <div class="msg-chat-header">
          <button class="msg-back-btn" onclick="window.backToRooms()">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"></polyline></svg>
          </button>
          <div style="position:relative;flex-shrink:0;">
            <div style="width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,var(--primary),var(--secondary));display:flex;align-items:center;justify-content:center;font-size:1rem;font-weight:700;color:white;">
              ${getRoomHeaderIcon(messengerRoomType, messengerRoomName)}
            </div>
            ${(function() {
              if (messengerRoomType !== 'dm') return '';
              const dmOtherIc = messengerRoomId.replace('dm_','').split('__').find(ic => ic !== user.ic);
              const p = dmOtherIc && onlineUsers[dmOtherIc];
              if (!p) return '';
              const cm = resolveStatus(p);
              return `<span class="msg-online-dot" style="width:13px;height:13px;bottom:0;right:0;background:${cm.color};box-shadow:0 0 0 1px ${cm.color}55;"></span>`;
            })()}
          </div>
          <div>
            <div class="msg-chat-title">${messengerRoomName}</div>
            <div class="msg-chat-subtitle">
              ${(function() {
                if (messengerRoomType === 'dm') {
                  const dmOtherIc = messengerRoomId.replace('dm_','').split('__').find(ic => ic !== user.ic);
                  const p = dmOtherIc && onlineUsers[dmOtherIc];
                  if (p) {
                    const cm = resolveStatus(p);
                    const mood = p.statusMsg ? ` · ${escapeHtml(p.statusMsg)}` : '';
                    return `<span style="color:${cm.color};font-weight:600;font-size:0.75rem;">${cm.dot} ${cm.label}${mood}</span>`;
                  }
                }
                return getRoomSubtitle(messengerRoomType);
              })()}
            </div>
          </div>
        </div>

        <div class="msg-chat-area" id="msg-chat-area">
          ${messengerMessages.length === 0 ? `
            <div style="text-align:center;padding:3rem 1rem;color:var(--text-muted);">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" style="opacity:0.25;margin-bottom:1rem;display:block;margin-left:auto;margin-right:auto;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
              <div style="font-size:0.9rem;">Belum ada mesej. Mulakan perbualan!</div>
            </div>
          ` : messengerMessages.map(renderMessageBubble).join('')}
        </div>

        ${messengerFileObj ? `
          <div class="msg-file-preview">
            <span style="font-size:1.4rem;">${getFileIcon(messengerFileObj.type, messengerFileObj.name)}</span>
            <div style="flex:1;min-width:0;">
              <div style="font-size:0.85rem;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${messengerFileObj.name}</div>
              <div style="font-size:0.72rem;color:var(--text-muted);">${formatFileSize(messengerFileObj.size)}</div>
            </div>
            <button onclick="window.cancelMessengerFile()" style="background:rgba(220,38,38,0.1);border:none;color:var(--danger);width:26px;height:26px;border-radius:50%;cursor:pointer;font-size:1.1rem;display:flex;align-items:center;justify-content:center;flex-shrink:0;line-height:1;">×</button>
          </div>
        ` : ''}

        <form class="msg-input-area" onsubmit="window.sendMessage(event)">
          <label class="msg-file-btn" for="msg-file-input" title="Lampirkan fail (maks 10MB)">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
            <input type="file" id="msg-file-input" style="display:none;"
              accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv"
              onchange="window.handleMessengerFile(this)">
          </label>
          <input type="text" id="msg-text-input" class="msg-text-field"
            placeholder="Tulis mesej..." autocomplete="off"
            ${messengerSending ? 'disabled' : ''}>
          <button type="submit" class="msg-send-btn" ${messengerSending ? 'disabled' : ''}>
            ${messengerSending ?
              `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:msgSpin 0.8s linear infinite;"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>` :
              `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>`}
          </button>
        </form>
      ` : `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;padding:3rem;text-align:center;color:var(--text-muted);">
          <svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="0.8" style="opacity:0.15;margin-bottom:1.5rem;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
          <h3 style="font-size:1.1rem;color:var(--text-soft);margin-bottom:0.5rem;font-family:'Outfit',sans-serif;">Pilih perbualan</h3>
          <p style="font-size:0.85rem;max-width:260px;line-height:1.6;">Pilih kumpulan atau staf dari senarai untuk mula menghantar mesej</p>
        </div>
      `}
    </div>
  </div>`;
}

function renderDashboard() {
  app.innerHTML = `
    <!-- Sesi berganda kini dikendali oleh auto-logout (handleDuplicateSessionKick), bukan banner. -->
    <!-- Floating Action Menu - V1.6.8 Stable Fix -->
    <div class="fab-menu ${mobileMenuOpen ? 'active' : ''}">
      <button class="fab-main" onclick="window.toggleMobileMenu()">
        <i data-lucide="menu" width="24" height="24" style="color:#fff;"></i>
      </button>
      <div class="fab-items">
        ${(() => {
          const rKey = window.rbacMatrix[user.role] ? user.role : 'staff';
          const rbac = window.rbacMatrix[rKey] || window.rbacMatrix.staff || {};
          return `
            ${rbac.dashboard ? `<div class="fab-item" onclick="window.setView('dashboard'); window.toggleMobileMenu(false)">Dashboard</div>` : ''}
            ${rbac.leave_request ? `<div class="fab-item" onclick="window.setView('leave-form'); window.toggleMobileMenu(false)">Borang Cuti</div>` : ''}
            ${rbac.management || rbac.manage_pending ? `<div class="fab-item" onclick="window.setView('management'); window.toggleMobileMenu(false)">Management</div>` : ''}
            ${rbac.messenger !== false ? `<div class="fab-item" onclick="window.setView('messenger'); window.toggleMobileMenu(false)">Messenger${messengerUnreadRooms.size > 0 ? ' 🔴' : ''}</div>` : ''}
            ${rbac.inbox ? `<div class="fab-item" onclick="window.setView('inbox'); window.toggleMobileMenu(false)">Inbox${inboxNotifs.filter(n=>!n.read).length > 0 ? ' 🔴' : ''}</div>` : ''}
            <div class="fab-item" onclick="window.setView('settings'); window.toggleMobileMenu(false)">Settings</div>
            <div class="fab-item logout" onclick="window.logout()">Log Keluar</div>
          `;
        })()}
      </div>
    </div>

    <div class="dashboard-layout fade-in">
      <header class="app-topbar">
        <img src="${logos.ksb}" alt="Logo KSB" class="app-topbar-logo">
        <div class="app-topbar-titles">
          <span class="app-topbar-company">KLINIK SYED BADARUDDIN SDN. BHD.</span>
          <span class="app-topbar-system">Sistem Permohonan Cuti &amp; Rekod Pekerja</span>
        </div>
        <span class="app-topbar-version">v2.0.0</span>
      </header>
      <aside class="sidebar">
        <nav class="nav-menu">
          ${(() => {
            const rKey = window.rbacMatrix[user.role] ? user.role : 'staff';
            const dashboardRbac = window.rbacMatrix[rKey];
            return `
              ${dashboardRbac.dashboard ? `<div class="nav-item ${view === 'dashboard' ? 'active' : ''}" onclick="window.setView('dashboard')"><i data-lucide="layout-dashboard" width="18" height="18"></i> Dashboard</div>` : ''}
              ${dashboardRbac.leave_request ? `<div class="nav-item ${view === 'leave-form' ? 'active' : ''}" onclick="window.setView('leave-form')"><i data-lucide="calendar-plus" width="18" height="18"></i> Borang Cuti</div>` : ''}
              ${(dashboardRbac.management || dashboardRbac.manage_pending || dashboardRbac.manage_staff || dashboardRbac.manage_branches || dashboardRbac.manage_audit || dashboardRbac.manage_login_audit || dashboardRbac.manage_reports || dashboardRbac.manage_access) ? `<div class="nav-item ${view === 'management' ? 'active' : ''}" onclick="window.setView('management')"><i data-lucide="shield-check" width="18" height="18"></i> Management</div>` : ''}
              ${dashboardRbac.messenger !== false ? `<div class="nav-item ${view === 'messenger' ? 'active' : ''}" onclick="window.setView('messenger')" style="position:relative;"><i data-lucide="message-circle" width="18" height="18"></i> Messenger${messengerUnreadRooms.size > 0 ? `<span style="position:absolute;top:4px;right:6px;min-width:16px;height:16px;padding:0 3px;border-radius:999px;background:var(--danger);color:#fff;font-size:0.6rem;font-weight:800;display:flex;align-items:center;justify-content:center;line-height:1;">${messengerUnreadRooms.size}</span>` : ''}</div>` : ''}
              ${dashboardRbac.inbox ? (() => { const inboxUnread = inboxNotifs.filter(n => !n.read).length; return `<div class="nav-item ${view === 'inbox' ? 'active' : ''}" onclick="window.setView('inbox')" style="position:relative;"><i data-lucide="inbox" width="18" height="18"></i> Inbox${inboxUnread > 0 ? `<span style="position:absolute;top:4px;right:6px;min-width:16px;height:16px;padding:0 3px;border-radius:999px;background:var(--danger);color:#fff;font-size:0.6rem;font-weight:800;display:flex;align-items:center;justify-content:center;line-height:1;">${inboxUnread}</span>` : ''}</div>`; })() : ''}
              ${dashboardRbac.policy ? `<div class="nav-item ${view === 'policy' ? 'active' : ''}" onclick="window.setView('policy')"><i data-lucide="book-open" width="18" height="18"></i> Polisi</div>` : ''}
              ${dashboardRbac.settings ? `<div class="nav-item ${view === 'settings' ? 'active' : ''}" onclick="window.setView('settings')"><i data-lucide="settings-2" width="18" height="18"></i> Tetapan</div>` : ''}
            `;
          })()}
        </nav>
        <div class="sidebar-footer">
          <div class="user-pill glass-card">
            <div class="user-avatar">${(user.name || '?')[0]}</div>
            <div class="user-info">
              <div class="user-name">${user.name}</div>
              <div class="user-role">${(user.role || '').toUpperCase()}</div>
            </div>
          </div>
          <button id="logout" class="btn-logout">Logout</button>
          <p style="font-size:0.68rem;color:var(--text-muted);text-align:center;margin:0.85rem 0 0;letter-spacing:0.3px;">© 2026 Hak Cipta Terpelihara<br>KSBSB IT @ LukhzzIsZa</p>
        </div>
      </aside>

      <main class="content-area">
        ${renderView()}
      </main>
    </div>
    ${renderModal()}
    ${renderLeaveModal()}
    ${renderSelfProfileModal()}
    ${renderAddStaffModal()}
    ${renderFirstLoginModal()}
    ${renderPhoneReminderModal()}
    ${renderActiveToasts()}
  `;

  // Logout Listener
  document.querySelector('#logout')?.addEventListener('click', window.logout);

  // Handle Leave Submission with Validation
  const leaveForm = document.querySelector('#leave-request-form');
  if (leaveForm) {
    leaveForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const leaveTypeName = leaveCategories.find(c => c.id === selectedLeaveType)?.name || selectedLeaveType;
      const startDate = leaveStartDate;
      const endDate = leaveEndDate;
      const reason = leaveForm.querySelector('textarea').value;
      const handover = leaveForm.querySelector('#handover-input')?.value || '';
      
      let diffDays = window.computeLeaveDays(leaveStartDate, leaveEndDate, user);
      if (diffDays <= 0) {
        alert('Tarikh yang dipilih tiada hari bekerja untuk staf pentadbiran. Sila pilih tarikh yang merangkumi hari bekerja (Isnin–Jumaat).');
        return;
      }
      if (applyHalfDay) diffDays -= 0.5;

      let leaveBreakdown = '';
      if (selectedLeaveType === 'AL') {
          // Baki AL sebenar = Formula B (Jumlah − Guna Sebelum − Guna Sistem − Pelarasan HR)
          const currentBal = window.getLeaveStats(user, 'AL').bal;

          if (diffDays > currentBal) {
              const unpaidDays = diffDays - Math.max(0, currentBal);
              const paidDays = diffDays - unpaidDays;
              leaveBreakdown = "\n*SPLIT LEAVE DETECTED*\nEarned AL Used: " + paidDays + " days\nUnpaid Leave (UL): " + unpaidDays + " days\n(Automatic split due to insufficient earned prorate)";
              alert("Notis: Baki prorate (Earned) anda ialah " + currentBal.toFixed(2) + " hari. Permohonan " + diffDays + " hari akan dibahagikan kepada " + paidDays + " hari AL dan " + unpaidDays + " hari Unpaid Leave (UL).");
          }
      }
      
      // Mandatory File Validations
      if (selectedLeaveType === 'MC') {
          const mcUpload = document.getElementById('mc-upload');
          if (!mcUpload || mcUpload.files.length === 0) {
              alert('🔴 WAJIB: Sila muat naik Sijil Sakit (MC) yang dikeluarkan oleh doktor sebelum menghantar permohonan.\n\nFormat yang diterima: Gambar (JPG/PNG) atau PDF.');
              return;
          }
      } else if (selectedLeaveType === 'EL_EMG') {
          const emgUpload = document.getElementById('emg-upload');
          if (!emgUpload || emgUpload.files.length === 0) {
              alert('MAAF, Borang ditolak. Anda WAJIB memuat naik dokumen/gambar bukti bagi permohonan Cuti Kecemasan.');
              return;
          }
      } else if (selectedLeaveType === 'EL') {
          const ehsanUpload = document.getElementById('ehsan-upload');
          if (!ehsanUpload || ehsanUpload.files.length === 0) {
              alert('MAAF, Borang ditolak. Anda WAJIB memuat naik Salinan Sijil Kematian bagi permohonan Cuti Ehsan.');
              return;
          }
      }

      // Tentukan sama ada staff adalah op-balok dengan needs_tl aktif.
      // Guna getStaffGroup (bukan category) supaya juru_audio/juru_xray/sonographer —
      // yang berkategori 'Operation Staff' tetapi ada laluan sendiri (juru_audio_balok dll,
      // needs_tl:false) — TIDAK tersilap diminta sokongan Team Leader.
      const _sbmIsOpBalokTL = window.getStaffGroup(user) === 'operation_balok' &&
          !!(approvalRouting['operation_balok'] || {}).needs_tl;

      // Wajib pilih TL (Peringkat 0) untuk op-balok
      // (MC kini ikut step kelulusan penuh sama seperti AL — tiada lagi laluan terus ke HR)
      const selectedTL = leaveForm.querySelector('#tl-select')?.value;
      if (_sbmIsOpBalokTL && !selectedTL) {
          alert('🔴 WAJIB: Sila pilih Team Leader (Pelulus Peringkat 0) sebelum menghantar permohonan cuti.\n\nPermohonan tidak dapat diproses tanpa sokongan Team Leader.');
          leaveForm.querySelector('#tl-select')?.focus();
          return;
      }

      // Wajib pilih pelulus Peringkat 1 (kecuali op-balok — Supervisor auto, atau jika tiada pelulus langsung — HR luluskan terus)
      const selectedHODCheck = leaveForm.querySelector('#hod-select')?.value;
      const _hasP1Approvers = window.getRoutingP1Approvers(user).length > 0;
      if (!_sbmIsOpBalokTL && _hasP1Approvers && !selectedHODCheck) {
          alert('🔴 WAJIB: Sila pilih Pelulus Peringkat 1 (HOD / PIC_HOD / Supervisor) sebelum menghantar permohonan cuti.\n\nPermohonan tidak dapat diproses tanpa kelulusan Peringkat 1.');
          leaveForm.querySelector('#hod-select')?.focus();
          return;
      }

      const isAdmin = user.category === 'Admin Staff' || user.category === 'Admin' || user.role === 'admin' || user.role === 'super_admin';

      // Cuti tak boleh dirancang (MC sakit, Kecemasan, Ehsan/kematian) + CME dikecualikan dari polisi notis awal (3/7 hari) — tetapi tetap perlu pelulus + bukti.
      const _noticeExempt = ['MC', 'EL_EMG', 'EL', 'CME'].includes(selectedLeaveType);
      if (!_noticeExempt && !validateNotice(startDate, user.category)) {
        const minDays = isAdmin ? 3 : 7;
        alert(`Policy Violation: ${user.category} staff require at least ${minDays} days notice.`);
        return;
      }
      
      // ── Muat naik fail bukti (MC / Kecemasan / Ehsan) ke Cloudinary ──
      // Firebase Storage tidak diaktifkan (perlu Blaze), jadi bukti dimuat naik ke
      // Cloudinary via unsigned upload. `secure_url` disimpan sebagai proofUrl untuk
      // rujukan HR (dilihat semula sebagai "Lihat Bukti" di Master Logs).
      let proofUrl = null, proofName = null;
      const _proofInput = selectedLeaveType === 'MC'     ? document.getElementById('mc-upload')
                        : selectedLeaveType === 'EL_EMG' ? document.getElementById('emg-upload')
                        : selectedLeaveType === 'EL'     ? document.getElementById('ehsan-upload')
                        : null;
      if (_proofInput && _proofInput.files.length > 0) {
        const _proofFile = _proofInput.files[0];
        try {
          const _fd = new FormData();
          _fd.append('file', _proofFile);
          _fd.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
          // Susun ikut IC supaya bukti mudah dikesan di Cloudinary.
          _fd.append('folder', `leave-proofs/${user.ic}`);
          // `auto` = Cloudinary kesan sendiri sama ada gambar (jpg/png) atau PDF.
          const _resp = await fetch(
            `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/auto/upload`,
            { method: 'POST', body: _fd }
          );
          const _data = await _resp.json().catch(() => ({}));
          if (!_resp.ok || !_data.secure_url) {
            throw new Error((_data.error && _data.error.message) || ('Cloudinary HTTP ' + _resp.status));
          }
          proofUrl = _data.secure_url;
          proofName = _proofFile.name;
        } catch (err) {
          console.error('Proof upload failed:', err);
          alert('🔴 Gagal memuat naik fail bukti. Sila cuba lagi atau semak sambungan internet anda.');
          return;
        }
      }

      const copyText = `*LEAVE APPLICATION*${leaveBreakdown}\nStaff Name: ${user.name}\nIC Number: ${user.ic}\nLeave Type: ${leaveTypeName}\nFrom: ${startDate}\nTo: ${endDate}\nHandover To: ${handover}\nReason: ${reason}`;

      // Save to Firestore
      const selectedHOD = leaveForm.querySelector('#hod-select')?.value;
      const newRecord = {
        id: Date.now(),
        name: user.name,
        ic: user.ic,
        branch: user.branch,
        type: selectedLeaveType,
        days: diffDays,
        startDate,
        endDate,
        reason,
        handoverName: handover,
        hodIC: selectedHOD || null,
        tlIC: selectedTL || null,
        // Semua jenis cuti (termasuk MC) bermula PENDING & ikut step kelulusan penuh seperti AL.
        status: 'PENDING',
        // Bukti (MC/Kecemasan/Ehsan) — null untuk jenis cuti lain & rekod lama.
        proofUrl: proofUrl || null,
        proofName: proofName || null
      };

      try {
          await setDoc(doc(db, "leaves", newRecord.id.toString()), newRecord);
          window.logSystemActivity(`Applied for ${leaveTypeName} (${diffDays} days)`);
          window.addNotification(user.ic, 'leave_submitted', '📋 Permohonan Cuti Dihantar', `Permohonan ${leaveTypeName} anda (${startDate} → ${endDate}, ${diffDays} hari) telah berjaya dihantar dan sedang menunggu kelulusan.`, newRecord.id.toString());
      } catch (err) {
          console.error("Error adding leave record: ", err);
          alert("Ralat menghantar permohonan ke pangkalan data.");
          return;
      }

      // WA Peringkat 0/1: notify TL yang dipilih (op-balok) atau approver biasa
      let hodToNotify = [];
      let hodMsg = '';
      if (_sbmIsOpBalokTL) {
        // Op-balok: notify hanya TL yang dipilih oleh staff (bukan semua TL)
        hodToNotify = staffList.filter(s => s.ic === selectedTL && s.phone);
        hodMsg = `📩 *PERMOHONAN CUTI BARU — Peringkat 0 (Sokongan Team Leader)*\n\nPermohonan cuti memerlukan sokongan anda (Team Leader) sebelum dihantar ke Supervisor.\n\n👤 Pemohon: *${user.name}*\n🏥 Cawangan: ${user.branch}\n📝 Jenis Cuti: *${leaveTypeName}*\n📅 Tarikh: ${startDate} → ${endDate}\n⏱ Tempoh: ${diffDays} hari\n💬 Sebab: ${reason}\n\n🔗 *Log masuk untuk meluluskan:* https://apply-leave-89ebb.web.app\n_— KSB Leave System_`;
      } else if (selectedHOD) {
        hodToNotify = staffList.filter(s => s.ic === selectedHOD && s.phone);
        hodMsg = `📩 *PERMOHONAN CUTI BARU — Peringkat 1 (Sokongan HOD)*\n\nPermohonan cuti memerlukan sokongan anda sebelum dihantar ke HR/Admin.\n\n👤 Pemohon: *${user.name}*\n🏥 Cawangan: ${user.branch}\n📝 Jenis Cuti: *${leaveTypeName}*\n📅 Tarikh: ${startDate} → ${endDate}\n⏱ Tempoh: ${diffDays} hari\n💬 Sebab: ${reason}\n\n🔗 *Log masuk untuk meluluskan:* https://apply-leave-89ebb.web.app\n_— KSB Leave System_`;
      } else {
        hodToNotify = window.getRoutingP1Approvers(user).filter(s => s.phone);
        hodMsg = `📩 *PERMOHONAN CUTI BARU — Peringkat 1 (Sokongan HOD)*\n\nPermohonan cuti memerlukan sokongan anda sebelum dihantar ke HR/Admin.\n\n👤 Pemohon: *${user.name}*\n🏥 Cawangan: ${user.branch}\n📝 Jenis Cuti: *${leaveTypeName}*\n📅 Tarikh: ${startDate} → ${endDate}\n⏱ Tempoh: ${diffDays} hari\n💬 Sebab: ${reason}\n\n🔗 *Log masuk untuk meluluskan:* https://apply-leave-89ebb.web.app\n_— KSB Leave System_`;
      }

      hodToNotify.forEach(hod => window.sendWhatsApp(hod.phone, hodMsg));

      // Inbox kepada pelulus (selari dengan WhatsApp) — peringkat yang sesuai
      const _apprStaff = _sbmIsOpBalokTL ? staffList.filter(s => s.ic === selectedTL)
        : selectedHOD ? staffList.filter(s => s.ic === selectedHOD)
        : window.getRoutingP1Approvers(user);
      window.notifyApproversInbox(_apprStaff,
        '📥 Permohonan Cuti Perlu Tindakan',
        `${user.name} memohon ${leaveTypeName} (${startDate}${startDate !== endDate ? ' → ' + endDate : ''}, ${diffDays} hari). Memerlukan ${_sbmIsOpBalokTL ? 'sokongan Team Leader (Peringkat 0)' : 'kelulusan Peringkat 1'} anda.`,
        newRecord.id.toString(), user.ic);

      // WA pengesahan kepada pemohon sendiri
      if (user.phone) {
        const nextStage = _sbmIsOpBalokTL
          ? 'Sokongan Team Leader (Peringkat 0)'
          : 'Sokongan HOD/Supervisor (Peringkat 1)';
        const confirmMsg = `✅ *PERMOHONAN CUTI DIHANTAR*\n\nSalam ${user.name},\n\nPermohonan cuti anda telah berjaya dihantar dengan sebab: *${reason}*\n\n📋 *Butiran Cuti:*\n• Jenis: ${leaveTypeName}\n• Tarikh: ${startDate} → ${endDate}\n• Tempoh: ${diffDays} hari\n\nPermohonan sedang menunggu *${nextStage}*. Anda akan dimaklumkan setiap kemaskini status.\n\n🔗 *Log masuk:* https://apply-leave-89ebb.web.app\n_— KSB Leave System_`;
        window.sendWhatsApp(user.phone, confirmMsg);
      }

      // CC: notify HR/Admin terus supaya mereka aware ada permohonan baru
      // HR hanya dapat notifikasi untuk cawangan Pahang sahaja
      const userBranchForCC = branches.find(b => b.name === user.branch);
      const isTerengganuLeave = userBranchForCC && userBranchForCC.state === 'Terengganu';
      const adminCC = staffList.filter(s => {
        if (!['admin', 'hr', 'super_admin'].includes(s.role) || !s.phone || s.inactive) return false;
        if (isTerengganuLeave && s.role === 'hr') return false;
        return true;
      });
      const adminCCMsg = _sbmIsOpBalokTL
        ? `ℹ️ *MAKLUMAN — Permohonan Cuti Baru (Tertunggu Sokongan Team Leader)*\n\n👤 Pemohon: *${user.name}*\n🏥 Cawangan: ${user.branch}\n📝 Jenis Cuti: *${leaveTypeName}*\n📅 Tarikh: ${startDate} → ${endDate}\n⏱ Tempoh: ${diffDays} hari\n\nPermohonan ini sedang menunggu sokongan Team Leader (Peringkat 0).\n\n🔗 *Log masuk:* https://apply-leave-89ebb.web.app\n_— KSB Leave System_`
        : `ℹ️ *MAKLUMAN — Permohonan Cuti Baru (Tertunggu Sokongan HOD)*\n\n👤 Pemohon: *${user.name}*\n🏥 Cawangan: ${user.branch}\n📝 Jenis Cuti: *${leaveTypeName}*\n📅 Tarikh: ${startDate} → ${endDate}\n⏱ Tempoh: ${diffDays} hari\n\nPermohonan ini sedang menunggu sokongan HOD/Supervisor (Peringkat 1).\n\n🔗 *Log masuk:* https://apply-leave-89ebb.web.app\n_— KSB Leave System_`;
      adminCC.forEach(admin => window.sendWhatsApp(admin.phone, adminCCMsg));

      // Build status message
      const waEnabled = WHATSAPP_ENABLED();
      const recipientNames = hodToNotify.map(h => h.name).join(', ');
      let statusMsg = '✅ Permohonan Cuti Berjaya Dihantar!\n\n';
      if (!waEnabled) {
        statusMsg += '⚠️ AMARAN: Token WhatsApp belum dikonfigurasi. Notifikasi WA TIDAK dihantar. Sila hubungi Super Admin untuk tetapkan token Fonnte dalam WA Settings.';
      } else if (hodToNotify.length === 0) {
        const noRecipientLabel = _sbmIsOpBalokTL ? 'Team Leader' : 'HOD/Supervisor';
        statusMsg += `⚠️ Tiada pelulus dijumpai untuk menerima notifikasi WA. Sila pastikan ${noRecipientLabel} telah didaftarkan dengan nombor telefon dalam sistem.`;
      } else {
        const notifLabel = _sbmIsOpBalokTL ? 'Team Leader (Peringkat 0)' : 'Pelulus Peringkat 1';
        statusMsg += `📲 Notifikasi WA dihantar kepada ${notifLabel}:\n${recipientNames}`;
      }

      navigator.clipboard.writeText(copyText).catch(() => {});
      alert(statusMsg);
      view = 'dashboard';
      render();
    });
  }

  // Handle Add Branch
  const addBranchForm = document.querySelector('#add-branch-form');
  if (addBranchForm) {
    addBranchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = e.target.querySelector('input[type="text"]');
      if (input.value.trim()) {
        branches.push({ name: input.value.trim(), state: 'Active', manager: user.name });
        alert(`Branch "${input.value.trim()}" added successfully!`);
        input.value = '';
        render(); // re-render to show updated list
      }
    });
  }

  // Handle Branch Filter in Management
  const branchFilterSelector = document.querySelector('#branch-filter');
  if (branchFilterSelector) {
    branchFilterSelector.addEventListener('change', (e) => {
      manageBranchFilter = e.target.value;
      render();
    });
  }

  // Handle Edit Staff Click
  document.querySelectorAll('.edit-staff-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      editingStaff = e.target.dataset.ic;
      render();
    });
  });

  // Handle Modal Interactions
  if (editingStaff) {
      const closeEditModal = () => {
          editingStaff = null;
          render();
      };
      
      const closeBtn = document.querySelector('#close-modal');
      const cancelBtn = document.querySelector('#cancel-modal');
      const backdrop = document.querySelector('#modal-backdrop');
      
      if (closeBtn) closeBtn.addEventListener('click', closeEditModal);
      if (cancelBtn) cancelBtn.addEventListener('click', closeEditModal);
      if (backdrop) backdrop.addEventListener('click', (e) => {
          if(e.target === backdrop) closeEditModal();
      });

      const editForm = document.querySelector('#edit-entitlement-form');
      if (editForm) {
          editForm.addEventListener('submit', async (e) => {
              e.preventDefault();
              const staffObj = staffList.find(s => s.ic === editingStaff);
              if (staffObj) {
                  const statusSelect = document.querySelector('#edit-status');
                  const startInput = document.querySelector('#edit-start-date');
                  const branchSelect = editForm.querySelectorAll('select')[0];
                  const categorySelect = editForm.querySelectorAll('select')[1];
                  const roleSelect = editForm.querySelectorAll('select')[2];
                  const passwordInput = document.querySelector('#edit-password');
                  const phoneInput = document.querySelector('#edit-phone');
                  const applyProrateInput = document.querySelector('#edit-apply-prorate');

                  const updates = {};
                  if(applyProrateInput) updates.apply_prorate = applyProrateInput.checked;
                  if(statusSelect) updates.inactive = statusSelect.value === 'inactive';
                  if(startInput) updates.startDate = startInput.value;
                  if(branchSelect) updates.branch = branchSelect.value;
                  if(categorySelect) updates.category = categorySelect.value;
                  if(roleSelect) updates.role = roleSelect.value;
                  if(phoneInput) updates.phone = phoneInput.value;

                  // Save Entitlements
                  const leaveTypes = ['AL', 'MC', 'HL', 'ML', 'PL', 'EL_EMG', 'EL', 'UP', 'CF', 'CME'];
                  leaveTypes.forEach(type => {
                      const input = document.getElementById(`ent-${type}`);
                      if (input) {
                          let val = parseFloat(input.value) || 0;
                          if (type === 'CF' && val > 3) {
                              val = 3; // hard limit to 3 days maximum
                          }
                          updates[`ent_${type}`] = val;
                      }
                  });

                  // Formula B: simpan "Guna Sebelum Sistem", "Guna Sistem (Tambahan HR)" & "Pelarasan HR".
                  ['al', 'mc', 'el'].forEach(p => {
                      const preEl = document.getElementById(`${p}-used-pre-input`);
                      const sysAdjEl = document.getElementById(`${p}-sys-adj-input`);
                      const pelEl = document.getElementById(`${p}-pelarasan-input`);
                      if (preEl)    updates[`${p}_used_pre`]     = Math.max(0, parseFloat(preEl.value) || 0);
                      if (sysAdjEl) updates[`${p}_used_sys_adj`] = Math.max(0, parseFloat(sysAdjEl.value) || 0);
                      if (pelEl)    updates[`${p}_pelarasan`]    = Math.max(0, parseFloat(pelEl.value) || 0);
                  });

                  try {
                      await updateDoc(doc(db, "staff", staffObj.ic), updates);
                      window.logSystemActivity(`Updated System Profile details for ${staffObj.name}`);
                      const newPwd = passwordInput && passwordInput.value.trim();
                      if (newPwd) { await window.adminSetPassword(staffObj.ic, newPwd); }
                      alert('Profil pekerja berjaya dikemaskini!');
                      closeEditModal();
                  } catch (err) {
                      console.error("Error updating staff: ", err);
                      alert("Ralat mengemaskini profil pekerja.");
                  }
              }
          });
      }

  }

  // Handle Leave Edit Modal
  if (editingLeaveId) {
      const closeLeaveModal = () => { editingLeaveId = null; render(); };
      const closeBtnL = document.querySelector('#close-leave-modal');
      const backdropL = document.querySelector('#leave-modal-backdrop');
      if (closeBtnL) closeBtnL.addEventListener('click', closeLeaveModal);
      if (backdropL) backdropL.addEventListener('click', (e) => { if(e.target === backdropL) closeLeaveModal(); });
      
      const elForm = document.querySelector('#edit-leave-form');
      if(elForm) elForm.addEventListener('submit', async (e) => {
          e.preventDefault();
          const rec = leaveRecords.find(r => r.id === editingLeaveId);
          if(rec) {
              const isAdminEditor = ['admin', 'hr', 'super_admin'].includes(user.role);
              const isOwner = rec.ic === user.ic;
              const isApprover = window.canManageRequest(user, rec);
              if (!isAdminEditor && ['APPROVED', 'REJECTED', 'CANCELLED'].includes(rec.status)) {
                  alert('Permohonan ini sudah selesai dan tidak boleh diubah.'); return;
              }
              if (!isAdminEditor && !isOwner && !isApprover) {
                  alert('Anda tidak mempunyai kebenaran untuk mengubah permohonan ini.'); return;
              }
              const elStart = document.querySelector('#el-start').value;
              const elEnd = document.querySelector('#el-end').value;
              const elDays = parseFloat(document.querySelector('#el-days').value);
              if (!(elDays > 0)) {
                  alert('Bilangan hari mesti lebih daripada 0. Sila betulkan.'); return;
              }
              const updates = {
                reason: document.querySelector('#el-reason').value,
                startDate: elStart,
                endDate: elEnd,
                days: elDays
              };
              if (isAdminEditor) {
                  updates.status = document.querySelector('#el-status').value;
                  updates.type = document.querySelector('#el-type').value;
              } else {
                  // Staf/pelulus: sebarang pindaan menetapkan semula ke PENDING untuk kelulusan semula.
                  updates.status = 'PENDING';
              }

              try {
                  await updateDoc(doc(db, "leaves", editingLeaveId.toString()), updates);
                  window.logSystemActivity(`Edited leave ${editingLeaveId} → ${elStart}..${elEnd}, ${elDays} hari, status ${updates.status}`);
                  // Jika reset ke PENDING (staf/pelulus), maklum semula pelulus peringkat 1.
                  if (!isAdminEditor) {
                      const applicant = staffList.find(s => s.ic === rec.ic) || user;
                      const info = `\n\n👤 Pemohon: *${applicant.name}*\n📅 Tarikh: ${elStart} → ${elEnd}\n⏱ Tempoh: ${elDays} hari\n\n🔗 https://apply-leave-89ebb.web.app`;
                      window.getRoutingP1Approvers(applicant).filter(s => s.phone).forEach(a =>
                          window.sendWhatsApp(a.phone, `🔁 *PERMOHONAN CUTI DIKEMASKINI — Perlu Sokongan Semula*${info}`));
                      window.notifyApproversInbox(window.getRoutingP1Approvers(applicant),
                          '🔁 Cuti Dikemaskini — Perlu Sokongan Semula',
                          `${applicant.name} mengubah permohonan cuti (kini ${elStart} → ${elEnd}, ${elDays} hari); memerlukan sokongan semula.`,
                          editingLeaveId.toString(), rec.ic);
                  }
                  alert('✅ Permohonan cuti dikemaskini.');
                  closeLeaveModal();
              } catch (err) {
                  console.error("Error updating leave: ", err);
                  alert("Ralat mengemaskini rekod cuti.");
              }
          }
      });
  }
}

function renderAnalyticsDashboard(lockedBranch = null) {
  // lockedBranch: when set (branch_analisa mode), filters are locked to that branch
  const effectiveBranchFilter = lockedBranch || analyticsBranchFilter;

  // Apply month + branch filters
  const filteredRecords = leaveRecords.filter(r => {
    if (analyticsFilterMonth !== 0) {
      if (!r.id) return false;
      if (new Date(r.id).getMonth() + 1 !== analyticsFilterMonth) return false;
    }
    if (effectiveBranchFilter !== 'SEMUA' && r.branch !== effectiveBranchFilter) return false;
    return true;
  });

  const totalReqs = filteredRecords.length;
  const approved = filteredRecords.filter(r => r.status === 'APPROVED').length;
  const pending = filteredRecords.filter(r => r.status?.includes('PENDING') || r.status?.includes('RECOM') || r.status?.includes('HOD') || r.status === 'TL APPROVED').length;
  const rejected = filteredRecords.filter(r => r.status === 'REJECTED').length;

  const types = {};
  filteredRecords.forEach(r => { types[r.type] = (types[r.type] || 0) + 1; });

  const branchesCount = {};
  filteredRecords.forEach(r => { branchesCount[r.branch] = (branchesCount[r.branch] || 0) + 1; });
  const sortedBranches = Object.entries(branchesCount).sort((a,b) => b[1] - a[1]);

  const monthsList = ['Jan','Feb','Mac','Apr','Mei','Jun','Jul','Ogo','Sep','Okt','Nov','Dis'];
  const monthCounts = monthsList.map((m, i) => leaveRecords.filter(r => {
      if (!r.id) return false;
      if (lockedBranch && r.branch !== lockedBranch) return false;
      return new Date(r.id).getMonth() === i;
  }).length);
  const maxMonthCount = Math.max(...monthCounts, 1);

  // Store for Chart.js
  window._analyticsData = { monthCounts, monthsList, types, totalReqs, sortedBranches, filteredRecords };

  // Color palettes reused in HTML (must match initCharts barPalette)
  const _barColors = ['#3b82f6','#6366f1','#8b5cf6','#a855f7','#ec4899','#ef4444','#f97316','#f59e0b','#eab308','#84cc16','#22c55e','#14b8a6'];
  const _donutColors = ['#3b82f6','#f59e0b','#10b981','#ef4444','#8b5cf6','#ec4899','#14b8a6','#f97316','#84cc16','#a855f7'];
  const _branchColors = ['#3b82f6','#a855f7','#10b981','#f59e0b','#ef4444','#ec4899','#14b8a6','#6366f1','#f97316','#84cc16','#22c55e','#38bdf8'];

  const approvalRate = totalReqs > 0 ? Math.round((approved/totalReqs)*100) : 0;
  const rejectedRate = totalReqs > 0 ? Math.round((rejected/totalReqs)*100) : 0;

  return `
    <div class="analytics-dashboard fade-in" style="overflow-y: auto; padding-top: 1rem;">

      <!-- Header -->
      <header style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.75rem;flex-wrap:wrap;gap:1rem;">
        <div style="display:flex;align-items:center;gap:1rem;">
          <div style="width:46px;height:46px;border-radius:13px;background:${lockedBranch ? 'linear-gradient(135deg,#fb923c,#f97316)' : 'linear-gradient(135deg,#3b82f6,#8b5cf6)'};display:flex;align-items:center;justify-content:center;box-shadow:0 8px 20px ${lockedBranch ? 'rgba(251,146,60,0.35)' : 'rgba(59,130,246,0.35)'};">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"><path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-4"/></svg>
          </div>
          <div>
            <h1 style="font-size:1.3rem;font-weight:800;margin:0;letter-spacing:-0.3px;">${lockedBranch ? `Analisa Cuti Cawangan` : 'Analisa Cuti — Admin View'}</h1>
            <p style="color:var(--text-muted);font-size:0.8rem;margin:0.15rem 0 0;">${lockedBranch ? `${lockedBranch} — rekod cuti kakitangan cawangan` : 'Gambaran keseluruhan rekod cuti seluruh kakitangan'}</p>
          </div>
        </div>
        <div style="display:flex;gap:0.65rem;align-items:center;flex-wrap:wrap;">
          ${lockedBranch
            ? `<div style="display:flex;align-items:center;gap:0.5rem;background:rgba(251,146,60,0.1);border:1px solid rgba(251,146,60,0.3);border-radius:8px;padding:0.45rem 0.9rem;font-size:0.82rem;font-weight:700;color:#fb923c;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
                ${lockedBranch}
              </div>`
            : `<select class="neu-inset" style="padding:0.45rem 0.9rem;font-size:0.85rem;width:auto;color-scheme:light;font-weight:600;" onchange="window.setAnalyticsBranch(this.value)">
                <option value="SEMUA" ${analyticsBranchFilter === 'SEMUA' ? 'selected' : ''}>Semua Cawangan</option>
                ${branches.map(b => `<option value="${b.name}" ${analyticsBranchFilter === b.name ? 'selected' : ''}>${b.name}</option>`).join('')}
              </select>`
          }
          <select id="month-filter" class="neu-inset" style="padding:0.45rem 0.9rem;font-size:0.85rem;width:auto;color-scheme:light;font-weight:600;" onchange="window.setAnalyticsMonth(this.value)">
            <option value="0" ${analyticsFilterMonth === 0 ? 'selected' : ''}>Semua Bulan</option>
            ${monthsList.map((m,i) => `<option value="${i+1}" ${analyticsFilterMonth === i+1 ? 'selected' : ''}>${m} ${new Date().getFullYear()}</option>`).join('')}
          </select>
        </div>
      </header>

      <!-- KPI Cards -->
      <section style="display:grid;grid-template-columns:repeat(4,1fr);gap:1.25rem;margin-bottom:1.75rem;">
        <!-- Total -->
        <div class="glass-card" style="padding:1.35rem;position:relative;overflow:hidden;background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%);border:none;">
          <div style="position:absolute;right:-15px;top:-15px;width:80px;height:80px;border-radius:50%;background:rgba(255,255,255,0.08);"></div>
          <div style="position:absolute;right:10px;bottom:-20px;width:60px;height:60px;border-radius:50%;background:rgba(255,255,255,0.05);"></div>
          <div style="font-size:0.7rem;text-transform:uppercase;font-weight:700;letter-spacing:1px;color:rgba(255,255,255,0.75);margin-bottom:0.5rem;">Jumlah Permohonan</div>
          <div style="font-size:2.8rem;font-weight:800;color:#fff;line-height:1;margin-bottom:0.4rem;">${totalReqs}</div>
          <div style="font-size:0.75rem;color:rgba(255,255,255,0.65);display:flex;align-items:center;gap:0.4rem;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            Tahun ${new Date().getFullYear()}
          </div>
        </div>
        <!-- Approved -->
        <div class="glass-card" style="padding:1.35rem;position:relative;overflow:hidden;background:linear-gradient(135deg,#059669 0%,#10b981 100%);border:none;">
          <div style="position:absolute;right:-15px;top:-15px;width:80px;height:80px;border-radius:50%;background:rgba(255,255,255,0.08);"></div>
          <div style="font-size:0.7rem;text-transform:uppercase;font-weight:700;letter-spacing:1px;color:rgba(255,255,255,0.75);margin-bottom:0.5rem;">Diluluskan</div>
          <div style="font-size:2.8rem;font-weight:800;color:#fff;line-height:1;margin-bottom:0.4rem;">${approved}</div>
          <div style="display:flex;align-items:center;gap:0.5rem;">
            <div style="flex:1;height:4px;background:rgba(255,255,255,0.2);border-radius:2px;overflow:hidden;"><div style="height:100%;width:${approvalRate}%;background:#fff;border-radius:2px;"></div></div>
            <span style="font-size:0.72rem;color:rgba(255,255,255,0.85);font-weight:700;">${approvalRate}%</span>
          </div>
        </div>
        <!-- Pending -->
        <div class="glass-card" style="padding:1.35rem;position:relative;overflow:hidden;background:linear-gradient(135deg,#d97706 0%,#f59e0b 100%);border:none;">
          <div style="position:absolute;right:-15px;top:-15px;width:80px;height:80px;border-radius:50%;background:rgba(255,255,255,0.08);"></div>
          <div style="font-size:0.7rem;text-transform:uppercase;font-weight:700;letter-spacing:1px;color:rgba(255,255,255,0.75);margin-bottom:0.5rem;">Sedang Diproses</div>
          <div style="font-size:2.8rem;font-weight:800;color:#fff;line-height:1;margin-bottom:0.4rem;">${pending}</div>
          <div style="font-size:0.75rem;color:rgba(255,255,255,0.65);display:flex;align-items:center;gap:0.4rem;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            Menunggu kelulusan
          </div>
        </div>
        <!-- Rejected -->
        <div class="glass-card" style="padding:1.35rem;position:relative;overflow:hidden;background:linear-gradient(135deg,#dc2626 0%,#ef4444 100%);border:none;">
          <div style="position:absolute;right:-15px;top:-15px;width:80px;height:80px;border-radius:50%;background:rgba(255,255,255,0.08);"></div>
          <div style="font-size:0.7rem;text-transform:uppercase;font-weight:700;letter-spacing:1px;color:rgba(255,255,255,0.75);margin-bottom:0.5rem;">Ditolak</div>
          <div style="font-size:2.8rem;font-weight:800;color:#fff;line-height:1;margin-bottom:0.4rem;">${rejected}</div>
          <div style="display:flex;align-items:center;gap:0.5rem;">
            <div style="flex:1;height:4px;background:rgba(255,255,255,0.2);border-radius:2px;overflow:hidden;"><div style="height:100%;width:${rejectedRate}%;background:#fff;border-radius:2px;"></div></div>
            <span style="font-size:0.72rem;color:rgba(255,255,255,0.85);font-weight:700;">${rejectedRate}%</span>
          </div>
        </div>
      </section>

      <!-- Charts Row -->
      <section style="display:grid;grid-template-columns:2fr 1fr;gap:1.25rem;margin-bottom:1.75rem;">
        <!-- Bar Chart -->
        <div class="glass-card" style="padding:1.5rem;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:1.25rem;">
            <div>
              <h3 style="font-size:0.95rem;font-weight:700;margin:0;letter-spacing:-0.2px;">Trend Permohonan Bulanan</h3>
              <div style="font-size:0.75rem;color:var(--text-muted);margin-top:0.2rem;">Klik pada bar untuk tapis mengikut bulan</div>
            </div>
            <div style="text-align:right;">
              <div style="font-size:1.5rem;font-weight:800;background:linear-gradient(135deg,#3b82f6,#8b5cf6);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">${Math.max(...monthCounts)}</div>
              <div style="font-size:0.65rem;color:var(--text-muted);text-transform:uppercase;font-weight:700;letter-spacing:0.5px;">Paling Tinggi</div>
            </div>
          </div>
          <!-- Month color legend pills -->
          <div style="display:flex;flex-wrap:wrap;gap:0.35rem;margin-bottom:1rem;">
            ${monthsList.map((m, i) => `
              <span onclick="window.setAnalyticsMonth(${analyticsFilterMonth === i+1 ? 0 : i+1})" style="cursor:pointer;padding:0.2rem 0.55rem;border-radius:20px;font-size:0.62rem;font-weight:700;background:${analyticsFilterMonth === 0 || analyticsFilterMonth === i+1 ? _barColors[i]+'22' : 'rgba(163,177,198,0.08)'};color:${analyticsFilterMonth === 0 || analyticsFilterMonth === i+1 ? _barColors[i] : '#94a3b8'};border:1px solid ${analyticsFilterMonth === 0 || analyticsFilterMonth === i+1 ? _barColors[i]+'44' : 'rgba(163,177,198,0.15)'};">${m}</span>
            `).join('')}
          </div>
          <div style="position:relative;height:200px;">
            <canvas id="chart-monthly"></canvas>
          </div>
        </div>

        <!-- Donut Chart -->
        <div class="glass-card" style="padding:1.5rem;">
          <h3 style="font-size:0.95rem;font-weight:700;margin:0 0 0.2rem;">Jenis Cuti</h3>
          <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:1rem;">Pecahan ${analyticsFilterMonth === 0 ? new Date().getFullYear() : monthsList[analyticsFilterMonth-1]}</div>
          <div style="position:relative;height:160px;margin-bottom:1.1rem;">
            <canvas id="chart-types"></canvas>
          </div>
          <div style="display:flex;flex-direction:column;gap:0.55rem;">
            ${Object.entries(types).map(([id, count], idx) => {
              const pct = totalReqs > 0 ? Math.round(count/totalReqs*100) : 0;
              const c = _donutColors[idx % _donutColors.length];
              return `
              <div>
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.25rem;">
                  <div style="display:flex;align-items:center;gap:0.45rem;">
                    <span style="width:9px;height:9px;border-radius:3px;background:${c};flex-shrink:0;display:inline-block;"></span>
                    <span style="font-size:0.73rem;font-weight:600;">${id}</span>
                  </div>
                  <div style="display:flex;align-items:center;gap:0.5rem;">
                    <span style="font-size:0.73rem;font-weight:800;">${count}</span>
                    <span style="font-size:0.65rem;background:${c}18;color:${c};border:1px solid ${c}30;border-radius:10px;padding:0.1rem 0.4rem;font-weight:700;">${pct}%</span>
                  </div>
                </div>
                <div style="height:4px;background:rgba(163,177,198,0.15);border-radius:2px;overflow:hidden;">
                  <div style="height:100%;width:${pct}%;background:${c};border-radius:2px;transition:width 0.5s ease;"></div>
                </div>
              </div>`;
            }).join('')}
          </div>
        </div>
      </section>

      <!-- Leaderboard -->
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;flex-wrap:wrap;gap:0.75rem;">
        <div style="display:flex;align-items:center;gap:0.75rem;">
          <div style="width:34px;height:34px;border-radius:9px;background:linear-gradient(135deg,#f59e0b,#f97316);display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(249,115,22,0.3);">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"><path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/></svg>
          </div>
          <div>
            <h3 style="font-size:0.9rem;font-weight:700;margin:0;">Ranking Penggunaan Cuti</h3>
            <p style="font-size:0.72rem;color:var(--text-muted);margin:0;">Top 3 mengikut jenis cuti</p>
          </div>
        </div>
        <div style="display:flex;gap:0.4rem;flex-wrap:wrap;">
          ${[['SEMUA','Semua'],['Doktor','Doktor'],['Admin Staff','Admin'],['Operation Staff','Operasi']].map(([val, label]) => `
            <button onclick="window.setAnalyticsCat('${val}')" style="padding:0.35rem 0.85rem;font-size:0.75rem;border-radius:20px;border:1px solid ${analyticsCatFilter === val ? 'var(--primary)' : 'rgba(163,177,198,0.3)'};cursor:pointer;transition:all 0.2s;font-weight:600;background:${analyticsCatFilter === val ? 'var(--primary)' : 'transparent'};color:${analyticsCatFilter === val ? 'white' : 'var(--text-muted)'};">${label}</button>
          `).join('')}
        </div>
      </div>

      <section style="display:grid;grid-template-columns:repeat(3,1fr);gap:1.25rem;margin-bottom:1.75rem;">
        ${[
          {type:'AL',    label:'Annual Leave',    short:'AL',  grad:'linear-gradient(135deg,#3b82f6,#6366f1)', glow:'rgba(59,130,246,0.3)',  icon:'<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'},
          {type:'MC',    label:'Medical Leave',   short:'MC',  grad:'linear-gradient(135deg,#059669,#10b981)', glow:'rgba(16,185,129,0.3)',  icon:'<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>'},
          {type:'EL_EMG',label:'Emergency Leave', short:'EL',  grad:'linear-gradient(135deg,#dc2626,#f97316)', glow:'rgba(239,68,68,0.3)',   icon:'<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'},
        ].map(cat => {
          const catRecords = filteredRecords.filter(r => r.type === cat.type);
          const catFiltered = analyticsCatFilter === 'SEMUA' ? catRecords
            : catRecords.filter(r => { const s = staffList.find(x => x.name === r.name || x.ic === r.ic); return s && s.category === analyticsCatFilter; });
          const top3 = [...catFiltered].sort((a,b) => (b.days||0) - (a.days||0)).slice(0,3);
          const medals = [
            { emoji:'🥇', bg:'linear-gradient(135deg,#fbbf24,#f59e0b)', shadow:'rgba(251,191,36,0.4)' },
            { emoji:'🥈', bg:'linear-gradient(135deg,#cbd5e1,#94a3b8)', shadow:'rgba(148,163,184,0.4)' },
            { emoji:'🥉', bg:'linear-gradient(135deg,#c2956c,#b45309)', shadow:'rgba(180,83,9,0.4)' },
          ];
          return `
          <div class="glass-card" style="padding:0;overflow:hidden;">
            <div style="padding:1rem 1.2rem;background:${cat.grad};display:flex;align-items:center;gap:0.75rem;box-shadow:0 4px 15px ${cat.glow};">
              <div style="width:34px;height:34px;border-radius:9px;background:rgba(255,255,255,0.2);display:flex;align-items:center;justify-content:center;">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">${cat.icon}</svg>
              </div>
              <div>
                <div style="font-size:0.8rem;font-weight:800;color:#fff;letter-spacing:0.3px;">${cat.label}</div>
                <div style="font-size:0.65rem;color:rgba(255,255,255,0.75);font-weight:600;">TOP 3 ${analyticsCatFilter !== 'SEMUA' ? '· ' + analyticsCatFilter.toUpperCase() : ''}</div>
              </div>
              <div style="margin-left:auto;background:rgba(255,255,255,0.2);border-radius:8px;padding:0.25rem 0.6rem;">
                <span style="font-size:0.9rem;font-weight:800;color:#fff;">${catFiltered.length}</span>
                <span style="font-size:0.6rem;color:rgba(255,255,255,0.75);display:block;text-align:center;">rekod</span>
              </div>
            </div>
            <div style="padding:1rem;display:flex;flex-direction:column;gap:0.6rem;">
              ${top3.length === 0
                ? `<div style="text-align:center;padding:1.5rem 1rem;color:var(--text-muted);">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" style="opacity:0.25;margin-bottom:0.5rem;"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                    <div style="font-size:0.75rem;font-weight:600;">Tiada rekod</div>
                  </div>`
                : top3.map((r, i) => `
                  <div style="display:flex;justify-content:space-between;align-items:center;background:rgba(163,177,198,0.07);padding:0.6rem 0.75rem;border-radius:10px;border:1px solid rgba(163,177,198,0.12);">
                    <div style="display:flex;align-items:center;gap:0.65rem;">
                      <div style="width:28px;height:28px;border-radius:8px;background:${medals[i].bg};box-shadow:0 3px 8px ${medals[i].shadow};display:flex;align-items:center;justify-content:center;font-size:0.9rem;flex-shrink:0;">${medals[i].emoji}</div>
                      <div>
                        <div style="font-size:0.8rem;font-weight:700;line-height:1.2;">${r.name}</div>
                        <div style="font-size:0.65rem;color:var(--text-muted);">${r.branch || ''}</div>
                      </div>
                    </div>
                    <div style="text-align:right;">
                      <div style="font-size:1rem;font-weight:800;background:${cat.grad};-webkit-background-clip:text;-webkit-text-fill-color:transparent;">${r.days || 1}</div>
                      <div style="font-size:0.6rem;color:var(--text-muted);font-weight:600;">HARI</div>
                    </div>
                  </div>
                `).join('')
              }
            </div>
          </div>`;
        }).join('')}
      </section>

      <!-- Branch Ranking Bars -->
      <section class="glass-card" style="padding:1.5rem;">
        <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:1.25rem;">
          <div style="width:34px;height:34px;border-radius:9px;background:linear-gradient(135deg,#14b8a6,#3b82f6);display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(20,184,166,0.3);">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          </div>
          <div>
            <h3 style="font-size:0.9rem;font-weight:700;margin:0;">Permohonan Mengikut Cawangan</h3>
            <p style="font-size:0.72rem;color:var(--text-muted);margin:0;">${analyticsBranchFilter === 'SEMUA' ? `${new Date().getFullYear()} — diisih dari tertinggi` : analyticsBranchFilter + ' — rekod dalam cawangan ini'}</p>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:0.85rem;">
          ${sortedBranches.map(([name, count], i) => {
            const c = _branchColors[i % _branchColors.length];
            const pct = totalReqs > 0 ? (count/totalReqs)*100 : 0;
            return `
            <div>
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.35rem;">
                <div style="display:flex;align-items:center;gap:0.6rem;">
                  <span style="width:22px;height:22px;border-radius:6px;background:${c}22;color:${c};font-size:0.68rem;font-weight:800;display:flex;align-items:center;justify-content:center;border:1px solid ${c}33;">${i+1}</span>
                  <span style="font-size:0.8rem;font-weight:600;">${name}</span>
                </div>
                <div style="display:flex;align-items:center;gap:0.5rem;">
                  <span style="font-size:0.78rem;font-weight:800;color:${c};">${count}</span>
                  <span style="font-size:0.65rem;background:${c}15;color:${c};border:1px solid ${c}28;border-radius:8px;padding:0.1rem 0.38rem;font-weight:700;">${Math.round(pct)}%</span>
                </div>
              </div>
              <div style="height:8px;background:rgba(163,177,198,0.12);border-radius:4px;overflow:hidden;">
                <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,${c},${c}bb);border-radius:4px;box-shadow:0 2px 6px ${c}44;transition:width 0.6s ease;"></div>
              </div>
            </div>`;
          }).join('')}
        </div>
      </section>
    </div>
  `;
}

function renderBranchDashboard() {
  const myBranch = user.branch || '';
  const monthsList = ['Jan','Feb','Mac','Apr','Mei','Jun','Jul','Ogo','Sep','Okt','Nov','Dis'];

  // All records for this branch, with optional month filter
  const branchRecords = leaveRecords.filter(r => {
    if (r.branch !== myBranch) return false;
    if (branchDashboardMonth !== 0) {
      if (!r.id) return false;
      if (new Date(r.id).getMonth() + 1 !== branchDashboardMonth) return false;
    }
    return true;
  });

  const branchStaff = staffList.filter(s => s.branch === myBranch && !s.inactive);
  const total = branchRecords.length;
  const approved = branchRecords.filter(r => r.status === 'APPROVED').length;
  const pending = branchRecords.filter(r => r.status?.includes('PENDING') || r.status?.includes('RECOM') || r.status?.includes('HOD') || r.status === 'TL APPROVED').length;
  const rejected = branchRecords.filter(r => r.status === 'REJECTED').length;
  const approvalRate = total > 0 ? Math.round(approved / total * 100) : 0;

  // Leave type counts
  const typeMap = {};
  branchRecords.forEach(r => { typeMap[r.type] = (typeMap[r.type] || 0) + 1; });
  const _donutColors = ['#3b82f6','#f59e0b','#10b981','#ef4444','#8b5cf6','#ec4899','#14b8a6','#f97316'];

  // Monthly counts for this branch (always full year, not filtered by month)
  const monthCounts = monthsList.map((_, i) =>
    leaveRecords.filter(r => r.branch === myBranch && r.startDate && new Date(r.startDate).getMonth() === i).length
  );
  const maxMonthCount = Math.max(...monthCounts, 1);

  // Staff ranking: who took most leave days (approved)
  const staffDays = {};
  branchRecords.filter(r => r.status === 'APPROVED').forEach(r => {
    staffDays[r.ic] = (staffDays[r.ic] || { name: r.name, days: 0 });
    staffDays[r.ic].days += parseFloat(r.days || 1);
  });
  const staffRanking = Object.values(staffDays).sort((a, b) => b.days - a.days).slice(0, 5);

  // Staff with pending leave
  const pendingByStaff = {};
  branchRecords.filter(r => r.status?.includes('PENDING') || r.status?.includes('RECOM') || r.status?.includes('HOD') || r.status === 'TL APPROVED').forEach(r => {
    if (!pendingByStaff[r.ic]) pendingByStaff[r.ic] = { name: r.name, count: 0 };
    pendingByStaff[r.ic].count++;
  });
  const pendingList = Object.values(pendingByStaff).sort((a, b) => b.count - a.count);

  return `
    <div class="analytics-dashboard fade-in" style="overflow-y:auto;padding-top:1rem;">

      <!-- Header -->
      <header style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.75rem;flex-wrap:wrap;gap:1rem;">
        <div style="display:flex;align-items:center;gap:1rem;">
          <div style="width:46px;height:46px;border-radius:13px;background:linear-gradient(135deg,#fb923c,#f97316);display:flex;align-items:center;justify-content:center;box-shadow:0 8px 20px rgba(251,146,60,0.35);">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          </div>
          <div>
            <h1 style="font-size:1.3rem;font-weight:800;margin:0;letter-spacing:-0.3px;">Dashboard Cawangan</h1>
            <p style="color:var(--text-muted);font-size:0.8rem;margin:0.15rem 0 0;">${myBranch || 'Cawangan Saya'} — ${branchStaff.length} kakitangan aktif</p>
          </div>
        </div>
        <select class="neu-inset" style="padding:0.45rem 0.9rem;font-size:0.85rem;width:auto;color-scheme:light;font-weight:600;" onchange="window.setBranchDashboardMonth(this.value)">
          <option value="0" ${branchDashboardMonth === 0 ? 'selected' : ''}>Semua Bulan</option>
          ${monthsList.map((m,i) => `<option value="${i+1}" ${branchDashboardMonth === i+1 ? 'selected' : ''}>${m} 2026</option>`).join('')}
        </select>
      </header>

      <!-- KPI Cards -->
      <section style="display:grid;grid-template-columns:repeat(4,1fr);gap:1.25rem;margin-bottom:1.75rem;">
        <div class="glass-card" style="padding:1.35rem;position:relative;overflow:hidden;background:linear-gradient(135deg,#4f46e5,#7c3aed);border:none;">
          <div style="position:absolute;right:-15px;top:-15px;width:80px;height:80px;border-radius:50%;background:rgba(255,255,255,0.08);"></div>
          <div style="font-size:0.7rem;text-transform:uppercase;font-weight:700;letter-spacing:1px;color:rgba(255,255,255,0.75);margin-bottom:0.5rem;">Jumlah Permohonan</div>
          <div style="font-size:2.8rem;font-weight:800;color:#fff;line-height:1;margin-bottom:0.4rem;">${total}</div>
          <div style="font-size:0.75rem;color:rgba(255,255,255,0.65);">${branchStaff.length} kakitangan</div>
        </div>
        <div class="glass-card" style="padding:1.35rem;position:relative;overflow:hidden;background:linear-gradient(135deg,#059669,#10b981);border:none;">
          <div style="position:absolute;right:-15px;top:-15px;width:80px;height:80px;border-radius:50%;background:rgba(255,255,255,0.08);"></div>
          <div style="font-size:0.7rem;text-transform:uppercase;font-weight:700;letter-spacing:1px;color:rgba(255,255,255,0.75);margin-bottom:0.5rem;">Diluluskan</div>
          <div style="font-size:2.8rem;font-weight:800;color:#fff;line-height:1;margin-bottom:0.4rem;">${approved}</div>
          <div style="display:flex;align-items:center;gap:0.5rem;">
            <div style="flex:1;height:4px;background:rgba(255,255,255,0.2);border-radius:2px;overflow:hidden;"><div style="height:100%;width:${approvalRate}%;background:#fff;border-radius:2px;"></div></div>
            <span style="font-size:0.72rem;color:rgba(255,255,255,0.85);font-weight:700;">${approvalRate}%</span>
          </div>
        </div>
        <div class="glass-card" style="padding:1.35rem;position:relative;overflow:hidden;background:linear-gradient(135deg,#d97706,#f59e0b);border:none;">
          <div style="position:absolute;right:-15px;top:-15px;width:80px;height:80px;border-radius:50%;background:rgba(255,255,255,0.08);"></div>
          <div style="font-size:0.7rem;text-transform:uppercase;font-weight:700;letter-spacing:1px;color:rgba(255,255,255,0.75);margin-bottom:0.5rem;">Sedang Diproses</div>
          <div style="font-size:2.8rem;font-weight:800;color:#fff;line-height:1;margin-bottom:0.4rem;">${pending}</div>
          <div style="font-size:0.75rem;color:rgba(255,255,255,0.65);">Menunggu kelulusan</div>
        </div>
        <div class="glass-card" style="padding:1.35rem;position:relative;overflow:hidden;background:linear-gradient(135deg,#dc2626,#ef4444);border:none;">
          <div style="position:absolute;right:-15px;top:-15px;width:80px;height:80px;border-radius:50%;background:rgba(255,255,255,0.08);"></div>
          <div style="font-size:0.7rem;text-transform:uppercase;font-weight:700;letter-spacing:1px;color:rgba(255,255,255,0.75);margin-bottom:0.5rem;">Ditolak</div>
          <div style="font-size:2.8rem;font-weight:800;color:#fff;line-height:1;margin-bottom:0.4rem;">${rejected}</div>
          <div style="font-size:0.75rem;color:rgba(255,255,255,0.65);">Permohonan ditolak</div>
        </div>
      </section>

      <!-- Monthly Trend + Leave Types -->
      <section style="display:grid;grid-template-columns:2fr 1fr;gap:1.25rem;margin-bottom:1.75rem;">
        <!-- Monthly Trend Bars -->
        <div class="glass-card" style="padding:1.5rem;">
          <h3 style="font-size:0.95rem;font-weight:700;margin:0 0 1.25rem;">Trend Bulanan — ${myBranch}</h3>
          <div style="display:flex;align-items:flex-end;gap:0.4rem;height:130px;">
            ${monthCounts.map((count, i) => {
              const pct = (count / maxMonthCount) * 100;
              const isActive = branchDashboardMonth === i + 1;
              const colors = ['#3b82f6','#6366f1','#8b5cf6','#a855f7','#ec4899','#ef4444','#f97316','#f59e0b','#eab308','#84cc16','#22c55e','#14b8a6'];
              const c = colors[i];
              return `
              <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:0.3rem;cursor:pointer;" onclick="window.setBranchDashboardMonth(${branchDashboardMonth === i+1 ? 0 : i+1})">
                <div style="font-size:0.6rem;font-weight:700;color:${isActive ? c : 'var(--text-muted)'};">${count || ''}</div>
                <div style="width:100%;border-radius:4px 4px 0 0;transition:height 0.4s ease;background:${isActive ? c : c + '66'};height:${Math.max(pct, count > 0 ? 8 : 0)}%;min-height:${count > 0 ? '6px' : '0'};"></div>
                <div style="font-size:0.55rem;font-weight:700;color:${isActive ? c : 'var(--text-muted)'};">${monthsList[i]}</div>
              </div>`;
            }).join('')}
          </div>
        </div>

        <!-- Leave Type Breakdown -->
        <div class="glass-card" style="padding:1.5rem;">
          <h3 style="font-size:0.95rem;font-weight:700;margin:0 0 1rem;">Jenis Cuti</h3>
          ${Object.entries(typeMap).length === 0
            ? `<div style="text-align:center;padding:2rem;color:var(--text-muted);font-size:0.8rem;">Tiada rekod</div>`
            : `<div style="display:flex;flex-direction:column;gap:0.65rem;">
                ${Object.entries(typeMap).map(([id, count], idx) => {
                  const pct = total > 0 ? Math.round(count / total * 100) : 0;
                  const c = _donutColors[idx % _donutColors.length];
                  return `
                  <div>
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.25rem;">
                      <div style="display:flex;align-items:center;gap:0.45rem;">
                        <span style="width:9px;height:9px;border-radius:3px;background:${c};flex-shrink:0;display:inline-block;"></span>
                        <span style="font-size:0.73rem;font-weight:600;">${id}</span>
                      </div>
                      <div style="display:flex;align-items:center;gap:0.5rem;">
                        <span style="font-size:0.73rem;font-weight:800;">${count}</span>
                        <span style="font-size:0.65rem;background:${c}18;color:${c};border:1px solid ${c}30;border-radius:10px;padding:0.1rem 0.4rem;font-weight:700;">${pct}%</span>
                      </div>
                    </div>
                    <div style="height:4px;background:rgba(163,177,198,0.15);border-radius:2px;overflow:hidden;">
                      <div style="height:100%;width:${pct}%;background:${c};border-radius:2px;transition:width 0.5s;"></div>
                    </div>
                  </div>`;
                }).join('')}
              </div>`
          }
        </div>
      </section>

      <!-- Staff Ranking + Pending -->
      <section style="display:grid;grid-template-columns:1fr 1fr;gap:1.25rem;margin-bottom:1.5rem;">
        <!-- Top Leave Takers -->
        <div class="glass-card" style="padding:1.5rem;">
          <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:1.25rem;">
            <div style="width:34px;height:34px;border-radius:9px;background:linear-gradient(135deg,#f59e0b,#f97316);display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(249,115,22,0.3);">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"><path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/></svg>
            </div>
            <div>
              <h3 style="font-size:0.9rem;font-weight:700;margin:0;">Penggunaan Cuti Tertinggi</h3>
              <p style="font-size:0.72rem;color:var(--text-muted);margin:0;">Berdasarkan cuti diluluskan</p>
            </div>
          </div>
          ${staffRanking.length === 0
            ? `<div style="text-align:center;padding:1.5rem;color:var(--text-muted);font-size:0.8rem;">Tiada rekod cuti diluluskan</div>`
            : `<div style="display:flex;flex-direction:column;gap:0.6rem;">
                ${staffRanking.map((s, i) => {
                  const medals = ['🥇','🥈','🥉','4️⃣','5️⃣'];
                  const medalBg = ['linear-gradient(135deg,#fbbf24,#f59e0b)','linear-gradient(135deg,#cbd5e1,#94a3b8)','linear-gradient(135deg,#c2956c,#b45309)','rgba(163,177,198,0.18)','rgba(163,177,198,0.12)'];
                  const maxDays = staffRanking[0].days;
                  const pct = maxDays > 0 ? (s.days / maxDays) * 100 : 0;
                  return `
                  <div>
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.3rem;">
                      <div style="display:flex;align-items:center;gap:0.6rem;">
                        <div style="width:26px;height:26px;border-radius:7px;background:${medalBg[i]};display:flex;align-items:center;justify-content:center;font-size:0.8rem;flex-shrink:0;">${medals[i]}</div>
                        <span style="font-size:0.8rem;font-weight:700;">${s.name}</span>
                      </div>
                      <span style="font-size:0.8rem;font-weight:800;color:#f59e0b;">${s.days} hari</span>
                    </div>
                    <div style="height:4px;background:rgba(163,177,198,0.12);border-radius:2px;overflow:hidden;">
                      <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#f59e0b,#f97316);border-radius:2px;transition:width 0.5s;"></div>
                    </div>
                  </div>`;
                }).join('')}
              </div>`
          }
        </div>

        <!-- Pending Approvals -->
        <div class="glass-card" style="padding:1.5rem;">
          <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:1.25rem;">
            <div style="width:34px;height:34px;border-radius:9px;background:linear-gradient(135deg,#d97706,#f59e0b);display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(217,119,6,0.3);">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            </div>
            <div>
              <h3 style="font-size:0.9rem;font-weight:700;margin:0;">Permohonan Menunggu</h3>
              <p style="font-size:0.72rem;color:var(--text-muted);margin:0;">${pending} perlu tindakan</p>
            </div>
          </div>
          ${pendingList.length === 0
            ? `<div style="text-align:center;padding:1.5rem;color:var(--text-muted);font-size:0.8rem;">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.3;margin-bottom:0.5rem;"><polyline points="20 6 9 17 4 12"/></svg>
                <div>Tiada permohonan menunggu</div>
              </div>`
            : `<div style="display:flex;flex-direction:column;gap:0.55rem;">
                ${pendingList.map(p => `
                  <div style="display:flex;justify-content:space-between;align-items:center;background:rgba(245,158,11,0.06);padding:0.6rem 0.8rem;border-radius:9px;border:1px solid rgba(245,158,11,0.15);">
                    <span style="font-size:0.8rem;font-weight:600;">${p.name}</span>
                    <span style="font-size:0.72rem;font-weight:800;color:#f59e0b;background:rgba(245,158,11,0.12);padding:0.2rem 0.55rem;border-radius:8px;border:1px solid rgba(245,158,11,0.25);">${p.count} permohonan</span>
                  </div>`).join('')}
              </div>`
          }
        </div>
      </section>

    </div>
  `;
}

function renderPersonalDashboard() {
  const myRecords = leaveRecords.filter(r => r.ic === user.ic).sort((a,b) => b.id - a.id);

  // Semua baki cuti guna getLeaveStats — ikut nilai yang HR set
  const alStats = window.getLeaveStats(user, 'AL');
  const mcStats = window.getLeaveStats(user, 'MC');
  const hlStats = window.getLeaveStats(user, 'HL');
  const mlStats = window.getLeaveStats(user, 'ML');
  const mlPlStats = window.getLeaveStats(user, 'ML_PL');
  const elStats = window.getLeaveStats(user, 'EL');
  const elEmgStats = window.getLeaveStats(user, 'EL_EMG');
  const cmeStats = window.getLeaveStats(user, 'CME');
  const cfStats = window.getLeaveStats(user, 'CF');

  // Baki AL = baki Pelarasan HR (baseline − guna sistem); penyebut = peruntukan setahun
  // (ent_AL + CF) supaya selaras dengan report "SENARAI BILANGAN CUTI".
  const balAL = alStats.bal.toFixed(2);
  const earnedAL = (user.ent_AL !== undefined && user.ent_AL !== null ? parseFloat(user.ent_AL) : window.getEntitlementAL(user)) + parseFloat(user.ent_CF || 0);

  const pendingCount = myRecords.filter(r => (r.status || '').includes('PENDING') || (r.status || '').includes('RECOM') || (r.status || '').includes('HOD') || r.status === 'TL APPROVED').length;

  // Cuti lain yang HR set (papar hanya jika entitlement > 0)
  // CF tidak disenaraikan di sini kerana sudah digabungkan dalam jumlah AL
  const otherLeaves = [
    { label: 'Hospitalisasi (HL)', stats: hlStats, color: '#06b6d4' },
    { label: 'Cuti Bersalin (ML)', stats: mlStats, color: '#ec4899' },
    { label: 'Cuti Paterniti', stats: mlPlStats, color: '#6366f1' },
    { label: 'Kecemasan Ehsan (EL)', stats: elStats, color: '#f59e0b' },
    { label: 'Kecemasan Am (EL_EMG)', stats: elEmgStats, color: '#ef4444' },
    { label: 'Latihan CME', stats: cmeStats, color: '#8b5cf6' },
  ].filter(o => o.stats.ent > 0);

  const otherLeavesHtml = otherLeaves.length > 0 ? `
    <div class="glass-card" style="padding: 1.5rem; margin-bottom: 2rem;">
      <div style="font-size: 0.9rem; font-weight: 800; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 1rem;">Baki Cuti Lain</div>
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 1rem;">
        ${otherLeaves.map(o => `
          <div style="padding: 0.9rem 1rem; background: rgba(163,177,198,0.1); border-radius: 12px; border-left: 3px solid ${o.color};">
            <div style="font-size: 0.78rem; font-weight: 700; color: var(--text-muted); margin-bottom: 0.4rem;">${o.label}</div>
            <div style="display: flex; align-items: baseline; gap: 0.3rem;">
              <span style="font-size: 1.5rem; font-weight: 800; color: ${o.color};">${o.stats.bal}</span>
              <span style="font-size: 0.78rem; color: var(--text-muted);">/ ${o.stats.ent} hari</span>
            </div>
            <div style="height: 4px; background: rgba(163,177,198,0.18); border-radius: 2px; overflow: hidden; margin-top: 0.5rem;">
              <div style="height: 100%; width: ${o.stats.ent > 0 ? Math.min(100, (o.stats.bal / o.stats.ent) * 100) : 0}%; background: ${o.color}; transition: width 0.5s ease;"></div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  ` : '';

  return `
    <div class="personal-dashboard fade-in" style="padding-top: 1rem;">
      <header class="top-bar" style="margin-bottom: 2rem;">
        <div>
          <h1 style="font-size: 1.75rem; letter-spacing: -0.5px;">Welcome back, ${(user.name || '').split(' ')[0]}!</h1>
          <p style="color: var(--text-muted); font-size: 1.05rem;">Here's a summary of your leave status and activity.</p>
        </div>
        <div class="action-buttons">
          <button class="btn-primary" style="width: auto; padding: 0.75rem 1.5rem; border-radius: 14px; font-weight: 700; display: flex; align-items: center; gap: 0.5rem;" onclick="window.setView('leave-form')">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            APPLY LEAVE
          </button>
        </div>
      </header>

      <section class="stats-grid" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.5rem; margin-bottom: 2rem;">
        <div class="glass-card" style="padding: 1.5rem; position: relative; overflow: hidden;">
           <div style="font-size: 1.05rem; font-weight: 800; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 0.75rem;">Annual Leave (AL) Balance</div>
           <div style="display: flex; align-items: baseline; gap: 0.5rem; margin-bottom: 0.75rem;">
              <div style="font-size: 2.5rem; font-weight: 800; color: var(--primary);">${balAL}</div>
              <div style="font-size: 1.05rem; color: var(--text-muted); font-weight: 600;">/ ${earnedAL.toFixed(1)} hari</div>
           </div>
           <div style="height: 6px; background: rgba(163,177,198,0.18); border-radius: 3px; overflow: hidden; margin-bottom: 0.75rem;">
              <div style="height: 100%; width: ${earnedAL > 0 ? Math.min(100, (parseFloat(balAL) / earnedAL) * 100) : 0}%; background: var(--primary); transition: width 0.5s ease;"></div>
           </div>
           <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.35rem 0.75rem; font-size: 0.78rem; color: var(--text-muted); border-top: 1px solid rgba(163,177,198,0.15); padding-top: 0.6rem;">
             <span>Bawa Lepas (CF):</span><span style="font-weight:700;color:var(--text-secondary);">${parseFloat(user.ent_CF||0).toFixed(0)} hari</span>
             <span>Peruntukan ${new Date().getFullYear()}:</span><span style="font-weight:700;color:var(--text-secondary);">${(user.ent_AL !== undefined ? parseFloat(user.ent_AL) : window.getEntitlementAL(user)).toFixed(0)} hari</span>
             ${alStats.usedPre > 0 ? `<span>Guna Sebelum Sistem:</span><span style="font-weight:700;color:#0ea5e9;">${alStats.usedPre.toFixed(1)} hari</span>` : ''}
             <span>Digunakan (Sistem):</span><span style="font-weight:700;color:#ef4444;">${alStats.used.toFixed(1)} hari</span>
             ${alStats.pelarasan > 0 ? `<span>Pelarasan HR:</span><span style="font-weight:700;color:#f59e0b;">${alStats.pelarasan.toFixed(1)} hari</span>` : ''}
           </div>
        </div>

        <div class="glass-card" style="padding: 1.5rem; position: relative; overflow: hidden;">
           <div style="font-size: 1.05rem; font-weight: 800; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 1rem;">Medical Leave (MC) Baki</div>
           <div style="display: flex; align-items: baseline; gap: 0.5rem; margin-bottom: 1rem;">
              <div style="font-size: 2.5rem; font-weight: 800; color: var(--accent);">${mcStats.bal}</div>
              <div style="font-size: 1.05rem; color: var(--text-muted); font-weight: 600;">/ ${mcStats.ent} days annual</div>
           </div>
           <div style="height: 6px; background: rgba(163,177,198,0.18); border-radius: 3px; overflow: hidden;">
              <div style="height: 100%; width: ${mcStats.ent > 0 ? Math.min(100, (mcStats.bal / mcStats.ent) * 100) : 0}%; background: var(--accent); transition: width 0.5s ease;"></div>
           </div>
           <div style="font-size: 1.05rem; color: var(--text-muted); margin-top: 0.5rem;">Tahun Semasa: ${new Date().getFullYear()}</div>
        </div>

        <div class="glass-card" style="padding: 1.5rem; position: relative; overflow: hidden; background: rgba(245, 158, 11, 0.05);">
           <div style="font-size: 1.05rem; font-weight: 800; color: var(--warning); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 1rem;">Pending Approval</div>
           <div style="font-size: 2.5rem; font-weight: 800; color: var(--warning); margin-bottom: 1rem;">${pendingCount}</div>
           <div style="font-size: 1.05rem; color: var(--text-muted); font-weight: 600;">Sila semak status permohonan di bawah.</div>
           <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="rgba(245, 158, 11, 0.15)" stroke-width="2" style="position: absolute; right: -10px; top: -10px;"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
        </div>
      </section>

      ${otherLeavesHtml}

      <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 1.5rem;">
        <div class="glass-card" style="padding: 1.5rem;">
          <h3 style="font-size: 1rem; margin-bottom: 1.5rem; display: flex; align-items: center; gap: 0.5rem;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="2.5"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
            Rekod Permohonan Terkini
          </h3>
          <div style="overflow-x: auto;">
            <table class="data-table" style="font-size: 0.93rem;">
              <thead>
                <tr>
                  <th>Jenis Cuti</th>
                  <th>Tarikh</th>
                  <th>Tempoh</th>
                  <th>Status</th>
                  <th>Tindakan</th>
                </tr>
              </thead>
              <tbody>
                ${myRecords.length === 0
                  ? '<tr><td colspan="5" style="text-align: center; padding: 2rem; color: var(--text-muted);">Tiada rekod permohonan ditemui.</td></tr>'
                  : myRecords.slice(0, 5).map(act => `
                  <tr>
                    <td style="font-weight: 700;">${act.type}</td>
                    <td style="color: var(--text-muted); font-size: 1rem;">${act.startDate} → ${act.endDate}</td>
                    <td style="font-weight: 600;">${act.days} Hari</td>
                    <td><span class="status-badge ${(act.status || '').toLowerCase()}">${act.status}</span></td>
                    <td>${act.ic === user.ic && !['APPROVED','REJECTED','CANCELLED'].includes(act.status) ? `<button class="neu-btn" onclick="window.editLeave(${act.id})" style="color:#60a5fa;">✏️ Edit Cuti</button>` : ''}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          ${myRecords.length > 5 ? `<div style="text-align: center; margin-top: 1.5rem;"><button class="neu-btn" style="width: auto; padding: 0.5rem 2rem; font-size: 1.05rem;">LIHAT SEMUA REKOD</button></div>` : ''}
        </div>

        <div style="display: flex; flex-direction: column; gap: 1.5rem;">
          <div class="glass-card" style="padding: 1.5rem; background: linear-gradient(135deg, rgba(59, 130, 246, 0.1), transparent);">
             <h3 style="font-size: 1.05rem; margin-bottom: 1rem; color: var(--primary);">Quick Info</h3>
             <div class="policy-item" style="padding: 1rem; background: rgba(163,177,198,0.18); border-radius: 12px; margin-bottom: 1rem;">
                <div style="font-size: 1.05rem; font-weight: 700; text-transform: uppercase; color: var(--text-muted); margin-bottom: 0.25rem;">Cawangan</div>
                <div style="font-size: 1.05rem; font-weight: 700;">${user.branch}</div>
             </div>
             <div class="policy-item" style="padding: 1rem; background: rgba(163,177,198,0.18); border-radius: 12px;">
                <div style="font-size: 1.05rem; font-weight: 700; text-transform: uppercase; color: var(--text-muted); margin-bottom: 0.25rem;">Kategori Staff</div>
                <div style="font-size: 1.05rem; font-weight: 700;">${user.category}</div>
             </div>
          </div>
          
          <div class="glass-card" style="padding: 1.5rem; border: 1px dashed rgba(163,177,198,0.4); background: transparent;">
             <h3 style="font-size: 1.05rem; margin-bottom: 1rem; display: flex; align-items: center; gap: 0.5rem;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg> Policy Note</h3>
             <p style="font-size: 1rem; color: var(--text-muted); line-height: 1.6;">Sila pastikan permohonan AL dibuat sekurang-kurangnya <strong>${user.category === 'Admin Staff' ? '3' : '7'} hari</strong> awal mengikut polisi syarikat KSB.</p>
             <button class="neu-btn" style="margin-top: 1rem; font-size: 1.05rem;" onclick="window.setView('policy')">BUKA POLISI PENUH</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderView() {
  switch (view) {
    case 'messenger':
      return renderMessengerView();

    case 'dashboard':
      const finalRKey = window.rbacMatrix[user.role] ? user.role : 'staff';
      const dashboardRbac = window.rbacMatrix[finalRKey];
      const dashboardMode = dashboardRbac.dashboard; // 'analisa' | 'branch' | 'staff'
      const canSeeAnalytics = dashboardMode === 'analisa';
      const canSeeBranch = dashboardMode === 'branch';
      const canSeeBranchAnalytics = !!dashboardRbac.branch_analisa && !canSeeAnalytics;

      // Initialize dashboardTab if not set
      if (!dashboardTab) {
          dashboardTab = dashboardMode === 'analisa' ? 'analytics' : dashboardMode === 'branch' ? 'branch' : canSeeBranchAnalytics ? 'branch_analytics' : 'personal';
      }

      const showSwitcher = canSeeAnalytics || canSeeBranch || canSeeBranchAnalytics;

      return `
        <div class="dashboard-wrapper">
          ${showSwitcher ? `
            <div style="display:flex;gap:0.6rem;margin-bottom:2rem;background:rgba(163,177,198,0.12);padding:0.4rem;border-radius:12px;width:fit-content;border:1px solid rgba(163,177,198,0.5);">
                ${canSeeAnalytics ? `
                <button onclick="window.setDashboardTab('analytics')" style="border:none;padding:0.6rem 1.4rem;border-radius:8px;font-size:0.92rem;font-weight:700;cursor:pointer;transition:all 0.2s;${dashboardTab === 'analytics' ? 'background:var(--primary);color:var(--text);box-shadow:0 4px 12px rgba(59,130,246,0.3);' : 'background:transparent;color:var(--text-muted);'}">
                  📊 ANALISA (ADMIN)
                </button>` : ''}
                ${canSeeBranchAnalytics ? `
                <button onclick="window.setDashboardTab('branch_analytics')" style="border:none;padding:0.6rem 1.4rem;border-radius:8px;font-size:0.92rem;font-weight:700;cursor:pointer;transition:all 0.2s;${dashboardTab === 'branch_analytics' ? 'background:linear-gradient(135deg,#fb923c,#f97316);color:#fff;box-shadow:0 4px 12px rgba(251,146,60,0.35);' : 'background:transparent;color:var(--text-muted);'}">
                  📊 ANALISA CAWANGAN
                </button>` : ''}
                ${canSeeBranch ? `
                <button onclick="window.setDashboardTab('branch')" style="border:none;padding:0.6rem 1.4rem;border-radius:8px;font-size:0.92rem;font-weight:700;cursor:pointer;transition:all 0.2s;${dashboardTab === 'branch' ? 'background:var(--primary);color:var(--text);box-shadow:0 4px 12px rgba(59,130,246,0.3);' : 'background:transparent;color:var(--text-muted);'}">
                  🏠 CAWANGAN SAYA
                </button>` : ''}
                <button onclick="window.setDashboardTab('personal')" style="border:none;padding:0.6rem 1.4rem;border-radius:8px;font-size:0.92rem;font-weight:700;cursor:pointer;transition:all 0.2s;${dashboardTab === 'personal' ? 'background:var(--primary);color:var(--text);box-shadow:0 4px 12px rgba(59,130,246,0.3);' : 'background:transparent;color:var(--text-muted);'}">
                  👤 PERSONAL
                </button>
            </div>
          ` : ''}

          ${dashboardTab === 'analytics' && canSeeAnalytics
            ? renderAnalyticsDashboard()
            : dashboardTab === 'branch_analytics' && canSeeBranchAnalytics
              ? renderAnalyticsDashboard(user.branch)
              : dashboardTab === 'branch' && canSeeBranch
                ? renderBranchDashboard()
                : renderPersonalDashboard()}
        </div>
      `;

    case 'leave-form':
      const lastDigit = parseInt(user.ic.slice(-1));
      const gender = isNaN(lastDigit) ? 'Female' : (lastDigit % 2 === 0 ? 'Female' : 'Male');
      
      // Safety check: ensure selectedLeaveType is valid for gender
      if (selectedLeaveType === 'ML' && gender === 'Male') selectedLeaveType = 'AL';
      if (selectedLeaveType === 'ML_PL' && gender === 'Female') selectedLeaveType = 'AL';

      const filteredCategories = leaveCategories.filter(cat => {
          if (cat.id === 'ML') return gender === 'Female';
          if (cat.id === 'ML_PL') return gender === 'Male';
          return true;
      });

      const currentCat = leaveCategories.find(c => c.id === selectedLeaveType) || leaveCategories[0];
      const isAL = selectedLeaveType === 'AL';
      const isMC = selectedLeaveType === 'MC';
      const isEhsan = selectedLeaveType === 'EL';
      const isNoticeExempt = ['MC', 'EL_EMG', 'EL', 'CME'].includes(selectedLeaveType);
      const isEMG = selectedLeaveType === 'EL_EMG';
      const isHosp = selectedLeaveType === 'HL';
      
      const myRecords = leaveRecords.filter(r => r.ic === user.ic);
      const earnedAL = window.getEarnedAL(user);
      const usedAL = myRecords.filter(r => r.status === 'APPROVED' && r.type === 'AL').reduce((acc, r) => acc + parseFloat(r.days || 0), 0);
      const balAL = (earnedAL - usedAL).toFixed(1);
      
      const usedMC = myRecords.filter(r => r.status === 'APPROVED' && r.type === 'MC').reduce((acc, r) => acc + parseFloat(r.days || 0), 0);
      const entMC = 14;
      const balMC = entMC - usedMC;
      
      const leaveIcons = {
        'AL':          '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="12" y1="14" x2="12" y2="17"/><line x1="10.5" y1="15.5" x2="13.5" y2="15.5"/>',
        'MC':          '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
        'EL':          '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
        'EL_EMG':      '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
        'UP':          '<circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/>',
        'HL':          '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
        'ML':          '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
        'ML_PL':       '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>',
        'CME':         '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
      };
      const leaveShort = {
        'AL':'Tahunan','MC':'Sakit','EL':'Ehsan','EL_EMG':'Kecemasan',
        'UP':'Tanpa Gaji','HL':'Hospital','ML':'Bersalin','ML_PL':'Paterniti',
        'CME':'CME'
      };
      const selStats = window.getLeaveStats(user, selectedLeaveType);
      const selEnt   = selStats.ent;
      const selUsed  = selStats.used;
      const selBal   = parseFloat(selStats.bal.toFixed(2));
      const selPct   = selEnt > 0 ? Math.min(100, Math.round((selUsed / selEnt) * 100)) : 0;
      const selCat   = leaveCategories.find(c => c.id === selectedLeaveType) || leaveCategories[0];

      return `
        <div class="split-layout fade-in">
          <!-- Left Panel: Form -->
          <form class="glass-pane form-panel" id="leave-request-form" style="padding:0;overflow:hidden;">

            <!-- Form Header -->
            <div style="background:linear-gradient(135deg,#1e3a5f 0%,#1a2744 100%);padding:1.5rem 2rem;position:relative;overflow:hidden;">
              <div style="position:absolute;right:-30px;top:-30px;width:120px;height:120px;border-radius:50%;background:rgba(59,130,246,0.12);"></div>
              <div style="position:absolute;right:30px;bottom:-40px;width:80px;height:80px;border-radius:50%;background:rgba(139,92,246,0.1);"></div>
              <div style="display:flex;align-items:center;justify-content:space-between;position:relative;">
                <div style="display:flex;align-items:center;gap:0.85rem;">
                  <div style="width:40px;height:40px;border-radius:11px;background:rgba(59,130,246,0.25);border:1px solid rgba(59,130,246,0.4);display:flex;align-items:center;justify-content:center;">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#93c5fd" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                  </div>
                  <div>
                    <h1 style="font-size:1.15rem;font-weight:800;color:#f1f5f9;margin:0;letter-spacing:-0.2px;">Borang Permohonan Cuti</h1>
                    <p style="font-size:0.72rem;color:rgba(148,163,184,0.9);margin:0.15rem 0 0;">New Leave Application</p>
                  </div>
                </div>
                <button type="button" onclick="window.setView('dashboard')" style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12);border-radius:8px;color:#94a3b8;padding:0.45rem 0.85rem;cursor:pointer;font-size:0.75rem;font-weight:600;display:flex;align-items:center;gap:0.4rem;">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
                  Kembali
                </button>
              </div>
              <!-- Staff strip -->
              <div style="display:flex;align-items:center;gap:0.65rem;margin-top:1.1rem;padding:0.65rem 0.85rem;background:rgba(255,255,255,0.06);border-radius:10px;border:1px solid rgba(255,255,255,0.08);">
                <div style="width:34px;height:34px;border-radius:9px;background:linear-gradient(135deg,#3b82f6,#8b5cf6);display:flex;align-items:center;justify-content:center;font-weight:800;color:#fff;font-size:0.9rem;flex-shrink:0;">${(user.name||'?')[0].toUpperCase()}</div>
                <div style="flex:1;min-width:0;">
                  <div style="font-size:0.85rem;font-weight:700;color:#f1f5f9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${user.name}</div>
                  <div style="font-size:0.68rem;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${user.branch}</div>
                </div>
                <span style="background:${selCat.color}22;color:${selCat.color};border:1px solid ${selCat.color}44;border-radius:6px;padding:0.2rem 0.6rem;font-size:0.65rem;font-weight:700;letter-spacing:0.3px;white-space:nowrap;">${(user.role||'').toUpperCase()}</span>
              </div>
            </div>

            <div style="padding:1.75rem 2rem;">

            <!-- SECTION: Jenis Cuti -->
            <div style="margin-bottom:1.5rem;">
              <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:1rem;">
                <div style="width:4px;height:18px;border-radius:2px;background:linear-gradient(to bottom,#3b82f6,#8b5cf6);"></div>
                <span style="font-size:0.72rem;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);">01 — Pilih Jenis Cuti</span>
              </div>
              <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:0.5rem;">
                ${filteredCategories.map(cat => {
                  const s = window.getLeaveStats(user, cat.id);
                  const isActive = selectedLeaveType === cat.id;
                  return `
                  <button type="button" onclick="window.setSelectedLeaveType('${cat.id}')" style="
                    padding:0.65rem 0.25rem;
                    border-radius:10px;
                    border:2px solid ${isActive ? cat.color : 'rgba(163,177,198,0.18)'};
                    background:${isActive ? cat.color+'18' : 'rgba(163,177,198,0.05)'};
                    cursor:pointer;
                    text-align:center;
                    transition:all 0.18s;
                    box-shadow:${isActive ? '0 0 0 1px '+cat.color+'30,0 4px 12px '+cat.color+'18' : 'none'};
                    position:relative;
                    overflow:hidden;
                  ">
                    ${isActive ? `<div style="position:absolute;inset:0;background:${cat.color}08;"></div>` : ''}
                    <div style="width:26px;height:26px;border-radius:7px;margin:0 auto 0.4rem;background:${isActive ? cat.color : 'rgba(163,177,198,0.15)'};display:flex;align-items:center;justify-content:center;">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="${isActive ? '#fff' : '#94a3b8'}" stroke-width="2">${leaveIcons[cat.id] || ''}</svg>
                    </div>
                    <div style="font-size:0.58rem;font-weight:800;color:${isActive ? cat.color : 'var(--text)'};line-height:1.2;margin-bottom:0.18rem;">${leaveShort[cat.id] || cat.name.split(' ')[0]}</div>
                    ${s.ent > 0 ? `<div style="font-size:0.54rem;color:${isActive ? cat.color : 'var(--text-muted)'};font-weight:600;">${s.bal.toFixed(0)}/${s.ent}hr</div>` : ''}
                  </button>`;
                }).join('')}
              </div>
            </div>

            <!-- Selected type balance bar -->
            <div style="margin-bottom:1.5rem;padding:0.9rem 1.1rem;border-radius:12px;background:${selCat.color}10;border:1px solid ${selCat.color}28;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.6rem;">
                <div style="display:flex;align-items:center;gap:0.55rem;">
                  <div style="width:28px;height:28px;border-radius:7px;background:${selCat.color};display:flex;align-items:center;justify-content:center;">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">${leaveIcons[selCat.id]||''}</svg>
                  </div>
                  <span style="font-size:0.78rem;font-weight:700;color:${selCat.color};">${selCat.name}</span>
                </div>
                <div style="text-align:right;">
                  <span style="font-size:1.35rem;font-weight:800;color:${selCat.color};line-height:1;">${selBal}</span>
                </div>
              </div>
              ${selEnt > 0 ? `
              <div style="height:6px;background:rgba(163,177,198,0.15);border-radius:3px;overflow:hidden;">
                <div style="height:100%;width:${selPct}%;background:linear-gradient(90deg,${selCat.color},${selCat.color}bb);border-radius:3px;transition:width 0.5s ease;"></div>
              </div>
              <div style="display:flex;justify-content:space-between;margin-top:0.35rem;font-size:0.62rem;color:var(--text-muted);">
                <span>Digunakan: ${selUsed} hari</span>
                <span>${selPct}% terpakai</span>
              </div>` : '<div style="font-size:0.68rem;color:var(--text-muted);">Cuti ini tiada had — diambil mengikut keperluan.</div>'}

              ${isAL ? (() => {
                const st = window.getLeaveStats(user, 'AL');
                const rawEnt = window.getEntitlementAL(user);
                const cfEnt  = parseFloat(user.ent_CF || 0);
                const line = (icon, label, valHtml, color) => `
                  <div style="display:flex;justify-content:space-between;align-items:center;">
                    <span style="font-size:0.68rem;color:var(--text-muted);display:flex;align-items:center;gap:0.35rem;">${icon}${label}</span>
                    <span style="font-size:0.75rem;font-weight:800;color:${color};">${valHtml}</span>
                  </div>`;
                return `
                <div style="margin-top:0.8rem;border-top:1px solid ${selCat.color}22;padding-top:0.75rem;display:flex;flex-direction:column;gap:0.45rem;">
                  ${line('<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
                    'Jumlah Diperuntukan',
                    `${st.ent} hari${cfEnt > 0 ? ` <span style="font-size:0.6rem;font-weight:500;color:var(--text-muted);">(AL ${rawEnt} + CF ${cfEnt})</span>` : ''}`,
                    'var(--text)')}
                  ${st.usedPre > 0 ? line('<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#0ea5e9" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>', 'Guna Sebelum Sistem', `${st.usedPre.toFixed(1)} hari`, '#0ea5e9') : ''}
                  ${line('<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/></svg>', 'Digunakan (Sistem)', `${st.used.toFixed(1)} hari`, '#ef4444')}
                  ${st.pelarasan > 0 ? line('<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>', 'Pelarasan HR', `${st.pelarasan.toFixed(1)} hari`, '#f59e0b') : ''}
                  ${line('<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>', 'Baki AL Sebenar', `${st.bal.toFixed(1)} hari`, '#10b981')}
                </div>`;
              })() : ''}
            </div>

            ${(() => {
                if (!isAL) return '';
                const cfEnt = parseFloat(user.ent_CF) || 0;
                if (cfEnt <= 0) return '';
                const cfUsed = leaveRecords.filter(r => r.ic === user.ic && r.status === 'APPROVED' && r.type === 'CF').reduce((acc, r) => acc + parseFloat(r.days || 0), 0);
                const cfBal = cfEnt - cfUsed;
                if (cfBal <= 0) return '';
                return `
                <div style="padding:0.85rem 1rem;border-radius:10px;background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.25);display:flex;align-items:flex-start;gap:0.75rem;margin-bottom:1rem;">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" style="flex-shrink:0;margin-top:1px;"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                    <div>
                        <div style="font-size:0.75rem;font-weight:700;color:#f59e0b;text-transform:uppercase;letter-spacing:0.5px;">Baki Bawa Dari Tahun Lepas</div>
                        <div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.15rem;"><strong style="color:var(--text);">${cfBal} hari</strong> (daripada ${cfEnt}) — akan digunakan dahulu sebelum AL biasa ditolak.</div>
                    </div>
                </div>`;
            })()}

            ${isMC ? `
                <div style="padding:0.85rem 1rem;border-radius:10px;background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.2);display:flex;align-items:flex-start;gap:0.75rem;margin-bottom:1rem;">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" style="flex-shrink:0;margin-top:1px;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                    <div style="font-size:0.72rem;color:var(--text-muted);line-height:1.4;">
                        <strong style="color:#3b82f6;">Medical Leave (MC)</strong> — ${(() => { const _b = branches.find(b => b.name === user.branch); const _trg = _b && _b.state === 'Terengganu'; return _trg ? 'Dihantar <strong>terus kepada HOD / PIC_HOD</strong> cawangan anda untuk semakan &amp; kelulusan.' : 'Dihantar <strong>terus kepada HR</strong> untuk semakan &amp; kelulusan, tanpa melalui HOD / Supervisor.'; })()} Tiada had notis 3/7 hari. Sila pastikan Sijil Sakit (MC) disertakan.
                    </div>
                </div>
            ` : ''}

            <!-- SECTION: Tarikh Cuti -->
            <div style="margin-bottom:1.5rem;">
              <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.85rem;">
                <div style="width:4px;height:18px;border-radius:2px;background:linear-gradient(to bottom,#10b981,#06b6d4);"></div>
                <span style="font-size:0.72rem;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);">02 — Tarikh Cuti</span>
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;margin-bottom:0.75rem;">
                <div>
                  <label style="font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);display:block;margin-bottom:0.4rem;">Tarikh Mula</label>
                  <input type="date" class="neu-inset" value="${leaveStartDate}" onchange="window.updateLeaveDate('start', this.value)" style="color-scheme:light;font-weight:600;font-size:0.88rem;">
                </div>
                <div>
                  <label style="font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);display:block;margin-bottom:0.4rem;">Tarikh Tamat</label>
                  <input type="date" class="neu-inset" value="${leaveEndDate}" onchange="window.updateLeaveDate('end', this.value)" style="color-scheme:light;font-weight:600;font-size:0.88rem;">
                </div>
              </div>
              <div style="display:flex;align-items:center;justify-content:space-between;padding:0.65rem 1rem;border-radius:10px;background:linear-gradient(135deg,rgba(16,185,129,0.07),rgba(59,130,246,0.07));border:1px solid rgba(59,130,246,0.15);">
                <div style="display:flex;align-items:center;gap:0.5rem;font-size:0.72rem;font-weight:600;color:var(--text-muted);">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                  Jumlah Tempoh Cuti
                </div>
                <div style="display:flex;align-items:baseline;gap:0.35rem;">
                  <span style="font-size:1.5rem;font-weight:800;background:linear-gradient(135deg,#10b981,#3b82f6);-webkit-background-clip:text;-webkit-text-fill-color:transparent;line-height:1;">
                    ${(() => {
                      if (!leaveStartDate || !leaveEndDate) { const t = new Date().toISOString().split('T')[0]; leaveStartDate = t; leaveEndDate = t; }
                      const s = new Date(leaveStartDate), e = new Date(leaveEndDate);
                      if (isNaN(s) || isNaN(e)) return '?';
                      let d = Math.floor((e - s) / (1000*60*60*24)) + 1;
                      if (applyHalfDay) d -= 0.5;
                      return d > 0 ? d : '—';
                    })()}
                  </span>
                  <span style="font-size:0.72rem;font-weight:700;color:var(--text-muted);">HARI</span>
                </div>
              </div>
              ${user.category === 'Doctor' ? `
              <div style="display:flex;align-items:center;gap:0.6rem;margin-top:0.75rem;padding:0.65rem 0.85rem;border-radius:8px;background:rgba(163,177,198,0.08);border:1px solid rgba(163,177,198,0.15);cursor:pointer;" onclick="document.getElementById('halfDayCheck').click()">
                <input type="checkbox" id="halfDayCheck" ${applyHalfDay ? 'checked' : ''} onclick="event.stopPropagation()" onchange="window.toggleHalfDay(this.checked)" style="width:1rem;height:1rem;cursor:pointer;accent-color:var(--primary);">
                <label for="halfDayCheck" onclick="event.stopPropagation()" style="margin:0;cursor:pointer;font-size:0.75rem;font-weight:600;color:var(--text-muted);">Mohon Separuh Hari — tolak 0.5 hari dari baki</label>
              </div>
              ` : ''}
            </div>

            <!-- SECTION: Maklumat Tambahan -->
            <div style="margin-bottom:1.5rem;">
              <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.85rem;">
                <div style="width:4px;height:18px;border-radius:2px;background:linear-gradient(to bottom,#8b5cf6,#ec4899);"></div>
                <span style="font-size:0.72rem;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);">03 — Maklumat Tambahan</span>
              </div>
              <div style="display:flex;flex-direction:column;gap:0.85rem;">
                <div>
                  <label style="font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);display:block;margin-bottom:0.4rem;">Sebab Permohonan</label>
                  <textarea class="neu-inset" placeholder="Nyatakan sebab permohonan cuti..." style="height:90px;font-size:0.85rem;resize:vertical;"></textarea>
                </div>
                <div>
                  <label style="font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);display:block;margin-bottom:0.4rem;">Pengganti Tugas (Handover)</label>
                  <input type="text" id="handover-input" class="neu-inset" placeholder="Nama rakan sekerja yang menggantikan..." style="font-size:0.85rem;">
                </div>
              </div>
            </div>

            ${isMC ? `
                <div style="margin-bottom:1.5rem;">
                  <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.85rem;">
                    <div style="width:4px;height:18px;border-radius:2px;background:linear-gradient(to bottom,#10b981,#3b82f6);"></div>
                    <span style="font-size:0.72rem;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);">Dokumen Wajib</span>
                    <span style="font-size:0.65rem;background:rgba(239,68,68,0.12);color:#ef4444;border:1px solid rgba(239,68,68,0.2);border-radius:6px;padding:0.15rem 0.5rem;font-weight:700;">★ WAJIB</span>
                  </div>
                  <div style="padding:1rem;border-radius:12px;border:1.5px dashed rgba(59,130,246,0.3);background:rgba(59,130,246,0.03);">
                    <div style="font-size:0.75rem;font-weight:600;color:var(--text-muted);margin-bottom:0.75rem;">Sila muat naik MC yang dikeluarkan oleh doktor (JPG/PNG/PDF, maks 10MB)</div>
                    <div style="display:flex;align-items:center;gap:0.75rem;">
                      <input type="file" id="mc-upload" accept="image/jpeg,image/png,image/jpg,application/pdf" style="display:none;" onchange="window.handleFileSelect(this, 'mc-filename', 'mc-notice')">
                      <button type="button" onclick="document.getElementById('mc-upload').click()" style="padding:0.55rem 1rem;border-radius:8px;border:1px solid rgba(59,130,246,0.3);background:rgba(59,130,246,0.1);color:#3b82f6;font-size:0.75rem;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:0.4rem;white-space:nowrap;">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                        PILIH FAIL MC
                      </button>
                      <span id="mc-filename" style="font-size:0.72rem;color:var(--text-muted);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">Tiada fail dipilih</span>
                    </div>
                    <div id="mc-notice" style="margin-top:0.75rem;padding:0.6rem 0.85rem;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.18);border-radius:8px;font-size:0.72rem;color:#ef4444;display:flex;align-items:center;gap:0.5rem;font-weight:700;">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12.01" y2="8"/><line x1="12" y1="12" x2="12" y2="16"/></svg>
                      MC BELUM DIMUAT NAIK — WAJIB SEBELUM HANTAR
                    </div>
                  </div>
                </div>
            ` : ''}

            ${isEhsan ? `
                <div style="margin-bottom:1.5rem;padding:1rem;border-radius:12px;border:1.5px dashed rgba(239,68,68,0.3);background:rgba(239,68,68,0.03);">
                  <div style="font-size:0.75rem;font-weight:700;color:#ef4444;text-transform:uppercase;margin-bottom:0.6rem;">Surat Kematian — Wajib Muat Naik</div>
                  <div style="font-size:0.7rem;color:var(--text-muted);margin-bottom:0.75rem;">Cuti Ehsan hanya untuk kematian ayah, ibu, suami, isteri, atau anak. Had: 3 hari sahaja. <strong>(JPG/PNG/PDF, maks 10MB)</strong></div>
                  <div style="display:flex;align-items:center;gap:0.75rem;">
                    <input type="file" id="ehsan-upload" accept="image/jpeg,image/png,image/jpg,application/pdf" style="display:none;" onchange="window.handleFileSelect(this, 'ehsan-filename')">
                    <button type="button" onclick="document.getElementById('ehsan-upload').click()" style="padding:0.55rem 1rem;border-radius:8px;border:1px solid rgba(239,68,68,0.3);background:rgba(239,68,68,0.1);color:#ef4444;font-size:0.75rem;font-weight:700;cursor:pointer;white-space:nowrap;">PILIH FAIL</button>
                    <span id="ehsan-filename" style="font-size:0.72rem;color:var(--text-muted);">Tiada fail dipilih</span>
                  </div>
                </div>
            ` : ''}

            ${isEMG ? `
                <div style="margin-bottom:1.5rem;">
                  <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.85rem;">
                    <div style="width:4px;height:18px;border-radius:2px;background:linear-gradient(to bottom,#ef4444,#f97316);"></div>
                    <span style="font-size:0.72rem;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);">Bukti Kecemasan</span>
                    <span style="font-size:0.65rem;background:rgba(239,68,68,0.12);color:#ef4444;border:1px solid rgba(239,68,68,0.2);border-radius:6px;padding:0.15rem 0.5rem;font-weight:700;">★ WAJIB</span>
                  </div>
                  <div style="padding:1rem;border-radius:12px;border:1.5px dashed rgba(249,115,22,0.3);background:rgba(249,115,22,0.03);">
                    <div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:0.75rem;">Sila muat naik gambar/bukti berkaitan (contoh: gambar banjir, kerosakan kenderaan dll) <strong>(JPG/PNG/PDF, maks 10MB)</strong></div>
                    <div style="display:flex;align-items:center;gap:0.75rem;">
                      <input type="file" id="emg-upload" accept="image/jpeg,image/png,image/jpg,application/pdf" style="display:none;" onchange="window.handleFileSelect(this, 'emg-filename')">
                      <button type="button" onclick="document.getElementById('emg-upload').click()" style="padding:0.55rem 1rem;border-radius:8px;border:1px solid rgba(249,115,22,0.3);background:rgba(249,115,22,0.1);color:#f97316;font-size:0.75rem;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:0.4rem;white-space:nowrap;">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                        PILIH FAIL BUKTI
                      </button>
                      <span id="emg-filename" style="font-size:0.72rem;color:var(--text-muted);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">Tiada fail dipilih</span>
                    </div>
                  </div>
                </div>
            ` : ''}

            <!-- SECTION: Pelulus Peringkat 0 — TL selector untuk op-balok -->
            ${(() => {
              const _fIsOpBalok = window.getStaffGroup(user) === 'operation_balok' &&
                  !!(approvalRouting['operation_balok'] || {}).needs_tl;
              if (!_fIsOpBalok) return '';
              const _tlList = staffList.filter(s =>
                  s.role === 'team_leader' && (s.branch || '').includes('Balok') && !s.inactive
              );
              return `
            <div style="margin-bottom:1.5rem;">
              <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.85rem;">
                <div style="width:4px;height:18px;border-radius:2px;background:linear-gradient(to bottom,#f43f5e,#fb7185);"></div>
                <span style="font-size:0.72rem;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);">04 — Pelulus Peringkat 0 (Team Leader)</span>
                <span style="font-size:0.62rem;background:rgba(244,63,94,0.12);color:#f43f5e;border:1px solid rgba(244,63,94,0.25);border-radius:5px;padding:0.1rem 0.45rem;font-weight:700;">★ WAJIB</span>
              </div>
              <div style="position:relative;">
                <select id="tl-select" class="neu-inset" style="appearance:none;padding-right:2.5rem;font-weight:600;color-scheme:light;font-size:0.85rem;border:1.5px solid rgba(244,63,94,0.4);background:rgba(244,63,94,0.03);" onchange="this.style.border='1.5px solid '+(this.value?'rgba(16,185,129,0.4)':'rgba(244,63,94,0.4)');this.style.background=this.value?'rgba(16,185,129,0.03)':'rgba(244,63,94,0.03)'">
                  <option value="">-- Pilih Team Leader (Sokongan Peringkat 0) — WAJIB --</option>
                  ${_tlList.length ? _tlList.map(s => `<option value="${s.ic}">${s.name} (Team Leader)</option>`).join('') : '<option value="" disabled>-- Tiada Team Leader didaftarkan --</option>'}
                </select>
                <div style="position:absolute;right:1rem;top:50%;transform:translateY(-50%);pointer-events:none;color:var(--text-muted);">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                </div>
              </div>
              <div style="font-size:0.7rem;color:#f43f5e;margin-top:0.5rem;font-weight:600;">⚠️ Pilih Team Leader yang akan menyokong permohonan anda sebelum dihantar ke Supervisor.</div>
            </div>`;
            })()}

            <!-- SECTION: Pelulus Peringkat 1 — sembunyikan untuk op-balok jika needs_tl aktif (MC kini ikut step penuh seperti AL) -->
            ${(() => {
              const _isOpBalokTL = window.getStaffGroup(user) === 'operation_balok' &&
                  !!(approvalRouting['operation_balok'] || {}).needs_tl;
              if (_isOpBalokTL) return ''; // P1 auto (Supervisor Balok) — pilih auto
              return `
            <div style="margin-bottom:1.5rem;">
              <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.85rem;">
                <div style="width:4px;height:18px;border-radius:2px;background:linear-gradient(to bottom,#f59e0b,#ef4444);"></div>
                <span style="font-size:0.72rem;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);">04 — Pelulus Peringkat 1</span>
                <span style="font-size:0.62rem;background:rgba(239,68,68,0.12);color:#ef4444;border:1px solid rgba(239,68,68,0.25);border-radius:5px;padding:0.1rem 0.45rem;font-weight:700;">★ WAJIB</span>
              </div>
              <div style="position:relative;">
                    <select id="hod-select" class="neu-inset" required style="appearance:none;padding-right:2.5rem;font-weight:600;color-scheme:light;font-size:0.85rem;border:1.5px solid rgba(239,68,68,0.4);background:rgba(239,68,68,0.03);" onchange="this.style.border='1.5px solid '+(this.value?'rgba(16,185,129,0.4)':'rgba(239,68,68,0.4)');this.style.background=this.value?'rgba(16,185,129,0.03)':'rgba(239,68,68,0.03)'">
                        <option value="">-- Pilih Pelulus Peringkat 1 (WAJIB) --</option>
                        ${(() => {
                            const approvers = window.getRoutingP1Approvers(user);
                            if (!approvers.length) return '<option value="" disabled>-- Tiada Pelulus (HR/Admin akan luluskan terus) --</option>';
                            const rl = { doctor_pic:'Doctor PIC', hod_balok:'HOD Balok', supervisor:'Supervisor' };
                            return approvers.map(s => `<option value="${s.ic}">${s.name} (${rl[s.role]||s.role.toUpperCase()})</option>`).join('');
                        })()}
                    </select>
                    <div style="position:absolute;right:1rem;top:50%;transform:translateY(-50%);pointer-events:none;color:var(--text-muted);">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                    </div>
              </div>
            </div>`;
            })()}

            ${(() => {
                const branchObj = branches.find(b => b.name === user.branch);
                const isPahang = branchObj && branchObj.state === 'Pahang';
                const isTerengganu = branchObj && branchObj.state === 'Terengganu';
                const isBentong = user.branch === 'Uni Klinik Bentong';
                const isMCKIP = user.branch === 'Klinik Syed Badaruddin MCKIP';
                const isBalokStaff = user.branch === 'Klinik Syed Badaruddin Balok (HQ)';
                const isDoctor = user.category === 'Doctor';

                let step1Who, step1Note, flowColor, flowIcon;

                if (isDoctor) {
                    if (isPahang && !isBentong && !isMCKIP) {
                        step1Who = 'Supervisor — Klinik Syed Badaruddin Balok (HQ)';
                        step1Note = 'Doktor Pahang (kecuali MCKIP & Bentong) mesti mendapat sokongan Supervisor Balok terlebih dahulu.';
                        flowColor = '#4361ee';
                        flowIcon = 'M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z';
                    } else if (isBentong) {
                        step1Who = 'Doctor PIC — Uni Klinik Bentong';
                        step1Note = 'Doktor Bentong mendapat kelulusan Doctor PIC cawangan sendiri.';
                        flowColor = '#7c3aed';
                        flowIcon = 'M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z';
                    } else if (isMCKIP) {
                        step1Who = 'Doctor PIC — Klinik Syed Badaruddin MCKIP';
                        step1Note = 'Doktor MCKIP mendapat kelulusan Doctor PIC cawangan sendiri.';
                        flowColor = '#7c3aed';
                        flowIcon = 'M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z';
                    } else if (isTerengganu) {
                        step1Who = 'Doctor PIC — Cawangan Terengganu';
                        step1Note = 'Doktor Terengganu mendapat kelulusan Doctor PIC cawangan masing-masing.';
                        flowColor = '#0d9488';
                        flowIcon = 'M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z';
                    } else {
                        step1Who = 'Doctor PIC Cawangan';
                        step1Note = 'Sila pilih Doctor PIC daripada senarai di atas.';
                        flowColor = '#059669';
                        flowIcon = 'M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z';
                    }
                } else if (user.category === 'Admin Staff') {
                    const _isBalokHQ = user.branch === 'Klinik Syed Badaruddin Balok (HQ)';
                    step1Who = _isBalokHQ ? 'HOD Balok — Klinik Syed Badaruddin Balok (HQ)' : `Doctor PIC — ${user.branch || 'Klinik Anda'}`;
                    step1Note = _isBalokHQ ? 'Staff admin Balok HQ mendapat kelulusan HOD Balok pada peringkat pertama.' : 'Staff admin mendapat kelulusan Doctor PIC klinik masing-masing pada peringkat pertama.';
                    flowColor = '#0ea5e9';
                    flowIcon = 'M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z';
                } else {
                    // Operation staff
                    if (isBalokStaff) {
                        step1Who = 'Supervisor — Klinik Syed Badaruddin Balok (HQ)';
                        step1Note = 'Staff operasi Balok mendapat sokongan Supervisor Balok pada peringkat pertama.';
                    } else {
                        step1Who = `Doctor PIC — ${user.branch || 'Cawangan Anda'}`;
                        step1Note = 'Staff operasi cawangan mendapat sokongan Doctor PIC cawangan masing-masing pada peringkat pertama.';
                    }
                    flowColor = '#0d9488';
                    flowIcon = 'M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z';
                }

                const arrow = `<div style="padding-left:11px;color:var(--text-muted);">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><polyline points="19 12 12 19 5 12"></polyline></svg>
                </div>`;

                // 3-step flow untuk operation staff Balok jika needs_tl aktif
                const isOpBalokTL = user.category === 'Operation Staff' && isBalokStaff &&
                    !!(approvalRouting['operation_balok'] || {}).needs_tl;

                if (isOpBalokTL) {
                    return `
                    <div style="border-radius:14px;border:1.5px solid #f43f5e33;background:rgba(244,63,94,0.04);padding:1.1rem 1.25rem;margin-bottom:0.25rem;">
                        <div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:0.85rem;">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f43f5e" stroke-width="2.5"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                            <span style="font-size:0.78rem;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:#f43f5e;">Aliran Kelulusan Cuti — Staff Operasi Balok (3 Peringkat)</span>
                        </div>
                        <div style="display:flex;flex-direction:column;gap:0.55rem;">

                            <!-- Peringkat 0: TL -->
                            <div style="display:flex;align-items:flex-start;gap:0.75rem;">
                                <div style="flex-shrink:0;width:24px;height:24px;border-radius:50%;background:#f43f5e;display:flex;align-items:center;justify-content:center;color:#fff;font-size:0.65rem;font-weight:800;margin-top:1px;">P0</div>
                                <div>
                                    <div style="font-size:0.82rem;font-weight:700;color:var(--text);">Sokongan Peringkat 0</div>
                                    <div style="font-size:0.78rem;color:#f43f5e;font-weight:600;margin-top:0.1rem;">Team Leader — Klinik Syed Badaruddin Balok (HQ)</div>
                                    <div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.1rem;">Permohonan perlu disokong oleh Team Leader Balok terlebih dahulu sebelum ke Supervisor.</div>
                                </div>
                            </div>

                            ${arrow}

                            <!-- Peringkat 1: Supervisor -->
                            <div style="display:flex;align-items:flex-start;gap:0.75rem;">
                                <div style="flex-shrink:0;width:24px;height:24px;border-radius:50%;background:#f59e0b;display:flex;align-items:center;justify-content:center;color:#fff;font-size:0.65rem;font-weight:800;margin-top:1px;">P1</div>
                                <div>
                                    <div style="font-size:0.82rem;font-weight:700;color:var(--text);">Nilai & Lulus Peringkat 1</div>
                                    <div style="font-size:0.78rem;color:#f59e0b;font-weight:600;margin-top:0.1rem;">Supervisor — Klinik Syed Badaruddin Balok (HQ)</div>
                                    <div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.1rem;">Supervisor menilai dan meluluskan selepas sokongan Team Leader diterima.</div>
                                </div>
                            </div>

                            ${arrow}

                            <!-- Peringkat 2: HR/Admin -->
                            <div style="display:flex;align-items:flex-start;gap:0.75rem;">
                                <div style="flex-shrink:0;width:24px;height:24px;border-radius:50%;background:#059669;display:flex;align-items:center;justify-content:center;color:#fff;font-size:0.65rem;font-weight:800;margin-top:1px;">P2</div>
                                <div>
                                    <div style="font-size:0.82rem;font-weight:700;color:var(--text);">Kelulusan Akhir Peringkat 2</div>
                                    <div style="font-size:0.78rem;color:#059669;font-weight:600;margin-top:0.1rem;">HR / Admin — KSB HQ</div>
                                    <div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.1rem;">Cuti hanya dikira SAH selepas HR/Admin beri kelulusan akhir.</div>
                                </div>
                            </div>

                        </div>
                    </div>`;
                }

                return `
                <div style="border-radius:14px;border:1.5px solid ${flowColor}33;background:${flowColor}0d;padding:1.1rem 1.25rem;margin-bottom:0.25rem;">
                    <div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:0.85rem;">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${flowColor}" stroke-width="2.5"><path d="${flowIcon}"></path></svg>
                        <span style="font-size:0.78rem;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:${flowColor};">Aliran Kelulusan Cuti${isDoctor ? ' — Doktor' : user.category === 'Admin Staff' ? ' — Staff Admin' : ' — Staff Operasi'}</span>
                    </div>

                    <div style="display:flex;flex-direction:column;gap:0.55rem;">

                        <!-- Step 1 -->
                        <div style="display:flex;align-items:flex-start;gap:0.75rem;">
                            <div style="flex-shrink:0;width:24px;height:24px;border-radius:50%;background:${flowColor};display:flex;align-items:center;justify-content:center;color:#fff;font-size:0.72rem;font-weight:800;margin-top:1px;">1</div>
                            <div>
                                <div style="font-size:0.82rem;font-weight:700;color:var(--text);">Sokongan Peringkat 1</div>
                                <div style="font-size:0.78rem;color:${flowColor};font-weight:600;margin-top:0.1rem;">${step1Who}</div>
                                <div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.1rem;">${step1Note}</div>
                            </div>
                        </div>

                        ${arrow}

                        <!-- Step 2 -->
                        <div style="display:flex;align-items:flex-start;gap:0.75rem;">
                            <div style="flex-shrink:0;width:24px;height:24px;border-radius:50%;background:#059669;display:flex;align-items:center;justify-content:center;color:#fff;font-size:0.72rem;font-weight:800;margin-top:1px;">2</div>
                            <div>
                                <div style="font-size:0.82rem;font-weight:700;color:var(--text);">Kelulusan Akhir Peringkat 2</div>
                                <div style="font-size:0.78rem;color:#059669;font-weight:600;margin-top:0.1rem;">HR / Admin — KSB HQ</div>
                                <div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.1rem;">Cuti hanya dikira SAH selepas HR/Admin beri kelulusan akhir.</div>
                            </div>
                        </div>

                        ${arrow}

                        ${isDoctor ? `
                        <!-- Locum info -->
                        <div style="display:flex;align-items:flex-start;gap:0.75rem;">
                            <div style="flex-shrink:0;width:24px;height:24px;border-radius:50%;background:#3b82f6;display:flex;align-items:center;justify-content:center;color:#fff;font-size:0.78rem;font-weight:800;margin-top:1px;">i</div>
                            <div>
                                <div style="font-size:0.82rem;font-weight:700;color:var(--primary);">Maklumat Doktor Locum (Pilihan)</div>
                                <div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.1rem;">Boleh diisi nama doktor locum, tarikh &amp; masa penggantian untuk rujukan akan datang. Tidak diwajibkan untuk meluluskan permohonan.</div>
                            </div>
                        </div>` : ''}

                    </div>
                </div>`;
            })()}

            <!-- Submit -->
            <button type="submit" style="width:100%;padding:0.95rem;border-radius:14px;border:none;cursor:pointer;background:linear-gradient(135deg,#3b82f6 0%,#8b5cf6 100%);color:#fff;font-size:0.9rem;font-weight:800;letter-spacing:0.5px;display:flex;justify-content:center;align-items:center;gap:0.6rem;box-shadow:0 8px 24px rgba(59,130,246,0.35);transition:all 0.2s;margin-top:0.5rem;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
              HANTAR PERMOHONAN
            </button>

            </div><!-- end padding div -->
            </form>

          <!-- Right Panel: Summary Widgets -->
          <div class="info-panel" style="display:flex;flex-direction:column;gap:1.25rem;">

            <!-- Notice: Polisi Notis — sembunyi untuk cuti dikecualikan (MC/Kecemasan/Ehsan — tiada had notis 3/7 hari) -->
            ${!isNoticeExempt ? `
            <div class="glass-card" style="padding:1.25rem;border:1px solid rgba(59,130,246,0.2);background:rgba(59,130,246,0.03);">
              <div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:1rem;">
                <div style="width:32px;height:32px;border-radius:9px;background:rgba(59,130,246,0.12);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                </div>
                <div>
                  <div style="font-size:0.75rem;font-weight:700;color:#3b82f6;">Polisi Notis Minimum</div>
                  <div style="font-size:0.65rem;color:var(--text-muted);">Sila hantar permohonan dalam tempoh ini</div>
                </div>
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.65rem;">
                <div style="padding:0.75rem;border-radius:10px;background:rgba(59,130,246,0.06);border:1px solid rgba(59,130,246,0.12);text-align:center;">
                  <div style="font-size:0.6rem;color:var(--text-muted);font-weight:600;text-transform:uppercase;margin-bottom:0.3rem;">Staff Admin</div>
                  <div style="font-size:1.3rem;font-weight:800;color:#3b82f6;line-height:1;">3</div>
                  <div style="font-size:0.62rem;color:var(--text-muted);">hari sebelum</div>
                </div>
                <div style="padding:0.75rem;border-radius:10px;background:rgba(139,92,246,0.06);border:1px solid rgba(139,92,246,0.12);text-align:center;">
                  <div style="font-size:0.6rem;color:var(--text-muted);font-weight:600;text-transform:uppercase;margin-bottom:0.3rem;">Operasi / Doktor</div>
                  <div style="font-size:1.3rem;font-weight:800;color:#8b5cf6;line-height:1;">7</div>
                  <div style="font-size:0.62rem;color:var(--text-muted);">hari sebelum</div>
                </div>
              </div>
            </div>
            ` : ''}

            <!-- Leave Balances Card -->
            <div class="glass-card" style="padding:1.25rem;">
              <div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:1.1rem;">
                <div style="width:32px;height:32px;border-radius:9px;background:linear-gradient(135deg,#10b981,#3b82f6);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                </div>
                <div>
                  <div style="font-size:0.75rem;font-weight:700;">Baki Cuti Anda</div>
                  <div style="font-size:0.63rem;color:var(--text-muted);">${user.name} · ${(user.role||'').toUpperCase()}</div>
                </div>
              </div>
              ${[
                { type: 'AL', label: 'Annual Leave', color: '#3b82f6' },
                { type: 'MC', label: 'Medical Leave', color: '#10b981' },
                { type: 'HL', label: 'Hospitalisasi', color: '#06b6d4' },
              ].map(item => {
                const st = window.getLeaveStats(user, item.type);
                // Semua jenis (termasuk AL) ikut getLeaveStats — sumber rasmi tunggal.
                const dispEnt = st.ent;
                const dispBal = st.bal;
                const pct = dispEnt > 0 ? Math.min(100, Math.round((st.used / dispEnt) * 100)) : 0;
                return `
                <div style="margin-bottom:0.85rem;">
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.3rem;">
                    <span style="font-size:0.72rem;font-weight:600;">${item.label}</span>
                    <div style="display:flex;align-items:center;gap:0.4rem;">
                      <span style="font-size:0.8rem;font-weight:800;color:${item.color};">${parseFloat(dispBal.toFixed(1))}</span>
                      <span style="font-size:0.62rem;color:var(--text-muted);">/ ${dispEnt} hari</span>
                    </div>
                  </div>
                  <div style="height:5px;background:rgba(163,177,198,0.15);border-radius:3px;overflow:hidden;">
                    <div style="height:100%;width:${pct}%;background:${item.color};border-radius:3px;transition:width 0.4s;"></div>
                  </div>
                </div>`;
              }).join('')}
            </div>

            <!-- Approval Flow (contextual) -->
            <div class="glass-card" style="padding:1.25rem;border:1px solid rgba(163,177,198,0.2);">
              <div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:1rem;">
                <div style="width:32px;height:32px;border-radius:9px;background:rgba(245,158,11,0.12);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                </div>
                <div>
                  <div style="font-size:0.75rem;font-weight:700;">Aliran Kelulusan</div>
                  <div style="font-size:0.63rem;color:var(--text-muted);">${user.category} · ${user.branch.split(' ').slice(0,3).join(' ')}</div>
                </div>
              </div>
              ${(() => {
                const branchObj = branches.find(b => b.name === user.branch);
                const isPahang = branchObj && branchObj.state === 'Pahang';
                const isBentong = user.branch === 'Uni Klinik Bentong';
                const isMCKIP = user.branch === 'Klinik Syed Badaruddin MCKIP';
                const isBalokStaff = user.branch === 'Klinik Syed Badaruddin Balok (HQ)';
                const isDoctor = user.category === 'Doctor';
                let step1Who;
                if (isDoctor) {
                  if (isPahang && !isBentong && !isMCKIP) step1Who = 'Supervisor Balok';
                  else step1Who = 'Doctor PIC Cawangan';
                } else if (user.category === 'Admin Staff') {
                  const _isBalokHQ2 = user.branch === 'Klinik Syed Badaruddin Balok (HQ)';
                  step1Who = _isBalokHQ2 ? 'HOD Balok — Balok (HQ)' : 'Doctor PIC — ' + (user.branch||'').split(' ').slice(0,3).join(' ');
                } else {
                  step1Who = isBalokStaff ? 'Supervisor Balok' : 'Doctor PIC Cawangan';
                }
                const isOperationBalok = user.category === 'Operation Staff' && isBalokStaff;
                let steps;
                if (isOperationBalok) {
                  steps = [
                    { n:1, label:'Sokongan Peringkat 0', who: 'Team Leader — Balok', color: '#f43f5e' },
                    { n:2, label:'Nilai Peringkat 1', who: 'Supervisor — Balok', color: '#f59e0b' },
                    { n:3, label:'Kelulusan Akhir', who: 'HR / Admin — KSB HQ', color: '#10b981' },
                  ];
                } else {
                  steps = [
                    { n:1, label:'Sokongan Peringkat 1', who: step1Who, color: '#f59e0b' },
                    { n:2, label:'Kelulusan Akhir', who: 'HR / Admin — KSB HQ', color: '#10b981' },
                  ];
                  if (isDoctor) steps.push({ n:'!', label:'Wajib: Maklumat Locum', who: 'Diisi oleh HOD/Supervisor sebelum lulus', color: '#ef4444' });
                }
                return steps.map((s, i) => `
                  ${i > 0 ? '<div style="padding-left:14px;color:var(--text-muted);margin:0.3rem 0;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg></div>' : ''}
                  <div style="display:flex;align-items:flex-start;gap:0.65rem;">
                    <div style="flex-shrink:0;width:24px;height:24px;border-radius:50%;background:${s.color}22;border:1.5px solid ${s.color}55;display:flex;align-items:center;justify-content:center;font-size:0.65rem;font-weight:800;color:${s.color};">${s.n}</div>
                    <div>
                      <div style="font-size:0.73rem;font-weight:700;">${s.label}</div>
                      <div style="font-size:0.68rem;color:${s.color};font-weight:600;margin-top:0.1rem;">${s.who}</div>
                    </div>
                  </div>`).join('');
              })()}
            </div>

            <!-- Recent Activity -->
            <div class="glass-card" style="padding:1.25rem;">
              <div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:1rem;">
                <div style="width:32px;height:32px;border-radius:9px;background:rgba(249,115,22,0.12);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#f97316" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                </div>
                <div style="font-size:0.75rem;font-weight:700;">Aktiviti Terkini</div>
              </div>
              <div style="display:flex;flex-direction:column;gap:0.55rem;">
                ${leaveRecords.filter(r => r.ic === user.ic).reverse().slice(0,5).map(act => {
                  const sc = act.status === 'APPROVED' ? '#10b981' : (act.status||'').includes('REJECT') ? '#ef4444' : '#f59e0b';
                  const catC = leaveCategories.find(c => c.id === act.type);
                  return `
                  <div style="display:flex;justify-content:space-between;align-items:center;padding:0.6rem 0.75rem;border-radius:9px;background:rgba(163,177,198,0.06);border:1px solid rgba(163,177,198,0.1);">
                    <div style="display:flex;align-items:center;gap:0.55rem;min-width:0;">
                      <div style="width:8px;height:8px;border-radius:50%;background:${catC ? catC.color : '#94a3b8'};flex-shrink:0;"></div>
                      <div style="min-width:0;">
                        <div style="font-size:0.72rem;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${act.type} — ${act.days} hari</div>
                        <div style="font-size:0.62rem;color:var(--text-muted);">${act.startDate || ''}</div>
                      </div>
                    </div>
                    <span style="font-size:0.6rem;font-weight:700;padding:0.15rem 0.45rem;border:1px solid ${sc}44;border-radius:6px;color:${sc};background:${sc}12;white-space:nowrap;margin-left:0.5rem;">${(act.status||'').replace('TL APPROVED','TL OK').replace('HOD APPROVED','HOD OK').replace('RECOMMENDED','RECOM')}</span>
                  </div>`;
                }).join('')}
                ${leaveRecords.filter(r => r.ic === user.ic).length === 0 ? '<div style="font-size:0.75rem;color:var(--text-muted);text-align:center;padding:1rem;">Tiada rekod setakat ini.</div>' : ''}
              </div>
            </div>

          </div>
        </div>
      `;


    case 'management':
      const managementRKey = window.rbacMatrix[user.role] ? user.role : 'staff';
      const userPerms = window.rbacMatrix[managementRKey] || {};
      
      const hasAnyManagementAccess = (
        userPerms.management || 
        userPerms.manage_pending || 
        userPerms.manage_staff || 
        userPerms.manage_branches || 
        userPerms.manage_audit || 
        userPerms.manage_login_audit || 
        userPerms.manage_reports || 
        userPerms.manage_access
      );

      if (!hasAnyManagementAccess) {
          return `<div style="padding: 5rem; text-align: center; color: var(--danger); font-size: 1.25rem;">Akses Dihalang. Anda tidak mempunyai kebenaran pengurusan.</div>`;
      }
      
      const isFullAdmin = userPerms.manage_staff || userPerms.manage_branches || userPerms.manage_access;
      const canManageBranches = userPerms.manage_branches;
      const canManageRouting = userPerms.manage_routing;

      // Auto-redirection logic for unauthorized tabs
      const tabPermissions = {
          'pending': userPerms.manage_pending,
          'staff': userPerms.manage_staff,
          'branches': userPerms.manage_branches,
          'routing': userPerms.manage_routing,
          'master_audit': userPerms.manage_audit,
          'login_audit': userPerms.manage_login_audit,
          'hr_reports': userPerms.manage_reports,
          'locum_records': userPerms.locum_records,
          'whatsapp_settings': userPerms.wa_setting,
          'access_control': userPerms.manage_access,
          'roles_categories': userPerms.manage_roles_categories,
          'public_holidays': userPerms.manage_holidays,
          'policy_editor': userPerms.manage_policy,
          'balance_view': userPerms.manage_reports,
          'reg_requests': ['admin', 'hr', 'super_admin'].includes(user.role)
      };

      if (!tabPermissions[managementTab]) {
          const firstAllowed = Object.keys(tabPermissions).find(tab => tabPermissions[tab]);
          if (firstAllowed) {
              managementTab = firstAllowed;
          }
      }
      
      // Tapis staff mengikut skop negeri pengguna
      const userStateScope = window.getUserStateScope(user);
      let filteredStaff = staffList.filter(s => {
          if (s.role === 'super_admin') return false;
          if (userStateScope === 'all') return true;
          const sBranch = branches.find(b => b.name === s.branch);
          return sBranch && sBranch.state === userStateScope;
      });
      if (manageBranchFilter !== 'All') {
          filteredStaff = filteredStaff.filter(s => s.branch === manageBranchFilter);
      }
      if (manageSearchQuery) {
          const q = manageSearchQuery.toLowerCase();
          filteredStaff = filteredStaff.filter(s => (s.name || '').toLowerCase().includes(q) || (s.ic || '').includes(q));
      }
      if (manageRoleFilter !== 'SEMUA') {
          filteredStaff = filteredStaff.filter(s => (s.role || 'staff') === manageRoleFilter);
      }
      if (manageCategoryFilter !== 'SEMUA') {
          filteredStaff = filteredStaff.filter(s => (s.category || '') === manageCategoryFilter);
      }
      // Toggle: ON = tunjuk HANYA yang tidak aktif, OFF = tunjuk HANYA yang aktif
      if (showInactiveStaff) {
          filteredStaff = filteredStaff.filter(s => s.inactive);
      } else {
          filteredStaff = filteredStaff.filter(s => !s.inactive);
      }

      // Staff management: accordion by state > branch, compact card rows
      let branchIdCounter = 0;

      // Kumpulkan branch yang diketahui
      const knownBranchNames = new Set(branches.map(b => b.name));

      const stateGroupedHtml = ['Pahang', 'Terengganu'].map(function(stateName) {
        const stateBranches = branches.filter(function(b) { return b.state === stateName; });
        const stateStaff = filteredStaff.filter(function(s) { return stateBranches.some(function(b) { return b.name === s.branch; }); });
        if (stateStaff.length === 0) return '';
        const stateColor = stateName === 'Pahang' ? '#4361ee' : '#0d9488';
        const stateBg    = stateName === 'Pahang' ? 'rgba(67,97,238,0.07)' : 'rgba(13,148,136,0.07)';
        const stateBar   = stateName === 'Pahang' ? '#4361ee' : '#0d9488';

        const branchPanels = stateBranches.map(function(branchObj) {
          const branchStaff = filteredStaff.filter(function(s) { return s.branch === branchObj.name; });
          if (branchStaff.length === 0) return '';
          const bid = 'b' + (++branchIdCounter);

          // Role mini-summary for accordion header
          const roleCounts = {};
          branchStaff.forEach(function(s) {
            const cat = s.category || s.role || 'Lain';
            roleCounts[cat] = (roleCounts[cat] || 0) + 1;
          });
          const rolePills = Object.keys(roleCounts).map(function(cat) {
            return '<span style="font-size:0.7rem;color:var(--text-muted);background:rgba(163,177,198,0.25);padding:0.1rem 0.45rem;border-radius:999px;white-space:nowrap;">'
              + roleCounts[cat] + ' ' + cat + '</span>';
          }).join(' ');

          // Compact card rows (no table, no horizontal scroll)
          const staffRows = branchStaff.map(function(staff) {
            const al = window.getLeaveStats(staff, 'AL');
            const mc = window.getLeaveStats(staff, 'MC');
            const hl = window.getLeaveStats(staff, 'HL');
            const alLow = al.bal <= 3 && al.ent > 0;
            const inBadge = staff.inactive
              ? '<span style="background:rgba(239,68,68,0.1);color:#ef4444;font-size:0.68rem;padding:0.08rem 0.35rem;border-radius:4px;font-weight:700;border:1px solid rgba(239,68,68,0.2);vertical-align:middle;margin-left:4px;">TIDAK AKTIF</span>'
              : '';
            return '<div style="display:flex;align-items:center;gap:0.75rem;padding:0.55rem 0.9rem;border-bottom:1px solid rgba(163,177,198,0.15);">'
              // Name + role
              + '<div style="flex:1;min-width:0;">'
              +   '<div style="font-size:0.85rem;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + staff.name + inBadge + '</div>'
              +   '<div style="display:flex;align-items:center;gap:0.35rem;margin-top:0.15rem;">'
              +     '<span style="font-size:0.7rem;font-weight:600;color:#fff;background:#4361ee;padding:0.08rem 0.4rem;border-radius:4px;text-transform:capitalize;">' + (staff.role || '-') + '</span>'
              +     '<span style="font-size:0.7rem;color:var(--text-muted);">' + (staff.category || '') + '</span>'
              +   '</div>'
              + '</div>'
              // AL / MC / HL compact stats
              + '<div style="display:flex;gap:0.5rem;align-items:center;flex-shrink:0;">'
              +   statCell('AL', al.used.toFixed(1), window.getEntitlementAL(staff).toFixed(1), alLow ? '#ef4444' : '#38bdf8')
              +   statCell('MC', mc.used, mc.ent, '#10b981')
              +   statCell('HL', hl.used, hl.ent, '#06b6d4')
              + '</div>'
              // Edit + Delete buttons
              + '<button class="btn-logout" data-ic="' + staff.ic + '" onclick="window.setEditingStaff(this.dataset.ic)" style="flex-shrink:0;width:auto;padding:0.2rem 0.65rem;font-size:0.75rem;">Edit</button>'
              + '<button class="btn-logout" data-ic="' + staff.ic + '" onclick="window.deleteStaff(this.dataset.ic)" style="flex-shrink:0;width:auto;padding:0.2rem 0.65rem;font-size:0.75rem;background:rgba(239,68,68,0.1);color:#ef4444;border:1px solid rgba(239,68,68,0.25);" title="Buang dari sistem">&#10005;</button>'
              + '</div>';
          }).join('');

          function statCell(label, used, ent, color) {
            return '<div style="text-align:center;min-width:38px;">'
              +   '<div style="font-size:0.62rem;font-weight:600;color:var(--text-muted);letter-spacing:0.3px;">' + label + '</div>'
              +   '<div style="font-size:0.8rem;font-weight:700;color:' + color + ';line-height:1.1;">' + used
              +     '<span style="font-size:0.6rem;color:var(--text-muted);font-weight:400;">/' + ent + '</span>'
              +   '</div>'
              + '</div>';
          }

          // Accordion wrapper
          return '<div style="border:1px solid rgba(163,177,198,0.3);border-radius:10px;margin-bottom:0.4rem;overflow:hidden;">'
            // Header (clickable)
            + '<div data-bid="' + bid + '" onclick="window.toggleBranch(this.dataset.bid)"'
            +   ' style="display:flex;align-items:center;justify-content:space-between;padding:0.55rem 0.9rem;background:rgba(255,255,255,0.55);cursor:pointer;user-select:none;gap:0.75rem;">'
            +   '<div style="display:flex;align-items:center;gap:0.6rem;flex-wrap:wrap;flex:1;min-width:0;">'
            +     '<i data-lucide="building-2" width="14" height="14" style="color:var(--text-muted);flex-shrink:0;"></i>'
            +     '<span style="font-size:0.88rem;font-weight:700;color:var(--text-soft);white-space:nowrap;">' + branchObj.name + '</span>'
            +     '<span style="font-size:0.72rem;font-weight:600;color:var(--text-muted);background:rgba(163,177,198,0.2);padding:0.1rem 0.5rem;border-radius:999px;">' + branchStaff.length + ' staf</span>'
            +     rolePills
            +   '</div>'
            +   '<i id="bch-' + bid + '" data-lucide="chevron-down" width="15" height="15" style="color:var(--text-muted);transition:transform 0.2s;flex-shrink:0;"></i>'
            + '</div>'
            // Content (collapsed by default)
            + '<div id="bc-' + bid + '" style="display:none;background:#fff;">'
            +   staffRows
            + '</div>'
            + '</div>';
        }).join('');

        // State section header + branch panels
        return '<div style="margin-bottom:1.25rem;">'
          + '<div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:0.5rem;padding:0.5rem 0.9rem;background:' + stateBg + ';border-radius:8px;border-left:3px solid ' + stateBar + ';">'
          +   '<i data-lucide="map-pin" width="14" height="14" style="color:' + stateColor + ';"></i>'
          +   '<span style="font-size:0.9rem;font-weight:700;color:' + stateColor + ';">Negeri ' + stateName + '</span>'
          +   '<span style="font-size:0.75rem;color:var(--text-muted);">' + stateStaff.length + ' staf</span>'
          + '</div>'
          + branchPanels
          + '</div>';
      }).join('') + (function() {
        // Kumpulan "Lain-lain" — staff yang branchnya tidak termasuk dalam Pahang/Terengganu
        const unmatched = filteredStaff.filter(function(s) { return !knownBranchNames.has(s.branch); });
        if (unmatched.length === 0) return '';
        const bid = 'b' + (++branchIdCounter);
        const rows = unmatched.map(function(staff) {
          const al = window.getLeaveStats(staff, 'AL');
          const mc = window.getLeaveStats(staff, 'MC');
          const hl = window.getLeaveStats(staff, 'HL');
          const alLow = al.bal <= 3 && al.ent > 0;
          const inBadge = staff.inactive
            ? '<span style="background:rgba(239,68,68,0.1);color:#ef4444;font-size:0.68rem;padding:0.08rem 0.35rem;border-radius:4px;font-weight:700;border:1px solid rgba(239,68,68,0.2);vertical-align:middle;margin-left:4px;">TIDAK AKTIF</span>'
            : '';
          function statCell(label, used, ent, color) {
            return '<div style="text-align:center;min-width:38px;">'
              + '<div style="font-size:0.62rem;font-weight:600;color:var(--text-muted);letter-spacing:0.3px;">' + label + '</div>'
              + '<div style="font-size:0.8rem;font-weight:700;color:' + color + ';line-height:1.1;">' + used
              + '<span style="font-size:0.6rem;color:var(--text-muted);font-weight:400;">/' + ent + '</span>'
              + '</div></div>';
          }
          return '<div style="display:flex;align-items:center;gap:0.75rem;padding:0.55rem 0.9rem;border-bottom:1px solid rgba(163,177,198,0.15);">'
            + '<div style="flex:1;min-width:0;">'
            +   '<div style="font-size:0.85rem;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + staff.name + inBadge + '</div>'
            +   '<div style="display:flex;align-items:center;gap:0.35rem;margin-top:0.15rem;">'
            +     '<span style="font-size:0.7rem;font-weight:600;color:#fff;background:#4361ee;padding:0.08rem 0.4rem;border-radius:4px;text-transform:capitalize;">' + (staff.role || '-') + '</span>'
            +     '<span style="font-size:0.7rem;color:var(--text-muted);">' + (staff.branch || '—') + '</span>'
            +   '</div>'
            + '</div>'
            + '<div style="display:flex;gap:0.5rem;align-items:center;flex-shrink:0;">'
            +   statCell('AL', al.used.toFixed(1), window.getEntitlementAL(staff).toFixed(1), alLow ? '#ef4444' : '#38bdf8')
            +   statCell('MC', mc.used, mc.ent, '#10b981')
            +   statCell('HL', hl.used, hl.ent, '#06b6d4')
            + '</div>'
            + '<button class="btn-logout" data-ic="' + staff.ic + '" onclick="window.setEditingStaff(this.dataset.ic)" style="flex-shrink:0;width:auto;padding:0.2rem 0.65rem;font-size:0.75rem;">Edit</button>'
            + '<button class="btn-logout" data-ic="' + staff.ic + '" onclick="window.deleteStaff(this.dataset.ic)" style="flex-shrink:0;width:auto;padding:0.2rem 0.65rem;font-size:0.75rem;background:rgba(239,68,68,0.1);color:#ef4444;border:1px solid rgba(239,68,68,0.25);" title="Buang dari sistem">&#10005;</button>'
            + '</div>';
        }).join('');
        return '<div style="margin-bottom:1.25rem;">'
          + '<div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:0.5rem;padding:0.5rem 0.9rem;background:rgba(163,177,198,0.1);border-radius:8px;border-left:3px solid #94a3b8;">'
          +   '<span style="font-size:0.9rem;font-weight:700;color:#64748b;">Lain-lain / Tiada Cawangan</span>'
          +   '<span style="font-size:0.75rem;color:var(--text-muted);">' + unmatched.length + ' staf</span>'
          + '</div>'
          + '<div style="border:1px solid rgba(163,177,198,0.3);border-radius:10px;overflow:hidden;">'
          + '<div data-bid="' + bid + '" onclick="window.toggleBranch(this.dataset.bid)" style="display:flex;align-items:center;justify-content:space-between;padding:0.55rem 0.9rem;background:rgba(255,255,255,0.55);cursor:pointer;user-select:none;">'
          +   '<span style="font-size:0.88rem;font-weight:700;color:var(--text-soft);">Tidak Ditetapkan</span>'
          +   '<span style="font-size:0.72rem;font-weight:600;color:var(--text-muted);background:rgba(163,177,198,0.2);padding:0.1rem 0.5rem;border-radius:999px;">' + unmatched.length + ' staf</span>'
          + '</div>'
          + '<div id="bc-' + bid + '" style="display:none;background:#fff;">' + rows + '</div>'
          + '</div></div>';
      })();

      return `
      ${(() => {
        // compute active group from current managementTab
        const activeGroup = _tabToGroup[managementTab] || managementGroup;
        const pendingCount = userPerms.manage_pending ? (() => {
          const isFullBoss = ['admin','hr','super_admin'].includes(user.role);
          const isHODRole  = ['doctor_pic','hod_balok','supervisor'].includes(user.role);
          const isTL = user.role === 'team_leader';
          if (isFullBoss) return leaveRecords.filter(r => window.canManageRequest(user, r) && ['HOD APPROVED','HOD RECOMMENDED','PENDING'].includes(r.status)).length;
          if (isTL) return leaveRecords.filter(r => window.canManageRequest(user, r) && r.status === 'PENDING').length;
          if (isHODRole) return leaveRecords.filter(r => window.canManageRequest(user, r) && ['PENDING','TL APPROVED'].includes(r.status)).length;
          return 0;
        })() : 0;
        const pendingRegs = ['admin','hr','super_admin'].includes(user.role) ? registrationRequests.filter(r => r.status === 'pending').length : 0;

        // which main groups are visible for this role
        const showApprovals = userPerms.manage_pending;
        const showPeople    = userPerms.manage_staff || userPerms.manage_branches || userPerms.manage_roles_categories || ['admin','hr','super_admin'].includes(user.role);
        const showReports   = userPerms.manage_reports || userPerms.locum_records || userPerms.manage_audit || userPerms.manage_login_audit;
        const showConfig    = userPerms.manage_routing || userPerms.manage_access || userPerms.manage_holidays || userPerms.wa_setting || userPerms.manage_policy;

        const grpBtn = (key, icon, label, badge, show) => !show ? '' : `
          <button onclick="window.setManageGroup('${key}')" style="display:flex;align-items:center;gap:0.5rem;padding:0.6rem 1.1rem;border-radius:10px;border:none;cursor:pointer;font-size:0.82rem;font-weight:700;transition:all 0.2s;position:relative;
            ${activeGroup === key ? 'background:var(--card-bg);color:var(--primary);box-shadow:0 2px 10px rgba(0,0,0,0.12);' : 'background:transparent;color:var(--text-muted);'}">
            ${icon}${label}${badge > 0 ? `<span style="position:absolute;top:3px;right:4px;min-width:16px;height:16px;padding:0 3px;border-radius:999px;background:#ef4444;color:#fff;font-size:0.6rem;font-weight:800;display:flex;align-items:center;justify-content:center;">${badge}</span>` : ''}
          </button>`;

        return `
        <!-- Level 1: Kumpulan Utama -->
        <div style="display:flex;gap:0.3rem;margin-bottom:0.75rem;background:rgba(163,177,198,0.18);padding:0.35rem;border-radius:14px;overflow-x:auto;flex-wrap:wrap;">
          ${grpBtn('approvals','<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>','Kelulusan', pendingCount, showApprovals)}
          ${grpBtn('people','<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>','Staf & Cawangan', pendingRegs, showPeople)}
          ${grpBtn('reports','<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>','Laporan & Log', 0, showReports)}
          ${grpBtn('config','<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93A10 10 0 0 0 4.93 19.07M19.07 4.93A10 10 0 0 1 4.93 19.07M12 2v2M12 20v2M2 12h2M20 12h2"/></svg>','Konfigurasi', 0, showConfig)}
        </div>

        <!-- Level 2: Sub-tab dalam kumpulan aktif -->
        <div style="display:flex;gap:0.3rem;margin-bottom:1.75rem;background:rgba(163,177,198,0.1);padding:0.3rem;border-radius:10px;overflow-x:auto;flex-wrap:wrap;">
          ${activeGroup === 'approvals' ? `
            ${userPerms.manage_pending ? (() => {
              const isFullBoss = ['admin','hr','super_admin'].includes(user.role);
              const isHODRole  = ['doctor_pic','hod_balok','supervisor'].includes(user.role);
              const isTL = user.role === 'team_leader';
              let label = 'Kelulusan Tertunggak';
              if (isFullBoss) { const p2=leaveRecords.filter(r=>window.canManageRequest(user,r)&&['HOD APPROVED','HOD RECOMMENDED'].includes(r.status)).length; const by=leaveRecords.filter(r=>window.canManageRequest(user,r)&&r.status==='PENDING').length; label=`Kelulusan${p2>0?` ✅${p2}`:''}${by>0?` ⚡${by}`:''}`; }
              else if (isTL) { const p0=leaveRecords.filter(r=>window.canManageRequest(user,r)&&r.status==='PENDING').length; label=`Sokongan TL (${p0})`; }
              else if (isHODRole) { const p1=leaveRecords.filter(r=>window.canManageRequest(user,r)&&r.status==='PENDING').length; const tl=leaveRecords.filter(r=>window.canManageRequest(user,r)&&r.status==='TL APPROVED').length; label=`Nilai Cuti${tl>0?` 🟡${tl}`:''}${p1>0?` ⚡${p1}`:''}`; }
              return `<button class="neu-tab ${managementTab==='pending'?'active':''}" onclick="window.setManageTab('pending')" style="border-radius:8px;">${label}</button>`;
            })() : ''}
          ` : ''}
          ${activeGroup === 'people' ? `
            ${userPerms.manage_staff ? `<button class="neu-tab ${managementTab==='staff'?'active':''}" onclick="window.setManageTab('staff')" style="border-radius:8px;">Staff</button>` : ''}
            ${userPerms.manage_branches ? `<button class="neu-tab ${managementTab==='branches'?'active':''}" onclick="window.setManageTab('branches')" style="border-radius:8px;">Cawangan</button>` : ''}
            ${userPerms.manage_roles_categories ? `<button class="neu-tab ${managementTab==='roles_categories'?'active':''}" onclick="window.setManageTab('roles_categories')" style="border-radius:8px;">Peranan & Kategori</button>` : ''}
            ${['admin','hr','super_admin'].includes(user.role) ? (() => { const pr=registrationRequests.filter(r=>r.status==='pending').length; return `<button class="neu-tab ${managementTab==='reg_requests'?'active':''}" onclick="window.setManageTab('reg_requests')" style="border-radius:8px;">Daftar Baharu${pr>0?` <span style="background:#ef4444;color:#fff;border-radius:999px;padding:0 5px;font-size:0.65rem;font-weight:800;">${pr}</span>`:''}</button>`; })() : ''}
          ` : ''}
          ${activeGroup === 'reports' ? `
            ${userPerms.manage_reports ? `<button class="neu-tab ${managementTab==='hr_reports'?'active':''}" onclick="window.setManageTab('hr_reports')" style="border-radius:8px;">HR Reports</button>` : ''}
            ${userPerms.manage_reports ? `<button class="neu-tab ${managementTab==='balance_view'?'active':''}" onclick="window.setManageTab('balance_view')" style="border-radius:8px;">📊 Baki Cuti</button>` : ''}
            ${userPerms.locum_records ? `<button class="neu-tab ${managementTab==='locum_records'?'active':''}" onclick="window.setManageTab('locum_records')" style="border-radius:8px;">Rekod Locum</button>` : ''}
            ${userPerms.manage_audit ? `<button class="neu-tab ${managementTab==='master_audit'?'active':''}" onclick="window.setManageTab('master_audit')" style="border-radius:8px;">Master Logs</button>` : ''}
            ${userPerms.manage_login_audit ? `<button class="neu-tab ${managementTab==='login_audit'?'active':''}" onclick="window.setManageTab('login_audit')" style="border-radius:8px;">Login Logs</button>` : ''}
          ` : ''}
          ${activeGroup === 'config' ? `
            ${userPerms.manage_policy ? `<button class="neu-tab ${managementTab==='policy_editor'?'active':''}" onclick="window.setManageTab('policy_editor')" style="border-radius:8px;">📋 Editor Polisi</button>` : ''}
            ${userPerms.manage_routing ? `<button class="neu-tab ${managementTab==='routing'?'active':''}" onclick="window.setManageTab('routing')" style="border-radius:8px;">Laluan Kelulusan</button>` : ''}
            ${userPerms.manage_access ? `<button class="neu-tab ${managementTab==='access_control'?'active':''}" onclick="window.setManageTab('access_control')" style="border-radius:8px;">Access Control</button>` : ''}
            ${userPerms.manage_holidays ? `<button class="neu-tab ${managementTab==='public_holidays'?'active':''}" onclick="window.setManageTab('public_holidays')" style="border-radius:8px;">Cuti Umum</button>` : ''}
            ${userPerms.wa_setting ? `<button class="neu-tab ${managementTab==='whatsapp_settings'?'active':''}" onclick="window.setManageTab('whatsapp_settings')" style="border-radius:8px;color:#25d366;">WA Settings</button>` : ''}
          ` : ''}
        </div>`;
      })()}

        ${managementTab === 'pending' ? `
            <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 2rem;">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--warning, #f59e0b)" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
              <h2 style="font-size: 1.25rem; font-weight: 600;">Awaiting Authorization</h2>
            </div>
            
            <div class="approval-grid">
              ${leaveRecords.filter(r => {
                  if (['REJECTED', 'CANCELLED', 'APPROVED'].includes(r.status)) return false;
                  if (!window.canManageRequest(user, r)) return false;
                  const isFullBoss = ['admin', 'hr', 'super_admin'].includes(user.role);
                  const isHODRole = ['doctor_pic','hod_balok','supervisor'].includes(user.role);
                  const isTL = user.role === 'team_leader';
                  if (isTL) {
                      // Team Leader hanya nampak PENDING staf operasi Balok
                      return r.status === 'PENDING';
                  }
                  if (isHODRole) {
                      if (r.status === 'PENDING') {
                          // Supervisor Balok: jangan tunjuk PENDING staf operasi Balok jika needs_tl aktif
                          if (user.role === 'supervisor' && (approvalRouting['operation_balok'] || {}).needs_tl) {
                              const ap = staffList.find(s => s.ic === r.ic);
                              if (ap && window.getStaffGroup(ap) === 'operation_balok') return false;
                          }
                          return true;
                      }
                      // Supervisor: tunjuk TL APPROVED untuk staf operasi Balok jika needs_tl aktif
                      if (r.status === 'TL APPROVED' && (approvalRouting['operation_balok'] || {}).needs_tl) {
                          const ap = staffList.find(s => s.ic === r.ic);
                          return !!(ap && window.getStaffGroup(ap) === 'operation_balok');
                      }
                      // Supervisor: also show HOD APPROVED doctor records for locum editing
                      if (r.status === 'HOD APPROVED') {
                          const ap = staffList.find(s => s.ic === r.ic);
                          return !!(ap && ap.category === 'Doctor');
                      }
                      return false;
                  }
                  // isFullBoss: jangan tunjuk TL APPROVED op-balok — tunggu Supervisor lulus dulu
                  if (r.status === 'TL APPROVED' && (approvalRouting['operation_balok'] || {}).needs_tl) {
                      const ap = staffList.find(s => s.ic === r.ic);
                      if (ap && window.getStaffGroup(ap) === 'operation_balok') return false;
                  }
                  return true; // isFullBoss sees all other pending statuses
              }).map(req => {
                const isFullBoss = ['admin', 'hr', 'super_admin'].includes(user.role);
                const showHODIndicator = req.status === 'HOD RECOMMENDED' || req.status === 'HOD APPROVED';
                const showTLIndicator = req.status === 'TL APPROVED';
                
                return `
                <div class="neu-panel">
                  <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1.5rem;">
                     <div>
                        <div style="font-size: 1.1rem; font-weight: 600; margin-bottom: 0.25rem; text-transform: uppercase;">${req.name} ${showHODIndicator ? '🟢' : showTLIndicator ? '🟡' : ''}</div>
                        <div style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 0.25rem;">${req.ic}</div>
                        <div style="font-size: 0.7rem; color: var(--primary); text-transform: uppercase; font-weight: 600;">${req.branch}</div>
                     </div>
                     <span style="color: ${req.typeColor}; background: rgba(163,177,198,0.2); padding: 0.25rem 0.75rem; border-radius: 12px; font-weight: 700; font-size: 0.8rem; border: 1px solid var(--border);">${req.type}</span>
                  </div>

                  <div style="padding: 0.5rem 0.75rem; border-radius: 8px; margin-bottom: 1rem; display: flex; align-items: center; gap: 0.5rem; font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; ${showHODIndicator ? 'background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.2); color: var(--accent);' : showTLIndicator ? 'background: rgba(234,179,8,0.1); border: 1px solid rgba(234,179,8,0.3); color: #ca8a04;' : 'background: rgba(251,191,36,0.1); border: 1px solid rgba(251,191,36,0.25); color: #b45309;'}">
                      ${(() => {
                          if (showHODIndicator) return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg> Peringkat 2 — Menunggu Kelulusan HR/Admin';
                          if (showTLIndicator) return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg> Peringkat 1 — Telah Disokong TL, Menunggu Nilai Supervisor';
                          const reqBr = branches.find(b => b.name === req.branch);
                          const isTrg = reqBr && reqBr.state === 'Terengganu';
                          const isOpBalok = (() => { const ap = staffList.find(s => s.ic === req.ic); return ap && window.getStaffGroup(ap) === 'operation_balok'; })();
                          if (isOpBalok) return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg> Peringkat 0 — Menunggu Sokongan Team Leader';
                          return isTrg
                              ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg> Menunggu Kelulusan HOD (Terengganu — 1 Peringkat)'
                              : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg> Peringkat 1 — Menunggu Sokongan HOD/PIC_HOD';
                      })()}
                  </div>

                  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.5rem;">
                      <div class="neu-inset" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.25rem;">
                          <span style="font-size: 1.5rem; font-weight: 700;">${req.days}</span>
                          <span style="font-size: 0.65rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;">Days</span>
                      </div>
                      <div class="neu-inset" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.5rem; text-align: center;">
                          <span style="font-size: 0.8rem; font-weight: 600;">${req.startDate === req.endDate ? req.startDate : `${req.startDate} to ${req.endDate}`}</span>
                          <span style="font-size: 0.65rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;">Period</span>
                      </div>
                  </div>

                  <div class="neu-inset" style="font-style: italic; margin-bottom: 1.5rem; font-size: 0.9rem; color: var(--text-muted);">
                      "${req.reason}"
                  </div>

                  ${req.proofUrl ? `
                  <a href="${req.proofUrl}" target="_blank" rel="noopener" title="Lihat bukti yang dimuat naik pemohon${req.proofName ? ' (' + req.proofName + ')' : ''}" style="display:flex;align-items:center;justify-content:center;gap:0.5rem;width:100%;margin-bottom:1.5rem;padding:0.7rem 1rem;border-radius:10px;color:#10b981;border:1px solid rgba(16,185,129,0.35);background:rgba(16,185,129,0.08);font-weight:700;font-size:0.85rem;text-decoration:none;">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
                      📎 Lihat Bukti${req.proofName ? ` — ${req.proofName}` : ''}
                  </a>` : ''}

                  <div style="display:flex;gap:0.6rem;margin-bottom:1rem;">
                    <button class="neu-btn primary-text" onclick="printLeave(${req.id})" style="flex:1;">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V2h12v7"></path><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
                        Print
                    </button>
                    <button class="neu-btn" onclick="window.resendLeaveWA(${req.id})" style="flex:1;color:#22c55e;border:1px solid rgba(34,197,94,0.3);background:rgba(34,197,94,0.06);" title="Hantar semula notifikasi WhatsApp kepada pelulus semasa">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81a19.79 19.79 0 01-3.07-8.67A2 2 0 012 1h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L6.09 8.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z"></path><polyline points="14 2 14 8 20 8"/></svg>
                        Resend WA
                    </button>
                    <button class="neu-btn" onclick="window.editLeave(${req.id})" style="flex:1;color:#60a5fa;border:1px solid rgba(96,165,250,0.3);background:rgba(96,165,250,0.06);" title="Edit tarikh / bilangan hari / sebab sebelum sokong">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                        Edit
                    </button>
                  </div>

                  ${(() => {
                      const isHODRole = ['doctor_pic','hod_balok','supervisor'].includes(user.role);
                      const isTLRole = user.role === 'team_leader';
                      const isLocumEditMode = isHODRole && req.status === 'HOD APPROVED';
                      if (isLocumEditMode) {
                          // Supervisor sees HOD APPROVED doctor record only for locum editing
                          return `
                          <div style="background:rgba(13,148,136,0.07);border:1.5px solid rgba(13,148,136,0.25);border-radius:10px;padding:0.75rem;margin-bottom:1rem;display:flex;align-items:center;gap:0.6rem;">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0d9488" stroke-width="2.5"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                            <span style="font-size:0.72rem;font-weight:700;color:#0d9488;">Mod Edit Locum — Cuti ini sudah disokong. Kemaskini maklumat locum jika perlu.</span>
                          </div>
                          <button onclick="window.saveLocumEdit(${req.id})" class="neu-btn" style="width:100%;margin-bottom:1rem;background:rgba(13,148,136,0.1);color:#0d9488;border:1.5px solid rgba(13,148,136,0.3);font-weight:700;">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
                            💾 Simpan Kemaskini Locum
                          </button>`;
                      }
                      return `
                      <div style="display: flex; gap: 0.75rem; margin-bottom: 1rem; flex-wrap: wrap;">
                          <button class="neu-btn success-text" style="flex: 1; min-width: 120px;" onclick="window.finalizeLeave(${req.id})">
                             <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                             ${(() => {
                                 if (isFullBoss) return showHODIndicator ? '✅ Luluskan Akhir (Peringkat 2)' : '⚡ Luluskan Terus (Bypass)';
                                 if (isTLRole) return '📋 Sokong & Hantar ke Supervisor';
                                 if (showTLIndicator) return '✅ Lulus & Hantar ke HR/Admin (Peringkat 1)';
                                 const reqB = branches.find(b => b.name === req.branch);
                                 const reqTrg = reqB && reqB.state === 'Terengganu';
                                 return reqTrg ? '✅ Luluskan Cuti' : '📋 Sokong & Hantar ke HR/Admin';
                             })()}
                          </button>
                          <button class="neu-btn danger-text" style="flex: 1; min-width: 100px;" onclick="window.rejectLeave(${req.id})">
                             <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
                             Reject
                          </button>
                          <button class="neu-btn" style="flex: 1; min-width: 100px; color: #94a3b8; border: 1px dashed rgba(255,255,255,0.1);" onclick="window.cancelLeave(${req.id})">
                             <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
                             Batal
                          </button>
                      </div>`;
                  })()}

                  ${(() => {
                      const applicant = staffList.find(s => s.ic === req.ic);
                      if (applicant && applicant.category === 'Doctor') {
                          const showL2 = showLocum2Set.has(req.id) || !!req.locum2Name;
                          if (showL2 && !showLocum2Set.has(req.id)) showLocum2Set.add(req.id);
                          const l1ok = req.locum1Name && req.locum1Phone && req.locum1Date && req.locum1TimeStart && req.locum1TimeEnd;
                          const l2ok = !showL2 || (req.locum2Name && req.locum2Phone && req.locum2Date && req.locum2TimeStart && req.locum2TimeEnd);
                          const fld = (val) => `font-size:0.8rem;padding:0.5rem;`;
                          const fldSm = (val) => `font-size:0.75rem;padding:0.45rem;color-scheme:light;`;
                          const locumBlock = (n, prefix, nameVal, phoneVal, dateVal, tsVal, teVal, color) => `
                            <div style="background:rgba(255,255,255,0.6);border-radius:10px;padding:0.75rem;border:1px solid rgba(163,177,198,0.3);">
                              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.55rem;">
                                <span style="font-size:0.67rem;font-weight:800;color:${color};text-transform:uppercase;">Locum ${n} ${n===1?'(Pilihan)':''}</span>
                                ${n===2 ? `<button onclick="window.toggleLocum2(${req.id})" style="background:none;border:none;cursor:pointer;color:#dc2626;font-size:0.72rem;font-weight:700;padding:0.1rem 0.4rem;">✕ Buang</button>` : ''}
                              </div>
                              <div style="display:flex;flex-direction:column;gap:0.45rem;">
                                <input type="text" class="neu-inset" value="${nameVal || ''}" placeholder="Nama Doktor Locum..." oninput="window.updateLocumInfo(${req.id},'${prefix}Name',this.value)" style="${fld(nameVal)}">
                                <input type="tel" class="neu-inset" value="${phoneVal || ''}" placeholder="No. Telefon (cth: 601xxxxxxxx)" oninput="window.updateLocumInfo(${req.id},'${prefix}Phone',this.value)" style="${fld(phoneVal)}">
                                <input type="date" class="neu-inset" value="${dateVal || ''}" onchange="window.updateLocumInfo(${req.id},'${prefix}Date',this.value)" style="${fldSm(dateVal)}">
                                <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.4rem;">
                                  <div>
                                    <div style="font-size:0.62rem;color:var(--text-muted);font-weight:600;margin-bottom:0.2rem;">Masa Mula Bertugas</div>
                                    <input type="time" class="neu-inset" value="${tsVal || ''}" onchange="window.updateLocumInfo(${req.id},'${prefix}TimeStart',this.value)" style="${fldSm(tsVal)}width:100%;">
                                  </div>
                                  <div>
                                    <div style="font-size:0.62rem;color:var(--text-muted);font-weight:600;margin-bottom:0.2rem;">Masa Tamat Bertugas</div>
                                    <input type="time" class="neu-inset" value="${teVal || ''}" onchange="window.updateLocumInfo(${req.id},'${prefix}TimeEnd',this.value)" style="${fldSm(teVal)}width:100%;">
                                  </div>
                                </div>
                              </div>
                            </div>`;
                          return `
                            <div style="padding:1rem;background:rgba(59,130,246,0.04);border:1.5px solid rgba(59,130,246,0.18);border-radius:12px;margin-top:0.5rem;display:flex;flex-direction:column;gap:0.9rem;">
                              <div style="display:flex;align-items:center;justify-content:space-between;">
                                <span style="font-size:0.68rem;color:#3b82f6;text-transform:uppercase;font-weight:800;letter-spacing:0.5px;">
                                  📋 Maklumat Doktor Locum — Pilihan (Untuk Rujukan)
                                </span>
                                ${l1ok ? `
                                <button class="neu-btn" onclick="window.printLocumForm(${req.id})" style="padding:0.3rem 0.7rem;font-size:0.65rem;background:rgba(59,130,246,0.08);color:var(--primary);border:1px solid rgba(59,130,246,0.2);">
                                  🖨️ Print Borang Locum
                                </button>` : ''}
                              </div>
                              ${locumBlock(1,'locum1',req.locum1Name,req.locum1Phone,req.locum1Date,req.locum1TimeStart,req.locum1TimeEnd,'#1e40af')}
                              ${showL2
                                ? locumBlock(2,'locum2',req.locum2Name,req.locum2Phone,req.locum2Date,req.locum2TimeStart,req.locum2TimeEnd,'#7c3aed')
                                : `<button onclick="window.toggleLocum2(${req.id})" style="background:rgba(124,58,237,0.07);border:1px dashed rgba(124,58,237,0.35);border-radius:8px;padding:0.5rem;cursor:pointer;color:#7c3aed;font-size:0.75rem;font-weight:700;width:100%;">
                                    + Tambah Locum Kedua
                                  </button>`}
                            </div>
                          `;
                      }
                      return '';
                  })()}

                  ${req.status !== 'PENDING' ? `
                  <div style="margin-top: 1rem; color: var(--primary); font-size: 0.75rem; font-weight: 700; display: flex; align-items: center; gap: 0.5rem; text-transform: uppercase;">
                     <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
                     ${req.status}
                  </div>` : ''}
                </div>
              `;
            }).join('')}
          </div>
        ` : ''}

        ${managementTab === 'whatsapp_settings' && window.rbacMatrix[user.role]?.wa_setting ? (() => {
          const sentCount   = waLogs.filter(l => l.status === 'sent').length;
          const failedCount = waLogs.filter(l => l.status === 'failed').length;
          const allRoles = Object.keys(window.staffConfig.roleLabels);
          const triggers = [
            { key: 'p1_submit',       label: 'Hantar Permohonan',       desc: 'Submit → notify TL (Balok Op) / HOD (Admin)' },
            { key: 'tl_approved',     label: 'TL Lulus → Supervisor',   desc: 'Selepas TL sokong (Balok Op sahaja)' },
            { key: 'p2_p1_approved',  label: 'HOD/Supervisor Lulus',    desc: 'Selepas P1 lulus → notify HR/Admin' },
            { key: 'p3_final',        label: 'Lulus Sepenuhnya',         desc: 'Selepas HR/Admin lulus (APPROVED)' },
            { key: 'overdue_reminder',label: 'Peringatan Tertunggak',    desc: 'Reminder mingguan cuti tertunggak' }
          ];
          const zoneConfig = [
            { key: 'balok',      label: 'Balok',               desc: 'Klinik Syed Badaruddin Balok (HQ)', color: '#f59e0b' },
            { key: 'pahang',     label: 'Cawangan Pahang',     desc: 'Semua cawangan Pahang selain Balok', color: '#3b82f6' },
            { key: 'terengganu', label: 'Cawangan Terengganu', desc: 'Kerteh, Paka, Dungun',               color: '#8b5cf6' }
          ];
          return `
            <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:1.5rem;margin-top:1rem;">
               <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#25d366" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
               <h2 style="font-size:1.25rem;font-weight:600;">WhatsApp Notification Settings</h2>
            </div>

            <!-- WA Settings sub-tabs -->
            <div style="display:flex;gap:0.4rem;margin-bottom:1.75rem;background:rgba(163,177,198,0.1);padding:0.3rem;border-radius:12px;width:fit-content;flex-wrap:wrap;">
              <button onclick="window.setWaSettingsSubTab('token_log')" style="padding:0.5rem 1.1rem;border-radius:9px;border:none;cursor:pointer;font-size:0.8rem;font-weight:700;transition:all 0.2s;${waSettingsSubTab==='token_log' ? 'background:var(--card-bg);color:var(--primary);box-shadow:0 2px 8px rgba(0,0,0,0.12);' : 'background:transparent;color:var(--text-muted);'}">
                <span style="display:flex;align-items:center;gap:0.4rem;">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                  Token &amp; Log
                </span>
              </button>
              <button onclick="window.setWaSettingsSubTab('rbac_notif')" style="padding:0.5rem 1.1rem;border-radius:9px;border:none;cursor:pointer;font-size:0.8rem;font-weight:700;transition:all 0.2s;${waSettingsSubTab==='rbac_notif' ? 'background:var(--card-bg);color:var(--primary);box-shadow:0 2px 8px rgba(0,0,0,0.12);' : 'background:transparent;color:var(--text-muted);'}">
                <span style="display:flex;align-items:center;gap:0.4rem;">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                  RBAC Notifikasi Kelulusan
                </span>
              </button>
            </div>

            ${waSettingsSubTab === 'token_log' ? `
            <!-- Token & Test card -->
            <div class="glass-card fade-in" style="padding:2rem;max-width:600px;margin-bottom:2rem;">
                <div style="margin-bottom:1.5rem;background:rgba(37,211,102,0.1);border-left:4px solid #25d366;padding:1.25rem;border-radius:4px;">
                    <h4 style="color:#25d366;margin-bottom:0.4rem;font-size:0.95rem;">Integration Status: Fonnte.com</h4>
                    <p style="font-size:0.75rem;color:var(--text-muted);line-height:1.5;">Nombor penghantar: <strong>${WHATSAPP_SENDER}</strong></p>
                </div>
                <div class="form-group">
                    <label style="font-size:0.75rem;text-transform:uppercase;font-weight:700;color:var(--text-muted);letter-spacing:1px;">Fonnte API Token</label>
                    <div style="display:flex;gap:0.75rem;margin-top:0.5rem;">
                        <input type="password" id="wa-token-input" class="neu-inset" value="${WHATSAPP_TOKEN}" placeholder="Masukkan API Token dari Fonnte..." style="flex:1;">
                        <button class="btn-primary" onclick="window.saveWAToken(document.getElementById('wa-token-input').value)" style="width:auto;padding:0.75rem 1.5rem;">Save Token</button>
                    </div>
                    <div style="font-size:0.65rem;color:var(--text-muted);margin-top:0.4rem;">Token disimpan secara lokal pada device ini.</div>
                </div>
                <div style="margin-top:2rem;padding-top:1.5rem;border-top:1px solid rgba(163,177,198,0.25);">
                    <h4 style="font-size:0.85rem;margin-bottom:0.75rem;">Test Notification</h4>
                    <div style="display:flex;gap:0.75rem;">
                        <input type="tel" id="wa-test-phone" class="neu-inset" placeholder="Contoh: 60123456789" style="flex:1;">
                        <button class="btn-logout" onclick="window.testWANotification()" style="width:auto;padding:0.75rem 1.5rem;background:rgba(163,177,198,0.2);border:1px solid var(--border);color:var(--primary);">Test Send</button>
                    </div>
                </div>
            </div>

            <!-- WA Log -->
            <div class="glass-card fade-in" style="padding:0;overflow:hidden;">
              <div style="padding:0.85rem 1.25rem;border-bottom:1px solid rgba(163,177,198,0.15);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.75rem;background:rgba(163,177,198,0.04);">
                <div style="display:flex;align-items:center;gap:0.7rem;">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#25d366" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
                  <span style="font-size:0.9rem;font-weight:700;color:var(--text);">Log Notifikasi WhatsApp</span>
                  <span style="font-size:0.72rem;color:var(--text-muted);background:rgba(163,177,198,0.2);padding:0.1rem 0.5rem;border-radius:999px;">${waLogs.length} entri</span>
                </div>
                <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">
                  <span style="font-size:0.75rem;font-weight:700;background:rgba(16,185,129,0.12);color:#10b981;border:1px solid rgba(16,185,129,0.25);border-radius:999px;padding:0.2rem 0.65rem;">✓ ${sentCount} Berjaya</span>
                  <span style="font-size:0.75rem;font-weight:700;background:rgba(239,68,68,0.1);color:#ef4444;border:1px solid rgba(239,68,68,0.2);border-radius:999px;padding:0.2rem 0.65rem;">✗ ${failedCount} Gagal</span>
                  ${waLogs.length > 0 ? `<button onclick="window.clearWALogs()" style="padding:0.3rem 0.8rem;border-radius:999px;border:1px solid rgba(239,68,68,0.3);background:rgba(239,68,68,0.07);font-size:0.75rem;font-weight:600;color:#ef4444;cursor:pointer;">🗑 Kosongkan Log</button>` : ''}
                </div>
              </div>
              ${waLogs.length === 0 ? `
                <div style="padding:3rem;text-align:center;color:var(--text-muted);font-size:0.85rem;">
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.3;margin-bottom:0.75rem;display:block;margin-inline:auto;"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
                  Tiada log notifikasi lagi. Log akan muncul selepas sistem menghantar WhatsApp.
                </div>
              ` : `
              <div style="overflow-x:auto;">
                <table style="width:100%;border-collapse:collapse;font-size:0.78rem;">
                  <thead>
                    <tr style="background:rgba(163,177,198,0.04);border-bottom:1px solid rgba(163,177,198,0.15);">
                      <th style="padding:0.5rem 0.75rem;font-weight:700;font-size:0.67rem;letter-spacing:0.5px;text-transform:uppercase;color:var(--text-muted);text-align:left;white-space:nowrap;">Masa</th>
                      <th style="padding:0.5rem 0.75rem;font-weight:700;font-size:0.67rem;letter-spacing:0.5px;text-transform:uppercase;color:var(--text-muted);text-align:left;white-space:nowrap;">Status</th>
                      <th style="padding:0.5rem 0.75rem;font-weight:700;font-size:0.67rem;letter-spacing:0.5px;text-transform:uppercase;color:var(--text-muted);text-align:left;white-space:nowrap;">Penerima</th>
                      <th style="padding:0.5rem 0.75rem;font-weight:700;font-size:0.67rem;letter-spacing:0.5px;text-transform:uppercase;color:var(--text-muted);text-align:left;white-space:nowrap;">No. Telefon</th>
                      <th style="padding:0.5rem 0.75rem;font-weight:700;font-size:0.67rem;letter-spacing:0.5px;text-transform:uppercase;color:var(--text-muted);text-align:left;">Pratonton Mesej / Sebab Gagal</th>
                      <th style="padding:0.5rem 0.75rem;font-weight:700;font-size:0.67rem;letter-spacing:0.5px;text-transform:uppercase;color:var(--text-muted);text-align:left;white-space:nowrap;">Dihantar Oleh</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${waLogs.map((log, i) => {
                      const d = new Date(log.ts);
                      const timeStr = d.toLocaleDateString('ms-MY', { day:'2-digit', month:'short', year:'2-digit' }) + ' ' + d.toLocaleTimeString('ms-MY', { hour:'2-digit', minute:'2-digit' });
                      const isSent = log.status === 'sent';
                      const rowBg = !isSent ? 'rgba(239,68,68,0.04)' : (i % 2 === 0 ? '' : 'rgba(163,177,198,0.03)');
                      return `
                      <tr style="border-bottom:1px solid rgba(163,177,198,0.08);background:${rowBg};">
                        <td style="padding:0.55rem 0.75rem;white-space:nowrap;color:var(--text-muted);font-size:0.73rem;">${timeStr}</td>
                        <td style="padding:0.55rem 0.75rem;white-space:nowrap;">
                          ${isSent
                            ? `<span style="display:inline-flex;align-items:center;gap:0.3rem;background:rgba(16,185,129,0.12);color:#10b981;border:1px solid rgba(16,185,129,0.25);border-radius:999px;padding:0.18rem 0.6rem;font-size:0.7rem;font-weight:700;"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>Berjaya</span>`
                            : `<span style="display:inline-flex;align-items:center;gap:0.3rem;background:rgba(239,68,68,0.1);color:#ef4444;border:1px solid rgba(239,68,68,0.2);border-radius:999px;padding:0.18rem 0.6rem;font-size:0.7rem;font-weight:700;"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>Gagal</span>`
                          }
                        </td>
                        <td style="padding:0.55rem 0.75rem;font-weight:600;color:var(--text);">${log.name || '—'}</td>
                        <td style="padding:0.55rem 0.75rem;color:var(--text-muted);font-family:monospace;font-size:0.75rem;">${log.phone || '—'}</td>
                        <td style="padding:0.55rem 0.75rem;max-width:320px;">
                          ${!isSent && log.error
                            ? `<span style="color:#ef4444;font-size:0.75rem;font-weight:600;">⚠️ ${log.error}</span>`
                            : `<span style="color:var(--text-muted);font-size:0.75rem;">${(log.preview || '').substring(0, 100)}${(log.preview||'').length > 100 ? '…' : ''}</span>`
                          }
                        </td>
                        <td style="padding:0.55rem 0.75rem;color:var(--text-muted);font-size:0.73rem;white-space:nowrap;">${log.sentBy || '—'}</td>
                      </tr>`;
                    }).join('')}
                  </tbody>
                </table>
              </div>
              `}
            </div>
            ` : ''}

            ${waSettingsSubTab === 'rbac_notif' ? `
            <!-- RBAC Notifikasi Kelulusan -->
            <div style="margin-bottom:1rem;">
              <p style="font-size:0.8rem;color:var(--text-muted);line-height:1.6;">Pilih role yang akan menerima notifikasi WhatsApp bagi setiap peringkat kelulusan cuti, mengikut zon cawangan. Konfigurasi disimpan dalam Firestore dan berkuat kuasa untuk semua pengguna.</p>
            </div>
            ${zoneConfig.map(zone => {
              const cfg = waNotifRbac[zone.key] || {};
              return `
              <div class="glass-card fade-in" style="padding:0;overflow:hidden;margin-bottom:1.5rem;border-top:3px solid ${zone.color};">
                <div style="padding:1rem 1.25rem;border-bottom:1px solid rgba(163,177,198,0.15);background:rgba(163,177,198,0.04);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.75rem;">
                  <div>
                    <div style="display:flex;align-items:center;gap:0.6rem;">
                      <div style="width:10px;height:10px;border-radius:50%;background:${zone.color};flex-shrink:0;"></div>
                      <span style="font-size:0.95rem;font-weight:700;color:var(--text);">${zone.label}</span>
                    </div>
                    <div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.2rem;margin-left:1.1rem;">${zone.desc}</div>
                  </div>
                  <button id="save-rbac-${zone.key}" onclick="window.saveWaNotifRbac('${zone.key}')" style="padding:0.45rem 1.1rem;border-radius:8px;border:1px solid ${zone.color};background:transparent;color:${zone.color};font-size:0.78rem;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:0.4rem;">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                    Simpan ${zone.label}
                  </button>
                </div>
                <div style="overflow-x:auto;">
                  <table style="width:100%;border-collapse:collapse;font-size:0.8rem;">
                    <thead>
                      <tr style="background:rgba(163,177,198,0.06);border-bottom:1px solid rgba(163,177,198,0.15);">
                        <th style="padding:0.65rem 1rem;font-weight:700;font-size:0.67rem;letter-spacing:0.5px;text-transform:uppercase;color:var(--text-muted);text-align:left;white-space:nowrap;min-width:140px;">Role</th>
                        ${triggers.map(t => `
                        <th style="padding:0.65rem 0.75rem;font-weight:700;font-size:0.67rem;letter-spacing:0.5px;text-transform:uppercase;color:var(--text-muted);text-align:center;white-space:nowrap;">
                          <div>${t.label}</div>
                          <div style="font-size:0.6rem;font-weight:400;color:var(--text-muted);opacity:0.7;text-transform:none;letter-spacing:0;">${t.desc}</div>
                        </th>`).join('')}
                      </tr>
                    </thead>
                    <tbody>
                      ${allRoles.map((role, ri) => {
                        const label = window.staffConfig.roleLabels[role] || role;
                        return `
                        <tr style="border-bottom:1px solid rgba(163,177,198,0.07);${ri % 2 === 1 ? 'background:rgba(163,177,198,0.025);' : ''}">
                          <td style="padding:0.55rem 1rem;font-weight:600;color:var(--text);white-space:nowrap;">${label}</td>
                          ${triggers.map(t => {
                            const checked = (cfg[t.key] || []).includes(role);
                            return `
                            <td style="padding:0.55rem 0.75rem;text-align:center;">
                              <label style="display:inline-flex;align-items:center;justify-content:center;cursor:pointer;width:32px;height:32px;border-radius:8px;border:1.5px solid ${checked ? zone.color : 'rgba(163,177,198,0.35)'};background:${checked ? zone.color + '22' : 'transparent'};transition:all 0.15s;">
                                <input type="checkbox" ${checked ? 'checked' : ''} onchange="window.toggleWaNotifRole('${zone.key}','${t.key}','${role}')" style="position:absolute;opacity:0;width:0;height:0;">
                                ${checked ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${zone.color}" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>` : ''}
                              </label>
                            </td>`;
                          }).join('')}
                        </tr>`;
                      }).join('')}
                    </tbody>
                  </table>
                </div>
              </div>`;
            }).join('')}
            ` : ''}
          `;
        })() : ''}

        ${managementTab === 'reg_requests' && ['admin', 'hr', 'super_admin'].includes(user.role) ? `
          <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 2rem; margin-top: 1rem;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><line x1="19" y1="8" x2="19" y2="14"></line><line x1="22" y1="11" x2="16" y2="11"></line></svg>
            <h2 style="font-size: 1.25rem; font-weight: 600;">Permohonan Daftar Baharu</h2>
          </div>

          ${(() => {
            const pending = registrationRequests.filter(r => r.status === 'pending');
            const done = registrationRequests.filter(r => r.status !== 'pending');
            return `
              ${pending.length === 0 ? `
                <div style="text-align: center; padding: 3rem 1rem; color: var(--text-muted);">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity: 0.3; margin-bottom: 1rem;"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><line x1="19" y1="8" x2="19" y2="14"></line><line x1="22" y1="11" x2="16" y2="11"></line></svg>
                  <p>Tiada permohonan baharu yang menunggu kelulusan.</p>
                </div>
              ` : `
                <div style="display: grid; gap: 1rem; margin-bottom: 2rem;">
                  ${pending.map(req => `
                    <div class="glass-card fade-in" style="padding: 1.25rem 1.5rem; border-left: 4px solid #8b5cf6;">
                      <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; flex-wrap: wrap;">
                        <div style="display: flex; align-items: center; gap: 0.85rem;">
                          <div style="width: 44px; height: 44px; border-radius: 50%; background: linear-gradient(135deg,#8b5cf6,#6d28d9); display: flex; align-items: center; justify-content: center; font-size: 1.2rem; font-weight: 700; flex-shrink: 0;">${req.name.charAt(0)}</div>
                          <div>
                            <div style="font-weight: 700; font-size: 0.95rem;">${req.name}</div>
                            <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 0.2rem;">IC: ${req.ic} &nbsp;|&nbsp; ${req.branch}</div>
                            <div style="font-size: 0.78rem; color: var(--text-muted);">${req.category} &nbsp;|&nbsp; 📱 ${req.phone}</div>
                            <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 0.25rem;">Dihantar: ${req.submittedAt ? new Date(req.submittedAt).toLocaleString('ms-MY') : '-'}</div>
                          </div>
                        </div>
                        <div style="display: flex; gap: 0.5rem; flex-shrink: 0; margin-top: 0.25rem;">
                          <button onclick="window.approveRegistration('${req.docId}')" style="padding: 0.5rem 1rem; border-radius: 8px; border: none; cursor: pointer; background: rgba(16,185,129,0.15); color: #10b981; font-size: 0.8rem; font-weight: 700; display: flex; align-items: center; gap: 0.35rem;">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
                            Luluskan
                          </button>
                          <button onclick="window.rejectRegistration('${req.docId}')" style="padding: 0.5rem 1rem; border-radius: 8px; border: none; cursor: pointer; background: rgba(239,68,68,0.1); color: #ef4444; font-size: 0.8rem; font-weight: 700; display: flex; align-items: center; gap: 0.35rem;">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                            Tolak
                          </button>
                        </div>
                      </div>
                    </div>
                  `).join('')}
                </div>
              `}

              ${done.length > 0 ? `
                <div style="margin-top: 1.5rem;">
                  <div style="font-size: 0.75rem; text-transform: uppercase; font-weight: 700; color: var(--text-muted); letter-spacing: 1px; margin-bottom: 0.75rem;">Sejarah Permohonan</div>
                  <div style="display: grid; gap: 0.6rem;">
                    ${done.slice(0, 20).map(req => `
                      <div style="padding: 0.85rem 1.25rem; background: rgba(163,177,198,0.08); border-radius: 10px; display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap;">
                        <div>
                          <span style="font-weight: 600; font-size: 0.875rem;">${req.name}</span>
                          <span style="font-size: 0.75rem; color: var(--text-muted); margin-left: 0.5rem;">${req.ic} — ${req.branch}</span>
                        </div>
                        <span style="padding: 0.2rem 0.75rem; border-radius: 999px; font-size: 0.7rem; font-weight: 700; ${req.status === 'approved' ? 'background: rgba(16,185,129,0.15); color: #10b981;' : 'background: rgba(239,68,68,0.1); color: #ef4444;'}">
                          ${req.status === 'approved' ? 'Diluluskan' : 'Ditolak'}
                        </span>
                      </div>
                    `).join('')}
                  </div>
                </div>
              ` : ''}
            `;
          })()}
        ` : ''}


        ${managementTab === 'master_audit' ? `
          <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 2rem; margin-top: 1rem;">
              <div style="display: flex; align-items: center; gap: 0.75rem;">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#a855f7" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
                <h2 style="font-size: 1.25rem; font-weight: 600;">Master Logs</h2>
              </div>
              ${user.ic === 'super_admin' || user.ic === 'Super Admin' ? `
              <button onclick="if(confirm('Teruskan madam semua cache?')) { localStorage.clear(); window.location.reload(); }" class="neu-btn" style="background: rgba(239, 68, 68, 0.1); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.2); font-size: 0.75rem; padding: 0.5rem 1rem; border-radius: 8px; margin-left: auto;">
                 <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                 Reset System Cache
              </button>
              ` : ''}
          </div>

          <section class="glass-card fade-in" style="padding: 0; overflow: hidden;">
              <div style="overflow-x: auto;">
                  <table class="data-table" style="width: 100%; border-collapse: collapse; margin: 0;">
                      <thead>
                          <tr style="text-transform: uppercase; font-size: 0.65rem; color: var(--text-muted); border-bottom: 1px solid rgba(163,177,198,0.25); letter-spacing: 1px;">
                              <th style="padding: 1.5rem 1rem;">Period</th>
                              <th style="padding: 1.5rem 1rem;">Employee</th>
                              <th style="padding: 1.5rem 1rem;">Leave</th>
                              <th style="padding: 1.5rem 1rem;">Reason</th>
                              <th style="padding: 1.5rem 1rem;">Status</th>
                              <th style="padding: 1.5rem 1rem; text-align: right;">Actions</th>
                          </tr>
                      </thead>
                      <tbody>
                          ${leaveRecords.map((r, index) => `
                          <tr style="border-bottom: 1px solid rgba(255,255,255,0.03); transition: background 0.2s;">
                              <td style="padding: 1.5rem 1rem;">
                                  <div style="font-weight: 700; font-size: 0.8rem;">${r.startDate}</div>
                                  <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 0.25rem;">${r.startDate === r.endDate ? '' : `to ${r.endDate}`}</div>
                              </td>
                              <td style="padding: 1.5rem 1rem;">
                                  <div style="font-weight: 700; font-size: 0.85rem; text-transform: uppercase; margin-bottom: 0.25rem;">${r.name}</div>
                                  <div style="font-size: 0.65rem; color: var(--primary); text-transform: uppercase; font-weight: 600;">${r.branch}</div>
                              </td>
                              <td style="padding: 1.5rem 1rem; font-weight: 700; font-size: 1rem;">
                                  ${r.days}d <span style="font-size: 0.6rem; background: rgba(59,130,246,0.1); color: ${r.typeColor}; padding: 0.2rem 0.5rem; border-radius: 4px; border: 1px solid var(--border); vertical-align: top; margin-left: 4px;">${r.type}</span>
                              </td>
                              <td style="padding: 1.5rem 1rem; font-size: 0.75rem; font-style: italic; color: var(--text-muted); max-width: 250px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                                  ${r.reason}
                              </td>
                              <td style="padding: 1.5rem 1rem;">
                                  <span style="font-size: 0.6rem; font-weight: 700; text-transform: uppercase; padding: 0.35rem 0.75rem; border-radius: 20px; 
                                      ${r.status === 'REJECTED' || r.status === 'CANCELLED' ? 'color: var(--danger); background: rgba(239, 68, 68, 0.1);' :
                                        r.status.includes('HOD') || r.status === 'TL APPROVED' ? 'color: #eab308; background: rgba(234, 179, 8, 0.1);' :
                                        r.status === 'PENDING' ? 'color: #eab308; border: 1px solid rgba(234, 179, 8, 0.4);' :
                                        'color: var(--accent); background: rgba(34, 197, 94, 0.1);'}">
                                      ${r.status}
                                  </span>
                              </td>
                              <td style="padding: 1.5rem 1rem; text-align: right;">
                                  <div style="display: flex; gap: 1.25rem; justify-content: flex-end;">
                                      ${r.proofUrl ? `<a href="${r.proofUrl}" target="_blank" rel="noopener" title="Lihat Bukti${r.proofName ? ' (' + r.proofName + ')' : ''}" style="display:inline-flex;align-items:center;color:#10b981;transition:transform 0.2s;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg></a>` : ''}
                                      ${['MC','EL','EL_EMG'].includes(r.type) && ['admin','hr','super_admin'].includes(user.role) ? `<button onclick="window.reuploadProof(${r.id})" title="${r.proofUrl ? 'Ganti' : 'Muat Naik'} Bukti (JPG/PNG/PDF, maks 10MB)" style="background: none; border: none; cursor: pointer; color: #f59e0b; transition: transform 0.2s;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg></button>` : ''}
                                      ${window.canManageRequest(user, r) && r.status !== 'CANCELLED' ? `<button onclick="window.cancelLeave(${r.id})" title="Batal Cuti" style="background: none; border: none; cursor: pointer; color: #f87171; transition: transform 0.2s;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg></button>` : ''}
                                      <button onclick="printLeave(${r.id})" style="background: none; border: none; cursor: pointer; color: var(--secondary); transition: transform 0.2s;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V2h12v7"></path><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg></button>
                                      ${['admin', 'hr', 'super_admin'].includes(user.role) ? `
                                      <button onclick="editLeave(${r.id})" style="background: none; border: none; cursor: pointer; color: #60a5fa; transition: transform 0.2s;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg></button>
                                      <button onclick="deleteLeave(${r.id})" style="background: none; border: none; cursor: pointer; color: #f87171; transition: transform 0.2s;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg></button>
                                      ` : ''}
                                  </div>
                              </td>
                          </tr>
                          `).join('')}
                      </tbody>
                  </table>
              </div>
          </section>
        ` : ''}

        ${managementTab === 'login_audit' ? `
          <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 2rem; margin-top: 1rem;">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
              <h2 style="font-size: 1.25rem; font-weight: 600;">System Access & Activity Log</h2>
          </div>

          <section class="glass-card fade-in" style="padding: 0; overflow: hidden;">
              <div style="overflow-x: auto;">
                  <table class="data-table" style="width: 100%; border-collapse: collapse; margin: 0;">
                      <thead>
                          <tr style="text-transform: uppercase; font-size: 0.65rem; color: var(--text-muted); border-bottom: 1px solid rgba(163,177,198,0.25); letter-spacing: 1px;">
                              <th style="padding: 1.5rem 1rem;">Timestamp</th>
                              <th style="padding: 1.5rem 1rem;">User</th>
                              <th style="padding: 1.5rem 1rem;">User ID / Network</th>
                              <th style="padding: 1.5rem 1rem;">Activity Log</th>
                          </tr>
                      </thead>
                      <tbody>
                          ${systemAuditLogs.map(log => `
                          <tr style="border-bottom: 1px solid rgba(255,255,255,0.03); transition: background 0.2s;">
                              <td style="padding: 1.5rem 1rem;">
                                  <div style="font-weight: 600; font-size: 0.8rem; color: var(--text-muted);">${log.timestamp}</div>
                              </td>
                              <td style="padding: 1.5rem 1rem;">
                                  <div style="font-weight: 700; font-size: 0.85rem; text-transform: uppercase; margin-bottom: 0.25rem;">${log.name}</div>
                                  <div style="font-size: 0.65rem; color: var(--primary); text-transform: uppercase; font-weight: 600;">${log.branch}</div>
                              </td>
                              <td style="padding: 1.5rem 1rem;">
                                  <div style="font-weight: 600; font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.25rem;">${log.userId}</div>
                                  <div style="font-size: 0.65rem; color: #a855f7; font-family: monospace; font-weight: 600; display:flex; align-items: center; gap: 6px;">
                                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
                                      ${log.ip} <span style="color: var(--text-muted); font-family: system-ui;">(${log.location})</span>
                                  </div>
                              </td>
                              <td style="padding: 1.5rem 1rem;">
                                  <div style="font-size: 0.8rem; font-weight: 600; color: ${log.activity.includes('Logged in') ? 'var(--accent)' : 'var(--text-muted)'}; background: rgba(163,177,198,0.15); padding: 0.5rem 0.75rem; border-radius: 8px; border-left: 2px solid ${log.activity.includes('Logged in') ? 'var(--accent)' : log.activity.includes('Leave') ? 'var(--primary)' : 'var(--text-muted)'}; display: inline-block;">
                                      ${log.activity}
                                  </div>
                              </td>
                          </tr>
                          `).join('')}
                      </tbody>
                  </table>
              </div>
          </section>
        ` : ''}

        ${managementTab === 'locum_records' ? (() => {
          const isSupervisorRole = ['supervisor', 'doctor_pic', 'hod_balok'].includes(user.role);
          const locumRecs = leaveRecords.filter(r => r.locum1Name && (!isSupervisorRole || r.branch === user.branch));
          return `
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.5rem;margin-top:1rem;">
            <div style="display:flex;align-items:center;gap:0.75rem;">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0d9488" stroke-width="2"><path d="M20 7H4a2 2 0 00-2 2v6a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z"></path><path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16"></path></svg>
              <h2 style="font-size:1.25rem;font-weight:700;">Rekod Locum — Pembayaran Jam Locum</h2>
            </div>
            <button onclick="window.printAllLocum()" class="neu-btn" style="background:rgba(13,148,136,0.1);border:1px solid rgba(13,148,136,0.3);color:#0d9488;font-weight:700;padding:0.6rem 1.2rem;display:flex;align-items:center;gap:0.5rem;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V2h12v7"></path><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
              Print Semua Rekod
            </button>
          </div>

          ${locumRecs.length === 0 ? `
            <div class="glass-card" style="padding:2.5rem;text-align:center;color:var(--text-muted);">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin:0 auto 1rem;display:block;opacity:0.3;"><path d="M20 7H4a2 2 0 00-2 2v6a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z"></path><path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16"></path></svg>
              Tiada rekod locum lagi.
            </div>` : `
          <div style="display:flex;flex-direction:column;gap:1rem;">
            ${locumRecs.map(r => {
              const locums = [];
              if (r.locum1Name) locums.push({ name: r.locum1Name, phone: r.locum1Phone, date: r.locum1Date, ts: r.locum1TimeStart, te: r.locum1TimeEnd, n: 1 });
              if (r.locum2Name) locums.push({ name: r.locum2Name, phone: r.locum2Phone, date: r.locum2Date, ts: r.locum2TimeStart, te: r.locum2TimeEnd, n: 2 });
              return `
              <div class="glass-card" style="padding:1.25rem;">
                <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:1rem;">
                  <div>
                    <div style="font-weight:800;font-size:0.95rem;text-transform:uppercase;">${r.name}</div>
                    <div style="font-size:0.75rem;color:var(--primary);font-weight:600;margin-top:0.1rem;">${r.branch}</div>
                    <div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.25rem;">
                      Cuti: <strong>${r.type}</strong> &nbsp;|&nbsp; ${r.startDate}${r.startDate !== r.endDate ? ' → ' + r.endDate : ''} &nbsp;|&nbsp; ${r.days} hari
                    </div>
                  </div>
                  <div style="display:flex;gap:0.5rem;align-items:center;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end;">
                    <span style="font-size:0.65rem;font-weight:700;padding:0.25rem 0.6rem;border-radius:999px;
                      ${r.status === 'APPROVED' ? 'background:#dcfce7;color:#14532d;' : 'background:#dbeafe;color:#1e40af;'}">
                      ${r.status}
                    </span>
                    <button onclick="window.printLocumForm(${r.id})" style="background:rgba(13,148,136,0.08);border:1px solid rgba(13,148,136,0.25);border-radius:8px;padding:0.35rem 0.75rem;cursor:pointer;color:#0d9488;font-size:0.72rem;font-weight:700;display:flex;align-items:center;gap:0.3rem;">
                      🖨️ Print
                    </button>
                    <button onclick="window.saveLocumEdit(${r.id})" style="background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.25);border-radius:8px;padding:0.35rem 0.75rem;cursor:pointer;color:#6366f1;font-size:0.72rem;font-weight:700;display:flex;align-items:center;gap:0.3rem;">
                      ✏️ Kemaskini Locum
                    </button>
                  </div>
                </div>
                <div style="display:grid;grid-template-columns:${locums.length > 1 ? '1fr 1fr' : '1fr'};gap:0.75rem;">
                  ${locums.map(l => `
                  <div style="background:${l.n===1?'rgba(59,130,246,0.05)':'rgba(124,58,237,0.05)'};border:1px solid ${l.n===1?'rgba(59,130,246,0.2)':'rgba(124,58,237,0.2)'};border-radius:10px;padding:0.75rem;">
                    <div style="font-size:0.65rem;font-weight:800;color:${l.n===1?'#1e40af':'#6d28d9'};text-transform:uppercase;margin-bottom:0.5rem;">Locum ${l.n}</div>
                    <div style="font-weight:700;font-size:0.85rem;margin-bottom:0.15rem;">${l.name}</div>
                    <div style="font-size:0.75rem;color:var(--text-muted);">📞 ${l.phone || '-'}</div>
                    <div style="font-size:0.75rem;color:var(--text-muted);">📅 ${l.date || '-'}</div>
                    <div style="font-size:0.75rem;color:var(--text-muted);">🕐 ${l.ts || '-'} — ${l.te || '-'}</div>
                    ${l.ts && l.te ? (() => {
                      const [sh,sm] = (l.ts||'0:0').split(':').map(Number);
                      const [eh,em] = (l.te||'0:0').split(':').map(Number);
                      const hrs = ((eh*60+em)-(sh*60+sm))/60;
                      return hrs > 0 ? `<div style="font-size:0.72rem;font-weight:700;color:#0d9488;margin-top:0.3rem;">⏱ ${hrs.toFixed(1)} jam bertugas</div>` : '';
                    })() : ''}
                  </div>`).join('')}
                </div>
              </div>`;
            }).join('')}
          </div>`}
          `;
        })() : ''}

        ${managementTab === 'balance_view' && userPerms.manage_reports ? (() => {
          const userStateScope = window.getUserStateScope(user);
          const reportBranch   = window.getUserReportBranch(user);
          const reportDaerah   = window.getUserReportDaerah(user);

          // Pool staf ikut skop pengguna
          let pool = staffList.filter(s => {
            if (s.inactive) return false;
            if (s.role === 'super_admin') return false;
            if (reportBranch && s.branch !== reportBranch) return false;
            const b = branches.find(br => br.name === s.branch);
            if (!reportBranch) {
              if (userStateScope !== 'all' && (!b || b.state !== userStateScope)) return false;
              if (reportDaerah && (!b || b.daerah !== reportDaerah)) return false;
            }
            return true;
          });

          // Filter cawangan & carian
          if (balanceViewBranch !== 'SEMUA') pool = pool.filter(s => s.branch === balanceViewBranch);
          if (balanceViewSearch.trim()) {
            const q = balanceViewSearch.toLowerCase();
            pool = pool.filter(s => (s.name||'').toLowerCase().includes(q) || (s.ic||'').includes(q));
          }

          const availBranches = [...new Set(staffList.filter(s=>!s.inactive && s.role!=='super_admin').map(s=>s.branch).filter(Boolean))].sort();

          // Kira baki cuti untuk setiap staf
          const keyTypes = ['AL','MC','EL','HL','ML','CME'];
          const staffRows = pool.map(s => {
            const stats = {};
            keyTypes.forEach(t => { stats[t] = window.getLeaveStats(s, t); });
            return { s, stats };
          });

          // Kumpul ikut cawangan
          const byBranch = {};
          staffRows.forEach(({ s, stats }) => {
            const br = s.branch || '—';
            if (!byBranch[br]) byBranch[br] = [];
            byBranch[br].push({ s, stats });
          });
          const sortedBranches = Object.keys(byBranch).sort();

          const roleColor = { super_admin:'#3b82f6', admin:'#f59e0b', hr:'#a855f7', hod_cawangan:'#38bdf8', hod_balok:'#0ea5e9', doctor_pic:'#818cf8', supervisor:'#10b981', team_leader:'#f43f5e', staff:'#64748b', juru_xray:'#ec4899', sonographer:'#6366f1', juru_audio:'#0d9488' };

          return `
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem;margin-top:0.5rem;flex-wrap:wrap;gap:0.75rem;">
            <div style="display:flex;align-items:center;gap:0.75rem;">
              <div style="width:40px;height:40px;border-radius:10px;background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.25);display:flex;align-items:center;justify-content:center;">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              </div>
              <div>
                <h2 style="font-size:1.05rem;font-weight:700;margin:0;">Baki Cuti Semua Staf</h2>
                <p style="font-size:0.72rem;color:var(--text-muted);margin:0.1rem 0 0;">${pool.length} staf · dikumpul ikut cawangan</p>
              </div>
            </div>
            <div style="display:flex;gap:0.6rem;flex-wrap:wrap;align-items:center;">
              <input type="text" placeholder="Cari nama / IC..." value="${balanceViewSearch}" oninput="window.setBalanceViewSearch(this.value)" class="neu-inset" style="padding:0.45rem 0.75rem;font-size:0.82rem;border-radius:8px;width:180px;">
              <select class="neu-inset" style="padding:0.45rem 0.75rem;font-size:0.82rem;border-radius:8px;cursor:pointer;" onchange="window.setBalanceViewBranch(this.value)">
                <option value="SEMUA" ${balanceViewBranch==='SEMUA'?'selected':''}>Semua Cawangan</option>
                ${availBranches.map(b=>`<option value="${b}" ${balanceViewBranch===b?'selected':''}>${b}</option>`).join('')}
              </select>
            </div>
          </div>

          ${sortedBranches.length === 0 ? `
            <div class="glass-card" style="padding:3rem;text-align:center;color:var(--text-muted);">Tiada staf dijumpai.</div>
          ` : sortedBranches.map(br => {
            const rows = byBranch[br];
            return `
            <div class="glass-card fade-in" style="padding:0;overflow:hidden;margin-bottom:1.25rem;border-top:3px solid rgba(16,185,129,0.5);">
              <div style="padding:0.75rem 1.1rem;background:rgba(16,185,129,0.04);border-bottom:1px solid rgba(163,177,198,0.15);display:flex;align-items:center;gap:0.75rem;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
                <span style="font-size:0.88rem;font-weight:700;color:var(--text);">${br}</span>
                <span style="font-size:0.72rem;color:var(--text-muted);background:rgba(163,177,198,0.2);padding:0.1rem 0.5rem;border-radius:999px;">${rows.length} staf</span>
              </div>
              <div style="overflow-x:auto;">
                <table style="width:100%;border-collapse:collapse;font-size:0.78rem;">
                  <thead>
                    <tr style="background:rgba(163,177,198,0.06);border-bottom:1px solid rgba(163,177,198,0.2);">
                      <th style="padding:0.6rem 1rem;font-weight:700;font-size:0.68rem;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);text-align:left;min-width:160px;">Nama</th>
                      <th style="padding:0.6rem 0.75rem;font-weight:700;font-size:0.68rem;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);text-align:left;">Peranan</th>
                      ${keyTypes.map(t=>`<th style="padding:0.6rem 0.75rem;font-weight:700;font-size:0.68rem;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);text-align:center;min-width:70px;">${t}</th>`).join('')}
                    </tr>
                  </thead>
                  <tbody>
                    ${rows.map(({ s, stats }, ri) => {
                      const rc = roleColor[s.role] || '#64748b';
                      return `<tr style="border-bottom:1px solid rgba(163,177,198,0.08);${ri%2===1?'background:rgba(163,177,198,0.025);':''}">
                        <td style="padding:0.6rem 1rem;font-weight:600;color:var(--text);">${s.name}</td>
                        <td style="padding:0.6rem 0.75rem;">
                          <span style="font-size:0.65rem;font-weight:700;background:${rc}18;color:${rc};border:1px solid ${rc}33;border-radius:5px;padding:0.15rem 0.45rem;">${window.staffConfig.roleLabels[s.role]||s.role}</span>
                        </td>
                        ${keyTypes.map(t => {
                          const st = stats[t];
                          const hasEnt = st.ent > 0;
                          const isLow = hasEnt && st.bal <= 3;
                          const isZero = hasEnt && st.bal <= 0;
                          if (!hasEnt) return `<td style="padding:0.6rem 0.75rem;text-align:center;color:rgba(163,177,198,0.4);font-size:0.7rem;">—</td>`;
                          return `<td style="padding:0.6rem 0.75rem;text-align:center;">
                            <div style="font-size:0.82rem;font-weight:800;color:${isZero?'#ef4444':isLow?'#f59e0b':'#10b981'};">${st.bal.toFixed(1)}</div>
                            <div style="font-size:0.6rem;color:var(--text-muted);">${st.used.toFixed(1)}/${st.ent.toFixed(1)}</div>
                          </td>`;
                        }).join('')}
                      </tr>`;
                    }).join('')}
                  </tbody>
                </table>
              </div>
            </div>`;
          }).join('')}
          `;
        })() : ''}

        ${managementTab === 'hr_reports' ? (() => {
          // Scope filter (state + optional daerah + optional own-branch restriction)
          const reportDaerah = window.getUserReportDaerah(user);
          const reportBranch = window.getUserReportBranch(user);
          const scopedRecords = leaveRecords.filter(r => {
            if (reportBranch) return r.branch === reportBranch;
            if (userStateScope === 'all' && !reportDaerah) return true;
            const rb = branches.find(b => b.name === r.branch);
            if (!rb) return false;
            if (userStateScope !== 'all' && rb.state !== userStateScope) return false;
            if (reportDaerah && rb.daerah !== reportDaerah) return false;
            return true;
          });

          // Approved report data
          const approvedBase = scopedRecords.filter(r => r.status === 'APPROVED');
          const availableYears = [...new Set(approvedBase.map(r => r.id ? new Date(r.id).getFullYear().toString() : '').filter(Boolean))].sort().reverse();
          const availableBranches = [...new Set(approvedBase.map(r => r.branch).filter(Boolean))].sort();
          const availableTypes = [...new Set(approvedBase.map(r => r.type).filter(Boolean))].sort();

          const approvedFiltered = approvedBase.filter(r => {
            if (approvedReportBranch !== 'SEMUA' && r.branch !== approvedReportBranch) return false;
            if (approvedReportType !== 'SEMUA' && r.type !== approvedReportType) return false;
            if (approvedReportYear !== 'SEMUA' && (!r.id || new Date(r.id).getFullYear().toString() !== approvedReportYear)) return false;
            return true;
          });
          const approvedTotalDays = approvedFiltered.reduce((s,r) => s + parseFloat(r.days||0), 0);
          const approvedStaffCount = [...new Set(approvedFiltered.map(r=>r.ic))].length;

          // Breakdown by type
          const typeBreakdown = {};
          approvedFiltered.forEach(r => { typeBreakdown[r.type] = (typeBreakdown[r.type]||0) + parseFloat(r.days||0); });

          return `
          <!-- Header -->
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem;margin-top:1rem;flex-wrap:wrap;gap:0.75rem;">
            <div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#a855f7" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
              <h2 style="font-size:1.2rem;font-weight:700;margin:0;">HR Reports</h2>
              ${reportBranch ? `
              <div style="display:flex;align-items:center;gap:0.4rem;background:rgba(56,189,248,0.1);border:1px solid rgba(56,189,248,0.35);border-radius:20px;padding:0.25rem 0.75rem;">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#0284c7" stroke-width="2.5"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
                <span style="font-size:0.68rem;font-weight:800;color:#0284c7;letter-spacing:0.3px;">Skop: ${reportBranch}</span>
              </div>` : reportDaerah ? `
              <div style="display:flex;align-items:center;gap:0.4rem;background:rgba(234,179,8,0.1);border:1px solid rgba(234,179,8,0.35);border-radius:20px;padding:0.25rem 0.75rem;">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#ca8a04" stroke-width="2.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                <span style="font-size:0.68rem;font-weight:800;color:#ca8a04;letter-spacing:0.3px;">Skop: Kuantan Sahaja</span>
              </div>` : ''}
            </div>
            ${hrReportTab === 'all'
              ? `<button onclick="window.generateLeaveReport()" class="neu-btn" style="background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.2);color:var(--primary);font-weight:600;display:flex;align-items:center;gap:0.5rem;padding:0.6rem 1.2rem;font-size:0.8rem;">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V2h12v7"></path><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
                  Generate PDF
                </button>`
              : hrReportTab === 'approved'
              ? `<button onclick="window.generateApprovedReport()" class="neu-btn" style="background:rgba(5,150,105,0.1);border:1px solid rgba(5,150,105,0.25);color:#059669;font-weight:600;display:flex;align-items:center;gap:0.5rem;padding:0.6rem 1.2rem;font-size:0.8rem;">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V2h12v7"></path><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
                  Cetak Laporan
                </button>`
              : hrReportTab === 'balance'
              ? `<button onclick="window.generateBalanceReport(window._balanceRows||[],'${balanceReportBranch}','${balanceReportType}','${balanceReportYear}')" class="neu-btn" style="background:rgba(124,58,237,0.1);border:1px solid rgba(124,58,237,0.25);color:#7c3aed;font-weight:600;display:flex;align-items:center;gap:0.5rem;padding:0.6rem 1.2rem;font-size:0.8rem;">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V2h12v7"></path><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
                  Cetak Baki Cuti
                </button>`
              : hrReportTab === 'jenis'
              ? `<button onclick="window.generateJenisCutiReport()" class="neu-btn" style="background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.25);color:#d97706;font-weight:600;display:flex;align-items:center;gap:0.5rem;padding:0.6rem 1.2rem;font-size:0.8rem;">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V2h12v7"></path><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
                  Cetak Ringkasan
                </button>`
              : (userPerms.report_attendance ? `<button onclick="window.generateAttendanceReport()" class="neu-btn" style="background:rgba(30,41,59,0.1);border:1px solid rgba(30,41,59,0.3);color:var(--text);font-weight:600;display:flex;align-items:center;gap:0.5rem;padding:0.6rem 1.2rem;font-size:0.8rem;">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V2h12v7"></path><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
                  Cetak Rekod
                </button>` : '')
            }
          </div>

          <!-- Sub-tabs -->
          <div style="display:flex;gap:0.5rem;margin-bottom:1.5rem;background:rgba(163,177,198,0.1);padding:0.3rem;border-radius:12px;width:fit-content;flex-wrap:wrap;">
            <button onclick="window.setHrReportTab('all')" style="padding:0.5rem 1.1rem;border-radius:9px;border:none;cursor:pointer;font-size:0.8rem;font-weight:700;transition:all 0.2s;
              ${hrReportTab==='all' ? 'background:#fff;color:var(--text);box-shadow:0 2px 8px rgba(0,0,0,0.1);' : 'background:transparent;color:var(--text-muted);'}">
              Semua Rekod
            </button>
            <button onclick="window.setHrReportTab('approved')" style="padding:0.5rem 1.1rem;border-radius:9px;border:none;cursor:pointer;font-size:0.8rem;font-weight:700;transition:all 0.2s;display:flex;align-items:center;gap:0.4rem;
              ${hrReportTab==='approved' ? 'background:#059669;color:#fff;box-shadow:0 2px 8px rgba(5,150,105,0.3);' : 'background:transparent;color:var(--text-muted);'}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
              Cuti Diluluskan
            </button>
            <button onclick="window.setHrReportTab('balance')" style="padding:0.5rem 1.1rem;border-radius:9px;border:none;cursor:pointer;font-size:0.8rem;font-weight:700;transition:all 0.2s;display:flex;align-items:center;gap:0.4rem;
              ${hrReportTab==='balance' ? 'background:#7c3aed;color:#fff;box-shadow:0 2px 8px rgba(124,58,237,0.3);' : 'background:transparent;color:var(--text-muted);'}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              Baki Cuti Bulanan
            </button>
            <button onclick="window.setHrReportTab('jenis')" style="padding:0.5rem 1.1rem;border-radius:9px;border:none;cursor:pointer;font-size:0.8rem;font-weight:700;transition:all 0.2s;display:flex;align-items:center;gap:0.4rem;
              ${hrReportTab==='jenis' ? 'background:#d97706;color:#fff;box-shadow:0 2px 8px rgba(217,119,6,0.3);' : 'background:transparent;color:var(--text-muted);'}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
              Ringkasan Jenis
            </button>
            ${userPerms.report_attendance ? `<button onclick="window.setHrReportTab('attendance')" style="padding:0.5rem 1.1rem;border-radius:9px;border:none;cursor:pointer;font-size:0.8rem;font-weight:700;transition:all 0.2s;display:flex;align-items:center;gap:0.4rem;
              ${hrReportTab==='attendance' ? 'background:#1e293b;color:#fff;box-shadow:0 2px 8px rgba(30,41,59,0.3);' : 'background:transparent;color:var(--text-muted);'}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              Rekod Kedatangan
            </button>` : ''}
          </div>

          ${hrReportTab === 'all' ? `
          <!-- SEMUA REKOD -->
          <section class="glass-card fade-in" style="padding:0;overflow:hidden;">
            <div style="overflow-x:auto;">
              <table class="data-table" style="width:100%;border-collapse:collapse;margin:0;">
                <thead>
                  <tr style="text-transform:uppercase;font-size:0.65rem;color:var(--text-muted);border-bottom:1px solid rgba(163,177,198,0.25);letter-spacing:1px;">
                    <th style="padding:1.5rem 1rem;">Period</th>
                    <th style="padding:1.5rem 1rem;">Employee</th>
                    <th style="padding:1.5rem 1rem;">Type</th>
                    <th style="padding:1.5rem 1rem;">Reason</th>
                    <th style="padding:1.5rem 1rem;">Days</th>
                    <th style="padding:1.5rem 1rem;">Status</th>
                  </tr>
                </thead>
                <tbody>
                  ${scopedRecords.map(r => `
                  <tr style="border-bottom:1px solid rgba(255,255,255,0.03);">
                    <td style="padding:1.5rem 1rem;">
                      <div style="font-size:0.62rem;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;color:var(--text-muted);margin-bottom:0.2rem;">Tarikh Mohon</div>
                      <div style="font-weight:700;font-size:0.8rem;">${r.id ? new Date(r.id).toLocaleDateString('ms-MY',{day:'2-digit',month:'short',year:'numeric'}) : '-'}</div>
                      <div style="font-size:0.62rem;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;color:var(--text-muted);margin-top:0.4rem;margin-bottom:0.1rem;">Tarikh Cuti</div>
                      <div style="font-size:0.7rem;color:var(--text-muted);">${r.startDate}${r.startDate!==r.endDate?` → ${r.endDate}`:''}</div>
                    </td>
                    <td style="padding:1.5rem 1rem;">
                      <div style="font-weight:700;font-size:0.85rem;text-transform:uppercase;margin-bottom:0.25rem;">${r.name}</div>
                      <div style="font-size:0.65rem;color:var(--text-muted);margin-bottom:0.25rem;">${r.ic}</div>
                      <div style="font-size:0.65rem;color:var(--primary);text-transform:uppercase;font-weight:600;">${r.branch}</div>
                    </td>
                    <td style="padding:1.5rem 1rem;">
                      <div style="font-size:0.65rem;font-weight:700;background:rgba(59,130,246,0.1);color:${r.typeColor||'var(--primary)'};padding:0.3rem 0.6rem;border-radius:4px;border:1px solid var(--border);display:inline-block;">${r.type}</div>
                    </td>
                    <td style="padding:1.5rem 1rem;font-size:0.75rem;font-style:italic;color:var(--text-muted);max-width:250px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${r.reason}</td>
                    <td style="padding:1.5rem 1rem;font-weight:700;font-size:1.1rem;">${r.days}</td>
                    <td style="padding:1.5rem 1rem;">
                      <span style="font-size:0.6rem;font-weight:700;text-transform:uppercase;padding:0.35rem 0.75rem;border-radius:20px;
                        ${r.status==='REJECTED'?'color:var(--danger);background:rgba(239,68,68,0.1);':r.status.includes('HOD')||r.status==='TL APPROVED'?'color:#eab308;background:rgba(234,179,8,0.1);':r.status==='PENDING'?'color:#eab308;border:1px solid rgba(234,179,8,0.4);':'color:var(--accent);background:rgba(34,197,94,0.1);'}">
                        ${r.status}
                      </span>
                    </td>
                  </tr>`).join('')}
                </tbody>
              </table>
            </div>
          </section>
          ` : `
          <!-- CUTI DILULUSKAN -->

          <!-- Filter bar -->
          <div class="glass-card" style="padding:1rem 1.25rem;margin-bottom:1.25rem;display:flex;flex-wrap:wrap;gap:0.75rem;align-items:center;">
            <div style="font-size:0.72rem;font-weight:700;text-transform:uppercase;color:var(--text-muted);letter-spacing:0.5px;">Tapis:</div>
            <select class="neu-inset" style="padding:0.4rem 0.75rem;font-size:0.82rem;color-scheme:light;border-radius:8px;cursor:pointer;" onchange="window.setApprovedReportYear(this.value)">
              <option value="SEMUA" ${approvedReportYear==='SEMUA'?'selected':''}>Semua Tahun</option>
              ${availableYears.map(y=>`<option value="${y}" ${approvedReportYear===y?'selected':''}>${y}</option>`).join('')}
            </select>
            <select class="neu-inset" style="padding:0.4rem 0.75rem;font-size:0.82rem;color-scheme:light;border-radius:8px;cursor:pointer;" onchange="window.setApprovedReportBranch(this.value)">
              <option value="SEMUA" ${approvedReportBranch==='SEMUA'?'selected':''}>Semua Cawangan</option>
              ${availableBranches.map(b=>`<option value="${b}" ${approvedReportBranch===b?'selected':''}>${b}</option>`).join('')}
            </select>
            <select class="neu-inset" style="padding:0.4rem 0.75rem;font-size:0.82rem;color-scheme:light;border-radius:8px;cursor:pointer;" onchange="window.setApprovedReportType(this.value)">
              <option value="SEMUA" ${approvedReportType==='SEMUA'?'selected':''}>Semua Jenis</option>
              ${availableTypes.map(t=>`<option value="${t}" ${approvedReportType===t?'selected':''}>${t}</option>`).join('')}
            </select>
            <div style="margin-left:auto;font-size:0.72rem;color:var(--text-muted);font-weight:600;">${approvedFiltered.length} rekod dijumpai</div>
          </div>

          <!-- Stats cards -->
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:1rem;margin-bottom:1.25rem;">
            <div class="glass-card" style="padding:1.1rem 1.25rem;background:linear-gradient(135deg,rgba(5,150,105,0.12),rgba(16,185,129,0.06));border:1px solid rgba(5,150,105,0.2);">
              <div style="font-size:0.65rem;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:#059669;margin-bottom:0.4rem;">Jumlah Rekod Lulus</div>
              <div style="font-size:2.2rem;font-weight:800;color:#059669;line-height:1;">${approvedFiltered.length}</div>
            </div>
            <div class="glass-card" style="padding:1.1rem 1.25rem;background:linear-gradient(135deg,rgba(59,130,246,0.1),rgba(99,102,241,0.05));border:1px solid rgba(59,130,246,0.2);">
              <div style="font-size:0.65rem;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:#3b82f6;margin-bottom:0.4rem;">Jumlah Hari Diluluskan</div>
              <div style="font-size:2.2rem;font-weight:800;color:#3b82f6;line-height:1;">${approvedTotalDays.toFixed(1)}</div>
            </div>
            <div class="glass-card" style="padding:1.1rem 1.25rem;background:linear-gradient(135deg,rgba(234,179,8,0.1),rgba(245,158,11,0.05));border:1px solid rgba(234,179,8,0.2);">
              <div style="font-size:0.65rem;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:#ca8a04;margin-bottom:0.4rem;">Staf Terlibat</div>
              <div style="font-size:2.2rem;font-weight:800;color:#ca8a04;line-height:1;">${approvedStaffCount}</div>
            </div>
          </div>

          <!-- Breakdown by type -->
          ${Object.keys(typeBreakdown).length > 0 ? `
          <div class="glass-card" style="padding:1rem 1.25rem;margin-bottom:1.25rem;">
            <div style="font-size:0.7rem;font-weight:800;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);margin-bottom:0.75rem;">Pecahan Mengikut Jenis Cuti</div>
            <div style="display:flex;flex-wrap:wrap;gap:0.5rem;">
              ${Object.entries(typeBreakdown).sort((a,b)=>b[1]-a[1]).map(([type,days])=>`
                <div style="padding:0.4rem 0.85rem;border-radius:20px;background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.15);display:flex;align-items:center;gap:0.5rem;">
                  <span style="font-size:0.72rem;font-weight:800;color:var(--primary);">${type}</span>
                  <span style="font-size:0.68rem;color:var(--text-muted);">${days.toFixed(1)} hari</span>
                </div>`).join('')}
            </div>
          </div>` : ''}

          <!-- Approved table -->
          <section class="glass-card fade-in" style="padding:0;overflow:hidden;">
            <div style="overflow-x:auto;">
              <table class="data-table" style="width:100%;border-collapse:collapse;margin:0;">
                <thead>
                  <tr style="text-transform:uppercase;font-size:0.65rem;color:var(--text-muted);border-bottom:1px solid rgba(163,177,198,0.25);letter-spacing:1px;">
                    <th style="padding:1.2rem 1rem;">Tarikh</th>
                    <th style="padding:1.2rem 1rem;">Staf</th>
                    <th style="padding:1.2rem 1rem;">Cawangan</th>
                    <th style="padding:1.2rem 1rem;">Jenis</th>
                    <th style="padding:1.2rem 1rem;">Sebab</th>
                    <th style="padding:1.2rem 1rem;text-align:center;">Hari</th>
                    <th style="padding:1.2rem 1rem;text-align:center;">WA</th>
                  </tr>
                </thead>
                <tbody>
                  ${approvedFiltered.length === 0
                    ? `<tr><td colspan="6" style="padding:3rem;text-align:center;color:var(--text-muted);font-size:0.85rem;">Tiada rekod diluluskan dijumpai</td></tr>`
                    : approvedFiltered.slice().sort((a,b)=>(b.id||0)-(a.id||0)).map(r => `
                  <tr style="border-bottom:1px solid rgba(255,255,255,0.03);">
                    <td style="padding:1.1rem 1rem;">
                      <div style="font-size:0.6rem;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;color:var(--text-muted);margin-bottom:0.15rem;">Tarikh Mohon</div>
                      <div style="font-weight:700;font-size:0.8rem;">${r.id ? new Date(r.id).toLocaleDateString('ms-MY',{day:'2-digit',month:'short',year:'numeric'}) : '-'}</div>
                      <div style="font-size:0.6rem;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;color:var(--text-muted);margin-top:0.35rem;margin-bottom:0.1rem;">Tarikh Cuti</div>
                      <div style="font-size:0.68rem;color:var(--text-muted);">${r.startDate}${r.startDate!==r.endDate?` → ${r.endDate}`:''}</div>
                    </td>
                    <td style="padding:1.1rem 1rem;">
                      <div style="font-weight:700;font-size:0.82rem;text-transform:uppercase;">${r.name}</div>
                      <div style="font-size:0.62rem;color:var(--text-muted);">${r.ic}</div>
                    </td>
                    <td style="padding:1.1rem 1rem;font-size:0.72rem;color:var(--primary);font-weight:600;">${r.branch}</td>
                    <td style="padding:1.1rem 1rem;">
                      <span style="font-size:0.65rem;font-weight:700;background:rgba(5,150,105,0.1);color:#059669;padding:0.25rem 0.6rem;border-radius:4px;border:1px solid rgba(5,150,105,0.2);">${r.type}</span>
                    </td>
                    <td style="padding:1.1rem 1rem;font-size:0.73rem;font-style:italic;color:var(--text-muted);max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${r.reason||'-'}</td>
                    <td style="padding:1.1rem 1rem;font-weight:800;font-size:1rem;text-align:center;color:#059669;">${r.days}</td>
                    <td style="padding:0.6rem 1rem;text-align:center;">
                      <button onclick="window.resendApprovalWA(${r.id})" title="Hantar semula notifikasi WhatsApp" style="background:rgba(37,211,102,0.12);border:1px solid rgba(37,211,102,0.3);color:#25d366;border-radius:8px;padding:0.35rem 0.6rem;cursor:pointer;font-size:0.7rem;font-weight:700;display:inline-flex;align-items:center;gap:0.3rem;">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                        Hantar Semula
                      </button>
                    </td>
                  </tr>`).join('')}
                </tbody>
                ${approvedFiltered.length > 0 ? `
                <tfoot>
                  <tr style="border-top:1px solid rgba(5,150,105,0.3);background:rgba(5,150,105,0.05);">
                    <td colspan="5" style="padding:0.9rem 1rem;font-size:0.75rem;font-weight:800;text-align:right;color:var(--text-muted);text-transform:uppercase;">Jumlah Keseluruhan</td>
                    <td style="padding:0.9rem 1rem;font-weight:800;font-size:1.1rem;text-align:center;color:#059669;">${approvedTotalDays.toFixed(1)}</td>
                    <td></td>
                  </tr>
                </tfoot>` : ''}
              </table>
            </div>
          </section>
          `}

          ${hrReportTab === 'jenis' ? (() => {
            const availYearsJ = [...new Set(scopedRecords.map(r=>r.id ? new Date(r.id).getFullYear().toString() : '').filter(Boolean))].sort().reverse();
            const availBranchesJ = [...new Set(scopedRecords.map(r=>r.branch).filter(Boolean))].sort();

            const jeniFiltered = scopedRecords.filter(r => {
              if (r.status !== 'APPROVED') return false;
              if (jenisCutiYear !== 'SEMUA' && new Date(r.id).getFullYear().toString() !== jenisCutiYear) return false;
              if (jenisCutiBranch !== 'SEMUA' && r.branch !== jenisCutiBranch) return false;
              return true;
            });

            const typeSet = leaveCategories.map(c => c.id);
            const branchSet = jenisCutiBranch !== 'SEMUA'
              ? (jeniFiltered.some(r=>r.branch===jenisCutiBranch) ? [jenisCutiBranch] : [])
              : [...new Set(jeniFiltered.map(r=>r.branch).filter(Boolean))].sort();

            const matrix = {}, typeTotals = {}, branchTotals = {};
            let grandDays = 0, grandCount = 0;
            typeSet.forEach(t => { typeTotals[t] = {d:0,n:0}; });
            branchSet.forEach(b => { matrix[b] = {}; branchTotals[b] = {d:0,n:0}; typeSet.forEach(t => { matrix[b][t] = {d:0,n:0}; }); });
            jeniFiltered.forEach(r => {
              const b = r.branch, t = r.type, d = parseFloat(r.days||0);
              if (matrix[b] && matrix[b][t] !== undefined) {
                matrix[b][t].d += d; matrix[b][t].n += 1;
                branchTotals[b].d += d; branchTotals[b].n += 1;
                typeTotals[t].d += d; typeTotals[t].n += 1;
                grandDays += d; grandCount += 1;
              }
            });
            const activeTypes = typeSet.filter(t => typeTotals[t].d > 0);
            const typeColorMap = { AL:'#3b82f6', MC:'#10b981', EL:'#f59e0b', EL_EMG:'#ef4444', UP:'#94a3b8', HL:'#06b6d4', ML:'#ec4899', ML_PL:'#6366f1', CME:'#8b5cf6' };

            return `
            <!-- Filter bar -->
            <div class="glass-card" style="padding:1rem 1.25rem;margin-bottom:1.25rem;display:flex;flex-wrap:wrap;gap:0.75rem;align-items:center;">
              <div style="font-size:0.72rem;font-weight:700;text-transform:uppercase;color:var(--text-muted);letter-spacing:0.5px;">Tapis:</div>
              <select class="neu-inset" style="padding:0.4rem 0.75rem;font-size:0.82rem;color-scheme:light;border-radius:8px;cursor:pointer;" onchange="window.setJenisCutiYear(this.value)">
                <option value="SEMUA" ${jenisCutiYear==='SEMUA'?'selected':''}>Semua Tahun</option>
                ${availYearsJ.map(y=>`<option value="${y}" ${jenisCutiYear===y?'selected':''}>${y}</option>`).join('')}
              </select>
              <select class="neu-inset" style="padding:0.4rem 0.75rem;font-size:0.82rem;color-scheme:light;border-radius:8px;cursor:pointer;" onchange="window.setJenisCutiBranch(this.value)">
                <option value="SEMUA" ${jenisCutiBranch==='SEMUA'?'selected':''}>Semua Cawangan</option>
                ${availBranchesJ.map(b=>`<option value="${b}" ${jenisCutiBranch===b?'selected':''}>${b}</option>`).join('')}
              </select>
              <div style="margin-left:auto;font-size:0.72rem;color:var(--text-muted);font-weight:600;">${jeniFiltered.length} rekod · ${grandDays.toFixed(1)} hari</div>
            </div>

            <!-- Type summary badges -->
            ${activeTypes.length > 0 ? `
            <div style="display:flex;flex-wrap:wrap;gap:0.5rem;margin-bottom:1.25rem;">
              ${activeTypes.map(t => {
                const c = typeColorMap[t]||'#64748b';
                const cat = leaveCategories.find(x=>x.id===t);
                return `<div style="padding:0.6rem 1rem;border-radius:10px;background:${c}14;border:1px solid ${c}35;min-width:90px;">
                  <div style="font-size:0.65rem;font-weight:800;text-transform:uppercase;letter-spacing:0.5px;color:${c};">${t}</div>
                  <div style="font-size:1.5rem;font-weight:800;color:${c};line-height:1.2;">${typeTotals[t].d.toFixed(1)}</div>
                  <div style="font-size:0.6rem;color:var(--text-muted);">${typeTotals[t].n} rekod</div>
                </div>`;
              }).join('')}
              <div style="padding:0.6rem 1rem;border-radius:10px;background:rgba(163,177,198,0.12);border:1px solid rgba(163,177,198,0.25);min-width:90px;">
                <div style="font-size:0.65rem;font-weight:800;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);">JUMLAH</div>
                <div style="font-size:1.5rem;font-weight:800;color:var(--text);line-height:1.2;">${grandDays.toFixed(1)}</div>
                <div style="font-size:0.6rem;color:var(--text-muted);">${grandCount} rekod</div>
              </div>
            </div>` : ''}

            <!-- Cross-tab table -->
            <section class="glass-card fade-in" style="padding:0;overflow:hidden;">
              <div style="overflow-x:auto;">
                ${jeniFiltered.length === 0
                  ? `<div style="padding:3rem;text-align:center;color:var(--text-muted);">Tiada rekod diluluskan untuk ditunjukkan</div>`
                  : `<table style="width:100%;border-collapse:collapse;font-size:0.73rem;">
                  <thead>
                    <tr style="border-bottom:2px solid rgba(163,177,198,0.2);">
                      <th style="padding:0.9rem 1rem;text-align:left;font-weight:700;font-size:0.72rem;border-right:2px solid rgba(163,177,198,0.2);min-width:160px;background:rgba(163,177,198,0.06);">Cawangan</th>
                      ${activeTypes.map(t => {
                        const c = typeColorMap[t]||'#64748b';
                        const cat = leaveCategories.find(x=>x.id===t);
                        return `<th style="padding:0.7rem 0.6rem;text-align:center;font-weight:700;font-size:0.67rem;color:${c};border-right:1px solid rgba(163,177,198,0.12);min-width:68px;" title="${cat?cat.name:t}">
                          <div>${t}</div>
                          <div style="font-size:0.58rem;font-weight:500;color:var(--text-muted);margin-top:0.15rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:68px;">${cat?cat.name.split(' ')[0]:''}</div>
                        </th>`;
                      }).join('')}
                      <th style="padding:0.7rem 0.8rem;text-align:center;font-weight:700;font-size:0.72rem;color:var(--text);min-width:72px;background:rgba(163,177,198,0.06);">Jumlah</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${branchSet.map((b,i) => `
                    <tr style="border-bottom:1px solid rgba(163,177,198,0.1);background:${i%2===0?'transparent':'rgba(163,177,198,0.03)'};" onmouseover="this.style.background='rgba(59,130,246,0.05)'" onmouseout="this.style.background='${i%2===0?'transparent':'rgba(163,177,198,0.03)'}'">
                      <td style="padding:0.75rem 1rem;font-weight:700;font-size:0.78rem;border-right:2px solid rgba(163,177,198,0.2);">${b}</td>
                      ${activeTypes.map(t => {
                        const v = matrix[b][t];
                        const c = typeColorMap[t]||'#64748b';
                        return v.d > 0
                          ? `<td style="padding:0.75rem 0.6rem;text-align:center;border-right:1px solid rgba(163,177,198,0.1);">
                              <div style="font-weight:800;font-size:0.85rem;color:${c};">${v.d % 1 === 0 ? v.d : v.d.toFixed(1)}</div>
                              <div style="font-size:0.6rem;color:var(--text-muted);">${v.n} rekod</div>
                            </td>`
                          : `<td style="padding:0.75rem 0.6rem;text-align:center;color:rgba(163,177,198,0.4);border-right:1px solid rgba(163,177,198,0.1);">—</td>`;
                      }).join('')}
                      <td style="padding:0.75rem 0.8rem;text-align:center;font-weight:800;font-size:0.88rem;background:rgba(163,177,198,0.06);">${branchTotals[b].d.toFixed(1)}<div style="font-size:0.6rem;font-weight:500;color:var(--text-muted);">${branchTotals[b].n} rekod</div></td>
                    </tr>`).join('')}
                  </tbody>
                  <tfoot>
                    <tr style="border-top:2px solid rgba(163,177,198,0.25);background:rgba(163,177,198,0.08);">
                      <td style="padding:0.85rem 1rem;font-weight:800;font-size:0.75rem;text-transform:uppercase;border-right:2px solid rgba(163,177,198,0.2);">Jumlah Keseluruhan</td>
                      ${activeTypes.map(t => {
                        const c = typeColorMap[t]||'#64748b';
                        return `<td style="padding:0.85rem 0.6rem;text-align:center;border-right:1px solid rgba(163,177,198,0.12);">
                          <div style="font-weight:800;font-size:0.88rem;color:${c};">${typeTotals[t].d.toFixed(1)}</div>
                          <div style="font-size:0.6rem;color:var(--text-muted);">${typeTotals[t].n}x</div>
                        </td>`;
                      }).join('')}
                      <td style="padding:0.85rem 0.8rem;text-align:center;font-weight:800;font-size:0.95rem;">${grandDays.toFixed(1)}</td>
                    </tr>
                  </tfoot>
                </table>`}
              </div>
            </section>
            `;
          })() : ''}

          ${hrReportTab === 'balance' ? (() => {
            const MONTHS = ['Jan','Feb','Mac','Apr','Mei','Jun','Jul','Ogo','Sep','Okt','Nov','Dis'];
            const allLeaveTypes = leaveCategories.map(c => c.id);
            const availBranchesForBalance = [...new Set(scopedRecords.map(r=>r.branch).filter(Boolean))].sort();
            const availYearsForBalance = [...new Set(leaveRecords.map(r=>r.id ? new Date(r.id).getFullYear().toString() : '').filter(Boolean))].sort().reverse();

            // Get staff pool: staff in selected branch (or all), include inactive if they have records
            let staffPool = staffList.filter(s => {
              if (reportBranch && s.branch !== reportBranch) return false;
              if (balanceReportBranch !== 'SEMUA' && s.branch !== balanceReportBranch) return false;
              const b = branches.find(br => br.name === s.branch);
              if (!reportBranch) {
                if (userStateScope !== 'all') {
                  if (!b || b.state !== userStateScope) return false;
                }
                if (reportDaerah && (!b || b.daerah !== reportDaerah)) return false;
              }
              return true;
            });

            // Records for balance — sama dengan getLeaveStats: APPROVED
            const approvedForBalance = leaveRecords.filter(r => {
              if (r.status !== 'APPROVED') return false;
              if (r.type !== balanceReportType) return false;
              if (balanceReportYear !== 'SEMUA' && (!r.id || new Date(r.id).getFullYear().toString() !== balanceReportYear)) return false;
              if (reportBranch && r.branch !== reportBranch) return false;
              if (!reportBranch && balanceReportBranch !== 'SEMUA' && r.branch !== balanceReportBranch) return false;
              if (!reportBranch) {
                const b = branches.find(br => br.name === r.branch);
                if (userStateScope !== 'all') {
                  if (!b || b.state !== userStateScope) return false;
                }
                if (reportDaerah && (!b || b.daerah !== reportDaerah)) return false;
              }
              return true;
            });

            // Build monthly usage map per staff IC — guna tarikh mohon (submission date)
            const usageByIc = {};
            approvedForBalance.forEach(r => {
              const m = r.id ? new Date(r.id).getMonth() + 1 : parseInt((r.startDate||'').substring(5,7));
              if (!m || m < 1 || m > 12) return;
              if (!usageByIc[r.ic]) usageByIc[r.ic] = Array(12).fill(0);
              usageByIc[r.ic][m-1] += parseFloat(r.days||0);
            });

            // Also include staff who have records but might not be in staffPool
            const icsWithRecords = [...new Set(approvedForBalance.map(r=>r.ic))];
            const extraIcs = icsWithRecords.filter(ic => !staffPool.find(s=>s.ic===ic));
            const extraStaff = extraIcs.map(ic => {
              const rec = approvedForBalance.find(r=>r.ic===ic);
              return { ic, name: rec?.name||ic, branch: rec?.branch||'-', category: '' };
            });
            const fullPool = [...staffPool, ...extraStaff];

            // Build rows — guna getLeaveStats supaya selari dengan dashboard staf
            const balanceRows = fullPool.map(s => {
              const monthlyUsed = usageByIc[s.ic] || Array(12).fill(0);
              // Guna getLeaveStats untuk entitlement + used total (sama dengan dashboard)
              const staffFull = staffList.find(x => x.ic === s.ic) || s;
              const stats = window.getLeaveStats(staffFull, balanceReportType);
              return {
                ic: s.ic,
                name: s.name,
                branch: s.branch,
                monthlyUsed,
                totalUsed: stats.used,
                entitlement: stats.ent
              };
            }).filter(r => r.totalUsed > 0 || staffPool.find(s=>s.ic===r.ic));

            // Expose to print function via closure-accessible variable
            window._balanceRows = balanceRows;

            // Group by branch for display
            const groupedByBranch = {};
            balanceRows.forEach(r => {
              if (!groupedByBranch[r.branch]) groupedByBranch[r.branch] = [];
              groupedByBranch[r.branch].push(r);
            });

            const grandTotalUsed = balanceRows.reduce((s,r)=>s+r.totalUsed,0);
            const grandEntitlement = balanceRows.reduce((s,r)=>s+r.entitlement,0);
            const monthlyGrandTotal = Array(12).fill(0).map((_,i)=>balanceRows.reduce((s,r)=>s+(r.monthlyUsed[i]||0),0));

            return `
            <!-- Balance Filter bar -->
            <div class="glass-card" style="padding:1rem 1.25rem;margin-bottom:1.25rem;display:flex;flex-wrap:wrap;gap:0.75rem;align-items:center;">
              <div style="font-size:0.72rem;font-weight:700;text-transform:uppercase;color:var(--text-muted);letter-spacing:0.5px;">Tapis:</div>
              <select class="neu-inset" style="padding:0.4rem 0.75rem;font-size:0.82rem;color-scheme:light;border-radius:8px;cursor:pointer;" onchange="window.setBalanceReportYear(this.value)">
                <option value="SEMUA" ${balanceReportYear==='SEMUA'?'selected':''}>Semua Tahun</option>
                ${availYearsForBalance.map(y=>`<option value="${y}" ${balanceReportYear===y?'selected':''}>${y}</option>`).join('')}
              </select>
              <select class="neu-inset" style="padding:0.4rem 0.75rem;font-size:0.82rem;color-scheme:light;border-radius:8px;cursor:pointer;" onchange="window.setBalanceReportBranch(this.value)">
                <option value="SEMUA" ${balanceReportBranch==='SEMUA'?'selected':''}>Semua Cawangan</option>
                ${availBranchesForBalance.map(b=>`<option value="${b}" ${balanceReportBranch===b?'selected':''}>${b}</option>`).join('')}
              </select>
              <select class="neu-inset" style="padding:0.4rem 0.75rem;font-size:0.82rem;color-scheme:light;border-radius:8px;cursor:pointer;" onchange="window.setBalanceReportType(this.value)">
                ${leaveCategories.map(c=>`<option value="${c.id}" ${balanceReportType===c.id?'selected':''}>${c.id} — ${c.name}</option>`).join('')}
              </select>
              <div style="margin-left:auto;font-size:0.72rem;color:var(--text-muted);font-weight:600;">${balanceRows.length} staf</div>
            </div>

            <!-- Summary stat cards -->
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:1rem;margin-bottom:1.25rem;">
              <div class="glass-card" style="padding:1rem 1.25rem;background:linear-gradient(135deg,rgba(124,58,237,0.1),rgba(139,92,246,0.05));border:1px solid rgba(124,58,237,0.2);">
                <div style="font-size:0.65rem;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:#7c3aed;margin-bottom:0.4rem;">Jumlah Staf</div>
                <div style="font-size:2rem;font-weight:800;color:#7c3aed;line-height:1;">${balanceRows.length}</div>
              </div>
              <div class="glass-card" style="padding:1rem 1.25rem;background:linear-gradient(135deg,rgba(239,68,68,0.08),rgba(248,113,113,0.04));border:1px solid rgba(239,68,68,0.18);">
                <div style="font-size:0.65rem;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:#dc2626;margin-bottom:0.4rem;">Jumlah Hari Digunakan</div>
                <div style="font-size:2rem;font-weight:800;color:#dc2626;line-height:1;">${grandTotalUsed.toFixed(1)}</div>
              </div>
              <div class="glass-card" style="padding:1rem 1.25rem;background:linear-gradient(135deg,rgba(5,150,105,0.1),rgba(16,185,129,0.05));border:1px solid rgba(5,150,105,0.2);">
                <div style="font-size:0.65rem;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:#059669;margin-bottom:0.4rem;">Jumlah Baki</div>
                <div style="font-size:2rem;font-weight:800;color:#059669;line-height:1;">${(grandEntitlement - grandTotalUsed).toFixed(1)}</div>
              </div>
            </div>

            <!-- Monthly usage heatmap row -->
            <div class="glass-card" style="padding:1rem 1.25rem;margin-bottom:1.25rem;">
              <div style="font-size:0.7rem;font-weight:800;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);margin-bottom:0.75rem;">Penggunaan Mengikut Bulan (${balanceReportType})</div>
              <div style="display:grid;grid-template-columns:repeat(12,1fr);gap:0.35rem;">
                ${monthlyGrandTotal.map((total,i) => {
                  const maxVal = Math.max(...monthlyGrandTotal, 1);
                  const pct = Math.round((total/maxVal)*100);
                  return `<div style="text-align:center;">
                    <div style="height:40px;background:rgba(124,58,237,0.08);border-radius:6px;position:relative;overflow:hidden;">
                      <div style="position:absolute;bottom:0;left:0;right:0;height:${pct}%;background:rgba(124,58,237,${0.15+pct/100*0.7});border-radius:6px;transition:height 0.3s;"></div>
                    </div>
                    <div style="font-size:0.58rem;color:var(--text-muted);font-weight:700;margin-top:0.2rem;">${MONTHS[i]}</div>
                    <div style="font-size:0.65rem;font-weight:800;color:${total>0?'#7c3aed':'var(--text-muted)'};">${total>0?total.toFixed(1):'-'}</div>
                  </div>`;
                }).join('')}
              </div>
            </div>

            <!-- Balance table grouped by branch -->
            <section class="glass-card fade-in" style="padding:0;overflow:hidden;">
              <div style="overflow-x:auto;">
                <table class="data-table" style="width:100%;border-collapse:collapse;margin:0;min-width:900px;">
                  <thead>
                    <tr style="font-size:0.62rem;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);border-bottom:1px solid rgba(163,177,198,0.25);">
                      <th style="padding:1rem;text-align:left;min-width:150px;">Nama Staf</th>
                      ${MONTHS.map(m=>`<th style="padding:1rem 0.5rem;text-align:center;min-width:42px;">${m}</th>`).join('')}
                      <th style="padding:1rem;text-align:center;color:#dc2626;">Guna</th>
                      <th style="padding:1rem;text-align:center;">Hak</th>
                      <th style="padding:1rem;text-align:center;color:#059669;">Baki</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${balanceRows.length === 0
                      ? `<tr><td colspan="16" style="padding:3rem;text-align:center;color:var(--text-muted);font-size:0.85rem;">Tiada rekod untuk ditunjukkan</td></tr>`
                      : (balanceReportBranch !== 'SEMUA'
                        ? balanceRows
                        : Object.entries(groupedByBranch).flatMap(([branch, rows]) => [
                            { _isBranchHeader: true, branch },
                            ...rows
                          ])
                      ).map(r => {
                        if (r._isBranchHeader) {
                          return `<tr style="background:rgba(124,58,237,0.06);">
                            <td colspan="16" style="padding:0.6rem 1rem;font-size:0.7rem;font-weight:800;text-transform:uppercase;letter-spacing:0.5px;color:#7c3aed;">
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align:middle;margin-right:4px;"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
                              ${r.branch}
                            </td>
                          </tr>`;
                        }
                        const bal = r.entitlement - r.totalUsed;
                        return `<tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
                          <td style="padding:0.85rem 1rem;">
                            <div style="font-weight:700;font-size:0.8rem;">${r.name}</div>
                            ${balanceReportBranch==='SEMUA'?'':''}
                          </td>
                          ${r.monthlyUsed.map(d=>`<td style="padding:0.85rem 0.5rem;text-align:center;font-size:0.78rem;font-weight:${d>0?'700':'400'};color:${d>0?'#7c3aed':'var(--text-muted)'};">${d>0?d.toFixed(1):'-'}</td>`).join('')}
                          <td style="padding:0.85rem 1rem;text-align:center;font-weight:800;font-size:0.88rem;color:#dc2626;">${r.totalUsed.toFixed(1)}</td>
                          <td style="padding:0.85rem 1rem;text-align:center;font-weight:700;font-size:0.85rem;color:var(--text-muted);">${r.entitlement}</td>
                          <td style="padding:0.85rem 1rem;text-align:center;font-weight:800;font-size:0.88rem;color:${bal<=0?'#dc2626':'#059669'};">${bal.toFixed(1)}</td>
                        </tr>`;
                      }).join('')
                    }
                  </tbody>
                  ${balanceRows.length > 0 ? `
                  <tfoot>
                    <tr style="border-top:1px solid rgba(124,58,237,0.3);background:rgba(124,58,237,0.05);">
                      <td style="padding:0.85rem 1rem;font-size:0.72rem;font-weight:800;text-transform:uppercase;color:var(--text-muted);">Jumlah</td>
                      ${monthlyGrandTotal.map(t=>`<td style="padding:0.85rem 0.5rem;text-align:center;font-weight:800;font-size:0.78rem;color:${t>0?'#7c3aed':'var(--text-muted)'};">${t>0?t.toFixed(1):'-'}</td>`).join('')}
                      <td style="padding:0.85rem 1rem;text-align:center;font-weight:800;color:#dc2626;">${grandTotalUsed.toFixed(1)}</td>
                      <td style="padding:0.85rem 1rem;text-align:center;font-weight:800;color:var(--text-muted);">${grandEntitlement}</td>
                      <td style="padding:0.85rem 1rem;text-align:center;font-weight:800;color:#059669;">${(grandEntitlement-grandTotalUsed).toFixed(1)}</td>
                    </tr>
                  </tfoot>` : ''}
                </table>
              </div>
            </section>
            `;
          })() : ''}

          ${hrReportTab === 'attendance' && userPerms.report_attendance ? (() => {
            const MONTHS_MS = ['Januari','Februari','Mac','April','Mei','Jun','Julai','Ogos','September','Oktober','November','Disember'];
            const availYearsA = [...new Set(leaveRecords.map(r=>r.id ? new Date(r.id).getFullYear().toString() : '').filter(Boolean))].sort().reverse();
            const scopedBranchesA = [...new Set(staffList.filter(s=>!s.inactive).map(s=>s.branch).filter(Boolean))].sort().filter(b => {
              if (reportBranch) return b === reportBranch;
              const bObj = branches.find(br => br.name === b);
              if (!bObj) return userStateScope === 'all';
              if (userStateScope !== 'all' && bObj.state !== userStateScope) return false;
              if (reportDaerah && bObj.daerah !== reportDaerah) return false;
              return true;
            });

            const monthPrefix = attendanceReportYear + '-' + String(attendanceReportMonth).padStart(2,'0');

            const _selBranch = attendanceReportBranch; // tangkap nilai semasa
            const attStaffPool = staffList.filter(s => {
              if (s.inactive) return false;
              if (reportBranch && s.branch !== reportBranch) return false;
              if (_selBranch && _selBranch !== 'SEMUA' && s.branch !== _selBranch) return false;
              const bObj = branches.find(b => b.name === s.branch);
              if (userStateScope !== 'all') { if (!bObj || bObj.state !== userStateScope) return false; }
              if (reportDaerah && (!bObj || bObj.daerah !== reportDaerah)) return false;
              return true;
            });

            const getML = ic => {
              const t = {};
              leaveRecords.filter(r => r.ic===ic && r.status==='APPROVED' &&
                r.id && new Date(r.id).getFullYear().toString()===attendanceReportYear &&
                String(new Date(r.id).getMonth()+1)===attendanceReportMonth)
                .forEach(r => { t[r.type]=(t[r.type]||0)+parseFloat(r.days||0); });
              return t;
            };
            const getYL = ic => {
              const t = {};
              leaveRecords.filter(r => r.ic===ic && r.status==='APPROVED' &&
                r.id && new Date(r.id).getFullYear().toString()===attendanceReportYear)
                .forEach(r => { t[r.type]=(t[r.type]||0)+parseFloat(r.days||0); });
              return t;
            };

            const fmtV = v => v > 0
              ? `<span style="font-weight:800;color:var(--text);">${v%1===0?v:v.toFixed(1)}</span>`
              : `<span style="color:rgba(163,177,198,0.35);">—</span>`;
            const fmtBal = (rem, ent) => {
              const r = parseFloat(rem.toFixed(1)), e = Math.round(ent);
              return `<span style="font-weight:700;">${r%1===0?r:r}</span><span style="color:var(--text-muted);">/${e}</span>`;
            };

            const renderAttRow = (s, idx, isDoctor) => {
              const ml = getML(s.ic), yl = getYL(s.ic);
              // Baki Cuti = baki Formula B (getLeaveStats) / peruntukan setahun
              const alSt = window.getLeaveStats(s, 'AL');
              const alEnt = alSt.ent, alRem = alSt.bal;
              const mcSt = window.getLeaveStats(s, 'MC');
              const mcEnt = mcSt.ent, mcRem = mcSt.bal;
              const al = ml['AL']||0, mc = ml['MC']||0;
              const el = (ml['EL']||0)+(ml['EL_EMG']||0), up = ml['UP']||0;
              const last = isDoctor ? (ml['CME']||0) : ((ml['HL']||0)+(ml['ML']||0)+(ml['ML_PL']||0));
              const rowHasLeave = al||mc||el||up||last;
              return `<tr style="border-bottom:1px solid rgba(163,177,198,0.1);background:${idx%2===0?'transparent':'rgba(163,177,198,0.025)'};"
                onmouseover="this.style.background='rgba(59,130,246,0.05)'" onmouseout="this.style.background='${idx%2===0?'transparent':'rgba(163,177,198,0.025)'}'">
                <td style="padding:0.55rem 0.75rem;text-align:center;font-size:0.68rem;color:var(--text-muted);">${idx+1}</td>
                <td style="padding:0.55rem 0.75rem;font-weight:${rowHasLeave?700:500};font-size:0.78rem;">${s.name}</td>
                <td style="padding:0.55rem 0.5rem;text-align:center;">${fmtV(al)}</td>
                <td style="padding:0.55rem 0.5rem;text-align:center;">${fmtV(mc)}</td>
                <td style="padding:0.55rem 0.5rem;text-align:center;">${fmtV(el)}</td>
                <td style="padding:0.55rem 0.5rem;text-align:center;">${fmtV(up)}</td>
                <td style="padding:0.55rem 0.5rem;text-align:center;">${fmtV(last)}</td>
                <td style="padding:0.55rem 0.75rem;text-align:center;border-left:1px solid rgba(163,177,198,0.15);font-size:0.75rem;color:#3b82f6;">${fmtBal(alRem,alEnt)}</td>
                <td style="padding:0.55rem 0.75rem;text-align:center;font-size:0.75rem;color:#10b981;">${fmtBal(mcRem,mcEnt)}</td>
              </tr>`;
            };

            const renderAttSection = (title, arr, isDoctor, color) => {
              if (!arr.length) return '';
              const lastLabel = isDoctor ? 'CME' : 'LL';
              const lastColor = isDoctor ? '#8b5cf6' : '#06b6d4';
              const totAL = arr.reduce((s,x)=>s+(getML(x.ic)['AL']||0),0);
              const totMC = arr.reduce((s,x)=>s+(getML(x.ic)['MC']||0),0);
              const totEL = arr.reduce((s,x)=>s+((getML(x.ic)['EL']||0)+(getML(x.ic)['EL_EMG']||0)),0);
              const totUP = arr.reduce((s,x)=>s+(getML(x.ic)['UP']||0),0);
              const totLast = isDoctor
                ? arr.reduce((s,x)=>s+(getML(x.ic)['CME']||0),0)
                : arr.reduce((s,x)=>s+((getML(x.ic)['HL']||0)+(getML(x.ic)['ML']||0)+(getML(x.ic)['ML_PL']||0)),0);
              return `
              <div style="margin-bottom:1.5rem;">
                <div style="padding:0.6rem 1rem;background:${color}18;border-left:3px solid ${color};font-weight:700;font-size:0.75rem;text-transform:uppercase;letter-spacing:0.8px;color:${color};">
                  ${title} <span style="font-weight:500;font-size:0.68rem;color:var(--text-muted);margin-left:0.5rem;">(${arr.length} orang)</span>
                </div>
                <section class="glass-card" style="padding:0;overflow:hidden;border-radius:0 0 12px 12px;border-top:none;">
                  <div style="overflow-x:auto;">
                    <table style="width:100%;border-collapse:collapse;font-size:0.73rem;">
                      <thead>
                        <tr style="background:rgba(163,177,198,0.07);border-bottom:1px solid rgba(163,177,198,0.2);">
                          <th style="padding:0.55rem 0.75rem;text-align:center;font-size:0.6rem;font-weight:700;color:var(--text-muted);min-width:32px;">Bil</th>
                          <th style="padding:0.55rem 0.75rem;text-align:left;font-size:0.6rem;font-weight:700;color:var(--text-muted);min-width:180px;">Nama</th>
                          <th style="padding:0.55rem 0.5rem;text-align:center;font-size:0.63rem;font-weight:700;color:#3b82f6;min-width:42px;" title="Annual Leave">AL</th>
                          <th style="padding:0.55rem 0.5rem;text-align:center;font-size:0.63rem;font-weight:700;color:#10b981;min-width:42px;" title="Medical Certificate">MC</th>
                          <th style="padding:0.55rem 0.5rem;text-align:center;font-size:0.63rem;font-weight:700;color:#f59e0b;min-width:42px;" title="Emergency Leave">EL</th>
                          <th style="padding:0.55rem 0.5rem;text-align:center;font-size:0.63rem;font-weight:700;color:#94a3b8;min-width:42px;" title="Unpaid Leave">UPL</th>
                          <th style="padding:0.55rem 0.5rem;text-align:center;font-size:0.63rem;font-weight:700;color:${lastColor};min-width:42px;" title="${isDoctor?'CME':'Hospitalization/Bersalin/Lain-lain'}">${lastLabel}</th>
                          <th style="padding:0.55rem 0.75rem;text-align:center;font-size:0.6rem;font-weight:700;color:#3b82f6;border-left:1px solid rgba(163,177,198,0.2);min-width:72px;">Baki Cuti</th>
                          <th style="padding:0.55rem 0.75rem;text-align:center;font-size:0.6rem;font-weight:700;color:#10b981;min-width:62px;">Baki MC</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${arr.map((s,i)=>renderAttRow(s,i,isDoctor)).join('')}
                      </tbody>
                      <tfoot>
                        <tr style="border-top:1px solid rgba(163,177,198,0.25);background:rgba(163,177,198,0.06);">
                          <td colspan="2" style="padding:0.65rem 0.75rem;font-size:0.68rem;font-weight:700;color:var(--text-muted);">Jumlah bulan ini</td>
                          <td style="padding:0.65rem 0.5rem;text-align:center;font-weight:800;font-size:0.8rem;color:#3b82f6;">${totAL>0?totAL.toFixed(1).replace('.0',''):'—'}</td>
                          <td style="padding:0.65rem 0.5rem;text-align:center;font-weight:800;font-size:0.8rem;color:#10b981;">${totMC>0?totMC.toFixed(1).replace('.0',''):'—'}</td>
                          <td style="padding:0.65rem 0.5rem;text-align:center;font-weight:800;font-size:0.8rem;color:#f59e0b;">${totEL>0?totEL.toFixed(1).replace('.0',''):'—'}</td>
                          <td style="padding:0.65rem 0.5rem;text-align:center;font-weight:800;font-size:0.8rem;color:#94a3b8;">${totUP>0?totUP:'—'}</td>
                          <td style="padding:0.65rem 0.5rem;text-align:center;font-weight:800;font-size:0.8rem;color:${lastColor};">${totLast>0?totLast:'—'}</td>
                          <td colspan="2"></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </section>
              </div>`;
            };

            const attKakitangan = attStaffPool.filter(s=>s.category!=='Doctor').sort((a,b)=>a.name.localeCompare(b.name));
            const attDoktor = attStaffPool.filter(s=>s.category==='Doctor').sort((a,b)=>a.name.localeCompare(b.name));

            return `
            <!-- Filter bar -->
            <div class="glass-card" style="padding:1rem 1.25rem;margin-bottom:1.25rem;display:flex;flex-wrap:wrap;gap:0.75rem;align-items:center;">
              <div style="font-size:0.72rem;font-weight:700;text-transform:uppercase;color:var(--text-muted);letter-spacing:0.5px;">Tapis:</div>
              <select class="neu-inset" style="padding:0.4rem 0.75rem;font-size:0.82rem;color-scheme:light;border-radius:8px;cursor:pointer;" onchange="window.setAttendanceMonth(this.value)">
                ${MONTHS_MS.map((m,i)=>`<option value="${i+1}" ${attendanceReportMonth==i+1?'selected':''}>${m}</option>`).join('')}
              </select>
              <select class="neu-inset" style="padding:0.4rem 0.75rem;font-size:0.82rem;color-scheme:light;border-radius:8px;cursor:pointer;" onchange="window.setAttendanceYear(this.value)">
                ${availYearsA.map(y=>`<option value="${y}" ${attendanceReportYear===y?'selected':''}>${y}</option>`).join('')}
              </select>
              ${!reportBranch ? `<select class="neu-inset" style="padding:0.4rem 0.75rem;font-size:0.82rem;color-scheme:light;border-radius:8px;cursor:pointer;" onchange="window.setAttendanceBranch(this.value)">
                <option value="SEMUA" ${attendanceReportBranch==='SEMUA'?'selected':''}>Semua Cawangan</option>
                ${scopedBranchesA.map(b=>`<option value="${b}" ${attendanceReportBranch===b?'selected':''}>${b}</option>`).join('')}
              </select>` : ''}
              <div style="margin-left:auto;font-size:0.72rem;color:var(--text-muted);font-weight:600;">${attStaffPool.length} kakitangan</div>
            </div>

            <!-- Report title -->
            <div style="text-align:center;margin-bottom:1.5rem;padding:1rem;background:rgba(163,177,198,0.05);border-radius:12px;border:1px solid rgba(163,177,198,0.15);">
              <div style="font-size:0.9rem;font-weight:800;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:0.25rem;">SENARAI BILANGAN CUTI, MC DAN EL KAKITANGAN</div>
              <div style="display:inline-flex;align-items:center;gap:0.5rem;background:rgba(30,41,59,0.08);border:1px solid rgba(30,41,59,0.2);border-radius:20px;padding:0.3rem 1rem;margin:0.4rem 0;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
                <span style="font-size:0.75rem;font-weight:700;">Cawangan: ${_selBranch === 'SEMUA' ? (reportBranch || 'Semua Cawangan') : _selBranch}</span>
              </div>
              <div style="font-size:0.78rem;font-weight:700;color:var(--primary);margin-top:0.2rem;">BULAN: ${MONTHS_MS[parseInt(attendanceReportMonth)-1].toUpperCase()} ${attendanceReportYear}</div>
              <div style="font-size:0.7rem;color:var(--text-muted);margin-top:0.2rem;">${attStaffPool.length} kakitangan</div>
            </div>

            ${renderAttSection('KAKITANGAN', attKakitangan, false, '#3b82f6')}
            ${renderAttSection('DOKTOR', attDoktor, true, '#8b5cf6')}
            ${attStaffPool.length === 0 ? `<div style="padding:3rem;text-align:center;color:var(--text-muted);">Tiada kakitangan untuk ditunjukkan</div>` : ''}
            `;
          })() : ''}
        `; })() : ''}

        ${managementTab === 'staff' ? `
        <header class="top-bar">
          <h1>Management Hub</h1>
          <button class="btn-primary" onclick="window.openAddStaff()" style="width: auto; padding: 0.75rem 1.5rem;">+ Tambah Staf</button>
        </header>

                <section class="glass-card" style="padding: 1rem 1.25rem;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;flex-wrap:wrap;gap:0.6rem;">
            <div style="display:flex;align-items:center;gap:0.6rem;flex-wrap:wrap;">
              <button onclick="window.toggleAllBranches(true)" style="padding:0.3rem 0.8rem;border-radius:999px;border:1px solid rgba(163,177,198,0.45);background:rgba(255,255,255,0.6);font-size:0.78rem;font-weight:600;color:var(--text-soft);cursor:pointer;">▼ Buka Semua</button>
              <button onclick="window.toggleAllBranches(false)" style="padding:0.3rem 0.8rem;border-radius:999px;border:1px solid rgba(163,177,198,0.45);background:rgba(255,255,255,0.6);font-size:0.78rem;font-weight:600;color:var(--text-soft);cursor:pointer;">▶ Tutup Semua</button>
              <div style="display:flex;align-items:center;gap:0.4rem;">
                <div class="neu-toggle ${showInactiveStaff ? 'active' : ''}" onclick="window.toggleInactive()"></div>
                <span style="font-size:0.75rem;font-weight:600;color:${showInactiveStaff ? '#ef4444' : 'var(--text-muted)'};text-transform:uppercase;letter-spacing:0.4px;">${showInactiveStaff ? 'Melihat: Tidak Aktif' : 'Tidak Aktif'}</span>
              </div>
              <select onchange="window.setManageRoleFilter(this.value)" style="padding:0.3rem 0.7rem;border-radius:999px;border:1px solid rgba(163,177,198,0.45);background:rgba(255,255,255,0.6);font-size:0.78rem;font-weight:600;color:var(--text-soft);cursor:pointer;color-scheme:light;">
                ${[
                  { val: 'SEMUA', label: 'Semua Peranan' },
                  { val: 'super_admin', label: 'Super Admin' },
                  { val: 'admin', label: 'Admin' },
                  { val: 'hr', label: 'HR' },
                  { val: 'hod_cawangan', label: 'HOD Cawangan' },
                  { val: 'hod_balok', label: 'HOD Balok' },
                  { val: 'doctor_pic', label: 'Doctor PIC' },
                  { val: 'supervisor', label: 'Supervisor' },
                  { val: 'team_leader', label: 'Team Leader' },
                  { val: 'staff', label: 'Staff' },
                ].map(o => '<option value="' + o.val + '"' + (manageRoleFilter === o.val ? ' selected' : '') + '>' + o.label + '</option>').join('')}
              </select>
              <select onchange="window.setManageCategoryFilter(this.value)" style="padding:0.3rem 0.7rem;border-radius:999px;border:1px solid rgba(163,177,198,0.45);background:rgba(255,255,255,0.6);font-size:0.78rem;font-weight:600;color:var(--text-soft);cursor:pointer;color-scheme:light;">
                ${[
                  { val: 'SEMUA', label: 'Semua Kategori' },
                  { val: 'Doctor', label: 'Doktor' },
                  { val: 'Admin Staff', label: 'Admin Staff' },
                  { val: 'Operation Staff', label: 'Operasi' },
                ].map(o => '<option value="' + o.val + '"' + (manageCategoryFilter === o.val ? ' selected' : '') + '>' + o.label + '</option>').join('')}
              </select>
            </div>
            <input type="text" id="manage-staff-search" class="neu-inset" placeholder="Cari nama / IC..." value="${manageSearchQuery}" oninput="window.setManageSearch(this.value)" style="width:180px;padding:0.4rem 0.8rem;border-radius:10px;font-size:0.82rem;color-scheme:light;">
          </div>
          ${stateGroupedHtml}
        </section>
        ` : ''}

        ${managementTab === 'branches' ? `
        <header class="top-bar" style="margin-bottom: 1rem;">
          <h1>Pengurusan Cawangan</h1>
          ${canManageBranches ? `
          <div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;">
            <input id="new-branch-name" type="text" class="neu-inset" placeholder="Nama cawangan baru..." style="padding:0.4rem 0.8rem;border-radius:10px;font-size:0.85rem;width:200px;color-scheme:light;">
            <select id="new-branch-state" class="neu-inset" style="padding:0.4rem 0.8rem;border-radius:10px;font-size:0.85rem;color-scheme:light;cursor:pointer;" onchange="window.updateDaerahOptions()">
              ${MY_STATES.map(s => '<option value="' + s + '">' + s + '</option>').join('')}
            </select>
            <select id="new-branch-daerah" class="neu-inset" style="padding:0.4rem 0.8rem;border-radius:10px;font-size:0.85rem;color-scheme:light;cursor:pointer;">
              <option value="">— Daerah (pilihan) —</option>
              ${PAHANG_DAERAH.map(d => '<option value="' + d + '">' + d + '</option>').join('')}
            </select>
            <button onclick="window.addNewBranch()" class="btn-primary" style="width:auto;padding:0.4rem 1rem;font-size:0.85rem;">+ Tambah</button>
          </div>
          ` : ''}
        </header>

        <section class="glass-card" style="padding:1rem 1.25rem;">
          ${(() => {
            const allStates = [...new Set(branches.map(b => b.state || 'Lain-lain'))];
            const orderedStates = ['Pahang','Terengganu'].concat(allStates.filter(s => s !== 'Pahang' && s !== 'Terengganu'));
            return orderedStates.map(stateName => {
              const stateBranches = branches.filter(b => (b.state || 'Lain-lain') === stateName);
              if (stateBranches.length === 0) return '';
              const stateColor = stateName === 'Pahang' ? '#4361ee' : stateName === 'Terengganu' ? '#0d9488' : '#7c3aed';
              const stateBg    = stateName === 'Pahang' ? 'rgba(67,97,238,0.07)' : stateName === 'Terengganu' ? 'rgba(13,148,136,0.07)' : 'rgba(124,58,237,0.07)';
              const daerahColor = stateName === 'Pahang' ? '#6d7fe8' : stateName === 'Terengganu' ? '#14b8a6' : '#9d6fe8';
              const daerahBg    = stateName === 'Pahang' ? 'rgba(67,97,238,0.04)' : stateName === 'Terengganu' ? 'rgba(13,148,136,0.04)' : 'rgba(124,58,237,0.04)';

              // Kumpul cawangan mengikut daerah
              const daerahMap = {};
              stateBranches.forEach(b => {
                const d = b.daerah || 'Lain-lain';
                if (!daerahMap[d]) daerahMap[d] = [];
                daerahMap[d].push(b);
              });
              const orderedDaerah = (STATE_DAERAH[stateName] || []).filter(d => daerahMap[d]);
              const remaining = Object.keys(daerahMap).filter(d => !orderedDaerah.includes(d));
              const allDaerah = orderedDaerah.concat(remaining);

              return '<div style="margin-bottom:1.5rem;">'
                + '<div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:0.75rem;padding:0.5rem 0.9rem;background:' + stateBg + ';border-radius:8px;border-left:3px solid ' + stateColor + ';">'
                + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="' + stateColor + '" stroke-width="2.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>'
                + '<span style="font-size:0.9rem;font-weight:700;color:' + stateColor + ';">Negeri ' + stateName + '</span>'
                + '<span style="font-size:0.72rem;color:var(--text-muted);background:rgba(163,177,198,0.12);padding:0.1rem 0.5rem;border-radius:999px;">' + stateBranches.length + ' cawangan</span>'
                + '</div>'
                + allDaerah.map(daerahName => {
                    const daerahBranches = daerahMap[daerahName];
                    return '<div style="margin-left:0.9rem;margin-bottom:0.85rem;">'
                      + '<div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.35rem;padding:0.3rem 0.75rem;background:' + daerahBg + ';border-radius:6px;border-left:2px solid ' + daerahColor + ';">'
                      + '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="' + daerahColor + '" stroke-width="2.5"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>'
                      + '<span style="font-size:0.78rem;font-weight:700;color:' + daerahColor + ';">Daerah ' + daerahName + '</span>'
                      + '<span style="font-size:0.68rem;color:var(--text-muted);">' + daerahBranches.length + ' cawangan</span>'
                      + '</div>'
                      + daerahBranches.map(b => {
                          return '<div style="display:flex;align-items:center;gap:0.75rem;padding:0.45rem 0.75rem 0.45rem 1.5rem;border-bottom:1px solid rgba(163,177,198,0.1);flex-wrap:wrap;">'
                            + '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2" style="flex-shrink:0;"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>'
                            + '<span style="flex:1;font-size:0.84rem;font-weight:600;color:var(--text);min-width:160px;">' + b.name + '</span>'
                            + (canManageBranches && b.docId
                                ? window.buildStateSelect(b.state, b.docId)
                                  + ' ' + window.buildDaerahSelect(b.daerah, b.docId, b.state)
                                  + ' <button data-docid="' + b.docId + '" data-name="' + b.name.replace(/"/g,'') + '" onclick="window.deleteBranchById(this.dataset.docid, this.dataset.name)" style="padding:0.2rem 0.5rem;border-radius:6px;border:1px solid rgba(239,68,68,0.3);background:rgba(239,68,68,0.07);color:#ef4444;font-size:0.72rem;cursor:pointer;">Padam</button>'
                                : '<span style="font-size:0.75rem;color:var(--text-muted);background:rgba(163,177,198,0.1);padding:0.15rem 0.5rem;border-radius:999px;">' + (b.state || '-') + (b.daerah ? ' · ' + b.daerah : '') + '</span>')
                            + '</div>';
                        }).join('')
                      + '</div>';
                  }).join('')
                + '</div>';
            }).join('');
          })()}
        </section>
        ` : ''}

        ${managementTab === 'routing' && canManageRouting ? (() => {
          const rows = [
            { key:'terengganu',       label:'Semua Kakitangan',  sub:'Terengganu',           color:'#0d9488', bg:'rgba(13,148,136,0.06)'  },
            { key:'pahang_lain',      label:'Semua Kakitangan',  sub:'Pahang (Selain Balok)', color:'#3b82f6', bg:'rgba(59,130,246,0.06)'  },
            { key:'admin_balok',      label:'Kakitangan Admin',  sub:'Balok (HQ)',            color:'#0ea5e9', bg:'rgba(14,165,233,0.06)'  },
            { key:'doctor_pahang',    label:'Doktor',            sub:'Pahang (Selain Bentong)', color:'#d97706', bg:'rgba(217,119,6,0.06)'  },
            { key:'operation_balok',  label:'Kakitangan Operasi',sub:'Balok (HQ)',            color:'#10b981', bg:'rgba(16,185,129,0.06)'  },
            { key:'xray_sono_balok',  label:'Juru X-Ray / Sono', sub:'Balok (HQ)',            color:'#ec4899', bg:'rgba(236,72,153,0.06)'  },
            { key:'juru_audio_balok', label:'Juru Audio',        sub:'Balok (HQ)',            color:'#0d9488', bg:'rgba(13,148,136,0.06)'  },
          ];
          const cols = [
            { field:'needs_tl',      label:'Team Leader', grp:'p0', color:'#f43f5e' },
            { field:'p1_doctor_pic', label:'Doctor PIC',  grp:'p1', color:'#818cf8' },
            { field:'p1_hod_balok',  label:'HOD Balok',   grp:'p1', color:'#0ea5e9' },
            { field:'p1_supervisor', label:'Supervisor',  grp:'p1', color:'#34d399', note:'★ Supervisor Balok bagi Operasi/Doktor Balok' },
            { field:'needs_p2',      label:'Perlu P2?',   grp:'p2', color:'#f97316' },
          ];
          const mkCell = (group, field, checked, color) =>
            `<td style="padding:0.55rem 0.5rem;border-right:1px solid rgba(163,177,198,0.12);cursor:pointer;text-align:center;" onclick="window.toggleRouting('${group}','${field}')">
              <div style="display:flex;align-items:center;justify-content:center;pointer-events:none;">
                ${checked
                  ? `<div style="width:28px;height:28px;border-radius:7px;background:${color}20;border:1px solid ${color}50;display:flex;align-items:center;justify-content:center;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></div>`
                  : '<div style="width:28px;height:28px;border-radius:7px;background:rgba(239,68,68,0.07);border:1px solid rgba(239,68,68,0.15);display:flex;align-items:center;justify-content:center;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></div>'}
              </div>
            </td>`;
          return `
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.5rem;flex-wrap:wrap;gap:1rem;">
            <div style="display:flex;align-items:center;gap:0.85rem;">
              <div style="width:42px;height:42px;border-radius:11px;background:rgba(109,40,217,0.12);border:1px solid rgba(109,40,217,0.25);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6d28d9" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
              </div>
              <div>
                <h2 style="font-size:1.05rem;font-weight:700;margin:0;">Matrix Laluan Kelulusan</h2>
                <p style="font-size:0.72rem;color:var(--text-muted);margin:0.2rem 0 0;">Klik sel untuk togol · Tekan <strong>Simpan</strong> untuk berkuat kuasa</p>
              </div>
            </div>
            <button onclick="window.saveRouting()" class="btn-primary" style="width:auto;padding:0.65rem 1.4rem;display:flex;align-items:center;gap:0.5rem;font-weight:600;font-size:0.82rem;background:linear-gradient(135deg,#6d28d9 0%,#4f46e5 100%);">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
              Simpan Matrix
            </button>
          </div>

          <div style="display:flex;flex-wrap:wrap;gap:0.5rem;margin-bottom:1rem;">
            <div style="display:flex;align-items:center;gap:0.4rem;background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.2);border-radius:6px;padding:0.28rem 0.65rem;">
              <div style="width:16px;height:16px;border-radius:4px;background:rgba(16,185,129,0.18);display:flex;align-items:center;justify-content:center;"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></div>
              <span style="font-size:0.68rem;color:#34d399;font-weight:600;">Aktif</span>
            </div>
            <div style="display:flex;align-items:center;gap:0.4rem;background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.18);border-radius:6px;padding:0.28rem 0.65rem;">
              <div style="width:16px;height:16px;border-radius:4px;background:rgba(239,68,68,0.1);display:flex;align-items:center;justify-content:center;"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></div>
              <span style="font-size:0.68rem;color:#ef4444;font-weight:600;">Tidak Aktif</span>
            </div>
            <div style="font-size:0.68rem;color:var(--text-muted);padding:0.28rem 0.65rem;background:rgba(163,177,198,0.06);border:1px solid rgba(163,177,198,0.2);border-radius:6px;">★ Supervisor bagi Doktor Pahang (Selain Bentong) & Op. Balok = Supervisor Balok (HQ)</div>
          </div>

          <section class="glass-card fade-in" style="padding:0;overflow:hidden;border:1px solid rgba(163,177,198,0.3);">
            <div style="overflow-x:auto;">
              <table style="width:100%;border-collapse:collapse;font-size:0.78rem;">
                <thead>
                  <tr style="background:rgba(163,177,198,0.03);border-bottom:1px solid rgba(163,177,198,0.15);">
                    <th colspan="2" style="padding:0.55rem 0.75rem;font-weight:700;font-size:0.67rem;letter-spacing:0.8px;text-transform:uppercase;color:#6d28d9;border-right:2px solid rgba(163,177,198,0.25);text-align:left;">Kumpulan Kakitangan</th>
                    <th colspan="1" style="padding:0.55rem 0.75rem;font-weight:700;font-size:0.67rem;letter-spacing:0.8px;text-transform:uppercase;color:#f43f5e;border-right:2px solid rgba(163,177,198,0.25);text-align:center;">🟥 Peringkat 0 — Sokongan TL</th>
                    <th colspan="3" style="padding:0.55rem 0.75rem;font-weight:700;font-size:0.67rem;letter-spacing:0.8px;text-transform:uppercase;color:#38bdf8;border-right:2px solid rgba(163,177,198,0.25);text-align:center;">⬛ Peringkat 1 — Pelulus</th>
                    <th colspan="1" style="padding:0.55rem 0.75rem;font-weight:700;font-size:0.67rem;letter-spacing:0.8px;text-transform:uppercase;color:#f97316;text-align:center;">🔒 Peringkat 2</th>
                  </tr>
                  <tr style="background:rgba(163,177,198,0.03);border-bottom:2px solid rgba(163,177,198,0.2);">
                    <th style="padding:0.5rem 1rem;font-weight:600;font-size:0.63rem;color:var(--text-muted);border-right:1px solid rgba(163,177,198,0.12);text-align:left;white-space:nowrap;">Kategori</th>
                    <th style="padding:0.5rem 0.75rem;font-weight:600;font-size:0.63rem;color:var(--text-muted);border-right:2px solid rgba(163,177,198,0.25);text-align:left;white-space:nowrap;">Skop</th>
                    ${cols.map((c,i) => `<th style="padding:0.5rem 0.5rem;font-weight:600;font-size:0.63rem;color:${c.color};border-right:${i===0||i===3?'2px':'1px'} solid rgba(163,177,198,${i===0||i===3?'0.25':'0.12'});text-align:center;white-space:nowrap;">${c.label}</th>`).join('')}
                  </tr>
                </thead>
                <tbody>
                  ${rows.map((r, idx) => {
                    const cfg = approvalRouting[r.key] || {};
                    const rowBg = idx % 2 === 0 ? 'transparent' : 'rgba(163,177,198,0.03)';
                    return `<tr style="border-bottom:1px solid rgba(163,177,198,0.1);background:${rowBg};transition:background 0.15s;" onmouseover="this.style.background='rgba(109,40,217,0.04)'" onmouseout="this.style.background='${rowBg}'">
                      <td style="padding:0.6rem 1rem;border-right:1px solid rgba(163,177,198,0.12);">
                        <span style="display:inline-block;background:${r.bg};color:${r.color};border:1px solid ${r.color}30;border-radius:6px;padding:0.18rem 0.55rem;font-weight:700;font-size:0.73rem;">${r.label}</span>
                      </td>
                      <td style="padding:0.6rem 0.75rem;border-right:2px solid rgba(163,177,198,0.25);font-size:0.75rem;color:var(--text-muted);font-weight:600;">${r.sub}</td>
                      ${cols.map((c,i) => {
                        const thick = i === 0 || i === 3;
                        const borderRight = `${thick ? '2' : '1'}px solid rgba(163,177,198,${thick ? '0.25' : '0.12'})`;
                        return `<td style="padding:0.55rem 0.5rem;border-right:${borderRight};cursor:pointer;text-align:center;" onclick="window.toggleRouting('${r.key}','${c.field}')">
                          <div style="display:flex;align-items:center;justify-content:center;pointer-events:none;">
                            ${!!cfg[c.field]
                              ? `<div style="width:28px;height:28px;border-radius:7px;background:${c.color}20;border:1px solid ${c.color}50;display:flex;align-items:center;justify-content:center;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="${c.color}" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></div>`
                              : '<div style="width:28px;height:28px;border-radius:7px;background:rgba(239,68,68,0.07);border:1px solid rgba(239,68,68,0.15);display:flex;align-items:center;justify-content:center;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></div>'}
                          </div>
                        </td>`;
                      }).join('')}
                    </tr>`;
                  }).join('')}
                </tbody>
              </table>
            </div>
          </section>

          <!-- ── Jadual Laluan Kelulusan ─────────────────────────────── -->
          <div style="margin-top:2rem;">
            <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:1rem;">
              <div style="width:36px;height:36px;border-radius:9px;background:rgba(59,130,246,0.12);border:1px solid rgba(59,130,246,0.25);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
              </div>
              <div>
                <h3 style="font-size:0.95rem;font-weight:700;margin:0;">Jadual Laluan Kelulusan (Ringkasan)</h3>
                <p style="font-size:0.7rem;color:var(--text-muted);margin:0.15rem 0 0;">Paparan aliran kelulusan semasa mengikut tetapan matrix di atas</p>
              </div>
            </div>

            <section class="glass-card fade-in" style="padding:0;overflow:hidden;border:1px solid rgba(59,130,246,0.2);">
              <div style="overflow-x:auto;">
                <table style="width:100%;border-collapse:collapse;font-size:0.78rem;">
                  <thead>
                    <tr style="background:linear-gradient(135deg,rgba(59,130,246,0.08),rgba(139,92,246,0.06));border-bottom:2px solid rgba(163,177,198,0.2);">
                      <th style="padding:0.7rem 1rem;font-weight:700;font-size:0.67rem;letter-spacing:0.8px;text-transform:uppercase;color:var(--text-muted);border-right:1px solid rgba(163,177,198,0.15);text-align:left;white-space:nowrap;">Kumpulan Kakitangan</th>
                      <th style="padding:0.7rem 0.85rem;font-weight:700;font-size:0.67rem;letter-spacing:0.8px;text-transform:uppercase;color:var(--text-muted);border-right:2px solid rgba(163,177,198,0.25);text-align:left;white-space:nowrap;">Cawangan / Skop</th>
                      <th style="padding:0.7rem 0.85rem;font-weight:700;font-size:0.67rem;letter-spacing:0.8px;text-transform:uppercase;color:#f43f5e;border-right:2px solid rgba(163,177,198,0.25);text-align:center;white-space:nowrap;">🟥 P0 — Team Leader</th>
                      <th style="padding:0.7rem 0.85rem;font-weight:700;font-size:0.67rem;letter-spacing:0.8px;text-transform:uppercase;color:#38bdf8;border-right:2px solid rgba(163,177,198,0.25);text-align:center;white-space:nowrap;">⬛ P1 — Pelulus Utama</th>
                      <th style="padding:0.7rem 0.85rem;font-weight:700;font-size:0.67rem;letter-spacing:0.8px;text-transform:uppercase;color:#f97316;text-align:center;white-space:nowrap;">🔒 P2 — Kelulusan Akhir</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${(() => {
                      const flowArrow = `<span style="color:var(--text-muted);font-size:0.9rem;margin:0 0.3rem;">→</span>`;
                      const chip = (label, color, bg) => `<span style="display:inline-flex;align-items:center;gap:0.25rem;background:${bg};color:${color};border:1px solid ${color}40;border-radius:20px;padding:0.2rem 0.65rem;font-weight:700;font-size:0.7rem;white-space:nowrap;">${label}</span>`;
                      const dash = `<span style="color:rgba(163,177,198,0.4);font-size:1rem;">—</span>`;

                      const flowRows = [
                        { key:'terengganu',       grp:'Semua Kakitangan',          scope:'Terengganu',                     gColor:'#0d9488' },
                        { key:'pahang_lain',      grp:'Semua Kakitangan',          scope:'Pahang (Selain Balok)',           gColor:'#3b82f6' },
                        { key:'admin_balok',      grp:'Kakitangan Admin',          scope:'Balok (HQ)',                     gColor:'#0ea5e9' },
                        { key:'doctor_pahang',    grp:'Doktor',                    scope:'Pahang (Selain Bentong)',         gColor:'#d97706' },
                        { key:'operation_balok',  grp:'Kakitangan Operasi',        scope:'Balok (HQ)',                     gColor:'#10b981' },
                        { key:'xray_sono_balok',  grp:'Juru X-Ray / Sonographer', scope:'Balok (HQ)',                     gColor:'#ec4899' },
                        { key:'juru_audio_balok', grp:'Juru Audio',               scope:'Balok (HQ)',                     gColor:'#0d9488' },
                      ];

                      const getP1Label = (key, cfg) => {
                        if (cfg.needs_tl && cfg.p1_supervisor) return 'Supervisor Balok';
                        if (cfg.p1_supervisor) return 'Supervisor Balok';
                        if (cfg.p1_hod_balok) return 'HOD Balok';
                        if (cfg.p1_doctor_pic) return 'Doctor PIC';
                        return null;
                      };

                      return flowRows.map((r, idx) => {
                        const cfg = approvalRouting[r.key] || {};
                        const p1Label = getP1Label(r.key, cfg);
                        const rowBg = idx % 2 === 0 ? 'transparent' : 'rgba(163,177,198,0.025)';
                        const isBalokOp = r.key === 'operation_balok';

                        return `<tr style="border-bottom:1px solid rgba(163,177,198,0.08);background:${rowBg};transition:background 0.15s;" onmouseover="this.style.background='rgba(59,130,246,0.04)'" onmouseout="this.style.background='${rowBg}'">
                          <td style="padding:0.65rem 1rem;border-right:1px solid rgba(163,177,198,0.12);">
                            <span style="display:inline-block;background:${r.gColor}18;color:${r.gColor};border:1px solid ${r.gColor}30;border-radius:6px;padding:0.18rem 0.6rem;font-weight:700;font-size:0.73rem;">${r.grp}</span>
                          </td>
                          <td style="padding:0.65rem 0.85rem;border-right:2px solid rgba(163,177,198,0.2);font-size:0.75rem;color:var(--text-muted);font-weight:600;">${r.scope}</td>
                          <td style="padding:0.65rem 0.85rem;border-right:2px solid rgba(163,177,198,0.2);text-align:center;">
                            ${cfg.needs_tl ? chip('Team Leader', '#f43f5e', 'rgba(244,63,94,0.1)') : dash}
                          </td>
                          <td style="padding:0.65rem 0.85rem;border-right:2px solid rgba(163,177,198,0.2);text-align:center;">
                            ${p1Label ? chip(p1Label, '#38bdf8', 'rgba(56,189,248,0.1)') : dash}
                          </td>
                          <td style="padding:0.65rem 0.85rem;text-align:center;">
                            ${cfg.needs_p2 ? chip('HR / Admin', '#f97316', 'rgba(249,115,22,0.1)') : `<span style="font-size:0.7rem;color:var(--text-muted);font-style:italic;">Tidak perlu</span>`}
                          </td>
                        </tr>`;
                      }).join('');
                    })()}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
          `;
        })() : ''}

        ${managementTab === 'access_control' ? (() => {
          const CELL_SIZE = '38px';
          const renderRbacDashboardCell = (role) => {
              const val = window.rbacMatrix[role].dashboard;
              const isAnalisa = val === 'analisa';
              const isBranch = val === 'branch';
              const bg     = isAnalisa ? 'rgba(16,185,129,0.2)'  : isBranch ? 'rgba(251,146,60,0.2)'  : 'rgba(163,177,198,0.12)';
              const border = isAnalisa ? '2px solid #34d399'      : isBranch ? '2px solid #fb923c'      : '1px solid rgba(163,177,198,0.3)';
              const color  = isAnalisa ? '#10b981'                : isBranch ? '#f97316'                : '#64748b';
              const icon = isAnalisa
                ? '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>'
                : isBranch
                  ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f97316" stroke-width="2.5"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>'
                  : '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>';
              const label = isAnalisa ? 'ANALISA' : isBranch ? 'CAWANGAN' : 'STAFF';
              return `<td style="padding:0.55rem 0.4rem;border-right:1px solid rgba(163,177,198,0.15);cursor:pointer;text-align:center;background:transparent;" onclick="window.toggleRbac('${role}', 'dashboard')">
                <div style="display:flex;flex-direction:column;align-items:center;gap:0.3rem;pointer-events:none;">
                  <div style="width:${CELL_SIZE};height:${CELL_SIZE};border-radius:9px;display:flex;align-items:center;justify-content:center;background:${bg};border:${border};box-shadow:0 1px 3px rgba(0,0,0,0.07);">${icon}</div>
                  <span style="font-size:0.65rem;font-weight:800;letter-spacing:0.5px;color:${color};">${label}</span>
                </div>
              </td>`;
          };

          const renderRbacCell = (role, module, isLastInGroup) => {
              const checked = window.rbacMatrix[role][module];
              const borderStyle = isLastInGroup ? 'border-right:2px solid rgba(163,177,198,0.3)' : 'border-right:1px solid rgba(163,177,198,0.15)';
              return `<td style="padding:0.55rem 0.4rem;${borderStyle};cursor:pointer;text-align:center;" onclick="window.toggleRbac('${role}', '${module}')">
                <div style="display:flex;align-items:center;justify-content:center;pointer-events:none;">
                  ${checked
                    ? `<div style="width:${CELL_SIZE};height:${CELL_SIZE};border-radius:9px;background:rgba(16,185,129,0.15);border:2px solid #10b981;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(16,185,129,0.2);"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></div>`
                    : `<div style="width:${CELL_SIZE};height:${CELL_SIZE};border-radius:9px;background:rgba(239,68,68,0.08);border:1.5px solid rgba(239,68,68,0.25);display:flex;align-items:center;justify-content:center;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></div>`}
                </div>
              </td>`;
          };

          const renderRbacScopeCell = (role, module, badgeLabel, badgeColor, badgeBg, badgeBorder, badgeIcon, isLastInGroup) => {
              const checked = !!(window.rbacMatrix[role][module]);
              const hasReport = !!(window.rbacMatrix[role].manage_reports);
              const borderStyle = isLastInGroup ? 'border-right:2px solid rgba(163,177,198,0.3)' : 'border-right:1px solid rgba(163,177,198,0.15)';
              const canApply = hasReport;
              return `<td style="padding:0.55rem 0.4rem;${borderStyle};cursor:${canApply?'pointer':'default'};text-align:center;${!canApply?'opacity:0.25;':''}" ${canApply?`onclick="window.toggleRbac('${role}', '${module}')"`:''}>
                <div style="display:flex;flex-direction:column;align-items:center;gap:0.25rem;pointer-events:none;">
                  ${checked
                    ? `<div style="padding:0.25rem 0.6rem;border-radius:20px;background:${badgeBg};border:2px solid ${badgeBorder};display:flex;align-items:center;gap:0.35rem;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
                        ${badgeIcon}
                        <span style="font-size:0.68rem;font-weight:800;color:${badgeColor};">${badgeLabel}</span>
                      </div>`
                    : `<div style="padding:0.25rem 0.6rem;border-radius:20px;background:rgba(163,177,198,0.08);border:1.5px solid rgba(163,177,198,0.2);display:flex;align-items:center;gap:0.3rem;">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        <span style="font-size:0.68rem;font-weight:600;color:#94a3b8;">Tiada</span>
                      </div>`}
                </div>
              </td>`;
          };

          const roles = [
            { key: 'super_admin', label: 'Super Admin', color: '#3b82f6', bg: 'rgba(59,130,246,0.06)', bottomBorder: '2px solid rgba(59,130,246,0.25)', desc: 'Akses penuh' },
            { key: 'admin',       label: 'Admin',       color: '#f59e0b', bg: 'rgba(245,158,11,0.04)',  bottomBorder: '1px solid rgba(163,177,198,0.12)', desc: 'Pentadbiran' },
            { key: 'hr',          label: 'HR',           color: '#a855f7', bg: 'rgba(168,85,247,0.04)',  bottomBorder: '1px solid rgba(163,177,198,0.12)', desc: 'Sumber Manusia' },
            { key: 'hod_cawangan', label: 'HOD Cawangan', color: '#38bdf8', bg: 'rgba(56,189,248,0.04)',  bottomBorder: '1px solid rgba(163,177,198,0.12)', desc: 'Ketua Cawangan' },
            { key: 'hod_balok',   label: 'HOD Balok',    color: '#0ea5e9', bg: 'rgba(14,165,233,0.04)',  bottomBorder: '1px solid rgba(163,177,198,0.12)', desc: 'Ketua Balok HQ' },
            { key: 'doctor_pic',  label: 'Doctor PIC',   color: '#818cf8', bg: 'rgba(129,140,248,0.04)',  bottomBorder: '1px solid rgba(163,177,198,0.12)', desc: 'Doktor Penanggung Cawangan' },
            { key: 'supervisor',  label: 'Supervisor',   color: '#10b981', bg: 'rgba(16,185,129,0.04)',  bottomBorder: '1px solid rgba(163,177,198,0.12)', desc: 'Penyelia Balok' },
            { key: 'team_leader', label: 'Team Leader',  color: '#f43f5e', bg: 'rgba(244,63,94,0.04)',   bottomBorder: '1px solid rgba(163,177,198,0.12)', desc: 'Ketua Kumpulan Balok' },
            { key: 'staff',       label: 'Staff',        color: '#94a3b8', bg: 'rgba(148,163,184,0.04)', bottomBorder: '2px solid rgba(163,177,198,0.3)',  desc: 'Kakitangan Am' },
            { key: 'juru_xray',   label: 'Juru X-Ray',   color: '#ec4899', bg: 'rgba(236,72,153,0.04)', bottomBorder: '1px solid rgba(163,177,198,0.12)', desc: 'Paramedik Pengimejan' },
            { key: 'sonographer', label: 'Sonographer',  color: '#6366f1', bg: 'rgba(99,102,241,0.04)', bottomBorder: '1px solid rgba(163,177,198,0.12)', desc: 'Paramedik Ultrasound' },
            { key: 'juru_audio',  label: 'Juru Audio',   color: '#0d9488', bg: 'rgba(13,148,136,0.04)', bottomBorder: '1px solid rgba(163,177,198,0.12)', desc: 'Paramedik Audiologi' },
            { key: 'pemandu',     label: 'Pemandu',      color: '#a16207', bg: 'rgba(161,98,7,0.04)',   bottomBorder: 'none',                             desc: 'Pemandu Kenderaan' },
          ];

          const grpTh = (emoji, label, span, color, isLast) => `<th colspan="${span}" style="padding:0.7rem 0.75rem;font-weight:800;font-size:0.72rem;letter-spacing:0.8px;text-transform:uppercase;color:${color};border-right:${isLast ? '1px solid rgba(163,177,198,0.15)' : '3px solid rgba(163,177,198,0.3)'};border-bottom:2px solid ${color}44;background:${color}0f;text-align:center;white-space:nowrap;">${emoji} ${label}</th>`;
          const colTh = (label, color, isLast) => `<th style="padding:0.55rem 0.5rem;font-weight:700;font-size:0.68rem;color:${color || 'var(--text-muted)'};border-right:${isLast ? '3px solid rgba(163,177,198,0.3)' : '1px solid rgba(163,177,198,0.15)'};text-align:center;white-space:nowrap;line-height:1.4;min-width:64px;">${label}</th>`;

          return `
          <!-- Header -->
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem;margin-top:0.5rem;flex-wrap:wrap;gap:1rem;">
            <div style="display:flex;align-items:center;gap:0.85rem;">
              <div style="width:42px;height:42px;border-radius:11px;background:rgba(59,130,246,0.12);border:1px solid rgba(59,130,246,0.2);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              </div>
              <div>
                <h2 style="font-size:1.05rem;font-weight:700;margin:0;letter-spacing:-0.2px;">Kawalan Akses Berdasarkan Peranan (RBAC)</h2>
                <p style="font-size:0.72rem;color:var(--text-muted);margin:0.2rem 0 0;">Klik pada sel untuk togol kebenaran &bull; Simpan selepas membuat perubahan</p>
              </div>
            </div>
            <div style="display:flex;gap:0.6rem;flex-wrap:wrap;">
              <button onclick="window.resetRbac()" style="width:auto;padding:0.6rem 1.1rem;display:flex;align-items:center;gap:0.45rem;font-weight:600;font-size:0.79rem;border-radius:9px;border:1px solid rgba(239,68,68,0.3);background:rgba(239,68,68,0.08);color:#f87171;cursor:pointer;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.5"/></svg>
                Reset Lalai
              </button>
              <button onclick="window.saveRbac()" class="btn-primary" style="width:auto;padding:0.65rem 1.4rem;display:flex;align-items:center;gap:0.5rem;font-weight:600;font-size:0.82rem;background:linear-gradient(135deg,var(--primary) 0%,var(--secondary) 100%);">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                Simpan Matrix
              </button>
            </div>
          </div>

          <!-- Toggle: Auto "Guna Dalam Sistem" -->
          <div style="display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap;margin-bottom:1.25rem;padding:0.95rem 1.15rem;border-radius:12px;border:1px solid ${autoSystemUsage ? 'rgba(16,185,129,0.3)' : 'rgba(245,158,11,0.3)'};background:${autoSystemUsage ? 'rgba(16,185,129,0.06)' : 'rgba(245,158,11,0.06)'};">
            <div style="display:flex;align-items:flex-start;gap:0.7rem;">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${autoSystemUsage ? '#10b981' : '#f59e0b'}" stroke-width="2" style="flex-shrink:0;margin-top:1px;"><path d="M21 12a9 9 0 1 1-6.219-8.56"/><polyline points="23 4 23 10 17 10"/></svg>
              <div>
                <div style="font-size:0.85rem;font-weight:700;">Auto "Guna Dalam Sistem" — AL / MC / EL</div>
                <div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.15rem;max-width:560px;line-height:1.5;">
                  Status: <strong style="color:${autoSystemUsage ? '#10b981' : '#f59e0b'};">${autoSystemUsage ? 'AUTO (dikira dari rekod diluluskan)' : 'MANUAL (HR isi sendiri)'}</strong>.
                  Hidupkan AUTO hanya setelah SEMUA cuti sedia ada telah direkod & diluluskan dalam sistem (sync penuh). Bila AUTO, nilai manual diabaikan.
                </div>
              </div>
            </div>
            <button onclick="window.toggleAutoSystemUsage()" style="width:auto;padding:0.6rem 1.2rem;display:flex;align-items:center;gap:0.5rem;font-weight:700;font-size:0.8rem;border-radius:9px;border:1px solid ${autoSystemUsage ? 'rgba(245,158,11,0.4)' : 'rgba(16,185,129,0.4)'};background:${autoSystemUsage ? 'rgba(245,158,11,0.1)' : 'rgba(16,185,129,0.12)'};color:${autoSystemUsage ? '#f59e0b' : '#10b981'};cursor:pointer;white-space:nowrap;">
              ${autoSystemUsage ? '↩️ Kembali Manual' : '⚡ Hidupkan Auto'}
            </button>
          </div>

          <!-- Legend: access types -->
          <div style="display:flex;flex-wrap:wrap;gap:0.45rem;margin-bottom:0.55rem;align-items:center;">
            <span style="font-size:0.65rem;font-weight:700;color:var(--text-muted);letter-spacing:0.6px;text-transform:uppercase;margin-right:0.2rem;">Akses:</span>
            <div style="display:flex;align-items:center;gap:0.35rem;background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.2);border-radius:6px;padding:0.22rem 0.6rem;">
              <div style="width:16px;height:16px;border-radius:4px;background:rgba(16,185,129,0.18);display:flex;align-items:center;justify-content:center;"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></div>
              <span style="font-size:0.68rem;color:#34d399;font-weight:600;">Ada Akses</span>
            </div>
            <div style="display:flex;align-items:center;gap:0.35rem;background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.18);border-radius:6px;padding:0.22rem 0.6rem;">
              <div style="width:16px;height:16px;border-radius:4px;background:rgba(239,68,68,0.1);display:flex;align-items:center;justify-content:center;"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></div>
              <span style="font-size:0.68rem;color:#ef4444;font-weight:600;">Tiada Akses</span>
            </div>
            <div style="width:1px;height:18px;background:rgba(163,177,198,0.2);margin:0 0.1rem;"></div>
            <span style="font-size:0.65rem;font-weight:700;color:var(--text-muted);letter-spacing:0.6px;text-transform:uppercase;margin-right:0.2rem;">Dashboard:</span>
            <div style="display:flex;align-items:center;gap:0.3rem;background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.2);border-radius:6px;padding:0.22rem 0.6rem;">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
              <span style="font-size:0.68rem;color:#34d399;font-weight:700;">ANALISA</span>
              <span style="font-size:0.62rem;color:var(--text-muted);">— carta semua cawangan</span>
            </div>
            <div style="display:flex;align-items:center;gap:0.3rem;background:rgba(251,146,60,0.08);border:1px solid rgba(251,146,60,0.25);border-radius:6px;padding:0.22rem 0.6rem;">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fb923c" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
              <span style="font-size:0.68rem;color:#fb923c;font-weight:700;">CAWANGAN</span>
              <span style="font-size:0.62rem;color:var(--text-muted);">— carta cawangan sendiri</span>
            </div>
            <div style="display:flex;align-items:center;gap:0.3rem;background:rgba(163,177,198,0.07);border:1px solid rgba(163,177,198,0.2);border-radius:6px;padding:0.22rem 0.6rem;">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
              <span style="font-size:0.68rem;color:#94a3b8;font-weight:700;">STAFF</span>
              <span style="font-size:0.62rem;color:var(--text-muted);">— senarai sahaja</span>
            </div>
          </div>

          <!-- Legend: scope badges -->
          <div style="display:flex;flex-wrap:wrap;gap:0.45rem;margin-bottom:1rem;align-items:center;">
            <span style="font-size:0.65rem;font-weight:700;color:var(--text-muted);letter-spacing:0.6px;text-transform:uppercase;margin-right:0.2rem;">Skop Laporan:</span>
            <div style="display:flex;align-items:center;gap:0.35rem;background:rgba(163,177,198,0.06);border:1px solid rgba(163,177,198,0.18);border-radius:6px;padding:0.22rem 0.7rem;">
              <span style="font-size:0.68rem;color:var(--text-muted);">Tiada sekatan — lihat semua rekod dalam skop negeri</span>
            </div>
            <div style="display:flex;align-items:center;gap:0.35rem;background:rgba(234,179,8,0.1);border:1px solid rgba(234,179,8,0.35);border-radius:20px;padding:0.22rem 0.65rem;">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#ca8a04" stroke-width="2.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
              <span style="font-size:0.68rem;color:#ca8a04;font-weight:800;">Kuantan</span>
              <span style="font-size:0.62rem;color:var(--text-muted);">— laporan terhad daerah Kuantan sahaja</span>
            </div>
            <div style="display:flex;align-items:center;gap:0.35rem;background:rgba(56,189,248,0.1);border:1px solid rgba(56,189,248,0.35);border-radius:20px;padding:0.22rem 0.65rem;">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#0284c7" stroke-width="2.5"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
              <span style="font-size:0.68rem;color:#0284c7;font-weight:800;">Cawangan</span>
              <span style="font-size:0.62rem;color:var(--text-muted);">— laporan terhad cawangan sendiri sahaja</span>
            </div>
            <div style="display:flex;align-items:center;gap:0.35rem;padding:0.22rem 0.5rem;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              <span style="font-size:0.65rem;color:var(--text-muted);">Skop hanya aktif jika kolum Laporan dibenarkan</span>
            </div>
          </div>

          <section class="glass-card fade-in" style="padding:0;overflow:hidden;border:1.5px solid rgba(163,177,198,0.35);">
            <div style="overflow-x:auto;">
              <table style="width:100%;border-collapse:collapse;font-size:0.78rem;">
                <thead>
                  <tr style="border-bottom:1px solid rgba(163,177,198,0.2);">
                    <th rowspan="2" style="padding:0.9rem 1.1rem;font-weight:800;font-size:0.82rem;border-right:3px solid rgba(163,177,198,0.35);border-bottom:2px solid rgba(163,177,198,0.25);background:rgba(163,177,198,0.08);text-align:left;vertical-align:middle;min-width:148px;">Peranan</th>
                    ${grpTh('🖥️', 'Navigasi', 4, '#3b82f6', false)}
                    ${grpTh('⚙️', 'Tetapan', 3, '#2dd4bf', false)}
                    ${grpTh('📋', 'Pengurusan', 11, '#a855f7', false)}
                    ${grpTh('📊', 'Skop Laporan', 3, '#ca8a04', false)}
                    ${grpTh('🏥', 'Operasi', 4, '#f59e0b', true)}
                  </tr>
                  <tr style="background:rgba(163,177,198,0.06);border-bottom:2px solid rgba(163,177,198,0.25);">
                    ${colTh('Dashboard', '#94a3b8', false)}
                    ${colTh('Analisa<br>Cawangan', '#fb923c', false)}
                    ${colTh('Permohonan<br>Cuti', '#818cf8', false)}
                    ${colTh('Pengurusan', '#fbbf24', true)}
                    ${colTh('Polisi', '#2dd4bf', false)}
                    ${colTh('Tetapan<br>Sistem', '#a1a1aa', false)}
                    ${colTh('WhatsApp', '#10b981', true)}
                    ${colTh('Luluskan<br>Permohonan', '#f59e0b', false)}
                    ${colTh('Kakitangan', '#38bdf8', false)}
                    ${colTh('Cawangan', '#a855f7', false)}
                    ${colTh('Audit<br>Rekod', '#ec4899', false)}
                    ${colTh('Log<br>Masuk', '#10b981', false)}
                    ${colTh('Laporan', '#f97316', false)}
                    ${colTh('Laluan<br>Kelulusan', '#6d28d9', false)}
                    ${colTh('Kawalan<br>Akses', '#ef4444', false)}
                    ${colTh('Peranan &amp;<br>Kategori', '#10b981', false)}
                    ${colTh('Cuti<br>Umum', '#f59e0b', false)}
                    ${colTh('Editor<br>Polisi', '#6366f1', true)}
                    ${colTh('Daerah<br>Kuantan', '#ca8a04', false)}
                    ${colTh('Cawangan<br>Sendiri', '#0284c7', false)}
                    ${colTh('Rekod<br>Kedatangan', '#1e293b', true)}
                    ${colTh('Batal<br>Cuti', '#f43f5e', false)}
                    ${colTh('O/S<br>Balok', '#38bdf8', false)}
                    ${colTh('O/S<br>Pahang', '#fbbf24', false)}
                    ${colTh('Rekod<br>Locum', '#0d9488', false)}
                  </tr>
                </thead>
                <tbody>
                  ${roles.map(r => `
                  <tr style="border-bottom:${r.bottomBorder};background:${r.bg};transition:background 0.15s;" onmouseover="this.style.background='rgba(59,130,246,0.06)'" onmouseout="this.style.background='${r.bg}'">
                    <td style="padding:0.8rem 1.1rem;border-right:3px solid rgba(163,177,198,0.35);">
                      <div style="display:flex;flex-direction:column;gap:0.3rem;">
                        <span style="display:inline-block;background:${r.color}22;color:${r.color};border:1.5px solid ${r.color}55;border-radius:7px;padding:0.22rem 0.7rem;font-weight:800;font-size:0.8rem;width:fit-content;letter-spacing:0.2px;">${r.label}</span>
                        <span style="font-size:0.68rem;color:var(--text-muted);padding-left:0.15rem;">${r.desc}</span>
                      </div>
                    </td>
                    ${renderRbacDashboardCell(r.key)}
                    ${renderRbacCell(r.key, 'branch_analisa', false)}
                    ${renderRbacCell(r.key, 'leave_request', false)}
                    ${renderRbacCell(r.key, 'management', true)}
                    ${renderRbacCell(r.key, 'policy', false)}
                    ${renderRbacCell(r.key, 'settings', false)}
                    ${renderRbacCell(r.key, 'wa_setting', true)}
                    ${renderRbacCell(r.key, 'manage_pending', false)}
                    ${renderRbacCell(r.key, 'manage_staff', false)}
                    ${renderRbacCell(r.key, 'manage_branches', false)}
                    ${renderRbacCell(r.key, 'manage_audit', false)}
                    ${renderRbacCell(r.key, 'manage_login_audit', false)}
                    ${renderRbacCell(r.key, 'manage_reports', false)}
                    ${renderRbacCell(r.key, 'manage_routing', false)}
                    ${renderRbacCell(r.key, 'manage_access', false)}
                    ${renderRbacCell(r.key, 'manage_roles_categories', false)}
                    ${renderRbacCell(r.key, 'manage_holidays', false)}
                    ${renderRbacCell(r.key, 'manage_policy', true)}
                    ${renderRbacScopeCell(r.key, 'report_kuantan_only', 'Kuantan', '#ca8a04', 'rgba(234,179,8,0.15)', 'rgba(234,179,8,0.4)', '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#ca8a04" stroke-width="2.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>', false)}
                    ${renderRbacScopeCell(r.key, 'report_own_branch_only', 'Cawangan', '#0284c7', 'rgba(56,189,248,0.15)', 'rgba(56,189,248,0.4)', '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#0284c7" stroke-width="2.5"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>', false)}
                    ${renderRbacScopeCell(r.key, 'report_attendance', 'Kedatangan', '#1e293b', 'rgba(30,41,59,0.15)', 'rgba(30,41,59,0.5)', '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>', true)}
                    ${renderRbacCell(r.key, 'can_cancel', false)}
                    ${renderRbacCell(r.key, 'os_balok', false)}
                    ${renderRbacCell(r.key, 'os_pahang', false)}
                    ${renderRbacCell(r.key, 'locum_records', false)}
                  </tr>`).join('')}
                </tbody>
              </table>
            </div>
          </section>
          `;
        })() : ''}

        ${managementTab === 'policy_editor' && userPerms.manage_policy ? (() => {
          const pc = policyContent;
          const sectionCard = (id, title, icon, color, content) => `
            <div class="glass-card fade-in" style="padding:0;overflow:hidden;margin-bottom:1.25rem;border-top:3px solid ${color};">
              <div style="padding:0.9rem 1.1rem;background:rgba(163,177,198,0.04);border-bottom:1px solid rgba(163,177,198,0.12);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.5rem;">
                <div style="display:flex;align-items:center;gap:0.6rem;">
                  <span style="font-size:1rem;">${icon}</span>
                  <span style="font-size:0.92rem;font-weight:700;color:var(--text);">${title}</span>
                </div>
                <button id="save-policy-${id}" onclick="window.savePolicySection('${id}')" style="padding:0.4rem 1rem;border-radius:8px;border:1px solid ${color};background:${color}15;color:${color};font-size:0.78rem;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:0.4rem;">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                  Simpan
                </button>
              </div>
              <div style="padding:1rem 1.1rem;">${content}</div>
            </div>`;

          const ruleEditor = (section, color) => `
            <div style="display:flex;flex-direction:column;gap:0.5rem;">
              ${(pc[section]||[]).map((rule,i) => `
                <div style="display:flex;gap:0.5rem;align-items:flex-start;">
                  <span style="flex-shrink:0;width:22px;height:22px;border-radius:50%;background:${color}22;border:1px solid ${color}44;display:flex;align-items:center;justify-content:center;font-size:0.65rem;font-weight:800;color:${color};margin-top:0.55rem;">${i+1}</span>
                  <textarea oninput="window.updatePolicyRule('${section}',${i},this.value)" style="flex:1;padding:0.5rem 0.75rem;border-radius:8px;border:1px solid rgba(163,177,198,0.3);background:rgba(163,177,198,0.06);color:var(--text);font-size:0.82rem;resize:vertical;min-height:52px;line-height:1.5;">${rule}</textarea>
                  <button onclick="window.deletePolicyRule('${section}',${i})" style="flex-shrink:0;padding:0.3rem 0.6rem;border-radius:7px;border:1px solid rgba(239,68,68,0.3);background:rgba(239,68,68,0.07);color:#ef4444;cursor:pointer;margin-top:0.4rem;font-size:0.8rem;">✕</button>
                </div>`).join('')}
              <button onclick="window.addPolicyRule('${section}')" style="padding:0.4rem 0.9rem;border-radius:8px;border:1px dashed ${color}66;background:transparent;color:${color};font-size:0.78rem;font-weight:600;cursor:pointer;width:fit-content;margin-top:0.25rem;">+ Tambah Peraturan</button>
            </div>`;

          return `
          <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:1.5rem;margin-top:0.5rem;">
            <div style="width:40px;height:40px;border-radius:10px;background:rgba(99,102,241,0.12);border:1px solid rgba(99,102,241,0.25);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
            </div>
            <div>
              <h2 style="font-size:1.05rem;font-weight:700;margin:0;">Editor Polisi Syarikat</h2>
              <p style="font-size:0.72rem;color:var(--text-muted);margin:0.15rem 0 0;">Edit kandungan halaman Polisi yang dilihat oleh semua staf. Klik <strong>Simpan</strong> selepas setiap bahagian.</p>
            </div>
          </div>

          ${sectionCard('notice','Notis Umum','📢','#f59e0b',`
            <p style="font-size:0.78rem;color:var(--text-muted);margin-bottom:0.6rem;">Mesej/notis yang dipaparkan di bahagian atas halaman Polisi. Kosongkan jika tiada notis.</p>
            <textarea oninput="window.updatePolicyNotice(this.value)" placeholder="Contoh: Mulai 1 Jan 2026, semua permohonan cuti AL mestilah dikemukakan 7 hari lebih awal..." style="width:100%;padding:0.65rem 0.85rem;border-radius:9px;border:1px solid rgba(163,177,198,0.3);background:rgba(163,177,198,0.06);color:var(--text);font-size:0.85rem;resize:vertical;min-height:80px;box-sizing:border-box;line-height:1.5;">${pc.notice||''}</textarea>
          `)}

          ${sectionCard('glossary','Senarai Jenis Cuti (Glossary)','📝','#3b82f6',`
            <div style="display:flex;flex-direction:column;gap:0.4rem;margin-bottom:0.75rem;">
              <div style="display:grid;grid-template-columns:90px 1fr auto;gap:0.5rem;font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);padding:0 0.25rem;">
                <span>Kod</span><span>Nama Penuh</span><span></span>
              </div>
              ${pc.glossary.map((g,i) => `
                <div style="display:grid;grid-template-columns:90px 1fr auto;gap:0.5rem;align-items:center;">
                  <input value="${g.code}" oninput="window.updatePolicyGlossary(${i},'code',this.value)" style="padding:0.45rem 0.6rem;border-radius:7px;border:1px solid rgba(163,177,198,0.3);background:rgba(163,177,198,0.06);color:var(--text);font-size:0.82rem;font-weight:700;text-align:center;">
                  <input value="${(g.name||'').replace(/"/g,'&quot;')}" oninput="window.updatePolicyGlossary(${i},'name',this.value)" style="padding:0.45rem 0.6rem;border-radius:7px;border:1px solid rgba(163,177,198,0.3);background:rgba(163,177,198,0.06);color:var(--text);font-size:0.82rem;">
                  <button onclick="window.deletePolicyGlossaryRow(${i})" style="padding:0.3rem 0.6rem;border-radius:7px;border:1px solid rgba(239,68,68,0.3);background:rgba(239,68,68,0.07);color:#ef4444;cursor:pointer;font-size:0.8rem;">✕</button>
                </div>`).join('')}
            </div>
            <button onclick="window.addPolicyGlossaryRow()" style="padding:0.4rem 0.9rem;border-radius:8px;border:1px dashed rgba(59,130,246,0.5);background:transparent;color:#3b82f6;font-size:0.78rem;font-weight:600;cursor:pointer;">+ Tambah Jenis Cuti</button>
          `)}

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:0.5rem;">
            ${['entitlementPahang','entitlementTerengganu'].map((sec,si) => {
              const labels = ['Kelayakan AL — Pahang','Kelayakan AL — Terengganu'];
              const colors = ['#3b82f6','#8b5cf6'];
              const icons  = ['🏙️','🌊'];
              const isDoktor = false;
              return `<div class="glass-card" style="padding:0;overflow:hidden;border-top:3px solid ${colors[si]};">
                <div style="padding:0.75rem 0.9rem;background:rgba(163,177,198,0.04);border-bottom:1px solid rgba(163,177,198,0.1);display:flex;align-items:center;justify-content:space-between;gap:0.5rem;">
                  <span style="font-size:0.82rem;font-weight:700;">${icons[si]} ${labels[si]}</span>
                  <button id="save-policy-${sec}" onclick="window.savePolicySection('${sec}')" style="padding:0.3rem 0.7rem;border-radius:7px;border:1px solid ${colors[si]};background:${colors[si]}15;color:${colors[si]};font-size:0.72rem;font-weight:700;cursor:pointer;">Simpan</button>
                </div>
                <div style="padding:0.75rem 0.9rem;">
                  <div style="display:flex;flex-direction:column;gap:0.4rem;margin-bottom:0.6rem;">
                    ${isDoktor ? '' : `<div style="display:grid;grid-template-columns:1fr 1fr auto;gap:0.35rem;font-size:0.65rem;font-weight:700;text-transform:uppercase;color:var(--text-muted);padding:0 0.2rem;"><span>Tempoh</span><span>Hari</span><span></span></div>`}
                    ${(pc[sec]||[]).map((row,i) => `
                      <div style="display:grid;grid-template-columns:${isDoktor?'1fr auto':'1fr 1fr auto'};gap:0.35rem;align-items:center;">
                        ${isDoktor ? '' : `<input value="${row.period||''}" oninput="window.updateEntitlement('${sec}',${i},'period',this.value)" style="padding:0.4rem 0.5rem;border-radius:6px;border:1px solid rgba(163,177,198,0.3);background:rgba(163,177,198,0.06);color:var(--text);font-size:0.78rem;">`}
                        <input value="${row.days||''}" oninput="window.updateEntitlement('${sec}',${i},'days',this.value)" style="padding:0.4rem 0.5rem;border-radius:6px;border:1px solid rgba(163,177,198,0.3);background:rgba(163,177,198,0.06);color:var(--text);font-size:0.78rem;font-weight:700;text-align:center;">
                        <button onclick="window.deleteEntitlementRow('${sec}',${i})" style="padding:0.25rem 0.45rem;border-radius:6px;border:1px solid rgba(239,68,68,0.3);background:rgba(239,68,68,0.07);color:#ef4444;cursor:pointer;font-size:0.75rem;">✕</button>
                      </div>`).join('')}
                  </div>
                  <button onclick="window.addEntitlementRow('${sec}')" style="padding:0.35rem 0.75rem;border-radius:7px;border:1px dashed ${colors[si]}66;background:transparent;color:${colors[si]};font-size:0.73rem;font-weight:600;cursor:pointer;">+ Tambah</button>
                </div>
              </div>`;
            }).join('')}
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1.25rem;">
            ${['entitlementMC','entitlementDoktor'].map((sec,si) => {
              const labels = ['Kelayakan MC — Mengikut Tempoh Berkhidmat','Kelayakan AL — Doktor'];
              const colors = ['#10b981','#ef4444'];
              const icons  = ['🏥','🩺'];
              const isDoktor = sec === 'entitlementDoktor';
              return `<div class="glass-card" style="padding:0;overflow:hidden;border-top:3px solid ${colors[si]};">
                <div style="padding:0.75rem 0.9rem;background:rgba(163,177,198,0.04);border-bottom:1px solid rgba(163,177,198,0.1);display:flex;align-items:center;justify-content:space-between;gap:0.5rem;">
                  <span style="font-size:0.82rem;font-weight:700;">${icons[si]} ${labels[si]}</span>
                  <button id="save-policy-${sec}" onclick="window.savePolicySection('${sec}')" style="padding:0.3rem 0.7rem;border-radius:7px;border:1px solid ${colors[si]};background:${colors[si]}15;color:${colors[si]};font-size:0.72rem;font-weight:700;cursor:pointer;">Simpan</button>
                </div>
                <div style="padding:0.75rem 0.9rem;">
                  <div style="display:flex;flex-direction:column;gap:0.4rem;margin-bottom:0.6rem;">
                    ${isDoktor ? '' : `<div style="display:grid;grid-template-columns:1fr 1fr auto;gap:0.35rem;font-size:0.65rem;font-weight:700;text-transform:uppercase;color:var(--text-muted);padding:0 0.2rem;"><span>Tempoh Berkhidmat</span><span>Hari MC</span><span></span></div>`}
                    ${(pc[sec]||[]).map((row,i) => `
                      <div style="display:grid;grid-template-columns:${isDoktor?'1fr auto':'1fr 1fr auto'};gap:0.35rem;align-items:center;">
                        ${isDoktor ? '' : `<input value="${row.period||''}" oninput="window.updateEntitlement('${sec}',${i},'period',this.value)" style="padding:0.4rem 0.5rem;border-radius:6px;border:1px solid rgba(163,177,198,0.3);background:rgba(163,177,198,0.06);color:var(--text);font-size:0.78rem;">`}
                        <input value="${row.days||''}" oninput="window.updateEntitlement('${sec}',${i},'days',this.value)" style="padding:0.4rem 0.5rem;border-radius:6px;border:1px solid rgba(163,177,198,0.3);background:rgba(163,177,198,0.06);color:var(--text);font-size:0.78rem;font-weight:700;text-align:center;">
                        <button onclick="window.deleteEntitlementRow('${sec}',${i})" style="padding:0.25rem 0.45rem;border-radius:6px;border:1px solid rgba(239,68,68,0.3);background:rgba(239,68,68,0.07);color:#ef4444;cursor:pointer;font-size:0.75rem;">✕</button>
                      </div>`).join('')}
                  </div>
                  <button onclick="window.addEntitlementRow('${sec}')" style="padding:0.35rem 0.75rem;border-radius:7px;border:1px dashed ${colors[si]}66;background:transparent;color:${colors[si]};font-size:0.73rem;font-weight:600;cursor:pointer;">+ Tambah</button>
                </div>
              </div>`;
            }).join('')}
          </div>

          ${sectionCard('rulesAL','Peraturan Cuti Tahunan (AL)','📅','#6366f1', ruleEditor('rulesAL','#6366f1'))}
          ${sectionCard('rulesMC','Peraturan Cuti Sakit (MC)','🏥','#eab308', ruleEditor('rulesMC','#eab308'))}
          ${sectionCard('rulesCME','Peraturan Cuti CME','🎓','#c084fc', ruleEditor('rulesCME','#c084fc'))}
          ${sectionCard('rulesNotice','Notis Berhenti Kerja','📄','#94a3b8', ruleEditor('rulesNotice','#94a3b8'))}
          `;
        })() : ''}

        ${managementTab === 'public_holidays' && userPerms.manage_holidays ? (() => {
          const canEditPahang     = ['super_admin','admin','hr'].includes(user.role);
          const canEditTerengganu = ['super_admin','admin','hr','hod_cawangan'].includes(user.role);
          const rowStyle = 'display:grid;grid-template-columns:150px 1fr auto;gap:0.5rem;align-items:center;padding:0.45rem 0.75rem;border-bottom:1px solid rgba(163,177,198,0.1);';

          const renderPanel = (state, label, color, canEdit) => {
            const list = publicHolidays[state] || [];
            const year = list.length ? list[0].date.substring(0,4) : new Date().getFullYear();
            return `
            <section class="glass-card" style="padding:0;overflow:hidden;">
              <div style="padding:0.85rem 1rem;border-bottom:1px solid rgba(163,177,198,0.15);display:flex;align-items:center;justify-content:space-between;background:rgba(163,177,198,0.04);">
                <div style="display:flex;align-items:center;gap:0.6rem;">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                  <span style="font-size:0.9rem;font-weight:700;color:var(--text);">Cuti Umum ${label} ${year}</span>
                  <span style="font-size:0.72rem;color:var(--text-muted);background:rgba(163,177,198,0.2);padding:0.1rem 0.5rem;border-radius:999px;">${list.length} hari</span>
                </div>
                ${canEdit ? `<button onclick="window.addHoliday('${state}')" style="padding:0.3rem 0.8rem;border-radius:999px;border:1px solid ${color}55;background:${color}11;font-size:0.78rem;font-weight:600;color:${color};cursor:pointer;">+ Tambah</button>` : `<span style="font-size:0.72rem;color:var(--text-muted);font-style:italic;">Baca sahaja</span>`}
              </div>
              ${!canEdit ? `<div style="padding:0.6rem 0.75rem;background:rgba(163,177,198,0.04);border-bottom:1px solid rgba(163,177,198,0.08);font-size:0.75rem;color:var(--text-muted);">⚠️ Hanya HR/Admin boleh mengubah cuti umum Pahang.</div>` : ''}
              <div style="padding:0.6rem 1rem;background:${color}0d;border-bottom:1px solid ${color}22;text-align:center;">
                <span style="font-size:0.78rem;font-weight:700;color:${color};letter-spacing:0.5px;text-transform:uppercase;">
                  Jumlah: ${list.length} Hari Pelepasan Am
                </span>
              </div>
              <div style="padding:0.35rem 0.75rem;background:rgba(163,177,198,0.03);border-bottom:1px solid rgba(163,177,198,0.08);">
                <div style="display:grid;grid-template-columns:150px 1fr auto;gap:0.5rem;font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);padding:0.25rem 0;">
                  <span>Tarikh</span><span>Nama Cuti</span><span></span>
                </div>
              </div>
              ${list.length === 0 ? `<div style="padding:1.5rem;text-align:center;color:var(--text-muted);font-size:0.85rem;">Tiada cuti umum ditetapkan. Klik "+ Tambah" untuk mula.</div>` : ''}
              ${list.map((h, i) => `
                <div style="${rowStyle}">
                  ${canEdit
                    ? `<input type="date" value="${h.date}" onchange="window.updateHolidayField('${state}',${i},'date',this.value)" style="padding:0.35rem 0.5rem;border-radius:6px;border:1px solid rgba(163,177,198,0.25);background:rgba(163,177,198,0.07);color:var(--text);font-size:0.82rem;width:100%;">`
                    : `<span style="font-size:0.82rem;color:var(--text-muted);">${h.date ? new Date(h.date+'T00:00:00').toLocaleDateString('ms-MY',{day:'2-digit',month:'short',year:'numeric'}) : '-'}</span>`
                  }
                  ${canEdit
                    ? `<input type="text" value="${h.name.replace(/"/g,'&quot;')}" oninput="window.updateHolidayField('${state}',${i},'name',this.value)" placeholder="Nama cuti..." style="padding:0.35rem 0.5rem;border-radius:6px;border:1px solid rgba(163,177,198,0.25);background:rgba(163,177,198,0.07);color:var(--text);font-size:0.82rem;width:100%;">`
                    : `<span style="font-size:0.82rem;color:var(--text);">${h.name}</span>`
                  }
                  ${canEdit ? `<button onclick="window.deleteHoliday('${state}',${i})" title="Padam" style="padding:0.25rem 0.5rem;border-radius:6px;border:1px solid rgba(239,68,68,0.25);background:rgba(239,68,68,0.06);color:#ef4444;cursor:pointer;font-size:0.8rem;">✕</button>` : '<span></span>'}
                </div>`).join('')}
              <div style="padding:0.75rem;border-top:1px solid rgba(163,177,198,0.1);display:flex;align-items:center;justify-content:${canEdit ? 'space-between' : 'flex-end'};gap:0.75rem;flex-wrap:wrap;">
                ${canEdit ? `
                <button onclick="window.savePublicHolidays('${state}')" style="padding:0.55rem 1.25rem;border-radius:999px;border:none;background:linear-gradient(135deg,${color},${color}cc);color:#fff;font-size:0.85rem;font-weight:700;cursor:pointer;box-shadow:0 4px 12px ${color}44;">
                  💾 Simpan Cuti Umum ${label}
                </button>` : '<span></span>'}
                <button onclick="window.printPublicHolidays('${state}')" style="padding:0.55rem 1.25rem;border-radius:999px;border:1px solid ${color}55;background:${color}11;color:${color};font-size:0.85rem;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:0.4rem;">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                  Cetak / Jana PDF
                </button>
              </div>
            </section>`;
          };

          return `
          <header class="top-bar">
            <h1>📅 Polisi Cuti Umum</h1>
          </header>
          <div style="margin-bottom:1rem;padding:0.75rem 1rem;background:rgba(245,158,11,0.07);border:1px solid rgba(245,158,11,0.25);border-radius:0.75rem;font-size:0.82rem;color:var(--text-muted);">
            <strong style="color:#f59e0b;">Skop Kebenaran:</strong>
            HR / Admin → menguruskan Cuti Umum <strong>Pahang</strong> &amp; <strong>Terengganu</strong> &nbsp;|&nbsp;
            HOD → menguruskan Cuti Umum <strong>Terengganu</strong> sahaja
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.25rem;align-items:start;">
            ${renderPanel('pahang',     'Pahang',     '#3b82f6', canEditPahang)}
            ${renderPanel('terengganu', 'Terengganu', '#f59e0b', canEditTerengganu)}
          </div>
          `;
        })() : ''}

        ${managementTab === 'roles_categories' && userPerms.manage_roles_categories ? (() => {
          const _validRoleKeys = new Set([...CORE_ROLES, ...((window.staffConfig.customRoles)||[]).map(r => r.key)]);
          const allRoleKeys = Object.keys(window.rbacMatrix).filter(k => k !== 'super_admin' && _validRoleKeys.has(k));
          const categoryRowStyle = 'display:flex;align-items:center;justify-content:space-between;padding:0.55rem 1rem;border-bottom:1px solid rgba(163,177,198,0.12);';
          const roleRowStyle = 'display:flex;align-items:flex-start;justify-content:space-between;gap:0.75rem;padding:0.6rem 1rem;border-bottom:1px solid rgba(163,177,198,0.12);';
          const pillStyle = (color) => `font-size:0.75rem;font-weight:700;color:#fff;background:${color};padding:0.2rem 0.6rem;border-radius:6px;`;
          const roleColors = { admin:'#3b82f6', hr:'#10b981', hod_balok:'#0ea5e9', doctor_pic:'#818cf8', supervisor:'#8b5cf6', team_leader:'#f43f5e', hod_cawangan:'#38bdf8', juru_xray:'#14b8a6', sonographer:'#06b6d4', juru_audio:'#0891b2', staff:'#64748b' };
          const roleDesc = { admin:'Pentadbir penuh sistem', hr:'Kelulusan akhir (Peringkat 2), urus staf & laporan', hod_balok:'Pelulus Peringkat 1 — staff admin Balok HQ', doctor_pic:'Pelulus Peringkat 1 di cawangan (doktor bertugas)', supervisor:'Pelulus Peringkat 1 — operasi Balok & doktor Pahang', team_leader:'Sokongan Peringkat 0 — staf operasi Balok', hod_cawangan:'Pantau dashboard & laporan cawangan sendiri (tidak meluluskan cuti)', juru_xray:'Juru X-Ray', sonographer:'Sonographer', juru_audio:'Juru Audio', staff:'Staf biasa — mohon cuti sahaja' };
          const roleGroups = [ { title:'🛡️ Pentadbiran', keys:['admin','hr'] }, { title:'✅ Pelulus Cuti', keys:['hod_balok','doctor_pic','supervisor','team_leader'] }, { title:'👁️ Pemantau', keys:['hod_cawangan'] }, { title:'🩺 Paramedik', keys:['juru_xray','sonographer','juru_audio'] }, { title:'👤 Staf', keys:['staff'] } ];

          return `
          <header class="top-bar">
            <h1>Peranan &amp; Kategori Staff</h1>
          </header>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.25rem;align-items:start;">

            <!-- PERANAN -->
            <section class="glass-card" style="padding:0;overflow:hidden;">
              <div style="padding:0.85rem 1rem;border-bottom:1px solid rgba(163,177,198,0.15);display:flex;align-items:center;justify-content:space-between;background:rgba(163,177,198,0.04);">
                <div style="display:flex;align-items:center;gap:0.55rem;">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4361ee" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                  <span style="font-size:0.9rem;font-weight:700;color:var(--text);">Peranan (Roles)</span>
                  <span style="font-size:0.72rem;color:var(--text-muted);background:rgba(163,177,198,0.2);padding:0.1rem 0.5rem;border-radius:999px;">${allRoleKeys.length} peranan</span>
                </div>
                <button onclick="window.addCustomRole()" style="padding:0.3rem 0.8rem;border-radius:999px;border:1px solid rgba(67,97,238,0.4);background:rgba(67,97,238,0.08);font-size:0.78rem;font-weight:600;color:#4361ee;cursor:pointer;">+ Tambah</button>
              </div>
              ${(() => {
                const renderRow = (key) => {
                  const label = window.staffConfig.roleLabels[key] || key;
                  const isCore = CORE_ROLES.includes(key);
                  const color = roleColors[key] || '#94a3b8';
                  const desc = roleDesc[key] || '';
                  return `<div style="${roleRowStyle}">
                    <div style="display:flex;flex-direction:column;gap:0.25rem;min-width:0;">
                      <div style="display:flex;align-items:center;gap:0.6rem;flex-wrap:wrap;">
                        <span style="${pillStyle(color)}">${label}</span>
                        <span style="font-size:0.72rem;color:var(--text-muted);font-family:monospace;">${key}</span>
                        ${isCore ? '<span style="font-size:0.62rem;color:var(--text-muted);background:rgba(163,177,198,0.2);padding:0.06rem 0.4rem;border-radius:4px;">TERAS</span>' : ''}
                      </div>
                      ${desc ? `<span style="font-size:0.7rem;color:var(--text-muted);line-height:1.35;">${desc}</span>` : ''}
                    </div>
                    <div style="display:flex;gap:0.4rem;align-items:center;flex-shrink:0;">
                      <button onclick="window.setManageTab(\'access_control\')" title="Tetapkan kebenaran" style="padding:0.2rem 0.55rem;border-radius:6px;border:1px solid rgba(67,97,238,0.3);background:rgba(67,97,238,0.07);font-size:0.72rem;color:#4361ee;cursor:pointer;">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                        RBAC
                      </button>
                      ${!isCore ? `<button data-rolekey="${key}" onclick="window.deleteCustomRole(this.dataset.rolekey)" title="Padam peranan" style="padding:0.2rem 0.5rem;border-radius:6px;border:1px solid rgba(239,68,68,0.25);background:rgba(239,68,68,0.07);font-size:0.72rem;color:#ef4444;cursor:pointer;">&#10005;</button>` : ''}
                    </div>
                  </div>`;
                };
                const groupHeader = (t) => `<div style="padding:0.45rem 1rem;background:rgba(67,97,238,0.05);border-bottom:1px solid rgba(163,177,198,0.12);font-size:0.68rem;font-weight:800;text-transform:uppercase;letter-spacing:0.5px;color:#4361ee;">${t}</div>`;
                const grouped = new Set();
                roleGroups.forEach(g => g.keys.forEach(k => grouped.add(k)));
                let html = '';
                roleGroups.forEach(g => {
                  const present = g.keys.filter(k => allRoleKeys.includes(k));
                  if (present.length) html += groupHeader(g.title) + present.map(renderRow).join('');
                });
                const leftover = allRoleKeys.filter(k => !grouped.has(k));
                if (leftover.length) html += groupHeader('🧩 Tersuai') + leftover.map(renderRow).join('');
                return html;
              })()}
              <div style="padding:0.65rem 1rem;background:rgba(163,177,198,0.03);border-top:1px solid rgba(163,177,198,0.1);">
                <p style="font-size:0.7rem;color:var(--text-muted);margin:0;">Peranan teras tidak boleh dipadam. Peranan baharu akan ditambah ke RBAC dengan kebenaran minimum — tetapkan akses di tab <strong>Access Control</strong>.</p>
              </div>
            </section>

            <!-- KATEGORI -->
            <section class="glass-card" style="padding:0;overflow:hidden;">
              <div style="padding:0.85rem 1rem;border-bottom:1px solid rgba(163,177,198,0.15);display:flex;align-items:center;justify-content:space-between;background:rgba(163,177,198,0.04);">
                <div style="display:flex;align-items:center;gap:0.55rem;">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2"><path d="M4 6h16M4 10h16M4 14h16M4 18h16"/></svg>
                  <span style="font-size:0.9rem;font-weight:700;color:var(--text);">Kategori Staff</span>
                  <span style="font-size:0.72rem;color:var(--text-muted);background:rgba(163,177,198,0.2);padding:0.1rem 0.5rem;border-radius:999px;">${window.staffConfig.staffCategories.length} kategori</span>
                </div>
                <button onclick="window.addStaffCategory()" style="padding:0.3rem 0.8rem;border-radius:999px;border:1px solid rgba(16,185,129,0.4);background:rgba(16,185,129,0.08);font-size:0.78rem;font-weight:600;color:#10b981;cursor:pointer;">+ Tambah</button>
              </div>
              ${window.staffConfig.staffCategories.map(cat => {
                const isCore = CORE_CATEGORIES.includes(cat);
                return `<div style="${categoryRowStyle}">
                  <div style="display:flex;align-items:center;gap:0.6rem;">
                    <span style="font-size:0.82rem;font-weight:600;color:var(--text);">${cat}</span>
                    ${isCore ? '<span style="font-size:0.62rem;color:var(--text-muted);background:rgba(163,177,198,0.2);padding:0.06rem 0.4rem;border-radius:4px;">TERAS</span>' : ''}
                  </div>
                  ${!isCore ? `<button data-cat="${cat}" onclick="window.deleteStaffCategory(this.dataset.cat)" title="Padam kategori" style="padding:0.2rem 0.5rem;border-radius:6px;border:1px solid rgba(239,68,68,0.25);background:rgba(239,68,68,0.07);font-size:0.72rem;color:#ef4444;cursor:pointer;">&#10005;</button>` : ''}
                </div>`;
              }).join('')}
              <div style="padding:0.65rem 1rem;background:rgba(163,177,198,0.03);border-top:1px solid rgba(163,177,198,0.1);">
                <p style="font-size:0.7rem;color:var(--text-muted);margin:0;">Kategori teras (Admin Staff, Operation Staff, Doctor) tidak boleh dipadam. Kategori baharu akan tersedia dalam borang tambah/edit staff.</p>
              </div>
            </section>

          </div>

          <!-- LALUAN KELULUSAN -->
          <section class="glass-card" style="padding:0;overflow:hidden;margin-top:1.25rem;">
            <div style="padding:0.85rem 1rem;border-bottom:1px solid rgba(163,177,198,0.15);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.6rem;background:rgba(163,177,198,0.04);">
              <div style="display:flex;align-items:center;gap:0.55rem;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6d28d9" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                <span style="font-size:0.9rem;font-weight:700;color:var(--text);">Laluan Kelulusan Cuti</span>
                <span style="font-size:0.7rem;color:var(--text-muted);background:rgba(163,177,198,0.2);padding:0.1rem 0.5rem;border-radius:999px;">Siapa meluluskan cuti siapa</span>
              </div>
              <button onclick="window.saveRouting()" style="padding:0.35rem 1rem;border-radius:999px;border:1px solid rgba(109,40,217,0.4);background:rgba(109,40,217,0.1);font-size:0.78rem;font-weight:600;color:#6d28d9;cursor:pointer;display:flex;align-items:center;gap:0.4rem;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                Simpan
              </button>
            </div>

            <div style="padding:0.65rem 1rem;background:rgba(163,177,198,0.02);border-bottom:1px solid rgba(163,177,198,0.1);display:flex;flex-wrap:wrap;gap:0.4rem;align-items:center;">
              <div style="display:flex;align-items:center;gap:0.35rem;background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.2);border-radius:6px;padding:0.2rem 0.55rem;">
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
                <span style="font-size:0.67rem;color:#34d399;font-weight:600;">Aktif</span>
              </div>
              <div style="display:flex;align-items:center;gap:0.35rem;background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.18);border-radius:6px;padding:0.2rem 0.55rem;">
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                <span style="font-size:0.67rem;color:#ef4444;font-weight:600;">Tidak Aktif</span>
              </div>
              <span style="font-size:0.67rem;color:var(--text-muted);background:rgba(163,177,198,0.06);border:1px solid rgba(163,177,198,0.18);border-radius:6px;padding:0.2rem 0.55rem;">Klik sel untuk togol · Simpan untuk berkuat kuasa</span>
              <span style="font-size:0.67rem;color:var(--text-muted);background:rgba(163,177,198,0.06);border:1px solid rgba(163,177,198,0.18);border-radius:6px;padding:0.2rem 0.55rem;">★ Supervisor bagi Doktor Kuantan &amp; Op. Balok = Supervisor Balok (HQ)</span>
            </div>

            <div style="overflow-x:auto;">
              <table style="width:100%;border-collapse:collapse;font-size:0.78rem;">
                <thead>
                  <tr style="background:rgba(163,177,198,0.03);border-bottom:1px solid rgba(163,177,198,0.15);">
                    <th colspan="2" style="padding:0.5rem 0.75rem;font-weight:700;font-size:0.65rem;letter-spacing:0.8px;text-transform:uppercase;color:#6d28d9;border-right:2px solid rgba(163,177,198,0.25);text-align:left;">Kumpulan Kakitangan</th>
                    <th colspan="1" style="padding:0.5rem 0.75rem;font-weight:700;font-size:0.65rem;letter-spacing:0.8px;text-transform:uppercase;color:#f43f5e;border-right:2px solid rgba(163,177,198,0.25);text-align:center;">Peringkat 0 — TL</th>
                    <th colspan="3" style="padding:0.5rem 0.75rem;font-weight:700;font-size:0.65rem;letter-spacing:0.8px;text-transform:uppercase;color:#38bdf8;border-right:2px solid rgba(163,177,198,0.25);text-align:center;">Peringkat 1 — Pelulus</th>
                    <th colspan="1" style="padding:0.5rem 0.75rem;font-weight:700;font-size:0.65rem;letter-spacing:0.8px;text-transform:uppercase;color:#f97316;text-align:center;">Peringkat 2</th>
                  </tr>
                  <tr style="background:rgba(163,177,198,0.03);border-bottom:2px solid rgba(163,177,198,0.2);">
                    <th style="padding:0.45rem 0.9rem;font-weight:600;font-size:0.63rem;color:var(--text-muted);border-right:1px solid rgba(163,177,198,0.12);text-align:left;white-space:nowrap;">Kategori</th>
                    <th style="padding:0.45rem 0.75rem;font-weight:600;font-size:0.63rem;color:var(--text-muted);border-right:2px solid rgba(163,177,198,0.25);text-align:left;white-space:nowrap;">Skop</th>
                    <th style="padding:0.45rem 0.5rem;font-weight:600;font-size:0.63rem;color:#f43f5e;border-right:2px solid rgba(163,177,198,0.25);text-align:center;white-space:nowrap;">Team Leader</th>
                    <th style="padding:0.45rem 0.5rem;font-weight:600;font-size:0.63rem;color:#818cf8;border-right:1px solid rgba(163,177,198,0.12);text-align:center;white-space:nowrap;">Doctor PIC</th>
                    <th style="padding:0.45rem 0.5rem;font-weight:600;font-size:0.63rem;color:#0ea5e9;border-right:1px solid rgba(163,177,198,0.12);text-align:center;white-space:nowrap;">HOD Balok</th>
                    <th style="padding:0.45rem 0.5rem;font-weight:600;font-size:0.63rem;color:#34d399;border-right:2px solid rgba(163,177,198,0.25);text-align:center;white-space:nowrap;">Supervisor ★</th>
                    <th style="padding:0.45rem 0.5rem;font-weight:600;font-size:0.63rem;color:#f97316;text-align:center;white-space:nowrap;">Perlu P2?</th>
                  </tr>
                </thead>
                <tbody>
                  ${[
                    { key:'terengganu',       label:'Semua Kakitangan',  sub:'Terengganu',             color:'#0d9488', bg:'rgba(13,148,136,0.04)'  },
                    { key:'pahang_lain',      label:'Semua Kakitangan',  sub:'Pahang (Selain Balok)',   color:'#3b82f6', bg:'rgba(59,130,246,0.04)'  },
                    { key:'admin_balok',      label:'Kakitangan Admin',  sub:'Balok (HQ)',              color:'#0ea5e9', bg:'rgba(14,165,233,0.04)'  },
                    { key:'doctor_pahang',    label:'Doktor',            sub:'Pahang (Selain Bentong)', color:'#d97706', bg:'rgba(217,119,6,0.04)'  },
                    { key:'operation_balok',  label:'Kakitangan Operasi',sub:'Balok (HQ)',             color:'#10b981', bg:'rgba(16,185,129,0.04)'  },
                    { key:'xray_sono_balok',  label:'Juru X-Ray / Sono', sub:'Balok (HQ)',             color:'#ec4899', bg:'rgba(236,72,153,0.04)'  },
                    { key:'juru_audio_balok', label:'Juru Audio',        sub:'Balok (HQ)',             color:'#0d9488', bg:'rgba(13,148,136,0.04)'  },
                  ].map(row => {
                    const cfg = approvalRouting[row.key] || {};
                    const mkCell = (field, checked, color, thick) => {
                      const border = thick ? '2px' : '1px';
                      return `<td style="padding:0.5rem 0.5rem;border-right:${border} solid rgba(163,177,198,${thick?'0.25':'0.12'});cursor:pointer;text-align:center;" onclick="window.toggleRouting('${row.key}','${field}')">
                        <div style="display:flex;align-items:center;justify-content:center;pointer-events:none;">
                          ${checked
                            ? `<div style="width:26px;height:26px;border-radius:7px;background:${color}20;border:1px solid ${color}50;display:flex;align-items:center;justify-content:center;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></div>`
                            : '<div style="width:26px;height:26px;border-radius:7px;background:rgba(239,68,68,0.07);border:1px solid rgba(239,68,68,0.15);display:flex;align-items:center;justify-content:center;"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></div>'}
                        </div>
                      </td>`;
                    };
                    return `<tr style="border-bottom:1px solid rgba(163,177,198,0.1);background:${row.bg};" onmouseover="this.style.background='rgba(59,130,246,0.06)'" onmouseout="this.style.background='${row.bg}'">
                      <td style="padding:0.55rem 0.9rem;border-right:1px solid rgba(163,177,198,0.12);">
                        <span style="font-size:0.75rem;font-weight:700;color:${row.color};background:${row.color}15;border:1px solid ${row.color}30;padding:0.15rem 0.5rem;border-radius:6px;">${row.label}</span>
                      </td>
                      <td style="padding:0.55rem 0.75rem;border-right:2px solid rgba(163,177,198,0.25);font-size:0.75rem;color:var(--text-muted);white-space:nowrap;">${row.sub}</td>
                      ${mkCell('needs_tl',      cfg.needs_tl,      '#f43f5e', true)}
                      ${mkCell('p1_doctor_pic', cfg.p1_doctor_pic, '#818cf8', false)}
                      ${mkCell('p1_hod_balok',  cfg.p1_hod_balok,  '#0ea5e9', false)}
                      ${mkCell('p1_supervisor', cfg.p1_supervisor,  '#34d399', true)}
                      ${mkCell('needs_p2',      cfg.needs_p2,       '#f97316', false)}
                    </tr>`;
                  }).join('')}
                </tbody>
              </table>
            </div>
          </section>

          `;
        })() : ''}
      `;

    case 'policy':
      const currentMonthIndex = new Date().getMonth() + 1; // 1-12
      const currentMonthName = new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }).toUpperCase();
      const entitlementAL = user ? window.getEntitlementAL(user) : 20;
      const proRataPerMonth = (entitlementAL / 12);
      const monthsWorked = window.getMonthsWorkedThisYear(user.startDate);
      const accumulated = parseFloat((proRataPerMonth * monthsWorked).toFixed(2));
      // Baki sebenar ikut Formula B (getLeaveStats), bukan prorata mentah.
      const _polAlStats = user ? window.getLeaveStats(user, 'AL') : { ent: 0, used: 0, bal: 0 };
      
      return `
        <header class="top-bar">
          <h1>Policy Reference Guidelines</h1>
          <button class="neu-btn primary-text" onclick="window.setView('dashboard')">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
              Kembali ke Dashboard
          </button>
        </header>
        
        <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 2rem; margin-top: 2rem;">
            <!-- Main Policy Definitions -->
            <div style="display: flex; flex-direction: column; gap: 1.5rem;">
                <!-- PRO RATA WIDGET -->
                <section class="glass-card fade-in" style="padding: 2rem; background: rgba(255,255,255,0.02); border: 1px solid rgba(59, 130, 246, 0.2);">
                    <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1.5rem; color: var(--primary); font-weight: 700; letter-spacing: 1px; text-transform: uppercase;">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"></path><path d="M22 12A10 10 0 0 0 12 2v10z"></path></svg>
                        Formula Pengiraan Pro-Rata
                    </div>
                    <p style="color: var(--text-muted); font-size: 0.9rem; margin-bottom: 2rem;">Untuk mendapatkan jumlah cuti yang layak bagi setiap bulan bekerja:</p>
                    
                    <div style="display: flex; justify-content: center; align-items: center; gap: 1rem; margin-bottom: 2.5rem; font-weight: 700;">
                       <span style="color: var(--text-muted);">Cuti Pro-Rata Sebulan</span>
                       <span style="color: var(--primary); font-size: 1.5rem;">=</span>
                       <div style="display: flex; flex-direction: column; align-items: center; gap: 0.5rem;">
                          <span>Kelayakan Cuti Setahun</span>
                          <div style="width: 100%; height: 2px; background: currentColor;"></div>
                          <span>12 Bulan</span>
                       </div>
                    </div>

                    <div class="neu-panel" style="padding: 1.5rem;">
                       <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1.5rem; color: var(--text-muted); font-weight: 700; font-size: 0.75rem; letter-spacing: 1px;">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>
                          BAGI KES ANDA (${currentMonthName}) - CUTI TAHUNAN (AL)
                       </div>
                       
                       <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; margin-bottom: 2rem;">
                          <div>
                             <div style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 0.5rem;">Kelayakan Setahun</div>
                             <div style="font-size: 2rem; font-weight: 700; color: var(--primary);">${entitlementAL} <span style="font-size: 1rem; color: var(--text-muted); font-weight: 500;">hari</span></div>
                          </div>
                          <div>
                             <div style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 0.5rem;">Pro-Rata Sebulan</div>
                             <div style="font-size: 2rem; font-weight: 700; color: var(--secondary);">${(entitlementAL / 12).toFixed(2)} <span style="font-size: 1rem; color: var(--text-muted); font-weight: 500;">hari</span></div>
                          </div>
                          <div>
                             <div style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 0.5rem;">Jumlah Peruntukan</div>
                             <div style="font-size: 2rem; font-weight: 700; color: var(--accent);">${parseFloat(_polAlStats.ent.toFixed(2))} <span style="font-size: 1rem; color: var(--text-muted); font-weight: 500;">hari</span></div>
                          </div>
                           <div>
                             <div style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 0.5rem;">Baki Tersedia Sekarang</div>
                             <div style="font-size: 2rem; font-weight: 700; color: var(--primary);">${parseFloat(_polAlStats.bal.toFixed(2))} <span style="font-size: 1rem; color: var(--text-muted); font-weight: 500;">hari</span></div>
                          </div>
                       </div>

                       <div style="text-align: right; font-size: 0.75rem; color: var(--primary); font-style: italic; border-top: 1px dashed var(--border); padding-top: 1rem; font-weight: 600;">
                          Jumlah Peruntukan ${parseFloat(_polAlStats.ent.toFixed(2))} − Guna Sebelum ${parseFloat((_polAlStats.usedPre||0).toFixed(2))} − Guna Sistem ${parseFloat(_polAlStats.used.toFixed(2))} − Pelarasan ${parseFloat((_polAlStats.pelarasan||0).toFixed(2))} = Baki ${parseFloat(_polAlStats.bal.toFixed(2))} hari
                       </div>
                       <div style="text-align: right; font-size: 0.65rem; color: var(--text-muted); font-style: italic; margin-top: 0.4rem;">
                          *Prorata di atas adalah rujukan formula sahaja. Baki sebenar = Jumlah Peruntukan − Guna Sebelum Sistem − Guna Dalam Sistem − Pelarasan HR.
                       </div>
                    </div>
                </section>

                <!-- ALIRAN KELULUSAN SECTION -->
                <section class="glass-card fade-in" style="padding: 2rem; border: 1px solid rgba(139,92,246,0.25); background: rgba(139,92,246,0.03);">
                   <h2 style="font-size: 1.25rem; font-weight: 600; color: var(--secondary); margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.5rem;">
                     <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                     Aliran Kelulusan Cuti (Approval Flow)
                   </h2>
                   <p style="font-size: 0.82rem; color: var(--text-muted); margin-bottom: 1.5rem;">Setiap permohonan cuti mesti melalui peringkat kelulusan berikut sebelum dikira SAH.</p>

                   <div style="display: flex; flex-direction: column; gap: 1rem;">

                     <!-- Op Balok — 3 peringkat -->
                     <div style="border-radius: 14px; border: 1.5px solid #f43f5e33; background: rgba(244,63,94,0.04); padding: 1.25rem 1.5rem;">
                       <div style="font-size: 0.72rem; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; color: #f43f5e; margin-bottom: 1rem;">Staff Operasi — Klinik Syed Badaruddin Balok (3 Peringkat)</div>
                       <div style="display: flex; flex-direction: column; gap: 0.6rem;">
                         <div style="display: flex; align-items: flex-start; gap: 0.75rem;">
                           <div style="flex-shrink: 0; width: 28px; height: 28px; border-radius: 50%; background: #f43f5e; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 0.65rem; font-weight: 800;">P0</div>
                           <div>
                             <div style="font-size: 0.85rem; font-weight: 700; color: var(--text);">Sokongan Peringkat 0 — Team Leader (TL)</div>
                             <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 0.15rem;">Permohonan mesti disokong oleh <strong>Team Leader Balok</strong> yang dipilih semasa menghantar borang sebelum boleh ke Supervisor.</div>
                           </div>
                         </div>
                         <div style="border-left: 2px dashed rgba(244,63,94,0.3); height: 16px; margin-left: 13px;"></div>
                         <div style="display: flex; align-items: flex-start; gap: 0.75rem;">
                           <div style="flex-shrink: 0; width: 28px; height: 28px; border-radius: 50%; background: #f59e0b; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 0.65rem; font-weight: 800;">P1</div>
                           <div>
                             <div style="font-size: 0.85rem; font-weight: 700; color: var(--text);">Nilai & Lulus Peringkat 1 — Supervisor</div>
                             <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 0.15rem;">Supervisor Balok menilai dan meluluskan <strong>selepas</strong> sokongan Team Leader diterima.</div>
                           </div>
                         </div>
                         <div style="border-left: 2px dashed rgba(245,158,11,0.3); height: 16px; margin-left: 13px;"></div>
                         <div style="display: flex; align-items: flex-start; gap: 0.75rem;">
                           <div style="flex-shrink: 0; width: 28px; height: 28px; border-radius: 50%; background: #059669; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 0.65rem; font-weight: 800;">P2</div>
                           <div>
                             <div style="font-size: 0.85rem; font-weight: 700; color: var(--text);">Kelulusan Akhir Peringkat 2 — HR / Admin</div>
                             <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 0.15rem;">Cuti hanya dikira <strong>SAH</strong> selepas HR/Admin memberi kelulusan akhir.</div>
                           </div>
                         </div>
                       </div>
                     </div>

                     <!-- Doktor, Admin, Op Lain — 2 peringkat -->
                     <div style="border-radius: 14px; border: 1.5px solid #3b82f633; background: rgba(59,130,246,0.04); padding: 1.25rem 1.5rem;">
                       <div style="font-size: 0.72rem; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; color: #3b82f6; margin-bottom: 1rem;">Doktor / Staff Admin / Staff Operasi Lain (2 Peringkat)</div>
                       <div style="display: flex; flex-direction: column; gap: 0.6rem;">
                         <div style="display: flex; align-items: flex-start; gap: 0.75rem;">
                           <div style="flex-shrink: 0; width: 28px; height: 28px; border-radius: 50%; background: #3b82f6; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 0.65rem; font-weight: 800;">P1</div>
                           <div>
                             <div style="font-size: 0.85rem; font-weight: 700; color: var(--text);">Sokongan Peringkat 1 — HOD / PIC HOD / Supervisor</div>
                             <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 0.15rem;">Pelulus Peringkat 1 yang dipilih semasa menghantar borang menilai dan menyokong permohonan.</div>
                           </div>
                         </div>
                         <div style="border-left: 2px dashed rgba(59,130,246,0.3); height: 16px; margin-left: 13px;"></div>
                         <div style="display: flex; align-items: flex-start; gap: 0.75rem;">
                           <div style="flex-shrink: 0; width: 28px; height: 28px; border-radius: 50%; background: #059669; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 0.65rem; font-weight: 800;">P2</div>
                           <div>
                             <div style="font-size: 0.85rem; font-weight: 700; color: var(--text);">Kelulusan Akhir Peringkat 2 — HR / Admin</div>
                             <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 0.15rem;">Cuti hanya dikira <strong>SAH</strong> selepas HR/Admin memberi kelulusan akhir.</div>
                           </div>
                         </div>
                       </div>
                     </div>

                     <!-- Terengganu — tanpa P2 -->
                     <div style="border-radius: 14px; border: 1.5px solid #8b5cf633; background: rgba(139,92,246,0.04); padding: 1.25rem 1.5rem;">
                       <div style="font-size: 0.72rem; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; color: #8b5cf6; margin-bottom: 1rem;">Staff Terengganu (Dungun / Kerteh / Paka) — 1 Peringkat</div>
                       <div style="display: flex; align-items: flex-start; gap: 0.75rem;">
                         <div style="flex-shrink: 0; width: 28px; height: 28px; border-radius: 50%; background: #8b5cf6; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 0.65rem; font-weight: 800;">P1</div>
                         <div>
                           <div style="font-size: 0.85rem; font-weight: 700; color: var(--text);">Kelulusan — HOD / PIC HOD</div>
                           <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 0.15rem;">Cuti <strong>SAH</strong> selepas HOD / PIC HOD beri kelulusan. Tidak perlu kelulusan HR/Admin (Peringkat 2).</div>
                         </div>
                       </div>
                     </div>

                   </div>
                </section>

                ${policyContent.notice ? `<div style="margin-bottom:1.5rem;padding:1rem 1.25rem;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.3);border-left:4px solid #f59e0b;border-radius:10px;font-size:0.88rem;color:var(--text);line-height:1.6;">📢 ${policyContent.notice}</div>` : ''}
                <section class="glass-card fade-in" style="padding: 2rem;">
                   <h2 style="font-size: 1.25rem; font-weight: 600; color: var(--primary); margin-bottom: 1.5rem; display: flex; align-items: center; gap: 0.5rem;"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg> Senarai Kategori Cuti (Glossary)</h2>
                   <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                     ${policyContent.glossary.map(g => `<div class="neu-panel" style="padding: 1rem;"><strong style="color: var(--primary);">${g.code}:</strong> ${g.name}</div>`).join('')}
                   </div>
                </section>

                <section class="glass-card fade-in" style="padding: 2rem;">
                   <h2 style="font-size: 1.25rem; font-weight: 600; color: var(--primary); margin-bottom: 1.5rem; display: flex; align-items: center; gap: 0.5rem;"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg> Jadual Kelayakan Cuti Tahunan Mengikut Lokasi</h2>
                   
                   ${(!user || !user.branch || (!user.branch.includes('Dungun') && !user.branch.includes('Kerteh') && !user.branch.includes('Paka'))) ? `
                   <div style="margin-bottom: 2rem;">
                     <h3 style="color: var(--primary); font-size: 1rem; margin-bottom: 0.5rem;">Negeri Pahang</h3>
                     <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.85rem; color: var(--text-muted);">
                       <thead><tr style="background: rgba(67,97,238,0.07); color: var(--text);">
                         <th style="padding: 0.5rem; border: 1px solid var(--border);">Tempoh Berkhidmat</th>
                         <th style="padding: 0.5rem; border: 1px solid var(--border);">Kelayakan Tahunan (AL)</th>
                       </tr></thead>
                       <tbody>${policyContent.entitlementPahang.map((r,i) => `
                         <tr style="${i%2===1?'background:rgba(59,130,246,0.07);':''}">
                           <td style="padding:0.5rem;border:1px solid var(--border);font-weight:${i>0?'bold':'normal'};color:${i>0?'var(--primary)':'inherit'};">${r.period}</td>
                           <td style="padding:0.5rem;border:1px solid var(--border);font-weight:${i>0?'bold':'normal'};color:${i>0?'var(--primary)':'inherit'};">${r.days}</td>
                         </tr>`).join('')}
                       </tbody>
                     </table>
                   </div>` : ''}

                   ${(!user || !user.branch || (user.branch.includes('Dungun') || user.branch.includes('Kerteh') || user.branch.includes('Paka'))) ? `
                   <div>
                     <h3 style="color: var(--accent); font-size: 1rem; margin-bottom: 0.5rem;">Negeri Terengganu</h3>
                     <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.85rem; color: var(--text-muted);">
                       <thead><tr style="background: rgba(67,97,238,0.07); color: var(--text);">
                         <th style="padding: 0.5rem; border: 1px solid var(--border);">Tempoh Berkhidmat</th>
                         <th style="padding: 0.5rem; border: 1px solid var(--border);">Kelayakan Tahunan (AL)</th>
                       </tr></thead>
                       <tbody>${policyContent.entitlementTerengganu.map((r,i) => `
                         <tr style="background:rgba(192,132,252,0.1);">
                           <td style="padding:0.5rem;border:1px solid var(--border);color:var(--accent);font-weight:bold;">${r.period}</td>
                           <td style="padding:0.5rem;border:1px solid var(--border);color:var(--accent);font-weight:bold;">${r.days}</td>
                         </tr>`).join('')}
                       </tbody>
                     </table>
                     <p style="font-size:0.75rem;color:var(--text-muted);margin-top:0.5rem;font-style:italic;">*Terhad kepada cawangan Dungun, Kerteh, dan Paka.</p>
                   </div>` : ''}

                   <div style="margin-top: 2rem;">
                     <h3 style="color: var(--danger); font-size: 1rem; margin-bottom: 0.5rem;">Kategori Doktor (Semua Kawasan)</h3>
                     <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.85rem; color: var(--text-muted);">
                       <thead><tr style="background: rgba(67,97,238,0.07); color: var(--text);">
                         <th style="padding: 0.5rem; border: 1px solid var(--border);">Peringkat Cuti Tahunan (AL)</th>
                       </tr></thead>
                       <tbody>${policyContent.entitlementDoktor.map((r,i) => `
                         <tr style="${i%2===1?'background:rgba(248,113,113,0.1);':''}">
                           <td style="padding:0.5rem;border:1px solid var(--border);color:var(--danger);font-weight:bold;">${r.days}</td>
                         </tr>`).join('')}
                       </tbody>
                     </table>
                   </div>
                </section>

                <section class="glass-card fade-in" style="padding: 2rem;">
                   <h2 style="font-size: 1.25rem; font-weight: 600; color: var(--primary); margin-bottom: 1.5rem; display: flex; align-items: center; gap: 0.5rem;"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg> Syarat & Peraturan Utama</h2>
                   
                   <div style="display: flex; flex-direction: column; gap: 1rem;">
                       <div class="neu-panel" style="border-left: 4px solid var(--accent); padding-left: 1.5rem;">
                          <h3 style="font-size: 1rem; color: var(--accent); margin-bottom: 0.5rem;">1. Cuti Tahunan (Annual Leave - AL)</h3>
                          <ul style="color: var(--text-muted); font-size: 0.9rem; padding-left: 1.5rem; line-height: 1.6; margin: 0;">
                            ${policyContent.rulesAL.map(r => `<li>${r}</li>`).join('')}
                          </ul>
                       </div>

                       <div class="neu-panel" style="border-left: 4px solid #eab308; padding-left: 1.5rem;">
                          <h3 style="font-size: 1rem; color: #eab308; margin-bottom: 0.5rem;">2. Cuti Sakit (Medical Leave - MC)</h3>
                          <ul style="color: var(--text-muted); font-size: 0.9rem; padding-left: 1.5rem; line-height: 1.6; margin: 0;">
                            ${policyContent.rulesMC.map(r => `<li>${r}</li>`).join('')}
                          </ul>
                          ${policyContent.entitlementMC && policyContent.entitlementMC.length > 0 ? `
                          <div style="margin-top:1rem;">
                            <div style="font-size:0.78rem;font-weight:700;color:#eab308;margin-bottom:0.5rem;text-transform:uppercase;letter-spacing:0.5px;">Jadual Kelayakan MC</div>
                            <table style="width:100%;border-collapse:collapse;font-size:0.82rem;">
                              <thead><tr style="background:rgba(234,179,8,0.1);">
                                <th style="padding:0.45rem 0.6rem;border:1px solid rgba(234,179,8,0.25);text-align:left;color:#eab308;">Tempoh Berkhidmat</th>
                                <th style="padding:0.45rem 0.6rem;border:1px solid rgba(234,179,8,0.25);text-align:center;color:#eab308;">Hari Kelayakan</th>
                              </tr></thead>
                              <tbody>${policyContent.entitlementMC.map((r,i) => `
                                <tr style="${i%2===1?'background:rgba(234,179,8,0.05);':''}">
                                  <td style="padding:0.4rem 0.6rem;border:1px solid rgba(163,177,198,0.2);color:var(--text-muted);">${r.period}</td>
                                  <td style="padding:0.4rem 0.6rem;border:1px solid rgba(163,177,198,0.2);text-align:center;font-weight:700;color:#eab308;">${r.days}</td>
                                </tr>`).join('')}
                              </tbody>
                            </table>
                          </div>` : ''}
                       </div>

                       <div class="neu-panel" style="border-left: 4px solid var(--danger); padding-left: 1.5rem;">
                          <h3 style="font-size: 1rem; color: var(--danger); margin-bottom: 0.5rem;">3. Perbandingan: Cuti Kecemasan (EL) vs Cuti Ehsan</h3>
                          <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.85rem; color: var(--text-muted); margin-top: 1rem;">
                            <thead>
                                <tr style="background: rgba(67,97,238,0.07); color: var(--text);">
                                    <th style="padding: 0.5rem; border: 1px solid var(--border);">Aspek</th>
                                    <th style="padding: 0.5rem; border: 1px solid var(--border); color: var(--danger);">Cuti Kecemasan (EL)</th>
                                    <th style="padding: 0.5rem; border: 1px solid var(--border); color: var(--secondary);">Cuti Ehsan (Compassionate)</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td style="padding: 0.5rem; border: 1px solid var(--border);"><strong>Tujuan</strong></td>
                                    <td style="padding: 0.5rem; border: 1px solid var(--border);">Kecemasan peribadi (kereta rosak, banjir, isteri bersalin kecemasan dll)</td>
                                    <td style="padding: 0.5rem; border: 1px solid var(--border);">Kematian ahli keluarga terdekat <em>(Ibu, Bapa, Suami/Isteri, Anak sahaja)</em></td>
                                </tr>
                                <tr>
                                    <td style="padding: 0.5rem; border: 1px solid var(--border);"><strong>Tolak Baki Cuti?</strong></td>
                                    <td style="padding: 0.5rem; border: 1px solid var(--border);">Ya. Ditolak dari Annual Leave (AL)</td>
                                    <td style="padding: 0.5rem; border: 1px solid var(--border);">Tambahan Percuma (Tanpa tolak AL)</td>
                                </tr>
                                <tr>
                                    <td style="padding: 0.5rem; border: 1px solid var(--border);"><strong>Had Limit</strong></td>
                                    <td style="padding: 0.5rem; border: 1px solid var(--border);">Fleksibel (Mengikut baki AL sedia ada)</td>
                                    <td style="padding: 0.5rem; border: 1px solid var(--border);">Max 3 Hari berturut-turut untuk setiap kes</td>
                                </tr>
                                <tr>
                                    <td style="padding: 0.5rem; border: 1px solid var(--border);"><strong>Bukti WAJIB</strong></td>
                                    <td style="padding: 0.5rem; border: 1px solid var(--border);">Gambar kemalangan / tayar pancit dll</td>
                                    <td style="padding: 0.5rem; border: 1px solid var(--border);">Sijil Kematian</td>
                                </tr>
                            </tbody>
                          </table>
                          <p style="color: var(--danger); font-size: 0.8rem; margin-top: 1rem; font-style: italic;">*Nota: Borang yang dihantar tanpa dokumen sokongan akan dihalang oleh sistem serta-merta.</p>
                       </div>

                       <div class="neu-panel" style="border-left: 4px solid #c084fc; padding-left: 1.5rem;">
                          <h3 style="font-size: 1rem; color: var(--secondary); margin-bottom: 0.5rem;">4. Cuti Pendidikan (CME Leave)</h3>
                          <ul style="color: var(--text-muted); font-size: 0.9rem; padding-left: 1.5rem; line-height: 1.6; margin: 0;">
                            ${policyContent.rulesCME.map(r => `<li>${r}</li>`).join('')}
                          </ul>
                       </div>

                       <div class="neu-panel" style="border-left: 4px solid #94a3b8; padding-left: 1.5rem;">
                          <h3 style="font-size: 1rem; color: #94a3b8; margin-bottom: 0.5rem;">5. Notis Berhenti Kerja (Notice Period)</h3>
                          <ul style="color: var(--text-muted); font-size: 0.9rem; padding-left: 1.5rem; line-height: 1.6; margin: 0;">
                            ${policyContent.rulesNotice.map(r => `<li>${r}</li>`).join('')}
                          </ul>
                       </div>
                   </div>
                </section>
            </div>

            <!-- Side Information: Public Holidays (dynamic) -->
            <div>
               <section class="glass-card fade-in" style="position: sticky; top: 2rem; padding: 2rem;">
                  ${(() => {
                    const branchObj = branches.find(b => b.name === user.branch);
                    const isTerengganu = branchObj && branchObj.state === 'Terengganu';
                    const state = isTerengganu ? 'terengganu' : 'pahang';
                    const stateLabel = isTerengganu ? 'Terengganu' : 'Pahang';
                    const list = (publicHolidays[state] || []).slice().sort((a,b) => a.date.localeCompare(b.date));
                    const year = list.length ? list[0].date.substring(0,4) : new Date().getFullYear();
                    return `
                  <h2 style="font-size: 1.1rem; font-weight: 600; color: var(--text); margin-bottom: 1.5rem; display: flex; align-items: center; gap: 0.5rem;">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                    Cuti Umum ${stateLabel} ${year}
                  </h2>
                  <div style="border-radius: 12px; padding: 1.5rem; font-size: 0.85rem; border: 1px solid var(--border); box-shadow: var(--shadow-inset-sm);">
                    <div style="color: var(--primary); font-weight: 600; margin-bottom: 1.5rem; text-align: center; border-bottom: 1px solid var(--border); padding-bottom: 0.75rem; text-transform: uppercase;">Jumlah: ${list.length} Hari Pelepasan Am</div>
                    <table style="width: 100%; border-collapse: collapse; color: var(--text-muted); font-weight: 600; font-size: 0.8rem;">
                      ${list.map((h, i) => {
                        const d = new Date(h.date + 'T00:00:00');
                        const label = d.toLocaleDateString('ms-MY', { day: 'numeric', month: 'short' });
                        const isLast = i === list.length - 1;
                        return `<tr style="${isLast ? '' : 'border-bottom: 1px solid var(--border);'}"><td style="padding: 0.6rem 0;">${label}</td><td style="text-align: right; color: var(--text);">${h.name}</td></tr>`;
                      }).join('')}
                    </table>
                  </div>`;
                  })()}
               </section>
            </div>
        </div>
      `;

    case 'inbox': {
      const unread = inboxNotifs.filter(n => !n.read).length;
      const typeIcon = { leave_submitted:'📋', leave_approved:'✅', leave_rejected:'❌', leave_p1_approved:'📋', leave_tl_approved:'📋', leave_to_approve:'📥', approval_made:'🗂️', reminder_start:'🔔', reminder_balance:'⚠️', system:'ℹ️' };
      const typeColor = { leave_submitted:'#3b82f6', leave_approved:'#10b981', leave_rejected:'#ef4444', leave_p1_approved:'#f59e0b', leave_tl_approved:'#f59e0b', leave_to_approve:'#3b82f6', approval_made:'#10b981', reminder_start:'#8b5cf6', reminder_balance:'#f59e0b', system:'#64748b' };
      return `
        <header class="top-bar">
          <h1 style="display:flex;align-items:center;gap:0.6rem;">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>
            Inbox
            ${unread > 0 ? `<span style="background:var(--danger);color:#fff;font-size:0.7rem;font-weight:800;padding:0.1rem 0.5rem;border-radius:999px;">${unread} belum baca</span>` : ''}
          </h1>
          <button class="neu-btn primary-text" onclick="window.setView('dashboard')">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
            Kembali
          </button>
        </header>
        <div class="main-content" style="max-width:700px;margin:0 auto;padding:1.5rem 1rem;">
          ${inboxNotifs.length === 0 ? `
            <div class="glass-card fade-in" style="padding:3.5rem;text-align:center;color:var(--text-muted);">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.3;margin-bottom:1rem;display:block;margin-inline:auto;"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>
              <p style="font-size:0.95rem;font-weight:600;margin-bottom:0.4rem;">Inbox kosong</p>
              <p style="font-size:0.8rem;">Notifikasi berkaitan cuti anda akan muncul di sini.</p>
            </div>
          ` : `
            <div style="display:flex;flex-direction:column;gap:0.6rem;">
              ${inboxNotifs.map(n => {
                const icon = typeIcon[n.type] || 'ℹ️';
                const color = typeColor[n.type] || '#64748b';
                const d = new Date(n.createdAt);
                const timeStr = d.toLocaleDateString('ms-MY', { day:'2-digit', month:'short', year:'numeric' }) + ' ' + d.toLocaleTimeString('ms-MY', { hour:'2-digit', minute:'2-digit' });
                return `
                <div class="glass-card fade-in" onclick="window.markNotifRead('${n.id}')" style="padding:1rem 1.25rem;cursor:pointer;border-left:3px solid ${color};${!n.read ? 'background:rgba(59,130,246,0.04);' : 'opacity:0.75;'}display:flex;align-items:flex-start;gap:1rem;transition:opacity 0.2s;">
                  <div style="font-size:1.5rem;flex-shrink:0;margin-top:0.1rem;">${icon}</div>
                  <div style="flex:1;min-width:0;">
                    <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.25rem;">
                      <span style="font-size:0.9rem;font-weight:${n.read ? '600' : '800'};color:var(--text);">${n.title}</span>
                      ${!n.read ? `<span style="background:var(--danger);color:#fff;font-size:0.6rem;font-weight:800;padding:0.1rem 0.4rem;border-radius:999px;">BARU</span>` : ''}
                    </div>
                    <p style="font-size:0.8rem;color:var(--text-muted);margin:0 0 0.35rem;line-height:1.5;">${n.body}</p>
                    <span style="font-size:0.7rem;color:var(--text-muted);opacity:0.7;">${timeStr}</span>
                  </div>
                </div>`;
              }).join('')}
            </div>
          `}
        </div>
      `;
    }

    case 'settings':
      return `
        <header class="top-bar">
          <h1>Tetapan Akaun (Settings)</h1>
          <button class="neu-btn primary-text" onclick="window.setView('dashboard')">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
              Kembali ke Dashboard
          </button>
        </header>

        <section style="display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; margin-top: 2rem;">
            <!-- Profile Card -->
            <div class="glass-card fade-in" style="padding: 2.5rem; position: relative;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 2rem;">
                    <h2 style="font-size: 1.25rem; font-weight: 600; color: var(--primary); display: flex; align-items: center; gap: 0.5rem;">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                        My Profile
                    </h2>
                    <button class="neu-btn" onclick="window.setProfileSettings(true)" style="padding: 0.5rem 1rem; display: flex; align-items: center; gap: 0.5rem; font-size: 0.75rem;">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                        Edit Profile
                    </button>
                </div>

                <div style="display: flex; flex-direction: column; gap: 1.5rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(163,177,198,0.25); padding-bottom: 1rem;">
                        <span style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600; letter-spacing: 1px;">Full Name</span>
                        <span style="font-weight: 600;">${user.name}</span>
                    </div>

                    <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(163,177,198,0.25); padding-bottom: 1rem;">
                        <span style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600; letter-spacing: 1px;">IC Number</span>
                        <span style="font-weight: 600;">${user.ic}</span>
                    </div>

                    <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(163,177,198,0.25); padding-bottom: 1rem;">
                        <span style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600; letter-spacing: 1px;">Phone</span>
                        <span style="font-weight: 600;">${user.phone || 'Belum ditetapkan'}</span>
                    </div>

                    <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(163,177,198,0.25); padding-bottom: 1rem;">
                        <span style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600; letter-spacing: 1px; display: flex; align-items: center; gap: 0.25rem;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg> Email</span>
                        ${user.email ? `<span style="font-weight: 600; font-size: 0.85rem;">${user.email}</span>` : `<span style="font-weight: 600; font-size: 0.8rem; color: var(--warning); display: flex; align-items: center; gap: 0.25rem;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg> Belum ditetapkan &mdash; Klik Edit</span>`}
                    </div>
                    
                    <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(163,177,198,0.25); padding-bottom: 1rem;">
                        <span style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600; letter-spacing: 1px;">Access Level</span>
                        <span style="font-weight: 700; font-size: 0.75rem; background: rgba(59, 130, 246, 0.1); color: var(--primary); padding: 0.25rem 0.75rem; border-radius: 20px; border: 1px solid rgba(59, 130, 246, 0.2); text-transform: uppercase;">${user.role}</span>
                    </div>

                    <div style="display: flex; flex-direction: column; gap: 0.25rem; border-bottom: 1px solid rgba(163,177,198,0.25); padding-bottom: 1rem;">
                        <span style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600; letter-spacing: 1px;">Alamat</span>
                        <span style="font-weight: 600; font-size: 0.9rem;">${user.address || '—'}</span>
                    </div>

                    <div style="display: flex; flex-direction: column; gap: 0.25rem; border-bottom: 1px solid rgba(163,177,198,0.25); padding-bottom: 1rem;">
                        <span style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600; letter-spacing: 1px;">Branch</span>
                        <span style="font-weight: 600; font-size: 0.9rem;">${user.branch}</span>
                    </div>

                    <div style="display: flex; flex-direction: column; gap: 0.25rem;">
                        <span style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600; letter-spacing: 1px;">Service Duration</span>
                        <span style="font-weight: 700; font-size: 0.9rem; color: var(--primary);">${window.getServiceDurationText(user.startDate)}</span>
                    </div>
                </div>
            </div>

            <!-- Security Card -->
            <div class="glass-card fade-in" style="padding: 2.5rem; height: fit-content;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 2.5rem;">
                    <h2 style="font-size: 1.25rem; font-weight: 600; color: #f97316; display: flex; align-items: center; gap: 0.5rem;">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                        Security
                    </h2>
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="rgba(249, 115, 22, 0.2)" stroke-width="1"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                </div>
                
                <form style="display: flex; flex-direction: column; gap: 1.5rem;" onsubmit="window.changePassword(event)">
                    <div>
                        <label style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600; letter-spacing: 1px; margin-bottom: 0.5rem; display: block;">Current Password</label>
                        <input type="password" id="pwd-current" required class="neu-inset" placeholder="Masukkan kata laluan semasa" style="width: 100%; padding: 1rem; color-scheme: light;">
                    </div>

                    <div>
                        <label style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600; letter-spacing: 1px; margin-bottom: 0.5rem; display: block;">New Password</label>
                        <input type="password" id="pwd-new" required minlength="4" class="neu-inset" placeholder="Masukkan kata laluan baharu" style="width: 100%; padding: 1rem; color-scheme: light;">
                    </div>

                    <div>
                        <label style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600; letter-spacing: 1px; margin-bottom: 0.5rem; display: block;">Confirm New Password</label>
                        <input type="password" id="pwd-confirm" required minlength="4" class="neu-inset" placeholder="Ulang kata laluan baharu" style="width: 100%; padding: 1rem; color-scheme: light;">
                    </div>

                    <button type="submit" class="neu-btn" style="width: 100%; padding: 1rem; display: flex; justify-content: center; align-items: center; gap: 0.5rem; color: var(--primary); font-weight: 600; font-size: 1rem;">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
                        Tukar Kata Laluan
                    </button>
                </form>
            </div>
        </section>
      `;

    default:
      return `<div style="padding: 2rem; text-align: center;">Coming Soon: ${view} Module</div>`;
  }
}

function renderModal() {
  if (!editingStaff) return '';
  const staff = staffList.find(s => s.ic === editingStaff);
  if (!staff) return '';

  // Generate a mock start date if none exists, just to show the UI parity
  if (!staff.startDate) {
      const randomYear = 2013 + Math.floor(Math.random() * 10);
      staff.startDate = `${randomYear}-01-10`;
  }

  const serviceDurationText = window.getServiceDurationText(staff.startDate);

  // Kiraan AL/MC/EL untuk modal (Formula B: Jumlah − Guna Sebelum − Guna Sistem − Pelarasan)
  const _modalSysUsed = (t) => leaveRecords
    .filter(r => r.ic === staff.ic && r.status === 'APPROVED' && r.type === t)
    .reduce((acc, r) => acc + parseFloat(r.days || 0), 0);

  // Medan "Guna Dalam Sistem" — bergantung pada autoSystemUsage.
  //  • AUTO ON : satu medan Rekod Auto (read-only) dari rekod diluluskan.
  //  • MANUAL  : satu medan editable yang HR isi sendiri.
  const _sysUsageFieldsHTML = (prefix, autoVal, adjVal) => autoSystemUsage ? `
          <div style="display: flex; flex-direction: column;">
            <label style="font-size: 0.75rem; margin-bottom: 0.5rem; color: var(--text-muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Guna Dalam Sistem (Rekod Auto)</label>
            <input type="number" id="${prefix}-sys-used-display" class="neu-inset" disabled value="${autoVal.toFixed(1)}" data-used="${autoVal}" style="border-left: 3px solid #ef4444; color:#ef4444; font-weight:700; opacity:1; cursor:default;">
            <span style="font-size: 0.68rem; color: var(--text-muted); margin-top: 0.35rem;">Auto dari rekod cuti diluluskan (mod manual dimatikan)</span>
          </div>` : `
          <div style="display: flex; flex-direction: column;">
            <label style="font-size: 0.75rem; margin-bottom: 0.5rem; color: #ef4444; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">Guna Dalam Sistem (Manual)</label>
            <input type="number" id="${prefix}-sys-adj-input" class="neu-inset" min="0" step="0.5" value="${adjVal}" oninput="window._recalcLeaveBalance('${prefix}')" style="border-left: 3px solid #ef4444;">
            <span style="font-size: 0.68rem; color: var(--text-muted); margin-top: 0.35rem;">Bilangan hari telah digunakan dalam sistem (isi manual)</span>
          </div>`;

  const _modalSysUsedAL   = _modalSysUsed('AL');
  const _modalAlUsedSysAdj = parseFloat(staff.al_used_sys_adj || 0);
  const _modalAlPelarasan  = parseFloat(staff.al_pelarasan    || 0);
  const _modalTotalAL = parseFloat(staff.ent_CF !== undefined ? staff.ent_CF : 0) + parseFloat(staff.ent_AL !== undefined ? staff.ent_AL : window.getEntitlementAL(staff));
  // Fallback warisan al_adj → "Guna Sebelum Sistem" (selari dengan getLeaveStats) supaya
  // nilai sedia ada HR terpapar dalam modal dan kekal apabila HR simpan semula.
  const _modalAlUsedPre = (staff.al_used_pre === undefined && staff.al_pelarasan === undefined && parseFloat(staff.al_adj || 0) > 0)
    ? Math.max(0, _modalTotalAL - parseFloat(staff.al_adj || 0))
    : parseFloat(staff.al_used_pre || 0);
  const _modalAlBalance = Math.max(0, _modalTotalAL - _modalAlUsedPre - (autoSystemUsage ? _modalSysUsedAL : _modalAlUsedSysAdj) - _modalAlPelarasan);

  // Helper HTML breakdown untuk MC & EL (tiada CF). prefix: 'mc'|'el'.
  const _leaveBreakdownHTML = (prefix, typeId, title, annualDefault, accent) => {
    const sys = _modalSysUsed(typeId);
    const ann = (staff['ent_' + typeId] !== undefined && staff['ent_' + typeId] !== null) ? parseFloat(staff['ent_' + typeId]) : annualDefault;
    const pre = parseFloat(staff[prefix + '_used_pre'] || 0);
    const sysAdj = parseFloat(staff[prefix + '_used_sys_adj'] || 0);
    const pel = parseFloat(staff[prefix + '_pelarasan'] || 0);
    const bal = Math.max(0, ann - pre - (autoSystemUsage ? sys : sysAdj) - pel);
    return `
      <div style="margin-top:1.75rem;padding-top:1.5rem;border-top:1px solid rgba(163,177,198,0.15);">
        <div style="font-size: 0.7rem; text-transform: uppercase; color: ${accent}; font-weight: 700; letter-spacing: 1px; margin-bottom: 1rem;">${title} — Peruntukan & Baki</div>
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 1.25rem;">
          <div style="display: flex; flex-direction: column;">
            <label style="font-size: 0.75rem; margin-bottom: 0.5rem; color: var(--text-muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Peruntukan Setahun</label>
            <input type="number" id="ent-${typeId}" class="neu-inset" min="0" step="0.5" value="${ann}" oninput="window._recalcLeaveBalance('${prefix}')" style="border-left: 3px solid ${accent};">
          </div>
          <div style="display: flex; flex-direction: column;">
            <label style="font-size: 0.75rem; margin-bottom: 0.5rem; color: #0ea5e9; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">Guna Sebelum Sistem</label>
            <input type="number" id="${prefix}-used-pre-input" class="neu-inset" min="0" step="0.5" value="${pre}" oninput="window._recalcLeaveBalance('${prefix}')" style="border-left: 3px solid #0ea5e9;">
            <span style="font-size: 0.68rem; color: var(--text-muted); margin-top: 0.35rem;">Rekod guna sebelum sistem</span>
          </div>
          ${_sysUsageFieldsHTML(prefix, sys, sysAdj)}
          <div style="display: flex; flex-direction: column;">
            <label style="font-size: 0.75rem; margin-bottom: 0.5rem; color: #f59e0b; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">Pelarasan HR</label>
            <input type="number" id="${prefix}-pelarasan-input" class="neu-inset" min="0" step="0.5" value="${pel}" oninput="window._recalcLeaveBalance('${prefix}')" style="border-left: 3px solid #f59e0b;">
            <span style="font-size: 0.68rem; color: var(--text-muted); margin-top: 0.35rem;">Potongan pembetulan HR</span>
          </div>
          <div style="display: flex; flex-direction: column; grid-column: span 2;">
            <label style="font-size: 0.75rem; margin-bottom: 0.5rem; color: #10b981; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">Baki ${typeId} Sebenar</label>
            <input type="number" id="${prefix}-balance-display" class="neu-inset" disabled value="${bal.toFixed(1)}" style="border-left: 3px solid #10b981; font-weight:800; color:#10b981; opacity:1; cursor:default;">
            <span style="font-size: 0.68rem; color: var(--text-muted); margin-top: 0.35rem;">Peruntukan − Guna Sebelum − Guna Sistem − Pelarasan HR</span>
          </div>
        </div>
      </div>`;
  };

  return `
    <div class="modal-overlay" id="modal-backdrop">
      <div class="glass-card modal-content fade-in" style="padding: 2.5rem; max-height: 90vh; overflow-y: auto;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
            <h2>Kemaskini Profil & Baki Cuti</h2>
            <button id="close-modal" style="background: transparent; color: var(--text-muted); border: none; cursor: pointer; font-size: 2rem; line-height: 1;">&times;</button>
        </div>
        
        <div style="margin-bottom: 2.5rem; padding: 1rem 1.5rem; border-radius: 12px; background: rgba(59, 130, 246, 0.1); border-left: 4px solid var(--primary);">
            <strong style="font-size: 1.1rem;">${staff.name}</strong><br>
            <span style="font-size: 0.85rem; color: var(--text-muted);">IC: ${staff.ic}</span>
        </div>
        
        <form id="edit-entitlement-form">
          <div style="margin-bottom: 3rem; display: flex; flex-direction: column; gap: 1.5rem;">
              <div style="display: flex; flex-direction: column;">
                 <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 0.5rem;">
                     <label style="font-size: 0.75rem; text-transform: uppercase; color: var(--text-muted); font-weight: 600; letter-spacing: 0.5px;">Service Start Date</label>
                     <span style="background: rgba(59, 130, 246, 0.1); color: var(--primary); padding: 0.25rem 0.75rem; border-radius: 20px; font-size: 0.75rem; font-weight: 600; display: flex; align-items: center; gap: 0.5rem;">
                         <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
                         <span id="years-badge-text">${serviceDurationText} BERKHIDMAT</span>
                     </span>
                 </div>
                 <input type="date" id="edit-start-date" oninput="window.calculateYears(this.value)" class="neu-inset" value="${staff.startDate}" style="color-scheme: light;">
              </div>

              <div style="display: flex; flex-direction: column;">
                 <label style="font-size: 0.75rem; text-transform: uppercase; color: var(--text-muted); font-weight: 600; margin-bottom: 0.5rem; letter-spacing: 0.5px;">Assigned Branch</label>
                 <select class="neu-inset" style="appearance: none; cursor: pointer;">
                     ${branches.map(b => `<option value="${b.name}" ${staff.branch === b.name ? 'selected' : ''}>${b.name}</option>`).join('')}
                 </select>
              </div>

              <div style="display: flex; flex-direction: column;">
                 <label style="font-size: 0.75rem; text-transform: uppercase; color: var(--text-muted); font-weight: 600; margin-bottom: 0.5rem; letter-spacing: 0.5px;">Phone Number (WhatsApp)</label>
                 <input type="text" id="edit-phone" class="neu-inset" value="${staff.phone || ''}" placeholder="Cth: 60123456789">
              </div>
              
              <div style="display: flex; flex-direction: column;">
                 <label style="font-size: 0.75rem; text-transform: uppercase; color: var(--text-muted); font-weight: 600; margin-bottom: 0.5rem; letter-spacing: 0.5px;">Kategori Staff</label>
                 <select class="neu-inset" style="appearance: none; cursor: pointer; color-scheme: light; font-weight: 600;">
                     ${window.staffConfig.staffCategories.map(cat => `<option value="${cat}" ${staff.category === cat ? 'selected' : ''}>${cat}</option>`).join('')}
                     <option value="Super Admin" ${staff.category === 'Super Admin' ? 'selected' : ''}>Super Admin</option>
                 </select>
              </div>

              <div style="display: flex; flex-direction: column;">
                 <label style="font-size: 0.75rem; text-transform: uppercase; color: var(--text-muted); font-weight: 600; margin-bottom: 0.5rem; letter-spacing: 0.5px;">System Role</label>
                 <select class="neu-inset" style="appearance: none; cursor: pointer; color-scheme: light; font-weight: 600;">
                     ${Object.keys(window.rbacMatrix).map(k => `<option value="${k}" ${staff.role === k ? 'selected' : ''}>${window.staffConfig.roleLabels[k] || k}</option>`).join('')}
                 </select>
              </div>

              <div style="display: flex; flex-direction: column;">
                 <label style="font-size: 0.75rem; text-transform: uppercase; color: var(--text-muted); font-weight: 600; margin-bottom: 0.5rem; letter-spacing: 0.5px;">Account Status</label>
                 <select id="edit-status" class="neu-inset" style="appearance: none; cursor: pointer; color: ${staff.inactive ? 'var(--danger)' : 'var(--accent)'}; font-weight: 600;">
                     <option value="active" ${!staff.inactive ? 'selected' : ''}>Berkhidmat (Aktif)</option>
                     <option value="inactive" ${staff.inactive ? 'selected' : ''}>Telah Berhenti (Tidak Aktif)</option>
                 </select>
              </div>

              <div style="display: flex; flex-direction: column;">
                 <label style="font-size: 0.75rem; text-transform: uppercase; color: var(--text-muted); font-weight: 600; margin-bottom: 0.5rem; letter-spacing: 0.5px;">Account Password</label>
                 <input type="text" id="edit-password" class="neu-inset" value="" placeholder="Biarkan kosong jika tidak menukar kata laluan">
              </div>
          </div>

          
          <div style="display: flex; flex-direction: column; background: rgba(59, 130, 246, 0.05); padding: 1rem; border-radius: 8px; border-left: 4px solid var(--accent); margin-top: 1rem;">
             <label style="display: flex; align-items: flex-start; gap: 0.75rem; cursor: pointer; margin: 0;">
                <input type="checkbox" id="edit-apply-prorate" ${staff.apply_prorate !== false ? 'checked' : ''} style="margin-top: 0.15rem; width: 1.25rem; height: 1.25rem; accent-color: var(--primary);">
                <div style="display: flex; flex-direction: column;">
                    <span style="font-size: 0.85rem; font-weight: 700; color: var(--text);">Gunakan Kiraan Pro-Rata untuk Cuti Tahunan (AL) Sahaja</span>
                    <span style="font-size: 0.7rem; color: var(--text-muted); line-height: 1.4; margin-top: 0.25rem;">Jika di-tick, baki AL dikira mengikut bulan bekerja (pro-rata). Jika di-untick, staf mendapat baki AL penuh serta-merta. Cuti lain (MC, HL, CME dll) sentiasa penuh tanpa pro-rata.</span>
                </div>
             </label>
          </div>
          
          <!-- Seksyen AL: Baki Tahun Lepas + Peruntukan Tahun Ini + Jumlah -->
          <div style="border-top: 1px solid rgba(163,177,198,0.25); padding-top: 2rem; margin-top: 1.5rem; margin-bottom: 1.5rem;">
            <div style="font-size: 0.7rem; text-transform: uppercase; color: var(--primary); font-weight: 700; letter-spacing: 1px; margin-bottom: 1rem; display: flex; align-items: center; gap: 0.5rem;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              Cuti Tahunan (AL) — Peruntukan & Baki
            </div>
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.5rem;">
              <div style="display: flex; flex-direction: column;">
                <label style="font-size: 0.75rem; margin-bottom: 0.5rem; color: var(--text-muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Baki AL Tahun Lepas (Dibawa)</label>
                <input type="number" id="ent-CF" class="neu-inset" min="0" max="3"
                  value="${staff.ent_CF !== undefined ? staff.ent_CF : 0}"
                  oninput="if(this.value>3){this.value=3;} window._updateAlTotal();"
                  style="border-left: 3px solid #64748b;">
                <span style="font-size: 0.68rem; color: var(--text-muted); margin-top: 0.35rem;">Maksimum 3 hari sahaja</span>
              </div>
              <div style="display: flex; flex-direction: column;">
                <label style="font-size: 0.75rem; margin-bottom: 0.5rem; color: var(--text-muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">AL Diperuntukkan Tahun Ini</label>
                <input type="number" id="ent-AL" class="neu-inset" min="0"
                  value="${staff.ent_AL !== undefined ? staff.ent_AL : window.getEntitlementAL(staff)}"
                  oninput="window._updateAlTotal();"
                  style="border-left: 3px solid var(--primary);">
              </div>
              <div style="display: flex; flex-direction: column;">
                <label style="font-size: 0.75rem; margin-bottom: 0.5rem; color: var(--accent); font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">Jumlah AL Terkini</label>
                <input type="number" id="al-total-display" class="neu-inset" disabled
                  value="${(staff.ent_CF !== undefined ? staff.ent_CF : 0) + (staff.ent_AL !== undefined ? staff.ent_AL : window.getEntitlementAL(staff))}"
                  style="border-left: 3px solid var(--accent); font-weight: 800; color: var(--accent); opacity: 1; cursor: default;">
                <span style="font-size: 0.68rem; color: var(--text-muted); margin-top: 0.35rem;">Baki Tahun Lepas + Peruntukan Tahun Ini</span>
              </div>
            </div>

            <!-- Baris 2: Potongan & baki sebenar (Formula B) -->
            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 1.25rem; margin-top: 1.25rem; padding-top: 1.25rem; border-top: 1px dashed rgba(163,177,198,0.2);">
              <div style="display: flex; flex-direction: column;">
                <label style="font-size: 0.75rem; margin-bottom: 0.5rem; color: #0ea5e9; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">Guna Sebelum Sistem</label>
                <input type="number" id="al-used-pre-input" class="neu-inset" min="0" step="0.5"
                  value="${_modalAlUsedPre}"
                  oninput="window._recalcLeaveBalance('al')"
                  style="border-left: 3px solid #0ea5e9;">
                <span style="font-size: 0.68rem; color: var(--text-muted); margin-top: 0.35rem;">Rekod AL yang digunakan sebelum sistem</span>
              </div>
              ${_sysUsageFieldsHTML('al', _modalSysUsedAL, _modalAlUsedSysAdj)}
              <div style="display: flex; flex-direction: column;">
                <label style="font-size: 0.75rem; margin-bottom: 0.5rem; color: #f59e0b; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">Pelarasan HR</label>
                <input type="number" id="al-pelarasan-input" class="neu-inset" min="0" step="0.5"
                  value="${_modalAlPelarasan}"
                  oninput="window._recalcLeaveBalance('al')"
                  style="border-left: 3px solid #f59e0b;">
                <span style="font-size: 0.68rem; color: var(--text-muted); margin-top: 0.35rem;">Potongan pembetulan HR</span>
              </div>
              <div style="display: flex; flex-direction: column;">
                <label style="font-size: 0.75rem; margin-bottom: 0.5rem; color: #10b981; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">Baki AL Sebenar</label>
                <input type="number" id="al-balance-display" class="neu-inset" disabled
                  value="${_modalAlBalance.toFixed(1)}"
                  style="border-left: 3px solid #10b981; font-weight: 800; color: #10b981; opacity: 1; cursor: default;">
                <span style="font-size: 0.68rem; color: var(--text-muted); margin-top: 0.35rem;">Jumlah − Guna Sebelum − Guna Sistem − Pelarasan HR</span>
              </div>
            </div>
          </div>

          ${_leaveBreakdownHTML('mc', 'MC', 'MC — Cuti Sakit', window.getEntitlementMC(staff), '#10b981')}
          ${_leaveBreakdownHTML('el', 'EL', 'EL — Cuti Ehsan', 3, '#f59e0b')}

          <!-- Grid cuti lain (AL/MC/EL ada breakdown sendiri di atas) -->
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1.5rem 2rem; border-top: 1px solid rgba(163,177,198,0.15); padding-top: 1.5rem;">
             <div style="display: flex; flex-direction: column;">
               <label style="font-size: 0.85rem; margin-bottom: 0.5rem; color: var(--text-muted); font-weight: 500;">HL &mdash; Cuti Hospitalisasi</label>
               <input type="number" id="ent-HL" class="neu-inset" value="${staff.ent_HL !== undefined ? staff.ent_HL : 60}">
            </div>
            <div style="display: flex; flex-direction: column;">
               <label style="font-size: 0.85rem; margin-bottom: 0.5rem; color: var(--text-muted); font-weight: 500;">ML &mdash; Cuti Bersalin</label>
               <input type="number" id="ent-ML" class="neu-inset" value="${staff.ent_ML !== undefined ? staff.ent_ML : 98}">
            </div>
            <div style="display: flex; flex-direction: column;">
               <label style="font-size: 0.85rem; margin-bottom: 0.5rem; color: var(--text-muted); font-weight: 500;">PL &mdash; Cuti Isteri Bersalin</label>
               <input type="number" id="ent-PL" class="neu-inset" value="${staff.ent_PL !== undefined ? staff.ent_PL : 7}">
            </div>
            <div style="display: flex; flex-direction: column;">
               <label style="font-size: 0.85rem; margin-bottom: 0.5rem; color: var(--text-muted); font-weight: 500;">EL &mdash; Cuti Kecemasan</label>
               <input type="number" id="ent-EL_EMG" class="neu-inset" value="${staff.ent_EL_EMG !== undefined ? staff.ent_EL_EMG : 0}">
            </div>
            <div style="display: flex; flex-direction: column;">
               <label style="font-size: 0.85rem; margin-bottom: 0.5rem; color: var(--text-muted); font-weight: 500;">UL &mdash; Tanpa Gaji</label>
               <input type="number" id="ent-UP" class="neu-inset" value="${staff.ent_UP !== undefined ? staff.ent_UP : 0}">
            </div>
            <div style="display: flex; flex-direction: column;">
               <label style="font-size: 0.85rem; margin-bottom: 0.5rem; color: var(--text-muted); font-weight: 500;">CME &mdash; Cuti Pendidikan Perubatan</label>
               <input type="number" id="ent-CME" class="neu-inset" value="${staff.ent_CME !== undefined ? staff.ent_CME : 0}">
            </div>
          </div>

          
          <div style="margin-top: 3rem;">
            <button type="submit" class="btn-primary" style="width: 100%; display: flex; align-items: center; justify-content: center; gap: 0.5rem; padding: 1rem; border-radius: 12px;">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
                Commit Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  `;
}

// Initial render
render();

function renderLeaveModal() {
    if (!editingLeaveId) return '';
    const record = leaveRecords.find(r => r.id === editingLeaveId);
    if (!record) return '';
    const isAdminEditor = ['admin', 'hr', 'super_admin'].includes(user.role);

    return `
    <div class="modal-overlay" id="leave-modal-backdrop">
      <div class="glass-card modal-content fade-in" style="padding: 2.5rem; max-width: 500px;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 2rem;">
            <div>
              <h2 style="margin-bottom: 0.5rem; font-size: 1.5rem;">Edit Leave Application</h2>
              <div style="display: flex; align-items: center; gap: 0.5rem; color: var(--text-muted); font-size: 0.75rem; text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
                  System Record Correction
              </div>
            </div>
            <button id="close-leave-modal" style="background: transparent; color: var(--text-muted); border: none; cursor: pointer;"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg></button>
        </div>
        
        <form id="edit-leave-form">
          <div style="margin-bottom: 1.5rem;">
             <label style="font-size: 0.65rem; text-transform: uppercase; color: var(--text-muted); font-weight: 700; margin-bottom: 0.5rem; display: block; letter-spacing: 0.5px;">Staff Member</label>
             <input type="text" class="neu-inset" value="${record.name}" disabled style="opacity: 0.6; cursor: not-allowed; font-weight: 600; padding: 1rem;">
          </div>
          
          <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1rem; margin-bottom: 0.5rem;">
              <div>
                 <label style="font-size: 0.85rem; color: var(--text-muted); font-weight: 600; margin-bottom: 0.5rem; display: block;">Start Date</label>
                 <input type="date" id="el-start" class="neu-inset" value="${record.startDate}" onchange="window.recalcEditLeaveDays()" style="color-scheme: light;">
              </div>
              <div>
                 <label style="font-size: 0.85rem; color: var(--text-muted); font-weight: 600; margin-bottom: 0.5rem; display: block;">End Date</label>
                 <input type="date" id="el-end" class="neu-inset" value="${record.endDate}" onchange="window.recalcEditLeaveDays()" style="color-scheme: light;">
              </div>
              <div>
                 <label style="font-size: 0.85rem; color: var(--text-muted); font-weight: 600; margin-bottom: 0.5rem; display: block;">Bilangan Hari</label>
                 <input type="number" id="el-days" class="neu-inset" value="${record.days}" min="0.5" step="0.5" style="color-scheme: light;">
              </div>
          </div>
          <div style="font-size: 0.7rem; color: var(--text-muted); margin-bottom: 1.5rem;">Bilangan hari dikira automatik dari tarikh — boleh ditindih manual (cth. separuh hari 0.5).</div>
          
          <div style="margin-bottom: 1.5rem;">
             <label style="font-size: 0.85rem; color: var(--text-muted); font-weight: 600; margin-bottom: 0.5rem; display: block;">Reason for leave</label>
             <textarea id="el-reason" class="neu-inset" rows="3">${record.reason}</textarea>
          </div>
          
          ${isAdminEditor ? `
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-bottom: 2.5rem;">
              <div>
                 <label style="font-size: 0.65rem; text-transform: uppercase; color: var(--text-muted); font-weight: 700; margin-bottom: 0.5rem; display: block; letter-spacing: 0.5px;">Category</label>
                 <select id="el-type" class="neu-inset" style="appearance: none; cursor: pointer;">
                     <option value="AL" ${record.type === 'AL' ? 'selected' : ''}>Annual (AL)</option>
                     <option value="CME" ${record.type === 'CME' ? 'selected' : ''}>CME</option>
                     <option value="MC" ${record.type === 'MC' ? 'selected' : ''}>Medical (MC)</option>
                 </select>
              </div>
              <div>
                 <label style="font-size: 0.65rem; text-transform: uppercase; color: var(--text-muted); font-weight: 700; margin-bottom: 0.5rem; display: block; letter-spacing: 0.5px;">Status</label>
                 <select id="el-status" class="neu-inset" style="appearance: none; cursor: pointer;">
                     <option value="PENDING" ${record.status === 'PENDING' ? 'selected' : ''}>Pending</option>
                     <option value="TL APPROVED" ${record.status === 'TL APPROVED' ? 'selected' : ''}>TL Approved (Disokong Team Leader)</option>
                     <option value="HOD APPROVED" ${record.status === 'HOD APPROVED' ? 'selected' : ''}>HOD Approved (Disokong Supervisor)</option>
                     <option value="APPROVED" ${record.status === 'APPROVED' ? 'selected' : ''}>Approved (Diluluskan)</option>
                     <option value="REJECTED" ${record.status === 'REJECTED' ? 'selected' : ''}>Rejected (Ditolak)</option>
                 </select>
              </div>
          </div>` : `
          <div style="background:rgba(234,179,8,0.08);border:1px solid rgba(234,179,8,0.25);border-radius:10px;padding:0.75rem 1rem;margin-bottom:2rem;font-size:0.72rem;color:#b45309;font-weight:600;">
            ⚠️ Menyimpan perubahan akan menetapkan semula status ke <strong>PENDING</strong> dan proses kelulusan akan bermula semula.
          </div>`}
          
          <button type="submit" class="btn-primary" style="width: 100%; display: flex; align-items: center; justify-content: center; gap: 0.5rem; padding: 1rem; border-radius: 12px;">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
              Save Changes
          </button>
        </form>
      </div>
    </div>
    `;
}

function renderSelfProfileModal() {
    if (!showProfileSettings) return '';

    return `
    <div class="modal-overlay" id="profile-modal-backdrop" onclick="if(event.target === this) window.setProfileSettings(false)">
      <div class="glass-card modal-content fade-in" style="background: rgba(243, 244, 246, 0.95); padding: 0; min-width: 500px; max-width: 600px; max-height: 90vh; overflow-y: auto; color: #1f2937;">
         
         <div style="padding: 2rem 2.5rem; border-bottom: 1px solid rgba(0,0,0,0.05); display: flex; justify-content: space-between; align-items: center; position: relative;">
            <h2 style="font-size: 1.25rem; font-weight: 600; color: #1e3a8a; display: flex; align-items: center; gap: 0.5rem; margin: 0;">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                My Profile
            </h2>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="rgba(59, 130, 246, 0.1)" stroke-width="2" style="position: absolute; right: 2rem; top: 1.5rem;"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path><path d="M12 22s-8-4-8-10V5l8-3 8 3v7c0 6-8 10-8 10z"></path></svg>
         </div>

         <form id="edit-self-profile" style="padding: 2.5rem;" onsubmit="window.saveSelfProfile(event)">
            
            <div style="margin-bottom: 1.5rem;">
               <label style="font-size: 0.75rem; color: #6b7280; text-transform: uppercase; font-weight: 700; display: block; margin-bottom: 0.5rem;">Alamat</label>
               <input id="self-address" type="text" value="${(user.address || '').replace(/"/g,'&quot;')}" placeholder="Masukkan alamat anda..." style="width: 100%; padding: 1rem; border-radius: 12px; background: rgba(0,0,0,0.03); border: 1px inset rgba(255,255,255,0.5); outline: none; box-shadow: inset 2px 2px 5px rgba(0,0,0,0.05), inset -2px -2px 5px white; color: #374151; box-sizing: border-box;">
            </div>

            <div style="margin-bottom: 1.5rem;">
               <label style="font-size: 0.75rem; color: #6b7280; text-transform: uppercase; font-weight: 700; display: block; margin-bottom: 0.5rem;">Phone Number</label>
               <input type="text" id="self-phone" value="${user.phone || ''}" placeholder="Cth: 60123456789" style="width: 100%; padding: 1rem; border-radius: 12px; background: rgba(0,0,0,0.03); border: 1px inset rgba(255,255,255,0.5); outline: none; box-shadow: inset 2px 2px 5px rgba(0,0,0,0.05), inset -2px -2px 5px white; color: #374151;">
            </div>

            <div style="margin-bottom: 2rem;">
               <label style="font-size: 0.75rem; color: #f97316; text-transform: uppercase; font-weight: 700; display: flex; align-items: center; gap: 0.25rem; margin-bottom: 0.5rem;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
                  Email Notifikasi &starf; Wajib
               </label>
               <input type="email" id="self-email" placeholder="contoh@email.com" value="${user.email || ''}" required style="width: 100%; padding: 1rem; border-radius: 12px; background: rgba(0,0,0,0.03); border: 1px inset rgba(255,255,255,0.5); outline: none; box-shadow: inset 2px 2px 5px rgba(0,0,0,0.05), inset -2px -2px 5px white; color: #374151; margin-bottom: 0.5rem;">
               <div style="font-size: 0.7rem; color: #f97316;">Email ini digunakan untuk menerima notifikasi kelulusan cuti.</div>
            </div>

            <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 1.5rem; margin-bottom: 2.5rem;">
                <div style="display: flex; align-items: center; gap: 0.5rem; font-weight: 700; color: #166534; font-size: 0.9rem; margin-bottom: 1rem;">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
                    WhatsApp Notifikasi
                </div>
                
                <label style="font-size: 0.75rem; color: #4b5563; text-transform: uppercase; font-weight: 700; display: block; margin-bottom: 0.5rem;">Penerima Notifikasi WhatsApp</label>
                <div style="background: #e6ffed; padding: 1rem; border-radius: 8px; font-size: 0.75rem; font-weight: 600; color: #16a34a; line-height: 1.6;">
                    📱 Notifikasi sentiasa dihantar ke nombor telefon di atas.<br>
                    Sistem menggunakan Fonnte &mdash; tiada setup diperlukan dari pihak anda.
                </div>
            </div>

            <div style="display: flex; gap: 1rem;">
                <button type="button" onclick="window.setProfileSettings(false);" style="flex: 1; padding: 1rem; border-radius: 12px; background: rgba(0,0,0,0.03); border: 1px solid rgba(0,0,0,0.05); color: #ef4444; font-weight: 600; cursor: pointer;">Cancel</button>
                <button type="submit" style="flex: 1; padding: 1rem; border-radius: 12px; background: rgba(0,0,0,0.03); border: 1px solid rgba(0,0,0,0.05); color: #2563eb; font-weight: 600; display: flex; justify-content: center; align-items: center; gap: 0.5rem; cursor: pointer;">
                   <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
                   Save
                </button>
            </div>
         </form>
      </div>
    </div>
    `;
}

function renderAddStaffModal() {
  if (!showAddStaffModal) return '';
  return `
  <div class="modal-overlay" id="add-staff-backdrop" onclick="if(event.target===this)window.closeAddStaff()">
    <div class="glass-card modal-content fade-in" style="background:rgba(30,41,59,0.97);padding:2.5rem;border:1px solid rgba(255,255,255,0.1);max-width:540px;width:100%;max-height:90vh;overflow-y:auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2rem;">
        <h2 style="font-size:1.25rem;">Tambah Staf Baharu</h2>
        <button onclick="window.closeAddStaff()" style="background:transparent;border:none;color:white;font-size:2rem;cursor:pointer;line-height:1;">&times;</button>
      </div>
      <form onsubmit="window.submitAddStaff(event)" style="display:flex;flex-direction:column;gap:1.25rem;">
        <div>
          <label style="font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;font-weight:700;letter-spacing:1px;display:block;margin-bottom:0.4rem;">Nama Penuh <span style="color:var(--danger);">*</span></label>
          <input id="as-name" type="text" class="neu-inset" required placeholder="Cth: AHMAD BIN ALI" style="width:100%;text-transform:uppercase;">
        </div>
        <div>
          <label style="font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;font-weight:700;letter-spacing:1px;display:block;margin-bottom:0.4rem;">No. IC / ID <span style="color:var(--danger);">*</span></label>
          <input id="as-ic" type="text" class="neu-inset" required placeholder="Cth: 900101101234">
        </div>
        <div>
          <label style="font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;font-weight:700;letter-spacing:1px;display:block;margin-bottom:0.4rem;">Cawangan <span style="color:var(--danger);">*</span></label>
          <select id="as-branch" class="neu-inset" required style="appearance:none;cursor:pointer;color-scheme:dark;">
            <option value="">-- Pilih Cawangan --</option>
            ${branches.map(b => `<option value="${b.name}">${b.name}</option>`).join('')}
          </select>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
          <div>
            <label style="font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;font-weight:700;letter-spacing:1px;display:block;margin-bottom:0.4rem;">Kategori</label>
            <select id="as-category" class="neu-inset" style="appearance:none;cursor:pointer;color-scheme:dark;">
              ${window.staffConfig.staffCategories.map(cat => `<option value="${cat}">${cat}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;font-weight:700;letter-spacing:1px;display:block;margin-bottom:0.4rem;">Peranan (Role)</label>
            <select id="as-role" class="neu-inset" style="appearance:none;cursor:pointer;color-scheme:dark;">
              ${Object.keys(window.rbacMatrix).filter(k => k !== 'super_admin').map(k => `<option value="${k}">${window.staffConfig.roleLabels[k] || k}</option>`).join('')}
            </select>
          </div>
        </div>
        <div>
          <label style="font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;font-weight:700;letter-spacing:1px;display:block;margin-bottom:0.4rem;">No. Telefon (WhatsApp)</label>
          <input id="as-phone" type="tel" class="neu-inset" placeholder="Cth: 60123456789">
        </div>
        <div>
          <label style="font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;font-weight:700;letter-spacing:1px;display:block;margin-bottom:0.4rem;">Kata Laluan Awal</label>
          <input id="as-password" type="text" class="neu-inset" placeholder="Kosong = guna No. IC sebagai kata laluan">
          <div style="font-size:0.65rem;color:var(--text-muted);margin-top:0.4rem;">Jika dibiarkan kosong, kata laluan awal adalah No. IC staf.</div>
        </div>
        <div style="display:flex;gap:1rem;margin-top:0.5rem;">
          <button type="button" onclick="window.closeAddStaff()" class="neu-btn" style="flex:1;padding:1rem;color:var(--danger);">Batal</button>
          <button type="submit" class="btn-primary" style="flex:2;padding:1rem;display:flex;align-items:center;justify-content:center;gap:0.5rem;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            Simpan Staf Baharu
          </button>
        </div>
      </form>
    </div>
  </div>
  `;
}

// ── Public Holiday Management ─────────────────────────────────────────────────
window.addHoliday = function(state) {
  publicHolidays[state].push({ date: '', name: '' });
  render();
};
window.deleteHoliday = function(state, idx) {
  publicHolidays[state].splice(idx, 1);
  render();
};
window.updateHolidayField = function(state, idx, field, value) {
  if (publicHolidays[state] && publicHolidays[state][idx] !== undefined) {
    publicHolidays[state][idx][field] = value;
  }
};
window.savePublicHolidays = async function(state) {
  const list = publicHolidays[state];
  for (let i = 0; i < list.length; i++) {
    if (!list[i].date || !list[i].name.trim()) {
      alert('Sila lengkapkan semua tarikh dan nama cuti sebelum menyimpan.');
      return;
    }
  }
  publicHolidays[state] = list.slice().sort((a, b) => a.date.localeCompare(b.date));
  try {
    const payload = {};
    payload[state] = publicHolidays[state];
    await setDoc(doc(db, 'config', 'publicHolidays'), payload, { merge: true });
    alert(`✅ Cuti Umum ${state === 'pahang' ? 'Pahang' : 'Terengganu'} berjaya disimpan!`);
    render();
  } catch(e) {
    console.error('savePublicHolidays error:', e);
    alert('Ralat menyimpan. Sila cuba lagi.');
  }
};

window.printPublicHolidays = function(state) {
  const list = publicHolidays[state] || [];
  const label = state === 'pahang' ? 'Pahang' : 'Terengganu';
  const color = state === 'pahang' ? '#3b82f6' : '#f59e0b';
  const year = list.length ? list[0].date.substring(0, 4) : new Date().getFullYear();
  const DAYS = ['Ahad','Isnin','Selasa','Rabu','Khamis','Jumaat','Sabtu'];
  const rows = list.map((h, i) => {
    const d = new Date(h.date + 'T00:00:00');
    const dayName = DAYS[d.getDay()];
    const dateStr = d.toLocaleDateString('ms-MY', { day:'2-digit', month:'long', year:'numeric' });
    return `<tr style="${i % 2 === 0 ? '' : 'background:#f8fafc;'}">
      <td style="padding:7px 10px;border-bottom:1px solid #e2e8f0;text-align:center;">${i + 1}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #e2e8f0;">${dateStr}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #e2e8f0;">${dayName}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #e2e8f0;font-weight:600;">${h.name}</td>
    </tr>`;
  }).join('');

  const pw = window.open('', '_blank');
  pw.document.write(`<!DOCTYPE html><html lang="ms"><head>
    <meta charset="UTF-8">
    <title>Cuti Umum ${label} ${year}</title>
    <style>
      *{margin:0;padding:0;box-sizing:border-box;}
      body{font-family:Arial,sans-serif;color:#1a1a1a;padding:32px;background:#fff;}
      .watermark{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:380px;opacity:0.07;pointer-events:none;z-index:0;print-color-adjust:exact;-webkit-print-color-adjust:exact;}
      .header{display:flex;align-items:center;gap:16px;border-bottom:3px solid ${color};padding-bottom:14px;margin-bottom:20px;}
      .logo{width:56px;height:56px;border-radius:10px;object-fit:contain;}
      .header-text h1{font-size:15px;font-weight:800;color:${color};text-transform:uppercase;letter-spacing:1px;}
      .header-text h2{font-size:13px;color:#555;margin-top:2px;}
      .header-text p{font-size:11px;color:#888;margin-top:2px;}
      .badge{display:inline-block;background:${color}22;color:${color};font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;border:1px solid ${color}44;margin-top:6px;}
      table{width:100%;border-collapse:collapse;margin-top:10px;font-size:12px;}
      thead tr{background:${color};color:#fff;}
      th{padding:9px 10px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;}
      th:first-child{width:42px;text-align:center;}
      .footer{margin-top:28px;display:flex;justify-content:space-between;align-items:flex-end;border-top:1px solid #ddd;padding-top:14px;}
      .sign-box{text-align:center;width:180px;}
      .sign-box .line{border-top:1px solid #333;margin-bottom:6px;height:40px;}
      .sign-box p{font-size:10px;color:#555;}
      .print-btn{margin-bottom:18px;text-align:right;}
      .print-btn button{padding:9px 22px;background:${color};color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:700;font-size:13px;}
      @media print{.print-btn{display:none;} body{padding:20px;}}
    </style>
  </head><body>
    <div class="print-btn"><button onclick="window.print()">🖨️ CETAK / JANA PDF</button></div>
    ${window.printHeaderHTML({ isReport: true, title: 'SENARAI CUTI UMUM ' + String(label).toUpperCase() + ' ' + year, meta: [{ label: 'Negeri', value: label }, { label: 'Bilangan', value: list.length + ' hari cuti umum' }] })}
    <table>
      <thead><tr><th>Bil.</th><th>Tarikh</th><th>Hari</th><th>Nama Cuti Umum</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4" style="padding:14px;text-align:center;color:#888;">Tiada cuti umum ditetapkan.</td></tr>'}</tbody>
    </table>
    <div class="footer">
      <div>
        <p style="font-size:10px;color:#888;">Dicetak: ${new Date().toLocaleString('ms-MY')}</p>
        <p style="font-size:10px;color:#888;">Disediakan oleh: ${user ? user.name : 'HR/Admin'} — KSB Leave System</p>
      </div>
      <div class="sign-box">
        <div class="line"></div>
        <p>Tandatangan HR / Admin</p>
        <p style="margin-top:3px;">Tarikh: _______________</p>
      </div>
    </div>
  </body></html>`);
  pw.document.close();
};

// ── Policy Editor helpers ──
window.updatePolicyNotice = function(val) { policyContent.notice = val; };
window.updatePolicyGlossary = function(i, field, val) { if (policyContent.glossary[i]) policyContent.glossary[i][field] = val; };
window.addPolicyGlossaryRow = function() { policyContent.glossary.push({ code:'', name:'' }); render(); };
window.deletePolicyGlossaryRow = function(i) { policyContent.glossary.splice(i,1); render(); };
window.updateEntitlement = function(section, i, field, val) { if (policyContent[section] && policyContent[section][i]) policyContent[section][i][field] = val; };
window.addEntitlementRow = function(section) { const row = section==='entitlementDoktor' ? {days:''} : {period:'',days:''}; policyContent[section].push(row); render(); };
window.deleteEntitlementRow = function(section, i) { policyContent[section].splice(i,1); render(); };
window.updatePolicyRule = function(section, i, val) { if (policyContent[section]) policyContent[section][i] = val; };
window.addPolicyRule = function(section) { policyContent[section].push(''); render(); };
window.deletePolicyRule = function(section, i) { policyContent[section].splice(i,1); render(); };
window.savePolicySection = async function(section) {
  try {
    const payload = section === 'notice' ? { notice: policyContent.notice } : { [section]: policyContent[section] };
    await setDoc(doc(db, 'config', 'policyContent'), payload, { merge: true });
    const btn = document.getElementById('save-policy-' + section);
    if (btn) { btn.textContent = '✅ Tersimpan'; btn.disabled = true; }
    setTimeout(() => render(), 1200);
  } catch(e) { alert('Ralat menyimpan: ' + e.message); }
};

window.dismissPhoneReminder = function() { showPhoneReminderModal = false; render(); };
window.savePhoneFromReminder = async function() {
  const input = document.getElementById('reminder-phone-input');
  if (!input) return;
  const clean = input.value.trim().replace(/\D/g, '');
  if (!clean) { alert('Sila masukkan nombor telefon.'); return; }
  if (!clean.startsWith('6')) {
    alert('⚠️ Nombor MESTI bermula dengan 6.\n\nContoh: 60171234678\n(bukan 0171234678)');
    return;
  }
  if (clean.length < 10 || clean.length > 12) {
    alert('⚠️ Nombor telefon tidak sah.\n\nContoh: 60171234678');
    return;
  }
  try {
    await updateDoc(doc(db, 'staff', user.ic), { phone: clean });
    user.phone = clean;
    const s = staffList.find(i => i.ic === user.ic);
    if (s) s.phone = clean;
    showPhoneReminderModal = false;
    render();
    alert('✅ Nombor WhatsApp berjaya disimpan! Anda kini akan menerima notifikasi kelulusan cuti.');
  } catch(err) {
    console.error('savePhoneFromReminder error:', err);
    alert('Ralat menyimpan nombor. Sila cuba lagi.');
  }
};

function renderPhoneReminderModal() {
  if (!showPhoneReminderModal || !user) return '';
  const cur = (user.phone || '').replace(/\D/g, '');
  return `
  <div style="position:fixed;inset:0;background:rgba(0,0,0,0.75);backdrop-filter:blur(6px);z-index:99999;display:flex;align-items:center;justify-content:center;padding:1rem;">
    <div class="glass-pane fade-in" style="width:100%;max-width:460px;border-radius:1.75rem;padding:2rem;position:relative;border:2px solid rgba(59,130,246,0.5);box-shadow:0 0 40px rgba(59,130,246,0.25);">
      <div style="display:flex;justify-content:center;margin-bottom:1.25rem;">
        <div style="width:64px;height:64px;border-radius:50%;background:linear-gradient(135deg,#22c55e,#16a34a);display:flex;align-items:center;justify-content:center;box-shadow:0 0 24px rgba(34,197,94,0.5);animation:pulse 2s infinite;">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.44 2 2 0 0 1 3.6 1.27h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.9a16 16 0 0 0 6 6l.92-.92a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21.72 17z"></path></svg>
        </div>
      </div>
      <h2 style="text-align:center;font-size:1.2rem;font-weight:800;color:#22c55e;margin-bottom:0.5rem;">📲 Daftar Nombor WhatsApp Anda</h2>
      <p style="text-align:center;font-size:0.875rem;color:var(--text-muted);line-height:1.6;margin-bottom:1rem;">
        Nombor WhatsApp diperlukan supaya anda boleh menerima<br>
        <strong style="color:var(--text);">notifikasi kelulusan cuti</strong> daripada sistem.
      </p>
      <div style="background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.25);border-radius:0.75rem;padding:0.75rem 1rem;margin-bottom:1.25rem;font-size:0.8rem;color:var(--text-muted);line-height:1.7;">
        <strong style="color:#22c55e;">Format yang betul:</strong><br>
        ✅ <strong>60171234678</strong> &nbsp;←&nbsp; bermula dengan <strong>6</strong><br>
        ❌ <span style="text-decoration:line-through;">0171234678</span> &nbsp;←&nbsp; jangan bermula dengan <strong>0</strong>
      </div>
      <input id="reminder-phone-input" type="tel" inputmode="numeric" class="neu-inset"
        value="${cur}"
        placeholder="Contoh: 60171234678"
        style="width:100%;padding:0.85rem 1rem;border-radius:0.75rem;font-size:1.05rem;letter-spacing:1px;margin-bottom:1rem;box-sizing:border-box;text-align:center;"
        oninput="this.value=this.value.replace(/[^0-9]/g,'')">
      <div style="display:flex;flex-direction:column;gap:0.75rem;">
        <button onclick="window.savePhoneFromReminder()" class="btn-primary" style="width:100%;padding:1rem;font-size:1rem;font-weight:800;display:flex;align-items:center;justify-content:center;gap:0.6rem;background:linear-gradient(135deg,#22c55e,#16a34a);box-shadow:0 8px 24px rgba(34,197,94,0.35);">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
          Simpan Nombor WhatsApp
        </button>
        <button onclick="window.dismissPhoneReminder()" style="width:100%;padding:0.75rem;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);border-radius:12px;color:var(--text-muted);cursor:pointer;font-size:0.82rem;">
          Abaikan buat masa ini
        </button>
      </div>
    </div>
  </div>
  `;
}

window.dismissFirstLoginWarning = function() { showFirstLoginWarning = false; render(); };
window.goChangePassword = function() { showFirstLoginWarning = false; view = 'settings'; render(); };

function renderFirstLoginModal() {
  if (!showFirstLoginWarning) return '';
  return `
  <div style="position:fixed;inset:0;background:rgba(0,0,0,0.75);backdrop-filter:blur(6px);z-index:99999;display:flex;align-items:center;justify-content:center;padding:1rem;">
    <div class="glass-pane fade-in" style="width:100%;max-width:460px;border-radius:1.75rem;padding:2rem;position:relative;border:2px solid rgba(239,68,68,0.5);box-shadow:0 0 40px rgba(239,68,68,0.25);">
      <!-- Pulsing warning icon -->
      <div style="display:flex;justify-content:center;margin-bottom:1.25rem;">
        <div style="width:64px;height:64px;border-radius:50%;background:linear-gradient(135deg,#ef4444,#dc2626);display:flex;align-items:center;justify-content:center;box-shadow:0 0 24px rgba(239,68,68,0.5);animation:pulse 2s infinite;">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
        </div>
      </div>
      <h2 style="text-align:center;font-size:1.25rem;font-weight:800;color:#ef4444;margin-bottom:0.5rem;">⚠️ TUKAR KATA LALUAN SEKARANG!</h2>
      <p style="text-align:center;font-size:0.9rem;color:var(--text-muted);line-height:1.6;margin-bottom:0.5rem;">
        Anda masih menggunakan <strong style="color:var(--text);">kata laluan lalai (No. IC)</strong> yang tidak selamat.<br>
        Sila tukar kata laluan anda <strong style="color:#ef4444;">sebelum menggunakan sistem</strong> ini.
      </p>
      <div style="background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.25);border-radius:0.75rem;padding:0.85rem 1rem;margin-bottom:1.25rem;font-size:0.8rem;color:var(--text-muted);line-height:1.5;">
        <strong style="color:#ef4444;">Kenapa perlu tukar?</strong><br>
        Kata laluan lalai adalah nombor IC anda — sesiapa yang tahu IC anda boleh akses akaun ini. Lindungi maklumat cuti anda dengan kata laluan peribadi.
      </div>
      <div style="display:flex;flex-direction:column;gap:0.75rem;">
        <button onclick="window.goChangePassword()" class="btn-primary" style="width:100%;padding:1rem;font-size:1rem;font-weight:800;display:flex;align-items:center;justify-content:center;gap:0.6rem;background:linear-gradient(135deg,#ef4444,#dc2626);box-shadow:0 8px 24px rgba(239,68,68,0.35);">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
          Tukar Kata Laluan Sekarang
        </button>
        <button onclick="window.dismissFirstLoginWarning()" style="width:100%;padding:0.75rem;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);border-radius:12px;color:var(--text-muted);cursor:pointer;font-size:0.82rem;">
          Abaikan buat masa ini (tidak disyorkan)
        </button>
      </div>
    </div>
  </div>
  `;
}

// ── Service Worker Registration ──────────────────────────────────────────────
if ('serviceWorker' in navigator && !window.__reloadGuardTripped) {
  let _swRefreshing = false;
  let _userWantsUpdate = false; // hanya true selepas staf tekan "Muat Semula"
  // Reload HANYA jika staf yang mencetuskannya melalui butang.
  // Abaikan controllerchange automatik (cth: clients.claim semasa SW dipasang
  // kali pertama / selepas cache dibuang) — itu yang dulu buat app refresh sendiri.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!_userWantsUpdate) return;
    if (_swRefreshing) return;
    _swRefreshing = true;
    window.location.reload();
  });

  // Papar bar "Versi baru tersedia" dengan butang — staf kawal bila nak muat semula
  function showUpdateBanner(worker) {
    if (!worker || document.getElementById('app-update-banner')) return;
    const bar = document.createElement('div');
    bar.id = 'app-update-banner';
    bar.style.cssText = 'position:fixed;left:50%;bottom:1rem;transform:translateX(-50%);z-index:99999;background:#1e293b;color:#fff;padding:0.7rem 1rem;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,0.35);display:flex;align-items:center;gap:0.85rem;font-size:0.85rem;max-width:92vw;';
    bar.innerHTML = '<span>✨ Versi baru tersedia.</span>'
      + '<button id="app-update-btn" style="background:#3b82f6;color:#fff;border:none;padding:0.45rem 0.95rem;border-radius:8px;font-weight:700;cursor:pointer;font-size:0.82rem;white-space:nowrap;">Muat Semula</button>'
      + '<button id="app-update-dismiss" title="Tutup" style="background:transparent;color:#94a3b8;border:none;cursor:pointer;font-size:1.15rem;line-height:1;padding:0 0.2rem;">&times;</button>';
    document.body.appendChild(bar);
    document.getElementById('app-update-btn').onclick = () => { _userWantsUpdate = true; worker.postMessage('SKIP_WAITING'); };
    document.getElementById('app-update-dismiss').onclick = () => bar.remove();
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(reg => {
      // Periksa kemaskini setiap kali app dibuka
      reg.update();
      // Versi baru sudah menunggu sejak sesi lepas → terus tawarkan
      if (reg.waiting && navigator.serviceWorker.controller) showUpdateBanner(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          // SW baru siap dipasang & ada SW lama → tawarkan muat semula (TIDAK paksa)
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateBanner(newWorker);
          }
        });
      });
    }).catch(err => {
      console.warn('SW registration failed:', err);
    });
  });
}
