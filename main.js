import './style.css'

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

window.testWANotification = async function() {
  const phone = document.getElementById('wa-test-phone')?.value;
  if (!phone) return alert('Sila masukkan nombor telefon untuk ujian.');
  if (!WHATSAPP_TOKEN) return alert('Sila simpan token Fonnte dahulu.');
  await window.sendWhatsApp(phone, `✅ *Ujian Notifikasi KSB Portal*\n\nSistem notifikasi WhatsApp berfungsi dengan baik.\n\n_— KSB Leave System_`);
  alert('Mesej ujian telah dihantar ke ' + phone);
};


// State
let user = null;
let currentSessionId = null;
let view = 'login'; // 'login', 'dashboard', 'management', 'leave-form', 'policy', 'settings'
window.setView = function(v) {
  view = v;
  render();
};
let manageBranchFilter = 'All';
let editingStaff = null;
let managementTab = 'pending'; // 'pending', 'staff', 'branches', 'master_audit', 'login_audit', 'hr_reports'
let manageSearchQuery = '';
let showInactiveStaff = false;
let editingLeaveId = null;
let showProfileSettings = false;
let selectedLeaveType = 'AL';
let analyticsFilterMonth = 0; // 0 = All Months, 1-12 = specific month
let analyticsCatFilter = 'SEMUA'; // 'SEMUA', 'Doktor', 'Admin Staff', 'Operation Staff'
let selectedLoginBranch = '';
let selectedLoginStaffIC = '';
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
    admin: { dashboard: 'analisa', leave_request: true, management: true, policy: true, settings: true },
    hod: { dashboard: 'staff', leave_request: true, management: false, policy: true, settings: true },
    staff: { dashboard: 'staff', leave_request: true, management: false, policy: true, settings: true }
};

