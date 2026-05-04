export type Lang = 'BM' | 'BI';

const translations = {
    // ── NAV ──────────────────────────────────────────────
    nav_policy: { BM: 'Rujukan Polisi', BI: 'Policy Reference' },
    nav_dashboard: { BM: 'Dashboard', BI: 'Dashboard' },
    nav_leave: { BM: 'Borang Cuti', BI: 'Leave Form' },
    nav_overtime: { BM: 'Overtime', BI: 'Overtime' },
    nav_management: { BM: 'Pengurusan', BI: 'Management' },
    nav_settings: { BM: 'Tetapan', BI: 'Settings' },
    nav_logout: { BM: 'Log Keluar', BI: 'Log Out' },

    // ── LEAVE FORM ────────────────────────────────────────
    form_title: { BM: 'Borang Permohonan Cuti', BI: 'Leave Application Form' },
    form_staff_label: { BM: 'Nama Staff', BI: 'Staff Name' },
    form_choose_colleague: { BM: '-- Pilih Rakan Sekerja --', BI: '-- Choose Colleague --' },
    form_self: { BM: 'Diri Sendiri', BI: 'Self' },
    form_leave_category: { BM: 'Kategori Cuti', BI: 'Leave Category' },
    form_leave_annual: { BM: 'TAHUNAN', BI: 'ANNUAL' },
    form_leave_medical: { BM: 'PERUBATAN', BI: 'MEDICAL' },
    form_leave_cme: { BM: 'CME', BI: 'CME' },
    form_leave_hospitalization: { BM: 'HOSPITALISASI', BI: 'HOSPITALIZATION' },
    form_leave_compassionate: { BM: 'EHSAN', BI: 'COMPASSIONATE' },
    form_leave_emergency: { BM: 'KECEMASAN', BI: 'EMERGENCY' },
    form_leave_replacement: { BM: 'GANTI', BI: 'REPLACEMENT' },
    form_leave_unpaid: { BM: 'TANPA GAJI', BI: 'UNPAID' },
    form_leave_paternity: { BM: 'ISTERI BERSALIN', BI: 'PATERNITY' },
    form_leave_maternity: { BM: 'BERSALIN', BI: 'MATERNITY' },
    form_balance: { BM: 'Baki Cuti', BI: 'Leave Balance' },
    form_days: { BM: 'hari', BI: 'days' },
    form_duration: { BM: 'Bilangan Hari Cuti', BI: 'Number of Leave Days' },
    form_start_date: { BM: 'Tarikh Mula', BI: 'Start Date' },
    form_end_date: { BM: 'Tarikh Tamat', BI: 'End Date' },
    form_reason: { BM: 'Sebab Permohonan', BI: 'Reason for Leave' },
    form_reason_ph: { BM: 'Nyatakan sebab cuti...', BI: 'Briefly explain why...' },
    form_handover: { BM: 'Pengganti Tugas', BI: 'Duty Handover Replacement' },
    form_handover_ph: { BM: 'Nama rakan sekerja...', BI: "Colleague's name..." },
    form_hod_label: { BM: 'HOD Untuk Kelulusan', BI: 'HOD for Approval' },
    form_hod_auto: { BM: 'HOD Ditetapkan Automatik', BI: 'HOD Auto-Assigned' },
    form_submit: { BM: 'Hantar Permohonan', BI: 'Submit Application' },
    form_submitting: { BM: 'Menghantar...', BI: 'Submitting...' },

    // ML info banners
    ml_info: { BM: 'Medical Leave (MC) — Diluluskan secara automatik. Tidak memerlukan kelulusan HOD / HR / Admin. Permohonan ini adalah untuk makluman sahaja. Sila pastikan MC disertakan.', BI: 'Medical Leave (MC) — Auto-approved. No approval from HOD / HR / Admin required. This is for notification purposes only. Please attach your MC.' },
    cme_info: { BM: 'CME Leave — Hanya untuk Doktor sahaja. Entitlement: 5 hari setahun.', BI: 'CME Leave — Doctors only. Entitlement: 5 days per year.' },

    // MC Upload
    mc_label: { BM: 'Surat Cuti Sakit / MC', BI: 'Medical Certificate / MC' },
    mc_mandatory: { BM: '★ WAJIB', BI: '★ REQUIRED' },
    mc_hint: { BM: 'Sila muat naik MC yang dikeluarkan oleh doktor. Format: Gambar (JPG/PNG) atau PDF. Saiz maksimum: gambar 800px, PDF 500KB.', BI: 'Please upload a MC issued by the doctor. Format: JPG/PNG or PDF. Max size: image 800px, PDF 500KB.' },
    mc_uploaded: { BM: 'MC berjaya dimuat naik ✓', BI: 'MC uploaded successfully ✓' },
    mc_remove: { BM: 'Buang', BI: 'Remove' },
    mc_missing: { BM: 'MC belum dimuat naik — wajib sebelum hantar', BI: 'MC not uploaded — required before submitting' },

    // Death cert
    death_cert_label: { BM: 'Surat Kematian (Wajib Mesti Muat Naik)', BI: 'Death Certificate (Mandatory Upload)' },
    death_cert_note: { BM: '*Cuti Ehsan hanya terhad kepada 3 HARI SAHAJA. Sah untuk kematian ayah, ibu, suami, isteri, dan anak sahaja.', BI: '*Compassionate leave is limited to 3 DAYS ONLY. Valid for death of father, mother, spouse, and children only.' },
    emergency_proof_label: { BM: 'Gambar / Bukti Urusan Luar Jangka (Wajib)', BI: 'Photo / Proof of Emergency (Mandatory)' },
    emergency_proof_note: { BM: '*Sila muat naik bukti atau gambar berkaitan (contoh: gambar banjir, kerosakan kenderaan, dll) untuk simpanan rekod/audit.', BI: '*Please upload relevant proof or photos (e.g., flood photos, vehicle breakdown, etc.) for record/audit purposes.' },
    file_attached: { BM: 'Fail Disertakan', BI: 'File Attached' },

    // HOD locked texts
    hod_pahang_locked: { BM: 'HASIMAH BINTI MOHAMAD (Ditetapkan untuk Doktor Pahang)', BI: 'HASIMAH BINTI MOHAMAD (Locked for Pahang Doctors)' },
    hod_gebeng_locked: { BM: 'DR. ZAINAL (Ditetapkan untuk Klinik Gebeng)', BI: 'DR. ZAINAL (Locked for Gebeng Clinic)' },
    hod_beserah_locked: { BM: 'HASRI (Ditetapkan untuk Klinik Beserah)', BI: 'HASRI (Locked for Beserah Clinic)' },
    hod_kempadang_locked: { BM: 'ROHANA (Ditetapkan untuk Klinik Kempadang)', BI: 'ROHANA (Locked for Kempadang Clinic)' },
    hod_select_ph: { BM: '-- Pilih HOD --', BI: '-- Select HOD --' },

    // ── HISTORY ───────────────────────────────────────────
    history_title: { BM: 'Sejarah Permohonan', BI: 'Application History' },
    history_empty: { BM: 'Tiada rekod cuti.', BI: 'No leave records found.' },
    history_type: { BM: 'Jenis', BI: 'Type' },
    history_duration: { BM: 'Tempoh', BI: 'Duration' },
    history_status: { BM: 'Status', BI: 'Status' },
    history_date: { BM: 'Tarikh', BI: 'Date' },
    cancel_btn: { BM: 'Batal', BI: 'Cancel' },

    // ── STATUS ────────────────────────────────────────────
    status_pending: { BM: 'Menunggu', BI: 'Pending' },
    status_approved: { BM: 'Diluluskan', BI: 'Approved' },
    status_rejected: { BM: 'Ditolak', BI: 'Rejected' },
    status_hod_approved: { BM: 'Lulus HOD', BI: 'HOD Approved' },
    status_hr_approved: { BM: 'Lulus HR', BI: 'HR Approved' },
    status_cancelled: { BM: 'Dibatalkan', BI: 'Cancelled' },

    // ── DASHBOARD ─────────────────────────────────────────
    dash_title: { BM: 'Dashboard', BI: 'Dashboard' },
    dash_welcome: { BM: 'Selamat Datang', BI: 'Welcome' },
    dash_your_leaves: { BM: 'Baki Cuti Anda', BI: 'Your Leave Balances' },
    dash_al: { BM: 'Cuti Tahunan', BI: 'Annual Leave' },
    dash_ml: { BM: 'Cuti Sakit', BI: 'Medical Leave' },
    dash_recent: { BM: 'Permohonan Terkini', BI: 'Recent Applications' },
    dash_no_recent: { BM: 'Tiada permohonan terkini.', BI: 'No recent applications.' },
    dash_ai_insight: { BM: 'Jana Insight AI', BI: 'Generate AI Insight' },
    dash_generating: { BM: 'Menjana...', BI: 'Generating...' },

    // ── MANAGEMENT ────────────────────────────────────────
    mgmt_title: { BM: 'Pengurusan Staff', BI: 'Staff Management' },
    mgmt_approve: { BM: 'Lulus', BI: 'Approve' },
    mgmt_reject: { BM: 'Tolak', BI: 'Reject' },
    mgmt_pending_list: { BM: 'Senarai Menunggu', BI: 'Pending List' },
    mgmt_all_leave: { BM: 'Semua Cuti', BI: 'All Leave' },
    mgmt_staff_list: { BM: 'Senarai Staff', BI: 'Staff List' },
    mgmt_no_pending: { BM: 'Tiada permohonan menunggu kelulusan.', BI: 'No pending applications.' },

    // ── SETTINGS ──────────────────────────────────────────
    settings_title: { BM: 'Tetapan Profil', BI: 'Profile Settings' },
    settings_name: { BM: 'Nama Penuh', BI: 'Full Name' },
    settings_ic: { BM: 'No. Kad Pengenalan', BI: 'IC Number' },
    settings_phone: { BM: 'No. Telefon', BI: 'Phone Number' },
    settings_address: { BM: 'Alamat', BI: 'Address' },
    settings_save: { BM: 'Simpan', BI: 'Save' },
    settings_saved: { BM: 'Disimpan!', BI: 'Saved!' },
    settings_branch: { BM: 'Cawangan', BI: 'Branch' },
    settings_role: { BM: 'Peranan', BI: 'Role' },
    settings_dept: { BM: 'Jabatan', BI: 'Department' },
    settings_gender: { BM: 'Jantina', BI: 'Gender' },
    settings_join: { BM: 'Tarikh Mula Berkhidmat', BI: 'Join Date' },
    settings_password: { BM: 'Tukar Kata Laluan', BI: 'Change Password' },

    // ── LOGIN ─────────────────────────────────────────────
    login_title: { BM: 'Log Masuk', BI: 'Login' },
    login_ic: { BM: 'No. Kad Pengenalan', BI: 'IC Number' },
    login_password: { BM: 'Kata Laluan', BI: 'Password' },
    login_btn: { BM: 'Log Masuk', BI: 'Log In' },
    login_register: { BM: 'Daftar Baru', BI: 'Register' },
    login_no_acc: { BM: 'Belum ada akaun?', BI: "Don't have an account?" },

    // ── REGISTRATION ──────────────────────────────────────
    reg_title: { BM: 'Pendaftaran', BI: 'Registration' },
    reg_back: { BM: 'Kembali Log Masuk', BI: 'Back to Login' },
    reg_submit: { BM: 'Daftar', BI: 'Register' },

    // ── OVERTIME ──────────────────────────────────────────
    ot_title: { BM: 'Borang Overtime', BI: 'Overtime Form' },
    ot_date: { BM: 'Tarikh Overtime', BI: 'Overtime Date' },
    ot_hours: { BM: 'Bilangan Jam', BI: 'Number of Hours' },
    ot_reason: { BM: 'Sebab Overtime', BI: 'Reason for Overtime' },
    ot_submit: { BM: 'Hantar', BI: 'Submit' },
    ot_history: { BM: 'Sejarah Overtime', BI: 'Overtime History' },

    // ── POLICY ────────────────────────────────────────────
    policy_title: { BM: 'Rujukan Polisi Cuti', BI: 'Leave Policy Reference' },

    // ── ANALISA ───────────────────────────────────────────
    analisa_title: { BM: 'Analisa Cuti', BI: 'Leave Analytics' },

    // ── GENERAL ───────────────────────────────────────────
    general_loading: { BM: 'Memuatkan...', BI: 'Loading...' },
    general_error: { BM: 'Ralat', BI: 'Error' },
    general_success: { BM: 'Berjaya', BI: 'Success' },
    general_confirm: { BM: 'Sahkan', BI: 'Confirm' },
    general_cancel: { BM: 'Batal', BI: 'Cancel' },
    general_close: { BM: 'Tutup', BI: 'Close' },
    general_search: { BM: 'Cari...', BI: 'Search...' },
    general_filter: { BM: 'Tapis', BI: 'Filter' },
    general_all: { BM: 'Semua', BI: 'All' },
    general_name: { BM: 'Nama', BI: 'Name' },
    general_branch: { BM: 'Cawangan', BI: 'Branch' },
    general_date: { BM: 'Tarikh', BI: 'Date' },
    general_action: { BM: 'Tindakan', BI: 'Action' },
    general_edit: { BM: 'Edit', BI: 'Edit' },
    general_delete: { BM: 'Padam', BI: 'Delete' },
    general_view: { BM: 'Lihat', BI: 'View' },
    general_yes: { BM: 'Ya', BI: 'Yes' },
    general_no: { BM: 'Tidak', BI: 'No' },
    general_days: { BM: 'hari', BI: 'days' },
    general_hours: { BM: 'jam', BI: 'hours' },
    general_year: { BM: 'Tahun', BI: 'Year' },
    general_month: { BM: 'Bulan', BI: 'Month' },
};

export type TranslationKey = keyof typeof translations;

export function t(key: TranslationKey, lang: Lang): string {
    return translations[key]?.[lang] ?? key;
}

export default translations;
