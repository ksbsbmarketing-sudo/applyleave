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
                    <div className="inline-block p-4 bg-neu-base rounded-full shadow-neu-flat mb-4">
                        <img src="/logo.jpg" alt="Logo" className="w-16 h-16 rounded-full object-cover" />
                    </div>
                    <h1 className="text-4xl font-extrabold tracking-tight">Klinik Syed Badaruddin</h1>
                    <p className="text-gray-500 mt-2 font-medium">Leave Tracking System</p>
                </div>

                <NeuCard className="p-8">
                    <h2 className="text-xl font-bold mb-8 text-center uppercase tracking-widest text-gray-500">Secure access</h2>

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
                                'Authenticate'
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

                <p className="mt-10 text-center text-xs text-gray-400 font-bold uppercase tracking-widest">
                    Powered by Gemini & Firebase
                </p>
                <div className="mt-4 text-center">
                    <button
                        onClick={() => {
                            if (window.confirm("Are you sure you want to completely reset all data? This will clear all staff, logs, and sessions.")) {
                                localStorage.clear();
                                window.location.reload();
                            }
                        }}
                        className="text-[10px] text-red-300 hover:text-red-500 uppercase tracking-widest font-black transition-colors"
                    >
                        [ Reset Application Data ]
                    </button>
                </div>
            </div>
        </div>
    );
};
