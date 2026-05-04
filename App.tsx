import React, { useEffect, useState, useMemo } from 'react';
import { clsx } from 'clsx';
import {
  Activity, AlertCircle, FileText, Sparkles, Send, LayoutDashboard, History, Settings, LogOut, User as UserIcon, Zap,
  CheckCircle, XCircle, Users, Edit3, Trash2, ArrowRight, Calendar, Clock, BarChart2, Globe, ShieldAlert
} from 'lucide-react';
import { useLanguage } from './components/LanguageContext';
import { useIdleTimer } from './hooks/useIdleTimer';
import {
  initAuth,
  seedInitialData,
  subscribeToStaff,
  subscribeToLogs,
  submitLeaveApplication,
  approveLeave,
  rejectLeave,
  updateStaffData,
  deleteLeaveLog,
  calculateYearsOfService,
  subscribeToSessions,
  calculateAvailableCME,
  subscribeToOvertime,
  submitOvertime,
  approveOvertime,
  rejectOvertime,
  deleteOvertime,
  calculateEntitlement
} from './services/firebase';
import { generateLeaveSummary } from './services/gemini';
import { NeuCard, NeuButton, NeuInput, NeuBadge, NeuTextArea } from './components/NeuElements';
import { LoginPage } from './components/LoginPage';
import { RegistrationPage } from './components/RegistrationPage';
import { UserSettings } from './components/UserSettings';
import { ManagementView } from './components/ManagementView';
import { OvertimeView } from './components/OvertimeView';
import { PolicyView } from './components/PolicyView';
import { DashboardView } from './components/DashboardView';
import { Staff, LeaveLog, PAHANG_BRANCHES, OvertimeLog } from './types';

// ----- Constants -----
const COLORS = ['#4f46e5', '#3b82f6', '#64748b', '#0f172a']; // Indigo, Blue, Slate 500, Slate 900

