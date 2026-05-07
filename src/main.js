import './style.css'
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { 
  getFirestore, 
  collection, 
  onSnapshot, 
  doc, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where 
} from "firebase/firestore";

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

const app = document.querySelector('#app')

// ============================================================
// WHATSAPP NOTIFICATION CONFIG (Fonnte.com)
// Daftar di: https://fonnte.com → sambungkan no. 0129444295
// ============================================================
let WHATSAPP_TOKEN = localStorage.getItem('ksb_wa_token') || '';
const WHATSAPP_SENDER = '60129444295'; // No. penghantar
const WHATSAPP_ENABLED = () => !!WHATSAPP_TOKEN;

window.sendWhatsApp = async function(toPhone, message) {
  if (!WHATSAPP_ENABLED() || !toPhone) return;
  // Normalize phone: remove leading 0, add country code 60
  let phone = toPhone.replace(/\D/g, '');
  if (phone.startsWith('0')) phone = '6' + phone;
  try {
    await fetch('https://api.fonnte.com/send', {
      method: 'POST',
      headers: {
        'Authorization': WHATSAPP_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ target: phone, message, countryCode: '60' })
    });
  } catch(err) {
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
    await window.sendWhatsApp(staff.phone, msg);
    alert(`✅ Kata laluan telah dihantar ke nombor WhatsApp anda.\n\nSila semak mesej WhatsApp anda.`);
  } catch (err) {
    alert('Ralat menghantar mesej WhatsApp. Sila hubungi HR/Admin terus.');
  }
};

window.testWANotification = async function() {
  const phone = document.getElementById('wa-test-phone')?.value;
  if (!phone) return alert('Sila masukkan nombor telefon untuk ujian.');
  if (!WHATSAPP_TOKEN) return alert('Sila simpan token Fonnte dahulu.');
  await window.sendWhatsApp(phone, `✅ *Ujian Notifikasi KSB Leave Apply*\n\nSistem notifikasi WhatsApp berfungsi dengan baik.\n\n_— KSB Leave System_`);
  alert('Mesej ujian telah dihantar ke ' + phone);
};


