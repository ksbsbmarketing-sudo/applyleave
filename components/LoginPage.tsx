import React, { useState } from 'react';
import { Lock, User, Activity, AlertCircle, Shield } from 'lucide-react';
import { NeuCard, NeuButton, NeuInput } from './NeuElements';
import { loginStaff } from '../services/firebase';
import { validateIC } from '../services/validation';
import { Staff } from '../types';

interface LoginPageProps {
    onLogin: (user: Staff) => void;
    onGoToRegister: () => void;
    sessionMessage?: string | null;
    onClearMessage?: () => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLogin, onGoToRegister, sessionMessage, onClearMessage }) => {
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

            const icError = validateIC(sanitizedIc);
            if (icError) { setError(icError); setLoading(false); return; }

            const user = await loginStaff(sanitizedIc, password);
            onLogin(user);
        } catch (err: any) {
            setError(err.message || 'Login failed. Please check your credentials.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center p-4">
            <div className="w-full max-w-md animate-float">
                {/* Brand Header */}
                <div className="text-center mb-12">
                    <div className="flex justify-center items-center gap-6 mb-10 scale-90 md:scale-100">
                        <div className="relative group">
                            <div className="absolute -inset-1 bg-luxury-gold rounded-full blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200"></div>
                            <div className="relative p-1.5 bg-white rounded-full shadow-premium-md w-24 h-24 flex items-center justify-center overflow-hidden border border-premium-border/50">
                                <img src="/logo-ksb.jpg" alt="KSB" className="w-full h-full object-cover" />
                            </div>
                        </div>
                    </div>
                    
                    <h1 className="text-4xl md:text-5xl font-black tracking-tight text-premium-primary mb-3 font-luxury">
                        KSB <span className="text-premium-accent">Smart</span> Leave
                    </h1>
                    
                    <div className="flex items-center justify-center gap-4">
                        <div className="h-[1px] w-12 bg-luxury-gold/30"></div>
                        <p className="text-[10px] font-black uppercase tracking-[0.4em] text-premium-muted">
                            Internal Luxury Management
                        </p>
                        <div className="h-[1px] w-12 bg-luxury-gold/30"></div>
                    </div>
                </div>

                {sessionMessage && (
                    <div className="mb-6 flex items-start gap-3 p-4 bg-amber-50 text-amber-700 rounded-2xl text-[11px] font-bold border border-amber-200">
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                        <span className="flex-1">{sessionMessage}</span>
                        <button onClick={onClearMessage} className="shrink-0 text-amber-400 hover:text-amber-600 transition-colors text-sm font-black leading-none">×</button>
                    </div>
                )}

                <NeuCard className="p-10 bg-white/70 backdrop-blur-2xl border-white/50 shadow-premium-lg">
                    <div className="flex items-center justify-center gap-2 mb-10">
                        <Shield className="w-4 h-4 text-premium-accent" />
                        <h2 className="text-xs font-black uppercase tracking-[0.4em] text-premium-accent">Secure Gateway</h2>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-8">
                        <NeuInput 
                            label="Staff Identity (IC)"
                            placeholder="611021065069"
                            value={ic}
                            onChange={(e) => setIc(e.target.value)}
                            required
                        />

                        <NeuInput 
                            label="Security Password"
                            type="password"
                            placeholder="••••••••"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                        />

                        {error && (
                            <div className="flex items-center gap-3 p-4 bg-red-50 text-red-600 rounded-2xl text-[11px] font-black uppercase tracking-wider border border-red-100 animate-shake">
                                <AlertCircle className="w-4 h-4 shrink-0" />
                                {error}
                            </div>
                        )}

                        <NeuButton
                            type="submit"
                            variant="gold"
                            className="w-full py-5 text-sm font-black uppercase tracking-[0.3em] rounded-2xl shadow-luxury-gold/20"
                            disabled={loading}
                        >
                            {loading ? (
                                <Activity className="w-6 h-6 animate-spin" />
                            ) : (
                                'Proceed to Dashboard'
                            )}
                        </NeuButton>
                    </form>

                    <div className="mt-10 text-center">
                        <button
                            onClick={onGoToRegister}
                            className="text-[10px] font-black text-premium-muted uppercase tracking-widest hover:text-premium-accent transition-colors"
                        >
                            New membership? <span className="text-premium-accent border-b border-premium-accent/30 pb-0.5">Register Here</span>
                        </button>
                    </div>
                </NeuCard>

                {/* Footer */}
                <div className="text-center mt-12 space-y-3">
                    <p className="text-[10px] font-black text-premium-muted uppercase tracking-[0.2em]">
                        © 2026 Klinik Syed Badaruddin
                    </p>
                    <div className="flex items-center justify-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-luxury-gold animate-pulse"></div>
                        <p className="text-[9px] font-bold text-premium-muted italic">
                            Crafted by <span className="not-italic text-premium-primary">Kembara Senja</span>
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};
