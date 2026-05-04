import React from 'react';
import { NeuCard } from './NeuElements';
import { BookOpen, AlertCircle, Clock, Heart, Users, Calendar, ShieldCheck, Monitor, MessageSquare } from 'lucide-react';
import { Staff, LeaveLog, PAHANG_BRANCHES, TERENGGANU_BRANCHES } from '../types';
import { calculateEntitlement } from '../services/firebase';

interface PolicyViewProps {
    user?: Staff | null;
    logs?: LeaveLog[];
}

export const PolicyView: React.FC<PolicyViewProps> = ({ user, logs = [] }) => {
    const isPahang = PAHANG_BRANCHES.includes(user?.branch || '');
    const isTerengganu = TERENGGANU_BRANCHES.includes(user?.branch || '');
    const userSite = isPahang ? 'Pahang' : isTerengganu ? 'Terengganu' : '';

    const entitlement = user ? calculateEntitlement(user) : 0;
    const carryForward = (user as any)?.prevYearBalance ?? 0;
    const currentMonth = new Date().getMonth() + 1;
    const monthName = new Date().toLocaleString('ms-MY', { month: 'long' });
    const currentYear = new Date().getFullYear();
    const joinDateStr = (user as any)?.joinDate;
    const joinDate = joinDateStr ? new Date(joinDateStr) : null;
    let startMonth = 1;
    if (joinDate && joinDate.getFullYear() === currentYear) {
        startMonth = joinDate.getMonth() + 1;
    }
    const monthsThisYear = Math.max(0, currentMonth - startMonth + 1);

    const rawProrate = (entitlement * monthsThisYear) / 12;
    // Round to 2 decimals for fairness as requested
    const proRatedAllocation = Number(rawProrate.toFixed(2)) + carryForward;

    const usedAL = logs
        .filter(l =>
            user && l.staffId.replace(/-/g, '') === user.id.replace(/-/g, '') &&
            l.type === 'AL' &&
            (l.status === 'approved' || l.status === 'hod_approved' || l.status === 'hr_approved' || l.status === 'pending') &&
            new Date(l.startDate).getFullYear() === currentYear
        )
        .reduce((sum, l) => sum + l.duration, 0);
    const availableAL = Math.max(0, proRatedAllocation - usedAL);
    const proRatePerMonth = (entitlement / 12).toFixed(2);

    const leaveTerms = [
        { code: 'AL', label: 'Cuti Tahunan', color: 'bg-stone-100 text-stone-700 border-stone-200' },
        { code: 'MC', label: 'Cuti Sakit', color: 'bg-premium-bg text-premium-accent border-premium-accent/20' },
        { code: 'HL', label: 'Cuti Hospitalisasi', color: 'bg-stone-50 text-premium-primary border-premium-border/50' },
        { code: 'ML', label: 'Cuti Bersalin', color: 'bg-white text-luxury-gold border-luxury-gold/30' },
        { code: 'PL', label: 'Cuti Isteri Bersalin', color: 'bg-stone-100 text-stone-500 border-stone-200' },
        { code: 'EL', label: 'Cuti Kecemasan', color: 'bg-premium-bg text-red-600 border-red-100' },
        { code: 'BL', label: 'Cuti Ihsan', color: 'bg-stone-50 text-stone-600 border-stone-200' },
        { code: 'RL', label: 'Cuti Ganti', color: 'bg-white text-premium-accent border-premium-accent/40' },
        { code: 'UL', label: 'Cuti Tanpa Gaji', color: 'bg-stone-200 text-stone-700 border-stone-300' },
        { code: 'CME', label: 'Cuti CME', color: 'bg-premium-bg text-premium-primary border-premium-border' },
    ];

    return (
        <div className="animate-fade-in space-y-8 w-full max-w-4xl mx-auto">
            <h2 className="text-2xl font-bold text-premium-primary flex items-center gap-3 border-b border-premium-border/50 pb-4 font-luxury uppercase tracking-widest">
                <BookOpen className="w-8 h-8 text-premium-accent" />
                Rujukan Polisi &amp; Garis Panduan Cuti
            </h2>

            {/* === TERMINOLOGY LEGEND CARD === */}
            <NeuCard className="p-6 bg-premium-bg/50 border-premium-border/50">
                <p className="text-[10px] font-black text-premium-muted uppercase tracking-widest mb-4 flex items-center gap-2">
                    <span>📋</span> Senarai Singkatan Jenis Cuti — Rujukan HR
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {leaveTerms.map(({ code, label, color }) => (
                        <div key={code} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border ${color} shadow-sm`}>
                            <span className="text-sm font-black min-w-[28px]">{code}</span>
                            <span className="text-[11px] font-bold leading-tight">{label}</span>
                        </div>
                    ))}
                </div>
            </NeuCard>

            <NeuCard className="p-8 border-premium-border/50">
                <div className="flex items-center gap-3 mb-6 border-b border-premium-border/30 pb-4 font-luxury">
                    <Calendar className="w-6 h-6 text-premium-accent" />
                    <h3 className="font-bold text-premium-primary uppercase tracking-widest text-lg">1. Cuti Tahunan (Annual Leave)</h3>
                </div>
                <ul className="list-none mb-8 space-y-3 text-sm font-medium text-premium-text">
                    <li className="flex items-start gap-2">
                        <span className="text-luxury-gold font-bold mt-0.5">•</span>
                        <span>Permohonan mesti dibuat sekurang-kurangnya <strong>3 hari</strong> lebih awal.</span>
                    </li>
                    <li className="flex items-start gap-2">
                        <span className="text-luxury-gold font-bold mt-0.5">•</span>
                        <span>Kelulusan dijanjikan berdasarkan operasi semasa klinik dan merupakan budi bicara pengurusan / HOD (tidak menghalang kelancaran operasi klinik).</span>
                    </li>
                    <li className="flex items-start gap-2">
                        <span className="text-luxury-gold font-bold mt-0.5">•</span>
                        <span>Baki cuti hanya boleh dibawa ke hadapan maksimum <strong>3 hari</strong> sahaja untuk tahun berikutnya. Baki lebihan akan dilupuskan secara automatik.</span>
                    </li>
                </ul>

                {/* Entitlement table */}
                <div className="mb-8">
                    <p className="text-xs font-black text-gray-400 uppercase tracking-widest mb-3">
                        Kelayakan Cuti Tahunan Bergaji
                        {userSite && <span className="text-premium-accent"> ({userSite})</span>}
                    </p>

                    {!userSite ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div>
                                <p className="text-[10px] font-black text-luxury-gold uppercase mb-2">Pahang Site</p>
                                <table className="w-full border-collapse text-sm">
                                    <thead>
                                        <tr className="bg-stone-50/60">
                                            <th className="border border-stone-200 p-3 text-left text-xs font-black text-stone-700 uppercase tracking-wider">Perkhidmatan</th>
                                            <th className="border border-stone-200 p-3 text-center text-xs font-black text-stone-700 uppercase tracking-wider">Hari</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-stone-100 font-medium text-stone-600">
                                        <tr><td className="border border-stone-200 p-3">1–2 Thn</td><td className="border border-stone-200 p-3 text-center font-black text-luxury-gold">8</td></tr>
                                        <tr><td className="border border-stone-200 p-3">2–5 Thn</td><td className="border border-stone-200 p-3 text-center font-black text-luxury-gold">12</td></tr>
                                        <tr><td className="border border-stone-200 p-3">5+ Thn</td><td className="border border-stone-200 p-3 text-center font-black text-luxury-gold">20</td></tr>
                                    </tbody>
                                </table>
                            </div>
                            <div>
                                <p className="text-[10px] font-black text-premium-accent uppercase mb-2">Terengganu Site</p>
                                <table className="w-full border-collapse text-sm">
                                    <thead>
                                        <tr className="bg-stone-50/60">
                                            <th className="border border-stone-200 p-3 text-left text-xs font-black text-stone-700 uppercase tracking-wider">Perkhidmatan</th>
                                            <th className="border border-stone-200 p-3 text-center text-xs font-black text-stone-700 uppercase tracking-wider">Hari</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-stone-100 font-medium text-stone-600">
                                        <tr><td className="border border-stone-200 p-3">1–2 Thn</td><td className="border border-stone-200 p-3 text-center font-black text-premium-accent">8</td></tr>
                                        <tr><td className="border border-stone-200 p-3">2–5 Thn</td><td className="border border-stone-200 p-3 text-center font-black text-premium-accent">12</td></tr>
                                        <tr><td className="border border-stone-200 p-3">5+ Thn</td><td className="border border-stone-200 p-3 text-center font-black text-premium-accent">16</td></tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    ) : (
                        <table className="w-full border-collapse text-sm border border-premium-border/50">
                            <thead>
                                <tr className="bg-stone-50/60">
                                    <th className="border border-premium-border/50 p-3 text-left text-xs font-black text-premium-primary uppercase tracking-wider">Tempoh Perkhidmatan</th>
                                    <th className="border border-premium-border/50 p-3 text-center text-xs font-black text-premium-primary uppercase tracking-wider">Bilangan Hari</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-stone-100 font-medium text-stone-600">
                                <tr className="hover:bg-stone-50/30 transition-colors">
                                    <td className="border border-premium-border/50 p-3">a)&nbsp; 1 – 2 Tahun</td>
                                    <td className="border border-premium-border/50 p-3 text-center font-black text-luxury-gold">8 Hari</td>
                                </tr>
                                <tr className="hover:bg-stone-50/30 transition-colors">
                                    <td className="border border-premium-border/50 p-3">b)&nbsp; 2 – 5 Tahun</td>
                                    <td className="border border-premium-border/50 p-3 text-center font-black text-luxury-gold">12 Hari</td>
                                </tr>
                                <tr className="hover:bg-stone-50/30 transition-colors">
                                    <td className="border border-premium-border/50 p-3">c)&nbsp; 5 Tahun Ke Atas</td>
                                    <td className="border border-premium-border/50 p-3 text-center font-black text-luxury-gold">
                                        {isPahang ? '20 Hari' : '16 Hari'}
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    )}
                    <p className="text-[10px] text-red-500 font-bold mt-4 italic">* Tiada cuti tahunan semasa dalam tempoh percubaan.</p>
                </div>

                {/* Pro-Rata Formula Card */}
                {user && (
                    <div className="mb-8 rounded-2xl bg-stone-50 border border-premium-border/50 p-6 space-y-4">
                        <p className="text-xs font-black text-premium-accent uppercase tracking-widest">📐 Formula Pengiraan Pro-Rata</p>
                        <p className="text-sm text-premium-muted font-medium">Untuk mendapatkan jumlah cuti yang layak bagi setiap bulan bekerja:</p>

                        <div className="flex items-center justify-center gap-4 py-4">
                            <div className="text-center">
                                <p className="text-sm font-black text-premium-primary">Cuti Pro-Rata Sebulan</p>
                            </div>
                            <span className="text-2xl font-black text-luxury-gold">=</span>
                            <div className="text-center border-t-2 border-premium-primary px-4">
                                <p className="text-sm font-black text-premium-primary">Kelayakan Cuti Setahun</p>
                                <div className="border-t-2 border-premium-primary mt-1 pt-1">
                                    <p className="text-sm font-black text-premium-primary">12 Bulan</p>
                                </div>
                            </div>
                        </div>

                        <div className="bg-white rounded-xl p-4 border border-premium-border/30 shadow-premium-sm">
                            <p className="text-xs font-black text-premium-muted uppercase tracking-widest mb-3">📊 Bagi Kes Anda ({monthName} {currentYear})</p>
                            <div className="grid grid-cols-2 gap-3 text-sm">
                                <div>
                                    <p className="text-[10px] font-black text-premium-muted uppercase tracking-wider">Kelayakan Setahun</p>
                                    <p className="text-2xl font-bold text-premium-primary font-luxury">{entitlement} <span className="text-sm font-bold text-premium-muted">hari</span></p>
                                </div>
                                <div>
                                    <p className="text-[10px] font-black text-premium-muted uppercase tracking-wider">Pro-Rata Sebulan</p>
                                    <p className="text-2xl font-bold text-premium-accent font-luxury">{proRatePerMonth} <span className="text-sm font-bold text-premium-muted">hari</span></p>
                                </div>
                                <div>
                                    <p className="text-[10px] font-black text-premium-muted uppercase tracking-wider">Terkumpul ({monthsThisYear} bulan) + Bawa Hadapan</p>
                                    <p className="text-2xl font-bold text-premium-primary font-luxury">{proRatedAllocation} <span className="text-sm font-bold text-premium-muted">hari</span></p>
                                </div>
                                <div>
                                    <p className="text-[10px] font-black text-premium-muted uppercase tracking-wider">Baki Tersedia Sekarang</p>
                                    <p className="text-2xl font-bold text-luxury-gold font-luxury">{availableAL} <span className="text-sm font-bold text-premium-muted">hari</span></p>
                                </div>
                            </div>
                            <p className="text-[10px] text-premium-accent font-bold mt-3 italic text-right">
                                {entitlement} hari ÷ 12 × {monthsThisYear} bulan + {carryForward} bawa hadapan − {usedAL} digunakan = {availableAL} hari
                            </p>
                        </div>
                    </div>
                )}

                <div className="flex items-center gap-3 mb-6 border-b border-premium-border/30 pb-4 font-luxury">
                    <AlertCircle className="w-6 h-6 text-premium-accent" />
                    <h3 className="font-bold text-premium-primary uppercase tracking-widest text-lg">2. Cuti Sakit (Medical Leave)</h3>
                </div>
                <ul className="list-none mb-8 space-y-3 text-sm font-medium text-premium-text">
                    <li className="flex items-start gap-2">
                        <span className="text-premium-accent font-bold mt-0.5">•</span>
                        <span>Mesti disertakan dengan Sijil Sakit (MC) yang sah dari klinik atau hospital yang diiktiraf.</span>
                    </li>
                    <li className="flex items-start gap-2">
                        <span className="text-premium-accent font-bold mt-0.5">•</span>
                        <span>Kakitangan WAJIB memaklumkan kepada HOD/PIC secepat mungkin sebelum waktu bekerja bermula.</span>
                    </li>
                    <li className="flex items-start gap-2">
                        <span className="text-premium-accent font-bold mt-0.5">•</span>
                        <span>Permohonan rasmi di dalam sistem perlu dibuat sebaik sahaja kakitangan kembali bertugas.</span>
                    </li>
                </ul>

                <div className="flex items-center gap-3 mb-6 border-b border-premium-border/30 pb-4 font-luxury">
                    <Heart className="w-6 h-6 text-luxury-gold" />
                    <h3 className="font-bold text-premium-primary uppercase tracking-widest text-lg">3. Cuti Ehsan & Cuti Kecemasan</h3>
                </div>

                <div className="overflow-x-auto mb-8">
                    <table className="w-full text-left border-collapse text-sm">
                        <thead>
                            <tr className="bg-rose-50/50">
                                <th className="border border-rose-100 p-4 text-xs font-black text-rose-700 uppercase tracking-widest">Ciri-Ciri</th>
                                <th className="border border-rose-100 p-4 text-xs font-black text-rose-700 uppercase tracking-widest">Cuti Ehsan (Compassionate)</th>
                                <th className="border border-rose-100 p-4 text-xs font-black text-rose-700 uppercase tracking-widest">Cuti Kecemasan (Emergency / EL)</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-rose-50 font-medium text-premium-text">
                            <tr className="hover:bg-rose-50/20 transition-colors">
                                <td className="border border-rose-100 p-4 font-black text-premium-primary">Tujuan</td>
                                <td className="border border-rose-100 p-4">Kematian ahli keluarga terdekat atau bencana alam (kebakaran).</td>
                                <td className="border border-rose-100 p-4">Perkara luar jangka (kereta rosak, urusan keluarga mengejut, banjir).</td>
                            </tr>
                            <tr className="hover:bg-rose-50/20 transition-colors">
                                <td className="border border-rose-100 p-4 font-black text-premium-primary">Kesan pada AL</td>
                                <td className="border border-rose-100 p-4"><strong className="text-rose-600 text-xs font-black uppercase">Tidak menolak</strong> baki cuti tahunan (cuti percuma).</td>
                                <td className="border border-rose-100 p-4"><strong className="text-premium-primary text-xs font-black uppercase underline">Menolak</strong> baki cuti tahunan (AL).</td>
                            </tr>
                            <tr className="hover:bg-rose-50/20 transition-colors">
                                <td className="border border-rose-100 p-4 font-black text-premium-primary">Dokumen</td>
                                <td className="border border-rose-100 p-4">Perlu (Sijil kematian atau laporan polis / gambar bencana).</td>
                                <td className="border border-rose-100 p-4">Bergantung pada budi bicara (biasanya tidak perlu, atau bukti ringkas sahaja).</td>
                            </tr>
                            <tr className="hover:bg-rose-50/20 transition-colors">
                                <td className="border border-rose-100 p-4 font-black text-premium-primary">Had Hari</td>
                                <td className="border border-rose-100 p-4">3 hari bagi setiap kes.</td>
                                <td className="border border-rose-100 p-4">Selagi baki cuti tahunan (AL) masih ada.</td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div className="bg-pink-50/30 rounded-2xl p-6 border border-pink-100 mb-8">
                    <p className="text-[10px] font-black text-pink-400 uppercase tracking-widest mb-3">Syarat Tambahan Cuti Ehsan</p>
                    <ul className="list-none space-y-2 text-[11px] font-bold text-pink-800/80 leading-relaxed uppercase tracking-tighter">
                        <li className="flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-pink-400 flex-shrink-0"></span>
                            <span>Ahli keluarga terdekat terhad kepada: Ibu, Bapa, Suami/Isteri, dan Anak Kandung sahaja.</span>
                        </li>
                        <li className="flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-pink-400 flex-shrink-0"></span>
                            <span>Salinan Sijil Kematian wajib dimuat naik ke sistem untuk tujuan audit akaun perkhidmatan.</span>
                        </li>
                    </ul>
                </div>

                <div className="flex items-center gap-3 mb-6 border-b border-premium-border/30 pb-4 font-luxury">
                    <Users className="w-6 h-6 text-premium-accent" />
                    <h3 className="font-bold text-premium-primary uppercase tracking-widest text-lg">4. Cuti Tanpa Gaji (Unpaid Leave)</h3>
                </div>
                <ul className="list-none mb-8 space-y-3 text-sm font-medium text-premium-text">
                    <li className="flex items-start gap-2">
                        <span className="text-premium-accent font-bold mt-0.5">•</span>
                        <span>Hanya dibenarkan atau dinilai kelulusan apabila kesemua baki Cuti Tahunan (AL) pekerja telah dihabiskan atau berbaki 0 hari.</span>
                    </li>
                    <li className="flex items-start gap-2">
                        <span className="text-premium-accent font-bold mt-0.5">•</span>
                        <span>Gaji bulanan kakitangan akan ditolak secara pro-rata berdasarkan rekod jumlah hari cuti tanpa gaji yang diambil dalam bulan tersebut.</span>
                    </li>
                </ul>


                <div className="flex items-center gap-3 mt-10 mb-6 border-b pb-4">
                    <Calendar className="w-6 h-6 text-premium-accent" />
                    <h3 className="font-black text-premium-primary uppercase tracking-widest text-lg font-luxury">
                        6. Jadual Cuti Umum 2026 {userSite && <span className="text-premium-accent">({userSite})</span>}
                    </h3>
                </div>

                <div className="overflow-x-auto mb-8">
                    {userSite === 'Terengganu' ? (
                        <>
                            <table className="w-full text-left border-collapse min-w-[600px] border border-premium-border/50">
                                <thead>
                                    <tr className="bg-premium-bg border-b-2 border-premium-border/50">
                                        <th className="p-4 text-xs font-black text-gray-600 uppercase tracking-widest text-center w-12">Bil</th>
                                        <th className="p-4 text-xs font-black text-gray-600 uppercase tracking-widest">Tarikh Cuti</th>
                                        <th className="p-4 text-xs font-black text-gray-600 uppercase tracking-widest">Hari Kelepasan AM</th>
                                        <th className="p-4 text-xs font-black text-gray-600 uppercase tracking-widest">Hari</th>
                                        <th className="p-4 text-xs font-black text-gray-600 uppercase tracking-widest text-center w-24">Bil Hari</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-premium-border/30 text-sm font-medium text-premium-text">
                                    <tr className="hover:bg-gray-50/50">
                                        <td className="p-4 text-center">1</td>
                                        <td className="p-4 font-bold text-premium-primary">17-Feb</td>
                                        <td className="p-4 uppercase">TAHUN BARU CINA</td>
                                        <td className="p-4">Selasa</td>
                                        <td className="p-4 text-center font-bold">1</td>
                                    </tr>
                                    <tr className="hover:bg-gray-50/50">
                                        <td className="p-4 text-center">2</td>
                                        <td className="p-4 font-bold text-premium-primary">21-Mar s/d 25-Mar</td>
                                        <td className="p-4 uppercase underline font-black">HARI RAYA AIDILFITRI @</td>
                                        <td className="p-4">Sabtu - Rabu</td>
                                        <td className="p-4 text-center font-bold">5</td>
                                    </tr>
                                    <tr className="hover:bg-gray-50/50">
                                        <td className="p-4 text-center">3</td>
                                        <td className="p-4 font-bold text-premium-primary">26-Apr</td>
                                        <td className="p-4 uppercase">KEPUTERAAN SULTAN TERENGGANU</td>
                                        <td className="p-4">Ahad</td>
                                        <td className="p-4 text-center font-bold">1</td>
                                    </tr>
                                    <tr className="hover:bg-gray-50/50">
                                        <td className="p-4 text-center">4</td>
                                        <td className="p-4 font-bold text-premium-primary">1-May</td>
                                        <td className="p-4 uppercase">HARI PEKERJA</td>
                                        <td className="p-4">Jumaat</td>
                                        <td className="p-4 text-center font-bold">1</td>
                                    </tr>
                                    <tr className="hover:bg-gray-50/50">
                                        <td className="p-4 text-center">5</td>
                                        <td className="p-4 font-bold text-premium-primary">27-May s/d 29-May</td>
                                        <td className="p-4 uppercase underline font-black">HARI RAYA AIDILADHA @</td>
                                        <td className="p-4">Rabu - Jumaat</td>
                                        <td className="p-4 text-center font-bold">3</td>
                                    </tr>
                                    <tr className="hover:bg-gray-50/50">
                                        <td className="p-4 text-center">6</td>
                                        <td className="p-4 font-bold text-premium-primary">1-Jun</td>
                                        <td className="p-4 uppercase">HARI KEPUTERAAN AGONG</td>
                                        <td className="p-4">Isnin</td>
                                        <td className="p-4 text-center font-bold">1</td>
                                    </tr>
                                    <tr className="hover:bg-gray-50/50">
                                        <td className="p-4 text-center">7</td>
                                        <td className="p-4 font-bold text-premium-primary">17-Jun</td>
                                        <td className="p-4 uppercase">AWAL MUHARRAM</td>
                                        <td className="p-4">Rabu</td>
                                        <td className="p-4 text-center font-bold">1</td>
                                    </tr>
                                    <tr className="hover:bg-gray-50/50">
                                        <td className="p-4 text-center">8</td>
                                        <td className="p-4 font-bold text-premium-primary">25-Aug</td>
                                        <td className="p-4 uppercase">MAULIDUR RASUL</td>
                                        <td className="p-4">Selasa</td>
                                        <td className="p-4 text-center font-bold">1</td>
                                    </tr>
                                    <tr className="hover:bg-gray-50/50">
                                        <td className="p-4 text-center">9</td>
                                        <td className="p-4 font-bold text-premium-primary">31-Aug</td>
                                        <td className="p-4 uppercase">HARI KEBANGSAAN</td>
                                        <td className="p-4">Isnin</td>
                                        <td className="p-4 text-center font-bold">1</td>
                                    </tr>
                                    <tr className="hover:bg-gray-50/50">
                                        <td className="p-4 text-center">10</td>
                                        <td className="p-4 font-bold text-premium-primary">16-Sep</td>
                                        <td className="p-4 uppercase">HARI MALAYSIA</td>
                                        <td className="p-4">Rabu</td>
                                        <td className="p-4 text-center font-bold">1</td>
                                    </tr>
                                    <tr className="bg-premium-accent/5">
                                        <td colSpan={4} className="p-4 text-right font-black text-premium-primary uppercase tracking-widest text-sm">JUMLAH HARI (TERENGGANU)</td>
                                        <td className="p-4 text-center font-black text-premium-accent text-lg">16</td>
                                    </tr>
                                </tbody>
                            </table>
                            <div className="mt-4 space-y-1">
                                <p className="text-[10px] text-gray-400 font-bold italic">* Hari cuti yang jatuh pada hari Sabtu akan diganti pada hari Ahad - kakitangan pentadbiran</p>
                                <p className="text-[10px] text-gray-400 font-bold italic">* Hari cuti yang jatuh pada hari Jumaat tidak akan digantikan - kakitangan pentadbiran</p>
                                <p className="text-[10px] text-premium-accent font-bold italic">@ Perubahan cuti Hari Raya Puasa & Qurban tertakluk kepada budi bicara</p>
                            </div>
                        </>
                    ) : (
                        <table className="w-full text-left border-collapse min-w-[600px] border border-premium-border/50">
                            <thead>
                                <tr className="bg-premium-bg border-b-2 border-premium-border/50">
                                    <th className="p-4 text-xs font-black text-gray-600 uppercase tracking-widest text-center w-12">Bil</th>
                                    <th className="p-4 text-xs font-black text-gray-600 uppercase tracking-widest">Tarikh Cuti</th>
                                    <th className="p-4 text-xs font-black text-gray-600 uppercase tracking-widest">Hari Kelepasan AM</th>
                                    <th className="p-4 text-xs font-black text-gray-600 uppercase tracking-widest">Hari</th>
                                    <th className="p-4 text-xs font-black text-gray-600 uppercase tracking-widest text-center w-24">Bil Hari</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-premium-border/30 text-sm font-medium text-premium-text">
                                <tr className="hover:bg-gray-50/50">
                                    <td className="p-4 text-center">1</td>
                                    <td className="p-4 font-bold text-premium-primary">1-Jan</td>
                                    <td className="p-4 uppercase">TAHUN BARU</td>
                                    <td className="p-4">Khamis</td>
                                    <td className="p-4 text-center font-bold">1</td>
                                </tr>
                                <tr className="hover:bg-gray-50/50">
                                    <td className="p-4 text-center">2</td>
                                    <td className="p-4 font-bold text-premium-primary">17-Feb</td>
                                    <td className="p-4 uppercase">TAHUN BARU CINA</td>
                                    <td className="p-4">Selasa</td>
                                    <td className="p-4 text-center font-bold">1</td>
                                </tr>
                                <tr className="hover:bg-gray-50/50">
                                    <td className="p-4 text-center">3</td>
                                    <td className="p-4 font-bold text-premium-primary">21-Mar s/d 24-Mar</td>
                                    <td className="p-4 uppercase underline font-black">HARI RAYA AIDILFITRI @</td>
                                    <td className="p-4">Sabtu - Selasa</td>
                                    <td className="p-4 text-center font-bold">4</td>
                                </tr>
                                <tr className="hover:bg-gray-50/50">
                                    <td className="p-4 text-center">4</td>
                                    <td className="p-4 font-bold text-premium-primary">1-May</td>
                                    <td className="p-4 uppercase">HARI PEKERJA</td>
                                    <td className="p-4">Jumaat</td>
                                    <td className="p-4 text-center font-bold">1</td>
                                </tr>
                                <tr className="hover:bg-gray-50/50">
                                    <td className="p-4 text-center">5</td>
                                    <td className="p-4 font-bold text-premium-primary">27-May s/d 28-May</td>
                                    <td className="p-4 uppercase underline font-black">HARI RAYA AIDILADHA @</td>
                                    <td className="p-4">Rabu - Khamis</td>
                                    <td className="p-4 text-center font-bold">2</td>
                                </tr>
                                <tr className="hover:bg-gray-50/50">
                                    <td className="p-4 text-center">6</td>
                                    <td className="p-4 font-bold text-premium-primary">1-Jun</td>
                                    <td className="p-4 uppercase flex flex-col">HARI KEPUTERAAN YDP <span>AGONG</span></td>
                                    <td className="p-4">Isnin</td>
                                    <td className="p-4 text-center font-bold">1</td>
                                </tr>
                                <tr className="hover:bg-gray-50/50">
                                    <td className="p-4 text-center">7</td>
                                    <td className="p-4 font-bold text-premium-primary">31-Jul</td>
                                    <td className="p-4 uppercase flex flex-col">KEPUTERAAN SULTAN <span>PAHANG</span></td>
                                    <td className="p-4">Jumaat</td>
                                    <td className="p-4 text-center font-bold">1</td>
                                </tr>
                                <tr className="hover:bg-gray-50/50">
                                    <td className="p-4 text-center">8</td>
                                    <td className="p-4 font-bold text-premium-primary">25-Aug</td>
                                    <td className="p-4 uppercase">MAULIDUR RASUL</td>
                                    <td className="p-4">Selasa</td>
                                    <td className="p-4 text-center font-bold">1</td>
                                </tr>
                                <tr className="hover:bg-gray-50/50">
                                    <td className="p-4 text-center">9</td>
                                    <td className="p-4 font-bold text-premium-primary">31-Aug</td>
                                    <td className="p-4 uppercase">HARI KEBANGSAAN</td>
                                    <td className="p-4">Isnin</td>
                                    <td className="p-4 text-center font-bold">1</td>
                                </tr>
                                <tr className="hover:bg-gray-50/50">
                                    <td className="p-4 text-center">10</td>
                                    <td className="p-4 font-bold text-premium-primary">16-Sep</td>
                                    <td className="p-4 uppercase">HARI MALAYSIA</td>
                                    <td className="p-4">Rabu</td>
                                    <td className="p-4 text-center font-bold">1</td>
                                </tr>
                                <tr className="hover:bg-gray-50/50 border-b-2 border-gray-200">
                                    <td className="p-4 text-center">11</td>
                                    <td className="p-4 font-bold text-premium-primary">25-Dec</td>
                                    <td className="p-4 uppercase">HARI KRISMAS</td>
                                    <td className="p-4">Jumaat</td>
                                    <td className="p-4 text-center font-bold">1</td>
                                </tr>
                                <tr className="bg-premium-accent/5">
                                    <td colSpan={4} className="p-4 text-right font-black text-premium-primary uppercase tracking-widest text-sm">JUMLAH HARI (PAHANG)</td>
                                    <td className="p-4 text-center font-black text-premium-accent text-lg">15</td>
                                </tr>
                            </tbody>
                        </table>
                    )}
                    <p className="text-xs text-gray-400 font-bold mt-4 italic">@ Tertakluk kepada perubahan budi bicara pengurusan</p>
                </div>
                <div className="flex items-center gap-3 mt-10 mb-6 border-b pb-4">
                    <ShieldCheck className="w-6 h-6 text-premium-accent" />
                    <h3 className="font-black text-premium-primary uppercase tracking-widest text-lg font-luxury">7. Kawalan Keselamatan &amp; Sesi (Login Control)</h3>
                </div>

                <div className="space-y-6 mb-8 text-sm font-medium text-premium-text">
                    <div className="bg-premium-bg/50 p-6 rounded-2xl border border-premium-border/50 space-y-4">
                        <div className="flex items-center gap-2 mb-2">
                            <Monitor className="w-5 h-5 text-premium-accent" />
                            <p className="text-[11px] font-black text-premium-accent uppercase tracking-widest">Satu ID, Satu Peranti (Single Device Session)</p>
                        </div>
                        <p className="text-[11px] font-black text-premium-primary flex items-center gap-2">Sistem kini akan memantau ID pengguna secara masa-nyata:</p>
                        <ul className="list-none space-y-3 pl-2">
                            <li className="flex items-start gap-2">
                                <span className="text-premium-accent font-bold mt-0.5">1.</span>
                                <span>Setiap kali seseorang log masuk, satu <strong className="text-premium-primary border-b border-premium-border">"Session ID" unik</strong> akan dijana dan disimpan dalam rekod pengguna tersebut.</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-premium-accent font-bold mt-0.5">2.</span>
                                <span><strong>Pengesan Konflik:</strong> Jika ID yang sama digunakan untuk log masuk pada peranti kedua (contoh: telefon lain atau komputer lain), peranti pertama akan mengesan perubahan tersebut secara automatik.</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-premium-accent font-bold mt-0.5">3.</span>
                                <span><strong>Amaran &amp; Log Keluar Serta-merta:</strong> Peranti yang sedang aktif akan memaparkan amaran: <strong className="text-red-500">"⚠️ AKSES DITOLAK: Akaun anda telah log masuk di peranti lain..."</strong> dan akan melog keluar pengguna tersebut secara serta-merta untuk melindungi keselamatan akaun anda.</span>
                            </li>
                        </ul>
                    </div>

                    <div className="bg-premium-bg/50 p-6 rounded-2xl border border-premium-border/50 space-y-4">
                        <div className="flex items-center gap-2 mb-2">
                            <Clock className="w-5 h-5 text-premium-accent" />
                            <p className="text-[11px] font-black text-premium-accent uppercase tracking-widest">Masa Tamat Sesi (Auto-Logout Out)</p>
                        </div>
                        <p className="text-sm font-medium text-premium-text">Tetapan masa tamat sesi telah dikemaskini bagi meningkatkan keselamatan dan efisiensi:</p>
                        <ul className="list-none space-y-3 pl-2">
                            <li className="flex items-start gap-2">
                                <span className="text-premium-accent font-bold mt-0.5">•</span>
                                <span><strong>Masa Tidak Aktif:</strong> Sistem kini akan menunggu selama <strong className="text-premium-primary">10 minit</strong> sebelum melog keluar secara automatik jika tiada aktiviti.</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-premium-accent font-bold mt-0.5">•</span>
                                <span><strong>Mesej Amaran:</strong> Notifikasi amaran akan dipaparkan seminit sebelum sesi tamat untuk membolehkan anda kekal log masuk.</span>
                            </li>
                        </ul>
                    </div>
                </div>

                <div className="mt-8 pt-6 border-t border-gray-100 text-center">
                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest leading-relaxed">
                        Pautan Live Utama: <br />
                        <span className="text-premium-accent select-all">https://ksbsb-leave-tracker-2c782.web.app</span>
                    </p>
                </div>

                <div className="flex items-center gap-3 mt-10 mb-6 border-b border-premium-border/30 pb-4 font-luxury">
                    <MessageSquare className="w-6 h-6 text-emerald-600" />
                    <h3 className="font-bold text-premium-primary uppercase tracking-widest text-lg">8. Notifikasi WhatsApp (Fonnte)</h3>
                </div>

                <div className="space-y-6 mb-8 text-sm font-medium text-stone-600">
                    <div className="bg-emerald-50/50 p-6 rounded-2xl border border-emerald-100 space-y-4">
                        <p className="text-[11px] font-black text-emerald-600 uppercase tracking-widest">Kenapa WhatsApp Belum Diterima?</p>
                        <p className="text-sm font-medium text-stone-600 italic">"Sistem sudah pun menghantar arahan ke Fonnte, tetapi mesej mungkin tersangkut (pending) jika telefon pengirim tidak disambungkan."</p>
                        <ul className="list-none space-y-3 pl-2 text-xs">
                            <li className="flex items-start gap-2">
                                <span className="text-emerald-500 font-bold mt-0.5">•</span>
                                <span>Pastikan telefon pengirim <strong className="text-stone-900">+60129444295</strong> telah disambungkan ke server Fonnte melalui imbasan QR.</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-emerald-500 font-bold mt-0.5">•</span>
                                <span>Pastikan nombor telefon staff di dalam bahagian <strong>"Staff Management"</strong> dimasukkan dengan betul (Contoh: 0123456789 atau 60123456789).</span>
                            </li>
                        </ul>
                    </div>

                    <div className="bg-emerald-50/50 p-6 rounded-2xl border border-emerald-100 space-y-4">
                        <p className="text-[11px] font-black text-emerald-600 uppercase tracking-widest">Triger Automatik:</p>
                        <ul className="list-disc pl-5 space-y-2 text-xs font-bold text-stone-600">
                            <li><strong className="text-emerald-700">Permohonan Baru:</strong> HOD akan menerima mesej WhatsApp sebaik sahaja staff menghantar borang cuti.</li>
                            <li><strong className="text-emerald-700">Kelulusan HOD:</strong> Admin akan menerima notifikasi, dan Staff juga akan dimaklumkan bahawa permohonan kini sedang menunggu kelulusan akhir Admin.</li>
                            <li><strong className="text-emerald-700">Keputusan Akhir (Lulus/Tolak):</strong> Staff akan menerima mesej pengesahan secara terus sebaik sahaja keputusan dibuat oleh Admin/GM.</li>
                        </ul>
                    </div>

                    <div className="bg-emerald-50/50 p-6 rounded-2xl border border-emerald-100 space-y-4">
                        <p className="text-[11px] font-black text-emerald-600 uppercase tracking-widest">Kandungan Mesej:</p>
                        <p className="text-xs font-medium text-stone-600">Setiap mesej notifikasi merangkumi butiran penting:</p>
                        <ul className="list-none grid grid-cols-2 gap-2 pl-2 text-[10px] font-black text-stone-500 uppercase tracking-tight">
                            <li className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 bg-emerald-400 rounded-full"></div> Nama Pemohon</li>
                            <li className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 bg-emerald-400 rounded-full"></div> Jenis Cuti</li>
                            <li className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 bg-emerald-400 rounded-full"></div> Tarikh &amp; Tempoh</li>
                            <li className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 bg-emerald-400 rounded-full"></div> Sebab Cuti</li>
                        </ul>
                        <p className="text-[10px] text-emerald-600 font-bold italic mt-2">— Disertakan pautan (link) terus ke sistem untuk tindakan pantas.</p>
                    </div>

                    <div className="bg-stone-50/50 p-6 rounded-2xl border border-premium-border/50 space-y-4">
                        <p className="text-[11px] font-black text-luxury-gold uppercase tracking-widest">Langkah-langkah Penyediaan (Sekali sahaja):</p>
                        <ol className="list-decimal pl-5 space-y-3 text-xs font-bold text-stone-600">
                            <li><strong className="text-premium-primary">Daftar/Login di Fonnte:</strong> Pergi ke <a href="https://fonnte.com" target="_blank" rel="noopener noreferrer" className="text-luxury-gold underline">https://fonnte.com</a>.</li>
                            <li><strong className="text-premium-primary">Tambah Device:</strong> Di dalam Dashboard Fonnte, masukkan nombor telefon <strong className="text-stone-900 italic">0129444295</strong>.</li>
                            <li><strong className="text-premium-primary">Sambungkan Telefon (QR Code):</strong> 
                                <ul className="list-disc pl-5 mt-2 space-y-1 font-medium text-stone-500">
                                    <li>Fonnte akan memaparkan QR Code (seperti WhatsApp Web).</li>
                                    <li>Buka WhatsApp di telefon <strong className="text-stone-800">0129444295</strong>, pergi ke <em>Linked Devices &gt; Link a Device</em>, dan imbas QR code tersebut.</li>
                                </ul>
                            </li>
                            <li><strong className="text-premium-primary">Selesai:</strong> Pastikan status di dashboard Fonnte bertukar kepada <strong className="text-emerald-600 uppercase">"Connected"</strong>.</li>
                        </ol>
                    </div>
                </div>
            </NeuCard>
        </div>
    );
};
