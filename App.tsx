import React, { useEffect, useState, useMemo } from 'react';
import { clsx } from 'clsx';
import {
  Activity, AlertCircle, FileText, Sparkles, Send, LayoutDashboard, History, Settings, LogOut, User as UserIcon, Zap,
  CheckCircle, XCircle, Users, Edit3, Trash2, ArrowRight, Calendar
} from 'lucide-react';
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
  calculateProRatedAL,
  calculateYearsOfService,
  subscribeToSessions
} from './services/firebase';
import { generateLeaveSummary } from './services/gemini';
import { NeuCard, NeuButton, NeuInput, NeuBadge, NeuTextArea } from './components/NeuElements';
import { LoginPage } from './components/LoginPage';
import { RegistrationPage } from './components/RegistrationPage';
import { UserSettings } from './components/UserSettings';
import { ManagementView } from './components/ManagementView';
import { Staff, LeaveLog } from './types';

// ----- Constants -----
const COLORS = ['#60A5FA', '#34D399', '#F87171', '#FBBF24'];

const App: React.FC = () => {
  // ----- State -----
  const [currentUser, setCurrentUser] = useState<Staff | null>(null);
  const [authView, setAuthView] = useState<'login' | 'register'>('login');
  const [activeTab, setActiveTab] = useState<'dashboard' | 'management' | 'settings'>('dashboard');
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [logs, setLogs] = useState<LeaveLog[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Form State
  const [selectedStaffIC, setSelectedStaffIC] = useState('');
  const [leaveType, setLeaveType] = useState<'AL' | 'ML' | 'CME' | 'Paid' | 'Compassionate' | 'Unpaid'>('AL');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [dutyHandover, setDutyHandover] = useState('');
  const [duration, setDuration] = useState<number | ''>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Insight State
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [generatingAi, setGeneratingAi] = useState(false);

  // ----- Effects -----

  useEffect(() => {
    const init = async () => {
      await initAuth();
      await seedInitialData(); // Ensure demo data exists

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
    };
    init();

    // Real-time Listeners
    const unsubStaff = subscribeToStaff(setStaffList);
    const unsubLogs = subscribeToLogs(setLogs);
    const unsubSessions = subscribeToSessions(setSessions);

    return () => {
      unsubStaff();
      unsubLogs();
      unsubSessions();
    };
  }, []);

  // Update current user data from staff list (to keep balances in sync)
  useEffect(() => {
    if (currentUser && staffList.length > 0) {
      const updated = staffList.find(s => s.id === currentUser.id);
      if (updated) {
        setCurrentUser(prev => ({ ...prev!, ...updated }));
      }
    }
  }, [staffList]);

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

  // ----- Computed Data -----

  const selectedStaff = useMemo(() =>
    staffList.find(s => s.ic === (currentUser ? currentUser.ic : selectedStaffIC)),
    [staffList, selectedStaffIC, currentUser]);

  const currentBalance = useMemo(() => {
    if (!selectedStaff) return 0;
    if (leaveType === 'AL') {
      return calculateProRatedAL(selectedStaff, logs);
    }
    if (leaveType === 'ML') return selectedStaff.balanceML;
    return 999;
  }, [selectedStaff, leaveType, logs]);

  const isDurationValid = useMemo(() => {
    if (typeof duration !== 'number' || duration <= 0) return true;
    if (!selectedStaff) return true;
    // For AL, it's always "valid" because overflow becomes Unpaid
    if (leaveType === 'AL') return true;
    return duration <= currentBalance;
  }, [duration, currentBalance, selectedStaff, leaveType]);



  const dashboardStats = useMemo(() => {
    if (!currentUser) return { totalDays: 0, totalUnpaid: 0 };

    const userLogs = logs.filter(l => l.staffId === currentUser.id);
    const approvedLogs = userLogs.filter(l => l.status === 'approved');

    const totalDays = approvedLogs.reduce((acc, log) => acc + log.duration, 0);
    const totalUnpaid = approvedLogs
      .filter(l => l.type === 'Unpaid')
      .reduce((acc, log) => acc + log.duration, 0);

    return { totalDays, totalUnpaid };
  }, [logs, currentUser]);

  // ----- Handlers -----

  const handleLogin = (user: Staff) => {
    setCurrentUser(user);
    localStorage.setItem('logged_in_user', JSON.stringify(user));
  };

  const handleLogout = () => {
    setCurrentUser(null);
    localStorage.removeItem('logged_in_user');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStaff || !duration || duration <= 0) return;
    if (!isDurationValid) return;

    const result = await submitLeaveApplication(
      selectedStaff.id,
      selectedStaff.name,
      leaveType,
      duration,
      startDate,
      endDate,
      reason,
      dutyHandover
    );

    if (result.success) {
      setDuration('');
      setStartDate('');
      setEndDate('');
      setReason('');
      setDutyHandover('');
    } else {
      setSubmitError(result.error || "Submission failed");
    }
    setIsSubmitting(false);
  };

  const handleGenerateInsight = async () => {
    setGeneratingAi(true);
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const recentLogs = logs.filter(l => l.timestamp > thirtyDaysAgo && l.status === 'approved');

    try {
      const summary = await generateLeaveSummary(recentLogs);
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
      <div className="min-h-screen flex items-center justify-center bg-[#e0e5ec] text-gray-500">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <Activity className="w-12 h-12 animate-spin text-blue-400" />
          <p className="font-semibold tracking-widest text-xs uppercase">Initializing System</p>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    if (authView === 'register') {
      return <RegistrationPage onRegister={handleLogin} onBack={() => setAuthView('login')} />;
    }
    return <LoginPage onLogin={handleLogin} onGoToRegister={() => setAuthView('register')} />;
  }

  return (
    <div className="min-h-screen bg-[#e0e5ec] p-4 md:p-8 overflow-x-hidden flex flex-col items-center">
      <div className="w-full max-w-7xl space-y-8">

        {/* Navigation Header */}
        <header className="flex flex-col md:flex-row justify-between items-center gap-6 mb-12">
          <div className="flex items-center gap-6 group cursor-pointer" onClick={() => setActiveTab('dashboard')}>
            <div className="p-4 bg-neu-base rounded-3xl shadow-neu-flat group-hover:shadow-neu-pressed transition-all duration-300 transform group-hover:scale-95">
              <img src="/logo.jpg" alt="Logo" className="w-10 h-10 rounded-full object-cover shadow-sm" />
            </div>
            <div>
              <h1 className="text-3xl font-black text-gray-700 tracking-tighter">Klinik <span className="text-blue-500">Syed Badaruddin</span></h1>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-widest leading-none mt-1">Leave Tracking System</p>
            </div>
          </div>

          <nav className="flex items-center gap-3">
            <NeuButton
              onClick={() => setActiveTab('dashboard')}
              active={activeTab === 'dashboard'}
              className="px-6 py-3 flex items-center gap-2"
            >
              <LayoutDashboard className="w-4 h-4" />
              <span className="hidden sm:inline">Dashboard</span>
            </NeuButton>
            <NeuButton
              onClick={() => setActiveTab('settings')}
              active={activeTab === 'settings'}
              className="px-6 py-3 flex items-center gap-2"
            >
              <Settings className="w-4 h-4" />
              <span className="hidden sm:inline">Settings</span>
            </NeuButton>

            {currentUser.role && currentUser.role !== 'staff' && (
              <NeuButton
                onClick={() => setActiveTab('management')}
                active={activeTab === 'management'}
                className="px-6 py-3 flex items-center gap-2 bg-blue-50/50"
              >
                <Users className="w-4 h-4 text-blue-500" />
                <span className="hidden sm:inline">Management</span>
              </NeuButton>
            )}

            <div className="w-px h-8 bg-gray-300 mx-2 hidden sm:block"></div>

            <div className="flex items-center gap-4 pl-4 border-l border-gray-300/30">
              <div className="text-right hidden sm:block">
                <p className="text-sm font-black text-gray-700 leading-none">{currentUser.name}</p>
                <p className="text-[10px] font-bold text-gray-400 uppercase">{currentUser.role || 'Staff'}</p>
              </div>
              <NeuButton onClick={handleLogout} className="p-3 text-red-500 shadow-neu-flat hover:shadow-neu-pressed">
                <LogOut className="w-5 h-5" />
              </NeuButton>
            </div>
          </nav>
        </header>

        {activeTab === 'settings' ? (
          <UserSettings user={currentUser} logs={logs} onLogout={handleLogout} />
        ) : activeTab === 'management' ? (
          <ManagementView user={currentUser} staffList={staffList} logs={logs} sessions={sessions} />
        ) : (
          /* Main Dashboard Tab */
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 animate-fade-in">
            {currentUser.prevYearBalance && currentUser.prevYearBalance > 3 && (
              <div className="lg:col-span-12">
                <div className="bg-orange-100 border-l-8 border-orange-500 text-orange-800 p-6 rounded-2xl shadow-neu-flat flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <AlertCircle className="w-8 h-8 text-orange-500 mt-1" />
                    <div>
                      <h3 className="font-black text-lg uppercase tracking-tight">Carry-Forward Limit Reached</h3>
                      <p className="text-sm font-medium opacity-90 mt-1">
                        You had <strong className="text-black">{currentUser.prevYearBalance} days</strong> remaining from last year.
                        However, the maximum carry-forward limit is 3 days.
                        <span className="block mt-1 bg-white/50 px-2 py-0.5 rounded text-orange-900 border border-orange-200 inline-block">
                          {currentUser.prevYearBalance - 3} days have been forfeited.
                        </span>
                      </p>
                    </div>
                  </div>
                  <div className="hidden md:block text-right">
                    <span className="text-4xl font-black text-orange-400/30">MAX:3</span>
                  </div>
                </div>
              </div>
            )}

            {/* LEFT COLUMN: Application Form (4 cols) */}
            <div className="lg:col-span-4 space-y-10">
              <NeuCard className="relative overflow-hidden group">
                <div className="absolute top-0 left-0 w-2 h-full bg-blue-500 transition-all duration-300 group-hover:w-3"></div>
                <h2 className="text-xl font-black text-gray-700 mb-8 flex items-center gap-3">
                  <FileText className="w-6 h-6 text-blue-500" />
                  New Application
                </h2>

                <form onSubmit={handleSubmit} className="space-y-8">
                  {/* Staff Select (Visible only for Admins, Staff are locked to their own) */}
                  <div className="space-y-3">
                    <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-2">Request Origin</label>
                    {currentUser.role === 'admin' || currentUser.role === 'super_admin' ? (
                      <div className="relative group">
                        <select
                          aria-label="Request Origin"
                          value={selectedStaffIC}
                          onChange={(e) => setSelectedStaffIC(e.target.value)}
                          className="w-full appearance-none bg-neu-base rounded-2xl shadow-neu-pressed-sm px-5 py-4 text-gray-700 outline-none focus:shadow-neu-pressed transition-all duration-300 cursor-pointer text-sm font-bold"
                        >
                          <option value="">-- Choose Colleague --</option>
                          {staffList.filter(s => s.active !== false).map(s => (
                            <option key={s.id} value={s.ic}>{s.name} ({s.ic}){s.branch ? ` - ${s.branch}` : ''}</option>
                          ))}
                        </select>
                        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-gray-400">
                          <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" /></svg>
                        </div>
                      </div>
                    ) : (
                      <div className="p-4 bg-neu-base rounded-2xl shadow-neu-pressed-sm flex items-center gap-3 border border-blue-100/50">
                        <UserIcon className="w-5 h-5 text-blue-400" />
                        <span className="font-bold text-gray-600">{currentUser.name} (Self)</span>
                      </div>
                    )}
                  </div>

                  {/* Leave Type Toggle */}
                  <div className="space-y-3">
                    <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-2">Leave Category</label>
                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                      <NeuButton type="button" onClick={() => setLeaveType('AL')} active={leaveType === 'AL'} className="py-3 text-[10px] font-black">ANNUAL</NeuButton>
                      <NeuButton type="button" onClick={() => setLeaveType('ML')} active={leaveType === 'ML'} className="py-3 text-[10px] font-black">MEDICAL</NeuButton>
                      <NeuButton type="button" onClick={() => setLeaveType('CME')} active={leaveType === 'CME'} className="py-3 text-[10px] font-black">CME</NeuButton>
                      <NeuButton type="button" onClick={() => setLeaveType('Paid')} active={leaveType === 'Paid'} className="py-3 text-[10px] font-black">PAID</NeuButton>
                      <NeuButton type="button" onClick={() => setLeaveType('Compassionate')} active={leaveType === 'Compassionate'} className="py-3 text-[10px] font-black text-center">EHSAN</NeuButton>
                      <NeuButton
                        type="button"
                        onClick={() => {
                          if (selectedStaff && selectedStaff.balanceAL > 0) {
                            alert("Unpaid leave is only available when Annual Leave balance is 0 or below.");
                            return;
                          }
                          setLeaveType('Unpaid');
                        }}
                        active={leaveType === 'Unpaid'}
                        className={clsx(
                          "py-3 text-[10px] font-black text-center",
                          selectedStaff && selectedStaff.balanceAL > 0 ? "opacity-50 cursor-not-allowed grayscale" : ""
                        )}
                      >
                        UNPAID
                      </NeuButton>
                    </div>
                  </div>

                  {/* Balance Display */}
                  <div className="bg-neu-base rounded-2xl p-6 shadow-neu-pressed flex justify-between items-center group-hover:bg-blue-50/10 transition-colors">
                    <span className="text-xs font-black text-gray-400 uppercase tracking-widest">{leaveType === 'AL' ? 'Earned' : 'Available'}</span>
                    <span className={clsx(
                      "text-2xl font-black transition-all duration-500",
                      currentBalance < 3 ? "text-red-500" : "text-blue-600"
                    )}>
                      {selectedStaff ? currentBalance : '-'} <span className="text-[10px] uppercase ml-1">Days</span>
                    </span>
                  </div>

                  {/* Leave Period Selection */}
                  <div className="space-y-4">
                    <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-2">Leave Period</label>
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

                  {/* Calculated Duration View */}
                  <div className="bg-neu-base rounded-2xl p-4 shadow-neu-pressed-sm flex justify-between items-center bg-gray-50/50">
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-blue-500" />
                      <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Calculated Duration</span>
                    </div>
                    <span className="text-lg font-black text-gray-700">
                      {duration ? `${duration} Days` : 'Select dates'}
                    </span>
                  </div>

                  {leaveType === 'AL' && typeof duration === 'number' && duration > currentBalance && (
                    <div className="flex items-center gap-2 p-3 bg-purple-50 text-purple-600 rounded-xl text-[10px] font-black uppercase tracking-tighter shadow-sm border border-purple-200/50">
                      <Zap className="w-3 h-3" />
                      Pro-rated Override: {duration - currentBalance} days will be UNPAID
                    </div>
                  )}

                  {!isDurationValid && duration !== '' && (
                    <div className="flex items-center gap-2 p-3 bg-red-50 text-red-500 rounded-xl text-[10px] font-black uppercase tracking-tighter animate-pulse">
                      <AlertCircle className="w-3 h-3" />
                      Exceeds {leaveType} balance
                    </div>
                  )}

                  {submitError && (
                    <div className="p-4 rounded-2xl bg-red-100 text-red-600 text-xs font-bold shadow-inner">
                      {submitError}
                    </div>
                  )}

                  <NeuButton
                    type="submit"
                    disabled={!selectedStaff || !duration || !isDurationValid || isSubmitting}
                    variant="primary"
                    className="w-full py-5 flex justify-center items-center gap-3 rounded-2xl shadow-neu-flat text-xs font-black tracking-widest uppercase mt-4"
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

              {/* KPI Cards & Leave Balances */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
                {/* Left Mini Column: KPIs */}
                <div className="space-y-8">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <NeuCard className="flex flex-col justify-center items-center gap-2 py-6 border-t-4 border-blue-400">
                      <span className="text-gray-400 text-[10px] font-black uppercase tracking-[0.2em]">Total Days</span>
                      <span className="text-3xl font-black text-gray-700 tracking-tighter">{dashboardStats.totalDays}</span>
                    </NeuCard>
                    <NeuCard className="flex flex-col justify-center items-center gap-2 py-6 border-t-4 border-purple-400">
                      <span className="text-gray-400 text-[10px] font-black uppercase tracking-[0.2em]">Unpaid Taken</span>
                      <span className="text-3xl font-black text-purple-600 tracking-tighter">{dashboardStats.totalUnpaid}</span>
                    </NeuCard>
                  </div>

                  {/* Leave Balances Section (Moved from sidebar) */}
                  <NeuCard className="max-h-[500px] flex flex-col">
                    <div className="flex items-center justify-between mb-6 border-b border-gray-300/20 pb-4">
                      <h3 className="text-gray-600 font-black uppercase tracking-widest text-xs">
                        Personnel Leave Balances
                      </h3>
                      <Users className="w-4 h-4 text-blue-400" />
                    </div>
                    <div className="space-y-3 overflow-y-auto pr-2 custom-scrollbar">
                      {staffList.filter(s => s.active !== false).map(staff => (
                        <div key={staff.id} className="flex justify-between items-center group p-4 bg-neu-base rounded-2xl shadow-neu-pressed-sm hover:shadow-neu-pressed transition-all duration-300 border border-white/50">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center font-black text-blue-500 text-xs">
                              {staff.name.charAt(0)}
                            </div>
                            <div>
                              <p className="font-bold text-gray-700 text-sm leading-none">{staff.name}</p>
                              <p className="text-[10px] text-gray-400 font-bold uppercase tracking-tight mt-1">{staff.ic}</p>
                              {staff.branch && <p className="text-[9px] text-blue-400 font-bold uppercase tracking-tight mt-0.5">{staff.branch}</p>}
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <div className="flex flex-col items-center">
                              <span className="text-[8px] font-black text-blue-400 uppercase tracking-tighter" title="Earned pro-rated balance">AL*</span>
                              <div className="px-2 py-1 bg-blue-50/50 rounded-lg text-xs font-black text-blue-600 shadow-sm">
                                {calculateProRatedAL(staff, logs)}
                              </div>
                            </div>
                            <div className="flex flex-col items-center">
                              <span className="text-[8px] font-black text-green-400 uppercase tracking-tighter">ML</span>
                              <div className="px-2 py-1 bg-green-50/50 rounded-lg text-xs font-black text-green-600 shadow-sm">{staff.balanceML}</div>
                            </div>
                            <div className="flex flex-col items-center">
                              <span className="text-[8px] font-black text-purple-400 uppercase tracking-tighter">UNP</span>
                              <div className="px-2 py-1 bg-purple-50/50 rounded-lg text-xs font-black text-purple-600 shadow-sm">
                                {logs.filter(l => l.staffId === staff.id && l.type === 'Unpaid' && (l.status === 'approved' || l.status === 'hod_approved' || l.status === 'pending')).reduce((acc, curr) => acc + curr.duration, 0)}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </NeuCard>
                </div>

                {/* Right Mini Column: insights & Activity */}
                <div className="space-y-6">

                  {/* Recent Activity Feed */}
                  <NeuCard className="max-h-[400px] flex flex-col">
                    <div className="flex items-center gap-3 mb-6 border-b border-gray-300/20 pb-4">
                      <History className="w-4 h-4 text-orange-400" />
                      <h3 className="text-gray-600 font-black uppercase tracking-widest text-xs">
                        Latest Updates
                      </h3>
                    </div>
                    <div className="space-y-4 overflow-y-auto pr-2 custom-scrollbar">
                      {logs.slice(0, 8).map(log => (
                        <div key={log.id} className="flex items-start justify-between p-3 bg-neu-base rounded-xl shadow-neu-pressed-sm border border-white/40">
                          <div>
                            <p className="font-bold text-gray-700 text-xs">{log.staffName}</p>
                            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-tight mt-0.5">
                              {log.type} &bull; {log.duration} Days
                            </p>
                          </div>
                          <div className={`px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest border ${log.status === 'approved' ? 'bg-green-100 text-green-600 border-green-200' :
                            log.status === 'hod_approved' ? 'bg-blue-100 text-blue-600 border-blue-200' :
                              log.status === 'rejected' ? 'bg-red-100 text-red-600 border-red-200' :
                                'bg-yellow-100 text-yellow-600 border-yellow-200'
                            }`}>
                            {log.status === 'hod_approved' ? 'HOD Auth' : log.status}
                          </div>
                        </div>
                      ))}
                      {logs.length === 0 && (
                        <p className="text-center text-[10px] text-gray-400 italic py-4">No recent activity.</p>
                      )}
                    </div>
                  </NeuCard>

                  <NeuCard className="h-[250px] border-l-8 border-purple-500 overflow-hidden relative flex flex-col">
                    <div className="absolute -top-10 -right-10 opacity-5">
                      <Sparkles className="w-40 h-40 text-purple-500" />
                    </div>
                    <div className="flex justify-between items-center mb-6">
                      <div>
                        <h3 className="text-md font-black text-gray-700 flex items-center gap-3">
                          <Sparkles className="w-5 h-5 text-purple-500" />
                          Gemini AI
                        </h3>
                        <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mt-1">Live analysis</p>
                      </div>
                      <NeuButton
                        onClick={handleGenerateInsight}
                        disabled={generatingAi}
                        className="text-[8px] px-4 py-2 font-black uppercase tracking-widest"
                      >
                        {generatingAi ? '...' : 'Refresh'}
                      </NeuButton>
                    </div>

                    <div className="flex-1 bg-neu-base rounded-3xl shadow-neu-pressed p-6 text-sm text-gray-600 leading-relaxed relative border border-white/20">
                      {generatingAi ? (
                        <div className="absolute inset-0 flex items-center justify-center bg-neu-base/80 rounded-3xl backdrop-blur-sm z-10">
                          <Activity className="w-6 h-6 text-purple-500 animate-spin" />
                        </div>
                      ) : aiSummary ? (
                        <div className="whitespace-pre-line font-medium text-xs">{aiSummary}</div>
                      ) : (
                        <div className="flex flex-col items-center justify-center h-full text-gray-400 grayscale opacity-30">
                          <Zap className="w-8 h-8 mb-2" />
                          <span className="text-[10px] font-black uppercase text-center">Ready</span>
                        </div>
                      )}
                    </div>
                  </NeuCard>
                </div>
              </div>



            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="mt-20 pb-10 text-center">
        <div className="flex items-center justify-center gap-6 mb-4 opacity-30">
          <Activity className="w-5 h-5 text-gray-400" />
          <Sparkles className="w-5 h-5 text-gray-400" />
          <LayoutDashboard className="w-5 h-5 text-gray-400" />
        </div>
        <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.5em]">Klinik Syed Badaruddin 2026. Internal Use Only.</p>
      </footer>
    </div>
  );
};

export default App;