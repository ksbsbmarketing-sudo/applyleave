import './style.css'
import { Chart, registerables } from 'chart.js';
Chart.register(...registerables);

import { initializeApp } from "firebase/app";
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
  query,
  where
} from "firebase/firestore";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";

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
const db = getFirestore(firebaseApp);
const analytics = getAnalytics(firebaseApp);
const storage = getStorage(firebaseApp);

const app = document.querySelector('#app')

// ============================================================
// WHATSAPP NOTIFICATION CONFIG (Fonnte.com)
// Daftar di: https://fonnte.com → sambungkan no. 0129444295
// ============================================================
let WHATSAPP_TOKEN = localStorage.getItem('ksb_wa_token') || '';
const WHATSAPP_SENDER = '60129444295'; // No. penghantar
const WHATSAPP_ENABLED = () => !!WHATSAPP_TOKEN;

window.sendWhatsApp = async function(toPhone, message, throwOnError = false) {
  if (!WHATSAPP_ENABLED() || !toPhone) return;
  // Normalize phone: remove leading 0, add country code 60
  let phone = toPhone.replace(/\D/g, '');
  if (phone.startsWith('0')) phone = '6' + phone;
  try {
    const res = await fetch('https://api.fonnte.com/send', {
      method: 'POST',
      headers: {
        'Authorization': WHATSAPP_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ target: phone, message, countryCode: '60' })
    });
    if (throwOnError && !res.ok) throw new Error(`Fonnte error: ${res.status}`);
  } catch(err) {
    if (throwOnError) throw err;
    console.warn('WhatsApp notification failed:', err);
  }
};

window.saveWAToken = function(token) {
  WHATSAPP_TOKEN = token;
  localStorage.setItem('ksb_wa_token', token);
  alert('✅ Token WhatsApp berjaya disimpan!');
};

window.forgotPassword = async function() {
  if (!selectedLoginBranch) {
    alert('Sila pilih cawangan anda terlebih dahulu.');
    return;
  }
  if (!selectedLoginStaffIC) {
    alert('Sila pilih nama anda dari senarai dropdown sebelum meneruskan.');
    return;
  }

  const staff = staffList.find(s => s.ic === selectedLoginStaffIC && !s.inactive);
  if (!staff) {
    alert('Ralat: Rekod staf tidak ditemui. Sila hubungi HR/Admin.');
    return;
  }

  if (!staff.phone) {
    alert('Maaf, nombor WhatsApp anda belum didaftarkan dalam sistem.\n\nSila hubungi HR/Admin untuk mendapatkan kata laluan anda.');
    return;
  }

  if (!WHATSAPP_ENABLED()) {
    alert('Sistem WhatsApp belum dikonfigurasi oleh Admin.\n\nSila hubungi HR/Admin terus untuk mendapatkan kata laluan anda.');
    return;
  }

  const pwd = staff.password || staff.ic;
  const msg = `🔐 *PEMULIHAN KATA LALUAN — KSB Leave Apply*\n\nSalam ${staff.name},\n\nKata laluan akaun anda adalah:\n\n📌 *${pwd}*\n\nSila log masuk ke sistem menggunakan kata laluan di atas.\n\n⚠️ Demi keselamatan, sila tukar kata laluan anda selepas berjaya masuk melalui Settings → Security.\n\n_— KSB Leave System_`;

  try {
    await window.sendWhatsApp(staff.phone, msg, true);
    alert(`✅ Kata laluan telah dihantar ke nombor WhatsApp anda.\n\nSila semak mesej WhatsApp anda.`);
  } catch (err) {
    console.error('forgotPassword WA send failed:', err);
    alert('Ralat menghantar mesej WhatsApp. Sila pastikan token Fonnte betul atau hubungi HR/Admin terus.');
  }
};

