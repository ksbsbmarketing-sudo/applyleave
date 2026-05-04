import React, { useState, useEffect } from 'react';
import {
    CheckCircle, XCircle, Trash2, Edit3, User, Users, Calendar, Clock,
    Search, Shield, Activity, Save, ArrowLeft, Printer, Download, FileText,
    Briefcase, MapPin, Stethoscope, ChevronDown, ChevronUp, Lock, AlertCircle,
    ShieldAlert, UserCog, ShieldCheck, PieChart
} from 'lucide-react';
import { NeuCard, NeuButton, NeuInput, NeuBadge, NeuTextArea } from './NeuElements';
import { Staff, LeaveLog, BRANCHES, BRANCH_GROUPS, MALAYSIA_STATES } from '../types';
import { 
    approveLeave, rejectLeave, updateStaffData, deleteLeaveLog, 
    updateLeaveLog, deleteStaff, subscribeToBranches, addBranch, deleteBranch 
} from '../services/firebase';

interface ManagementViewProps {
    user: Staff;
    staffList: Staff[];
    logs: LeaveLog[];
    sessions: any[];
}

export const ManagementView: React.FC<ManagementViewProps> = ({ user, staffList, logs, sessions }) => {
    const [activeSubTab, setActiveSubTab] = useState<'approvals' | 'staff' | 'logs' | 'reports' | 'sessions' | 'branches' | 'audit'>(
        user.role === 'hr' ? 'reports' : (user.role === 'admin' || user.role === 'super_admin') ? 'staff' : 'approvals'
    );
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedBranch, setSelectedBranch] = useState<string>('');
    const [editingStaff, setEditingStaff] = useState<Staff | null>(null);

    const calculateTenure = (joinDate: string) => {
        if (!joinDate) return 0;
        const join = new Date(joinDate);
        const now = new Date();
        let years = now.getFullYear() - join.getFullYear();
        const m = now.getMonth() - join.getMonth();
        if (m < 0 || (m === 0 && now.getDate() < join.getDate())) {
            years--;
        }
        return years >= 0 ? years : 0;
    };
    const [editingLog, setEditingLog] = useState<LeaveLog | null>(null);
    const [printingLog, setPrintingLog] = useState<LeaveLog | null>(null);
    const [isUpdating, setIsUpdating] = useState(false);
    const [showInactive, setShowInactive] = useState(false);

    // Branch Management State
    const [branchesConfig, setBranchesConfig] = useState<Record<string, string[]>>({});
    const [newState, setNewState] = useState('Pahang');
    const [newBranch, setNewBranch] = useState('');
    const [expandedBranches, setExpandedBranches] = useState<string[]>([]);

    useEffect(() => {
        return subscribeToBranches((config) => {
            setBranchesConfig(config);
        });
    }, []);

    const handleAddBranch = () => {
        if (!newBranch.trim()) return;
        addBranch(newState, newBranch.trim());
        setNewBranch('');
    };

    const handleDeleteBranch = (state: string, branch: string) => {
        if (confirm(`Buang cawangan ${branch} dari ${state}?`)) {
            deleteBranch(state, branch);
        }
    };

    const toggleBranch = (branchName: string) => {
        setExpandedBranches(prev => 
            prev.includes(branchName) 
                ? prev.filter(b => b !== branchName) 
                : [...prev, branchName]
        );
    };

    const getBranchColor = (branchName: string) => {
        if (branchName.includes('Balok')) return 'bg-luxury-gold shadow-premium-lg ring-1 ring-white/20';
        if (branchName.includes('Beserah') || branchName.includes('Utama')) return 'bg-stone-800 shadow-premium-md ring-1 ring-white/10';
        if (branchName.includes('Gebeng')) return 'bg-premium-accent shadow-premium-md';
        if (branchName.includes('Kempadang') || branchName.includes('Bentong')) return 'bg-stone-500 shadow-premium-sm';
        if (branchName.includes('MCKIP') || branchName.includes('Kerteh')) return 'bg-stone-700 shadow-premium-sm';
        if (branchName.includes('RPCM') || branchName.includes('Paka')) return 'bg-stone-900 shadow-premium-sm';
        return 'bg-stone-400 shadow-premium-sm';
    };

    // Filter logs for approval
    const pendingLogs = logs.filter(log => {
        if (user.role === 'hod') return log.status === 'pending';
        if (user.role === 'gm') return log.status === 'hod_approved' || log.status === 'pending';
        if (user.role === 'admin' || user.role === 'super_admin') return log.status === 'pending' || log.status === 'hod_approved';
        return false;
    });

    const handleApprove = async (logId: string) => {
        if (!user.role || user.role === 'staff') return;
        try {
            await approveLeave(logId, user.role as any, user.id);
        } catch (e: any) {
            alert(e.message);
        }
    };

    const handleReject = async (logId: string) => {
        const reason = prompt("Enter rejection reason:");
        if (!reason) return;
        try {
            await rejectLeave(logId, reason);
        } catch (e: any) {
            alert(e.message);
        }
    };

    const handleUpdateStaff = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingStaff) return;
        setIsUpdating(true);
        try {
            await updateStaffData(editingStaff.id, {
                balanceAL: editingStaff.balanceAL,
                balanceMC: editingStaff.balanceMC,
                balanceHL: editingStaff.balanceHL || 0,
                balanceRL: editingStaff.balanceRL || 0,
                balanceML: editingStaff.balanceML || 0,
                balancePL: editingStaff.balancePL || 0,
                balanceEL: editingStaff.balanceEL || 0,
                balanceBL: editingStaff.balanceBL || 0,
                balanceUL: editingStaff.balanceUL || 0,
                staffType: (editingStaff.staffType || undefined) as any,
                role: editingStaff.role,
                branch: editingStaff.branch ? editingStaff.branch.trim() : '',
                name: editingStaff.name,
                joinDate: editingStaff.joinDate,
                prevYearBalance: editingStaff.prevYearBalance || 0
            });
            setEditingStaff(null);
        } catch (e: any) {
            alert(e.message);
        } finally {
            setIsUpdating(false);
        }
    };

    const handleDeleteStaff = async (staffId: string) => {
        if (!window.confirm("Are you sure you want to remove this staff member? This action cannot be undone.")) return;
        try {
            await deleteStaff(staffId);
        } catch (e: any) {
            alert(e.message);
        }
    };

    const handleDeleteLog = async (logId: string) => {
        if (!window.confirm("Delete this leave record?")) return;
        try {
            await deleteLeaveLog(logId);
        } catch (e: any) {
            alert(e.message);
        }
    };

    const handleUpdateLog = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingLog) return;
        setIsUpdating(true);
        try {
            // Recalculate duration if dates changed
            const start = new Date(editingLog.startDate);
            const end = new Date(editingLog.endDate);
            const diffTime = end.getTime() - start.getTime();
            const calcDuration = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

            await updateLeaveLog(editingLog.id, {
                startDate: editingLog.startDate,
                endDate: editingLog.endDate,
                duration: calcDuration > 0 ? calcDuration : editingLog.duration,
                type: editingLog.type,
                status: editingLog.status,
                reason: editingLog.reason
            });
            setEditingLog(null);
        } catch (e: any) {
            alert(e.message);
        } finally {
            setIsUpdating(false);
        }
    };

    const handlePrintForm = (log: LeaveLog) => {
        setPrintingLog(log);
        setTimeout(() => {
            window.print();
            setPrintingLog(null);
        }, 100);
    };

    return (
        <div className="space-y-8 animate-fade-in">
            {/* Sub-Navigation */}
            <div className="flex flex-wrap gap-2 p-2 bg-white/60 backdrop-blur-xl rounded-[1.5rem] border border-premium-border/30 max-w-fit shadow-premium-md sticky top-4 z-20 mx-auto lg:mx-0">
                {(user.role === 'hod' || user.role === 'gm' || user.role === 'admin' || user.role === 'super_admin') && (
                    <button
                        onClick={() => setActiveSubTab('approvals')}
                        className={`px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] transition-all duration-500 ${activeSubTab === 'approvals' 
                            ? 'bg-luxury-gold text-white shadow-premium-lg scale-[1.02]' 
                            : 'text-premium-muted hover:bg-premium-bg hover:text-premium-primary'}`}
                    >
                        Kelulusan ({pendingLogs.length})
                    </button>
                )}
                {(user.role === 'admin' || user.role === 'super_admin' || user.role === 'hr') && (
                    <button
                        onClick={() => setActiveSubTab('staff')}
                        className={`px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] transition-all duration-500 ${activeSubTab === 'staff' 
                            ? 'bg-luxury-gold text-white shadow-premium-lg scale-[1.02]' 
                            : 'text-premium-muted hover:bg-premium-bg hover:text-premium-primary'}`}
                    >
                        Senarai Staff
                    </button>
                )}
                {(user.role === 'admin' || user.role === 'super_admin') && (
                    <>
                        <button
                            onClick={() => setActiveSubTab('branches')}
                            className={`px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] transition-all duration-500 flex items-center gap-2 ${activeSubTab === 'branches' 
                                ? 'bg-luxury-gold text-white shadow-premium-lg scale-[1.02]' 
                                : 'text-premium-muted hover:bg-stone-100 hover:text-premium-primary'}`}
                        >
                            <Briefcase className="w-3.5 h-3.5" />
                            Cawangan
                        </button>
                        {(user.role === 'admin' || user.role === 'super_admin') && (
                            <button
                                onClick={() => setActiveSubTab('sessions')}
                                className={`px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] transition-all duration-500 ${activeSubTab === 'sessions' 
                                    ? 'bg-premium-primary text-white shadow-premium-lg scale-[1.02]' 
                                    : 'text-premium-muted hover:bg-premium-bg hover:text-premium-primary'}`}
                            >
                                Sesi Login
                            </button>
                        )}
                        {user.role === 'super_admin' && (
                            <button
                                onClick={() => setActiveSubTab('audit')}
                                className={`px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] transition-all duration-500 ${activeSubTab === 'audit' 
                                    ? 'bg-red-900 text-white shadow-premium-lg scale-[1.02]' 
                                    : 'text-premium-muted hover:bg-premium-bg hover:text-premium-primary'}`}
                            >
                                Master Audit
                            </button>
                        )}
                    </>
                )}
                {(user.role === 'admin' || user.role === 'super_admin' || user.role === 'hr') && (
                    <button
                        onClick={() => setActiveSubTab('reports')}
                        className={`px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] transition-all duration-500 flex items-center gap-2 ${activeSubTab === 'reports' 
                            ? 'bg-luxury-gold text-white shadow-premium-lg scale-[1.02]' 
                            : 'text-premium-muted hover:bg-premium-bg hover:text-premium-primary'}`}
                    >
                        <FileText className="w-3.5 h-3.5" />
                        Laporan HR
                    </button>
                )}
            </div>

            {/* --- Approvals Tab --- */}
            {activeSubTab === 'approvals' && (
                <div className="space-y-6">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-premium-bg rounded-2xl border border-luxury-gold/30">
                            <Clock className="w-6 h-6 text-luxury-gold" />
                        </div>
                        <h3 className="text-2xl font-bold text-premium-primary uppercase tracking-tight font-luxury">Menunggu Kelulusan</h3>
                    </div>

                    {pendingLogs.length === 0 ? (
                        <NeuCard className="text-center py-20 bg-premium-bg/50 border-dashed">
                            <div className="w-20 h-20 bg-premium-bg rounded-full flex items-center justify-center mx-auto mb-6 border border-luxury-gold/20">
                                <CheckCircle className="w-10 h-10 text-luxury-gold" />
                            </div>
                            <p className="text-premium-muted font-black uppercase tracking-widest text-sm font-luxury">Tiada Kelulusan Tertunggak</p>
                            <p className="text-xs text-premium-muted mt-2">Semua permohonan telah diproses</p>
                        </NeuCard>
                    ) : (
                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                            {pendingLogs.map(log => (
                                <NeuCard key={log.id} className="relative overflow-hidden group border border-premium-border/50 hover:shadow-premium-lg transition-all duration-300">
                                    <div className="absolute top-0 right-0 w-32 h-32 bg-luxury-gold/5 -translate-y-16 translate-x-16 rounded-full group-hover:scale-110 transition-transform duration-500" />
                                    <div className="flex justify-between items-start mb-4">
                                        <div>
                                            <h4 className="font-black text-gray-700 text-lg">{log.staffName}</h4>
                                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{log.staffId}</p>
                                            {staffList.find(s => s.id === log.staffId)?.branch && (
                                                <p className="text-[9px] font-bold text-premium-accent uppercase tracking-widest mt-1">
                                                    {staffList.find(s => s.id === log.staffId)?.branch}
                                                </p>
                                            )}
                                        </div>
                                        <NeuBadge variant={log.type === 'AL' ? 'gold' : 'green'}>{log.type}</NeuBadge>
                                    </div>

                                    <div className="flex items-center gap-4 mb-6 relative z-10">
                                        <div className="flex-1 p-4 bg-premium-bg rounded-2xl border border-premium-border/50 text-center">
                                            <span className="block text-2xl font-bold text-premium-primary font-luxury">{log.duration}</span>
                                            <span className="text-[10px] font-black text-premium-muted uppercase tracking-widest">Hari</span>
                                        </div>
                                        <div className="flex-[2] p-4 bg-premium-bg rounded-2xl border border-premium-border/50 text-center">
                                            <span className="block text-[11px] font-bold text-premium-primary tracking-tight font-luxury">{log.startDate} hingga {log.endDate}</span>
                                            <span className="text-[10px] font-black text-premium-muted uppercase tracking-widest">Tempoh Cuti</span>
                                        </div>
                                    </div>

                                    <div className="mb-6 p-4 bg-gray-50/50 rounded-xl border border-gray-100 italic text-sm text-gray-600">
                                        "{log.reason}"
                                    </div>

                                    <div className="flex gap-3 mb-4">
                                        <NeuButton onClick={() => handlePrintForm(log)} className="flex-1 py-3 text-premium-accent hover:bg-premium-bg flex items-center justify-center gap-2 border-premium-border/30">
                                            <Printer className="w-4 h-4" /> Print Form
                                        </NeuButton>
                                    </div>

                                    <div className="flex gap-3">
                                        <NeuButton
                                            onClick={() => handleApprove(log.id)}
                                            className="flex-1 py-3 text-green-600 hover:bg-green-50/50 flex items-center justify-center gap-2"
                                        >
                                            <CheckCircle className="w-4 h-4" />
                                            {user.role === 'hod' ? 'Authorize' : 'Finalize'}
                                        </NeuButton>
                                        <NeuButton
                                            onClick={() => handleReject(log.id)}
                                            className="flex-1 py-3 text-red-500 hover:bg-red-50/50 flex items-center justify-center gap-2"
                                        >
                                            <XCircle className="w-4 h-4" />
                                            Reject
                                        </NeuButton>
                                    </div>

                                    {log.status === 'hod_approved' && (
                                        <div className="mt-4 pt-4 border-t border-gray-200">
                                            <p className="text-[10px] font-bold text-premium-accent uppercase tracking-widest flex items-center gap-1">
                                                <Shield className="w-3 h-3" /> HOD Authorized
                                            </p>
                                        </div>
                                    )}
                                </NeuCard>
                            ))}
                        </div>
                    )}
                </div>
            )}


            {/* --- Staff Management Tab --- */}
            {activeSubTab === 'staff' && (user.role === 'admin' || user.role === 'super_admin' || user.role === 'hr') && (
                <div className="space-y-6">
                    <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-8">
                        <div>
                            <h3 className="text-3xl font-black text-premium-primary uppercase tracking-tight flex items-center gap-3">
                                <Users className="w-8 h-8 text-premium-accent" />
                                SENARAI KAKITANGAN
                            </h3>
                            <p className="text-sm text-premium-muted font-bold mt-2 ml-1">Pengurusan data personel dan kelayakan cuti</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-4 bg-white/50 backdrop-blur-sm p-3 rounded-2xl border border-premium-border/50 shadow-premium-sm">
                            <label className="flex items-center gap-3 cursor-pointer select-none px-2 group">
                                <div className={`w-11 h-6 rounded-full p-1 transition-all duration-300 ${showInactive ? 'bg-luxury-gold' : 'bg-premium-border'}`}>
                                    <div className={`w-4 h-4 rounded-full bg-white shadow-sm transform transition-transform duration-300 ${showInactive ? 'translate-x-5' : ''}`}></div>
                                </div>
                                <input type="checkbox" className="hidden" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
                                <span className="text-[11px] font-black text-premium-muted uppercase tracking-widest group-hover:text-premium-primary transition-colors">Tunjuk Tidak Aktif</span>
                            </label>
                            <div className="w-full md:w-72">
                                <NeuInput
                                    placeholder="Carian Nama / IC / Cawangan..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="!rounded-xl"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="space-y-8">
                        {Object.entries(branchesConfig).map(([state, branches]) => {
                            const stateStaff = staffList.filter(s => {
                                const isInSearch = s.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                                                  s.id.includes(searchTerm) || 
                                                  (s.branch && s.branch.toLowerCase().includes(searchTerm.toLowerCase()));
                                const isActiveMatch = showInactive || s.active !== false;
                                return isInSearch && isActiveMatch && branches.includes(s.branch || '');
                            });

                            if (stateStaff.length === 0 && !searchTerm) return null;

                            return (
                                <div key={state} className="space-y-4">
                                    {/* State Header Dashboard Style */}
                                    <div className="bg-white rounded-[2.5rem] p-8 shadow-premium-md flex flex-col md:flex-row justify-between items-center gap-8 border border-premium-border/50 relative overflow-hidden group">
                                        <div className="absolute top-0 left-0 w-1 h-full bg-luxury-gold" />
                                        <div className="flex items-center gap-8 relative z-10">
                                            <div className="w-20 h-20 bg-premium-bg rounded-3xl flex items-center justify-center border border-premium-border shadow-premium-sm group-hover:scale-110 transition-transform duration-500">
                                                <MapPin className="w-10 h-10 text-premium-accent" />
                                            </div>
                                            <div>
                                                <p className="text-[11px] font-black text-premium-muted uppercase tracking-[0.25em] mb-2 leading-none">Negeri / Kawasan</p>
                                                <h3 className="text-3xl font-black text-premium-primary tracking-tight uppercase leading-none">
                                                    {state} SITE
                                                </h3>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-12 relative z-10 bg-premium-bg/50 p-6 rounded-[2rem] border border-premium-border/30">
                                            <div className="text-center">
                                                <p className="text-3xl font-black text-premium-primary leading-none tabular-nums font-luxury">{branches.length}</p>
                                                <p className="text-[10px] font-black text-premium-muted uppercase tracking-widest mt-2">Cawangan</p>
                                            </div>
                                            <div className="h-10 w-px bg-premium-border/30"></div>
                                            <div className="text-center">
                                                <p className="text-3xl font-black text-premium-primary leading-none tabular-nums font-luxury">{stateStaff.length}</p>
                                                <p className="text-[10px] font-black text-premium-muted uppercase tracking-widest mt-2">Kakitangan</p>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="space-y-3 pl-4 md:pl-0">
                                        {branches.map(branch => {
                                            const branchStaff = stateStaff.filter(s => s.branch === branch);
                                            if (branchStaff.length === 0 && searchTerm) return null;
                                            if (branchStaff.length === 0 && !searchTerm) return null;

                                            const isExpanded = expandedBranches.includes(branch);
                                            const stats = {
                                                total: branchStaff.length,
                                                active: branchStaff.filter(s => s.active !== false).length,
                                                admin: branchStaff.filter(s => s.staffType === 'admin_staff').length,
                                                doctor: branchStaff.filter(s => s.staffType === 'doctor').length,
                                                operations: branchStaff.filter(s => s.staffType === 'operation_staff').length
                                            };

                                            return (
                                                <div key={branch} className="space-y-2">
                                                    {/* Branch Bar */}
                                                    <div 
                                                        onClick={() => toggleBranch(branch)}
                                                        className="bg-white rounded-[2rem] p-5 flex flex-col md:flex-row justify-between items-center gap-5 cursor-pointer hover:shadow-premium-md transition-all duration-300 border border-premium-border/50 group relative overflow-hidden"
                                                    >
                                                        <div className="absolute top-0 right-0 w-2 h-full bg-premium-bg transition-colors group-hover:bg-premium-accent/5" />
                                                        <div className="flex items-center gap-5 relative z-10">
                                                            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center border border-white shadow-premium-sm transition-transform duration-300 group-hover:rotate-6 ${
                                                                branch.toLowerCase().includes('balok') ? 'bg-luxury-gold' :
                                                                branch.toLowerCase().includes('beserah') ? 'bg-premium-primary' :
                                                                branch.toLowerCase().includes('gebeng') ? 'bg-premium-accent' :
                                                                branch.toLowerCase().includes('kempadang') ? 'bg-premium-muted' :
                                                                'bg-premium-muted/70'
                                                            }`}>
                                                                {branch.toLowerCase().includes('klinik') ? <Stethoscope className="w-6 h-6 text-white" /> : <Briefcase className="w-6 h-6 text-white" />}
                                                            </div>
                                                            <h5 className="text-base font-black text-premium-primary tracking-tight uppercase truncate max-w-[200px] md:max-w-none">
                                                                {branch}
                                                            </h5>
                                                        </div>

                                                        <div className="flex flex-wrap items-center justify-center gap-3 relative z-10">
                                                            {[
                                                                { label: 'Staff', val: stats.total, color: 'text-premium-primary' },
                                                                { label: 'Aktif', val: stats.active, color: 'text-luxury-gold' },
                                                                { label: 'Doktor', val: stats.doctor, color: 'text-premium-muted/70' },
                                                                { label: 'Admin', val: stats.admin, color: 'text-premium-accent' }
                                                            ].map(stat => (
                                                                <div key={stat.label} className="bg-premium-bg/80 rounded-xl px-4 py-2 min-w-[70px] text-center border border-premium-border/30">
                                                                    <p className={`text-base font-bold ${stat.color} leading-none tabular-nums font-luxury`}>{stat.val}</p>
                                                                    <p className="text-[8px] font-black text-premium-muted uppercase tracking-widest mt-1.5">{stat.label}</p>
                                                                </div>
                                                            ))}
                                                            <div className="ml-3 w-10 h-10 rounded-full bg-premium-bg flex items-center justify-center border border-premium-border group-hover:bg-premium-primary group-hover:border-premium-primary transition-all duration-300">
                                                                {isExpanded ? <ChevronUp className="w-5 h-5 text-premium-muted group-hover:text-white" /> : <ChevronDown className="w-5 h-5 text-premium-muted group-hover:text-white" />}
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* Expanded Staff Table */}
                                                    {isExpanded && (
                                                        <div className="mx-6 animate-in slide-in-from-top-4 duration-500">
                                                            <div className="bg-white/50 backdrop-blur-xl rounded-b-[2rem] shadow-premium-lg border-x border-b border-premium-border/30 overflow-hidden">
                                                                <div className="overflow-x-auto">
                                                                    <table className="w-full text-left border-collapse">
                                                                        <thead>
                                                                            <tr className="border-b border-premium-border/30 bg-premium-bg/50">
                                                                                <th className="p-6 pl-8 text-[10px] font-black text-premium-muted uppercase tracking-[0.2em]">Profil Kakitangan</th>
                                                                                <th className="p-4 text-[10px] font-black text-premium-muted uppercase tracking-widest text-center">Ent</th>
                                                                                <th className="p-4 text-[10px] font-black text-premium-muted uppercase tracking-widest text-center">AL</th>
                                                                                <th className="p-4 text-[10px] font-black text-premium-muted uppercase tracking-widest text-center">MC</th>
                                                                                <th className="p-4 text-[10px] font-black text-premium-muted uppercase tracking-widest text-center">HL</th>
                                                                                <th className="p-4 text-[10px] font-black text-premium-muted uppercase tracking-widest text-center">RL</th>
                                                                                <th className="p-4 text-[10px] font-black text-premium-muted uppercase tracking-widest text-center">ML</th>
                                                                                <th className="p-4 text-[10px] font-black text-premium-muted uppercase tracking-widest text-center">PL</th>
                                                                                <th className="p-4 text-[10px] font-black text-premium-muted uppercase tracking-widest text-center">EL</th>
                                                                                <th className="p-4 text-[10px] font-black text-premium-muted uppercase tracking-widest text-center">BL</th>
                                                                                <th className="p-4 text-[10px] font-black text-premium-muted uppercase tracking-widest text-center">UL</th>
                                                                                <th className="p-4 text-[10px] font-black text-premium-muted uppercase tracking-widest text-center">CF</th>
                                                                                <th className="p-6 pr-8 text-[10px] font-black text-premium-muted uppercase tracking-[0.2em] text-right">Tindakan</th>
                                                                            </tr>
                                                                        </thead>
                                                                        <tbody className="divide-y divide-premium-border/20">
                                                                            {branchStaff.map(s => (
                                                                                <tr key={s.id} className="hover:bg-premium-bg/50 even:bg-premium-bg/30 transition-colors">
                                                                                    <td className="p-4 pl-6">
                                                                                        <p className={s.active !== false ? "font-black text-[13px] text-gray-700 uppercase tracking-tight" : "font-black text-[13px] text-gray-400 uppercase tracking-tight"}>{s.name}</p>
                                                                                        <p className="text-[11px] text-gray-400 font-bold mb-2 tracking-tighter">{s.ic}</p>
                                                                                        <div className="flex flex-wrap gap-1.5">
                                                                                            <button
                                                                                                onClick={() => {
                                                                                                    if (confirm(`Change status of ${s.name} to ${s.active !== false ? 'Inactive' : 'Active'}?`)) {
                                                                                                        updateStaffData(s.id, { active: s.active === false });
                                                                                                    }
                                                                                                }}
                                                                                                className={`px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest transition-all shadow-sm ${s.active !== false
                                                                                                    ? "bg-luxury-gold/20 text-luxury-gold border border-luxury-gold/30"
                                                                                                    : "bg-premium-bg text-premium-muted/70 border border-premium-border"
                                                                                                    }`}
                                                                                            >
                                                                                                {s.active !== false ? "Active" : "Inactive"}
                                                                                            </button>
                                                                                            {s.staffType && (
                                                                                                <NeuBadge className="text-[9px] px-2.5 py-1" variant={s.staffType === 'doctor' ? 'green' : s.staffType === 'admin_staff' ? 'gold' : 'stone'}>
                                                                                                    {s.staffType === 'admin_staff' ? 'ADMIN' : s.staffType === 'operation_staff' ? 'OPERASI' : 'DOKTOR'}
                                                                                                </NeuBadge>
                                                                                            )}
                                                                                            <NeuBadge className="text-[9px] px-2.5 py-1" variant={s.role === 'super_admin' ? 'stone' : s.role === 'admin' ? 'stone' : s.role === 'gm' ? 'gold' : 'gold'}>
                                                                                                {s.role?.toUpperCase() || 'STAFF'}
                                                                                            </NeuBadge>
                                                                                        </div>
                                                                                    </td>
                                                                                    <td className="p-4 text-center border-l border-premium-border/30">
                                                                                        <span className="text-[12px] font-black text-premium-muted/50">
                                                                                            {s.entitlementAL || 0}
                                                                                        </span>
                                                                                    </td>
                                                                                    <td className="p-2 text-center text-[12px] font-bold text-premium-primary font-luxury">{s.balanceAL}</td>
                                                                                    <td className="p-2 text-center text-[12px] font-bold text-luxury-gold font-luxury">{s.balanceMC}</td>
                                                                                    <td className="p-2 text-center text-[12px] font-bold text-premium-muted font-luxury">{s.balanceHL || 0}</td>
                                                                                    <td className="p-2 text-center text-[12px] font-bold text-premium-muted font-luxury">{s.balanceRL || 0}</td>
                                                                                    <td className="p-2 text-center text-[12px] font-bold text-premium-accent font-luxury">{s.balanceML || 0}</td>
                                                                                    <td className="p-2 text-center text-[12px] font-bold text-premium-muted font-luxury">{s.balancePL || 0}</td>
                                                                                    <td className="p-2 text-center text-[12px] font-bold text-red-500 font-luxury">{s.balanceEL || 0}</td>
                                                                                    <td className="p-2 text-center text-[12px] font-bold text-premium-accent font-luxury">{s.balanceBL || 0}</td>
                                                                                    <td className="p-2 text-center text-[12px] font-bold text-premium-muted font-luxury">{s.balanceUL || 0}</td>
                                                                                    <td className="p-2 text-center text-[12px] font-bold text-luxury-gold font-luxury">{s.prevYearBalance || 0}</td>
                                                                                    <td className="p-4 pr-8 text-right flex justify-end gap-3">
                                                                                        <NeuButton onClick={() => setEditingStaff(s)} variant="gold" className="p-2.5 shadow-premium-sm border-premium-border/30">
                                                                                            <Edit3 className="w-4 h-4 text-premium-muted" />
                                                                                        </NeuButton>
                                                                                        <NeuButton onClick={() => handleDeleteStaff(s.id)} variant="danger" className="p-2.5 shadow-premium-sm">
                                                                                            <Trash2 className="w-4 h-4" />
                                                                                        </NeuButton>
                                                                                    </td>
                                                                                </tr>
                                                                            ))}
                                                                        </tbody>
                                                                    </table>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Other/Unassigned Section Dashboard Style */}
                    {(() => {
                        const otherStaff = staffList.filter(s => {
                            const isInSearch = s.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                                              s.id.includes(searchTerm);
                            const isActiveMatch = showInactive || s.active !== false;
                            const isUnassigned = !s.branch || !Object.values(branchesConfig).flat().includes(s.branch);
                            return isInSearch && isActiveMatch && isUnassigned;
                        });

                        if (otherStaff.length === 0) return null;

                        return (
                            <div className="space-y-6 pb-12">
                                <div className="bg-white rounded-[2.5rem] p-8 shadow-premium-md flex justify-between items-center border border-premium-border/50 relative overflow-hidden group">
                                    <div className="absolute top-0 left-0 w-1.5 h-full bg-slate-400" />
                                    <div className="flex items-center gap-8 relative z-10">
                                        <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center border border-slate-100 group-hover:scale-105 transition-transform">
                                            <User className="w-8 h-8 text-stone-500" />
                                        </div>
                                        <div>
                                            <p className="text-[10px] font-black text-premium-muted uppercase tracking-widest mb-1">Status Khas</p>
                                            <h3 className="text-2xl font-black text-premium-primary tracking-tight uppercase">Belum Ditugaskan</h3>
                                        </div>
                                    </div>
                                    <div className="bg-slate-50 px-6 py-3 rounded-2xl border border-slate-100 flex flex-col items-center justify-center">
                                        <p className="text-2xl font-bold text-premium-primary leading-none tabular-nums font-luxury">{otherStaff.length}</p>
                                        <p className="text-[9px] font-black text-premium-muted uppercase tracking-widest mt-1.5">Personel</p>
                                    </div>
                                </div>
                                <div className="bg-white rounded-[2rem] shadow-premium-sm border border-premium-border/30 overflow-hidden">
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-left border-collapse">
                                            <thead>
                                                <tr className="border-b border-slate-100 bg-slate-50/30">
                                                    <th className="p-5 pl-8 text-[10px] font-black text-premium-muted uppercase tracking-widest text-left">Info Kakitangan</th>
                                                    <th className="p-5 text-[10px] font-black text-premium-muted uppercase tracking-widest text-center">Status</th>
                                                    <th className="p-5 text-[10px] font-black text-premium-muted uppercase tracking-widest text-center">Jenis</th>
                                                    <th className="p-5 text-[10px] font-black text-premium-muted uppercase tracking-widest text-center">CF</th>
                                                    <th className="p-5 text-[10px] font-black text-premium-muted uppercase tracking-widest text-center">Cawangan Semasa</th>
                                                    <th className="p-5 pr-8 text-[10px] font-black text-premium-muted uppercase tracking-widest text-right">Tindakan</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-50">
                                                {otherStaff.map(s => (
                                                    <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                                                        <td className="p-5 pl-8">
                                                            <p className="font-black text-sm text-premium-primary uppercase">{s.name}</p>
                                                            <p className="text-[11px] text-premium-muted font-bold tracking-tighter">{s.ic}</p>
                                                        </td>
                                                        <td className="p-5 text-center">
                                                            <NeuBadge variant={s.active !== false ? 'green' : 'slate'}>
                                                                {s.active !== false ? 'AKTIF' : 'TIDAK AKTIF'}
                                                            </NeuBadge>
                                                        </td>
                                                        <td className="p-5 text-center">
                                                            {s.staffType && (
                                                                <NeuBadge variant={s.staffType === 'doctor' ? 'green' : s.staffType === 'admin_staff' ? 'gold' : 'stone'}>
                                                                    {s.staffType === 'admin_staff' ? 'Admin Staff' : s.staffType === 'operation_staff' ? 'Operation Staff' : 'Doctor'}
                                                                </NeuBadge>
                                                            )}
                                                        </td>
                                                        <td className="p-5 text-center font-bold text-xs text-luxury-gold font-luxury">
                                                            {s.prevYearBalance || 0}
                                                        </td>
                                                        <td className="p-4">
                                                            <p className="text-[10px] font-bold text-red-400 italic">
                                                                {s.branch || "Tiada Cawangan"}
                                                            </p>
                                                        </td>
                                                        <td className="p-4 pr-6 text-right">
                                                            <NeuButton onClick={() => setEditingStaff(s)} className="p-2 text-premium-accent">
                                                                <Edit3 className="w-3.5 h-3.5" />
                                                            </NeuButton>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>
                        );
                    })()}
                </div>
            )}

            {/* --- Branch Management Tab --- */}
            {activeSubTab === 'branches' && (user.role === 'admin' || user.role === 'super_admin') && (
                <div className="space-y-8 animate-fade-in">
                    <div className="flex items-center gap-4">
                        <div className="p-3.5 bg-stone-100 rounded-2xl border border-premium-border/30 shadow-premium-sm">
                            <MapPin className="w-8 h-8 text-premium-accent" />
                        </div>
                        <div>
                            <h3 className="text-3xl font-bold text-premium-primary uppercase tracking-tight font-luxury">Pengurusan Kawasan</h3>
                            <p className="text-xs text-premium-muted font-bold mt-1">Konfigurasi cawangan dan pemetaan lokasi</p>
                        </div>
                    </div>

                    <NeuCard className="p-0 overflow-hidden border border-premium-border/50">
                        <div className="p-8 bg-slate-50/50 border-b border-premium-border/30">
                            <h4 className="text-[11px] font-black text-premium-muted uppercase tracking-[0.25em] mb-6">Tambah Cawangan Baharu</h4>
                            <div className="flex flex-col lg:flex-row gap-6 items-end">
                                <div className="flex-1 w-full">
                                    <label className="text-[10px] font-black text-premium-muted uppercase tracking-widest mb-2.5 block ml-1">Pilih Negeri / Kawasan</label>
                                    <select 
                                        value={newState} 
                                        onChange={e => setNewState(e.target.value)} 
                                        className="w-full text-xs font-black text-premium-primary bg-white border border-premium-border rounded-xl px-5 py-4 focus:outline-none focus:ring-4 focus:ring-premium-primary/5 transition-all appearance-none cursor-pointer hover:border-premium-primary/50 shadow-premium-sm uppercase tracking-wider"
                                        title="Pilih Negeri"
                                    >
                                        {MALAYSIA_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                                    </select>
                                </div>
                                <div className="flex-[2] w-full">
                                    <NeuInput 
                                        label="Nama Cawangan"
                                        value={newBranch} 
                                        onChange={e => setNewBranch(e.target.value)} 
                                        placeholder="Contoh: KSB BALOK" 
                                        className="text-sm py-4" 
                                    />
                                </div>
                                <NeuButton 
                                    onClick={handleAddBranch} 
                                    variant="primary"
                                    className="w-full lg:w-60 h-[58px] uppercase tracking-[0.2em] text-[10px]"
                                >
                                    Daftar Cawangan
                                </NeuButton>
                            </div>
                        </div>
                        
                        <div className="p-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 bg-white">
                            {Object.entries(branchesConfig).map(([state, branches]) => branches.length > 0 && (
                                <div key={state} className="group bg-slate-50/30 border border-premium-border/50 rounded-3xl overflow-hidden hover:shadow-premium-md transition-all duration-300">
                                    <div className="bg-white px-6 py-4 border-b border-premium-border/50 flex justify-between items-center">
                                        <span className="text-[11px] font-black text-premium-primary uppercase tracking-widest">{state}</span>
                                        <NeuBadge variant="stone" className="text-[9px]">{branches.length}</NeuBadge>
                                    </div>
                                    <div className="p-2 space-y-1">
                                        {branches.map(b => (
                                            <div key={b} className="flex justify-between items-center px-4 py-3 rounded-2xl hover:bg-white hover:shadow-premium-sm transition-all group/item border border-transparent hover:border-premium-border/30">
                                                <span className="text-xs font-bold text-slate-600 group-hover/item:text-premium-primary transition-colors">{b}</span>
                                                <button 
                                                    onClick={() => handleDeleteBranch(state, b)} 
                                                    className="text-red-300 hover:text-red-500 p-2 rounded-xl hover:bg-red-50 transition-all opacity-0 group-hover/item:opacity-100" 
                                                    title="Padam Cawangan"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </NeuCard>
                </div>
            )}

            {/* --- Login Sessions Tab --- */}
            {activeSubTab === 'sessions' && (user.role === 'admin' || user.role === 'super_admin') && (
                <div className="space-y-8 animate-fade-in">
                    <div className="flex items-center gap-4">
                        <div className="p-3.5 bg-premium-bg rounded-2xl border border-premium-border shadow-premium-sm">
                            <Lock className="w-8 h-8 text-premium-accent" />
                        </div>
                        <div>
                            <h3 className="text-3xl font-black text-premium-primary uppercase tracking-tight">Sesi Log Masuk Aktif</h3>
                            <p className="text-xs text-premium-muted font-bold mt-1">Kawalan keselamatan peranti tunggal</p>
                        </div>
                    </div>
                    
                    <NeuCard className="overflow-hidden p-0 border border-premium-border/50">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="bg-slate-50/80 border-b border-premium-border/30">
                                        <th className="p-6 text-[10px] font-black text-premium-muted uppercase tracking-[0.2em]">Pengguna</th>
                                        <th className="p-6 text-[10px] font-black text-premium-muted uppercase tracking-[0.2em]">Status Sesi</th>
                                        <th className="p-6 text-[10px] font-black text-premium-muted uppercase tracking-[0.2em]">Aktiviti Terakhir</th>
                                        <th className="p-6 text-[10px] font-black text-premium-muted uppercase tracking-[0.2em] text-right">Kawalan</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-premium-border/20">
                                    {sessions.sort((a, b) => (b.lastSeen?.seconds || 0) - (a.lastSeen?.seconds || 0)).map(session => (
                                        <tr key={session.id} className="hover:bg-slate-50/50 transition-colors">
                                            <td className="p-6">
                                                <p className="font-black text-premium-primary uppercase text-sm leading-none mb-1.5">{session.id}</p>
                                                <p className="text-[10px] font-bold text-premium-muted tracking-tight">Device: {session.deviceId?.slice(0, 12)}...</p>
                                            </td>
                                            <td className="p-6">
                                                <div className="flex items-center gap-2.5">
                                                    <div className={`w-2 h-2 rounded-full ${Date.now() - (session.lastSeen?.seconds * 1000) < 600000 ? 'bg-luxury-gold animate-pulse' : 'bg-stone-300'}`} />
                                                    <span className={`text-[10px] font-black uppercase tracking-widest ${Date.now() - (session.lastSeen?.seconds * 1000) < 600000 ? 'text-luxury-gold' : 'text-stone-400'}`}>
                                                        {Date.now() - (session.lastSeen?.seconds * 1000) < 600000 ? 'DALAM TALIAN' : 'LUAR TALIAN'}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="p-6">
                                                <p className="text-xs font-black text-stone-500">
                                                    {session.lastSeen ? new Date(session.lastSeen.seconds * 1000).toLocaleString('ms-MY', { 
                                                        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' 
                                                    }) : 'N/A'}
                                                </p>
                                            </td>
                                            <td className="p-6 text-right">
                                                <NeuButton 
                                                    onClick={() => {
                                                        if (confirm(`Tamatkan sesi untuk ${session.id}?`)) {
                                                            alert('Fungsi Reset Sesi memerlukan akses Firebase Admin.');
                                                        }
                                                    }}
                                                    variant="danger"
                                                    className="px-5 py-2 text-[9px] uppercase tracking-widest"
                                                >
                                                    Tamatkan Sesi
                                                </NeuButton>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </NeuCard>
                </div>
            )}

            {/* --- Logs Management Tab --- */}
            {activeSubTab === 'logs' && (user.role === 'admin' || user.role === 'super_admin') && (
                <div className="space-y-8 animate-fade-in">
                    <div className="flex items-center gap-4">
                        <div className="p-3.5 bg-stone-100 rounded-2xl border border-premium-border/30 shadow-premium-sm">
                            <Activity className="w-8 h-8 text-premium-accent" />
                        </div>
                        <div>
                            <h3 className="text-3xl font-bold text-premium-primary uppercase tracking-tight font-luxury">Log Audit Induk</h3>
                            <p className="text-xs text-premium-muted font-bold mt-1">Jejak audit menyeluruh sistem</p>
                        </div>
                    </div>

                    <NeuCard className="overflow-hidden p-0 border border-premium-border/50 shadow-premium-md">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="bg-slate-50/80 border-b border-premium-border/30">
                                        <th className="p-6 text-[10px] font-black text-premium-muted uppercase tracking-[0.2em]">Tempoh Cuti</th>
                                        <th className="p-6 text-[10px] font-black text-premium-muted uppercase tracking-[0.2em]">Kakitangan</th>
                                        <th className="p-6 text-[10px] font-black text-premium-muted uppercase tracking-[0.2em] text-center">Jenis / Bil</th>
                                        <th className="p-6 text-[10px] font-black text-premium-muted uppercase tracking-[0.2em]">Sebab</th>
                                        <th className="p-6 text-[10px] font-black text-premium-muted uppercase tracking-[0.2em]">Status</th>
                                        <th className="p-6 text-[10px] font-black text-premium-muted uppercase tracking-[0.2em] text-right">Tindakan</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-premium-border/20">
                                    {logs.slice().sort((a,b) => b.timestamp - a.timestamp).map(log => (
                                        <tr key={log.id} className="hover:bg-slate-50/50 transition-colors">
                                            <td className="p-6">
                                                <p className="text-xs font-black text-premium-primary">{log.startDate}</p>
                                                <p className="text-[10px] text-premium-muted font-bold mt-0.5">hingga {log.endDate}</p>
                                            </td>
                                            <td className="p-6">
                                                <p className="font-black text-premium-primary text-sm uppercase leading-none mb-1.5">{log.staffName}</p>
                                                <div className="flex items-center gap-2">
                                                    <NeuBadge variant="stone" className="text-[8px] py-0 px-1.5">{log.staffId}</NeuBadge>
                                                    {staffList.find(s => s.id === log.staffId)?.branch && (
                                                        <span className="text-[9px] font-bold text-premium-accent uppercase tracking-tighter">
                                                            {staffList.find(s => s.id === log.staffId)?.branch}
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="p-6 text-center">
                                                <div className="inline-flex flex-col items-center">
                                                    <NeuBadge variant={log.type === 'AL' ? 'gold' : 'green'} className="text-[9px] mb-1">{log.type}</NeuBadge>
                                                    <span className="text-xs font-black text-premium-primary tabular-nums">{log.duration} Hari</span>
                                                </div>
                                            </td>
                                            <td className="p-6">
                                                <p className="text-[11px] text-premium-muted font-medium italic leading-relaxed max-w-[180px]">"{log.reason}"</p>
                                            </td>
                                            <td className="p-6">
                                                <NeuBadge variant={log.status === 'approved' ? 'green' : log.status === 'rejected' ? 'red' : 'yellow'} className="text-[9px]">
                                                    {log.status.replace('_', ' ')}
                                                </NeuBadge>
                                            </td>
                                            <td className="p-6 text-right">
                                                <div className="flex justify-end gap-2 text-premium-muted">
                                                    <button onClick={() => handlePrintForm(log)} className="p-2.5 hover:text-luxury-gold hover:bg-stone-50 rounded-xl transition-all" title="Cetak Borang">
                                                        <Printer className="w-4 h-4" />
                                                    </button>
                                                    <button onClick={() => setEditingLog(log)} className="p-2.5 text-slate-400 hover:text-premium-accent hover:bg-premium-bg rounded-xl transition-all" title="Edit Log">
                                                        <Edit3 className="w-4 h-4" />
                                                    </button>
                                                    <button onClick={() => handleDeleteLog(log.id)} className="p-2.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all" title="Padam Log">
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </NeuCard>
                </div>
            )}
            {/* --- HR Reports Tab --- */}
            {activeSubTab === 'reports' && (
                <div className="space-y-8 animate-fade-in">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div className="flex items-center gap-4">
                            <div className="p-3.5 bg-premium-bg rounded-2xl border border-premium-border/30 shadow-premium-sm">
                                <FileText className="w-8 h-8 text-premium-accent" />
                            </div>
                            <div>
                                <h3 className="text-3xl font-bold text-premium-primary uppercase tracking-tight font-luxury">Dokumentasi & Laporan</h3>
                                <p className="text-xs text-premium-muted font-bold mt-1">Arkib rasmi rekod cuti kakitangan</p>
                            </div>
                        </div>
                        <NeuButton
                            onClick={() => window.print()}
                            variant="primary"
                            className="flex items-center gap-3 px-8 py-4 shadow-premium-lg bg-luxury-gold text-white"
                        >
                            <Printer className="w-4 h-4" />
                            Cetak Laporan Rasmi (PDF)
                        </NeuButton>
                    </div>

                    <NeuCard className="print:shadow-none print:border-none p-0 overflow-hidden border border-premium-border/50">
                        {/* Print Header */}
                        <div className="hidden print:block p-10 bg-stone-50 border-b-2 border-stone-100">
                            <div className="flex items-center gap-6 mb-8">
                                <div className="w-20 h-20 bg-luxury-gold rounded-3xl flex items-center justify-center text-white text-3xl font-bold shadow-premium-md font-luxury">KSB</div>
                                <div>
                                    <h1 className="text-3xl font-black text-slate-800">Klinik Syed Badaruddin</h1>
                                    <p className="text-[10px] text-stone-500 font-black uppercase tracking-[0.3em] mt-1">Sistem Pengurusan Cuti Pintar</p>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-12 text-xs">
                                <div className="space-y-2">
                                    <p className="text-slate-400 font-black uppercase tracking-widest text-[9px]">Kategori Laporan</p>
                                    <p className="font-black text-slate-700 text-sm">Semua Rekod Cuti Klasifikasi Rasmi</p>
                                </div>
                                <div className="text-right space-y-2">
                                    <p className="text-slate-400 font-black uppercase tracking-widest text-[9px]">Tarikh Penjanaan</p>
                                    <p className="font-black text-slate-700 text-sm">{new Date().toLocaleDateString('ms-MY', { day: '2-digit', month: 'long', year: 'numeric' })}</p>
                                </div>
                            </div>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="bg-slate-50 border-b border-premium-border/30">
                                        <th className="p-6 text-[10px] font-black text-premium-muted uppercase tracking-[0.15em]">Tempoh</th>
                                        <th className="p-6 text-[10px] font-black text-premium-muted uppercase tracking-[0.15em]">Nama Kakitangan</th>
                                        <th className="p-6 text-[10px] font-black text-premium-muted uppercase tracking-[0.15em] text-center">Kate</th>
                                        <th className="p-6 text-[10px] font-black text-premium-muted uppercase tracking-[0.15em] text-center">Hari</th>
                                        <th className="p-6 text-[10px] font-black text-premium-muted uppercase tracking-[0.15em] pr-10 text-right">Status Akhir</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-premium-border/10">
                                    {logs.slice().sort((a, b) => b.timestamp - a.timestamp).map(log => (
                                        <tr key={log.id} className="border-b border-slate-50/50 print:border-slate-100 hover:bg-slate-50/30 transition-colors">
                                            <td className="p-6">
                                                <p className="text-xs font-black text-slate-700">{log.startDate}</p>
                                                <p className="text-[10px] text-slate-400 font-bold">hingga {log.endDate}</p>
                                            </td>
                                            <td className="p-6">
                                                <p className="font-black text-slate-700 text-sm uppercase">{log.staffName}</p>
                                                <p className="text-[10px] text-slate-400 font-bold tracking-tight">{log.staffId}</p>
                                            </td>
                                            <td className="p-6 text-center">
                                                <NeuBadge variant={log.type === 'AL' ? 'gold' : 'green'} className="text-[9px] font-black">{log.type}</NeuBadge>
                                            </td>
                                            <td className="p-6 text-center font-black text-slate-700 tabular-nums">{log.duration}</td>
                                            <td className="p-6 text-right pr-10">
                                                <NeuBadge variant={log.status === 'approved' ? 'green' : log.status === 'rejected' ? 'red' : 'yellow'} className="text-[9px]">
                                                    {log.status.replace('_', ' ').toUpperCase()}
                                                </NeuBadge>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <div className="hidden print:block mt-16 pt-10 border-t border-slate-100 italic text-[9px] text-slate-400 text-center tracking-widest font-bold">
                            DOKUMEN INI DIJANA SECARA AUTOMATIK OLEH SMART LEAVE TRACKER. TIADA TANDATANGAN DIPERLUKAN.
                        </div>
                    </NeuCard>
                </div>
            )}


            {/* --- Master Audit Tab (Super Admin Only) --- */}
            {activeSubTab === 'audit' && user.role === 'super_admin' && (
                <div className="space-y-8 animate-fade-in">
                    <div className="flex items-center gap-4">
                        <div className="p-3.5 bg-rose-50 rounded-2xl border border-rose-100 shadow-premium-sm">
                            <ShieldAlert className="w-8 h-8 text-rose-600" />
                        </div>
                        <div>
                            <h3 className="text-3xl font-black text-premium-primary uppercase tracking-tight">Kawalan Utama Sistem</h3>
                            <p className="text-xs text-premium-muted font-bold mt-1">Konfigurasi kritikal dan integriti data</p>
                        </div>
                    </div>

                    <NeuCard className="p-10 border-t-4 border-t-rose-500 shadow-premium-lg">
                        <div className="space-y-10">
                            <div className="bg-rose-50/40 p-8 rounded-[2.5rem] border border-rose-100 shadow-inner">
                                <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-8">
                                    <div className="flex items-start gap-5">
                                        <div className="mt-1 p-2 bg-rose-100 rounded-xl text-rose-600">
                                            <AlertCircle className="w-6 h-6" />
                                        </div>
                                        <div>
                                            <h4 className="text-sm font-black text-rose-700 uppercase tracking-widest mb-2">Penetapan Semula Data Aplikasi</h4>
                                            <p className="text-[11px] text-stone-500 font-bold leading-relaxed max-w-xl">
                                                Tindakan ini akan memadamkan <span className="text-rose-600">SEMUA</span> rekod termasuk profil kakitangan, sejarah cuti, dan sesi log masuk. 
                                                Data akan dikembalikan ke keadaan asal (Empty State). Tindakan ini tidak boleh dibatalkan.
                                            </p>
                                        </div>
                                    </div>
                                    
                                    <NeuButton
                                        variant="danger"
                                        onClick={async () => {
                                            const confirmReset = window.confirm(
                                                "⚠️ PERHATIAN: Anda akan memadam SEMUA DATA sistem secara kekal.\n\nAdakah anda benar-benar pasti?"
                                            );
                                            if (confirmReset) {
                                                try {
                                                    const { resetApplicationData } = await import('../services/firebase');
                                                    await resetApplicationData();
                                                    window.location.reload();
                                                } catch (err) {
                                                    alert("Gagal melakukan reset: " + err);
                                                }
                                            }
                                        }}
                                        className="w-full lg:w-fit px-10 py-5 text-[10px] font-black uppercase tracking-[0.25em] bg-red-600 hover:bg-red-700 shadow-red-200/50"
                                    >
                                        Padam Semua Rekod
                                    </NeuButton>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                                <div className="p-6 bg-premium-bg rounded-3xl border border-premium-border/30 text-center hover:shadow-premium-md transition-all">
                                    <p className="text-[9px] font-black text-premium-muted uppercase tracking-widest mb-2">Pengkalan Data</p>
                                    <div className="flex items-center justify-center gap-2">
                                        <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                                        <p className="text-xs font-black text-emerald-600">TERSAMBUNG</p>
                                    </div>
                                </div>
                                <div className="p-6 bg-premium-bg rounded-3xl border border-premium-border/30 text-center hover:shadow-premium-md transition-all">
                                    <p className="text-[9px] font-black text-premium-muted uppercase tracking-widest mb-2">WhatsApp API</p>
                                    <div className="flex items-center justify-center gap-2">
                                        <div className="w-2 h-2 bg-emerald-500 rounded-full" />
                                        <p className="text-xs font-black text-emerald-600">AKTIF (FONNTE)</p>
                                    </div>
                                </div>
                                <div className="p-6 bg-premium-bg rounded-3xl border border-premium-border/30 text-center hover:shadow-premium-md transition-all">
                                    <p className="text-[9px] font-black text-premium-muted uppercase tracking-widest mb-2">Auto-Logout</p>
                                    <p className="text-xs font-black text-premium-primary">AKTIF (10 MINIT)</p>
                                </div>
                                <div className="p-6 bg-premium-bg rounded-3xl border border-premium-border/30 text-center hover:shadow-premium-md transition-all">
                                    <p className="text-[9px] font-black text-premium-muted uppercase tracking-widest mb-2">Sesi Tunggal</p>
                                    <p className="text-xs font-black text-red-600">DIKETATKAN</p>
                                </div>
                            </div>
                        </div>
                    </NeuCard>
                </div>
            )}
                       {/* --- Editing Modal/Overlay --- */}
            {editingStaff && (
                <div className="fixed inset-0 bg-premium-primary/60 backdrop-blur-md flex items-center justify-center z-[100] p-4 p-y-12">
                    <div className="max-w-4xl w-full max-h-[90vh] animate-premium-pop flex flex-col shadow-premium-2xl">
                        <NeuCard className="relative overflow-y-auto flex-1 scroll-smooth custom-scrollbar p-10 rounded-[2.5rem] border-premium-border/50">
                            <button
                                onClick={() => setEditingStaff(null)}
                                className="absolute top-6 right-6 p-3 text-premium-muted/50 hover:text-red-500 hover:bg-red-50 rounded-2xl transition-all z-10"
                                title="Tutup"
                            >
                                <ArrowLeft className="w-6 h-6" />
                            </button>

                            <div className="flex items-center gap-4 mb-10">
                                <div className="p-3 bg-premium-bg rounded-2xl border border-premium-border">
                                    <UserCog className="w-8 h-8 text-premium-accent" />
                                </div>
                                <div>
                                    <h3 className="text-2xl font-black text-premium-primary uppercase tracking-tight">Kemas Kini Profil Kakitangan</h3>
                                    <p className="text-[10px] font-black text-premium-accent uppercase tracking-[0.2em] mt-1 flex items-center gap-2">
                                        <ShieldCheck className="w-3.5 h-3.5" /> Mod Keselamatan: Admin
                                    </p>
                                </div>
                            </div>

                            <form onSubmit={handleUpdateStaff} className="space-y-10">
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                                    <NeuInput
                                        label="Nama Penuh (Seperti Dalam Kad Pengenalan)"
                                        value={editingStaff.name}
                                        onChange={e => setEditingStaff({ ...editingStaff, name: e.target.value })}
                                        placeholder="Staff Name"
                                        className="text-sm font-bold"
                                    />
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black text-premium-muted uppercase tracking-widest ml-1">Kategori Staff</label>
                                        <select
                                            value={editingStaff.staffType || ''}
                                            onChange={e => setEditingStaff({ ...editingStaff, staffType: e.target.value as any })}
                                            className="w-full bg-premium-bg border border-premium-border rounded-xl px-5 py-4 focus:outline-none focus:ring-4 focus:ring-premium-primary/5 transition-all appearance-none cursor-pointer hover:border-premium-primary/50 shadow-premium-sm text-xs font-black text-premium-primary uppercase tracking-wider"
                                            title="Kategori Staff"
                                        >
                                            <option value="">-- Sila Pilih Kategori --</option>
                                            <option value="admin_staff">Staff Admin</option>
                                            <option value="operation_staff">Staff Operasi</option>
                                            <option value="doctor">Doctor</option>
                                        </select>
                                    </div>
                                </div>

                                <div className="bg-premium-bg/50 p-8 rounded-[2.5rem] border border-premium-border/30 shadow-inner">
                                    <div className="flex items-center gap-3 mb-6 ml-1">
                                        <PieChart className="w-4 h-4 text-stone-500" />
                                        <h4 className="text-[11px] font-black text-premium-primary uppercase tracking-[0.2em]">Penyelarasan Baki Cuti Induk</h4>
                                    </div>
                                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                                        <NeuInput label="Annual (AL)" type="number" value={editingStaff.balanceAL} onChange={e => setEditingStaff({ ...editingStaff, balanceAL: parseInt(e.target.value) || 0 })} />
                                        <NeuInput label="Medical (MC)" type="number" value={editingStaff.balanceMC} onChange={e => setEditingStaff({ ...editingStaff, balanceMC: parseInt(e.target.value) || 0 })} />
                                        <NeuInput label="Hosp (HL)" type="number" value={editingStaff.balanceHL || 0} onChange={e => setEditingStaff({ ...editingStaff, balanceHL: parseInt(e.target.value) || 0 })} />
                                        <NeuInput label="Ganti (RL)" type="number" value={editingStaff.balanceRL || 0} onChange={e => setEditingStaff({ ...editingStaff, balanceRL: parseInt(e.target.value) || 0 })} />
                                        <NeuInput label="Annual-CF" type="number" value={editingStaff.prevYearBalance || 0} onChange={e => setEditingStaff({ ...editingStaff, prevYearBalance: parseInt(e.target.value) || 0 })} className="bg-stone-100" />
                                        <NeuInput label="Bersalin (ML)" type="number" value={editingStaff.balanceML || 0} onChange={e => setEditingStaff({ ...editingStaff, balanceML: parseInt(e.target.value) || 0 })} />
                                        <NeuInput label="Isteri (PL)" type="number" value={editingStaff.balancePL || 0} onChange={e => setEditingStaff({ ...editingStaff, balancePL: parseInt(e.target.value) || 0 })} />
                                        <NeuInput label="Kecemasan (EL)" type="number" value={editingStaff.balanceEL || 0} onChange={e => setEditingStaff({ ...editingStaff, balanceEL: parseInt(e.target.value) || 0 })} />
                                        <NeuInput label="Ihsan (BL)" type="number" value={editingStaff.balanceBL || 0} onChange={e => setEditingStaff({ ...editingStaff, balanceBL: parseInt(e.target.value) || 0 })} />
                                        <NeuInput label="Unpaid (UL)" type="number" value={editingStaff.balanceUL || 0} onChange={e => setEditingStaff({ ...editingStaff, balanceUL: parseInt(e.target.value) || 0 })} />
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                                    <div className="space-y-2">
                                        <div className="flex justify-between items-center ml-1">
                                            <label className="text-[10px] font-black text-premium-muted uppercase tracking-widest">Tarikh Mula Khidmat</label>
                                            {editingStaff.joinDate && (
                                                <span className="text-[9px] font-bold text-luxury-gold uppercase bg-stone-100 px-2.5 py-1 rounded-full border border-luxury-gold/20 font-luxury">
                                                    {calculateTenure(editingStaff.joinDate)} Tahun
                                                </span>
                                            )}
                                        </div>
                                        <NeuInput
                                            type="date"
                                            value={editingStaff.joinDate || ''}
                                            onChange={e => setEditingStaff({ ...editingStaff, joinDate: e.target.value })}
                                            className="text-xs font-bold"
                                        />
                                    </div>

                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black text-premium-muted uppercase tracking-widest ml-1">Penempatan Cawangan</label>
                                        <select
                                            value={editingStaff.branch || ''}
                                            onChange={e => setEditingStaff({ ...editingStaff, branch: e.target.value })}
                                            className="w-full bg-premium-bg border border-premium-border rounded-xl px-5 py-4 focus:outline-none focus:ring-4 focus:ring-premium-primary/5 transition-all appearance-none cursor-pointer hover:border-premium-primary/50 shadow-premium-sm text-xs font-black text-premium-primary uppercase tracking-wider"
                                            title="Assigned Branch"
                                        >
                                            <option value="">-- Tiada Cawangan --</option>
                                            {Object.entries(branchesConfig).map(([site, branches]) => (
                                                <optgroup key={site} label={site}>
                                                    {branches.map(b => (
                                                        <option key={b} value={b}>{b}</option>
                                                    ))}
                                                </optgroup>
                                            ))}
                                        </select>
                                    </div>

                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black text-premium-muted uppercase tracking-widest ml-1">Peranan Sistem</label>
                                        <select
                                            value={editingStaff.role}
                                            onChange={e => setEditingStaff({ ...editingStaff, role: e.target.value as any })}
                                            className="w-full bg-premium-bg border border-premium-border rounded-xl px-5 py-4 focus:outline-none focus:ring-4 focus:ring-premium-primary/5 transition-all appearance-none cursor-pointer hover:border-premium-primary/50 shadow-premium-sm text-xs font-black text-premium-primary uppercase tracking-wider"
                                            title="System Role"
                                        >
                                            <option value="staff">Staff Biasa</option>
                                            <option value="hod">Ketua Jabatan (HOD)</option>
                                            <option value="gm">Pengurus Besar (GM)</option>
                                            <option value="admin">Administrator</option>
                                            <option value="super_admin">Super Admin</option>
                                        </select>
                                    </div>
                                </div>

                                <NeuButton
                                    type="submit"
                                    variant="primary"
                                    className="w-full py-5 flex items-center justify-center gap-3 mt-4 text-[11px] uppercase tracking-[0.3em] font-black shadow-premium-lg bg-luxury-gold text-white"
                                    disabled={isUpdating}
                                >
                                    {isUpdating ? <Activity className="w-5 h-5 animate-spin" /> : <><Save className="w-5 h-5" /> Komit Perubahan Rekod</>}
                                </NeuButton>
                            </form>
                        </NeuCard>
                    </div>
                </div>
            )}

            {/* --- Log Editing Modal --- */}
            {editingLog && (
                <div className="fixed inset-0 bg-premium-primary/60 backdrop-blur-md flex items-center justify-center z-[100] p-4">
                    <div className="max-w-xl w-full animate-premium-pop shadow-premium-2xl">
                        <NeuCard className="relative p-10 rounded-[2.5rem] border-premium-border/50">
                            <button
                                onClick={() => setEditingLog(null)}
                                className="absolute top-6 right-6 p-3 text-premium-muted/50 hover:text-red-500 hover:bg-red-50 rounded-2xl transition-all"
                                title="Tutup"
                            >
                                <ArrowLeft className="w-6 h-6" />
                            </button>

                            <div className="flex items-center gap-4 mb-10">
                                <div className="p-3 bg-stone-100 rounded-2xl border border-premium-border/30">
                                    <Activity className="w-8 h-8 text-premium-accent" />
                                </div>
                                <div>
                                    <h3 className="text-2xl font-bold text-premium-primary uppercase tracking-tight font-luxury">Penyelarasan Rekod Cuti</h3>
                                    <p className="text-[10px] font-black text-premium-accent uppercase tracking-[0.2em] mt-1 flex items-center gap-2">
                                        <ShieldCheck className="w-3.5 h-3.5" /> Mod Audit Sistem
                                    </p>
                                </div>
                            </div>

                            <form onSubmit={handleUpdateLog} className="space-y-8">
                                <div className="bg-slate-50/50 p-6 rounded-2xl border border-premium-border/20">
                                    <label className="text-[10px] font-black text-premium-muted uppercase tracking-widest ml-1 mb-2 block">Kakitangan Terlibat</label>
                                    <p className="px-5 py-4 bg-white rounded-xl font-black text-premium-primary text-sm uppercase shadow-inner border border-premium-border/30">{editingLog.staffName}</p>
                                </div>

                                <div className="grid grid-cols-2 gap-6">
                                    <NeuInput
                                        label="Tarikh Mula"
                                        type="date"
                                        value={editingLog.startDate}
                                        onChange={e => setEditingLog({ ...editingLog, startDate: e.target.value })}
                                        className="text-xs font-bold"
                                    />
                                    <NeuInput
                                        label="Tarikh Akhir"
                                        type="date"
                                        value={editingLog.endDate}
                                        onChange={e => setEditingLog({ ...editingLog, endDate: e.target.value })}
                                        className="text-xs font-bold"
                                    />
                                </div>

                                <NeuTextArea
                                    label="Justifikasi / Catatan Cuti"
                                    value={editingLog.reason}
                                    onChange={e => setEditingLog({ ...editingLog, reason: e.target.value })}
                                    className="text-xs font-medium min-h-[100px]"
                                />

                                <div className="grid grid-cols-2 gap-6">
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black text-premium-muted uppercase tracking-widest ml-1">Kategori Cuti</label>
                                        <select
                                            value={editingLog.type}
                                            onChange={e => setEditingLog({ ...editingLog, type: e.target.value as any })}
                                            className="w-full bg-premium-bg border border-premium-border rounded-xl px-5 py-4 focus:outline-none focus:ring-4 focus:ring-premium-primary/5 transition-all appearance-none cursor-pointer hover:border-premium-primary/50 shadow-premium-sm text-xs font-black text-premium-primary uppercase tracking-wider"
                                            title="Kategori"
                                        >
                                            <option value="AL">Tahunan (AL)</option>
                                            <option value="MC">Sakit (MC)</option>
                                            <option value="HL">Hosp (HL)</option>
                                            <option value="RL">Ganti (RL)</option>
                                            <option value="ML">Bersalin (ML)</option>
                                            <option value="PL">Isteri (PL)</option>
                                            <option value="EL">Kecemasan (EL)</option>
                                            <option value="BL">Ihsan (BL)</option>
                                            <option value="UL">Tanpa Gaji (UL)</option>
                                        </select>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black text-premium-muted uppercase tracking-widest ml-1">Status Cuti</label>
                                        <select
                                            value={editingLog.status}
                                            onChange={e => setEditingLog({ ...editingLog, status: e.target.value as any })}
                                            className="w-full bg-slate-50 border border-premium-border rounded-xl px-5 py-4 focus:outline-none focus:ring-4 focus:ring-premium-primary/5 transition-all appearance-none cursor-pointer hover:border-premium-primary/50 shadow-premium-sm text-xs font-black text-premium-primary uppercase tracking-wider"
                                            title="Status"
                                        >
                                            <option value="pending">Menunggu (Pending)</option>
                                            <option value="hod_approved">Disokong (HOD)</option>
                                            <option value="approved">Diluluskan (Approved)</option>
                                            <option value="rejected">Ditolak (Rejected)</option>
                                        </select>
                                    </div>
                                </div>

                                <NeuButton
                                    type="submit"
                                    variant="primary"
                                    className="w-full py-5 flex items-center justify-center gap-3 mt-4 text-[11px] uppercase tracking-[0.3em] font-black shadow-premium-lg bg-luxury-gold text-white"
                                    disabled={isUpdating}
                                >
                                    {isUpdating ? <Activity className="w-5 h-5 animate-spin" /> : <><Save className="w-5 h-5" /> Simpan Arkib</>}
                                </NeuButton>
                            </form>
                        </NeuCard>
                    </div>
                </div>
            )}

            {/* --- Specialized Printing View (Borang Permohonan Cuti) --- */}
            {printingLog && (
                <div className="hidden print:block fixed inset-0 bg-white z-[9999] p-10 overflow-auto">
                    {/* Header Section */}
                    <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-4">
                            <img src="/logo.jpg" alt="KSB Logo" className="w-20 h-20 rounded-full" />
                            <div>
                                <h1 className="text-3xl font-black text-red-800 tracking-tighter uppercase">Klinik</h1>
                                <h1 className="text-3xl font-black text-red-800 tracking-tighter uppercase -mt-2">Syed Badaruddin</h1>
                                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mt-1">- SERVICING COMMUNITY SINCE 1991 -</p>
                            </div>
                        </div>
                    </div>

                    <div className="text-center bg-gray-200 py-1 font-black text-sm uppercase tracking-widest mb-4 border border-black/20">
                        Borang Permohonan Cuti
                    </div>

                    {/* Category Selection Grid */}
                    <div className="grid grid-cols-5 gap-2 mb-6 text-[10px] font-black uppercase">
                        <div className="flex items-center gap-2">
                            <div className="w-5 h-5 border-2 border-black flex items-center justify-center">
                                {printingLog.type === 'AL' && <div className="w-3 h-3 bg-black"></div>}
                            </div>
                            Cuti Tahunan
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-5 h-5 border-2 border-black flex items-center justify-center">
                                {printingLog.type === 'CME' && <div className="w-3 h-3 bg-black"></div>}
                            </div>
                            Cuti CME
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-5 h-5 border-2 border-black flex items-center justify-center">
                                {(printingLog.type === 'HL' || printingLog.type === 'RL' || printingLog.type === 'PL' || printingLog.type === 'ML') && <div className="w-3 h-3 bg-black"></div>}
                            </div>
                            Cuti Berbayar
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-5 h-5 border-2 border-black flex items-center justify-center">
                                {printingLog.type === 'BL' && <div className="w-3 h-3 bg-black"></div>}
                            </div>
                            Cuti Ehsan
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-5 h-5 border-2 border-black flex items-center justify-center">
                                {printingLog.type === 'UL' && <div className="w-3 h-3 bg-black"></div>}
                            </div>
                            Tanpa Gaji
                        </div>
                    </div>

                    {/* Details Table */}
                    <div className="space-y-4 text-xs font-black">
                        <div className="grid grid-cols-[180px_1fr] items-center gap-2">
                            <span className="uppercase tracking-tight">Tarikh Memohon Cuti</span>
                            <div className="border border-red-800 p-2 min-h-[32px]">{new Date(printingLog.timestamp).toLocaleDateString('en-GB')}</div>
                        </div>
                        <div className="grid grid-cols-[180px_1fr] items-center gap-2">
                            <span className="uppercase tracking-tight">Nama Pemohon</span>
                            <div className="border border-red-800 p-2 min-h-[32px]">{printingLog.staffName}</div>
                        </div>
                        <div className="grid grid-cols-[180px_1fr] items-center gap-2">
                            <span className="uppercase tracking-tight">No. K/P</span>
                            <div className="border border-red-800 p-2 min-h-[32px]">{printingLog.staffId}</div>
                        </div>
                        <div className="grid grid-cols-[180px_1fr] items-center gap-2">
                            <span className="uppercase tracking-tight">Tarikh Mula Bekerja</span>
                            <div className="border border-red-800 p-2 min-h-[32px]">
                                {staffList.find(s => s.id === printingLog.staffId)?.joinDate || '-'}
                            </div>
                        </div>
                        <div className="grid grid-cols-[180px_1fr] items-center gap-2">
                            <span className="uppercase tracking-tight">Kelayakan Cuti Tahunan</span>
                            <div className="border border-red-800 p-2 min-h-[32px]">
                                {staffList.find(s => s.id === printingLog.staffId)?.entitlementAL || '-'} Hari
                            </div>
                        </div>
                        <div className="grid grid-cols-[180px_1fr] items-center gap-2">
                            <span className="uppercase tracking-tight">Baki Cuti Terdahulu</span>
                            <div className="border border-red-800 p-2 min-h-[32px]">
                                {(staffList.find(s => s.id === printingLog.staffId)?.balanceAL || 0) + printingLog.duration} Hari
                            </div>
                        </div>

                        <div className="grid grid-cols-[180px_1fr] gap-2 items-start">
                            <div className="flex flex-col">
                                <span className="uppercase tracking-tight leading-none mb-1">Jumlah Cuti</span>
                                <span className="uppercase tracking-tight leading-none">Dipohon</span>
                            </div>
                            <div className="flex gap-2 h-full">
                                <div className="border border-red-800 p-2 w-24 h-12 flex items-center justify-center">{printingLog.duration} Hari</div>
                                <div className="flex flex-col flex-1 gap-1">
                                    <div className="flex items-center gap-2">
                                        <span className="text-[9px] uppercase">Tarikh:</span>
                                        <div className="border border-red-800 flex-1 p-2 min-h-[32px]">{printingLog.startDate} to {printingLog.endDate}</div>
                                    </div>
                                    <div className="border-b border-black w-full mt-2 h-[1px]"></div>
                                    <div className="border-b border-black w-full mt-2 h-[1px]"></div>
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-[180px_1fr] items-center gap-2 pt-2">
                            <span className="uppercase tracking-tight">Baki Cuti</span>
                            <div className="border border-red-800 p-2 min-h-[32px]">
                                {staffList.find(s => s.id === printingLog.staffId)?.balanceAL || 0} Hari
                            </div>
                        </div>

                        <div className="grid grid-cols-[180px_1fr] items-center gap-2">
                            <div className="flex flex-col">
                                <span className="uppercase tracking-tight leading-none mb-1">Tugasan Diganti</span>
                                <span className="uppercase tracking-tight leading-none">Oleh</span>
                            </div>
                            <div className="border border-black p-2 min-h-[32px]">{printingLog.dutyHandover || '-'}</div>
                        </div>

                        {/* Reason Box */}
                        <div className="grid grid-cols-[120px_1fr] border border-red-800 mt-6 min-h-[80px]">
                            <div className="bg-white border-r border-red-800 p-4 flex items-center justify-center text-center">
                                <span className="uppercase tracking-tighter text-[10px]">Sebab Cuti:</span>
                            </div>
                            <div className="p-4 text-sm font-bold">
                                {printingLog.reason}
                            </div>
                        </div>

                        {/* Signature Grid */}
                        <div className="grid grid-cols-3 border border-black mt-8 text-center text-[10px] font-black uppercase">
                            <div className="border-r border-black flex flex-col min-h-[100px]">
                                <div className="bg-gray-200 border-b border-black py-1">T/Tangan Pemohon</div>
                                <div className="flex-1"></div>
                            </div>
                            <div className="border-r border-black flex flex-col min-h-[100px]">
                                <div className="bg-gray-200 border-b border-black py-1">Disokong</div>
                                <div className="flex-1 flex flex-col items-center justify-center">
                                    {printingLog.hodApprovedBy && <p className="text-gray-400 italic font-medium">Digitally Signed By HOD</p>}
                                </div>
                            </div>
                            <div className="flex flex-col min-h-[100px]">
                                <div className="bg-gray-200 border-b border-black py-1">Diluluskan/Tidak Lulus</div>
                                <div className="flex-1 flex flex-col items-center justify-center">
                                    {printingLog.status === 'approved' && <p className="text-gray-400 italic font-medium">Digitally Signed By GM</p>}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
