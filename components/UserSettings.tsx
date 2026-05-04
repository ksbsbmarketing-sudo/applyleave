import React, { useState, useEffect } from 'react';
import { User, Clock, Shield, LogOut, History, Edit3, Save, Lock, Trash2, Mail, AlertTriangle, MessageCircle } from 'lucide-react';
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
        phone: user.phone || '',
        email: user.email || ''
    });

    const [passwordForm, setPasswordForm] = useState({
        currentPassword: '',
        newPassword: ''
    });

    const handleUpdateProfile = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            await updateStaffData(user.id.replace(/-/g, ''), {
                address: profileForm.address,
                phone: profileForm.phone,
                email: profileForm.email
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
            await updateStaffData(user.id.replace(/-/g, ''), {
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
                        <Shield className="w-12 h-12 text-premium-accent/10" />
                    </div>
                    <div className="flex justify-between items-center mb-6">
                        <h3 className="text-xl font-bold text-premium-primary flex items-center gap-2 font-luxury uppercase tracking-widest">
                            <User className="w-5 h-5 text-premium-accent" />
                            Profil Peribadi
                        </h3>
                        {!isEditingProfile && (
                            <NeuButton
                                onClick={() => {
                                    setProfileForm({
                                        address: user.address || '',
                                        phone: user.phone || '',
                                        email: user.email || ''
                                    });
                                    setIsEditingProfile(true);
                                }}
                                className="px-3 py-1 flex items-center gap-2 text-xs"
                            >
                                <Edit3 className="w-3 h-3" /> Edit Profile
                            </NeuButton>
                        )}
                    </div>

                    {isEditingProfile ? (
                        <form onSubmit={handleUpdateProfile} className="space-y-4">
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-premium-muted uppercase">Address</label>
                                <NeuInput
                                    value={profileForm.address}
                                    onChange={e => setProfileForm(prev => ({ ...prev, address: e.target.value }))}
                                    placeholder="Enter your address"
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-premium-muted uppercase">Phone Number</label>
                                <NeuInput
                                    value={profileForm.phone}
                                    onChange={e => setProfileForm(prev => ({ ...prev, phone: e.target.value }))}
                                    placeholder="Enter current phone number"
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-orange-500 uppercase flex items-center gap-1">
                                    <Mail className="w-3 h-3" /> Email Notifikasi <span className="text-red-500">★ WAJIB</span>
                                </label>
                                <NeuInput
                                    type="email"
                                    value={profileForm.email}
                                    onChange={e => setProfileForm(prev => ({ ...prev, email: e.target.value }))}
                                    placeholder="contoh@email.com"
                                    required
                                />
                                <p className="text-[10px] text-orange-400 font-bold px-1">Email ini digunakan untuk menerima notifikasi kelulusan cuti.</p>
                            </div>

                            {/* WhatsApp - Fonnte (nombor dihantar dari +60129444295) */}
                            <div className="rounded-2xl bg-green-50/60 border border-green-200 p-4 space-y-2">
                                <p className="text-xs font-black text-green-700 flex items-center gap-1.5">
                                    <MessageCircle className="w-4 h-4" /> WhatsApp Notifikasi
                                </p>
                                <div className="space-y-1">
                                    <label className="text-xs font-bold text-premium-muted uppercase">Nombor WhatsApp Anda</label>
                                    <NeuInput
                                        value={profileForm.phone}
                                        onChange={e => setProfileForm(prev => ({ ...prev, phone: e.target.value }))}
                                        placeholder="contoh: 0123456789"
                                    />
                                    <p className="text-[10px] text-premium-muted font-bold px-1">Format Malaysia (0123456789). Notifikasi akan dihantar ke nombor ini.</p>
                                </div>
                                <div className="bg-green-100/80 rounded-xl p-3">
                                    <p className="text-[10px] font-black text-green-800">📱 Notifikasi dihantar DARI: <span className="font-mono">+60129444295</span></p>
                                    <p className="text-[10px] text-green-700 font-bold mt-0.5">Sistem menggunakan Fonnte — tiada setup diperlukan dari pihak anda.</p>
                                </div>
                            </div>


                            <div className="flex gap-2 pt-2">
                                <NeuButton
                                    type="button"
                                    onClick={() => { setIsEditingProfile(false); setProfileForm({ address: user.address || '', phone: user.phone || '', email: user.email || '' }); }}
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
                                <span className="font-bold text-premium-primary">{user.name}</span>
                            </div>
                            <div className="flex justify-between items-center border-b border-gray-300/20 pb-4">
                                <span className="text-sm font-bold text-gray-400 uppercase">IC Number</span>
                                <span className="font-bold text-premium-primary">{user.ic.replace(/-/g, '')}</span>
                            </div>
                            <div className="flex justify-between items-center border-b border-gray-300/20 pb-4">
                                <span className="text-sm font-bold text-gray-400 uppercase">Phone</span>
                                <span className="font-bold text-premium-primary">{user.phone || '-'}</span>
                            </div>
                            <div className="flex justify-between items-center border-b border-gray-300/20 pb-4">
                                <span className="text-sm font-bold text-gray-400 uppercase flex items-center gap-1"><Mail className="w-3.5 h-3.5 text-orange-400" /> Email</span>
                                {user.email ? (
                                    <span className="font-bold text-premium-primary text-sm">{user.email}</span>
                                ) : (
                                    <span className="flex items-center gap-1 text-orange-500 font-bold text-xs">
                                        <AlertTriangle className="w-3.5 h-3.5" /> Belum ditetapkan — Klik Edit
                                    </span>
                                )}
                            </div>
                            <div className="flex justify-between items-center border-b border-premium-border/50 pb-4">
                                <span className="text-sm font-bold text-premium-muted uppercase tracking-widest">Access Level</span>
                                <NeuBadge variant={user.role === 'admin' || user.role === 'super_admin' ? 'gold' : 'stone'}>
                                    {user.role || 'Staff'}
                                </NeuBadge>
                            </div>

                            {user.address && (
                                <div className="flex flex-col gap-1 border-b border-gray-300/20 pb-4">
                                    <span className="text-sm font-bold text-gray-400 uppercase">Address</span>
                                    <span className="font-bold text-premium-primary text-sm">{user.address}</span>
                                </div>
                            )}
                            {user.branch && (
                                <div className="flex flex-col gap-1 border-b border-gray-300/20 pb-4">
                                    <span className="text-sm font-bold text-gray-400 uppercase">Branch</span>
                                    <span className="font-bold text-premium-primary text-sm">{user.branch}</span>
                                </div>
                            )}
                            <div className="flex flex-col gap-1 border-b border-gray-300/20 pb-4">
                                <span className="text-sm font-bold text-premium-muted uppercase tracking-widest">Service Duration</span>
                                <span className="font-bold text-premium-accent text-sm">
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
                                variant="danger"
                                className="w-full flex items-center justify-center gap-2 text-rose-500 font-bold"
                            >
                                <LogOut className="w-5 h-5" />
                                Sign Out
                            </NeuButton>
                        </div>
                    )}
                </NeuCard>

                <div className="space-y-8">
                    {/* Security Settings */}
                    <NeuCard className="bg-premium-bg/50 relative overflow-hidden group border-premium-border/50">
                        <div className="absolute top-0 left-0 w-1.5 h-full bg-luxury-gold"></div>
                        <h3 className="text-xl font-bold text-premium-primary mb-6 flex items-center gap-2 font-luxury uppercase tracking-widest">
                            <Lock className="w-5 h-5 text-luxury-gold" />
                            Keselamatan
                        </h3>
                        <form onSubmit={handleUpdatePassword} className="space-y-4">
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-premium-muted uppercase tracking-widest">Current Password</label>
                                <NeuInput
                                    type="password"
                                    value={passwordForm.currentPassword}
                                    onChange={e => setPasswordForm(prev => ({ ...prev, currentPassword: e.target.value }))}
                                    placeholder="Enter current password"
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-premium-muted uppercase tracking-widest">New Password</label>
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
                <h3 className="text-xl font-bold text-premium-primary mb-6 flex items-center gap-2 font-luxury uppercase tracking-widest">
                    <History className="w-5 h-5 text-premium-accent" />
                    Rekod Permohonan
                </h3>

                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="text-[10px] font-black text-premium-muted uppercase tracking-widest border-b border-premium-border/50">
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
                                        <td className="py-4 pl-2 font-bold text-premium-primary">
                                            {log.startDate}
                                            <span className="text-[9px] text-premium-muted block font-normal mt-0.5">to {log.endDate}</span>
                                        </td>
                                        <td className="py-4">
                                            <span className={`px-2 py-1 rounded text-[10px] font-black uppercase tracking-widest ${log.type === 'AL' ? 'bg-premium-bg text-premium-primary' : 'bg-premium-accent/10 text-premium-accent'}`}>
                                                {log.type}
                                            </span>
                                        </td>
                                        <td className="py-4 text-center font-bold text-premium-primary">
                                            {log.duration}d
                                        </td>
                                        <td className="py-4 text-xs text-premium-muted italic max-w-[200px] truncate">
                                            {log.reason}
                                        </td>
                                        <td className="py-4 text-center">
                                            <NeuBadge variant={
                                                log.status === 'approved' ? 'green' :
                                                    log.status === 'rejected' ? 'red' :
                                                        log.status === 'hod_approved' ? 'stone' : 'yellow'
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
                                                        className="p-2 text-premium-accent hover:text-luxury-gold hover:bg-premium-bg rounded-lg transition-colors"
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
                    <h3 className="text-xl font-bold text-premium-primary mb-6 flex items-center gap-2 font-luxury uppercase tracking-widest">
                        <History className="w-5 h-5 text-luxury-gold" />
                        Session Tracking
                    </h3>

                <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                    {mySessions.length === 0 ? (
                        <p className="text-center text-gray-400 py-10 italic">No recent login activity found.</p>
                    ) : (
                        mySessions.map((session, i) => (
                            <div key={session.id || i} className="flex items-center gap-4 p-4 hover:shadow-neu-pressed-sm rounded-xl transition-all duration-300">
                                <div className="p-3 bg-premium-bg rounded-full border border-premium-border/50">
                                    <Clock className="w-4 h-4 text-premium-muted" />
                                </div>
                                <div className="flex-1">
                                    <p className="text-sm font-bold text-premium-primary">Authenticated Session</p>
                                    <p className="text-xs text-premium-muted">{new Date(session.loginTime).toLocaleString()}</p>
                                </div>
                                <div className="text-[10px] font-black text-premium-accent uppercase px-2 py-1 bg-premium-bg rounded border border-premium-accent/20">
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