window.testWANotification = async function() {
  const phone = document.getElementById('wa-test-phone')?.value;
  if (!phone) return alert('Sila masukkan nombor telefon untuk ujian.');
  if (!WHATSAPP_TOKEN) return alert('Sila simpan token Fonnte dahulu.');
  await window.sendWhatsApp(phone, `✅ *Ujian Notifikasi KSB Leave Apply*\n\nSistem notifikasi WhatsApp berfungsi dengan baik.\n\n_— KSB Leave System_`);
  alert('Mesej ujian telah dihantar ke ' + phone);
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
    if (r.status !== 'PENDING' && r.status !== 'HOD APPROVED') return false;
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
let managementTab = 'pending'; // 'pending', 'staff', 'branches', 'master_audit', 'login_audit', 'hr_reports'
let hrReportTab = 'all'; // 'all' | 'approved' | 'balance' | 'jenis'
let approvedReportBranch = 'SEMUA';
let approvedReportType = 'SEMUA';
let approvedReportYear = new Date().getFullYear().toString();
let balanceReportBranch = 'SEMUA';
let balanceReportType = 'AL';
let balanceReportYear = new Date().getFullYear().toString();
let jenisCutiYear = new Date().getFullYear().toString();
let jenisCutiBranch = 'SEMUA';
let attendanceReportMonth = String(new Date().getMonth() + 1);
let attendanceReportYear = new Date().getFullYear().toString();
let attendanceReportBranch = 'SEMUA';
let manageSearchQuery = '';
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

window.rbacMatrix = {
    super_admin: {
        dashboard: 'analisa', branch_analisa: false, leave_request: true, management: true, policy: true, settings: true, wa_setting: true, messenger: true,
        manage_pending: true, manage_staff: true, manage_branches: true, manage_audit: true, manage_login_audit: true, manage_reports: true, manage_routing: true, manage_access: true,
        report_kuantan_only: false, report_own_branch_only: false, report_attendance: true,
        can_cancel: true, os_balok: true, os_pahang: true, locum_records: true
    },
    admin: {
        dashboard: 'analisa', branch_analisa: false, leave_request: true, management: true, policy: true, settings: true, wa_setting: false, messenger: true,
        manage_pending: true, manage_staff: true, manage_branches: true, manage_audit: true, manage_login_audit: true, manage_reports: true, manage_routing: true, manage_access: true,
        report_kuantan_only: false, report_own_branch_only: false, report_attendance: true,
        can_cancel: true, os_balok: true, os_pahang: true, locum_records: true
    },
    hr: {
        dashboard: 'staff', branch_analisa: false, leave_request: true, management: true, policy: true, settings: true, wa_setting: false, messenger: true,
        manage_pending: true, manage_staff: true, manage_branches: true, manage_audit: true, manage_login_audit: false, manage_reports: true, manage_routing: false, manage_access: false,
        report_kuantan_only: true, report_own_branch_only: false, report_attendance: true,
        can_cancel: true, os_balok: true, os_pahang: true, locum_records: true
    },
    hod: {
        dashboard: 'branch', branch_analisa: true, leave_request: true, management: false, policy: true, settings: true, wa_setting: false, messenger: true,
        manage_pending: true, manage_staff: false, manage_branches: false, manage_audit: false, manage_login_audit: false, manage_reports: true, manage_routing: false, manage_access: false,
        report_kuantan_only: false, report_own_branch_only: true, report_attendance: true,
        can_cancel: true, os_balok: true, os_pahang: true, locum_records: false
    },
    pic_hod: {
        dashboard: 'branch', branch_analisa: true, leave_request: true, management: false, policy: true, settings: true, wa_setting: false, messenger: true,
        manage_pending: true, manage_staff: false, manage_branches: false, manage_audit: false, manage_login_audit: false, manage_reports: false, manage_routing: false, manage_access: false,
        report_kuantan_only: false, report_own_branch_only: false, report_attendance: false,
        can_cancel: true, os_balok: true, os_pahang: true, locum_records: false
    },
    supervisor: {
        dashboard: 'staff', branch_analisa: false, leave_request: true, management: false, policy: true, settings: true, wa_setting: false, messenger: true,
        manage_pending: true, manage_staff: false, manage_branches: false, manage_audit: false, manage_login_audit: false, manage_reports: false, manage_routing: false, manage_access: false,
        report_kuantan_only: false, report_own_branch_only: false, report_attendance: false,
        can_cancel: true, os_balok: true, os_pahang: true, locum_records: true
    },
    staff: {
        dashboard: 'staff', branch_analisa: false, leave_request: true, management: false, policy: true, settings: true, wa_setting: false, messenger: true,
        manage_pending: false, manage_staff: false, manage_branches: false, manage_audit: false, manage_login_audit: false, manage_reports: false, manage_routing: false, manage_access: false,
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

const _rbacCodeDefaults = JSON.parse(JSON.stringify(window.rbacMatrix));
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
    if (!['hod', 'pic_hod', 'supervisor'].includes(user.role)) return false;

    // Permohonan dengan pelulus spesifik — hanya pelulus itu sahaja
    if (req.hodIC) return req.hodIC === user.ic;

    // Guna routing config
    const applicant = staffList.find(s => s.ic === req.ic);
    if (!applicant) return false;
    const group = window.getStaffGroup(applicant);
    const cfg   = approvalRouting[group] || {};

    const isP1 = (
        (cfg.p1_hod       && user.role === 'hod') ||
        (cfg.p1_pic_hod   && user.role === 'pic_hod') ||
        (cfg.p1_supervisor && user.role === 'supervisor')
    );
    if (!isP1) return false;

    // Semak cawangan
    if (cfg.p1_supervisor && user.role === 'supervisor') {
        const useBalok = group === 'doctor_kuantan' || group === 'operation_balok';
        if (useBalok) return (user.branch || '').includes('Balok');
        return req.branch === user.branch;
    }
    return req.branch === user.branch;
};

window.handleFileSelect = function(input, displayId, noticeId) {
    if (input.files.length > 0) {
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
                .header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 20px; margin-bottom: 30px; }
                .logo { width: 100px; margin-bottom: 10px; }
                .title { font-size: 24px; font-weight: bold; text-transform: uppercase; margin: 0; }
                .subtitle { font-size: 14px; color: #666; margin-top: 5px; }
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
                <button onclick="window.print()" style="padding: 10px 20px; background: #3b82f6; color: var(--text); border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">PRINT FORM</button>
            </div>
            <div class="header">
                <img src="${logos.ksb}" class="logo" alt="KSB Logo">
                <h1 class="title">BORANG PELANTIKAN DOKTOR LOCUM</h1>
                <p class="subtitle">KLINIK SYED BADARUDDIN GROUP</p>
            </div>
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
    <h1>REKOD LOCUM — Klinik Syed Badaruddin</h1>
    <div style="font-size:10px;color:#666;">Dicetak: ${new Date().toLocaleString()}</div>
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
  const confirm = document.getElementById('pwd-confirm')?.value;

  if (!user) { alert('Sesi tidak sah. Sila log masuk semula.'); return; }
  if (current !== (user.password || user.ic)) {
    alert('❌ Kata laluan semasa tidak betul. Sila cuba lagi.'); return;
  }
  if (next !== confirm) {
    alert('❌ Kata laluan baharu tidak sepadan. Sila cuba lagi.'); return;
  }
  if (next.length < 4) {
    alert('❌ Kata laluan baharu mesti sekurang-kurangnya 4 aksara.'); return;
  }

  try {
    await updateDoc(doc(db, 'staff', user.ic), { password: next });
    user.password = next;
    const s = staffList.find(i => i.ic === user.ic);
    if (s) s.password = next;
    alert('✅ Kata laluan berjaya ditukar!');
    document.getElementById('pwd-current').value = '';
    document.getElementById('pwd-new').value = '';
    document.getElementById('pwd-confirm').value = '';
  } catch (err) {
    console.error('changePassword error:', err);
    alert('Ralat menyimpan kata laluan. Sila cuba lagi.');
  }
};

window.saveSelfProfile = async function(event) {
    if (event) event.preventDefault();
    const phone = document.getElementById('self-phone')?.value;
    const email = document.getElementById('self-email')?.value;

    if (!user || !user.ic) {
        alert('Ralat: Sesi tidak sah. Sila log masuk semula.');
        return;
    }

    const s = staffList.find(i => i.ic === user.ic);
    if (s) {
        s.phone = phone;
        s.email = email;
        user.phone = phone;
        user.email = email;
    }

    try {
        await updateDoc(doc(db, "staff", user.ic), { phone, email });
    } catch (err) {
        console.error("Error saving profile:", err);
        alert('Ralat menyimpan profil ke pangkalan data.');
        return;
    }

    alert('Profil berjaya dikemaskini!');
    window.setProfileSettings(false);
};

window.setManageTab = function(tab) {
  managementTab = tab;
  render();
};

let showAddStaffModal = false;
window.openAddStaff = function() { showAddStaffModal = true; render(); };
window.closeAddStaff = function() { showAddStaffModal = false; render(); };

window.submitAddStaff = async function(event) {
  event.preventDefault();
  const form = event.target;
  const name     = form.querySelector('#as-name').value.trim().toUpperCase();
  const ic       = form.querySelector('#as-ic').value.trim();
  const branch   = form.querySelector('#as-branch').value;
  const category = form.querySelector('#as-category').value;
  const role     = form.querySelector('#as-role').value;
  const phone    = form.querySelector('#as-phone').value.trim();
  const password = form.querySelector('#as-password').value || ic;

  if (!name || !ic || !branch) {
    alert('Sila lengkapkan Nama, No. IC, dan Cawangan.');
    return;
  }
  if (staffList.find(s => s.ic === ic)) {
    alert('No. IC ini sudah wujud dalam sistem. Sila semak semula.');
    return;
  }

  const newStaff = { name, ic, branch, category, role, phone, password, inactive: false, startDate: new Date().toISOString().split('T')[0] };

  try {
    await setDoc(doc(db, 'staff', ic), newStaff);
    window.logSystemActivity(`Added new staff: ${name}`);
    alert(`✅ Staf baharu "${name}" berjaya ditambah!`);
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
  doctor_kuantan:    { p1_hod: false, p1_pic_hod: false, p1_supervisor: true,  needs_p2: true  },
  doctor_bentong:    { p1_hod: true,  p1_pic_hod: true,  p1_supervisor: false, needs_p2: true  },
  doctor_mckip:      { p1_hod: true,  p1_pic_hod: true,  p1_supervisor: false, needs_p2: true  },
  doctor_terengganu: { p1_hod: true,  p1_pic_hod: true,  p1_supervisor: false, needs_p2: false },
  admin_staff_pahang:     { p1_hod: true,  p1_pic_hod: false, p1_supervisor: false, needs_p2: true  },
  admin_staff_terengganu: { p1_hod: true,  p1_pic_hod: false, p1_supervisor: false, needs_p2: false },
  operation_balok:   { p1_hod: false, p1_pic_hod: false, p1_supervisor: true,  needs_p2: true  },
  operation_other:   { p1_hod: false, p1_pic_hod: true,  p1_supervisor: false, needs_p2: true  },
};
let approvalRouting = JSON.parse(JSON.stringify(ROUTING_DEFAULTS));

window.getStaffGroup = function(s) {
  const branchObj = branches.find(b => b.name === s.branch);
  const isTerengganu = branchObj && branchObj.state === 'Terengganu';
  const isBentong    = (s.branch || '').includes('Bentong');
  const isMCKIP      = (s.branch || '').includes('MCKIP');
  const isBalok      = (s.branch || '').includes('Balok');
  if (s.category === 'Doctor') {
    if (isTerengganu) return 'doctor_terengganu';
    if (isBentong)    return 'doctor_bentong';
    if (isMCKIP)      return 'doctor_mckip';
    return 'doctor_kuantan';
  }
  if (s.category === 'Admin Staff') return isTerengganu ? 'admin_staff_terengganu' : 'admin_staff_pahang';
  if (isBalok) return 'operation_balok';
  return 'operation_other';
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
    const useBalok = group === 'doctor_kuantan' || group === 'operation_balok';
    const supBranch = useBalok ? 'Klinik Syed Badaruddin Balok (HQ)' : staffMember.branch;
    candidates.push(...staffList.filter(s => s.role === 'supervisor' && s.branch === supBranch && !s.inactive && s.ic !== staffMember.ic));
  }
  if (cfg.p1_hod) {
    candidates.push(...staffList.filter(s => s.role === 'hod' && s.branch === staffMember.branch && !s.inactive && s.ic !== staffMember.ic));
    // HOD memohon → guna supervisor jika ada
    if (staffMember.role === 'hod') {
      const sups = staffList.filter(s => s.role === 'supervisor' && s.branch === staffMember.branch && !s.inactive && s.ic !== staffMember.ic);
      if (sups.length) candidates = sups;
    }
  }
  if (cfg.p1_pic_hod) {
    candidates.push(...staffList.filter(s => s.role === 'pic_hod' && s.branch === staffMember.branch && !s.inactive && s.ic !== staffMember.ic));
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

window._updateAlTotal = function() {
    const cf = parseFloat(document.getElementById('ent-CF')?.value || 0);
    const al = parseFloat(document.getElementById('ent-AL')?.value || 0);
    const totalEl = document.getElementById('al-total-display');
    if (totalEl) totalEl.value = (cf + al).toFixed(0);
};

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

window.printLeave = function(id) {
    const record = leaveRecords.find(r => r.id === id);
    if (!record) return;

    let printHTML = `
    <div id="print-container" style="font-family: Arial, sans-serif; padding: 40px; color: #841824;">
        <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #9b2c2c; font-size: 28px; font-weight: bold; margin: 0;">KLINIK SYED BADARUDDIN</h1>
            <p style="color: #4a5568; font-size: 11px; letter-spacing: 1px; margin-top: 5px; text-transform: uppercase;">- SERVICING COMMUNITY SINCE 1991 -</p>
            <div style="border: 1px solid #e2e8f0; width: 60%; margin: 15px auto; padding: 5px; font-weight: bold; letter-spacing: 2px;">BORANG PERMOHONAN CUTI</div>
        </div>
        
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
                <td style="border: 2px solid #e53e3e; padding: 8px;">2021-06-01</td>
            </tr>
            <tr>
                <td style="color: #4a5568;">KELAYAKAN CUTI TAHUNAN</td>
                <td style="border: 2px solid #e53e3e; padding: 8px;">20 Hari</td>
            </tr>
            <tr>
                <td style="color: #4a5568;">BAKI CUTI TERDAHULU</td>
                <td style="border: 2px solid #e53e3e; padding: 8px;">21 Hari</td>
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
                <td style="border: 2px solid #e53e3e; padding: 8px;">20 Hari</td>
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
    editingLeaveId = id;
    render();
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
        let newStatus = "";

        if (isFullBoss) {
            // Peringkat 2: HR/Admin beri kelulusan akhir
            // Jika PENDING (bypass HOD), minta pengesahan
            if (record.status === 'PENDING') {
                if (!confirm(`⚠️ Permohonan ini BELUM disokong oleh HOD/PIC_HOD.\n\nAdakah anda pasti mahu luluskan terus (bypass peringkat HOD) bagi ${record.name}?`)) return;
            }
            newStatus = "APPROVED";
            const leaveTypeName = leaveCategories.find(c => c.id === record.type)?.name || record.type;
            if (applicant && applicant.phone) {
                const msg = `✅ *CUTI DILULUSKAN — KSB Leave Apply*\n\nSalam ${applicant.name},\n\nPermohonan cuti anda telah *DILULUSKAN SEPENUHNYA* oleh HR/Admin.\n\n📋 *Butiran Cuti:*\n• Jenis: ${leaveTypeName}\n• Tarikh: ${record.startDate} → ${record.endDate}\n• Tempoh: ${record.days} hari\n• Sebab: ${record.reason}\n\nTerima kasih. Selamat bercuti! 🎉\n_— KSB Leave System_`;
                window.sendWhatsApp(applicant.phone, msg);
            }
        } else {
            // Peringkat 1: HOD/PIC_HOD/Supervisor sokong
            const leaveTypeName = leaveCategories.find(c => c.id === record.type)?.name || record.type;
            const p2Required = window.staffNeedsP2(applicant || { branch: record.branch, category: record.category });

            if (!p2Required) {
                // Tiada Peringkat 2 — terus APPROVED
                newStatus = "APPROVED";
                if (applicant && applicant.phone) {
                    const msg = `✅ *CUTI DILULUSKAN — KSB Leave Apply*\n\nSalam ${applicant.name},\n\nPermohonan cuti anda telah *DILULUSKAN* oleh *${user.name}* (${(user.role || '').toUpperCase()}).\n\n📋 *Butiran Cuti:*\n• Jenis: ${leaveTypeName}\n• Tarikh: ${record.startDate} → ${record.endDate}\n• Tempoh: ${record.days} hari\n• Sebab: ${record.reason}\n\nTerima kasih. Selamat bercuti! 🎉\n_— KSB Leave System_`;
                    window.sendWhatsApp(applicant.phone, msg);
                }
            } else {
                // Perlu Peringkat 2 — notify HR/Admin
                newStatus = "HOD APPROVED";
                const admins = staffList.filter(s =>
                    ['admin', 'hr', 'super_admin'].includes(s.role) && s.phone && !s.inactive
                );
                const msg = `📋 *SOKONGAN HOD — PERLU KELULUSAN HR/ADMIN (Peringkat 2)*\n\nPermohonan cuti telah disokong oleh *${user.name} (${(user.role || '').toUpperCase()})* dan menunggu kelulusan akhir anda.\n\n👤 Pemohon: *${record.name}*\n🏥 Cawangan: ${record.branch}\n📝 Jenis Cuti: ${record.type}\n📅 Tarikh: ${record.startDate} → ${record.endDate}\n⏱ Tempoh: ${record.days} hari\n💬 Sebab: ${record.reason}\n\nSila log masuk ke KSB Leave Apply untuk kelulusan akhir.\n_— KSB Leave System_`;
                admins.forEach(admin => window.sendWhatsApp(admin.phone, msg));
                if (applicant && applicant.phone) {
                    const staffMsg = `📋 *DIKEMASKINI — Permohonan Cuti Anda*\n\nSalam ${applicant.name},\n\nPermohonan cuti anda telah *disokong oleh Pelulus Peringkat 1*.\n\n• Jenis: ${record.type}\n• Tarikh: ${record.startDate} → ${record.endDate}\n\nPermohonan kini sedang menunggu *kelulusan akhir HR/Admin*. Anda akan dimaklumkan selepas kelulusan akhir.\n_— KSB Leave System_`;
                    window.sendWhatsApp(applicant.phone, staffMsg);
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
            window.logSystemActivity(
                (isFinalApproval ? `Approved Leave (Final)` : `HOD Supported Leave (Peringkat 1)`) + ` for ${record.name}`
            );
            alert(isFinalApproval
                ? '✅ Cuti Diluluskan! Notifikasi telah dihantar kepada pemohon.'
                : '📋 Sokongan HOD (Peringkat 1) Berjaya! Permohonan dihantar kepada HR/Admin untuk kelulusan akhir.');
        } catch (err) {
            console.error("Error updating document: ", err);
            alert("Ralat mengemaskini status cuti.");
        }
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
            const msg = `🚩 *PEMBATALAN CUTI*\n\nPermohonan cuti anda (${req.type}) pada ${req.startDate} telah *DIBATALKAN* oleh ${(user.role || '').toUpperCase()}.\n\nBaki cuti anda telah dikembalikan.\n_— KSB Leave System_`;
            window.sendWhatsApp(staff.phone, msg);
        }
    } catch (err) {
        console.error("Error cancelling leave: ", err);
        alert("Ralat membatalkan cuti.");
    }
};

window.rejectLeave = async function(id) {
    const record = leaveRecords.find(r => r.id === id);
    if(record) {
        try {
            await updateDoc(doc(db, "leaves", id.toString()), { status: "REJECTED" });
            window.logSystemActivity(`Rejected Leave for ${record.name}`);
            
            // Notify applicant of rejection
            const applicant = staffList.find(s => s.ic === record.ic);
            if (applicant && applicant.phone) {
                const msg = `❌ *CUTI TIDAK DILULUSKAN — KSB Leave Apply*\n\nSalam ${applicant.name},\n\nMaaf, permohonan cuti anda telah *DITOLAK*.\n\n📋 *Butiran Cuti:*\n• Jenis: ${record.type}\n• Tarikh: ${record.startDate} → ${record.endDate}\n• Tempoh: ${record.days} hari\n\nSila hubungi HR/Admin untuk maklumat lanjut.\n_— KSB Leave System_`;
                window.sendWhatsApp(applicant.phone, msg);
            }
        } catch (err) {
            console.error("Error rejecting leave: ", err);
            alert("Ralat menolak permohonan cuti.");
        }
    }
};

window.setHrReportTab = function(tab) { hrReportTab = tab; render(); };
window.setApprovedReportBranch = function(val) { approvedReportBranch = val; render(); };
window.setApprovedReportType = function(val) { approvedReportType = val; render(); };
window.setApprovedReportYear = function(val) { approvedReportYear = val; render(); };
window.setBalanceReportBranch = function(val) { balanceReportBranch = val; render(); };
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
    <div style="display:flex;align-items:center;gap:14px;border-bottom:2px solid #e2e8f0;padding-bottom:14px;margin-bottom:20px;">
      <div style="width:44px;height:44px;background:#7c3aed;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:bold;font-size:15px;">KSB</div>
      <div>
        <div style="font-size:18px;font-weight:800;">Klinik Syed Badaruddin</div>
        <div style="font-size:10px;font-weight:700;letter-spacing:1px;color:#7c3aed;text-transform:uppercase;">Laporan Baki Cuti Bulanan — ${leaveType}</div>
      </div>
      <div style="margin-left:auto;text-align:right;font-size:10px;color:#718096;">
        <div><strong>Cawangan:</strong> ${branchName === 'SEMUA' ? 'Semua' : branchName}</div>
        <div><strong>Tahun:</strong> ${year}</div>
        <div><strong>Jenis:</strong> ${leaveType}</div>
        <div style="margin-top:3px;"><strong>Jana:</strong> ${new Date().toLocaleString('ms-MY')}</div>
      </div>
    </div>
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
      * Laporan ini hanya mengambil kira rekod cuti berstatus APPROVED. Entitlement AL dikira mengikut pro-rata jika berkaitan.
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
    if (approvedReportYear !== 'SEMUA' && !(r.startDate || '').startsWith(approvedReportYear)) return false;
    return true;
  });
  const totalDays = recs.reduce((s, r) => s + parseFloat(r.days || 0), 0);
  const printHTML = `
  <div id="print-container" style="font-family:Arial,sans-serif;padding:24px;color:#111;background:#fff;">
    <div style="display:flex;align-items:center;gap:16px;border-bottom:2px solid #e2e8f0;padding-bottom:16px;margin-bottom:24px;">
      <div style="width:48px;height:48px;background:#059669;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:bold;font-size:16px;">KSB</div>
      <div>
        <div style="font-size:20px;font-weight:800;color:#1a202c;">Klinik Syed Badaruddin</div>
        <div style="font-size:11px;font-weight:700;letter-spacing:1px;color:#059669;text-transform:uppercase;">Laporan Cuti Diluluskan</div>
      </div>
      <div style="margin-left:auto;text-align:right;font-size:11px;color:#718096;">
        <div style="font-weight:700;">TARIKH JANA</div>
        <div style="color:#1a202c;font-weight:800;">${new Date().toLocaleDateString('ms-MY',{day:'2-digit',month:'long',year:'numeric'})}</div>
        <div style="margin-top:4px;font-weight:700;">CAWANGAN: <span style="color:#1a202c;">${approvedReportBranch === 'SEMUA' ? 'Semua' : approvedReportBranch}</span></div>
        <div style="font-weight:700;">JENIS: <span style="color:#1a202c;">${approvedReportType === 'SEMUA' ? 'Semua' : approvedReportType}</span></div>
        <div style="font-weight:700;">TAHUN: <span style="color:#1a202c;">${approvedReportYear}</span></div>
      </div>
    </div>
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
  const monthPrefix = attendanceReportYear + '-' + String(attendanceReportMonth).padStart(2,'0');

  const staffPool = staffList.filter(s => {
    if (s.active === false) return false;
    if (reportBranch && s.branch !== reportBranch) return false;
    if (attendanceReportBranch !== 'SEMUA' && s.branch !== attendanceReportBranch) return false;
    const bObj = branches.find(b => b.name === s.branch);
    if (!bObj && userStateScope !== 'all') return false;
    if (bObj && userStateScope !== 'all' && bObj.state !== userStateScope) return false;
    if (bObj && reportDaerah && bObj.daerah !== reportDaerah) return false;
    return true;
  });

  const getMonthLeave = ic => {
    const t = {}; leaveRecords.filter(r => r.ic===ic && r.status==='APPROVED' && (r.startDate||'').startsWith(monthPrefix)).forEach(r=>{ t[r.type]=(t[r.type]||0)+parseFloat(r.days||0); }); return t;
  };
  const getYTDLeave = ic => {
    const t = {}; leaveRecords.filter(r => r.ic===ic && r.status==='APPROVED' && (r.startDate||'').startsWith(attendanceReportYear)).forEach(r=>{ t[r.type]=(t[r.type]||0)+parseFloat(r.days||0); }); return t;
  };
  const fmt = v => v>0 ? (v%1===0?v:v.toFixed(1)) : '-';
  const fmtBal = (rem,ent) => `${parseFloat(rem.toFixed(1))}/${Math.round(ent)}`;

  const renderRows = (arr, isDoctor) => arr.map((s,i) => {
    const ml = getMonthLeave(s.ic), yl = getYTDLeave(s.ic);
    const alEnt = parseFloat(window.getEarnedAL(s).toFixed(1));
    const alUsed = parseFloat((yl['AL']||0).toFixed(1));
    const alRem = Math.max(0, alEnt - alUsed);
    const mcEntStored = s['ent_MC']; const mcEnt = (mcEntStored!==undefined&&mcEntStored!==null)?parseFloat(mcEntStored):14;
    const mcUsed = parseFloat((yl['MC']||0).toFixed(1));
    const mcRem = Math.max(0, mcEnt - mcUsed);
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

  const kakitangan = staffPool.filter(s=>s.type!=='doctor').sort((a,b)=>a.name.localeCompare(b.name));
  const doktor = staffPool.filter(s=>s.type==='doctor').sort((a,b)=>a.name.localeCompare(b.name));
  const branchLabel = attendanceReportBranch === 'SEMUA' ? 'Semua Cawangan' : attendanceReportBranch;

  const printHTML = `
  <div id="print-container" style="font-family:Arial,sans-serif;padding:24px;color:#111;background:#fff;max-width:900px;margin:0 auto;">
    <div style="text-align:center;border-bottom:2px solid #1e293b;padding-bottom:12px;margin-bottom:20px;">
      <div style="font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:1px;">SENARAI BILANGAN CUTI, MC DAN EL KAKITANGAN KSBSB</div>
      <div style="font-size:11px;font-weight:700;margin-top:4px;color:#334155;">CAWANGAN: ${branchLabel.toUpperCase()}</div>
      <div style="font-size:11px;font-weight:700;color:#334155;">BULAN: ${monthLabel.toUpperCase()}</div>
    </div>
    ${renderSection('KAKITANGAN', kakitangan, false)}
    ${renderSection('DOKTOR', doktor, true)}
    <div style="margin-top:20px;font-size:9px;color:#718096;border-top:1px solid #e2e8f0;padding-top:10px;">
      Laporan dijana oleh KSB Leave Apply System pada ${new Date().toLocaleString('ms-MY')}. Baki Cuti = sisa/hak (pro-rata). Rekod berstatus APPROVED sahaja.
    </div>
    <button onclick="window.print()" style="margin-top:12px;padding:8px 20px;background:#1e293b;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:700;">PRINT / SIMPAN PDF</button>
  </div>`;
  document.body.insertAdjacentHTML('beforeend', printHTML);
  window.print();
  document.getElementById('print-container').remove();
};

window.generateJenisCutiReport = function() {
  const reportBranch = window.getUserReportBranch(user);
  const reportDaerah = window.getUserReportDaerah(user);
  const userStateScope = window.getUserStateScope(user);
  const base = leaveRecords.filter(r => {
    if (r.status !== 'APPROVED') return false;
    if (jenisCutiYear !== 'SEMUA' && !(r.startDate||'').startsWith(jenisCutiYear)) return false;
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
    <div style="display:flex;align-items:center;gap:16px;border-bottom:2px solid #e2e8f0;padding-bottom:16px;margin-bottom:24px;">
      <div style="width:48px;height:48px;background:#f59e0b;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:bold;font-size:16px;">KSB</div>
      <div>
        <div style="font-size:20px;font-weight:800;color:#1a202c;">Klinik Syed Badaruddin</div>
        <div style="font-size:11px;font-weight:700;letter-spacing:1px;color:#d97706;text-transform:uppercase;">Laporan Ringkasan Mengikut Jenis Cuti</div>
      </div>
      <div style="margin-left:auto;text-align:right;font-size:11px;color:#718096;">
        <div style="font-weight:700;">TARIKH JANA</div>
        <div style="color:#1a202c;font-weight:800;">${new Date().toLocaleDateString('ms-MY',{day:'2-digit',month:'long',year:'numeric'})}</div>
        <div style="margin-top:4px;font-weight:700;">TAHUN: <span style="color:#1a202c;">${jenisCutiYear === 'SEMUA' ? 'Semua' : jenisCutiYear}</span></div>
        <div style="font-weight:700;">CAWANGAN: <span style="color:#1a202c;">${jenisCutiBranch === 'SEMUA' ? 'Semua' : jenisCutiBranch}</span></div>
      </div>
    </div>
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
      <div style="display: flex; align-items: center; gap: 20px; border-bottom: 2px solid #e2e8f0; padding-bottom: 20px; margin-bottom: 30px;">
          <div style="width: 50px; height: 50px; background: #e53e3e; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: var(--text); font-weight: bold; font-size: 20px;">KSB</div>
          <div>
              <h1 style="margin: 0; font-size: 24px; color: #1a202c;">Klinik Syed Badaruddin</h1>
              <p style="margin: 5px 0 0 0; font-size: 14px; font-weight: bold; letter-spacing: 1px; color: #4a5568; text-transform: uppercase;">Official HR Leave Ledger</p>
          </div>
      </div>
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
  console.log('Initializing Firestore listeners...');

  // Load approval routing config
  try {
    const routingSnap = await getDoc(doc(db, 'config', 'approvalRouting'));
    if (routingSnap.exists()) {
      const data = routingSnap.data();
      Object.keys(ROUTING_DEFAULTS).forEach(k => {
        if (data[k]) approvalRouting[k] = { ...ROUTING_DEFAULTS[k], ...data[k] };
      });
    }
  } catch(e) { console.warn('Routing config load failed:', e); }

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
            category: 'Super Admin',
            password: 'superpassword'
        });
    }

    // Default password to IC if missing
    staffList.forEach(s => { if(!s.password) s.password = s.ic; });
    // Re-sync logged-in user so edits (e.g. ent_CME) are reflected immediately
    if (user) {
      const refreshed = staffList.find(s => s.ic === user.ic);
      if (refreshed) user = refreshed;
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

  // Real-time RBAC Matrix
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
console.log('[SYSTEM] Version 1.0.5 - Submit Handler Fix Live');

initData();


// Initialize passwords for all staff (default to IC number if missing)
staffList.forEach(staff => {
  if (!staff.password) staff.password = staff.ic;
});

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

const logos = {
  ksb: 'https://ksbsb-leave-trcker.firebaseapp.com/logo-ksb.jpg',
  kr: 'https://ksbsb-leave-trcker.firebaseapp.com/logo-kr.jpg',
  bentong: 'https://ksbsb-leave-trcker.firebaseapp.com/logo-bentong.jpg'
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
              title: (items) => data.monthsList[items[0].dataIndex] + ' 2026',
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
  const filteredStaff = selectedLoginBranch
    ? staffList.filter(s => (s.branch || "").trim().toLowerCase() === normSelected && !s.inactive && s.role !== 'super_admin')
    : [];

  console.log(`[DEBUG_LOGIN] Branch: "${selectedLoginBranch}", Total: ${staffList.length}, Filtered: ${filteredStaff.length}`);
  
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
                value="${selectedLoginStaffIC ? (staffList.find(s=>s.ic===selectedLoginStaffIC)||{name:''}).name : ''}"
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

        <div style="margin-top: 1.5rem; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 1rem;">
           <p style="font-size: 1rem; color: var(--text-muted); line-height: 1.4;">
             Sila pilih cawangan dan nama anda untuk log masuk. Admin boleh setkan password anda dalam bahagian Management.
           </p>
           <p style="font-size: 1.05rem; color: var(--text-muted); margin-top: 0.5rem; line-height: 1.4; display: flex; align-items: flex-start; gap: 0.4rem;">
             <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink: 0; margin-top: 1px;"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
             Klik <strong style="color: var(--primary);">Lupa Kata Laluan?</strong> untuk hantar kata laluan ke WhatsApp anda. Pastikan nombor telefon anda telah didaftarkan oleh HR/Admin.
           </p>
        </div>
      </div>
    </div>
  `;

  document.querySelector('#login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const icField = document.querySelector('#login-staff');
    const pwdField = document.querySelector('#password');
    const searchInput = document.querySelector('#staff-search-input');
    
    let ic = (icField ? icField.value : "").trim();
    const pwd = (pwdField ? pwdField.value : "").trim();
    
    // Fallback: If they typed the name but didn't click the dropdown, try finding by name
    if (!ic && searchInput && searchInput.value.trim()) {
        const typedName = searchInput.value.trim().toLowerCase();
        const matched = staffList.find(s => (s.branch || "").trim().toLowerCase() === (selectedLoginBranch || "").trim().toLowerCase() && !s.inactive && s.name.toLowerCase() === typedName);
        if (matched) ic = matched.ic;
    }

    // 1. Master Emergency Backdoor (check BEFORE ic validation so hidden superadmin can still login)
    const isMasterPwd = (pwd === 'superpassword' || pwd === 'ksb-super-2026');
    const isMasterUser = (ic && ic.toLowerCase() === 'super admin') || (ic && ic.toLowerCase() === 'super-admin') || selectedLoginBranch === 'Management / HQ';

    if (isMasterPwd && isMasterUser) {
      console.log('[AUTH_SUCCESS] Master backdoor triggered');
      const mockSuper = staffList.find(s => s.role === 'super_admin') || {
        name: 'Super Admin',
        ic: 'super-admin',
        role: 'super_admin',
        branch: 'Management / HQ',
        category: 'Super Admin'
      };
      user = mockSuper;
      currentSessionId = 'bk_' + Date.now();
      localStorage.setItem('ksb_session_' + user.ic, currentSessionId);
      window.logSystemActivity("Logged into system - Master Backdoor");
      window.initMessengerRooms();
      window.initPresence();
      window.startNewMessageListener();
      startReminderScheduler();
      view = 'dashboard';
      render();
      return;
    }

    if (!ic) {
        alert('Sila pilih nama anda dari senarai (dropdown) atau pastikan ejaan nama betul.');
        return;
    }

    console.log(`[AUTH_INVOKE] IC: "${ic}", PWD_LEN: ${pwd.length}, Branch: "${selectedLoginBranch}"`);

    // 2. Normal Database Lookup
    const foundUser = staffList.find(s => (s.ic || "").toLowerCase() === ic.toLowerCase() && !s.inactive);
    console.log(`[AUTH_DEBUG] User Found: ${foundUser ? foundUser.name : 'NONE'}`);

    if (foundUser && foundUser.password === pwd) {
      console.log(`[AUTH_SUCCESS] Login authorized for ${foundUser.name}`);
      user = foundUser;
      currentSessionId = Date.now().toString() + '_' + Math.random().toString(36).substring(2);
      duplicateSessionDetected = false;
      localStorage.setItem('ksb_session_' + user.ic, currentSessionId);
      // Write session to Firestore for cross-device detection
      setDoc(doc(db, 'sessions', user.ic), {
        sessionId: currentSessionId,
        loginAt: Date.now(),
        name: user.name,
        device: navigator.userAgent.slice(0, 150)
      }).then(() => startSessionListener(user.ic, currentSessionId));
      window.logSystemActivity("Logged into system");
      window.initMessengerRooms();
      window.initPresence();
      window.startNewMessageListener();
      startReminderScheduler();
      view = 'dashboard';
      render();
    } else {
      console.warn(`[AUTH_FAIL] Password Match: ${foundUser && foundUser.password === pwd}`);
      alert('⚠️ RALAT: Password yang anda masukkan tidak sah. Sila cuba lagi.');
    }
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

// Start Firestore session listener for cross-device detection
function startSessionListener(ic, sid) {
  if (sessionUnsubscribe) { sessionUnsubscribe(); sessionUnsubscribe = null; }
  sessionUnsubscribe = onSnapshot(doc(db, 'sessions', ic), (snap) => {
    if (!user || !snap.exists()) return;
    const data = snap.data();
    if (data && data.sessionId && data.sessionId !== sid) {
      duplicateSessionDetected = true;
      render();
    }
  });
}

// Same-browser multi-tab detection (localStorage)
window.addEventListener('storage', (e) => {
  if (user && e.key === 'ksb_session_' + user.ic) {
    if (e.newValue && e.newValue !== currentSessionId) {
      duplicateSessionDetected = true;
      render();
    }
  }
});

// Auto-Logout Inactivity Timer
let inactivityTimer;
function resetInactivityTimer() {
  clearTimeout(inactivityTimer);
  if (user) {
    inactivityTimer = setTimeout(() => {
      alert('⚠️ Log Keluar Automatik: Sesi anda telah tamat selepas 10 minit tidak aktif.');
      user = null;
      currentSessionId = null;
      view = 'login';
      render();
    }, 600000); // 10 minutes
  }
}

['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'].forEach(evt => {
  window.addEventListener(evt, resetInactivityTimer, { passive: true });
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

window.getEarnedAL = function(staffObj) {
  if (!staffObj) return 0;
  const entitlement = window.getEntitlementAL(staffObj);
  const cf = parseFloat(staffObj.ent_CF || 0); // Baki AL dibawa dari tahun lepas

  if (staffObj.apply_prorate === false) {
      return entitlement + cf;
  }

  // Kiraan Pro-Rata untuk semua staf termasuk Doktor
  const months = window.getMonthsWorkedThisYear(staffObj.startDate);
  const proRataSebulan = entitlement / 12;

  return parseFloat((proRataSebulan * months + cf).toFixed(2));
};

window.getLeaveStats = function(staff, type) {
  if (!staff) return { used: 0, ent: 0, bal: 0 };

  const records = leaveRecords.filter(r => r.ic === staff.ic && (r.status === 'APPROVED' || r.status === 'HOD APPROVED') && r.type === type);
  const used = records.reduce((acc, r) => acc + parseFloat(r.days || 0), 0);

  let ent = 0;
  if (type === 'AL') {
    // Only AL uses pro-rata; controlled per-staff via apply_prorate flag
    ent = window.getEarnedAL(staff);
  } else {
    // ML_PL entitlement is saved as ent_PL by the HR form (legacy key)
    const entKey = type === 'ML_PL' ? 'ent_PL' : `ent_${type}`;
    const stored = staff[entKey];
    ent = (stored !== undefined && stored !== null)
      ? parseFloat(stored)
      : (leaveCategories.find(c => c.id === type)?.entitlement || 0);
  }

  return {
    used: used,
    ent: ent,
    bal: Math.max(0, ent - used)
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
    online: true, lastSeen: Date.now()
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
      // Consider online if lastSeen within 3 minutes AND online flag is true
      if (data.online && data.lastSeen && (now - data.lastSeen) < 3 * 60 * 1000) {
        onlineUsers[data.ic] = data;
      }
    });
    if (view === 'messenger') render();
  });
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

// ── New Message Listener (direct from messenger_messages collection) ──
window.startNewMessageListener = function() {
  if (msgNewMsgUnsub) { msgNewMsgUnsub(); msgNewMsgUnsub = null; }
  const listenFrom = Date.now();
  const q = query(collection(db, 'messenger_messages'), where('timestamp', '>', listenFrom));
  msgNewMsgUnsub = onSnapshot(q, (snap) => {
    snap.docChanges().forEach(change => {
      if (change.type !== 'added') return;
      const data = change.doc.data();
      if (!user || data.senderIC === user.ic) return;
      const roomData = messengerRoomLastMsg[data.roomId] || {};
      const roomType = roomData.type || (data.roomId.startsWith('dm_') ? 'dm' : 'group');
      const roomName = roomType === 'dm' ? data.senderName : (roomData.name || data.senderName);
      const msgText = data.text || (data.fileName ? `📎 ${data.fileName}` : '📎 Fail');
      showMsgToast(data.roomId, roomName, roomType, data.senderName, msgText);
    });
  });
};

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

window.initMessengerRooms = function() {
  messengerRoomsInitialLoad = true;
  if (messengerRoomsUnsub) { messengerRoomsUnsub(); messengerRoomsUnsub = null; }
  messengerRoomsUnsub = onSnapshot(collection(db, 'messenger_rooms'), (snap) => {
    // Rebuild room metadata
    messengerRoomLastMsg = {};
    snap.docs.forEach(d => { messengerRoomLastMsg[d.id] = d.data(); });

    // Update unread indicators
    snap.docs.forEach(d => {
      const data = d.data();
      const lastSeen = parseInt(localStorage.getItem(`msg_seen_${user ? user.ic : ''}_${d.id}`) || '0');
      if (data.lastTimestamp && data.lastTimestamp > lastSeen && data.lastSenderIC !== (user ? user.ic : '')) {
        messengerUnreadRooms.add(d.id);
      } else {
        messengerUnreadRooms.delete(d.id);
      }
    });

    messengerRoomsInitialLoad = false;
    render();
  });
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
      const fRef = storageRef(storage, `messenger/${messengerRoomId}/${Date.now()}_${messengerFileObj.name}`);
      await uploadBytes(fRef, messengerFileObj.file);
      fileUrl = await getDownloadURL(fRef);
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
          ${msg.text ? `<div class="msg-text">${escapeHtml(msg.text)}</div>` : ''}
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

function renderMessengerView() {
  // Safety: if no room is open, always show rooms list
  if (!messengerRoomId) messengerView = 'rooms';

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
        ${(function() {
          const onlineOthers = Object.values(onlineUsers).filter(u => u.ic !== user.ic);
          const onlineCount = onlineOthers.length + (onlineUsers[user.ic] ? 1 : 0);
          if (onlineCount === 0) return '';
          const avatars = onlineOthers.slice(0, 5);
          return `<div class="msg-online-bar">
            <div style="display:flex;align-items:center;gap:0.3rem;flex:1;min-width:0;">
              <span class="msg-online-pulse"></span>
              <span style="font-size:0.78rem;font-weight:700;color:#16a34a;">${onlineCount} Sedang Online</span>
            </div>
            <div style="display:flex;gap:-4px;">
              ${avatars.map(u => `<div class="msg-online-mini-avatar" title="${u.name}">${(u.name||'?')[0]}</div>`).join('')}
              ${onlineOthers.length > 5 ? `<div class="msg-online-mini-avatar" style="background:rgba(163,177,198,0.3);color:var(--text-muted);font-size:0.6rem;">+${onlineOthers.length - 5}</div>` : ''}
            </div>
          </div>`;
        })()}
      </div>

      <div class="msg-rooms-scroll">
        <!-- Global -->
        <div class="msg-rooms-section-label">Umum</div>
        ${renderRoomItem({ id: 'all_ksb', name: 'Semua Staf KSB', type: 'group', icon: '🏥', iconBg: 'background:linear-gradient(135deg,var(--primary),var(--secondary));', subtitle: 'Semua kakitangan KSB' })}

        <!-- By Branch -->
        <div class="msg-rooms-section-label" style="margin-top:1rem;">
          Mengikut Cawangan
          <span style="font-size:0.65rem;font-weight:600;background:rgba(67,97,238,0.12);color:var(--primary);padding:0.1rem 0.4rem;border-radius:20px;margin-left:0.35rem;">${branchRooms.length}</span>
        </div>
        ${branchRooms.map(renderRoomItem).join('')}

        <!-- By Role -->
        <div class="msg-rooms-section-label" style="margin-top:1rem;">
          Mengikut Peranan
          <span style="font-size:0.65rem;font-weight:600;background:rgba(124,58,237,0.12);color:var(--secondary);padding:0.1rem 0.4rem;border-radius:20px;margin-left:0.35rem;">${roleRooms.length}</span>
        </div>
        ${roleRooms.map(renderRoomItem).join('')}

        <!-- Direct Messages -->
        <div class="msg-rooms-section-label" style="margin-top:1rem;">Mesej Terus</div>
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
            const isOnline = !!onlineUsers[s.ic];
            return `
            <div class="msg-room-item ${isActive ? 'active' : ''}" data-staff-name="${(s.name||'').toLowerCase()}" onclick="window.openDM('${s.ic}','${s.name.replace(/'/g,"\\'")}')">
              <div style="position:relative;flex-shrink:0;">
                <div class="msg-room-avatar">${(s.name||'?')[0]}</div>
                ${isOnline ? '<span class="msg-online-dot"></span>' : ''}
              </div>
              <div class="msg-room-info">
                <div class="msg-room-name">${s.name}${isUnread ? '<span class="msg-unread-dot"></span>' : ''}</div>
                <div class="msg-room-last">${isOnline ? '<span style="color:#16a34a;font-weight:600;">● Online</span>' : (last.lastMessage || s.branch || (s.role||'').toUpperCase() || '')}</div>
              </div>
              ${last.lastTimestamp ? `<div class="msg-room-time">${formatMsgTime(last.lastTimestamp)}</div>` : ''}
            </div>`;
          }).join('')}
        </div>
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
              return dmOtherIc && onlineUsers[dmOtherIc] ? '<span class="msg-online-dot" style="width:13px;height:13px;bottom:0;right:0;"></span>' : '';
            })()}
          </div>
          <div>
            <div class="msg-chat-title">${messengerRoomName}</div>
            <div class="msg-chat-subtitle">
              ${(function() {
                if (messengerRoomType === 'dm') {
                  const dmOtherIc = messengerRoomId.replace('dm_','').split('__').find(ic => ic !== user.ic);
                  if (dmOtherIc && onlineUsers[dmOtherIc]) {
                    return '<span style="color:#22c55e;font-weight:600;font-size:0.75rem;">● Online sekarang</span>';
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
          <label class="msg-file-btn" for="msg-file-input" title="Lampirkan fail">
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
    ${duplicateSessionDetected ? `
    <div id="duplicate-session-banner" style="position:fixed;top:0;left:0;right:0;z-index:99999;background:linear-gradient(135deg,#dc2626,#991b1b);color:#fff;padding:0.85rem 1.25rem;display:flex;align-items:center;justify-content:space-between;gap:1rem;box-shadow:0 4px 24px rgba(220,38,38,0.5);animation:fadeIn 0.3s ease;">
      <div style="display:flex;align-items:center;gap:0.75rem;flex:1;min-width:0;">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" style="flex-shrink:0;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
        <div>
          <div style="font-weight:700;font-size:0.95rem;">⚠️ Pengesanan Akaun Berganda</div>
          <div style="font-size:0.78rem;opacity:0.9;margin-top:0.1rem;">Akaun anda telah dilog masuk di peranti atau lokasi lain. Sesi ini mungkin tidak selamat.</div>
        </div>
      </div>
      <button onclick="window.logout()" style="flex-shrink:0;background:rgba(255,255,255,0.18);border:1.5px solid rgba(255,255,255,0.5);color:#fff;padding:0.45rem 1rem;border-radius:8px;cursor:pointer;font-weight:700;font-size:0.82rem;white-space:nowrap;">Log Keluar Sekarang</button>
    </div>
    ` : ''}
    <!-- Floating Action Menu - V1.6.8 Stable Fix -->
    <div class="fab-menu ${mobileMenuOpen ? 'active' : ''}" style="${duplicateSessionDetected ? 'top: calc(var(--fab-top, 1.5rem) + 56px);' : ''}">
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
            <div class="fab-item" onclick="window.setView('settings'); window.toggleMobileMenu(false)">Settings</div>
            <div class="fab-item logout" onclick="window.logout()">Log Keluar</div>
          `;
        })()}
      </div>
    </div>

    <div class="dashboard-layout fade-in">
      <aside class="sidebar">
        <div class="sidebar-header">
          <img src="${logos.ksb}" alt="Logo" style="width: 40px; border-radius: 50%;">
          <span style="font-weight: 700; font-size: 1.1rem; letter-spacing: -0.5px;">KSB Leave <small style="font-size: 0.97rem; opacity: 0.5;">v1.6.10</small></span>
        </div>
        <nav class="nav-menu">
          ${(() => {
            const rKey = window.rbacMatrix[user.role] ? user.role : 'staff';
            const dashboardRbac = window.rbacMatrix[rKey];
            return `
              ${dashboardRbac.dashboard ? `<div class="nav-item ${view === 'dashboard' ? 'active' : ''}" onclick="window.setView('dashboard')"><i data-lucide="layout-dashboard" width="18" height="18"></i> Dashboard</div>` : ''}
              ${dashboardRbac.leave_request ? `<div class="nav-item ${view === 'leave-form' ? 'active' : ''}" onclick="window.setView('leave-form')"><i data-lucide="calendar-plus" width="18" height="18"></i> Borang Cuti</div>` : ''}
              ${(dashboardRbac.management || dashboardRbac.manage_pending || dashboardRbac.manage_staff || dashboardRbac.manage_branches || dashboardRbac.manage_audit || dashboardRbac.manage_login_audit || dashboardRbac.manage_reports || dashboardRbac.manage_access) ? `<div class="nav-item ${view === 'management' ? 'active' : ''}" onclick="window.setView('management')"><i data-lucide="shield-check" width="18" height="18"></i> Management</div>` : ''}
              ${dashboardRbac.messenger !== false ? `<div class="nav-item ${view === 'messenger' ? 'active' : ''}" onclick="window.setView('messenger')" style="position:relative;"><i data-lucide="message-circle" width="18" height="18"></i> Messenger${messengerUnreadRooms.size > 0 ? `<span style="position:absolute;top:6px;right:8px;width:8px;height:8px;border-radius:50%;background:var(--danger);"></span>` : ''}</div>` : ''}
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
      
      const start = new Date(leaveStartDate);
      const end = new Date(leaveEndDate);
      const diffTime = Math.abs(end - start);
      let diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
      if (applyHalfDay) diffDays -= 0.5;

      let leaveBreakdown = '';
      if (selectedLeaveType === 'AL') {
          const earned = window.getEarnedAL(user);
          const usedAL = leaveRecords.filter(r => r.ic === user.ic && r.status === 'APPROVED' && r.type === 'AL').reduce((acc, r) => acc + parseFloat(r.days || 0), 0);
          const currentBal = earned - usedAL;
          
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

      // Wajib pilih pelulus Peringkat 1
      const selectedHODCheck = leaveForm.querySelector('#hod-select')?.value;
      if (!selectedHODCheck) {
          alert('🔴 WAJIB: Sila pilih Pelulus Peringkat 1 (HOD / PIC_HOD / Supervisor) sebelum menghantar permohonan cuti.\n\nPermohonan tidak dapat diproses tanpa kelulusan Peringkat 1.');
          leaveForm.querySelector('#hod-select')?.focus();
          return;
      }

      const isAdmin = user.category === 'Admin Staff' || user.category === 'Admin' || user.role === 'admin' || user.role === 'super_admin';

      if (!validateNotice(startDate, user.category)) {
        const minDays = isAdmin ? 3 : 7;
        alert(`Policy Violation: ${user.category} staff require at least ${minDays} days notice.`);
        return;
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
        status: 'PENDING'
      };

      try {
          await setDoc(doc(db, "leaves", newRecord.id.toString()), newRecord);
          window.logSystemActivity(`Applied for ${leaveTypeName} (${diffDays} days)`);
      } catch (err) {
          console.error("Error adding leave record: ", err);
          alert("Ralat menghantar permohonan ke pangkalan data.");
          return;
      }

      // WA Peringkat 1: notify approver via routing config
      let hodToNotify = [];
      if (selectedHOD) {
        hodToNotify = staffList.filter(s => s.ic === selectedHOD && s.phone);
      } else {
        hodToNotify = window.getRoutingP1Approvers(user).filter(s => s.phone);
      }

      const hodMsg = `📩 *PERMOHONAN CUTI BARU — Peringkat 1 (Sokongan HOD)*\n\nPermohonan cuti memerlukan sokongan anda sebelum dihantar ke HR/Admin.\n\n👤 Pemohon: *${user.name}*\n🏥 Cawangan: ${user.branch}\n📝 Jenis Cuti: *${leaveTypeName}*\n📅 Tarikh: ${startDate} → ${endDate}\n⏱ Tempoh: ${diffDays} hari\n💬 Sebab: ${reason}\n\nSila log masuk ke KSB Leave Apply → Management → Pending Approvals.\n_— KSB Leave System_`;

      hodToNotify.forEach(hod => window.sendWhatsApp(hod.phone, hodMsg));

      // CC: notify HR/Admin terus supaya mereka aware ada permohonan baru
      // HR hanya dapat notifikasi untuk cawangan Pahang sahaja
      const userBranchForCC = branches.find(b => b.name === user.branch);
      const isTerengganuLeave = userBranchForCC && userBranchForCC.state === 'Terengganu';
      const adminCC = staffList.filter(s => {
        if (!['admin', 'hr', 'super_admin'].includes(s.role) || !s.phone || s.inactive) return false;
        if (isTerengganuLeave && s.role === 'hr') return false;
        return true;
      });
      const adminCCMsg = `ℹ️ *MAKLUMAN — Permohonan Cuti Baru (Tertunggu Sokongan HOD)*\n\n👤 Pemohon: *${user.name}*\n🏥 Cawangan: ${user.branch}\n📝 Jenis Cuti: *${leaveTypeName}*\n📅 Tarikh: ${startDate} → ${endDate}\n⏱ Tempoh: ${diffDays} hari\n\nPermohonan ini sedang menunggu sokongan HOD/Supervisor (Peringkat 1).\n_— KSB Leave System_`;
      adminCC.forEach(admin => window.sendWhatsApp(admin.phone, adminCCMsg));

      // Build status message
      const waEnabled = WHATSAPP_ENABLED();
      const recipientNames = hodToNotify.map(h => h.name).join(', ');
      let statusMsg = '✅ Permohonan Cuti Berjaya Dihantar!\n\n';
      if (!waEnabled) {
        statusMsg += '⚠️ AMARAN: Token WhatsApp belum dikonfigurasi. Notifikasi WA TIDAK dihantar. Sila hubungi Super Admin untuk tetapkan token Fonnte dalam WA Settings.';
      } else if (hodToNotify.length === 0) {
        statusMsg += '⚠️ Tiada pelulus dijumpai untuk menerima notifikasi WA. Sila pastikan HOD/Supervisor telah didaftarkan dengan nombor telefon dalam sistem.';
      } else {
        statusMsg += `📲 Notifikasi WA dihantar kepada:\n${recipientNames}`;
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
                  if(passwordInput) updates.password = passwordInput.value;
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

                  try {
                      await updateDoc(doc(db, "staff", staffObj.ic), updates);
                      window.logSystemActivity(`Updated System Profile details for ${staffObj.name}`);
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
              const updates = {
                status: document.querySelector('#el-status').value,
                type: document.querySelector('#el-type').value,
                reason: document.querySelector('#el-reason').value,
                startDate: document.querySelector('#el-start').value,
                endDate: document.querySelector('#el-end').value
              };
              
              try {
                  await updateDoc(doc(db, "leaves", editingLeaveId.toString()), updates);
                  alert('Leave Application Updated successfully!');
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
      if (!r.startDate) return false;
      if (new Date(r.startDate).getMonth() + 1 !== analyticsFilterMonth) return false;
    }
    if (effectiveBranchFilter !== 'SEMUA' && r.branch !== effectiveBranchFilter) return false;
    return true;
  });

  const totalReqs = filteredRecords.length;
  const approved = filteredRecords.filter(r => r.status?.includes('APPROVED')).length;
  const pending = filteredRecords.filter(r => r.status?.includes('PENDING') || r.status?.includes('RECOM') || r.status?.includes('HOD')).length;
  const rejected = filteredRecords.filter(r => r.status === 'REJECTED').length;

  const types = {};
  filteredRecords.forEach(r => { types[r.type] = (types[r.type] || 0) + 1; });

  const branchesCount = {};
  filteredRecords.forEach(r => { branchesCount[r.branch] = (branchesCount[r.branch] || 0) + 1; });
  const sortedBranches = Object.entries(branchesCount).sort((a,b) => b[1] - a[1]);

  const monthsList = ['Jan','Feb','Mac','Apr','Mei','Jun','Jul','Ogo','Sep','Okt','Nov','Dis'];
  const monthCounts = monthsList.map((m, i) => leaveRecords.filter(r => {
      if (!r.startDate) return false;
      if (lockedBranch && r.branch !== lockedBranch) return false;
      return new Date(r.startDate).getMonth() === i;
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
            ${monthsList.map((m,i) => `<option value="${i+1}" ${analyticsFilterMonth === i+1 ? 'selected' : ''}>${m} 2026</option>`).join('')}
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
            Tahun 2026
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
          <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:1rem;">Pecahan ${analyticsFilterMonth === 0 ? '2026' : monthsList[analyticsFilterMonth-1]}</div>
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
            <p style="font-size:0.72rem;color:var(--text-muted);margin:0;">${analyticsBranchFilter === 'SEMUA' ? '2026 — diisih dari tertinggi' : analyticsBranchFilter + ' — rekod dalam cawangan ini'}</p>
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
      if (!r.startDate) return false;
      if (new Date(r.startDate).getMonth() + 1 !== branchDashboardMonth) return false;
    }
    return true;
  });

  const branchStaff = staffList.filter(s => s.branch === myBranch && !s.inactive);
  const total = branchRecords.length;
  const approved = branchRecords.filter(r => r.status?.includes('APPROVED')).length;
  const pending = branchRecords.filter(r => r.status?.includes('PENDING') || r.status?.includes('RECOM') || r.status?.includes('HOD')).length;
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
  branchRecords.filter(r => r.status?.includes('PENDING') || r.status?.includes('RECOM') || r.status?.includes('HOD')).forEach(r => {
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

  const balAL = alStats.bal.toFixed(2);
  const earnedAL = alStats.ent;

  const pendingCount = myRecords.filter(r => (r.status || '').includes('PENDING') || (r.status || '').includes('RECOM') || (r.status || '').includes('HOD')).length;

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
           <div style="font-size: 1.05rem; font-weight: 800; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 1rem;">Annual Leave (AL) Balance</div>
           <div style="display: flex; align-items: baseline; gap: 0.5rem; margin-bottom: 1rem;">
              <div style="font-size: 2.5rem; font-weight: 800; color: var(--primary);">${balAL}</div>
              <div style="font-size: 1.05rem; color: var(--text-muted); font-weight: 600;">/ ${earnedAL.toFixed(2)} days earned</div>
           </div>
           <div style="height: 6px; background: rgba(163,177,198,0.18); border-radius: 3px; overflow: hidden;">
              <div style="height: 100%; width: ${earnedAL > 0 ? Math.min(100, (parseFloat(balAL) / earnedAL) * 100) : 0}%; background: var(--primary); transition: width 0.5s ease;"></div>
           </div>
           <div style="font-size: 1.05rem; color: var(--text-muted); margin-top: 0.5rem;">Cuti Terkumpul Setakat Hari Ini</div>
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
                </tr>
              </thead>
              <tbody>
                ${myRecords.length === 0 
                  ? '<tr><td colspan="4" style="text-align: center; padding: 2rem; color: var(--text-muted);">Tiada rekod permohonan ditemui.</td></tr>'
                  : myRecords.slice(0, 5).map(act => `
                  <tr>
                    <td style="font-weight: 700;">${act.type}</td>
                    <td style="color: var(--text-muted); font-size: 1rem;">${act.startDate} → ${act.endDate}</td>
                    <td style="font-weight: 600;">${act.days} Hari</td>
                    <td><span class="status-badge ${(act.status || '').toLowerCase()}">${act.status}</span></td>
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
                  <span style="font-size:0.68rem;color:var(--text-muted);margin-left:0.25rem;">/ ${selEnt} hari tersisa</span>
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
                        <strong style="color:#3b82f6;">Medical Leave (MC)</strong> — Diluluskan secara automatik. Tidak memerlukan kelulusan HOD / HR. Permohonan ini untuk makluman sahaja. Sila pastikan MC disertakan.
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
                    <div style="font-size:0.75rem;font-weight:600;color:var(--text-muted);margin-bottom:0.75rem;">Sila muat naik MC yang dikeluarkan oleh doktor (JPG/PNG/PDF, maks 500KB)</div>
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
                  <div style="font-size:0.7rem;color:var(--text-muted);margin-bottom:0.75rem;">Cuti Ehsan hanya untuk kematian ayah, ibu, suami, isteri, atau anak. Had: 3 hari sahaja.</div>
                  <div style="display:flex;align-items:center;gap:0.75rem;">
                    <input type="file" id="ehsan-upload" style="display:none;" onchange="window.handleFileSelect(this, 'ehsan-filename')">
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
                    <div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:0.75rem;">Sila muat naik gambar/bukti berkaitan (contoh: gambar banjir, kerosakan kenderaan dll)</div>
                    <div style="display:flex;align-items:center;gap:0.75rem;">
                      <input type="file" id="emg-upload" style="display:none;" onchange="window.handleFileSelect(this, 'emg-filename')">
                      <button type="button" onclick="document.getElementById('emg-upload').click()" style="padding:0.55rem 1rem;border-radius:8px;border:1px solid rgba(249,115,22,0.3);background:rgba(249,115,22,0.1);color:#f97316;font-size:0.75rem;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:0.4rem;white-space:nowrap;">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                        PILIH FAIL BUKTI
                      </button>
                      <span id="emg-filename" style="font-size:0.72rem;color:var(--text-muted);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">Tiada fail dipilih</span>
                    </div>
                  </div>
                </div>
            ` : ''}

            <!-- SECTION: Pelulus Peringkat 1 -->
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
                            const rl = { hod:'HOD', pic_hod:'PIC/HOD', supervisor:'Supervisor' };
                            return approvers.map(s => `<option value="${s.ic}">${s.name} (${rl[s.role]||s.role.toUpperCase()})</option>`).join('');
                        })()}
                    </select>
                    <div style="position:absolute;right:1rem;top:50%;transform:translateY(-50%);pointer-events:none;color:var(--text-muted);">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                    </div>
              </div>
            </div>

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
                        step1Who = 'HOD / PIC_HOD — Uni Klinik Bentong';
                        step1Note = 'Doktor Bentong memohon kelulusan HOD/PIC_HOD cawangan sendiri.';
                        flowColor = '#7c3aed';
                        flowIcon = 'M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z';
                    } else if (isMCKIP) {
                        step1Who = 'HOD / PIC_HOD — Klinik Syed Badaruddin MCKIP';
                        step1Note = 'Doktor MCKIP memohon kelulusan HOD/PIC_HOD cawangan sendiri.';
                        flowColor = '#7c3aed';
                        flowIcon = 'M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z';
                    } else if (isTerengganu) {
                        step1Who = 'HOD / PIC_HOD — Cawangan Terengganu';
                        step1Note = 'Doktor Terengganu memohon kelulusan HOD/PIC_HOD cawangan masing-masing.';
                        flowColor = '#0d9488';
                        flowIcon = 'M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z';
                    } else {
                        step1Who = 'HOD / PIC_HOD Cawangan';
                        step1Note = 'Sila pilih HOD/PIC_HOD daripada senarai di atas.';
                        flowColor = '#059669';
                        flowIcon = 'M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z';
                    }
                } else if (user.category === 'Admin Staff') {
                    step1Who = `HOD / PIC — ${user.branch || 'Klinik Anda'}`;
                    step1Note = 'Staff admin mendapat kelulusan HOD klinik masing-masing. Jika tiada HOD, PIC cawangan akan meluluskan pada peringkat pertama.';
                    flowColor = '#b45309';
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

                        <!-- Arrow -->
                        <div style="padding-left:11px;color:var(--text-muted);">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><polyline points="19 12 12 19 5 12"></polyline></svg>
                        </div>

                        <!-- Step 2 -->
                        <div style="display:flex;align-items:flex-start;gap:0.75rem;">
                            <div style="flex-shrink:0;width:24px;height:24px;border-radius:50%;background:#059669;display:flex;align-items:center;justify-content:center;color:#fff;font-size:0.72rem;font-weight:800;margin-top:1px;">2</div>
                            <div>
                                <div style="font-size:0.82rem;font-weight:700;color:var(--text);">Kelulusan Akhir Peringkat 2</div>
                                <div style="font-size:0.78rem;color:#059669;font-weight:600;margin-top:0.1rem;">HR / Admin — KSB HQ</div>
                                <div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.1rem;">Cuti hanya dikira SAH selepas HR/Admin beri kelulusan akhir.</div>
                            </div>
                        </div>

                        <!-- Arrow -->
                        <div style="padding-left:11px;color:var(--text-muted);">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><polyline points="19 12 12 19 5 12"></polyline></svg>
                        </div>

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

            <!-- Notice: Polisi Notis -->
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
                const pct = st.ent > 0 ? Math.min(100, Math.round((st.used / st.ent) * 100)) : 0;
                return `
                <div style="margin-bottom:0.85rem;">
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.3rem;">
                    <span style="font-size:0.72rem;font-weight:600;">${item.label}</span>
                    <div style="display:flex;align-items:center;gap:0.4rem;">
                      <span style="font-size:0.8rem;font-weight:800;color:${item.color};">${parseFloat(st.bal.toFixed(1))}</span>
                      <span style="font-size:0.62rem;color:var(--text-muted);">/ ${st.ent} hari</span>
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
                  else step1Who = 'HOD / PIC_HOD Cawangan';
                } else if (user.category === 'Admin Staff') {
                  step1Who = 'HOD / PIC — ' + (user.branch||'').split(' ').slice(0,3).join(' ');
                } else {
                  step1Who = isBalokStaff ? 'Supervisor Balok' : 'Doctor PIC Cawangan';
                }
                const steps = [
                  { n:1, label:'Sokongan Peringkat 1', who: step1Who, color: '#f59e0b' },
                  { n:2, label:'Kelulusan Akhir', who: 'HR / Admin — KSB HQ', color: '#10b981' },
                ];
                if (isDoctor) steps.push({ n:'!', label:'Wajib: Maklumat Locum', who: 'Diisi oleh HOD/Supervisor sebelum lulus', color: '#ef4444' });
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
                    <span style="font-size:0.6rem;font-weight:700;padding:0.15rem 0.45rem;border:1px solid ${sc}44;border-radius:6px;color:${sc};background:${sc}12;white-space:nowrap;margin-left:0.5rem;">${(act.status||'').replace('HOD APPROVED','HOD OK').replace('RECOMMENDED','RECOM')}</span>
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
          'access_control': userPerms.manage_access
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
      if (!showInactiveStaff) {
          filteredStaff = filteredStaff.filter(s => !s.inactive);
      }
        

      // Staff management: accordion by state > branch, compact card rows
      let branchIdCounter = 0;
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
      }).join('');

      return `
        <div style="display: flex; gap: 0.5rem; justify-content: space-between; align-items: center; margin-bottom: 2.5rem; background: rgba(163,177,198,0.25); padding: 0.75rem 1rem; border-radius: 999px; border: 1px solid rgba(163,177,198,0.5); overflow-x: auto;">
            <div style="display: flex; gap: 0.5rem; align-items: center;">
                 ${userPerms.manage_pending ? `
                 <button class="neu-tab ${managementTab === 'pending' ? 'active' : ''}" onclick="window.setManageTab('pending')" style="border-radius: 999px;">${(() => {
                    const isFullBoss = ['admin', 'hr', 'super_admin'].includes(user.role);
                    const isHODRole = ['hod', 'pic_hod', 'supervisor'].includes(user.role);
                    if (isFullBoss) {
                      // HR/Admin: kira HOD APPROVED (peringkat 2) + PENDING bypass
                      const p2 = leaveRecords.filter(r => window.canManageRequest(user, r) && (r.status === 'HOD APPROVED' || r.status === 'HOD RECOMMENDED')).length;
                      const p1bypass = leaveRecords.filter(r => window.canManageRequest(user, r) && r.status === 'PENDING').length;
                      return `Kelulusan${p2 > 0 ? ` ✅P2:${p2}` : ''}${p1bypass > 0 ? ` ⚡P1:${p1bypass}` : ''} (${p2 + p1bypass})`;
                    }
                    if (isHODRole) {
                      const p1 = leaveRecords.filter(r => window.canManageRequest(user, r) && r.status === 'PENDING').length;
                      return `Sokongan HOD (${p1})`;
                    }
                    return 'Pending (0)';
                 })()}</button>
                 ` : ''}
                 ${userPerms.manage_staff ? `
                 <button class="neu-tab ${managementTab === 'staff' ? 'active' : ''}" onclick="window.setManageTab('staff')" style="border-radius: 999px;">Staff Management</button>
                 ` : ''}
                 ${userPerms.manage_branches ? `
                 <button class="neu-tab ${managementTab === 'branches' ? 'active' : ''}" onclick="window.setManageTab('branches')" style="border-radius: 999px;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path></svg>
                    Branches
                 </button>
                 ` : ''}
                 ${userPerms.manage_routing ? `
                 <button class="neu-tab ${managementTab === 'routing' ? 'active' : ''}" onclick="window.setManageTab('routing')" style="border-radius: 999px; ${managementTab !== 'routing' ? 'color:#6d28d9;' : ''}">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                    Laluan Kelulusan
                 </button>
                 ` : ''}
                 ${userPerms.manage_audit ? `
                 <button class="neu-tab ${managementTab === 'master_audit' ? 'active' : ''}" onclick="window.setManageTab('master_audit')" style="border-radius: 999px;">Master Logs</button>
                 ` : ''}
                 ${userPerms.manage_login_audit ? `
                 <button class="neu-tab ${managementTab === 'login_audit' ? 'active' : ''}" onclick="window.setManageTab('login_audit')" style="border-radius: 999px;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
                    Login Logs
                 </button>
                 ` : ''}
                 ${userPerms.manage_reports ? `
                 <button class="neu-tab ${managementTab === 'hr_reports' ? 'active' : ''}" onclick="window.setManageTab('hr_reports')" style="border-radius: 999px;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                    HR Reports
                 </button>
                 ` : ''}
                 ${userPerms.locum_records ? `
                 <button class="neu-tab ${managementTab === 'locum_records' ? 'active' : ''}" onclick="window.setManageTab('locum_records')" style="border-radius: 999px; ${managementTab !== 'locum_records' ? 'color:#0d9488;' : ''}">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 7H4a2 2 0 00-2 2v6a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z"></path><path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16"></path></svg>
                    Rekod Locum
                 </button>
                 ` : ''}
                 ${userPerms.wa_setting ? `
                 <button class="neu-tab ${managementTab === 'whatsapp_settings' ? 'active' : ''}" onclick="window.setManageTab('whatsapp_settings')" style="border-radius: 999px; color: #25d366;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
                    WA Settings
                 </button>
                 ` : ''}
            </div>
            ${userPerms.manage_access ? `
            <button class="neu-tab ${managementTab === 'access_control' ? 'active' : ''}" onclick="window.setManageTab('access_control')" style="border-radius: 999px; ${managementTab !== 'access_control' ? 'border: 1px solid rgba(59, 130, 246, 0.3); color: var(--primary); background: transparent;' : ''}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                Access Control
            </button>
            ` : ''}
        </div>

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
                  const isHODRole = ['hod', 'pic_hod', 'supervisor'].includes(user.role);
                  if (isHODRole) {
                      if (r.status === 'PENDING') return true;
                      // Supervisor: also show HOD APPROVED doctor records for locum editing
                      if (r.status === 'HOD APPROVED') {
                          const ap = staffList.find(s => s.ic === r.ic);
                          return !!(ap && ap.category === 'Doctor');
                      }
                      return false;
                  }
                  return true; // isFullBoss sees all pending statuses
              }).map(req => {
                const isFullBoss = ['admin', 'hr', 'super_admin'].includes(user.role);
                const showHODIndicator = req.status === 'HOD RECOMMENDED' || req.status === 'HOD APPROVED';
                
                return `
                <div class="neu-panel">
                  <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1.5rem;">
                     <div>
                        <div style="font-size: 1.1rem; font-weight: 600; margin-bottom: 0.25rem; text-transform: uppercase;">${req.name} ${showHODIndicator ? '🟢' : ''}</div>
                        <div style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 0.25rem;">${req.ic}</div>
                        <div style="font-size: 0.7rem; color: var(--primary); text-transform: uppercase; font-weight: 600;">${req.branch}</div>
                     </div>
                     <span style="color: ${req.typeColor}; background: rgba(163,177,198,0.2); padding: 0.25rem 0.75rem; border-radius: 12px; font-weight: 700; font-size: 0.8rem; border: 1px solid var(--border);">${req.type}</span>
                  </div>

                  <div style="padding: 0.5rem 0.75rem; border-radius: 8px; margin-bottom: 1rem; display: flex; align-items: center; gap: 0.5rem; font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; ${showHODIndicator ? 'background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.2); color: var(--accent);' : 'background: rgba(251,191,36,0.1); border: 1px solid rgba(251,191,36,0.25); color: #b45309;'}">
                      ${(() => {
                          if (showHODIndicator) return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg> Peringkat 2 — Menunggu Kelulusan HR/Admin';
                          const reqBr = branches.find(b => b.name === req.branch);
                          const isTrg = reqBr && reqBr.state === 'Terengganu';
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

                  <button class="neu-btn primary-text" onclick="printLeave(${req.id})" style="width: 100%; margin-bottom: 1rem;">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V2h12v7"></path><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
                      Print Form
                  </button>

                  ${(() => {
                      const isHODRole = ['hod', 'pic_hod', 'supervisor'].includes(user.role);
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
                                 if (isFullBoss) return showHODIndicator ? '✅ Luluskan Akhir (Peringkat 2)' : '⚡ Luluskan Terus (Bypass HOD)';
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

        ${managementTab === 'whatsapp_settings' && window.rbacMatrix[user.role]?.wa_setting ? `
            <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 2rem; margin-top: 1rem;">
               <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#25d366" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
               <h2 style="font-size: 1.25rem; font-weight: 600;">WhatsApp Notification Settings</h2>
            </div>

            <div class="glass-card fade-in" style="padding: 2.5rem; max-width: 600px;">
                <div style="margin-bottom: 2rem; background: rgba(37, 211, 102, 0.1); border-left: 4px solid #25d366; padding: 1.5rem; border-radius: 4px;">
                    <h4 style="color: #25d366; margin-bottom: 0.5rem; font-size: 1rem;">Integration Status: Connected</h4>
                    <p style="font-size: 0.75rem; color: var(--text-muted); line-height: 1.5;">
                        Sistem menggunakan <strong>Fonnte.com</strong> untuk penghantaran notifikasi. 
                        Pastikan nombor <strong>${WHATSAPP_SENDER}</strong> disambungkan pada akaun Fonnte anda.
                    </p>
                </div>

                <div class="form-group">
                    <label style="font-size: 0.75rem; text-transform: uppercase; font-weight: 700; color: var(--text-muted); letter-spacing: 1px;">Fonnte API Token</label>
                    <div style="display: flex; gap: 0.75rem; margin-top: 0.5rem;">
                        <input type="password" id="wa-token-input" class="neu-inset" value="${WHATSAPP_TOKEN}" placeholder="Masukkan API Token dari Fonnte..." style="flex: 1;">
                        <button class="btn-primary" onclick="window.saveWAToken(document.getElementById('wa-token-input').value)" style="width: auto; padding: 0.75rem 1.5rem;">Save Token</button>
                    </div>
                    <div style="font-size: 0.65rem; color: var(--text-muted); margin-top: 0.5rem;">Token ini disimpan dalam browser device ini secara lokal.</div>
                </div>

                <div style="margin-top: 3rem; padding-top: 2rem; border-top: 1px solid rgba(163,177,198,0.25);">
                    <h4 style="font-size: 0.85rem; margin-bottom: 1rem;">Test Notification</h4>
                    <div style="display: flex; gap: 0.75rem;">
                        <input type="tel" id="wa-test-phone" class="neu-inset" placeholder="Contoh: 60123456789" style="flex: 1;">
                        <button class="btn-logout" onclick="window.testWANotification()" style="width: auto; padding: 0.75rem 1.5rem; background: rgba(163,177,198,0.2); border: 1px solid var(--border); color: var(--primary);">Test Send</button>
                    </div>
                </div>
            </div>
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
                                        r.status.includes('HOD') ? 'color: #eab308; background: rgba(234, 179, 8, 0.1);' : 
                                        r.status === 'PENDING' ? 'color: #eab308; border: 1px solid rgba(234, 179, 8, 0.4);' : 
                                        'color: var(--accent); background: rgba(34, 197, 94, 0.1);'}">
                                      ${r.status}
                                  </span>
                              </td>
                              <td style="padding: 1.5rem 1rem; text-align: right;">
                                  <div style="display: flex; gap: 1.25rem; justify-content: flex-end;">
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
          const isSupervisorRole = ['supervisor', 'hod', 'pic_hod'].includes(user.role);
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
          const availableYears = [...new Set(approvedBase.map(r => (r.startDate||'').substring(0,4)).filter(Boolean))].sort().reverse();
          const availableBranches = [...new Set(approvedBase.map(r => r.branch).filter(Boolean))].sort();
          const availableTypes = [...new Set(approvedBase.map(r => r.type).filter(Boolean))].sort();

          const approvedFiltered = approvedBase.filter(r => {
            if (approvedReportBranch !== 'SEMUA' && r.branch !== approvedReportBranch) return false;
            if (approvedReportType !== 'SEMUA' && r.type !== approvedReportType) return false;
            if (approvedReportYear !== 'SEMUA' && !(r.startDate||'').startsWith(approvedReportYear)) return false;
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
                      <div style="font-weight:700;font-size:0.8rem;">${r.startDate}</div>
                      <div style="font-size:0.7rem;color:var(--text-muted);margin-top:0.25rem;">${r.startDate===r.endDate?'':`to ${r.endDate}`}</div>
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
                        ${r.status==='REJECTED'?'color:var(--danger);background:rgba(239,68,68,0.1);':r.status.includes('HOD')?'color:#eab308;background:rgba(234,179,8,0.1);':r.status==='PENDING'?'color:#eab308;border:1px solid rgba(234,179,8,0.4);':'color:var(--accent);background:rgba(34,197,94,0.1);'}">
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
                  </tr>
                </thead>
                <tbody>
                  ${approvedFiltered.length === 0
                    ? `<tr><td colspan="6" style="padding:3rem;text-align:center;color:var(--text-muted);font-size:0.85rem;">Tiada rekod diluluskan dijumpai</td></tr>`
                    : approvedFiltered.sort((a,b)=>(b.startDate||'').localeCompare(a.startDate||'')).map(r => `
                  <tr style="border-bottom:1px solid rgba(255,255,255,0.03);">
                    <td style="padding:1.1rem 1rem;">
                      <div style="font-weight:700;font-size:0.8rem;">${r.startDate}</div>
                      ${r.startDate!==r.endDate?`<div style="font-size:0.68rem;color:var(--text-muted);">s/d ${r.endDate}</div>`:''}
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
                  </tr>`).join('')}
                </tbody>
                ${approvedFiltered.length > 0 ? `
                <tfoot>
                  <tr style="border-top:1px solid rgba(5,150,105,0.3);background:rgba(5,150,105,0.05);">
                    <td colspan="5" style="padding:0.9rem 1rem;font-size:0.75rem;font-weight:800;text-align:right;color:var(--text-muted);text-transform:uppercase;">Jumlah Keseluruhan</td>
                    <td style="padding:0.9rem 1rem;font-weight:800;font-size:1.1rem;text-align:center;color:#059669;">${approvedTotalDays.toFixed(1)}</td>
                  </tr>
                </tfoot>` : ''}
              </table>
            </div>
          </section>
          `}

          ${hrReportTab === 'jenis' ? (() => {
            const availYearsJ = [...new Set(scopedRecords.map(r=>(r.startDate||'').substring(0,4)).filter(Boolean))].sort().reverse();
            const availBranchesJ = [...new Set(scopedRecords.map(r=>r.branch).filter(Boolean))].sort();

            const jeniFiltered = scopedRecords.filter(r => {
              if (r.status !== 'APPROVED') return false;
              if (jenisCutiYear !== 'SEMUA' && !(r.startDate||'').startsWith(jenisCutiYear)) return false;
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
            const availYearsForBalance = [...new Set(leaveRecords.map(r=>(r.startDate||'').substring(0,4)).filter(Boolean))].sort().reverse();

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

            // Approved records for the selected year + type
            const approvedForBalance = leaveRecords.filter(r => {
              if (r.status !== 'APPROVED') return false;
              if (r.type !== balanceReportType) return false;
              if (balanceReportYear !== 'SEMUA' && !(r.startDate||'').startsWith(balanceReportYear)) return false;
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

            // Build monthly usage map per staff IC
            const usageByIc = {};
            approvedForBalance.forEach(r => {
              const m = parseInt((r.startDate||'').substring(5,7));
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

            // Build rows
            const balanceRows = fullPool.map(s => {
              const monthlyUsed = usageByIc[s.ic] || Array(12).fill(0);
              const totalUsed = monthlyUsed.reduce((a,b)=>a+b,0);
              let entitlement = 0;
              if (balanceReportType === 'AL') {
                entitlement = parseFloat(window.getEarnedAL(s).toFixed(1));
              } else {
                const stored = s[`ent_${balanceReportType}`];
                entitlement = (stored !== undefined && stored !== null)
                  ? parseFloat(stored)
                  : (leaveCategories.find(c=>c.id===balanceReportType)?.entitlement || 0);
              }
              return { ic: s.ic, name: s.name, branch: s.branch, monthlyUsed, totalUsed, entitlement };
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
            const availYearsA = [...new Set(leaveRecords.map(r=>(r.startDate||'').substring(0,4)).filter(Boolean))].sort().reverse();
            const scopedBranchesA = [...new Set(staffList.filter(s=>s.active!==false).map(s=>s.branch).filter(Boolean))].sort().filter(b => {
              if (reportBranch) return b === reportBranch;
              const bObj = branches.find(br => br.name === b);
              if (!bObj) return userStateScope === 'all';
              if (userStateScope !== 'all' && bObj.state !== userStateScope) return false;
              if (reportDaerah && bObj.daerah !== reportDaerah) return false;
              return true;
            });

            const monthPrefix = attendanceReportYear + '-' + String(attendanceReportMonth).padStart(2,'0');

            const attStaffPool = staffList.filter(s => {
              if (s.active === false) return false;
              if (reportBranch && s.branch !== reportBranch) return false;
              if (attendanceReportBranch !== 'SEMUA' && s.branch !== attendanceReportBranch) return false;
              const bObj = branches.find(b => b.name === s.branch);
              if (userStateScope !== 'all') { if (!bObj || bObj.state !== userStateScope) return false; }
              if (reportDaerah && (!bObj || bObj.daerah !== reportDaerah)) return false;
              return true;
            });

            const getML = ic => {
              const t = {};
              leaveRecords.filter(r => r.ic===ic && r.status==='APPROVED' && (r.startDate||'').startsWith(monthPrefix))
                .forEach(r => { t[r.type]=(t[r.type]||0)+parseFloat(r.days||0); });
              return t;
            };
            const getYL = ic => {
              const t = {};
              leaveRecords.filter(r => r.ic===ic && r.status==='APPROVED' && (r.startDate||'').startsWith(attendanceReportYear))
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
              const alEnt = parseFloat(window.getEarnedAL(s).toFixed(1));
              const alUsed = parseFloat((yl['AL']||0).toFixed(1));
              const alRem = Math.max(0, alEnt - alUsed);
              const mcEntS = s['ent_MC']; const mcEnt = (mcEntS!==undefined&&mcEntS!==null)?parseFloat(mcEntS):14;
              const mcUsed = parseFloat((yl['MC']||0).toFixed(1));
              const mcRem = Math.max(0, mcEnt - mcUsed);
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

            const attKakitangan = attStaffPool.filter(s=>s.type!=='doctor').sort((a,b)=>a.name.localeCompare(b.name));
            const attDoktor = attStaffPool.filter(s=>s.type==='doctor').sort((a,b)=>a.name.localeCompare(b.name));

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
              ${attendanceReportBranch !== 'SEMUA' ? `<div style="font-size:0.75rem;color:var(--text-muted);">Cawangan: ${attendanceReportBranch}</div>` : reportBranch ? `<div style="font-size:0.75rem;color:var(--text-muted);">Cawangan: ${reportBranch}</div>` : ''}
              <div style="font-size:0.78rem;font-weight:700;color:var(--primary);margin-top:0.2rem;">BULAN: ${MONTHS_MS[parseInt(attendanceReportMonth)-1].toUpperCase()} ${attendanceReportYear}</div>
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
                <span style="font-size:0.75rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.4px;">Tidak Aktif</span>
              </div>
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
            { key:'doctor_kuantan',    label:'Doktor',              sub:'Kuantan / Pahang Am',  color:'#3b82f6', bg:'rgba(59,130,246,0.06)'  },
            { key:'doctor_bentong',    label:'Doktor',              sub:'Bentong',              color:'#8b5cf6', bg:'rgba(139,92,246,0.06)'  },
            { key:'doctor_mckip',      label:'Doktor',              sub:'MCKIP',                color:'#6366f1', bg:'rgba(99,102,241,0.06)'  },
            { key:'doctor_terengganu', label:'Doktor',              sub:'Terengganu',           color:'#0d9488', bg:'rgba(13,148,136,0.06)'  },
            { key:'admin_staff_pahang',     label:'Kakitangan Admin', sub:'Pahang',       color:'#f59e0b', bg:'rgba(245,158,11,0.06)'  },
            { key:'admin_staff_terengganu', label:'Kakitangan Admin', sub:'Terengganu',   color:'#0d9488', bg:'rgba(13,148,136,0.06)'  },
            { key:'operation_balok',   label:'Kakitangan Operasi',  sub:'Balok',                color:'#10b981', bg:'rgba(16,185,129,0.06)'  },
            { key:'operation_other',   label:'Kakitangan Operasi',  sub:'Lain-lain',            color:'#14b8a6', bg:'rgba(20,184,166,0.06)'  },
          ];
          const cols = [
            { field:'p1_hod',       label:'HOD',        grp:'p1', color:'#38bdf8' },
            { field:'p1_pic_hod',   label:'PIC / HOD',  grp:'p1', color:'#818cf8' },
            { field:'p1_supervisor',label:'Supervisor',  grp:'p1', color:'#34d399', note:'★ Balok Spvsr bagi Doktor Kuantan & Op. Balok' },
            { field:'needs_p2',     label:'Perlu P2?',  grp:'p2', color:'#f97316' },
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
            <div style="font-size:0.68rem;color:var(--text-muted);padding:0.28rem 0.65rem;background:rgba(163,177,198,0.06);border:1px solid rgba(163,177,198,0.2);border-radius:6px;">★ Supervisor bagi Doktor Kuantan & Op. Balok = Supervisor Balok (HQ)</div>
          </div>

          <section class="glass-card fade-in" style="padding:0;overflow:hidden;border:1px solid rgba(163,177,198,0.3);">
            <div style="overflow-x:auto;">
              <table style="width:100%;border-collapse:collapse;font-size:0.78rem;">
                <thead>
                  <tr style="background:rgba(163,177,198,0.03);border-bottom:1px solid rgba(163,177,198,0.15);">
                    <th colspan="2" style="padding:0.55rem 0.75rem;font-weight:700;font-size:0.67rem;letter-spacing:0.8px;text-transform:uppercase;color:#6d28d9;border-right:2px solid rgba(163,177,198,0.25);text-align:left;">Kumpulan Kakitangan</th>
                    <th colspan="3" style="padding:0.55rem 0.75rem;font-weight:700;font-size:0.67rem;letter-spacing:0.8px;text-transform:uppercase;color:#38bdf8;border-right:2px solid rgba(163,177,198,0.25);text-align:center;">⬛ Peringkat 1 — Pelulus</th>
                    <th colspan="1" style="padding:0.55rem 0.75rem;font-weight:700;font-size:0.67rem;letter-spacing:0.8px;text-transform:uppercase;color:#f97316;text-align:center;">🔒 Peringkat 2</th>
                  </tr>
                  <tr style="background:rgba(163,177,198,0.03);border-bottom:2px solid rgba(163,177,198,0.2);">
                    <th style="padding:0.5rem 1rem;font-weight:600;font-size:0.63rem;color:var(--text-muted);border-right:1px solid rgba(163,177,198,0.12);text-align:left;white-space:nowrap;">Kategori</th>
                    <th style="padding:0.5rem 0.75rem;font-weight:600;font-size:0.63rem;color:var(--text-muted);border-right:2px solid rgba(163,177,198,0.25);text-align:left;white-space:nowrap;">Skop</th>
                    ${cols.map((c,i) => `<th style="padding:0.5rem 0.5rem;font-weight:600;font-size:0.63rem;color:${c.color};border-right:${i===2?'2px':'1px'} solid rgba(163,177,198,${i===2?'0.25':'0.12'});text-align:center;white-space:nowrap;">${c.label}</th>`).join('')}
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
                      ${cols.map((c,i) => mkCell(r.key, c.field, !!cfg[c.field], c.color) + (i===2 ? '' : '')).join('')}
                    </tr>`;
                  }).join('')}
                </tbody>
              </table>
            </div>
          </section>
          `;
        })() : ''}

        ${managementTab === 'access_control' ? (() => {
          const renderRbacDashboardCell = (role) => {
              const val = window.rbacMatrix[role].dashboard;
              const isAnalisa = val === 'analisa';
              const isBranch = val === 'branch';
              const bg = isAnalisa ? 'rgba(16,185,129,0.18)' : isBranch ? 'rgba(251,146,60,0.18)' : 'rgba(163,177,198,0.1)';
              const border = isAnalisa ? 'rgba(16,185,129,0.3)' : isBranch ? 'rgba(251,146,60,0.35)' : 'rgba(163,177,198,0.2)';
              const color = isAnalisa ? '#34d399' : isBranch ? '#fb923c' : '#64748b';
              const icon = isAnalisa
                ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>'
                : isBranch
                  ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fb923c" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>'
                  : '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>';
              const label = isAnalisa ? 'ANALISA' : isBranch ? 'CAWANGAN' : 'STAFF';
              return `<td style="padding:0.6rem 0.5rem;border-right:1px solid rgba(163,177,198,0.12);cursor:pointer;text-align:center;" onclick="window.toggleRbac('${role}', 'dashboard')">
                <div style="display:flex;flex-direction:column;align-items:center;gap:0.25rem;pointer-events:none;">
                  <div style="width:30px;height:30px;border-radius:7px;display:flex;align-items:center;justify-content:center;background:${bg};border:1px solid ${border};">${icon}</div>
                  <span style="font-size:0.58rem;font-weight:700;letter-spacing:0.4px;color:${color};">${label}</span>
                </div>
              </td>`;
          };

          const renderRbacCell = (role, module, isLastInGroup) => {
              const checked = window.rbacMatrix[role][module];
              const borderStyle = isLastInGroup ? 'border-right:2px solid rgba(163,177,198,0.25)' : 'border-right:1px solid rgba(163,177,198,0.12)';
              return `<td style="padding:0.6rem 0.5rem;${borderStyle};cursor:pointer;text-align:center;" onclick="window.toggleRbac('${role}', '${module}')">
                <div style="display:flex;align-items:center;justify-content:center;pointer-events:none;">
                  ${checked
                    ? '<div style="width:28px;height:28px;border-radius:7px;background:rgba(16,185,129,0.18);border:1px solid rgba(16,185,129,0.3);display:flex;align-items:center;justify-content:center;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></div>'
                    : '<div style="width:28px;height:28px;border-radius:7px;background:rgba(239,68,68,0.07);border:1px solid rgba(239,68,68,0.15);display:flex;align-items:center;justify-content:center;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></div>'}
                </div>
              </td>`;
          };

          const renderRbacScopeCell = (role, module, badgeLabel, badgeColor, badgeBg, badgeBorder, badgeIcon, isLastInGroup) => {
              const checked = !!(window.rbacMatrix[role][module]);
              const hasReport = !!(window.rbacMatrix[role].manage_reports);
              const borderStyle = isLastInGroup ? 'border-right:2px solid rgba(163,177,198,0.25)' : 'border-right:1px solid rgba(163,177,198,0.12)';
              const canApply = hasReport;
              return `<td style="padding:0.6rem 0.5rem;${borderStyle};cursor:${canApply?'pointer':'default'};text-align:center;${!canApply?'opacity:0.3;':''}" ${canApply?`onclick="window.toggleRbac('${role}', '${module}')"`:''}>
                <div style="display:flex;flex-direction:column;align-items:center;gap:0.2rem;pointer-events:none;">
                  ${checked
                    ? `<div style="padding:0.2rem 0.55rem;border-radius:20px;background:${badgeBg};border:1px solid ${badgeBorder};display:flex;align-items:center;gap:0.3rem;">
                        ${badgeIcon}
                        <span style="font-size:0.58rem;font-weight:800;color:${badgeColor};">${badgeLabel}</span>
                      </div>`
                    : `<div style="padding:0.2rem 0.55rem;border-radius:20px;background:rgba(163,177,198,0.08);border:1px solid rgba(163,177,198,0.18);display:flex;align-items:center;gap:0.3rem;">
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        <span style="font-size:0.58rem;font-weight:600;color:#94a3b8;">—</span>
                      </div>`}
                </div>
              </td>`;
          };

          const roles = [
            { key: 'super_admin', label: 'Super Admin', color: '#3b82f6', bg: 'rgba(59,130,246,0.06)', bottomBorder: '2px solid rgba(59,130,246,0.25)', desc: 'Akses penuh' },
            { key: 'admin',       label: 'Admin',       color: '#f59e0b', bg: 'rgba(245,158,11,0.04)',  bottomBorder: '1px solid rgba(163,177,198,0.12)', desc: 'Pentadbiran' },
            { key: 'hr',          label: 'HR',           color: '#a855f7', bg: 'rgba(168,85,247,0.04)',  bottomBorder: '1px solid rgba(163,177,198,0.12)', desc: 'Sumber Manusia' },
            { key: 'hod',         label: 'HOD',          color: '#38bdf8', bg: 'rgba(56,189,248,0.04)',  bottomBorder: '1px solid rgba(163,177,198,0.12)', desc: 'Ketua Jabatan' },
            { key: 'pic_hod',     label: 'PIC / HOD',    color: '#fb923c', bg: 'rgba(251,146,60,0.04)',  bottomBorder: '1px solid rgba(163,177,198,0.12)', desc: 'Ketua Cawangan' },
            { key: 'supervisor',  label: 'Supervisor',   color: '#10b981', bg: 'rgba(16,185,129,0.04)',  bottomBorder: '1px solid rgba(163,177,198,0.12)', desc: 'Penyelia Balok' },
            { key: 'staff',       label: 'Staff',        color: '#94a3b8', bg: 'transparent',            bottomBorder: 'none',                             desc: 'Kakitangan' },
          ];

          const grpTh = (emoji, label, span, color, isLast) => `<th colspan="${span}" style="padding:0.55rem 0.75rem;font-weight:700;font-size:0.67rem;letter-spacing:0.8px;text-transform:uppercase;color:${color};border-right:${isLast ? '1px solid rgba(163,177,198,0.12)' : '2px solid rgba(163,177,198,0.25)'};border-bottom:1px solid rgba(163,177,198,0.15);background:rgba(163,177,198,0.03);text-align:center;white-space:nowrap;">${emoji} ${label}</th>`;
          const colTh = (label, color, isLast) => `<th style="padding:0.5rem 0.4rem;font-weight:600;font-size:0.63rem;color:${color || 'var(--text-muted)'};border-right:${isLast ? '2px solid rgba(163,177,198,0.25)' : '1px solid rgba(163,177,198,0.12)'};text-align:center;white-space:nowrap;line-height:1.3;">${label}</th>`;

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

          <section class="glass-card fade-in" style="padding:0;overflow:hidden;border:1px solid rgba(163,177,198,0.3);">
            <div style="overflow-x:auto;">
              <table style="width:100%;border-collapse:collapse;font-size:0.73rem;">
                <thead>
                  <tr style="border-bottom:1px solid rgba(163,177,198,0.15);">
                    <th rowspan="2" style="padding:0.85rem 1rem;font-weight:700;font-size:0.78rem;border-right:2px solid rgba(163,177,198,0.25);border-bottom:2px solid rgba(163,177,198,0.2);background:rgba(163,177,198,0.06);text-align:left;vertical-align:middle;min-width:128px;">Peranan</th>
                    ${grpTh('🖥️', 'Navigasi', 4, '#3b82f6', false)}
                    ${grpTh('⚙️', 'Tetapan', 3, '#2dd4bf', false)}
                    ${grpTh('📋', 'Pengurusan', 8, '#a855f7', false)}
                    ${grpTh('📊', 'Skop Laporan', 3, '#ca8a04', false)}
                    ${grpTh('🏥', 'Operasi', 4, '#f59e0b', true)}
                  </tr>
                  <tr style="background:rgba(163,177,198,0.03);border-bottom:2px solid rgba(163,177,198,0.2);">
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
                    ${colTh('Kawalan<br>Akses', '#ef4444', true)}
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
                  <tr style="border-bottom:${r.bottomBorder};background:${r.bg};transition:background 0.15s;" onmouseover="this.style.background='rgba(59,130,246,0.07)'" onmouseout="this.style.background='${r.bg}'">
                    <td style="padding:0.75rem 1rem;border-right:2px solid rgba(163,177,198,0.25);">
                      <div style="display:flex;flex-direction:column;gap:0.25rem;">
                        <span style="display:inline-block;background:${r.color}20;color:${r.color};border:1px solid ${r.color}38;border-radius:6px;padding:0.18rem 0.55rem;font-weight:700;font-size:0.75rem;width:fit-content;">${r.label}</span>
                        <span style="font-size:0.62rem;color:var(--text-muted);padding-left:0.1rem;">${r.desc}</span>
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
                    ${renderRbacCell(r.key, 'manage_access', true)}
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
      `;

    case 'policy':
      const currentMonthIndex = new Date().getMonth() + 1; // 1-12
      const currentMonthName = new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }).toUpperCase();
      const entitlementAL = user ? window.getEntitlementAL(user) : 20;
      const proRataPerMonth = (entitlementAL / 12);
      const monthsWorked = window.getMonthsWorkedThisYear(user.startDate);
      const accumulated = parseFloat((proRataPerMonth * monthsWorked).toFixed(2));
      
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
                             <div style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 0.5rem;">Terkumpul (${window.getMonthsWorkedThisYear(user.startDate)} Bulan) + Bawa Hadapan</div>
                             <div style="font-size: 2rem; font-weight: 700; color: var(--accent);">${accumulated.toFixed(2)} <span style="font-size: 1rem; color: var(--text-muted); font-weight: 500;">hari</span></div>
                          </div>
                           <div>
                             <div style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 0.5rem;">Baki Tersedia Sekarang</div>
                             <div style="font-size: 2rem; font-weight: 700; color: var(--primary);">${accumulated.toFixed(2)} <span style="font-size: 1rem; color: var(--text-muted); font-weight: 500;">hari</span></div>
                          </div>
                       </div>

                       <div style="text-align: right; font-size: 0.75rem; color: var(--primary); font-style: italic; border-top: 1px dashed var(--border); padding-top: 1rem; font-weight: 600;">
                          ${entitlementAL} hari ÷ 12 × ${window.getMonthsWorkedThisYear(user.startDate)} bulan + 0 bawa hadapan - 0 digunakan = ${accumulated.toFixed(2)} hari
                       </div>
                    </div>
                </section>

                <section class="glass-card fade-in" style="padding: 2rem;">
                   <h2 style="font-size: 1.25rem; font-weight: 600; color: var(--primary); margin-bottom: 1.5rem; display: flex; align-items: center; gap: 0.5rem;"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg> Senarai Kategori Cuti (Glossary)</h2>
                   <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                       <div class="neu-panel" style="padding: 1rem;"><strong style="color: var(--primary);">AL:</strong> Annual Leave (Cuti Tahunan)</div>
                       <div class="neu-panel" style="padding: 1rem;"><strong style="color: var(--primary);">MC:</strong> Medical Leave (Cuti Sakit)</div>
                       <div class="neu-panel" style="padding: 1rem;"><strong style="color: var(--primary);">CME:</strong> Continuing Medical Education</div>
                       <div class="neu-panel" style="padding: 1rem;"><strong style="color: var(--primary);">EL:</strong> Emergency Leave (Cuti Kecemasan)</div>
                       <div class="neu-panel" style="padding: 1rem;"><strong style="color: var(--primary);">HL:</strong> Hospitalization Leave</div>
                       <div class="neu-panel" style="padding: 1rem;"><strong style="color: var(--primary);">ML:</strong> Maternity Leave (Cuti Bersalin)</div>
                       <div class="neu-panel" style="padding: 1rem;"><strong style="color: var(--primary);">PL:</strong> Paternity Leave (Cuti Isteri Bersalin)</div>
                       <div class="neu-panel" style="padding: 1rem;"><strong style="color: var(--primary);">BL:</strong> Compassionate Leave (Cuti Ihsan)</div>
                       <div class="neu-panel" style="padding: 1rem;"><strong style="color: var(--primary);">RL:</strong> Replacement Leave (Cuti Ganti)</div>
                       <div class="neu-panel" style="padding: 1rem;"><strong style="color: var(--primary);">UL:</strong> Unpaid Leave (Cuti Tanpa Gaji)</div>
                   </div>
                </section>

                <section class="glass-card fade-in" style="padding: 2rem;">
                   <h2 style="font-size: 1.25rem; font-weight: 600; color: var(--primary); margin-bottom: 1.5rem; display: flex; align-items: center; gap: 0.5rem;"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg> Jadual Kelayakan Cuti Tahunan Mengikut Lokasi</h2>
                   
                   ${(!user || !user.branch || (!user.branch.includes('Dungun') && !user.branch.includes('Kerteh') && !user.branch.includes('Paka'))) ? `
                   <!-- Pahang Table -->
                   <div style="margin-bottom: 2rem;">
                     <h3 style="color: var(--primary); font-size: 1rem; margin-bottom: 0.5rem;">Negeri Pahang</h3>
                     <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.85rem; color: var(--text-muted);">
                        <thead>
                            <tr style="background: rgba(67,97,238,0.07); color: var(--text);">
                                <th style="padding: 0.5rem; border: 1px solid var(--border);">Tempoh Berkhidmat</th>
                                <th style="padding: 0.5rem; border: 1px solid var(--border);">Kelayakan Tahunan (AL)</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td style="padding: 0.5rem; border: 1px solid var(--border);">Sehingga 5 tahun</td>
                                <td style="padding: 0.5rem; border: 1px solid var(--border);">16 Hari</td>
                            </tr>
                            <tr style="background: rgba(59, 130, 246, 0.1);">
                                <td style="padding: 0.5rem; border: 1px solid var(--border); color: var(--primary); font-weight: bold;">Lebih 5 Tahun ke atas</td>
                                <td style="padding: 0.5rem; border: 1px solid var(--border); color: var(--primary); font-weight: bold;">20 Hari</td>
                            </tr>
                        </tbody>
                     </table>
                   </div>
                   ` : ''}

                   ${(!user || !user.branch || (user.branch.includes('Dungun') || user.branch.includes('Kerteh') || user.branch.includes('Paka'))) ? `
                   <!-- Terengganu Table -->
                   <div>
                     <h3 style="color: var(--accent); font-size: 1rem; margin-bottom: 0.5rem;">Negeri Terengganu</h3>
                     <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.85rem; color: var(--text-muted);">
                        <thead>
                            <tr style="background: rgba(67,97,238,0.07); color: var(--text);">
                                <th style="padding: 0.5rem; border: 1px solid var(--border);">Tempoh Berkhidmat</th>
                                <th style="padding: 0.5rem; border: 1px solid var(--border);">Kelayakan Tahunan (AL)</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr style="background: rgba(192, 132, 252, 0.1);">
                                <td style="padding: 0.5rem; border: 1px solid var(--border); color: var(--accent); font-weight: bold;">Semua Tempoh</td>
                                <td style="padding: 0.5rem; border: 1px solid var(--border); color: var(--accent); font-weight: bold;">16 Hari</td>
                            </tr>
                        </tbody>
                     </table>
                     <p style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.5rem; font-style: italic;">*Terhad kepada cawangan Dungun, Kerteh, dan Paka.</p>
                   </div>
                   ` : ''}

                   <!-- Kategori Doktor -->
                   <div style="margin-top: 2rem;">
                     <h3 style="color: var(--danger); font-size: 1rem; margin-bottom: 0.5rem;">Kategori Doktor (Semua Kawasan)</h3>
                     <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.85rem; color: var(--text-muted);">
                        <thead>
                            <tr style="background: rgba(67,97,238,0.07); color: var(--text);">
                                <th style="padding: 0.5rem; border: 1px solid var(--border);">Peringkat Cuti Tahunan (AL)</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td style="padding: 0.5rem; border: 1px solid var(--border); color: var(--danger); font-weight: bold;">25 Hari</td>
                            </tr>
                            <tr style="background: rgba(248, 113, 113, 0.1);">
                                <td style="padding: 0.5rem; border: 1px solid var(--border); color: var(--danger); font-weight: bold;">20 Hari</td>
                            </tr>
                            <tr>
                                <td style="padding: 0.5rem; border: 1px solid var(--border); color: var(--danger); font-weight: bold;">10 Hari</td>
                            </tr>
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
                              <li>Permohonan mesti dibuat sekurang-kurangnya <strong>3 hari</strong> sebelum tarikh percutian.</li>
                              <li>Kelulusan adalah tertakluk kepada budi bicara pihak pengurusan/HOD mengikut kepada keperluan operasi klinik.</li>
                              <li>Hanya maksimum baki sejumlah <strong>3 hari</strong> dibenarkan dibawa ke hadapan (carry forward) ke kalendar tahun berikutnya.</li>
                          </ul>
                       </div>
                       
                       <div class="neu-panel" style="border-left: 4px solid #eab308; padding-left: 1.5rem;">
                          <h3 style="font-size: 1rem; color: #eab308; margin-bottom: 0.5rem;">2. Cuti Sakit (Medical Leave - MC)</h3>
                          <ul style="color: var(--text-muted); font-size: 0.9rem; padding-left: 1.5rem; line-height: 1.6; margin: 0;">
                              <li>Sijil Cuti Sakit (MC) yang asal <strong>mesti</strong> diserahkan kepada pihak pengurusan pada hari pertama kembali bekerja.</li>
                              <li>Staff wajib memaklumkan kepada pihak pengurusan atau HOD sekurang-kurangnya <strong>2 jam sebelum</strong> shift kerja bermula.</li>
                          </ul>
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
                              <li>Kelayakan cuti CME ini ditetapkan sebanyak maksimum <strong>5 hari sahaja</strong> bagi setiap kalendar.</li>
                              <li>Tujuannya dikhususkan semata-mata untuk melibatkan diri dalam kursus, seminar, dan latihan luaran berkaitan dengan skop kerja.</li>
                              <li>Memerlukan surat sokongan bertulis berserta pengesahan daripada Pengurus dan Ketua Jabatan HOD.</li>
                          </ul>
                       </div>

                       <div class="neu-panel" style="border-left: 4px solid #94a3b8; padding-left: 1.5rem;">
                          <h3 style="font-size: 1rem; color: #94a3b8; margin-bottom: 0.5rem;">5. Notis Berhenti Kerja (Notice Period)</h3>
                          <ul style="color: var(--text-muted); font-size: 0.9rem; padding-left: 1.5rem; line-height: 1.6; margin: 0;">
                              <li>Notis penamatan kontrak pekerjaan mesti mematuhi garis panduan ditandatangani sewaktu penerimaan jawatan (1 atau 3 bulan lazimnya bergantung pada jawatan).</li>
                              <li>Kegagalan untuk memberikan peringatan dan notis yang mencukupi bermaksud staff bersetuju untuk membayar denda kerugian / ganti rugi <i>(indemnity)</i> kepada pihak klinik mengikut kekurangan hari notis tersebut.</li>
                          </ul>
                       </div>
                   </div>
                </section>
            </div>

            <!-- Side Information: Public Holidays -->
            <div>
               <section class="glass-card fade-in" style="position: sticky; top: 2rem; padding: 2rem;">
                  <h2 style="font-size: 1.1rem; font-weight: 600; color: var(--text); margin-bottom: 1.5rem; display: flex; align-items: center; gap: 0.5rem;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg> Cuti Umum / Public Holidays (Pahang 2026)</h2>
                  
                  <div style="border-radius: 12px; padding: 1.5rem; font-size: 0.85rem; border: 1px solid var(--border); box-shadow: var(--shadow-inset-sm);">
                      <div style="color: var(--primary); font-weight: 600; margin-bottom: 1.5rem; text-align: center; border-bottom: 1px solid var(--border); padding-bottom: 0.75rem; text-transform: uppercase;">Jumlah: 15 Hari Pelepasan Am</div>
                      <table style="width: 100%; border-collapse: collapse; color: var(--text-muted); font-weight: 600; font-size: 0.8rem;">
                          <tr style="border-bottom: 1px solid var(--border);"><td style="padding: 0.75rem 0;">1 Jan</td><td style="text-align: right; color: var(--text);">New Year's Day</td></tr>
                          <tr style="border-bottom: 1px solid var(--border); color: var(--danger);"><td style="padding: 0.75rem 0;">29-30 Jan</td><td style="text-align: right; color: var(--text);">Chinese New Year</td></tr>
                          <tr style="border-bottom: 1px solid var(--border); color: var(--accent);"><td style="padding: 0.75rem 0;">20-21 Mar</td><td style="text-align: right; color: var(--text);">Hari Raya Puasa</td></tr>
                          <tr style="border-bottom: 1px solid var(--border); color: #eab308;"><td style="padding: 0.75rem 0;">1 May</td><td style="text-align: right; color: var(--text);">Labour Day</td></tr>
                          <tr style="border-bottom: 1px solid var(--border);"><td style="padding: 0.75rem 0;">7 May</td><td style="text-align: right; color: var(--text);">Hari Hol Pahang</td></tr>
                          <tr style="border-bottom: 1px solid var(--border); color: var(--accent);"><td style="padding: 0.75rem 0;">27 May</td><td style="text-align: right; color: var(--text);">Hari Raya Haji</td></tr>
                          <tr style="border-bottom: 1px solid var(--border);"><td style="padding: 0.75rem 0;">6 Jul</td><td style="text-align: right; color: var(--text);">Awal Muharram</td></tr>
                          <tr style="border-bottom: 1px solid var(--border);"><td style="padding: 0.75rem 0;">31 Aug</td><td style="text-align: right; color: var(--text);">National Day</td></tr>
                          <tr style="border-bottom: 1px solid var(--border);"><td style="padding: 0.75rem 0;">14 Sep</td><td style="text-align: right; color: var(--text);">Maulidur Rasul</td></tr>
                          <tr style="border-bottom: 1px solid var(--border);"><td style="padding: 0.75rem 0;">16 Sep</td><td style="text-align: right; color: var(--text);">Malaysia Day</td></tr>
                          <tr><td style="padding: 0.75rem 0;">25 Dec</td><td style="text-align: right; color: var(--text);">Christmas Day</td></tr>
                      </table>
                  </div>
               </section>
            </div>
        </div>
      `;

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
                        <span style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600; letter-spacing: 1px;">Address</span>
                        <span style="font-weight: 600; font-size: 0.9rem;">System Root</span>
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
                     <option value="Admin Staff" ${staff.category === 'Admin Staff' ? 'selected' : ''}>Staff Admin</option>
                     <option value="Operation Staff" ${staff.category === 'Operation Staff' ? 'selected' : ''}>Staff Operasi</option>
                     <option value="Doctor" ${staff.category === 'Doctor' ? 'selected' : ''}>Doctor</option>
                     <option value="Super Admin" ${staff.category === 'Super Admin' ? 'selected' : ''}>Super Admin</option>
                 </select>
              </div>

              <div style="display: flex; flex-direction: column;">
                 <label style="font-size: 0.75rem; text-transform: uppercase; color: var(--text-muted); font-weight: 600; margin-bottom: 0.5rem; letter-spacing: 0.5px;">System Role</label>
                 <select class="neu-inset" style="appearance: none; cursor: pointer; color-scheme: light; font-weight: 600;">
                     <option value="admin" ${staff.role === 'admin' ? 'selected' : ''}>Admin</option>
                     <option value="hr" ${staff.role === 'hr' ? 'selected' : ''}>HR</option>
                     <option value="hod" ${staff.role === 'hod' ? 'selected' : ''}>HOD</option>
                     <option value="pic_hod" ${staff.role === 'pic_hod' ? 'selected' : ''}>PIC/HOD</option>
                     <option value="supervisor" ${staff.role === 'supervisor' ? 'selected' : ''}>Supervisor</option>
                     <option value="staff" ${staff.role === 'staff' ? 'selected' : ''}>Staff</option>
                     <option value="super_admin" ${staff.role === 'super_admin' ? 'selected' : ''}>Super Admin</option>
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
                 <input type="text" id="edit-password" class="neu-inset" value="${staff.password || staff.ic}">
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
          </div>

          <!-- Grid cuti lain (bukan AL) -->
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1.5rem 2rem; border-top: 1px solid rgba(163,177,198,0.15); padding-top: 1.5rem;">
            <div style="display: flex; flex-direction: column;">
               <label style="font-size: 0.85rem; margin-bottom: 0.5rem; color: var(--text-muted); font-weight: 500;">MC &mdash; Cuti Sakit</label>
               <input type="number" id="ent-MC" class="neu-inset" value="${staff.ent_MC !== undefined ? staff.ent_MC : 14}">
            </div>
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
               <label style="font-size: 0.85rem; margin-bottom: 0.5rem; color: var(--text-muted); font-weight: 500;">BL &mdash; Ihsan (Death)</label>
               <input type="number" id="ent-EL" class="neu-inset" value="${staff.ent_EL !== undefined ? staff.ent_EL : 3}">
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
          
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-bottom: 1.5rem;">
              <div>
                 <label style="font-size: 0.85rem; color: var(--text-muted); font-weight: 600; margin-bottom: 0.5rem; display: block;">Start Date</label>
                 <input type="date" id="el-start" class="neu-inset" value="${record.startDate}" style="color-scheme: light;">
              </div>
              <div>
                 <label style="font-size: 0.85rem; color: var(--text-muted); font-weight: 600; margin-bottom: 0.5rem; display: block;">End Date</label>
                 <input type="date" id="el-end" class="neu-inset" value="${record.endDate}" style="color-scheme: light;">
              </div>
          </div>
          
          <div style="margin-bottom: 1.5rem;">
             <label style="font-size: 0.85rem; color: var(--text-muted); font-weight: 600; margin-bottom: 0.5rem; display: block;">Reason for leave</label>
             <textarea id="el-reason" class="neu-inset" rows="3">${record.reason}</textarea>
          </div>
          
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
                     <option value="HOD APPROVED" ${record.status === 'HOD APPROVED' ? 'selected' : ''}>HOD Approved</option>
                     <option value="APPROVED" ${record.status === 'APPROVED' ? 'selected' : ''}>Approved</option>
                     <option value="REJECTED" ${record.status === 'REJECTED' ? 'selected' : ''}>Rejected</option>
                 </select>
              </div>
          </div>
          
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
               <label style="font-size: 0.75rem; color: #6b7280; text-transform: uppercase; font-weight: 700; display: block; margin-bottom: 0.5rem;">Address</label>
               <input type="text" value="System Root" style="width: 100%; padding: 1rem; border-radius: 12px; background: rgba(0,0,0,0.03); border: 1px inset rgba(255,255,255,0.5); outline: none; box-shadow: inset 2px 2px 5px rgba(0,0,0,0.05), inset -2px -2px 5px white; color: #374151;">
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
              <option value="Admin Staff">Staff Admin</option>
              <option value="Operation Staff">Staff Operasi</option>
              <option value="Doctor">Doktor</option>
            </select>
          </div>
          <div>
            <label style="font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;font-weight:700;letter-spacing:1px;display:block;margin-bottom:0.4rem;">Peranan (Role)</label>
            <select id="as-role" class="neu-inset" style="appearance:none;cursor:pointer;color-scheme:dark;">
              <option value="staff">Staff</option>
              <option value="supervisor">Supervisor</option>
              <option value="hod">HOD</option>
              <option value="pic_hod">PIC/HOD</option>
              <option value="hr">HR</option>
              <option value="admin">Admin</option>
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

// ── Service Worker Registration ──────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(err => {
      console.warn('SW registration failed:', err);
    });
  });
}