// State
let user = null;
let currentSessionId = null;
let view = 'login'; // 'login', 'dashboard', 'management', 'leave-form', 'policy', 'settings'
window.setView = function(v) {
  if (v === 'leave-form') {
      const today = new Date().toISOString().split('T')[0];
      leaveStartDate = today;
      leaveEndDate = today;
      selectedLeaveType = 'AL';
      applyHalfDay = false;
  }
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
let manageSearchQuery = '';
let showInactiveStaff = false;
let editingLeaveId = null;
let dashboardTab = null; // 'personal' or 'analytics'
let showProfileSettings = false;
let selectedLeaveType = 'AL';
let analyticsFilterMonth = 0; // 0 = All Months, 1-12 = specific month
let analyticsCatFilter = 'SEMUA'; // 'SEMUA', 'Doktor', 'Admin Staff', 'Operation Staff'
let selectedLoginBranch = '';
let selectedLoginStaffIC = '';
let leaveStartDate = '';
let leaveEndDate = '';
let applyHalfDay = false;
const leaveCategories = [
    { id: 'AL', name: 'Annual Leave (AL)', entitlement: 14, icon: 'icon-al', color: '#3b82f6', description: 'Cuti Tahunan mengikut pro-rata bulan bekerja.' },
    { id: 'MC', name: 'Medical Leave (MC)', entitlement: 14, icon: 'icon-mc', color: '#10b981', description: 'Cuti Sakit dengan Sijil Sakit (MC) yang sah.' },
    { id: 'EL', name: 'Emergency/Compassionate (EL)', entitlement: 3, icon: 'icon-el', color: '#f59e0b', description: 'Cuti Kecemasan atau Ehsan (Kematian keluarga terdekat).' },
    { id: 'EL_EMG', name: 'Emergency (Non-Ehsan)', entitlement: 0, icon: 'icon-emg', color: '#ef4444', description: 'Cuti Kecemasan Am (Bukan Kematian).' },
    { id: 'UP', name: 'Unpaid Leave (UL)', entitlement: 0, icon: 'icon-ul', color: '#94a3b8', description: 'Cuti Tanpa Gaji (Setelah baki AL habis digunakan).' },
    { id: 'HL', name: 'Hospitalization (HL)', entitlement: 60, icon: 'icon-hl', color: '#06b6d4', description: 'Cuti Wad/Hospitalisasi (Maksimum 60 hari).' },
    { id: 'ML', name: 'Maternity/Paternity', entitlement: 98, icon: 'icon-ml', color: '#ec4899', description: 'Cuti Bersalin (98 hari) atau Paterniti (7 hari).' },
    { id: 'CME', name: 'CME Leave', entitlement: 5, icon: 'icon-cme', color: '#8b5cf6', description: 'Cuti Pendidikan Perubatan Berterusan (Doktor sahaja).' },
    { id: 'UP_MC', name: 'Unpaid MC', entitlement: 0, icon: 'icon-upmc', color: '#64748b', description: 'Cuti Sakit Tanpa Gaji (Bagi tempoh MC melebihi kelayakan).' },
    { id: 'NPL', name: 'No-Pay Leave (NPL)', entitlement: 0, icon: 'icon-npl', color: '#475569', description: 'Cuti Tanpa Gaji Panjang / Khas.' },
    { id: 'REPLACEMENT', name: 'Replacement Leave', entitlement: 0, icon: 'icon-rep', color: '#14b8a6', description: 'Cuti Gantian (Gantian hari bekerja off-day/public holiday).' }
];

window.rbacMatrix = {
    super_admin: { 
        dashboard: 'analisa', leave_request: true, management: true, policy: true, settings: true, wa_setting: true, 
        manage_pending: true, manage_staff: true, manage_branches: true, manage_audit: true, manage_login_audit: true, manage_reports: true, manage_access: true,
        can_cancel: true, os_balok: true, os_pahang: true
    },
    admin: { 
        dashboard: 'analisa', leave_request: true, management: true, policy: true, settings: true, wa_setting: false, 
        manage_pending: true, manage_staff: true, manage_branches: true, manage_audit: true, manage_login_audit: true, manage_reports: true, manage_access: true,
        can_cancel: true, os_balok: true, os_pahang: true
    },
    hr: { 
        dashboard: 'staff', leave_request: true, management: true, policy: true, settings: true, wa_setting: false, 
        manage_pending: true, manage_staff: true, manage_branches: true, manage_audit: true, manage_login_audit: false, manage_reports: false, manage_access: false,
        can_cancel: true, os_balok: true, os_pahang: true
    },
    hod: { 
        dashboard: 'staff', leave_request: true, management: false, policy: true, settings: true, wa_setting: false, 
        manage_pending: true, manage_staff: false, manage_branches: false, manage_audit: false, manage_login_audit: false, manage_reports: false, manage_access: false,
        can_cancel: true, os_balok: true, os_pahang: true
    },
    pic_hod: { 
        dashboard: 'staff', leave_request: true, management: false, policy: true, settings: true, wa_setting: false, 
        manage_pending: true, manage_staff: false, manage_branches: false, manage_audit: false, manage_login_audit: false, manage_reports: false, manage_access: false,
        can_cancel: true, os_balok: true, os_pahang: true
    },
    supervisor: { 
        dashboard: 'staff', leave_request: true, management: false, policy: true, settings: true, wa_setting: false, 
        manage_pending: true, manage_staff: false, manage_branches: false, manage_audit: false, manage_login_audit: false, manage_reports: false, manage_access: false,
        can_cancel: true, os_balok: true, os_pahang: true
    },
    staff: { 
        dashboard: 'staff', leave_request: true, management: false, policy: true, settings: true, wa_setting: false, 
        manage_pending: false, manage_staff: false, manage_branches: false, manage_audit: false, manage_login_audit: false, manage_reports: false, manage_access: false,
        can_cancel: false, os_balok: false, os_pahang: false
    }
};

window.toggleRbac = function(role, module) {
    if (module === 'dashboard') {
        window.rbacMatrix[role].dashboard = (window.rbacMatrix[role].dashboard === 'analisa') ? 'staff' : 'analisa';
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

window.setDashboardTab = function(tab) {
  dashboardTab = tab;
  render();
};

window.canManageRequest = function(user, req) {
    if (!user || !req) return false;
    const rKey = window.rbacMatrix[user.role] ? user.role : 'staff';
    const finalRbac = window.rbacMatrix[rKey];
    const isFullBoss = finalRbac.manage_pending === true;
    if (isFullBoss) return true;

    const isManagement = ['hod', 'pic_hod', 'supervisor'].includes(user.role);
    if (!isManagement) return false;

    const userBranchObj = branches.find(b => b.name === user.branch);
    const isPahang = userBranchObj && userBranchObj.state === 'Pahang';
    const isBalok = user.branch.includes('Balok');
    const isBentong = user.branch.includes('Bentong');
    
    // 1. Staff in BALOK Branch (Configurable)
    if (finalRbac.os_balok && isBalok && req.branch.includes('Balok')) return true;
    
    // 2. Doctors in PAHANG (Configurable, except Bentong)
    const staff = staffList.find(s => s.ic === req.ic);
    if (finalRbac.os_pahang && isPahang && !isBentong && staff && staff.category === 'Doctor' && req.branch === user.branch) return true;

    // 3. Default Branch Oversight (Pending/Recommended)
    if (req.branch === user.branch) {
        return ['PENDING', 'HOD RECOMMENDED', 'HOD APPROVED'].includes(req.status);
    }

    return false;
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
    // Debounced or immediate state update for rendering
    render(); 
  }
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
                <button onclick="window.print()" style="padding: 10px 20px; background: #3b82f6; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">PRINT FORM</button>
            </div>
            <div class="header">
                <img src="${logos.ksb}" class="logo" alt="KSB Logo">
                <h1 class="title">BORANG PELANTIKAN DOKTOR LOCUM</h1>
                <p class="subtitle">KLINIK SYED BADARUDDIN GROUP</p>
            </div>
            <div class="content">
                <div class="row"><div class="label">Doktor Bercuti:</div><div class="value">${r.name.toUpperCase()}</div></div>
                <div class="row"><div class="label">Cawangan:</div><div class="value">${r.branch}</div></div>
                <div class="row"><div class="label">Tempoh Cuti:</div><div class="value">${r.startDate} hingga ${r.endDate} (${r.days} Hari)</div></div>
                <div style="height: 30px;"></div>
                <div style="background: #f9f9f9; padding: 20px; border-radius: 8px; border: 1px solid #ddd;">
                    <h3 style="margin-top: 0; color: #3b82f6;">MAKLUMAT DOKTOR PENGGANTI (LOCUM)</h3>
                    <div class="row"><div class="label">Nama Locum:</div><div class="value"><strong>${(r.locumName || 'TIADA').toUpperCase()}</strong></div></div>
                    <div class="row"><div class="label">Tarikh Bertugas:</div><div class="value">${r.locumDate || '-'}</div></div>
                    <div class="row"><div class="label">Masa Bertugas:</div><div class="value">${r.locumTime || '-'}</div></div>
                </div>
                <div style="margin-top: 40px; font-size: 13px; color: #666;">
                    * Borang ini dijana secara automatik oleh KSB Leave Apply System pada ${new Date().toLocaleString()}.
                </div>
            </div>
            <div class="footer">
                <div class="sign-box">Disediakan Oleh (S/V)</div>
                <div class="sign-box">Disahkan Oleh (HR/Admin)</div>
            </div>
        </body>
        </html>
    `;
    printWindow.document.write(html);
    printWindow.document.close();
};

window.setProfileSettings = function(state) {
  showProfileSettings = state;
  render();
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

window.toggleInactive = function() {
  showInactiveStaff = !showInactiveStaff;
  render();
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
            if (!record.locumName || !record.locumDate || !record.locumTime) {
                alert("🔴 PERHATIAN: Sila lengkapkan maklumat Doktor Locum (Nama, Tarikh, & Masa) sebelum meluluskan permohonan ini.");
                return;
            }
        }

        const isFullBoss = ['admin', 'hr', 'super_admin'].includes(user.role);
        let newStatus = "";
        
        if (isFullBoss) {
            newStatus = "APPROVED";
            const leaveTypeName = leaveCategories.find(c => c.id === record.type)?.name || record.type;
            if (applicant && applicant.phone) {
                const msg = `✅ *CUTI DILULUSKAN — KSB Leave Apply*\n\nSalam ${applicant.name},\n\nPermohonan cuti anda telah *DILULUSKAN* oleh HR/Admin.\n\n📋 *Butiran Cuti:*\n• Jenis: ${leaveTypeName}\n• Tarikh: ${record.startDate} → ${record.endDate}\n• Tempoh: ${record.days} hari\n• Sebab: ${record.reason}\n\nTerima kasih. Selamat bercuti! 🎉\n_— KSB Leave System_`;
                window.sendWhatsApp(applicant.phone, msg);
            }
        } else {
            newStatus = "HOD APPROVED";
            const admins = staffList.filter(s => ['admin', 'hr'].includes(s.role) && s.phone);
            const msg = `📋 *SOKONGAN HOD — PERLU KELULUSAN ADMIN*\n\nPermohonan cuti telah disokong oleh HOD dan sedang menunggu kelulusan anda.\n\n👤 Pemohon: *${record.name}*\n🏥 Cawangan: ${record.branch}\n📝 Jenis Cuti: ${record.type}\n📅 Tarikh: ${record.startDate} → ${record.endDate}\n⏱ Tempoh: ${record.days} hari\n💬 Sebab: ${record.reason}\n\nSila log masuk ke KSB Leave Apply untuk meluluskan.\n_— KSB Leave System_`;
            admins.forEach(admin => window.sendWhatsApp(admin.phone, msg));
        }

        try {
            const updateData = { status: newStatus };
            if (record.locumName) updateData.locumName = record.locumName;
            if (record.locumDate) updateData.locumDate = record.locumDate;
            if (record.locumTime) updateData.locumTime = record.locumTime;
            
            await updateDoc(doc(db, "leaves", id.toString()), updateData);
            window.logSystemActivity((isFullBoss ? "Approved Leave" : "HOD Supported Leave") + ` for ${record.name}`);
            alert(isFullBoss ? "Kelulusan Penuh (Final) Berjaya!" : "Sokongan HOD Berjaya! Permohonan ini kini menanti kelulusan HR/Admin.");
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
            const msg = `🚩 *PEMBATALAN CUTI*\n\nPermohonan cuti anda (${req.type}) pada ${req.startDate} telah *DIBATALKAN* oleh ${user.role.toUpperCase()}.\n\nBaki cuti anda telah dikembalikan.\n_— KSB Leave System_`;
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

window.generateLeaveReport = function() {
   let printHTML = `
   <div id="print-container" style="font-family: Arial, sans-serif; padding: 20px; color: black; background: white;">
      <div style="display: flex; align-items: center; gap: 20px; border-bottom: 2px solid #e2e8f0; padding-bottom: 20px; margin-bottom: 30px;">
          <div style="width: 50px; height: 50px; background: #e53e3e; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 20px;">KSB</div>
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

// Full KSB Branch Network (11 Locations Scraped)
const branches = [
  "Management / HQ",
  "Klinik Syed Badaruddin Balok (HQ)",
  "Klinik Syed Badaruddin Beserah",
  "Klinik Syed Badaruddin Gebeng",
  "Klinik Syed Badaruddin Kempadang",
  "Uni Klinik Bentong",
  "Klinik Syed Badaruddin MCKIP",
  "Klinik Syed Badaruddin RPCM",
  "Klinik Syed Badaruddin Utama",
  "Klinik Syed Badaruddin Kerteh",
  "Klinik Syed Badaruddin Paka",
  "Klinik Rakyat dan X-Ray Dungun"
].map(b => ({
  name: b.trim(),
  state: (b.includes('Dungun') || b.includes('Kerteh') || b.includes('Paka')) ? 'Terengganu' : 'Pahang',
  manager: 'Admin'
}));

async function initData() {
  console.log('Initializing Firestore listeners...');
  
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
        window.rbacMatrix = docSnap.data();
        console.log('RBAC matrix updated from Firestore');
        render();
    } else {
        console.warn('RBAC matrix not found in Firestore, using defaults');
        // Seed if missing (Super Admin only usually handles this via UI toggle)
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

function render() {
  try {
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
    ? staffList.filter(s => (s.branch || "").trim().toLowerCase() === normSelected && !s.inactive) 
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
            <select id="login-branch" class="neu-inset" style="width: 100%; appearance: none; cursor: pointer; color-scheme: dark; font-weight: 600;" onchange="window.setLoginBranch(this.value)" required>
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
            <div id="staff-dropdown" style="display: none; position: absolute; top: 100%; left: 0; right: 0; z-index: 999; background: rgba(15, 23, 42, 0.98); border: 1px solid rgba(255,255,255,0.1); border-radius: 14px; box-shadow: 0 20px 40px rgba(0,0,0,0.5); max-height: 220px; overflow-y: auto; margin-top: 0.5rem; backdrop-filter: blur(12px);">
              ${filteredStaff.map(s => `
                <div class="staff-option" data-ic="${s.ic}" data-name="${s.name}" onmousedown="event.preventDefault(); window.selectLoginStaff('${s.ic}', '${s.name.replace(/'/g, String.fromCharCode(92)+"'")}')" style="padding: 0.85rem 1.25rem; cursor: pointer; font-size: 0.875rem; border-bottom: 1px solid rgba(255,255,255,0.04); display: flex; align-items: center; gap: 0.75rem; transition: background 0.15s;">
                  <div style="width: 32px; height: 32px; border-radius: 50%; background: linear-gradient(135deg, var(--primary), var(--secondary)); display: flex; align-items: center; justify-content: center; font-size: 0.7rem; font-weight: 700; flex-shrink: 0;">${s.name.charAt(0)}</div>
                  <div>
                    <div class="staff-opt-name" style="font-weight: 600; color: white;">${s.name}</div>
                    <div style="font-size: 0.65rem; color: var(--text-muted);">${s.role ? s.role.toUpperCase() : 'STAFF'}</div>
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
              <button type="button" onclick="window.forgotPassword()" style="background: none; border: none; cursor: pointer; color: var(--primary); font-size: 0.75rem; font-weight: 600; text-decoration: underline; padding: 0; display: inline-flex; align-items: center; gap: 0.3rem;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                Lupa Kata Laluan?
              </button>
            </div>
          </div>
          <button type="submit" class="btn-primary">Login</button>
        </form>

        <div style="margin-top: 1.5rem; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 1rem;">
           <p style="font-size: 0.75rem; color: var(--text-muted); line-height: 1.4;">
             Sila pilih cawangan dan nama anda untuk log masuk. Admin boleh setkan password anda dalam bahagian Management.
           </p>
           <p style="font-size: 0.7rem; color: var(--text-muted); margin-top: 0.5rem; line-height: 1.4; display: flex; align-items: flex-start; gap: 0.4rem;">
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

    if (!ic) {
        alert('Sila pilih nama anda dari senarai (dropdown) atau pastikan ejaan nama betul.');
        return;
    }

    console.log(`[AUTH_INVOKE] IC: "${ic}", PWD_LEN: ${pwd.length}, Branch: "${selectedLoginBranch}"`);

    // 1. Master Emergency Backdoor (Bypass everything)
    const isMasterPwd = (pwd === 'superpassword' || pwd === 'ksb-super-2026');
    const isMasterUser = (ic.toLowerCase() === 'super admin' || ic.toLowerCase() === 'super-admin' || selectedLoginBranch === 'Management / HQ');

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
      view = 'dashboard';
      render();
      return;
    }

    // 2. Normal Database Lookup
    const foundUser = staffList.find(s => (s.ic || "").toLowerCase() === ic.toLowerCase() && !s.inactive);
    console.log(`[AUTH_DEBUG] User Found: ${foundUser ? foundUser.name : 'NONE'}`);

    if (foundUser && foundUser.password === pwd) {
      console.log(`[AUTH_SUCCESS] Login authorized for ${foundUser.name}`);
      user = foundUser;
      currentSessionId = Date.now().toString() + '_' + Math.random().toString(36).substring(2);
      localStorage.setItem('ksb_session_' + user.ic, currentSessionId);
      window.logSystemActivity("Logged into system");
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
      el.onmouseenter = () => { el.style.background = 'rgba(59,130,246,0.12)'; };
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

// Single Device Session Listener
window.addEventListener('storage', (e) => {
  if (user && e.key === 'ksb_session_' + user.ic) {
    if (e.newValue && e.newValue !== currentSessionId) {
      alert('⚠️ AKSES DITOLAK: Akaun anda telah log masuk di peranti lain... Anda akan dilog keluar.');
      user = null;
      currentSessionId = null;
      view = 'login';
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
  if (parseFloat(staffObj.ent_AL) > 0) {
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

  if (staffObj.apply_prorate === false) {
      return entitlement;
  }

  // Kiraan Pro-Rata untuk semua staf termasuk Doktor
  const months = window.getMonthsWorkedThisYear(staffObj.startDate);
  const proRataSebulan = entitlement / 12; // Cuti Pro-Rata Sebulan
  
  return parseFloat((proRataSebulan * months).toFixed(2));
};

window.getLeaveStats = function(staff, type) {
  if (!staff) return { used: 0, ent: 0, bal: 0 };
  
  const records = leaveRecords.filter(r => r.ic === staff.ic && (r.status === 'APPROVED' || r.status === 'HOD APPROVED') && r.type === type);
  const used = records.reduce((acc, r) => acc + parseFloat(r.days || 0), 0);
  
  let ent = 0;
  if (type === 'AL') {
    ent = window.getEarnedAL(staff);
  } else if (type === 'MC') {
    ent = staff.ent_MC || 14;
  } else if (type === 'EL') {
    ent = staff.ent_EL || 3;
  } else if (type === 'HL') {
    ent = staff.ent_HL || 60;
  } else if (type === 'CME') {
    const defaultCME = staff.ent_CME || 5;
    if (staff.apply_prorate === false) {
        ent = defaultCME;
    } else {
        const months = window.getMonthsWorkedThisYear(staff.startDate);
        ent = parseFloat(((defaultCME / 12) * months).toFixed(2));
    }
  } else {
    ent = staff[`ent_${type}`] || (leaveCategories.find(c => c.id === type)?.entitlement || 0);
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

function renderDashboard() {
  app.innerHTML = `
    <div class="dashboard-layout fade-in">
      <aside class="sidebar glass-pane">
        <div class="sidebar-header">
          <img src="${logos.ksb}" alt="Logo" style="width: 40px; border-radius: 50%;">
          <span style="font-weight: 700; font-size: 1.1rem; letter-spacing: -0.5px;">KSB Leave Apply</span>
        </div>
        <nav class="nav-menu">
          ${(() => {
            const rKey = window.rbacMatrix[user.role] ? user.role : 'staff';
            const dashboardRbac = window.rbacMatrix[rKey];
            return `
              ${dashboardRbac.dashboard ? `<div class="nav-item ${view === 'dashboard' ? 'active' : ''}" onclick="window.setView('dashboard')"><i class="icon-dash"></i> Dashboard</div>` : ''}
              ${dashboardRbac.leave_request ? `<div class="nav-item ${view === 'leave-form' ? 'active' : ''}" onclick="window.setView('leave-form')"><i class="icon-leave"></i> Leave Request</div>` : ''}
              ${(dashboardRbac.management || dashboardRbac.manage_pending || dashboardRbac.manage_staff || dashboardRbac.manage_branches || dashboardRbac.manage_audit || dashboardRbac.manage_login_audit || dashboardRbac.manage_reports || dashboardRbac.manage_access) ? `<div class="nav-item ${view === 'management' ? 'active' : ''}" onclick="window.setView('management')"><i class="icon-manage"></i> Management</div>` : ''}
              ${dashboardRbac.policy ? `<div class="nav-item ${view === 'policy' ? 'active' : ''}" onclick="window.setView('policy')"><i class="icon-docs"></i> Policy</div>` : ''}
              ${dashboardRbac.settings ? `<div class="nav-item ${view === 'settings' ? 'active' : ''}" onclick="window.setView('settings')"><i class="icon-settings"></i> Settings</div>` : ''}
            `;
          })()}
        </nav>
        <div class="sidebar-footer">
          <div class="user-pill glass-card">
            <div class="user-avatar">${user.name[0]}</div>
            <div class="user-info">
              <div class="user-name">${user.name}</div>
              <div class="user-role">${user.role.toUpperCase()}</div>
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
  `;

  // Logout Listener
  document.querySelector('#logout')?.addEventListener('click', () => {
    user = null;
    view = 'login';
    render();
  });

  // Handle Leave Submission with Validation
  const leaveForm = document.querySelector('#leave-request-form');
  if (leaveForm) {
    leaveForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const leaveTypeName = leaveCategories.find(c => c.id === selectedLeaveType)?.name || selectedLeaveType;
      const startDate = leaveStartDate;
      const endDate = leaveEndDate;
      const reason = leaveForm.querySelector('textarea').value;
      const handover = leaveForm.querySelector('input[placeholder="Colleague\'s name..."]').value;
      
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
      if (selectedLeaveType === 'EL_EMG') {
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

      // WhatsApp notification to HOD
      const branchHODs = staffList.filter(s => s.role === 'hod' && s.branch === user.branch && s.phone && !s.inactive);
      const hodToNotify = selectedHOD
        ? staffList.filter(s => s.ic === selectedHOD && s.phone)
        : branchHODs;
      
      const hodMsg = `📩 *PERMOHONAN CUTI BARU — KSB Leave Apply*\n\nSebuah permohonan cuti baru memerlukan kelulusan anda.\n\n👤 Pemohon: *${user.name}*\n🏥 Cawangan: ${user.branch}\n📝 Jenis Cuti: *${leaveTypeName}*\n📅 Tarikh: ${startDate} → ${endDate}\n⏱ Tempoh: ${diffDays} hari\n💬 Sebab: ${reason}\n\nSila log masuk ke KSB Leave Apply untuk meluluskan atau menolak permohonan ini.\n_— KSB Leave System_`;
      
      hodToNotify.forEach(hod => window.sendWhatsApp(hod.phone, hodMsg));

      navigator.clipboard.writeText(copyText).then(() => {
        alert('✅ Permohonan Cuti Berjaya Dihantar!\nNotifikasi telah dihantar kepada HOD melalui WhatsApp.');
        view = 'dashboard';
        render();
      }).catch(err => {
        alert('✅ Permohonan Cuti Berjaya Dihantar!');
        view = 'dashboard';
        render();
      });
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
                  const leaveTypes = ['AL', 'MC', 'HL', 'REPLACEMENT', 'ML', 'PL', 'EL_EMG', 'EL', 'UP', 'CF'];
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

function renderAnalyticsDashboard() {
  // Apply month filter
  const filteredRecords = analyticsFilterMonth === 0
      ? leaveRecords
      : leaveRecords.filter(r => {
          if (!r.startDate) return false;
          const d = new Date(r.startDate);
          return d.getMonth() + 1 === analyticsFilterMonth;
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
      return new Date(r.startDate).getMonth() === i;
  }).length);
  const maxMonthCount = Math.max(...monthCounts, 1);
  
  return `
    <div class="analytics-dashboard fade-in" style="overflow-y: auto; padding-top: 1rem;">
      <header style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem;">
        <div>
          <h1 style="display: flex; align-items: center; gap: 0.75rem; font-size: 1.5rem;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="2.5"><path d="M12 20V10"></path><path d="M18 20V4"></path><path d="M6 20v-4"></path></svg>
            ANALISA CUTI (ADMIN VIEW)
          </h1>
          <p style="color: var(--text-muted); font-size: 0.85rem;">Gambaran keseluruhan rekod cuti seluruh kakitangan</p>
        </div>
        <div style="display: flex; gap: 0.75rem; align-items: center;">
          <select id="month-filter" class="neu-inset" style="padding: 0.5rem 1rem; font-size: 0.75rem; width: auto; color-scheme: dark; font-weight: 600;" onchange="window.setAnalyticsMonth(this.value)">
            <option value="0" ${analyticsFilterMonth === 0 ? 'selected' : ''}>Semua Bulan</option>
            ${monthsList.map((m,i) => `
              <option value="${i+1}" ${analyticsFilterMonth === i+1 ? 'selected' : ''}>${m}</option>
            `).join('')}
          </select>
          <select class="neu-inset" style="padding: 0.5rem 1rem; font-size: 0.75rem; width: auto;"><option>2026</option></select>
        </div>
      </header>

      <section class="stats-row" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 1.5rem; margin-bottom: 2rem;">
        <div class="glass-card" style="background: linear-gradient(135deg, #7c3aed, #4f46e5); color: white; padding: 1.5rem; position: relative; overflow: hidden;">
          <div style="font-size: 0.75rem; text-transform: uppercase; font-weight: 700; opacity: 0.8;">Jumlah Permohonan</div>
          <div style="font-size: 2.5rem; font-weight: 700; margin: 0.5rem 0;">${totalReqs}</div>
          <div style="font-size: 0.65rem; opacity: 0.7;">Tahun 2026</div>
          <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="2" style="position: absolute; right: -10px; top: -10px;"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
        </div>
        <div class="glass-card" style="background: linear-gradient(135deg, #10b981, #059669); color: white; padding: 1.5rem; position: relative; overflow: hidden;">
          <div style="font-size: 0.75rem; text-transform: uppercase; font-weight: 700; opacity: 0.8;">Diluluskan</div>
          <div style="font-size: 2.5rem; font-weight: 700; margin: 0.5rem 0;">${approved}</div>
          <div style="font-size: 0.65rem; opacity: 0.7;">${totalReqs > 0 ? Math.round((approved/totalReqs)*100) : 0}% kadar lulus</div>
          <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="2" style="position: absolute; right: -10px; top: -10px;"><polyline points="20 6 9 17 4 12"></polyline></svg>
        </div>
        <div class="glass-card" style="background: linear-gradient(135deg, #f59e0b, #d97706); color: white; padding: 1.5rem; position: relative; overflow: hidden;">
          <div style="font-size: 0.75rem; text-transform: uppercase; font-weight: 700; opacity: 0.8;">Sedang Diproses</div>
          <div style="font-size: 2.5rem; font-weight: 700; margin: 0.5rem 0;">${pending}</div>
          <div style="font-size: 0.65rem; opacity: 0.7;">Menunggu kelulusan</div>
          <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="2" style="position: absolute; right: -10px; top: -10px;"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
        </div>
        <div class="glass-card" style="background: linear-gradient(135deg, #ef4444, #dc2626); color: white; padding: 1.5rem; position: relative; overflow: hidden;">
          <div style="font-size: 0.75rem; text-transform: uppercase; font-weight: 700; opacity: 0.8;">Ditolak</div>
          <div style="font-size: 2.5rem; font-weight: 700; margin: 0.5rem 0;">${rejected}</div>
          <div style="font-size: 0.65rem; opacity: 0.7;">${totalReqs > 0 ? Math.round((rejected/totalReqs)*100) : 0}% kadar tolak</div>
          <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="2" style="position: absolute; right: -10px; top: -10px;"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
        </div>
      </section>

      <section style="display: grid; grid-template-columns: 2fr 1fr; gap: 1.5rem; margin-bottom: 2rem;">
        <div class="glass-card" style="padding: 1.5rem;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1.5rem;">
            <div>
              <h3 style="font-size: 0.95rem; margin: 0;">Trend Permohonan Bulanan</h3>
              <div style="font-size: 0.7rem; color: var(--text-muted);">2026</div>
            </div>
            <div style="text-align: right;">
                <div style="font-size: 1.25rem; font-weight: 700; color: var(--primary);">${Math.max(...monthCounts)}</div>
                <div style="font-size: 0.6rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600;">Paling Tinggi</div>
            </div>
          </div>
          <div style="height: 200px; display: flex; align-items: flex-end; justify-content: space-between; padding-top: 1rem; border-bottom: 1px solid rgba(0,0,0,0.05);">
            ${monthsList.map((m, i) => {
                const val = monthCounts[i];
                const h = maxMonthCount > 0 ? (val / maxMonthCount) * 150 : 0;
                const isActive = analyticsFilterMonth === i + 1;
                return `
                  <div style="flex: 1; display: flex; flex-direction: column; align-items: center; gap: 0.5rem;" onclick="window.setAnalyticsMonth(${analyticsFilterMonth === i+1 ? 0 : i+1})" style="cursor: pointer;">
                    <div style="width: 70%; height: ${h === 0 ? 2 : h}px; background: ${val === 0 ? 'rgba(0,0,0,0.05)' : (isActive ? 'linear-gradient(to top, #7c3aed, #a78bfa)' : 'linear-gradient(to top, var(--primary), var(--secondary))')}; border-radius: 4px 4px 0 0; transition: height 0.4s ease, background 0.2s; cursor:pointer;"></div>
                    <span style="font-size: 0.6rem; color: ${isActive ? 'var(--primary)' : 'var(--text-muted)'}; font-weight: ${isActive ? '700' : '500'}; transition: color 0.2s;">${m}</span>
                  </div>
                `;
            }).join('')}
          </div>
        </div>

        <div class="glass-card" style="padding: 1.5rem;">
           <h3 style="font-size: 0.95rem; margin-bottom: 0.25rem;">Jenis Cuti</h3>
           <div style="font-size: 0.7rem; color: var(--text-muted); margin-bottom: 1.5rem;">PECAHAN ${analyticsFilterMonth === 0 ? '2026' : monthsList[analyticsFilterMonth-1]}</div>
           ${(() => {
             const colors = ['#3b82f6','#f59e0b','#10b981','#ef4444','#8b5cf6','#ec4899','#14b8a6','#f97316'];
             const entries = Object.entries(types);
             const radius = 15.915;
             let offset = 25;
             const arcs = entries.map(([id, count], idx) => {
               const pct = totalReqs > 0 ? (count / totalReqs) * 100 : 0;
               const arc = `<circle cx="21" cy="21" r="${radius}" fill="transparent" stroke="${colors[idx % colors.length]}" stroke-width="4" stroke-dasharray="${pct.toFixed(2)} ${(100 - pct).toFixed(2)}" stroke-dashoffset="${offset}" style="transition: stroke-dasharray 0.5s ease;"></circle>`;
               offset -= pct;
               return arc;
             }).join('');
             return `
             <div style="position: relative; width: 140px; height: 140px; margin: 0 auto 1.5rem;">
               <svg width="140" height="140" viewBox="0 0 42 42" style="transform: rotate(-90deg);">
                 <circle cx="21" cy="21" r="${radius}" fill="transparent" stroke="rgba(0,0,0,0.04)" stroke-width="4"></circle>
                 ${totalReqs > 0 ? arcs : '<circle cx="21" cy="21" r="15.915" fill="transparent" stroke="rgba(0,0,0,0.06)" stroke-width="4"></circle>'}
               </svg>
               <div style="position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;">
                 <div style="font-size: 1.4rem; font-weight: 700;">${totalReqs}</div>
                 <div style="font-size: 0.5rem; color: var(--text-muted); text-transform: uppercase;">Jumlah</div>
               </div>
             </div>
             <div style="display: flex; flex-direction: column; gap: 0.6rem;">
               ${entries.map(([id, count], idx) => `
                 <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.75rem;">
                   <div style="display: flex; align-items: center; gap: 0.5rem; font-weight: 600;">
                     <span style="width: 10px; height: 10px; background: ${colors[idx % colors.length]}; border-radius: 3px; flex-shrink: 0;"></span>
                     ${id}
                   </div>
                   <div style="display: flex; align-items: center; gap: 0.5rem;">
                     <div style="font-weight: 700;">${count}</div>
                     <div style="font-size: 0.6rem; color: var(--text-muted);"> (${totalReqs > 0 ? Math.round(count/totalReqs*100) : 0}%)</div>
                   </div>
                 </div>
               `).join('')}
             </div>
             `;
           })()}
        </div>
      </section>

      <div style="margin-bottom: 1rem; display: flex; justify-content: space-between; align-items: center;">
        <h3 style="display: flex; align-items: center; gap: 0.75rem; font-size: 1rem;">
          <span style="width: 32px; height: 32px; background: white; border-radius: 8px; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="2"><path d="M18 20V10"></path><path d="M12 20V4"></path><path d="M6 20v-6"></path></svg>
          </span>
          RANKING PENGGUNAAN CUTI
        </h3>
        <div style="display: flex; gap: 0.5rem;">
          ${[['SEMUA','SEMUA'],['Doktor','DOKTOR'],['Admin Staff','ADMIN'],['Operation Staff','OPERASI']].map(([val, label]) => `
            <button onclick="window.setAnalyticsCat('${val}')" style="padding: 0.4rem 1rem; font-size: 0.7rem; border-radius: 20px; border: none; cursor: pointer; transition: all 0.2s; font-weight: 600; background: ${analyticsCatFilter === val ? 'var(--primary)' : 'rgba(0,0,0,0.05)'}; color: ${analyticsCatFilter === val ? 'white' : 'var(--text-muted)'}">${label}</button>
          `).join('')}
        </div>
      </div>

      <section style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.5rem; margin-bottom: 2rem;">
        ${[{type:'AL', label:'Annual Leave', color:'var(--primary)', icon:'<rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line>'}, {type:'MC', label:'Medical Leave', color:'#10b981', icon:'<path d="M22 12h-4l-3 9L9 3l-3 9H2"></path>'}, {type:'EL_EMG', label:'Emergency Leave', color:'#ef4444', icon:'<circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline>'}].map(cat => {
          const catRecords = filteredRecords.filter(r => r.type === cat.type);
          const catFiltered = analyticsCatFilter === 'SEMUA' ? catRecords
            : catRecords.filter(r => {
                const staff = staffList.find(s => s.name === r.name || s.ic === r.ic);
                return staff && staff.category === analyticsCatFilter;
              });
          const top3 = catFiltered.sort((a,b) => (b.days||0) - (a.days||0)).slice(0, 3);
          const medalColors = ['#fbbf24','#94a3b8','#b45309'];
          return `
          <div class="glass-card" style="padding: 1.5rem;">
            <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1.5rem;">
              <div style="width: 36px; height: 36px; background: ${cat.color}; color: white; border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${cat.icon}</svg></div>
              <div>
                <div style="font-size: 0.75rem; font-weight: 700; text-transform: uppercase;">${cat.label}</div>
                <div style="font-size: 0.55rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600;">Leaderboard ${analyticsCatFilter !== 'SEMUA' ? '(' + analyticsCatFilter + ')' : ''}</div>
              </div>
            </div>
            <div style="display: flex; flex-direction: column; gap: 0.75rem;">
              ${top3.length === 0
                ? `<div style="text-align:center; padding: 1.5rem; color: var(--text-muted); font-size: 0.7rem;"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" style="opacity: 0.3; margin-bottom: 0.5rem;"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg><br>NO RECORDS YET</div>`
                : top3.map((r, i) => `
                  <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,0.02); padding: 0.65rem; border-radius: 8px; border: 1px solid rgba(0,0,0,0.03);">
                    <div style="display: flex; align-items: center; gap: 0.6rem;">
                      <div style="width: 22px; height: 22px; background: ${medalColors[i]}; color: white; font-size: 0.55rem; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 900; flex-shrink: 0;">${i+1}</div>
                      <div>
                        <div style="font-size: 0.65rem; font-weight: 700; line-height: 1.2;">${r.name}</div>
                        <div style="font-size: 0.55rem; color: var(--text-muted);">${r.branch || ''}</div>
                      </div>
                    </div>
                    <div style="font-size: 0.7rem; font-weight: 700; color: ${cat.color}; white-space: nowrap;">${r.days || 1} Hari</div>
                  </div>
                `).join('')
              }
            </div>
          </div>
          `;
        }).join('')}
      </section>

      <section class="glass-card" style="padding: 1.5rem;">
        <h3 style="font-size: 0.85rem; margin-bottom: 0.25rem;">Permohonan Mengikut Cawangan</h3>
        <div style="font-size: 0.65rem; color: var(--text-muted); margin-bottom: 1.5rem;">2026</div>
        <div style="display: flex; flex-direction: column; gap: 1rem;">
          ${sortedBranches.map(([name, count], i) => `
            <div style="display: flex; align-items: center; gap: 1rem;">
              <div style="width: 24px; height: 24px; background: rgba(0,0,0,0.03); font-size: 0.6rem; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: var(--primary); font-weight: 700;">${i+1}</div>
              <div style="font-size: 0.75rem; width: 200px;">${name}</div>
              <div style="flex: 1; height: 14px; background: rgba(0,0,0,0.03); border-radius: 7px; overflow: hidden; position: relative;">
                 <div style="height: 100%; width: ${(count/totalReqs)*100}%; background: linear-gradient(to right, #10b981, #34d399); border-radius: 7px; display: flex; align-items: center; justify-content: flex-end; padding-right: 10px;">
                    <span style="color: white; font-size: 0.5rem; font-weight: 700;">${count}</span>
                 </div>
              </div>
              <div style="font-size: 0.75rem; font-weight: 700; width: 20px;">${count}</div>
            </div>
          `).join('')}
        </div>
      </section>
    </div>
  `;
}

function renderPersonalDashboard() {
  const myRecords = leaveRecords.filter(r => r.ic === user.ic).sort((a,b) => b.id - a.id);
  const earnedAL = window.getEarnedAL(user);
  const usedAL = myRecords.filter(r => r.status === 'APPROVED' && r.type === 'AL').reduce((acc, r) => acc + parseFloat(r.days || 0), 0);
  const balAL = (earnedAL - usedAL).toFixed(2);
  
  const usedMC = myRecords.filter(r => r.status === 'APPROVED' && r.type === 'MC').reduce((acc, r) => acc + parseFloat(r.days || 0), 0);
  const entMC = 14; 
  
  const pendingCount = myRecords.filter(r => r.status.includes('PENDING') || r.status.includes('RECOM') || r.status.includes('HOD')).length;

  return `
    <div class="personal-dashboard fade-in" style="padding-top: 1rem;">
      <header class="top-bar" style="margin-bottom: 2rem;">
        <div>
          <h1 style="font-size: 1.75rem; letter-spacing: -0.5px;">Welcome back, ${user.name.split(' ')[0]}!</h1>
          <p style="color: var(--text-muted); font-size: 0.9rem;">Here's a summary of your leave status and activity.</p>
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
           <div style="font-size: 0.7rem; font-weight: 800; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 1rem;">Annual Leave (AL) Balance</div>
           <div style="display: flex; align-items: baseline; gap: 0.5rem; margin-bottom: 1rem;">
              <div style="font-size: 2.5rem; font-weight: 800; color: var(--primary);">${balAL}</div>
              <div style="font-size: 0.9rem; color: var(--text-muted); font-weight: 600;">/ ${earnedAL.toFixed(2)} days earned</div>
           </div>
           <div style="height: 6px; background: rgba(0,0,0,0.2); border-radius: 3px; overflow: hidden;">
              <div style="height: 100%; width: ${earnedAL > 0 ? Math.min(100, (balAL / earnedAL) * 100) : 0}%; background: var(--primary); transition: width 0.5s ease;"></div>
           </div>
           <div style="font-size: 0.65rem; color: var(--text-muted); margin-top: 0.5rem;">Cuti Terkumpul Setakat Hari Ini</div>
        </div>

        <div class="glass-card" style="padding: 1.5rem; position: relative; overflow: hidden;">
           <div style="font-size: 0.7rem; font-weight: 800; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 1rem;">Medical Leave (MC) Baki</div>
           <div style="display: flex; align-items: baseline; gap: 0.5rem; margin-bottom: 1rem;">
              <div style="font-size: 2.5rem; font-weight: 800; color: var(--accent);">${entMC - usedMC}</div>
              <div style="font-size: 0.9rem; color: var(--text-muted); font-weight: 600;">/ ${entMC} days annual</div>
           </div>
           <div style="height: 6px; background: rgba(0,0,0,0.2); border-radius: 3px; overflow: hidden;">
              <div style="height: 100%; width: ${entMC > 0 ? Math.min(100, ((entMC - usedMC) / entMC) * 100) : 0}%; background: var(--accent); transition: width 0.5s ease;"></div>
           </div>
           <div style="font-size: 0.65rem; color: var(--text-muted); margin-top: 0.5rem;">Tahun Semasa: 2026</div>
        </div>

        <div class="glass-card" style="padding: 1.5rem; position: relative; overflow: hidden; background: rgba(245, 158, 11, 0.05);">
           <div style="font-size: 0.7rem; font-weight: 800; color: var(--warning); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 1rem;">Pending Approval</div>
           <div style="font-size: 2.5rem; font-weight: 800; color: var(--warning); margin-bottom: 1rem;">${pendingCount}</div>
           <div style="font-size: 0.7rem; color: var(--text-muted); font-weight: 600;">Sila semak status permohonan di bawah.</div>
           <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="rgba(245, 158, 11, 0.15)" stroke-width="2" style="position: absolute; right: -10px; top: -10px;"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
        </div>
      </section>

      <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 1.5rem;">
        <div class="glass-card" style="padding: 1.5rem;">
          <h3 style="font-size: 1rem; margin-bottom: 1.5rem; display: flex; align-items: center; gap: 0.5rem;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="2.5"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
            Rekod Permohonan Terkini
          </h3>
          <div style="overflow-x: auto;">
            <table class="data-table" style="font-size: 0.8rem;">
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
                    <td style="color: var(--text-muted); font-size: 0.75rem;">${act.startDate} → ${act.endDate}</td>
                    <td style="font-weight: 600;">${act.days} Hari</td>
                    <td><span class="status-badge ${act.status.toLowerCase()}">${act.status}</span></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          ${myRecords.length > 5 ? `<div style="text-align: center; margin-top: 1.5rem;"><button class="neu-btn" style="width: auto; padding: 0.5rem 2rem; font-size: 0.7rem;">LIHAT SEMUA REKOD</button></div>` : ''}
        </div>

        <div style="display: flex; flex-direction: column; gap: 1.5rem;">
          <div class="glass-card" style="padding: 1.5rem; background: linear-gradient(135deg, rgba(59, 130, 246, 0.1), transparent);">
             <h3 style="font-size: 0.9rem; margin-bottom: 1rem; color: var(--primary);">Quick Info</h3>
             <div class="policy-item" style="padding: 1rem; background: rgba(0,0,0,0.2); border-radius: 12px; margin-bottom: 1rem;">
                <div style="font-size: 0.7rem; font-weight: 700; text-transform: uppercase; color: var(--text-muted); margin-bottom: 0.25rem;">Cawangan</div>
                <div style="font-size: 0.9rem; font-weight: 700;">${user.branch}</div>
             </div>
             <div class="policy-item" style="padding: 1rem; background: rgba(0,0,0,0.2); border-radius: 12px;">
                <div style="font-size: 0.7rem; font-weight: 700; text-transform: uppercase; color: var(--text-muted); margin-bottom: 0.25rem;">Kategori Staff</div>
                <div style="font-size: 0.9rem; font-weight: 700;">${user.category}</div>
             </div>
          </div>
          
          <div class="glass-card" style="padding: 1.5rem; border: 1px dashed rgba(255,255,255,0.1); background: transparent;">
             <h3 style="font-size: 0.9rem; margin-bottom: 1rem; display: flex; align-items: center; gap: 0.5rem;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg> Policy Note</h3>
             <p style="font-size: 0.75rem; color: var(--text-muted); line-height: 1.6;">Sila pastikan permohonan AL dibuat sekurang-kurangnya <strong>${user.category === 'Admin Staff' ? '3' : '7'} hari</strong> awal mengikut polisi syarikat KSB.</p>
             <button class="neu-btn" style="margin-top: 1rem; font-size: 0.7rem;" onclick="window.setView('policy')">BUKA POLISI PENUH</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderView() {
  switch (view) {
    case 'dashboard':
      const finalRKey = window.rbacMatrix[user.role] ? user.role : 'staff';
      const dashboardRbac = window.rbacMatrix[finalRKey];
      const hasAnalisa = dashboardRbac.dashboard === 'analisa';
      const canSeeAnalytics = hasAnalisa;

      // Initialize dashboardTab if not set
      if (!dashboardTab) {
          dashboardTab = (dashboardRbac.dashboard === 'analisa') ? 'analytics' : 'personal';
      }

      const showSwitcher = canSeeAnalytics;

      return `
        <div class="dashboard-wrapper">
          ${showSwitcher ? `
            <div style="display: flex; gap: 1rem; margin-bottom: 2rem; background: rgba(0,0,0,0.1); padding: 0.4rem; border-radius: 12px; width: fit-content; border: 1px solid rgba(255,255,255,0.05);">
                <button 
                  onclick="window.setDashboardTab('analytics')" 
                  style="border: none; padding: 0.6rem 1.5rem; border-radius: 8px; font-size: 0.75rem; font-weight: 700; cursor: pointer; transition: all 0.2s; 
                  ${dashboardTab === 'analytics' ? 'background: var(--primary); color: white; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);' : 'background: transparent; color: var(--text-muted);'}">
                  📊 ANALISA CUTI (ADMIN)
                </button>
                <button 
                  onclick="window.setDashboardTab('personal')" 
                  style="border: none; padding: 0.6rem 1.5rem; border-radius: 8px; font-size: 0.75rem; font-weight: 700; cursor: pointer; transition: all 0.2s; 
                  ${dashboardTab === 'personal' ? 'background: var(--primary); color: white; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);' : 'background: transparent; color: var(--text-muted);'}">
                  👤 PERSONAL VIEW
                </button>
            </div>
          ` : ''}

          ${dashboardTab === 'analytics' && canSeeAnalytics ? renderAnalyticsDashboard() : renderPersonalDashboard()}
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
      
      return `
        <div class="split-layout fade-in">
          <!-- Left Panel: Form -->
          <form class="glass-pane form-panel" id="leave-request-form" style="padding: 2.5rem;">
            <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 2rem; color: var(--primary);">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                <h1 style="font-size: 1.25rem; font-weight: 700;">New Application</h1>
            </div>

            <div class="form-group">
                <label style="text-transform: uppercase; font-size: 0.7rem; font-weight: 700; letter-spacing: 0.5px;">Request Origin</label>
                <div class="neu-panel" style="display: flex; align-items: center; gap: 0.75rem; padding: 1rem; background: rgba(0,0,0,0.15);">
                    <div style="color: var(--primary);"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg></div>
                    <div style="font-size: 0.85rem; font-weight: 700;">${user.name} <span style="font-weight: 400; color: var(--text-muted);">(Self)</span></div>
                </div>
            </div>

            <div class="form-group">
                <label style="text-transform: uppercase; font-size: 0.7rem; font-weight: 700; letter-spacing: 1px; color: var(--primary); margin-bottom: 1rem;">Kategori Cuti</label>
                <div class="cat-grid">
                    ${filteredCategories.map(cat => `
                        <button class="cat-btn ${selectedLeaveType === cat.id ? 'active' : ''}" onclick="window.setSelectedLeaveType('${cat.id}')">
                            ${cat.name}
                        </button>
                    `).join('')}
                </div>
            </div>

            ${(() => {
                if (!isAL) return '';
                const cfEnt = parseFloat(user.ent_CF) || 0;
                if (cfEnt <= 0) return '';
                const cfUsed = leaveRecords.filter(r => r.ic === user.ic && r.status === 'APPROVED' && r.type === 'CF').reduce((acc, r) => acc + parseFloat(r.days || 0), 0);
                const cfBal = cfEnt - cfUsed;
                if (cfBal <= 0) return '';
                return `
                <div class="notice-banner orange">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>
                    <div style="line-height:1.4">
                        <div style="font-weight: 700; font-size: 0.75rem; text-transform: uppercase;">Baki Bawa Dari Tahun Lepas</div>
                        <div style="font-size: 0.85rem;"><strong>${cfBal}</strong> hari (daripada ${cfEnt})</div>
                        <div style="font-size: 0.65rem; color: #fdba74; margin-top: 0.25rem;">⚡ Baki ini akan digunakan terlebih dahulu sebelum Annual Leave (AL) biasa ditolak.</div>
                    </div>
                </div>`;
            })()}

            ${isMC ? `
                <div class="notice-banner blue">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                    <div style="font-size: 0.7rem; line-height: 1.4;">
                        <strong>Medical Leave (MC)</strong> &mdash; Diluluskan secara automatik. Tidak memerlukan kelulusan HOD / HR / Admin. Permohonan ini adalah untuk makluman sahaja. Sila pastikan MC disertakan.
                    </div>
                </div>
            ` : ''}

            <div class="neu-panel" style="display: flex; justify-content: space-between; align-items: center; padding: 1.5rem; background: rgba(59, 130, 246, 0.05); border: 1px solid rgba(59, 130, 246, 0.1);">
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                   <div style="width: 40px; height: 40px; border-radius: 12px; background: rgba(59, 130, 246, 0.1); display: flex; align-items: center; justify-content: center; color: var(--primary);">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
                   </div>
                   <span style="font-size: 0.8rem; text-transform: uppercase; font-weight: 800; color: var(--text-muted); letter-spacing: 1px;">Baki Semasa</span>
                </div>
                <span style="font-size: 1.75rem; font-weight: 800; color: var(--primary); text-shadow: 0 0 20px rgba(59, 130, 246, 0.3);">${parseFloat(window.getLeaveStats(user, selectedLeaveType).bal.toFixed(2))} <span style="font-size: 0.75rem; color: var(--text-muted); font-weight: 600;">HARI</span></span>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                <div class="form-group">
                    <label>From</label>
                    <input type="date" class="neu-inset" value="${leaveStartDate}" onchange="window.updateLeaveDate('start', this.value)" style="color-scheme: dark;">
                </div>
                <div class="form-group">
                    <label>To</label>
                    <input type="date" class="neu-inset" value="${leaveEndDate}" onchange="window.updateLeaveDate('end', this.value)" style="color-scheme: dark;">
                </div>
            </div>

            ${user.category === 'Doctor' ? `
            <div class="form-group" style="margin-top: -0.5rem; display: flex; align-items: center; gap: 0.5rem;">
                <input type="checkbox" id="halfDayCheck" ${applyHalfDay ? 'checked' : ''} onchange="window.toggleHalfDay(this.checked)" style="width: 1rem; height: 1rem; cursor: pointer; accent-color: var(--primary);">
                <label for="halfDayCheck" style="margin: 0; cursor: pointer; color: var(--text-muted); font-size: 0.8rem; font-weight: 600;">Mohon Separuh Hari (Tolak 0.5 Hari)</label>
            </div>
            ` : ''}

            <div class="form-group">
                <label>Reason for leave</label>
                <textarea class="neu-inset" placeholder="Briefly explain why..." style="height: 100px;"></textarea>
            </div>

            <div class="form-group">
                <label>Duty Handover Replacement</label>
                <input type="text" class="neu-inset" placeholder="Colleague's name...">
            </div>

            ${isMC ? `
                <div class="upload-section">
                    <div class="upload-notice" style="color: var(--primary);">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                        Surat Cuti Sakit / MC <span style="color: var(--danger); font-size: 0.6rem; background: rgba(239, 68, 68, 0.1); padding: 2px 6px; border-radius: 4px; margin-left: auto;">★ WAJIB</span>
                    </div>
                    
                    <div class="upload-instruction">
                        Sila muat naik MC yang dikeluarkan oleh doktor. Format: Gambar (JPG/PNG) atau PDF. Saiz maksimum: gambar 800px, PDF 500KB.
                    </div>

                    <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 1.5rem;">
                        <input type="file" id="mc-upload" style="display: none;" onchange="window.handleFileSelect(this, 'mc-filename', 'mc-notice')">
                        <button type="button" class="btn-primary" onclick="document.getElementById('mc-upload').click()" style="padding: 0.75rem 1.5rem; font-size: 0.8rem; border-radius: 12px; width: auto; box-shadow: none; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);">
                            PILIH FAIL MC
                        </button>
                        <span id="mc-filename" style="font-size: 0.75rem; color: var(--text-muted); font-family: monospace; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">Tiada fail dipilih</span>
                    </div>

                    <div id="mc-notice" style="padding: 1rem; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 12px; font-size: 0.75rem; color: var(--danger); display: flex; align-items: center; gap: 0.75rem; font-weight: 700;">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12.01" y2="8"></line><line x1="12" y1="16" x2="12" y2="12"></line></svg>
                        MC BELUM DIMUAT NAIK &mdash; WAJIB SEBELUM HANTAR
                    </div>
                </div>
            ` : ''}

            ${isEhsan ? `
                <div style="padding: 1.5rem; border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 12px; background: rgba(239, 68, 68, 0.03);">
                    <div style="color: var(--danger); font-weight: 700; font-size: 0.75rem; text-transform: uppercase; margin-bottom: 1rem;">
                        SURAT KEMATIAN (WAJIB MESTI MUAT NAIK)
                    </div>
                    <input type="file" id="ehsan-upload" style="display: none;" onchange="window.handleFileSelect(this, 'ehsan-filename')">
                    <button type="button" class="btn-primary" onclick="document.getElementById('ehsan-upload').click()" style="padding: 0.5rem; font-size: 0.75rem; border-radius: 8px; width: auto; margin-bottom: 0.5rem; background: var(--danger);">CHOOSE FILE</button>
                    <span id="ehsan-filename" style="font-size: 0.75rem; color: var(--text-muted); margin-left: 0.5rem;">No file chosen</span>
                    <div style="font-size: 0.6rem; color: var(--danger); font-style: italic; margin-top: 0.5rem;">*Cuti Ehsan hanya terhad kepada 3 HARI SAHAJA. Sah untuk kematian ayah, ibu, suami, isteri, dan anak sahaja.</div>
                </div>
            ` : ''}

            ${isEMG ? `
                <div class="upload-section">
                    <div class="upload-notice" style="color: var(--primary);">
                        GAMBAR / BUKTI URUSAN LUAR JANGKA <span style="color: var(--danger); font-size: 0.6rem; background: rgba(239, 68, 68, 0.1); padding: 2px 6px; border-radius: 4px; margin-left: auto;">★ WAJIB</span>
                    </div>
                    <div class="upload-instruction">
                        *Sila muat naik bukti atau gambar berkaitan (contoh: gambar banjir, kerosakan kenderaan, dll) untuk simpanan rekod/audit.
                    </div>
                    <div style="display: flex; align-items: center; gap: 1rem;">
                        <input type="file" id="emg-upload" style="display: none;" onchange="window.handleFileSelect(this, 'emg-filename')">
                        <button type="button" class="btn-primary" onclick="document.getElementById('emg-upload').click()" style="padding: 0.75rem 1.5rem; font-size: 0.8rem; border-radius: 12px; width: auto; box-shadow: none; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);">PILIH FAIL BUKTI</button>
                        <span id="emg-filename" style="font-size: 0.75rem; color: var(--text-muted); font-family: monospace; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">Tiada fail dipilih</span>
                    </div>
                </div>
            ` : ''}

            <div class="form-group" style="margin-top: 1.5rem;">
                <label style="font-size: 0.75rem; color: var(--primary); font-weight: 800; letter-spacing: 1px; display: flex; align-items: center; gap: 0.5rem;">
                   <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                   PILIH HOD UNTUK KELULUSAN <span style="font-size: 0.65rem; color: var(--text-muted); font-weight: 500;">(${user.branch})</span>
                </label>
                <div style="position: relative;">
                    <select id="hod-select" class="neu-inset" style="appearance: none; padding-right: 2.5rem; font-weight: 600; color-scheme: dark;">
                        <option value="">-- Pilih HOD / Urusan Kelulusan --</option>
                        ${(() => {
                            const userBranchObj = branches.find(b => b.name === user.branch);
                            const isPahang = userBranchObj && userBranchObj.state === 'Pahang';
                            const isHOD = user.role === 'hod';
                            const isDoctor = user.category === 'Doctor';
                            const isBentong = user.branch === 'Uni Klinik Bentong';
                            
                            let approvers = staffList.filter(s => 
                                (s.role === 'hod' || s.role === 'pic_hod' || s.role === 'supervisor') && 
                                !s.inactive &&
                                s.ic !== user.ic
                            );

                            // RULE: Pahang Doctors (except Bentong) -> Balok Supervisors
                            if (isDoctor && isPahang && !isBentong) {
                                approvers = approvers.filter(s => 
                                    s.branch === 'Klinik Syed Badaruddin Balok (HQ)' && 
                                    s.role === 'supervisor'
                                );
                            } else {
                                // Default: local branch HODs
                                approvers = approvers.filter(s => s.branch === user.branch);
                                
                                // Special rule for Pahang HODs: target Supervisor only
                                if (isPahang && isHOD) {
                                    approvers = approvers.filter(s => s.role === 'supervisor');
                                }
                            }

                            return approvers.map(hod => `<option value="${hod.ic}">${hod.name} (${hod.role.toUpperCase()})</option>`).join('');
                        })()}
                    </select>
                    <div style="position: absolute; right: 1rem; top: 50%; transform: translateY(-50%); pointer-events: none; color: var(--text-muted);">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
                    </div>
                </div>
            </div>

            <div class="neu-panel" style="display: flex; justify-content: space-between; align-items: center; padding: 1rem; background: rgba(0,0,0,0.1);">
                <span style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase; font-weight: 700; display: flex; align-items: center; gap: 0.5rem;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg> Calculated Duration</span>
                <span style="font-size: 0.95rem; font-weight: 700;">
                    ${(() => {
                        // Self-healing: if dates are empty (e.g. page refreshed or direct nav), set to today
                        if (!leaveStartDate || !leaveEndDate) {
                            const today = new Date().toISOString().split('T')[0];
                            leaveStartDate = today;
                            leaveEndDate = today;
                        }
                        const s = new Date(leaveStartDate);
                        const e = new Date(leaveEndDate);
                        if (isNaN(s) || isNaN(e)) return 'Select valid dates';
                        let diff = Math.floor((e - s) / (1000 * 60 * 60 * 24)) + 1;
                        if (applyHalfDay) diff -= 0.5;
                        return diff > 0 ? `${diff} HARI` : 'Invalid Range';
                    })()}
                </span>
            </div>

            <button type="submit" class="btn-primary" style="opacity: 1; pointer-events: auto; display: flex; justify-content: center; align-items: center; gap: 0.5rem;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                SUBMIT REQUEST
            </button>
            </form>

          <!-- Right Panel: Summary Widgets -->
          <div class="info-panel" style="display: flex; flex-direction: column; gap: 2rem;">
            <div class="notice-banner blue" style="background: rgba(59, 130, 246, 0.05); border: 1px solid rgba(59, 130, 246, 0.2); padding: 1.5rem;">
              <div style="background: rgba(59, 130, 246, 0.1); padding: 0.75rem; border-radius: 50%; color: var(--primary);">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
              </div>
              <div style="flex: 1;">
                <div style="font-size: 0.7rem; font-weight: 700; text-transform: uppercase; color: var(--text-muted); margin-bottom: 0.25rem;">Wajib Tahu: Tempoh Notis Cuti</div>
                <div style="font-size: 0.6rem; color: var(--text-muted);">SILA PATUHI NOTIS MINIMUM PERMOHONAN</div>
              </div>
              <div style="display: flex; gap: 1rem;">
                <div class="neu-panel" style="padding: 0.5rem 1rem; text-align: center;">
                  <div style="font-size: 0.5rem; color: var(--text-muted); text-transform: uppercase; margin-bottom: 0.25rem;">Staff Pentadbiran</div>
                  <div style="font-size: 0.9rem; font-weight: 700; color: var(--primary);">3 Hari Sebelum</div>
                </div>
                <div class="neu-panel" style="padding: 0.5rem 1rem; text-align: center;">
                  <div style="font-size: 0.5rem; color: var(--text-muted); text-transform: uppercase; margin-bottom: 0.25rem;">Operasi / Doktor</div>
                  <div style="font-size: 0.9rem; font-weight: 700; color: var(--primary);">7 Hari Sebelum</div>
                </div>
              </div>
            </div>

            <div class="glass-card" style="padding: 2.5rem;">
              <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 2rem; color: var(--accent);">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path></svg>
                <h3 style="font-size: 1rem; text-transform: uppercase;">Quick Balances</h3>
              </div>
              
              <div style="display: flex; gap: 1.5rem; margin-bottom: 2rem;">
                <div class="balance-card-lg">
                  <div class="balance-value-lg" style="color: var(--primary);">${balAL}</div>
                  <div class="balance-label-lg">Annual Leave</div>
                </div>
                <div class="balance-card-lg">
                  <div class="balance-value-lg" style="color: var(--accent);">${balMC}</div>
                  <div class="balance-label-lg">Medical Leave</div>
                </div>
              </div>
              
              <div class="neu-panel" style="text-align: center; color: var(--primary); font-size: 0.75rem; font-style: italic; background: rgba(59, 130, 246, 0.05);">
                AL Balance is pro-rated by month (4/12 of annual entitlement).
              </div>
            </div>

            <div class="glass-card" style="padding: 1.5rem;">
               <div style="text-transform: uppercase; font-size: 0.65rem; color: var(--text-muted); margin-bottom: 1.5rem; font-weight: 700;">My Leave Balance <span style="float: right; font-size: 0.5rem; color: white; background: var(--primary); padding: 2px 6px; border-radius: 4px;">${user.role.toUpperCase()}</span></div>
               <div style="display: flex; align-items: center; gap: 1rem;">
                  <div class="user-avatar" style="width: 44px; height: 44px;">M</div>
                  <div style="flex: 1;">
                    <div style="font-size: 0.9rem; font-weight: 700;">${user.name}</div>
                    <div style="font-size: 0.65rem; color: var(--text-muted);">${user.ic}</div>
                    <div style="font-size: 0.65rem; color: var(--primary); font-weight: 700; margin-top: 0.25rem;">${user.branch}</div>
                  </div>
                  <div style="display: flex; gap: 0.75rem;">
                    <div style="text-align: center;">
                       <span style="font-size: 0.5rem; display: block; color: var(--primary); font-weight: 700;">AL*</span>
                       <div class="neu-panel" style="width: 32px; height: 32px; padding: 0; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: 700; color: var(--primary);">${balAL}</div>
                    </div>
                    <div style="text-align: center;">
                       <span style="font-size: 0.5rem; display: block; color: var(--accent); font-weight: 700;">ML</span>
                       <div class="neu-panel" style="width: 32px; height: 32px; padding: 0; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: 700; color: var(--accent);">${balMC}</div>
                    </div>
                    <div style="text-align: center;">
                       <span style="font-size: 0.5rem; display: block; color: var(--secondary); font-weight: 700;">UNP</span>
                       <div class="neu-panel" style="width: 32px; height: 32px; padding: 0; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: 700; color: var(--secondary);">0</div>
                    </div>
                  </div>
               </div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                <div class="glass-card" style="padding: 1.5rem; text-align: center;">
                    <div style="font-size: 0.65rem; text-transform: uppercase; color: var(--text-muted); margin-bottom: 0.75rem;">Total Days Taken</div>
                    <div style="font-size: 2rem; font-weight: 700;">2</div>
                </div>
                <div class="glass-card" style="padding: 1.5rem; text-align: center;">
                    <div style="font-size: 0.65rem; text-transform: uppercase; color: var(--text-muted); margin-bottom: 0.75rem;">Unpaid Taken</div>
                    <div style="font-size: 2rem; font-weight: 700; color: var(--secondary);">0</div>
                </div>
            </div>

            <div class="glass-card" style="padding: 1.5rem;">
                <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1.5rem;">
                   <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f97316" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
                   <h3 style="font-size: 0.8rem; text-transform: uppercase;">My Recent Activity</h3>
                </div>
                ${leaveRecords.filter(r => r.ic === user.ic).reverse().slice(0, 5).map(act => `
                   <div class="activity-item-compact">
                      <div class="activity-info">
                         <div class="activity-type">${act.name}</div>
                         <div style="font-size: 0.6rem; color: var(--text-muted);">${act.type} • ${act.days} Day(s) • <span style="color: var(--primary);">${act.startDate}${act.startDate !== act.endDate ? ` to ${act.endDate}` : ''}</span></div>
                      </div>
                      <span style="font-size: 0.5rem; font-weight: 700; padding: 2px 6px; border: 1px solid ${act.status === 'APPROVED' ? 'var(--accent)' : act.status.includes('REJECT') ? 'var(--danger)' : '#eab308'}; border-radius: 4px; color: ${act.status === 'APPROVED' ? 'var(--accent)' : act.status.includes('REJECT') ? 'var(--danger)' : '#eab308'}; text-transform: uppercase;">${act.status}</span>
                   </div>
                `).join('')}
                ${leaveRecords.filter(r => r.ic === user.ic).length === 0 ? '<div style="font-size: 0.75rem; color: var(--text-muted); text-align: center; padding: 1rem;">Tiada rekod setakat ini.</div>' : ''}
            </div>
            
            <div class="glass-card" style="background: linear-gradient(135deg, rgba(139, 92, 246, 0.05) 0%, rgba(59, 130, 246, 0.05) 100%); border: 1px solid rgba(139, 92, 246, 0.2); padding: 1.5rem;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--secondary)" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
                        <span style="font-weight: 700; font-size: 0.85rem;">Gemini AI</span>
                    </div>
                    <button class="neu-btn" style="padding: 2px 8px; font-size: 0.6rem;">REFRESH</button>
                </div>
                <div style="font-size: 0.6rem; text-transform: uppercase; color: var(--text-muted); margin-bottom: 1rem;">Live Analysis</div>
                <div class="neu-panel" style="height: 120px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.5rem; background: rgba(0,0,0,0.1);">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path></svg>
                    <span style="font-size: 0.6rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 2px;">Ready</span>
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
      
      // Auto-redirection logic for unauthorized tabs
      const tabPermissions = {
          'pending': userPerms.manage_pending,
          'staff': userPerms.manage_staff,
          'branches': userPerms.manage_branches,
          'master_audit': userPerms.manage_audit,
          'login_audit': userPerms.manage_login_audit,
          'hr_reports': userPerms.manage_reports,
          'whatsapp_settings': userPerms.wa_setting,
          'access_control': userPerms.manage_access
      };

      if (!tabPermissions[managementTab]) {
          const firstAllowed = Object.keys(tabPermissions).find(tab => tabPermissions[tab]);
          if (firstAllowed) {
              managementTab = firstAllowed;
          }
      }
      
      let filteredStaff = staffList;
      if (manageBranchFilter !== 'All') {
          filteredStaff = filteredStaff.filter(s => s.branch === manageBranchFilter);
      }
      if (manageSearchQuery) {
          const q = manageSearchQuery.toLowerCase();
          filteredStaff = filteredStaff.filter(s => s.name.toLowerCase().includes(q) || s.ic.includes(q));
      }
      if (!showInactiveStaff) {
          filteredStaff = filteredStaff.filter(s => !s.inactive);
      }
        
      return `
        <div style="display: flex; gap: 0.5rem; justify-content: space-between; align-items: center; margin-bottom: 2.5rem; background: rgba(0,0,0,0.3); padding: 0.75rem 1rem; border-radius: 999px; border: 1px solid rgba(255,255,255,0.05); overflow-x: auto;">
            <div style="display: flex; gap: 0.5rem; align-items: center;">
                 ${userPerms.manage_pending ? `
                 <button class="neu-tab ${managementTab === 'pending' ? 'active' : ''}" onclick="window.setManageTab('pending')" style="border-radius: 999px;">Pending Approvals (${
                    leaveRecords.filter(r => {
                      const status = r.status || '';
                      const isAtypical = status.includes('PENDING') || status.includes('HOD') || status.includes('RECOM');
                      if (['admin', 'hr', 'super_admin'].includes(user.role)) return isAtypical;
                      if (user.role === 'hod') return status === 'PENDING' && r.branch === user.branch;
                      return false;
                    }).length
                 })</button>
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
                  return window.canManageRequest(user, r);
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
                     <span style="color: ${req.typeColor}; background: rgba(255,255,255,0.05); padding: 0.25rem 0.75rem; border-radius: 12px; font-weight: 700; font-size: 0.8rem; border: 1px solid rgba(255,255,255,0.1);">${req.type}</span>
                  </div>

                  ${showHODIndicator ? `
                  <div style="padding: 0.75rem; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: 10px; margin-bottom: 1.5rem; display: flex; align-items: center; gap: 0.5rem;">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
                      <span style="font-size: 0.65rem; color: var(--accent); font-weight: 700; text-transform: uppercase;">Sudah Disokong oleh HOD</span>
                  </div>` : ''}

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

                  <div style="display: flex; gap: 0.75rem; margin-bottom: 1rem; flex-wrap: wrap;">
                      <button class="neu-btn success-text" style="flex: 1; min-width: 120px;" onclick="window.finalizeLeave(${req.id})">
                         <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                         ${isFullBoss ? (showHODIndicator ? 'Luluskan (Final)' : 'Luluskan (Direct)') : 'Sokong (Recommend)'}
                      </button>
                      <button class="neu-btn danger-text" style="flex: 1; min-width: 100px;" onclick="window.rejectLeave(${req.id})">
                         <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
                         Reject
                      </button>
                      <button class="neu-btn" style="flex: 1; min-width: 100px; color: #94a3b8; border: 1px dashed rgba(255,255,255,0.1);" onclick="window.cancelLeave(${req.id})">
                         <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
                         Batal
                      </button>
                  </div>

                  ${(() => {
                      const applicant = staffList.find(s => s.ic === req.ic);
                      if (applicant && applicant.category === 'Doctor') {
                          return `
                            <div style="padding: 1rem; background: rgba(59, 130, 246, 0.05); border: 1px solid rgba(59, 130, 246, 0.2); border-radius: 12px; margin-top: 0.5rem; display: flex; flex-direction: column; gap: 0.75rem;">
                                <label style="font-size: 0.65rem; color: var(--primary); text-transform: uppercase; font-weight: 700; display: block;">Doktor Locum Pengganti <span style="color: var(--danger); font-size: 0.55rem; float: right;">★ WAJIB ISI SEBELUM APPROVE</span></label>
                                <input type="text" class="neu-inset" value="${req.locumName || ''}" placeholder="Nama Doktor Locum..." oninput="window.updateLocumInfo(${req.id}, 'locumName', this.value)" style="font-size: 0.8rem; padding: 0.5rem; ${!req.locumName ? 'border-color: rgba(239, 68, 68, 0.3);' : ''}">
                                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;">
                                    <input type="date" class="neu-inset" value="${req.locumDate || ''}" onchange="window.updateLocumInfo(${req.id}, 'locumDate', this.value)" style="font-size: 0.75rem; padding: 0.4rem; color-scheme: dark;">
                                    <input type="time" class="neu-inset" value="${req.locumTime || ''}" onchange="window.updateLocumInfo(${req.id}, 'locumTime', this.value)" style="font-size: 0.75rem; padding: 0.4rem; color-scheme: dark;">
                                </div>
                                ${req.locumName && req.locumDate && req.locumTime ? `
                                <button class="neu-btn" onclick="window.printLocumForm(${req.id})" style="padding: 0.4rem; font-size: 0.65rem; background: rgba(59, 130, 246, 0.1); color: var(--primary); border: 1px solid rgba(59, 130, 246, 0.2);">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V2h12v7"></path><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
                                    Print Locum Form
                                </button>` : ''}
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

                <div style="margin-top: 3rem; padding-top: 2rem; border-top: 1px solid rgba(255,255,255,0.05);">
                    <h4 style="font-size: 0.85rem; margin-bottom: 1rem;">Test Notification</h4>
                    <div style="display: flex; gap: 0.75rem;">
                        <input type="tel" id="wa-test-phone" class="neu-inset" placeholder="Contoh: 60123456789" style="flex: 1;">
                        <button class="btn-logout" onclick="window.testWANotification()" style="width: auto; padding: 0.75rem 1.5rem; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: var(--primary);">Test Send</button>
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
                          <tr style="text-transform: uppercase; font-size: 0.65rem; color: var(--text-muted); border-bottom: 1px solid rgba(255,255,255,0.05); letter-spacing: 1px;">
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
                                  ${r.days}d <span style="font-size: 0.6rem; background: rgba(59,130,246,0.1); color: ${r.typeColor}; padding: 0.2rem 0.5rem; border-radius: 4px; border: 1px solid rgba(255,255,255,0.1); vertical-align: top; margin-left: 4px;">${r.type}</span>
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
                                      <button onclick="printLeave(${r.id})" style="background: none; border: none; cursor: pointer; color: #c084fc; transition: transform 0.2s;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V2h12v7"></path><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg></button>
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
                          <tr style="text-transform: uppercase; font-size: 0.65rem; color: var(--text-muted); border-bottom: 1px solid rgba(255,255,255,0.05); letter-spacing: 1px;">
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
                                  <div style="font-size: 0.8rem; font-weight: 600; color: ${log.activity.includes('Logged in') ? 'var(--accent)' : 'var(--text-muted)'}; background: rgba(0,0,0,0.1); padding: 0.5rem 0.75rem; border-radius: 8px; border-left: 2px solid ${log.activity.includes('Logged in') ? 'var(--accent)' : log.activity.includes('Leave') ? 'var(--primary)' : 'var(--text-muted)'}; display: inline-block;">
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

        ${managementTab === 'hr_reports' ? `
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 2rem; margin-top: 1rem;">
              <div style="display: flex; align-items: center; gap: 0.75rem;">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#a855f7" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                  <h2 style="font-size: 1.25rem; font-weight: 600;">Official Leave Reports</h2>
              </div>
              <button onclick="generateLeaveReport()" class="neu-btn primary-text" style="background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.2); font-weight: 600; display: flex; align-items: center; gap: 0.5rem; padding: 0.75rem 1.5rem;">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V2h12v7"></path><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
                  Generate PDF Record
              </button>
          </div>

          <section class="glass-card fade-in" style="padding: 0; overflow: hidden;">
              <div style="overflow-x: auto;">
                  <table class="data-table" style="width: 100%; border-collapse: collapse; margin: 0;">
                      <thead>
                          <tr style="text-transform: uppercase; font-size: 0.65rem; color: var(--text-muted); border-bottom: 1px solid rgba(255,255,255,0.05); letter-spacing: 1px;">
                              <th style="padding: 1.5rem 1rem;">Period</th>
                              <th style="padding: 1.5rem 1rem;">Employee</th>
                              <th style="padding: 1.5rem 1rem;">Type</th>
                              <th style="padding: 1.5rem 1rem;">Reason</th>
                              <th style="padding: 1.5rem 1rem;">Days</th>
                              <th style="padding: 1.5rem 1rem;">Status</th>
                          </tr>
                      </thead>
                      <tbody>
                          ${leaveRecords.map(r => `
                          <tr style="border-bottom: 1px solid rgba(255,255,255,0.03); transition: background 0.2s;">
                              <td style="padding: 1.5rem 1rem;">
                                  <div style="font-weight: 700; font-size: 0.8rem;">${r.startDate}</div>
                                  <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 0.25rem;">${r.startDate === r.endDate ? '' : `to ${r.endDate}`}</div>
                              </td>
                              <td style="padding: 1.5rem 1rem;">
                                  <div style="font-weight: 700; font-size: 0.85rem; text-transform: uppercase; margin-bottom: 0.25rem;">${r.name}</div>
                                  <div style="font-size: 0.65rem; color: var(--text-muted); margin-bottom: 0.25rem;">${r.ic}</div>
                                  <div style="font-size: 0.65rem; color: var(--primary); text-transform: uppercase; font-weight: 600;">${r.branch}</div>
                              </td>
                              <td style="padding: 1.5rem 1rem;">
                                  <div style="font-size: 0.65rem; font-weight: 700; background: rgba(59,130,246,0.1); color: ${r.typeColor}; padding: 0.3rem 0.6rem; border-radius: 4px; border: 1px solid rgba(255,255,255,0.1); display: inline-block;">${r.type}</div>
                              </td>
                              <td style="padding: 1.5rem 1rem; font-size: 0.75rem; font-style: italic; color: var(--text-muted); max-width: 250px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                                  ${r.reason}
                              </td>
                              <td style="padding: 1.5rem 1rem; font-weight: 700; font-size: 1.1rem;">
                                  ${r.days}
                              </td>
                              <td style="padding: 1.5rem 1rem;">
                                  <span style="font-size: 0.6rem; font-weight: 700; text-transform: uppercase; padding: 0.35rem 0.75rem; border-radius: 20px; 
                                      ${r.status === 'REJECTED' ? 'color: var(--danger); background: rgba(239, 68, 68, 0.1);' : 
                                        r.status.includes('HOD') ? 'color: #eab308; background: rgba(234, 179, 8, 0.1);' : 
                                        r.status === 'PENDING' ? 'color: #eab308; border: 1px solid rgba(234, 179, 8, 0.4);' : 
                                        'color: var(--accent); background: rgba(34, 197, 94, 0.1);'}">
                                      ${r.status}
                                  </span>
                              </td>
                          </tr>
                          `).join('')}
                      </tbody>
                  </table>
              </div>
          </section>
        ` : ''}
        
        ${managementTab === 'staff' ? `
        <header class="top-bar">
          <h1>Management Hub</h1>
          <button class="btn-primary" style="width: auto; padding: 0.75rem 1.5rem;">+ Add Staff</button>
        </header>

        <section class="glass-card">
          <div class="tabs-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 1rem; flex-wrap: wrap; gap: 1rem;">
            <div style="display: flex; gap: 2rem;">
              <div style="color: var(--primary); font-weight: 600; cursor: pointer;">Staff Directory</div>

            </div>
            <div style="display: flex; gap: 1.5rem; align-items: center; flex-wrap: wrap;">
              
              <div style="display: flex; align-items: center; gap: 0.75rem;">
                 <div class="neu-toggle ${showInactiveStaff ? 'active' : ''}" onclick="window.toggleInactive()"></div>
                 <span style="font-size: 0.75rem; font-weight: 600; color: var(--text-muted); letter-spacing: 0.5px; text-transform: uppercase;">Show Inactive</span>
              </div>
              
              <input type="text" id="manage-staff-search" class="neu-inset" placeholder="Search Staff..." value="${manageSearchQuery}" oninput="window.setManageSearch(this.value)" style="width: 200px; padding: 0.5rem 1rem; border-radius: 12px; font-size: 0.85rem; color-scheme: dark;">
              
              <select id="branch-filter" style="padding: 0.5rem 1rem; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.05); color: white; cursor: pointer; outline: none; color-scheme: dark; font-weight: 600;">
                <option value="All" ${manageBranchFilter === 'All' ? 'selected' : ''}>Semua Cawangan (${staffList.length})</option>
                ${branches.map(b => `
                  <option value="${b.name}" ${manageBranchFilter === b.name ? 'selected' : ''}>
                    ${b.name} (${staffList.filter(s => s.branch === b.name).length})
                  </option>
                `).join('')}
              </select>
            </div>
          </div>
          
          <div id="manage-content" style="max-height: 500px; overflow: auto; border-radius: 12px; background: rgba(0,0,0,0.1); border: 1px solid rgba(255,255,255,0.05);">
            <table class="data-table" style="min-width: 1400px;">
              <thead>
                <tr>
                  <th style="position: sticky; left: 0; background: #1e3a8a; z-index: 10;">Name</th>
                  <th style="min-width: 120px;">IC Number</th>
                  <th style="min-width: 150px;">Branch</th>
                  <th style="min-width: 120px;">Role / Cat</th>
                  <th style="min-width: 100px; color: #38bdf8;">AL (Annual)</th>
                  <th style="min-width: 100px; color: #10b981;">MC (Medical)</th>
                  <th style="min-width: 100px; color: #06b6d4;">HL (Hosp)</th>
                  <th style="min-width: 100px; color: #14b8a6;">RL (Replace)</th>
                  <th style="min-width: 100px; color: #ec4899;">ML (Matern)</th>
                  <th style="min-width: 100px; color: #f472b6;">PL (Patern)</th>
                  <th style="min-width: 100px; color: #f59e0b;">EL (Emerge)</th>
                  <th style="min-width: 100px; color: #fbbf24;">BL (Ihsan)</th>
                  <th style="min-width: 100px; color: #94a3b8;">UL (Unpaid)</th>
                  <th style="min-width: 100px; color: #818cf8;">CF (Carry)</th>
                  <th style="text-align: right; position: sticky; right: 0; background: #1e3a8a; z-index: 10;">Actions</th>
                </tr>
              </thead>
              <tbody>
                ${filteredStaff.map(staff => {
                  const al = window.getLeaveStats(staff, 'AL');
                  const mc = window.getLeaveStats(staff, 'MC');
                  const hl = window.getLeaveStats(staff, 'HL');
                  const rl = window.getLeaveStats(staff, 'REPLACEMENT');
                  const ml = window.getLeaveStats(staff, 'ML');
                  const pl = window.getLeaveStats(staff, 'PL');
                  const el = window.getLeaveStats(staff, 'EL_EMG');
                  const bl = window.getLeaveStats(staff, 'EL');
                  const ul = window.getLeaveStats(staff, 'UP');
                  const cf = { used: 0, ent: staff.ent_CF || 0, bal: staff.ent_CF || 0 };
                  
                  return `
                  <tr>
                    <td style="position: sticky; left: 0; background: rgba(30, 58, 138, 0.9); z-index: 5; font-weight: 700; backdrop-filter: blur(10px);">
                      ${staff.name}
                      ${staff.inactive ? `<br><span style="margin-top: 4px; display: inline-block; background: rgba(239, 68, 68, 0.1); color: var(--danger); font-size: 0.65rem; padding: 0.2rem 0.5rem; border-radius: 4px; font-weight: 600; letter-spacing: 0.5px; border: 1px solid rgba(239,68,68,0.2);">TIDAK AKTIF</span>` : ''}
                    </td>
                    <td>${staff.ic}</td>
                    <td><span style="font-size: 0.85rem; color: var(--text-muted);">${staff.branch}</span></td>
                    <td>
                      <span class="status-badge approved" style="text-transform: capitalize; margin-bottom: 4px; display: inline-block;">${staff.role}</span>
                      <br>
                      <span style="font-size: 0.75rem; color: var(--text-muted);">${staff.category}</span>
                    </td>
                    <td><span style="font-weight:700; color:#38bdf8;">${al.used.toFixed(1)}</span> <span style="font-size: 0.7rem; color: var(--text-muted);">/ ${al.ent.toFixed(1)}</span></td>
                    <td><span style="font-weight:700; color:#10b981;">${mc.used}</span> <span style="font-size: 0.7rem; color: var(--text-muted);">/ ${mc.ent}</span></td>
                    <td><span style="font-weight:700; color:#06b6d4;">${hl.used}</span> <span style="font-size: 0.7rem; color: var(--text-muted);">/ ${hl.ent}</span></td>
                    <td><span style="font-weight:700; color:#14b8a6;">${rl.used}</span></td>
                    <td><span style="font-weight:700; color:#ec4899;">${ml.used}</span> <span style="font-size: 0.7rem; color: var(--text-muted);">/ ${ml.ent}</span></td>
                    <td><span style="font-weight:700; color:#f472b6;">${pl.used}</span></td>
                    <td><span style="font-weight:700; color:#f59e0b;">${el.used}</span></td>
                    <td><span style="font-weight:700; color:#fbbf24;">${bl.used}</span> <span style="font-size: 0.7rem; color: var(--text-muted);">/ ${bl.ent}</span></td>
                    <td><span style="font-weight:700; color:#94a3b8;">${ul.used}</span></td>
                    <td><span style="font-weight:700; color:#818cf8;">${cf.ent}</span></td>
                    <td style="text-align: right; position: sticky; right: 0; background: rgba(30, 58, 138, 0.9); z-index: 5; backdrop-filter: blur(10px);">
                      <button class="btn-logout" onclick="window.setEditingStaff('${staff.ic}')" style="width: auto; padding: 0.25rem 0.75rem; font-size: 0.75rem;">Edit</button>
                    </td>
                  </tr>
                `}).join('')}
              </tbody>
            </table>

            ${filteredStaff.length === 0 ? `<div style="text-align: center; padding: 2rem; color: var(--text-muted);">Tiada rekod staff di cawangan ini.</div>` : ''}
          </div>
        </section>
        ` : ''}

        ${managementTab === 'branches' ? `
        <section class="glass-card">
          <h3>Branches & Log Preview</h3>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-top: 1.5rem;">
            <div>
              <h4 style="margin-bottom: 1rem; color: var(--primary);">Branch Network</h4>
              <div style="max-height: 220px; overflow-y: auto; padding-right: 5px;">
                ${branches.map(b => `<div style="padding: 1rem; border-bottom: 1px solid rgba(255,255,255,0.03); display: flex; justify-content: space-between;"><span>${b.name}</span> <span style="color: var(--text-muted); font-size: 0.75rem;">${b.state}</span></div>`).join('')}
              </div>
              ${canManageBranches ? `
              <form id="add-branch-form" style="margin-top: 1rem; display: flex; gap: 0.5rem;">
                <input type="text" placeholder="New Branch Name..." required style="flex: 1; padding: 0.5rem 1rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.05); color: white;">
                <button type="submit" class="btn-primary" style="padding: 0.5rem 1rem; width: auto;">+ Branch</button>
              </form>
              ` : ''}
            </div>
            <div>
              <h4 style="margin-bottom: 1rem; color: var(--secondary);">System Record History</h4>
              ${systemAuditLogs.slice(0, 3).map(l => `<div style="padding: 1rem; border-bottom: 1px solid rgba(255,255,255,0.03); font-size: 0.75rem;"><strong>${l.name}</strong>: ${l.activity} <div style="color: var(--text-muted);">${l.timestamp}</div></div>`).join('')}
            </div>
          </div>
        </section>
        ` : ''}

        ${managementTab === 'access_control' ? (() => {
          const renderRbacDashboardCell = (role) => {
              const val = window.rbacMatrix[role].dashboard;
              if (val === 'analisa') {
                  return `<td style="padding: 1.5rem; border-right: 1px solid rgba(255,255,255,0.05); cursor: pointer;" onclick="window.toggleRbac('${role}', 'dashboard')">
                              <div style="display: flex; flex-direction: column; gap: 0.5rem; align-items: flex-start; pointer-events: none;">
                                  <div style="background: rgba(16, 185, 129, 0.2); color: #34d399; border-radius: 4px; display: inline-flex; width: 20px; height: 20px; align-items: center; justify-content: center;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg></div>
                                  <span style="font-size: 0.72rem; font-weight: 600; color: #cbd5e1; letter-spacing: 0.5px;">ANALISA<br>CUTI</span>
                              </div>
                          </td>`;
              } else {
                  return `<td style="padding: 0.85rem 1rem; border-right: 1px solid rgba(255,255,255,0.05); cursor: pointer;" onclick="window.toggleRbac('${role}', 'dashboard')">
                              <div style="display: flex; gap: 0.5rem; align-items: center; pointer-events: none;">
                                  <span style="font-size: 0.8rem;">📋</span> <span style="font-size: 0.72rem; font-weight: 600; color: #cbd5e1;">Staff<br>View</span>
                              </div>
                          </td>`;
              }
          };

          const renderRbacCell = (role, module) => {
              const checked = window.rbacMatrix[role][module];
              if (checked) {
                  return `<td style="padding: 0.85rem 1rem; border-right: 1px solid rgba(255,255,255,0.05); cursor: pointer;" onclick="window.toggleRbac('${role}', '${module}')"><div style="background: rgba(16, 185, 129, 0.2); color: #34d399; border-radius: 4px; display: inline-flex; width: 20px; height: 20px; align-items: center; justify-content: center; pointer-events: none;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg></div></td>`;
              } else {
                  return `<td style="padding: 0.85rem 1rem; border-right: 1px solid rgba(255,255,255,0.05); cursor: pointer;" onclick="window.toggleRbac('${role}', '${module}')"><div style="display: flex; align-items: center; gap: 0.4rem; color: var(--text-muted); font-weight: 500; font-size: 0.72rem; pointer-events: none;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg> Hidden</div></td>`;
              }
          };

          return `
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 2rem; margin-top: 1rem;">
              <div style="display: flex; align-items: center; gap: 0.75rem;">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                  <h2 style="font-size: 1.25rem; font-weight: 600;">Role-Based Access Control matrix</h2>
              </div>
              <button onclick="window.saveRbac()" class="btn-primary" style="width: auto; padding: 0.75rem 1.75rem; display: flex; align-items: center; gap: 0.6rem; font-weight: 600; background: linear-gradient(135deg, var(--primary) 0%, var(--secondary) 100%);">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
                  Simpan Tetapan Matrix
              </button>
          </div>
          <section class="glass-card fade-in" style="padding: 0; overflow: hidden; border: 1px solid rgba(255,255,255,0.05);">
              <div style="overflow-x: auto;">
                  <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.75rem;">
                      <thead>
                          <tr style="background: rgba(255,255,255,0.03); color: var(--text-muted); border-bottom: 1px solid rgba(255,255,255,0.05);">
                              <th style="padding: 0.85rem 1rem; font-weight: 600; border-right: 1px solid rgba(255,255,255,0.05);">Role</th>
                              <th style="padding: 0.85rem 1rem; font-weight: 600; border-right: 1px solid rgba(255,255,255,0.05); color: #94a3b8;">Dashboard</th>
                              <th style="padding: 0.85rem 1rem; font-weight: 600; border-right: 1px solid rgba(255,255,255,0.05); color: #818cf8;">Leave Req</th>
                              <th style="padding: 0.85rem 1rem; font-weight: 600; border-right: 1px solid rgba(255,255,255,0.05); color: #fbbf24;">Manage</th>
                              <th style="padding: 0.85rem 1rem; font-weight: 600; border-right: 1px solid rgba(255,255,255,0.05); color: #2dd4bf;">Policy</th>
                              <th style="padding: 0.85rem 1rem; font-weight: 600; border-right: 1px solid rgba(255,255,255,0.05); color: #a1a1aa;">Settings</th>
                              <th style="padding: 0.85rem 1rem; font-weight: 600; border-right: 1px solid rgba(255,255,255,0.05); color: #10b981;">WA Set</th>
                              <th style="padding: 0.85rem 1rem; font-weight: 600; border-right: 1px solid rgba(255,255,255,0.05); color: #f59e0b;">Pen App</th>
                              <th style="padding: 0.85rem 1rem; font-weight: 600; border-right: 1px solid rgba(255,255,255,0.05); color: #38bdf8;">Staff</th>
                              <th style="padding: 0.85rem 1rem; font-weight: 600; border-right: 1px solid rgba(255,255,255,0.05); color: #a855f7;">Branch</th>
                              <th style="padding: 0.85rem 1rem; font-weight: 600; border-right: 1px solid rgba(255,255,255,0.05); color: #ec4899;">Master</th>
                              <th style="padding: 0.85rem 1rem; font-weight: 600; border-right: 1px solid rgba(255,255,255,0.05); color: #10b981;">Login</th>
                              <th style="padding: 0.85rem 1rem; font-weight: 600; border-right: 1px solid rgba(255,255,255,0.05); color: #f97316;">Report</th>
                              <th style="padding: 0.85rem 1rem; font-weight: 600; border-right: 1px solid rgba(255,255,255,0.05); color: #ef4444;">Access</th>
                              <th style="padding: 0.85rem 1rem; font-weight: 600; border-right: 1px solid rgba(255,255,255,0.05); color: #f43f5e;">Batal</th>
                              <th style="padding: 0.85rem 1rem; font-weight: 600; border-right: 1px solid rgba(255,255,255,0.05); color: #38bdf8;">O/S Balok</th>
                              <th style="padding: 0.85rem 1rem; font-weight: 600; color: #fbbf24;">O/S Pahang</th>
                          </tr>
                      </thead>
                      <tbody>
                          <!-- Super Admin -->
                          <tr style="border-bottom: 2px solid rgba(59, 130, 246, 0.3); background: rgba(59, 130, 246, 0.05); transition: background 0.2s;" onmouseover="this.style.background='rgba(59, 130, 246, 0.08)'" onmouseout="this.style.background='rgba(59, 130, 246, 0.05)'">
                              <td style="padding: 0.85rem 1rem; font-weight: 800; font-size: 0.85rem; border-right: 1px solid rgba(255,255,255,0.05); color: #60a5fa;">Super Admin</td>
                              ${renderRbacDashboardCell('super_admin')}
                              ${renderRbacCell('super_admin', 'leave_request')}
                              ${renderRbacCell('super_admin', 'management')}
                              ${renderRbacCell('super_admin', 'policy')}
                              ${renderRbacCell('super_admin', 'settings')}
                              ${renderRbacCell('super_admin', 'wa_setting')}
                              ${renderRbacCell('super_admin', 'manage_pending')}
                              ${renderRbacCell('super_admin', 'manage_staff')}
                              ${renderRbacCell('super_admin', 'manage_branches')}
                              ${renderRbacCell('super_admin', 'manage_audit')}
                              ${renderRbacCell('super_admin', 'manage_login_audit')}
                              ${renderRbacCell('super_admin', 'manage_reports')}
                              ${renderRbacCell('super_admin', 'manage_access')}
                              ${renderRbacCell('super_admin', 'can_cancel')}
                              ${renderRbacCell('super_admin', 'os_balok')}
                              ${renderRbacCell('super_admin', 'os_pahang')}
                          </tr>
                          <!-- Admin -->
                          <tr style="border-bottom: 1px solid rgba(255,255,255,0.05); transition: background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.02)'" onmouseout="this.style.background='transparent'">
                              <td style="padding: 0.85rem 1rem; font-weight: 700; font-size: 0.85rem; border-right: 1px solid rgba(255,255,255,0.05); color: #facc15;">Admin</td>
                              ${renderRbacDashboardCell('admin')}
                              ${renderRbacCell('admin', 'leave_request')}
                              ${renderRbacCell('admin', 'management')}
                              ${renderRbacCell('admin', 'policy')}
                              ${renderRbacCell('admin', 'settings')}
                              ${renderRbacCell('admin', 'wa_setting')}
                              ${renderRbacCell('admin', 'manage_pending')}
                              ${renderRbacCell('admin', 'manage_staff')}
                              ${renderRbacCell('admin', 'manage_branches')}
                              ${renderRbacCell('admin', 'manage_audit')}
                              ${renderRbacCell('admin', 'manage_login_audit')}
                              ${renderRbacCell('admin', 'manage_reports')}
                              ${renderRbacCell('admin', 'manage_access')}
                              ${renderRbacCell('admin', 'can_cancel')}
                              ${renderRbacCell('admin', 'os_balok')}
                              ${renderRbacCell('admin', 'os_pahang')}
                          </tr>
                          <!-- HR -->
                          <tr style="border-bottom: 1px solid rgba(255,255,255,0.05); transition: background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.02)'" onmouseout="this.style.background='transparent'">
                              <td style="padding: 0.85rem 1rem; font-weight: 700; font-size: 0.85rem; border-right: 1px solid rgba(255,255,255,0.05); color: #c084fc;">HR</td>
                              ${renderRbacDashboardCell('hr')}
                              ${renderRbacCell('hr', 'leave_request')}
                              ${renderRbacCell('hr', 'management')}
                              ${renderRbacCell('hr', 'policy')}
                              ${renderRbacCell('hr', 'settings')}
                              ${renderRbacCell('hr', 'wa_setting')}
                              ${renderRbacCell('hr', 'manage_pending')}
                              ${renderRbacCell('hr', 'manage_staff')}
                              ${renderRbacCell('hr', 'manage_branches')}
                              ${renderRbacCell('hr', 'manage_audit')}
                              ${renderRbacCell('hr', 'manage_login_audit')}
                              ${renderRbacCell('hr', 'manage_reports')}
                              ${renderRbacCell('hr', 'manage_access')}
                              ${renderRbacCell('hr', 'can_cancel')}
                              ${renderRbacCell('hr', 'os_balok')}
                              ${renderRbacCell('hr', 'os_pahang')}
                          </tr>
                          <!-- HOD -->
                          <tr style="border-bottom: 1px solid rgba(255,255,255,0.05); transition: background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.02)'" onmouseout="this.style.background='transparent'">
                              <td style="padding: 0.85rem 1rem; font-weight: 700; font-size: 0.85rem; border-right: 1px solid rgba(255,255,255,0.05); color: #22d3ee;">HOD</td>
                              ${renderRbacDashboardCell('hod')}
                              ${renderRbacCell('hod', 'leave_request')}
                              ${renderRbacCell('hod', 'management')}
                              ${renderRbacCell('hod', 'policy')}
                              ${renderRbacCell('hod', 'settings')}
                              ${renderRbacCell('hod', 'wa_setting')}
                              ${renderRbacCell('hod', 'manage_pending')}
                              ${renderRbacCell('hod', 'manage_staff')}
                              ${renderRbacCell('hod', 'manage_branches')}
                              ${renderRbacCell('hod', 'manage_audit')}
                              ${renderRbacCell('hod', 'manage_login_audit')}
                              ${renderRbacCell('hod', 'manage_reports')}
                              ${renderRbacCell('hod', 'manage_access')}
                              ${renderRbacCell('hod', 'can_cancel')}
                              ${renderRbacCell('hod', 'os_balok')}
                              ${renderRbacCell('hod', 'os_pahang')}
                          </tr>
                          <!-- PIC/HOD -->
                          <tr style="border-bottom: 1px solid rgba(255,255,255,0.05); transition: background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.02)'" onmouseout="this.style.background='transparent'">
                              <td style="padding: 0.85rem 1rem; font-weight: 700; font-size: 0.85rem; border-right: 1px solid rgba(255,255,255,0.05); color: #fb923c;">PIC/HOD</td>
                              ${renderRbacDashboardCell('pic_hod')}
                              ${renderRbacCell('pic_hod', 'leave_request')}
                              ${renderRbacCell('pic_hod', 'management')}
                              ${renderRbacCell('pic_hod', 'policy')}
                              ${renderRbacCell('pic_hod', 'settings')}
                              ${renderRbacCell('pic_hod', 'wa_setting')}
                              ${renderRbacCell('pic_hod', 'manage_pending')}
                              ${renderRbacCell('pic_hod', 'manage_staff')}
                              ${renderRbacCell('pic_hod', 'manage_branches')}
                              ${renderRbacCell('pic_hod', 'manage_audit')}
                              ${renderRbacCell('pic_hod', 'manage_login_audit')}
                              ${renderRbacCell('pic_hod', 'manage_reports')}
                              ${renderRbacCell('pic_hod', 'manage_access')}
                              ${renderRbacCell('pic_hod', 'can_cancel')}
                              ${renderRbacCell('pic_hod', 'os_balok')}
                              ${renderRbacCell('pic_hod', 'os_pahang')}
                          </tr>
                          <!-- Supervisor -->
                          <tr style="border-bottom: 1px solid rgba(255,255,255,0.05); transition: background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.02)'" onmouseout="this.style.background='transparent'">
                              <td style="padding: 0.85rem 1rem; font-weight: 700; font-size: 0.85rem; border-right: 1px solid rgba(255,255,255,0.05); color: #4ade80;">Supervisor</td>
                              ${renderRbacDashboardCell('supervisor')}
                              ${renderRbacCell('supervisor', 'leave_request')}
                              ${renderRbacCell('supervisor', 'management')}
                              ${renderRbacCell('supervisor', 'policy')}
                              ${renderRbacCell('supervisor', 'settings')}
                              ${renderRbacCell('supervisor', 'wa_setting')}
                              ${renderRbacCell('supervisor', 'manage_pending')}
                              ${renderRbacCell('supervisor', 'manage_staff')}
                              ${renderRbacCell('supervisor', 'manage_branches')}
                              ${renderRbacCell('supervisor', 'manage_audit')}
                              ${renderRbacCell('supervisor', 'manage_login_audit')}
                              ${renderRbacCell('supervisor', 'manage_reports')}
                              ${renderRbacCell('supervisor', 'manage_access')}
                              ${renderRbacCell('supervisor', 'can_cancel')}
                              ${renderRbacCell('supervisor', 'os_balok')}
                              ${renderRbacCell('supervisor', 'os_pahang')}
                          </tr>
                          <!-- Staff -->
                          <tr style="transition: background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.02)'" onmouseout="this.style.background='transparent'">
                              <td style="padding: 0.85rem 1rem; font-weight: 700; font-size: 0.82rem; border-right: 1px solid rgba(255,255,255,0.05);">Staff</td>
                              ${renderRbacDashboardCell('staff')}
                              ${renderRbacCell('staff', 'leave_request')}
                              ${renderRbacCell('staff', 'management')}
                              ${renderRbacCell('staff', 'policy')}
                              ${renderRbacCell('staff', 'settings')}
                              ${renderRbacCell('staff', 'wa_setting')}
                              ${renderRbacCell('staff', 'manage_pending')}
                              ${renderRbacCell('staff', 'manage_staff')}
                              ${renderRbacCell('staff', 'manage_branches')}
                              ${renderRbacCell('staff', 'manage_audit')}
                              ${renderRbacCell('staff', 'manage_login_audit')}
                              ${renderRbacCell('staff', 'manage_reports')}
                              ${renderRbacCell('staff', 'manage_access')}
                              ${renderRbacCell('staff', 'can_cancel')}
                              ${renderRbacCell('staff', 'os_balok')}
                              ${renderRbacCell('staff', 'os_pahang')}
                          </tr>
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
                    <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1.5rem; color: #60a5fa; font-weight: 700; letter-spacing: 1px; text-transform: uppercase;">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"></path><path d="M22 12A10 10 0 0 0 12 2v10z"></path></svg>
                        Formula Pengiraan Pro-Rata
                    </div>
                    <p style="color: var(--text-muted); font-size: 0.9rem; margin-bottom: 2rem;">Untuk mendapatkan jumlah cuti yang layak bagi setiap bulan bekerja:</p>
                    
                    <div style="display: flex; justify-content: center; align-items: center; gap: 1rem; margin-bottom: 2.5rem; font-weight: 700;">
                       <span style="color: var(--text-muted);">Cuti Pro-Rata Sebulan</span>
                       <span style="color: #60a5fa; font-size: 1.5rem;">=</span>
                       <div style="display: flex; flex-direction: column; align-items: center; gap: 0.5rem;">
                          <span>Kelayakan Cuti Setahun</span>
                          <div style="width: 100%; height: 2px; background: currentColor;"></div>
                          <span>12 Bulan</span>
                       </div>
                    </div>

                    <div class="neu-panel" style="padding: 1.5rem; background: rgba(0,0,0,0.2);">
                       <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1.5rem; color: var(--text-muted); font-weight: 700; font-size: 0.75rem; letter-spacing: 1px;">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>
                          BAGI KES ANDA (${currentMonthName}) - CUTI TAHUNAN (AL)
                       </div>
                       
                       <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; margin-bottom: 2rem;">
                          <div>
                             <div style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 0.5rem;">Kelayakan Setahun</div>
                             <div style="font-size: 2rem; font-weight: 700; color: #60a5fa;">${entitlementAL} <span style="font-size: 1rem; color: var(--text-muted); font-weight: 500;">hari</span></div>
                          </div>
                          <div>
                             <div style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 0.5rem;">Pro-Rata Sebulan</div>
                             <div style="font-size: 2rem; font-weight: 700; color: #c084fc;">${(entitlementAL / 12).toFixed(2)} <span style="font-size: 1rem; color: var(--text-muted); font-weight: 500;">hari</span></div>
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

                       <div style="text-align: right; font-size: 0.75rem; color: #60a5fa; font-style: italic; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 1rem; font-weight: 600;">
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
                     <h3 style="color: #60a5fa; font-size: 1rem; margin-bottom: 0.5rem;">Negeri Pahang</h3>
                     <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.85rem; color: var(--text-muted);">
                        <thead>
                            <tr style="background: rgba(255,255,255,0.05); color: #fff;">
                                <th style="padding: 0.5rem; border: 1px solid rgba(255,255,255,0.1);">Tempoh Berkhidmat</th>
                                <th style="padding: 0.5rem; border: 1px solid rgba(255,255,255,0.1);">Kelayakan Tahunan (AL)</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td style="padding: 0.5rem; border: 1px solid rgba(255,255,255,0.1);">Sehingga 5 tahun</td>
                                <td style="padding: 0.5rem; border: 1px solid rgba(255,255,255,0.1);">16 Hari</td>
                            </tr>
                            <tr style="background: rgba(59, 130, 246, 0.1);">
                                <td style="padding: 0.5rem; border: 1px solid rgba(255,255,255,0.1); color: #60a5fa; font-weight: bold;">Lebih 5 Tahun ke atas</td>
                                <td style="padding: 0.5rem; border: 1px solid rgba(255,255,255,0.1); color: #60a5fa; font-weight: bold;">20 Hari</td>
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
                            <tr style="background: rgba(255,255,255,0.05); color: #fff;">
                                <th style="padding: 0.5rem; border: 1px solid rgba(255,255,255,0.1);">Tempoh Berkhidmat</th>
                                <th style="padding: 0.5rem; border: 1px solid rgba(255,255,255,0.1);">Kelayakan Tahunan (AL)</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr style="background: rgba(192, 132, 252, 0.1);">
                                <td style="padding: 0.5rem; border: 1px solid rgba(255,255,255,0.1); color: var(--accent); font-weight: bold;">Semua Tempoh</td>
                                <td style="padding: 0.5rem; border: 1px solid rgba(255,255,255,0.1); color: var(--accent); font-weight: bold;">16 Hari</td>
                            </tr>
                        </tbody>
                     </table>
                     <p style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.5rem; font-style: italic;">*Terhad kepada cawangan Dungun, Kerteh, dan Paka.</p>
                   </div>
                   ` : ''}

                   <!-- Kategori Doktor -->
                   <div style="margin-top: 2rem;">
                     <h3 style="color: #fca5a5; font-size: 1rem; margin-bottom: 0.5rem;">Kategori Doktor (Semua Kawasan)</h3>
                     <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.85rem; color: var(--text-muted);">
                        <thead>
                            <tr style="background: rgba(255,255,255,0.05); color: #fff;">
                                <th style="padding: 0.5rem; border: 1px solid rgba(255,255,255,0.1);">Peringkat Cuti Tahunan (AL)</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td style="padding: 0.5rem; border: 1px solid rgba(255,255,255,0.1); color: #fca5a5; font-weight: bold;">25 Hari</td>
                            </tr>
                            <tr style="background: rgba(248, 113, 113, 0.1);">
                                <td style="padding: 0.5rem; border: 1px solid rgba(255,255,255,0.1); color: #fca5a5; font-weight: bold;">20 Hari</td>
                            </tr>
                            <tr>
                                <td style="padding: 0.5rem; border: 1px solid rgba(255,255,255,0.1); color: #fca5a5; font-weight: bold;">10 Hari</td>
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
                                <tr style="background: rgba(255,255,255,0.05); color: #fff;">
                                    <th style="padding: 0.5rem; border: 1px solid rgba(255,255,255,0.1);">Aspek</th>
                                    <th style="padding: 0.5rem; border: 1px solid rgba(255,255,255,0.1); color: var(--danger);">Cuti Kecemasan (EL)</th>
                                    <th style="padding: 0.5rem; border: 1px solid rgba(255,255,255,0.1); color: #c084fc;">Cuti Ehsan (Compassionate)</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td style="padding: 0.5rem; border: 1px solid rgba(255,255,255,0.1);"><strong>Tujuan</strong></td>
                                    <td style="padding: 0.5rem; border: 1px solid rgba(255,255,255,0.1);">Kecemasan peribadi (kereta rosak, banjir, isteri bersalin kecemasan dll)</td>
                                    <td style="padding: 0.5rem; border: 1px solid rgba(255,255,255,0.1);">Kematian ahli keluarga terdekat <em>(Ibu, Bapa, Suami/Isteri, Anak sahaja)</em></td>
                                </tr>
                                <tr>
                                    <td style="padding: 0.5rem; border: 1px solid rgba(255,255,255,0.1);"><strong>Tolak Baki Cuti?</strong></td>
                                    <td style="padding: 0.5rem; border: 1px solid rgba(255,255,255,0.1);">Ya. Ditolak dari Annual Leave (AL)</td>
                                    <td style="padding: 0.5rem; border: 1px solid rgba(255,255,255,0.1);">Tambahan Percuma (Tanpa tolak AL)</td>
                                </tr>
                                <tr>
                                    <td style="padding: 0.5rem; border: 1px solid rgba(255,255,255,0.1);"><strong>Had Limit</strong></td>
                                    <td style="padding: 0.5rem; border: 1px solid rgba(255,255,255,0.1);">Fleksibel (Mengikut baki AL sedia ada)</td>
                                    <td style="padding: 0.5rem; border: 1px solid rgba(255,255,255,0.1);">Max 3 Hari berturut-turut untuk setiap kes</td>
                                </tr>
                                <tr>
                                    <td style="padding: 0.5rem; border: 1px solid rgba(255,255,255,0.1);"><strong>Bukti WAJIB</strong></td>
                                    <td style="padding: 0.5rem; border: 1px solid rgba(255,255,255,0.1);">Gambar kemalangan / tayar pancit dll</td>
                                    <td style="padding: 0.5rem; border: 1px solid rgba(255,255,255,0.1);">Sijil Kematian</td>
                                </tr>
                            </tbody>
                          </table>
                          <p style="color: var(--danger); font-size: 0.8rem; margin-top: 1rem; font-style: italic;">*Nota: Borang yang dihantar tanpa dokumen sokongan akan dihalang oleh sistem serta-merta.</p>
                       </div>

                       <div class="neu-panel" style="border-left: 4px solid #c084fc; padding-left: 1.5rem;">
                          <h3 style="font-size: 1rem; color: #c084fc; margin-bottom: 0.5rem;">4. Cuti Pendidikan (CME Leave)</h3>
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
                  <h2 style="font-size: 1.1rem; font-weight: 600; color: white; margin-bottom: 1.5rem; display: flex; align-items: center; gap: 0.5rem;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg> Cuti Umum / Public Holidays (Pahang 2026)</h2>
                  
                  <div style="background: rgba(0,0,0,0.2); border-radius: 12px; padding: 1.5rem; font-size: 0.85rem; border: 1px solid rgba(255,255,255,0.05);">
                      <div style="color: var(--primary); font-weight: 600; margin-bottom: 1.5rem; text-align: center; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 0.75rem; text-transform: uppercase;">Jumlah: 15 Hari Pelepasan Am</div>
                      <table style="width: 100%; border-collapse: collapse; color: var(--text-muted); font-weight: 600; font-size: 0.8rem;">
                          <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);"><td style="padding: 0.75rem 0;">1 Jan</td><td style="text-align: right; color: rgba(255,255,255,0.85);">New Year's Day</td></tr>
                          <tr style="border-bottom: 1px solid rgba(255,255,255,0.05); color: var(--danger);"><td style="padding: 0.75rem 0;">29-30 Jan</td><td style="text-align: right; color: rgba(255,255,255,0.85);">Chinese New Year</td></tr>
                          <tr style="border-bottom: 1px solid rgba(255,255,255,0.05); color: var(--accent);"><td style="padding: 0.75rem 0;">20-21 Mar</td><td style="text-align: right; color: rgba(255,255,255,0.85);">Hari Raya Puasa</td></tr>
                          <tr style="border-bottom: 1px solid rgba(255,255,255,0.05); color: #eab308;"><td style="padding: 0.75rem 0;">1 May</td><td style="text-align: right; color: rgba(255,255,255,0.85);">Labour Day</td></tr>
                          <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);"><td style="padding: 0.75rem 0;">7 May</td><td style="text-align: right; color: rgba(255,255,255,0.85);">Hari Hol Pahang</td></tr>
                          <tr style="border-bottom: 1px solid rgba(255,255,255,0.05); color: var(--accent);"><td style="padding: 0.75rem 0;">27 May</td><td style="text-align: right; color: rgba(255,255,255,0.85);">Hari Raya Haji</td></tr>
                          <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);"><td style="padding: 0.75rem 0;">6 Jul</td><td style="text-align: right; color: rgba(255,255,255,0.85);">Awal Muharram</td></tr>
                          <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);"><td style="padding: 0.75rem 0;">31 Aug</td><td style="text-align: right; color: rgba(255,255,255,0.85);">National Day</td></tr>
                          <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);"><td style="padding: 0.75rem 0;">14 Sep</td><td style="text-align: right; color: rgba(255,255,255,0.85);">Maulidur Rasul</td></tr>
                          <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);"><td style="padding: 0.75rem 0;">16 Sep</td><td style="text-align: right; color: rgba(255,255,255,0.85);">Malaysia Day</td></tr>
                          <tr><td style="padding: 0.75rem 0;">25 Dec</td><td style="text-align: right; color: rgba(255,255,255,0.85);">Christmas Day</td></tr>
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
                    <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 1rem;">
                        <span style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600; letter-spacing: 1px;">Full Name</span>
                        <span style="font-weight: 600;">${user.name}</span>
                    </div>

                    <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 1rem;">
                        <span style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600; letter-spacing: 1px;">IC Number</span>
                        <span style="font-weight: 600;">${user.ic}</span>
                    </div>

                    <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 1rem;">
                        <span style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600; letter-spacing: 1px;">Phone</span>
                        <span style="font-weight: 600;">${user.phone || 'Belum ditetapkan'}</span>
                    </div>

                    <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 1rem;">
                        <span style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600; letter-spacing: 1px; display: flex; align-items: center; gap: 0.25rem;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg> Email</span>
                        ${user.email ? `<span style="font-weight: 600; font-size: 0.85rem;">${user.email}</span>` : `<span style="font-weight: 600; font-size: 0.8rem; color: var(--warning); display: flex; align-items: center; gap: 0.25rem;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg> Belum ditetapkan &mdash; Klik Edit</span>`}
                    </div>
                    
                    <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 1rem;">
                        <span style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600; letter-spacing: 1px;">Access Level</span>
                        <span style="font-weight: 700; font-size: 0.75rem; background: rgba(59, 130, 246, 0.1); color: var(--primary); padding: 0.25rem 0.75rem; border-radius: 20px; border: 1px solid rgba(59, 130, 246, 0.2); text-transform: uppercase;">${user.role}</span>
                    </div>

                    <div style="display: flex; flex-direction: column; gap: 0.25rem; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 1rem;">
                        <span style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600; letter-spacing: 1px;">Address</span>
                        <span style="font-weight: 600; font-size: 0.9rem;">System Root</span>
                    </div>

                    <div style="display: flex; flex-direction: column; gap: 0.25rem; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 1rem;">
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
                
                <form style="display: flex; flex-direction: column; gap: 1.5rem;" onsubmit="event.preventDefault(); alert('Katalaluan (Password) telah berjaya ditukar!');">
                    <div>
                        <label style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600; letter-spacing: 1px; margin-bottom: 0.5rem; display: block;">Current Password</label>
                        <input type="password" required class="neu-inset" placeholder="Enter current password" style="width: 100%; padding: 1rem; color-scheme: dark;">
                    </div>
                    
                    <div style="margin-bottom: 1rem;">
                        <label style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600; letter-spacing: 1px; margin-bottom: 0.5rem; display: block;">New Password</label>
                        <input type="password" required class="neu-inset" placeholder="Enter new password" style="width: 100%; padding: 1rem; color-scheme: dark;">
                    </div>

                    <button type="submit" class="neu-btn" style="width: 100%; padding: 1rem; display: flex; justify-content: center; align-items: center; gap: 0.5rem; color: var(--primary); font-weight: 600; font-size: 1rem;">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
                        Update Password
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
      <div class="glass-card modal-content fade-in" style="background: rgba(30, 41, 59, 0.95); padding: 2.5rem; border: 1px solid rgba(255,255,255,0.1); max-height: 90vh; overflow-y: auto;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
            <h2>Kemaskini Profil & Baki Cuti</h2>
            <button id="close-modal" style="background: transparent; color: white; border: none; cursor: pointer; font-size: 2rem; line-height: 1;">&times;</button>
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
                 <input type="date" id="edit-start-date" oninput="window.calculateYears(this.value)" class="neu-inset" value="${staff.startDate}" style="color-scheme: dark;">
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
                 <select class="neu-inset" style="appearance: none; cursor: pointer; color-scheme: dark; font-weight: 600;">
                     <option value="Admin Staff" ${staff.category === 'Admin Staff' ? 'selected' : ''}>Staff Admin</option>
                     <option value="Operation Staff" ${staff.category === 'Operation Staff' ? 'selected' : ''}>Staff Operasi</option>
                     <option value="Doctor" ${staff.category === 'Doctor' ? 'selected' : ''}>Doctor</option>
                     <option value="Super Admin" ${staff.category === 'Super Admin' ? 'selected' : ''}>Super Admin</option>
                 </select>
              </div>

              <div style="display: flex; flex-direction: column;">
                 <label style="font-size: 0.75rem; text-transform: uppercase; color: var(--text-muted); font-weight: 600; margin-bottom: 0.5rem; letter-spacing: 0.5px;">System Role</label>
                 <select class="neu-inset" style="appearance: none; cursor: pointer; color-scheme: dark; font-weight: 600;">
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
                     <option value="active" ${!staff.inactive ? 'selected' : ''} style="color: white; font-weight: normal;">Berkhidmat (Aktif)</option>
                     <option value="inactive" ${staff.inactive ? 'selected' : ''} style="color: white; font-weight: normal;">Telah Berhenti (Tidak Aktif)</option>
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
                    <span style="font-size: 0.85rem; font-weight: 700; color: white;">Gunakan Kiraan Pro-Rata (Terkumpul)</span>
                    <span style="font-size: 0.7rem; color: var(--text-muted); line-height: 1.4; margin-top: 0.25rem;">Jika di-tick, baki dikira mengikut bulan bekerja. Jika di-untick, staf mendapat baki penuh serta-merta tanpa pro-rata.</span>
                </div>
             </label>
          </div>
          
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1.5rem 2rem; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 2rem; margin-top: 1.5rem;">
            <div style="display: flex; flex-direction: column;">
               <label style="font-size: 0.85rem; margin-bottom: 0.5rem; color: var(--text-muted); font-weight: 500;">AL &mdash; Cuti Tahunan</label>
               <input type="number" id="ent-AL" class="neu-inset" value="${staff.ent_AL || 14}">
            </div>
            <div style="display: flex; flex-direction: column;">
               <label style="font-size: 0.85rem; margin-bottom: 0.5rem; color: var(--text-muted); font-weight: 500;">MC &mdash; Cuti Sakit</label>
               <input type="number" id="ent-MC" class="neu-inset" value="${staff.ent_MC || 14}">
            </div>
             <div style="display: flex; flex-direction: column;">
               <label style="font-size: 0.85rem; margin-bottom: 0.5rem; color: var(--text-muted); font-weight: 500;">HL &mdash; Cuti Hospitalisasi</label>
               <input type="number" id="ent-HL" class="neu-inset" value="${staff.ent_HL || 60}">
            </div>
            <div style="display: flex; flex-direction: column;">
               <label style="font-size: 0.85rem; margin-bottom: 0.5rem; color: var(--text-muted); font-weight: 500;">RL &mdash; Cuti Ganti</label>
               <input type="number" id="ent-REPLACEMENT" class="neu-inset" value="${staff.ent_REPLACEMENT || 0}">
            </div>
            <div style="display: flex; flex-direction: column;">
               <label style="font-size: 0.85rem; margin-bottom: 0.5rem; color: var(--text-muted); font-weight: 500;">ML &mdash; Cuti Bersalin</label>
               <input type="number" id="ent-ML" class="neu-inset" value="${staff.ent_ML || 98}">
            </div>
            <div style="display: flex; flex-direction: column;">
               <label style="font-size: 0.85rem; margin-bottom: 0.5rem; color: var(--text-muted); font-weight: 500;">PL &mdash; Cuti Isteri Bersalin</label>
               <input type="number" id="ent-PL" class="neu-inset" value="${staff.ent_PL || 7}">
            </div>
            <div style="display: flex; flex-direction: column;">
               <label style="font-size: 0.85rem; margin-bottom: 0.5rem; color: var(--text-muted); font-weight: 500;">EL &mdash; Cuti Kecemasan</label>
               <input type="number" id="ent-EL_EMG" class="neu-inset" value="${staff.ent_EL_EMG || 0}">
            </div>
            <div style="display: flex; flex-direction: column;">
               <label style="font-size: 0.85rem; margin-bottom: 0.5rem; color: var(--text-muted); font-weight: 500;">BL &mdash; Ihsan (Death)</label>
               <input type="number" id="ent-EL" class="neu-inset" value="${staff.ent_EL || 3}">
            </div>
            <div style="display: flex; flex-direction: column;">
               <label style="font-size: 0.85rem; margin-bottom: 0.5rem; color: var(--text-muted); font-weight: 500;">UL &mdash; Tanpa Gaji</label>
               <input type="number" id="ent-UP" class="neu-inset" value="${staff.ent_UP || 0}">
            </div>
            <div style="display: flex; flex-direction: column;">
               <label style="font-size: 0.85rem; margin-bottom: 0.5rem; color: var(--text-muted); font-weight: 500;">CF &mdash; Bawa Hadapan</label>
               <input type="number" id="ent-CF" class="neu-inset" value="${staff.ent_CF || 0}" max="3" oninput="if(this.value>3){this.value=3; alert('Maksimum cuti CF yang dibenarkan bawa ke tahun hadapan adalah 3 hari sahaja. Yang selebihnya akan burn.');}">
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
      <div class="glass-card modal-content fade-in" style="background: rgba(30, 41, 59, 0.95); padding: 2.5rem; border: 1px solid rgba(255,255,255,0.1); max-width: 500px;">
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
             <input type="text" class="neu-inset" value="${record.name}" disabled style="background: rgba(0,0,0,0.2); color: rgba(255,255,255,0.7); cursor: not-allowed; font-weight: 600; padding: 1rem;">
          </div>
          
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-bottom: 1.5rem;">
              <div>
                 <label style="font-size: 0.85rem; color: var(--text-muted); font-weight: 600; margin-bottom: 0.5rem; display: block;">Start Date</label>
                 <input type="date" id="el-start" class="neu-inset" value="${record.startDate}" style="color-scheme: dark;">
              </div>
              <div>
                 <label style="font-size: 0.85rem; color: var(--text-muted); font-weight: 600; margin-bottom: 0.5rem; display: block;">End Date</label>
                 <input type="date" id="el-end" class="neu-inset" value="${record.endDate}" style="color-scheme: dark;">
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
