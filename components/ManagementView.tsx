import React, { useState } from 'react';
import {
    CheckCircle, XCircle, Trash2, Edit3, User, Calendar, Clock,
    Search, Shield, Activity, Save, ArrowLeft, Printer, Download, FileText
} from 'lucide-react';
import { NeuCard, NeuButton, NeuInput, NeuBadge, NeuTextArea } from './NeuElements';
import { Staff, LeaveLog, BRANCHES, BRANCH_GROUPS } from '../types';
import { approveLeave, rejectLeave, updateStaffData, deleteLeaveLog, updateLeaveLog, deleteStaff } from '../services/firebase';

interface ManagementViewProps {
    user: Staff;
    staffList: Staff[];
    logs: LeaveLog[];
    sessions: any[];
}

export const ManagementView: React.FC<ManagementViewProps> = ({ user, staffList, logs, sessions }) => {
    const [activeSubTab, setActiveSubTab] = useState<'approvals' | 'staff' | 'logs' | 'reports' | 'sessions'>(
        user.role === 'hr' ? 'reports' : (user.role === 'admin' || user.role === 'super_admin') ? 'staff' : 'approvals'
    );
    const [searchTerm, setSearchTerm] = useState('');
    const [editingStaff, setEditingStaff] = useState<Staff | null>(null);
    const [editingLog, setEditingLog] = useState<LeaveLog | null>(null);
    const [printingLog, setPrintingLog] = useState<LeaveLog | null>(null);
    const [isUpdating, setIsUpdating] = useState(false);
    const [showInactive, setShowInactive] = useState(false);

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
                balanceML: editingStaff.balanceML,
                role: editingStaff.role,
                branch: editingStaff.branch,
                name: editingStaff.name,
                joinDate: editingStaff.joinDate
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
            <div className="flex gap-4 p-2 bg-neu-base rounded-2xl shadow-neu-pressed max-w-fit overflow-x-auto">
                {(user.role === 'hod' || user.role === 'gm' || user.role === 'admin' || user.role === 'super_admin') && (
                    <NeuButton
                        onClick={() => setActiveSubTab('approvals')}
                        active={activeSubTab === 'approvals'}
                        className="px-6 py-2 text-xs"
                    >
                        Pending Approvals ({pendingLogs.length})
                    </NeuButton>
                )}
                {(user.role === 'admin' || user.role === 'super_admin' || user.role === 'hr') && (
                    <NeuButton
                        onClick={() => setActiveSubTab('staff')}
                        active={activeSubTab === 'staff'}
                        className="px-6 py-2 text-xs"
                    >
                        Staff Management
                    </NeuButton>
                )}
                {(user.role === 'admin' || user.role === 'super_admin') && (
                    <>
                        <NeuButton
                            onClick={() => setActiveSubTab('logs')}
                            active={activeSubTab === 'logs'}
                            className="px-6 py-2 text-xs"
                        >
                            Master Audit
                        </NeuButton>
                        <NeuButton
                            onClick={() => setActiveSubTab('sessions')}
                            active={activeSubTab === 'sessions'}
                            className="px-6 py-2 text-xs flex items-center gap-2"
                        >
                            <Shield className="w-3 h-3" />
                            Login Audit
                        </NeuButton>
                    </>
                )}
                {(user.role === 'admin' || user.role === 'super_admin' || user.role === 'hr') && (
                    <NeuButton
                        onClick={() => setActiveSubTab('reports')}
                        active={activeSubTab === 'reports'}
                        className="px-6 py-2 text-xs flex items-center gap-2"
                    >
                        <FileText className="w-3 h-3" />
                        HR Reports
                    </NeuButton>
                )}
            </div>

            {/* --- Approvals Tab --- */}
            {activeSubTab === 'approvals' && (
                <div className="space-y-6">
                    <div className="flex items-center gap-3 mb-2">
                        <Clock className="w-5 h-5 text-yellow-500" />
                        <h3 className="text-xl font-bold text-gray-700">Awaiting Authorization</h3>
                    </div>

                    {pendingLogs.length === 0 ? (
                        <NeuCard className="text-center py-16">
                            <CheckCircle className="w-12 h-12 text-green-300 mx-auto mb-4" />
                            <p className="text-gray-400 font-bold uppercase tracking-widest text-sm">Clear Queue: All caught up!</p>
                        </NeuCard>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {pendingLogs.map(log => (
                                <NeuCard key={log.id} className="relative overflow-hidden group">
                                    <div className="flex justify-between items-start mb-4">
                                        <div>
                                            <h4 className="font-black text-gray-700 text-lg">{log.staffName}</h4>
                                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{log.staffId}</p>
                                            {staffList.find(s => s.id === log.staffId)?.branch && (
                                                <p className="text-[9px] font-bold text-blue-400 uppercase tracking-widest mt-1">
                                                    {staffList.find(s => s.id === log.staffId)?.branch}
                                                </p>
                                            )}
                                        </div>
                                        <NeuBadge variant={log.type === 'AL' ? 'blue' : 'green'}>{log.type}</NeuBadge>
                                    </div>

                                    <div className="flex items-center gap-4 mb-6">
                                        <div className="flex-1 p-3 bg-neu-base rounded-xl shadow-neu-pressed text-center">
                                            <span className="block text-xl font-black text-gray-700">{log.duration}</span>
                                            <span className="text-[9px] font-bold text-gray-400 uppercase">Days</span>
                                        </div>
                                        <div className="flex-2 p-3 bg-neu-base rounded-xl shadow-neu-pressed text-center">
                                            <span className="block text-[10px] font-black text-gray-700">{log.startDate} to {log.endDate}</span>
                                            <span className="text-[9px] font-bold text-gray-400 uppercase">Period</span>
                                        </div>
                                    </div>

                                    <div className="mb-6 p-4 bg-gray-50/50 rounded-xl border border-gray-100 italic text-sm text-gray-600">
                                        "{log.reason}"
                                    </div>

                                    <div className="flex gap-3 mb-4">
                                        <NeuButton onClick={() => handlePrintForm(log)} className="flex-1 py-3 text-purple-600 hover:bg-purple-50/50 flex items-center justify-center gap-2">
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
                                            <p className="text-[10px] font-bold text-blue-500 uppercase tracking-widest flex items-center gap-1">
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
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                            <img src="/logo.jpg" alt="Logo" className="w-8 h-8 rounded-full border border-gray-200" />
                            <h3 className="text-xl font-bold text-gray-700">Staff Census</h3>
                        </div>
                        <div className="flex items-center gap-4">
                            <label className="flex items-center gap-2 cursor-pointer select-none">
                                <div className={`w-10 h-6 rounded-full p-1 transition-colors duration-300 ${showInactive ? 'bg-blue-500' : 'bg-gray-300'}`}>
                                    <div className={`w-4 h-4 rounded-full bg-white shadow-sm transform transition-transform duration-300 ${showInactive ? 'translate-x-full' : ''}`}></div>
                                </div>
                                <input type="checkbox" className="hidden" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
                                <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Show Inactive</span>
                            </label>
                            <div className="w-full md:w-60">
                                <NeuInput
                                    placeholder="Search Staff..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                            </div>
                        </div>
                    </div>

                    <NeuCard className="overflow-x-auto p-0">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="border-b border-gray-200">
                                    <th className="p-6 text-[10px] font-black text-gray-400 uppercase tracking-widest">Employee</th>
                                    <th className="p-6 text-[10px] font-black text-gray-400 uppercase tracking-widest">Status</th>
                                    <th className="p-6 text-[10px] font-black text-gray-400 uppercase tracking-widest">Role</th>
                                    <th className="p-6 text-[10px] font-black text-gray-400 uppercase tracking-widest">Branch</th>
                                    <th className="p-6 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">AL Bal</th>
                                    <th className="p-6 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">ML Bal</th>
                                    <th className="p-6 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {staffList.filter(s =>
                                    (showInactive || s.active !== false) &&
                                    (s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                                        s.ic.includes(searchTerm) ||
                                        (s.branch && s.branch.toLowerCase().includes(searchTerm.toLowerCase())))
                                ).map(s => (
                                    <tr key={s.id} className="hover:bg-gray-50/50 transition-colors">
                                        <td className="p-6">
                                            <p className={s.active !== false ? "font-bold text-gray-700" : "font-bold text-gray-400"}>{s.name}</p>
                                            <p className="text-[10px] text-gray-400 font-bold">{s.ic}</p>
                                        </td>
                                        <td className="p-6">
                                            <button
                                                onClick={() => {
                                                    if (confirm(`Change status of ${s.name} to ${s.active !== false ? 'Inactive' : 'Active'}?`)) {
                                                        updateStaffData(s.id, { active: s.active === false });
                                                    }
                                                }}
                                                className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest transition-all ${s.active !== false
                                                    ? "bg-green-100 text-green-600 border border-green-200 hover:bg-green-200"
                                                    : "bg-gray-100 text-gray-500 border border-gray-200 hover:bg-gray-200"
                                                    }`}
                                            >
                                                {s.active !== false ? "Active" : "Inactive"}
                                            </button>
                                        </td>
                                        <td className="p-6">
                                            <NeuBadge variant={s.role === 'super_admin' ? 'purple' : s.role === 'admin' ? 'purple' : s.role === 'gm' ? 'blue' : 'yellow'}>
                                                {s.role || 'Staff'}
                                            </NeuBadge>
                                        </td>
                                        <td className="p-6">
                                            <p className="text-[10px] font-bold text-gray-500 max-w-[150px] truncate" title={s.branch || ''}>{s.branch || '-'}</p>
                                        </td>
                                        <td className="p-6 text-center font-bold text-blue-500">{s.balanceAL}</td>
                                        <td className="p-6 text-center font-bold text-green-500">{s.balanceML}</td>
                                        <td className="p-6 text-right flex justify-end gap-2">
                                            <NeuButton onClick={() => setEditingStaff(s)} className="p-2 text-blue-500">
                                                <Edit3 className="w-4 h-4" />
                                            </NeuButton>
                                            <NeuButton onClick={() => handleDeleteStaff(s.id)} className="p-2 text-red-500 hover:bg-red-50" title="Delete Staff">
                                                <Trash2 className="w-4 h-4" />
                                            </NeuButton>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </NeuCard>
                </div>
            )}

            {/* --- Logs Management Tab --- */}
            {activeSubTab === 'logs' && (user.role === 'admin' || user.role === 'super_admin') && (
                <div className="space-y-6">
                    <div className="flex items-center gap-3 mb-2">
                        <Activity className="w-5 h-5 text-purple-500" />
                        <h3 className="text-xl font-bold text-gray-700">Master Audit Logs</h3>
                    </div>

                    <NeuCard className="overflow-x-auto p-0">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="border-b border-gray-200">
                                    <th className="p-6 text-[10px] font-black text-gray-400 uppercase tracking-widest">Period</th>
                                    <th className="p-6 text-[10px] font-black text-gray-400 uppercase tracking-widest">Employee</th>
                                    <th className="p-6 text-[10px] font-black text-gray-400 uppercase tracking-widest">Leave</th>
                                    <th className="p-6 text-[10px] font-black text-gray-400 uppercase tracking-widest">Reason</th>
                                    <th className="p-6 text-[10px] font-black text-gray-400 uppercase tracking-widest">Status</th>
                                    <th className="p-6 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {logs.map(log => (
                                    <tr key={log.id} className="hover:bg-gray-50/50 transition-colors border-b border-gray-100/50">
                                        <td className="p-6">
                                            <p className="text-xs font-black text-gray-700">{log.startDate}</p>
                                            <p className="text-[10px] text-gray-400 font-bold">to {log.endDate}</p>
                                        </td>
                                        <td className="p-6">
                                            <p className="font-bold text-gray-700 text-sm">{log.staffName}</p>
                                            {staffList.find(s => s.id === log.staffId)?.branch && (
                                                <p className="text-[9px] font-bold text-blue-400 uppercase tracking-tight mt-1">
                                                    {staffList.find(s => s.id === log.staffId)?.branch}
                                                </p>
                                            )}
                                        </td>
                                        <td className="p-6">
                                            <div className="flex items-center gap-2">
                                                <span className="font-black text-gray-700">{log.duration}d</span>
                                                <NeuBadge variant={log.type === 'AL' ? 'blue' : 'green'}>{log.type}</NeuBadge>
                                            </div>
                                        </td>
                                        <td className="p-6">
                                            <p className="text-[10px] text-gray-500 italic truncate max-w-[150px]">{log.reason}</p>
                                        </td>
                                        <td className="p-6">
                                            <NeuBadge variant={log.status === 'approved' ? 'green' : log.status === 'rejected' ? 'red' : 'yellow'}>
                                                {log.status.replace('_', ' ')}
                                            </NeuBadge>
                                        </td>
                                        <td className="p-6 text-right flex justify-end gap-2">
                                            <button onClick={() => handlePrintForm(log)} className="p-2 text-purple-300 hover:text-purple-500 transition-colors" title="Print Official Form" aria-label="Print Official Form">
                                                <Printer className="w-4 h-4" />
                                            </button>
                                            <button onClick={() => setEditingLog(log)} className="p-2 text-blue-300 hover:text-blue-500 transition-colors" title="Edit Log" aria-label="Edit Log">
                                                <Edit3 className="w-4 h-4" />
                                            </button>
                                            <button onClick={() => handleDeleteLog(log.id)} className="p-2 text-red-300 hover:text-red-500 transition-colors" title="Delete Log" aria-label="Delete Log">
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </NeuCard>
                </div>
            )}
            {/* --- HR Reports Tab --- */}
            {activeSubTab === 'reports' && (
                <div className="space-y-6 animate-fade-in">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                            <FileText className="w-5 h-5 text-purple-500" />
                            <h3 className="text-xl font-bold text-gray-700">Official Leave Reports</h3>
                        </div>
                        <NeuButton
                            onClick={() => window.print()}
                            variant="primary"
                            className="flex items-center gap-2 whitespace-nowrap"
                        >
                            <Printer className="w-4 h-4" />
                            Generate PDF Record
                        </NeuButton>
                    </div>

                    <NeuCard className="print:shadow-none print:border-none">
                        <div className="hidden print:block mb-8">
                            <div className="flex items-center gap-4 border-b-2 border-gray-100 pb-6 mb-6">
                                <img src="/logo.jpg" alt="Logo" className="w-16 h-16 rounded-full" />
                                <div>
                                    <h1 className="text-2xl font-black text-gray-800">Klinik Syed Badaruddin</h1>
                                    <p className="text-sm text-gray-400 font-bold uppercase tracking-widest">Official HR Leave Ledger</p>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-8 text-sm mb-8">
                                <div>
                                    <p className="text-gray-400 font-bold uppercase text-[10px]">Report Category</p>
                                    <p className="font-bold text-gray-700">All Classified Leave Records</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-gray-400 font-bold uppercase text-[10px]">Generation Date</p>
                                    <p className="font-bold text-gray-700">{new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}</p>
                                </div>
                            </div>
                        </div>

                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="border-b border-gray-200">
                                    <th className="p-6 text-[10px] font-black text-gray-400 uppercase tracking-widest">Period</th>
                                    <th className="p-6 text-[10px] font-black text-gray-400 uppercase tracking-widest">Employee</th>
                                    <th className="p-6 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">Type</th>
                                    <th className="p-6 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">Reason</th>
                                    <th className="p-6 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">Days</th>
                                    <th className="p-6 text-[10px] font-black text-gray-400 uppercase tracking-widest pr-10 text-right">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {logs.sort((a, b) => b.timestamp - a.timestamp).map(log => (
                                    <tr key={log.id} className="border-b border-gray-50/50 print:border-gray-100">
                                        <td className="p-6">
                                            <p className="text-xs font-black text-gray-700">{log.startDate}</p>
                                            <p className="text-[10px] text-gray-400 font-bold">to {log.endDate}</p>
                                        </td>
                                        <td className="p-6">
                                            <p className="font-bold text-gray-700 text-sm">{log.staffName}</p>
                                            <p className="text-[10px] text-gray-400 font-bold">{log.staffId}</p>
                                            {staffList.find(s => s.id === log.staffId)?.branch && (
                                                <p className="text-[9px] font-bold text-blue-400 uppercase tracking-tight mt-0.5">
                                                    {staffList.find(s => s.id === log.staffId)?.branch}
                                                </p>
                                            )}
                                        </td>
                                        <td className="p-6 text-center">
                                            <span className={`text-[10px] font-black px-2 py-1 rounded-md ${log.type === 'AL' ? 'bg-blue-50 text-blue-500' : 'bg-green-50 text-green-500'}`}>
                                                {log.type}
                                            </span>
                                        </td>
                                        <td className="p-6 text-center">
                                            <p className="text-[10px] text-gray-500 italic max-w-[200px] mx-auto">{log.reason}</p>
                                        </td>
                                        <td className="p-6 text-center font-black text-gray-700">{log.duration}</td>
                                        <td className="p-6 text-right pr-10">
                                            <NeuBadge variant={log.status === 'approved' ? 'green' : log.status === 'rejected' ? 'red' : 'yellow'}>
                                                {log.status.replace('_', ' ')}
                                            </NeuBadge>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>

                        <div className="hidden print:block mt-12 pt-12 border-t border-gray-100 italic text-[10px] text-gray-400 text-center">
                            This is a computer-generated document from the Smart Leave Tracker. No signature required.
                        </div>
                    </NeuCard>
                </div>
            )}


            {/* --- Login Sessions Tab --- */}
            {activeSubTab === 'sessions' && (user.role === 'admin' || user.role === 'super_admin') && (
                <div className="space-y-6 animate-fade-in">
                    <div className="flex items-center gap-3 mb-2">
                        <Shield className="w-5 h-5 text-gray-500" />
                        <h3 className="text-xl font-bold text-gray-700">System Access Log</h3>
                    </div>

                    <NeuCard className="overflow-hidden p-0">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="border-b border-gray-200 bg-gray-50/50">
                                    <th className="p-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Timestamp</th>
                                    <th className="p-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">User</th>
                                    <th className="p-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">User ID</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {sessions.map(session => (
                                    <tr key={session.id} className="hover:bg-gray-50 transition-colors">
                                        <td className="p-4 text-xs font-bold text-gray-500">
                                            {new Date(session.loginTime).toLocaleString()}
                                        </td>
                                        <td className="p-4 font-bold text-gray-700">
                                            {session.staffName}
                                            {staffList.find(s => s.id === session.staffId)?.branch && (
                                                <p className="text-[9px] font-bold text-blue-400 uppercase tracking-tight mt-0.5">
                                                    {staffList.find(s => s.id === session.staffId)?.branch}
                                                </p>
                                            )}
                                        </td>
                                        <td className="p-4 text-xs text-gray-400 font-bold">
                                            {session.staffId}
                                        </td>
                                    </tr>
                                ))}
                                {sessions.length === 0 && (
                                    <tr>
                                        <td colSpan={3} className="p-8 text-center text-gray-400 italic text-xs">
                                            No login sessions recorded yet.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </NeuCard>
                </div>
            )}

            {/* --- Editing Modal/Overlay --- */}
            {editingStaff && (
                <div className="fixed inset-0 bg-gray-900/20 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="max-w-md w-full animate-pop-in">
                        <NeuCard className="relative">
                            <button
                                onClick={() => setEditingStaff(null)}
                                className="absolute top-4 right-4 p-2 text-gray-400 hover:text-gray-600"
                                title="Close Modal"
                                aria-label="Close Modal"
                            >
                                <ArrowLeft className="w-5 h-5" />
                            </button>

                            <h3 className="text-xl font-bold text-gray-700 mb-8 pt-2">Modify Employee Records</h3>
                            <p className="text-xs font-bold text-gray-400 uppercase mb-6 flex items-center gap-2">
                                <Shield className="w-4 h-4" /> Security Mode: Admin Override
                            </p>

                            <form onSubmit={handleUpdateStaff} className="space-y-6">
                                <div>
                                    <NeuInput
                                        label="Full Name"
                                        value={editingStaff.name}
                                        onChange={e => setEditingStaff({ ...editingStaff, name: e.target.value })}
                                        placeholder="Staff Name"
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <NeuInput
                                        label="AL Balance"
                                        type="number"
                                        value={editingStaff.balanceAL}
                                        onChange={e => setEditingStaff({ ...editingStaff, balanceAL: parseInt(e.target.value) })}
                                    />
                                    <NeuInput
                                        label="ML Balance"
                                        type="number"
                                        value={editingStaff.balanceML}
                                        onChange={e => setEditingStaff({ ...editingStaff, balanceML: parseInt(e.target.value) })}
                                    />
                                </div>

                                <div>
                                    <NeuInput
                                        label="Service Start Date"
                                        type="date"
                                        value={editingStaff.joinDate || ''}
                                        onChange={e => setEditingStaff({ ...editingStaff, joinDate: e.target.value })}
                                        placeholder="YYYY-MM-DD"
                                    />
                                </div>

                                <div>
                                    <label className="text-[10px] font-black text-gray-400 uppercase ml-1">Assigned Branch</label>
                                    <select
                                        value={editingStaff.branch || ''}
                                        onChange={e => setEditingStaff({ ...editingStaff, branch: e.target.value })}
                                        className="w-full mt-1 bg-neu-base rounded-xl shadow-neu-pressed-sm px-4 py-3 outline-none focus:shadow-neu-pressed transition-all"
                                        aria-label="Assigned Branch"
                                        title="Assigned Branch"
                                    >
                                        <option value="">-- No Branch Assigned --</option>
                                        {Object.entries(BRANCH_GROUPS).map(([site, branches]) => (
                                            <optgroup key={site} label={site}>
                                                {branches.map(b => (
                                                    <option key={b} value={b}>{b}</option>
                                                ))}
                                            </optgroup>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="text-[10px] font-black text-gray-400 uppercase ml-1">System Role</label>
                                    <select
                                        value={editingStaff.role}
                                        onChange={e => setEditingStaff({ ...editingStaff, role: e.target.value as any })}
                                        className="w-full mt-1 bg-neu-base rounded-xl shadow-neu-pressed-sm px-4 py-3 outline-none focus:shadow-neu-pressed transition-all"
                                        aria-label="System Role"
                                        title="System Role"
                                    >
                                        <option value="staff">Staff</option>
                                        <option value="hod">HOD</option>
                                        <option value="gm">General Manager</option>
                                        <option value="admin">Admin</option>
                                        <option value="super_admin">Super Admin</option>
                                    </select>
                                </div>

                                <NeuButton
                                    type="submit"
                                    variant="primary"
                                    className="w-full py-4 flex items-center justify-center gap-2 mt-4"
                                    disabled={isUpdating}
                                >
                                    {isUpdating ? <Activity className="w-5 h-5 animate-spin" /> : <><Save className="w-5 h-5" /> Commit Changes</>}
                                </NeuButton>
                            </form>
                        </NeuCard>
                    </div>
                </div>
            )}

            {/* --- Log Editing Modal --- */}
            {editingLog && (
                <div className="fixed inset-0 bg-gray-900/20 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="max-w-md w-full animate-pop-in">
                        <NeuCard className="relative">
                            <button
                                onClick={() => setEditingLog(null)}
                                className="absolute top-4 right-4 p-2 text-gray-400 hover:text-gray-600"
                                title="Close Modal"
                                aria-label="Close Modal"
                            >
                                <ArrowLeft className="w-5 h-5" />
                            </button>

                            <h3 className="text-xl font-bold text-gray-700 mb-8 pt-2">Edit Leave Application</h3>
                            <p className="text-xs font-bold text-gray-400 uppercase mb-6 flex items-center gap-2">
                                <Activity className="w-4 h-4" /> System Record Correction
                            </p>

                            <form onSubmit={handleUpdateLog} className="space-y-6">
                                <div>
                                    <label className="text-[10px] font-black text-gray-400 uppercase ml-1">Staff Member</label>
                                    <p className="p-4 bg-gray-100 rounded-xl font-bold text-gray-500 mt-1">{editingLog.staffName}</p>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <NeuInput
                                        label="Start Date"
                                        type="date"
                                        value={editingLog.startDate}
                                        onChange={e => setEditingLog({ ...editingLog, startDate: e.target.value })}
                                    />
                                    <NeuInput
                                        label="End Date"
                                        type="date"
                                        value={editingLog.endDate}
                                        onChange={e => setEditingLog({ ...editingLog, endDate: e.target.value })}
                                    />
                                </div>

                                <NeuTextArea
                                    label="Reason for leave"
                                    value={editingLog.reason}
                                    onChange={e => setEditingLog({ ...editingLog, reason: e.target.value })}
                                />

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="text-[10px] font-black text-gray-400 uppercase ml-1">Category</label>
                                        <select
                                            value={editingLog.type}
                                            onChange={e => setEditingLog({ ...editingLog, type: e.target.value as any })}
                                            className="w-full mt-1 bg-neu-base rounded-xl shadow-neu-pressed-sm px-4 py-3 outline-none"
                                            aria-label="Category"
                                            title="Category"
                                        >
                                            <option value="AL">Annual (AL)</option>
                                            <option value="ML">Medical (ML)</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-black text-gray-400 uppercase ml-1">Status</label>
                                        <select
                                            value={editingLog.status}
                                            onChange={e => setEditingLog({ ...editingLog, status: e.target.value as any })}
                                            className="w-full mt-1 bg-neu-base rounded-xl shadow-neu-pressed-sm px-4 py-3 outline-none"
                                            aria-label="Status"
                                            title="Status"
                                        >
                                            <option value="pending">Pending</option>
                                            <option value="hod_approved">HOD Approved</option>
                                            <option value="approved">Approved</option>
                                            <option value="rejected">Rejected</option>
                                        </select>
                                    </div>
                                </div>

                                <NeuButton
                                    type="submit"
                                    variant="primary"
                                    className="w-full py-4 flex items-center justify-center gap-2 mt-4"
                                    disabled={isUpdating}
                                >
                                    {isUpdating ? <Activity className="w-5 h-5 animate-spin" /> : <><Save className="w-5 h-5" /> Save Changes</>}
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
                                {printingLog.type === 'Paid' && <div className="w-3 h-3 bg-black"></div>}
                            </div>
                            Cuti Berbayar
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-5 h-5 border-2 border-black flex items-center justify-center">
                                {printingLog.type === 'Compassionate' && <div className="w-3 h-3 bg-black"></div>}
                            </div>
                            Cuti Ehsan
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-5 h-5 border-2 border-black flex items-center justify-center">
                                {printingLog.type === 'Unpaid' && <div className="w-3 h-3 bg-black"></div>}
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