const App: React.FC = () => {
  const { lang, setLang, t } = useLanguage();
  // ----- State -----
  const [currentUser, setCurrentUser] = useState<Staff | null>(null);
  const [authView, setAuthView] = useState<'login' | 'register'>('login');
  const [activeTab, setActiveTab] = useState<'policy' | 'dashboard' | 'management' | 'settings' | 'overtime' | 'admindash'>('dashboard');
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [logs, setLogs] = useState<LeaveLog[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [overtime, setOvertime] = useState<OvertimeLog[]>([]);
  const [loading, setLoading] = useState(true);

  // Form State
  const [selectedStaffIC, setSelectedStaffIC] = useState('');
  const [leaveType, setLeaveType] = useState<'AL' | 'MC' | 'HL' | 'ML' | 'PL' | 'EL' | 'BL' | 'RL' | 'UL' | 'CME'>('AL');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [dutyHandover, setDutyHandover] = useState('');
  const [selectedHod, setSelectedHod] = useState('');
  const [selectedApprover, setSelectedApprover] = useState(''); // for HOD-as-applicant (Balok)
  const [attachmentUrl, setAttachmentUrl] = useState<string | undefined>(undefined);

  const hodList = useMemo(() => staffList.filter(s => s.role === 'hod'), [staffList]);
  const hrList = useMemo(() => staffList.filter(s => s.role === 'hr'), [staffList]);
  // List for HOD-at-Balok: HODs from SAME branch (not self) + all HR staff
  const hodApproverList = useMemo(() => {
    const sameBranch = hodList.filter(h => h.id !== currentUser?.id && h.branch === currentUser?.branch);
    return [...sameBranch, ...hrList];
  }, [hodList, hrList, currentUser?.id, currentUser?.branch]);
  const isHodAtBalok = currentUser?.role === 'hod' && (currentUser?.branch?.toLowerCase().includes('balok') ?? false);
  const [duration, setDuration] = useState<number | ''>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const [sessionMessage, setSessionMessage] = useState<string | null>(null);

  // Insight State
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [generatingAi, setGeneratingAi] = useState(false);

  // ----- Computed Data -----

  const selectedStaff = useMemo(() => {
    const targetIc = (currentUser ? currentUser.ic : selectedStaffIC).replace(/-/g, '');
    return staffList.find(s => s.ic.replace(/-/g, '') === targetIc);
  }, [staffList, selectedStaffIC, currentUser]);

  // Pro-rated AL: (entitlement × currentMonth / 12) + carryForward - usedAL
  const calculateProRatedAL = (staff: typeof currentUser, allLogs: typeof logs): number => {
    if (!staff) return 0;
    const entitlement = calculateEntitlement(staff as any);
    const carryForward = (staff as any).prevYearBalance ?? 0;
    const currentMonth = new Date().getMonth() + 1; // 1–12
    const currentYear = new Date().getFullYear();

    const joinDateStr = (staff as any)?.joinDate;
    const joinDate = joinDateStr ? new Date(joinDateStr) : null;
    let startMonth = 1;
    if (joinDate && joinDate.getFullYear() === currentYear) {
      startMonth = joinDate.getMonth() + 1;
    }
    const monthsThisYear = Math.max(0, currentMonth - startMonth + 1);

    const rawProrate = (entitlement * monthsThisYear) / 12;
    const proRatedAllocation = Number(rawProrate.toFixed(2)) + carryForward;

    const usedAL = allLogs
      .filter(l =>
        l.staffId.replace(/-/g, '') === staff.id.replace(/-/g, '') &&
        l.type === 'AL' &&
        (l.status === 'approved' || l.status === 'hod_approved' || l.status === 'hr_approved' || l.status === 'pending') &&
        new Date(l.startDate).getFullYear() === currentYear
      )
      .reduce((sum, l) => sum + l.duration, 0);
    return Math.max(0, proRatedAllocation - usedAL);
  };

  const currentBalance = useMemo(() => {
    if (!selectedStaff) return 0;
    if (leaveType === 'AL' || leaveType === 'EL') {
      return selectedStaff.balanceAL;
    }
    if (leaveType === 'MC') return selectedStaff.balanceMC ?? 14;
    if (leaveType === 'HL') return selectedStaff.balanceHL ?? 0;
    if (leaveType === 'RL') return selectedStaff.balanceRL ?? 0;
    if (leaveType === 'CME') return calculateAvailableCME(selectedStaff.id, logs);
    if (leaveType === 'BL') {
      const usedEhsan = logs
        .filter(l => l.staffId === selectedStaff.id &&
          l.type === 'BL' &&
          (l.status === 'approved' || l.status === 'hod_approved' || l.status === 'pending') &&
          new Date(l.startDate).getFullYear() === new Date().getFullYear())
        .reduce((sum, l) => sum + l.duration, 0);
      return Math.max(0, 3 - usedEhsan);
    }
    if (leaveType === 'PL') return 7;
    if (leaveType === 'ML') return 98;
    return 999;
  }, [selectedStaff, leaveType, logs]);

  const isDurationValid = useMemo(() => {
    if (typeof duration !== 'number' || duration <= 0) return true;
    if (!selectedStaff) return true;
    // For AL, Emergency and CME, it's always "valid" because overflow handles it (AL -> Unpaid, CME -> AL -> Unpaid)
    if (leaveType === 'AL' || leaveType === 'EL' || leaveType === 'CME') return true;

    // Policy: Paternity/Maternity limited to 5 times (anak 1-5)
    if (leaveType === 'PL' || leaveType === 'ML') {
      const maternityCount = logs.filter(l =>
        l.staffId === selectedStaff.id &&
        (l.type === 'PL' || l.type === 'ML') &&
        (l.status === 'approved' || l.status === 'hod_approved' || l.status === 'pending')
      ).length;
      if (maternityCount >= 5) return false;
    }

    return duration <= currentBalance;
  }, [duration, currentBalance, selectedStaff, leaveType, logs]);

  // ----- Effects -----

  useEffect(() => {
    const init = async () => {
      try {
        await initAuth();
        await seedInitialData(); 
      } catch (err) {
        console.error("Initialization error:", err);
      } finally {
        // Check for saved session
        const savedUser = localStorage.getItem('logged_in_user');
        if (savedUser) {
          try {
            setCurrentUser(JSON.parse(savedUser));
          } catch (e) {
            localStorage.removeItem('logged_in_user');
          }
        }
        setLoading(false);
      }
    };
    init();

    // Real-time Listeners
    const unsubStaff = subscribeToStaff(setStaffList);
    const unsubLogs = subscribeToLogs(setLogs);
    const unsubSessions = subscribeToSessions(setSessions);
    const unsubOvertime = subscribeToOvertime(setOvertime);

    return () => {
      unsubStaff();
      unsubLogs();
      unsubSessions();
      unsubOvertime();
    };
  }, []);

  // Update current user data from staff list (to keep balances and profile details in sync)
  useEffect(() => {
    if (currentUser && staffList.length > 0) {
      const updated = staffList.find(s => s.id === currentUser.id || s.ic === currentUser.ic);
      if (updated) {
        // Multi-device detection: If sessionId exists and doesn't match our local one, 
        // it means another session was started elsewhere for this account
        if (currentUser.sessionId && updated.sessionId && updated.sessionId !== currentUser.sessionId) {
          handleLogout(lang === 'BM'
            ? '⚠️ Akaun anda telah log masuk di peranti lain. Sila log masuk semula.'
            : '⚠️ Your account was signed in on another device. Please log in again.');
          return;
        }

        // Only update if there's actually a change to prevent unnecessary re-renders or loops
        if (JSON.stringify(updated) !== JSON.stringify(currentUser)) {
          console.log(`Syncing user data for ${updated.name}`);
          setCurrentUser(updated);
          localStorage.setItem('logged_in_user', JSON.stringify(updated));
        }
      }
    }
  }, [staffList, currentUser, lang]);

  // Handle auto-calculation of duration from dates
  useEffect(() => {
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      const diffTime = end.getTime() - start.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; // +1 to include both days
      if (diffDays > 0) {
        setDuration(diffDays);
      } else {
        setDuration('');
      }
    }
  }, [startDate, endDate]);

  // Auto-set End Date for Paternity/Maternity based on Gender
  useEffect(() => {
    if ((leaveType === 'PL' || leaveType === 'ML') && startDate && selectedStaff) {
      const start = new Date(startDate);
      const daysToAdd = leaveType === 'ML' ? 97 : 6;
      const end = new Date(start);
      end.setDate(start.getDate() + daysToAdd);

      const endStr = end.toISOString().split('T')[0];
      if (endStr !== endDate) {
        setEndDate(endStr);
      }
    }
  }, [startDate, leaveType, selectedStaff]);




  const dashboardStats = useMemo(() => {
    if (!currentUser) return { totalDays: 0, totalUnpaid: 0 };

    const userLogs = logs.filter(l => l.staffId === currentUser.id);
    const approvedLogs = userLogs.filter(l => l.status === 'approved');

    const totalDays = approvedLogs.reduce((acc, log) => acc + log.duration, 0);
    const totalUnpaid = approvedLogs
      .filter(l => l.type === 'UL')
      .reduce((acc, log) => acc + log.duration, 0);

    return { totalDays, totalUnpaid };
  }, [logs, currentUser]);

  // ----- Handlers -----

  const handleLogin = (user: Staff) => {
    setCurrentUser(user);
    localStorage.setItem('logged_in_user', JSON.stringify(user));
  };

  const handleLogout = (message?: string) => {
    setCurrentUser(null);
    localStorage.removeItem('logged_in_user');
    if (message) setSessionMessage(message);
  };

  // ── Auto-logout after 10 min idle ──────────────────────
  const idleLogout = () => {
    handleLogout(lang === 'BM'
      ? 'Sesi anda telah tamat kerana tidak aktif selama 10 minit.'
      : 'Your session has expired due to 10 minutes of inactivity.');
  };
  const { isWarning, secondsLeft, reset: resetIdle } = useIdleTimer({
    idleTimeout: 10 * 60 * 1000,  // 10 minutes
    warningBefore: 60 * 1000,    // warn at 4 min
    onLogout: idleLogout,
  });


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (!selectedStaff) {
      setSubmitError('Sila pilih pekerja sebelum menghantar permohonan.');
      return;
    }

    // Date validation
    if (!startDate || !endDate) {
      setSubmitError('Sila pilih tarikh mula dan tamat cuti.');
      return;
    }
    if (new Date(endDate) < new Date(startDate)) {
      setSubmitError('Tarikh tamat tidak boleh lebih awal dari tarikh mula.');
      return;
    }

    if (!duration || duration <= 0) {
      setSubmitError('Tempoh cuti tidak sah. Sila semak tarikh yang dipilih.');
      return;
    }

    if (!isDurationValid) {
      setSubmitError('Baki cuti tidak mencukupi untuk permohonan ini.');
      return;
    }

    // Reason min length
    if (reason.trim().length < 5) {
      setSubmitError('Sila berikan sebab yang lebih terperinci (sekurang-kurangnya 5 aksara).');
      return;
    }

    // MC upload is mandatory for Medical Leave
    if (leaveType === 'MC' && !attachmentUrl) {
      setSubmitError('Sila muat naik Surat Cuti Sakit (MC) sebelum menghantar permohonan Medical Leave.');
      return;
    }

    // Proof mandatory for Emergency Leave
    if (leaveType === 'EL' && !attachmentUrl) {
      setSubmitError('Sila muat naik gambar atau bukti urusan luar jangka sebelum menghantar permohonan Cuti Kecemasan.');
      return;
    }

    // Advanced Notice Validation Policy
    if (leaveType !== 'BL' && leaveType !== 'MC') {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const leaveStart = new Date(startDate);
      const diffTime = leaveStart.getTime() - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      const typeOfStaff = selectedStaff.staffType || 'operation_staff'; // Default strictly to 1 week if not set

      if (typeOfStaff === 'admin_staff' && diffDays < 3) {
        setSubmitError("Gagal: Staff Pentadbiran mesti memohon cuti sekurang-kurangnya 3 hari sebelum tarikh bercuti.");
        return;
      }
      if ((typeOfStaff === 'operation_staff' || typeOfStaff === 'doctor') && diffDays < 7) {
        setSubmitError("Gagal: Staff Operasi / Doktor mesti memohon cuti sekurang-kurangnya 1 minggu (7 hari) sebelum tarikh bercuti.");
        return;
      }
    }

    const isPahangDoctorSubmit = selectedStaff.staffType === 'doctor' && PAHANG_BRANCHES.includes(selectedStaff.branch || '');
    const isGebengStaff = selectedStaff.branch === 'Klinik Syed Badaruddin Gebeng';
    const isBeserahStaff = selectedStaff.branch === 'Klinik Syed Badaruddin Beserah';
    const isKempadangStaff = selectedStaff.branch === 'Klinik Syed Badaruddin Kempadang';

    // CME leave by Pahang doctors (excluding Uni Klinik Bentong) -> always Hasimah
    const CME_PAHANG_BRANCHES = PAHANG_BRANCHES.filter(b => b !== 'Uni Klinik Bentong');
    const isCmePahangDoctorNonBentong =
      leaveType === 'CME' &&
      selectedStaff.staffType === 'doctor' &&
      CME_PAHANG_BRANCHES.includes(selectedStaff.branch || '');

    const hasimahId = '740407115242';
    const zainalId = '700210016105';
    const hasriId = '880714115511';
    const rohanaId = '720107035322';

    // Priority: CME Pahang (non-Bentong) doctor -> Hasimah, else existing branch routing
    const finalHod = isCmePahangDoctorNonBentong ? hasimahId :
      (isPahangDoctorSubmit ? hasimahId :
        (isGebengStaff ? zainalId :
          (isBeserahStaff ? hasriId :
            (isKempadangStaff ? rohanaId : selectedHod))));

    // Validation: Staff must select HOD; HOD-at-Balok must select an approver
    if (currentUser?.role === 'staff' && !finalHod) {
      setSubmitError("Please select an HOD to approve your leave.");
      return;
    }
    if (isHodAtBalok && !selectedApprover) {
      setSubmitError("Sila pilih HOD lain atau HR untuk meluluskan cuti anda.");
      return;
    }

    setIsSubmitting(true);
    const result = await submitLeaveApplication(
      selectedStaff.id,
      selectedStaff.name,
      leaveType,
      duration,
      startDate,
      endDate,
      reason.trim(),
      dutyHandover,
      isHodAtBalok ? selectedApprover : (currentUser?.role === 'staff' ? finalHod : undefined),
      attachmentUrl
    );

    if (result.success) {
      setSubmitSuccess(result.message || (lang === 'BM' ? 'Permohonan berjaya dihantar!' : 'Application submitted successfully!'));
      setDuration('');
      setStartDate('');
      setEndDate('');
      setReason('');
      setDutyHandover('');
      setSelectedHod('');
      setSelectedApprover('');
      setAttachmentUrl(undefined);
    } else {
      setSubmitError(result.error || 'Submission failed. Please try again.');
    }
    setIsSubmitting(false);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/') && file.type !== 'application/pdf') {
      setSubmitError('Sila muat naik format gambar (JPG/PNG) atau PDF sahaja.');
      return;
    }

    if (file.type === 'application/pdf') {
      if (file.size > 500 * 1024) {
        setSubmitError('Saiz PDF terlalu besar (Maksimum 500KB).');
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        setAttachmentUrl(ev.target?.result as string);
      };
      reader.readAsDataURL(file);
      return;
    }

    // Resize image to prevent Firestore 1MB limit exceed
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 800;
        const MAX_HEIGHT = 800;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.6); // 60% quality JPEG
        setAttachmentUrl(dataUrl);
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleGenerateInsight = async () => {
    setGeneratingAi(true);
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    // Filter for the current user's personal logs for dashboard insights
    const myRecentLogs = logs.filter(l => l.staffId === currentUser?.id && l.timestamp > thirtyDaysAgo && l.status === 'approved');

    try {
      const summary = await generateLeaveSummary(myRecentLogs);
      setAiSummary(summary);
    } catch (err) {
      console.error(err);
      setAiSummary("Failed to generate insights. Please try again.");
    } finally {
      setGeneratingAi(false);
    }
  };

  // ----- Render Helpers -----

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-transparent text-white/60">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <Activity className="w-12 h-12 animate-spin text-modern-accent" />
          <p className="font-bold tracking-[0.3em] text-[10px] uppercase">Initializing KSB HR</p>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    if (authView === 'register') {
      return <RegistrationPage onRegister={handleLogin} onBack={() => setAuthView('login')} />;
    }
    return <LoginPage onLogin={handleLogin} onGoToRegister={() => setAuthView('register')} sessionMessage={sessionMessage} onClearMessage={() => setSessionMessage(null)} />;
  }

  return (
    <div className="min-h-screen bg-transparent p-4 md:p-8 overflow-x-hidden flex flex-col items-center selection:bg-indigo-300/30 selection:text-white">

      {/* ── Auto-Logout Warning Modal ────────────────────── */}
      {isWarning && (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-md">
      <div className="bg-white rounded-[32px] shadow-neu-lg border border-white/50 p-10 max-w-sm w-full text-center space-y-6 animate-in fade-in zoom-in duration-300">
            {/* Icon */}
            <div className="flex justify-center">
              <div className="w-20 h-20 rounded-full bg-modern-bg flex items-center justify-center border border-modern-border/50">
                <ShieldAlert className="w-10 h-10 text-modern-accent" />
              </div>
            </div>

            {/* Title */}
            <div>
              <h2 className="text-lg font-black text-modern-primary uppercase tracking-widest">
                {lang === 'BM' ? 'Sesi Hampir Tamat' : 'Session Expiring'}
              </h2>
              <p className="text-sm text-modern-muted font-bold mt-1">
                {lang === 'BM'
                  ? 'Anda tidak aktif. Sistem akan log keluar secara automatik dalam:'
                  : 'You have been inactive. You will be automatically logged out in:'}
              </p>
            </div>

            {/* Countdown */}
            <div className="relative w-28 h-28 mx-auto">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="44" fill="none" stroke="#e2e8f0" strokeWidth="8" />
                <circle
                  cx="50" cy="50" r="44" fill="none"
                  stroke={secondsLeft > 30 ? '#4f46e5' : '#ef4444'}
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray={`${2 * Math.PI * 44}`}
                  strokeDashoffset={`${2 * Math.PI * 44 * (1 - secondsLeft / 60)}`}
                  style={{ transition: 'stroke-dashoffset 1s linear, stroke 0.5s' }}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className={clsx('text-4xl font-black tabular-nums', secondsLeft > 30 ? 'text-modern-accent' : 'text-rose-500')}>
                  {secondsLeft}
                </span>
                <span className="text-[10px] font-bold text-modern-muted uppercase tracking-widest">
                  {lang === 'BM' ? 'saat' : 'sec'}
                </span>
              </div>
            </div>

            <div className="flex gap-3">
              <NeuButton
                variant="primary"
                onClick={resetIdle}
                className="flex-1 py-4 uppercase tracking-widest text-xs"
              >
                {lang === 'BM' ? 'Teruskan Sesi' : 'Stay Logged In'}
              </NeuButton>
              <NeuButton
                variant="danger"
                onClick={handleLogout}
                className="px-5 py-4"
              >
                <LogOut className="w-4 h-4" />
              </NeuButton>
            </div>
          </div>
        </div>
      )}

      <div className="w-full max-w-7xl space-y-8">

        <header className="mb-6">
          <div className="flex flex-col items-center justify-center py-10 space-y-6">
            <div className="flex items-center gap-6">
              {[
                { src: "/logo-ksb.jpg", alt: "KSB" },
                { src: "/logo-kr.jpg", alt: "KR" },
                { src: "/logo-bentong.jpg", alt: "Bentong" }
              ].map((logo, idx) => (
                <div key={idx} className="w-20 h-20 md:w-24 md:h-24 rounded-full bg-white shadow-neu-md border-4 border-white overflow-hidden flex items-center justify-center p-1">
                  <img src={logo.src} alt={logo.alt} className="w-full h-full object-contain" />
                </div>
              ))}
            </div>
            <div className="text-center">
              <h1 className="text-4xl md:text-5xl font-black text-slate-900 tracking-tighter uppercase">Klinik Syed Badaruddin</h1>
              <p className="text-[10px] md:text-xs font-bold text-modern-accent tracking-[0.4em] uppercase mt-2">Leave Tracking System</p>
            </div>
          </div>

          <div className="bg-modern-card rounded-[24px] shadow-neu-md border border-white/50 px-5 py-3 flex flex-col sm:flex-row items-center justify-between gap-4">
            {/* Nav buttons */}
            <nav className="flex items-center gap-1.5 overflow-x-auto flex-nowrap pb-0.5 flex-1">
              <NeuButton
                onClick={() => setActiveTab('policy')}
                active={activeTab === 'policy'}
                className="px-3.5 py-2 flex items-center gap-1.5 whitespace-nowrap text-[10px] uppercase font-black tracking-widest flex-shrink-0"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>{t('nav_policy')}</span>
              </NeuButton>

              {(currentUser.role === 'admin' || currentUser.role === 'super_admin') && (
                <NeuButton
                  onClick={() => setActiveTab('admindash')}
                  active={activeTab === 'admindash'}
                  className="px-3.5 py-2 flex items-center gap-1.5 whitespace-nowrap text-[10px] uppercase font-black tracking-widest flex-shrink-0"
                >
                  <BarChart2 className="w-3.5 h-3.5 text-modern-accent" />
                  <span>{t('nav_dashboard')}</span>
                </NeuButton>
              )}

              <NeuButton
                onClick={() => setActiveTab('dashboard')}
                active={activeTab === 'dashboard'}
                className="px-3.5 py-2 flex items-center gap-1.5 whitespace-nowrap text-[10px] uppercase font-black tracking-widest flex-shrink-0"
              >
                <LayoutDashboard className="w-3.5 h-3.5" />
                <span>{t('nav_leave')}</span>
              </NeuButton>

              {/* 
              <NeuButton
                onClick={() => setActiveTab('overtime')}
                active={activeTab === 'overtime'}
                className="px-3.5 py-2 flex items-center gap-1.5 whitespace-nowrap text-xs flex-shrink-0"
              >
                <Clock className="w-3.5 h-3.5" />
                <span>{t('nav_overtime')}</span>
              </NeuButton>
              */}

              {currentUser.role && currentUser.role !== 'staff' && (
                <NeuButton
                  onClick={() => setActiveTab('management')}
                  active={activeTab === 'management'}
                  className="px-3.5 py-2 flex items-center gap-1.5 whitespace-nowrap text-[10px] uppercase font-black tracking-widest flex-shrink-0"
                >
                  <Users className="w-3.5 h-3.5 text-modern-accent" />
                  <span>{t('nav_management')}</span>
                </NeuButton>
              )}

              <NeuButton
                onClick={() => setActiveTab('settings')}
                active={activeTab === 'settings'}
                className="px-3.5 py-2 flex items-center gap-1.5 whitespace-nowrap text-[10px] uppercase font-black tracking-widest flex-shrink-0"
              >
                <Settings className="w-3.5 h-3.5" />
                <span>{t('nav_settings')}</span>
              </NeuButton>
            </nav>

            {/* Divider */}
            <div className="hidden sm:block w-px h-8 bg-modern-border/30 flex-shrink-0" />

            {/* BM | BI Language Toggle */}
            <div className="flex items-center gap-1 bg-modern-bg rounded-xl border border-modern-border p-1 flex-shrink-0 shadow-neu-sm">
              <Globe className="w-3 h-3 text-modern-muted ml-1" />
              <button
                onClick={() => setLang('BM')}
                className={clsx(
                  'px-2.5 py-1 rounded-lg text-[10px] font-black uppercase transition-all duration-200',
                  lang === 'BM'
                    ? 'bg-white shadow-neu-sm text-modern-accent'
                    : 'text-modern-muted hover:text-slate-600'
                )}
              >BM</button>
              <span className="text-modern-border text-[10px]">|</span>
              <button
                onClick={() => setLang('BI')}
                className={clsx(
                  'px-2.5 py-1 rounded-lg text-[10px] font-black uppercase transition-all duration-200',
                  lang === 'BI'
                    ? 'bg-white shadow-neu-sm text-modern-accent'
                    : 'text-modern-muted hover:text-slate-600'
                )}
              >BI</button>
            </div>

            {/* Staff name + Logout */}
            <div className="flex items-center gap-2.5 flex-shrink-0">
              <div className="text-right">
                <p className="text-xs font-black text-modern-primary leading-none uppercase tracking-tight">{currentUser.name}</p>
                <p className="text-[9px] font-bold text-modern-muted uppercase tracking-widest mt-0.5">{currentUser.role || 'Staff'}</p>
              </div>
              <NeuButton
                onClick={handleLogout}
                className="px-3 py-2 text-rose-500 bg-rose-50/50 hover:bg-rose-100/50 border-rose-100 flex items-center gap-1.5 text-[10px] uppercase font-black tracking-widest flex-shrink-0 transition-all"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="font-black">{t('nav_logout')}</span>
              </NeuButton>
            </div>
          </div>
        </header>


        {activeTab === 'policy' ? (
          <PolicyView user={currentUser} logs={logs} />
        ) : activeTab === 'settings' ? (
          <UserSettings user={currentUser} logs={logs} onLogout={handleLogout} />
        ) : activeTab === 'management' ? (
          <ManagementView user={currentUser} staffList={staffList} logs={logs} sessions={sessions} />
        ) : activeTab === 'admindash' && (currentUser.role === 'admin' || currentUser.role === 'super_admin') ? (
          <DashboardView staffList={staffList} logs={logs} />
        ) : (
          /* Main Dashboard Tab */
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 animate-fade-in">
            {new Date().getMonth() === 0 && currentUser.prevYearBalance && currentUser.prevYearBalance > 3 && (
              <div className="lg:col-span-12">
                <div className="bg-modern-bg border-l-8 border-modern-accent text-modern-primary p-6 rounded-2xl shadow-neu-md border border-modern-border flex flex-col md:flex-row items-center justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <AlertCircle className="w-8 h-8 text-modern-accent mt-1" />
                    <div>
                      <h2 className="font-bold text-lg uppercase tracking-widest text-modern-primary">Carry-Forward Limit Reached</h2>
                      <p className="text-sm font-medium text-modern-muted mt-1 uppercase tracking-tight">
                        You had <strong className="text-modern-primary">{currentUser.prevYearBalance} days</strong> remaining from last year.
                        However, the maximum carry-forward limit is 3 days.
                        <span className="block mt-1 bg-modern-bg px-2 py-0.5 rounded text-modern-primary border border-modern-border inline-block font-black">
                          {currentUser.prevYearBalance - 3} days have been forfeited.
                        </span>
                      </p>
                    </div>
                  </div>
                  <div className="hidden md:block text-right">
                    <span className="text-5xl font-black text-modern-accent/20">MAX:3</span>
                  </div>
                </div>
              </div>
            )}

            {/* LEFT COLUMN: Application Form (4 cols) */}
            <div className="lg:col-span-4 space-y-10">
              <NeuCard className="relative overflow-hidden group border-transparent">
                <div className="absolute top-0 left-0 w-1.5 h-full bg-modern-accent"></div>
                <h2 className="text-xl font-bold text-modern-primary mb-8 flex items-center gap-3 uppercase tracking-widest">
                  <FileText className="w-6 h-6 text-modern-accent" />
                  New Application
                </h2>

                <form onSubmit={handleSubmit} className="space-y-8">
                  {/* Staff Select (Visible only for Admins, Staff are locked to their own) */}
                  <div className="space-y-3">
                    <label className="text-[10px] font-black text-modern-muted uppercase tracking-[0.2em] ml-2">Request Origin</label>
                    {currentUser.role === 'admin' || currentUser.role === 'super_admin' ? (
                      <div className="relative group">
                        <select
                          aria-label="Request Origin"
                          value={selectedStaffIC}
                          onChange={(e) => setSelectedStaffIC(e.target.value)}
                          className="w-full appearance-none bg-modern-bg rounded-2xl border border-modern-border px-5 py-4 text-modern-primary outline-none focus:border-modern-accent transition-all duration-300 cursor-pointer text-sm font-bold shadow-neu-sm"
                        >
                          <option value="">-- Choose Colleague --</option>
                          {staffList.filter(s => s.active !== false).map(s => (
                            <option key={s.id} value={s.ic}>{s.name} ({s.ic.replace(/-/g, '')}){s.branch ? ` - ${s.branch}` : ''}</option>
                          ))}
                        </select>
                        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-modern-muted">
                          <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" /></svg>
                        </div>
                      </div>
                    ) : (
                      <div className="p-4 bg-modern-bg/50 rounded-2xl border border-modern-accent/20 flex items-center gap-3">
                        <UserIcon className="w-5 h-5 text-modern-accent" />
                        <span className="font-bold text-modern-primary text-sm">{currentUser.name} (Self)</span>
                      </div>
                    )}
                  </div>

                  {/* Leave Type Toggle */}
                  <div className="space-y-3">
                    <label className="text-[10px] font-black text-modern-muted uppercase tracking-[0.2em] ml-2">{t('form_leave_category')}</label>
                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                      <NeuButton type="button" onClick={() => setLeaveType('AL')} active={leaveType === 'AL'} className="py-3 text-[10px] font-black">{t('form_leave_annual')}</NeuButton>
                      <NeuButton type="button" onClick={() => setLeaveType('MC')} active={leaveType === 'MC'} className="py-3 text-[10px] font-black">
                        {t('form_leave_medical')}
                        {leaveType === 'MC' && <span className="ml-1 text-[7px] bg-emerald-500 text-white rounded-full px-1">AUTO</span>}
                      </NeuButton>
                      <NeuButton type="button" onClick={() => setLeaveType('HL')} active={leaveType === 'HL'} className="py-3 text-[10px] font-black text-center">{t('form_leave_hospitalization')}</NeuButton>
                      
                      <NeuButton type="button" onClick={() => setLeaveType('BL')} active={leaveType === 'BL'} className="py-3 text-[10px] font-black text-center">{t('form_leave_compassionate')}</NeuButton>
                      <NeuButton type="button" onClick={() => setLeaveType('EL')} active={leaveType === 'EL'} className="py-3 text-[10px] font-black text-center">{t('form_leave_emergency')}</NeuButton>
                      <NeuButton type="button" onClick={() => setLeaveType('RL')} active={leaveType === 'RL'} className="py-3 text-[10px] font-black text-center">{t('form_leave_replacement')}</NeuButton>
                      
                      <NeuButton
                        type="button"
                        onClick={() => {
                          if (selectedStaff && selectedStaff.balanceAL > 0) {
                            alert("Unpaid leave is only available when Annual Leave balance is 0 or below.");
                            return;
                          }
                          setLeaveType('UL');
                        }}
                        active={leaveType === 'UL'}
                        className={clsx(
                          "py-3 text-[10px] font-black text-center",
                          selectedStaff && selectedStaff.balanceAL > 0 ? "opacity-50 cursor-not-allowed grayscale" : ""
                        )}
                      >
                        {t('form_leave_unpaid')}
                      </NeuButton>

                      {selectedStaff?.gender === 'female' ? (
                        <NeuButton type="button" onClick={() => setLeaveType('ML')} active={leaveType === 'ML'} className="py-3 text-[10px] font-black text-center">{t('form_leave_maternity')}</NeuButton>
                      ) : (
                        <NeuButton type="button" onClick={() => setLeaveType('PL')} active={leaveType === 'PL'} className="py-3 text-[10px] font-black text-center">{t('form_leave_paternity')}</NeuButton>
                      )}
                      
                      {/* CME — doctors only */}
                      {selectedStaff?.staffType === 'doctor' && (
                        <NeuButton type="button" onClick={() => setLeaveType('CME')} active={leaveType === 'CME'} className="py-3 text-[10px] font-black">{t('form_leave_cme')}</NeuButton>
                      )}
                    </div>

                    {/* ML info banner */}
                    {leaveType === 'MC' && (
                      <div className="flex items-start gap-2 bg-modern-bg/50 border border-modern-accent/20 rounded-2xl px-4 py-3 mt-2">
                        <AlertCircle className="w-4 h-4 text-modern-accent flex-shrink-0 mt-0.5" />
                        <p className="text-[10px] text-modern-primary font-bold leading-relaxed">{t('ml_info')}</p>
                      </div>
                    )}

                    {/* CME info banner */}
                    {leaveType === 'CME' && (
                      <div className="flex items-start gap-2 bg-modern-bg/50 border border-modern-accent/20 rounded-2xl px-4 py-3 mt-2">
                        <AlertCircle className="w-4 h-4 text-modern-accent flex-shrink-0 mt-0.5" />
                        <p className="text-[10px] text-modern-primary font-bold leading-relaxed">{t('cme_info')}</p>
                      </div>
                    )}
                  </div>

                  {/* Balance Display */}
                  <div className="bg-modern-bg/30 rounded-2xl p-6 border border-modern-border flex justify-between items-center group-hover:bg-modern-bg/50 transition-colors">
                    <span className="text-xs font-black text-modern-muted uppercase tracking-widest">{lang === 'BM' ? 'Baki Semasa' : 'Available Balance'}</span>
                    <span className={clsx(
                      "text-2xl font-black transition-all duration-500",
                      currentBalance < 3 ? "text-red-500" : "text-modern-accent"
                    )}>
                      {selectedStaff ? currentBalance : '-'} <span className="text-[10px] uppercase ml-1 tracking-widest">Days</span>
                    </span>
                  </div>

                  {/* Carry-Forward Notice — shown only for AL/Emergency if remainingCarryForward > 0 */}
                  {(() => {
                    if (!selectedStaff || (leaveType !== 'AL' && leaveType !== 'EL')) return null;
                    const prevBalance = (selectedStaff as any).prevYearBalance ?? 0;
                    if (prevBalance <= 0) return null;

                    const currentYear = new Date().getFullYear();
                    const usedAL = logs
                      .filter(l =>
                        l.staffId.replace(/-/g, '') === selectedStaff.id.replace(/-/g, '') &&
                        (l.type === 'AL' || l.type === 'EL') &&
                        (l.status === 'approved' || l.status === 'hod_approved' || l.status === 'hr_approved' || l.status === 'pending') &&
                        new Date(l.startDate).getFullYear() === currentYear
                      )
                      .reduce((sum, l) => sum + l.duration, 0);

                    const remainingCarryForward = Math.max(0, prevBalance - usedAL);

                    if (remainingCarryForward <= 0) return null;

                    return (
                      <div className="flex items-start gap-3 bg-modern-bg/50 border-l-4 border-modern-accent rounded-2xl px-4 py-3 shadow-neu-sm animate-fade-in">
                        <span className="text-xl mt-0.5">✨</span>
                        <div>
                          <p className="text-xs font-bold text-modern-primary uppercase tracking-widest">Baki Bawa Hadapan</p>
                          <p className="text-sm font-black text-modern-accent mt-1">
                            <span className="text-2xl">{remainingCarryForward}</span>
                            <span className="text-xs ml-1 uppercase tracking-tighter">hari (daripada {prevBalance})</span>
                          </p>
                          <p className="text-[10px] text-modern-muted font-bold mt-1 leading-relaxed">
                            ⚡ Baki ini akan digunakan <strong>terlebih dahulu</strong> secara automatik.
                          </p>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Leave Period Selection */}
                  <div className="space-y-4">
                    <label className="text-xs font-black text-modern-muted/50 uppercase tracking-widest ml-2">Leave Period</label>
                    <div className="grid grid-cols-2 gap-4">
                      <NeuInput
                        type="date"
                        label="From"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        required
                      />
                      <NeuInput
                        type="date"
                        label="To"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <NeuTextArea
                    label="Reason for leave"
                    placeholder="Briefly explain why..."
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    required
                  />

                  <NeuInput
                    label="Duty Handover Replacement"
                    placeholder="Colleague's name..."
                    value={dutyHandover}
                    onChange={(e) => setDutyHandover(e.target.value)}
                    required
                  />

                   {leaveType === 'BL' && (
                    <div className="space-y-3 p-4 bg-modern-bg/50 rounded-2xl border border-red-200">
                      <label className="text-xs font-black text-red-600 uppercase tracking-widest ml-2">{t('death_cert_label')}</label>
                      <input
                        id="death-cert-upload"
                        aria-label={t('death_cert_label')}
                        title={t('death_cert_label')}
                        type="file"
                        accept="image/jpeg, image/png, application/pdf"
                        onChange={handleFileChange}
                        className="w-full text-sm font-bold text-modern-primary file:mr-4 file:py-3 file:px-6 file:rounded-xl file:border-0 file:text-xs file:font-black file:uppercase file:bg-red-500 file:text-white hover:file:bg-red-600 transition-all cursor-pointer"
                        required
                      />
                      {attachmentUrl && (
                        <div className="mt-2 flex items-center gap-2 text-[10px] text-green-600 font-bold uppercase tracking-widest">
                          <CheckCircle className="w-4 h-4" /> {t('file_attached')}
                        </div>
                      )}
                      <p className="text-[10px] text-red-400 font-bold leading-relaxed px-2">{t('death_cert_note')}</p>
                    </div>
                  )}

                  {leaveType === 'EL' && (
                    <div className="space-y-3 p-4 bg-modern-bg/50 rounded-2xl border border-modern-accent/20">
                      <label className="text-xs font-black text-modern-accent uppercase tracking-widest ml-2">{t('emergency_proof_label')}</label>
                      <input
                        id="emergency-proof-upload"
                        aria-label={t('emergency_proof_label')}
                        title={t('emergency_proof_label')}
                        type="file"
                        accept="image/jpeg, image/png, application/pdf"
                        onChange={handleFileChange}
                        className="w-full text-sm font-bold text-modern-primary file:mr-4 file:py-3 file:px-6 file:rounded-xl file:border-0 file:text-xs file:font-black file:uppercase file:bg-modern-accent file:text-white hover:file:bg-modern-accent/90 transition-all cursor-pointer"
                        required
                      />
                      {attachmentUrl && (
                        <div className="mt-2 flex items-center gap-2 text-[10px] text-green-600 font-bold uppercase tracking-widest">
                          <CheckCircle className="w-4 h-4" /> {t('file_attached')}
                        </div>
                      )}
                      <p className="text-[10px] text-modern-muted font-bold leading-relaxed px-2">{t('emergency_proof_note')}</p>
                    </div>
                  )}

                  {/* Medical Leave — MC upload mandatory */}
                  {leaveType === 'MC' && (
                    <div className="space-y-3 p-4 rounded-2xl border-2 border-dashed border-modern-border/50 bg-modern-bg/40">
                      <div className="flex items-center gap-2 mb-1">
                        <FileText className="w-4 h-4 text-modern-accent" />
                        <label className="text-xs font-black text-modern-primary uppercase tracking-widest">
                          {t('mc_label')}
                          <span className="ml-1 text-red-500 font-bold">{t('mc_mandatory')}</span>
                        </label>
                      </div>
                      <p className="text-[10px] text-modern-muted font-bold px-1 leading-relaxed">{t('mc_hint')}</p>
                      <input
                        id="mc-upload"
                        aria-label={t('mc_label')}
                        title={t('mc_label')}
                        type="file"
                        accept="image/jpeg, image/png, application/pdf"
                        onChange={handleFileChange}
                        className="w-full text-sm font-bold text-modern-primary file:mr-4 file:py-3 file:px-6 file:rounded-xl file:border-0 file:text-xs file:font-black file:uppercase file:bg-modern-accent file:text-white hover:file:bg-modern-accent/90 transition-all cursor-pointer"
                      />
                      {attachmentUrl ? (
                        <div className="flex items-center gap-2 text-[10px] text-green-600 font-black uppercase tracking-widest bg-green-50 rounded-xl px-3 py-2">
                          <CheckCircle className="w-4 h-4 flex-shrink-0" />
                          <span>{t('mc_uploaded')}</span>
                          <button
                            type="button"
                            onClick={() => setAttachmentUrl(undefined)}
                            className="ml-auto text-red-400 hover:text-red-600 font-black text-xs"
                          >
                            {t('mc_remove')}
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-[10px] text-red-500 font-bold uppercase tracking-widest bg-red-50 rounded-xl px-3 py-2">
                          <AlertCircle className="w-4 h-4 flex-shrink-0" />
                          <span>{t('mc_missing')}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {leaveType === 'PL' && (
                    <div className="space-y-3 p-5 bg-modern-bg/50 rounded-2xl border border-modern-accent/20">
                      <label className="text-[11px] font-black text-modern-accent uppercase tracking-widest ml-1">Polisi Paternity / Maternity Leave</label>
                      <div className="text-[10px] text-modern-muted font-bold leading-relaxed px-1 space-y-2">
                        <p className="flex items-center gap-2"><span className="w-1 h-1 bg-modern-accent rounded-full"></span> Sah untuk anak pertama sehingga anak kelima sahaja.</p>
                        <p className="flex items-center gap-2"><span className="w-1 h-1 bg-modern-accent rounded-full"></span> Staff Perempuan: 98 hari (Maternity).</p>
                        <p className="flex items-center gap-2"><span className="w-1 h-1 bg-modern-accent rounded-full"></span> Staff Lelaki: 7 hari (Paternity).</p>
                        <p className="flex items-center gap-2 text-modern-accent"><span className="w-1 h-1 bg-modern-accent rounded-full"></span> Bermula dari tarikh bersalin.</p>
                      </div>
                    </div>
                  )}

                  {/* Approver picker for HOD at Balok applying leave */}
                  {isHodAtBalok && (
                    <div className="space-y-2">
                      <label className="text-xs font-black text-modern-muted uppercase tracking-widest ml-2">
                        Pilih Approver untuk Cuti Anda
                      </label>
                      <select
                        aria-label="Pilih Approver"
                        className="w-full p-4 bg-modern-bg/50 rounded-2xl border border-modern-border text-sm font-bold text-modern-primary outline-none focus:border-modern-accent transition-all appearance-none"
                        value={selectedApprover}
                        onChange={(e) => setSelectedApprover(e.target.value)}
                        required
                      >
                        <option value="">-- Pilih HOD lain / HR --</option>
                        <optgroup label="HOD Lain (Balok)">
                          {hodList.filter(h => h.id !== currentUser?.id && h.branch === currentUser?.branch).map(h => (
                            <option key={h.id} value={h.id}>{h.name}</option>
                          ))}
                          {hodList.filter(h => h.id !== currentUser?.id && h.branch === currentUser?.branch).length === 0 && (
                            <option disabled>Tiada HOD lain di cawangan ini</option>
                          )}
                        </optgroup>
                      </select>
                      <p className="text-[10px] text-modern-accent font-bold ml-2">⚠️ Sebagai HOD, anda perlu lantik HOD lain atau HR untuk meluluskan cuti anda.</p>
                    </div>
                  )}

                  {/* HOD Selection for Staff */}
                  {currentUser?.role === 'staff' && (
                    <div className="space-y-3">
                      {selectedStaff?.staffType === 'doctor' && PAHANG_BRANCHES.includes(selectedStaff?.branch || '') ? (
                        <>
                          <label className="text-xs font-black text-modern-muted uppercase tracking-widest ml-2">HOD Approval (Auto-Assigned)</label>
                          <div className="w-full p-4 bg-modern-bg/30 rounded-2xl border border-modern-accent/20 text-sm font-bold text-modern-muted italic">
                            HASIMAH BINTI MOHAMAD (Locked for Pahang Doctors)
                          </div>
                        </>
                      ) : selectedStaff?.branch === 'Klinik Syed Badaruddin Gebeng' ? (
                        <>
                          <label className="text-xs font-black text-modern-muted uppercase tracking-widest ml-2">PIC Approval (Auto-Assigned)</label>
                          <div className="w-full p-4 bg-modern-bg/30 rounded-2xl border border-modern-accent/20 text-sm font-bold text-modern-muted italic">
                            DR ZAINAL BIN SULIAN (PIC Gebeng)
                          </div>
                        </>
                      ) : selectedStaff?.branch === 'Klinik Syed Badaruddin Beserah' ? (
                        <>
                          <label className="text-xs font-black text-modern-muted uppercase tracking-widest ml-2">PIC Approval (Auto-Assigned)</label>
                          <div className="w-full p-4 bg-modern-bg/30 rounded-2xl border border-modern-accent/20 text-sm font-bold text-modern-muted italic">
                            DR HASRI BIN HAZNAN (PIC Beserah)
                          </div>
                        </>
                      ) : selectedStaff?.branch === 'Klinik Syed Badaruddin Kempadang' ? (
                        <>
                          <label className="text-xs font-black text-modern-muted uppercase tracking-widest ml-2">PIC Approval (Auto-Assigned)</label>
                          <div className="w-full p-4 bg-modern-bg/30 rounded-2xl border border-modern-accent/20 text-sm font-bold text-modern-muted italic">
                            DR ROHANA BINTI MOHD ZAIN (PIC Kempadang)
                          </div>
                        </>
                      ) : (
                        <>
                          <label className="text-xs font-black text-modern-muted uppercase tracking-widest ml-2">
                            Pilih HOD untuk Kelulusan
                            {selectedStaff?.branch && (
                              <span className="ml-2 text-modern-accent normal-case font-bold">({selectedStaff.branch})</span>
                            )}
                          </label>
                          <select
                            aria-label="Select HOD for Approval"
                            className="w-full p-4 bg-modern-bg/50 rounded-2xl border border-modern-border text-sm font-bold text-modern-primary outline-none focus:border-modern-accent transition-all appearance-none"
                            value={selectedHod}
                            onChange={(e) => setSelectedHod(e.target.value)}
                            required
                          >
                            <option value="">-- Pilih HOD --</option>
                            {(hodList.filter(h => h.branch === selectedStaff?.branch).length > 0
                              ? hodList.filter(h => h.branch === selectedStaff?.branch)
                              : hodList
                            ).map(hod => (
                              <option key={hod.id} value={hod.id}>
                                {hod.name} ({hod.branch ? (hod.branch.length > 25 ? hod.branch.substring(0, 25) + "..." : hod.branch) : "Main"})
                              </option>
                            ))}
                          </select>
                          {hodList.filter(h => h.branch === selectedStaff?.branch).length === 0 && (
                            <p className="text-[10px] text-amber-500 font-bold ml-2">Tiada HOD untuk cawangan ini. Hubungi Admin.</p>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {/* Calculated Duration View */}
                  <div className="bg-modern-card rounded-2xl p-4 border border-modern-border flex justify-between items-center mt-6">
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-modern-accent" />
                      <span className="text-[10px] font-black text-modern-muted uppercase tracking-widest">Calculated Duration</span>
                    </div>
                    <span className="text-lg font-black text-modern-primary">
                      {duration ? `${duration} Days` : 'Select dates'}
                    </span>
                  </div>

                  {leaveType === 'AL' && typeof duration === 'number' && duration > currentBalance && (
                    <div className="flex items-center gap-2 p-3 bg-modern-bg text-modern-accent rounded-xl text-[10px] font-black uppercase tracking-tighter shadow-neu-sm border border-modern-accent/30">
                      <Zap className="w-3 h-3" />
                      Pro-rated Override: {duration - currentBalance} days will be UNPAID
                    </div>
                  )}

                  {!isDurationValid && duration !== '' && (
                    <div className="flex items-center gap-2 p-3 bg-red-50 text-red-500 rounded-xl text-[10px] font-black uppercase tracking-tighter animate-pulse">
                      <AlertCircle className="w-3 h-3" />
                      {leaveType === 'PL' ? 'Gagal: Had limit 5 anak telah dicapai atau tempoh tidak sah.' : `Exceeds ${leaveType} balance`}
                    </div>
                  )}

                  {submitSuccess && (
                    <div className="flex items-start gap-3 p-4 rounded-2xl bg-emerald-50 text-emerald-700 text-xs font-bold border border-emerald-100">
                      <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span className="flex-1">{submitSuccess}</span>
                      <button onClick={() => setSubmitSuccess(null)} className="shrink-0 text-emerald-400 hover:text-emerald-600 font-black text-sm leading-none">×</button>
                    </div>
                  )}

                  {submitError && (
                    <div className="flex items-start gap-3 p-4 rounded-2xl bg-red-50 text-red-600 text-xs font-bold border border-red-100 animate-shake">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span className="flex-1">{submitError}</span>
                      <button onClick={() => setSubmitError(null)} className="shrink-0 text-red-300 hover:text-red-500 font-black text-sm leading-none">×</button>
                    </div>
                  )}

                  <NeuButton
                    type="submit"
                    disabled={!selectedStaff || !duration || !isDurationValid || isSubmitting}
                    variant="primary"
                    className="w-full py-5 flex justify-center items-center gap-3 rounded-2xl shadow-neu-md text-xs font-black tracking-[0.3em] uppercase mt-4"
                  >
                    {isSubmitting ? (
                      <Activity className="w-5 h-5 animate-spin" />
                    ) : (
                      <>
                        <Send className="w-5 h-5" />
                        Submit Request
                      </>
                    )}
                  </NeuButton>
                </form>
              </NeuCard>
            </div>

            {/* RIGHT COLUMN: Dashboard & Insights (8 cols) */}
            <div className="lg:col-span-8 space-y-10">

              {/* Notice Period Banner */}
              <NeuCard className="relative overflow-hidden group border-transparent">
                <div className="absolute top-0 left-0 w-1.5 h-full bg-modern-accent opacity-50"></div>
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-modern-bg/50 rounded-2xl border border-modern-accent/20">
                      <Clock className="w-6 h-6 text-modern-accent" />
                    </div>
                    <div>
                      <h2 className="text-sm font-bold text-modern-primary uppercase tracking-widest">Wajib Tahu: Tempoh Notis Cuti</h2>
                      <p className="text-[10px] font-bold text-modern-muted mt-1 uppercase tracking-tight">Sila patuhi notis minimum permohonan</p>
                    </div>
                  </div>

                  <div className="flex gap-4 w-full sm:w-auto">
                    <div className="flex-1 sm:flex-none bg-modern-bg rounded-2xl p-4 border border-modern-border flex flex-col items-center justify-center min-w-[140px] group-hover:bg-modern-bg/50 transition-colors shadow-neu-sm">
                      <span className="text-modern-muted text-[10px] font-black uppercase tracking-widest mb-1">Staff Pentadbiran</span>
                      <span className="text-xl font-bold text-modern-accent">3 Hari Sebelum</span>
                    </div>
                    <div className="flex-1 sm:flex-none bg-modern-bg rounded-2xl p-4 border border-modern-border flex flex-col items-center justify-center min-w-[140px] group-hover:bg-modern-bg/50 transition-colors shadow-neu-sm">
                      <span className="text-modern-muted text-[10px] font-black uppercase tracking-widest mb-1">Operasi / Doktor</span>
                      <span className="text-xl font-bold text-modern-accent">7 Hari Sebelum</span>
                    </div>
                  </div>
                </div>
              </NeuCard>

              {/* Quick Balances HERO (Full Width for All Staff) */}
              {currentUser && (
                <NeuCard className="flex flex-col relative overflow-hidden border-transparent">
                  <div className="flex items-center gap-3 mb-8 relative z-10 border-b border-modern-border pb-4">
                    <Zap className="w-5 h-5 text-modern-accent" />
                    <h3 className="text-modern-primary font-bold text-lg tracking-widest uppercase">Quick Balances</h3>
                    <div className="absolute -top-10 -right-6 opacity-[0.03] rotate-12 -z-10">
                      <Zap className="w-32 h-32 text-modern-accent" />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div className="bg-modern-bg rounded-[2rem] border border-modern-border p-10 flex flex-col items-center justify-center transition-all hover:bg-modern-bg/50 group shadow-neu-sm">
                      <span className="text-5xl font-bold text-modern-accent mb-2 group-hover:scale-110 transition-transform">
                        {currentUser && logs ? calculateProRatedAL(currentUser, logs).toFixed(0) : '0'}
                      </span>
                      <span className="text-[10px] font-black text-modern-muted uppercase tracking-[0.4em] text-center">Annual Leave</span>
                    </div>
                    <div className="bg-modern-bg rounded-[2rem] border border-modern-border p-10 flex flex-col items-center justify-center transition-all hover:bg-modern-bg/50 group shadow-neu-sm">
                      <span className="text-5xl font-bold text-modern-accent mb-2 group-hover:scale-110 transition-transform">
                        {currentUser.balanceMC}
                      </span>
                      <span className="text-[10px] font-black text-modern-muted uppercase tracking-[0.4em] text-center">Medical Leave</span>
                    </div>
                  </div>

                  <div className="mt-8 p-4 bg-modern-bg/50 rounded-2xl border border-modern-border">
                    <p className="text-[11px] text-modern-muted font-bold leading-relaxed text-center italic tracking-wide">
                      AL Balance is pro-rated by month ({new Date().getMonth() + 1}/12 of annual entitlement).
                    </p>
                  </div>
                </NeuCard>
              )}

              {/* Detailed Personal Card */}
              {currentUser && (
                <NeuCard className="group p-6 bg-white rounded-[2rem] border border-modern-border shadow-neu-sm">
                  <div className="flex items-center justify-between mb-4 border-b border-modern-border/10 pb-4">
                    <h3 className="text-modern-muted font-black uppercase tracking-[0.3em] text-[9px]">
                      Personnel Leave Portfolio
                    </h3>
                    <div className="px-3 py-1 bg-modern-bg rounded-full text-[9px] font-black text-modern-accent uppercase tracking-widest shadow-sm border border-modern-accent/20">
                      {currentUser.role || 'Personnel'}
                    </div>
                  </div>
                  <div className="flex flex-col md:flex-row justify-between items-center gap-6">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-2xl bg-modern-bg flex items-center justify-center font-bold text-modern-accent text-xl shadow-neu-sm border border-modern-accent/10">
                        {currentUser.name.charAt(0)}
                      </div>
                      <div>
                        <p className="font-bold text-modern-primary text-xl leading-tight uppercase tracking-widest">{currentUser.name}</p>
                        <p className="text-[10px] text-modern-muted font-black uppercase tracking-[0.2em] mt-1">{currentUser.ic.replace(/-/g, '')}</p>
                        {currentUser.branch && <p className="text-[10px] text-modern-accent font-black uppercase tracking-widest mt-1 bg-modern-bg px-2 py-0.5 rounded-md border border-modern-accent/20 inline-block">{currentUser.branch}</p>}
                      </div>
                    </div>
                    <div className="flex gap-4">
                      <div className="flex flex-col items-center">
                        <span className="text-[9px] font-black text-modern-accent uppercase tracking-widest mb-1">AL*</span>
                        <div className="px-5 py-2 bg-modern-bg rounded-2xl text-sm font-bold text-modern-primary border border-modern-border shadow-neu-sm">
                          {currentUser && logs ? calculateProRatedAL(currentUser, logs).toFixed(0) : '0'}
                        </div>
                      </div>
                      <div className="flex flex-col items-center">
                        <span className="text-[9px] font-black text-modern-accent uppercase tracking-widest mb-1">ML</span>
                        <div className="px-5 py-2 bg-modern-bg rounded-2xl text-sm font-bold text-modern-primary border border-modern-border shadow-neu-sm">{currentUser.balanceMC}</div>
                      </div>
                      <div className="flex flex-col items-center">
                        <span className="text-[9px] font-black text-modern-muted uppercase tracking-widest mb-1">UNP</span>
                        <div className="px-5 py-2 bg-modern-bg rounded-2xl text-sm font-bold text-modern-primary border border-modern-border shadow-neu-sm">
                          {logs.filter(l => l.staffId === currentUser.id && l.type === 'UL' && (l.status === 'approved' || l.status === 'hod_approved' || l.status === 'pending')).reduce((acc, curr) => acc + curr.duration, 0)}
                        </div>
                      </div>
                    </div>
                  </div>
                </NeuCard>
              )}

              {/* KPI Cards & Feed (2 Columns below Quick Balances) */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">

                {/* Dashboard Stats */}
                <div className="space-y-8">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <NeuCard className="flex flex-col justify-center items-center gap-3 py-8 border-t-4 border-modern-accent shadow-neu-sm">
                      <span className="text-modern-muted text-[10px] font-black uppercase tracking-[0.3em] mb-1">Total Days Taken</span>
                      <span className="text-4xl font-bold text-modern-primary tracking-widest">{dashboardStats.totalDays}</span>
                    </NeuCard>
                    <NeuCard className="flex flex-col justify-center items-center gap-3 py-8 border-t-4 border-modern-accent/30 shadow-neu-sm">
                      <span className="text-modern-muted text-[10px] font-black uppercase tracking-[0.3em] mb-1">Unpaid Taken</span>
                      <span className="text-4xl font-bold text-modern-primary/60 tracking-widest">{dashboardStats.totalUnpaid}</span>
                    </NeuCard>
                  </div>
                </div>

                {/* Activity & AI (Visible to Everyone on their personal dashboard) */}
                <div className="space-y-8">
                  <div className="space-y-8">
                    {/* Recent Activity Feed */}
                    <NeuCard className="max-h-[400px] flex flex-col border-modern-border shadow-neu-sm">
                      <div className="flex items-center gap-3 mb-6 border-b border-modern-border/20 pb-4">
                        <History className="w-4 h-4 text-modern-accent" />
                        <h3 className="text-modern-primary font-bold uppercase tracking-widest text-[10px]">
                          My Recent Activity
                        </h3>
                      </div>
                      <div className="space-y-4 overflow-y-auto pr-2 custom-scrollbar">
                        {logs
                          .filter(l => l.staffId === currentUser.id)
                          .slice(0, 8)
                          .map(log => (
                            <div key={log.id} onClick={() => alert(`Tujuan Cuti: ${log.reason}`)} className="flex items-start justify-between p-3 bg-modern-bg rounded-xl border border-modern-border cursor-pointer hover:bg-modern-bg/50 transition-colors" title="Klik untuk mellihat tujuan cuti">
                              <div>
                                <p className="font-bold text-modern-primary text-[11px] uppercase tracking-wide">{log.staffName}</p>
                                <p className="text-[9px] text-modern-muted font-bold uppercase tracking-widest mt-1 flex items-center gap-1.5 flex-wrap">
                                  <span>{log.type} &bull; {log.duration} Days</span>
                                  <span className="text-modern-accent tracking-tight">&bull; {log.startDate} {log.startDate !== log.endDate && ` - ${log.endDate}`}</span>
                                </p>
                              </div>
                              <div className={`px-2 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest border ${log.status === 'approved' ? 'bg-green-50 text-green-600 border-green-100' :
                                log.status === 'hod_approved' ? 'bg-modern-accent/10 text-modern-accent border-modern-accent/20' :
                                  log.status === 'rejected' ? 'bg-red-50 text-red-600 border-red-100' :
                                    'bg-modern-bg text-modern-muted border-modern-border'
                                }`}>
                                {log.status === 'hod_approved' ? 'HOD Auth' : log.status}
                              </div>
                            </div>
                          ))}
                        {logs.length === 0 && (
                          <p className="text-center text-[10px] text-modern-muted/50 italic py-4">No recent activity.</p>
                        )}
                      </div>
                    </NeuCard>

                    {/* Gemini AI Insights */}
                    <NeuCard className="h-[250px] border-l-4 border-modern-accent overflow-hidden relative flex flex-col shadow-neu-sm border-modern-border">
                      <div className="absolute -top-10 -right-10 opacity-[0.02]">
                        <Sparkles className="w-40 h-40 text-modern-accent" />
                      </div>
                      <div className="flex justify-between items-center mb-6">
                        <div>
                          <h3 className="text-md font-bold text-modern-primary flex items-center gap-3 tracking-widest">
                            <Sparkles className="w-5 h-5 text-modern-accent" />
                            GEMINI AI
                          </h3>
                          <p className="text-[9px] font-black text-modern-muted uppercase tracking-[0.4em] mt-1">Strategic Portfolio Analysis</p>
                        </div>
                        <NeuButton
                          onClick={handleGenerateInsight}
                          disabled={generatingAi}
                          className="text-[8px] px-4 py-2 font-black uppercase tracking-widest border-modern-accent/30 hover:bg-modern-accent/5"
                        >
                          {generatingAi ? '...' : 'Refresh'}
                        </NeuButton>
                      </div>

                      <div className="flex-1 bg-modern-bg/50 rounded-2xl p-6 text-sm text-modern-primary leading-relaxed relative border border-modern-border/10">
                        {generatingAi ? (
                          <div className="absolute inset-0 flex items-center justify-center bg-white/50 rounded-2xl backdrop-blur-sm z-10">
                            <Activity className="w-6 h-6 text-modern-accent animate-spin" />
                          </div>
                        ) : aiSummary ? (
                          <div className="whitespace-pre-line font-medium text-xs italic opacity-80">{aiSummary}</div>
                        ) : (
                          <div className="flex flex-col items-center justify-center h-full text-modern-muted/30">
                            <Zap className="w-8 h-8 mb-2 opacity-50" />
                            <span className="text-[9px] font-black uppercase text-center tracking-widest">Ready for analysis</span>
                          </div>
                        )}
                      </div>
                    </NeuCard>
                  </div>
                </div>
              </div>
            </div>

          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="mt-16 pb-10 w-full max-w-7xl">
        {/* Logo strip */}
        <div className="bg-white/50 backdrop-blur-xl rounded-[2rem] border border-modern-border px-10 py-12 mb-8 shadow-neu-sm">
          {/* Title */}
          <div className="flex items-center justify-center gap-4 mb-10">
            <div className="h-px flex-1 bg-gradient-to-r from-transparent to-modern-border max-w-[150px]" />
            <p className="text-[9px] font-black text-modern-muted uppercase tracking-[0.6em] whitespace-nowrap">Rangkaian Klinik Syed Badaruddin</p>
            <div className="h-px flex-1 bg-gradient-to-l from-transparent to-modern-border max-w-[150px]" />
          </div>

          <div className="flex flex-wrap items-end justify-center gap-10">

            {/* KSB Logo */}
            <div className="group flex flex-col items-center gap-3 cursor-default">
              <div className="relative">
                {/* glow ring */}
                <div className="absolute inset-0 rounded-full bg-gradient-to-br from-blue-400 to-indigo-400 blur-md opacity-0 group-hover:opacity-40 transition-all duration-500 scale-110" />
                {/* gradient border */}
                <div className="w-24 h-24 rounded-full p-[3px] bg-gradient-to-br from-blue-600 via-indigo-500 to-slate-400 shadow-lg group-hover:shadow-blue-200 group-hover:shadow-xl transition-all duration-300 group-hover:-translate-y-2">
                  <div className="w-full h-full rounded-full bg-white flex items-center justify-center overflow-hidden">
                    <img src="/logo-ksb.jpg" alt="KSB Logo" className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" />
                  </div>
                </div>
              </div>
              <span className="text-[9px] font-black uppercase tracking-widest text-modern-muted bg-modern-bg px-3 py-1 rounded-full shadow-inner">KSB</span>
            </div>

            {/* KLINIK RAKYAT - WE CARE Logo */}
            <div className="group flex flex-col items-center gap-3 cursor-default">
              <div className="relative">
                <div className="absolute inset-0 rounded-full bg-slate-600 blur-md opacity-0 group-hover:opacity-30 transition-all duration-500 scale-110" />
                <div className="w-24 h-24 rounded-full p-[3px] bg-gradient-to-br from-slate-700 via-slate-500 to-slate-300 shadow-lg group-hover:shadow-slate-300 group-hover:shadow-xl transition-all duration-300 group-hover:-translate-y-2">
                  <div className="w-full h-full rounded-full bg-black flex items-center justify-center overflow-hidden">
                    <img src="/logo-kr.jpg" alt="KLINIK RAKYAT - WE CARE" className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" />
                  </div>
                </div>
              </div>
              <span className="text-[9px] font-black uppercase tracking-widest text-modern-muted bg-modern-bg px-3 py-1 rounded-full shadow-inner">KLINIK RAKYAT - WE CARE</span>
            </div>

            {/* Uni Klinik Bentong Logo */}
            <div className="group flex flex-col items-center gap-3 cursor-default">
              <div className="relative">
                <div className="absolute inset-0 rounded-2xl bg-indigo-500 blur-md opacity-0 group-hover:opacity-20 transition-all duration-500" />
                <div className="rounded-2xl p-[3px] bg-gradient-to-br from-indigo-600 via-blue-500 to-slate-700 shadow-lg group-hover:shadow-blue-200 group-hover:shadow-xl transition-all duration-300 group-hover:-translate-y-2">
                  <div className="rounded-[14px] bg-white px-5 py-4 flex items-center justify-center overflow-hidden">
                    <img src="/logo-bentong.jpg" alt="Uni Klinik Bentong" className="h-12 w-auto object-contain transition-transform duration-500 group-hover:scale-105" />
                  </div>
                </div>
              </div>
              <span className="text-[9px] font-black uppercase tracking-widest text-modern-muted bg-modern-bg px-3 py-1 rounded-full shadow-inner">Uni Klinik Bentong</span>
            </div>

          </div>
        </div>

        {/* Copyright Footer */}
        <div className="text-center mt-12 pb-8">
          <p className="text-[9px] font-black text-modern-muted uppercase tracking-[0.3em]">
            © 2026 Klinik Syed Badaruddin Sdn Bhd. <span className="text-modern-accent italic">Excellence in Care since 1991.</span>
          </p>
          <p className="text-[10px] font-bold text-modern-muted italic mt-2 opacity-60">
            Developed by <span className="text-modern-primary not-italic font-black">Kembara Senja</span> &bull; <span className="uppercase tracking-tighter">Enterprise Edition</span>
          </p>
          <div className="w-12 h-px bg-modern-accent/50 mx-auto mt-6" />
        </div>
      </footer>
    </div>
  );
};

export default App;