window.toggleRbac = function(role, module) {
    if (module === 'dashboard') {
        window.rbacMatrix[role].dashboard = (window.rbacMatrix[role].dashboard === 'analisa') ? 'staff' : 'analisa';
    } else {
        window.rbacMatrix[role][module] = !window.rbacMatrix[role][module];
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

window.updateLocumName = function(id, name) {
  const record = leaveRecords.find(r => r.id === id);
  if (record) {
    record.locumName = name;
  }
};

window.setProfileSettings = function(state) {
  showProfileSettings = state;
  render();
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

window.calculateYears = function(dateStr) {
   const start = new Date(dateStr);
   const now = new Date();
   let yearsService = now.getFullYear() - start.getFullYear();
   if (now.getMonth() < start.getMonth() || (now.getMonth() === start.getMonth() && now.getDate() < start.getDate())) {
       yearsService--;
   }
   const el = document.getElementById('years-badge-text');
   if(el) el.innerText = `${Math.max(0, yearsService)} TAHUN BERKHIDMAT`;
};

const systemAuditLogs = [
  {
     timestamp: "4/3/2026, 10:49:06 PM",
     name: "Super Admin",
     branch: "HQ",
     userId: "super-admin",
     ip: "192.168.1.104",
     location: "Kuantan, Pahang",
     activity: "Logged into system"
  },
  {
     timestamp: "4/3/2026, 10:46:21 PM",
     name: "MUHAMMAD LUKHMAN BIN ISMAIL",
     branch: "KLINIK SYED BADARUDDIN BALOK (HQ)",
     userId: "880712065055",
     ip: "115.164.172.90",
     location: "Kuantan, Pahang",
     activity: "Applied for Annual Leave (2 days)"
  },
  {
     timestamp: "4/3/2026, 8:59:46 PM",
     name: "Super Admin",
     branch: "HQ",
     userId: "super-admin",
     ip: "192.168.1.104",
     location: "Kuantan, Pahang",
     activity: "Approved Leave for MOHD AKMAL"
  },
  {
     timestamp: "4/3/2026, 5:39:58 PM",
     name: "DR HASRI BIN HAZNAN",
     branch: "KLINIK SYED BADARUDDIN BESERAH",
     userId: "880714115511",
     ip: "202.188.10.15",
     location: "Beserah, Pahang",
     activity: "Updated System Profile details"
  },
  {
     timestamp: "4/3/2026, 4:37:43 PM",
     name: "INTAN NURFAHADA BINTI MOHAMMAD HIZAM",
     branch: "KLINIK SYED BADARUDDIN BALOK (HQ)",
     userId: "010515060256",
     ip: "175.143.20.100",
     location: "Cherating, Pahang",
     activity: "Logged into system"
  }
];

const leaveRecords = [
  {
    id: 1,
    name: "DR HASRI BIN HAZNAN", 
    ic: "880714115511", 
    branch: "Klinik Syed Badaruddin Beserah",
    type: "CME",
    typeColor: "var(--accent)", // green
    days: 1,
    startDate: "2026-04-18",
    endDate: "2026-04-18",
    reason: 'Scientific meeting KPI Pahang',
    status: "PENDING"
  },
  {
    id: 2,
    name: "MOHD AKMAL BIN SEMAN @ ABD JABAR", 
    ic: "760205065687", 
    branch: "Klinik Syed Badaruddin Balok (HQ)",
    type: "AL",
    typeColor: "var(--primary)", // blue
    days: 1,
    startDate: "2026-04-06",
    endDate: "2026-04-06",
    reason: 'Ke Kelantan',
    status: "HOD APPROVED"
  },
  {
    id: 3,
    name: "DR FARHAH AMALINA BINTI C.HARUN", 
    ic: "920303115342", 
    branch: "Klinik Syed Badaruddin Balok (HQ)",
    type: "CME",
    typeColor: "var(--accent)",
    days: 1,
    startDate: "2026-05-10",
    endDate: "2026-05-10",
    reason: 'Kursus Perubatan',
    status: "PENDING"
  },
  {
    id: 4,
    name: "DR BISME NORIHAN BINTI BORHANUDDIN", 
    ic: "790725125046", 
    branch: "Klinik Syed Badaruddin Balok (HQ)",
    type: "AL",
    typeColor: "var(--primary)",
    days: 2,
    startDate: "2026-05-12",
    endDate: "2026-05-13",
    reason: 'Urusan Keluarga',
    status: "PENDING"
  },
  {
    id: 5,
    name: "MUHAMMAD LUKHMAN BIN ISMAIL", 
    ic: "980911065432", 
    branch: "Klinik Syed Badaruddin Balok (HQ)",
    type: "AL",
    typeColor: "var(--primary)",
    days: 1,
    startDate: "2026-03-25",
    endDate: "2026-03-25",
    reason: 'Balik Kampung',
    status: "REJECTED"
  }
];

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

window.deleteLeave = function(id) {
    if(confirm("Are you sure you want to delete this leave record?")) {
        const index = leaveRecords.findIndex(r => r.id === id);
        if(index > -1) leaveRecords.splice(index, 1);
        render();
    }
};

window.finalizeLeave = function(id) {
    const record = leaveRecords.find(r => r.id === id);
    if(record) {
        const applicant = staffList.find(s => s.ic === record.ic);
        if (applicant && applicant.category === 'Doctor' && !record.locumName) {
            alert("MAAF: Sila isi nama Doktor Locum Pengganti sebelum meluluskan permohonan ini.");
            return;
        }

        const isFullBoss = ['admin', 'hr', 'Super Admin'].includes(user.role);
        
        if (isFullBoss) {
            record.status = "APPROVED";
            alert("Kelulusan Penuh (Final) Berjaya!");
            // Notify the leave applicant staff
            if (applicant && applicant.phone) {
                const msg = `✅ *CUTI DILULUSKAN — KSB Portal*\n\nSalam ${applicant.name},\n\nPermohonan cuti anda telah *DILULUSKAN* oleh HR/Admin.\n\n📋 *Butiran Cuti:*\n• Jenis: ${record.type}\n• Tarikh: ${record.startDate} → ${record.endDate}\n• Tempoh: ${record.days} hari\n• Sebab: ${record.reason}\n\nTerima kasih.\n_— KSB Leave System_`;
                window.sendWhatsApp(applicant.phone, msg);
            }
        } else if (user.role === 'hod') {
            record.status = "HOD RECOMMENDED";
            alert("Sokongan HOD Berjaya! Permohonan ini kini menanti kelulusan HR/Admin.");
            // Notify all HR/Admin staff
            const admins = staffList.filter(s => ['admin', 'hr'].includes(s.role) && s.phone);
            const msg = `📋 *SOKONGAN HOD — PERLU KELULUSAN ADMIN*\n\nPermohonan cuti telah disokong oleh HOD dan sedang menunggu kelulusan anda.\n\n👤 Pemohon: *${record.name}*\n🏥 Cawangan: ${record.branch}\n📝 Jenis Cuti: ${record.type}\n📅 Tarikh: ${record.startDate} → ${record.endDate}\n⏱ Tempoh: ${record.days} hari\n💬 Sebab: ${record.reason}\n\nSila log masuk ke KSB Portal untuk meluluskan.\n_— KSB Leave System_`;
            admins.forEach(admin => window.sendWhatsApp(admin.phone, msg));
        }
    }
    render();
};

window.rejectLeave = function(id) {
    const record = leaveRecords.find(r => r.id === id);
    if(record) {
        record.status = "REJECTED";
        // Notify applicant of rejection
        const applicant = staffList.find(s => s.ic === record.ic);
        if (applicant && applicant.phone) {
            const msg = `❌ *CUTI TIDAK DILULUSKAN — KSB Portal*\n\nSalam ${applicant.name},\n\nMaaf, permohonan cuti anda telah *DITOLAK*.\n\n📋 *Butiran Cuti:*\n• Jenis: ${record.type}\n• Tarikh: ${record.startDate} → ${record.endDate}\n• Tempoh: ${record.days} hari\n\nSila hubungi HR/Admin untuk maklumat lanjut.\n_— KSB Leave System_`;
            window.sendWhatsApp(applicant.phone, msg);
        }
    }
    render();
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

const staffList = [
  {
    "name": "Super Admin",
    "ic": "Super Admin",
    "branch": "Management / HQ",
    "role": "admin",
    "category": "Super Admin",
    "startDate": "2020-01-01",
    "password": "superpassword",
    "phone": "60129444295"
  },
  {
    "name": "MOHD AKMAL BIN SEMAN @ ABD JABAR",
    "ic": "760205065687",
    "branch": "Klinik Syed Badaruddin Balok (HQ)",
    "role": "hod",
    "category": "Admin Staff",
    "phone": "60179339333",
    "startDate": "2008-12-02"
  },
  {
    "name": "HASIMAH BINTI MOHAMAD",
    "ic": "740407115242",
    "branch": "Klinik Syed Badaruddin Balok (HQ)",
    "role": "hod",
    "category": "Operation Staff",
    "phone": "60199449444",
    "startDate": "1994-01-13"
  },
  {
    "name": "DR ABDUL WAHID BIN MOHAMMAD WAZIR",
    "ic": "740409145189",
    "branch": "Klinik Syed Badaruddin Balok (HQ)",
    "role": "staff",
    "category": "Doctor",
        "waApiKey": "",
    "startDate": "2011-04-01"
  },
  {
    "name": "DR NUR AKMAL BINTI MOHD ALI",
    "ic": "770505115358",
    "branch": "Klinik Syed Badaruddin Balok (HQ)",
    "role": "staff",
    "category": "Doctor",
        "waApiKey": "",
    "startDate": "2008-07-01"
  },
  {
    "name": "RADHIAH SYAHINDAH BINTI MD RAZIRAN",
    "ic": "000205050256",
    "branch": "Klinik Syed Badaruddin Balok (HQ)",
    "role": "staff",
    "category": "Admin Staff",
        "waApiKey": "",
    "startDate": "2025-09-17"
  },
  {
    "name": "SHARIFAH NURUL IZZAH BT SYED BADARUDDIN",
    "ic": "000405060766",
    "branch": "Klinik Syed Badaruddin Balok (HQ)",
    "role": "staff",
    "category": "Admin Staff",
        "waApiKey": "",
    "startDate": "2024-06-24"
  },
  {
    "name": "NUR SYASYA AFIQAH BINTI MOHD ROSLI",
    "ic": "010415080022",
    "branch": "Klinik Syed Badaruddin Balok (HQ)",
    "role": "staff",
    "category": "Operation Staff",
        "waApiKey": "",
    "startDate": "2022-09-01"
  },
  {
    "name": "INTAN NURFAHADA BINTI MOHAMMAD HIZAM",
    "ic": "010515060256",
    "branch": "Klinik Syed Badaruddin Balok (HQ)",
    "role": "staff",
    "category": "Operation Staff",
        "waApiKey": "",
    "startDate": "2022-07-01"
  },
  {
    "name": "MUHAMMAD AMIR IRFAN BIN MOHD ZAIDIN",
    "ic": "010716060615",
    "branch": "Klinik Syed Badaruddin Balok (HQ)",
    "role": "staff",
    "category": "Operation Staff",
        "waApiKey": "",
    "startDate": "2025-09-17"
  },
  {
    "name": "IRDINA BINTI MOHD HANAFIAH",
    "ic": "020304060394",
    "branch": "Klinik Syed Badaruddin Balok (HQ)",
    "role": "staff",
    "category": "Operation Staff",
        "waApiKey": "",
    "startDate": "2023-07-03"
  },
  {
    "name": "Nur Syaza Faiqah Binti Zawawi",
    "ic": "020417110116",
    "branch": "Klinik Syed Badaruddin Balok (HQ)",
    "role": "staff",
    "category": "Operation Staff"
  },
  {
    "name": "ADRIANA BATRISYIA BINTI MOHD SHAHRIL PINI",
    "ic": "041105100712",
    "branch": "Klinik Syed Badaruddin Balok (HQ)",
    "role": "staff",
    "category": "Operation Staff",
        "waApiKey": "",
    "startDate": "2025-07-14"
  },
  {
    "name": "SYED BADARUDDIN BIN SYED ALI",
    "ic": "611021065069",
    "branch": "Klinik Syed Badaruddin Balok (HQ)",
    "role": "admin",
    "category": "Admin Staff",
    "phone": "60129444295"
  },
  {
    "name": "ABDULLAH SABIL BIN ABU BAKAR",
    "ic": "640622035239",
    "branch": "Klinik Syed Badaruddin Balok (HQ)",
    "role": "staff",
    "category": "Admin Staff",
        "waApiKey": "",
    "startDate": "2001-06-01"
  },
  {
    "name": "TENGKU ROHSNAN TENGKU ABDUL HAMID",
    "ic": "660504065361",
    "branch": "Klinik Syed Badaruddin Balok (HQ)",
    "role": "staff",
    "category": "Admin Staff"
  },
  {
    "name": "ABDULLAH SABIL BIN ABU BAKAR",
    "ic": "740113065361",
    "branch": "Klinik Syed Badaruddin Balok (HQ)",
    "role": "staff",
    "category": "Operation Staff"
  },
  {
    "name": "SAMSUDDIN BIN HAMID",
    "ic": "760927065091",
    "branch": "Klinik Syed Badaruddin Balok (HQ)",
    "role": "hod",
    "category": "Admin Staff"
  },
  {
    "name": "MOHD AZLI BIN RAZAK",
    "ic": "770711115447",
    "branch": "Klinik Syed Badaruddin Balok (HQ)",
    "role": "hod",
    "category": "Admin Staff",
        "waApiKey": "",
    "startDate": "2004-04-01"
  },
  {
    "name": "DR ASRATHIAH BINTI AB RAZAK",
    "ic": "770925065844",
    "branch": "Klinik Syed Badaruddin Balok (HQ)",
    "role": "staff",
    "category": "Doctor",
        "waApiKey": "",
    "startDate": "2009-11-01"
  },
  {
    "name": "NOOR HASNALAILI RAMLI",
    "ic": "780724115058",
    "branch": "Klinik Syed Badaruddin Balok (HQ)",
    "role": "staff",
    "category": "Doctor"
  },
  {
    "name": "DR BISME NORIHAN BINTI BORHANUDDIN",
    "ic": "790725125046",
    "branch": "Klinik Syed Badaruddin Balok (HQ)",
    "role": "staff",
    "category": "Doctor",
        "waApiKey": "",
    "startDate": "2007-07-01"
  },
  {
    "name": "MOHD MARZUKI BIN ADBUL AZIZ",
    "ic": "800423065689",
    "branch": "Klinik Syed Badaruddin Balok (HQ)",
    "role": "staff",
    "category": "Operation Staff",
        "waApiKey": "",
    "startDate": "2022-10-01"
  },
  {
    "name": "FARAHTINA BINTI KAMARUDDIN",
    "ic": "801010065052",
    "branch": "Klinik Syed Badaruddin Balok (HQ)",
    "role": "staff",
    "category": "Admin Staff",
        "waApiKey": "",
    "startDate": "2014-03-12"
  },
  {
    "name": "MOHD KHAIRUL AZHAR BIN HASAN",
    "ic": "810113065295",
    "branch": "Klinik Syed Badaruddin Balok (HQ)",
    "role": "staff",
    "category": "Operation Staff",
        "waApiKey": "",
    "startDate": "2021-09-01"
  },
  {
    "name": "NORHAZLINAH BINTI ALI",
    "ic": "810506035572",
    "branch": "Klinik Syed Badaruddin Balok (HQ)",
    "role": "hr",
    "category": "Admin Staff",
        "waApiKey": "",
    "startDate": "2022-07-01"
  },
  {
    "name": "MOHD SYAHRAIL FIRDAUS BIN CHE MOHD RAHIM",
    "ic": "820410035905",
    "branch": "Klinik Syed Badaruddin Balok (HQ)",
    "role": "staff",
    "category": "Operation Staff",
        "waApiKey": "",
    "startDate": "2017-09-20"
  },
  {
    "name": "NOR AIDA BINTI AB AZIZ",
    "ic": "830501065092",
    "branch": "Klinik Syed Badaruddin Balok (HQ)",
    "role": "staff",
    "category": "Admin Staff",
        "waApiKey": "",
    "startDate": "2004-12-20"
  },
  {
    "name": "FARIZA BINTI ZAINUDDIN",
    "ic": "850813065612",
    "branch": "Klinik Syed Badaruddin Balok (HQ)",
    "role": "staff",
    "category": "Operation Staff",
        "waApiKey": "",
    "startDate": "2025-12-01"
  },
  {
    "name": "NOOR MARDIYYAH BINTI ABD MANAN",
    "ic": "870503115520",
    "branch": "Klinik Syed Badaruddin Balok (HQ)",
    "role": "staff",
    "category": "Operation Staff",
        "waApiKey": "",
    "startDate": "2008-12-06"
  },
  {
    "name": "FATIN ZALIKHA BINTI ISMAIL",
    "ic": "880706065040",
    "branch": "Klinik Syed Badaruddin Balok (HQ)",
    "role": "staff",
    "category": "Operation Staff",
        "waApiKey": "",
    "startDate": "2014-05-15"
  },
  {
    "name": "MUHAMMAD LUKHMAN BIN ISMAIL",
    "ic": "880712065055",
    "branch": "Klinik Syed Badaruddin Balok (HQ)",
    "role": "staff",
    "category": "Operation Staff",
        "waApiKey": "",
    "startDate": "2022-12-12"
  },
  {
    "name": "SYAFIQA BINTI ABD AZIZ",
    "ic": "891215015798",
    "branch": "Klinik Syed Badaruddin Balok (HQ)",
    "role": "staff",
    "category": "Admin Staff",
        "waApiKey": "",
    "startDate": "2011-03-01"
  },
  {
    "name": "NURAINI BINTI MUSTAPA",
    "ic": "900105035570",
    "branch": "Klinik Syed Badaruddin Balok (HQ)",
    "role": "staff",
    "category": "Admin Staff",
        "waApiKey": "",
    "startDate": "2023-09-01"
  },
  {
    "name": "WAN MOHAMAD FAIZIN BIN WAN MOHD YUSOFF",
    "ic": "900213035655",
    "branch": "Klinik Syed Badaruddin Balok (HQ)",
    "role": "staff",
    "category": "Operation Staff"
  },
  {
    "name": "DR SYED FAZREEN BIN SEYED FADZIR",
    "ic": "920103065045",
    "branch": "Klinik Syed Badaruddin Balok (HQ)",
    "role": "staff",
    "category": "Doctor",
        "waApiKey": "",
    "startDate": "2023-09-01"
  },
  {
    "name": "DR FARHAH AMALINA BINTI C.HARUN",
    "ic": "920303115342",
    "branch": "Klinik Syed Badaruddin Balok (HQ)",
    "role": "staff",
    "category": "Doctor",
        "waApiKey": "",
    "startDate": "2025-08-01"
  },
  {
    "name": "SITI NURHAFIZAH BINTI HASAN",
    "ic": "920601135288",
    "branch": "Klinik Syed Badaruddin Balok (HQ)",
    "role": "staff",
    "category": "Operation Staff",
        "waApiKey": "",
    "startDate": "2025-11-17"
  },
  {
    "name": "KU SYAZWANA BT KU RADZALI",
    "ic": "920622065370",
    "branch": "Klinik Syed Badaruddin Balok (HQ)",
    "role": "staff",
    "category": "Operation Staff",
        "waApiKey": "",
    "startDate": "2018-11-05"
  },
  {
    "name": "NUR IZZATUL NAJWA BT MOHD HANAN KASHFI",
    "ic": "930622115410",
    "branch": "Klinik Syed Badaruddin Balok (HQ)",
    "role": "staff",
    "category": "Operation Staff",
        "waApiKey": "",
    "startDate": "2016-09-01"
  },
  {
    "name": "NUR SAFIRAH BINTI ZAINAL",
    "ic": "930712115158",
    "branch": "Klinik Syed Badaruddin Balok (HQ)",
    "role": "staff",
    "category": "Operation Staff",
        "waApiKey": "",
    "startDate": "2013-05-15"
  },
  {
    "name": "WAN MUHAMMAD ARIFF BIN WAN AZAMIN",
    "ic": "940330115485",
    "branch": "Klinik Syed Badaruddin Balok (HQ)",
    "role": "staff",
    "category": "Operation Staff",
        "waApiKey": "",
    "startDate": "2019-11-18"
  },
  {
    "name": "NURDIANA NABILA BINTI MOHD FAZLI",
    "ic": "950204016362",
    "branch": "Klinik Syed Badaruddin Balok (HQ)",
    "role": "staff",
    "category": "Operation Staff",
        "waApiKey": "",
    "startDate": "2024-12-01"
  },
  {
    "name": "PUTERI AMIRA IRFFA BINTI SAIDI",
    "ic": "950606115718",
    "branch": "Klinik Syed Badaruddin Balok (HQ)",
    "role": "staff",
    "category": "Operation Staff",
        "waApiKey": "",
    "startDate": "2020-10-19"
  },
  {
    "name": "NUR SYAZWANI BINTI MOHD NOOR",
    "ic": "950801115596",
    "branch": "Klinik Syed Badaruddin Balok (HQ)",
    "role": "staff",
    "category": "Operation Staff",
        "waApiKey": "",
    "startDate": "2026-01-02"
  },
  {
    "name": "SITI HAJAR BINTI ZULKIFLEE",
    "ic": "960331045042",
    "branch": "Klinik Syed Badaruddin Balok (HQ)",
    "role": "staff",
    "category": "Admin Staff",
        "waApiKey": "",
    "startDate": "2025-07-21"
  },
  {
    "name": "NOR AZIERAH BINTI ISMAIL",
    "ic": "960406065524",
    "branch": "Klinik Syed Badaruddin Balok (HQ)",
    "role": "staff",
    "category": "Operation Staff",
        "waApiKey": "",
    "startDate": "2020-03-02"
  },
  {
    "name": "SITI MARIANI BINTI RAZAK",
    "ic": "970423065074",
    "branch": "Klinik Syed Badaruddin Balok (HQ)",
    "role": "staff",
    "category": "Admin Staff",
        "waApiKey": "",
    "startDate": "2026-02-02"
  },
  {
    "name": "NABILAH BINTI GHAZALI",
    "ic": "980419065476",
    "branch": "Klinik Syed Badaruddin Balok (HQ)",
    "role": "staff",
    "category": "Operation Staff",
        "waApiKey": "",
    "startDate": "2022-06-15"
  },
  {
    "name": "NUR AQILAH BINTI ABU BAKAR@AZAHAR",
    "ic": "980521115046",
    "branch": "Klinik Syed Badaruddin Balok (HQ)",
    "role": "staff",
    "category": "Operation Staff",
        "waApiKey": "",
    "startDate": "2023-04-10"
  },
  {
    "name": "SYARIFAH NOORLAILATUL SYUHADA BINTI SYED HUSAIN",
    "ic": "980605065162",
    "branch": "Klinik Syed Badaruddin Balok (HQ)",
    "role": "staff",
    "category": "Operation Staff",
        "waApiKey": "",
    "startDate": "2020-12-03"
  },
  {
    "name": "Adriana athirah binti azmi",
    "ic": "980610066426",
    "branch": "Klinik Syed Badaruddin Balok (HQ)",
    "role": "staff",
    "category": "Operation Staff"
  },
  {
    "name": "WAN NUR AINA BINTI WAN NAWANG",
    "ic": "980926115052",
    "branch": "Klinik Syed Badaruddin Balok (HQ)",
    "role": "staff",
    "category": "Operation Staff",
        "waApiKey": "",
    "startDate": "2024-02-01"
  },
  {
    "name": "AZNIDA BINTI ALI",
    "ic": "810707065284",
    "branch": "Klinik Syed Badaruddin Beserah",
    "role": "staff",
    "category": "Operation Staff"
  },
  {
    "name": "NURZURIA MOHD NOOR",
    "ic": "821222115080",
    "branch": "Klinik Syed Badaruddin Beserah",
    "role": "staff",
    "category": "Operation Staff"
  },
  {
    "name": "DR HASRI BIN HAZNAN",
    "ic": "880714115511",
    "branch": "Klinik Syed Badaruddin Beserah",
    "role": "hod",
    "category": "Doctor",
    "phone": "601122233344",
    "startDate": "2021-06-01"
  },
  {
    "name": "NOR AIN BINTI AB WAHAB",
    "ic": "950505065336",
    "branch": "Klinik Syed Badaruddin Beserah",
    "role": "staff",
    "category": "Operation Staff",
        "waApiKey": "",
    "startDate": "2016-12-13"
  },
  {
    "name": "NOOR ANIZ SYAFEEQAH CHE FAIZUL",
    "ic": "970726335086",
    "branch": "Klinik Syed Badaruddin Beserah",
    "role": "staff",
    "category": "Operation Staff"
  },
  {
    "name": "DR ZAINAL BIN SULIAN",
    "ic": "700210016105",
    "branch": "Klinik Syed Badaruddin Gebeng",
    "role": "hod",
    "category": "Doctor",
        "waApiKey": "",
    "startDate": "2003-05-01"
  },
  {
    "name": "NOR BAIZATULAIMI BINTI ABDUL RAHIM",
    "ic": "860717335722",
    "branch": "Klinik Syed Badaruddin Gebeng",
    "role": "staff",
    "category": "Operation Staff"
  },
  {
    "name": "NOOR SHAFIKAH BINTI GHAFFAR",
    "ic": "990522065238",
    "branch": "Klinik Syed Badaruddin Gebeng",
    "role": "staff",
    "category": "Operation Staff"
  },
  {
    "name": "DR ROHANA BINTI MOHD ZAIN",
    "ic": "720107035322",
    "branch": "Klinik Syed Badaruddin Kempadang",
    "role": "hod",
    "category": "Doctor",
        "waApiKey": "",
    "startDate": "2001-06-01"
  },
  {
    "name": "Maizaitulnaddia Binti Mohamed",
    "ic": "840621065782",
    "branch": "Klinik Syed Badaruddin Kempadang",
    "role": "staff",
    "category": "Operation Staff"
  },
  {
    "name": "NUR AIN BINTI ABD RAHMAN",
    "ic": "900518085760",
    "branch": "Klinik Syed Badaruddin Kempadang",
    "role": "staff",
    "category": "Operation Staff"
  },
  {
    "name": "NORZARIFAH BINTI ZAILI",
    "ic": "921010065980",
    "branch": "Klinik Syed Badaruddin Kempadang",
    "role": "staff",
    "category": "Operation Staff"
  },
  {
    "name": "NORSAISAZLIN BINTI ADNAN",
    "ic": "000505060640",
    "branch": "Uni Klinik Bentong",
    "role": "staff",
    "category": "Operation Staff"
  },
  {
    "name": "NUR ALEEYA SYAFIQA BINTI IZHARUDDIN",
    "ic": "030916060802",
    "branch": "Uni Klinik Bentong",
    "role": "staff",
    "category": "Operation Staff"
  },
  {
    "name": "NUR FADIRAH BINTI RASININ",
    "ic": "970104126554",
    "branch": "Uni Klinik Bentong",
    "role": "staff",
    "category": "Operation Staff"
  },
  {
    "name": "INTAN SULIZA BINTI ABU HASAN",
    "ic": "880526055064",
    "branch": "Klinik Syed Badaruddin MCKIP",
    "role": "staff",
    "category": "Operation Staff"
  },
  {
    "name": "Norhaya binti hasbullah",
    "ic": "941002126382",
    "branch": "Klinik Syed Badaruddin MCKIP",
    "role": "staff",
    "category": "Operation Staff"
  },
  {
    "name": "SAPURA BINTI JAMALUDIN",
    "ic": "860522335546",
    "branch": "Klinik Syed Badaruddin RPCM",
    "role": "staff",
    "category": "Operation Staff",
        "waApiKey": "",
    "startDate": "2013-07-01"
  },
  {
    "name": "NUR SYAHIRAH BINTI MOHD NAWI",
    "ic": "001203110010",
    "branch": "Klinik Syed Badaruddin Kerteh",
    "role": "staff",
    "category": "Operation Staff"
  },
  {
    "name": "HAZIQAH'TUN NAFISAH BINTI ABDUL FAAL",
    "ic": "030622110544",
    "branch": "Klinik Syed Badaruddin Kerteh",
    "role": "staff",
    "category": "Operation Staff"
  },
  {
    "name": "Noryusmainei Binti Mustapha",
    "ic": "870213045114",
    "branch": "Klinik Syed Badaruddin Kerteh",
    "role": "staff",
    "category": "Operation Staff"
  },
  {
    "name": "Zahirah Dahria binti Mohamed Basri",
    "ic": "890609115092",
    "branch": "Klinik Syed Badaruddin Kerteh",
    "role": "hod",
    "category": "Admin Staff"
  },
  {
    "name": "Muhammad Naqib Bin Bajuri",
    "ic": "910903045211",
    "branch": "Klinik Syed Badaruddin Kerteh",
    "role": "hod",
    "category": "Doctor"
  },
  {
    "name": "NUR IZZATI BINTI AZAHRI",
    "ic": "941003115394",
    "branch": "Klinik Syed Badaruddin Kerteh",
    "role": "staff",
    "category": "Operation Staff"
  },
  {
    "name": "NUR HAZWANIE BT IBRAHIM",
    "ic": "950607035242",
    "branch": "Klinik Syed Badaruddin Kerteh",
    "role": "staff",
    "category": "Admin Staff"
  },
  {
    "name": "NURUL MASHAIZAM BINTI MOHAMMAD",
    "ic": "960519115292",
    "branch": "Klinik Syed Badaruddin Kerteh",
    "role": "staff",
    "category": "Operation Staff"
  },
  {
    "name": "WAN NUR SYUHAIDA WAN SHAMSUDIN",
    "ic": "970331115142",
    "branch": "Klinik Syed Badaruddin Kerteh",
    "role": "staff",
    "category": "Operation Staff"
  },
  {
    "name": "NUR HANISS SYAFEERA BINTI MOHD FAUZI",
    "ic": "981223115160",
    "branch": "Klinik Syed Badaruddin Kerteh",
    "role": "staff",
    "category": "Operation Staff"
  },
  {
    "name": "NADHIRATUL IHSAN BT MOHD ZUKI",
    "ic": "990423115316",
    "branch": "Klinik Syed Badaruddin Kerteh",
    "role": "staff",
    "category": "Operation Staff"
  },
  {
    "name": "NURUL SAHIRA BINTI MOHD SAUFI",
    "ic": "011121110438",
    "branch": "Klinik Syed Badaruddin Paka",
    "role": "staff",
    "category": "Operation Staff"
  },
  {
    "name": "KHAIRANI BINTI KASIM@ABDUL GHAFAR",
    "ic": "780416115136",
    "branch": "Klinik Syed Badaruddin Paka",
    "role": "hod",
    "category": "Admin Staff"
  },
  {
    "name": "NORHASLINA BINTI OTHMAN",
    "ic": "820102115188",
    "branch": "Klinik Syed Badaruddin Paka",
    "role": "staff",
    "category": "Operation Staff"
  },
  {
    "name": "MAZLINDA BINTI MUHAMAD",
    "ic": "841006115156",
    "branch": "Klinik Syed Badaruddin Paka",
    "role": "staff",
    "category": "Operation Staff"
  },
  {
    "name": "ROSMALISSA BINTI ZULKIFLI",
    "ic": "850720115384",
    "branch": "Klinik Syed Badaruddin Paka",
    "role": "staff",
    "category": "Operation Staff"
  },
  {
    "name": "NURUL FATIHAH BINTI SASFARIZAM",
    "ic": "001125110866",
    "branch": "Klinik Rakyat dan X-Ray Dungun",
    "role": "staff",
    "category": "Operation Staff"
  },
  {
    "name": "Suziyana binti jusoh",
    "ic": "791126115350",
    "branch": "Klinik Rakyat dan X-Ray Dungun",
    "role": "staff",
    "category": "Doctor"
  },
  {
    "name": "NOR AINI BINTI LATIF",
    "ic": "881005115396",
    "branch": "Klinik Rakyat dan X-Ray Dungun",
    "role": "staff",
    "category": "Operation Staff"
  },
  {
    "name": "NURUL AIN BINTI MOHD FAUZI",
    "ic": "900701115518",
    "branch": "Klinik Rakyat dan X-Ray Dungun",
    "role": "hod",
    "category": "Admin Staff"
  },
  {
    "name": "Nor Aniyah binti Sulong",
    "ic": "900903115460",
    "branch": "Klinik Rakyat dan X-Ray Dungun",
    "role": "staff",
    "category": "Operation Staff"
  },
  {
    "name": "NURHAMIZAH BINTI MD ALI",
    "ic": "910330115680",
    "branch": "Klinik Rakyat dan X-Ray Dungun",
    "role": "staff",
    "category": "Operation Staff"
  },
  {
    "name": "CHE NURUL NADZIRAH BINTI CHE ZAKARNOR",
    "ic": "920428115426",
    "branch": "Klinik Rakyat dan X-Ray Dungun",
    "role": "staff",
    "category": "Operation Staff"
  },
  {
    "name": "YUSLIDA BINTI YUSOF",
    "ic": "930825115496",
    "branch": "Klinik Rakyat dan X-Ray Dungun",
    "role": "staff",
    "category": "Operation Staff"
  },
  {
    "name": "SITI NOR AIN BINTI RANI",
    "ic": "941119115652",
    "branch": "Klinik Rakyat dan X-Ray Dungun",
    "role": "staff",
    "category": "Operation Staff"
  },
  {
    "name": "KHALIDAH ALAWIYAH BINTI MUHAMOD",
    "ic": "950414115764",
    "branch": "Klinik Rakyat dan X-Ray Dungun",
    "role": "staff",
    "category": "Operation Staff"
  },
  {
    "name": "NUR MUSTABSYIRAH",
    "ic": "980321115260",
    "branch": "Klinik Rakyat dan X-Ray Dungun",
    "role": "staff",
    "category": "Operation Staff"
  },
  {
    "name": "Zulina bt abd ghani",
    "ic": "860226115362",
    "branch": "Klinik Syed Badaruddin Utama",
    "role": "staff",
    "category": "Operation Staff"
  },
  {
    "name": "NORMAIZAN BINTI AZIS",
    "ic": "881213115278",
    "branch": "Klinik Syed Badaruddin Utama",
    "role": "staff",
    "category": "Operation Staff"
  },
  {
    "name": "MIMI ASMIDA BT MOHD ASRI",
    "ic": "911028115748",
    "branch": "Klinik Syed Badaruddin Utama",
    "role": "staff",
    "category": "Operation Staff"
  },
  {
    "name": "NURUL HAZWANI BINTI MOHD YATIM",
    "ic": "940607025790",
    "branch": "Klinik Syed Badaruddin Utama",
    "role": "staff",
    "category": "Operation Staff"
  },
  {
    "name": "Super Admin",
    "ic": "super_admin",
    "branch": "BELUM DITUGASKAN",
    "role": "admin",
    "category": "Super Admin"
  },
  {
    "name": "SHARIFAH MARDZIAH BT SYED ABDUL RAHMAN",
    "ic": "660728065522",
    "branch": "Klinik Syed Badaruddin Balok (HQ)",
    "role": "staff",
    "category": "Operation Staff",
        "waApiKey": "",
    "startDate": ""
  },
  {
    "name": "DR YASRIZA BIN YAHAYA",
    "ic": "640820065025",
    "branch": "Klinik Syed Badaruddin Balok (HQ)",
    "role": "staff",
    "category": "Operation Staff",
        "waApiKey": "",
    "startDate": "1997-09-01"
  },
  {
    "name": "TENGKU ROHSNAN TENGKU ABDUL HAMID",
    "ic": "710929065011",
    "branch": "Klinik Syed Badaruddin Balok (HQ)",
    "role": "staff",
    "category": "Operation Staff",
        "waApiKey": "",
    "startDate": "2000-03-01"
  },
  {
    "name": "WAN MOHAMAD FAIZIN BIN WAN MOHD YUSOFF",
    "ic": "910407035647",
    "branch": "Klinik Syed Badaruddin Balok (HQ)",
    "role": "staff",
    "category": "Operation Staff",
        "waApiKey": "",
    "startDate": "2015-01-01"
  },
  {
    "name": "NURUL NABILA BINTI MOHD JAILANI",
    "ic": "000822060126",
    "branch": "Klinik Syed Badaruddin Balok (HQ)",
    "role": "staff",
    "category": "Operation Staff",
        "waApiKey": "",
    "startDate": "2024-02-05"
  },
  {
    "name": "SHARIFAH ROHANA BINTI SAYED BAHRUM",
    "ic": "710314065402",
    "branch": "Klinik Syed Badaruddin Balok (HQ)",
    "role": "staff",
    "category": "Operation Staff",
        "waApiKey": "",
    "startDate": "2023-06-01"
  },
  {
    "name": "NUR FATEHAH BINTI AHMAD FIDZAL",
    "ic": "941026025914",
    "branch": "Klinik Syed Badaruddin Balok (HQ)",
    "role": "staff",
    "category": "Operation Staff",
        "waApiKey": "",
    "startDate": "2024-05-02"
  }
];


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
  if (view === 'login') {
    renderLogin();
  } else {
    renderDashboard();
  }
}

function renderLogin() {
  const filteredStaff = selectedLoginBranch ? staffList.filter(s => s.branch === selectedLoginBranch) : [];
  
  app.innerHTML = `
    <div class="auth-container">
      <div class="glass-pane auth-card fade-in">
        <div class="logo-group">
          <div class="logo-circle"><img src="${logos.ksb}" alt="KSB"></div>
          <div class="logo-circle"><img src="${logos.kr}" alt="KR"></div>
          <div class="logo-circle"><img src="${logos.bentong}" alt="Bentong"></div>
        </div>
        <h1 class="auth-title">KLINIK SYED BADARUDDIN</h1>
        <p class="auth-subtitle">Leave & Overtime Tracking System</p>
        
        <form id="login-form">
          <div class="form-group">
            <label>Cawangan (Branch)</label>
            <select id="login-branch" class="neu-inset" style="width: 100%; appearance: none; cursor: pointer;" onchange="window.setLoginBranch(this.value)" required>
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
            <input type="password" id="password" placeholder="••••••••" required>
          </div>
          <button type="submit" class="btn-primary" ${!selectedLoginStaffIC ? 'disabled' : ''}>Login</button>
        </form>
        
        <div style="margin-top: 1.5rem; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 1rem;">
           <p style="font-size: 0.75rem; color: var(--text-muted); line-height: 1.4;">
             Sila pilih cawangan dan nama anda untuk log masuk. Admin boleh setkan password anda dalam bahagian Management.
           </p>
        </div>
      </div>
    </div>
  `;

  document.querySelector('#login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const ic = document.querySelector('#login-staff').value;
    const pwd = document.querySelector('#password').value;

    // Super Admin Backdoor
    if (pwd === 'superpassword' && (ic === 'Super Admin' || selectedLoginBranch === 'Management')) {
       // Allow backdoor if password is correct
    }

    const foundUser = staffList.find(s => s.ic === ic);
    if (foundUser && foundUser.password === pwd) {
      user = foundUser;
      currentSessionId = Date.now().toString() + '_' + Math.random().toString(36).substring(2);
      localStorage.setItem('ksb_session_' + user.ic, currentSessionId);
      view = 'dashboard';
      render();
    } else {
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
    const name = opt.dataset.name.toLowerCase();
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

  // Force Sync 25 Hari untuk pakar
  const isSpecialDoctor = ['Dr. Rohana', 'Dr. Abdul Wahid', 'Dr. Zainal'].some(d => staffObj.name.toLowerCase().includes(d.toLowerCase()));
  if (isSpecialDoctor) return 25;
  if (staffObj.category === 'Doctor') return 20;

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
  const branchObj = branches.find(b => b.name === staffObj.branch.trim());
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
  const months = window.getMonthsWorkedThisYear(staffObj.startDate);
  return parseFloat(((entitlement * months) / 12).toFixed(2));
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
          <span style="font-weight: 700; font-size: 1.1rem; letter-spacing: -0.5px;">KSB PORTAL</span>
        </div>
        <nav class="nav-menu">
          ${(() => {
            const rKey = (user.role === 'admin' || user.role === 'hr' || user.role === 'Super Admin') ? 'admin' : (user.role === 'hod' ? 'hod' : 'staff');
            const rbac = window.rbacMatrix[rKey];
            return `
              ${rbac.dashboard ? `<div class="nav-item ${view === 'dashboard' ? 'active' : ''}" onclick="window.setView('dashboard')"><i class="icon-dash"></i> Dashboard</div>` : ''}
              ${rbac.leave_request ? `<div class="nav-item ${view === 'leave-form' ? 'active' : ''}" onclick="window.setView('leave-form')"><i class="icon-leave"></i> Leave Request</div>` : ''}
              ${rbac.management ? `<div class="nav-item ${view === 'management' ? 'active' : ''}" onclick="window.setView('management')"><i class="icon-manage"></i> Management</div>` : ''}
              ${rbac.policy ? `<div class="nav-item ${view === 'policy' ? 'active' : ''}" onclick="window.setView('policy')"><i class="icon-docs"></i> Policy</div>` : ''}
              ${rbac.settings ? `<div class="nav-item ${view === 'settings' ? 'active' : ''}" onclick="window.setView('settings')"><i class="icon-settings"></i> Settings</div>` : ''}
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
  const leaveForm = document.querySelector('.form-panel');
  if (leaveForm) {
    const fromInput = leaveForm.querySelector('input[type="date"]:nth-of-type(1)');
    const toInput = leaveForm.querySelector('input[type="date"]:nth-of-type(2)');
    const submitBtn = leaveForm.querySelector('button[type="submit"]');
    const durationDisplay = leaveForm.querySelector('.neu-panel span:last-child');

    const updateDuration = () => {
      if (fromInput.value && toInput.value) {
        const start = new Date(fromInput.value);
        const end = new Date(toInput.value);
        const diffTime = Math.abs(end - start);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
        
        if (durationDisplay) durationDisplay.innerText = `${diffDays} Day${diffDays > 1 ? 's' : ''}`;
        if (submitBtn) {
          submitBtn.style.opacity = '1';
          submitBtn.style.pointerEvents = 'auto';
        }
      }
    };

    if(fromInput) fromInput.addEventListener('change', updateDuration);
    if(toInput) toInput.addEventListener('change', updateDuration);

    leaveForm.addEventListener('submit', (e) => {
      e.preventDefault();
      
      const leaveTypeName = leaveCategories.find(c => c.id === selectedLeaveType)?.name || selectedLeaveType;
      const startDate = fromInput.value;
      const endDate = toInput.value;
      const reason = leaveForm.querySelector('textarea').value;
      const handover = leaveForm.querySelector('input[placeholder="Colleague\'s name..."]').value;
      
      const start = new Date(fromInput.value);
      const end = new Date(toInput.value);
      const diffTime = Math.abs(end - start);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

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

      const isAdmin = user.category === 'Admin Staff' || user.category === 'Admin' || user.role === 'admin' || user.role === 'Super Admin';
      
      if (!validateNotice(startDate, user.category)) {
        const minDays = isAdmin ? 3 : 7;
        alert(`Policy Violation: ${user.category} staff require at least ${minDays} days notice.`);
        return;
      }
      
      const copyText = `*LEAVE APPLICATION*${leaveBreakdown}\nStaff Name: ${user.name}\nIC Number: ${user.ic}\nLeave Type: ${leaveTypeName}\nFrom: ${startDate}\nTo: ${endDate}\nHandover To: ${handover}\nReason: ${reason}`;

      // Save to leaveRecords
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
      leaveRecords.push(newRecord);

      // WhatsApp notification to HOD
      const branchHODs = staffList.filter(s => s.role === 'hod' && s.branch === user.branch && s.phone);
      const hodToNotify = selectedHOD
        ? staffList.filter(s => s.ic === selectedHOD && s.phone)
        : branchHODs;
      
      const hodMsg = `📩 *PERMOHONAN CUTI BARU — KSB Portal*\n\nSebuah permohonan cuti baru memerlukan kelulusan anda.\n\n👤 Pemohon: *${user.name}*\n🏥 Cawangan: ${user.branch}\n📝 Jenis Cuti: *${leaveTypeName}*\n📅 Tarikh: ${startDate} → ${endDate}\n⏱ Tempoh: ${diffDays} hari\n💬 Sebab: ${reason}\n\nSila log masuk ke KSB Portal untuk meluluskan atau menolak permohonan ini.\n_— KSB Leave System_`;
      
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
          editForm.addEventListener('submit', (e) => {
              e.preventDefault();
              const staffObj = staffList.find(s => s.ic === editingStaff);
              const statusSelect = document.querySelector('#edit-status');
              const startInput = document.querySelector('#edit-start-date');
              if (staffObj) {
                  const statusSelect = document.querySelector('#edit-status');
                  const startInput = document.querySelector('#edit-start-date');
                  const branchSelect = editForm.querySelectorAll('select')[0];
                  const categorySelect = editForm.querySelectorAll('select')[1];
                  const roleSelect = editForm.querySelectorAll('select')[2];
                  const passwordInput = document.querySelector('#edit-password');
                  const phoneInput = document.querySelector('#edit-phone');

                  if(statusSelect) staffObj.inactive = statusSelect.value === 'inactive';
                  if(startInput) staffObj.startDate = startInput.value;
                  if(branchSelect) staffObj.branch = branchSelect.value;
                  if(categorySelect) staffObj.category = categorySelect.value;
                  if(roleSelect) staffObj.role = roleSelect.value;
                  if(passwordInput) staffObj.password = passwordInput.value;
                  if(phoneInput) staffObj.phone = phoneInput.value;
              }
              alert('Profil pekerja berjaya dikemaskini!');
              closeEditModal();
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
      if(elForm) elForm.addEventListener('submit', (e) => {
          e.preventDefault();
          const rec = leaveRecords.find(r => r.id === editingLeaveId);
          if(rec) {
              rec.status = document.querySelector('#el-status').value;
              rec.type = document.querySelector('#el-type').value;
              rec.reason = document.querySelector('#el-reason').value;
              rec.startDate = document.querySelector('#el-start').value;
              rec.endDate = document.querySelector('#el-end').value;
          }
          alert('Leave Application Updated successfully!');
          closeLeaveModal();
      });
  }
}

function renderView() {
  switch (view) {
    case 'dashboard':
      const roleKey = (user.role === 'admin' || user.role === 'hr' || user.role === 'Super Admin') ? 'admin' : (user.role === 'hod' ? 'hod' : 'staff');
      const showAnalisa = window.rbacMatrix[roleKey].dashboard === 'analisa';
      
      if (showAnalisa) {
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

          const months = ['Jan','Feb','Mac','Apr','Mei','Jun','Jul','Ogo','Sep','Okt','Nov','Dis'];
          const monthCounts = months.map((m, i) => leaveRecords.filter(r => {
              if (!r.startDate) return false;
              return new Date(r.startDate).getMonth() === i;
          }).length);
          const maxMonthCount = Math.max(...monthCounts, 1);
          
           return `
            <div class="analytics-dashboard fade-in" style="overflow-y: auto;">
              <header style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem;">
                <div>
                  <h1 style="display: flex; align-items: center; gap: 0.75rem; font-size: 1.5rem;">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="2.5"><path d="M12 20V10"></path><path d="M18 20V4"></path><path d="M6 20v-4"></path></svg>
                    ANALISA CUTI
                  </h1>
                  <p style="color: var(--text-muted); font-size: 0.85rem;">Gambaran keseluruhan rekod cuti seluruh kakitangan</p>
                </div>
                <div style="display: flex; gap: 0.75rem; align-items: center;">
                  <select id="month-filter" class="neu-inset" style="padding: 0.5rem 1rem; font-size: 0.75rem; width: auto;" onchange="window.setAnalyticsMonth(this.value)">
                    <option value="0" ${analyticsFilterMonth === 0 ? 'selected' : ''}>Semua Bulan</option>
                    ${['Jan','Feb','Mac','Apr','Mei','Jun','Jul','Ogo','Sep','Okt','Nov','Dis'].map((m,i) => `
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
                    ${months.map((m, i) => {
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
                   <div style="font-size: 0.7rem; color: var(--text-muted); margin-bottom: 1.5rem;">PECAHAN ${analyticsFilterMonth === 0 ? '2026' : months[analyticsFilterMonth-1]}</div>
                   ${(() => {
                     const colors = ['#3b82f6','#f59e0b','#10b981','#ef4444','#8b5cf6','#ec4899','#14b8a6','#f97316'];
                     const entries = Object.entries(types);
                     const circumference = 100; // using percentages for stroke-dasharray
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

      return `
        <header class="top-bar">
          <div>
            <h1 style="font-size: 1.75rem;">Welcome back, ${user.name.split(' ')[0]}!</h1>
            <p style="color: var(--text-muted);">Here's what's happening today.</p>
          </div>
          <div class="action-buttons">
            <button class="btn-primary" style="width: auto; padding: 0.75rem 1.5rem;" onclick="window.setView('leave-form')">+ New Request</button>
          </div>
        </header>

        <section class="stats-grid" style="grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));">
          ${leaveCategories.slice(0, 8).map(cat => `
            <div class="glass-card stat-card">
              <div class="stat-label">${cat.name} (${cat.id})</div>
              <div class="stat-value" style="color: var(--${cat.color})">
                ${Math.floor(Math.random() * cat.entitlement)}${cat.entitlement > 0 ? `<span class="stat-total">/${cat.entitlement}</span>` : ''}
              </div>
              <div class="stat-trend">Available Days</div>
            </div>
          `).join('')}
        </section>

        <section class="main-grid">
          <div class="glass-card activity-card">
            <h3>Recent Activity</h3>
            <table class="data-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Date</th>
                  <th>Duration</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${recentActivity.map(act => `
                  <tr>
                    <td>${act.type}</td>
                    <td>${act.date}</td>
                    <td>${act.duration}</td>
                    <td><span class="status-badge ${act.status.toLowerCase()}">${act.status}</span></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          <div class="glass-card info-card">
            <h3>Clinic Policy</h3>
            <div class="policy-item">
              <strong>Notice Period</strong>
              <p>Admin: 3 Days | Operations: 7 Days</p>
            </div>
            <div class="policy-item" style="margin-top: 1rem;">
              <strong>Active Branches</strong>
              <p>13 locations across Pahang & Terengganu</p>
            </div>
          </div>
        </section>
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
      
      return `
        <div class="split-layout fade-in">
          <!-- Left Panel: Form -->
          <div class="glass-pane form-panel" style="padding: 2.5rem;">
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

            ${isAL ? `
                <div class="notice-banner orange">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>
                    <div style="line-height:1.4">
                        <div style="font-weight: 700; font-size: 0.75rem; text-transform: uppercase;">Baki Bawa Dari Tahun Lepas</div>
                        <div style="font-size: 0.85rem;"><strong>3</strong> hari (daripada 5)</div>
                        <div style="font-size: 0.65rem; color: #fdba74; margin-top: 0.25rem;">⚡ Baki ini akan digunakan terlebih dahulu sebelum Annual Leave (AL) biasa ditolak.</div>
                    </div>
                </div>
            ` : ''}

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
                <span style="font-size: 1.75rem; font-weight: 800; color: var(--primary); text-shadow: 0 0 20px rgba(59, 130, 246, 0.3);">${selectedLeaveType === 'AL' ? window.getEarnedAL(user).toFixed(2) : currentCat.entitlement} <span style="font-size: 0.75rem; color: var(--text-muted); font-weight: 600;">HARI</span></span>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                <div class="form-group">
                    <label>From</label>
                    <input type="date" class="neu-inset" style="color-scheme: dark;">
                </div>
                <div class="form-group">
                    <label>To</label>
                    <input type="date" class="neu-inset" style="color-scheme: dark;">
                </div>
            </div>

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
                            PIILIH FAIL MC
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
                    <select class="neu-inset" style="appearance: none; padding-right: 2.5rem; font-weight: 600;">
                        <option>-- Pilih HOD --</option>
                        ${staffList.filter(s => s.role === 'hod' && s.branch === user.branch).map(hod => `<option>${hod.name}</option>`).join('')}
                    </select>
                    <div style="position: absolute; right: 1rem; top: 50%; transform: translateY(-50%); pointer-events: none; color: var(--text-muted);">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
                    </div>
                </div>
            </div>

            <div class="neu-panel" style="display: flex; justify-content: space-between; align-items: center; padding: 1rem; background: rgba(0,0,0,0.1);">
                <span style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase; font-weight: 700; display: flex; align-items: center; gap: 0.5rem;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg> Calculated Duration</span>
                <span style="font-size: 0.95rem; font-weight: 700;">Select dates</span>
            </div>

            <button type="submit" class="btn-primary" style="opacity: 0.5; pointer-events: none; display: flex; justify-content: center; align-items: center; gap: 0.5rem;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                SUBMIT REQUEST
            </button>
          </div>

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
                  <div class="balance-value-lg" style="color: var(--primary);">8</div>
                  <div class="balance-label-lg">Annual Leave</div>
                </div>
                <div class="balance-card-lg">
                  <div class="balance-value-lg" style="color: var(--accent);">14</div>
                  <div class="balance-label-lg">Medical Leave</div>
                </div>
              </div>
              
              <div class="neu-panel" style="text-align: center; color: var(--primary); font-size: 0.75rem; font-style: italic; background: rgba(59, 130, 246, 0.05);">
                AL Balance is pro-rated by month (4/12 of annual entitlement).
              </div>
            </div>

            <div class="glass-card" style="padding: 1.5rem;">
               <div style="text-transform: uppercase; font-size: 0.65rem; color: var(--text-muted); margin-bottom: 1.5rem; font-weight: 700;">My Leave Balance <span style="float: right; font-size: 0.5rem; color: white; background: var(--primary); padding: 2px 6px; border-radius: 4px;">STAFF</span></div>
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
                       <div class="neu-panel" style="width: 32px; height: 32px; padding: 0; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: 700; color: var(--primary);">8</div>
                    </div>
                    <div style="text-align: center;">
                       <span style="font-size: 0.5rem; display: block; color: var(--accent); font-weight: 700;">ML</span>
                       <div class="neu-panel" style="width: 32px; height: 32px; padding: 0; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: 700; color: var(--accent);">14</div>
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
                ${recentActivity.map(act => `
                   <div class="activity-item-compact">
                      <div class="activity-info">
                         <div class="activity-type">${act.name}</div>
                         <div style="font-size: 0.6rem; color: var(--text-muted);">${act.type} • ${act.duration} • <span style="color: var(--primary);">${act.date}</span></div>
                      </div>
                      <span style="font-size: 0.5rem; font-weight: 700; padding: 2px 6px; border: 1px solid ${act.status === 'APPROVED' ? 'var(--accent)' : 'var(--danger)'}; border-radius: 4px; color: ${act.status === 'APPROVED' ? 'var(--accent)' : 'var(--danger)'}; text-transform: uppercase;">${act.status}</span>
                   </div>
                `).join('')}
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
      if (user.role === 'staff' || user.category === 'Operation Staff' && user.role !== 'hod') {
          return `<div style="padding: 5rem; text-align: center; color: var(--danger); font-size: 1.25rem;">Akses Dihalang. Anda tidak mempunyai kebenaran pengurusan.</div>`;
      }
      
      const isFullAdmin = user.role === 'admin' || user.role === 'hr';
      const canManageBranches = isFullAdmin;
      
      if (!isFullAdmin && managementTab !== 'pending') {
          managementTab = 'pending'; 
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
                 <button class="neu-tab ${managementTab === 'pending' ? 'active' : ''}" onclick="window.setManageTab('pending')" style="border-radius: 999px;">Pending Approvals (${
                    leaveRecords.filter(r => {
                      const status = r.status || '';
                      const isAtypical = status.includes('PENDING') || status.includes('HOD') || status.includes('RECOM');
                      if (['admin', 'hr', 'Super Admin'].includes(user.role)) return isAtypical;
                      if (user.role === 'hod') return status === 'PENDING' && r.branch === user.branch;
                      return false;
                    }).length
                 })</button>
                 ${isFullAdmin ? `
                 <button class="neu-tab ${managementTab === 'staff' ? 'active' : ''}" onclick="window.setManageTab('staff')" style="border-radius: 999px;">Staff Management</button>
                 <button class="neu-tab ${managementTab === 'branches' ? 'active' : ''}" onclick="window.setManageTab('branches')" style="border-radius: 999px;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path></svg>
                    Branches
                 </button>
                 <button class="neu-tab ${managementTab === 'master_audit' ? 'active' : ''}" onclick="window.setManageTab('master_audit')" style="border-radius: 999px;">Master Audit</button>
                 <button class="neu-tab ${managementTab === 'login_audit' ? 'active' : ''}" onclick="window.setManageTab('login_audit')" style="border-radius: 999px;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
                    Login Audit
                 </button>
                 <button class="neu-tab ${managementTab === 'hr_reports' ? 'active' : ''}" onclick="window.setManageTab('hr_reports')" style="border-radius: 999px;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                    HR Reports
                 </button>
                 <button class="neu-tab ${managementTab === 'whatsapp_settings' ? 'active' : ''}" onclick="window.setManageTab('whatsapp_settings')" style="border-radius: 999px; color: #25d366;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
                    WA Settings
                 </button>
                 ` : ''}
            </div>
            ${isFullAdmin ? `
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
                  const isAtypical = r.status.includes('PENDING') || r.status.includes('HOD RECOM') || r.status.includes('HOD APP');
                  if (['admin', 'hr', 'Super Admin'].includes(user.role)) return isAtypical;
                  if (user.role === 'hod') return r.status === 'PENDING' && r.branch === user.branch;
                  return false;
              }).map(req => {
                const isFullBoss = ['admin', 'hr', 'Super Admin'].includes(user.role);
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

                  <div style="display: flex; gap: 1rem; margin-bottom: 1rem;">
                      <button class="neu-btn success-text" onclick="finalizeLeave(${req.id})">
                         <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                         ${isFullBoss ? (showHODIndicator ? 'Luluskan (Final)' : 'Luluskan (Direct)') : 'Sokong (Recommend)'}
                      </button>
                      <button class="neu-btn danger-text" onclick="rejectLeave(${req.id})">
                         <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
                         Reject
                      </button>
                  </div>

                  ${(() => {
                      const applicant = staffList.find(s => s.ic === req.ic);
                      if (applicant && applicant.category === 'Doctor') {
                          return `
                            <div style="padding: 1rem; background: rgba(59, 130, 246, 0.05); border: 1px solid rgba(59, 130, 246, 0.2); border-radius: 12px; margin-top: 0.5rem;">
                                <label style="font-size: 0.65rem; color: var(--primary); text-transform: uppercase; font-weight: 700; margin-bottom: 0.5rem; display: block;">Doktor Locum Pengganti <span style="color: var(--danger); font-size: 0.55rem; float: right;">★ WAJIB ISI SEBELUM APPROVE</span></label>
                                <input type="text" class="neu-inset" value="${req.locumName || ''}" placeholder="Nama Doktor Locum..." oninput="window.updateLocumName(${req.id}, this.value)" style="font-size: 0.8rem; padding: 0.5rem; ${!req.locumName ? 'border-color: rgba(239, 68, 68, 0.3);' : ''}">
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

        ${managementTab === 'whatsapp_settings' ? `
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
                <h2 style="font-size: 1.25rem; font-weight: 600;">Master Audit Logs</h2>
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
                                      ${r.status === 'REJECTED' ? 'color: var(--danger); background: rgba(239, 68, 68, 0.1);' : 
                                        r.status.includes('HOD') ? 'color: #eab308; background: rgba(234, 179, 8, 0.1);' : 
                                        r.status === 'PENDING' ? 'color: #eab308; border: 1px solid rgba(234, 179, 8, 0.4);' : 
                                        'color: var(--accent); background: rgba(34, 197, 94, 0.1);'}">
                                      ${r.status}
                                  </span>
                              </td>
                              <td style="padding: 1.5rem 1rem; text-align: right;">
                                  <div style="display: flex; gap: 1.25rem; justify-content: flex-end;">
                                      <button onclick="printLeave(${r.id})" style="background: none; border: none; cursor: pointer; color: #c084fc; transition: transform 0.2s;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V2h12v7"></path><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg></button>
                                      <button onclick="editLeave(${r.id})" style="background: none; border: none; cursor: pointer; color: #60a5fa; transition: transform 0.2s;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg></button>
                                      <button onclick="deleteLeave(${r.id})" style="background: none; border: none; cursor: pointer; color: #f87171; transition: transform 0.2s;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg></button>
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
              <div style="color: var(--text-muted); cursor: pointer;">Audit Logs</div>
            </div>
            <div style="display: flex; gap: 1.5rem; align-items: center; flex-wrap: wrap;">
              
              <div style="display: flex; align-items: center; gap: 0.75rem;">
                 <div class="neu-toggle ${showInactiveStaff ? 'active' : ''}" onclick="window.toggleInactive()"></div>
                 <span style="font-size: 0.75rem; font-weight: 600; color: var(--text-muted); letter-spacing: 0.5px; text-transform: uppercase;">Show Inactive</span>
              </div>
              
              <input type="text" class="neu-inset" placeholder="Search Staff..." value="${manageSearchQuery}" oninput="window.setManageSearch(this.value)" style="width: 200px; padding: 0.5rem 1rem; border-radius: 12px; font-size: 0.85rem; color-scheme: dark;">
              
              <select id="branch-filter" style="padding: 0.5rem 1rem; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.05); color: white; cursor: pointer; outline: none;">
                <option value="All" ${manageBranchFilter === 'All' ? 'selected' : ''}>Semua Cawangan (${staffList.length})</option>
                ${branches.map(b => `
                  <option value="${b.name}" ${manageBranchFilter === b.name ? 'selected' : ''}>
                    ${b.name} (${staffList.filter(s => s.branch === b.name).length})
                  </option>
                `).join('')}
              </select>
            </div>
          </div>
          
          <div id="manage-content" style="max-height: 500px; overflow-y: auto;">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>IC Number</th>
                  <th>Branch</th>
                  <th>Role / Cat</th>
                  <th>Ent</th>
                  <th>AL Bal</th>
                  ${user.ic === 'Super Admin' ? '<th>Password</th>' : ''}
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                ${filteredStaff.map(staff => {
                  const ent = window.getEntitlementAL(staff);
                  const usedLeaves = leaveRecords.filter(r => r.ic === staff.ic && r.status === 'APPROVED' && r.type === 'AL').reduce((acc, r) => acc + parseInt(r.days || 0), 0);
                  const alBal = ent - usedLeaves;
                  return `
                  <tr>
                    <td>
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
                    <td><span style="font-weight:700; color:#38bdf8; font-size: 1.1rem;">${ent}</span><span style="font-size: 0.65rem; color: var(--text-muted);"> Hari</span></td>
                    <td><span style="font-weight:700; color:#4ade80; font-size: 1.1rem;">${alBal}</span><span style="font-size: 0.65rem; color: var(--text-muted);"> Hari</span></td>
                    ${user.ic === 'Super Admin' ? `<td><code style="background: rgba(255,255,255,0.05); padding: 0.2rem 0.5rem; border-radius: 4px; font-family: monospace; font-size: 0.85rem; color: var(--primary);">${staff.password || staff.ic}</code></td>` : ''}
                    <td><button class="btn-logout" onclick="window.setEditingStaff('${staff.ic}')" style="width: auto; padding: 0.25rem 0.75rem; font-size: 0.75rem;">Edit</button></td>
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
          <h3>Branches & Audit Preview</h3>
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
              <h4 style="margin-bottom: 1rem; color: var(--secondary);">System Audit</h4>
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
                                  <div style="background: rgba(16, 185, 129, 0.2); color: #34d399; border-radius: 4px; display: inline-flex; width: 22px; height: 22px; align-items: center; justify-content: center;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg></div>
                                  <span style="font-size: 0.8rem; font-weight: 600; color: #cbd5e1; letter-spacing: 0.5px;">ANALISA<br>CUTI</span>
                              </div>
                          </td>`;
              } else {
                  return `<td style="padding: 1.5rem; border-right: 1px solid rgba(255,255,255,0.05); cursor: pointer;" onclick="window.toggleRbac('${role}', 'dashboard')">
                              <div style="display: flex; gap: 0.5rem; align-items: center; pointer-events: none;">
                                  <span>📋</span> <span style="font-size: 0.9rem; font-weight: 600; color: #cbd5e1;">Staff<br>View</span>
                              </div>
                          </td>`;
              }
          };

          const renderRbacCell = (role, module) => {
              const checked = window.rbacMatrix[role][module];
              if (checked) {
                  return `<td style="padding: 1.5rem; border-right: 1px solid rgba(255,255,255,0.05); cursor: pointer;" onclick="window.toggleRbac('${role}', '${module}')"><div style="background: rgba(16, 185, 129, 0.2); color: #34d399; border-radius: 4px; display: inline-flex; width: 22px; height: 22px; align-items: center; justify-content: center; pointer-events: none;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg></div></td>`;
              } else {
                  return `<td style="padding: 1.5rem; border-right: 1px solid rgba(255,255,255,0.05); cursor: pointer;" onclick="window.toggleRbac('${role}', '${module}')"><div style="display: flex; align-items: center; gap: 0.5rem; color: var(--text-muted); font-weight: 500; pointer-events: none;"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg> Hidden</div></td>`;
              }
          };

          return `
          <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 2rem; margin-top: 1rem;">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
              <h2 style="font-size: 1.25rem; font-weight: 600;">Role-Based Access Control matrix</h2>
          </div>

          <section class="glass-card fade-in" style="padding: 0; overflow: hidden; border: 1px solid rgba(255,255,255,0.05);">
              <div style="overflow-x: auto;">
                  <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.9rem;">
                      <thead>
                          <tr style="background: rgba(255,255,255,0.03); color: var(--text-muted); border-bottom: 1px solid rgba(255,255,255,0.05);">
                              <th style="padding: 1.25rem 1.5rem; font-weight: 600; border-right: 1px solid rgba(255,255,255,0.05);">Role</th>
                              <th style="padding: 1.25rem 1.5rem; font-weight: 600; border-right: 1px solid rgba(255,255,255,0.05);">Dashboard</th>
                              <th style="padding: 1.25rem 1.5rem; font-weight: 600; border-right: 1px solid rgba(255,255,255,0.05);">Leave Request</th>
                              <th style="padding: 1.25rem 1.5rem; font-weight: 600; border-right: 1px solid rgba(255,255,255,0.05);">Management</th>
                              <th style="padding: 1.25rem 1.5rem; font-weight: 600; border-right: 1px solid rgba(255,255,255,0.05);">Policy</th>
                              <th style="padding: 1.25rem 1.5rem; font-weight: 600;">Settings</th>
                          </tr>
                      </thead>
                      <tbody>
                          <!-- Admin / HR -->
                          <tr style="border-bottom: 1px solid rgba(255,255,255,0.05); transition: background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.02)'" onmouseout="this.style.background='transparent'">
                              <td style="padding: 1.5rem; font-weight: 700; font-size: 1rem; border-right: 1px solid rgba(255,255,255,0.05);">Admin<br>/ HR</td>
                              ${renderRbacDashboardCell('admin')}
                              ${renderRbacCell('admin', 'leave_request')}
                              ${renderRbacCell('admin', 'management')}
                              ${renderRbacCell('admin', 'policy')}
                              ${renderRbacCell('admin', 'settings')}
                          </tr>
                          <!-- HOD -->
                          <tr style="border-bottom: 1px solid rgba(255,255,255,0.05); transition: background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.02)'" onmouseout="this.style.background='transparent'">
                              <td style="padding: 1.5rem; font-weight: 700; font-size: 1rem; border-right: 1px solid rgba(255,255,255,0.05);">HOD</td>
                              ${renderRbacDashboardCell('hod')}
                              ${renderRbacCell('hod', 'leave_request')}
                              ${renderRbacCell('hod', 'management')}
                              ${renderRbacCell('hod', 'policy')}
                              ${renderRbacCell('hod', 'settings')}
                          </tr>
                          <!-- Staff -->
                          <tr style="transition: background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.02)'" onmouseout="this.style.background='transparent'">
                              <td style="padding: 1.5rem; font-weight: 700; font-size: 1rem; border-right: 1px solid rgba(255,255,255,0.05);">Staff</td>
                              ${renderRbacDashboardCell('staff')}
                              ${renderRbacCell('staff', 'leave_request')}
                              ${renderRbacCell('staff', 'management')}
                              ${renderRbacCell('staff', 'policy')}
                              ${renderRbacCell('staff', 'settings')}
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
                        <span style="font-weight: 600;">60129444295</span>
                    </div>

                    <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 1rem;">
                        <span style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600; letter-spacing: 1px; display: flex; align-items: center; gap: 0.25rem;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg> Email</span>
                        <span style="font-weight: 600; font-size: 0.8rem; color: var(--warning); display: flex; align-items: center; gap: 0.25rem;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg> Belum ditetapkan &mdash; Klik Edit</span>
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
                        <span style="font-weight: 600; font-size: 0.9rem;">HQ</span>
                    </div>

                    <div style="display: flex; flex-direction: column; gap: 0.25rem;">
                        <span style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600; letter-spacing: 1px;">Service Duration</span>
                        <span style="font-weight: 700; font-size: 0.9rem; color: var(--primary);">6 Years, 3 Months</span>
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

  const start = new Date(staff.startDate);
  const now = new Date();
  let yearsService = now.getFullYear() - start.getFullYear();
  if (now.getMonth() < start.getMonth() || (now.getMonth() === start.getMonth() && now.getDate() < start.getDate())) {
    yearsService--;
  }

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
                         <span id="years-badge-text">${yearsService} TAHUN BERKHIDMAT</span>
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
                 <select class="neu-inset" style="appearance: none; cursor: pointer;">
                     <option value="Admin Staff" ${staff.category === 'Admin Staff' ? 'selected' : ''}>Staff Admin</option>
                     <option value="Operation Staff" ${staff.category === 'Operation Staff' ? 'selected' : ''}>Staff Operasi</option>
                     <option value="Doctor" ${staff.category === 'Doctor' ? 'selected' : ''}>Doctor</option>
                     <option value="Super Admin" ${staff.category === 'Super Admin' ? 'selected' : ''}>Super Admin</option>
                 </select>
              </div>

              <div style="display: flex; flex-direction: column;">
                 <label style="font-size: 0.75rem; text-transform: uppercase; color: var(--text-muted); font-weight: 600; margin-bottom: 0.5rem; letter-spacing: 0.5px;">System Role</label>
                 <select class="neu-inset" style="appearance: none; cursor: pointer;">
                     <option value="admin" ${staff.role === 'admin' ? 'selected' : ''}>Admin</option>
                     <option value="hod" ${staff.role === 'hod' ? 'selected' : ''}>HOD</option>
                     <option value="hr" ${staff.role === 'hr' ? 'selected' : ''}>HR</option>
                     <option value="staff" ${staff.role === 'staff' ? 'selected' : ''}>Staff</option>
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
               <div style="display: flex; flex-direction: column;">
                 <label style="font-size: 0.75rem; text-transform: uppercase; color: #25d366; font-weight: 600; margin-bottom: 0.5rem; letter-spacing: 0.5px;">No. WhatsApp (Untuk Notifikasi)</label>
                 <input type="tel" id="edit-phone" class="neu-inset" placeholder="cth: 0129444295" value="${staff.phone || ''}" style="border: 1px solid rgba(37,211,102,0.2);">
               </div>
          
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1.5rem 2rem; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 2rem;">
            <div style="display: flex; flex-direction: column;">
               <label style="font-size: 0.85rem; margin-bottom: 0.5rem; color: var(--text-muted); font-weight: 500;">AL &mdash; Cuti Tahunan</label>
               <input type="number" class="neu-inset" value="15">
            </div>
            <div style="display: flex; flex-direction: column;">
               <label style="font-size: 0.85rem; margin-bottom: 0.5rem; color: var(--text-muted); font-weight: 500;">MC &mdash; Cuti Sakit</label>
               <input type="number" class="neu-inset" value="14">
            </div>
             <div style="display: flex; flex-direction: column;">
               <label style="font-size: 0.85rem; margin-bottom: 0.5rem; color: var(--text-muted); font-weight: 500;">HL &mdash; Cuti Hospitalisasi</label>
               <input type="number" class="neu-inset" value="60">
            </div>
            <div style="display: flex; flex-direction: column;">
               <label style="font-size: 0.85rem; margin-bottom: 0.5rem; color: var(--text-muted); font-weight: 500;">RL &mdash; Cuti Ganti</label>
               <input type="number" class="neu-inset" value="0">
            </div>
            <div style="display: flex; flex-direction: column;">
               <label style="font-size: 0.85rem; margin-bottom: 0.5rem; color: var(--text-muted); font-weight: 500;">ML &mdash; Cuti Bersalin</label>
               <input type="number" class="neu-inset" value="14">
            </div>
            <div style="display: flex; flex-direction: column;">
               <label style="font-size: 0.85rem; margin-bottom: 0.5rem; color: var(--text-muted); font-weight: 500;">PL &mdash; Cuti Isteri Bersalin</label>
               <input type="number" class="neu-inset" value="0">
            </div>
            <div style="display: flex; flex-direction: column;">
               <label style="font-size: 0.85rem; margin-bottom: 0.5rem; color: var(--text-muted); font-weight: 500;">EL &mdash; Cuti Kecemasan</label>
               <input type="number" class="neu-inset" value="0">
            </div>
            <div style="display: flex; flex-direction: column;">
               <label style="font-size: 0.85rem; margin-bottom: 0.5rem; color: var(--text-muted); font-weight: 500;">BL &mdash; Cuti Ihsan</label>
               <input type="number" class="neu-inset" value="0">
            </div>
            <div style="display: flex; flex-direction: column;">
               <label style="font-size: 0.85rem; margin-bottom: 0.5rem; color: var(--text-muted); font-weight: 500;">UL &mdash; Cuti Tanpa Gaji</label>
               <input type="number" class="neu-inset" value="0">
            </div>
            <div style="display: flex; flex-direction: column;">
               <label style="font-size: 0.85rem; margin-bottom: 0.5rem; color: var(--text-muted); font-weight: 500;">CF &mdash; Cuti Bawaan</label>
               <input type="number" class="neu-inset" value="0">
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

         <form id="edit-self-profile" style="padding: 2.5rem;" onsubmit="
            event.preventDefault(); 
            const phone = document.getElementById('self-phone').value;
            const email = document.getElementById('self-email').value;
            const s = staffList.find(i => i.ic === user.ic);
            if(s) { s.phone = phone; s.email = email; user.phone = phone; user.email = email; }
            alert('Profil berjaya dikemaskini!'); 
            window.setProfileSettings(false);
         ">
            
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
