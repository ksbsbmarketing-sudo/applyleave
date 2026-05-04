import React, { useState, useEffect } from 'react';
import { User, Clock, Shield, LogOut, History, Edit3, Save, Lock, Trash2 } from 'lucide-react';
import { NeuCard, NeuButton, NeuInput, NeuBadge } from './NeuElements';
import { Staff, LeaveLog } from '../types';
import { subscribeToSessions, updateStaffData, calculateYearsOfService, deleteLeaveLog, updateLeaveLog } from '../services/firebase';

interface UserSettingsProps {
    user: Staff;
    logs: LeaveLog[];
    onLogout: () => void;
}

export const UserSettings: React.FC<UserSettingsProps> = ({ user, logs, onLogout }) => {
    const [sessions, setSessions] = useState<any[]>([]);
    const [isEditingProfile, setIsEditingProfile] = useState(false);
    const [profileForm, setProfileForm] = useState({
        address: user.address || '',
        phone: user.phone || ''
    });

    const [passwordForm, setPasswordForm] = useState({
        currentPassword: '',
        newPassword: ''
    });

    const handleUpdateProfile = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            await updateStaffData(user.id, {
                address: profileForm.address,
                phone: profileForm.phone
            });
            setIsEditingProfile(false);
            alert("Profile updated successfully!");
        } catch (error: any) {
            alert("Failed to update profile: " + error.message);
        }
    };

    const handleUpdatePassword = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!passwordForm.newPassword) return;

        // Simple client-side check if we wanted to enforce current password
        // Since we don't have a verify API easily, we'll assume if they differ from session they might be wrong, 
        // but let's just allow update for now or check against user.password locally (insecure but consistent with current app level)
        if (user.password && passwordForm.currentPassword !== user.password) {
            alert("Current password is incorrect.");
            return;
        }

        try {
            await updateStaffData(user.id, {
                password: passwordForm.newPassword
            });
            setPasswordForm({ currentPassword: '', newPassword: '' });
            alert("Password updated successfully!");
        } catch (error: any) {
            alert("Failed to update password: " + error.message);
        }
    };

    useEffect(() => {
        const unsub = subscribeToSessions(setSessions);
        return () => unsub();
    }, []);

    const mySessions = sessions.filter(s => s.staffId === user.id);
    const myLogs = logs.filter(l => l.staffId === user.id).sort((a, b) => b.timestamp - a.timestamp);

    return (
        <div className="space-y-8 animate-fade-in">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Profile Info */}
                <NeuCard className="relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4">
                        <Shield className="w-12 h-12 text-blue-500/10" />
                    </div>
                    <div className="flex justify-between items-center mb-6">
                        <h3 className="text-xl font-bold text-gray-700 flex items-center gap-2">
                            <User className="w-5 h-5 text-blue-500" />
                            My Profile
                        </h3>
                        {!isEditingProfile && (
                            <NeuButton
                                onClick={() => setIsEditingProfile(true)}
                                className="px-3 py-1 flex items-center gap-2 text-xs"
                            >
                                <Edit3 className="w-3 h-3" /> Edit Profile
                            </NeuButton>
                        )}
                    </div>

                    {isEditingProfile ? (
                        <form onSubmit={handleUpdateProfile} className="space-y-4">
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-gray-400 uppercase">Address</label>
                                <NeuInput
                                    value={profileForm.address}
                                    onChange={e => setProfileForm(prev => ({ ...prev, address: e.target.value }))}
                                    placeholder="Enter your address"
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-gray-400 uppercase">Phone Number</label>
                                <NeuInput
                                    value={profileForm.phone}
                                    onChange={e => setProfileForm(prev => ({ ...prev, phone: e.target.value }))}
                                    placeholder="Enter current phone number"
                                />
                            </div>

                            <div className="flex gap-2 pt-2">
                                <NeuButton
                                    type="button"
                                    onClick={() => { setIsEditingProfile(false); setProfileForm({ address: user.address || '', phone: user.phone || '' }); }}
                                    className="flex-1 py-2 text-red-500 bg-red-50/50"
                                >
                                    Cancel
                                </NeuButton>
                                <NeuButton
                                    type="submit"
                                    variant="primary"
                                    className="flex-1 py-2 flex items-center justify-center gap-2"
                                >
                                    <Save className="w-4 h-4" /> Save
                                </NeuButton>
                            </div>
                        </form>
                    ) : (
                        <div className="space-y-6">
                            <div className="flex justify-between items-center border-b border-gray-300/20 pb-4">
                                <span className="text-sm font-bold text-gray-400 uppercase">Full Name</span>
                                <span className="font-bold text-gray-700">{user.name}</span>
                            </div>
                            <div className="flex justify-between items-center border-b border-gray-300/20 pb-4">
                                <span className="text-sm font-bold text-gray-400 uppercase">IC Number</span>
                                <span className="font-bold text-gray-700">{user.ic.replace(/-/g, '')}</span>
                            </div>
                            <div className="flex justify-between items-center border-b border-gray-300/20 pb-4">
                                <span className="text-sm font-bold text-gray-400 uppercase">Phone</span>
                                <span className="font-bold text-gray-700">{user.phone || '-'}</span>
                            </div>
                            <div className="flex justify-between items-center border-b border-gray-300/20 pb-4">
                                <span className="text-sm font-bold text-gray-400 uppercase">Access Level</span>
                                <span className="px-3 py-1 bg-blue-100 text-blue-600 rounded-full text-xs font-bold shadow-sm uppercase">
                                    {user.role || 'Staff'}
                                </span>
                            </div>
                            {user.address && (
                                <div className="flex flex-col gap-1 border-b border-gray-300/20 pb-4">
                                    <span className="text-sm font-bold text-gray-400 uppercase">Address</span>
                                    <span className="font-bold text-gray-700 text-sm">{user.address}</span>
                                </div>
                            )}
                            {user.branch && (
                                <div className="flex flex-col gap-1 border-b border-gray-300/20 pb-4">
                                    <span className="text-sm font-bold text-gray-400 uppercase">Branch</span>
                                    <span className="font-bold text-gray-700 text-sm">{user.branch}</span>
                                </div>
                            )}
                            <div className="flex flex-col gap-1 border-b border-gray-300/20 pb-4">
                                <span className="text-sm font-bold text-gray-400 uppercase">Service Duration</span>
                                <span className="font-bold text-blue-600 text-sm">
                                    {(() => {
                                        const { years, months } = calculateYearsOfService(user.joinDate || new Date().toISOString());
                                        return `${years} Years, ${months} Months`;
                                    })()}
                                </span>
                            </div>
                        </div>
                    )}

                    {!isEditingProfile && (
                        <div className="mt-8">
                            <NeuButton
                                onClick={onLogout}
                                variant="secondary"
                                className="w-full flex items-center justify-center gap-2 text-red-500 font-bold"
                            >
                                <LogOut className="w-5 h-5" />
                                Sign Out
                            </NeuButton>
                        </div>
                    )}
                </NeuCard>

                <div className="space-y-8">
                    {/* Security Settings */}
                    <NeuCard className="relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-4">
                            <Lock className="w-12 h-12 text-orange-500/10" />
                        </div>
                        <h3 className="text-xl font-bold text-gray-700 mb-6 flex items-center gap-2">
                            <Lock className="w-5 h-5 text-orange-500" />
                            Security
                        </h3>
                        <form onSubmit={handleUpdatePassword} className="space-y-4">
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-gray-400 uppercase">Current Password</label>
                                <NeuInput
                                    type="password"
                                    value={passwordForm.currentPassword}
                                    onChange={e => setPasswordForm(prev => ({ ...prev, currentPassword: e.target.value }))}
                                    placeholder="Enter current password"
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-gray-400 uppercase">New Password</label>
                                <NeuInput
                                    type="password"
                                    value={passwordForm.newPassword}
                                    onChange={e => setPasswordForm(prev => ({ ...prev, newPassword: e.target.value }))}
                                    placeholder="Enter new password"
                                />
                            </div>
                            <NeuButton
                                type="submit"
                                variant="primary"
                                className="w-full py-2 flex items-center justify-center gap-2 mt-2"
                            >
                                <Save className="w-4 h-4" /> Update Password
                            </NeuButton>
                        </form>
                    </NeuCard>


                </div>
            </div>

            {/* My Applications (Interactive) */}
            <NeuCard className="overflow-hidden">
                <h3 className="text-xl font-bold text-gray-700 mb-6 flex items-center gap-2">
                    <History className="w-5 h-5 text-blue-500" />
                    My Applications
                </h3>

                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="text-[10px] font-black text-gray-400 uppercase tracking-widest border-b border-gray-200">
                                <th className="pb-4 pl-2">Period</th>
                                <th className="pb-4">Category</th>
                                <th className="pb-4 text-center">Duration</th>
                                <th className="pb-4">Reason</th>
                                <th className="pb-4 text-center">Status</th>
                                <th className="pb-4 text-right pr-2">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="text-sm">
                            {myLogs.length === 0 ? (
                                <tr><td colSpan={6} className="py-8 text-center text-gray-400 italic text-xs">No leave transactions found.</td></tr>
                            ) : (
                                myLogs.map(log => (
                                    <tr key={log.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors group">
                                        <td className="py-4 pl-2 font-bold text-gray-600">
                                            {log.startDate}
                                            <span className="text-[9px] text-gray-400 block font-normal mt-0.5">to {log.endDate}</span>
                                        </td>
                                        <td className="py-4">
                                            <span className={`px-2 py-1 rounded text-[10px] font-black uppercase tracking-widest ${log.type === 'AL' ? 'bg-blue-50 text-blue-500' : 'bg-green-50 text-green-500'}`}>
                                                {log.type}
                                            </span>
                                        </td>
                                        <td className="py-4 text-center font-bold text-gray-700">
                                            {log.duration}d
                                        </td>
                                        <td className="py-4 text-xs text-gray-500 italic max-w-[200px] truncate">
                                            {log.reason}
                                        </td>
                                        <td className="py-4 text-center">
                                            <NeuBadge variant={
                                                log.status === 'approved' ? 'green' :
                                                    log.status === 'rejected' ? 'red' :
                                                        log.status === 'hod_approved' ? 'purple' : 'yellow'
                                            }>
                                                {log.status === 'hod_approved' ? 'Auth' : log.status}
                                            </NeuBadge>
                                        </td>
                                        <td className="py-4 text-right pr-2">
                                            {log.status !== 'rejected' && (
                                                <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <button
                                                        onClick={async () => {
                                                            const newStart = prompt("Enter new Start Date (YYYY-MM-DD):", log.startDate);
                                                            const newEnd = prompt("Enter new End Date (YYYY-MM-DD):", log.endDate);
                                                            if (newStart && newEnd) {
                                                                try {
                                                                    // Recalculate duration
                                                                    const start = new Date(newStart);
                                                                    const end = new Date(newEnd);
                                                                    const diffTime = end.getTime() - start.getTime();
                                                                    const calcDuration = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

                                                                    if (calcDuration > 0) {
                                                                        await updateLeaveLog(log.id, {
                                                                            startDate: newStart,
                                                                            endDate: newEnd,
                                                                            duration: calcDuration,
                                                                            status: 'pending' // Force re-approval if edited
                                                                        });
                                                                        alert("Dates updated successfully. Please note: This request will now require re-approval.");
                                                                    } else {
                                                                        alert("Invalid dates.");
                                                                    }
                                                                } catch (e: any) {
                                                                    alert("Failed to update: " + e.message);
                                                                }
                                                            }
                                                        }}
                                                        className="p-2 text-blue-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                                        title="Change Dates (Requires Re-approval)"
                                                    >
                                                        <Edit3 className="w-4 h-4" />
                                                    </button>
                                                    <button
                                                        onClick={async () => {
                                                            if (window.confirm("Are you sure you want to cancel this application? If it was approved, your balance will be refunded.")) {
                                                                await deleteLeaveLog(log.id);
                                                            }
                                                        }}
                                                        className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                                        title="Cancel Application"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </NeuCard>

            {/* Login History */}
            <NeuCard>
                <h3 className="text-xl font-bold text-gray-700 mb-6 flex items-center gap-2">
                    <History className="w-5 h-5 text-purple-500" />
                    Session Tracking
                </h3>

                <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                    {mySessions.length === 0 ? (
                        <p className="text-center text-gray-400 py-10 italic">No recent login activity found.</p>
                    ) : (
                        mySessions.map((session, i) => (
                            <div key={session.id || i} className="flex items-center gap-4 p-4 hover:shadow-neu-pressed-sm rounded-xl transition-all duration-300">
                                <div className="p-3 bg-neu-base rounded-full shadow-neu-flat">
                                    <Clock className="w-4 h-4 text-gray-400" />
                                </div>
                                <div className="flex-1">
                                    <p className="text-sm font-bold text-gray-600">Authenticated Session</p>
                                    <p className="text-xs text-gray-400">{new Date(session.loginTime).toLocaleString()}</p>
                                </div>
                                <div className="text-[10px] font-black text-green-500 uppercase px-2 py-1 bg-green-50 rounded border border-green-100">
                                    Active
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </NeuCard>
        </div>
    );
};
