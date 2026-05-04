import React, { useState } from 'react';
import { Lock, User, Activity, AlertCircle } from 'lucide-react';
import { NeuCard, NeuButton, NeuInput } from './NeuElements';
import { loginStaff } from '../services/firebase';
import { Staff } from '../types';

interface LoginPageProps {
    onLogin: (user: Staff) => void;
    onGoToRegister: () => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLogin, onGoToRegister }) => {
    const [ic, setIc] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!ic || !password) return;

        setLoading(true);
        setError(null);

        try {
            const sanitizedIc = ic.replace(/-/g, '').trim();
            const user = await loginStaff(sanitizedIc, password);
            onLogin(user);
        } catch (err: any) {
            setError(err.message || 'Login failed. Please check your credentials.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-[#e0e5ec] p-4 text-gray-700">
            <div className="w-full max-w-md">
                <div className="text-center mb-10">
                    <div className="flex justify-center items-center gap-6 mb-10 mt-2 scale-90 md:scale-100">
                        {/* KSB Logo */}
                        <div className="p-1.5 bg-neu-base rounded-full shadow-neu-flat w-20 h-20 flex items-center justify-center overflow-hidden border border-white">
                            <img src="/logo-ksb.jpg" alt="KSB" className="w-full h-full object-cover" />
                        </div>
                        {/* KLINIK RAKYAT - WE CARE Logo */}
                        <div className="p-1.5 bg-black rounded-full shadow-neu-flat w-20 h-20 flex items-center justify-center overflow-hidden border border-white">
                            <img src="/logo-kr.jpg" alt="KLINIK RAKYAT - WE CARE" className="w-full h-full object-cover" />
                        </div>
                        {/* Uni Klinik Logo */}
                        <div className="p-2 bg-white rounded-xl shadow-neu-flat w-28 h-20 flex items-center justify-center overflow-hidden border border-white">
                            <img src="/logo-bentong.jpg" alt="Bentong" className="w-full h-auto object-contain" />
                        </div>
                    </div>
                    <div className="relative inline-block">
                        <h1 className="text-4xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-br from-gray-900 via-gray-800 to-blue-900 leading-none">
                            KLINIK SYED BADARUDDIN
                        </h1>
                        <div className="flex items-center justify-center gap-4 mt-3">
                            <div className="h-[1px] w-8 bg-gradient-to-r from-transparent to-blue-200"></div>
                            <p className="text-[10px] font-black uppercase tracking-[0.5em] text-blue-500/70">
                                Leave Tracking System
                            </p>
                            <div className="h-[1px] w-8 bg-gradient-to-l from-transparent to-blue-200"></div>
                        </div>
                    </div>
                </div>

                <NeuCard className="p-8">
                    <h2 className="text-xl font-bold mb-8 text-center uppercase tracking-[0.3em] text-blue-600/60">Login</h2>

                    <form onSubmit={handleSubmit} className="space-y-8">
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">Staff IC Number</label>
                            <div className="relative">
                                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
                                    <User className="w-5 h-5" />
                                </div>
                                <input
                                    type="text"
                                    placeholder="e.g. 611021065069 (No Hyphens)"
                                    value={ic}
                                    onChange={(e) => setIc(e.target.value)}
                                    className="w-full bg-neu-base rounded-[16px] shadow-neu-pressed-sm px-12 py-4 outline-none focus:shadow-neu-pressed transition-all duration-300"
                                    required
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
                            className="w-full py-4 text-lg font-bold uppercase tracking-widest rounded-2xl flex items-center justify-center gap-3"
                            disabled={loading}
                        >
                            {loading ? (
                                <Activity className="w-6 h-6 animate-spin" />
                            ) : (
                                'Login'
                            )}
                        </NeuButton>
                    </form>

                    <div className="mt-8 text-center space-y-4">
                        <button
                            onClick={onGoToRegister}
                            className="text-xs font-black text-blue-500 uppercase tracking-widest hover:underline"
                        >
                            New here? Register Now
                        </button>
                    </div>
                </NeuCard>

                <div className="text-center mt-12 pb-8">
                    <p className="text-[10px] font-black text-gray-700 uppercase tracking-[0.1em]">
                        © 2026 Klinik Syed Badaruddin Sdn Bhd. Hak Cipta Terpelihara.
                    </p>
                    <p className="text-[9px] font-bold text-gray-400 italic mt-1">
                        Pencipta: <span className="text-gray-500 not-italic">Kembara Senja</span>
                    </p>
                    <div className="w-10 h-0.5 bg-red-100 mx-auto mt-4 rounded-full" />
                </div>
            </div>
        </div>
    );
};
