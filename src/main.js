import './style.css'
import { countLeaveDays, weekendDaysForState } from './leaveDays.js';
import { recordBalances, computeElOverflow, computeEmgOverflow, computeCMEEntitlement, FORMULA_B_TYPES, usesFormulaB, formulaBBalance } from './leaveBalance.js';
import { computeYearEndRollover, buildStaffRolloverPatch, CF_CAP } from './yearEnd.js';
import { deriveLoginBranches } from './loginBranches.js';
import { formatPersonName } from './nameFormat.js';
import { LEAVE_CATEGORIES, LEAVE_TYPE_NAMES, leaveTypeName, leaveTypeName as leaveTypeLabel,
         leaveTypeShort, proofRequirement, hexToRgbTriple, PROOF_REQUIRED_TYPES } from './leaveTypes.js';
import { ALL as SCOPE_ALL, NO_BRANCH, visibleStates, branchOptions, filterByScope } from './masterLogScope.js';
import { findOverlappingLeaves, overlapsOtherLeaves, describeOverlaps,
         findApprovedOverlaps, findOverlapGroups } from './leaveOverlap.js';
import { normalizePhone, isValidPhone } from './phoneFormat.js';
import { deriveRolePermissions, changedRoles, claimsFor } from './rolePermissions.js';
import { canEditHolidayState } from './holidayAccess.js';
import { canSeeAuditLogs, canSeeRegistrations, listenerScope, canSeeWaLogs, STAFF_APPROVER_ROLES } from './listenerScope.js';
import { getNoticeDays, isNoticeExempt } from './leaveNotice.js';
import { validateLeaveReason } from './leaveReason.js';
import { showToast, showConfirm, restorePendingToasts } from './notify.js';
import { statusBadge } from './statusBadge.js';
import { emptyState, emptyRow, dashboardSkeleton, userAvatar } from './uiStates.js';
import { trendWindow } from './monthTrend.js';
import { monthGrid, leavesByDay, shiftMonth, monthLabel } from './leaveCalendar.js';
import { relativeTime, groupNotifs, filterNotifs, notifKind, notifSender, senderInitials, cleanSubject, fullTime } from './inboxView.js';
// Satu sumber versi: package.json (dulu ditulis tangan di topbar & log — mudah terlupa naikkan).
import { version as APP_VERSION } from '../package.json';
import { Chart, registerables } from 'chart.js';
Chart.register(...registerables);

// Toast/dialog menggantikan alert()/confirm() — didedahkan pada window untuk onclick inline.
window.showToast = showToast;
window.showConfirm = showConfirm;
restorePendingToasts();

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
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
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
  arrayUnion,
  query,
  where,
  orderBy,
  limit,
  documentId,
  serverTimestamp
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

// Cache kekal (IndexedDB), bukan cache dalam-memori lalai. Tanpa ini, setiap
// page-load membaca semula SETIAP dokumen bagi setiap pendengar dari server —
// staff (119) + leaves (116) + branches + registration_requests pada setiap
// refresh, bagi setiap pengguna. Dengan cache kekal, pendengar menyambung dari
// cakera dan hanya dokumen yang BERUBAH sejak sinkronisasi terakhir dibayar.
// Ini penting kerana projek berada di pelan Spark (50k bacaan/hari).
//
// persistentMultipleTabManager: staf memang membuka app dalam beberapa tab;
// tanpa ia, hanya satu tab dapat cache kekal dan yang lain gagal senyap.
let db;
try {
  db = initializeFirestore(firebaseApp, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
} catch (e) {
  // Pelayar tanpa IndexedDB (cth. mod privasi ketat) — jangan halang app.
  console.warn('Cache kekal Firestore tidak tersedia, guna cache memori:', e);
  db = getFirestore(firebaseApp);
}
const auth = getAuth(firebaseApp);
const analytics = getAnalytics(firebaseApp);
const functions = getFunctions(firebaseApp);

// Cloudinary — hos bukti cuti (MC / Kecemasan / Ehsan). Firebase Storage TIDAK
// diaktifkan untuk projek ni (perlu Blaze), jadi bukti dimuat naik ke Cloudinary
// melalui "unsigned upload" (tiada backend/rahsia perlu — preset selamat didedah).
const CLOUDINARY_CLOUD_NAME = 'dgm3fozmu';
const CLOUDINARY_UPLOAD_PRESET = 'l1mrxwdx';

// ── Semakan & mesej ralat muat naik fail (dikongsi oleh SEMUA tempat muat naik:
// bukti cuti di borang mohon cuti, "muat naik semula bukti" di Master Logs, dan
// gambar profil di Tetapan) ──
// Dulu semua kegagalan dilaporkan sebagai "Gagal memuat naik… semak sambungan
// internet", jadi staf tidak tahu fail mereka terlalu besar atau salah format.
// Sekarang setiap punca diberitahu dengan jelas.
const PROOF_RULES = {
  maxMB: 10, // had Cloudinary free tier
  exts: ['jpg', 'jpeg', 'png', 'pdf'],
  mimes: ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'],
  formatsText: 'JPG, PNG atau PDF',
  subject: 'fail bukti',
};
// Gambar profil: tiada PDF; HEIC ditolak kerana URL .heic tidak dipaparkan di kebanyakan pelayar.
const PHOTO_RULES = {
  maxMB: 5,
  exts: ['jpg', 'jpeg', 'png', 'webp'],
  mimes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
  formatsText: 'JPG, PNG atau WEBP',
  subject: 'gambar profil',
};
const PROOF_ACCEPT = PROOF_RULES.mimes.join(',');
const PHOTO_ACCEPT = PHOTO_RULES.mimes.join(',');

const formatFileSize = (bytes) => (bytes / (1024 * 1024)).toFixed(1) + 'MB';

const fileTooLargeMessage = (sizeText, rules) =>
  '🔴 SAIZ FAIL TERLALU BESAR\n\n' +
  (sizeText ? 'Saiz fail anda: ' + sizeText + '\n' : '') +
  'Had maksimum: ' + rules.maxMB + 'MB\n\n' +
  'Sila kecilkan fail, atau ambil tangkap layar (screenshot) dan muat naik gambar itu.';

const fileBadFormatMessage = (fileName, reasonLine, rules) =>
  '🔴 FORMAT FAIL TIDAK SAH\n\n' +
  (fileName ? 'Fail: ' + fileName + '\n' : '') +
  (reasonLine ? reasonLine + '\n' : '') +
  'Format yang diterima: ' + rules.formatsText + ' sahaja.\n\n' +
  'Jika ini gambar HEIC (iPhone) atau jenis fail lain, sila ambil tangkap layar (screenshot) dan muat naik gambar itu.';

// Semak fail SEBELUM dimuat naik. Pulangkan mesej ralat, atau null jika fail OK.
const validateUploadFile = (file, rules) => {
  if (!file) return null;
  const ext = (String(file.name || '').split('.').pop() || '').toLowerCase();
  const mime = String(file.type || '').toLowerCase();
  // Sesetengah telefon Android hantar MIME kosong — terima jika sambungan nama fail betul.
  const okType = rules.mimes.includes(mime)
              || ((!mime || mime === 'application/octet-stream') && rules.exts.includes(ext));
  if (!okType) return fileBadFormatMessage(file.name, ext ? 'Jenis fail: .' + ext.toUpperCase() : '', rules);
  if (file.size === 0) return fileBadFormatMessage(file.name, 'Fail kosong (0 bait) — fail mungkin rosak atau belum dimuat turun ke telefon.', rules);
  if (file.size > rules.maxMB * 1024 * 1024) return fileTooLargeMessage(formatFileSize(file.size), rules);
  return null;
};
const validateProofFile = (file) => validateUploadFile(file, PROOF_RULES);

// Mesej bila muat naik ke Cloudinary GAGAL. Ralat asal dilampirkan supaya admin
// boleh kesan punca dari tangkap layar staf.
const uploadErrorMessage = (err, rules) => {
  const raw = String((err && err.message) || err || '');
  if (/too large|file size/i.test(raw)) return fileTooLargeMessage('', rules) + '\n\n(Butiran: ' + raw + ')';
  if (/invalid image file|unsupported|format|invalid pdf/i.test(raw)) {
    return fileBadFormatMessage('', 'Fail tidak dapat dibaca — fail mungkin rosak, atau PDF dikunci dengan kata laluan.', rules) +
           '\n\n(Butiran: ' + raw + ')';
  }
  if (/failed to fetch|network|load failed|notreadable|could not be read/i.test(raw)) {
    return '🔴 FAIL TIDAK DAPAT DIHANTAR\n\n' +
           'Sambungan internet terputus, ATAU fail dipilih terus dari Google Drive / WhatsApp. ' +
           'Simpan (download) fail ke telefon dahulu, kemudian pilih semula.\n\n(Butiran: ' + raw + ')';
  }
  return '🔴 Gagal memuat naik ' + rules.subject + '. Sila cuba lagi.' + (raw ? '\n\n(Butiran: ' + raw + ')' : '');
};
const proofUploadErrorMessage = (err) => uploadErrorMessage(err, PROOF_RULES);
const AUTH_EMAIL_DOMAIN = 'ksb-leave.local';
const emailForIC = (ic) => `${String(ic).replace(/[^a-zA-Z0-9]/g, '')}@${AUTH_EMAIL_DOMAIN}`;

// Base URL of the free (no-Blaze) WhatsApp OTP password-reset backend on Vercel.
// Set this to the deployed Vercel URL (e.g. 'https://ksb-otp.vercel.app').
// While empty, "Lupa Kata Laluan?" tells the user the feature isn't configured yet.
const OTP_API_BASE = 'https://otp-backend-ochre.vercel.app';

// Pre-login directory (branch + name + ic) loaded under the anonymous bootstrap session.
//
// Dicache dalam localStorage selama DIRECTORY_CACHE_TTL. Skrin log masuk membaca
// seluruh koleksi (~120 dokumen) setiap kali dibuka — dan di PC kaunter yang
// dikongsi, setiap log keluar (reload) membuka skrin itu semula untuk staf
// seterusnya. Senarai ini jarang berubah, jadi cache menjimatkan hampir semua
// bacaan itu. Data yang sama sudah pun disimpan dalam IndexedDB oleh
// persistentLocalCache, jadi tiada pendedahan baharu pada peranti.
//
// Staf baru yang belum ada dalam cache: pautan "Muat semula senarai" dan semakan
// semula automatik bila nama ditaip tidak dijumpai (pengendali #login-form) —
// jadi cache lapuk tidak pernah mengunci sesiapa di luar.
const DIRECTORY_CACHE_KEY = 'ksb_directory_cache';
const DIRECTORY_CACHE_TTL = 6 * 60 * 60 * 1000;
let directoryList = [];
async function loadDirectory({ force = false } = {}) {
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(DIRECTORY_CACHE_KEY) || 'null'); } catch (e) { cached = null; }
  const cacheOk = cached && Array.isArray(cached.list) && cached.list.length > 0;
  if (!force && cacheOk && Date.now() - cached.ts < DIRECTORY_CACHE_TTL) {
    directoryList = cached.list;
    return;
  }
  try {
    const snap = await getDocs(collection(db, 'directory'));
    directoryList = snap.docs.map(d => d.data()).filter(s => !s.inactive);
    try { localStorage.setItem(DIRECTORY_CACHE_KEY, JSON.stringify({ ts: Date.now(), list: directoryList })); } catch (e) {}
  } catch (e) {
    console.error('loadDirectory failed:', e);
    // Cth. kuota Spark habis — senarai lapuk lebih baik daripada skrin log masuk kosong.
    directoryList = cacheOk ? cached.list : [];
  }
}
window.refreshLoginDirectory = async function() {
  await loadDirectory({ force: true });
  render();
  showToast('Senarai nama dikemas kini.');
};

const app = document.querySelector('#app')

// ============================================================
// WHATSAPP NOTIFICATION CONFIG (Fonnte.com)
// Daftar di: https://fonnte.com → sambungkan no. 0129444295
// ============================================================
// Satu peranti Fonnte (Free, 1,000 mesej/bulan) per zon, dipilih ikut zon PENERIMA.
// Zon tanpa token sendiri guna token Pahang (token asal). Medan dalam system_config/whatsapp:
const WA_TOKEN_FIELDS = { pahang: 'token', terengganu: 'tokenTerengganu', pharma: 'tokenPharma' };
const WA_ZONE_LABELS = { pahang: 'Pahang (Balok HQ, Utama, Admin)', terengganu: 'Terengganu', pharma: 'KSB Pharma' };
let WA_TOKENS = { pahang: localStorage.getItem('ksb_wa_token') || '', terengganu: '', pharma: '' };
const WHATSAPP_SENDER = '60129444295'; // No. penghantar zon Pahang
const WHATSAPP_ENABLED = () => Object.values(WA_TOKENS).some(Boolean);
// Nombor peranti penghantar Fonnte per zon. Diisi dari /device.
// WhatsApp tak boleh hantar kepada nombornya sendiri — kita guna ini untuk kesan & elak.
let WA_DEVICES = { pahang: '', terengganu: '', pharma: '' };
async function refreshWADevice() {
  await Promise.all(Object.keys(WA_TOKENS).map(async zone => {
    const token = WA_TOKENS[zone];
    if (!token) { WA_DEVICES[zone] = ''; return; }
    try {
      const res = await fetch('https://api.fonnte.com/device', {
        method: 'POST', headers: { 'Authorization': token }
      });
      const d = await res.json();
      if (d && d.device) WA_DEVICES[zone] = String(d.device).replace(/\D/g, '');
    } catch(_) { /* abaikan — guard self-send sekadar lapisan tambahan */ }
  }));
}
// Zon penghantar bagi seorang penerima. Admin/HQ dan penerima tidak dikenali → Pahang.
function waZoneOf(recipient) {
  if (!recipient || ['admin', 'super_admin'].includes(recipient.role)) return 'pahang';
  if (OWN_HR_ZONE[recipient.branch]) return 'pharma';
  if (recipient.role === 'hr') return recipient.hrState === 'Terengganu' ? 'terengganu' : 'pahang';
  return window.scopeStateOfBranch(recipient.branch) === 'Terengganu' ? 'terengganu' : 'pahang';
}

window.sendWhatsApp = async function(toPhone, message, throwOnError = false) {
  if (!WHATSAPP_ENABLED() || !toPhone) return;
  // Mod Test: semua mesej → penguji sahaja. Ditentukan SEGERA (sebelum await pertama)
  // kerana kebanyakan pemanggil tidak menunggu (forEach tanpa await).
  if (testCtx) {
    const _orig = staffList.find(s => (s.phone || '').replace(/\D/g, '').replace(/^0/, '6') === toPhone.replace(/\D/g, '').replace(/^0/, '6'));
    if (!testCtx.phone) return;   // penguji tiada nombor — langkau, jangan sesekali hantar kepada staf sebenar
    message = `🧪 *[UJIAN SISTEM — CUTI TEST]*\n_Mesej ini asalnya untuk: ${_orig ? _orig.name : toPhone}_\n\n` + message;
    toPhone = testCtx.phone;
  }
  let phone = toPhone.replace(/\D/g, '');
  if (phone.startsWith('0')) phone = '6' + phone;

  const recipient = staffList.find(s => (s.phone || '').replace(/\D/g, '').replace(/^0/, '6') === phone);
  const wantZone = waZoneOf(recipient);
  const zone = WA_TOKENS[wantZone] ? wantZone : 'pahang';
  const token = WA_TOKENS[zone];
  const device = WA_DEVICES[zone];
  if (!token) return;
  const logBase = {
    ts: Date.now(),
    phone,
    name: recipient ? recipient.name : phone,
    preview: message.replace(/[*_[\]]/g, '').replace(/\n/g, ' ').trim().substring(0, 120),
    sentBy: (typeof user !== 'undefined' && user) ? user.name : 'System',
    via: zone,
  };

  let logStatus = 'sent', logErr = null;
  try {
    if (device && phone === device) {
      // Target = nombor peranti penghantar Fonnte sendiri. Fonnte akan pulangkan
      // status:true (queue) tetapi WhatsApp TIDAK boleh hantar kepada diri sendiri,
      // jadi mesej tak sampai. Log sebagai gagal supaya jelas, jangan tipu "sent".
      logStatus = 'failed';
      logErr = `Nombor penerima (${phone}) sama dengan nombor peranti penghantar Fonnte — WhatsApp tidak boleh hantar kepada diri sendiri. Guna nombor penghantar berasingan untuk sistem.`;
      if (throwOnError) throw new Error(logErr);
    } else {
      const res = await fetch('https://api.fonnte.com/send', {
        method: 'POST',
        headers: { 'Authorization': token, 'Content-Type': 'application/json' },
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
  if (!await showConfirm('Padam semua log notifikasi WhatsApp? Tindakan ini tidak boleh dibatalkan.')) return;
  try {
    const snap = await getDocs(collection(db, 'wa_logs'));
    if (snap.empty) { showToast('Tiada log untuk dipadam.'); return; }
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
    showToast('✅ Log WhatsApp berjaya dipadam.');
  } catch(e) { showToast('Ralat memadam log: ' + e.message); }
};

window.saveWAToken = async function(zone, token) {
  token = String(token || '').trim();
  WA_TOKENS[zone] = token;
  if (zone === 'pahang') localStorage.setItem('ksb_wa_token', token);
  refreshWADevice(); // kemas kini nombor peranti untuk guard self-send
  try {
    // merge — jangan padam token zon lain.
    await setDoc(doc(db, 'system_config', 'whatsapp'), { [WA_TOKEN_FIELDS[zone]]: token }, { merge: true });
  } catch(e) {
    console.warn('Failed to save WA token to Firestore:', e);
  }
  showToast(`✅ Token WhatsApp ${WA_ZONE_LABELS[zone]} berjaya disimpan!`);
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
  if (!ic) { showToast('Sila pilih nama anda dari senarai (dropdown) dahulu, kemudian tekan "Lupa Kata Laluan?".'); return; }
  if (!OTP_API_BASE) {
    showToast('ℹ️ Set semula kata laluan sendiri belum diaktifkan. Sila hubungi HR/Admin untuk reset kata laluan anda.');
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
          showToast('✅ Kata laluan anda telah ditetapkan semula. Sila log masuk dengan kata laluan baharu.');
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
  if (!phone) return showToast('Sila masukkan nombor telefon untuk ujian.');
  if (!WHATSAPP_ENABLED()) return showToast('Sila simpan token Fonnte dahulu.');
  await window.sendWhatsApp(phone, `✅ *Ujian Notifikasi KSB Leave Apply*\n\nSistem notifikasi WhatsApp berfungsi dengan baik.\n\n\n🔗 *Log masuk:* https://cuti-staff.ksbsb.com.my\n_— KSB Leave System_`);
  showToast('Mesej ujian telah dihantar ke ' + phone);
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
  } catch(e) { showToast('Ralat menyimpan: ' + e.message); }
};

// ============================================================
// PENGINGAT KELULUSAN TERTANGGUH (7 hari)
// ============================================================
// ── Peringatan cuti tertangguh (overdue reminders) ──────────────────────────
// Kini dikendalikan di SERVER, bukan di browser. Vercel Cron (otp-backend/
// api/check-reminders.js) hantar peringatan WhatsApp harian (9 pagi MYT) untuk
// permohonan tertangguh >= 3 hari — tak lagi bergantung pada sesi browser yang
// dibuka. Fungsi startReminderScheduler/checkOverduePendingReminders lama telah
// dibuang. Lihat docs/superpowers/specs/2026-07-07-server-side-leave-reminders-design.md
function startReminderScheduler() { /* moved to server cron */ }
function stopReminderScheduler()  { /* moved to server cron */ }

// State
let user = null;
let currentSessionId = null;
let sessionUnsubscribe = null;
let duplicateSessionDetected = false;
// Kunci hantar borang cuti. Muat naik bukti ke Cloudinary ambil beberapa saat;
// tanpa kunci ini, klik kedua menjalankan semula seluruh handler dan menulis
// rekod kedua. Semakan pertindihan TIDAK dapat menangkapnya — kedua-dua larian
// membaca leaveRecords yang sama, sebelum mana-mana tulisan mendarat.
let leaveSubmitting = false;
// Dashboard staf: false = 5 permohonan terkini sahaja; true = semua rekod (butang LIHAT SEMUA REKOD).
let showAllMyRecords = false;
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
  inboxSelected.clear(); // pilihan checkbox inbox tidak kekal antara navigasi
  inboxSelectMode = false;
  inboxOpenId = null;
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
let policyTab = 'ringkasan'; // tab Polisi: ringkasan | aliran | kelayakan | peraturan | cuti_umum
let hrReportTab = 'all'; // 'all' | 'approved' | 'balance' | 'jenis'
let masterLogState = SCOPE_ALL;   // SCOPE_ALL | 'Pahang' | 'Terengganu'
let masterLogBranch = SCOPE_ALL;
// Kalendar cuti (view 'calendar')
let calMonth = new Date().toISOString().slice(0, 7);             // 'YYYY-MM'
let calState = SCOPE_ALL;                                        // SCOPE_ALL | 'Pahang' | 'Terengganu' (admin sahaja)
let calBranch = SCOPE_ALL;                                       // SCOPE_ALL | nama cawangan
let calSelected = new Date().toISOString().slice(0, 10);         // hari dipilih (senarai butiran)
  // SCOPE_ALL | NO_BRANCH | nama cawangan
// Penapis "⚠️ Bertindih sahaja" pada Master Logs. Sengaja TIDAK di-reset oleh
// setMasterLogState/setMasterLogBranch — ia penyempitan pandangan di atas tab,
// bukan sebahagian daripada tab itu. Jadual kosong dilindungi oleh mesej
// khusus di bawah, bukan dengan mematikan penapis secara senyap.
let masterLogOverlapOnly = false;
let approvedReportBranch = 'SEMUA';
let approvedReportType = 'SEMUA';
let approvedReportYear = new Date().getFullYear().toString();
let approvedReportMonth = 'SEMUA'; // 'SEMUA' or '1'..'12'; filters approved report by leave start month (Tarikh Cuti)
let leaveYearConfig = { lastClosed: 0 }; // config/leaveYear: last year already closed via Tutup Tahun
let yearEndPreview = null;   // computed rollover plan { year, rows, totals } while the preview modal is open
let yearEndProcessing = false; // true while applying the rollover (disables the confirm button)
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
let analyticsFilterYear = new Date().getFullYear().toString(); // 'SEMUA' or a year e.g. '2026'; default current year to align with HR Reports
let analyticsCatFilter = 'SEMUA'; // 'SEMUA', 'Doctor', 'Admin Staff', 'Operation Staff' — mesti sama dgn staff.category
let analyticsBranchFilter = 'SEMUA'; // 'SEMUA' or branch name
let analyticsRankModal = null; // null, or leave type 'AL'/'MC'/'EL_EMG' for full-list ranking modal
let branchDashboardMonth = 0; // 0 = all months, 1-12 = specific month for HOD/PIC branch view
let selectedLoginBranch = '';
let selectedLoginStaffIC = '';
let showRegisterModal = false;
let showFirstLoginWarning = false;
const MUST_CHANGE_PWD_KEY = 'ksb_must_change_pwd';
let firstLoginPwd = '';            // kata laluan lalai yang baru ditaip — memori sahaja, tidak pernah disimpan
let showPhoneReminderModal = false;

let publicHolidays = { pahang: [], terengganu: [] };
let policyContent = {
  notice: '',
  glossary: [
    { code:'AL',  name:'Annual Leave (Cuti Tahunan)' },
    { code:'MC',  name:'Medical Leave (Cuti Sakit)' },
    { code:'CME', name:'Continuing Medical Education' },
    { code:'EL',  name:'Emergency Leave (Cuti Kecemasan)' },
    { code:'CL',  name:'Compassionate Leave (Cuti Ehsan)' },
    { code:'HL',  name:'Hospitalization Leave' },
    { code:'ML',  name:'Maternity Leave (Cuti Bersalin)' },
    { code:'PL',  name:'Paternity Leave (Cuti Isteri Bersalin)' },
    { code:'RL',  name:'Replacement Leave (Cuti Ganti)' },
    { code:'UPL', name:'Unpaid Leave (Cuti Tanpa Gaji)' }
  ],
  entitlementPahang:     [{ period:'Sehingga 5 tahun', days:'16 Hari' }, { period:'Lebih 5 Tahun ke atas', days:'20 Hari' }],
  entitlementTerengganu: [{ period:'Semua Tempoh', days:'16 Hari' }],
  entitlementDoktor:     [{ days:'25 Hari' }, { days:'20 Hari' }, { days:'10 Hari' }],
  entitlementMC:         [{ period:'Kurang dari 2 tahun', days:'14 Hari' }, { period:'2 tahun hingga kurang 5 tahun', days:'18 Hari' }, { period:'5 tahun ke atas', days:'22 Hari' }],
  rulesAL: [
    'Permohonan mesti dibuat sekurang-kurangnya <strong>3 hari</strong> sebelum tarikh percutian bagi Staff Admin, Staff Operasi di cawangan, dan Doktor di Kerteh / Paka / Klinik Rakyat Dungun; <strong>7 hari</strong> bagi Staff Operasi di Balok (HQ) dan Doktor di lokasi lain.',
    'Kelulusan adalah tertakluk kepada budi bicara pihak pengurusan/HOD mengikut kepada keperluan operasi klinik.',
    'Hanya maksimum baki sejumlah <strong>3 hari</strong> dibenarkan dibawa ke hadapan (carry forward) ke kalendar tahun berikutnya.',
    'Jika baki Cuti Tahunan (AL) anda sudah <strong>habis (0 hari)</strong>, permohonan AL akan disimpan sebagai <strong>Unpaid Leave (UPL — Cuti Tanpa Gaji)</strong>. Kelulusan tetap seperti biasa.',
    'Bagi Staff Admin, hari <strong>hujung minggu dan cuti umum tidak dikira</strong> (Pahang: Sabtu &amp; Ahad; Terengganu: Jumaat &amp; Sabtu). Cuti Bersalin, Paterniti dan Hospitalisasi dikira mengikut hari kalendar berturut-turut.',
    'Permohonan yang <strong>bertindih tarikh</strong> dengan permohonan sedia ada (kecuali yang ditolak/dibatalkan) akan dihalang oleh sistem.'
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
// Polisi anak syarikat (companyPolicy/{cawangan}) — berasingan sepenuhnya dari
// policyContent klinik. Lalai di bawah hanya titik mula; HR syarikat mengeditnya.
const defaultCompanyPolicy = () => ({
  notice: '',
  glossary: [
    { code:'AL',  name:'Annual Leave (Cuti Tahunan)' },
    { code:'MC',  name:'Medical Leave (Cuti Sakit)' },
    { code:'EL',  name:'Emergency Leave (Cuti Kecemasan)' },
    { code:'CL',  name:'Compassionate Leave (Cuti Ehsan)' },
    { code:'HL',  name:'Hospitalization Leave' },
    { code:'ML',  name:'Maternity Leave (Cuti Bersalin)' },
    { code:'PL',  name:'Paternity Leave (Cuti Isteri Bersalin)' },
    { code:'RL',  name:'Replacement Leave (Cuti Ganti)' },
    { code:'UPL', name:'Unpaid Leave (Cuti Tanpa Gaji)' }
  ],
  entitlementAL: [{ period:'Sehingga 5 tahun', days:'16 Hari' }, { period:'Lebih 5 Tahun ke atas', days:'20 Hari' }],
  entitlementMC: [{ period:'Kurang dari 2 tahun', days:'14 Hari' }, { period:'2 tahun hingga kurang 5 tahun', days:'18 Hari' }, { period:'5 tahun ke atas', days:'22 Hari' }],
  rulesAL: [
    'Permohonan mesti dibuat sekurang-kurangnya <strong>3 hari</strong> sebelum tarikh percutian.',
    'Kelulusan adalah tertakluk kepada budi bicara pihak pengurusan mengikut keperluan operasi syarikat.',
    'Hanya maksimum baki sejumlah <strong>3 hari</strong> dibenarkan dibawa ke hadapan (carry forward) ke kalendar tahun berikutnya.',
    'Jika baki Cuti Tahunan (AL) anda sudah <strong>habis (0 hari)</strong>, permohonan AL akan disimpan sebagai <strong>Unpaid Leave (UPL — Cuti Tanpa Gaji)</strong>. Kelulusan tetap seperti biasa.',
    'Permohonan yang <strong>bertindih tarikh</strong> dengan permohonan sedia ada (kecuali yang ditolak/dibatalkan) akan dihalang oleh sistem.'
  ],
  rulesMC: [
    'Sijil Cuti Sakit (MC) yang asal <strong>mesti</strong> diserahkan kepada pihak pengurusan pada hari pertama kembali bekerja.',
    'Staff wajib memaklumkan kepada pihak pengurusan sekurang-kurangnya <strong>2 jam sebelum</strong> waktu kerja bermula.'
  ],
  rulesNotice: [
    'Notis penamatan kontrak pekerjaan mesti mematuhi garis panduan yang ditandatangani sewaktu penerimaan jawatan.',
    'Kegagalan memberikan notis yang mencukupi bermaksud staff bersetuju membayar ganti rugi <i>(indemnity)</i> kepada pihak syarikat mengikut kekurangan hari notis tersebut.'
  ]
});
let companyPolicy = defaultCompanyPolicy();
// Polisi yang dipapar/diedit untuk pengguna semasa.
window.activePolicy = () => (window.isSubsidiaryUser(user) ? companyPolicy : policyContent);

let waLogs = [];
let inboxNotifs = [];
let inboxUnsub = null;
let inboxSelected = new Set(); // ID notifikasi yang ditanda (checkbox) — state UI dalam-memori
let inboxSelectMode = false;   // checkbox hanya dipapar selepas tekan "Pilih"
let inboxFilter = 'all';       // 'all' | 'unread'
let inboxOpenId = null;        // surat yang sedang dibuka (null = senarai)
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

// Katalog jenis cuti + label paparan: src/leaveTypes.js (modul tulen, ada ujian).
// Alias tempatan supaya ~15 tapak panggilan `leaveCategories` sedia ada kekal.
const leaveCategories = LEAVE_CATEGORIES;

// Year options for report/analytics dropdowns: every year present in `records`
// (by Tarikh Mohon, r.id) UNION the current year, sorted newest-first. Always
// including the current year keeps a new calendar year selectable — and keeps the
// default (current-year) selection valid — even before any record exists for it.
function reportYearOptions(records) {
  return [...new Set([
    new Date().getFullYear().toString(),
    ...records.map(r => r.id ? new Date(r.id).getFullYear().toString() : '').filter(Boolean),
  ])].sort().reverse();
}

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
    a:'<strong>Cuti CME</strong> untuk <strong>doktor sahaja</strong>, maksimum <strong>5 hari setiap kalendar</strong>, khusus untuk kursus/seminar/latihan luaran berkaitan kerja. Perlu surat sokongan + pengesahan daripada Pengurus dan Ketua Jabatan (HOD).<br><br><strong>WAJIB muat naik bukti CME</strong> (surat jemputan atau slip pendaftaran program) sebelum hantar — gambar JPG/PNG atau PDF. Tanpa bukti, borang akan ditolak.',
    action:{ label:'Pergi ke Borang Cuti', view:'leave-form' } },
  { id:'ganti-submit', cat:'Cuti', keywords:['cuti ganti','ganti','replacement','rl','mesyuarat','meeting','doktor'],
    q:'Cuti Ganti (doktor) — apa itu & macam mana mohon?',
    a:'<strong>Cuti Ganti</strong> ialah cuti gantian untuk <strong>doktor sahaja</strong>, selepas menghadiri <strong>mesyuarat doktor</strong>. Ia <strong>tiada kuota tetap</strong> — hari diambil direkod dan dilaporkan, tetapi tiada baki tahunan. Mohon seperti biasa melalui <em>Mohon Cuti</em> → pilih <strong>Cuti Ganti</strong>; <strong>polisi notis awal tidak terpakai</strong> kerana cuti ini dituntut selepas mesyuarat berlangsung.',
    action:{ label:'Pergi ke Borang Cuti', view:'leave-form' } },
  { id:'locum-info', cat:'Cuti', keywords:['locum','ganti','doktor locum','penggantian'],
    q:'Maklumat Locum untuk doktor',
    a:'Untuk doktor, maklumat <strong>Locum</strong> (nama, tarikh, masa penggantian) boleh diisi untuk rujukan. Ia biasanya dilengkapkan oleh HOD/Supervisor sebelum meluluskan, dan <strong>tidak diwajibkan</strong> untuk meluluskan permohonan.' },
  { id:'no-submit-approver', cat:'Masalah', popular:true, keywords:['tak boleh hantar','pelulus','wajib pilih','borang ditolak','peringkat 1'],
    q:'Borang tak boleh hantar — "Wajib pilih Pelulus"',
    a:'Anda perlu <strong>pilih Pelulus Peringkat 1</strong> dari menu dropdown sebelum hantar. Jika <strong>tiada pelulus berdaftar</strong> untuk cawangan/kategori anda, sistem akan benarkan hantar terus dan <strong>HR/Admin</strong> akan luluskan. (MC tidak perlu pilih pelulus.)' },
  { id:'no-submit-mc', cat:'Masalah', keywords:['mc tak hantar','sijil belum','muat naik mc','upload mc'],
    q:'MC tak boleh hantar — sijil belum dimuat naik',
    a:'Cuti Sakit (MC) <strong>wajib</strong> ada <strong>Sijil Sakit</strong> dimuat naik (gambar JPG/PNG atau PDF) sebelum boleh dihantar. Tekan kotak muat naik MC, pilih fail, kemudian hantar.' },
  { id:'no-submit-cme', cat:'Masalah', keywords:['cme tak hantar','bukti cme','muat naik cme','upload cme','surat jemputan'],
    q:'Cuti CME tak boleh hantar — bukti belum dimuat naik',
    a:'Cuti CME <strong>wajib</strong> ada <strong>bukti program</strong> dimuat naik (surat jemputan atau slip pendaftaran — gambar JPG/PNG atau PDF) sebelum boleh dihantar. Tekan kotak muat naik bukti CME, pilih fail, kemudian hantar.' },
  { id:'notice-policy', cat:'Masalah', keywords:['notis','polisi notis','policy violation','3 hari','7 hari','days notice','terlalu lewat'],
    q:'Mesej "Polisi Notis Minimum — hari sebelum tarikh mula cuti"',
    a:'Cuti Tahunan (AL) mesti dimohon awal sebelum tarikh cuti: <strong>3 hari</strong> untuk Staff Admin &amp; Staff Operasi di cawangan, <strong>7 hari</strong> untuk Doktor &amp; Staff Operasi di Balok (HQ). <strong>MC, Cuti Kecemasan, Cuti Ehsan & Cuti Hospitalisasi (HL) dikecualikan</strong> (boleh hari ini/ke belakang) — tetapi wajib pilih pelulus & muat naik bukti.' },
  { id:'balance-insufficient', cat:'Masalah', keywords:['baki tak cukup','unpaid','split','ul','kurang baki'],
    q:'Baki cuti tak cukup / jadi Unpaid Leave',
    a:'Jika baki Cuti Tahunan (AL) anda sudah <strong>habis (0 hari)</strong>, permohonan <strong>AL</strong> atau <strong>EL (Cuti Kecemasan)</strong> akan disimpan terus sebagai <strong>Unpaid Leave (UPL)</strong>. Kelulusan tetap seperti biasa. Jika baki AL masih ada tetapi kurang daripada hari dimohon, notis akan dipaparkan semasa hantar — semak dengan HR untuk pelarasan.' },
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
    a:'Buka <strong>Tetapan</strong> → anda boleh kemas kini sendiri <strong>Nama Penuh</strong>, alamat, nombor telefon, e-mel dan gambar profil. Nama akan ditukar kepada HURUF BESAR automatik. Cawangan, jawatan dan kelayakan cuti hanya boleh diubah oleh <strong>HR/Admin</strong>.' },
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
    a:'Anda boleh hubungi HR/Admin melalui nombor telefon rasmi yang disediakan oleh klinik.' }
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
        dashboard: 'analisa', branch_analisa: false, leave_request: true, policy: true, settings: true, wa_setting: true, inbox: true,
        manage_pending: true, manage_staff: true, manage_branches: true, manage_audit: true, manage_login_audit: true, manage_reports: true, manage_routing: true, manage_access: true, manage_roles_categories: true, manage_holidays: true, manage_policy: true,
        report_kuantan_only: false, report_own_branch_only: false, report_attendance: true,
        can_cancel: true, locum_records: true, manage_registrations: true, edit_leave: true, leave_calendar: true
    },
    admin: {
        dashboard: 'analisa', branch_analisa: false, leave_request: true, policy: true, settings: true, wa_setting: false, inbox: true,
        manage_pending: true, manage_staff: true, manage_branches: true, manage_audit: true, manage_login_audit: true, manage_reports: true, manage_routing: true, manage_access: true, manage_roles_categories: true, manage_holidays: true, manage_policy: true,
        report_kuantan_only: false, report_own_branch_only: false, report_attendance: true,
        can_cancel: true, locum_records: true, manage_registrations: true, edit_leave: true, leave_calendar: true
    },
    hr: {
        dashboard: 'staff', branch_analisa: false, leave_request: true, policy: true, settings: true, wa_setting: false, inbox: true,
        manage_pending: true, manage_staff: true, manage_branches: true, manage_audit: true, manage_login_audit: false, manage_reports: true, manage_routing: false, manage_access: false, manage_roles_categories: true, manage_holidays: true, manage_policy: true,
        report_kuantan_only: false, report_own_branch_only: false, report_attendance: true,
        can_cancel: true, locum_records: true, manage_registrations: true, edit_leave: true, leave_calendar: true
    },
    hod_cawangan: {
        dashboard: 'branch', branch_analisa: true, leave_request: true, policy: true, settings: true, wa_setting: false, inbox: true,
        // manage_staff di sini = urus staf CAWANGAN SENDIRI (firestore.rules isBranchHodOf).
        // Ia sengaja TIDAK menjadi claim manageStaff seluruh syarikat — lihat
        // BRANCH_LIMITED_STAFF_ROLES dalam src/rolePermissions.js.
        manage_pending: false, manage_staff: true, manage_branches: false, manage_audit: false, manage_login_audit: false, manage_reports: true, manage_routing: false, manage_access: false, manage_roles_categories: false, manage_holidays: true, manage_policy: false,
        report_kuantan_only: false, report_own_branch_only: true, report_attendance: true,
        can_cancel: true, locum_records: false, manage_registrations: false, edit_leave: false, leave_calendar: false
    },
    hod_balok: {
        dashboard: 'branch', branch_analisa: true, leave_request: true, policy: true, settings: true, wa_setting: false, inbox: true,
        manage_pending: true, manage_staff: false, manage_branches: false, manage_audit: false, manage_login_audit: false, manage_reports: true, manage_routing: false, manage_access: false, manage_roles_categories: false, manage_holidays: false, manage_policy: false,
        report_kuantan_only: false, report_own_branch_only: true, report_attendance: true,
        can_cancel: true, locum_records: false, manage_registrations: false, edit_leave: false, leave_calendar: true
    },
    doctor_pic: {
        dashboard: 'branch', branch_analisa: true, leave_request: true, policy: true, settings: true, wa_setting: false, inbox: true,
        manage_pending: true, manage_staff: false, manage_branches: false, manage_audit: false, manage_login_audit: false, manage_reports: false, manage_routing: false, manage_access: false, manage_roles_categories: false, manage_holidays: false, manage_policy: false,
        report_kuantan_only: false, report_own_branch_only: false, report_attendance: false,
        can_cancel: true, locum_records: false, manage_registrations: false, edit_leave: false, leave_calendar: true
    },
    supervisor: {
        dashboard: 'staff', branch_analisa: false, leave_request: true, policy: true, settings: true, wa_setting: false, inbox: true,
        manage_pending: true, manage_staff: false, manage_branches: false, manage_audit: false, manage_login_audit: false, manage_reports: false, manage_routing: false, manage_access: false, manage_roles_categories: false, manage_holidays: false, manage_policy: false,
        report_kuantan_only: false, report_own_branch_only: false, report_attendance: false,
        can_cancel: true, locum_records: true, manage_registrations: false, edit_leave: false, leave_calendar: true
    },
    team_leader: {
        dashboard: 'staff', branch_analisa: false, leave_request: true, policy: true, settings: true, wa_setting: false, inbox: true,
        manage_pending: true, manage_staff: false, manage_branches: false, manage_audit: false, manage_login_audit: false, manage_reports: false, manage_routing: false, manage_access: false, manage_roles_categories: false, manage_holidays: false, manage_policy: false,
        report_kuantan_only: false, report_own_branch_only: false, report_attendance: false,
        can_cancel: false, locum_records: false, manage_registrations: false, edit_leave: false, leave_calendar: true
    },
    staff: {
        dashboard: 'staff', branch_analisa: false, leave_request: true, policy: true, settings: true, wa_setting: false, inbox: true,
        manage_pending: false, manage_staff: false, manage_branches: false, manage_audit: false, manage_login_audit: false, manage_reports: false, manage_routing: false, manage_access: false, manage_roles_categories: false, manage_holidays: false, manage_policy: false,
        report_kuantan_only: false, report_own_branch_only: false, report_attendance: false,
        can_cancel: false, locum_records: false, manage_registrations: false, edit_leave: false, leave_calendar: false
    },
    juru_xray: {
        dashboard: 'staff', branch_analisa: false, leave_request: true, policy: true, settings: true, wa_setting: false, inbox: true,
        manage_pending: false, manage_staff: false, manage_branches: false, manage_audit: false, manage_login_audit: false, manage_reports: false, manage_routing: false, manage_access: false, manage_roles_categories: false, manage_holidays: false, manage_policy: false,
        report_kuantan_only: false, report_own_branch_only: false, report_attendance: false,
        can_cancel: false, locum_records: false, manage_registrations: false, edit_leave: false, leave_calendar: false
    },
    sonographer: {
        dashboard: 'staff', branch_analisa: false, leave_request: true, policy: true, settings: true, wa_setting: false, inbox: true,
        manage_pending: false, manage_staff: false, manage_branches: false, manage_audit: false, manage_login_audit: false, manage_reports: false, manage_routing: false, manage_access: false, manage_roles_categories: false, manage_holidays: false, manage_policy: false,
        report_kuantan_only: false, report_own_branch_only: false, report_attendance: false,
        can_cancel: false, locum_records: false, manage_registrations: false, edit_leave: false, leave_calendar: false
    },
    juru_audio: {
        dashboard: 'staff', branch_analisa: false, leave_request: true, policy: true, settings: true, wa_setting: false, inbox: true,
        manage_pending: false, manage_staff: false, manage_branches: false, manage_audit: false, manage_login_audit: false, manage_reports: false, manage_routing: false, manage_access: false, manage_roles_categories: false, manage_holidays: false, manage_policy: false,
        report_kuantan_only: false, report_own_branch_only: false, report_attendance: false,
        can_cancel: false, locum_records: false, manage_registrations: false, edit_leave: false, leave_calendar: false
    },
    pemandu: {
        dashboard: 'staff', branch_analisa: false, leave_request: true, policy: true, settings: true, wa_setting: false, inbox: true,
        manage_pending: false, manage_staff: false, manage_branches: false, manage_audit: false, manage_login_audit: false, manage_reports: false, manage_routing: false, manage_access: false, manage_roles_categories: false, manage_holidays: false, manage_policy: false,
        report_kuantan_only: false, report_own_branch_only: false, report_attendance: false,
        can_cancel: false, locum_records: false, manage_registrations: false, edit_leave: false, leave_calendar: false
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

// Satu-satunya laluan menulis kawalan akses. Matriks RBAC disimpan BERSAMA
// config/rolePermissions yang dijana daripadanya (src/rolePermissions.js) dalam
// satu batch — dua dokumen itu tidak boleh lagi tersasar. Peranan yang claimsnya
// berubah direkod dalam config/rolePermissionsSync.pendingRoles sehingga
// `node sync-claims.js` dijalankan. firestore.rules: Admin/Super Admin sahaja.
const canEditAccessControl = u => !!u && ['admin', 'super_admin'].includes(u.role);
let rbacSection = 'akses';          // sub-tab jadual Kawalan Akses
window.setRbacSection = function(k) { rbacSection = k; render(); };
let claimsSyncInfo = null;          // config/rolePermissionsSync — dimuat bila tab Kawalan Akses dibuka
async function loadClaimsSyncInfo() {
    try {
        const snap = await getDoc(doc(db, 'config', 'rolePermissionsSync'));
        claimsSyncInfo = snap.exists() ? snap.data() : { pendingRoles: [] };
    } catch (e) { console.warn('rolePermissionsSync load failed:', e); claimsSyncInfo = { pendingRoles: [] }; }
    render();
}
async function persistRbac() {
    const next = deriveRolePermissions(window.rbacMatrix);
    const prevSnap = await getDoc(doc(db, 'config', 'rolePermissions'));
    const changed = changedRoles(prevSnap.exists() ? prevSnap.data() : {}, next);
    const batch = writeBatch(db);
    batch.set(doc(db, 'settings', 'rbac'), window.rbacMatrix);
    batch.set(doc(db, 'config', 'rolePermissions'), next);
    if (changed.length) {
        batch.set(doc(db, 'config', 'rolePermissionsSync'),
            { pendingRoles: arrayUnion(...changed), updatedAt: Date.now(), updatedBy: user?.name || user?.ic || '' },
            { merge: true });
    }
    await batch.commit();
    if (changed.length) loadClaimsSyncInfo();
    return changed;
}

window.saveRbac = async function() {
    if (!canEditAccessControl(user)) { showToast('Hanya Admin / Super Admin boleh mengubah kawalan akses.'); return; }
    try {
        const changed = await persistRbac();
        showToast(changed.length
            ? `RBAC disimpan. Kuasa simpan berubah untuk: ${changed.join(', ')} — jalankan "node sync-claims.js" supaya berkuat kuasa.`
            : 'Kebenaran Akses (RBAC) berjaya disimpan ke Firestore!');
    } catch (e) {
        console.error("Error persisting RBAC Matrix:", e);
        showToast('Ralat: Gagal menyimpan tetapan matrix. Sila semak sambungan internet.');
    }
    render();
};

// Togol mod "Guna Dalam Sistem": manual (HR isi sendiri) ↔ auto (kira dari rekod diluluskan).
window.toggleAutoSystemUsage = async function() {
    if (!['admin', 'super_admin'].includes(user?.role)) {
        showToast('Hanya Super Admin / Admin boleh menukar tetapan ini.');
        return;
    }
    const turningOn = !autoSystemUsage;
    const msg = turningOn
        ? '⚠️ HIDUPKAN MOD AUTO?\n\nBaki "Guna Dalam Sistem" untuk AL/MC/EL akan dikira AUTOMATIK daripada rekod cuti yang DILULUSKAN dalam sistem. Nilai "Guna Dalam Sistem (Manual)" yang HR isi akan DIABAIKAN.\n\nPastikan SEMUA cuti sedia ada sudah direkod & diluluskan dalam sistem (sync penuh) sebelum hidupkan.\n\nTeruskan?'
        : '↩️ MATIKAN MOD AUTO (kembali manual)?\n\nBaki "Guna Dalam Sistem" akan kembali ikut nilai manual yang HR isi (rekod diluluskan TIDAK dikira automatik).\n\nTeruskan?';
    if (!await showConfirm(msg)) return;
    try {
        await setDoc(doc(db, 'settings', 'leaveConfig'), { autoSystemUsage: turningOn, updatedAt: Date.now(), updatedBy: user.name || user.ic }, { merge: true });
        window.logSystemActivity(`Set AUTO "Guna Dalam Sistem" = ${turningOn ? 'ON (auto rekod)' : 'OFF (manual)'}`);
        showToast(turningOn ? '✅ Mod AUTO dihidupkan. Baki kini dikira dari rekod diluluskan.' : '✅ Mod manual dihidupkan semula.');
    } catch (e) {
        console.error('Error toggling autoSystemUsage:', e);
        showToast('Ralat: Gagal menyimpan tetapan. Sila semak sambungan internet.');
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
window.resetRbac = async function() {
    if (!await showConfirm('Reset semua kebenaran ke nilai lalai kod? Perubahan yang belum disimpan akan hilang.')) return;
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

window.setAnalyticsYear = function(val) {
  analyticsFilterYear = val;
  render();
};

window.setAnalyticsCat = function(cat) {
  analyticsCatFilter = cat;
  render();
};

window.openRankModal = function(type) {
  analyticsRankModal = type;
  render();
};

window.closeRankModal = function() {
  analyticsRankModal = null;
  render();
};

// Label paparan untuk analyticsCatFilter (nilainya ikut staff.category yg English).
function analyticsCatLabel(catFilter) {
  return catFilter === 'Doctor' ? 'DOKTOR' : catFilter.toUpperCase();
}

// Shared source of truth for the "Ranking Penggunaan Cuti" cards + full-list modal.
// Aggregates APPROVED-only records of a given leave type per person (sum days,
// count applications), honouring the active category filter. Returns rows sorted
// by total days descending: [{ ic, name, branch, days, count }].
function rankLeaveUsers(records, type, catFilter) {
  const approved = records.filter(r => r.type === type && r.status === 'APPROVED');
  const catMatched = catFilter === 'SEMUA' ? approved
    : approved.filter(r => {
        const s = staffList.find(x => x.name === r.name || x.ic === r.ic);
        return s && s.category === catFilter;
      });
  const byPerson = {};
  catMatched.forEach(r => {
    const key = r.ic || r.name;
    if (!byPerson[key]) byPerson[key] = { ic: r.ic, name: r.name, branch: r.branch || '', days: 0, count: 0 };
    byPerson[key].days += parseFloat(r.days || 1);
    byPerson[key].count += 1;
  });
  return Object.values(byPerson).sort((a, b) => b.days - a.days);
}

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
    const perms = window.effectivePerms(u);
    if (perms.report_kuantan_only) return 'Kuantan';
    return null;
};

window.getUserReportBranch = function(u) {
    if (!u) return null;
    const perms = window.effectivePerms(u);
    if (perms.report_own_branch_only) return u.branch || null;
    return null;
};

// Negeri yang menentukan SKOP HR bagi sesebuah cawangan. Sama seperti state
// cawangan, KECUALI cawangan dalam ROUTES_AS_PAHANG (Utama) — fizikalnya di
// Terengganu tetapi diuruskan oleh Balok HQ, jadi ia milik zon Pahang.
window.scopeStateOfBranch = function(branchName) {
    if (OWN_HR_ZONE[branchName]) return OWN_HR_ZONE[branchName];
    if (ROUTES_AS_PAHANG.includes(branchName)) return 'Pahang';
    const b = branches.find(x => x.name === branchName);
    return (b && b.state) ? b.state : null;
};

// Skop HR per-staf. `hrState` disimpan pada rekod staf HR:
//   Norhazlinah → 'Pahang' (Balok, cawangan Pahang & Utama)
//   Zahirah     → 'Terengganu' (Kerteh, Paka, KR X-Ray Dungun)
// HR tanpa hrState kekal 'Pahang' (tingkah laku asal sebelum 2026-08-03).
window.getUserStateScope = function(u) {
    if (!u) return null;
    if (['super_admin', 'admin'].includes(u.role)) return 'all';
    if (u.role === 'hr') return u.hrState || 'Pahang';
    // Staf anak syarikat (KSB Pharma) — zon syarikatnya, bukan negeri cawangan.
    if (OWN_HR_ZONE[u.branch]) return OWN_HR_ZONE[u.branch];
    const branchObj = branches.find(b => b.name === u.branch);
    return (branchObj && branchObj.state) ? branchObj.state : null;
};

// Rekod cuti yang berada dalam skop pengguna. HR hanya nampak zonnya sendiri;
// admin/super_admin ('all') nampak semua. Digunakan oleh papan pemuka Analisa —
// skrin laporan menapis sendiri melalui getUserStateScope + reportBranch/Daerah.
window.recordsInUserScope = function(records) {
    const scope = window.getUserStateScope(user);
    if (!scope || scope === 'all') return records;
    return records.filter(r => window.scopeStateOfBranch(r.branch) === scope);
};

// Cawangan yang berada dalam skop pengguna — untuk dropdown penapis.
window.branchesInUserScope = function() {
    const scope = window.getUserStateScope(user);
    if (!scope || scope === 'all') return branches;
    return branches.filter(b => window.scopeStateOfBranch(b.name) === scope);
};

// Penerima notifikasi/kelulusan HR bagi satu cawangan — HR zon lain dikecualikan.
// Admin & Super Admin sentiasa termasuk (mereka nampak kedua-dua zon).
window.hrRecipientsForBranch = function(branchName) {
    const zone = window.scopeStateOfBranch(branchName);
    return staffList.filter(s => {
        if (!['admin', 'hr', 'super_admin'].includes(s.role) || s.inactive) return false;
        if (s.role !== 'hr') return true;
        if (window.isP1OnlyHR(s)) return false;   // pelulus Peringkat 1, bukan akhir
        return (s.hrState || 'Pahang') === zone;
    });
};

// A HOD Cawangan sees and edits only their own branch. Deliberately NOT folded
// into canManageRequest(): that function also gates the approve/reject controls,
// and a HOD Cawangan is not an approver — leave still routes through Doctor PIC.
window.isBranchScopedHod = function(u) {
    return !!u && u.role === 'hod_cawangan';
};

// HR anak syarikat (cth. KSB Pharma, anak syarikat KSB Balok) — HR penuh untuk
// syarikatnya SAHAJA: lulus cuti, urus staf, laporan & Master Logs zonnya. Tetapan yang
// dikongsi dengan klinik (cawangan, cuti umum, polisi, peranan, laluan, akses, WA, log
// login, locum) disekat — dia tidak boleh nampak atau mengubah apa-apa milik klinik.
// Polisi: HR anak syarikat mengedit polisi SYARIKATNYA (companyPolicy/{cawangan}),
// bukan polisi klinik (config/policyContent).
// Sekatan juga dikuatkuasakan di firestore.rules (isSubsidiaryUser/companyOK) —
// pendengar data mesti ditapis ikut cawangan (subsidiaryScoped) atau ia akan ditolak.
const SUBSIDIARY_HR_DENY = ['manage_branches', 'manage_roles_categories', 'manage_login_audit',
    'manage_routing', 'manage_access', 'manage_holidays', 'wa_setting', 'locum_records'];
const SUBSIDIARY_HR_ROLES = ['staff', 'supervisor', 'hr'];
// Mana-mana staf anak syarikat (bukan HR sahaja) — data mereka terhad kepada syarikat sendiri.
window.isSubsidiaryUser = function(u) {
    return !!u && !!OWN_HR_ZONE[u.branch];
};
// Admin kumpulan — satu-satunya yang nampak klinik DAN anak syarikat.
window.isGroupAdmin = function(u) {
    return !!u && ['admin', 'super_admin'].includes(u.role);
};
window.isSubsidiaryHR = function(u) {
    return !!u && u.role === 'hr' && !!OWN_HR_ZONE[u.branch];
};
// HR anak syarikat bertanda approvalStage 'p1' (Siti Noridah, KSB Pharma) — akses HR
// penuh untuk syarikatnya, tetapi dalam kelulusan cuti dia PELULUS PERINGKAT 1 sahaja;
// kelulusan akhir kekal pada HR syarikat itu yang lain (Syarifah).
window.isP1OnlyHR = function(u) {
    return window.isSubsidiaryHR(u) && u.approvalStage === 'p1';
};
// Pelulus akhir (Peringkat 2) vs pelulus Peringkat 1 — guna ini, bukan senarai peranan.
window.isFinalApprover = function(u) {
    return !!u && ['admin', 'hr', 'super_admin'].includes(u.role) && !window.isP1OnlyHR(u);
};
window.isP1Approver = function(u) {
    return !!u && (['doctor_pic', 'hod_balok', 'supervisor'].includes(u.role) || window.isP1OnlyHR(u));
};
// Kebenaran RBAC berkesan untuk pengguna — guna ini, bukan rbacMatrix[role] terus,
// supaya sekatan HR anak syarikat terpakai di semua tempat.
window.effectivePerms = function(u) {
    const key = (u && window.rbacMatrix[u.role]) ? u.role : 'staff';
    const perms = window.rbacMatrix[key] || {};
    if (!window.isSubsidiaryHR(u)) return perms;
    const out = { ...perms };
    SUBSIDIARY_HR_DENY.forEach(k => { out[k] = false; });
    return out;
};
// Pilihan cawangan & peranan dalam borang tambah/edit staf.
window.staffFormBranches = function() {
    return window.isSubsidiaryHR(user) ? window.branchesInUserScope() : branches;
};
window.staffFormRoles = function(keys) {
    return window.isSubsidiaryHR(user) ? keys.filter(k => SUBSIDIARY_HR_ROLES.includes(k)) : keys;
};
// Permohonan daftar baharu: HR anak syarikat hanya nampak yang memilih cawangannya.
window.regRequestsInScope = function(list) {
    if (!window.isSubsidiaryHR(user)) return list;
    const zone = window.getUserStateScope(user);
    return list.filter(r => window.scopeStateOfBranch(r.branch) === zone);
};

// Correct/cancel rights for a HOD Cawangan over their own branch. Mirrors the
// firestore.rules grant exactly: own branch, never their own record. Approval is
// deliberately absent — the rules reject any status other than PENDING/CANCELLED.
window.canCorrectBranchLeave = function(u, req) {
    if (!u || !req) return false;
    if (!window.isBranchScopedHod(u)) return false;
    if (req.ic === u.ic) return false;
    return req.branch === u.branch;
};

window.canManageRequest = function(user, req) {
    if (!user || !req) return false;
    if (['super_admin', 'admin'].includes(user.role)) return true;
    if (user.role === 'hr') {
        // HR hanya urus zon sendiri — Pahang & Terengganu berasingan sepenuhnya.
        const zone = window.scopeStateOfBranch(req.branch);
        const inZone = !zone || zone === (user.hrState || 'Pahang');
        if (!inZone) return false;
        if (!window.isP1OnlyHR(user)) return true;
        // HR Peringkat-1 sahaja: hanya PENDING orang lain yang melalui Peringkat 1.
        if (req.ic === user.ic || req.status !== 'PENDING') return false;
        if (req.hodIC) return req.hodIC === user.ic;
        const _ap = staffList.find(s => s.ic === req.ic);
        const _skip = (req.directHR != null) ? !!req.directHR : window.shouldSkipP1(_ap, req.type);
        return !_skip;
    }
    // Pengasingan tugas: tiada sesiapa boleh menilai permohonan cutinya SENDIRI pada
    // Peringkat 0/1 (Team Leader / HOD / Doctor PIC / Supervisor). Semakan ini perlu
    // kerana getRoutingP1Approvers membuang pemohon dari senarai calon, tetapi laluan
    // 'TL APPROVED' + laluan config P1 di bawah hanya semak peranan & cawangan — jadi
    // pelulus tunggal di cawangannya (cth. satu-satunya Supervisor Balok) boleh
    // meluluskan cuti sendiri. HR/Admin (Peringkat 2) sudah pulang true di atas dan
    // sengaja dikecualikan: jika tidak, cuti HR sendiri tiada pelulus akhir.
    if (req.ic === user.ic) return false;

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

    // Pengecualian "terus ke HR" — Pelulus Peringkat 1 (HOD/Supervisor/Doctor PIC)
    // tidak boleh urus. HR/Admin sudah dibenarkan di atas. Guna flag tersimpan;
    // fallback kira semula untuk rekod lama tanpa flag.
    const skipP1 = (req.directHR != null) ? !!req.directHR : window.shouldSkipP1(applicant, req.type);
    if (skipP1) return false;

    const group = window.getStaffGroup(applicant);
    const cfg   = approvalRouting[group] || {};

    // Cawangan Pahang tanpa Doctor PIC → Supervisor Balok (lihat usesBalokSupervisorFallback).
    if (user.role === 'supervisor' && (user.branch || '') === 'Klinik Syed Badaruddin Balok (HQ)'
        && window.usesBalokSupervisorFallback(group, cfg, req.branch)) return true;

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
        // Semak format (JPG/PNG/PDF) & saiz (10MB) — beritahu punca sebenar.
        const _fileErr = validateProofFile(input.files[0]);
        if (_fileErr) {
            showToast(_fileErr);
            input.value = '';
            const _d = document.getElementById(displayId);
            if (_d) _d.innerText = 'Tiada fail dipilih';
            // Notis mungkin masih menunjukkan hijau "sedia untuk dihantar" daripada
            // percubaan lepas — pulihkan kepada teks asal "belum dimuat naik".
            if (noticeId) {
                const noticeEl = document.getElementById(noticeId);
                if (noticeEl && noticeEl.dataset.pendingHtml) {
                    noticeEl.style.background = 'rgba(239,68,68,0.08)';
                    noticeEl.style.color = '#ef4444';
                    noticeEl.innerHTML = noticeEl.dataset.pendingHtml;
                }
            }
            return;
        }
        document.getElementById(displayId).innerText = input.files[0].name;
        if (noticeId) {
            const noticeEl = document.getElementById(noticeId);
            if (noticeEl) {
                if (!noticeEl.dataset.pendingHtml) noticeEl.dataset.pendingHtml = noticeEl.innerHTML;
                noticeEl.style.background = 'rgba(34, 197, 94, 0.1)';
                noticeEl.style.color = '#34d399';
                noticeEl.innerHTML = `
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
                    DOKUMEN TELAH DIMUAT NAIK - SEDIA UNTUK DIHANTAR
                `;
            }
        }
    }
};

// Panel "Mod Test" di atas Borang Cuti — super_admin / admin sahaja.
// Suis menanda permohonan seterusnya sebagai isTest; senarai di bawahnya memaparkan
// semua cuti test dengan butang yang memanggil fungsi SEBENAR (finalizeLeave,
// rejectLeave, printLeave, deleteLeave) — jadi aliran yang diuji ialah aliran sebenar.
function renderTestModePanel() {
  const escT = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const on = leaveTestMode;
  const phoneNote = user.phone
    ? `WhatsApp test dihantar ke nombor anda: <strong>${escT(user.phone)}</strong>`
    : '<strong style="color:#b45309;">Akaun anda tiada nombor telefon — WhatsApp test akan DILANGKAU</strong> (Inbox tetap berfungsi).';
  const rows = testLeaveRecords.map(r => {
    const open = !FINAL_LEAVE_STATUSES.includes(r.status);
    const btn = (label, onclick, cls = '') => `<button type="button" class="neu-btn ${cls}" onclick="${onclick}" style="padding:0.3rem 0.65rem;font-size:0.7rem;font-weight:700;flex:none;">${label}</button>`;
    return `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:0.6rem;padding:0.6rem 0.75rem;border-radius:10px;background:rgba(255,255,255,0.55);border:1px solid rgba(217,119,6,0.18);">
        <div style="flex:1;min-width:180px;">
          <div style="font-size:0.78rem;font-weight:700;">${escT(leaveTypeName(r.type))} — ${escT(r.days)} hari</div>
          <div style="font-size:0.68rem;color:var(--text-muted);">${escT(r.name)} · ${escT(r.startDate)}${r.endDate && r.endDate !== r.startDate ? ' → ' + escT(r.endDate) : ''}</div>
        </div>
        <span>${statusBadge(r.status, { compact: true })}</span>
        <div style="display:flex;gap:0.35rem;flex-wrap:wrap;">
          ${open ? btn('Lulus / Sokong', `window.finalizeLeave(${r.id})`, 'is-approve') : ''}
          ${open ? btn('Tolak', `window.rejectLeave(${r.id})`, 'is-reject') : ''}
          ${btn('Cetak Borang', `window.printLeave(${r.id})`, 'is-print')}
          ${btn('Padam', `window.deleteLeave(${r.id})`, 'is-cancel')}
        </div>
      </div>`;
  }).join('');
  return `
    <div class="glass-card fade-in" style="margin-bottom:1rem;padding:1rem 1.25rem;border:1.5px dashed ${on ? '#d97706' : 'rgba(217,119,6,0.35)'};background:${on ? 'rgba(251,191,36,0.12)' : 'transparent'};">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap;">
        <div>
          <div style="font-size:0.85rem;font-weight:800;color:#b45309;">🧪 Mod Test Sistem</div>
          <div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.15rem;">Cuti test tidak dikira dalam baki, laporan, Analisa atau kalendar. Semua WA &amp; Inbox dihala kepada anda sahaja.</div>
        </div>
        <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer;font-size:0.78rem;font-weight:700;color:${on ? '#b45309' : 'var(--text-muted)'};">
          <input type="checkbox" ${on ? 'checked' : ''} onchange="window.toggleLeaveTestMode(this.checked)" style="width:18px;height:18px;accent-color:#d97706;cursor:pointer;">
          ${on ? 'AKTIF — permohonan seterusnya ialah TEST' : 'Hidupkan Mod Test'}
        </label>
      </div>
      ${on ? `<div style="font-size:0.72rem;margin-top:0.6rem;color:var(--text);">${phoneNote}</div>` : ''}
      ${testLeaveRecords.length ? `<div style="margin-top:0.85rem;">
        <div style="font-size:0.68rem;font-weight:800;letter-spacing:0.5px;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.45rem;">Cuti Test (${testLeaveRecords.length})</div>
        <div style="display:flex;flex-direction:column;gap:0.45rem;">${rows}</div>
      </div>` : ''}
    </div>`;
}
window.toggleLeaveTestMode = function(on) { leaveTestMode = !!on && canUseTestMode(user); render(); };

// Kotak muat naik bukti — satu renderer untuk SEMUA jenis cuti yang perlukan
// dokumen (MC / Ehsan / Kecemasan / CME / HL). Isi kandungan datang dari LEAVE_PROOF
// dalam leaveTypes.js; jangan tambah blok HTML baharu untuk jenis cuti baharu.
// Pulangkan '' jika jenis cuti itu tidak perlukan bukti.
function renderProofSection(code) {
  const need = proofRequirement(code);
  if (!need) return '';
  const stem = need.inputId.replace('-upload', '');   // 'mc-upload' → 'mc'
  const rgb = hexToRgbTriple(need.boxColor);
  return `
            <div style="margin-bottom:1.5rem;">
              <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.85rem;">
                <div style="width:4px;height:18px;border-radius:2px;background:linear-gradient(to bottom,${need.barFrom},${need.barTo});"></div>
                <span style="font-size:0.72rem;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);">${need.title}</span>
                <span style="font-size:0.65rem;background:rgba(239,68,68,0.12);color:#ef4444;border:1px solid rgba(239,68,68,0.2);border-radius:6px;padding:0.15rem 0.5rem;font-weight:700;">★ WAJIB</span>
              </div>
              <div style="padding:1rem;border-radius:12px;border:1.5px dashed rgba(${rgb},0.3);background:rgba(${rgb},0.03);">
                <div style="font-size:0.75rem;font-weight:600;color:var(--text-muted);margin-bottom:0.75rem;">${need.hint}</div>
                <div style="display:flex;align-items:center;gap:0.75rem;">
                  <input type="file" id="${need.inputId}" accept="${PROOF_ACCEPT}" style="display:none;" onchange="window.handleFileSelect(this, '${stem}-filename', '${stem}-notice')">
                  <button type="button" onclick="document.getElementById('${need.inputId}').click()" style="padding:0.55rem 1rem;border-radius:8px;border:1px solid rgba(${rgb},0.3);background:rgba(${rgb},0.1);color:${need.boxColor};font-size:0.75rem;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:0.4rem;white-space:nowrap;">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                    ${need.buttonLabel}
                  </button>
                  <span id="${stem}-filename" style="font-size:0.72rem;color:var(--text-muted);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">Tiada fail dipilih</span>
                </div>
                <div id="${stem}-notice" style="margin-top:0.75rem;padding:0.6rem 0.85rem;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.18);border-radius:8px;font-size:0.72rem;color:#ef4444;display:flex;align-items:center;gap:0.5rem;font-weight:700;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12.01" y2="8"/><line x1="12" y1="12" x2="12" y2="16"/></svg>
                  ${need.notice}
                </div>
              </div>
            </div>`;
}

// Master Logs: HR/Admin muat naik atau ganti bukti untuk cuti yang perlukan bukti
// (lihat LEAVE_PROOF — MC / Kecemasan / Ehsan / CME / HL). Fail dimuat naik ke Cloudinary dan proofUrl/
// proofName dikemas kini pada rekod cuti. Berguna untuk rekod lama yang belum ada bukti.
window.reuploadProof = function(id) {
  const rec = findLeaveRecord(id);
  if (!rec) return;
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = PROOF_ACCEPT;
  inp.onchange = async () => {
    const file = inp.files && inp.files[0];
    if (!file) return;
    const _fileErr = validateProofFile(file);
    if (_fileErr) { showToast(_fileErr); return; }
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
      showToast('✅ Bukti berjaya dimuat naik & disimpan.');
    } catch (err) {
      console.error('Re-upload proof failed:', err);
      showToast(proofUploadErrorMessage(err));
    }
  };
  inp.click();
};

window.updateLocumInfo = function(id, field, value) {
  const record = findLeaveRecord(id);
  if (record) {
    record[field] = value;
    render();
  }
};

window.toggleLocum2 = function(id) {
  if (showLocum2Set.has(id)) {
    showLocum2Set.delete(id);
    // clear locum2 data when removed
    const rec = findLeaveRecord(id);
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
                <div class="row"><div class="label">Jenis Cuti:</div><div class="value">${leaveTypeName(r.type)}</div></div>
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
    if (recs.length === 0) { showToast('Tiada rekod locum untuk dicetak.'); return; }
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
                <td>${r.name}</td><td>${r.branch}</td><td>${leaveTypeName(r.type)}</td>
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
  const record = findLeaveRecord(id);
  if (!record) return;
  const hasLocum2 = showLocum2Set.has(id) || record.locum2Name;
  if (hasLocum2 && record.locum2Name && (!record.locum2Phone || !record.locum2Date || !record.locum2TimeStart || !record.locum2TimeEnd)) {
      showToast('⚠️ Locum 2 tidak lengkap. Sila isi semua maklumat atau buang Locum 2.');
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
      showToast('✅ Maklumat locum berjaya dikemaskini.');
  } catch(e) {
      showToast('Ralat menyimpan: ' + e.message);
  }
};

window.setProfileSettings = function(state) {
  showProfileSettings = state;
  render();
};

window.changePassword = async function(event) {
  event.preventDefault();
  const form = event.target;
  const current = form.querySelector('#pwd-current')?.value;
  const next    = form.querySelector('#pwd-new')?.value;
  const confirm  = form.querySelector('#pwd-confirm')?.value;

  if (!user) { showToast('Sesi tidak sah. Sila log masuk semula.'); return; }
  if (!auth.currentUser || auth.currentUser.isAnonymous) { showToast('Sesi tidak sah. Sila log masuk semula.'); return; }
  if (next !== confirm) { showToast('❌ Kata laluan baharu tidak sepadan. Sila cuba lagi.'); return; }
  if ((next || '').length < 6) { showToast('❌ Kata laluan baharu mesti sekurang-kurangnya 6 aksara.'); return; }
  if (next === String(user.ic || '').trim()) { showToast('❌ Kata laluan baharu tidak boleh sama dengan No. IC anda.'); return; }

  try {
    const cred = EmailAuthProvider.credential(emailForIC(user.ic), current);
    await reauthenticateWithCredential(auth.currentUser, cred);
    await updatePassword(auth.currentUser, next);
    showToast('✅ Kata laluan berjaya ditukar!');
    showFirstLoginWarning = false;
    firstLoginPwd = '';
    try { localStorage.removeItem(MUST_CHANGE_PWD_KEY); } catch (e) {}
    ['#pwd-current', '#pwd-new', '#pwd-confirm'].forEach(sel => { const el = form.querySelector(sel); if (el) el.value = ''; });
    render();
  } catch (err) {
    console.error('changePassword error:', err);
    if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
      showToast('❌ Kata laluan semasa tidak betul. Sila cuba lagi.');
    } else {
      showToast('Ralat menukar kata laluan. Sila cuba lagi.');
    }
  }
};

window.adminSetPassword = async function(ic, newPassword) {
  if (!newPassword || newPassword.length < 6) { showToast('Kata laluan mesti sekurang-kurangnya 6 aksara.'); return false; }
  // Setting another user's password needs the Admin SDK. If the Cloud Function is
  // deployed (Blaze), this works from the app. If NOT deployed (no-Blaze setup),
  // we fall back to guiding IT to use the local reset-password.js script.
  try {
    const fn = httpsCallable(functions, 'setStaffPassword');
    await fn({ ic, newPassword });
    showToast('✅ Kata laluan staf berjaya ditetapkan.');
    return true;
  } catch (err) {
    console.error('adminSetPassword error:', err);
    if (['functions/not-found', 'functions/internal', 'functions/unavailable', 'functions/failed-precondition'].includes(err.code)) {
      showToast(`ℹ️ Set kata laluan dari aplikasi tidak tersedia (Cloud Function tidak di-deploy).\n\nIT boleh reset kata laluan staf ini melalui skrip di komputer:\n\nnode reset-password.js ${ic} <kata-laluan-baharu>`);
    } else {
      showToast('Ralat menetapkan kata laluan: ' + (err.message || err.code));
    }
    return false;
  }
};

// Definisi sebenar ada di src/nameFormat.js (dikongsi dengan normalize-names.js).
// Didedahkan pada window kerana borang memanggilnya melalui window.formatPersonName.
window.formatPersonName = formatPersonName;

window.saveSelfProfile = async function(event) {
    if (event) event.preventDefault();
    const rawName  = document.getElementById('self-name')?.value?.trim() || '';
    const rawPhone = document.getElementById('self-phone')?.value?.trim() || '';
    const email   = document.getElementById('self-email')?.value?.trim() || '';
    const address = document.getElementById('self-address')?.value?.trim() || '';

    if (!user || !user.ic) {
        showToast('Ralat: Sesi tidak sah. Sila log masuk semula.');
        return;
    }

    const name = window.formatPersonName(rawName);
    if (name.length < 3) {
        showToast('⚠️ Nama terlalu pendek. Sila masukkan nama penuh anda.');
        return;
    }
    if (name.length > 80) {
        showToast('⚠️ Nama terlalu panjang (maksimum 80 aksara).');
        return;
    }
    // Nama ialah identiti rasmi pada rekod cuti — sahkan perubahan sebenar,
    // bukan sekadar pembetulan huruf besar/kecil.
    const nameChanged = name !== (user.name || '');
    if (nameChanged && name.toLowerCase() !== String(user.name || '').toLowerCase()) {
        if (!await showConfirm(`Tukar nama daripada:\n\n"${user.name}"\n\nkepada:\n\n"${name}"\n\nNama ini akan digunakan di skrin log masuk dan pada permohonan cuti anda. Teruskan?`)) return;
    }

    // "013-652 9531" dibetulkan kepada "60136529531" — bukan ditolak. Rekod lama
    // tersimpan dengan awalan 0, dan menolaknya bermakna staf berkenaan langsung
    // tidak boleh menyimpan profil (nama sekalipun) sehingga telefon dibetulkan.
    const phone = normalizePhone(rawPhone);
    if (!isValidPhone(phone)) {
        showToast('⚠️ Nombor telefon tidak sah.\n\nContoh: 0171234678 atau 60171234678');
        return;
    }

    const previousName = user.name || '';
    const s = staffList.find(i => i.ic === user.ic);
    if (s) {
        s.name    = name;
        s.phone   = phone;
        s.email   = email;
        s.address = address;
        user.name    = name;
        user.phone   = phone;
        user.email   = email;
        user.address = address;
    }

    try {
        await updateDoc(doc(db, "staff", user.ic), { name, phone, email, address });
        // Senarai log masuk dibaca dari `directory`, bukan `staff` — tanpa ini nama
        // lama kekal di skrin log masuk. Rules benarkan staf tulis medan `name`
        // pada dokumen directory sendiri sahaja.
        if (nameChanged) {
            try {
                await updateDoc(doc(db, "directory", user.ic), { name });
            } catch (dirErr) {
                console.error("Error syncing directory name:", dirErr);
                showToast('⚠️ Nama disimpan pada profil, tetapi gagal dikemas kini pada senarai log masuk.\nSila maklumkan HR/IT — nama lama mungkin masih dipaparkan semasa log masuk.');
            }
            window.logSystemActivity(`Staff renamed self: "${previousName}" → "${name}" (${user.ic})`);
        }
    } catch (err) {
        console.error("Error saving profile:", err);
        showToast('Ralat menyimpan profil ke pangkalan data.');
        return;
    }

    showToast('✅ Profil berjaya dikemaskini!');
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
  pending:'manage_pending', staff:'manage_staff', branches:'manage_branches', reg_requests:'manage_registrations',
  roles_categories:'manage_roles_categories', hr_reports:'manage_reports',
  locum_records:'locum_records', master_audit:'manage_audit', login_audit:'manage_login_audit',
  balance_view:'manage_reports',
  routing:'manage_routing', access_control:'manage_access', public_holidays:'manage_holidays',
  whatsapp_settings:'wa_setting', policy_editor:'manage_policy'
};
// Satu sumber kebenaran untuk "boleh buka Management": mana-mana tab yang
// dibenarkan. Dulu tiga senarai berbeza (nav desktop, menu telefon, gate dalam
// renderView) — menu telefon hanya semak management/manage_pending, jadi HOD
// Cawangan (Urus Staf tanpa Kelulusan) tidak nampak Management di telefon, dan
// peranan dengan HANYA Locum/Laluan/Cuti Umum/Polisi/WhatsApp disekat terus.
window.canOpenManagement = function(u) {
  if (!u) return false;
  const p = window.effectivePerms(u);
  return Object.values(_tabPermMap).some(k => p[k] === true || p[k] === 'true');
};
// Kebenaran yang dulu ditetapkan terus dalam kod (admin/hr/super_admin) — kini
// lajur RBAC (v2.5.19). Setiap satu juga perlukan claim yang Firestore semak,
// supaya tiada butang yang muncul lalu gagal (src/rolePermissions.js claimsFor).
const _granted = v => v === true || v === 'true';
// Tab Daftar Baharu: lulus pendaftaran = cipta dokumen staff → claim manageStaff.
window.canSeeRegRequests = function(u) {
  return !!u && canSeeRegistrations(u.role, window.effectivePerms(u));
};
// Edit cuti orang lain + muat naik semula bukti → claim canApprove.
window.canEditAnyLeave = function(u) {
  if (!u) return false;
  const p = window.effectivePerms(u);
  return _granted(p.edit_leave) && claimsFor(u.role, p).canApprove;
};
window.setManageGroup = function(group) {
  managementGroup = group;
  const perms = user ? window.effectivePerms(user) : {};
  const tabs = _groupFirstTab[group] || [];
  for (const t of tabs) {
    if (t === 'reg_requests') { if (window.canSeeRegRequests(user)) { managementTab = t; break; } }
    else if (!_tabPermMap[t] || perms[_tabPermMap[t]]) { managementTab = t; break; }
  }
  render();
};
window.setManageTab = function(tab) {
  managementTab = tab;
  managementGroup = _tabToGroup[tab] || managementGroup;
  render();
};

window.setMasterLogState = function(s) {
  masterLogState = s;
  // Tukar negeri mesti reset cawangan: kombinasi Pahang + Kerteh menghasilkan
  // jadual kosong yang nampak macam pepijat, bukan macam kombinasi mustahil.
  masterLogBranch = SCOPE_ALL;
  render();
};

window.setMasterLogBranch = function(b) {
  masterLogBranch = b;
  render();
};

window.toggleMasterLogOverlap = function() {
  masterLogOverlapOnly = !masterLogOverlapOnly;
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
  const phone = normalizePhone(form.querySelector('#reg-phone').value);

  if (!name || !ic || !branch || !category || !phone) {
    showToast('Sila lengkapkan semua maklumat yang diperlukan.');
    return;
  }
  if (staffList.find(s => s.ic === ic)) {
    showToast('No. IC ini sudah berdaftar dalam sistem. Sila log masuk atau hubungi HR/Admin.');
    return;
  }
  const existing = registrationRequests.find(r => r.ic === ic && r.status === 'pending');
  if (existing) {
    showToast('Permohonan anda sedang dalam semakan. Sila tunggu kelulusan daripada HR/Admin.');
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

    showToast('✅ Permohonan anda telah dihantar!\n\nHR/Admin akan menyemak dan meluluskan akaun anda tidak lama lagi. Anda akan dihubungi melalui WhatsApp.');
    window.closeRegisterModal();
  } catch (err) {
    console.error('submitRegister error:', err);
    showToast('Ralat menghantar permohonan. Sila cuba lagi.');
  }
};

window.approveRegistration = async function(docId) {
  const req = registrationRequests.find(r => r.docId === docId);
  if (!req) return;
  if (staffList.find(s => s.ic === req.ic)) {
    showToast('No. IC ini sudah wujud dalam sistem.');
    await updateDoc(doc(db, 'registration_requests', docId), { status: 'rejected', rejectedAt: Date.now(), rejectedReason: 'IC sudah wujud' });
    return;
  }
  try {
    const newStaff = {
      name: window.formatPersonName(req.name), ic: req.ic, branch: req.branch, category: req.category,
      role: 'staff', phone: req.phone, inactive: false,
      startDate: new Date().toISOString().split('T')[0]
    };
    await setDoc(doc(db, 'staff', req.ic), newStaff);
    await updateDoc(doc(db, 'registration_requests', docId), { status: 'approved', approvedAt: Date.now() });
    window.logSystemActivity(`Approved registration: ${req.name} (${req.ic})`);
    await window.sendWhatsApp(req.phone, `✅ *Selamat datang ke KSB Leave System!*\n\nNama: ${req.name}\nKata Laluan: ${req.ic}\n\nAkaun anda sedang diaktifkan. Sila log masuk sebentar lagi dan tukar kata laluan anda.`);
    showToast(`✅ Permohonan ${req.name} telah diluluskan!\n\n⚠️ IT perlu jalankan "node provision-auth.js" untuk mengaktifkan akaun log masuk. Kata laluan awal ialah No. IC (${req.ic}).`);
  } catch (err) {
    console.error('approveRegistration error:', err);
    showToast('Ralat meluluskan permohonan.');
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
    showToast(`Permohonan ${req.name} telah ditolak.`);
  } catch (err) {
    console.error('rejectRegistration error:', err);
    showToast('Ralat menolak permohonan.');
  }
};

window.submitAddStaff = async function(event) {
  event.preventDefault();
  const form = event.target;
  // Dulu .toUpperCase() — itulah punca nama bercampur CAPS/huruf kecil dalam sistem.
  const name     = window.formatPersonName(form.querySelector('#as-name').value);
  const ic       = form.querySelector('#as-ic').value.trim();
  const branch   = form.querySelector('#as-branch').value;
  const category = form.querySelector('#as-category').value;
  const role     = form.querySelector('#as-role').value;
  // Borang ini menyimpan nombor mentah dulu — itulah punca rekod 01XXXXXXXX.
  const phone    = normalizePhone(form.querySelector('#as-phone').value);
  const initialPassword = form.querySelector('#as-password')?.value || ic;

  if (!name || !ic || !branch) {
    showToast('Sila lengkapkan Nama, No. IC, dan Cawangan.');
    return;
  }
  if (!isValidPhone(phone)) {
    showToast('⚠️ Nombor telefon tidak sah.\n\nContoh: 0171234678 atau 60171234678');
    return;
  }
  if (staffList.find(s => s.ic === ic)) {
    showToast('No. IC ini sudah wujud dalam sistem. Sila semak semula.');
    return;
  }

  const newStaff = { name, ic, branch, category, role, phone, inactive: false, startDate: new Date().toISOString().split('T')[0] };

  try {
    await setDoc(doc(db, 'staff', ic), newStaff);
    window.logSystemActivity(`Added new staff: ${name}`);
    // No-Blaze setup: the login account is created when IT runs provision-auth.js.
    // Initial password defaults to the staff's IC; IT can change it via reset-password.js.
    showToast(`✅ Staf baharu "${name}" berjaya ditambah!\n\n⚠️ IT perlu jalankan "node provision-auth.js" untuk mengaktifkan akaun log masuk. Kata laluan awal ialah No. IC (${ic}).`);
    window.closeAddStaff();
  } catch (err) {
    console.error('submitAddStaff error:', err);
    showToast('Ralat menyimpan staf. Sila cuba lagi.');
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
  // Terengganu kini 2 peringkat: Doctor PIC → HR Terengganu (Zahirah). 2026-08-03.
  terengganu:       { needs_tl: false, p1_doctor_pic: true,  p1_supervisor: false, p1_hod_balok: false, needs_p2: true  },
  pahang_lain:      { needs_tl: false, p1_doctor_pic: true,  p1_supervisor: false, p1_hod_balok: false, needs_p2: true  },
  admin_balok:      { needs_tl: false, p1_doctor_pic: false, p1_supervisor: false, p1_hod_balok: true,  needs_p2: true  },
  // Supervisor Balok — disokong Doctor PIC Balok sebelum HR (2026-08-18).
  supervisor_balok: { needs_tl: false, p1_doctor_pic: true,  p1_supervisor: false, p1_hod_balok: false, needs_p2: true  },
  doctor_pahang:    { needs_tl: false, p1_doctor_pic: false, p1_supervisor: true,  p1_hod_balok: false, needs_p2: true  },
  operation_balok:  { needs_tl: true,  p1_doctor_pic: false, p1_supervisor: true,  p1_hod_balok: false, needs_p2: true  },
  xray_sono_balok:  { needs_tl: false, p1_doctor_pic: false, p1_supervisor: true,  p1_hod_balok: false, needs_p2: true  },
  juru_audio_balok: { needs_tl: false, p1_doctor_pic: false, p1_supervisor: false, p1_hod_balok: true,  needs_p2: true  },
  pemandu_balok:    { needs_tl: false, p1_doctor_pic: false, p1_supervisor: true,  p1_hod_balok: false, needs_p2: true  },
  // KSB Pharma — Supervisor cawangan sendiri (Siti Noridah) → HR KSB Pharma (Syarifah). 2026-10-08.
  ksb_pharma:       { needs_tl: false, p1_doctor_pic: false, p1_supervisor: true,  p1_hod_balok: false, needs_p2: true  },
};
let approvalRouting = JSON.parse(JSON.stringify(ROUTING_DEFAULTS));

// Cawangan yang terletak di Terengganu tetapi kelulusan cutinya diuruskan oleh
// Balok HQ — dilayan seperti cawangan Pahang untuk routing SAHAJA. State cawangan
// kekal Terengganu untuk laporan & lokasi. (Utama, disahkan 2026-08-03.)
const ROUTES_AS_PAHANG = ['Klinik Syed Badaruddin Utama'];

// Syarikat berasingan dengan HR sendiri (2026-10-08). Cawangan ini membentuk zon HR
// tersendiri — HR Pahang/Terengganu tidak nampak, hanya HR ber-hrState sama (Syarifah
// Nurjehan untuk KSB Pharma) + Admin/Super Admin. State cawangan kekal Pahang untuk
// cuti umum. ⚠️ Disalin dalam otp-backend/lib/routing.js — kemas kini kedua-dua.
const KSB_PHARMA = 'KSB Pharma Sdn. Bhd.';
const OWN_HR_ZONE = { [KSB_PHARMA]: 'KSB Pharma' };

window.getStaffGroup = function(s) {
  const branchObj  = branches.find(b => b.name === s.branch);
  const routesAsPahang = ROUTES_AS_PAHANG.includes(s.branch);
  const isTerengganu = branchObj && branchObj.state === 'Terengganu' && !routesAsPahang;
  const isBalok      = (s.branch || '').includes('Balok');

  if (s.branch === KSB_PHARMA) return 'ksb_pharma';

  // Peranan paramedik — laluan kelulusan khusus, hanya di Balok
  if (['juru_xray', 'sonographer'].includes(s.role) && isBalok) return 'xray_sono_balok';
  if (s.role === 'juru_audio'                        && isBalok) return 'juru_audio_balok';
  if (s.role === 'pemandu'                           && isBalok) return 'pemandu_balok';

  // Supervisor yang bertugas di Balok — sokongan Doctor PIC Balok (2026-08-18).
  // Disemak SEBELUM leaveAsAdmin: kalau tidak, flag itu akan tarik dia ke HOD Balok.
  if (isBalok && s.role === 'supervisor') return 'supervisor_balok';
  // Pengecualian per-staff: Operation Staff bertanda leaveAsAdmin ikut laluan cuti
  // Admin Staff (→ HOD Balok), tetapi kekal Operation Staff di tempat lain (laporan).
  if (isBalok && s.leaveAsAdmin) return 'admin_balok';
  // Hanya Operation Staff di Balok → TL → Supervisor → HR
  if (isBalok && s.category === 'Operation Staff') return 'operation_balok';
  // Admin Staff di Balok HQ → HOD Balok
  if (isBalok && s.category === 'Admin Staff') return 'admin_balok';
  if (isTerengganu)  return 'terengganu';

  // Doktor di SEMUA cawangan Pahang → Supervisor Balok (HQ) → HR, bukan HOD.
  // Pengecualian Bentong & MCKIP dibuang (2026-08-03): Doctor PIC di kedua-dua
  // cawangan itu tiada pelulus P1 sendiri, jadi permohonan mereka tersangkut.
  if (s.category === 'Doctor' && branchObj && (branchObj.state === 'Pahang' || routesAsPahang)) {
    return 'doctor_pahang';
  }

  return 'pahang_lain';
};

window.staffNeedsP2 = function(s) {
  if (!s) return true;
  const cfg = approvalRouting[window.getStaffGroup(s)];
  return cfg ? cfg.needs_p2 !== false : true;
};

// Pengecualian Laluan Kelulusan — permohonan TERUS ke HR, skip Pelulus Peringkat 1
// (HOD / Penyelia). Sumber tunggal kebenaran untuk SEMUA bahagian (borang, padanan
// pelulus, senarai pending, kelulusan HR, paparan config):
//   (a) HOD Balok memohon cuti SENDIRI — semua jenis cuti (tak perlu HOD lain lulus).
//   (b) Supervisor memohon cuti SENDIRI — terus ke HR (2026-08-03). Supervisor &
//       HOD Balok ialah pelulus Peringkat 1; mereka tidak perlu memohon sesama sendiri.
// Doctor PIC TIDAK termasuk — mereka kekal naik ke Supervisor Balok. Team Leader juga
// tidak termasuk — cuti TL sendiri kekal ikut laluan TL → Supervisor → HR.
// (Kakitangan Admin Balok kini ikut laluan asal HOD Balok → HR/Admin untuk SEMUA
//  jenis cuti — pengecualian terus-ke-HR untuk MC/EL/ML/ML_PL telah ditarik balik.)
window.shouldSkipP1 = function(applicant, leaveType) {
  if (!applicant) return false;
  if (applicant.role === 'hod_balok') return true;                                  // (a)
  // (b) Supervisor DI LUAR Balok sahaja. Supervisor Balok kekal perlu sokongan
  //     Doctor PIC Balok pada Peringkat 1 (2026-08-18).
  if (applicant.role === 'supervisor' && !(applicant.branch || '').includes('Balok')) return true;
  // (c) HR KSB Pharma (Syarifah) — pelulus terakhir syarikat itu, lulus cuti sendiri.
  if (applicant.role === 'hr' && applicant.branch === KSB_PHARMA) return true;
  return false;
};

// pahang_lain menghala ke Doctor PIC cawangan sendiri; jika cawangan itu tiada
// Doctor PIC aktif, Supervisor Balok HQ menjadi Peringkat 1 (sebelum ini senarai
// kosong → permohonan terus ke HR tanpa sokongan).
window.usesBalokSupervisorFallback = function(group, cfg, branch) {
  return group === 'pahang_lain' && !!(cfg && cfg.p1_doctor_pic)
    && !staffList.some(s => s.role === 'doctor_pic' && s.branch === branch && !s.inactive);
};

window.getRoutingP1Approvers = function(staffMember, leaveType) {
  if (window.shouldSkipP1(staffMember, leaveType)) return [];
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
  // Cawangan Pahang TANPA Doctor PIC (cth. RPCM, 2026-10-14) → Supervisor Balok HQ
  // pada Peringkat 1, bukan terus ke HR. Selari dengan canManageRequest dan
  // otp-backend/lib/routing.js.
  if (window.usesBalokSupervisorFallback(group, cfg, staffMember.branch)) {
    candidates.push(...staffList.filter(s => s.role === 'supervisor' && s.branch === 'Klinik Syed Badaruddin Balok (HQ)' && !s.inactive && s.ic !== staffMember.ic));
  }
  if (group === 'ksb_pharma') {
    // HR Peringkat-1 KSB Pharma (Siti Noridah) — peranan HR, bukan supervisor.
    candidates.push(...staffList.filter(s => window.isP1OnlyHR(s) && s.branch === staffMember.branch && !s.inactive && s.ic !== staffMember.ic));
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
    showToast('✅ Laluan Kelulusan berjaya disimpan!');
  } catch(e) { showToast('Ralat menyimpan: ' + e.message); }
};

window.buildStateSelect = function(selectedState, docId) {
  const opts = MY_STATES.map(s => '<option value="' + s + '"' + (s === selectedState ? ' selected' : '') + '>' + s + '</option>').join('');
  return '<select data-docid="' + docId + '" onchange="window.saveBranchState(this.dataset.docid, this.value)" style="padding:0.25rem 0.5rem;border-radius:8px;border:1px solid rgba(163,177,198,0.5);background:rgba(255,255,255,0.7);color:var(--text);font-size:0.8rem;cursor:pointer;color-scheme:light;max-width:160px;">' + opts + '</select>';
};

window.saveBranchState = async function(docId, newState) {
  try {
    await updateDoc(doc(db, 'branches', docId), { state: newState, daerah: '' });
    render();
  } catch(e) { showToast('Gagal simpan negeri: ' + e.message); }
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
  } catch(e) { showToast('Gagal simpan daerah: ' + e.message); }
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
  } catch(e) { showToast('Gagal tambah: ' + e.message); }
};

window.deleteBranchById = async function(docId, name) {
  if (!await showConfirm('Padam cawangan "' + name + '"?')) return;
  try {
    await deleteDoc(doc(db, 'branches', docId));
  } catch(e) { showToast('Gagal padam: ' + e.message); }
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
  if (window.staffConfig.staffCategories.includes(name)) { showToast('Kategori sudah wujud.'); return; }
  window.staffConfig.staffCategories.push(name);
  await saveStaffConfig();
  render();
};

window.deleteStaffCategory = async function(name) {
  if (CORE_CATEGORIES.includes(name)) { showToast('Kategori teras tidak boleh dipadam.'); return; }
  if (!await showConfirm('Padam kategori "' + name + '"?')) return;
  window.staffConfig.staffCategories = window.staffConfig.staffCategories.filter(c => c !== name);
  await saveStaffConfig();
  render();
};

window.addCustomRole = async function() {
  // Peranan baharu menambah baris pada matriks RBAC — kawalan akses, Admin sahaja.
  if (!canEditAccessControl(user)) { showToast('Hanya Admin / Super Admin boleh menambah peranan.'); return; }
  const key = (prompt('Kunci peranan (huruf kecil, tiada ruang, contoh: ketua_unit):') || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (!key) return;
  if (window.rbacMatrix[key]) { showToast('Peranan sudah wujud.'); return; }
  const label = (prompt('Nama paparan peranan (contoh: Ketua Unit):') || '').trim();
  if (!label) return;
  // Add to rbacMatrix with zeroed permissions
  window.rbacMatrix[key] = { ...JSON.parse(JSON.stringify(_rbacCodeDefaults.staff)), manage_roles_categories: false };
  window.staffConfig.roleLabels[key] = label;
  window.staffConfig.customRoles.push({ key, label });
  await saveStaffConfig();
  await persistRbac();
  render();
};

window.deleteCustomRole = async function(key) {
  if (!canEditAccessControl(user)) { showToast('Hanya Admin / Super Admin boleh memadam peranan.'); return; }
  if (CORE_ROLES.includes(key)) { showToast('Peranan teras tidak boleh dipadam.'); return; }
  if (!await showConfirm('Padam peranan "' + key + '"? Staff dengan peranan ini perlu dikemas kini secara manual.')) return;
  delete window.rbacMatrix[key];
  delete window.staffConfig.roleLabels[key];
  window.staffConfig.customRoles = window.staffConfig.customRoles.filter(r => r.key !== key);
  await saveStaffConfig();
  await persistRbac();
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
    const confirmed = await showConfirm(`Adakah anda pasti untuk BUANG "${staff.name}" daripada sistem?\n\nTindakan ini tidak boleh dibatalkan.`);
    if (!confirmed) return;
    try {
        await deleteDoc(doc(db, 'staff', ic));
        window.logSystemActivity(`Deleted staff record: ${staff.name} (${ic})`);
        showToast(`"${staff.name}" berjaya dibuang dari sistem.`);
    } catch (err) {
        console.error('deleteStaff error:', err);
        showToast('Ralat semasa membuang rekod. Sila cuba lagi.');
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
    // AL absorbs EL overflow AND every EMG day: read the live fields from the same modal
    // so the displayed AL balance stays consistent with the dashboard (getLeaveStats).
    // Only AL is affected.
    let elOv = 0, emgOv = 0;
    if (prefix === 'al') {
        const elEnt = parseFloat(document.getElementById('ent-EL')?.value || 0);
        const elPre = parseFloat(document.getElementById('el-used-pre-input')?.value || 0);
        const elSysAuto = parseFloat(document.getElementById('el-sys-used-display')?.dataset.used || 0);
        const elSysManual = parseFloat(document.getElementById('el-sys-adj-input')?.value || 0);
        const elPel = parseFloat(document.getElementById('el-pelarasan-input')?.value || 0);
        elOv = computeElOverflow({ entEL: elEnt, usedPre: elPre, usedSys: autoSystemUsage ? elSysAuto : elSysManual, pelarasan: elPel });
        const noteEl = document.getElementById('al-el-overflow-note');
        if (noteEl) {
            noteEl.textContent = elOv > 0 ? `− ${elOv.toFixed(1)} hari ditolak dari limpahan Cuti Ehsan` : '';
            noteEl.style.display = elOv > 0 ? 'block' : 'none';
        }
        // EMG is not a Formula B type, so the modal has no EMG usage inputs — the approved
        // days are stashed on the ent-EL_EMG field as data-used when the modal renders.
        const emgInput = document.getElementById('ent-EL_EMG');
        const emgEnt = parseFloat(emgInput?.value || 0);
        const emgUsed = parseFloat(emgInput?.dataset.used || 0);
        emgOv = computeEmgOverflow({ entEMG: emgEnt, used: autoSystemUsage ? emgUsed : 0 });
        const emgNote = document.getElementById('al-emg-overflow-note');
        if (emgNote) {
            emgNote.textContent = emgOv > 0 ? `− ${emgOv.toFixed(1)} hari ditolak dari Cuti Kecemasan` : '';
            emgNote.style.display = emgOv > 0 ? 'block' : 'none';
        }
    }
    const balEl = document.getElementById(prefix + '-balance-display');
    if (balEl) balEl.value = Math.max(0, total - pre - sys - pel - elOv - emgOv).toFixed(1);
    // Editing EL fields must refresh the AL balance, since AL absorbs EL overflow.
    if (prefix === 'el') window._recalcLeaveBalance('al');
};
window._updateAlTotal   = () => window._recalcLeaveBalance('al');
window._updateAlBalance = () => window._recalcLeaveBalance('al');

let systemAuditLogs = [];

// Berapa banyak entri audit yang dibaca pada setiap page-load. Lihat pendengar
// audit_logs untuk sebab ia perlu berhad.
const AUDIT_LOG_LIMIT = 200;

// Masa audit datang dari serverTimestamp(), jadi nilainya boleh jadi Firestore
// Timestamp (dah disahkan server), null (tulisan sendiri yang belum sampai
// server — anggap "baru sahaja"), atau nombor epoch (rekod lama sebelum tukar).
function auditMillis(v) {
    if (v === null) return Date.now();          // pending server write = terbaru
    if (v === undefined) return 0;              // medan tiada langsung
    if (typeof v === 'number') return v;        // rekod lama (Date.now())
    if (typeof v.toMillis === 'function') return v.toMillis();
    return 0;
}

function auditTimeLabel(log) {
    const ms = auditMillis(log.createdAt);
    // Rekod lama simpan teks masa dalam log.timestamp; guna ia kalau tiada createdAt.
    if (!ms) return log.timestamp || '-';
    if (log.createdAt === null && log.timestamp) return log.timestamp;
    return new Date(ms).toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' });
}

window.logSystemActivity = async function(activityDesc, overrideUser) {
    const actUser = overrideUser || user;
    if (!actUser) return;
    
    const tzStr = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Unknown';
    const osInfo = navigator.userAgent.includes('Windows') ? 'Windows Web' : navigator.userAgent.includes('Mac') ? 'Mac OS Web' : 'Mobile/Web';
    
    const newLog = {
        id: Date.now().toString(),
        // Paparan sementara (jam peranti) sementara serverTimestamp belum sampai.
        // Sumber rasmi masa ialah createdAt di bawah.
        timestamp: new Date().toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' }),
        name: actUser.name,
        branch: actUser.branch || 'N/A',
        userId: actUser.ic,
        ip: osInfo,
        location: tzStr,
        activity: activityDesc,
        createdAt: serverTimestamp()
    };
    
    try {
        await setDoc(doc(db, "audit_logs", newLog.id), newLog);
    } catch (err) {
        console.error("Error logging activity: ", err);
    }
};

let leaveRecords = [];
// ── Mod Test (super_admin / admin) ────────────────────────────────────
// Cuti test (isTest: true) disimpan dalam koleksi `leaves` yang sama tetapi
// DIASINGKAN ke testLeaveRecords semasa snapshot — jadi `leaveRecords` (yang
// dibaca oleh baki, laporan, Analisa, kalendar, semakan pertindihan) tidak
// pernah melihatnya. Hanya panel "Cuti Test" di Borang Cuti memaparkannya.
// Server (otp-backend/api/check-reminders.js) turut melangkau isTest.
let testLeaveRecords = [];
let leaveTestMode = false;   // suis "Mod Test" pada Borang Cuti
// Semasa tindakan ke atas rekod test berjalan, testCtx = { ic, name, phone } penguji:
// sendWhatsApp & addNotification menghala SEMUA mesej kepada penguji, berlabel [TEST].
let testCtx = null;
const canUseTestMode = u => !!u && ['super_admin', 'admin'].includes(u.role);
// Cari rekod cuti mengikut id — rekod sebenar dahulu, kemudian rekod test.
const findLeaveRecord = id => leaveRecords.find(r => r.id === id) || testLeaveRecords.find(r => r.id === id);
// false sehingga snapshot pertama `leaves` sampai — dashboard tunjuk skeleton,
// bukan angka 0 yang mengelirukan. Ralat/timeout juga set true supaya tidak tersekat.
let leavesLoaded = false;
let staffList = [];

// Jenama ikut cawangan — borang Uni Klinik Bentong guna logo/nama Bentong, Klinik Rakyat
// guna KR, KSB Pharma guna logo KSB Pharma, KSBYMC guna logo KSB YMC, selebihnya KSB. Laporan tanpa cawangan (SEMUA) kekal KSB.
//   logo      — logo asal (topbar app guna medan ini juga — jangan buang).
//   hdrLogo   — logo header cetakan, margin kosong sudah dipotong; KSB/KSBYMC guna LAMBANG
//               resolusi tinggi kerana nama syarikat sudah ditaip di sebelahnya.
//   wmLogo    — watermark satu-warna (warna jenama) berlatar lutsinar. Dijana oleh
//               gen_print_assets.cjs → public/print/. Tukar logo? Jalankan semula skrip itu.
//   hdrHeight — tinggi logo header (px); wordmark lebar dipendekkan supaya seimbang dengan lambang.
const PRINT_BRANDS = {
    ksb:     { name: 'KLINIK SYED BADARUDDIN SDN. BHD.', tagline: 'Servicing Community Since 1991', logo: '/logo-ksb.png',        hdrLogo: '/print/hdr-ksb.png',     hdrHeight: 62, wmLogo: '/print/wm-ksb.png',     accent: '#9b2c2c', sub: '#c05621', wmWidth: 330, wmOpacity: 0.07 },
    bentong: { name: 'UNI KLINIK BENTONG',               tagline: '',                               logo: '/logo-bentong.png',    hdrLogo: '/print/hdr-bentong.png', hdrHeight: 44, wmLogo: '/print/wm-bentong.png', accent: '#283a6e', sub: '#d9480f', wmWidth: 440, wmOpacity: 0.07 },
    pharma:  { name: 'KSB PHARMA SDN. BHD.',             tagline: 'We care beyond drug',            logo: '/logo-ksb-pharma.png', hdrLogo: '/print/hdr-pharma.png',  hdrHeight: 54, wmLogo: '/print/wm-pharma.png',  accent: '#0f3d2e', sub: '#a8862b', wmWidth: 400, wmOpacity: 0.07 },
    ksbymc:  { name: 'KSB YPHIM MANAGE CARE SDN. BHD.',  tagline: 'KSB YMC',                        logo: '/logo-ksbymc.png',     hdrLogo: '/print/hdr-ksbymc.png',  hdrHeight: 62, wmLogo: '/print/wm-ksbymc.png',  accent: '#c81e28', sub: '#4a4a4a', wmWidth: 300, wmOpacity: 0.07 },
    kr:      { name: 'KLINIK RAKYAT DAN X-RAY DUNGUN',   tagline: 'We Care',                        logo: '/logo-kr.png',         hdrLogo: '/print/hdr-kr.png',      hdrHeight: 62, wmLogo: '/print/wm-kr.png',      accent: '#1a1a1a', sub: '#718096', wmWidth: 340, wmOpacity: 0.06 },
};
window.printBrandFor = function(branch) {
    const b = String(branch || '');
    if (/ksb pharma/i.test(b)) return PRINT_BRANDS.pharma;
    if (/ksb ?ymc|yphim/i.test(b)) return PRINT_BRANDS.ksbymc;
    if (/bentong/i.test(b)) return PRINT_BRANDS.bentong;
    if (/klinik rakyat|x-?ray dungun/i.test(b)) return PRINT_BRANDS.kr;
    return PRINT_BRANDS.ksb;
};

// Header korporat SERAGAM untuk SEMUA PDF/print. Gaya inline penuh supaya berfungsi
// dalam dokumen utama mahupun tetingkap window.open. Satu sumber tunggal.
//   opts.branch   — cawangan rekod/individu (borang). 'SEMUA'/kosong dianggap laporan.
//   opts.isReport — true untuk laporan agregat → guna main branch jika tiada cawangan.
//   opts.title    — tajuk dokumen (cth. BORANG PERMOHONAN CUTI).
//   opts.meta     — [{label,value}] baris kecil di bawah tajuk (cth. Tahun, Jenis, Jana).
// Garisan dibuat dengan border (bukan background) supaya tetap tercetak walaupun
// pengguna tidak tanda "Background graphics" dalam dialog cetak.
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
    const brand = window.printBrandFor(opts.branch);
    return `
        <img src="${brand.wmLogo}" style="position:fixed;top:52%;left:50%;transform:translate(-50%,-50%);width:${brand.wmWidth}px;max-width:70vw;opacity:${brand.wmOpacity};pointer-events:none;z-index:0;print-color-adjust:exact;-webkit-print-color-adjust:exact;" alt="">
        <div style="position:relative;z-index:1;font-family:Arial,Helvetica,sans-serif;">
            <div style="display:flex;align-items:center;gap:16px;padding-bottom:12px;">
                <img src="${brand.hdrLogo}" style="height:${brand.hdrHeight}px;max-width:200px;object-fit:contain;flex-shrink:0;" alt="Logo">
                <div style="flex:1;min-width:0;border-left:1px solid #e2e8f0;padding-left:16px;">
                    <div style="color:${brand.accent};font-size:18px;font-weight:bold;letter-spacing:0.6px;line-height:1.2;">${brand.name}</div>
                    ${brand.tagline ? `<div style="color:${brand.sub};font-size:9px;letter-spacing:2.2px;margin-top:4px;text-transform:uppercase;">${brand.tagline}</div>` : ''}
                </div>
                <div style="text-align:right;flex-shrink:0;">
                    <div style="font-size:8.5px;letter-spacing:1.6px;text-transform:uppercase;color:#a0aec0;">Cawangan</div>
                    <div style="font-size:12px;font-weight:bold;color:#2d3748;margin-top:2px;">${branchLine}</div>
                </div>
            </div>
            <div style="border-top:3px solid ${brand.accent};"></div>
            <div style="border-top:1px solid ${brand.sub};opacity:0.55;margin:2px 0 ${title ? '18px' : '20px'};"></div>
            ${title ? `<div style="display:flex;align-items:center;gap:14px;margin-bottom:${metaLine ? '8px' : '22px'};">
                <div style="flex:1;border-top:1px solid #e2e8f0;"></div>
                <div style="font-size:14px;font-weight:bold;letter-spacing:3px;color:${brand.accent};white-space:nowrap;">${title}</div>
                <div style="flex:1;border-top:1px solid #e2e8f0;"></div>
            </div>` : ''}
        </div>
        ${metaLine}
    `;
};

// Cetak #print-container SELEPAS semua imej (logo + watermark) siap dimuat.
// window.print() serta-merta selepas insert → imej belum dimuat (terutama watermark
// logo-*-mark.png yang tiada dalam cache) dan tidak muncul dalam cetakan.
window.printContainerWhenReady = function() {
    const el = document.getElementById('print-container');
    if (!el) return;
    const imgs = [...el.querySelectorAll('img')].filter(img => !img.complete);
    const loaded = imgs.map(img => new Promise(res => { img.onload = img.onerror = res; }));
    const timeout = new Promise(res => setTimeout(res, 3000));
    Promise.race([Promise.all(loaded), timeout]).then(() => {
        window.print();
        el.remove();
    });
};

window.toggleAllMyRecords = function() {
    showAllMyRecords = !showAllMyRecords;
    render();
};

window.printLeave = function(id) {
    const record = findLeaveRecord(id);
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
      // elOverflow/emgOverflow are 0 for every type except AL, so this is a no-op on
      // other forms; on AL they shift the printed baseline down so BAKI CUTI matches
      // the dashboard (Cuti Ehsan spillover + every Cuti Kecemasan day).
      alAdj: (stats.usedPre || 0) + (stats.pelarasan || 0) + (stats.elOverflow || 0) + (stats.emgOverflow || 0) + (autoSystemUsage ? 0 : (stats.usedSysAdj || 0)),
      // Mod manual → jangan kira rekod diluluskan (selari dengan getLeaveStats).
      records: autoSystemUsage ? leaveRecords : [],
    });
    // KELAYAKAN CUTI TAHUNAN: untuk AL guna kelayakan tahunan penuh; jenis lain guna entitlement jenis itu.
    const kelayakan = record.type === 'AL' ? window.getEntitlementAL(staffObj) : stats.ent;
    const fmtHari = n => (Number.isFinite(n) ? (Math.round(n * 10) / 10).toString() : '0') + ' Hari';

    // Warna ikut jenama cawangan (bukan merah tetap) — kotak nilai berbingkai kelabu
    // lembut dengan jalur kiri warna jenama.
    const _brand = window.printBrandFor(record.branch);
    const _acc = _brand.accent;
    // Kotak tanda: SEMUA jenis cuti yang boleh dipohon. Sebelum ini hanya 6 jenis,
    // jadi borang MC / Kecemasan / HL / Paterniti tercetak tanpa sebarang tanda.
    const _typeBoxes = [
        ['AL', 'CUTI TAHUNAN'], ['MC', 'CUTI SAKIT'], ['EL_EMG', 'CUTI KECEMASAN'], ['EL', 'CUTI EHSAN'],
        ['HL', 'CUTI HOSPITALISASI'], ['ML', 'CUTI BERSALIN'], ['ML_PL', 'CUTI PATERNITI'], ['CME', 'CUTI CME'],
        ['RL', 'CUTI GANTI'], ['UP', 'TANPA GAJI'],
    ].map(([code, label]) => {
        const on = record.type === code || (code === 'ML_PL' && record.type === 'PL');
        return `<div style="display:flex;align-items:center;gap:7px;font-size:10px;font-weight:bold;color:${on ? _acc : '#718096'};">
            <span style="display:inline-flex;align-items:center;justify-content:center;width:13px;height:13px;border:1.5px solid ${on ? _acc : '#a0aec0'};border-radius:2px;font-size:11px;line-height:1;color:${_acc};">${on ? '✓' : ''}</span>${label}</div>`;
    }).join('');
    const _lbl = 'width:32%;padding:6px 0;color:#4a5568;font-size:10.5px;font-weight:bold;letter-spacing:0.4px;vertical-align:middle;';
    const _box = `border:1px solid #cbd5e0;border-left:3px solid ${_acc};border-radius:3px;padding:8px 11px;color:#1a202c;font-size:12px;font-weight:bold;background:rgba(255,255,255,0.85);`;
    const _row = (label, value, extra = '') => `<tr><td style="${_lbl}">${label}</td><td style="padding:4px 0;"><div style="${_box}${extra}">${value}</div></td></tr>`;

    let printHTML = `
    <div id="print-container" style="font-family: Arial, Helvetica, sans-serif; padding: 40px 44px; color: #1a202c;">
        ${window.printHeaderHTML({ branch: record.branch, title: record.isTest ? 'BORANG PERMOHONAN CUTI — TEST' : 'BORANG PERMOHONAN CUTI' })}

        <div style="position:relative;z-index:1;border:1px solid #e2e8f0;border-radius:4px;padding:12px 14px;margin-bottom:18px;">
            <div style="font-size:8.5px;letter-spacing:1.6px;color:#a0aec0;font-weight:bold;margin-bottom:9px;">JENIS CUTI</div>
            <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:9px 10px;">${_typeBoxes}</div>
        </div>

        <table style="position:relative;z-index:1;width: 100%; border-collapse: collapse;">
            ${_row('TARIKH MEMOHON CUTI', record.startDate)}
            ${_row('NAMA PEMOHON', record.name)}
            ${_row('NO. K/P', record.ic)}
            ${_row('TARIKH MULA BEKERJA', startWork)}
            ${_row('KELAYAKAN CUTI TAHUNAN', fmtHari(kelayakan))}
            ${_row('BAKI CUTI TERDAHULU', fmtHari(bakiTerdahulu))}
            <tr>
                <td style="${_lbl}">JUMLAH CUTI DIPOHON</td>
                <td style="padding:4px 0;">
                    <div style="display: flex; gap: 10px; align-items: center;">
                        <div style="${_box}flex: 1; text-align: center;">${record.days} Hari</div>
                        <span style="color: #718096; font-size: 9.5px; font-weight:bold; letter-spacing:0.4px;">TARIKH</span>
                        <div style="${_box}flex: 3;">${record.startDate} &nbsp;hingga&nbsp; ${record.endDate}</div>
                    </div>
                </td>
            </tr>
            ${_row('BAKI CUTI', fmtHari(bakiSelepas))}
            ${_row('TUGASAN DIGANTI OLEH (LOCUM)', record.locumName || record.handoverName || 'Belum Ditentukan', 'border-left-color:#a0aec0;font-weight:normal;')}
            ${_row('SEBAB CUTI', record.reason || '—', 'min-height:44px;font-weight:normal;font-style:italic;color:#2d3748;')}
        </table>

        <table style="position:relative;z-index:1;border-collapse: separate; border-spacing: 14px 0; margin: 46px -14px 0; width: calc(100% + 28px); table-layout: fixed;">
            <tr>
                ${['T/TANGAN PEMOHON', 'DISOKONG OLEH', 'DILULUSKAN / TIDAK DILULUSKAN'].map(t => `
                <td style="vertical-align:bottom;text-align:center;">
                    <div style="height:70px;"></div>
                    <div style="border-top:1px solid #4a5568;padding-top:6px;font-size:9.5px;font-weight:bold;letter-spacing:0.6px;color:#2d3748;">${t}</div>
                    <div style="font-size:8.5px;color:#a0aec0;margin-top:10px;text-align:left;">Nama:</div>
                    <div style="font-size:8.5px;color:#a0aec0;margin-top:6px;text-align:left;">Tarikh:</div>
                </td>`).join('')}
            </tr>
        </table>
    </div>
    `;
    document.body.insertAdjacentHTML('beforeend', printHTML);
    window.printContainerWhenReady();
};

window.editLeave = function(id) {
    const rec = findLeaveRecord(id);
    if (!rec) return;
    const isAdminEditor = window.canEditAnyLeave(user);
    const isOwner = rec.ic === user.ic;
    const isApprover = window.canManageRequest(user, rec) || window.canCorrectBranchLeave(user, rec);
    const finalized = ['APPROVED', 'REJECTED', 'CANCELLED'].includes(rec.status);
    // Staf/pelulus hanya boleh ubah semasa belum diluluskan muktamad; HR/Admin boleh bila-bila (pembetulan rekod).
    if (!isAdminEditor && finalized) { showToast('Permohonan ini sudah selesai dan tidak boleh diubah.'); return; }
    if (!isAdminEditor && !isOwner && !isApprover) { showToast('Anda tidak mempunyai kebenaran untuk mengubah permohonan ini.'); return; }
    editingLeaveId = id;
    render();
};

// Kira semula bilangan hari (cadangan) bila tarikh diubah dalam modal edit.
// Nilai boleh ditindih manual selepas ini.
window.recalcEditLeaveDays = function() {
    const rec = findLeaveRecord(editingLeaveId);
    if (!rec) return;
    const s = document.querySelector('#el-start')?.value;
    const e = document.querySelector('#el-end')?.value;
    const daysEl = document.querySelector('#el-days');
    if (!s || !e || !daysEl) return;
    daysEl.value = window.computeLeaveDays(s, e, staffList.find(x => x.ic === rec.ic), rec.type);
};

// Cuti berasaskan HARI KALENDAR berturut-turut mengikut undang-undang — tidak
// langkau hujung minggu/cuti umum walaupun untuk staf admin (Cuti Bersalin 98,
// Paterniti 7, Hospitalisasi 60).
const CALENDAR_DAY_LEAVE_TYPES = ['ML', 'ML_PL', 'HL'];

// Chargeable leave-day count for a staff member over a date range.
// Admin Staff skip their zone's rest days + their state's public holidays; everyone
// else counts all calendar days. Calendar-day leave types (ML/ML_PL/HL) ALWAYS
// count calendar days regardless of category. Returns whole days (callers apply half-day).
//
// The rest days differ by zone — Pahang rests Sat+Sun, Terengganu rests Fri+Sat —
// so the branch state drives BOTH the holiday list and the weekend. Use the branch's
// own `state`, never window.scopeStateOfBranch(): Klinik Utama is physically in
// Terengganu and keeps the Terengganu weekend, even though ROUTES_AS_PAHANG sends
// its leave approvals through Balok HQ. Routing and geography are separate concerns.
window.computeLeaveDays = function(startDate, endDate, staff, leaveType) {
  const isAdmin = !!staff && (staff.category === 'Admin Staff' || staff.category === 'Admin' || staff.leaveAsAdmin === true);
  const calendarOnly = CALENDAR_DAY_LEAVE_TYPES.includes(leaveType);
  let holidayDates = [];
  let weekendDays = weekendDaysForState(null); // Pahang default
  if (isAdmin && !calendarOnly) {
    const branchObj = branches.find(b => b.name === (staff.branch || ''));
    const state = branchObj ? branchObj.state : null;
    const list = state === 'Terengganu' ? publicHolidays.terengganu
               : state === 'Pahang'     ? publicHolidays.pahang
               : [];
    holidayDates = (list || []).map(h => h.date);
    weekendDays = weekendDaysForState(state);
  }
  return countLeaveDays(startDate, endDate, isAdmin, holidayDates, calendarOnly, weekendDays);
};

// Auto-pulih tempoh cuti untuk rekod yang MASIH MENUNGGU sahaja.
// `days` dibekukan pada masa hantar (src/main.js: newRecord.days). Jika tetapan
// berubah SELEPAS staf hantar — cth. staf ditanda leaveAsAdmin, atau cuti umum
// ditambah ke Polisi Cuti Umum — rekod PENDING dikira semula & disimpan supaya
// paparan kelulusan + potongan baki mengikut tetapan terkini.
// Rekod APPROVED/REJECTED/CANCELLED KEKAL BEKU: getLeaveStats menjumlahkan
// days rekod APPROVED, jadi mengira semula rekod sejarah akan mengubah baki lalu
// secara senyap. Rekod muktamad sengaja tidak disentuh (integriti perakaunan).
const FINAL_LEAVE_STATUSES = ['APPROVED', 'REJECTED', 'CANCELLED'];
function selfHealPendingLeaveDays() {
  if (!Array.isArray(staffList) || !staffList.length) return;      // staf belum dimuat
  if (!Array.isArray(leaveRecords) || !leaveRecords.length) return;
  leaveRecords.forEach(rec => {
    if (!rec || FINAL_LEAVE_STATUSES.includes(rec.status)) return; // hanya belum muktamad
    const staff = staffList.find(s => s.ic === rec.ic);
    if (!staff) return;
    let recomputed = window.computeLeaveDays(rec.startDate, rec.endDate, staff, rec.type);
    if (!(recomputed > 0)) return;                 // jangan timpa dengan 0 / nilai tak sah
    // Rekod tak simpan flag separuh hari — kesan pecahan .5 tersimpan & kekalkannya.
    const stored = parseFloat(rec.days || 0);
    if (Math.abs((stored % 1) - 0.5) < 1e-9) recomputed -= 0.5;
    if (Math.abs(recomputed - stored) < 1e-9) return;              // sudah betul
    updateDoc(doc(db, 'leaves', (rec.docId || rec.id).toString()), { days: recomputed })
      .catch(err => console.warn('selfHealPendingLeaveDays skip', rec.id, err?.code || err));
  });
}

// Staff edits their OWN leave's dates/reason. Resets to PENDING (re-approval),
// after a before→after confirmation of exactly what changed.
// NOTA: fungsi ini kini TIADA titik panggilan (call site) di seluruh repo —
// tiada butang menggunakannya. Ia menulis startDate/endDate melalui updateDoc
// TANPA semakan pertindihan (overlap guard). Jika ia disambungkan semula pada
// masa depan (cth. butang baharu), WAJIB tambah semakan findOverlappingLeaves
// dahulu — sama seperti modal edit (#edit-leave-form) sudah buat.
window.staffEditOwnLeave = async function(id) {
  const rec = findLeaveRecord(id);
  if (!rec) return;
  if (rec.ic !== user.ic) { showToast('Anda hanya boleh mengubah permohonan anda sendiri.'); return; }
  if (['APPROVED', 'REJECTED', 'CANCELLED'].includes(rec.status)) {
    showToast('Permohonan ini sudah selesai dan tidak boleh diubah.'); return;
  }

  const newStart = prompt('Tarikh Mula (YYYY-MM-DD):', rec.startDate);
  if (newStart === null) return;
  const newEnd = prompt('Tarikh Akhir (YYYY-MM-DD):', rec.endDate);
  if (newEnd === null) return;
  const newReason = prompt('Sebab:', rec.reason);
  if (newReason === null) return;
  const _reasonErr = validateLeaveReason(newReason);
  if (_reasonErr) { showToast(_reasonErr); return; }

  // Build a diff of only what changed.
  const changes = [];
  if (newStart !== rec.startDate) changes.push(`• Tarikh Mula: ${rec.startDate} → ${newStart}`);
  if (newEnd !== rec.endDate)     changes.push(`• Tarikh Akhir: ${rec.endDate} → ${newEnd}`);
  if (newReason !== rec.reason)   changes.push(`• Sebab: "${rec.reason}" → "${newReason}"`);
  if (!changes.length) { showToast('Tiada perubahan dibuat.'); return; }

  const days = window.computeLeaveDays(newStart, newEnd, staffList.find(s => s.ic === rec.ic) || user, rec.type);
  if (days <= 0) {
    showToast('Tarikh yang dipilih tiada hari bekerja untuk staf pentadbiran. Sila pilih tarikh yang merangkumi hari bekerja (Isnin–Jumaat).');
    return;
  }

  const warn = rec.status !== 'PENDING'
    ? '\n\n⚠️ Permohonan ini telah disokong/diluluskan separa. Mengubahnya akan MENETAPKAN SEMULA status ke PENDING dan proses kelulusan akan bermula semula.'
    : '';
  if (!await showConfirm(`Sahkan perubahan berikut?\n\n${changes.join('\n')}\n\nTempoh baharu: ${days} hari${warn}`)) return;

  try {
    await updateDoc(doc(db, 'leaves', id.toString()), {
      startDate: newStart, endDate: newEnd, reason: newReason, days, status: 'PENDING',
    });
    window.logSystemActivity(`Staff edited own leave ${id} (reset to PENDING)`);
    // Re-notify approvers that this needs (re-)action.
    const applicant = staffList.find(s => s.ic === rec.ic) || user;
    const approvers = window.getRoutingP1Approvers(applicant, rec.type).filter(s => s.phone);
    const info = `\n\n👤 Pemohon: *${applicant.name}*\n📅 Tarikh: ${newStart} → ${newEnd}\n⏱ Tempoh: ${days} hari\n💬 Sebab: ${newReason}\n\n🔗 https://cuti-staff.ksbsb.com.my`;
    approvers.forEach(a => window.sendWhatsApp(a.phone, `🔁 *PERMOHONAN CUTI DIKEMASKINI — Perlu Sokongan Semula*${info}`));
    window.notifyApproversInbox(window.getRoutingP1Approvers(applicant, rec.type),
      '🔁 Cuti Dikemaskini — Perlu Sokongan Semula',
      `${applicant.name} mengubah permohonan cuti (kini ${newStart} → ${newEnd}); memerlukan sokongan semula.`,
      id.toString(), rec.ic, applicant);
    showToast('✅ Permohonan dikemaskini. Status ditetapkan semula ke PENDING untuk kelulusan semula.');
  } catch (err) {
    console.error('staffEditOwnLeave error:', err);
    showToast('Ralat mengemaskini permohonan. (Mungkin status telah berubah — sila muat semula.)');
  }
};

window.deleteLeave = async function(id) {
    if(await showConfirm("Padam rekod cuti ini? Tindakan ini tidak boleh dibatalkan.")) {
        try {
            await deleteDoc(doc(db, "leaves", id.toString()));
            showToast("Rekod cuti berjaya dipadam.");
        } catch (err) {
            console.error("Error deleting document: ", err);
            showToast("Ralat memadam rekod.");
        }
    }
};

window.finalizeLeave = async function(id) {
    const record = findLeaveRecord(id);
    if(record) {
        // Kebenaran: hanya pelulus yang menguruskan staf/cawangan ini boleh meluluskan/menyokong.
        // Selari dengan tapisan UI senarai kelulusan dan guard rejectLeave/cancelLeave.
        if (!window.canManageRequest(user, record)) {
            showToast('Anda tidak mempunyai kebenaran untuk meluluskan permohonan cawangan/staf ini.');
            return;
        }

        // ── Halang kelulusan yang bertindih dengan cuti yang SUDAH diluluskan ──
        // DI ATAS SEKALI, sebelum semua cabang peringkat. Cabang-cabang itu
        // menghantar WhatsApp SEBELUM tulisan (2503/2512/2598 vs updateDoc di
        // 2617), jadi sekatan yang diletak kemudian akan memberitahu pemohon
        // cutinya diluluskan, kemudian tidak meluluskannya.
        //
        // Kerana `newStatus` belum wujud di sini, sekatan ini meliputi SEMUA
        // peringkat (TL, HOD, HR) — itu memang niatnya: menyokong rekod yang
        // bertindih dengan cuti yang sudah diluluskan tetap salah, cuma salah
        // lebih awal.
        //
        // Guna leaveTypeLabel, BUKAN leaveTypeName — `const leaveTypeName` di
        // bawah (2490) berada dalam blok yang SAMA, jadi merujuknya di sini
        // melontar ReferenceError (temporal dead zone). Build tidak menangkapnya.
        const _apprDup = findApprovedOverlaps(
            leaveRecords, record.ic, record.startDate, record.endDate, { excludeId: record.id }
        );
        if (_apprDup.length > 0) {
            showToast('⛔ TIDAK BOLEH DILULUSKAN — BERTINDIH\n\n' +
                  'Staf ini sudah ada cuti DILULUSKAN untuk tarikh yang sama:\n\n' +
                  describeOverlaps(_apprDup, leaveTypeLabel) + '\n\n' +
                  'Meluluskan permohonan ini akan menolak baki dua kali.\n' +
                  'Sila batalkan rekod yang bertindih itu terlebih dahulu.\n\n' +
                  'Jika anda bukan HR/Admin: tolak permohonan ini, atau hubungi HR untuk membatalkan rekod bertindih.');
            return;
        }

        const applicant = staffList.find(s => s.ic === record.ic);
        if (applicant && applicant.category === 'Doctor') {
            const hasLocum2 = showLocum2Set.has(record.id) || record.locum2Name;
            if (hasLocum2 && record.locum2Name && (!record.locum2Phone || !record.locum2Date || !record.locum2TimeStart || !record.locum2TimeEnd)) {
                showToast("⚠️ Locum Kedua tidak lengkap. Sila lengkapkan atau buang Locum Kedua sebelum meneruskan.");
                return;
            }
        }

        const isFullBoss = window.isFinalApprover(user);
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
            const supMsg = `📋 *SOKONGAN TEAM LEADER — PERLU NILAI SUPERVISOR (Peringkat 1)*\n\nPermohonan cuti telah disokong oleh *${user.name} (TEAM LEADER)* dan menunggu penilaian anda.\n\n👤 Pemohon: *${record.name}*\n🏥 Cawangan: ${record.branch}\n📝 Jenis Cuti: ${leaveTypeName}\n📅 Tarikh: ${record.startDate} → ${record.endDate}\n⏱ Tempoh: ${record.days} hari\n💬 Sebab: ${record.reason}\n\n🔗 *Log masuk untuk menilai:* https://cuti-staff.ksbsb.com.my\n_— KSB Leave System_`;
            supervisors.forEach(sup => window.sendWhatsApp(sup.phone, supMsg));
            // Inbox kepada Supervisor Balok (selari dengan WhatsApp)
            window.notifyApproversInbox(
                staffList.filter(s => s.role === 'supervisor' && (s.branch || '').includes('Balok')),
                '📥 Cuti Perlu Penilaian Supervisor (Peringkat 1)',
                `${record.name} — ${leaveTypeName} (${record.startDate} → ${record.endDate}) telah disokong Team Leader; memerlukan penilaian anda.`,
                id.toString(), record.ic, record);
            if (applicant && applicant.phone) {
                const staffMsg = `📋 *DIKEMASKINI — Permohonan Cuti Anda*\n\nSalam ${applicant.name},\n\nPermohonan cuti anda telah *disokong oleh Team Leader*.\n\n• Jenis: ${leaveTypeName}\n• Tarikh: ${record.startDate} → ${record.endDate}\n\nPermohonan kini menunggu *penilaian Supervisor*. Anda akan dimaklumkan selepas kelulusan akhir.\n\n🔗 *Log masuk:* https://cuti-staff.ksbsb.com.my\n_— KSB Leave System_`;
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
                    showToast('⛔ Permohonan ini masih menunggu kelulusan Supervisor (Peringkat 1). HR/Admin hanya boleh luluskan selepas Supervisor lulus.');
                    return;
                }
            }
            // Jika PENDING, minta pengesahan — bezakan "tiada pelulus berdaftar" vs "bypass sengaja"
            if (record.status === 'PENDING') {
                const _ap = applicant || staffList.find(s => s.ic === record.ic);
                const _directHR = (record.directHR != null) ? !!record.directHR : window.shouldSkipP1(_ap, record.type);
                const _noP1 = !_directHR && !!(_ap && window.getRoutingP1Approvers(_ap, record.type).length === 0);
                const _confirmMsg = _directHR
                    ? `Permohonan ${leaveTypeName} bagi ${record.name} dilaluankan TERUS ke HR (tanpa HOD) mengikut polisi.\n\nLuluskan sekarang?`
                    : _noP1
                    ? `Staf ${record.name} tiada Pelulus Peringkat 1 (HOD/Supervisor) berdaftar untuk cawangan/kategori ini.\n\nLuluskan terus sebagai HR/Admin?`
                    : `⚠️ Permohonan ini BELUM dinilai oleh HOD/Supervisor.\n\nAdakah anda pasti mahu luluskan terus (bypass) bagi ${record.name}?`;
                if (!await showConfirm(_confirmMsg)) return;
            }
            newStatus = "APPROVED";
            const approvedName = (applicant || {}).name || record.name;
            const approvedMsg = `✅ *CUTI DILULUSKAN — KSB Leave Apply*\n\nSalam ${approvedName},\n\nPermohonan cuti anda telah *DILULUSKAN SEPENUHNYA* oleh HR/Admin.\n\n📋 *Butiran Cuti:*\n• Jenis: ${leaveTypeName}\n• Tarikh: ${record.startDate} → ${record.endDate}\n• Tempoh: ${record.days} hari\n• Sebab: ${record.reason}\n\nTerima kasih. Selamat bercuti! 🎉\n\n🔗 *Log masuk:* https://cuti-staff.ksbsb.com.my\n_— KSB Leave System_`;
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
                const admins = window.hrRecipientsForBranch(record.branch).filter(s => s.phone);
                const p1Label = isTLApprovedOperationBalok ? 'SUPERVISOR (selepas Team Leader)' : window.isP1OnlyHR(user) ? 'PELULUS PERTAMA' : (user.role || '').toUpperCase();
                const p1Title = isTLApprovedOperationBalok ? 'SOKONGAN SUPERVISOR' : `SOKONGAN ${p1Label}`;
                const msg = `📋 *${p1Title} — PERLU KELULUSAN HR/ADMIN (Peringkat 2)*\n\nPermohonan cuti telah dinilai dan disokong oleh *${user.name} (${p1Label})* dan menunggu kelulusan akhir anda.\n\n👤 Pemohon: *${record.name}*\n🏥 Cawangan: ${record.branch}\n📝 Jenis Cuti: ${leaveTypeName}\n📅 Tarikh: ${record.startDate} → ${record.endDate}\n⏱ Tempoh: ${record.days} hari\n💬 Sebab: ${record.reason}\n\n🔗 *Log masuk untuk kelulusan akhir:* https://cuti-staff.ksbsb.com.my\n_— KSB Leave System_`;
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
                    window.hrRecipientsForBranch(record.branch),
                    '📥 Cuti Perlu Kelulusan Akhir (Peringkat 2)',
                    `${record.name} — ${leaveTypeName} (${record.startDate} → ${record.endDate}) telah disokong ${p1Label}; memerlukan kelulusan akhir HR/Admin.`,
                    id.toString(), record.ic, record);
                if (applicant && applicant.phone) {
                    const staffMsg = `📋 *DIKEMASKINI — Permohonan Cuti Anda*\n\nSalam ${applicant.name},\n\nPermohonan cuti anda telah *dinilai dan disokong oleh ${user.name} (${p1Label})*.\n\n• Jenis: ${leaveTypeName}\n• Tarikh: ${record.startDate} → ${record.endDate}\n\nPermohonan kini sedang menunggu *kelulusan akhir HR/Admin*. Anda akan dimaklumkan selepas kelulusan akhir.\n\n🔗 *Log masuk:* https://cuti-staff.ksbsb.com.my\n_— KSB Leave System_`;
                    window.sendWhatsApp(applicant.phone, staffMsg);
                }
            } else {
                // Tiada Peringkat 2 — terus APPROVED
                newStatus = "APPROVED";
                const hodApprovedName = (applicant || {}).name || record.name;
                const hodApprovedMsg = `✅ *CUTI DILULUSKAN — KSB Leave Apply*\n\nSalam ${hodApprovedName},\n\nPermohonan cuti anda telah *DILULUSKAN* oleh *${user.name}* (${p1Label}).\n\n📋 *Butiran Cuti:*\n• Jenis: ${leaveTypeName}\n• Tarikh: ${record.startDate} → ${record.endDate}\n• Tempoh: ${record.days} hari\n• Sebab: ${record.reason}\n\nTerima kasih. Selamat bercuti! 🎉\n\n🔗 *Log masuk:* https://cuti-staff.ksbsb.com.my\n_— KSB Leave System_`;
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
                window.addNotification(record.ic, 'leave_approved', '✅ Cuti Diluluskan!', `Permohonan cuti anda (${leaveTypeName}, ${record.startDate} → ${record.endDate}, ${record.days} hari) telah DILULUSKAN sepenuhnya oleh ${user.name}.`, id.toString(), user);
            } else if (isTLApproval) {
                window.addNotification(record.ic, 'leave_tl_approved', '📋 Cuti Disokong Team Leader', `Permohonan cuti anda (${leaveTypeName}, ${record.startDate} → ${record.endDate}) telah disokong oleh Team Leader dan sedang menunggu penilaian Supervisor.`, id.toString(), user);
            } else {
                window.addNotification(record.ic, 'leave_p1_approved', '📋 Cuti Disokong Peringkat 1', `Permohonan cuti anda (${leaveTypeName}, ${record.startDate} → ${record.endDate}) telah disokong oleh ${user.name} dan sedang menunggu kelulusan akhir HR/Admin.`, id.toString(), user);
            }


            showToast(isFinalApproval
                ? `✅ Cuti Diluluskan!${waFinalFeedback}`
                : isTLApproval
                ? `📋 Sokongan Team Leader (Peringkat 0) Berjaya! Permohonan dihantar kepada Supervisor untuk dinilai.${tlWaFeedback}`
                : `📋 Sokongan Peringkat 1 Berjaya! Permohonan dihantar kepada HR/Admin untuk kelulusan akhir.${waHRFeedback}`);
        } catch (err) {
            console.error("Error updating document: ", err);
            showToast("Ralat mengemaskini status cuti.");
        }
    }
};

window.resendApprovalWA = async function(id) {
    const record = findLeaveRecord(id);
    if (!record) return showToast('Rekod tidak dijumpai.');
    if (record.status !== 'APPROVED') return showToast('Hanya rekod yang sudah DILULUSKAN boleh dihantar semula.');

    const applicant = staffList.find(s => s.ic === record.ic);
    if (!applicant) return showToast('Maklumat staf tidak dijumpai.');
    if (!applicant.phone) return showToast(`Nombor telefon ${applicant.name} belum didaftarkan dalam sistem.\n\nSila kemaskini nombor telefon dalam profil staf.`);
    if (!WHATSAPP_ENABLED()) return showToast('Token WhatsApp belum dikonfigurasi.\n\nPergi ke Pengurusan → Tetapan WhatsApp untuk simpan token Fonnte.');

    const leaveTypeName = leaveCategories.find(c => c.id === record.type)?.name || record.type;
    const msg = `✅ *CUTI DILULUSKAN — KSB Leave Apply*\n\nSalam ${applicant.name},\n\nPermohonan cuti anda telah *DILULUSKAN SEPENUHNYA* oleh HR/Admin.\n\n📋 *Butiran Cuti:*\n• Jenis: ${leaveTypeName}\n• Tarikh: ${record.startDate} → ${record.endDate}\n• Tempoh: ${record.days} hari\n• Sebab: ${record.reason}\n\nTerima kasih. Selamat bercuti! 🎉\n\n🔗 *Log masuk:* https://cuti-staff.ksbsb.com.my\n_— KSB Leave System_`;

    try {
        await window.sendWhatsApp(applicant.phone, msg, true);
        showToast(`✅ Notifikasi WhatsApp berjaya dihantar semula kepada ${applicant.name}.`);
    } catch(err) {
        showToast(`❌ Gagal menghantar WhatsApp.\n\nRalat: ${err.message}\n\nSila pastikan token Fonnte masih sah.`);
    }
};

window.cancelLeave = async function(id) {
    const req = findLeaveRecord(id);
    if (!req) return;

    const finalRbac = window.effectivePerms(user);
    if (!finalRbac.can_cancel) {
        showToast('Anda tidak mempunyai kebenaran (RBAC) untuk membatalkan cuti ini.');
        return;
    }

    if (!window.canManageRequest(user, req) && !window.canCorrectBranchLeave(user, req)) {
        showToast('Anda tidak mempunyai kebenaran untuk menguruskan cawangan/staf ini.');
        return;
    }

    if (!await showConfirm(`Adakah anda pasti mahu MEMBATALKAN cuti ${req.name}?\nStatus akan ditukar ke BATAL.`)) return;

    try {
        await updateDoc(doc(db, "leaves", id.toString()), { status: 'CANCELLED' });
        window.logSystemActivity(`Cancelled Leave for ${req.name}`);
        showToast(`Cuti ${req.name} berjaya dibatalkan.`);
        
        const staff = staffList.find(s => s.ic === req.ic);
        if (staff && staff.phone) {
            const leaveTypeName = leaveCategories.find(c => c.id === req.type)?.name || req.type;
            const msg = `🚩 *PEMBATALAN CUTI*\n\nPermohonan cuti anda (${leaveTypeName}) pada ${req.startDate} telah *DIBATALKAN* oleh ${(user.role || '').toUpperCase()}.\n\nBaki cuti anda telah dikembalikan.\n\n🔗 *Log masuk:* https://cuti-staff.ksbsb.com.my\n_— KSB Leave System_`;
            window.sendWhatsApp(staff.phone, msg);
        }
    } catch (err) {
        console.error("Error cancelling leave: ", err);
        showToast("Ralat membatalkan cuti.");
    }
};

window.rejectLeave = async function(id) {
    const record = findLeaveRecord(id);
    if (!record) return;

    // Kebenaran: hanya pelulus yang menguruskan staf/cawangan ini boleh menolak.
    // canManageRequest membenarkan Team Leader menolak rekod PENDING op-Balok yang diuruskannya.
    if (!window.canManageRequest(user, record)) {
        showToast('Anda tidak mempunyai kebenaran untuk menolak permohonan cawangan/staf ini.');
        return;
    }

    const leaveTypeName = leaveCategories.find(c => c.id === record.type)?.name || record.type;
    if (!await showConfirm(`Adakah anda pasti mahu MENOLAK permohonan cuti ${record.name}?\n(${leaveTypeName}, ${record.startDate} → ${record.endDate})\n\nStatus akan ditukar ke DITOLAK dan pemohon akan dimaklumkan.`)) return;

    try {
        await updateDoc(doc(db, "leaves", id.toString()), { status: "REJECTED" });
        window.logSystemActivity(`Rejected Leave for ${record.name}`);
        window.addNotification(record.ic, 'leave_rejected', '❌ Cuti Ditolak', `Maaf, permohonan cuti anda (${leaveTypeName}, ${record.startDate} → ${record.endDate}) telah DITOLAK. Sila hubungi HR/Admin untuk maklumat lanjut.`, id.toString(), user);

        // Notify applicant of rejection
        const applicant = staffList.find(s => s.ic === record.ic);
        if (applicant && applicant.phone) {
            const msg = `❌ *CUTI TIDAK DILULUSKAN — KSB Leave Apply*\n\nSalam ${applicant.name},\n\nMaaf, permohonan cuti anda telah *DITOLAK*.\n\n📋 *Butiran Cuti:*\n• Jenis: ${leaveTypeName}\n• Tarikh: ${record.startDate} → ${record.endDate}\n• Tempoh: ${record.days} hari\n\nSila hubungi HR/Admin untuk maklumat lanjut.\n\n🔗 *Log masuk:* https://cuti-staff.ksbsb.com.my\n_— KSB Leave System_`;
            window.sendWhatsApp(applicant.phone, msg);
        }
        showToast(`Permohonan cuti ${record.name} telah ditolak.`);
    } catch (err) {
        console.error("Error rejecting leave: ", err);
        showToast("Ralat menolak permohonan cuti.");
    }
};

window.resendLeaveWA = function(id) {
    const record = findLeaveRecord(id);
    if (!record) return;
    const applicant = staffList.find(s => s.ic === record.ic);
    const leaveTypeName = (leaveCategories.find(c => c.id === record.type) || {}).name || record.type;
    const info = `\n\n👤 Pemohon: *${record.name}*\n🏥 Cawangan: ${record.branch}\n📝 Jenis Cuti: ${leaveTypeName}\n📅 Tarikh: ${record.startDate} → ${record.endDate}\n⏱ Tempoh: ${record.days} hari\n💬 Sebab: ${record.reason}\n\n🔗 *Log masuk untuk meluluskan:* https://cuti-staff.ksbsb.com.my\n_— KSB Leave System_`;

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
        } else if (record.directHR || (applicant && window.shouldSkipP1(applicant, record.type))) {
            // Terus ke HR (skip HOD): peringatan kepada HR zon rekod + Admin
            recipients = window.hrRecipientsForBranch(record.branch).filter(s => s.phone);
            msg = `🔔 *PERINGATAN — Permohonan Cuti Menunggu Kelulusan HR*\n\nPermohonan cuti di bawah dilaluankan terus ke HR dan masih menunggu kelulusan.${info}`;
        } else {
            // PENDING routing auto: peringatan kepada semua P1 approver
            recipients = window.getRoutingP1Approvers(applicant || { branch: record.branch, category: record.category }, record.type).filter(s => s.phone);
            msg = `🔔 *PERINGATAN — Permohonan Cuti Menunggu Sokongan Anda (Peringkat 1)*\n\nPermohonan cuti di bawah masih menunggu sokongan anda.${info}`;
        }
    } else if (record.status === 'TL APPROVED') {
        // TL dah sokong — peringatan kepada Supervisor Balok
        recipients = staffList.filter(s => s.role === 'supervisor' && (s.branch || '').includes('Balok') && s.phone && !s.inactive);
        msg = `🔔 *PERINGATAN — Permohonan Cuti Menunggu Nilai Anda (Peringkat 1)*\n\nPermohonan cuti telah disokong Team Leader dan masih menunggu penilaian *Supervisor*.${info}`;
    } else if (record.status === 'HOD APPROVED' || record.status === 'HOD RECOMMENDED') {
        // Peringkat 1 dah lulus — peringatan kepada HR zon rekod + Admin
        recipients = window.hrRecipientsForBranch(record.branch).filter(s => s.phone);
        msg = `🔔 *PERINGATAN — Permohonan Cuti Menunggu Kelulusan Akhir Anda (Peringkat 2)*\n\nPermohonan cuti telah disokong dan masih menunggu kelulusan akhir *HR/Admin*.${info}`;
    }

    if (!recipients.length) {
        showToast('⚠️ Tiada penerima dijumpai untuk dihantar peringatan WA.');
        return;
    }
    recipients.forEach(r => window.sendWhatsApp(r.phone, msg));
    const names = recipients.map(r => r.name).join(', ');
    showToast(`📲 Peringatan WA dihantar semula kepada:\n${names}`);
};

window.setHrReportTab = function(tab) { hrReportTab = tab; render(); };
window.setPolicyTab = function(tab) { policyTab = tab; render(); };
window.setApprovedReportBranch = function(val) { approvedReportBranch = val; render(); };
window.setApprovedReportType = function(val) { approvedReportType = val; render(); };
window.setApprovedReportYear = function(val) { approvedReportYear = val; render(); };
window.setApprovedReportMonth = function(val) { approvedReportMonth = val; render(); };

// ---- Tutup Tahun (annual leave-year rollover) ----
window.openYearEndPreview = function(year) {
  if (window.isSubsidiaryHR(user)) return;
  const activeStaff = staffList.filter(s => !s.inactive);
  yearEndPreview = computeYearEndRollover({ staffList: activeStaff, getStats: window.getLeaveStats, year });
  yearEndProcessing = false;
  render();
};
window.closeYearEndModal = function() { yearEndPreview = null; yearEndProcessing = false; render(); };
window.confirmYearEnd = async function() {
  if (!yearEndPreview || yearEndProcessing) return;
  const plan = yearEndPreview;
  yearEndProcessing = true; render();
  try {
    // Apply each staff's rollover patch, then record the close marker.
    for (const row of plan.rows) {
      await updateDoc(doc(db, 'staff', row.ic), buildStaffRolloverPatch(row, plan.year));
    }
    await setDoc(doc(db, 'config', 'leaveYear'),
      { lastClosed: plan.year, closedAt: Date.now(), closedBy: user?.name || user?.ic || '' },
      { merge: true });
    yearEndPreview = null; yearEndProcessing = false; render();
    showToast(`Tutup Tahun ${plan.year} selesai. ${plan.rows.length} staf dikemaskini · CF ${plan.year + 1} = ${plan.totals.totalCF} hari · ${plan.totals.totalForfeited} hari hangus.`);
  } catch (e) {
    console.error('Tutup Tahun gagal:', e);
    yearEndProcessing = false; render();
    showToast('Ralat semasa Tutup Tahun: ' + (e?.message || e) + '\nSebahagian staf mungkin sudah dikemaskini — semak sebelum cuba semula.');
  }
};
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
    ${window.printHeaderHTML({ isReport: true, branch: branchName, title: 'LAPORAN BAKI CUTI BULANAN', meta: [{ label: 'Jenis', value: leaveTypeName(leaveType) }, { label: 'Tahun', value: year }, { label: 'Jana', value: new Date().toLocaleString('ms-MY') }] })}
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
          const bal = r.balance;
          const balPrint = Math.max(bal, 0);
          return `<tr style="border-bottom:1px solid #e2e8f0;background:${i%2===0?'#fff':'#faf5ff'};">
            <td style="padding:5px 8px;font-weight:700;font-size:9px;">${r.name}</td>
            <td style="padding:5px 8px;color:#6d28d9;font-size:8px;">${r.branch}</td>
            ${r.monthlyUsed.map(d=>`<td style="padding:5px 4px;text-align:center;${d>0?'font-weight:700;color:#059669;':''}">${d>0?d:''}</td>`).join('')}
            <td style="padding:5px 6px;text-align:center;font-weight:800;color:#7c3aed;">${r.totalUsed.toFixed(1)}</td>
            <td style="padding:5px 6px;text-align:center;font-weight:700;">${r.entitlement}</td>
            <td style="padding:5px 6px;text-align:center;font-weight:800;${bal<=0?'color:#dc2626;':'color:#059669;'}">${balPrint.toFixed(1)}</td>
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
          <td style="padding:6px 6px;text-align:center;font-weight:800;color:#059669;">${rows.reduce((s,r)=>s+r.balance,0).toFixed(1)}</td>
        </tr>
      </tfoot>
    </table>
    <div style="margin-top:12px;font-size:9px;color:#718096;border-top:1px solid #e2e8f0;padding-top:8px;">
      * Baki cuti dikira berdasarkan status APPROVED (selari dengan paparan dashboard staf). Breakdown bulanan berdasarkan tarikh permohonan. Entitlement AL dikira mengikut pro-rata jika berkaitan.
    </div>
    <button onclick="window.print()" style="margin-top:12px;padding:7px 18px;background:#7c3aed;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:700;">PRINT / SIMPAN PDF</button>
  </div>`;
  document.body.insertAdjacentHTML('beforeend', printHTML);
  window.printContainerWhenReady();
};

// Shared branch/type/month/year predicate for the "Cuti Diluluskan" report (screen + PDF).
// Month is based on Tarikh Cuti (startDate); when a month is chosen the year is also read
// from startDate so "Julai 2026" means leave starting in July 2026. With "Semua Bulan" the
// year keeps the existing Tarikh Mohon (r.id) basis. Does NOT check status/scope — callers do.
function matchesApprovedReportFilters(r) {
  if (approvedReportBranch !== 'SEMUA' && r.branch !== approvedReportBranch) return false;
  if (approvedReportType !== 'SEMUA' && r.type !== approvedReportType) return false;
  if (approvedReportMonth !== 'SEMUA') {
    const d = new Date(r.startDate);
    if (isNaN(d.getTime())) return false;
    if (d.getMonth() + 1 !== Number(approvedReportMonth)) return false;
    if (approvedReportYear !== 'SEMUA' && d.getFullYear().toString() !== approvedReportYear) return false;
    return true;
  }
  if (approvedReportYear !== 'SEMUA' && (!r.id || new Date(r.id).getFullYear().toString() !== approvedReportYear)) return false;
  return true;
}

window.generateApprovedReport = function() {
  const _MONTHS_MS = ['Januari','Februari','Mac','April','Mei','Jun','Julai','Ogos','September','Oktober','November','Disember'];
  const monthLabel = approvedReportMonth === 'SEMUA' ? 'Semua Bulan' : _MONTHS_MS[Number(approvedReportMonth) - 1];
  // Laporan ini ("Cuti Diluluskan") tidak pernah ditapis mengikut zon — HR
  // Terengganu boleh muat turun PDF zon Pahang. Tapis mengikut zon dahulu
  // (padanan generateLeaveReport), kemudian sempitkan lagi mengikut
  // getUserReportDaerah/getUserReportBranch supaya PDF sepadan dengan
  // scopedRecords/approvedFiltered yang dipaparkan di skrin tab hr_reports.
  const _apprReportBranch = window.getUserReportBranch(user);
  const _apprReportDaerah = window.getUserReportDaerah(user);
  const _apprZoned = filterByScope(leaveRecords, {
    userScope: window.getUserStateScope(user),
    stateOfBranch: window.scopeStateOfBranch,
  }).filter(r => {
    if (_apprReportBranch) return r.branch === _apprReportBranch;
    if (_apprReportDaerah) {
      const rb = branches.find(b => b.name === r.branch);
      return !!rb && rb.daerah === _apprReportDaerah;
    }
    return true;
  });
  const recs = _apprZoned.filter(r => r.status === 'APPROVED' && matchesApprovedReportFilters(r));
  const totalDays = recs.reduce((s, r) => s + parseFloat(r.days || 0), 0);
  const printHTML = `
  <div id="print-container" style="font-family:Arial,sans-serif;padding:24px;color:#111;background:#fff;">
    ${window.printHeaderHTML({ isReport: true, branch: approvedReportBranch, title: 'LAPORAN CUTI DILULUSKAN', meta: [{ label: 'Jenis', value: approvedReportType === 'SEMUA' ? 'Semua' : approvedReportType }, { label: 'Bulan', value: monthLabel }, { label: 'Tahun', value: approvedReportYear }, { label: 'Jana', value: new Date().toLocaleDateString('ms-MY',{day:'2-digit',month:'long',year:'numeric'}) }] })}
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
          <td style="padding:7px 10px;font-weight:700;color:#059669;">${leaveTypeName(r.type)}</td>
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
      * Laporan ini dijana secara automatik oleh KSB Leave Apply System pada ${new Date().toLocaleString('ms-MY')}. Rekod yang dipaparkan adalah berstatus APPROVED sahaja.${approvedReportMonth !== 'SEMUA' ? ' Tapisan bulan mengikut Tarikh Cuti (tarikh mula cuti).' : ''}
    </div>
    <button onclick="window.print()" style="margin-top:16px;padding:8px 20px;background:#059669;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:700;">PRINT / SIMPAN PDF</button>
  </div>`;
  document.body.insertAdjacentHTML('beforeend', printHTML);
  window.printContainerWhenReady();
};

// ── Shared print-report helpers (used by printAllLeaveReport + printLeaveTypeReport) ──
const REPORT_MONTHS_MS = ['Januari','Februari','Mac','April','Mei','Jun','Julai','Ogos','September','Oktober','November','Disember'];
const LEAVE_TYPE_COLOR = { AL:'#3b82f6', MC:'#10b981', EL:'#f59e0b', EL_EMG:'#ef4444', HL:'#06b6d4', ML:'#ec4899', ML_PL:'#6366f1', CME:'#8b5cf6', RL:'#14b8a6', UP:'#64748b' };
const ALL_LEAVE_TYPES = ['AL','MC','EL','EL_EMG','HL','ML','ML_PL','CME','RL','UP'];

// Active staff within the current user's report scope (same predicate as the attendance/CME report).
function getReportStaffPool() {
  const reportBranch = window.getUserReportBranch(user);
  const reportDaerah = window.getUserReportDaerah(user);
  const userStateScope = window.getUserStateScope(user);
  const activeBranch = attendanceReportBranch;
  return staffList.filter(s => {
    if (s.inactive) return false;
    if (reportBranch && s.branch !== reportBranch) return false;
    if (activeBranch && activeBranch !== 'SEMUA' && s.branch !== activeBranch) return false;
    const bObj = branches.find(b => b.name === s.branch);
    if (!bObj && userStateScope !== 'all') return false;
    if (bObj && userStateScope !== 'all' && window.scopeStateOfBranch(s.branch) !== userStateScope) return false;
    if (bObj && reportDaerah && bObj.daerah !== reportDaerah) return false;
    return true;
  });
}

function fmtLeaveDate(d) {
  if (!d) return '-';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return `${dt.getDate()} ${REPORT_MONTHS_MS[dt.getMonth()]} ${dt.getFullYear()}`;
}
function fmtLeaveRange(r) {
  return (r.startDate && r.endDate && r.startDate !== r.endDate)
    ? `${fmtLeaveDate(r.startDate)} – ${fmtLeaveDate(r.endDate)}` : fmtLeaveDate(r.startDate || r.endDate);
}

// Build HTML for the given leave-type sections. Returns { html, sectionCount, grandTotal, staffCount }.
// Only staff with >=1 APPROVED record of a type in `year` are listed (sorted branch, then name);
// empty sections are skipped. Per staff: Kelayakan/Guna/Baki from getLeaveStats, or Guna only when ent===0.
function renderLeaveSections(types, pool, year) {
  let grandTotal = 0, sectionCount = 0, staffCount = 0;
  const html = types.map(type => {
    const perStaff = pool.map(s => {
      const recs = leaveRecords
        .filter(r => r.ic === s.ic && r.type === type && r.status === 'APPROVED' && leaveYearOf(r) === year)
        .sort((a,b) => (a.startDate||'').localeCompare(b.startDate||''));
      return { s, recs };
    }).filter(x => x.recs.length > 0)
      .sort((a,b) => (a.s.branch||'').localeCompare(b.s.branch||'') || a.s.name.localeCompare(b.s.name));

    if (!perStaff.length) return '';
    sectionCount++;
    staffCount += perStaff.length;
    const accent = LEAVE_TYPE_COLOR[type] || '#334155';
    const blocks = perStaff.map(({ s, recs }) => {
      const st = window.getLeaveStats(s, type);
      const used = recs.reduce((acc,r) => acc + parseFloat(r.days||0), 0);
      grandTotal += used;
      const summary = st.ent > 0
        ? `Kelayakan: ${Math.round(st.ent)} &nbsp;|&nbsp; Guna: ${parseFloat(st.used.toFixed(1))} &nbsp;|&nbsp; Baki: ${parseFloat(st.bal.toFixed(1))}`
        : `Guna: ${parseFloat(used.toFixed(1))}`;
      const rows = recs.map(r => `<div style="padding:3px 0 3px 18px;font-size:11px;color:#334155;">• ${fmtLeaveRange(r)} &nbsp;(${parseFloat(r.days||0)} hari)&nbsp; ${r.reason ? '— ' + r.reason : ''}</div>`).join('');
      return `
        <div style="margin-bottom:10px;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;">
          <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 12px;background:${accent}12;border-bottom:1px solid #e2e8f0;">
            <div style="font-size:12px;font-weight:700;color:${accent};">${s.name} <span style="font-weight:500;color:#64748b;">— ${s.branch || '-'}</span></div>
            <div style="font-size:11px;font-weight:700;color:#334155;">${summary}</div>
          </div>
          <div style="padding:6px 12px;">${rows}</div>
        </div>`;
    }).join('');
    return `
      <div style="margin-bottom:22px;">
        <div style="padding:8px 12px;background:${accent};color:#fff;font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:1px;border-radius:4px;margin-bottom:10px;">${leaveTypeName(type)}</div>
        ${blocks}
      </div>`;
  }).join('');
  return { html, sectionCount, grandTotal, staffCount };
}

window.printAllLeaveReport = function() {
  const year = window.getCurrentLeaveYear();
  const activeBranch = attendanceReportBranch;
  const pool = getReportStaffPool();
  const { html: sections, sectionCount, grandTotal } = renderLeaveSections(ALL_LEAVE_TYPES, pool, year);

  const pw = window.open('', '_blank');
  pw.document.write(`<!DOCTYPE html><html><head>
    <meta charset="UTF-8">
    <title>Laporan Cuti Kakitangan — ${year}</title>
    <style>
      *{margin:0;padding:0;box-sizing:border-box;}
      body{font-family:Arial,sans-serif;padding:24px;color:#111;background:#fff;}
      .print-btn{margin:16px 0;text-align:right;}
      .print-btn button{padding:8px 20px;background:#334155;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:700;font-size:12px;}
      @media print{.print-btn{display:none;} body{padding:16px;}}
    </style>
  </head><body>
    <div class="print-btn"><button onclick="window.print()">🖨️ PRINT / SIMPAN PDF</button></div>
    ${window.printHeaderHTML({ isReport: true, branch: activeBranch, title: 'LAPORAN CUTI KAKITANGAN', meta: [{ label: 'Tahun', value: String(year) }, { label: 'Bilangan', value: pool.length + ' kakitangan' }] })}
    ${sectionCount ? sections : '<div style="padding:24px;text-align:center;color:#64748b;font-size:12px;">Tiada rekod cuti diluluskan bagi tahun ini dalam skop ini.</div>'}
    <div style="margin-top:14px;padding-top:10px;border-top:2px solid #cbd5e1;font-size:11px;font-weight:700;color:#334155;display:flex;gap:24px;">
      <span>Jumlah kakitangan (skop): ${pool.length}</span>
      <span>Seksyen jenis cuti: ${sectionCount}</span>
      <span>Jumlah hari cuti diluluskan: ${parseFloat(grandTotal.toFixed(1))} hari</span>
    </div>
    <div style="margin-top:14px;font-size:9px;color:#718096;border-top:1px solid #e2e8f0;padding-top:8px;">
      Laporan dijana oleh KSB Leave Apply System pada ${new Date().toLocaleString('ms-MY')}. Rekod berstatus APPROVED, tahun ${year}.
    </div>
  </body></html>`);
  pw.document.close();
};

window.printLeaveTypeReport = function(type) {
  const year = window.getCurrentLeaveYear();
  const activeBranch = attendanceReportBranch;
  const pool = getReportStaffPool();
  const { html: sections, sectionCount, grandTotal, staffCount } = renderLeaveSections([type], pool, year);
  const typeName = leaveTypeName(type);

  const pw = window.open('', '_blank');
  pw.document.write(`<!DOCTYPE html><html><head>
    <meta charset="UTF-8">
    <title>Laporan ${typeName} — ${year}</title>
    <style>
      *{margin:0;padding:0;box-sizing:border-box;}
      body{font-family:Arial,sans-serif;padding:24px;color:#111;background:#fff;}
      .print-btn{margin:16px 0;text-align:right;}
      .print-btn button{padding:8px 20px;background:#334155;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:700;font-size:12px;}
      @media print{.print-btn{display:none;} body{padding:16px;}}
    </style>
  </head><body>
    <div class="print-btn"><button onclick="window.print()">🖨️ PRINT / SIMPAN PDF</button></div>
    ${window.printHeaderHTML({ isReport: true, branch: activeBranch, title: 'LAPORAN ' + typeName.toUpperCase(), meta: [{ label: 'Tahun', value: String(year) }, { label: 'Bilangan', value: staffCount + ' kakitangan' }] })}
    ${sectionCount ? sections : `<div style="padding:24px;text-align:center;color:#64748b;font-size:12px;">Tiada rekod cuti ${typeName} diluluskan bagi tahun ini dalam skop ini.</div>`}
    <div style="margin-top:14px;padding-top:10px;border-top:2px solid #cbd5e1;font-size:11px;font-weight:700;color:#334155;display:flex;gap:24px;">
      <span>Bilangan kakitangan: ${staffCount}</span>
      <span>Jumlah hari diluluskan: ${parseFloat(grandTotal.toFixed(1))} hari</span>
    </div>
    <div style="margin-top:14px;font-size:9px;color:#718096;border-top:1px solid #e2e8f0;padding-top:8px;">
      Laporan dijana oleh KSB Leave Apply System pada ${new Date().toLocaleString('ms-MY')}. Rekod berstatus APPROVED, tahun ${year}.
    </div>
  </body></html>`);
  pw.document.close();
};

window.printCMEReport = function() {
  const MONTHS_MS = ['Januari','Februari','Mac','April','Mei','Jun','Julai','Ogos','September','Oktober','November','Disember'];
  const year = window.getCurrentLeaveYear();
  const reportBranch = window.getUserReportBranch(user);
  const reportDaerah = window.getUserReportDaerah(user);
  const userStateScope = window.getUserStateScope(user);
  const activeBranch = attendanceReportBranch;

  // Active doctors within the current user's report scope (same predicate as the attendance report).
  const doctors = staffList.filter(s => {
    if (s.category !== 'Doctor' || s.inactive) return false;
    if (reportBranch && s.branch !== reportBranch) return false;
    if (activeBranch && activeBranch !== 'SEMUA' && s.branch !== activeBranch) return false;
    const bObj = branches.find(b => b.name === s.branch);
    if (!bObj && userStateScope !== 'all') return false;
    if (bObj && userStateScope !== 'all' && window.scopeStateOfBranch(s.branch) !== userStateScope) return false;
    if (bObj && reportDaerah && bObj.daerah !== reportDaerah) return false;
    return true;
  }).sort((a,b) => (a.branch||'').localeCompare(b.branch||'') || a.name.localeCompare(b.name));

  const fmtDate = d => {
    if (!d) return '-';
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return d;
    return `${dt.getDate()} ${MONTHS_MS[dt.getMonth()]} ${dt.getFullYear()}`;
  };
  const fmtRange = r => (r.startDate && r.endDate && r.startDate !== r.endDate)
    ? `${fmtDate(r.startDate)} – ${fmtDate(r.endDate)}` : fmtDate(r.startDate || r.endDate);

  let totUsed = 0, totBal = 0;
  const blocks = doctors.map(s => {
    const st = window.getLeaveStats(s, 'CME');
    const ent = window.getEntitlementCME(s);
    totUsed += st.used; totBal += st.bal;
    const recs = leaveRecords
      .filter(r => r.ic === s.ic && r.type === 'CME' && r.status === 'APPROVED' && leaveYearOf(r) === year)
      .sort((a,b) => (a.startDate||'').localeCompare(b.startDate||''));
    const rows = recs.length
      ? recs.map(r => `<div style="padding:3px 0 3px 18px;font-size:11px;color:#334155;">• ${fmtRange(r)} &nbsp;(${parseFloat(r.days||0)} hari)&nbsp; ${r.reason ? '— ' + r.reason : ''}</div>`).join('')
      : `<div style="padding:3px 0 3px 18px;font-size:11px;color:#94a3b8;font-style:italic;">(tiada cuti CME direkodkan)</div>`;
    return `
      <div style="margin-bottom:12px;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 12px;background:#f5f3ff;border-bottom:1px solid #e2e8f0;">
          <div style="font-size:12px;font-weight:700;color:#5b21b6;">${s.name} <span style="font-weight:500;color:#64748b;">— ${s.branch || '-'}</span></div>
          <div style="font-size:11px;font-weight:700;color:#334155;">Kelayakan: ${Math.round(ent)} &nbsp;|&nbsp; Guna: ${parseFloat(st.used.toFixed(1))} &nbsp;|&nbsp; Baki: ${parseFloat(st.bal.toFixed(1))}</div>
        </div>
        <div style="padding:6px 12px;">${rows}</div>
      </div>`;
  }).join('');

  const pw = window.open('', '_blank');
  pw.document.write(`<!DOCTYPE html><html><head>
    <meta charset="UTF-8">
    <title>Laporan Cuti CME — Doktor — ${year}</title>
    <style>
      *{margin:0;padding:0;box-sizing:border-box;}
      body{font-family:Arial,sans-serif;padding:24px;color:#111;background:#fff;}
      .print-btn{margin:16px 0;text-align:right;}
      .print-btn button{padding:8px 20px;background:#5b21b6;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:700;font-size:12px;}
      @media print{.print-btn{display:none;} body{padding:16px;}}
    </style>
  </head><body>
    <div class="print-btn"><button onclick="window.print()">🖨️ PRINT / SIMPAN PDF</button></div>
    ${window.printHeaderHTML({ isReport: true, branch: activeBranch, title: 'LAPORAN CUTI CME — DOKTOR', meta: [{ label: 'Tahun', value: String(year) }, { label: 'Bilangan', value: doctors.length + ' doktor' }] })}
    ${doctors.length ? blocks : '<div style="padding:24px;text-align:center;color:#64748b;font-size:12px;">Tiada doktor dalam skop ini.</div>'}
    <div style="margin-top:14px;padding-top:10px;border-top:2px solid #cbd5e1;font-size:11px;font-weight:700;color:#334155;display:flex;gap:24px;">
      <span>Jumlah: ${doctors.length} doktor</span>
      <span>Jumlah Guna: ${parseFloat(totUsed.toFixed(1))} hari</span>
      <span>Jumlah Baki: ${parseFloat(totBal.toFixed(1))} hari</span>
    </div>
    <div style="margin-top:14px;font-size:9px;color:#718096;border-top:1px solid #e2e8f0;padding-top:8px;">
      Laporan CME dijana oleh KSB Leave Apply System pada ${new Date().toLocaleString('ms-MY')}. Rekod berstatus APPROVED, tahun ${year}.
    </div>
  </body></html>`);
  pw.document.close();
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
    if (bObj && userStateScope !== 'all' && window.scopeStateOfBranch(s.branch) !== userStateScope) return false;
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
    const cmeSt = isDoctor ? window.getLeaveStats(s, 'CME') : null;
    const al = ml['AL']||0, mc = ml['MC']||0;
    const el = (ml['EL']||0)+(ml['EL_EMG']||0), up = ml['UP']||0;
    const last = isDoctor ? ((ml['CME']||0)+(ml['RL']||0)) : ((ml['HL']||0)+(ml['ML']||0)+(ml['ML_PL']||0));
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
      ${isDoctor ? `<td style="padding:5px 8px;text-align:center;font-size:10px;font-weight:700;color:#6d28d9;">${fmtBal(cmeSt.bal,cmeSt.ent)}</td>` : ''}
    </tr>`;
  }).join('');

  const renderSection = (title, arr, isDoctor) => {
    if (!arr.length) return '';
    const lastHdr = isDoctor ? 'CME+RL' : 'LL';
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
            <th style="padding:7px 6px;text-align:center;font-size:10px;color:#d97706;">CL+EL</th>
            <th style="padding:7px 6px;text-align:center;font-size:10px;color:#64748b;">UPL</th>
            <th style="padding:7px 6px;text-align:center;font-size:10px;color:${lastColor};">${lastHdr}</th>
            <th style="padding:7px 8px;text-align:center;font-size:10px;color:#1d4ed8;border-left:1px solid #e2e8f0;">Baki Cuti</th>
            <th style="padding:7px 8px;text-align:center;font-size:10px;color:#065f46;">Baki MC</th>
            ${isDoctor ? `<th style="padding:7px 8px;text-align:center;font-size:10px;color:#6d28d9;">Baki CME</th>` : ''}
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
            <td style="padding:7px 6px;text-align:center;">${isDoctor ? (arr.reduce((s,x)=>s+((getMonthLeave(x.ic)['CME']||0)+(getMonthLeave(x.ic)['RL']||0)),0)||'-') : (arr.reduce((s,x)=>s+((getMonthLeave(x.ic)['HL']||0)+(getMonthLeave(x.ic)['ML']||0)+(getMonthLeave(x.ic)['ML_PL']||0)),0)||'-')}</td>
            <td colspan="${isDoctor ? 3 : 2}"></td>
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
      if (!rb || window.scopeStateOfBranch(r.branch) !== userStateScope) return false;
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
  const typeColors = { AL:'#3b82f6', MC:'#10b981', EL:'#f59e0b', EL_EMG:'#ef4444', UP:'#94a3b8', HL:'#06b6d4', ML:'#ec4899', ML_PL:'#6366f1', CME:'#8b5cf6', RL:'#14b8a6' };
  const printHTML = `
  <div id="print-container" style="font-family:Arial,sans-serif;padding:24px;color:#111;background:#fff;">
    ${window.printHeaderHTML({ isReport: true, branch: jenisCutiBranch, title: 'LAPORAN RINGKASAN MENGIKUT JENIS CUTI', meta: [{ label: 'Tahun', value: jenisCutiYear === 'SEMUA' ? 'Semua' : jenisCutiYear }, { label: 'Jana', value: new Date().toLocaleDateString('ms-MY',{day:'2-digit',month:'long',year:'numeric'}) }] })}
    <div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap;">
      ${activeTypes.map(t => {
        const c = typeColors[t]||'#64748b';
        return `<div style="padding:8px 14px;background:${c}18;border:1px solid ${c}44;border-radius:8px;min-width:80px;">
          <div style="font-size:9px;font-weight:700;text-transform:uppercase;color:${c};">${leaveTypeShort(t)}</div>
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
          ${activeTypes.map(t => `<th style="padding:8px 6px;text-align:center;min-width:60px;">${leaveTypeShort(t)}</th>`).join('')}
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
  window.printContainerWhenReady();
};

window.generateLeaveReport = function() {
   // Butang ini berlabel "Semua Rekod" — maksudnya semua rekod DALAM ZON
   // pengguna, bukan semua rekod dalam sistem. Tanpa tapisan ini HR boleh
   // muat turun PDF zon yang seorang lagi HR uruskan.
   // Jadual di skrin (scopedRecords, tab hr_reports) turut menyempitkan
   // dengan getUserReportDaerah/getUserReportBranch (cth. HR "Kuantan
   // Sahaja"), jadi PDF mesti ikut sempadan yang sama — jika tidak, PDF akan
   // lebih luas daripada apa yang HR itu nampak di skrin.
   const _rptReportBranch = window.getUserReportBranch(user);
   const _rptReportDaerah = window.getUserReportDaerah(user);
   const _rptRecords = filterByScope(leaveRecords, {
     userScope: window.getUserStateScope(user),
     stateOfBranch: window.scopeStateOfBranch,
   }).filter(r => {
     if (_rptReportBranch) return r.branch === _rptReportBranch;
     if (_rptReportDaerah) {
       const rb = branches.find(b => b.name === r.branch);
       return !!rb && rb.daerah === _rptReportDaerah;
     }
     return true;
   });
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
              ${_rptRecords.map(r => `
              <tr style="border-bottom: 1px solid #e2e8f0;">
                  <td style="padding: 10px; font-weight: bold;">${r.startDate}<br><span style="color: #718096; font-weight: normal;">to ${r.endDate}</span></td>
                  <td style="padding: 10px; font-weight: bold;">${r.name}<br><span style="color: #3b82f6; font-size: 10px;">${r.branch}</span><br><span style="color: #718096; font-size: 10px;">${r.ic}</span></td>
                  <td style="padding: 10px; font-weight: bold; color: #059669;">${leaveTypeName(r.type)}</td>
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
   window.printContainerWhenReady();
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
  { name: "KSB Pharma Sdn. Bhd.",                   state: "Pahang",     daerah: "Kuantan",  manager: "Admin" },
];

// Pendengar audit_logs dipasang secara MALAS — hanya untuk peranan yang betul-betul
// ada kebenaran `manage_login_audit`.
//
// Selamat dipanggil berulang kali, dan itu memang perlu: window.rbacMatrix bermula
// dengan nilai lalai dalam kod, sedangkan settings/rbac di Firestore boleh MEMBERI
// kebenaran yang lalai itu tolak. Kalau kita nilai sekali sahaja semasa init, seorang
// admin yang dibenarkan oleh Firestore sahaja akan nampak jadual audit kosong selamanya.
// Sebab itu pendengar RBAC memanggil fungsi ini semula bila snapshotnya tiba.
let auditLogUnsub = null;
function ensureAuditLogListener() {
  if (auditLogUnsub) return;                                    // sudah dipasang
  if (!user || window.isSubsidiaryUser(user) || !canSeeAuditLogs(user.role, window.rbacMatrix)) return;
  if (view !== 'management' || managementTab !== 'login_audit') return;   // tunggu tab dibuka
  auditLogUnsub = onSnapshot(
    query(collection(db, "audit_logs"), orderBy("createdAt", "desc"), limit(AUDIT_LOG_LIMIT)),
    (snapshot) => {
      systemAuditLogs = snapshot.docs.map(doc => doc.data())
        .sort((a, b) => auditMillis(b.createdAt) - auditMillis(a.createdAt));
      render();
    },
    (e) => {
      // Lepaskan pemegang supaya percubaan seterusnya boleh pasang semula.
      console.warn('Audit log sync failed:', e);
      auditLogUnsub = null;
    }
  );
}

let waLogsLoaded = false;
async function ensureWaLogsLoaded() {
  if (waLogsLoaded || !user || window.isSubsidiaryUser(user) || !canSeeWaLogs(user.role, window.rbacMatrix)) return;
  if (view !== 'management' || managementTab !== 'whatsapp_settings') return;   // tunggu tab dibuka
  waLogsLoaded = true;
  try {
    const logsSnap = await getDocs(query(collection(db, 'wa_logs'), orderBy('ts', 'desc'), limit(200)));
    waLogs = logsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    render();
  } catch(e) { console.warn('WA logs load failed:', e); waLogsLoaded = false; }
}

// Pendengar `leaves` — staf biasa hanya cuti SENDIRI, Doctor PIC cawangannya (listenerScope).
//
// Dulu setiap pengguna memuat turun SELURUH koleksi cuti pada setiap cold load,
// dan koleksi itu bertambah dengan setiap permohonan — bacaan terbesar yang terus
// membesar di pelan Spark (50k/hari). Staf biasa (~90% pengguna) hanya melihat
// sejarah, baki dan semakan pertindihan cuti sendiri, jadi `where ic ==` memberi
// skrin yang sama dengan beberapa bacaan sahaja.
//
// Selamat dipanggil berulang kali (sama seperti ensureAuditLogListener): pendengar
// RBAC memanggilnya semula, dan jika settings/rbac memberi staf kebenaran tambahan
// skopnya dilebarkan kepada semua tanpa perlu muat semula app.
// Pendengar registration_requests — hanya untuk yang boleh buka tab Daftar Baharu
// (window.canSeeRegRequests). Peranan lain tidak pernah membacanya, jadi melanggan
// cuma membakar kuota. Borang pendaftaran awam berjalan SEBELUM log masuk (array
// kosong ketika itu), jadi gate ini tidak melemahkan semakan pendua di sana.
// Dipanggil semula oleh pendengar RBAC supaya kebenaran baharu berkuat kuasa.
let registrationUnsub = null;
function ensureRegistrationListener() {
  if (registrationUnsub || !window.canSeeRegRequests(user)) return;
  registrationUnsub = onSnapshot(subsidiaryScoped('registration_requests', 'branch'), (snapshot) => {
    registrationRequests = snapshot.docs.map(d => ({ ...d.data(), docId: d.id }))
      .sort((a, b) => (b.submittedAt || 0) - (a.submittedAt || 0));
    render();
  }, (err) => { console.warn('registration_requests listener failed:', err); registrationUnsub = null; });
}

let leavesUnsubs = [];
let leavesScope = null;
function ensureLeavesListener() {
  if (!user) return;
  // 'own' = staf biasa; 'branch' = Doctor PIC (cawangan + cuti sendiri); 'all' = lain-lain.
  const scope = listenerScope(user.role, window.effectivePerms(user));
  if (leavesUnsubs.length && leavesScope === scope) return;       // skop tidak berubah
  leavesUnsubs.forEach(u => u());
  leavesUnsubs = [];
  leavesScope = scope;
  // Pertanyaan `ic ==` lulus rules melalui klausa cuti-sendiri (firestore.rules
  // match /leaves) — tanpa itu ia ditolak kerana tidak menapis cawangan.
  const queries = scope === 'all' ? [subsidiaryScoped('leaves', 'branch')]
    : scope === 'branch' ? [query(collection(db, 'leaves'), where('branch', '==', user.branch)),
                            query(collection(db, 'leaves'), where('ic', '==', user.ic))]
    : [query(collection(db, 'leaves'), where('ic', '==', user.ic))];
  const parts = queries.map(() => []);
  const apply = () => {
    const _allLeaves = [...new Map(parts.flat().map(d => [d.id, d])).values()].map(doc => ({
      ...doc.data(),
      docId: doc.id
    })).sort((a, b) => b.id - a.id);
    leaveRecords = _allLeaves.filter(r => !r.isTest);
    testLeaveRecords = _allLeaves.filter(r => r.isTest);
    leavesLoaded = true;
    console.log(`Leave records updated from Firestore (${scope}: ${_allLeaves.length})`);
    selfHealPendingLeaveDays();
    render();
  };
  queries.forEach((q, i) => leavesUnsubs.push(onSnapshot(q, (snapshot) => {
    parts[i] = snapshot.docs;
    apply();
  }, (err) => {
    // Contoh: kuota Spark habis. Jangan biar skeleton berpusing selama-lamanya.
    console.error('leaves listener failed:', err);
    leavesUnsubs.forEach(u => u());
    leavesUnsubs = [];                       // benarkan percubaan semula
    leavesLoaded = true;
    render();
  })));
}

// Pendengar `staff` — staf biasa klinik hanya muat PELULUS + rekod sendiri.
//
// Senarai staf penuh (~120 dokumen) dibaca oleh setiap pengguna pada setiap cold
// load. Staf biasa hanya memerlukan rekod sendiri dan orang yang menerima
// permohonannya (dropdown TL, getRoutingP1Approvers, hrRecipientsForBranch →
// WhatsApp + Inbox) — semuanya ditapis ikut STAFF_APPROVER_ROLES. Jadi ~30
// bacaan dan bukan ~120. Penapis `branch !=` diperlukan oleh rules (companyOK):
// tanpanya HR KSB Pharma termasuk dan seluruh pertanyaan ditolak. `!=` hanya
// boleh untuk SATU anak syarikat ('in' tidak boleh digabung dengan 'not-in') —
// jika lebih, kembali ke senarai penuh.
//
// Gagal TERBUKA: sebarang ralat pada pertanyaan sempit (cth. indeks komposit
// belum siap) → tukar ke senarai penuh, bukan senarai kosong.
let staffUnsubs = [];
let staffScope = null;
function ensureStaffListener(forceAll = false) {
  const subs = Object.keys(OWN_HR_ZONE);
  const isSub = !!user && window.isSubsidiaryUser(user);
  const perms = user ? window.effectivePerms(user) : null;
  // firestore.rules (v2.5.22): tanpa claim canApprove/manageStaff, hanya dokumen
  // sendiri, dokumen pelulus, dan (HOD Cawangan) staf cawangan sendiri boleh
  // dibaca — pertanyaan senarai penuh akan DITOLAK. Jadi skop mesti sempit.
  const c = user ? claimsFor(user.role, perms) : { canApprove: false, manageStaff: false };
  const canReadAll = c.canApprove || c.manageStaff;
  let scope;
  if (!user) scope = 'all';
  else if (!canReadAll) scope = window.isBranchScopedHod(user) ? 'branch' : 'own';
  else if (forceAll || isSub || subs.length !== 1) scope = 'all';
  else scope = listenerScope(user.role, perms);
  if (staffUnsubs.length && staffScope === scope) return;
  staffUnsubs.forEach(u => u());
  staffUnsubs = [];
  staffScope = scope;
  if (scope === 'all') {
    staffUnsubs.push(onSnapshot(subsidiaryScoped('staff', 'branch'),
      snap => applyStaffDocs(snap.docs),
      err => console.error('staff listener failed:', err)));
    return;
  }
  // 'own': pelulus + diri sendiri. 'branch' (Doctor PIC, TL, HOD Cawangan): tambah
  // staf cawangannya — canManageRequest perlukan rekod pemohon untuk getStaffGroup().
  // Penapis cawangan pada pertanyaan pelulus diperlukan oleh rules (companyOK):
  // staf anak syarikat → syarikatnya sendiri; staf klinik → `!=` anak syarikat
  // (hanya boleh untuk SATU anak syarikat — 'in' tidak boleh digabung dengan 'not-in').
  const sources = [
    query(collection(db, 'staff'), where('role', 'in', STAFF_APPROVER_ROLES),
      isSub ? where('branch', '==', user.branch) : where('branch', '!=', subs[0])),
    doc(db, 'staff', user.ic),
  ];
  if (scope === 'branch') sources.push(query(collection(db, 'staff'), where('branch', '==', user.branch)));
  const parts = sources.map(() => []);
  const merge = () => applyStaffDocs([...new Map(parts.flat().map(d => [d.id, d])).values()]);
  // Gagal terbuka hanya bagi yang BOLEH membaca senarai penuh (cth. indeks belum
  // siap). Tanpa claim, senarai penuh pasti ditolak — jangan cuba.
  const fallback = (err) => {
    if (!canReadAll) { console.error('staff (narrow) listener failed:', err); return; }
    console.warn('staff (narrow) listener failed — falling back to full list:', err);
    staffScope = null;
    ensureStaffListener(true);
  };
  sources.forEach((src, i) => staffUnsubs.push(onSnapshot(src, snap => {
    parts[i] = snap.docs ? snap.docs : (snap.exists() ? [snap] : []);
    merge();
  }, fallback)));
}

function applyStaffDocs(docs) {
    // Susun ikut docId — pertanyaan 'not-in' menyusun ikut cawangan, bukan id.
    staffList = docs.map(doc => ({
      ...doc.data(),
      docId: doc.id
    })).sort((a, b) => (a.docId < b.docId ? -1 : a.docId > b.docId ? 1 : 0));
    
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

    // Staf mungkin dimuat SELEPAS rekod cuti — pulih semula tempoh PENDING supaya
    // perubahan leaveAsAdmin (dsb.) diambil kira walaupun susunan muat berbeza.
    selfHealPendingLeaveDays();

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
          window.initInbox();
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
}

// Koleksi untuk pendengar — pengasingan DUA HALA (firestore.rules companyOK):
//  • staf anak syarikat → dokumen syarikat sendiri sahaja;
//  • staf/HR klinik     → semua KECUALI anak syarikat;
//  • Admin/Super Admin  → semua.
// Pertanyaan MESTI ditapis begini — pertanyaan tanpa tapis akan ditolak keseluruhannya.
function subsidiaryScoped(name, field) {
  const ref = collection(db, name);
  if (window.isSubsidiaryUser(user)) return query(ref, where(field, '==', user.branch));
  if (window.isGroupAdmin(user)) return ref;
  return query(ref, where(field, 'not-in', Object.keys(OWN_HR_ZONE)));
}

async function initData() {
  if (initData._done) return;
  initData._done = true;
  console.log('Initializing Firestore listeners...');

  // Load WhatsApp token dari Firestore — supaya semua device guna token yang sama
  try {
    const waSnap = await getDoc(doc(db, 'system_config', 'whatsapp'));
    if (waSnap.exists()) {
      const cfg = waSnap.data();
      for (const [zone, field] of Object.entries(WA_TOKEN_FIELDS)) {
        if (cfg[field]) WA_TOKENS[zone] = cfg[field];
      }
      if (cfg.token) localStorage.setItem('ksb_wa_token', cfg.token);
    }
  } catch(e) { console.warn('WA token load failed:', e); }
  refreshWADevice(); // isi WA_DEVICES untuk guard self-send (fire-and-forget)

  // Load policy content — anak syarikat guna polisi syarikat sendiri, bukan polisi klinik.
  const _isSub = window.isSubsidiaryUser(user);
  try {
    if (_isSub) {
      const cpSnap = await getDoc(doc(db, 'companyPolicy', user.branch));
      if (cpSnap.exists()) {
        const d = cpSnap.data();
        Object.keys(d).forEach(k => { if (k in companyPolicy) companyPolicy[k] = d[k]; });
      }
    } else {
      const pcSnap = await getDoc(doc(db, 'config', 'policyContent'));
      if (pcSnap.exists()) {
        const d = pcSnap.data();
        Object.keys(d).forEach(k => { if (k in policyContent) policyContent[k] = d[k]; });
      }
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

  // Year-end close marker (which leave year was last rolled over). Live-synced so the
  // "Tutup Tahun" button reflects the latest state across sessions.
  onSnapshot(doc(db, 'config', 'leaveYear'), (snap) => {
    leaveYearConfig = snap.exists() ? { lastClosed: parseInt(snap.data().lastClosed || 0, 10) } : { lastClosed: 0 };
    render();
  }, (e) => console.warn('Leave-year config sync failed:', e));

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

  // Load WA notification logs (latest 200) — bukan untuk anak syarikat (rules tolak),
  // dan hanya untuk peranan yang boleh buka tab Tetapan WhatsApp (wa_setting).
  // Dulu SETIAP pengguna klinik membaca 200 dokumen ini pada setiap cold load.
  // Pendengar RBAC memanggilnya semula (seperti ensureAuditLogListener).
  ensureWaLogsLoaded();

  // Branches — seed Firestore on first run, then stay live
  onSnapshot(subsidiaryScoped('branches', 'name'), (snapshot) => {
    if (snapshot.empty && !_isSub) {
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
  ensureStaffListener();

  // Real-time Audit Logs — 200 rekod terbaru SAHAJA.
  //
  // Dulu ini onSnapshot(collection(db,"audit_logs")) tanpa had: seluruh koleksi
  // dibaca setiap kali app dibuka, oleh setiap pengguna. Koleksi itu membesar
  // dengan SETIAP log masuk, kelulusan dan kemas kini profil, jadi kos setiap
  // page-load meningkat tanpa henti — itulah yang membakar kuota harian Firestore
  // (pelan Spark) sampai habis dua kali pada 2026-08-03, sehingga tiada tulisan
  // pun boleh masuk. Paparan `login_audit` hanya jadual rata tanpa carian atau
  // pagination, jadi 200 terbaru mencukupi.
  //
  // orderBy medan tunggal + limit tidak perlukan indeks komposit.
  //
  // Had 200 itu sahaja tidak cukup: ia masih dibayar oleh SETIAP pengguna pada
  // setiap cold load, walaupun staf biasa langsung tak boleh buka skrin
  // `login_audit`. 200 bacaan itu adalah kepingan TERBESAR sesuatu page-load
  // (~475 bacaan), untuk kira-kira 90% pengguna yang tak guna pun datanya.
  // Sekarang ia dipasang hanya untuk peranan yang benar-benar ada kebenaran.
  ensureAuditLogListener();

  // Real-time Leave Records
  setTimeout(() => { if (!leavesLoaded) { leavesLoaded = true; render(); } }, 10000);
  ensureLeavesListener();

  // Real-time Registration Requests — hanya untuk yang ada tab "Daftar Baharu"
  // (RBAC manage_registrations + claim manageStaff). Lihat ensureRegistrationListener.
  ensureRegistrationListener();

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
        let needsMigration = false;
        // Migrate: add branch_analisa flag for roles missing it
        const _branchAnalisaDefaults = { super_admin: false, admin: false, hr: false, supervisor: false, staff: false };
        for (const _role of Object.keys(_branchAnalisaDefaults)) {
            if (data[_role] && data[_role].branch_analisa === undefined) {
                data[_role].branch_analisa = _branchAnalisaDefaults[_role];
                needsMigration = true;
            }
        }
        // Migrate: add report_kuantan_only + enable manage_reports for hr
        const _reportKuantanDefaults = { super_admin: false, admin: false, hr: false, supervisor: false, staff: false };
        for (const _role of Object.keys(_reportKuantanDefaults)) {
            if (data[_role] && data[_role].report_kuantan_only === undefined) {
                data[_role].report_kuantan_only = _reportKuantanDefaults[_role];
                needsMigration = true;
            }
        }
        // Migrate: add report_own_branch_only + enable manage_reports for hod
        const _reportOwnBranchDefaults = { super_admin: false, admin: false, hr: false, supervisor: false, staff: false };
        for (const _role of Object.keys(_reportOwnBranchDefaults)) {
            if (data[_role] && data[_role].report_own_branch_only === undefined) {
                data[_role].report_own_branch_only = _reportOwnBranchDefaults[_role];
                needsMigration = true;
            }
        }
        // Migrate: add report_attendance
        const _reportAttendanceDefaults = { super_admin: true, admin: true, hr: true, supervisor: false, staff: false };
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
        // Hanya Admin boleh menulis settings/rbac (firestore.rules) — klien lain
        // cuma guna data yang dimigrasi dalam memori.
        if (needsMigration && canEditAccessControl(user)) setDoc(doc(db, "settings", "rbac"), data).catch(e => console.warn('RBAC migration write skipped:', e?.code || e));
        console.log('RBAC matrix updated from Firestore');
        // Firestore boleh memberi `manage_login_audit` yang lalai dalam kod tolak.
        // Nilai semula sekarang, jika tidak pengguna itu terpaksa muat semula app
        // sebelum jadual audit terisi.
        ensureAuditLogListener();
        ensureLeavesListener();
        ensureStaffListener();
        ensureWaLogsLoaded();
        ensureRegistrationListener();
        render();
    } else {
        console.warn('RBAC matrix not found in Firestore, using defaults');
        if (canEditAccessControl(user)) setDoc(doc(db, "settings", "rbac"), window.rbacMatrix).catch(e => console.warn('RBAC seed skipped:', e?.code || e));
    }
  });
}

// Pulihkan sesi selepas refresh menggunakan SATU getDoc.
//
// Dulu ini dibuat di dalam pendengar `staff` seluruh koleksi: `user` dicari dalam
// staffList, jadi pemulihan sesi bergantung pada 122 dokumen tiba dahulu. Itu
// bermakna peranan pengguna belum diketahui semasa initData() memasang pendengar —
// mustahil hendak menggate ikut peranan. Membaca staff/{ic} terus berharga 1 bacaan
// dan bukan 122, DAN ia menjadikan `user.role` tersedia sebelum pendengar dipasang.
//
// Blok pemulihan dalam pendengar `staff` sengaja dikekalkan sebagai jaring
// keselamatan; ia menjadi no-op sebaik `user` sudah terisi di sini.
async function restoreSessionUser() {
  if (user) return true;
  const savedIC  = localStorage.getItem('ksb_logged_in_ic');
  const savedSID = localStorage.getItem('ksb_logged_in_sid');
  const forget = () => {
    localStorage.removeItem('ksb_logged_in_ic');
    localStorage.removeItem('ksb_logged_in_sid');
  };
  if (!savedIC || !savedSID) { if (savedIC || savedSID) forget(); return false; }
  if (!(auth.currentUser && !auth.currentUser.isAnonymous)) return false;
  // Sesi peranti tunggal: SID tempatan mesti sepadan, sama seperti semakan lama.
  if (localStorage.getItem('ksb_session_' + savedIC) !== savedSID) { forget(); return false; }

  let snap;
  try {
    snap = await getDoc(doc(db, 'staff', savedIC));
  } catch (e) {
    // Rangkaian mati atau kuota habis — JANGAN buang sesi. Biar jaring keselamatan
    // dalam pendengar `staff` mencuba lagi apabila data akhirnya sampai.
    console.warn('Session restore read failed:', e);
    return false;
  }
  if (!snap.exists() || snap.data().inactive) { forget(); return false; }

  user = { ...snap.data(), docId: snap.id };
  currentSessionId = savedSID;
  duplicateSessionDetected = false;
  sessionKickHandled = false;
  startSessionListener(savedIC, savedSID);
  window.initInbox();
  window.requestNotifPermission();
  startReminderScheduler();
  view = window.rbacMatrix[user.role]?.dashboard ? 'dashboard' : 'leave-form';
  try { if (localStorage.getItem(MUST_CHANGE_PWD_KEY) === user.ic) showFirstLoginWarning = true; } catch (e) {}
  console.log(`[AUTH] Session restored for ${user.name} (${user.ic})`);
  return true;
}

// Migration helper removed as data is now live on Firestore.
console.log(`[SYSTEM] Version ${APP_VERSION}`);

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
      // Mesti SEBELUM initData(): ia yang menetapkan `user.role`, dan initData
      // menggunakan peranan itu untuk memutuskan pendengar mana patut dipasang.
      const restored = await restoreSessionUser();
      // `directory` (~120 dokumen) hanya digunakan oleh skrin log masuk. Dulu ia
      // dimuat pada SETIAP cold load, termasuk pengguna yang sesinya dipulihkan
      // terus ke dashboard — bacaan sia-sia terbesar selepas leaves/staff dikecilkan.
      // Muat hanya bila skrin log masuk memang akan dipaparkan.
      if (!restored) await loadDirectory();
      initData();
      // Sengaja TIADA render() di sini: pendengar `staff` tetap akan panggil render()
      // bila datanya tiba. Melukis lebih awal hanya akan memaparkan dashboard dengan
      // senarai kosong buat seketika.
    } else {
      if (!auth.currentUser) {
        await signInAnonymously(auth);
        console.log('[AUTH] Anonymous bootstrap OK:', auth.currentUser && auth.currentUser.uid);
      }
      await loadDirectory();
      // MUST re-render: the login branch dropdown is derived from directoryList
      // (see src/loginBranches.js), and the first paint happened before this
      // resolved. Without it the branch <select> stays empty and nobody can log
      // in at all.
      render();
    }
  } catch (e) {
    console.error('[AUTH] bootstrap failed:', e.code || e.message);
    render();
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
  bentong: '/logo-bentong.png',
  pharma: '/logo-ksb-pharma.png',
  ksbymc: '/logo-ksbymc.png'
};

// Chart.js instances
let _chartMonthly = null;
let _chartTypes = null;

function initCharts() {
  const data = window._analyticsData;
  if (!data) return;

  // Trend bulanan — satu warna (warna utama sistem). Warna tidak membawa makna
  // bagi setiap bulan, jadi pelangi per-bulan dibuang (v2.5.32). Bulan semasa
  // yang belum habis dipudarkan; bila satu bulan ditapis, bulan lain dipudarkan.
  const { start, end, partial } = data.trend;
  const idx = data.monthsList.map((_, i) => i).slice(start, end + 1);
  const activeMonth = analyticsFilterMonth;
  const ink = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#9b2c2c';
  const barColor = (i) => {
    if (activeMonth && activeMonth !== i + 1) return ink + '26';
    return i === partial ? ink + '80' : ink;
  };
  const valueLabels = {
    id: 'trendValueLabels',
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      const meta = chart.getDatasetMeta(0);
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.font = '700 11px Outfit, sans-serif';
      meta.data.forEach((bar, k) => {
        const v = chart.data.datasets[0].data[k];
        if (!v) return;
        const i = idx[k];
        ctx.fillStyle = activeMonth && activeMonth !== i + 1 ? '#94a3b8' : '#1e293b';
        ctx.fillText(v, bar.x, bar.y - 4);
      });
      ctx.restore();
    }
  };

  const mc = document.getElementById('chart-monthly');
  if (mc) {
    if (_chartMonthly) { _chartMonthly.destroy(); _chartMonthly = null; }
    _chartMonthly = new Chart(mc, {
      type: 'bar',
      plugins: [valueLabels],
      data: {
        labels: idx.map(i => i === partial ? [data.monthsList[i], 'setakat kini'] : data.monthsList[i]),
        datasets: [{
          label: 'Permohonan',
          data: idx.map(i => data.monthCounts[i]),
          backgroundColor: idx.map(barColor),
          hoverBackgroundColor: idx.map(i => (activeMonth && activeMonth !== i + 1) ? ink + '55' : ink),
          borderWidth: 0,
          borderRadius: { topLeft: 4, topRight: 4 },
          borderSkipped: 'bottom',
          maxBarThickness: 36,
          categoryPercentage: 0.7,
          barPercentage: 0.9,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 18 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(15,23,42,0.92)',
            titleColor: '#f1f5f9',
            bodyColor: '#cbd5e1',
            padding: 10,
            cornerRadius: 8,
            displayColors: false,
            callbacks: {
              title: (items) => data.monthsList[idx[items[0].dataIndex]] + (data.yearLabel ? ' ' + data.yearLabel : ''),
              label: (item) => item.raw + ' permohonan' + (idx[item.dataIndex] === partial ? ' (bulan belum habis)' : ''),
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            border: { color: 'rgba(163,177,198,0.35)' },
            ticks: { color: '#5a6678', font: { size: 11, weight: '600' } },
          },
          y: {
            grid: { color: 'rgba(163,177,198,0.14)' },
            border: { display: false },
            ticks: { color: '#94a3b8', font: { size: 10 }, maxTicksLimit: 5, precision: 0 },
            beginAtZero: true,
          }
        },
        onHover: (e, elements) => { e.native.target.style.cursor = elements.length ? 'pointer' : 'default'; },
        onClick: (e, elements) => {
          if (elements.length > 0) {
            const m = idx[elements[0].index] + 1;
            window.setAnalyticsMonth(analyticsFilterMonth === m ? 0 : m);
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
        labels: entries.map(([id]) => leaveTypeName(id)),
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
        showToast("⚠️ Ralat Sistem: Gagal memaparkan dashboard. Memulakan semula...");
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

  // Branch options come from the directory, NOT from `branches` — the login screen
  // runs on an anonymous session and firestore.rules denies it the branches
  // collection, so `branches` is still the hardcoded seed array at this point.
  // It serves only as an ordering hint. See src/loginBranches.js.
  const loginBranches = deriveLoginBranches(directoryList, branches);

  console.log(`[DEBUG_LOGIN] Branch: "${selectedLoginBranch}", Total: ${directoryList.length}, Filtered: ${filteredStaff.length}, Branches: ${loginBranches.length}`);

  app.innerHTML = `
    <div class="auth-container">
      <div class="glass-pane auth-card fade-in">
        <div class="logo-group">
          <div class="logo-circle"><img src="${logos.ksb}" alt="KSB"></div>
          <div class="logo-circle logo-square"><img src="${logos.kr}" alt="KR"></div>
          <div class="logo-circle"><img src="${logos.bentong}" alt="Bentong"></div>
          <div class="logo-circle logo-square"><img src="${logos.pharma}" alt="KSB Pharma"></div>
          <div class="logo-circle"><img src="${logos.ksbymc}" alt="KSB YMC"></div>
        </div>
        <h1 class="auth-title">KLINIK SYED BADARUDDIN</h1>
        <p class="auth-subtitle">Sistem Permohonan Cuti Staf</p>

        <!-- System URL Badge -->
        <div style="margin-bottom:1rem;text-align:center;">
          <a href="https://cuti-staff.ksbsb.com.my" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:0.4rem;background:var(--primary-glow);border:1px solid var(--primary-glow);border-radius:999px;padding:0.35rem 0.9rem;font-size:0.78rem;color:var(--primary);font-weight:700;text-decoration:none;letter-spacing:0.3px;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
            cuti-staff.ksbsb.com.my
          </a>
        </div>
        
        <form id="login-form">
          <div class="form-group">
            <label>Cawangan (Branch)</label>
            <select id="login-branch" class="neu-inset" style="width: 100%; appearance: none; cursor: pointer; color-scheme: light; font-weight: 600;" onchange="window.setLoginBranch(this.value)" required>
              <option value="" disabled ${!selectedLoginBranch ? 'selected' : ''}>${loginBranches.length ? '-- Pilih Cawangan --' : '-- Memuatkan senarai cawangan... --'}</option>
              ${loginBranches.map(name => `<option value="${name}" ${selectedLoginBranch === name ? 'selected' : ''}>${name}</option>`).join('')}
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
            <div style="text-align: right; margin-top: 0.35rem;">
              <button type="button" onclick="window.refreshLoginDirectory()" style="background: none; border: none; cursor: pointer; color: var(--text-muted); font-family: inherit; font-size: 0.75rem;">Nama tiada dalam senarai? Muat semula senarai</button>
            </div>
          </div>

          <div class="form-group">
            <label>Kata Laluan</label>
            <div style="position: relative;">
              <input type="password" id="password" placeholder="••••••••" required style="width: 100%;">
            </div>
            <div style="text-align: right; margin-top: 0.5rem;">
              <button type="button" onclick="window.forgotPassword()" style="background: none; border: none; cursor: pointer; color: var(--primary); font-family: inherit; font-size: 0.9rem; font-weight: 600; padding: 0.25rem 0; display: inline-flex; align-items: center; gap: 0.35rem;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                Lupa Kata Laluan?
              </button>
            </div>
          </div>
          <button type="submit" class="btn-primary">Log Masuk</button>
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
          <p style="font-size:0.72rem;color:var(--text-muted);letter-spacing:0.3px;margin:0;line-height:1.6;">© 2026 Klinik Syed Badaruddin Sdn. Bhd. · Hak Cipta Terpelihara<br><span style="font-size:0.66rem;opacity:0.8;">Dibangunkan oleh KSBSB IT @ LukhzzIsZa</span></p>
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
      const findTyped = () => directoryList.find(s =>
        (s.branch || "").trim().toLowerCase() === (selectedLoginBranch || "").trim().toLowerCase() &&
        s.name.toLowerCase() === typedName);
      let matched = findTyped();
      // Senarai mungkin dari cache lapuk (staf baru) — semak semula dari pelayan sekali.
      if (!matched) { await loadDirectory({ force: true }); matched = findTyped(); }
      if (matched) ic = matched.ic;
    }

    if (!ic) { showToast('Sila pilih nama anda dari senarai (dropdown) atau pastikan ejaan nama betul.'); return; }
    if (!pwd) { showToast('Sila masukkan kata laluan.'); return; }

    try {
      await signInWithEmailAndPassword(auth, emailForIC(ic), pwd);
    } catch (err) {
      console.warn('[AUTH_FAIL]', err.code);
      if (err.code === 'auth/user-disabled') showToast('⚠️ Akaun anda tidak aktif. Sila hubungi HR/Admin.');
      else showToast('⚠️ RALAT: IC atau kata laluan tidak sah. Sila cuba lagi.');
      return;
    }

    // Load the staff profile for the now-authenticated user.
    const snap = await getDoc(doc(db, 'staff', ic));
    if (!snap.exists()) { showToast('Profil staf tidak dijumpai. Sila hubungi HR/Admin.'); await signOut(auth); return; }
    // HR menyahaktif staf dengan `inactive` pada dokumen staf, tetapi akaun Auth
    // hanya dimatikan bila provision-one.js dijalankan (Spark: tiada onStaffWrite).
    // Tanpa semakan ini staf yang sudah dinyahaktif masih boleh log masuk.
    if (snap.data().inactive) { showToast('⚠️ Akaun anda tidak aktif. Sila hubungi HR/Admin.'); await signOut(auth); return; }
    user = snap.data();
    initData(); // subscribe to live data now that we have a real (non-anonymous) session

    showFirstLoginWarning = (pwd === (user.ic || '').trim());
    // Wajib tukar: bendera bertahan selepas reload (localStorage) sehingga berjaya
    // ditukar — modal tiada butang "abaikan". Kata laluan semasa disimpan dalam
    // memori sahaja supaya borang tidak perlu ditaip semula.
    try {
      if (showFirstLoginWarning) { firstLoginPwd = pwd; localStorage.setItem(MUST_CHANGE_PWD_KEY, user.ic); }
      else localStorage.removeItem(MUST_CHANGE_PWD_KEY);
    } catch (e) {}
    const _ph = (user.phone || '').replace(/\D/g, '');
    showPhoneReminderModal = !showFirstLoginWarning && (!_ph || !_ph.startsWith('6'));
    currentSessionId = Date.now().toString() + '_' + Math.random().toString(36).substring(2);
    duplicateSessionDetected = false;
    sessionKickHandled = false;
    localStorage.setItem('ksb_session_' + user.ic, currentSessionId);
    localStorage.setItem('ksb_logged_in_ic', user.ic);
    localStorage.setItem('ksb_logged_in_sid', currentSessionId);
    setDoc(doc(db, 'sessions', user.ic), {
      sessionId: currentSessionId, loginAt: serverTimestamp(), name: user.name,
      device: navigator.userAgent.slice(0, 150)
    }).then(() => startSessionListener(user.ic, currentSessionId));
    window.logSystemActivity("Logged into system");
    window.initInbox();
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

// CME entitlement (doctors-only, default 5). ent_CME is an optional HR override.
// Mirrors getEntitlementMC. Delegates the rule to the pure computeCMEEntitlement helper.
window.getEntitlementCME = function(staffObj) {
  if (!staffObj) return 0;
  return computeCMEEntitlement({ category: staffObj.category, ent_CME: staffObj.ent_CME });
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

// Single source of truth for the "current leave year" (calendar year).
window.getCurrentLeaveYear = function() { return new Date().getFullYear(); };

// The leave year a record is consumed in = the year the leave STARTS (startDate),
// falling back to the application year (r.id) when startDate is missing.
function leaveYearOf(r) {
  if (r.startDate) { const d = new Date(r.startDate); if (!isNaN(d.getTime())) return d.getFullYear(); }
  if (r.id) return new Date(r.id).getFullYear();
  return null;
}

window.getLeaveStats = function(staff, type, year) {
  if (!staff) return { used: 0, ent: 0, bal: 0 };

  // "Guna Dalam Sistem" is counted per leave year. Defaults to the current year, so
  // 2026 numbers are unchanged today (every existing record is 2026); balances refresh
  // automatically each new calendar year (carry-forward handled by Tutup Tahun).
  const leaveYear = (year !== undefined && year !== null) ? parseInt(year, 10) : window.getCurrentLeaveYear();
  const records = leaveRecords.filter(r => r.ic === staff.ic && r.status === 'APPROVED' && r.type === type
    && leaveYearOf(r) === leaveYear);
  const recordsUsed = records.reduce((acc, r) => acc + parseFloat(r.days || 0), 0);

  let ent = 0;
  if (type === 'AL') {
    ent = window.getEarnedAL(staff); // Jumlah = ent_AL + CF
  } else if (type === 'MC') {
    ent = window.getEntitlementMC(staff); // peruntukan MC ikut tahun khidmat (14/18/22)
  } else if (type === 'CME') {
    ent = window.getEntitlementCME(staff); // doctors 5, non-doctors 0, ent_CME overrides
  } else {
    // ML_PL entitlement is saved as ent_PL by the HR form (legacy key)
    const entKey = type === 'ML_PL' ? 'ent_PL' : `ent_${type}`;
    const stored = staff[entKey];
    ent = (stored !== undefined && stored !== null)
      ? parseFloat(stored)
      : (leaveCategories.find(c => c.id === type)?.entitlement || 0);
  }

  // Formula B: Baki = Jumlah − Guna Sebelum Sistem − Guna Dalam Sistem − Pelarasan HR.
  // "Guna Dalam Sistem" = rekod diluluskan (mod AUTO) ATAU nilai manual HR (mod manual).
  // Medan {jenis}_used_pre, {jenis}_used_sys_adj, {jenis}_pelarasan diisi HR (lalai 0).
  // Jenis yang terpakai: FORMULA_B_TYPES dalam leaveBalance.js — jangan senarai semula di sini.
  let usedPre = 0, pelarasan = 0, usedSysAdj = 0;
  if (usesFormulaB(type)) {
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

  // Annual Leave absorbs TWO spillovers. Only AL does; the recursive EL / EL_EMG calls
  // never re-enter this branch (type !== 'AL'), so this terminates.
  //
  //  • EL  (Cuti Ehsan)     — once the 3-day bucket is exhausted, the excess hits AL.
  //  • EMG (Cuti Kecemasan) — no bucket of its own (ent_EL_EMG defaults to 0), so every
  //                           approved EMG day hits AL from day one. Before this, EMG
  //                           days were logged but charged to nothing at all.
  let elOverflow = 0, emgOverflow = 0;
  if (type === 'AL') {
    const el = window.getLeaveStats(staff, 'EL', leaveYear);
    elOverflow = computeElOverflow({
      entEL: el.ent, usedPre: el.usedPre, usedSys: el.used, pelarasan: el.pelarasan
    });
    const emg = window.getLeaveStats(staff, 'EL_EMG', leaveYear);
    emgOverflow = computeEmgOverflow({ entEMG: emg.ent, used: emg.used });
  }

  return {
    used: usedSys,
    usedFromRecords: recordsUsed,
    usedSysAdj: usedSysAdj,
    usedPre: usedPre,
    pelarasan: pelarasan,
    adj: pelarasan,
    ent: ent,
    elOverflow: elOverflow,
    emgOverflow: emgOverflow,
    bal: formulaBBalance({ ent, usedPre, usedSys, pelarasan, overflow: elOverflow + emgOverflow })
  };
};



// Polisi notis minimum — bilangan hari ditentukan oleh getNoticeDays()
// (src/leaveNotice.js), sumber tunggal kebenaran. Terima objek staff penuh,
// bukan `category` sahaja: sejak 2026-08-24 cawangan pemohon turut penting.
function validateNotice(startDate, staff) {
  const today = new Date();
  const start = new Date(startDate);
  const diffTime = start - today;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  return diffDays >= getNoticeDays(staff);
}

window.toggleMobileMenu = function(val) {
  mobileMenuOpen = (val !== undefined) ? val : !mobileMenuOpen;
  render();
};

window.logout = function() {
  localStorage.removeItem('ksb_logged_in_ic');
  localStorage.removeItem('ksb_logged_in_sid');
  if (sessionUnsubscribe) { sessionUnsubscribe(); sessionUnsubscribe = null; }
  stopReminderScheduler();
  user = null;
  currentSessionId = null;
  duplicateSessionDetected = false;
  mobileMenuOpen = false;
  dashboardTab = null;
  analyticsFilterMonth = 0;
  analyticsFilterYear = new Date().getFullYear().toString();
  yearEndPreview = null;
  yearEndProcessing = false;
  analyticsCatFilter = 'SEMUA';
  analyticsBranchFilter = 'SEMUA';
  analyticsRankModal = null;
  branchDashboardMonth = 0;
  view = 'login';
  render();
  signOut(auth).catch(() => {}).finally(() => window.location.reload());
};

// ── Inbox (notifikasi dalam aplikasi) ────────────────────────

// ── Minta kebenaran Browser Notification ──
window.requestNotifPermission = function() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    Notification.requestPermission();
  }
};

// ── Inbox: tambah notifikasi ke Firestore ──
// from = staff (atau rekod cuti) yang "menghantar" surat ini — dipapar sebagai
// pengirim dalam Inbox. Tanpa from, surat dipapar daripada Sistem Cuti KSB.
window.addNotification = async function(recipientIC, type, title, body, leaveId = null, from = null) {
  if (!recipientIC) return;
  if (testCtx) {
    const _orig = recipientIC === testCtx.ic ? null : staffList.find(s => s.ic === recipientIC);
    recipientIC = testCtx.ic;
    title = '🧪 [TEST] ' + title;
    if (_orig) body = `(Asalnya untuk ${_orig.name}) ${body}`;
  }
  try {
    const data = { recipientIC, type, title, body, read: false, createdAt: Date.now() };
    if (leaveId) data.leaveId = leaveId;
    if (from && from.name) {
      // Rekod cuti tiada role — cari staff sebenar ikut IC untuk label peranan
      const role = from.role || (from.ic && staffList.find(s => s.ic === from.ic) || {}).role;
      data.senderName = from.name;
      if (role) data.senderRole = window.staffConfig.roleLabels[role] || role;
    }
    await addDoc(collection(db, 'notifications'), data);
  } catch(e) { console.warn('addNotification failed:', e); }
};

// ── Inbox: notifikasi kepada senarai pelulus (selari dgn notifikasi WhatsApp) ──
// staffArr = senarai objek staff pelulus; auto buang yang inactif, tiada IC,
// dan pemohon sendiri (excludeIC), serta nyahduplikasi ikut IC.
window.notifyApproversInbox = function(staffArr, title, body, leaveId, excludeIC, from = null) {
  const uniq = [...new Map(
    (staffArr || [])
      .filter(s => s && s.ic && s.ic !== excludeIC && !s.inactive)
      .map(s => [s.ic, s])
  ).values()];
  uniq.forEach(s => window.addNotification(s.ic, 'leave_to_approve', title, body, leaveId, from));
};

// ── Inbox: mark as read ──
window.markNotifRead = async function(notifId) {
  try {
    await updateDoc(doc(db, 'notifications', notifId), { read: true });
  } catch(e) { console.warn('markNotifRead failed:', e); }
};

// ── Inbox: tandai SEMUA yang belum dibaca sebagai dibaca ──
window.markAllNotifsRead = async function() {
  const unread = inboxNotifs.filter(n => !n.read);
  if (!unread.length) return;
  try {
    const batch = writeBatch(db);
    unread.forEach(n => batch.update(doc(db, 'notifications', n.id), { read: true }));
    await batch.commit();
  } catch(e) { console.warn('markAllNotifsRead failed:', e); }
};

// ── Inbox: tanda/nyahtanda satu notifikasi (checkbox) ──
window.toggleNotifSelect = function(notifId) {
  if (inboxSelected.has(notifId)) inboxSelected.delete(notifId);
  else inboxSelected.add(notifId);
  render();
};

// ── Inbox: tanda/nyahtanda SEMUA (pilih semua) ──
window.toggleSelectAllNotifs = function() {
  const visible = filterNotifs(inboxNotifs, inboxFilter);
  if (visible.length && visible.every(n => inboxSelected.has(n.id))) inboxSelected.clear();
  else visible.forEach(n => inboxSelected.add(n.id));
  render();
};

// ── Inbox: masuk/keluar mod pilih ──
window.toggleInboxSelectMode = function() {
  inboxSelectMode = !inboxSelectMode;
  inboxSelected.clear();
  render();
};

// ── Inbox: penapis Semua / Belum baca ──
window.setInboxFilter = function(f) {
  inboxFilter = f;
  inboxSelected.clear();
  render();
};

// ── Inbox: klik baris — pilih (mod pilih) atau buka surat ──
window.onInboxRowClick = function(notifId) {
  if (inboxSelectMode) { window.toggleNotifSelect(notifId); return; }
  window.openInboxLetter(notifId);
};

// ── Inbox: buka / tutup surat penuh ──
window.openInboxLetter = function(notifId) {
  const n = inboxNotifs.find(x => x.id === notifId);
  if (!n) return;
  inboxOpenId = notifId;
  if (!n.read) window.markNotifRead(notifId);
  render();
  window.scrollTo(0, 0);
};
window.closeInboxLetter = function() {
  inboxOpenId = null;
  render();
};

// ── Inbox: padam surat yang sedang dibuka ──
window.deleteOpenLetter = async function() {
  const id = inboxOpenId;
  if (!id || !await showConfirm('Padam surat ini? Tindakan ini kekal dan tidak boleh dibatalkan.')) return;
  try {
    await deleteDoc(doc(db, 'notifications', id));
    inboxOpenId = null;
    render();
  } catch(e) { console.warn('deleteOpenLetter failed:', e); showToast('Gagal memadam surat. Sila cuba lagi.'); }
};

// ── Inbox: padam notifikasi yang ditanda (dengan pengesahan) ──
window.deleteSelectedNotifs = async function() {
  const ids = [...inboxSelected].filter(id => inboxNotifs.some(n => n.id === id));
  if (!ids.length) return;
  if (!await showConfirm(`Padam ${ids.length} notifikasi? Tindakan ini kekal dan tidak boleh dibatalkan.`)) return;
  try {
    const batch = writeBatch(db);
    ids.forEach(id => batch.delete(doc(db, 'notifications', id)));
    await batch.commit();
    inboxSelected.clear();
    inboxSelectMode = false;
    render();
  } catch(e) { console.warn('deleteSelectedNotifs failed:', e); showToast('Gagal memadam sebahagian notifikasi. Sila cuba lagi.'); }
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
    // Buang ID yang ditanda tetapi sudah tiada (cth. dipadam di peranti lain).
    if (inboxSelected.size) {
      const live = new Set(inboxNotifs.map(n => n.id));
      inboxSelected.forEach(id => { if (!live.has(id)) inboxSelected.delete(id); });
    }
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

// ── Shared UI helpers ────────────────────────────────────────

function escapeHtml(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Upload a profile photo to Cloudinary and save its URL on the staff doc.
// Used by the profile form in Tetapan.
window.uploadProfilePhoto = async function(input) {
  if (!input || !input.files || !input.files[0]) return;
  const file = input.files[0];
  const _fileErr = validateUploadFile(file, PHOTO_RULES);
  if (_fileErr) { showToast(_fileErr); input.value = ''; return; }
  if (!user || !user.ic) { showToast('Ralat: Sesi tidak sah.'); return; }
  try {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
    fd.append('folder', 'profile_photos');
    const resp = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,
      { method: 'POST', body: fd }
    );
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.secure_url) {
      throw new Error((data.error && data.error.message) || ('Cloudinary HTTP ' + resp.status));
    }
    const photoUrl = data.secure_url;
    await updateDoc(doc(db, 'staff', user.ic), { photoUrl });
    user.photoUrl = photoUrl;
    const s = staffList.find(x => x.ic === user.ic);
    if (s) s.photoUrl = photoUrl;
    render();
  } catch (err) {
    console.error('Profile photo upload failed:', err);
    showToast(uploadErrorMessage(err, PHOTO_RULES));
  } finally {
    input.value = '';
  }
};

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
          const rbac = window.effectivePerms(user);
          return `
            ${rbac.dashboard ? `<div class="fab-item" onclick="window.setView('dashboard'); window.toggleMobileMenu(false)">Dashboard</div>` : ''}
            ${rbac.leave_request ? `<div class="fab-item" onclick="window.setView('leave-form'); window.toggleMobileMenu(false)">Borang Cuti</div>` : ''}
            ${window.canSeeLeaveCalendar(user) ? `<div class="fab-item" onclick="window.setView('calendar'); window.toggleMobileMenu(false)">Kalendar Cuti</div>` : ''}
            ${window.canOpenManagement(user) ? `<div class="fab-item" onclick="window.setView('management'); window.toggleMobileMenu(false)">Management</div>` : ''}
            ${rbac.inbox ? `<div class="fab-item" onclick="window.setView('inbox'); window.toggleMobileMenu(false)">Inbox${inboxNotifs.filter(n=>!n.read).length > 0 ? ' 🔴' : ''}</div>` : ''}
            <div class="fab-item" onclick="window.setView('settings'); window.toggleMobileMenu(false)">Settings</div>
            <div class="fab-item logout" onclick="window.logout()">Log Keluar</div>
          `;
        })()}
      </div>
    </div>

    <div class="dashboard-layout fade-in">
      <header class="app-topbar">
        ${(() => {
          // Anak syarikat (KSB Pharma) nampak jenamanya sendiri; klinik kekal KSB.
          const _own = user && OWN_HR_ZONE[user.branch] ? window.printBrandFor(user.branch) : null;
          return `<img src="${_own ? _own.logo : logos.ksb}" alt="Logo" class="app-topbar-logo">
        <div class="app-topbar-titles">
          <span class="app-topbar-company">${_own ? _own.name : 'KLINIK SYED BADARUDDIN SDN. BHD.'}</span>`;
        })()}
          <span class="app-topbar-system">Sistem Permohonan Cuti &amp; Rekod Pekerja</span>
        </div>
        <span class="app-topbar-version">v${APP_VERSION}</span>
      </header>
      <aside class="sidebar">
        <nav class="nav-menu">
          ${(() => {
            const dashboardRbac = window.effectivePerms(user);
            return `
              ${dashboardRbac.dashboard ? `<div class="nav-item ${view === 'dashboard' ? 'active' : ''}" onclick="window.setView('dashboard')"><i data-lucide="layout-dashboard" width="18" height="18"></i> Dashboard</div>` : ''}
              ${dashboardRbac.leave_request ? `<div class="nav-item ${view === 'leave-form' ? 'active' : ''}" onclick="window.setView('leave-form')"><i data-lucide="calendar-plus" width="18" height="18"></i> Borang Cuti</div>` : ''}
              ${window.canSeeLeaveCalendar(user) ? `<div class="nav-item ${view === 'calendar' ? 'active' : ''}" onclick="window.setView('calendar')"><i data-lucide="calendar-days" width="18" height="18"></i> Kalendar Cuti</div>` : ''}
              ${window.canOpenManagement(user) ? `<div class="nav-item ${view === 'management' ? 'active' : ''}" onclick="window.setView('management')"><i data-lucide="shield-check" width="18" height="18"></i> Management</div>` : ''}
              ${dashboardRbac.inbox ? (() => { const inboxUnread = inboxNotifs.filter(n => !n.read).length; return `<div class="nav-item ${view === 'inbox' ? 'active' : ''}" onclick="window.setView('inbox')" style="position:relative;"><i data-lucide="inbox" width="18" height="18"></i> Inbox${inboxUnread > 0 ? `<span style="position:absolute;top:4px;right:6px;min-width:16px;height:16px;padding:0 3px;border-radius:999px;background:var(--danger);color:#fff;font-size:0.6rem;font-weight:800;display:flex;align-items:center;justify-content:center;line-height:1;">${inboxUnread}</span>` : ''}</div>`; })() : ''}
              ${dashboardRbac.policy ? `<div class="nav-item ${view === 'policy' ? 'active' : ''}" onclick="window.setView('policy')"><i data-lucide="book-open" width="18" height="18"></i> Polisi</div>` : ''}
              ${dashboardRbac.settings ? `<div class="nav-item ${view === 'settings' ? 'active' : ''}" onclick="window.setView('settings')"><i data-lucide="settings-2" width="18" height="18"></i> Tetapan</div>` : ''}
            `;
          })()}
        </nav>
        <div class="sidebar-footer">
          <div class="user-pill glass-card">
            ${userAvatar(user)}
            <div class="user-info">
              <div class="user-name">${user.name}</div>
              <div class="user-role">${(user.role || '').toUpperCase()}</div>
            </div>
          </div>
          <button id="logout" class="btn-logout">Logout</button>
          <p style="font-size:0.68rem;color:var(--text-muted);text-align:center;margin:0.85rem 0 0;letter-spacing:0.3px;line-height:1.6;">© 2026 Klinik Syed Badaruddin Sdn. Bhd.<br>Hak Cipta Terpelihara<br><span style="font-size:0.63rem;opacity:0.8;">Dibangunkan oleh KSBSB IT @ LukhzzIsZa</span></p>
        </div>
      </aside>

      <main class="content-area">
        ${leavesLoaded || !['dashboard', 'management', 'calendar'].includes(view) ? renderView() : dashboardSkeleton()}
      </main>
    </div>
    ${renderModal()}
    ${renderLeaveModal()}
    ${renderSelfProfileModal()}
    ${renderAddStaffModal()}
    ${renderFirstLoginModal()}
    ${renderPhoneReminderModal()}
  `;

  // Logout Listener
  document.querySelector('#logout')?.addEventListener('click', window.logout);

  // Handle Leave Submission with Validation
  const leaveForm = document.querySelector('#leave-request-form');
  if (leaveForm) {
    leaveForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (leaveSubmitting) return;

      let leaveTypeName = leaveCategories.find(c => c.id === selectedLeaveType)?.name || selectedLeaveType;
      // Jenis yang DISIMPAN. Biasanya sama dengan pilihan; AL bertukar kepada UP
      // apabila baki AL sudah habis (lihat di bawah). Laluan kelulusan, polisi notis
      // dan semakan pelulus tetap guna selectedLeaveType (AL) — kelulusan macam biasa.
      let storedLeaveType = selectedLeaveType;
      const startDate = leaveStartDate;
      const endDate = leaveEndDate;
      const reason = leaveForm.querySelector('textarea').value.trim();
      const handover = leaveForm.querySelector('#handover-input')?.value || '';
      // Sebab mesti perkataan sebenar — bukan `""`, `''`, `-` sahaja (src/leaveReason.js).
      const _reasonErr = validateLeaveReason(reason);
      if (_reasonErr) {
        showToast(_reasonErr);
        leaveForm.querySelector('textarea')?.focus();
        return;
      }
      
      let diffDays = window.computeLeaveDays(leaveStartDate, leaveEndDate, user, selectedLeaveType);
      if (diffDays <= 0) {
        showToast('Tarikh yang dipilih tiada hari bekerja untuk staf pentadbiran. Sila pilih tarikh yang merangkumi hari bekerja (Isnin–Jumaat).');
        return;
      }
      // ── Halang permohonan bertindih ──
      // Diletakkan SEBELUM dialog baki AL/EL, semakan pelulus dan muat naik
      // Cloudinary: pemohon tidak perlu klik tiga dialog sebelum ditolak, dan
      // tiada fail dimuat naik untuk permohonan yang takkan wujud.
      // Guna leaveTypeLabel (fungsi), BUKAN leaveTypeName — yang itu dilindungi
      // oleh const tempatan di atas yang memegang nama jenis cuti semasa.
      const _overlaps = findOverlappingLeaves(leaveRecords, user.ic, startDate, endDate);
      if (_overlaps.length > 0) {
        showToast('🔴 PERMOHONAN BERTINDIH\n\n' +
              'Anda sudah ada permohonan cuti untuk tarikh ini:\n\n' +
              describeOverlaps(_overlaps, leaveTypeLabel) + '\n\n' +
              'Permohonan baharu tidak boleh dihantar. Sila batalkan permohonan asal ' +
              'terlebih dahulu jika anda perlu mengubah tarikh.');
        return;
      }
      if (applyHalfDay) diffDays -= 0.5;

      let leaveBreakdown = '';
      if (selectedLeaveType === 'AL') {
          // Baki AL sebenar = Formula B (Jumlah − Guna Sebelum − Guna Sistem − Pelarasan HR)
          const currentBal = window.getLeaveStats(user, 'AL').bal;

          if (currentBal <= 0) {
              // Baki AL = 0 → keseluruhan permohonan terus menjadi Unpaid Leave (UPL).
              storedLeaveType = 'UP';
              leaveTypeName = leaveCategories.find(c => c.id === 'UP')?.name || 'Unpaid Leave (UPL)';
              leaveBreakdown = "\n*AL HABIS → UPL*\nBaki AL: " + currentBal.toFixed(2) + " hari\nUnpaid Leave (UPL): " + diffDays + " hari";
              showToast("Notis: Baki Cuti Tahunan (AL) anda telah habis (" + currentBal.toFixed(2) + " hari). Permohonan " + diffDays + " hari ini akan dihantar sebagai Unpaid Leave (UPL — Cuti Tanpa Gaji). Kelulusan tetap seperti biasa.");
          } else if (diffDays > currentBal) {
              const unpaidDays = diffDays - Math.max(0, currentBal);
              const paidDays = diffDays - unpaidDays;
              leaveBreakdown = "\n*SPLIT LEAVE DETECTED*\nEarned AL Used: " + paidDays + " days\nUnpaid Leave (UPL): " + unpaidDays + " days\n(Automatic split due to insufficient earned prorate)";
              showToast("Notis: Baki prorate (Earned) anda ialah " + currentBal.toFixed(2) + " hari. Permohonan " + diffDays + " hari akan dibahagikan kepada " + paidDays + " hari AL dan " + unpaidDays + " hari Unpaid Leave (UPL).");
          }
      }
      if (selectedLeaveType === 'EL') {
          // EL bucket first; once exhausted the excess is deducted from Annual Leave.
          const elBal = window.getLeaveStats(user, 'EL').bal;
          const fromEL = Math.min(diffDays, elBal);
          const toAL = diffDays - fromEL;
          if (toAL > 0) {
              const alBal = window.getLeaveStats(user, 'AL').bal;
              leaveBreakdown = "\n*CL OVERFLOW*\nCL (Cuti Ehsan) Bucket Used: " + fromEL.toFixed(1) + " days\nAnnual Leave (AL) Used: " + toAL.toFixed(1) + " days\n(CL bucket exhausted → overflow deducted from AL)";
              let elMsg = "Notis: Baki Cuti Ehsan anda tinggal " + elBal.toFixed(2) + " hari. Permohonan " + diffDays + " hari akan ditolak " + fromEL.toFixed(1) + " hari dari Cuti Ehsan dan " + toAL.toFixed(1) + " hari dari Cuti Tahunan (AL).";
              if (toAL > alBal) {
                  elMsg += "\n\n⚠️ Baki AL juga tidak mencukupi (baki AL: " + alBal.toFixed(2) + " hari).";
              }
              showToast(elMsg);
          }
      }
      if (selectedLeaveType === 'EL_EMG') {
          // Cuti Kecemasan carries no bucket by default (ent_EL_EMG = 0), so the whole
          // application is charged to Annual Leave. If HR granted an EMG entitlement,
          // that is consumed first and only the excess reaches AL.
          const emgBal = window.getLeaveStats(user, 'EL_EMG').bal;
          const fromEMG = Math.min(diffDays, emgBal);
          const toAL = diffDays - fromEMG;
          const _alBalEmg = window.getLeaveStats(user, 'AL').bal;
          if (toAL > 0 && fromEMG <= 0 && _alBalEmg <= 0) {
              // Masih ada baki AL → tolak AL (cabang di bawah). Baki AL sudah habis →
              // keseluruhan Cuti Kecemasan disimpan sebagai Unpaid Leave (UPL).
              // Kelulusan tetap ikut laluan EL biasa (selectedLeaveType tidak berubah).
              storedLeaveType = 'UP';
              leaveTypeName = leaveCategories.find(c => c.id === 'UP')?.name || 'Unpaid Leave (UPL)';
              leaveBreakdown = "\n*EL (Cuti Kecemasan) → UPL*\nBaki AL: " + _alBalEmg.toFixed(2) + " hari\nUnpaid Leave (UPL): " + diffDays + " hari";
              showToast("Notis: Cuti Kecemasan (EL) ditolak dari Cuti Tahunan (AL), tetapi baki AL anda telah habis (" + _alBalEmg.toFixed(2) + " hari). Permohonan " + diffDays + " hari ini akan dihantar sebagai Unpaid Leave (UPL — Cuti Tanpa Gaji). Kelulusan tetap seperti biasa.");
          } else if (toAL > 0) {
              const alBal = _alBalEmg;
              leaveBreakdown = "\n*EL (Cuti Kecemasan) → AL*\n" + (fromEMG > 0 ? "EL Bucket Used: " + fromEMG.toFixed(1) + " days\n" : "")
                  + "Annual Leave (AL) Used: " + toAL.toFixed(1) + " days\n(Cuti Kecemasan is deducted from Annual Leave)";
              let emgMsg = fromEMG > 0
                  ? "Notis: Baki Cuti Kecemasan anda tinggal " + emgBal.toFixed(2) + " hari. Permohonan " + diffDays + " hari akan ditolak " + fromEMG.toFixed(1) + " hari dari Cuti Kecemasan dan " + toAL.toFixed(1) + " hari dari Cuti Tahunan (AL)."
                  : "Notis: Cuti Kecemasan ditolak dari Cuti Tahunan (AL). Permohonan " + diffDays + " hari ini akan menolak " + toAL.toFixed(1) + " hari dari baki AL anda (baki AL sekarang: " + alBal.toFixed(2) + " hari).";
              if (toAL > alBal) {
                  emgMsg += "\n\n⚠️ Baki AL tidak mencukupi (baki AL: " + alBal.toFixed(2) + " hari).";
              }
              showToast(emgMsg);
          }
      }

      // Bukti wajib — jenis cuti yang perlukan dokumen disenaraikan dalam
      // LEAVE_PROOF (leaveTypes.js). Termasuk CME: tanpa surat jemputan /
      // slip pendaftaran program CME, permohonan tidak boleh dihantar.
      const _proofNeed = proofRequirement(selectedLeaveType);
      if (_proofNeed) {
          const _inp = document.getElementById(_proofNeed.inputId);
          if (!_inp || _inp.files.length === 0) {
              showToast(_proofNeed.error);
              return;
          }
      }

      // Tentukan sama ada staff adalah op-balok dengan needs_tl aktif.
      // Guna getStaffGroup (bukan category) supaya juru_audio/juru_xray/sonographer —
      // yang berkategori 'Operation Staff' tetapi ada laluan sendiri (juru_audio_balok dll,
      // needs_tl:false) — TIDAK tersilap diminta sokongan Team Leader.
      const _sbmIsOpBalokTL = window.getStaffGroup(user) === 'operation_balok' &&
          !!(approvalRouting['operation_balok'] || {}).needs_tl;

      // Pengecualian "terus ke HR" (skip HOD) — ikut jenis cuti & peranan pemohon.
      const _sbmDirectHR = window.shouldSkipP1(user, selectedLeaveType);

      // Wajib pilih TL (Peringkat 0) untuk op-balok
      // (MC kini ikut step kelulusan penuh sama seperti AL — tiada lagi laluan terus ke HR)
      const selectedTL = leaveForm.querySelector('#tl-select')?.value;
      if (_sbmIsOpBalokTL && !selectedTL) {
          showToast('🔴 WAJIB: Sila pilih Team Leader (Pelulus Peringkat 0) sebelum menghantar permohonan cuti.\n\nPermohonan tidak dapat diproses tanpa sokongan Team Leader.');
          leaveForm.querySelector('#tl-select')?.focus();
          return;
      }

      // Wajib pilih pelulus Peringkat 1 (kecuali op-balok — Supervisor auto, atau jika tiada pelulus langsung — HR luluskan terus)
      const selectedHODCheck = leaveForm.querySelector('#hod-select')?.value;
      const _hasP1Approvers = window.getRoutingP1Approvers(user, selectedLeaveType).length > 0;
      if (!_sbmIsOpBalokTL && _hasP1Approvers && !selectedHODCheck) {
          showToast('🔴 WAJIB: Sila pilih Pelulus Peringkat 1 (HOD / PIC_HOD / Supervisor) sebelum menghantar permohonan cuti.\n\nPermohonan tidak dapat diproses tanpa kelulusan Peringkat 1.');
          leaveForm.querySelector('#hod-select')?.focus();
          return;
      }

      // Cuti tak boleh dirancang (MC sakit, Kecemasan, Ehsan/kematian, Hospitalisasi) + CME dan Cuti Ganti (dituntut selepas mesyuarat) dikecualikan dari polisi notis awal — senarai penuh di NOTICE_EXEMPT_TYPES (leaveNotice.js), jangan salin semula di sini. Tetap perlu pelulus + bukti.
      if (!isNoticeExempt(selectedLeaveType) && !validateNotice(startDate, user)) {
        const minDays = getNoticeDays(user);
        showToast(`Polisi Notis Minimum: permohonan anda mesti dihantar sekurang-kurangnya ${minDays} hari sebelum tarikh mula cuti.`);
        return;
      }
      
      // ── Kunci hantar ──
      // Ditetapkan SELEPAS semua pengesahan lulus: kalau diletak di awal,
      // kegagalan pengesahan akan mengunci borang sampai render seterusnya.
      // `finally` di hujung memulihkan butang walau upload/tulisan gagal —
      // jangan tukar kepada pemulihan manual di setiap `return`.
      leaveSubmitting = true;
      const _isTestSubmit = leaveTestMode && canUseTestMode(user);
      if (_isTestSubmit) testCtx = { ic: user.ic, name: user.name, phone: user.phone || '' };
      const _submitBtn = leaveForm.querySelector('button[type="submit"]');
      const _submitBtnHTML = _submitBtn ? _submitBtn.innerHTML : '';
      if (_submitBtn) {
        _submitBtn.disabled = true;
        _submitBtn.style.opacity = '0.6';
        _submitBtn.style.cursor = 'not-allowed';
        _submitBtn.textContent = 'MENGHANTAR…';
      }
      try {
        // ── Muat naik fail bukti (MC / Kecemasan / Ehsan / CME) ke Cloudinary ──
        // Firebase Storage tidak diaktifkan (perlu Blaze), jadi bukti dimuat naik ke
        // Cloudinary via unsigned upload. `secure_url` disimpan sebagai proofUrl untuk
        // rujukan HR (dilihat semula sebagai "Lihat Bukti" di Master Logs).
        let proofUrl = null, proofName = null;
        const _proofInput = _proofNeed ? document.getElementById(_proofNeed.inputId) : null;
        if (_proofInput && _proofInput.files.length > 0) {
          const _proofFile = _proofInput.files[0];
          // Semak semula sebelum hantar (jaga-jaga jika semakan semasa pilih fail terlepas).
          const _fileErr = validateProofFile(_proofFile);
          if (_fileErr) { showToast(_fileErr); return; }
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
            showToast(proofUploadErrorMessage(err));
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
          type: storedLeaveType,
          // Dimohon sebagai AL tetapi baki AL habis → disimpan sebagai UP.
          ...(storedLeaveType !== selectedLeaveType ? { requestedType: selectedLeaveType } : {}),
          days: diffDays,
          startDate,
          endDate,
          reason,
          handoverName: handover,
          hodIC: _sbmDirectHR ? null : (selectedHOD || null),
          tlIC: selectedTL || null,
          // Permohonan terus ke HR (skip HOD) — disimpan supaya laluan kekal stabil
          // walaupun polisi berubah kemudian. null untuk laluan biasa & rekod lama.
          directHR: _sbmDirectHR || null,
          // Semua jenis cuti (termasuk MC) bermula PENDING & ikut step kelulusan penuh seperti AL.
          status: 'PENDING',
          // Bukti (MC/Kecemasan/Ehsan/CME) — null untuk jenis cuti lain & rekod lama.
          proofUrl: proofUrl || null,
          proofName: proofName || null
        };
        if (_isTestSubmit) newRecord.isTest = true;
  
        try {
            await setDoc(doc(db, "leaves", newRecord.id.toString()), newRecord);
            window.logSystemActivity(`Applied for ${leaveTypeName} (${diffDays} days)`);
            window.addNotification(user.ic, 'leave_submitted', '📋 Permohonan Cuti Dihantar', `Permohonan ${leaveTypeName} anda (${startDate} → ${endDate}, ${diffDays} hari) telah berjaya dihantar dan sedang menunggu kelulusan.`, newRecord.id.toString());
        } catch (err) {
            console.error("Error adding leave record: ", err);
            showToast("Ralat menghantar permohonan ke pangkalan data.");
            return;
        }
  
        // WA Peringkat 0/1: notify TL yang dipilih (op-balok) atau approver biasa
        let hodToNotify = [];
        let hodMsg = '';
        if (_sbmIsOpBalokTL) {
          // Op-balok: notify hanya TL yang dipilih oleh staff (bukan semua TL)
          hodToNotify = staffList.filter(s => s.ic === selectedTL && s.phone);
          hodMsg = `📩 *PERMOHONAN CUTI BARU — Peringkat 0 (Sokongan Team Leader)*\n\nPermohonan cuti memerlukan sokongan anda (Team Leader) sebelum dihantar ke Supervisor.\n\n👤 Pemohon: *${user.name}*\n🏥 Cawangan: ${user.branch}\n📝 Jenis Cuti: *${leaveTypeName}*\n📅 Tarikh: ${startDate} → ${endDate}\n⏱ Tempoh: ${diffDays} hari\n💬 Sebab: ${reason}\n\n🔗 *Log masuk untuk meluluskan:* https://cuti-staff.ksbsb.com.my\n_— KSB Leave System_`;
        } else if (_sbmDirectHR) {
          // Terus ke HR — HR/Admin ialah pelulus (bukan HOD)
          hodToNotify = window.hrRecipientsForBranch(user.branch).filter(s => s.phone);
          hodMsg = `📩 *PERMOHONAN CUTI BARU — Kelulusan HR (Terus)*\n\nPermohonan cuti ini dilaluankan TERUS kepada HR/Admin untuk kelulusan (tanpa peringkat HOD).\n\n👤 Pemohon: *${user.name}*\n🏥 Cawangan: ${user.branch}\n📝 Jenis Cuti: *${leaveTypeName}*\n📅 Tarikh: ${startDate} → ${endDate}\n⏱ Tempoh: ${diffDays} hari\n💬 Sebab: ${reason}\n\n🔗 *Log masuk untuk meluluskan:* https://cuti-staff.ksbsb.com.my\n_— KSB Leave System_`;
        } else if (selectedHOD) {
          hodToNotify = staffList.filter(s => s.ic === selectedHOD && s.phone);
          hodMsg = `📩 *PERMOHONAN CUTI BARU — Peringkat 1 (Sokongan HOD)*\n\nPermohonan cuti memerlukan sokongan anda sebelum dihantar ke HR/Admin.\n\n👤 Pemohon: *${user.name}*\n🏥 Cawangan: ${user.branch}\n📝 Jenis Cuti: *${leaveTypeName}*\n📅 Tarikh: ${startDate} → ${endDate}\n⏱ Tempoh: ${diffDays} hari\n💬 Sebab: ${reason}\n\n🔗 *Log masuk untuk meluluskan:* https://cuti-staff.ksbsb.com.my\n_— KSB Leave System_`;
        } else {
          hodToNotify = window.getRoutingP1Approvers(user, selectedLeaveType).filter(s => s.phone);
          hodMsg = `📩 *PERMOHONAN CUTI BARU — Peringkat 1 (Sokongan HOD)*\n\nPermohonan cuti memerlukan sokongan anda sebelum dihantar ke HR/Admin.\n\n👤 Pemohon: *${user.name}*\n🏥 Cawangan: ${user.branch}\n📝 Jenis Cuti: *${leaveTypeName}*\n📅 Tarikh: ${startDate} → ${endDate}\n⏱ Tempoh: ${diffDays} hari\n💬 Sebab: ${reason}\n\n🔗 *Log masuk untuk meluluskan:* https://cuti-staff.ksbsb.com.my\n_— KSB Leave System_`;
        }
  
        hodToNotify.forEach(hod => window.sendWhatsApp(hod.phone, hodMsg));
  
        // Inbox kepada pelulus (selari dengan WhatsApp) — peringkat yang sesuai
        const _apprStaff = _sbmIsOpBalokTL ? staffList.filter(s => s.ic === selectedTL)
          : _sbmDirectHR ? window.hrRecipientsForBranch(user.branch)
          : selectedHOD ? staffList.filter(s => s.ic === selectedHOD)
          : window.getRoutingP1Approvers(user, selectedLeaveType);
        window.notifyApproversInbox(_apprStaff,
          '📥 Permohonan Cuti Perlu Tindakan',
          `${user.name} memohon ${leaveTypeName} (${startDate}${startDate !== endDate ? ' → ' + endDate : ''}, ${diffDays} hari). Memerlukan ${_sbmIsOpBalokTL ? 'sokongan Team Leader (Peringkat 0)' : _sbmDirectHR ? 'kelulusan HR/Admin' : 'kelulusan Peringkat 1'} anda.`,
          newRecord.id.toString(), user.ic, user);
  
        // WA pengesahan kepada pemohon sendiri
        if (user.phone) {
          const nextStage = _sbmIsOpBalokTL
            ? 'Sokongan Team Leader (Peringkat 0)'
            : _sbmDirectHR ? 'Kelulusan HR/Admin'
            : 'Sokongan HOD/Supervisor (Peringkat 1)';
          const confirmMsg = `✅ *PERMOHONAN CUTI DIHANTAR*\n\nSalam ${user.name},\n\nPermohonan cuti anda telah berjaya dihantar dengan sebab: *${reason}*\n\n📋 *Butiran Cuti:*\n• Jenis: ${leaveTypeName}\n• Tarikh: ${startDate} → ${endDate}\n• Tempoh: ${diffDays} hari\n\nPermohonan sedang menunggu *${nextStage}*. Anda akan dimaklumkan setiap kemaskini status.\n\n🔗 *Log masuk:* https://cuti-staff.ksbsb.com.my\n_— KSB Leave System_`;
          window.sendWhatsApp(user.phone, confirmMsg);
        }
  
        // CC: notify HR/Admin terus supaya mereka aware ada permohonan baru.
        // HR zon lain dikecualikan — Terengganu ke HR Terengganu, Pahang ke HR Pahang.
        // (Dulu SEMUA hr disekat untuk cuti Terengganu kerana tiada HR Terengganu.)
        const adminCC = window.hrRecipientsForBranch(user.branch).filter(s => s.phone);
        const adminCCMsg = _sbmIsOpBalokTL
          ? `ℹ️ *MAKLUMAN — Permohonan Cuti Baru (Tertunggu Sokongan Team Leader)*\n\n👤 Pemohon: *${user.name}*\n🏥 Cawangan: ${user.branch}\n📝 Jenis Cuti: *${leaveTypeName}*\n📅 Tarikh: ${startDate} → ${endDate}\n⏱ Tempoh: ${diffDays} hari\n\nPermohonan ini sedang menunggu sokongan Team Leader (Peringkat 0).\n\n🔗 *Log masuk:* https://cuti-staff.ksbsb.com.my\n_— KSB Leave System_`
          : `ℹ️ *MAKLUMAN — Permohonan Cuti Baru (Tertunggu Sokongan HOD)*\n\n👤 Pemohon: *${user.name}*\n🏥 Cawangan: ${user.branch}\n📝 Jenis Cuti: *${leaveTypeName}*\n📅 Tarikh: ${startDate} → ${endDate}\n⏱ Tempoh: ${diffDays} hari\n\nPermohonan ini sedang menunggu sokongan HOD/Supervisor (Peringkat 1).\n\n🔗 *Log masuk:* https://cuti-staff.ksbsb.com.my\n_— KSB Leave System_`;
        // Untuk laluan "terus ke HR", HR/Admin sudah menerima notifikasi pelulus di atas —
        // elak hantar WA berganda melalui CC.
        if (!_sbmDirectHR) adminCC.forEach(admin => window.sendWhatsApp(admin.phone, adminCCMsg));
  
        // Build status message
        const waEnabled = WHATSAPP_ENABLED();
        const recipientNames = hodToNotify.map(h => h.name).join(', ');
        let statusMsg = _isTestSubmit
          ? '🧪 CUTI TEST berjaya dihantar.\nRekod ini TIDAK dikira dalam baki, laporan atau Analisa. Semua WA & Inbox dihala kepada anda sahaja.\n\n'
          : '✅ Permohonan Cuti Berjaya Dihantar!\n\n';
        if (!waEnabled) {
          statusMsg += '⚠️ AMARAN: Token WhatsApp belum dikonfigurasi. Notifikasi WA TIDAK dihantar. Sila hubungi Super Admin untuk tetapkan token Fonnte dalam WA Settings.';
        } else if (hodToNotify.length === 0) {
          const noRecipientLabel = _sbmIsOpBalokTL ? 'Team Leader' : _sbmDirectHR ? 'HR/Admin' : 'HOD/Supervisor';
          statusMsg += `⚠️ Tiada pelulus dijumpai untuk menerima notifikasi WA. Sila pastikan ${noRecipientLabel} telah didaftarkan dengan nombor telefon dalam sistem.`;
        } else {
          const notifLabel = _sbmIsOpBalokTL ? 'Team Leader (Peringkat 0)' : _sbmDirectHR ? 'HR/Admin (Kelulusan Terus)' : 'Pelulus Peringkat 1';
          statusMsg += `📲 Notifikasi WA dihantar kepada ${notifLabel}:\n${recipientNames}`;
        }
        statusMsg += '\n\n🖨️ Borang cuti boleh dicetak untuk simpanan melalui butang "Cetak" di Rekod Permohonan Terkini.';
  
        navigator.clipboard.writeText(copyText).catch(() => {});
        showToast(statusMsg);
        // Cuti test: kekal di Borang Cuti supaya panel "Cuti Test" kelihatan.
        view = _isTestSubmit ? 'leave-form' : 'dashboard';
        render();
      } finally {
        if (_isTestSubmit) testCtx = null;
        leaveSubmitting = false;
        if (_submitBtn) {
          _submitBtn.disabled = false;
          _submitBtn.style.opacity = '';
          _submitBtn.style.cursor = '';
          _submitBtn.innerHTML = _submitBtnHTML;
        }
      }
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
        showToast(`Branch "${input.value.trim()}" added successfully!`);
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
                  const leaveAsAdminInput = document.querySelector('#edit-leave-as-admin');

                  const updates = {};
                  if(applyProrateInput) updates.apply_prorate = applyProrateInput.checked;
                  if(leaveAsAdminInput) updates.leaveAsAdmin = leaveAsAdminInput.checked;
                  if(statusSelect) updates.inactive = statusSelect.value === 'inactive';
                  if(startInput) updates.startDate = startInput.value;
                  if(branchSelect) updates.branch = branchSelect.value;
                  if(categorySelect) updates.category = categorySelect.value;
                  if(roleSelect) updates.role = roleSelect.value;
                  if(phoneInput) updates.phone = normalizePhone(phoneInput.value);

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
                  // Jenis diambil dari FORMULA_B_TYPES supaya ia tidak lari dari getLeaveStats.
                  FORMULA_B_TYPES.map(t => t.toLowerCase()).forEach(p => {
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
                      showToast('Profil pekerja berjaya dikemaskini!');
                      closeEditModal();
                  } catch (err) {
                      console.error("Error updating staff: ", err);
                      showToast("Ralat mengemaskini profil pekerja.");
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
          const rec = findLeaveRecord(editingLeaveId);
          if(rec) {
              const isAdminEditor = window.canEditAnyLeave(user);
              const isOwner = rec.ic === user.ic;
              const isApprover = window.canManageRequest(user, rec) || window.canCorrectBranchLeave(user, rec);
              if (!isAdminEditor && ['APPROVED', 'REJECTED', 'CANCELLED'].includes(rec.status)) {
                  showToast('Permohonan ini sudah selesai dan tidak boleh diubah.'); return;
              }
              if (!isAdminEditor && !isOwner && !isApprover) {
                  showToast('Anda tidak mempunyai kebenaran untuk mengubah permohonan ini.'); return;
              }
              const elStart = document.querySelector('#el-start').value;
              const elEnd = document.querySelector('#el-end').value;
              const elDays = parseFloat(document.querySelector('#el-days').value);
              if (!(elDays > 0)) {
                  showToast('Bilangan hari mesti lebih daripada 0. Sila betulkan.'); return;
              }
              // `rec.ic` bukan `user.ic` — HR dan pelulus mengedit rekod orang lain di sini.
              // `excludeId` menghalang rekod daripada bertindih dengan dirinya sendiri.
              const _editOverlaps = findOverlappingLeaves(leaveRecords, rec.ic, elStart, elEnd,
                                                          { excludeId: editingLeaveId });
              if (_editOverlaps.length > 0) {
                  showToast('🔴 TARIKH BERTINDIH\n\n' +
                        'Staf ini sudah ada permohonan cuti lain untuk tarikh tersebut:\n\n' +
                        describeOverlaps(_editOverlaps, leaveTypeName) + '\n\n' +
                        'Sila batalkan permohonan berkenaan terlebih dahulu.');
                  return;
              }
              // Semak sebab hanya jika diubah — rekod lama dengan sebab tidak sah
              // masih boleh dikemas kini tarikh/status oleh HR tanpa disekat.
              const _elReason = document.querySelector('#el-reason').value.trim();
              if (_elReason !== String(rec.reason || '').trim()) {
                  const _reasonErr = validateLeaveReason(_elReason);
                  if (_reasonErr) { showToast(_reasonErr); return; }
              }
              const updates = {
                reason: _elReason,
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
                      const info = `\n\n👤 Pemohon: *${applicant.name}*\n📅 Tarikh: ${elStart} → ${elEnd}\n⏱ Tempoh: ${elDays} hari\n\n🔗 https://cuti-staff.ksbsb.com.my`;
                      window.getRoutingP1Approvers(applicant, rec.type).filter(s => s.phone).forEach(a =>
                          window.sendWhatsApp(a.phone, `🔁 *PERMOHONAN CUTI DIKEMASKINI — Perlu Sokongan Semula*${info}`));
                      window.notifyApproversInbox(window.getRoutingP1Approvers(applicant, rec.type),
                          '🔁 Cuti Dikemaskini — Perlu Sokongan Semula',
                          `${applicant.name} mengubah permohonan cuti (kini ${elStart} → ${elEnd}, ${elDays} hari); memerlukan sokongan semula.`,
                          editingLeaveId.toString(), rec.ic, applicant);
                  }
                  showToast('✅ Permohonan cuti dikemaskini.');
                  closeLeaveModal();
              } catch (err) {
                  console.error("Error updating leave: ", err);
                  showToast("Ralat mengemaskini rekod cuti.");
              }
          }
      });
  }
}

function renderAnalyticsDashboard(lockedBranch = null) {
  // lockedBranch: when set (branch_analisa mode), filters are locked to that branch

  // Skop zon DAHULU — HR Terengganu tidak boleh nampak rekod Pahang dan
  // sebaliknya. Semua kiraan di bawah bermula daripada `scopedRecords`, bukan
  // `leaveRecords`, supaya tiada panel terlepas. Admin/Super Admin = semua.
  const scopedRecords = window.recordsInUserScope(leaveRecords);
  const scopeBranches = window.branchesInUserScope();
  const userScope = window.getUserStateScope(user);
  const scopeLimited = userScope && userScope !== 'all';
  // Jika penapis cawangan tersimpan berada di luar zon (cth. tukar peranan),
  // jangan hormatinya — kembali kepada semua cawangan dalam zon.
  const branchInScope = analyticsBranchFilter === 'SEMUA'
    || scopeBranches.some(b => b.name === analyticsBranchFilter);
  const effectiveBranchFilter = lockedBranch || (branchInScope ? analyticsBranchFilter : 'SEMUA');

  // Years present in the data (for the year dropdown); always include the current year.
  const analyticsYears = reportYearOptions(scopedRecords);

  // Apply year + month + branch filters
  const filteredRecords = scopedRecords.filter(r => {
    if (analyticsFilterYear !== 'SEMUA') {
      if (!r.id) return false;
      if (new Date(r.id).getFullYear().toString() !== analyticsFilterYear) return false;
    }
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
  const monthCounts = monthsList.map((m, i) => scopedRecords.filter(r => {
      if (!r.id) return false;
      if (lockedBranch && r.branch !== lockedBranch) return false;
      if (analyticsFilterYear !== 'SEMUA' && new Date(r.id).getFullYear().toString() !== analyticsFilterYear) return false;
      return new Date(r.id).getMonth() === i;
  }).length);
  const maxMonthCount = Math.max(...monthCounts, 1);

  // Label for the selected period year (used across the dashboard + chart)
  const yearLabel = analyticsFilterYear === 'SEMUA' ? 'Semua Tahun' : analyticsFilterYear;

  // Store for Chart.js
  const trend = trendWindow(monthCounts, { year: analyticsFilterYear, selected: analyticsFilterMonth });
  const trendCounts = monthCounts.slice(trend.start, trend.end + 1);
  const trendTotal = trendCounts.reduce((a, b) => a + b, 0);
  const trendPeak = Math.max(...trendCounts, 0);
  const trendPeakMonth = trendPeak > 0 ? monthsList[trend.start + trendCounts.indexOf(trendPeak)] : '';
  window._analyticsData = { monthCounts, monthsList, types, totalReqs, sortedBranches, filteredRecords, yearLabel, trend };

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
            <h1 style="font-size:1.3rem;font-weight:800;margin:0;letter-spacing:-0.3px;">${lockedBranch ? `Analisa Cuti Cawangan` : scopeLimited ? `Analisa Cuti — Zon ${userScope}` : 'Analisa Cuti — Admin View'}</h1>
            <p style="color:var(--text-muted);font-size:0.8rem;margin:0.15rem 0 0;">${lockedBranch ? `${lockedBranch} — rekod cuti kakitangan cawangan` : scopeLimited ? `${scopeBranches.length} cawangan dalam seliaan anda — rekod zon lain tidak dipaparkan` : 'Gambaran keseluruhan rekod cuti seluruh kakitangan'}</p>
          </div>
        </div>
        <div style="display:flex;gap:0.65rem;align-items:center;flex-wrap:wrap;">
          ${lockedBranch
            ? `<div style="display:flex;align-items:center;gap:0.5rem;background:rgba(251,146,60,0.1);border:1px solid rgba(251,146,60,0.3);border-radius:8px;padding:0.45rem 0.9rem;font-size:0.82rem;font-weight:700;color:#fb923c;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
                ${lockedBranch}
              </div>`
            : `<select class="neu-inset" style="padding:0.45rem 0.9rem;font-size:0.85rem;width:auto;color-scheme:light;font-weight:600;" onchange="window.setAnalyticsBranch(this.value)">
                <option value="SEMUA" ${effectiveBranchFilter === 'SEMUA' ? 'selected' : ''}>${scopeLimited ? 'Semua Cawangan (zon anda)' : 'Semua Cawangan'}</option>
                ${scopeBranches.map(b => `<option value="${b.name}" ${effectiveBranchFilter === b.name ? 'selected' : ''}>${b.name}</option>`).join('')}
              </select>`
          }
          <select class="neu-inset" style="padding:0.45rem 0.9rem;font-size:0.85rem;width:auto;color-scheme:light;font-weight:600;" onchange="window.setAnalyticsYear(this.value)">
            <option value="SEMUA" ${analyticsFilterYear === 'SEMUA' ? 'selected' : ''}>Semua Tahun</option>
            ${analyticsYears.map(y => `<option value="${y}" ${analyticsFilterYear === y ? 'selected' : ''}>${y}</option>`).join('')}
          </select>
          <select id="month-filter" class="neu-inset" style="padding:0.45rem 0.9rem;font-size:0.85rem;width:auto;color-scheme:light;font-weight:600;" onchange="window.setAnalyticsMonth(this.value)">
            <option value="0" ${analyticsFilterMonth === 0 ? 'selected' : ''}>Semua Bulan</option>
            ${monthsList.map((m,i) => `<option value="${i+1}" ${analyticsFilterMonth === i+1 ? 'selected' : ''}>${m}${analyticsFilterYear !== 'SEMUA' ? ' ' + analyticsFilterYear : ''}</option>`).join('')}
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
            Tahun ${yearLabel}
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
              <div style="font-size:0.75rem;color:var(--text-muted);margin-top:0.2rem;">Ikut tarikh permohonan dihantar · klik bar untuk tapis bulan</div>
            </div>
            <div style="text-align:right;font-size:0.75rem;color:var(--text-muted);line-height:1.5;">
              <div><strong style="color:var(--text);font-size:0.95rem;">${trendTotal}</strong> permohonan</div>
              ${trendPeak > 0 ? `<div>Tertinggi <strong style="color:var(--text);">${trendPeak}</strong> (${trendPeakMonth})</div>` : ''}
            </div>
          </div>
          ${analyticsFilterMonth ? `
          <div style="margin:-0.5rem 0 0.75rem;">
            <button onclick="window.setAnalyticsMonth(0)" style="border:1px solid rgba(155,44,44,0.25);background:rgba(155,44,44,0.06);color:var(--primary);border-radius:999px;padding:0.2rem 0.65rem;font-size:0.7rem;font-weight:700;cursor:pointer;">${monthsList[analyticsFilterMonth-1]} &nbsp;✕ Semua bulan</button>
          </div>` : ''}
          <div style="position:relative;height:200px;">
            <canvas id="chart-monthly"></canvas>
          </div>
        </div>

        <!-- Donut Chart -->
        <div class="glass-card" style="padding:1.5rem;">
          <h3 style="font-size:0.95rem;font-weight:700;margin:0 0 0.2rem;">Jenis Cuti</h3>
          <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:1rem;">Pecahan ${analyticsFilterMonth === 0 ? yearLabel : monthsList[analyticsFilterMonth-1] + (analyticsFilterYear !== 'SEMUA' ? ' ' + analyticsFilterYear : '')}</div>
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
                    <span style="font-size:0.73rem;font-weight:600;">${leaveTypeName(id)}</span>
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
          ${[['SEMUA','Semua'],['Doctor','Doktor'],['Admin Staff','Admin'],['Operation Staff','Operasi']].map(([val, label]) => `
            <button onclick="window.setAnalyticsCat('${val}')" style="padding:0.35rem 0.85rem;font-size:0.75rem;border-radius:20px;border:1px solid ${analyticsCatFilter === val ? 'var(--primary)' : 'rgba(163,177,198,0.3)'};cursor:pointer;transition:all 0.2s;font-weight:600;background:${analyticsCatFilter === val ? 'var(--primary)' : 'transparent'};color:${analyticsCatFilter === val ? 'white' : 'var(--text-muted)'};">${label}</button>
          `).join('')}
        </div>
      </div>

      <section style="display:grid;grid-template-columns:repeat(3,1fr);gap:1.25rem;margin-bottom:1.75rem;">
        ${[
          {type:'AL',    label:'Annual Leave',    short:'AL',  grad:'linear-gradient(135deg,#3b82f6,#6366f1)', glow:'rgba(59,130,246,0.3)',  icon:'<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'},
          {type:'MC',    label:'Medical Leave',   short:'MC',  grad:'linear-gradient(135deg,#059669,#10b981)', glow:'rgba(16,185,129,0.3)',  icon:'<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>'},
          {type:'EL_EMG',label:'Cuti Kecemasan', short:'EL',  grad:'linear-gradient(135deg,#dc2626,#f97316)', glow:'rgba(239,68,68,0.3)',   icon:'<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'},
        ].map(cat => {
          const ranked = rankLeaveUsers(filteredRecords, cat.type, analyticsCatFilter);
          const top3 = ranked.slice(0, 3);
          const approvedRecords = ranked.reduce((s, r) => s + r.count, 0);
          const medals = [
            { emoji:'🥇', bg:'linear-gradient(135deg,#fbbf24,#f59e0b)', shadow:'rgba(251,191,36,0.4)' },
            { emoji:'🥈', bg:'linear-gradient(135deg,#cbd5e1,#94a3b8)', shadow:'rgba(148,163,184,0.4)' },
            { emoji:'🥉', bg:'linear-gradient(135deg,#c2956c,#b45309)', shadow:'rgba(180,83,9,0.4)' },
          ];
          return `
          <div class="glass-card" onclick="window.openRankModal('${cat.type}')" style="padding:0;overflow:hidden;cursor:pointer;" title="Klik untuk senarai penuh">
            <div style="padding:1rem 1.2rem;background:${cat.grad};display:flex;align-items:center;gap:0.75rem;box-shadow:0 4px 15px ${cat.glow};">
              <div style="width:34px;height:34px;border-radius:9px;background:rgba(255,255,255,0.2);display:flex;align-items:center;justify-content:center;">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">${cat.icon}</svg>
              </div>
              <div>
                <div style="font-size:0.8rem;font-weight:800;color:#fff;letter-spacing:0.3px;">${cat.label}</div>
                <div style="font-size:0.65rem;color:rgba(255,255,255,0.75);font-weight:600;">TOP 3 ${analyticsCatFilter !== 'SEMUA' ? '· ' + analyticsCatLabel(analyticsCatFilter) : ''}</div>
              </div>
              <div style="margin-left:auto;background:rgba(255,255,255,0.2);border-radius:8px;padding:0.25rem 0.6rem;">
                <span style="font-size:0.9rem;font-weight:800;color:#fff;">${approvedRecords}</span>
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
                      <div style="font-size:1rem;font-weight:800;background:${cat.grad};-webkit-background-clip:text;-webkit-text-fill-color:transparent;">${r.days}</div>
                      <div style="font-size:0.6rem;color:var(--text-muted);font-weight:600;">HARI</div>
                    </div>
                  </div>
                `).join('')
              }
              <div style="text-align:center;margin-top:0.15rem;font-size:0.7rem;font-weight:700;color:var(--primary);letter-spacing:0.2px;">Lihat semua →</div>
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
            <p style="font-size:0.72rem;color:var(--text-muted);margin:0;">${analyticsBranchFilter === 'SEMUA' ? `${yearLabel} — diisih dari tertinggi` : analyticsBranchFilter + ' — rekod dalam cawangan ini'}</p>
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

      ${analyticsRankModal ? (() => {
        const meta = {
          'AL':     { label:'Annual Leave',    grad:'linear-gradient(135deg,#3b82f6,#6366f1)', glow:'rgba(59,130,246,0.3)' },
          'MC':     { label:'Medical Leave',   grad:'linear-gradient(135deg,#059669,#10b981)', glow:'rgba(16,185,129,0.3)' },
          'EL_EMG': { label:'Cuti Kecemasan', grad:'linear-gradient(135deg,#dc2626,#f97316)', glow:'rgba(239,68,68,0.3)' },
        }[analyticsRankModal] || { label:'Cuti', grad:'linear-gradient(135deg,#3b82f6,#6366f1)', glow:'rgba(59,130,246,0.3)' };
        const rows = rankLeaveUsers(filteredRecords, analyticsRankModal, analyticsCatFilter);
        const medals = ['🥇','🥈','🥉'];
        return `
        <div style="position:fixed;inset:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;" onclick="if(event.target===this)window.closeRankModal()">
          <div class="glass-card fade-in" style="width:100%;max-width:520px;border-radius:1.25rem;position:relative;max-height:85vh;display:flex;flex-direction:column;overflow:hidden;">
            <div style="padding:1.1rem 1.3rem;background:${meta.grad};box-shadow:0 4px 15px ${meta.glow};display:flex;align-items:center;gap:0.75rem;">
              <div>
                <div style="font-size:0.95rem;font-weight:800;color:#fff;letter-spacing:0.3px;">${meta.label} — Senarai Penuh</div>
                <div style="font-size:0.66rem;color:rgba(255,255,255,0.8);font-weight:600;">Cuti diluluskan sahaja${analyticsCatFilter !== 'SEMUA' ? ' · ' + analyticsCatLabel(analyticsCatFilter) : ''} · ${rows.length} staf</div>
              </div>
              <button onclick="window.closeRankModal()" style="margin-left:auto;background:rgba(255,255,255,0.2);border:none;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#fff;flex-shrink:0;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </div>
            <div style="padding:1rem;overflow-y:auto;display:flex;flex-direction:column;gap:0.5rem;">
              ${rows.length === 0
                ? `<div style="text-align:center;padding:2rem 1rem;color:var(--text-muted);">
                    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" style="opacity:0.25;margin-bottom:0.5rem;"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                    <div style="font-size:0.8rem;font-weight:600;">Tiada rekod diluluskan</div>
                  </div>`
                : rows.map((r, i) => `
                  <div style="display:flex;justify-content:space-between;align-items:center;background:rgba(163,177,198,0.07);padding:0.6rem 0.8rem;border-radius:10px;border:1px solid rgba(163,177,198,0.12);">
                    <div style="display:flex;align-items:center;gap:0.7rem;min-width:0;">
                      <div style="width:28px;height:28px;border-radius:8px;background:${i < 3 ? 'transparent' : 'rgba(163,177,198,0.18)'};display:flex;align-items:center;justify-content:center;font-size:${i < 3 ? '1.05rem' : '0.72rem'};font-weight:800;color:var(--text-muted);flex-shrink:0;">${i < 3 ? medals[i] : (i + 1)}</div>
                      <div style="min-width:0;">
                        <div style="font-size:0.82rem;font-weight:700;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${r.name}</div>
                        <div style="font-size:0.65rem;color:var(--text-muted);">${r.branch || ''} · ${r.count} permohonan</div>
                      </div>
                    </div>
                    <div style="text-align:right;flex-shrink:0;padding-left:0.6rem;">
                      <div style="font-size:1rem;font-weight:800;background:${meta.grad};-webkit-background-clip:text;-webkit-text-fill-color:transparent;">${r.days}</div>
                      <div style="font-size:0.6rem;color:var(--text-muted);font-weight:600;">HARI</div>
                    </div>
                  </div>
                `).join('')
              }
            </div>
          </div>
        </div>`;
      })() : ''}
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
            ? emptyState({ compact: true, icon: 'calendar', title: 'Tiada rekod' })
            : `<div style="display:flex;flex-direction:column;gap:0.65rem;">
                ${Object.entries(typeMap).map(([id, count], idx) => {
                  const pct = total > 0 ? Math.round(count / total * 100) : 0;
                  const c = _donutColors[idx % _donutColors.length];
                  return `
                  <div>
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.25rem;">
                      <div style="display:flex;align-items:center;gap:0.45rem;">
                        <span style="width:9px;height:9px;border-radius:3px;background:${c};flex-shrink:0;display:inline-block;"></span>
                        <span style="font-size:0.73rem;font-weight:600;">${leaveTypeName(id)}</span>
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
            ? emptyState({ compact: true, icon: 'calendar', title: 'Tiada cuti diluluskan lagi' })
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
            ? emptyState({ compact: true, icon: 'check', title: 'Tiada permohonan menunggu', text: 'Semua permohonan cawangan sudah diproses.' })
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

      ${window.isBranchScopedHod(user) ? `
      <section class="glass-card" style="padding:1rem 1.25rem;margin-top:1.5rem;">
        <div style="font-size:0.72rem;text-transform:uppercase;color:var(--text-muted);font-weight:700;letter-spacing:0.5px;margin-bottom:0.75rem;">Rekod Cuti Cawangan</div>
        <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:0.82rem;">
          <thead><tr style="text-align:left;color:var(--text-muted);font-size:0.72rem;text-transform:uppercase;">
            <th style="padding:0.4rem 0.5rem;">Nama</th><th style="padding:0.4rem 0.5rem;">Jenis</th>
            <th style="padding:0.4rem 0.5rem;">Tarikh</th><th style="padding:0.4rem 0.5rem;">Hari</th>
            <th style="padding:0.4rem 0.5rem;">Status</th><th style="padding:0.4rem 0.5rem;">Tindakan</th>
          </tr></thead>
          <tbody>
            ${branchRecords.length === 0
              ? emptyRow(6, { icon: 'calendar', title: 'Tiada rekod cuti untuk cawangan ini' })
              : branchRecords.map(r => `
              <tr style="border-top:1px solid rgba(163,177,198,0.18);">
                <td style="padding:0.45rem 0.5rem;font-weight:600;">${r.name || ''}</td>
                <td style="padding:0.45rem 0.5rem;">${leaveTypeName(r.type)}</td>
                <td style="padding:0.45rem 0.5rem;color:var(--text-muted);">${r.startDate} → ${r.endDate}</td>
                <td style="padding:0.45rem 0.5rem;">${r.days}</td>
                <td style="padding:0.45rem 0.5rem;">${statusBadge(r.status)}</td>
                <td style="padding:0.45rem 0.5rem;white-space:nowrap;">
                  ${window.canCorrectBranchLeave(user, r) ? `
                    ${!['APPROVED', 'REJECTED', 'CANCELLED'].includes(r.status)
                      ? `<button class="neu-btn sm is-edit" onclick="window.editLeave(${r.id})">Edit</button>` : ''}
                    ${r.status !== 'CANCELLED' && window.effectivePerms(user).can_cancel
                      ? `<button class="neu-btn sm is-cancel" onclick="window.cancelLeave(${r.id})">Batal</button>` : ''}
                  ` : ''}
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
        </div>
      </section>` : ''}

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
    { label: 'Cuti Paterniti (PL)', stats: mlPlStats, color: '#6366f1' },
    { label: 'Cuti Ehsan', stats: elStats, color: '#f59e0b' },
    { label: 'Cuti Kecemasan', stats: elEmgStats, color: '#ef4444' },
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
          <h1 style="font-size: 1.75rem; letter-spacing: -0.5px;">Selamat kembali, ${(user.name || '').split(' ')[0]}!</h1>
          <p style="color: var(--text-muted); font-size: 1.05rem;">Ringkasan baki dan aktiviti cuti anda.</p>
        </div>
        <div class="action-buttons">
          <button class="btn-primary" style="width: auto; padding: 0.75rem 1.5rem; border-radius: 14px; font-weight: 700; display: flex; align-items: center; gap: 0.5rem;" onclick="window.setView('leave-form')">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            MOHON CUTI
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
            ${showAllMyRecords ? `Semua Rekod Permohonan (${myRecords.length})` : 'Rekod Permohonan Terkini'}
          </h3>
          <div style="overflow-x: auto;${showAllMyRecords ? ' max-height: 520px; overflow-y: auto;' : ''}">
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
                  ? emptyRow(5, { icon: 'calendar', title: 'Anda belum memohon cuti', text: 'Permohonan cuti anda akan dipaparkan di sini.', action: { label: 'Mohon Cuti', onclick: "window.setView('leave-form')" } })
                  : (showAllMyRecords ? myRecords : myRecords.slice(0, 5)).map(act => `
                  <tr>
                    <td style="font-weight: 700;">${leaveTypeName(act.type)}</td>
                    <td style="color: var(--text-muted); font-size: 1rem;">${act.startDate} → ${act.endDate}</td>
                    <td style="font-weight: 600;">${act.days} Hari</td>
                    <td>${statusBadge(act.status)}</td>
                    <td><div style="display:flex;gap:0.4rem;flex-wrap:wrap;">${act.ic === user.ic && !['APPROVED','REJECTED','CANCELLED'].includes(act.status) ? `<button class="neu-btn sm is-edit" onclick="window.editLeave(${act.id})"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>Edit Cuti</button>` : ''}<button class="neu-btn sm is-print" onclick="printLeave(${act.id})" title="Cetak borang cuti untuk simpanan"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V2h12v7"></path><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>Cetak</button></div></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          ${myRecords.length > 5 ? `<div style="text-align: center; margin-top: 1.5rem;"><button class="neu-btn" style="width: auto; padding: 0.5rem 2rem; font-size: 1.05rem;" onclick="window.toggleAllMyRecords()">${showAllMyRecords ? 'TUNJUK 5 TERKINI SAHAJA' : `LIHAT SEMUA REKOD (${myRecords.length})`}</button></div>` : ''}
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
             <p style="font-size: 1rem; color: var(--text-muted); line-height: 1.6;">Sila pastikan permohonan AL dibuat sekurang-kurangnya <strong>${getNoticeDays(user)} hari</strong> awal mengikut polisi ${window.isSubsidiaryUser(user) ? 'syarikat' : 'syarikat KSB'}.</p>
             <button class="neu-btn" style="margin-top: 1rem; font-size: 1.05rem;" onclick="window.setView('policy')">BUKA POLISI PENUH</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ── Kalendar Cuti ───────────────────────────────────────────────────────────
// Siapa boleh lihat: admin/super_admin/HR (ikut zon) dan pelulus Peringkat 0/1
// (cawangan sendiri sahaja). Staf biasa tidak nampak cuti orang lain.
// RBAC leave_calendar (v2.5.19). Skop (zon vs cawangan) ditentukan dalam
// renderLeaveCalendar; pemerhati bukan-zon perlu ada cawangan untuk dikunci.
window.canSeeLeaveCalendar = function(u) {
  if (!u) return false;
  if (!_granted(window.effectivePerms(u).leave_calendar)) return false;
  return ['super_admin', 'admin', 'hr'].includes(u.role) || !!u.branch;
};
window.calShift = function(delta) { calMonth = shiftMonth(calMonth, delta); render(); };
window.calToday = function() {
  const t = new Date().toISOString();
  calMonth = t.slice(0, 7); calSelected = t.slice(0, 10); render();
};
window.setCalBranch = function(v) { calBranch = v; render(); };
// Tukar negeri → reset cawangan, supaya cawangan negeri lain tidak tertinggal dipilih.
window.setCalState = function(v) { calState = v; calBranch = SCOPE_ALL; render(); };
window.calSelectDay = function(d) { calSelected = d; render(); };

function renderLeaveCalendar() {
  if (!window.canSeeLeaveCalendar(user)) {
    return emptyState({ icon: 'calendar', title: 'Tiada akses', text: 'Kalendar cuti hanya untuk pelulus dan HR.' });
  }
  const isZoneViewer = ['super_admin', 'admin', 'hr'].includes(user.role);
  const scope = window.getUserStateScope(user);
  // Pelulus cawangan dikunci pada cawangannya sendiri — tidak percaya calBranch.
  const branchFilter = isZoneViewer ? calBranch : user.branch;
  // Zon ialah sempadan keselamatan (filterByScope): HR Pahang hanya Pahang
  // (termasuk Utama), HR Terengganu hanya Terengganu. Tab negeri hanya untuk
  // admin (skop 'all') — dan filterByScope tetap tidak mempercayai nilainya.
  const stateTabs = isZoneViewer ? visibleStates(scope) : [];
  const stateFilter = stateTabs.length > 1 && stateTabs.includes(calState) ? calState : SCOPE_ALL;
  const scoped = isZoneViewer
    ? filterByScope(leaveRecords, { userScope: scope, state: stateFilter, branch: branchFilter, stateOfBranch: window.scopeStateOfBranch })
    : leaveRecords.filter(r => r.branch === user.branch);
  const branchList = isZoneViewer
    ? branchOptions(branches, { userScope: scope, state: stateFilter, stateOfBranch: window.scopeStateOfBranch })
    : [];

  const [y, m] = calMonth.split('-').map(Number);
  const weeks = monthGrid(y, m);
  const from = weeks[0][0].date, to = weeks[weeks.length - 1][6].date;
  const byDay = leavesByDay(scoped, from, to);
  const today = new Date().toISOString().slice(0, 10);

  // Cuti umum: hanya bila negeri dapat ditentukan (satu cawangan, atau zon tunggal).
  // Cuti umum ikut negeri SEBENAR cawangan (Utama = Terengganu walaupun kelulusannya ikut Pahang).
  const holState = branchFilter !== SCOPE_ALL ? ((branches.find(b => b.name === branchFilter) || {}).state || window.scopeStateOfBranch(branchFilter))
                 : stateFilter !== SCOPE_ALL ? stateFilter
                 : (scope && scope !== 'all' ? scope : null);
  const holList = holState === 'Terengganu' ? publicHolidays.terengganu : holState === 'Pahang' ? publicHolidays.pahang : [];
  const holidays = new Map((holList || []).map(h => [h.date, h.name]));

  const color = (r) => (leaveCategories.find(c => c.id === r.type) || {}).color || '#94a3b8';
  const esc = (t) => String(t || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const firstName = (n) => esc(String(n || '').split(' ').slice(0, 2).join(' '));

  const monthTotal = new Set(weeks.flat().filter(c => c.inMonth).flatMap(c => (byDay.get(c.date) || []).map(r => r.id))).size;
  const selList = byDay.get(calSelected) || [];
  // Bilangan permohonan (unik) bagi setiap jenis cuti dalam bulan ini — untuk petunjuk warna.
  const typeCounts = new Map();
  for (const r of new Map(weeks.flat().filter(c => c.inMonth).flatMap(c => (byDay.get(c.date) || []).map(x => [x.id, x]))).values()) {
    typeCounts.set(r.type, (typeCounts.get(r.type) || 0) + 1);
  }

  return `
    <div class="leave-cal fade-in">
      <div class="cal-header">
        <div>
          <h2 class="cal-title">Kalendar Cuti</h2>
          <div class="cal-sub">${isZoneViewer ? (scope === 'all' ? (stateFilter === SCOPE_ALL ? 'Pahang & Terengganu' : esc(stateFilter)) : 'Zon ' + esc(scope)) : esc(user.branch)} · ${monthTotal} permohonan bulan ini</div>
        </div>
        <div class="cal-controls">
          ${stateTabs.length > 1 ? `
          <div class="cal-state-tabs" role="tablist">
            ${[SCOPE_ALL, ...stateTabs].map(st => `<button role="tab" class="cal-state-tab ${stateFilter === st ? 'active' : ''}" onclick="window.setCalState('${st}')">${st === SCOPE_ALL ? 'Semua' : st}</button>`).join('')}
          </div>` : ''}
          ${isZoneViewer ? `
          <select class="neu-inset cal-branch" onchange="window.setCalBranch(this.value)">
            <option value="${SCOPE_ALL}" ${calBranch === SCOPE_ALL ? 'selected' : ''}>Semua cawangan</option>
            ${branchList.map(b => `<option value="${esc(b)}" ${calBranch === b ? 'selected' : ''}>${esc(b)}</option>`).join('')}
          </select>` : ''}
          <div class="cal-nav">
            <button class="icon-btn" onclick="window.calShift(-1)" title="Bulan sebelum" aria-label="Bulan sebelum"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="15 18 9 12 15 6"/></svg></button>
            <div class="cal-month">${monthLabel(calMonth)}</div>
            <button class="icon-btn" onclick="window.calShift(1)" title="Bulan seterusnya" aria-label="Bulan seterusnya"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="9 18 15 12 9 6"/></svg></button>
            <button class="neu-btn sm is-print" onclick="window.calToday()">Hari Ini</button>
          </div>
        </div>
      </div>

      <div class="cal-legend">
        <span><i class="cal-chip-demo"></i> Diluluskan</span>
        <span><i class="cal-chip-demo is-pending"></i> Dalam proses</span>
        ${holidays.size ? '<span><i class="cal-hol-demo"></i> Cuti umum</span>' : ''}
      </div>
      <div class="cal-type-legend" aria-label="Petunjuk warna jenis cuti">
        ${leaveCategories.map(c => {
          const n = typeCounts.get(c.id) || 0;
          return `<span class="cal-type${n ? '' : ' is-empty'}" title="${esc(c.name)}${n ? ' — ' + n + ' permohonan bulan ini' : ''}"><i style="background:${c.color}"></i>${esc(c.name)}${n ? `<b>${n}</b>` : ''}</span>`;
        }).join('')}
      </div>

      <div class="cal-grid glass-card">
        ${['Isn', 'Sel', 'Rab', 'Kha', 'Jum', 'Sab', 'Ahd'].map(d => `<div class="cal-dow">${d}</div>`).join('')}
        ${weeks.flat().map(c => {
          const list = byDay.get(c.date) || [];
          const hol = holidays.get(c.date);
          const cls = ['cal-cell', c.inMonth ? '' : 'is-out', c.date === today ? 'is-today' : '', c.date === calSelected ? 'is-selected' : '', hol ? 'is-holiday' : ''].join(' ');
          return `<div class="${cls}" onclick="window.calSelectDay('${c.date}')">
            <div class="cal-day"><span>${c.day}</span>${list.length ? `<b class="cal-count">${list.length}</b>` : ''}</div>
            ${hol ? `<div class="cal-hol" title="${esc(hol)}">${esc(hol)}</div>` : ''}
            <div class="cal-chips">
              ${list.slice(0, 3).map(r => `<div class="cal-chip${r.status === 'APPROVED' ? '' : ' is-pending'}" style="--lc:${color(r)}" title="${esc(r.name)} — ${esc(leaveTypeName(r.type))} (${esc(r.status)})">${firstName(r.name)}</div>`).join('')}
              ${list.length > 3 ? `<div class="cal-more">+${list.length - 3} lagi</div>` : ''}
            </div>
          </div>`;
        }).join('')}
      </div>

      <div class="cal-detail glass-card">
        <div class="cal-detail-head">
          ${new Date(calSelected + 'T00:00:00').toLocaleDateString('ms-MY', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          ${holidays.get(calSelected) ? `<span class="cal-hol-tag">${esc(holidays.get(calSelected))}</span>` : ''}
        </div>
        ${selList.length === 0
          ? emptyState({ compact: true, icon: 'check', title: 'Tiada staf bercuti pada hari ini' })
          : selList.map(r => `
            <div class="cal-detail-row">
              <span class="cal-dot" style="background:${color(r)}"></span>
              <div class="cal-detail-main">
                <div class="cal-detail-name">${esc(r.name)}</div>
                <div class="cal-detail-meta">${esc(leaveTypeName(r.type))} · ${esc(r.branch)} · ${esc(r.startDate)}${r.endDate && r.endDate !== r.startDate ? ' → ' + esc(r.endDate) : ''} (${esc(r.days)} hari)</div>
              </div>
              ${statusBadge(r.status, { compact: true })}
            </div>`).join('')}
      </div>
    </div>`;
}

function renderView() {
  switch (view) {
    case 'calendar':
      return renderLeaveCalendar();
    case 'dashboard':
      const dashboardRbac = window.effectivePerms(user);
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
                <button onclick="window.setDashboardTab('analytics')" style="border:none;padding:0.6rem 1.4rem;border-radius:8px;font-size:0.92rem;font-weight:700;cursor:pointer;transition:all 0.2s;${dashboardTab === 'analytics' ? 'background:var(--primary);color:#fff;box-shadow:0 4px 12px var(--primary-glow);' : 'background:transparent;color:var(--text-muted);'}">
                  📊 ANALISA (ADMIN)
                </button>` : ''}
                ${canSeeBranchAnalytics ? `
                <button onclick="window.setDashboardTab('branch_analytics')" style="border:none;padding:0.6rem 1.4rem;border-radius:8px;font-size:0.92rem;font-weight:700;cursor:pointer;transition:all 0.2s;${dashboardTab === 'branch_analytics' ? 'background:linear-gradient(135deg,#fb923c,#f97316);color:#fff;box-shadow:0 4px 12px rgba(251,146,60,0.35);' : 'background:transparent;color:var(--text-muted);'}">
                  📊 ANALISA CAWANGAN
                </button>` : ''}
                ${canSeeBranch ? `
                <button onclick="window.setDashboardTab('branch')" style="border:none;padding:0.6rem 1.4rem;border-radius:8px;font-size:0.92rem;font-weight:700;cursor:pointer;transition:all 0.2s;${dashboardTab === 'branch' ? 'background:var(--primary);color:#fff;box-shadow:0 4px 12px var(--primary-glow);' : 'background:transparent;color:var(--text-muted);'}">
                  🏠 CAWANGAN SAYA
                </button>` : ''}
                <button onclick="window.setDashboardTab('personal')" style="border:none;padding:0.6rem 1.4rem;border-radius:8px;font-size:0.92rem;font-weight:700;cursor:pointer;transition:all 0.2s;${dashboardTab === 'personal' ? 'background:var(--primary);color:#fff;box-shadow:0 4px 12px var(--primary-glow);' : 'background:transparent;color:var(--text-muted);'}">
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
      // Cuti Ganti ialah cuti gantian selepas mesyuarat doktor — doktor sahaja.
      // super_admin turut melihatnya walaupun bukan doktor, supaya jenis cuti ini
      // kelihatan wujud dari akaun pentadbir tanpa perlu log masuk sebagai doktor.
      const canApplyRL = user.category === 'Doctor' || user.role === 'super_admin';

      if (selectedLeaveType === 'ML' && gender === 'Male') selectedLeaveType = 'AL';
      if (selectedLeaveType === 'ML_PL' && gender === 'Female') selectedLeaveType = 'AL';
      if (selectedLeaveType === 'RL' && !canApplyRL) selectedLeaveType = 'AL';

      const filteredCategories = leaveCategories.filter(cat => {
          if (cat.id === 'ML') return gender === 'Female';
          if (cat.id === 'ML_PL') return gender === 'Male';
          if (cat.id === 'RL') return canApplyRL;
          return true;
      });

      const currentCat = leaveCategories.find(c => c.id === selectedLeaveType) || leaveCategories[0];
      const isAL = selectedLeaveType === 'AL';
      const isMC = selectedLeaveType === 'MC';
      const isNoticeExempt = ['MC', 'EL_EMG', 'EL', 'CME', 'RL'].includes(selectedLeaveType);
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
        'RL':          '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>',
      };
      const leaveShort = {
        'AL':'Tahunan','MC':'Sakit','EL':'Ehsan','EL_EMG':'Kecemasan',
        'UP':'Tanpa Gaji','HL':'Hospital','ML':'Bersalin','ML_PL':'Paterniti',
        'CME':'CME','RL':'Ganti'
      };
      const selStats = window.getLeaveStats(user, selectedLeaveType);
      const selEnt   = selStats.ent;
      const selUsed  = selStats.used;
      const selBal   = parseFloat(selStats.bal.toFixed(2));
      const selPct   = selEnt > 0 ? Math.min(100, Math.round((selUsed / selEnt) * 100)) : 0;
      const selCat   = leaveCategories.find(c => c.id === selectedLeaveType) || leaveCategories[0];

      return `
        ${canUseTestMode(user) ? renderTestModePanel() : ''}
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
                    <h1 style="font-size:1.15rem;font-weight:800;color:#f1f5f9;margin:0;letter-spacing:-0.2px;">Borang Permohonan Cuti${leaveTestMode && canUseTestMode(user) ? ' <span style="font-size:0.7rem;background:#d97706;color:#fff;border-radius:6px;padding:0.15rem 0.5rem;vertical-align:middle;">🧪 TEST</span>' : ''}</h1>
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
                        <strong style="color:#3b82f6;">Medical Leave (MC)</strong> — ${(() => { const _b = branches.find(b => b.name === user.branch); const _trg = _b && _b.state === 'Terengganu'; return _trg ? 'Dihantar <strong>terus kepada HOD / PIC_HOD</strong> cawangan anda untuk semakan &amp; kelulusan.' : 'Dihantar <strong>terus kepada HR</strong> untuk semakan &amp; kelulusan, tanpa melalui HOD / Supervisor.'; })()} Tiada had notis minimum. Sila pastikan Sijil Sakit (MC) disertakan.
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
                      // Guna computeLeaveDays (sama seperti semasa hantar) supaya preview
                      // tepat: staf Admin (mis. Admin Balok) langkau Sabtu/Ahad + cuti umum.
                      let d = window.computeLeaveDays(leaveStartDate, leaveEndDate, user, selectedLeaveType);
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
                  <textarea class="neu-inset" placeholder="Nyatakan sebab permohonan cuti (wajib, dengan perkataan — cth. Demam, Urusan keluarga)..." style="height:90px;font-size:0.85rem;resize:vertical;"></textarea>
                </div>
                <div>
                  <label style="font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);display:block;margin-bottom:0.4rem;">Pengganti Tugas (Handover)</label>
                  <input type="text" id="handover-input" class="neu-inset" placeholder="Nama rakan sekerja yang menggantikan..." style="font-size:0.85rem;">
                </div>
              </div>
            </div>

            ${renderProofSection(selectedLeaveType)}

            <!-- SECTION: Pelulus Peringkat 0 — TL selector untuk op-balok -->
            ${(() => {
              const _fIsOpBalok = window.getStaffGroup(user) === 'operation_balok' &&
                  !!(approvalRouting['operation_balok'] || {}).needs_tl;
              if (!_fIsOpBalok) return '';
              // Buang diri sendiri — seorang Team Leader tidak boleh menjadi pelulus
              // Peringkat 0 bagi cutinya sendiri (selari dengan getRoutingP1Approvers
              // dan guard `req.ic === user.ic` dalam canManageRequest).
              const _tlList = staffList.filter(s =>
                  s.role === 'team_leader' && (s.branch || '').includes('Balok') && !s.inactive
                  && s.ic !== user.ic
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
              // Laluan terus ke HR — tiada pilihan HOD; tunjuk notis sahaja.
              if (window.shouldSkipP1(user, selectedLeaveType)) {
                return `
            <div style="margin-bottom:1.5rem;border-radius:14px;border:1.5px solid rgba(5,150,105,0.3);background:rgba(5,150,105,0.06);padding:1rem 1.15rem;">
              <div style="display:flex;align-items:center;gap:0.5rem;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                <span style="font-size:0.78rem;font-weight:700;color:#059669;">Kelulusan Terus ke HR</span>
              </div>
              <div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.4rem;">Permohonan ini tidak memerlukan kelulusan HOD/Penyelia. Ia akan dihantar TERUS kepada HR/Admin untuk kelulusan akhir.</div>
            </div>`;
              }
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
                            const approvers = window.getRoutingP1Approvers(user, selectedLeaveType);
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
                // Utama: fizikal Terengganu, laluan kelulusan ikut Pahang (Balok HQ).
                const _routesAsPahang = ROUTES_AS_PAHANG.includes(user.branch);
                const isPahang = (branchObj && branchObj.state === 'Pahang') || _routesAsPahang;
                const isTerengganu = branchObj && branchObj.state === 'Terengganu' && !_routesAsPahang;
                const isBalokStaff = user.branch === 'Klinik Syed Badaruddin Balok (HQ)';
                const isDoctor = user.category === 'Doctor';

                let step1Who, step1Note, flowColor, flowIcon;

                if (isDoctor) {
                    if (isPahang) {
                        step1Who = 'Supervisor — Klinik Syed Badaruddin Balok (HQ)';
                        step1Note = 'Doktor Pahang (semua cawangan) mesti mendapat sokongan Supervisor Balok terlebih dahulu.';
                        flowColor = '#4361ee';
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
                } else if (isBalokStaff && user.role === 'supervisor') {
                    // Supervisor Balok — Doctor PIC Balok, bukan HOD Balok (2026-08-18).
                    step1Who = 'Doctor PIC — Klinik Syed Badaruddin Balok (HQ)';
                    step1Note = 'Supervisor Balok mendapat sokongan Doctor PIC Balok pada peringkat pertama.';
                    flowColor = '#8b5cf6';
                    flowIcon = 'M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z';
                } else if (user.category === 'Admin Staff' || user.leaveAsAdmin === true) {
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
                const isOpBalokTL = user.category === 'Operation Staff' && !user.leaveAsAdmin && isBalokStaff &&
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

                // Laluan terus ke HR (skip HOD) — paparkan aliran 1-peringkat.
                if (window.shouldSkipP1(user, selectedLeaveType)) {
                    return `
                <div style="border-radius:14px;border:1.5px solid #05966933;background:rgba(5,150,105,0.05);padding:1.1rem 1.25rem;margin-bottom:0.25rem;">
                    <div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:0.85rem;">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2.5"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"></path></svg>
                        <span style="font-size:0.78rem;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:#059669;">Aliran Kelulusan Cuti — Terus ke HR</span>
                    </div>
                    <div style="display:flex;flex-direction:column;gap:0.55rem;">
                        <div style="display:flex;align-items:flex-start;gap:0.75rem;">
                            <div style="flex-shrink:0;width:24px;height:24px;border-radius:50%;background:#059669;display:flex;align-items:center;justify-content:center;color:#fff;font-size:0.72rem;font-weight:800;margin-top:1px;">1</div>
                            <div>
                                <div style="font-size:0.82rem;font-weight:700;color:var(--text);">Kelulusan Akhir HR/Admin</div>
                                <div style="font-size:0.78rem;color:#059669;font-weight:600;margin-top:0.1rem;">HR / Admin — KSB HQ</div>
                                <div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.1rem;">${window.isSubsidiaryHR(user) ? (window.isP1OnlyHR(user) ? 'Sebagai pelulus pertama, permohonan anda dihantar terus kepada pelulus akhir syarikat.' : 'Sebagai pelulus akhir syarikat, anda boleh meluluskan permohonan anda sendiri.') : `Sebagai ${user.role === 'supervisor' ? 'Supervisor' : 'HOD Balok'}, permohonan anda dihantar terus ke HR — tanpa sokongan Peringkat 1.`}</div>
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

            <!-- Notice: Polisi Notis — sembunyi untuk cuti dikecualikan (MC/Kecemasan/Ehsan — tiada had notis minimum) -->
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
              ${(() => {
                // Papar nombor yang benar-benar terpakai kepada pengguna ini —
                // grid statik 3/7 yang lama menipu staf operasi cawangan, yang
                // kini 3 hari (polisi 2026-08-24). Sumber: getNoticeDays().
                const _nd = getNoticeDays(user);
                const _c  = _nd === 3 ? '#3b82f6' : '#8b5cf6';
                return `
                <div style="padding:0.9rem;border-radius:10px;background:${_nd === 3 ? 'rgba(59,130,246,0.06)' : 'rgba(139,92,246,0.06)'};border:1px solid ${_nd === 3 ? 'rgba(59,130,246,0.12)' : 'rgba(139,92,246,0.12)'};text-align:center;">
                  <div style="font-size:0.6rem;color:var(--text-muted);font-weight:600;text-transform:uppercase;margin-bottom:0.35rem;">Untuk anda</div>
                  <div style="font-size:2rem;font-weight:800;color:${_c};line-height:1;">${_nd}</div>
                  <div style="font-size:0.65rem;color:var(--text-muted);margin-top:0.2rem;">hari sebelum tarikh mula cuti</div>
                </div>
                ${OWN_HR_ZONE[user.branch] ? '' : `<div style="font-size:0.62rem;color:var(--text-muted);line-height:1.5;margin-top:0.75rem;">
                  <strong>3 hari</strong> — Staff Admin &amp; Staff Operasi cawangan.<br>
                  <strong>7 hari</strong> — Doktor &amp; Staff Operasi Balok (HQ).
                </div>`}`;
              })()}
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
                const isPahang = (branchObj && branchObj.state === 'Pahang') || ROUTES_AS_PAHANG.includes(user.branch);
                const isBalokStaff = user.branch === 'Klinik Syed Badaruddin Balok (HQ)';
                const isDoctor = user.category === 'Doctor';
                let step1Who;
                if (isDoctor) {
                  if (isPahang) step1Who = 'Supervisor Balok';
                  else step1Who = 'Doctor PIC Cawangan';
                } else if (user.category === 'Admin Staff') {
                  const _isBalokHQ2 = user.branch === 'Klinik Syed Badaruddin Balok (HQ)';
                  step1Who = _isBalokHQ2 ? 'HOD Balok — Balok (HQ)' : 'Doctor PIC — ' + (user.branch||'').split(' ').slice(0,3).join(' ');
                } else {
                  step1Who = isBalokStaff ? 'Supervisor Balok' : 'Doctor PIC Cawangan';
                }
                const isOperationBalok = user.category === 'Operation Staff' && isBalokStaff;
                let steps;
                if (window.shouldSkipP1(user)) {
                  // Supervisor / HOD Balok — terus ke HR, tiada Peringkat 1.
                  steps = [{ n:1, label:'Kelulusan Akhir (terus ke HR)', who: 'HR / Admin — KSB HQ', color: '#10b981' }];
                } else if (isOperationBalok) {
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
                  const catC = leaveCategories.find(c => c.id === act.type);
                  return `
                  <div style="display:flex;justify-content:space-between;align-items:center;padding:0.6rem 0.75rem;border-radius:9px;background:rgba(163,177,198,0.06);border:1px solid rgba(163,177,198,0.1);">
                    <div style="display:flex;align-items:center;gap:0.55rem;min-width:0;">
                      <div style="width:8px;height:8px;border-radius:50%;background:${catC ? catC.color : '#94a3b8'};flex-shrink:0;"></div>
                      <div style="min-width:0;">
                        <div style="font-size:0.72rem;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${leaveTypeShort(act.type)} — ${act.days} hari</div>
                        <div style="font-size:0.62rem;color:var(--text-muted);">${act.startDate || ''}</div>
                      </div>
                    </div>
                    <span style="margin-left:0.5rem;flex-shrink:0;">${statusBadge(act.status, { compact: true })}</span>
                  </div>`;
                }).join('')}
                ${leaveRecords.filter(r => r.ic === user.ic).length === 0 ? emptyState({ compact: true, icon: 'calendar', title: 'Tiada aktiviti lagi' }) : ''}
              </div>
            </div>

          </div>
        </div>
      `;


    case 'management':
      const userPerms = window.effectivePerms(user);
      
      const hasAnyManagementAccess = window.canOpenManagement(user);

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
          'reg_requests': window.canSeeRegRequests(user)
      };

      if (!tabPermissions[managementTab]) {
          const firstAllowed = Object.keys(tabPermissions).find(tab => tabPermissions[tab]);
          if (firstAllowed) {
              managementTab = firstAllowed;
          }
      }
      
      // audit_logs / wa_logs (200 dokumen setiap satu) dimuat MALAS — hanya bila
      // tabnya benar-benar dibuka, bukan pada setiap cold load Admin/Super Admin.
      // Kedua-dua fungsi idempotent; snapshot/get yang tiba akan render() semula.
      if (managementTab === 'login_audit') ensureAuditLogListener();
      if (managementTab === 'whatsapp_settings') ensureWaLogsLoaded();
      if (managementTab === 'access_control' && !claimsSyncInfo) { claimsSyncInfo = { pendingRoles: [] }; loadClaimsSyncInfo(); }

      // Tapis staff mengikut skop negeri pengguna
      const userStateScope = window.getUserStateScope(user);
      let filteredStaff = staffList.filter(s => {
          if (s.role === 'super_admin') return false;
          if (userStateScope === 'all') return true;
          const sBranch = branches.find(b => b.name === s.branch);
          return sBranch && window.scopeStateOfBranch(s.branch) === userStateScope;
      });
      // A HOD Cawangan manages leave figures for their own branch only; the rules
      // reject anything else, so do not list staff they cannot save.
      if (window.isBranchScopedHod(user)) {
          filteredStaff = filteredStaff.filter(s => s.branch === user.branch);
      }
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
              +   statCell('AL', al.bal.toFixed(1), al.ent.toFixed(1), alLow ? '#ef4444' : '#38bdf8')
              +   statCell('MC', mc.bal, mc.ent, '#10b981')
              +   statCell('HL', hl.used, hl.ent, '#06b6d4')
              + '</div>'
              // Edit + Delete buttons
              + '<button class="btn-logout" data-ic="' + staff.ic + '" onclick="window.setEditingStaff(this.dataset.ic)" style="flex-shrink:0;width:auto;padding:0.2rem 0.65rem;font-size:0.75rem;">Edit</button>'
              + (window.isBranchScopedHod(user) ? '' : '<button class="btn-logout" data-ic="' + staff.ic + '" onclick="window.deleteStaff(this.dataset.ic)" style="flex-shrink:0;width:auto;padding:0.2rem 0.65rem;font-size:0.75rem;background:rgba(239,68,68,0.1);color:#ef4444;border:1px solid rgba(239,68,68,0.25);" title="Buang dari sistem">&#10005;</button>')
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
            +   statCell('AL', al.bal.toFixed(1), al.ent.toFixed(1), alLow ? '#ef4444' : '#38bdf8')
            +   statCell('MC', mc.bal, mc.ent, '#10b981')
            +   statCell('HL', hl.used, hl.ent, '#06b6d4')
            + '</div>'
            + '<button class="btn-logout" data-ic="' + staff.ic + '" onclick="window.setEditingStaff(this.dataset.ic)" style="flex-shrink:0;width:auto;padding:0.2rem 0.65rem;font-size:0.75rem;">Edit</button>'
            + (window.isBranchScopedHod(user) ? '' : '<button class="btn-logout" data-ic="' + staff.ic + '" onclick="window.deleteStaff(this.dataset.ic)" style="flex-shrink:0;width:auto;padding:0.2rem 0.65rem;font-size:0.75rem;background:rgba(239,68,68,0.1);color:#ef4444;border:1px solid rgba(239,68,68,0.25);" title="Buang dari sistem">&#10005;</button>')
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
          const isFullBoss = window.isFinalApprover(user);
          const isHODRole  = window.isP1Approver(user);
          const isTL = user.role === 'team_leader';
          if (isFullBoss) return leaveRecords.filter(r => window.canManageRequest(user, r) && ['HOD APPROVED','HOD RECOMMENDED','PENDING'].includes(r.status)).length;
          if (isTL) return leaveRecords.filter(r => window.canManageRequest(user, r) && r.status === 'PENDING').length;
          if (isHODRole) return leaveRecords.filter(r => window.canManageRequest(user, r) && ['PENDING','TL APPROVED'].includes(r.status)).length;
          return 0;
        })() : 0;
        const pendingRegs = window.canSeeRegRequests(user) ? window.regRequestsInScope(registrationRequests).filter(r => r.status === 'pending').length : 0;

        // which main groups are visible for this role
        const showApprovals = userPerms.manage_pending;
        const showPeople    = userPerms.manage_staff || userPerms.manage_branches || userPerms.manage_roles_categories || window.canSeeRegRequests(user);
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
              const isFullBoss = window.isFinalApprover(user);
              const isHODRole  = window.isP1Approver(user);
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
            ${window.canSeeRegRequests(user) ? (() => { const pr=window.regRequestsInScope(registrationRequests).filter(r=>r.status==='pending').length; return `<button class="neu-tab ${managementTab==='reg_requests'?'active':''}" onclick="window.setManageTab('reg_requests')" style="border-radius:8px;">Daftar Baharu${pr>0?` <span style="background:#ef4444;color:#fff;border-radius:999px;padding:0 5px;font-size:0.65rem;font-weight:800;">${pr}</span>`:''}</button>`; })() : ''}
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
              <h2 style="font-size: 1.25rem; font-weight: 600;">Menunggu Kelulusan</h2>
            </div>
            
            <div class="approval-grid">
              ${(html => html || emptyState({ icon: 'check', title: 'Tiada permohonan menunggu kelulusan', text: 'Semua permohonan sudah diproses. Kerja yang baik!' }))(leaveRecords.filter(r => {
                  if (['REJECTED', 'CANCELLED', 'APPROVED'].includes(r.status)) return false;
                  if (!window.canManageRequest(user, r)) return false;
                  const isFullBoss = window.isFinalApprover(user);
                  const isHODRole = window.isP1Approver(user);
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
                const isFullBoss = window.isFinalApprover(user);
                const showHODIndicator = req.status === 'HOD RECOMMENDED' || req.status === 'HOD APPROVED';
                const showTLIndicator = req.status === 'TL APPROVED';
                
                return `
                <div class="neu-panel">
                  <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1.5rem;">
                     <div>
                        <div style="font-size: 1.1rem; font-weight: 600; margin-bottom: 0.25rem; text-transform: uppercase;">${req.name} ${showHODIndicator ? '🟢' : showTLIndicator ? '🟡' : ''}</div>
                        <div style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 0.25rem;">${req.ic}</div>
                        <div style="font-size: 0.7rem; color: var(--primary); text-transform: uppercase; font-weight: 600;">${req.branch}</div>
                        <div style="font-size: 0.65rem; color: var(--text-muted); margin-top: 0.35rem; display: flex; align-items: center; gap: 0.3rem;">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                            Dimohon: ${req.id ? new Date(req.id).toLocaleString('ms-MY', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'}
                        </div>
                     </div>
                     <span style="color: ${req.typeColor}; background: rgba(163,177,198,0.2); padding: 0.25rem 0.75rem; border-radius: 12px; font-weight: 700; font-size: 0.8rem; border: 1px solid var(--border);">${leaveTypeShort(req.type)}</span>
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

                  ${(() => {
                      // Lencana ini yang mendedahkan duplikat yang SUDAH ada dalam
                      // barisan menunggu — ia muncul pada KEDUA-DUA kad pasangan
                      // duplikat, jadi pelulus nampak dua kad bertanda dan tolak satu.
                      const _ov = overlapsOtherLeaves(leaveRecords, req);
                      if (_ov.length === 0) return '';
                      return `
                  <div style="padding: 0.5rem 0.75rem; border-radius: 8px; margin-bottom: 1rem; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); color: #dc2626; font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">
                      ⚠️ Bertindih — staf ini ada permohonan lain untuk tarikh yang sama
                      <div style="margin-top: 0.35rem; font-weight: 600; text-transform: none; letter-spacing: 0; white-space: pre-line;">${describeOverlaps(_ov, leaveTypeName)}</div>
                  </div>`;
                  })()}

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
                    <button class="neu-btn is-print" onclick="printLeave(${req.id})">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V2h12v7"></path><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
                        Cetak
                    </button>
                    <button class="neu-btn is-wa" onclick="window.resendLeaveWA(${req.id})" title="Hantar semula notifikasi WhatsApp kepada pelulus semasa">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81a19.79 19.79 0 01-3.07-8.67A2 2 0 012 1h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L6.09 8.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z"></path><polyline points="14 2 14 8 20 8"/></svg>
                        Hantar WA
                    </button>
                    <button class="neu-btn is-edit" onclick="window.editLeave(${req.id})" title="Edit tarikh / bilangan hari / sebab sebelum sokong">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                        Edit
                    </button>
                  </div>

                  ${(() => {
                      const isHODRole = window.isP1Approver(user);
                      const isTLRole = user.role === 'team_leader';
                      const isLocumEditMode = isHODRole && req.status === 'HOD APPROVED';
                      if (isLocumEditMode) {
                          // Supervisor sees HOD APPROVED doctor record only for locum editing
                          return `
                          <div style="background:rgba(13,148,136,0.07);border:1.5px solid rgba(13,148,136,0.25);border-radius:10px;padding:0.75rem;margin-bottom:1rem;display:flex;align-items:center;gap:0.6rem;">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0d9488" stroke-width="2.5"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                            <span style="font-size:0.72rem;font-weight:700;color:#0d9488;">Mod Edit Locum — Cuti ini sudah disokong. Kemaskini maklumat locum jika perlu.</span>
                          </div>
                          <button onclick="window.saveLocumEdit(${req.id})" class="neu-btn is-locum" style="width:100%;margin-bottom:1rem;">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
                            Simpan Kemaskini Locum
                          </button>`;
                      }
                      return `
                      <div style="display: flex; gap: 0.75rem; margin-bottom: 1rem; flex-wrap: wrap;">
                          <button class="neu-btn is-approve" style="min-width: 120px;" onclick="window.finalizeLeave(${req.id})">
                             <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                             ${(() => {
                                 if (isFullBoss) return showHODIndicator ? 'Luluskan Akhir (Peringkat 2)' : 'Luluskan Terus (Bypass)';
                                 if (isTLRole) return 'Sokong & Hantar ke Supervisor';
                                 if (showTLIndicator) return 'Lulus & Hantar ke HR/Admin (Peringkat 1)';
                                 const reqB = branches.find(b => b.name === req.branch);
                                 const reqTrg = reqB && reqB.state === 'Terengganu';
                                 return reqTrg ? 'Luluskan Cuti' : 'Sokong & Hantar ke HR/Admin';
                             })()}
                          </button>
                          <button class="neu-btn is-reject" style="min-width: 100px;" onclick="window.rejectLeave(${req.id})">
                             <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
                             Tolak
                          </button>
                          ${window.effectivePerms(user).can_cancel ? `<button class="neu-btn is-cancel" style="min-width: 100px;" onclick="window.cancelLeave(${req.id})">
                             <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
                             Batal
                          </button>` : ''}
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
                  <div style="margin-top: 1rem;">${statusBadge(req.status)}</div>` : ''}
                </div>
              `;
            }).join(''))}
          </div>
        ` : ''}

        ${managementTab === 'whatsapp_settings' && window.effectivePerms(user).wa_setting ? (() => {
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
                    <p style="font-size:0.75rem;color:var(--text-muted);line-height:1.5;">Satu nombor penghantar per zon, dipilih ikut zon penerima. Zon tanpa token guna nombor Pahang.</p>
                </div>
                ${Object.keys(WA_TOKEN_FIELDS).map(zone => `
                <div class="form-group">
                    <label style="font-size:0.75rem;text-transform:uppercase;font-weight:700;color:var(--text-muted);letter-spacing:1px;">Token Fonnte — ${WA_ZONE_LABELS[zone]}</label>
                    <div style="display:flex;gap:0.75rem;margin-top:0.5rem;">
                        <input type="password" id="wa-token-${zone}" class="neu-inset" value="${WA_TOKENS[zone]}" placeholder="${zone === 'pahang' ? 'Masukkan API Token dari Fonnte...' : 'Kosong = guna nombor Pahang'}" style="flex:1;">
                        <button class="btn-primary" onclick="window.saveWAToken('${zone}', document.getElementById('wa-token-${zone}').value)" style="width:auto;padding:0.75rem 1.5rem;">Save</button>
                    </div>
                    <div style="font-size:0.65rem;color:var(--text-muted);margin-top:0.4rem;">Penghantar: <strong>${WA_DEVICES[zone] || (WA_TOKENS[zone] ? '…' : (zone === 'pahang' ? WHATSAPP_SENDER : 'guna Pahang'))}</strong></div>
                </div>`).join('')}
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

        ${managementTab === 'reg_requests' && window.canSeeRegRequests(user) ? `
          <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 2rem; margin-top: 1rem;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><line x1="19" y1="8" x2="19" y2="14"></line><line x1="22" y1="11" x2="16" y2="11"></line></svg>
            <h2 style="font-size: 1.25rem; font-weight: 600;">Permohonan Daftar Baharu</h2>
          </div>

          ${(() => {
            const pending = window.regRequestsInScope(registrationRequests).filter(r => r.status === 'pending');
            const done = window.regRequestsInScope(registrationRequests).filter(r => r.status !== 'pending');
            return `
              ${pending.length === 0 ? emptyState({ icon: 'users', title: 'Tiada pendaftaran baharu', text: 'Tiada permohonan pendaftaran staf yang menunggu kelulusan.' }) : `
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
                        ${statusBadge(req.status, { label: req.status === 'approved' ? 'Diluluskan' : 'Ditolak' })}
                      </div>
                    `).join('')}
                  </div>
                </div>
              ` : ''}
            `;
          })()}
        ` : ''}


        ${managementTab === 'master_audit' ? (() => {
          const _mlScope = window.getUserStateScope(user);
          const _mlRecords = filterByScope(leaveRecords, {
            userScope: _mlScope,
            state: masterLogState,
            branch: masterLogBranch,
            stateOfBranch: window.scopeStateOfBranch,
          });
          // Pertindihan dikira SEKALI setiap render, daripada senarai yang
          // ber-skop ZON SAHAJA (_mlZoneRecords) — bukan _mlRecords yang juga
          // ditapis oleh tab negeri/cawangan. Tab negeri/cawangan cuma
          // navigasi, bukan sempadan keselamatan; jika peta dikira selepas
          // tapisan cawangan, pasangan bertindih yang rekodnya berlainan
          // cawangan (cth. staf berpindah cawangan) akan hilang sepenuhnya
          // apabila mana-mana tab cawangan dipilih — kedua-dua rekod tidak
          // ditanda dan butang ⚠️ Bertindih hilang. Sempadan keselamatan
          // sebenar (userScope) kekal dikuatkuasakan di _mlZoneRecords.
          const _mlZoneRecords = filterByScope(leaveRecords, {
            userScope: _mlScope,
            state: SCOPE_ALL,
            branch: SCOPE_ALL,
            stateOfBranch: window.scopeStateOfBranch,
          });
          const _mlOverlaps = findOverlapGroups(_mlZoneRecords);
          const _mlRows = masterLogOverlapOnly
            ? _mlRecords.filter(r => _mlOverlaps.has(r.id))
            : _mlRecords;
          // "(N)" bermaksud N daripada baris yang anda sedang lihat (selepas
          // tab negeri/cawangan) yang bertindih — bukan jumlah keseluruhan
          // dalam zon; pasangan silang-cawangan tetap muncul dalam tooltip
          // walaupun tidak dikira di sini.
          const _mlOverlapCount = _mlRecords.reduce((n, r) => n + (_mlOverlaps.has(r.id) ? 1 : 0), 0);
          const _mlStates = visibleStates(_mlScope);
          const _mlBranchList = branchOptions(branches, {
            userScope: _mlScope,
            state: masterLogState,
            stateOfBranch: window.scopeStateOfBranch,
          });
          // Kiraan per-tab dalam SATU laluan sahaja (bukan satu filterByScope
          // berasingan bagi setiap tab cawangan + Semua + Lain-lain, ~15
          // laluan penuh atas leaveRecords pada setiap render). Sengaja
          // abaikan tab cawangan semasa supaya nombor pada setiap tab kekal
          // sama tak kira tab mana yang sedang dibuka — hanya negeri
          // (masterLogState) dan skop pengguna (_mlScope) yang tetap. Logik
          // di bawah ialah filterByScope disusun semula sebagai satu
          // pengumpulan, bukan definisi berasingan — kekalkan ia sepadan jika
          // filterByScope berubah.
          const _mlCountMap = new Map();
          let _mlAllCount = 0;
          for (const r of leaveRecords) {
            const s = window.scopeStateOfBranch(r.branch);
            const inZone = !!s && _mlStates.includes(s);
            if (!inZone) {
              // Rekod tersadai ATAU negeri di luar zon — hanya admin di tab
              // negeri SEMUA mengiranya, dan ia hanya masuk baldi Lain-lain.
              if (_mlScope === 'all' && masterLogState === SCOPE_ALL) {
                _mlAllCount++;
                _mlCountMap.set(NO_BRANCH, (_mlCountMap.get(NO_BRANCH) || 0) + 1);
              }
              continue;
            }
            if (masterLogState !== SCOPE_ALL && s !== masterLogState) continue;
            _mlAllCount++;
            _mlCountMap.set(r.branch, (_mlCountMap.get(r.branch) || 0) + 1);
          }
          const _mlCount = (branch) => branch === SCOPE_ALL ? _mlAllCount : (_mlCountMap.get(branch) || 0);
          const _mlOrphans = (_mlScope === 'all' && masterLogState === SCOPE_ALL)
            ? _mlCount(NO_BRANCH) : 0;
          // Nama cawangan masuk ke dalam atribut onclick. encodeURIComponent
          // tidak melepaskan petik tunggal, jadi ia dikendalikan sendiri.
          const _mlArg = (v) => encodeURIComponent(v).replace(/'/g, '%27');
          // Di bawah, onclick="window.setMasterLogState('ALL')" / setMasterLogBranch('ALL'
          // | '__NONE__') sengaja kekal sebagai literal 'ALL' / '__NONE__', BUKAN
          // ${SCOPE_ALL} / ${NO_BRANCH}. onclick ialah HTML yang dihurai semula sebagai
          // JS global apabila diklik — SCOPE_ALL/NO_BRANCH (import modul) tiada dalam
          // skop global itu, jadi menukarnya kepada templat akan pecah senyap. Nilainya
          // masih perlu sepadan dgn ALL/NO_BRANCH dalam masterLogScope.js secara manual.
          return `
          <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 2rem; margin-top: 1rem;">
              <div style="display: flex; align-items: center; gap: 0.75rem;">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#a855f7" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
                <h2 style="font-size: 1.25rem; font-weight: 600;">Master Logs</h2>
              </div>
              ${user.ic === 'super_admin' || user.ic === 'Super Admin' ? `
              <button onclick="showConfirm('Padam semua cache sistem?').then(ok => { if (ok) { localStorage.clear(); window.location.reload(); } })" class="neu-btn" style="background: rgba(239, 68, 68, 0.1); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.2); font-size: 0.75rem; padding: 0.5rem 1rem; border-radius: 8px; margin-left: auto;">
                 <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                 Reset System Cache
              </button>
              ` : ''}
          </div>

          <!-- _mlScope boleh jadi null (getUserStateScope tidak dapat
               selesaikan cawangan pengguna) — jadual di bawah sudah
               gagal-tertutup ke kosong dan mesej "Tiada rekod" meliputinya,
               jadi cip tidak memaparkan apa-apa dalam kes itu. -->
          ${_mlScope === 'all' ? `
          <div style="display:flex;gap:0.5rem;margin-bottom:0.75rem;overflow-x:auto;padding-bottom:0.25rem;">
            <button class="neu-tab ${masterLogState === SCOPE_ALL ? 'active' : ''}" onclick="window.setMasterLogState('ALL')" style="border-radius:8px;white-space:nowrap;">SEMUA</button>
            ${_mlStates.map(s => `<button class="neu-tab ${masterLogState === s ? 'active' : ''}" onclick="window.setMasterLogState('${s}')" style="border-radius:8px;white-space:nowrap;">${s.toUpperCase()}</button>`).join('')}
          </div>
          ` : (typeof _mlScope === 'string' && _mlScope) ? `
          <div style="display:flex;align-items:center;gap:0.4rem;background:rgba(56,189,248,0.1);border:1px solid rgba(56,189,248,0.35);border-radius:20px;padding:0.25rem 0.75rem;margin-bottom:0.75rem;width:fit-content;">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#0284c7" stroke-width="2.5"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
            <span style="font-size:0.68rem;font-weight:800;color:#0284c7;letter-spacing:0.3px;">Skop: ${_mlScope}</span>
          </div>
          ` : ''}

          <div style="display:flex;gap:0.5rem;margin-bottom:1.25rem;overflow-x:auto;padding-bottom:0.25rem;">
            <button class="neu-tab ${masterLogBranch === SCOPE_ALL ? 'active' : ''}" onclick="window.setMasterLogBranch('ALL')" style="border-radius:8px;white-space:nowrap;">Semua (${_mlCount(SCOPE_ALL)})</button>
            ${_mlBranchList.map(b => `<button class="neu-tab ${masterLogBranch === b ? 'active' : ''}" onclick="window.setMasterLogBranch(decodeURIComponent('${_mlArg(b)}'))" style="border-radius:8px;white-space:nowrap;">${b} (${_mlCount(b)})</button>`).join('')}
            ${_mlOrphans > 0 ? `<button class="neu-tab ${masterLogBranch === NO_BRANCH ? 'active' : ''}" onclick="window.setMasterLogBranch('__NONE__')" style="border-radius:8px;white-space:nowrap;color:#f59e0b;" title="Rekod dengan cawangan yang tiada dalam senarai cawangan — perlu dibetulkan">Lain-lain (${_mlOrphans})</button>` : ''}
            ${(_mlOverlapCount > 0 || masterLogOverlapOnly) ? `<button class="neu-tab ${masterLogOverlapOnly ? 'active' : ''}" onclick="window.toggleMasterLogOverlap()" style="border-radius:8px;white-space:nowrap;color:#dc2626;" title="Tunjuk hanya rekod yang bertindih dengan cuti lain staf yang sama">⚠️ Bertindih (${_mlOverlapCount})</button>` : ''}
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
                          ${_mlRows.map((r, index) => `
                          <tr style="border-bottom: 1px solid rgba(255,255,255,0.03); transition: background 0.2s;${_mlOverlaps.has(r.id) ? ' border-left: 3px solid #dc2626; background: rgba(239,68,68,0.04);' : ''}">
                              <td style="padding: 1.5rem 1rem;">
                                  <div style="font-weight: 700; font-size: 0.8rem;">${r.startDate}</div>
                                  <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 0.25rem;">${r.startDate === r.endDate ? '' : `to ${r.endDate}`}</div>
                              </td>
                              <td style="padding: 1.5rem 1rem;">
                                  <div style="font-weight: 700; font-size: 0.85rem; text-transform: uppercase; margin-bottom: 0.25rem;">${r.name}</div>
                                  <div style="font-size: 0.65rem; color: var(--primary); text-transform: uppercase; font-weight: 600;">${r.branch}</div>
                                  ${_mlOverlaps.has(r.id) ? `<div title="Bertindih dengan:&#10;${describeOverlaps(_mlOverlaps.get(r.id), leaveTypeName).replace(/"/g, '&quot;')}" style="display:inline-block;margin-top:0.35rem;font-size:0.58rem;font-weight:800;color:#dc2626;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:6px;padding:0.15rem 0.4rem;letter-spacing:0.3px;cursor:help;">⚠️ BERTINDIH</div>` : ''}
                              </td>
                              <td style="padding: 1.5rem 1rem; font-weight: 700; font-size: 1rem;">
                                  ${r.days}d <span style="font-size: 0.6rem; background: rgba(59,130,246,0.1); color: ${r.typeColor}; padding: 0.2rem 0.5rem; border-radius: 4px; border: 1px solid var(--border); vertical-align: top; margin-left: 4px;">${leaveTypeShort(r.type)}</span>
                              </td>
                              <td style="padding: 1.5rem 1rem; font-size: 0.75rem; font-style: italic; color: var(--text-muted); max-width: 250px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                                  ${r.reason}
                              </td>
                              <td style="padding: 1.5rem 1rem;">
                                  ${statusBadge(r.status)}
                              </td>
                              <td style="padding: 1.5rem 1rem; text-align: right;">
                                  <div style="display: flex; gap: 1.25rem; justify-content: flex-end;">
                                      ${r.proofUrl ? `<a href="${r.proofUrl}" target="_blank" rel="noopener" title="Lihat Bukti${r.proofName ? ' (' + r.proofName + ')' : ''}" class="icon-btn is-proof"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg></a>` : ''}
                                      ${PROOF_REQUIRED_TYPES.includes(r.requestedType || r.type) && window.canEditAnyLeave(user) ? `<button class="icon-btn is-upload" onclick="window.reuploadProof(${r.id})" title="${r.proofUrl ? 'Ganti' : 'Muat Naik'} Bukti (JPG/PNG/PDF, maks 10MB)" aria-label="Bukti"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg></button>` : ''}
                                      ${window.canManageRequest(user, r) && r.status !== 'CANCELLED' && window.effectivePerms(user).can_cancel ? `<button class="icon-btn is-cancel" onclick="window.cancelLeave(${r.id})" title="Batal Cuti" aria-label="Batal Cuti"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg></button>` : ''}
                                      <button class="icon-btn is-print" onclick="printLeave(${r.id})" title="Cetak" aria-label="Cetak"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V2h12v7"></path><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg></button>
                                      ${window.canEditAnyLeave(user) ? `
                                      <button class="icon-btn is-edit" onclick="editLeave(${r.id})" title="Edit Cuti" aria-label="Edit Cuti"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg></button>
                                      <button class="icon-btn is-delete" onclick="deleteLeave(${r.id})" title="Padam Rekod" aria-label="Padam Rekod"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg></button>
                                      ` : ''}
                                  </div>
                              </td>
                          </tr>
                          `).join('')}
                      </tbody>
                  </table>
                  ${_mlRows.length === 0 ? (masterLogOverlapOnly ? emptyState({ icon: 'check', title: 'Tiada cuti bertindih', text: 'Tiada rekod bertindih untuk pilihan ini.' }) : emptyState({ icon: 'search', title: 'Tiada rekod dijumpai', text: 'Cuba tukar penapis cawangan, tahun atau carian.' })) : ''}
              </div>
          </section>
        `; })() : ''}

        ${managementTab === 'login_audit' ? `
          <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 2rem; margin-top: 1rem;">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
              <h2 style="font-size: 1.25rem; font-weight: 600;">System Access & Activity Log</h2>
              <span style="font-size:0.68rem;color:var(--text-muted);font-weight:600;">${systemAuditLogs.length} rekod terbaru (had ${AUDIT_LOG_LIMIT})</span>
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
                                  <div style="font-weight: 600; font-size: 0.8rem; color: var(--text-muted);">${auditTimeLabel(log)}</div>
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

          ${locumRecs.length === 0 ? `<div class="glass-card">${emptyState({ icon: 'file', title: 'Tiada rekod locum lagi' })}</div>` : `
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
                      Cuti: <strong>${leaveTypeName(r.type)}</strong> &nbsp;|&nbsp; ${r.startDate}${r.startDate !== r.endDate ? ' → ' + r.endDate : ''} &nbsp;|&nbsp; ${r.days} hari
                    </div>
                  </div>
                  <div style="display:flex;gap:0.5rem;align-items:center;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end;">
                    ${statusBadge(r.status)}
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
              if (userStateScope !== 'all' && (!b || window.scopeStateOfBranch(s.branch) !== userStateScope)) return false;
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

          const _bvScope = window.getUserStateScope(user);
          const availBranches = [...new Set(staffList.filter(s=>!s.inactive && s.role!=='super_admin').map(s=>s.branch).filter(Boolean))].sort()
            .filter(b => !window.isSubsidiaryHR(user) || window.scopeStateOfBranch(b) === _bvScope);

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

          // Tutup Tahun (annual reset) gating
          const _cy = window.getCurrentLeaveYear();
          const _lastClosed = leaveYearConfig.lastClosed || 0;
          const _targetYear = (_lastClosed || (_cy - 1)) + 1;
          // Tutup Tahun memproses SEMUA staf syarikat — HR anak syarikat tidak boleh.
          const _canCloseYear = userPerms.manage_staff && _targetYear <= _cy && !window.isSubsidiaryHR(user);

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

          ${userPerms.manage_staff ? `
          <!-- Tutup Tahun (annual leave-year reset) -->
          <div class="glass-card" style="padding:1rem 1.25rem;margin-bottom:1.25rem;display:flex;flex-wrap:wrap;gap:0.75rem;align-items:center;border:1px solid rgba(124,58,237,0.25);background:linear-gradient(135deg,rgba(124,58,237,0.06),rgba(99,102,241,0.03));">
            <div style="display:flex;align-items:center;gap:0.6rem;">
              <div style="width:34px;height:34px;border-radius:9px;background:linear-gradient(135deg,#7c3aed,#6366f1);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/><polyline points="21 3 21 9 15 9"/></svg>
              </div>
              <div>
                <div style="font-size:0.85rem;font-weight:800;">Tutup Tahun / Reset Baki Tahunan</div>
                <div style="font-size:0.68rem;color:var(--text-muted);">Bawa ke hadapan AL (maks ${CF_CAP} hari) &amp; reset baseline untuk tahun baru.${_lastClosed?` Terakhir ditutup: <b>${_lastClosed}</b>.`:''}</div>
              </div>
            </div>
            <div style="margin-left:auto;">
              ${_canCloseYear
                ? `<button onclick="window.openYearEndPreview(${_targetYear})" style="padding:0.5rem 1.1rem;border:none;border-radius:9px;background:linear-gradient(135deg,#7c3aed,#6366f1);color:#fff;font-weight:700;font-size:0.8rem;cursor:pointer;">Tutup Tahun ${_targetYear} →</button>`
                : window.isSubsidiaryHR(user)
                  ? `<span style="font-size:0.75rem;font-weight:700;color:var(--text-muted);">Diuruskan oleh HR / Admin KSB</span>`
                  : `<span style="font-size:0.75rem;font-weight:700;color:#059669;">✓ Tahun ${_lastClosed||_cy} sudah ditutup</span>`}
            </div>
          </div>

          ${yearEndPreview ? `
          <div style="position:fixed;inset:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;" onclick="if(event.target===this)window.closeYearEndModal()">
            <div class="glass-card fade-in" style="width:100%;max-width:640px;border-radius:1.25rem;max-height:88vh;display:flex;flex-direction:column;overflow:hidden;">
              <div style="padding:1.1rem 1.3rem;background:linear-gradient(135deg,#7c3aed,#6366f1);color:#fff;display:flex;align-items:center;gap:0.75rem;">
                <div>
                  <div style="font-size:0.95rem;font-weight:800;">Tutup Tahun ${yearEndPreview.year} — Pratonton</div>
                  <div style="font-size:0.66rem;color:rgba(255,255,255,0.85);">${yearEndPreview.totals.staff} staf · CF ${yearEndPreview.year+1} = ${yearEndPreview.totals.totalCF} hari · ${yearEndPreview.totals.totalForfeited} hari hangus</div>
                </div>
                <button onclick="window.closeYearEndModal()" style="margin-left:auto;background:rgba(255,255,255,0.2);border:none;border-radius:50%;width:32px;height:32px;color:#fff;cursor:pointer;font-size:1rem;flex-shrink:0;">✕</button>
              </div>
              <div style="overflow-y:auto;">
                <table style="width:100%;border-collapse:collapse;font-size:0.78rem;">
                  <thead><tr style="text-transform:uppercase;font-size:0.6rem;color:var(--text-muted);border-bottom:1px solid rgba(163,177,198,0.25);position:sticky;top:0;background:var(--card-bg);">
                    <th style="padding:0.6rem 1rem;text-align:left;">Staf</th><th style="padding:0.6rem;text-align:center;">Baki AL</th><th style="padding:0.6rem;text-align:center;">Bawa (CF)</th><th style="padding:0.6rem 1rem;text-align:center;">Hangus</th>
                  </tr></thead>
                  <tbody>
                    ${yearEndPreview.rows.length === 0
                      ? `<tr><td colspan="4" style="padding:2rem;text-align:center;color:var(--text-muted);">Tiada staf aktif</td></tr>`
                      : yearEndPreview.rows.map(r=>`<tr style="border-bottom:1px solid rgba(163,177,198,0.1);">
                      <td style="padding:0.55rem 1rem;"><div style="font-weight:700;">${r.name}</div><div style="font-size:0.6rem;color:var(--text-muted);">${r.branch}</div></td>
                      <td style="padding:0.55rem;text-align:center;font-weight:700;">${r.closingAL}</td>
                      <td style="padding:0.55rem;text-align:center;font-weight:800;color:#059669;">${r.cfNext}</td>
                      <td style="padding:0.55rem 1rem;text-align:center;color:${r.forfeited>0?'#dc2626':'var(--text-muted)'};font-weight:${r.forfeited>0?'700':'400'};">${r.forfeited>0?r.forfeited:'—'}</td>
                    </tr>`).join('')}
                  </tbody>
                </table>
              </div>
              <div style="padding:1rem 1.3rem;border-top:1px solid rgba(163,177,198,0.2);display:flex;gap:0.75rem;align-items:center;flex-wrap:wrap;">
                <div style="font-size:0.66rem;color:#b45309;flex:1;min-width:200px;line-height:1.4;">⚠️ Tindakan tidak boleh dibatalkan. Baki AL dibawa maks ${CF_CAP} hari sebagai CF ${yearEndPreview.year+1}; baseline (guna sebelum sistem / pelarasan) direset 0. Sebaiknya buat pada hujung tahun.</div>
                <button onclick="window.closeYearEndModal()" style="padding:0.5rem 1rem;border:1px solid rgba(163,177,198,0.4);border-radius:8px;background:transparent;font-weight:700;font-size:0.78rem;cursor:pointer;color:var(--text-muted);">Batal</button>
                <button onclick="window.confirmYearEnd()" ${yearEndProcessing?'disabled':''} style="padding:0.5rem 1.2rem;border:none;border-radius:8px;background:${yearEndProcessing?'#9ca3af':'#059669'};color:#fff;font-weight:800;font-size:0.78rem;cursor:${yearEndProcessing?'wait':'pointer'};">${yearEndProcessing?'Memproses…':`Sahkan Tutup ${yearEndPreview.year}`}</button>
              </div>
            </div>
          </div>` : ''}` : ''}

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
                        <td style="padding:0.6rem 1rem;font-weight:600;color:var(--text);"><div style="display:flex;align-items:center;gap:0.6rem;">${userAvatar(s, { small: true })}<span>${s.name}</span></div></td>
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
            if (userStateScope !== 'all' && window.scopeStateOfBranch(r.branch) !== userStateScope) return false;
            if (reportDaerah && rb.daerah !== reportDaerah) return false;
            return true;
          });

          // Approved report data
          const approvedBase = scopedRecords.filter(r => r.status === 'APPROVED');
          const availableYears = reportYearOptions(approvedBase);
          const availableBranches = [...new Set(approvedBase.map(r => r.branch).filter(Boolean))].sort();
          const availableTypes = [...new Set(approvedBase.map(r => r.type).filter(Boolean))].sort();

          const approvedFiltered = approvedBase.filter(matchesApprovedReportFilters);
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
              ? `<button onclick="window.generateLeaveReport()" title="Muat turun PDF — Semua Rekod" class="neu-btn" style="background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.2);color:var(--primary);font-weight:600;display:flex;align-items:center;gap:0.4rem;padding:0.45rem 0.85rem;font-size:0.75rem;flex:none;white-space:nowrap;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V2h12v7"></path><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
                  PDF
                </button>`
              : hrReportTab === 'approved'
              ? `<button onclick="window.generateApprovedReport()" title="Muat turun PDF — Cuti Diluluskan" class="neu-btn" style="background:rgba(5,150,105,0.1);border:1px solid rgba(5,150,105,0.25);color:#059669;font-weight:600;display:flex;align-items:center;gap:0.4rem;padding:0.45rem 0.85rem;font-size:0.75rem;flex:none;white-space:nowrap;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V2h12v7"></path><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
                  PDF
                </button>`
              : hrReportTab === 'balance'
              ? `<button onclick="window.generateBalanceReport(window._balanceRows||[],'${balanceReportBranch}','${balanceReportType}','${balanceReportYear}')" title="Muat turun PDF — Baki Cuti" class="neu-btn" style="background:rgba(124,58,237,0.1);border:1px solid rgba(124,58,237,0.25);color:#7c3aed;font-weight:600;display:flex;align-items:center;gap:0.4rem;padding:0.45rem 0.85rem;font-size:0.75rem;flex:none;white-space:nowrap;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V2h12v7"></path><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
                  PDF
                </button>`
              : hrReportTab === 'jenis'
              ? `<button onclick="window.generateJenisCutiReport()" title="Muat turun PDF — Ringkasan Jenis" class="neu-btn" style="background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.25);color:#d97706;font-weight:600;display:flex;align-items:center;gap:0.4rem;padding:0.45rem 0.85rem;font-size:0.75rem;flex:none;white-space:nowrap;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V2h12v7"></path><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
                  PDF
                </button>`
              : (userPerms.report_attendance ? `<div style="display:flex;flex-direction:column;align-items:flex-end;gap:0.5rem;"><div style="display:flex;gap:0.5rem;flex-wrap:wrap;justify-content:flex-end;"><button onclick="window.generateAttendanceReport()" title="Muat turun PDF — Rekod Kedatangan" class="neu-btn" style="background:rgba(30,41,59,0.1);border:1px solid rgba(30,41,59,0.3);color:var(--text);font-weight:600;display:flex;align-items:center;gap:0.4rem;padding:0.45rem 0.85rem;font-size:0.75rem;flex:none;white-space:nowrap;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V2h12v7"></path><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
                  PDF
                </button>
                <button onclick="window.printCMEReport()" title="Cetak Laporan CME — Doktor" class="neu-btn" style="background:rgba(124,58,237,0.1);border:1px solid rgba(124,58,237,0.25);color:#7c3aed;font-weight:600;display:flex;align-items:center;gap:0.4rem;padding:0.45rem 0.85rem;font-size:0.75rem;flex:none;white-space:nowrap;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 2H9a2 2 0 0 0-2 2v2"></path><rect x="3" y="8" width="13" height="13" rx="2"></rect></svg>
                  CME
                </button>
                <button onclick="window.printAllLeaveReport()" title="Cetak Laporan Semua Cuti (ikut jenis)" class="neu-btn" style="background:rgba(51,65,85,0.1);border:1px solid rgba(51,65,85,0.3);color:#334155;font-weight:600;display:flex;align-items:center;gap:0.4rem;padding:0.45rem 0.85rem;font-size:0.75rem;flex:none;white-space:nowrap;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="8" y1="13" x2="16" y2="13"></line><line x1="8" y1="17" x2="16" y2="17"></line></svg>
                  Semua Cuti
                </button>
                </div>
                <div style="display:flex;align-items:center;gap:0.35rem;flex-wrap:wrap;justify-content:flex-end;padding:0.3rem 0.55rem;background:rgba(163,177,198,0.08);border:1px solid rgba(163,177,198,0.18);border-radius:10px;">
                  <span style="font-size:0.62rem;font-weight:800;text-transform:uppercase;letter-spacing:0.4px;color:var(--text-muted);white-space:nowrap;">Cetak Ikut Jenis</span>
                  ${['AL','MC','EL','EL_EMG','HL','ML','ML_PL','RL','UP'].map(t => { const c=LEAVE_TYPE_COLOR[t]; const lbl=leaveTypeShort(t); return `<button onclick="window.printLeaveTypeReport('${t}')" title="Cetak Laporan ${lbl}" class="neu-btn" style="background:${c}14;border:1px solid ${c}55;color:${c};font-weight:700;padding:0.3rem 0.6rem;font-size:0.68rem;flex:none;white-space:nowrap;border-radius:7px;">${lbl}</button>`; }).join('')}
                </div>
              </div>` : '')
            }
          </div>

          <!-- Sub-tabs -->
          <div style="display:flex;gap:0.35rem;margin-bottom:1.5rem;background:rgba(163,177,198,0.1);padding:0.35rem;border-radius:14px;max-width:100%;overflow-x:auto;flex-wrap:nowrap;-webkit-overflow-scrolling:touch;">
            <button onclick="window.setHrReportTab('all')" style="padding:0.5rem 1rem;border-radius:10px;border:none;cursor:pointer;font-size:0.8rem;font-weight:700;transition:all 0.2s;flex-shrink:0;display:flex;align-items:center;gap:0.4rem;white-space:nowrap;
              ${hrReportTab==='all' ? 'background:#fff;color:var(--text);box-shadow:0 2px 8px rgba(0,0,0,0.1);' : 'background:transparent;color:var(--text-muted);'}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
              Semua Rekod
            </button>
            <button onclick="window.setHrReportTab('approved')" style="padding:0.5rem 1rem;border-radius:10px;border:none;cursor:pointer;font-size:0.8rem;font-weight:700;transition:all 0.2s;flex-shrink:0;white-space:nowrap;display:flex;align-items:center;gap:0.4rem;
              ${hrReportTab==='approved' ? 'background:#059669;color:#fff;box-shadow:0 2px 8px rgba(5,150,105,0.3);' : 'background:transparent;color:var(--text-muted);'}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
              Cuti Diluluskan
            </button>
            <button onclick="window.setHrReportTab('balance')" style="padding:0.5rem 1rem;border-radius:10px;border:none;cursor:pointer;font-size:0.8rem;font-weight:700;transition:all 0.2s;flex-shrink:0;white-space:nowrap;display:flex;align-items:center;gap:0.4rem;
              ${hrReportTab==='balance' ? 'background:#7c3aed;color:#fff;box-shadow:0 2px 8px rgba(124,58,237,0.3);' : 'background:transparent;color:var(--text-muted);'}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              Baki Cuti Bulanan
            </button>
            <button onclick="window.setHrReportTab('jenis')" style="padding:0.5rem 1rem;border-radius:10px;border:none;cursor:pointer;font-size:0.8rem;font-weight:700;transition:all 0.2s;flex-shrink:0;white-space:nowrap;display:flex;align-items:center;gap:0.4rem;
              ${hrReportTab==='jenis' ? 'background:#d97706;color:#fff;box-shadow:0 2px 8px rgba(217,119,6,0.3);' : 'background:transparent;color:var(--text-muted);'}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
              Ringkasan Jenis
            </button>
            ${userPerms.report_attendance ? `<button onclick="window.setHrReportTab('attendance')" style="padding:0.5rem 1rem;border-radius:10px;border:none;cursor:pointer;font-size:0.8rem;font-weight:700;transition:all 0.2s;flex-shrink:0;white-space:nowrap;display:flex;align-items:center;gap:0.4rem;
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
                      <div style="font-size:0.65rem;font-weight:700;background:rgba(59,130,246,0.1);color:${r.typeColor||'var(--primary)'};padding:0.3rem 0.6rem;border-radius:4px;border:1px solid var(--border);display:inline-block;">${leaveTypeShort(r.type)}</div>
                    </td>
                    <td style="padding:1.5rem 1rem;font-size:0.75rem;font-style:italic;color:var(--text-muted);max-width:250px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${r.reason}</td>
                    <td style="padding:1.5rem 1rem;font-weight:700;font-size:1.1rem;">${r.days}</td>
                    <td style="padding:1.5rem 1rem;">
                      ${statusBadge(r.status)}
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
            <select class="neu-inset" style="padding:0.4rem 0.75rem;font-size:0.82rem;color-scheme:light;border-radius:8px;cursor:pointer;" onchange="window.setApprovedReportMonth(this.value)">
              <option value="SEMUA" ${approvedReportMonth==='SEMUA'?'selected':''}>Semua Bulan</option>
              ${['Januari','Februari','Mac','April','Mei','Jun','Julai','Ogos','September','Oktober','November','Disember'].map((m,i)=>`<option value="${i+1}" ${approvedReportMonth===String(i+1)?'selected':''}>${m}</option>`).join('')}
            </select>
            <select class="neu-inset" style="padding:0.4rem 0.75rem;font-size:0.82rem;color-scheme:light;border-radius:8px;cursor:pointer;" onchange="window.setApprovedReportBranch(this.value)">
              <option value="SEMUA" ${approvedReportBranch==='SEMUA'?'selected':''}>Semua Cawangan</option>
              ${availableBranches.map(b=>`<option value="${b}" ${approvedReportBranch===b?'selected':''}>${b}</option>`).join('')}
            </select>
            <select class="neu-inset" style="padding:0.4rem 0.75rem;font-size:0.82rem;color-scheme:light;border-radius:8px;cursor:pointer;" onchange="window.setApprovedReportType(this.value)">
              <option value="SEMUA" ${approvedReportType==='SEMUA'?'selected':''}>Semua Jenis</option>
              ${availableTypes.map(t=>`<option value="${t}" ${approvedReportType===t?'selected':''}>${leaveTypeShort(t)} — ${leaveTypeName(t)}</option>`).join('')}
            </select>
            <div style="margin-left:auto;font-size:0.72rem;color:var(--text-muted);font-weight:600;">${approvedFiltered.length} rekod dijumpai${approvedReportMonth !== 'SEMUA' ? ' · bulan ikut Tarikh Cuti' : ''}</div>
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
                  <span style="font-size:0.72rem;font-weight:800;color:var(--primary);">${leaveTypeShort(type)}</span>
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
                    ? emptyRow(6, { icon: 'search', title: 'Tiada rekod diluluskan dijumpai', text: 'Cuba tukar penapis atau carian.' })
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
                      <span style="font-size:0.65rem;font-weight:700;background:rgba(5,150,105,0.1);color:#059669;padding:0.25rem 0.6rem;border-radius:4px;border:1px solid rgba(5,150,105,0.2);">${leaveTypeShort(r.type)}</span>
                    </td>
                    <td style="padding:1.1rem 1rem;font-size:0.73rem;font-style:italic;color:var(--text-muted);max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${r.reason||'-'}</td>
                    <td style="padding:1.1rem 1rem;font-weight:800;font-size:1rem;text-align:center;color:#059669;">${r.days}</td>
                    <td style="padding:0.6rem 1rem;text-align:center;">
                      <button class="neu-btn sm is-wa" onclick="window.resendApprovalWA(${r.id})" title="Hantar semula notifikasi WhatsApp">
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
            const availYearsJ = reportYearOptions(scopedRecords);
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
            const typeColorMap = { AL:'#3b82f6', MC:'#10b981', EL:'#f59e0b', EL_EMG:'#ef4444', UP:'#94a3b8', HL:'#06b6d4', ML:'#ec4899', ML_PL:'#6366f1', CME:'#8b5cf6', RL:'#14b8a6' };

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
                return `<div style="padding:0.6rem 1rem;border-radius:10px;background:${c}14;border:1px solid ${c}35;min-width:90px;">
                  <div style="font-size:0.65rem;font-weight:800;text-transform:uppercase;letter-spacing:0.5px;color:${c};">${leaveTypeShort(t)}</div>
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
                  ? emptyState({ icon: 'search', title: 'Tiada rekod diluluskan', text: 'Cuba tukar penapis atau carian.' })
                  : `<table style="width:100%;border-collapse:collapse;font-size:0.73rem;">
                  <thead>
                    <tr style="border-bottom:2px solid rgba(163,177,198,0.2);">
                      <th style="padding:0.9rem 1rem;text-align:left;font-weight:700;font-size:0.72rem;border-right:2px solid rgba(163,177,198,0.2);min-width:160px;background:rgba(163,177,198,0.06);">Cawangan</th>
                      ${activeTypes.map(t => {
                        const c = typeColorMap[t]||'#64748b';
                        const cat = leaveCategories.find(x=>x.id===t);
                        return `<th style="padding:0.7rem 0.6rem;text-align:center;font-weight:700;font-size:0.67rem;color:${c};border-right:1px solid rgba(163,177,198,0.12);min-width:68px;" title="${cat?cat.name:t}">
                          <div>${leaveTypeShort(t)}</div>
                          <div style="font-size:0.58rem;font-weight:500;color:var(--text-muted);margin-top:0.15rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:68px;">${cat?cat.name:''}</div>
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
            const availYearsForBalance = reportYearOptions(leaveRecords);

            // Get staff pool: staff in selected branch (or all), include inactive if they have records
            let staffPool = staffList.filter(s => {
              if (reportBranch && s.branch !== reportBranch) return false;
              if (balanceReportBranch !== 'SEMUA' && s.branch !== balanceReportBranch) return false;
              const b = branches.find(br => br.name === s.branch);
              if (!reportBranch) {
                if (userStateScope !== 'all') {
                  if (!b || window.scopeStateOfBranch(b.name) !== userStateScope) return false;
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
                  if (!b || window.scopeStateOfBranch(b.name) !== userStateScope) return false;
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
              const stats = window.getLeaveStats(staffFull, balanceReportType, balanceReportYear === 'SEMUA' ? undefined : balanceReportYear);
              return {
                ic: s.ic,
                name: s.name,
                branch: s.branch,
                monthlyUsed,
                totalUsed: stats.used,
                entitlement: stats.ent,
                // Baki ikut Formula B penuh (Guna Sebelum Sistem, Pelarasan HR, limpahan EL/EMG) — sama dengan Management Hub
                balance: stats.bal
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
            const grandBalance = balanceRows.reduce((s,r)=>s+r.balance,0);
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
                ${leaveCategories.map(c=>`<option value="${c.id}" ${balanceReportType===c.id?'selected':''}>${leaveTypeShort(c.id)} — ${c.name}</option>`).join('')}
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
                <div style="font-size:2rem;font-weight:800;color:#059669;line-height:1;">${grandBalance.toFixed(1)}</div>
              </div>
            </div>

            <!-- Monthly usage heatmap row -->
            <div class="glass-card" style="padding:1rem 1.25rem;margin-bottom:1.25rem;">
              <div style="font-size:0.7rem;font-weight:800;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);margin-bottom:0.75rem;">Penggunaan Mengikut Bulan (${leaveTypeShort(balanceReportType)})</div>
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
                      ? emptyRow(16, { icon: 'search', title: 'Tiada rekod untuk ditunjukkan', text: 'Cuba tukar penapis atau carian.' })
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
                        const bal = r.balance;
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
                      <td style="padding:0.85rem 1rem;text-align:center;font-weight:800;color:#059669;">${grandBalance.toFixed(1)}</td>
                    </tr>
                  </tfoot>` : ''}
                </table>
              </div>
            </section>
            `;
          })() : ''}

          ${hrReportTab === 'attendance' && userPerms.report_attendance ? (() => {
            const MONTHS_MS = ['Januari','Februari','Mac','April','Mei','Jun','Julai','Ogos','September','Oktober','November','Disember'];
            const availYearsA = reportYearOptions(leaveRecords);
            const scopedBranchesA = [...new Set(staffList.filter(s=>!s.inactive).map(s=>s.branch).filter(Boolean))].sort().filter(b => {
              if (reportBranch) return b === reportBranch;
              const bObj = branches.find(br => br.name === b);
              if (!bObj) return userStateScope === 'all';
              if (userStateScope !== 'all' && window.scopeStateOfBranch(bObj.name) !== userStateScope) return false;
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
              if (userStateScope !== 'all') { if (!bObj || window.scopeStateOfBranch(bObj.name) !== userStateScope) return false; }
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
              const cmeSt = isDoctor ? window.getLeaveStats(s, 'CME') : null;
              const al = ml['AL']||0, mc = ml['MC']||0;
              const el = (ml['EL']||0)+(ml['EL_EMG']||0), up = ml['UP']||0;
              const last = isDoctor ? ((ml['CME']||0)+(ml['RL']||0)) : ((ml['HL']||0)+(ml['ML']||0)+(ml['ML_PL']||0));
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
                ${isDoctor ? `<td style="padding:0.55rem 0.75rem;text-align:center;font-size:0.75rem;color:#8b5cf6;">${fmtBal(cmeSt.bal,cmeSt.ent)}</td>` : ''}
              </tr>`;
            };

            const renderAttSection = (title, arr, isDoctor, color) => {
              if (!arr.length) return '';
              const lastLabel = isDoctor ? 'CME+RL' : 'LL';
              const lastColor = isDoctor ? '#8b5cf6' : '#06b6d4';
              const totAL = arr.reduce((s,x)=>s+(getML(x.ic)['AL']||0),0);
              const totMC = arr.reduce((s,x)=>s+(getML(x.ic)['MC']||0),0);
              const totEL = arr.reduce((s,x)=>s+((getML(x.ic)['EL']||0)+(getML(x.ic)['EL_EMG']||0)),0);
              const totUP = arr.reduce((s,x)=>s+(getML(x.ic)['UP']||0),0);
              const totLast = isDoctor
                ? arr.reduce((s,x)=>s+((getML(x.ic)['CME']||0)+(getML(x.ic)['RL']||0)),0)
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
                          <th style="padding:0.55rem 0.5rem;text-align:center;font-size:0.63rem;font-weight:700;color:#f59e0b;min-width:42px;" title="Cuti Ehsan + Cuti Kecemasan">CL+EL</th>
                          <th style="padding:0.55rem 0.5rem;text-align:center;font-size:0.63rem;font-weight:700;color:#94a3b8;min-width:42px;" title="Unpaid Leave">UPL</th>
                          <th style="padding:0.55rem 0.5rem;text-align:center;font-size:0.63rem;font-weight:700;color:${lastColor};min-width:42px;" title="${isDoctor?'CME + Cuti Ganti (RL)':'Hospitalization/Bersalin/Lain-lain'}">${lastLabel}</th>
                          <th style="padding:0.55rem 0.75rem;text-align:center;font-size:0.6rem;font-weight:700;color:#3b82f6;border-left:1px solid rgba(163,177,198,0.2);min-width:72px;">Baki Cuti</th>
                          <th style="padding:0.55rem 0.75rem;text-align:center;font-size:0.6rem;font-weight:700;color:#10b981;min-width:62px;">Baki MC</th>
                          ${isDoctor ? `<th style="padding:0.55rem 0.75rem;text-align:center;font-size:0.6rem;font-weight:700;color:#8b5cf6;min-width:72px;">Baki CME</th>` : ''}
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
                          <td colspan="${isDoctor ? 3 : 2}"></td>
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
          ${window.isBranchScopedHod(user) ? '' : `<button class="btn-primary" onclick="window.openAddStaff()" style="width: auto; padding: 0.75rem 1.5rem;">+ Tambah Staf</button>`}
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
                ].filter(o => o.val === 'SEMUA' || window.staffFormRoles([o.val]).length).map(o => '<option value="' + o.val + '"' + (manageRoleFilter === o.val ? ' selected' : '') + '>' + o.label + '</option>').join('')}
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
            { key:'supervisor_balok', label:'Supervisor',        sub:'Balok (HQ)',            color:'#8b5cf6', bg:'rgba(139,92,246,0.06)'  },
            { key:'doctor_pahang',    label:'Doktor',            sub:'Pahang (Semua Cawangan)', color:'#d97706', bg:'rgba(217,119,6,0.06)'  },
            { key:'operation_balok',  label:'Kakitangan Operasi',sub:'Balok (HQ)',            color:'#10b981', bg:'rgba(16,185,129,0.06)'  },
            { key:'xray_sono_balok',  label:'Juru X-Ray / Sono', sub:'Balok (HQ)',            color:'#ec4899', bg:'rgba(236,72,153,0.06)'  },
            { key:'juru_audio_balok', label:'Juru Audio',        sub:'Balok (HQ)',            color:'#0d9488', bg:'rgba(13,148,136,0.06)'  },
            { key:'ksb_pharma',       label:'Semua Kakitangan',  sub:'KSB Pharma',            color:'#14532d', bg:'rgba(20,83,45,0.06)'    },
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
            <div style="font-size:0.68rem;color:var(--text-muted);padding:0.28rem 0.65rem;background:rgba(163,177,198,0.06);border:1px solid rgba(163,177,198,0.2);border-radius:6px;">★ Supervisor bagi Doktor Pahang (Semua Cawangan) & Op. Balok = Supervisor Balok (HQ)</div>
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
                        { key:'doctor_pahang',    grp:'Doktor',                    scope:'Pahang (Semua Cawangan)',         gColor:'#d97706' },
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
          // Jadual RBAC padat dengan sub-tab — setiap bahagian muat satu skrin tanpa
          // skrol mendatar (dulu 22 lajur × sel 38px dalam satu jadual).
          const CELL = '22px';
          const ICON_ON  = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="3.5"><polyline points="20 6 9 17 4 12"/></svg>';
          const ICON_OFF = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="3" opacity="0.55"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
          const tdBorder = last => last ? 'border-right:2px solid rgba(163,177,198,0.3)' : 'border-right:1px solid rgba(163,177,198,0.12)';

          const cellDashboard = (role, last) => {
              const val = window.rbacMatrix[role].dashboard;
              const m = val === 'analisa' ? { c: '#10b981', bg: 'rgba(16,185,129,0.15)', t: 'ANALISA' }
                      : val === 'branch'  ? { c: '#f97316', bg: 'rgba(251,146,60,0.15)', t: 'CAWANGAN' }
                      :                     { c: '#64748b', bg: 'rgba(163,177,198,0.12)', t: 'STAFF' };
              return `<td style="padding:0.12rem 0.25rem;${tdBorder(last)};text-align:center;cursor:pointer;" onclick="window.toggleRbac('${role}', 'dashboard')" title="Klik untuk tukar: Analisa → Cawangan → Staff">
                <span style="display:inline-block;min-width:64px;padding:0.1rem 0.4rem;border-radius:6px;background:${m.bg};border:1.5px solid ${m.c};color:${m.c};font-size:0.6rem;font-weight:800;letter-spacing:0.4px;">${m.t}</span></td>`;
          };
          const cellToggle = (role, key, last) => {
              const on = window.rbacMatrix[role][key] === true || window.rbacMatrix[role][key] === 'true';
              return `<td style="padding:0.12rem 0.25rem;${tdBorder(last)};text-align:center;cursor:pointer;" onclick="window.toggleRbac('${role}', '${key}')">
                <div style="width:${CELL};height:${CELL};margin:auto;border-radius:7px;display:flex;align-items:center;justify-content:center;pointer-events:none;${on ? 'background:rgba(16,185,129,0.15);border:2px solid #10b981;' : 'background:rgba(239,68,68,0.05);border:1px solid rgba(239,68,68,0.2);'}">${on ? ICON_ON : ICON_OFF}</div></td>`;
          };
          // Skop laporan hanya bermakna jika lajur Laporan (manage_reports) dibenarkan.
          const cellScope = (role, key, last, label, color) => {
              const on = !!window.rbacMatrix[role][key];
              const can = !!window.rbacMatrix[role].manage_reports;
              return `<td style="padding:0.12rem 0.25rem;${tdBorder(last)};text-align:center;${can ? 'cursor:pointer;' : 'opacity:0.3;'}" ${can ? `onclick="window.toggleRbac('${role}', '${key}')"` : 'title="Aktif hanya jika Laporan dibenarkan (tab Pengurusan)"'}>
                <span style="display:inline-block;min-width:58px;padding:0.15rem 0.45rem;border-radius:20px;font-size:0.6rem;font-weight:800;${on ? `background:${color}22;border:1.5px solid ${color};color:${color};` : 'background:rgba(163,177,198,0.08);border:1px solid rgba(163,177,198,0.25);color:#94a3b8;'}">${on ? label : 'Tiada'}</span></td>`;
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


          // Lajur ikut sub-tab. claims:true = juga kuasa simpan Firestore (src/rolePermissions.js).
          const RBAC_SECTIONS = {
            akses: { label: '🖥️ Navigasi & Tetapan', groups: [
              { title: 'Navigasi', color: '#3b82f6', cols: [
                { key: 'dashboard', label: 'Dashboard', kind: 'dashboard' },
                { key: 'branch_analisa', label: 'Analisa<br>Cawangan' },
                { key: 'leave_request', label: 'Permohonan<br>Cuti' },
                { key: 'leave_calendar', label: 'Kalendar<br>Cuti' } ] },
              { title: 'Tetapan', color: '#2dd4bf', cols: [
                { key: 'policy', label: 'Polisi' },
                { key: 'settings', label: 'Tetapan<br>Sistem' },
                { key: 'wa_setting', label: 'WhatsApp' } ] } ] },
            pengurusan: { label: '📋 Pengurusan', groups: [
              { title: 'Kelulusan & Staf', color: '#a855f7', cols: [
                { key: 'manage_pending', label: 'Luluskan<br>Permohonan', claims: true },
                { key: 'manage_staff', label: 'Kakitangan', claims: true },
                { key: 'manage_branches', label: 'Cawangan' },
                { key: 'manage_roles_categories', label: 'Peranan &amp;<br>Kategori' },
                { key: 'manage_registrations', label: 'Daftar<br>Baharu', requires: 'manageStaff' },
                { key: 'edit_leave', label: 'Edit<br>Cuti', requires: 'canApprove' } ] },
              { title: 'Rekod', color: '#ec4899', cols: [
                { key: 'manage_audit', label: 'Audit<br>Rekod' },
                { key: 'manage_login_audit', label: 'Log<br>Masuk' },
                { key: 'manage_reports', label: 'Laporan' } ] },
              { title: 'Konfigurasi', color: '#6366f1', cols: [
                { key: 'manage_routing', label: 'Laluan<br>Kelulusan' },
                { key: 'manage_access', label: 'Kawalan<br>Akses' },
                { key: 'manage_holidays', label: 'Cuti<br>Umum' },
                { key: 'manage_policy', label: 'Editor<br>Polisi' } ] } ] },
            laporan: { label: '📊 Skop Laporan & Operasi', groups: [
              { title: 'Skop Laporan', color: '#ca8a04', cols: [
                { key: 'report_kuantan_only', label: 'Daerah<br>Kuantan', kind: 'scope', badge: 'Kuantan', color: '#ca8a04' },
                { key: 'report_own_branch_only', label: 'Cawangan<br>Sendiri', kind: 'scope', badge: 'Cawangan', color: '#0284c7' },
                { key: 'report_attendance', label: 'Rekod<br>Kedatangan', kind: 'scope', badge: 'Kedatangan', color: '#334155' } ] },
              { title: 'Operasi', color: '#f59e0b', cols: [
                { key: 'can_cancel', label: 'Batal<br>Cuti' },
                { key: 'locum_records', label: 'Rekod<br>Locum' } ] } ] },
            lain: { label: '⚙️ Tetapan Baki' },
          };
          const sec = RBAC_SECTIONS[rbacSection] ? rbacSection : 'akses';
          const pending = (claimsSyncInfo && claimsSyncInfo.pendingRoles) || [];

          const renderCell = (role, col, last) =>
              col.kind === 'dashboard' ? cellDashboard(role, last)
            : col.kind === 'scope' ? cellScope(role, col.key, last, col.badge, col.color)
            : col.requires && !claimsFor(role, window.rbacMatrix[role])[col.requires]
              ? `<td style="padding:0.12rem 0.25rem;${tdBorder(last)};text-align:center;opacity:0.3;" title="Perlukan ${col.requires === 'manageStaff' ? 'Kakitangan 🔒' : 'Luluskan Permohonan 🔒'} — Firestore akan menolak tanpanya"><div style="width:${CELL};height:${CELL};margin:auto;border-radius:7px;display:flex;align-items:center;justify-content:center;background:rgba(163,177,198,0.08);border:1px dashed rgba(163,177,198,0.4);">${ICON_OFF}</div></td>`
            : cellToggle(role, col.key, last);

          const renderMatrix = (groups) => `
            <section class="glass-card fade-in" style="padding:0;overflow:hidden;border:1.5px solid rgba(163,177,198,0.35);">
              <div style="overflow-x:auto;">
              <table style="width:100%;border-collapse:collapse;font-size:0.74rem;">
                <thead>
                  <tr style="border-bottom:1px solid rgba(163,177,198,0.2);">
                    <th rowspan="2" style="padding:0.3rem 0.6rem;text-align:left;font-size:0.7rem;font-weight:800;border-right:2px solid rgba(163,177,198,0.3);min-width:120px;">Peranan</th>
                    ${groups.map((g, gi) => `<th colspan="${g.cols.length}" style="padding:0.25rem;font-size:0.62rem;font-weight:800;letter-spacing:0.7px;text-transform:uppercase;color:${g.color};${tdBorder(gi < groups.length - 1)};text-align:center;">${g.title}</th>`).join('')}
                  </tr>
                  <tr style="background:rgba(163,177,198,0.06);border-bottom:2px solid rgba(163,177,198,0.25);">
                    ${groups.map((g, gi) => g.cols.map((c, ci) => `<th style="padding:0.2rem 0.25rem;font-size:0.58rem;font-weight:700;line-height:1.25;color:var(--text-muted);${tdBorder(ci === g.cols.length - 1 && gi < groups.length - 1)};text-align:center;" ${c.claims ? 'title="Juga kuasa simpan Firestore — selepas Simpan, jalankan node sync-claims.js"' : ''}>${c.label}${c.claims ? ' 🔒' : ''}</th>`).join('')).join('')}
                  </tr>
                </thead>
                <tbody>
                  ${roles.map(r => `
                  <tr style="border-bottom:${r.bottomBorder};background:${r.bg};">
                    <td style="padding:0.12rem 0.6rem;border-right:2px solid rgba(163,177,198,0.3);white-space:nowrap;" title="${r.desc}">
                      <span style="display:inline-block;background:${r.color}22;color:${r.color};border:1.5px solid ${r.color}55;border-radius:6px;padding:0.05rem 0.45rem;font-weight:800;font-size:0.66rem;">${r.label}</span>
                      ${pending.includes(r.key) ? `<span title="Perlu node sync-claims.js" style="font-size:0.7rem;margin-left:0.25rem;">⚠️</span>` : ''}
                    </td>
                    ${groups.map((g, gi) => g.cols.map((c, ci) => renderCell(r.key, c, ci === g.cols.length - 1 && gi < groups.length - 1)).join('')).join('')}
                  </tr>`).join('')}
                </tbody>
              </table>
              </div>
            </section>`;

          const legend = {
            akses: `<b>Dashboard</b> (klik untuk tukar): <span style="color:#10b981;font-weight:700;">ANALISA</span> carta semua cawangan · <span style="color:#f97316;font-weight:700;">CAWANGAN</span> carta cawangan sendiri · <span style="color:#64748b;font-weight:700;">STAFF</span> paparan peribadi sahaja`,
            pengurusan: `Setiap lajur membuka satu tab/butang dalam Management. 🔒 = juga kuasa simpan Firestore — selepas Simpan, jalankan <code>node sync-claims.js</code>. Sel pudar = perlukan lajur 🔒 dahulu (Daftar Baharu ← Kakitangan, Edit Cuti ← Luluskan Permohonan).`,
            laporan: `Skop laporan hanya aktif jika <b>Laporan</b> dibenarkan (tab Pengurusan). <span style="color:#ca8a04;font-weight:700;">Kuantan</span> = daerah Kuantan sahaja · <span style="color:#0284c7;font-weight:700;">Cawangan</span> = cawangan sendiri sahaja · tiada sekatan = semua rekod dalam zon.`,
          };

          return `
          <!-- Toolbar: tajuk · sub-tab · Reset/Simpan (satu baris) -->
          <div style="display:flex;align-items:center;justify-content:space-between;gap:0.5rem;flex-wrap:wrap;margin:0.25rem 0 0.5rem;">
            <div style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap;">
              <span style="font-size:0.9rem;font-weight:800;margin-right:0.35rem;">🔐 RBAC</span>
              ${Object.entries(RBAC_SECTIONS).map(([k, v]) => `<button onclick="window.setRbacSection('${k}')" style="width:auto;padding:0.32rem 0.75rem;border-radius:7px;font-size:0.72rem;font-weight:700;cursor:pointer;${sec === k ? 'background:var(--primary);color:#fff;border:1px solid var(--primary);' : 'background:transparent;color:var(--text-muted);border:1px solid rgba(163,177,198,0.4);'}">${v.label}</button>`).join('')}
            </div>
            <div style="display:flex;gap:0.4rem;">
              <button onclick="window.resetRbac()" style="width:auto;padding:0.38rem 0.8rem;font-weight:600;font-size:0.72rem;border-radius:7px;border:1px solid rgba(239,68,68,0.3);background:rgba(239,68,68,0.08);color:#f87171;cursor:pointer;">↺ Reset Lalai</button>
              <button onclick="window.saveRbac()" class="btn-primary" style="width:auto;padding:0.4rem 1rem;font-weight:700;font-size:0.74rem;">💾 Simpan Matrix</button>
            </div>
          </div>

          ${pending.length ? `<div style="margin-bottom:0.5rem;padding:0.4rem 0.75rem;border-radius:8px;border:1px solid rgba(245,158,11,0.45);background:rgba(245,158,11,0.08);font-size:0.7rem;line-height:1.45;" title="Paparan sudah berubah, tetapi Firestore masih guna kuasa lama sehingga sync dijalankan.">
            ⚠️ <b>Kuasa simpan belum dikemas kini: ${pending.map(r => window.staffConfig.roleLabels[r] || r).join(', ')}</b> — jalankan <code>node sync-claims.js</code>, kemudian staf berkenaan log masuk semula (atau tunggu ≤1 jam).
          </div>` : ''}

          ${sec === 'lain' ? `
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

          ` : `
          <div style="font-size:0.64rem;color:var(--text-muted);margin-bottom:0.35rem;line-height:1.4;">${legend[sec]} · <span style="color:#10b981;">✔ ada akses</span> · <span style="color:#ef4444;">✕ tiada</span> · klik sel untuk togol, kemudian <b>Simpan Matrix</b>.</div>
          ${renderMatrix(RBAC_SECTIONS[sec].groups)}
          `}
          `;
        })() : ''}

        ${managementTab === 'policy_editor' && userPerms.manage_policy ? (() => {
          const pc = window.activePolicy();
          const isCo = window.isSubsidiaryUser(user);
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
              <h2 style="font-size:1.05rem;font-weight:700;margin:0;">Editor Polisi ${isCo ? (window.printBrandFor(user.branch).name) : 'Syarikat'}</h2>
              <p style="font-size:0.72rem;color:var(--text-muted);margin:0.15rem 0 0;">Edit kandungan halaman Polisi yang dilihat oleh ${isCo ? 'semua staf syarikat anda sahaja' : 'semua staf'}. Klik <strong>Simpan</strong> selepas setiap bahagian.</p>
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

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:${isCo ? '1.25rem' : '0.5rem'};">
            ${(isCo ? ['entitlementAL','entitlementMC'] : ['entitlementPahang','entitlementTerengganu']).map((sec,si) => {
              const labels = isCo ? ['Kelayakan Cuti Tahunan (AL)','Kelayakan MC — Mengikut Tempoh Berkhidmat'] : ['Kelayakan AL — Pahang','Kelayakan AL — Terengganu'];
              const colors = ['#3b82f6','#8b5cf6'];
              const icons  = isCo ? ['📅','🏥'] : ['🏙️','🌊'];
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

          ${isCo ? '' : `<div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1.25rem;">
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
          </div>`}

          ${sectionCard('rulesAL','Peraturan Cuti Tahunan (AL)','📅','#6366f1', ruleEditor('rulesAL','#6366f1'))}
          ${sectionCard('rulesMC','Peraturan Cuti Sakit (MC)','🏥','#eab308', ruleEditor('rulesMC','#eab308'))}
          ${isCo ? '' : sectionCard('rulesCME','Peraturan Cuti CME','🎓','#c084fc', ruleEditor('rulesCME','#c084fc'))}
          ${sectionCard('rulesNotice','Notis Berhenti Kerja','📄','#94a3b8', ruleEditor('rulesNotice','#94a3b8'))}
          `;
        })() : ''}

        ${managementTab === 'public_holidays' && userPerms.manage_holidays ? (() => {
          // Zon sendiri sahaja (src/holidayAccess.js) — selari dengan firestore.rules.
          const _hCtx = { role: user.role, perms: userPerms, zone: window.getUserStateScope(user) };
          const canEditPahang     = canEditHolidayState(_hCtx, 'pahang');
          const canEditTerengganu = canEditHolidayState(_hCtx, 'terengganu');
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
              ${!canEdit ? `<div style="padding:0.6rem 0.75rem;background:rgba(163,177,198,0.04);border-bottom:1px solid rgba(163,177,198,0.08);font-size:0.75rem;color:var(--text-muted);">⚠️ Hanya Admin atau HR/HOD zon ${label} boleh mengubah senarai ini.</div>` : ''}
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
              ${list.length === 0 ? emptyState({ compact: true, icon: 'calendar', title: 'Tiada cuti umum ditetapkan', text: 'Klik "+ Tambah" untuk mula.' }) : ''}
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
                <button onclick="window.addCustomRole()" style="padding:0.3rem 0.8rem;border-radius:999px;border:1px solid rgba(155,44,44,0.4);background:rgba(155,44,44,0.08);font-size:0.78rem;font-weight:600;color:#4361ee;cursor:pointer;">+ Tambah</button>
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
                      <button onclick="window.setManageTab(\'access_control\')" title="Tetapkan kebenaran" style="padding:0.2rem 0.55rem;border-radius:6px;border:1px solid rgba(155,44,44,0.3);background:rgba(155,44,44,0.07);font-size:0.72rem;color:#4361ee;cursor:pointer;">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                        RBAC
                      </button>
                      ${!isCore ? `<button data-rolekey="${key}" onclick="window.deleteCustomRole(this.dataset.rolekey)" title="Padam peranan" style="padding:0.2rem 0.5rem;border-radius:6px;border:1px solid rgba(239,68,68,0.25);background:rgba(239,68,68,0.07);font-size:0.72rem;color:#ef4444;cursor:pointer;">&#10005;</button>` : ''}
                    </div>
                  </div>`;
                };
                const groupHeader = (t) => `<div style="padding:0.45rem 1rem;background:rgba(155,44,44,0.05);border-bottom:1px solid rgba(163,177,198,0.12);font-size:0.68rem;font-weight:800;text-transform:uppercase;letter-spacing:0.5px;color:#4361ee;">${t}</div>`;
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
                    { key:'doctor_pahang',    label:'Doktor',            sub:'Pahang (Semua Cawangan)', color:'#d97706', bg:'rgba(217,119,6,0.04)'  },
                    { key:'operation_balok',  label:'Kakitangan Operasi',sub:'Balok (HQ)',             color:'#10b981', bg:'rgba(16,185,129,0.04)'  },
                    { key:'xray_sono_balok',  label:'Juru X-Ray / Sono', sub:'Balok (HQ)',             color:'#ec4899', bg:'rgba(236,72,153,0.04)'  },
                    { key:'juru_audio_balok', label:'Juru Audio',        sub:'Balok (HQ)',             color:'#0d9488', bg:'rgba(13,148,136,0.04)'  },
                    { key:'ksb_pharma',       label:'Semua Kakitangan',  sub:'KSB Pharma',             color:'#14532d', bg:'rgba(20,83,45,0.04)'    },
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

            <div style="margin-top:0.9rem;border-radius:10px;border:1px solid rgba(5,150,105,0.25);background:rgba(5,150,105,0.05);padding:0.75rem 0.9rem;">
              <div style="font-size:0.68rem;font-weight:800;letter-spacing:0.6px;text-transform:uppercase;color:#059669;margin-bottom:0.35rem;">Pengecualian — Terus ke HR (Skip HOD)</div>
              <ul style="margin:0;padding-left:1.1rem;font-size:0.72rem;color:var(--text-muted);line-height:1.5;">
                <li><strong>HOD Balok</strong> yang memohon cuti sendiri — <strong>semua jenis cuti</strong> terus ke HR, tanpa kelulusan HOD lain.</li>
              </ul>
              <div style="font-size:0.66rem;color:var(--text-muted);margin-top:0.4rem;">Peraturan ini terpakai automatik di seluruh sistem (borang, senarai pending, kelulusan HR) dan tidak boleh ditogol di jadual di atas.</div>
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
      // Anak syarikat (KSB Pharma) melihat polisi syarikat sendiri — tiada kandungan klinik.
      const _isCoPol = window.isSubsidiaryUser(user);
      const _pol = window.activePolicy();

      // ── Reka bentuk moden (2026-10-14): hero baki + sub-tab, kandungan sama. ──
      const _f2 = (n) => parseFloat((Number(n) || 0).toFixed(2));
      const _alUsedAll = _f2((_polAlStats.usedPre || 0) + (_polAlStats.used || 0) + (_polAlStats.pelarasan || 0));
      const _alPct = _polAlStats.ent > 0 ? Math.max(0, Math.min(100, Math.round((_alUsedAll / _polAlStats.ent) * 100))) : 0;
      const _polTabs = [
        { id: 'ringkasan', label: 'Ringkasan',        icon: 'layout-dashboard' },
        { id: 'aliran',    label: 'Aliran Kelulusan', icon: 'git-branch' },
        { id: 'kelayakan', label: 'Kelayakan',        icon: 'table-2' },
        { id: 'peraturan', label: 'Peraturan',        icon: 'scroll-text' },
        { id: 'cuti_umum', label: 'Cuti Umum',        icon: 'calendar-days' },
      ];
      const _pTab = _polTabs.some(t => t.id === policyTab) ? policyTab : 'ringkasan';
      // Warna kod glosari (kod paparan rasmi HR, bukan id storan).
      const _glossColor = { AL:'#3b82f6', MC:'#10b981', CME:'#8b5cf6', EL:'#ef4444', CL:'#f59e0b', HL:'#06b6d4', ML:'#ec4899', PL:'#6366f1', RL:'#14b8a6', UPL:'#64748b' };

      const _flowCard = (title, color, steps) => `
        <div class="pol-flow" style="--fc:${color};">
          <div class="pol-flow-head"><span class="pol-dot"></span>${title}<span class="pol-flow-count">${steps.length} peringkat</span></div>
          <div class="pol-steps">
            ${steps.map((s, i) => `
              ${i > 0 ? '<div class="pol-step-arrow" aria-hidden="true"><i data-lucide="chevron-right" width="18" height="18"></i></div>' : ''}
              <div class="pol-step ${i === steps.length - 1 ? 'is-final' : ''}">
                <div class="pol-step-badge">${s.code}</div>
                <div class="pol-step-title">${s.label}</div>
                <div class="pol-step-desc">${s.desc}</div>
              </div>`).join('')}
          </div>
        </div>`;
      const _flowsHTML = _isCoPol
        ? _flowCard(`Staf ${window.printBrandFor(user.branch).name}`, '#3b82f6', [
            { code: 'P1', label: 'Pelulus Pertama', desc: 'Pelulus peringkat pertama syarikat menilai dan menyokong permohonan.' },
            { code: 'P2', label: 'Kelulusan Akhir — Pengurus Besar', desc: 'Cuti hanya dikira <strong>SAH</strong> selepas kelulusan akhir diberi.' },
          ])
        : [
            _flowCard('Staff Operasi — Klinik Syed Badaruddin Balok', '#f43f5e', [
              { code: 'P0', label: 'Team Leader (TL)', desc: 'Sokongan <strong>Team Leader Balok</strong> yang dipilih semasa menghantar borang.' },
              { code: 'P1', label: 'Supervisor', desc: 'Supervisor Balok menilai dan meluluskan <strong>selepas</strong> sokongan TL.' },
              { code: 'P2', label: 'HR / Admin', desc: 'Cuti hanya dikira <strong>SAH</strong> selepas kelulusan akhir HR/Admin.' },
            ]),
            _flowCard('Doktor / Staff Admin / Staff Operasi Lain', '#3b82f6', [
              { code: 'P1', label: 'Doctor PIC / HOD Balok / Supervisor', desc: 'Pelulus yang dipilih semasa menghantar borang menyokong permohonan.' },
              { code: 'P2', label: 'HR / Admin', desc: 'Cuti hanya dikira <strong>SAH</strong> selepas kelulusan akhir HR/Admin.' },
            ]),
            _flowCard('Staff Terengganu (Dungun / Kerteh / Paka)', '#8b5cf6', [
              { code: 'P1', label: 'Doctor PIC Cawangan', desc: 'Doctor PIC cawangan anda menilai dan menyokong permohonan.' },
              { code: 'P2', label: 'HR Terengganu', desc: 'Cuti hanya dikira <strong>SAH</strong> selepas kelulusan akhir HR Terengganu.' },
            ]),
            `<div class="pol-callout"><i data-lucide="info" width="16" height="16"></i><div>Cawangan Pahang yang <strong>tiada Doctor PIC</strong> (cth. RPCM) — Peringkat 1 ialah <strong>Supervisor Balok (HQ)</strong>. Klinik Utama mengikut laluan Balok (HQ).</div></div>`,
          ].join('');

      const _entTable = (title, color, rows, note = '') => `
        <div class="pol-ent" style="--ec:${color};">
          <div class="pol-ent-title">${title}</div>
          ${rows.map(r => `<div class="pol-ent-row">${r.period ? `<span>${r.period}</span>` : ''}<strong>${r.days}</strong></div>`).join('')}
          ${note ? `<div class="pol-ent-note">${note}</div>` : ''}
        </div>`;
      const _isTrgBranch = !!(user && user.branch && (user.branch.includes('Dungun') || user.branch.includes('Kerteh') || user.branch.includes('Paka')));
      const _showPahang = !user || !user.branch || !_isTrgBranch;
      const _showTrg    = !user || !user.branch || _isTrgBranch;

      const _ruleCard = (n, title, color, icon, items, extra = '') => `
        <div class="pol-rule" style="--rc:${color};">
          <div class="pol-rule-head"><span class="pol-rule-icon"><i data-lucide="${icon}" width="17" height="17"></i></span><span class="pol-rule-num">${n}</span>${title}</div>
          ${items && items.length ? `<ul class="pol-list">${items.map(r => `<li>${r}</li>`).join('')}</ul>` : ''}
          ${extra}
        </div>`;

      const _hol = (() => {
        const branchObj = branches.find(b => b.name === user.branch);
        const isTerengganu = branchObj && branchObj.state === 'Terengganu';
        const state = isTerengganu ? 'terengganu' : 'pahang';
        const list = (publicHolidays[state] || []).slice().sort((a,b) => a.date.localeCompare(b.date));
        const today = new Date(); today.setHours(0,0,0,0);
        const nextIdx = list.findIndex(h => new Date(h.date + 'T00:00:00') >= today);
        return { stateLabel: isTerengganu ? 'Terengganu' : 'Pahang', list, nextIdx,
                 year: list.length ? list[0].date.substring(0,4) : new Date().getFullYear(), today };
      })();

      let _tabBody = '';
      if (_pTab === 'ringkasan') {
        _tabBody = `
          ${_pol.notice ? `<div class="pol-notice"><i data-lucide="megaphone" width="18" height="18"></i><div>${_pol.notice}</div></div>` : ''}
          <section class="pol-card">
            <div class="pol-card-title"><i data-lucide="calculator" width="18" height="18"></i>Formula Pengiraan Pro-Rata</div>
            <div class="pol-formula">
              <span>Cuti Pro-Rata Sebulan</span><b>=</b>
              <span class="pol-frac"><span>Kelayakan Cuti Setahun</span><span>12 Bulan</span></span>
            </div>
            <div class="pol-calc">
              <span>Peruntukan <b>${_f2(_polAlStats.ent)}</b></span><em>−</em>
              <span>Guna Sebelum <b>${_f2(_polAlStats.usedPre)}</b></span><em>−</em>
              <span>Guna Sistem <b>${_f2(_polAlStats.used)}</b></span><em>−</em>
              <span>Pelarasan <b>${_f2(_polAlStats.pelarasan)}</b></span><em>=</em>
              <span class="is-result">Baki <b>${_f2(_polAlStats.bal)} hari</b></span>
            </div>
            <p class="pol-muted">*Prorata ialah rujukan formula sahaja. Baki sebenar = Jumlah Peruntukan − Guna Sebelum Sistem − Guna Dalam Sistem − Pelarasan HR.</p>
          </section>
          <section class="pol-card">
            <div class="pol-card-title"><i data-lucide="book-a" width="18" height="18"></i>Senarai Kategori Cuti</div>
            <div class="pol-gloss">
              ${_pol.glossary.map(g => { const c = _glossColor[g.code] || '#9b2c2c'; return `<div class="pol-gloss-item"><span class="pol-code" style="--cc:${c};">${g.code}</span><span>${g.name}</span></div>`; }).join('')}
            </div>
          </section>`;
      } else if (_pTab === 'aliran') {
        _tabBody = `
          <section class="pol-card">
            <div class="pol-card-title"><i data-lucide="git-branch" width="18" height="18"></i>Aliran Kelulusan Cuti</div>
            <p class="pol-muted" style="margin-bottom:1rem;">Setiap permohonan cuti mesti melalui peringkat berikut sebelum dikira <strong>SAH</strong>.</p>
            <div class="pol-flows">${_flowsHTML}</div>
          </section>`;
      } else if (_pTab === 'kelayakan') {
        _tabBody = `
          <section class="pol-card">
            <div class="pol-card-title"><i data-lucide="table-2" width="18" height="18"></i>${_isCoPol ? 'Kelayakan Cuti Tahunan (AL)' : 'Kelayakan Cuti Tahunan (AL) Mengikut Lokasi'}</div>
            <div class="pol-ent-grid">
              ${_isCoPol
                ? _entTable('Semua Staf', '#9b2c2c', _pol.entitlementAL || [])
                : [
                    _showPahang ? _entTable('Negeri Pahang', '#9b2c2c', _pol.entitlementPahang) : '',
                    _showTrg ? _entTable('Negeri Terengganu', '#059669', _pol.entitlementTerengganu, 'Terhad kepada cawangan Dungun, Kerteh dan Paka.') : '',
                    _entTable('Kategori Doktor (Semua Kawasan)', '#dc2626', _pol.entitlementDoktor),
                  ].join('')}
            </div>
          </section>
          ${_pol.entitlementMC && _pol.entitlementMC.length ? `
          <section class="pol-card">
            <div class="pol-card-title"><i data-lucide="stethoscope" width="18" height="18"></i>Kelayakan Cuti Sakit (MC)</div>
            <div class="pol-ent-grid">${_entTable('Mengikut Tempoh Berkhidmat', '#10b981', _pol.entitlementMC)}</div>
          </section>` : ''}`;
      } else if (_pTab === 'peraturan') {
        const _cmp = [
          ['Tujuan', 'Kecemasan peribadi (kereta rosak, banjir, isteri bersalin kecemasan dll)', 'Kematian ahli keluarga terdekat <em>(Ibu, Bapa, Suami/Isteri, Anak sahaja)</em>'],
          ['Tolak baki cuti', 'Ya — ditolak dari AL. Jika baki AL sudah <strong>habis (0)</strong>, dikira sebagai <strong>Unpaid Leave (UPL)</strong>.', 'Tambahan percuma untuk 3 hari pertama. Lebihan melebihi 3 hari ditolak dari AL.'],
          ['Had', 'Fleksibel (mengikut baki AL; selepas AL habis → UPL)', 'Maksimum 3 hari berturut-turut bagi setiap kes'],
          ['Bukti wajib', 'Gambar kemalangan / tayar pancit dll', 'Sijil Kematian'],
        ];
        let _n = 0;
        _tabBody = `
          <div class="pol-rules">
            ${_ruleCard(++_n, 'Cuti Tahunan (AL)', '#3b82f6', 'calendar-check', _pol.rulesAL)}
            ${_ruleCard(++_n, 'Cuti Sakit (MC)', '#10b981', 'stethoscope', _pol.rulesMC)}
            ${_ruleCard(++_n, 'Cuti Kecemasan (EL) vs Cuti Ehsan (CL)', '#ef4444', 'scale', [], `
              <div class="pol-cmp">
                ${[['Cuti Kecemasan (EL)', '#ef4444', 1], ['Cuti Ehsan (CL)', '#f59e0b', 2]].map(([t, c, k]) => `
                  <div class="pol-cmp-col" style="--cc:${c};">
                    <div class="pol-cmp-title">${t}</div>
                    ${_cmp.map(row => `<div class="pol-cmp-row"><span>${row[0]}</span><div>${row[k]}</div></div>`).join('')}
                  </div>`).join('')}
              </div>
              <div class="pol-callout is-danger"><i data-lucide="file-warning" width="16" height="16"></i><div>Borang yang dihantar tanpa dokumen sokongan akan dihalang oleh sistem serta-merta.</div></div>`)}
            ${_isCoPol ? '' : _ruleCard(++_n, 'Cuti Pendidikan (CME)', '#8b5cf6', 'graduation-cap', _pol.rulesCME)}
            ${_ruleCard(++_n, 'Notis Berhenti Kerja', '#64748b', 'file-text', _pol.rulesNotice)}
          </div>`;
      } else {
        _tabBody = `
          <section class="pol-card">
            <div class="pol-card-title"><i data-lucide="calendar-days" width="18" height="18"></i>Cuti Umum ${_hol.stateLabel} ${_hol.year}<span class="pol-pill">${_hol.list.length} hari</span></div>
            ${_hol.list.length ? `<div class="pol-hols">
              ${_hol.list.map((h, i) => {
                const d = new Date(h.date + 'T00:00:00');
                const past = d < _hol.today;
                return `<div class="pol-hol ${past ? 'is-past' : ''} ${i === _hol.nextIdx ? 'is-next' : ''}">
                  <div class="pol-hol-date"><b>${d.getDate()}</b><span>${d.toLocaleDateString('ms-MY', { month: 'short' })}</span></div>
                  <div class="pol-hol-name">${h.name}<small>${d.toLocaleDateString('ms-MY', { weekday: 'long' })}</small></div>
                  ${i === _hol.nextIdx ? '<span class="pol-pill is-next">Akan datang</span>' : ''}
                </div>`;
              }).join('')}
            </div>` : '<p class="pol-muted">Tiada cuti umum direkodkan lagi.</p>'}
          </section>`;
      }

      return `
        <header class="top-bar">
          <h1>Polisi Cuti</h1>
          <button class="neu-btn primary-text" onclick="window.setView('dashboard')">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
              Kembali ke Dashboard
          </button>
        </header>

        <div class="pol-page fade-in">
          <section class="pol-hero">
            <div class="pol-hero-main">
              <div class="pol-hero-label">Baki Cuti Tahunan (AL) · ${currentMonthName}</div>
              <div class="pol-hero-value">${_f2(_polAlStats.bal)}<span>hari</span></div>
              <div class="pol-bar"><div style="width:${_alPct}%;"></div></div>
              <div class="pol-hero-sub">${_alUsedAll} daripada ${_f2(_polAlStats.ent)} hari peruntukan telah digunakan</div>
            </div>
            <div class="pol-hero-stats">
              <div><span>Kelayakan Setahun</span><b>${entitlementAL}<small> hari</small></b></div>
              <div><span>Pro-Rata Sebulan</span><b>${(entitlementAL / 12).toFixed(2)}<small> hari</small></b></div>
              <div><span>Jumlah Peruntukan</span><b>${_f2(_polAlStats.ent)}<small> hari</small></b></div>
            </div>
          </section>

          <nav class="pol-tabs" role="tablist">
            ${_polTabs.map(t => `<button role="tab" aria-selected="${t.id === _pTab}" class="pol-tab ${t.id === _pTab ? 'active' : ''}" onclick="window.setPolicyTab('${t.id}')"><i data-lucide="${t.icon}" width="15" height="15"></i>${t.label}</button>`).join('')}
          </nav>

          <div class="pol-body">${_tabBody}</div>
        </div>
      `;

    case 'inbox': {
      const unread = inboxNotifs.filter(n => !n.read).length;
      const visible = filterNotifs(inboxNotifs, inboxFilter);
      const selCount = inboxSelected.size;
      const allSelected = visible.length > 0 && visible.every(n => inboxSelected.has(n.id));
      const now = Date.now();
      const avatar = (snd, size = '') => snd.system
        ? `<div class="inbox-avatar is-system${size}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg></div>`
        : `<div class="inbox-avatar${size}" aria-hidden="true">${escapeHtml(senderInitials(snd.name))}</div>`;
      const kindIcon = (n) => {
        const k = notifKind(n.type);
        return `<span class="inbox-kind tone-${k.tone}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">${k.svg}</svg></span>`;
      };
      const row = (n) => {
        const snd = notifSender(n);
        const isSel = inboxSelected.has(n.id);
        return `
          <div class="inbox-row${n.read ? '' : ' is-unread'}${isSel ? ' is-selected' : ''}" role="button" tabindex="0" onclick="window.onInboxRowClick('${n.id}')" onkeydown="if(event.key==='Enter')window.onInboxRowClick('${n.id}')">
            ${inboxSelectMode ? `<input type="checkbox" class="inbox-check" ${isSel ? 'checked' : ''} onclick="event.stopPropagation();window.toggleNotifSelect('${n.id}')" aria-label="Pilih surat">` : ''}
            ${avatar(snd)}
            <div class="inbox-text">
              <div class="inbox-head">
                <span class="inbox-from">${escapeHtml(snd.name)}</span>
                <span class="inbox-time" title="${fullTime(n.createdAt)}">${relativeTime(n.createdAt, now)}</span>
              </div>
              <div class="inbox-subject">${kindIcon(n)}<span>${escapeHtml(cleanSubject(n.title))}</span>${n.read ? '' : '<span class="inbox-dot" aria-label="Belum baca"></span>'}</div>
              <p class="inbox-body">${escapeHtml(n.body)}</p>
            </div>
          </div>`;
      };
      const open = inboxOpenId && inboxNotifs.find(n => n.id === inboxOpenId);
      const letter = (n) => {
        const snd = notifSender(n);
        return `
          <article class="inbox-card glass-card inbox-letter">
            <div class="inbox-letter-bar">
              <button class="inbox-link" onclick="window.closeInboxLetter()">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="15 18 9 12 15 6"/></svg>
                Inbox
              </button>
              <button class="inbox-link is-danger" onclick="window.deleteOpenLetter()">Padam</button>
            </div>
            <h2 class="inbox-letter-subject">${kindIcon(n)}<span>${escapeHtml(cleanSubject(n.title))}</span></h2>
            <div class="inbox-letter-meta">
              ${avatar(snd, ' is-lg')}
              <div>
                <div class="inbox-from">${escapeHtml(snd.name)}${snd.role ? ` <span class="inbox-role">${escapeHtml(snd.role)}</span>` : ''}</div>
                <div class="inbox-to">kepada saya · ${fullTime(n.createdAt)}</div>
              </div>
            </div>
            <div class="inbox-letter-body">${escapeHtml(n.body)}</div>
            ${n.leaveId ? `<div class="inbox-letter-actions"><button class="neu-btn primary-text" onclick="window.setView('dashboard')">${n.type === 'leave_to_approve' ? 'Buka Dashboard untuk tindakan' : 'Lihat di Dashboard'}</button></div>` : ''}
          </article>`;
      };
      return `
        <header class="top-bar">
          <h1 style="display:flex;align-items:center;gap:0.6rem;">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>
            Inbox
            ${unread > 0 ? `<span class="inbox-count">${unread}</span>` : ''}
          </h1>
          <button class="neu-btn primary-text" onclick="window.setView('dashboard')">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
            Kembali
          </button>
        </header>
        <div class="main-content inbox-wrap">
          ${open ? letter(open) : inboxNotifs.length === 0 ? `<div class="inbox-card glass-card">${emptyState({ icon: 'inbox', title: 'Inbox kosong', text: 'Surat berkaitan cuti anda akan muncul di sini.' })}</div>` : `
          <div class="inbox-card glass-card">
            <div class="inbox-toolbar">
              <div class="inbox-tabs" role="tablist">
                <button class="inbox-tab${inboxFilter === 'all' ? ' active' : ''}" onclick="window.setInboxFilter('all')">Semua</button>
                <button class="inbox-tab${inboxFilter === 'unread' ? ' active' : ''}" onclick="window.setInboxFilter('unread')">Belum baca${unread ? ` <span class="inbox-tab-n">${unread}</span>` : ''}</button>
              </div>
              <div class="inbox-actions">
                ${!inboxSelectMode && unread > 0 ? `<button class="inbox-link" onclick="window.markAllNotifsRead()">Tandai<span class="inbox-hide-sm"> semua</span> dibaca</button>` : ''}
                <button class="inbox-link" onclick="window.toggleInboxSelectMode()">${inboxSelectMode ? 'Selesai' : 'Pilih'}</button>
              </div>
            </div>
            ${inboxSelectMode ? `
            <div class="inbox-selectbar">
              <label><input type="checkbox" class="inbox-check" ${allSelected ? 'checked' : ''} onchange="window.toggleSelectAllNotifs()"> Pilih semua</label>
              <span class="inbox-selcount">${selCount} dipilih</span>
              <button class="neu-btn sm is-reject" ${selCount === 0 ? 'disabled' : ''} onclick="window.deleteSelectedNotifs()">Padam${selCount ? ` (${selCount})` : ''}</button>
            </div>` : ''}
            ${visible.length === 0
              ? emptyState({ icon: 'check', title: 'Semua sudah dibaca', text: 'Tiada notifikasi baru buat masa ini.', compact: true })
              : groupNotifs(visible, now).map(g => `
                <div class="inbox-group">${g.label}</div>
                ${g.items.map(row).join('')}`).join('')}
          </div>`}
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

  // Nota: JANGAN jana startDate palsu di sini. Dulu modal mengisi tarikh rawak
  // bila startDate kosong — ia mengubah objek global staffList (rujukan), lalu
  // getEntitlementAL kira tahun khidmat dari tarikh rawak tu (AL 16 vs 20 secara
  // rawak setiap kali modal dibuka), jadi baki AL tak padan dengan Management Hub.
  // Biarkan startDate kosong → getEntitlementAL deterministik (years 0). HR perlu
  // isi Service Start Date sebenar untuk peruntukan tepat.
  const serviceDurationText = window.getServiceDurationText(staff.startDate);

  // Kiraan AL/MC/EL untuk modal (Formula B: Jumlah − Guna Sebelum − Guna Sistem − Pelarasan)
  const _modalSysUsed = (t) => leaveRecords
    .filter(r => r.ic === staff.ic && r.status === 'APPROVED' && r.type === t
      && leaveYearOf(r) === window.getCurrentLeaveYear())
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
  // EL overflow into AL (mirror getLeaveStats): excess EL usage beyond the EL bucket is
  // deducted from AL here too, so the modal's "Baki AL Sebenar" matches the dashboard.
  const _modalElSys      = _modalSysUsed('EL');
  const _modalElEnt      = (staff.ent_EL !== undefined && staff.ent_EL !== null) ? parseFloat(staff.ent_EL) : 3;
  const _modalElOverflow = computeElOverflow({
    entEL: _modalElEnt,
    usedPre: parseFloat(staff.el_used_pre || 0),
    usedSys: autoSystemUsage ? _modalElSys : parseFloat(staff.el_used_sys_adj || 0),
    pelarasan: parseFloat(staff.el_pelarasan || 0)
  });
  // EMG into AL (mirror getLeaveStats): Cuti Kecemasan has no bucket of its own, so every
  // approved EMG day is charged to AL here too.
  const _modalEmgUsed = _modalSysUsed('EL_EMG');
  const _modalEmgEnt  = (staff.ent_EL_EMG !== undefined && staff.ent_EL_EMG !== null) ? parseFloat(staff.ent_EL_EMG) : 0;
  const _modalEmgOverflow = computeEmgOverflow({
    entEMG: _modalEmgEnt,
    used: autoSystemUsage ? _modalEmgUsed : 0
  });
  const _modalAlBalance = Math.max(0, _modalTotalAL - _modalAlUsedPre - (autoSystemUsage ? _modalSysUsedAL : _modalAlUsedSysAdj) - _modalAlPelarasan - _modalElOverflow - _modalEmgOverflow);

  // Helper HTML breakdown untuk MC & EL (tiada CF). prefix: 'mc'|'el'.
  // balanceLabel: what the "Baki … Sebenar" field calls this type. Defaults to the storage
  // code, which reads fine for MC and CME. EL passes "Cuti Ehsan" — the bare code misleads.
  const _leaveBreakdownHTML = (prefix, typeId, title, annualDefault, accent, balanceLabel = typeId) => {
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
            <label style="font-size: 0.75rem; margin-bottom: 0.5rem; color: #10b981; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">Baki ${balanceLabel} Sebenar</label>
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
        
        <div style="margin-bottom: 2.5rem; padding: 1rem 1.5rem; border-radius: 12px; background: rgba(59, 130, 246, 0.1); border-left: 4px solid var(--primary); display: flex; align-items: center; gap: 1rem;">
            ${userAvatar(staff, { large: true })}
            <div>
              <strong style="font-size: 1.1rem;">${staff.name}</strong><br>
              <span style="font-size: 0.85rem; color: var(--text-muted);">IC: ${staff.ic}</span>
            </div>
        </div>
        
        <form id="edit-entitlement-form">
          ${window.isBranchScopedHod(user) ? `
          <div style="margin-bottom: 2rem; padding: 0.9rem 1.1rem; border-radius: 10px; background: rgba(56,189,248,0.07); border-left: 4px solid #38bdf8;">
            <span style="font-size:0.78rem;font-weight:700;color:#38bdf8;">Anda boleh kemaskini baki &amp; kelayakan cuti sahaja.</span>
            <div style="font-size:0.7rem;color:var(--text-muted);margin-top:0.25rem;line-height:1.4;">Peranan, cawangan, kategori, status akaun, telefon dan kata laluan diuruskan oleh HR/Admin.</div>
          </div>` : `
          <div style="margin-bottom: 3rem; display: flex; flex-direction: column; gap: 1.5rem;">
              <div style="display: flex; flex-direction: column;">
                 <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 0.5rem;">
                     <label style="font-size: 0.75rem; text-transform: uppercase; color: var(--text-muted); font-weight: 600; letter-spacing: 0.5px;">Service Start Date</label>
                     <span style="background: rgba(59, 130, 246, 0.1); color: var(--primary); padding: 0.25rem 0.75rem; border-radius: 20px; font-size: 0.75rem; font-weight: 600; display: flex; align-items: center; gap: 0.5rem;">
                         <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
                         <span id="years-badge-text">${serviceDurationText} BERKHIDMAT</span>
                     </span>
                 </div>
                 <input type="date" id="edit-start-date" oninput="window.calculateYears(this.value)" class="neu-inset" value="${staff.startDate || ''}" style="color-scheme: light;">
              </div>

              <div style="display: flex; flex-direction: column;">
                 <label style="font-size: 0.75rem; text-transform: uppercase; color: var(--text-muted); font-weight: 600; margin-bottom: 0.5rem; letter-spacing: 0.5px;">Assigned Branch</label>
                 <select class="neu-inset" style="appearance: none; cursor: pointer;">
                     ${window.staffFormBranches().map(b => `<option value="${b.name}" ${staff.branch === b.name ? 'selected' : ''}>${b.name}</option>`).join('')}
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
                     ${window.staffFormRoles(Object.keys(window.rbacMatrix)).map(k => `<option value="${k}" ${staff.role === k ? 'selected' : ''}>${window.staffConfig.roleLabels[k] || k}</option>`).join('')}
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

          <div style="display: flex; flex-direction: column; background: rgba(14, 165, 233, 0.06); padding: 1rem; border-radius: 8px; border-left: 4px solid #0ea5e9; margin-top: 1rem;">
             <label style="display: flex; align-items: flex-start; gap: 0.75rem; cursor: pointer; margin: 0;">
                <input type="checkbox" id="edit-leave-as-admin" ${staff.leaveAsAdmin === true ? 'checked' : ''} style="margin-top: 0.15rem; width: 1.25rem; height: 1.25rem; accent-color: #0ea5e9;">
                <div style="display: flex; flex-direction: column;">
                    <span style="font-size: 0.85rem; font-weight: 700; color: var(--text);">Layan Seperti Staff Admin untuk Cuti (Sabtu &amp; Ahad Cuti)</span>
                    <span style="font-size: 0.7rem; color: var(--text-muted); line-height: 1.4; margin-top: 0.25rem;">Untuk Operation Staff yang bekerja Isnin–Jumaat sahaja. Jika di-tick: hari Sabtu/Ahad &amp; cuti umum TIDAK dikira dalam permohonan cuti, dan permohonan dihalakan ke HOD Balok (bukan Team Leader/Supervisor). Kategori kekal "Operation Staff" dalam laporan.</span>
                </div>
             </label>
          </div>`}

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
                <span id="al-el-overflow-note" style="font-size: 0.68rem; color: #f59e0b; font-weight: 700; margin-top: 0.35rem; display: ${_modalElOverflow > 0 ? 'block' : 'none'};">${_modalElOverflow > 0 ? `− ${_modalElOverflow.toFixed(1)} hari ditolak dari limpahan Cuti Ehsan` : ''}</span>
                <span id="al-emg-overflow-note" style="font-size: 0.68rem; color: #ef4444; font-weight: 700; margin-top: 0.35rem; display: ${_modalEmgOverflow > 0 ? 'block' : 'none'};">${_modalEmgOverflow > 0 ? `− ${_modalEmgOverflow.toFixed(1)} hari ditolak dari Cuti Kecemasan` : ''}</span>
              </div>
            </div>
          </div>

          ${_leaveBreakdownHTML('mc', 'MC', 'MC — Cuti Sakit', window.getEntitlementMC(staff), '#10b981')}
          ${_leaveBreakdownHTML('el', 'EL', 'Cuti Ehsan (Kematian Keluarga Terdekat)', 3, '#f59e0b', 'Cuti Ehsan')}
          ${staff.category === 'Doctor'
            ? _leaveBreakdownHTML('cme', 'CME', 'CME — Cuti Pendidikan Perubatan (Doktor)', window.getEntitlementCME(staff), '#8b5cf6')
            : '' /* CME is doctors-only */}

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
               <label style="font-size: 0.85rem; margin-bottom: 0.5rem; color: var(--text-muted); font-weight: 500;">PL &mdash; Cuti Paterniti</label>
               <input type="number" id="ent-PL" class="neu-inset" value="${staff.ent_PL !== undefined ? staff.ent_PL : 7}">
            </div>
            <div style="display: flex; flex-direction: column;">
               <!-- EMG, bukan EL: medan ini menetapkan ent_EL_EMG (Cuti Kecemasan).
                    Cuti Ehsan (EL) ada blok Formula B tersendiri di atas.
                    data-used membawa hari EMG diluluskan tahun ini — EMG bukan jenis
                    Formula B jadi tiada medan guna; _recalcLeaveBalance('al') membacanya
                    untuk tolak hari EMG dari baki AL. Biar 0 → setiap hari EMG tolak AL. -->
               <label style="font-size: 0.85rem; margin-bottom: 0.5rem; color: var(--text-muted); font-weight: 500;">EL &mdash; Cuti Kecemasan</label>
               <input type="number" id="ent-EL_EMG" class="neu-inset" data-used="${_modalEmgUsed}" oninput="window._recalcLeaveBalance('al')" value="${staff.ent_EL_EMG !== undefined ? staff.ent_EL_EMG : 0}">
            </div>
            <div style="display: flex; flex-direction: column;">
               <label style="font-size: 0.85rem; margin-bottom: 0.5rem; color: var(--text-muted); font-weight: 500;">UPL &mdash; Tanpa Gaji</label>
               <input type="number" id="ent-UP" class="neu-inset" value="${staff.ent_UP !== undefined ? staff.ent_UP : 0}">
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
    const record = findLeaveRecord(editingLeaveId);
    if (!record) return '';
    const isAdminEditor = window.canEditAnyLeave(user);

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

            <div style="display:flex; flex-direction:column; align-items:center; margin-bottom: 1.75rem;">
               <div onclick="document.getElementById('settings-avatar-upload').click()" title="Tukar gambar profil"
                    style="width:96px; height:96px; border-radius:50%; overflow:hidden; cursor:pointer; position:relative;
                           background:linear-gradient(135deg,#9b2c2c,#841824); display:flex; align-items:center; justify-content:center;
                           color:#fff; font-size:2.2rem; font-weight:800; box-shadow:0 4px 12px rgba(0,0,0,0.15);">
                  ${user.photoUrl
                    ? `<img src="${user.photoUrl}" alt="${escapeHtml(user.name || '')}" style="width:100%;height:100%;object-fit:cover;">`
                    : escapeHtml(((user.name || '?')[0] || '?'))}
                  <span style="position:absolute; bottom:0; left:0; right:0; background:rgba(0,0,0,0.45); color:#fff; font-size:0.7rem; text-align:center; padding:2px 0;">📷 Tukar</span>
               </div>
               <input type="file" id="settings-avatar-upload" accept="${PHOTO_ACCEPT}" style="display:none;" onchange="window.uploadProfilePhoto(this)">
               <div style="font-size:0.72rem; color:#9ca3af; margin-top:0.5rem;">Tekan gambar untuk muat naik (maks 5MB)</div>
            </div>

            <div style="margin-bottom: 1.5rem;">
               <label style="font-size: 0.75rem; color: #6b7280; text-transform: uppercase; font-weight: 700; display: block; margin-bottom: 0.5rem;">Nama Penuh</label>
               <input id="self-name" type="text" value="${(user.name || '').replace(/"/g,'&quot;')}" placeholder="Nama penuh anda..." required style="width: 100%; padding: 1rem; border-radius: 12px; background: rgba(0,0,0,0.03); border: 1px inset rgba(255,255,255,0.5); outline: none; box-shadow: inset 2px 2px 5px rgba(0,0,0,0.05), inset -2px -2px 5px white; color: #374151; box-sizing: border-box;">
               <div style="font-size:0.7rem; color:#9ca3af; margin-top:0.4rem;">Nama akan ditukar kepada HURUF BESAR automatik semasa simpan (cth: <em>ahmad bin ali</em> → <em>AHMAD BIN ALI</em>). Nama ini digunakan di skrin log masuk dan pada permohonan cuti baharu.</div>
            </div>

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
            ${window.staffFormBranches().map(b => `<option value="${b.name}">${b.name}</option>`).join('')}
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
              ${window.staffFormRoles(Object.keys(window.rbacMatrix).filter(k => k !== 'super_admin')).map(k => `<option value="${k}">${window.staffConfig.roleLabels[k] || k}</option>`).join('')}
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
  if (!canEditHolidayState({ role: user.role, perms: window.effectivePerms(user), zone: window.getUserStateScope(user) }, state)) {
    showToast('Anda hanya boleh mengubah cuti umum zon anda sendiri.');
    return;
  }
  const list = publicHolidays[state];
  for (let i = 0; i < list.length; i++) {
    if (!list[i].date || !list[i].name.trim()) {
      showToast('Sila lengkapkan semua tarikh dan nama cuti sebelum menyimpan.');
      return;
    }
  }
  publicHolidays[state] = list.slice().sort((a, b) => a.date.localeCompare(b.date));
  try {
    const payload = {};
    payload[state] = publicHolidays[state];
    await setDoc(doc(db, 'config', 'publicHolidays'), payload, { merge: true });
    showToast(`✅ Cuti Umum ${state === 'pahang' ? 'Pahang' : 'Terengganu'} berjaya disimpan!`);
    render();
  } catch(e) {
    console.error('savePublicHolidays error:', e);
    showToast('Ralat menyimpan. Sila cuba lagi.');
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
// Semua helper menyunting activePolicy(): polisi klinik untuk HR klinik, polisi
// syarikat untuk HR anak syarikat — kedua-duanya tidak pernah bercampur.
window.updatePolicyNotice = function(val) { window.activePolicy().notice = val; };
window.updatePolicyGlossary = function(i, field, val) { if (window.activePolicy().glossary[i]) window.activePolicy().glossary[i][field] = val; };
window.addPolicyGlossaryRow = function() { window.activePolicy().glossary.push({ code:'', name:'' }); render(); };
window.deletePolicyGlossaryRow = function(i) { window.activePolicy().glossary.splice(i,1); render(); };
window.updateEntitlement = function(section, i, field, val) { if (window.activePolicy()[section] && window.activePolicy()[section][i]) window.activePolicy()[section][i][field] = val; };
window.addEntitlementRow = function(section) { const row = section==='entitlementDoktor' ? {days:''} : {period:'',days:''}; window.activePolicy()[section].push(row); render(); };
window.deleteEntitlementRow = function(section, i) { window.activePolicy()[section].splice(i,1); render(); };
window.updatePolicyRule = function(section, i, val) { if (window.activePolicy()[section]) window.activePolicy()[section][i] = val; };
window.addPolicyRule = function(section) { window.activePolicy()[section].push(''); render(); };
window.deletePolicyRule = function(section, i) { window.activePolicy()[section].splice(i,1); render(); };
window.savePolicySection = async function(section) {
  try {
    const pc = window.activePolicy();
    const payload = section === 'notice' ? { notice: pc.notice } : { [section]: pc[section] };
    // Anak syarikat → companyPolicy/{cawangan}; polisi klinik (config/policyContent) tidak disentuh.
    const ref = window.isSubsidiaryUser(user) ? doc(db, 'companyPolicy', user.branch) : doc(db, 'config', 'policyContent');
    await setDoc(ref, payload, { merge: true });
    const btn = document.getElementById('save-policy-' + section);
    if (btn) { btn.textContent = '✅ Tersimpan'; btn.disabled = true; }
    setTimeout(() => render(), 1200);
  } catch(e) { showToast('Ralat menyimpan: ' + e.message); }
};

window.dismissPhoneReminder = function() { showPhoneReminderModal = false; render(); };
window.savePhoneFromReminder = async function() {
  const input = document.getElementById('reminder-phone-input');
  if (!input) return;
  const clean = normalizePhone(input.value);
  if (!clean) { showToast('Sila masukkan nombor telefon.'); return; }
  if (!isValidPhone(clean)) {
    showToast('⚠️ Nombor telefon tidak sah.\n\nContoh: 0171234678 atau 60171234678');
    return;
  }
  try {
    await updateDoc(doc(db, 'staff', user.ic), { phone: clean });
    user.phone = clean;
    const s = staffList.find(i => i.ic === user.ic);
    if (s) s.phone = clean;
    showPhoneReminderModal = false;
    render();
    showToast('✅ Nombor WhatsApp berjaya disimpan! Anda kini akan menerima notifikasi kelulusan cuti.');
  } catch(err) {
    console.error('savePhoneFromReminder error:', err);
    showToast('Ralat menyimpan nombor. Sila cuba lagi.');
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

// Modal wajib tukar kata laluan: tiada "abaikan" — kata laluan lalai (IC) boleh
// diteka kerana IC kelihatan di senarai log masuk. Pilihan: tukar, atau log keluar.

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
        Anda <strong style="color:#ef4444;">wajib</strong> menukarnya sebelum menggunakan sistem ini.
      </p>
      <div style="background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.25);border-radius:0.75rem;padding:0.85rem 1rem;margin-bottom:1.25rem;font-size:0.8rem;color:var(--text-muted);line-height:1.5;">
        <strong style="color:#ef4444;">Kenapa perlu tukar?</strong><br>
        Kata laluan lalai adalah nombor IC anda — sesiapa yang tahu IC anda boleh akses akaun ini. Lindungi maklumat cuti anda dengan kata laluan peribadi.
      </div>
      <form onsubmit="window.changePassword(event)" style="display:flex;flex-direction:column;gap:0.6rem;">
        <input type="password" id="pwd-current" placeholder="Kata laluan semasa (No. IC)" value="${firstLoginPwd.replace(/"/g, '&quot;')}" required autocomplete="current-password" class="neu-inset" style="width:100%;padding:0.75rem 0.9rem;border-radius:10px;font-size:0.9rem;">
        <input type="password" id="pwd-new" placeholder="Kata laluan baharu (min. 6 aksara, bukan IC)" required minlength="6" autocomplete="new-password" class="neu-inset" style="width:100%;padding:0.75rem 0.9rem;border-radius:10px;font-size:0.9rem;">
        <input type="password" id="pwd-confirm" placeholder="Sahkan kata laluan baharu" required minlength="6" autocomplete="new-password" class="neu-inset" style="width:100%;padding:0.75rem 0.9rem;border-radius:10px;font-size:0.9rem;">
        <button type="submit" class="btn-primary" style="width:100%;padding:0.95rem;font-size:1rem;font-weight:800;background:linear-gradient(135deg,#ef4444,#dc2626);box-shadow:0 8px 24px rgba(239,68,68,0.35);">
          🔒 Tukar Kata Laluan
        </button>
        <button type="button" onclick="window.logout()" style="width:100%;padding:0.7rem;background:transparent;border:1px solid rgba(163,177,198,0.4);border-radius:12px;color:var(--text-muted);cursor:pointer;font-size:0.82rem;">
          Log Keluar
        </button>
      </form>
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

// ── Mod Test: tindakan ke atas rekod test ─────────────────────────────
// Dibalut SELEPAS semua definisi supaya setiap butang/pemanggil (window.X) melalui
// pembalut ini. Untuk rekod isTest, testCtx dipasang sepanjang tindakan supaya
// sendWhatsApp/addNotification menghala mesej kepada penguji sahaja.
['finalizeLeave', 'rejectLeave', 'cancelLeave', 'resendApprovalWA', 'resendLeaveWA', 'staffEditOwnLeave'].forEach(name => {
  const orig = window[name];
  if (typeof orig !== 'function') return;
  window[name] = async function(id, ...rest) {
    const rec = findLeaveRecord(id);
    if (!rec || !rec.isTest) return orig.call(this, id, ...rest);
    if (!canUseTestMode(user)) { showToast('Rekod test hanya boleh diuruskan oleh Super Admin / Admin.'); return; }
    const prev = testCtx;
    testCtx = { ic: user.ic, name: user.name, phone: user.phone || '' };
    try { return await orig.call(this, id, ...rest); } finally { testCtx = prev; }
  };
});
