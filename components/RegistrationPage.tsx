import React, { useState } from 'react';
import { Lock, User, Activity, AlertCircle, MapPin, ArrowLeft, Building2, Mail, ShieldCheck } from 'lucide-react';
import { NeuCard, NeuButton, NeuInput, NeuTextArea } from './NeuElements';
import { registerStaff, subscribeToBranches } from '../services/firebase';
import { validateRegistration } from '../services/validation';
import { Staff } from '../types';

interface RegistrationPageProps {
    onRegister: (user: Staff) => void;
    onBack: () => void;
}

export const RegistrationPage: React.FC<RegistrationPageProps> = ({ onRegister, onBack }) => {
    const [ic, setIc] = useState('');
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [address, setAddress] = useState('');
    const [branch, setBranch] = useState('');
    const [joinDate, setJoinDate] = useState(''); // Empty to force user selection
    const [staffType, setStaffType] = useState<'admin_staff' | 'operation_staff' | 'doctor'>('operation_staff');
    const [gender, setGender] = useState<'male' | 'female'>('male');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [branchConfig, setBranchConfig] = useState<Record<string, string[]>>({});

    React.useEffect(() => {
        return subscribeToBranches((config) => {
            setBranchConfig(config);
            setBranch(prev => {
                const allBranches = Object.values(config).flat();
                if (!prev || !allBranches.includes(prev)) {
                    return allBranches.length > 0 ? allBranches[0] : '';
                }
                return prev;
            });
        });
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        const sanitizedIc = ic.replace(/-/g, '').trim();

        const regError = validateRegistration(name, sanitizedIc, password);
        if (regError) { setError(regError); return; }
        if (!email || !address || !branch || !joinDate) return;

        setLoading(true);

        try {
            const user = await registerStaff(sanitizedIc, name.trim(), address, password, branch, joinDate, staffType, gender);
            // Save email separately
            await import('../services/firebase').then(m => m.updateStaffData(sanitizedIc, { email }));
            onRegister({ ...user, email });
        } catch (err: any) {
            setError(err.message || 'Registration failed. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen py-12 px-4 flex items-center justify-center">
            <div className="w-full max-w-2xl animate-fade-in">
                {/* Navigation Back */}
                <button
                    onClick={onBack}
                    className="mb-8 flex items-center gap-2 text-premium-muted hover:text-premium-accent transition-colors font-black uppercase tracking-[0.3em] text-[10px]"
                >
                    <ArrowLeft className="w-4 h-4" />
                    Kembali Ke Arkib
                </button>

                <div className="text-center mb-12">
                    <div className="flex justify-center items-center gap-4 mb-8">
                        <div className="h-0.5 w-12 bg-luxury-gold/20"></div>
                        <div className="p-3 bg-white rounded-3xl shadow-premium-md border border-premium-border/50">
                            <ShieldCheck className="w-6 h-6 text-premium-accent" />
                        </div>
                        <div className="h-0.5 w-12 bg-luxury-gold/20"></div>
                    </div>
                    
                    <h1 className="text-4xl font-black tracking-tight text-premium-primary font-luxury uppercase mb-3">
                        Pendaftaran <span className="text-premium-accent">Ahli Baru</span>
                    </h1>
                    <p className="text-xs text-premium-muted font-bold uppercase tracking-[0.4em]">Sertai Keluarga Klinik Syed Badaruddin</p>
                </div>

                <NeuCard className="p-10 bg-white/80 backdrop-blur-3xl border-white/50 shadow-premium-lg">
                    <form onSubmit={handleSubmit} className="space-y-10">
                        {/* Personal Information Section */}
                        <div className="space-y-6">
                            <div className="flex items-center gap-3 border-b border-premium-border/50 pb-4">
                                <User className="w-4 h-4 text-premium-accent" />
                                <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-premium-primary">Maklumat Peribadi</h3>
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <NeuInput 
                                    label="Nama Penuh (Seperti Dalam IC)"
                                    placeholder="Contoh: AHMAD BIN ALI"
                                    value={name}
                                    onChange={(e) => {
                                        const newName = e.target.value.toUpperCase();
                                        setName(newName);
                                        if (newName.includes('BIN')) setGender('male');
                                        else if (newName.includes('BINTI')) setGender('female');
                                    }}
                                    required
                                />
                                <NeuInput 
                                    label="Nombor Kad Pengenalan"
                                    placeholder="900101065069"
                                    value={ic}
                                    onChange={(e) => setIc(e.target.value)}
                                    maxLength={14}
                                    required
                                />
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <NeuInput 
                                    label="Email Rasmi"
                                    type="email"
                                    placeholder="ahmad@ksb.com"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    required
                                />
                                <div className="space-y-2">
                                    <label className="ml-1 text-[11px] font-black text-premium-muted uppercase tracking-[0.2em]">Jantina</label>
                                    <div className="flex gap-3 h-[58px]">
                                        <button 
                                            type="button" 
                                            onClick={() => setGender('male')}
                                            className={`flex-1 rounded-2xl border transition-all duration-300 text-[10px] font-black uppercase tracking-widest ${gender === 'male' ? 'bg-premium-primary text-white border-premium-primary shadow-premium-md' : 'bg-white text-premium-muted border-premium-border hover:bg-premium-bg'}`}
                                        >
                                            Lelaki
                                        </button>
                                        <button 
                                            type="button" 
                                            onClick={() => setGender('female')}
                                            className={`flex-1 rounded-2xl border transition-all duration-300 text-[10px] font-black uppercase tracking-widest ${gender === 'female' ? 'bg-premium-primary text-white border-premium-primary shadow-premium-md' : 'bg-white text-premium-muted border-premium-border hover:bg-premium-bg'}`}
                                        >
                                            Perempuan
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <NeuTextArea 
                                label="Alamat Kediaman"
                                placeholder="No 123, Jalan Mewah, 25000 Kuantan, Pahang"
                                value={address}
                                onChange={(e) => setAddress(e.target.value)}
                                required
                            />
                        </div>

                        {/* Professional Information Section */}
                        <div className="space-y-6">
                            <div className="flex items-center gap-3 border-b border-premium-border/50 pb-4">
                                <Building2 className="w-4 h-4 text-premium-accent" />
                                <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-premium-primary">Maklumat Perjawatan</h3>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <label className="ml-1 text-[11px] font-black text-premium-muted uppercase tracking-[0.2em]">Cawangan Bertugas</label>
                                    <select
                                        value={branch}
                                        onChange={(e) => setBranch(e.target.value)}
                                        className="w-full bg-white rounded-2xl border border-premium-border px-5 py-4 text-sm font-medium text-premium-primary focus:outline-none focus:ring-4 focus:ring-premium-accent/5 focus:border-premium-accent transition-all appearance-none cursor-pointer"
                                        title="Pilih Cawangan"
                                        required
                                    >
                                        <option value="" disabled>Pilih Cawangan</option>
                                        {Object.entries(branchConfig).map(([site, branches]) => branches.length > 0 && (
                                            <optgroup key={site} label={site.toUpperCase()} className="font-black text-[10px] tracking-widest">
                                                {branches.map(b => (
                                                    <option key={b} value={b}>{b}</option>
                                                ))}
                                            </optgroup>
                                        ))}
                                    </select>
                                </div>

                                <div className="space-y-2">
                                    <label className="ml-1 text-[11px] font-black text-premium-muted uppercase tracking-[0.2em]">Kategori Perjawatan</label>
                                    <select
                                        value={staffType}
                                        onChange={(e) => setStaffType(e.target.value as any)}
                                        className="w-full bg-white rounded-2xl border border-premium-border px-5 py-4 text-sm font-medium text-premium-primary focus:outline-none focus:ring-4 focus:ring-premium-accent/5 focus:border-premium-accent transition-all appearance-none cursor-pointer"
                                        title="Kategori Staff"
                                        required
                                    >
                                        <option value="operation_staff">STAFF OPERASI</option>
                                        <option value="admin_staff">STAFF PENTADBIRAN</option>
                                        <option value="doctor">DOKTOR RASMI</option>
                                    </select>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <NeuInput 
                                    label="Tarikh Mula Berkhidmat"
                                    type="date"
                                    value={joinDate}
                                    onChange={(e) => setJoinDate(e.target.value)}
                                    required
                                />
                                <NeuInput 
                                    label="Kata Laluan Keselamatan"
                                    type="password"
                                    placeholder="••••••••"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                />
                            </div>
                        </div>

                        {error && (
                            <div className="flex items-center gap-3 p-5 bg-red-50 text-red-600 rounded-[1.5rem] text-[11px] font-black uppercase tracking-wider border border-red-100 animate-shake shadow-premium-sm">
                                <AlertCircle className="w-5 h-5 shrink-0" />
                                {error}
                            </div>
                        )}

                        <div className="pt-4">
                            <NeuButton
                                type="submit"
                                variant="gold"
                                className="w-full py-5 text-sm font-black uppercase tracking-[0.4em] rounded-[1.5rem] shadow-luxury-gold/20 flex items-center justify-center gap-4"
                                disabled={loading}
                            >
                                {loading ? (
                                    <Activity className="w-6 h-6 animate-spin" />
                                ) : (
                                    <>
                                        Daftar Keahlian Rasmi
                                        <ShieldCheck className="w-5 h-5" />
                                    </>
                                )}
                            </NeuButton>
                            <p className="text-center mt-6 text-[9px] font-bold text-premium-muted uppercase tracking-widest leading-relaxed">
                                Dengan mendaftar, anda bersetuju dengan segala <br /> terma dan syarat pengurusan data Klinik Syed Badaruddin.
                            </p>
                        </div>
                    </form>
                </NeuCard>

                {/* Footer Brand */}
                <div className="text-center mt-12 space-y-4">
                    <div className="flex items-center justify-center gap-3">
                        <div className="w-8 h-[1px] bg-premium-border"></div>
                        <p className="text-[10px] font-black text-premium-muted uppercase tracking-[0.2em]">KSB Luxury System v2.0</p>
                        <div className="w-8 h-[1px] bg-premium-border"></div>
                    </div>
                </div>
            </div>
        </div>
    );
};
