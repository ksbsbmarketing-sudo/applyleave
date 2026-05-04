import React, { useMemo, useState } from 'react';
import {
    TrendingUp, Users, CheckCircle, XCircle, Clock,
    Award, BarChart2, Calendar, Filter, ArrowUp, Activity
} from 'lucide-react';
import { NeuCard } from './NeuElements';
import { Staff, LeaveLog } from '../types';

interface DashboardViewProps {
    staffList: Staff[];
    logs: LeaveLog[];
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ogo', 'Sep', 'Okt', 'Nov', 'Dis'];
const LEAVE_TYPES = ['AL', 'MC', 'CL', 'EL', 'PL', 'ML', 'CME', 'UL'];
const TYPE_COLORS: Record<string, string> = {
    AL: '#4f46e5',   // Indigo-600
    MC: '#6366f1',   // Indigo-500
    CL: '#3b82f6',   // Blue-500
    EL: '#0ea5e9',   // Sky-500
    PL: '#06b6d4',   // Cyan-500
    ML: '#14b8a6',   // Teal-500
    CME: '#0891b2',  // Cyan-600
    UL: '#94a3b8',   // Slate-400
};

/* ── Stat Card ─────────────────────────────────────────── */
function StatCard({ icon, label, value, sub, variant = 'accent' }: {
    icon: React.ReactNode; label: string; value: string | number;
    sub?: string; variant?: 'accent' | 'muted' | 'primary' | 'dark';
}) {
    const gradient = variant === 'primary' ? 'from-modern-primary to-slate-700' :
                   variant === 'dark' ? 'from-slate-800 to-black' :
                   variant === 'muted' ? 'from-modern-muted to-slate-400' :
                   'from-modern-accent to-indigo-500';
                   
    return (
        <div className={`rounded-3xl p-6 shadow-neu-md bg-white border border-modern-border/50 flex flex-col gap-3 relative overflow-hidden group hover:shadow-neu-lg transition-all duration-300`}>
            <div className={`absolute top-0 right-0 w-24 h-24 rounded-full bg-gradient-to-br ${gradient} opacity-[0.03] -translate-y-8 translate-x-8 group-hover:scale-110 transition-transform duration-500`} />
            <div className="flex items-start justify-between relative z-10">
                <div className={`p-2.5 bg-gradient-to-br ${gradient} rounded-2xl text-white shadow-neu-sm`}>{icon}</div>
                <div className="w-6 h-6 rounded-full bg-modern-bg flex items-center justify-center border border-modern-border/50">
                    <ArrowUp className="w-3 h-3 text-modern-accent" />
                </div>
            </div>
            <div className="relative z-10 mt-1">
                <p className="text-3xl font-black text-modern-primary tabular-nums tracking-tight">{value}</p>
                <p className="text-[11px] font-black text-modern-muted uppercase tracking-wider mt-1">{label}</p>
                {sub && <p className="text-[10px] text-modern-accent font-bold mt-1 bg-modern-bg px-2 py-0.5 rounded-full w-fit">{sub}</p>}
            </div>
        </div>
    );
}

/* ── Beautiful Bar Chart ────────────────────────────────── */
function BeautifulBarChart({ data, labels, color = '#6366f1' }: {
    data: number[]; labels: string[]; color?: string;
}) {
    const [hovered, setHovered] = useState<number | null>(null);
    const maxVal = Math.max(...data, 1);
    const H = 160; // chart area height in px
    const steps = 5;
    const gridVals = Array.from({ length: steps + 1 }, (_, i) => Math.round((maxVal / steps) * i));

    return (
        <div className="w-full select-none">
            {/* Y-axis + bars */}
            <div className="flex gap-2">
                {/* Y labels */}
                <div className="flex flex-col-reverse justify-between pb-6 h-[184px] min-w-[28px]">
                    {gridVals.map(v => (
                        <span key={v} className="text-[9px] font-bold text-modern-muted/50 text-right pr-1 leading-none">{v}</span>
                    ))}
                </div>
                {/* Chart area */}
                <div className="flex-1 relative">
                    {/* Grid lines */}
                    <div className="absolute inset-0 bottom-6 h-[160px]">
                        {gridVals.map((_, i) => (
                            <div
                                key={i}
                                className="absolute left-0 right-0 border-t border-modern-border/10"
                                style={{ bottom: `${(i / steps) * 100}%` } as React.CSSProperties}
                            />
                        ))}
                    </div>
                    {/* Bars */}
                    <div className="flex items-end gap-1.5 relative h-[184px]">
                        {data.map((v, i) => {
                            const pct = maxVal > 0 ? (v / maxVal) * 100 : 0;
                            const isHov = hovered === i;
                            return (
                                <div
                                    key={i}
                                    className="flex flex-col items-center flex-1 cursor-pointer group"
                                    onMouseEnter={() => setHovered(i)}
                                    onMouseLeave={() => setHovered(null)}
                                >
                                    {/* Tooltip */}
                                    <div className={`mb-1 px-2 py-0.5 rounded-lg text-[10px] font-black text-white shadow-lg transition-all duration-150 ${isHov && v > 0 ? 'opacity-100 scale-100' : 'opacity-0 scale-90'}`}
                                        style={{ backgroundColor: color } as React.CSSProperties}>
                                        {v}
                                    </div>
                                    {/* Bar */}
                                    <div
                                        className="w-full rounded-t-lg transition-all duration-300 relative overflow-hidden"
                                        style={{
                                            height: `${pct * H / 100}px`,
                                            background: isHov
                                                ? color
                                                : `linear-gradient(to top, ${color}cc, ${color}66)`,
                                            minHeight: v > 0 ? 4 : 0,
                                            boxShadow: isHov ? `0 -4px 12px ${color}55` : 'none',
                                        } as React.CSSProperties}
                                    >
                                        {/* Shine */}
                                        <div className="absolute top-0 left-0 right-0 h-1/3 bg-white/10 rounded-t-lg" />
                                    </div>
                                    {/* Month label */}
                                    <p className={`text-[9px] font-bold mt-1.5 leading-none transition-colors ${isHov ? 'font-black' : 'text-modern-muted/50'}`}
                                        style={{ color: isHov ? color : undefined } as React.CSSProperties}>
                                        {labels[i]}
                                    </p>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}

/* ── Donut Chart ────────────────────────────────────────── */
function DonutChart({ slices }: { slices: { label: string; value: number; color: string }[] }) {
    const [hovered, setHovered] = useState<number | null>(null);
    const total = slices.reduce((s, x) => s + x.value, 0);
    if (total === 0) return (
        <div className="flex items-center justify-center h-32 text-modern-muted/30 text-sm font-bold">Tiada data</div>
    );

    let cumAngle = -Math.PI / 2;
    const R = 42, r = 25, cx = 50, cy = 50;

    const paths = slices.filter(s => s.value > 0).map((s, idx) => {
        const angle = (s.value / total) * 2 * Math.PI;
        const x1 = cx + R * Math.cos(cumAngle);
        const y1 = cy + R * Math.sin(cumAngle);
        cumAngle += angle;
        const x2 = cx + R * Math.cos(cumAngle);
        const y2 = cy + R * Math.sin(cumAngle);
        const ix1 = cx + r * Math.cos(cumAngle - angle);
        const iy1 = cy + r * Math.sin(cumAngle - angle);
        const ix2 = cx + r * Math.cos(cumAngle);
        const iy2 = cy + r * Math.sin(cumAngle);
        const large = angle > Math.PI ? 1 : 0;
        const d = `M ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2} L ${ix2} ${iy2} A ${r} ${r} 0 ${large} 0 ${ix1} ${iy1} Z`;
        return { d, color: s.color, label: s.label, value: s.value, idx };
    });

    const hoveredSlice = hovered !== null ? slices.filter(s => s.value > 0)[hovered] : null;

    return (
        <svg viewBox="0 0 100 100" className="w-full max-w-[180px] mx-auto drop-shadow-md"
            onMouseLeave={() => setHovered(null)}>
            <defs>
                {paths.map(p => (
                    <radialGradient key={p.idx} id={`grad-${p.idx}`} cx="50%" cy="30%" r="70%">
                        <stop offset="0%" stopColor={p.color} stopOpacity="1" />
                        <stop offset="100%" stopColor={p.color} stopOpacity="0.7" />
                    </radialGradient>
                ))}
            </defs>
            {paths.map(p => (
                <path
                    key={p.idx}
                    d={p.d}
                    fill={`url(#grad-${p.idx})`}
                    stroke="white"
                    strokeWidth={hovered === p.idx ? 0.5 : 0.8}
                    transform={hovered === p.idx ? `scale(1.04) translate(-2, -2)` : ''}
                    className="origin-[50px_50px] cursor-pointer transition-all duration-200"
                    onMouseEnter={() => setHovered(p.idx)}
                />
            ))}
            {/* Center text */}
            <text x={cx} y={cy - 3} textAnchor="middle" fontSize={hoveredSlice ? 8 : 11} fontWeight="bold" fill="var(--modern-text-primary)">
                {hoveredSlice ? hoveredSlice.value : total}
            </text>
            <text x={cx} y={cy + 5} textAnchor="middle" fontSize={4} fill="var(--modern-text-muted)">
                {hoveredSlice ? hoveredSlice.label : 'Jumlah'}
            </text>
        </svg>
    );
}

/* ── Main Component ─────────────────────────────────────── */
export const DashboardView: React.FC<DashboardViewProps> = ({ staffList, logs }) => {
    // Tarikh Mula Go-Live Sistem
    const validLogs = useMemo(() => 
        logs.filter(l => new Date(l.startDate).getTime() >= new Date('2026-04-01T00:00:00').getTime()), 
    [logs]);

    const currentYear = new Date().getFullYear();
    const [selectedYear, setSelectedYear] = useState(currentYear);
    const [selectedMonth, setSelectedMonth] = useState<number | 'all'>('all');
    const [selectedDay, setSelectedDay] = useState<number | 'all'>('all');
    
    const [rankingStaffType, setRankingStaffType] = useState<'all' | 'admin_staff' | 'operation_staff' | 'doctor'>('all');

    const years = useMemo(() => {
        const ys = new Set<number>();
        validLogs.forEach(l => ys.add(new Date(l.startDate).getFullYear()));
        ys.add(currentYear);
        return Array.from(ys).sort((a, b) => b - a);
    }, [validLogs, currentYear]);

    const filteredLogs = useMemo(() =>
        validLogs.filter(l => {
            const d = new Date(l.startDate);
            if (d.getFullYear() !== selectedYear) return false;
            if (selectedMonth !== 'all' && d.getMonth() !== selectedMonth) return false;
            if (selectedDay !== 'all' && d.getDate() !== selectedDay) return false;
            return true;
        }),
        [validLogs, selectedYear, selectedMonth, selectedDay]);

    const total = filteredLogs.length;
    const approved = filteredLogs.filter(l => l.status === 'approved').length;
    const pending = filteredLogs.filter(l => ['pending', 'hod_approved', 'hr_approved'].includes(l.status)).length;
    const rejected = filteredLogs.filter(l => l.status === 'rejected').length;

    const monthlyData = useMemo(() => {
        const arr = Array(12).fill(0);
        filteredLogs.forEach(l => { arr[new Date(l.startDate).getMonth()]++; });
        return arr;
    }, [filteredLogs]);

    const staffRanking = useMemo(() => {
        const map: Record<string, { name: string; branch: string; count: number; days: number }> = {};
        filteredLogs.forEach(l => {
            const staff = staffList.find(s => s.id.replace(/-/g, '') === l.staffId.replace(/-/g, ''));
            if (!staff) return;
            if (!map[l.staffId]) map[l.staffId] = { name: staff.name, branch: staff.branch || '-', count: 0, days: 0 };
            map[l.staffId].count++;
            map[l.staffId].days += l.duration || 0;
        });
        return Object.values(map).sort((a, b) => b.count - a.count).slice(0, 10);
    }, [filteredLogs, staffList]);

    const typeBreakdown = useMemo(() => {
        const map: Record<string, number> = {};
        filteredLogs.forEach(l => { map[l.type] = (map[l.type] || 0) + 1; });
        return LEAVE_TYPES
            .map(t => ({ label: t, value: map[t] || 0, color: TYPE_COLORS[t] || '#6b7280' }))
            .filter(t => t.value > 0)
            .sort((a, b) => b.value - a.value);
    }, [filteredLogs]);

    const branchStats = useMemo(() => {
        const map: Record<string, number> = {};
        filteredLogs.forEach(l => {
            const staff = staffList.find(s => s.id.replace(/-/g, '') === l.staffId.replace(/-/g, ''));
            const branch = staff?.branch || 'Tidak Ditetapkan';
            map[branch] = (map[branch] || 0) + 1;
        });
        return Object.entries(map).sort((a, b) => b[1] - a[1]);
    }, [filteredLogs, staffList]);

    const maxBranch = branchStats[0]?.[1] || 1;

    // Helper to get days in selected month
    const daysInMonth = useMemo(() => {
        if (selectedMonth === 'all') return 31;
        return new Date(selectedYear, (selectedMonth as number) + 1, 0).getDate();
    }, [selectedYear, selectedMonth]);

    // Format sub strings
    const headerSub = [
        selectedDay !== 'all' ? `Hari ${selectedDay}` : null,
        selectedMonth !== 'all' ? MONTHS_SHORT[selectedMonth as number] : 'Semua Bulan',
        `Tahun ${selectedYear}`
    ].filter(Boolean).join(' • ');

    return (
        <div className="space-y-8 animate-fade-in">

            {/* ── Header ── */}
            <div className="flex flex-col xl:flex-row items-start xl:items-center justify-between gap-4">
                <div>
                    <h2 className="text-3xl font-black text-modern-primary flex items-center gap-3 tracking-tight">
                        <div className="p-2.5 bg-modern-bg rounded-2xl border border-modern-border/50 shadow-neu-sm">
                            <BarChart2 className="w-7 h-7 text-modern-accent" />
                        </div>
                        ANALISA <span className="text-modern-accent">CUTI</span>
                    </h2>
                    <p className="text-sm text-modern-muted font-bold mt-2 ml-1">Gambaran keseluruhan rekod cuti seluruh kakitangan</p>
                </div>
                
                <div className="flex flex-wrap items-center gap-2">
                    {/* Day Filter */}
                    <div className="flex items-center gap-2 bg-white rounded-2xl px-4 py-2.5 shadow-neu-sm border border-modern-border">
                        <Calendar className="w-4 h-4 text-modern-accent" />
                        <select
                            title="Pilih Hari"
                            value={selectedDay}
                            onChange={e => setSelectedDay(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                            className="text-sm font-black text-modern-primary bg-transparent focus:outline-none cursor-pointer"
                        >
                            <option value="all">Semua Hari</option>
                            {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(d => (
                                <option key={d} value={d}>Hari {d}</option>
                            ))}
                        </select>
                    </div>

                    {/* Month Filter */}
                    <div className="flex items-center gap-2 bg-white rounded-2xl px-4 py-2.5 shadow-neu-sm border border-modern-border">
                        <Filter className="w-4 h-4 text-modern-accent" />
                        <select
                            title="Pilih Bulan"
                            value={selectedMonth}
                            onChange={e => {
                                setSelectedMonth(e.target.value === 'all' ? 'all' : Number(e.target.value));
                                setSelectedDay('all'); // Reset day when month changes
                            }}
                            className="text-sm font-black text-modern-primary bg-transparent focus:outline-none cursor-pointer w-28"
                        >
                            <option value="all">Semua Bulan</option>
                            {MONTHS_SHORT.map((m, i) => <option key={m} value={i}>{m}</option>)}
                        </select>
                    </div>

                    <div className="flex items-center gap-2 bg-white rounded-2xl px-4 py-2.5 shadow-neu-sm border border-modern-border">
                        <select
                            title="Pilih Tahun"
                            value={selectedYear}
                            onChange={e => setSelectedYear(Number(e.target.value))}
                            className="text-sm font-black text-modern-primary bg-transparent focus:outline-none cursor-pointer"
                        >
                            {years.map(y => <option key={y} value={y}>{y}</option>)}
                        </select>
                    </div>
                </div>
            </div>

            {/* ── Stat Cards ── */}
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-6">
                <StatCard icon={<Calendar className="w-5 h-5" />} label="Jumlah Permohonan" value={total}
                    sub={`Tahun ${selectedYear}`} variant="accent" />
                <StatCard icon={<CheckCircle className="w-5 h-5" />} label="Diluluskan" value={approved}
                    sub={`${total > 0 ? Math.round(approved / total * 100) : 0}% kadar lulus`}
                    variant="primary" />
                <StatCard icon={<Clock className="w-5 h-5" />} label="Sedang Diproses" value={pending}
                    sub="Menunggu kelulusan" variant="muted" />
                <StatCard icon={<XCircle className="w-5 h-5" />} label="Ditolak" value={rejected}
                    sub={`${total > 0 ? Math.round(rejected / total * 100) : 0}% kadar tolak`}
                    variant="dark" />
            </div>

            {/* ── Chart Row ── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* Monthly Bar Chart */}
                <NeuCard className="lg:col-span-2 p-6">
                    <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-2">
                            <div className="p-2 bg-modern-bg rounded-xl">
                                <TrendingUp className="w-4 h-4 text-modern-accent" />
                            </div>
                            <div>
                                <h3 className="font-black text-modern-primary text-xs uppercase tracking-widest">Trend Permohonan Bulanan</h3>
                                <p className="text-[10px] text-modern-muted font-bold uppercase tracking-wide">{selectedYear}</p>
                            </div>
                        </div>
                        {/* Mini stat */}
                        <div className="text-right">
                            <p className="text-2xl font-black text-modern-accent font-luxury">{Math.max(...monthlyData)}</p>
                            <p className="text-[9px] text-modern-muted font-bold uppercase">Paling Tinggi</p>
                        </div>
                    </div>
                    <BeautifulBarChart data={monthlyData} labels={MONTHS_SHORT} color="#6366f1" />
                </NeuCard>

                {/* Donut + Legend */}
                <NeuCard className="p-6 flex flex-col">
                    <div className="flex items-center gap-2 mb-4">
                        <div className="p-2 bg-modern-bg rounded-xl">
                            <Calendar className="w-4 h-4 text-modern-accent" />
                        </div>
                        <div>
                            <h3 className="font-black text-modern-primary text-sm">Jenis Cuti</h3>
                            <p className="text-[10px] text-modern-muted/50 font-bold uppercase tracking-wide">Pecahan {selectedYear}</p>
                        </div>
                    </div>
                    <DonutChart slices={typeBreakdown} />
                    <div className="mt-4 space-y-2 flex-1">
                        {typeBreakdown.map(t => (
                            <div key={t.label} className="flex items-center gap-2 group">
                                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 shadow-sm" style={{ background: t.color }} />
                                <p className="text-xs font-bold text-modern-primary flex-1">{t.label}</p>
                                <div className="w-16 h-1.5 rounded-full bg-modern-bg overflow-hidden">
                                    <div className="h-full rounded-full transition-all duration-500"
                                        style={{ background: t.color, width: `${total > 0 ? (t.value / total) * 100 : 0}%` }} />
                                </div>
                                <span className="text-xs font-black text-modern-primary w-5 text-right">{t.value}</span>
                            </div>
                        ))}
                        {typeBreakdown.length === 0 && (
                            <p className="text-center text-modern-muted/30 text-xs py-4 font-bold">Tiada data</p>
                        )}
                    </div>
                </NeuCard>
            </div>

            {/* ── Categorical Staff Ranking ── */}
            <div className="space-y-6 pt-4">
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-white rounded-2xl shadow-neu-sm border border-modern-border/30">
                            <Award className="w-6 h-6 text-modern-accent" />
                        </div>
                        <div>
                            <h3 className="text-modern-primary font-black uppercase tracking-[0.15em] text-xl">Ranking Penggunaan Cuti</h3>
                            <p className="text-[10px] text-modern-muted/50 font-bold uppercase tracking-widest mt-0.5">Statistik Tertinggi Mengikut Kategori • {selectedYear}</p>
                        </div>
                    </div>

                    {/* Staff Type Filters */}
                    <div className="flex flex-wrap gap-2 bg-white/50 backdrop-blur-sm p-1.5 rounded-2xl border border-modern-border/50 shadow-neu-sm">
                        {[
                            { id: 'all', label: 'SEMUA' },
                            { id: 'doctor', label: 'DOKTOR' },
                            { id: 'admin_staff', label: 'ADMIN' },
                            { id: 'operation_staff', label: 'OPERASI' }
                        ].map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setRankingStaffType(tab.id as any)}
                                className={`px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all duration-300 ${
                                    rankingStaffType === tab.id 
                                    ? 'bg-modern-primary text-white shadow-neu-md scale-[1.02]' 
                                    : 'text-modern-muted hover:bg-modern-bg'
                                }`}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>
                </div>

                {(() => {
                    const approvedLogs = filteredLogs.filter(l =>
                        (l.status === 'approved' || l.status === 'hod_approved' || l.status === 'hr_approved')
                    );

                    const getTop10 = (type: string) => {
                        const stats: Record<string, { name: string; duration: number; branch: string; id: string }> = {};
                        approvedLogs
                            .filter(l => {
                                if (type && l.type !== type) return false;
                                if (rankingStaffType !== 'all') {
                                    const staff = staffList.find(st => st.id.replace(/-/g, '') === l.staffId.replace(/-/g, ''));
                                    return staff?.staffType === rankingStaffType;
                                }
                                return true;
                            })
                            .forEach(l => {
                                if (!stats[l.staffId]) {
                                    const s = staffList.find(st => st.id.replace(/-/g, '') === l.staffId.replace(/-/g, ''));
                                    stats[l.staffId] = { id: l.staffId, name: l.staffName, duration: 0, branch: s?.branch || '-' };
                                }
                                stats[l.staffId].duration += l.duration;
                            });

                        return Object.values(stats)
                            .sort((a, b) => b.duration - a.duration)
                            .slice(0, 10);
                    };

                    const RankingCard = ({ title, data, color, icon: Icon }: { title: string, data: any[], color: 'accent' | 'muted' | 'primary' | 'dark', icon: any }) => (
                        <div className="bg-white rounded-[2.5rem] shadow-neu-md p-8 flex flex-col border border-modern-border/50 relative overflow-hidden group hover:shadow-neu-lg transition-all duration-300">
                            {/* Decorative Background */}
                            <div className={`absolute -top-10 -right-10 w-32 h-32 rounded-full blur-3xl opacity-5 transition-all duration-700 group-hover:scale-150 ${color === 'accent' ? 'bg-modern-accent' : color === 'muted' ? 'bg-modern-muted' : 'bg-modern-primary'}`} />
                            
                            <div className="flex items-center gap-4 mb-8 relative z-10">
                                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-neu-sm transform rotate-3 transition-transform group-hover:rotate-0 ${
                                    color === 'accent' ? 'bg-gradient-to-br from-modern-accent to-indigo-500' :
                                    color === 'muted' ? 'bg-gradient-to-br from-modern-muted to-modern-primary' :
                                    color === 'primary' ? 'bg-gradient-to-br from-modern-primary to-slate-700' :
                                    'bg-gradient-to-br from-slate-800 to-slate-950'} text-white`}>
                                    <Icon className="w-6 h-6" />
                                </div>
                                <div>
                                    <h4 className="text-sm font-bold text-modern-primary uppercase tracking-widest leading-none">{title}</h4>
                                    <p className="text-[9px] text-modern-muted font-bold uppercase tracking-widest mt-1">Leaderboard</p>
                                </div>
                            </div>
                            
                            <div className="space-y-5 relative z-10">
                                {data.map((item, idx) => {
                                    const maxVal = data[0].duration;
                                    const width = (item.duration / maxVal) * 100;
                                    const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : null;

                                    return (
                                        <div key={item.id} className="relative group/item">
                                            <div className="flex items-center justify-between mb-2 px-1">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-6 flex justify-center">
                                                        {medal ? <span className="text-xl drop-shadow-sm">{medal}</span> : <span className="text-[10px] font-black text-modern-muted/30">#{idx + 1}</span>}
                                                    </div>
                                                    <div>
                                                        <p className="text-[12px] font-black text-modern-primary uppercase tracking-tight leading-none group-hover/item:text-modern-accent transition-colors">{item.name}</p>
                                                        <p className="text-[9px] text-modern-muted font-bold uppercase tracking-widest mt-1">{item.branch}</p>
                                                    </div>
                                                </div>
                                                <div className="text-right">
                                                    <span className={`text-sm font-bold ${color === 'accent' ? 'text-modern-accent' : 'text-modern-primary'}`}>
                                                        {item.duration} <span className="text-[9px] opacity-60">DAYS</span>
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="h-2 w-full bg-modern-bg rounded-full overflow-hidden border border-modern-border/30">
                                                <div 
                                                    className={`h-full rounded-full transition-all duration-1000 ${
                                                        color === 'accent' ? 'bg-gradient-to-r from-modern-accent to-indigo-500' :
                                                        color === 'muted' ? 'bg-gradient-to-r from-modern-muted to-modern-primary' :
                                                        color === 'primary' ? 'bg-gradient-to-r from-modern-primary to-slate-700' :
                                                        'bg-gradient-to-r from-modern-primary to-black'}`}
                                                    style={{ width: `${width}%` }}
                                                />
                                            </div>
                                        </div>
                                    );
                                })}
                                {data.length === 0 && (
                                    <div className="py-16 flex flex-col items-center justify-center opacity-20 grayscale">
                                        <Icon className="w-10 h-10 mb-3" />
                                        <p className="text-[10px] font-black uppercase tracking-widest">No Records Yet</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    );

                    return (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
                            <RankingCard title="Annual Leave" data={getTop10('AL')} color="accent" icon={Calendar} />
                            <RankingCard title="Medical Leave" data={getTop10('MC')} color="muted" icon={Activity} />
                            <RankingCard title="Emergency Leave" data={getTop10('EL')} color="dark" icon={Clock} />
                        </div>
                    );
                })()}
            </div>

            {/* ── Branch Breakdown ── */}
            <NeuCard className="p-6">
                <div className="flex items-center gap-2 mb-6">
                    <div className="p-2 bg-modern-bg rounded-xl">
                        <Users className="w-4 h-4 text-modern-accent" />
                    </div>
                    <div>
                        <h3 className="font-bold text-modern-primary text-sm font-luxury">Permohonan Mengikut Cawangan</h3>
                        <p className="text-[10px] text-modern-muted font-bold uppercase tracking-wide">{selectedYear}</p>
                    </div>
                </div>
                {branchStats.length === 0 ? (
                    <p className="text-center text-modern-muted/30 py-8 text-sm font-bold">Tiada data</p>
                ) : (
                    <div className="space-y-3">
                        {branchStats.map(([branch, count], i) => (
                            <div key={branch} className="flex items-center gap-3">
                                <div className="w-5 h-5 rounded-lg bg-modern-bg flex items-center justify-center flex-shrink-0 border border-modern-border/30">
                                    <span className="text-[8px] font-black text-modern-accent">{i + 1}</span>
                                </div>
                                <p className="text-xs font-bold text-modern-primary w-48 lg:w-64 truncate flex-shrink-0">{branch}</p>
                                <div className="flex-1 h-6 rounded-lg bg-modern-bg overflow-hidden border border-modern-border/30">
                                    <div
                                        className="h-full rounded-lg bg-gradient-to-r from-modern-accent to-indigo-500 flex items-center justify-end pr-2 transition-all duration-700 shadow-sm"
                                        style={{ width: `${(count / maxBranch) * 100}%`, minWidth: count > 0 ? 32 : 0 }}
                                    >
                                        <span className="text-[9px] font-black text-white">{count}</span>
                                    </div>
                                </div>
                                <span className="text-xs font-black text-modern-muted w-8 text-right flex-shrink-0">{count}</span>
                            </div>
                        ))}
                    </div>
                )}
            </NeuCard>

        </div>
    );
};
