import React, { useState } from 'react';
import { Lock, User, Activity, AlertCircle, MapPin, ArrowLeft, Building2 } from 'lucide-react';
import { NeuCard, NeuButton, NeuInput } from './NeuElements';
import { registerStaff } from '../services/firebase';
import { Staff, BRANCHES, BRANCH_GROUPS } from '../types';

interface RegistrationPageProps {
    onRegister: (user: Staff) => void;
    onBack: () => void;
}

export const RegistrationPage: React.FC<RegistrationPageProps> = ({ onRegister, onBack }) => {
    const [ic, setIc] = useState('');
    const [name, setName] = useState('');
    const [address, setAddress] = useState('');
    const [branch, setBranch] = useState(BRANCHES[0]);
    const [joinDate, setJoinDate] = useState(new Date().toISOString().split('T')[0]);
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!ic || !name || !address || !password || !branch || !joinDate) return;

        setLoading(true);
        setError(null);

        try {
            const user = await registerStaff(ic, name, address, password, branch, joinDate);
            onRegister(user);
        } catch (err: any) {
            setError(err.message || 'Registration failed. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-[#e0e5ec] p-4 text-gray-700">
            <div className="w-full max-w-md">
                <div className="text-center mb-10 relative">
                    <button
                        onClick={onBack}
                        className="absolute left-0 top-1/2 -translate-y-1/2 p-3 bg-neu-base rounded-full shadow-neu-flat hover:shadow-neu-pressed transition-all duration-300 transform active:scale-90"
                        title="Go Back"
                        aria-label="Go Back"
                    >
                        <ArrowLeft className="w-5 h-5 text-gray-500" />
                    </button>

                    <div className="inline-block p-4 bg-neu-base rounded-full shadow-neu-flat mb-4">
                        <img src="/logo.jpg" alt="Logo" className="w-16 h-16 rounded-full object-cover" />
                    </div>
                    <h1 className="text-4xl font-extrabold tracking-tight">Klinik Syed Badaruddin</h1>
                    <p className="text-gray-500 mt-2 font-medium">Leave Tracking System</p>
                </div>

                <NeuCard className="p-8">
                    <h2 className="text-xl font-bold mb-8 text-center uppercase tracking-widest text-gray-500">Registration</h2>

                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">Full Name</label>
                            <div className="relative">
                                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
                                    <User className="w-5 h-5" />
                                </div>
                                <input
                                    type="text"
                                    placeholder="e.g. John Doe"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    className="w-full bg-neu-base rounded-[16px] shadow-neu-pressed-sm px-12 py-4 outline-none focus:shadow-neu-pressed transition-all duration-300"
                                    required
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">IC Number</label>
                            <div className="relative">
                                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-lg leading-none">#</div>
                                <input
                                    type="text"
                                    placeholder="e.g. 880101-10-1234"
                                    value={ic}
                                    onChange={(e) => setIc(e.target.value)}
                                    className="w-full bg-neu-base rounded-[16px] shadow-neu-pressed-sm px-12 py-4 outline-none focus:shadow-neu-pressed transition-all duration-300 font-mono"
                                    required
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">Residential Address</label>
                            <div className="relative">
                                <div className="absolute left-4 top-4 text-gray-400">
                                    <MapPin className="w-5 h-5" />
                                </div>
                                <textarea
                                    placeholder="Street, City, Postcode"
                                    value={address}
                                    onChange={(e) => setAddress(e.target.value)}
                                    className="w-full bg-neu-base rounded-[16px] shadow-neu-pressed-sm px-12 py-4 outline-none focus:shadow-neu-pressed transition-all duration-300 min-h-[100px] resize-none"
                                    required
                                />
                            </div>
                        </div>


                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">Branch</label>
                            <div className="relative">
                                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
                                    <Building2 className="w-5 h-5" />
                                </div>
                                <select
                                    value={branch}
                                    onChange={(e) => setBranch(e.target.value)}
                                    className="w-full bg-neu-base rounded-[16px] shadow-neu-pressed-sm px-12 py-4 outline-none focus:shadow-neu-pressed transition-all duration-300 appearance-none cursor-pointer"
                                    required
                                    aria-label="Select Branch"
                                    title="Select Branch"
                                >
                                    {Object.entries(BRANCH_GROUPS).map(([site, branches]) => (
                                        <optgroup key={site} label={site}>
                                            {branches.map(b => (
                                                <option key={b} value={b}>{b}</option>
                                            ))}
                                        </optgroup>
                                    ))}
                                </select>
                                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-gray-400">
                                    <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" /></svg>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">Date Joined</label>
                            <div className="relative">
                                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
                                    <Activity className="w-5 h-5" />
                                </div>
                                <input
                                    type="date"
                                    value={joinDate}
                                    onChange={(e) => setJoinDate(e.target.value)}
                                    className="w-full bg-neu-base rounded-[16px] shadow-neu-pressed-sm px-12 py-4 outline-none focus:shadow-neu-pressed transition-all duration-300"
                                    required
                                    title="Date Joined"
                                    aria-label="Date Joined"
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">Password</label>
                            <div className="relative">
                                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
                                    <Lock className="w-5 h-5" />
                                </div>
                                <input
                                    type="password"
                                    placeholder="••••••••"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="w-full bg-neu-base rounded-[16px] shadow-neu-pressed-sm px-12 py-4 outline-none focus:shadow-neu-pressed transition-all duration-300"
                                    required
                                />
                            </div>
                        </div>

                        {error && (
                            <div className="flex items-center gap-2 p-4 bg-red-100/50 text-red-600 rounded-xl text-sm font-bold animate-shake">
                                <AlertCircle className="w-5 h-5 shrink-0" />
                                {error}
                            </div>
                        )}

                        <NeuButton
                            type="submit"
                            variant="primary"
                            className="w-full py-4 text-lg font-bold uppercase tracking-widest rounded-2xl flex items-center justify-center gap-3 mt-4"
                            disabled={loading}
                        >
                            {loading ? (
                                <Activity className="w-6 h-6 animate-spin" />
                            ) : (
                                'Create Account'
                            )}
                        </NeuButton>
                    </form>
                </NeuCard>

                <p className="mt-8 text-center text-xs text-gray-400 font-bold uppercase tracking-widest">
                    Secure Profile Management
                </p>
            </div>
        </div>
    );
};
