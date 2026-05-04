import React, { useState, useMemo, useEffect } from 'react';
import {
    Clock, CheckCircle, XCircle, Trash2,
    Calendar, Save, Filter, AlertCircle, Printer, Edit3
} from 'lucide-react';
import { Staff, OvertimeLog, PublicHoliday } from '../types';
import { NeuCard, NeuButton, NeuInput, NeuBadge, NeuTextArea } from './NeuElements';
import { submitOvertime, approveOvertime, rejectOvertime, deleteOvertime, markOvertimeAsPrinted, updateOvertime, subscribeHolidays } from '../services/firebase';

// Sila tambah/buang tarikh Cuti Umum mengikut kalendar rasmi Pahang/Johor bagi tahun semasa
export const PUBLIC_HOLIDAYS = [
    '2026-01-01', // Tahun Baru
    '2026-01-28', // Thaipusam (Contoh)
    '2026-02-17', // Tahun Baru Cina (Mula)
    '2026-02-18', // Tahun Baru Cina (Akhir)
    '2026-03-01', // Awal Ramadan (Contoh - Johor)
    '2026-03-20', // Hari Raya Aidilfitri (Mula)
    '2026-03-21', // Hari Raya Aidilfitri (Akhir)
    '2026-05-01', // Hari Pekerja
    '2026-05-22', // Hari Hol Pahang (Pahang sahaja)
    '2026-05-27', // Hari Raya Haji (Contoh)
    '2026-06-06', // Hari Keputeraan Agong
    '2026-08-31', // Hari Kebangsaan
    '2026-09-16', // Hari Malaysia
    '2026-10-31', // Deepavali
    '2026-12-25', // Hari Krismas
];

interface Props {
    user: Staff;
    staffList: Staff[];
    overtimeLogs: OvertimeLog[];
}

export const OvertimeView: React.FC<Props> = ({ user, staffList, overtimeLogs }) => {
    const [date, setDate] = useState('');
    const [startTime, setStartTime] = useState('');
    const [endTime, setEndTime] = useState('');
    const [reason, setReason] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [filterMonth, setFilterMonth] = useState(new Date().toISOString().substring(0, 7)); // YYYY-MM
    const [isPrinting, setIsPrinting] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [h15, setH15] = useState<string>('');
    const [h20, setH20] = useState<string>('');
    const [h30, setH30] = useState<string>('');

    // Load holiday dates dynamically from Firestore / localStorage
    const [publicHolidayDates, setPublicHolidayDates] = useState<string[]>([]);
    useEffect(() => {
        const unsub = subscribeHolidays((holidays: PublicHoliday[]) => {
            setPublicHolidayDates(holidays.map(h => h.date));
        });
        return unsub;
    }, []);

    const [otType, setOtType] = useState<'ot15' | 'ot20' | 'ot30' | 'mixed'>('ot15');

    // Auto-detect Overtime Type based on the selected Date
    React.useEffect(() => {
        if (!date) return;
        
        // 1. Check if public holiday -> 3.0x (from dynamic HR-managed list)
        if (publicHolidayDates.includes(date)) {
            setOtType('ot30');
            return;
        }

        // 2. Check if weekend (0 = Sunday, 6 = Saturday) -> 2.0x
        const d = new Date(date);
        const dayOfWeek = d.getDay();
        if (dayOfWeek === 0 || dayOfWeek === 6) {
            setOtType('ot20');
            return;
        }

        // 3. Otherwise normal work day -> 1.5x
        setOtType('ot15');
    }, [date, publicHolidayDates]);

    const canManage = user.role === 'admin' || user.role === 'super_admin' || user.role === 'hr';

    const calculateDuration = (start: string, end: string) => {
        if (!start || !end) return 0;
        const [h1, m1] = start.split(':').map(Number);
        const [h2, m2] = end.split(':').map(Number);
        const totalMinutes = (h2 * 60 + m2) - (h1 * 60 + m1);
        return Math.max(0, totalMinutes / 60);
    };

    const multipliers = {
        ot15: 1.5,
        ot20: 2.0,
        ot30: 3.0,
        mixed: 0 // Not used directly for calculation in mixed mode
    };

    const hourlyRate = (user.basicSalary || 0) / 26 / 7.5; // Formula: Gaji Asas ÷ 26 hari ÷ 7.5 jam
    const currentDuration = calculateDuration(startTime, endTime);

    // Auto-fill selected OT type hours if breakdown is empty
    const hours = {
        ot15: parseFloat(h15) || 0,
        ot20: parseFloat(h20) || 0,
        ot30: parseFloat(h30) || 0
    };

    const payments = {
        ot15: hours.ot15 * multipliers.ot15 * hourlyRate,
        ot20: hours.ot20 * multipliers.ot20 * hourlyRate,
        ot30: hours.ot30 * multipliers.ot30 * hourlyRate
    };

    const totalHours = hours.ot15 + hours.ot20 + hours.ot30;
    const estimatedPayment = payments.ot15 + payments.ot20 + payments.ot30;

    const filteredLogs = useMemo(() => {
        let list = [...overtimeLogs].sort((a, b) => b.timestamp - a.timestamp);
        if (!canManage) {
            const cleanUserId = user.id.replace(/-/g, '');
            list = list.filter(l => l.staffId.replace(/-/g, '') === cleanUserId);
        }
        if (filterMonth) {
            list = list.filter(l => l.date.substring(0, 7) === filterMonth);
        }
        return list;
    }, [overtimeLogs, user.id, canManage, filterMonth]);

    const stats = useMemo(() => {
        const userLogs = overtimeLogs.filter(l => l.staffId === user.id && l.status === 'approved');
        const thisMonth = userLogs.filter(l => l.date.substring(0, 7) === filterMonth);
        const unprintedThisMonth = filteredLogs.filter(l => !l.isPrinted);

        return {
            totalHours: userLogs.reduce((acc, curr) => acc + curr.duration, 0),
            monthHours: thisMonth.reduce((acc, curr) => acc + curr.duration, 0),
            totalPayment: userLogs.reduce((acc, curr) => acc + (curr.paymentAmount || 0), 0),
            monthPayment: thisMonth.reduce((acc, curr) => acc + (curr.paymentAmount || 0), 0),
            unprintedCount: unprintedThisMonth.length,
            unprintedAmount: unprintedThisMonth.reduce((a, c) => a + (c.paymentAmount || 0), 0)
        };
    }, [overtimeLogs, user.id, filterMonth, filteredLogs]);

    const monthlySummary = useMemo(() => {
        return filteredLogs.reduce((acc, log) => {
            const hasBreakdown = log.h15 !== undefined || log.h20 !== undefined || log.h30 !== undefined;

            acc.h15 += hasBreakdown ? (log.h15 || 0) : (log.otType === 'ot15' ? log.duration : 0);
            acc.h20 += hasBreakdown ? (log.h20 || 0) : (log.otType === 'ot20' ? log.duration : 0);
            acc.h30 += hasBreakdown ? (log.h30 || 0) : (log.otType === 'ot30' ? log.duration : 0);

            acc.p15 += hasBreakdown ? (log.p15 || 0) : (log.otType === 'ot15' ? (log.paymentAmount || 0) : 0);
            acc.p20 += hasBreakdown ? (log.p20 || 0) : (log.otType === 'ot20' ? (log.paymentAmount || 0) : 0);
            acc.p30 += hasBreakdown ? (log.p30 || 0) : (log.otType === 'ot30' ? (log.paymentAmount || 0) : 0);
            acc.totalRM += (log.paymentAmount || 0);
            return acc;
        }, { h15: 0, h20: 0, h30: 0, p15: 0, p20: 0, p30: 0, totalRM: 0 });
    }, [filteredLogs]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const duration = calculateDuration(startTime, endTime);
        if (duration <= 0) {
            alert("End time must be after start time");
            return;
        }

        setIsSubmitting(true);
        try {
            const finalHours = {
                ot15: parseFloat(h15) || 0,
                ot20: parseFloat(h20) || 0,
                ot30: parseFloat(h30) || 0
            };

            // If all breakdown hours are 0, use currentDuration for the selected otType
            if (finalHours.ot15 === 0 && finalHours.ot20 === 0 && finalHours.ot30 === 0) {
                (finalHours as any)[otType] = duration;
            }

            const otData = {
                staffId: user.id,
                staffName: user.name,
                date,
                startTime,
                endTime,
                duration: finalHours.ot15 + finalHours.ot20 + finalHours.ot30,
                reason,
                otType: (finalHours.ot15 > 0 && (finalHours.ot20 > 0 || finalHours.ot30 > 0)) || (finalHours.ot20 > 0 && finalHours.ot30 > 0) ? 'mixed' :
                    finalHours.ot30 > 0 ? 'ot30' : finalHours.ot20 > 0 ? 'ot20' : 'ot15',
                hourlyRate: hourlyRate, // Store base rate
                paymentAmount: (finalHours.ot15 * 1.5 + finalHours.ot20 * 2.0 + finalHours.ot30 * 3.0) * hourlyRate,
                h15: finalHours.ot15,
                h20: finalHours.ot20,
                h30: finalHours.ot30,
                p15: finalHours.ot15 * 1.5 * hourlyRate,
                p20: finalHours.ot20 * 2.0 * hourlyRate,
                p30: finalHours.ot30 * 3.0 * hourlyRate,
                status: 'approved' as const,
                isPrinted: false
            };

            if (editingId) {
                await updateOvertime(editingId, otData as any);
                setEditingId(null);
            } else {
                await submitOvertime(otData as any);
            }
            // Automatically switch view to the month of the date just submitted
            setFilterMonth(date.substring(0, 7));

            setDate('');
            setStartTime('');
            setEndTime('');
            setReason('');
            setH15('');
            setH20('');
            setH30('');
            alert(editingId ? "Overtime record updated successfully!" : "Overtime record saved successfully! You can see it in the history below.");
        } catch (e: any) {
            alert(e.message);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleEdit = (log: OvertimeLog) => {
        setEditingId(log.id);
        setDate(log.date);
        setStartTime(log.startTime);
        setEndTime(log.endTime);
        setReason(log.reason);
        setOtType(log.otType);
        setH15(log.h15?.toString() || '');
        setH20(log.h20?.toString() || '');
        setH30(log.h30?.toString() || '');
        // Scroll to form
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleCancelEdit = () => {
        setEditingId(null);
        setDate('');
        setStartTime('');
        setEndTime('');
        setReason('');
        setOtType('ot15');
        setH15('');
        setH20('');
        setH30('');
    };

    return (
        <div className="space-y-10 animate-fade-in max-w-6xl mx-auto w-full">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">

                {/* LEFT COLUMN: Submit Form & Stats */}
                <div className="lg:col-span-4 space-y-10">
                    <NeuCard className="bg-white relative overflow-hidden group shadow-premium-md border border-premium-border/50">
                        <div className="absolute top-0 left-0 w-1.5 h-full bg-luxury-gold"></div>
                        <div className="flex items-center gap-3 mb-8">
                            <Clock className="w-6 h-6 text-luxury-gold" />
                            <h3 className="text-xl font-bold text-premium-primary font-luxury uppercase tracking-tight">{editingId ? 'Edit Overtime Claim' : 'Submit Overtime'}</h3>
                        </div>
                        <form onSubmit={handleSubmit} className="space-y-8">
                            <NeuInput type="date" label="Work Date" value={date} onChange={e => setDate(e.target.value)} required />
                            <div className="grid grid-cols-2 gap-4">
                                <NeuInput type="time" label="Start Time" value={startTime} onChange={e => setStartTime(e.target.value)} required />
                                <NeuInput type="time" label="End Time" value={endTime} onChange={e => setEndTime(e.target.value)} required />
                            </div>

                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Kategori OT</label>
                                <select
                                    value={otType}
                                    title="Kategori Overtime"
                                    onChange={e => setOtType(e.target.value as any)}
                                    className="w-full p-4 bg-premium-bg rounded-2xl border border-premium-border/50 text-sm font-bold text-premium-primary outline-none focus:border-luxury-gold transition-all appearance-none shadow-premium-sm"
                                >
                                    <option value="ot15">OT15: Hari Biasa (1.5x)</option>
                                    <option value="ot20">OT20: Ahad / Cuti Rehat (2.0x)</option>
                                    <option value="ot30">OT30: Cuti Am / Public Holiday (3.0x)</option>
                                </select>
                            </div>

                            <div className="grid grid-cols-3 gap-2">
                                <div className="space-y-1">
                                    <label className="text-[8px] font-black text-premium-muted uppercase ml-1">Jam 1.5x</label>
                                    <input
                                        type="number"
                                        placeholder={otType === 'ot15' ? currentDuration.toFixed(1) : "0"}
                                        value={h15}
                                        onChange={e => setH15(e.target.value)}
                                        className="w-full p-2 bg-premium-bg border border-premium-border/50 rounded-lg text-xs font-bold text-premium-primary outline-none focus:border-luxury-gold"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[8px] font-black text-luxury-gold uppercase ml-1">Jam 2.0x</label>
                                    <input
                                        type="number"
                                        placeholder={otType === 'ot20' ? currentDuration.toFixed(1) : "0"}
                                        value={h20}
                                        onChange={e => setH20(e.target.value)}
                                        className="w-full p-2 bg-premium-bg border border-premium-border/50 rounded-lg text-xs font-bold text-premium-primary outline-none focus:border-luxury-gold"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[8px] font-black text-premium-accent uppercase ml-1">Jam 3.0x</label>
                                    <input
                                        type="number"
                                        placeholder={otType === 'ot30' ? currentDuration.toFixed(1) : "0"}
                                        value={h30}
                                        onChange={e => setH30(e.target.value)}
                                        className="w-full p-2 bg-premium-bg border border-premium-border/50 rounded-lg text-xs font-bold text-premium-primary outline-none focus:border-luxury-gold"
                                    />
                                </div>
                            </div>

                            <NeuTextArea label="Task description" value={reason} onChange={e => setReason(e.target.value)} placeholder="Specify what task you performed during OT..." required />

                            <div className="p-6 bg-premium-bg/50 rounded-2xl border border-premium-border/50 flex flex-col gap-4 group-hover:bg-premium-bg transition-colors shadow-premium-sm">
                                <div className="flex justify-between items-center">
                                    <span className="text-[10px] font-black text-premium-muted uppercase tracking-widest">Total OT Hours</span>
                                    <span className="text-xl font-black text-premium-primary font-luxury">{totalHours > 0 ? totalHours.toFixed(2) : currentDuration.toFixed(2)} <span className="text-xs uppercase ml-1">Hours</span></span>
                                </div>
                                <div className="h-px bg-premium-border/50 italic flex items-center justify-center relative">
                                    <span className="bg-premium-bg px-2 text-[8px] font-black text-premium-muted uppercase">Calculation</span>
                                </div>
                                <div className="space-y-1">
                                    {hours.ot15 > 0 && <div className="flex justify-between text-[10px] font-bold text-premium-muted">
                                        <span>1.5x ({hours.ot15}h)</span>
                                        <span>RM {payments.ot15.toFixed(2)}</span>
                                    </div>}
                                    {hours.ot20 > 0 && <div className="flex justify-between text-[10px] font-bold text-premium-muted">
                                        <span>2.0x ({hours.ot20}h)</span>
                                        <span>RM {payments.ot20.toFixed(2)}</span>
                                    </div>}
                                    {hours.ot30 > 0 && <div className="flex justify-between text-[10px] font-bold text-premium-muted">
                                        <span>3.0x ({hours.ot30}h)</span>
                                        <span>RM {payments.ot30.toFixed(2)}</span>
                                    </div>}
                                    {totalHours === 0 && (
                                        <div className="flex justify-between text-[10px] font-bold text-luxury-gold italic">
                                            <span>{multipliers[otType]}x ({currentDuration.toFixed(2)}h)</span>
                                            <span>RM {estimatedPayment.toFixed(2)}</span>
                                        </div>
                                    )}
                                </div>
                                <div className="flex justify-between items-center pt-2 border-t border-premium-border/50">
                                    <span className="text-[10px] font-black text-premium-accent uppercase tracking-widest leading-none">Total Payment Claim</span>
                                    <span className="text-2xl font-black text-premium-primary font-luxury">RM {totalHours > 0 ? estimatedPayment.toFixed(2) : (currentDuration * multipliers[otType] * hourlyRate).toFixed(2)}</span>
                                </div>
                                {(!user.basicSalary || user.basicSalary === 0) && (
                                    <div className="mt-2 p-2 bg-red-50 rounded-lg flex items-center gap-2">
                                        <AlertCircle className="w-3 h-3 text-red-500" />
                                        <span className="text-[8px] font-bold text-red-500 uppercase">Gaji Asas belum ditetapkan. Sila kemaskini di Tetapan.</span>
                                    </div>
                                )}
                            </div>

                            <NeuButton type="submit" variant="gold" className="w-full py-5 flex justify-center items-center gap-3 rounded-2xl shadow-premium-md text-xs font-black tracking-widest uppercase mt-4" disabled={isSubmitting}>
                                {isSubmitting ? 'Processing...' : (
                                    <>
                                        <Save className="w-5 h-5" />
                                        {editingId ? 'Update Claim' : 'Submit OT Claim'}
                                    </>
                                )}
                            </NeuButton>
                            {editingId && (
                                <button
                                    type="button"
                                    onClick={handleCancelEdit}
                                    className="w-full py-2 text-[10px] font-black uppercase text-gray-400 hover:text-red-500 transition-colors"
                                >
                                    Cancel Editing
                                </button>
                            )}
                        </form>
                    </NeuCard>

                    <div className="grid grid-cols-1 gap-6">
                         <NeuCard className="text-center py-6 shadow-premium-sm bg-white border border-premium-border/50">
                            <p className="text-[10px] font-black text-premium-muted uppercase tracking-widest mb-2">My Total (Approved)</p>
                            <h4 className="text-3xl font-black text-premium-primary tracking-tighter font-luxury">{stats.totalHours.toFixed(1)} <span className="text-sm">HRS</span></h4>
                            <p className="text-xs font-bold text-premium-accent">RM {stats.totalPayment.toFixed(2)}</p>
                        </NeuCard>

                        <NeuCard className="text-center py-6 shadow-premium-sm bg-white border-t-4 border-premium-primary">
                            <p className="text-[10px] font-black text-premium-muted/50 capitalize mb-2">Belum Di-Print ({new Date(filterMonth + '-01').toLocaleString('default', { month: 'short' })})</p>
                            <h4 className="text-3xl font-black text-premium-primary tracking-tighter font-luxury">{stats.unprintedCount} <span className="text-sm">ITEMS</span></h4>
                            <p className="text-xs font-bold text-premium-muted">RM {stats.unprintedAmount.toFixed(2)}</p>
                        </NeuCard>

                        <NeuCard className="text-center py-6 shadow-premium-sm bg-white border-t-4 border-luxury-gold">
                            <p className="text-[10px] font-black text-premium-muted uppercase tracking-widest mb-2">Total Month</p>
                            <h4 className="text-3xl font-black text-luxury-gold tracking-tighter font-luxury">{stats.monthHours.toFixed(1)} <span className="text-sm">HRS</span></h4>
                            <p className="text-xs font-bold text-premium-accent">RM {stats.monthPayment.toFixed(2)}</p>
                        </NeuCard>
                    </div>
                </div>

                {/* RIGHT COLUMN: List */}
                <div className="lg:col-span-8 space-y-10">
                    <div className="flex flex-col sm:flex-row justify-between items-center gap-6 px-2">
                        <div className="flex flex-col sm:flex-row items-center sm:items-start sm:gap-6 gap-3 flex-1">
                            <div className="flex items-center gap-3">
                                <Filter className="w-6 h-6 text-premium-accent" />
                                <h3 className="text-2xl font-black text-premium-primary tracking-tight font-luxury uppercase">History <span className="text-premium-accent">Claims</span></h3>
                            </div>
                            <div className="hidden sm:flex flex-col bg-white/50 px-4 py-1.5 rounded-xl border border-premium-border/50 shadow-premium-sm">
                                <span className="text-[10px] font-black text-premium-primary truncate max-w-[200px] uppercase tracking-tight">{user.name}</span>
                                <span className="text-[9px] font-bold text-premium-accent uppercase tracking-widest">Gaji Asas: RM {(user.basicSalary || 0).toFixed(2)}</span>
                            </div>
                        </div>
                        <div className="w-full sm:w-48">
                            <NeuInput type="month" value={filterMonth} onChange={e => setFilterMonth(e.target.value)} />
                        </div>
                        <NeuButton
                            onClick={async () => {
                                setIsPrinting(true);
                                const idsToMark = filteredLogs.filter(l => !l.isPrinted).map(l => l.id);
                                if (idsToMark.length > 0) {
                                    await markOvertimeAsPrinted(idsToMark);
                                }
                                setTimeout(() => {
                                    window.print();
                                    setIsPrinting(false);
                                }, 800);
                            }}
                            variant="gold"
                            className="flex items-center gap-2 shadow-premium-sm py-4"
                        >
                            <Printer className="w-4 h-4" />
                            Generate Monthly PDF
                        </NeuButton>
                    </div>

                    <NeuCard className="p-0 overflow-hidden shadow-premium-lg border border-premium-border/50 bg-white">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="border-b border-premium-border/50 bg-premium-bg/30">
                                        <th className="p-6 text-[10px] font-black text-premium-muted uppercase tracking-widest">Date & Period</th>
                                        {canManage && <th className="p-6 text-[10px] font-black text-premium-muted uppercase tracking-widest">Employee</th>}
                                        <th className="p-6 text-[10px] font-black text-premium-muted uppercase tracking-widest text-center">OT 1.5x</th>
                                        <th className="p-6 text-[10px] font-black text-premium-muted uppercase tracking-widest text-center">OT 2.0x</th>
                                        <th className="p-6 text-[10px] font-black text-premium-muted uppercase tracking-widest text-center">OT 3.0x</th>
                                        <th className="p-6 text-[10px] font-black text-premium-muted uppercase tracking-widest text-right">Total RM</th>
                                        <th className="p-6 text-[10px] font-black text-premium-muted uppercase tracking-widest text-center">Status</th>
                                        <th className="p-6 text-[10px] font-black text-premium-muted uppercase tracking-widest text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-premium-border/30">
                                    {filteredLogs.map(log => (
                                        <tr key={log.id} className="hover:bg-premium-bg/50 transition-colors group">
                                            <td className="p-6">
                                                <p className="text-sm font-black text-premium-primary uppercase tracking-tight">{log.date}</p>
                                                <p className="text-[10px] text-premium-muted font-bold group-hover:text-premium-accent transition-colors uppercase">{log.startTime} - {log.endTime}</p>
                                            </td>
                                            {canManage && (
                                                <td className="p-6">
                                                    <p className="text-sm font-black text-premium-primary">{log.staffName}</p>
                                                </td>
                                            )}
                                            <td className="p-6 text-center">
                                                <div className="flex flex-col">
                                                    <span className="text-sm font-black text-premium-primary">{(log.h15 || (log.otType === 'ot15' ? log.duration : 0)).toFixed(1)}h</span>
                                                    <span className="text-[8px] text-premium-muted/50 font-bold">RM {(log.p15 || (log.otType === 'ot15' ? log.paymentAmount : 0)).toFixed(2)}</span>
                                                </div>
                                            </td>
                                            <td className="p-6 text-center">
                                                <div className="flex flex-col">
                                                    <span className="text-sm font-black text-premium-primary">{(log.h20 || (log.otType === 'ot20' ? log.duration : 0)).toFixed(1)}h</span>
                                                    <span className="text-[8px] text-premium-muted/50 font-bold">RM {(log.p20 || (log.otType === 'ot20' ? log.paymentAmount : 0)).toFixed(2)}</span>
                                                </div>
                                            </td>
                                            <td className="p-6 text-center">
                                                <div className="flex flex-col">
                                                    <span className="text-sm font-black text-premium-primary">{(log.h30 || (log.otType === 'ot30' ? log.duration : 0)).toFixed(1)}h</span>
                                                    <span className="text-[8px] text-premium-muted/50 font-bold">RM {(log.p30 || (log.otType === 'ot30' ? log.paymentAmount : 0)).toFixed(2)}</span>
                                                </div>
                                            </td>
                                            <td className="p-6 text-right">
                                                <p className="text-sm font-black text-luxury-gold font-luxury">RM {(log.paymentAmount || 0).toFixed(2)}</p>
                                                <p className="text-[8px] text-premium-muted font-bold uppercase tracking-tight">{log.reason}</p>
                                            </td>
                                            <td className="p-6 text-center">
                                                <div className="flex flex-col items-center gap-1">
                                                <NeuBadge variant={
                                                    log.status === 'approved' ? 'gold' :
                                                        log.status === 'rejected' ? 'red' : 'stone'
                                                }>
                                                    {log.status}
                                                </NeuBadge>
                                                    {log.isPrinted ? (
                                                        <span className="text-[8px] font-black text-premium-muted/50 uppercase tracking-tighter flex items-center gap-0.5">
                                                            <CheckCircle className="w-2 h-2" /> Printed
                                                        </span>
                                                    ) : (
                                                        <span className="text-[8px] font-black text-luxury-gold uppercase tracking-tighter">
                                                            Not Printed
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="p-6 text-right">
                                                <div className="flex justify-end gap-3 transition-opacity">
                                                    <button onClick={() => handleEdit(log)} className="p-2 text-premium-muted/50 hover:text-luxury-gold transition-colors" title="Edit">
                                                        <Edit3 className="w-5 h-5" />
                                                    </button>
                                                    {canManage && log.status === 'pending' && (
                                                        <>
                                                            <button onClick={() => approveOvertime(log.id, user.name)} className="p-2 text-premium-muted/50 hover:text-luxury-gold transition-colors" title="Approve">
                                                                <CheckCircle className="w-5 h-5" />
                                                            </button>
                                                            <button onClick={() => {
                                                                const reason = prompt("Reason for rejection:");
                                                                if (reason) rejectOvertime(log.id, reason);
                                                            }} className="p-2 text-premium-muted/30 hover:text-premium-muted transition-colors" title="Reject">
                                                                <XCircle className="w-5 h-5" />
                                                            </button>
                                                        </>
                                                    )}
                                                    <button onClick={() => {
                                                        if (confirm("Delete this overtime record?")) deleteOvertime(log.id);
                                                    }} className="p-2 text-premium-muted/30 hover:text-red-400 transition-colors" title="Delete">
                                                        <Trash2 className="w-5 h-5" />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                    {filteredLogs.length > 0 && (
                                        <tr className="bg-premium-bg/50 font-black border-t-2 border-premium-border/50">
                                            <td className="p-6 text-xs uppercase text-premium-muted">Monthly Total</td>
                                            {canManage && <td className="p-6"></td>}
                                            <td className="p-6 text-center text-xs text-premium-muted">{monthlySummary.h15.toFixed(1)}h</td>
                                            <td className="p-6 text-center text-xs text-premium-text">{monthlySummary.h20.toFixed(1)}h</td>
                                            <td className="p-6 text-center text-xs text-premium-primary">{monthlySummary.h30.toFixed(1)}h</td>
                                            <td className="p-6 text-right">
                                                <span className="text-luxury-gold text-lg font-luxury">RM {monthlySummary.totalRM.toFixed(2)}</span>
                                            </td>
                                            <td className="p-6" colSpan={2}></td>
                                        </tr>
                                    )}
                                    {filteredLogs.length === 0 && (
                                        <tr>
                                            <td colSpan={canManage ? 6 : 5} className="p-12 text-center text-gray-400 italic text-sm">
                                                No overtime records found for {new Date(filterMonth + '-02').toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </NeuCard>
                </div>
            </div >

            {/* --- PRINT TEMPLATE (Hidden from UI) --- */}
            {isPrinting && (
                <div className="fixed inset-0 bg-white z-[9999] p-10 print-only overflow-y-auto">
                    {/* WATERMARK BACKGROUND */}
                    <div className="fixed inset-0 flex items-center justify-center opacity-[0.08] pointer-events-none z-0 min-h-screen">
                        <img src="/logo-ksb.jpg" alt="Watermark" className="w-[600px] object-contain grayscale" />
                    </div>

                    <div className="max-w-4xl mx-auto text-black font-serif relative z-10">
                        <div className="text-center mb-10">
                            <h2 className="text-xl font-bold uppercase underline">Klinik Syed Badaruddin Sdn. Bhd</h2>
                            <h3 className="text-lg font-bold uppercase mt-1">Borang Kerja Lebih Masa (O.T)</h3>
                        </div>

                        <div className="grid grid-cols-2 gap-x-20 gap-y-2 mb-6 text-sm">
                            <div className="flex gap-4">
                                <span className="font-bold w-20">NAMA</span>
                                <span className="border-b border-black flex-1 uppercase">: {user.name}</span>
                            </div>
                            <div className="flex gap-4">
                                <span className="font-bold w-20">BULAN</span>
                                <span className="border-b border-black flex-1 uppercase">: {new Date(filterMonth + '-01').toLocaleString('default', { month: 'short', year: '2-digit' })}</span>
                            </div>
                            <div className="flex gap-4">
                                <span className="font-bold w-20">IC NO</span>
                                <span className="border-b border-black flex-1">: {user.ic.replace(/-/g, '')}</span>
                            </div>
                            <div className="flex gap-4">
                                <span className="font-bold w-20">TARIKH</span>
                                <span className="border-b border-black flex-1">: {new Date().toLocaleDateString()}</span>
                            </div>
                        </div>

                        <table className="w-full border-collapse border-2 border-black text-[10px]">
                            <thead>
                                <tr className="bg-gray-100 uppercase">
                                    <th className="border-2 border-black p-2 w-20">Tarikh</th>
                                    <th className="border-2 border-black p-2">Perkara</th>
                                    <th className="border-2 border-black p-2 w-16 text-center">Mula<br />(Jam)</th>
                                    <th className="border-2 border-black p-2 w-16 text-center">Tamat<br />(Jam)</th>
                                    <th className="border-2 border-black p-2 text-center" colSpan={3}>Tempoh Jam Bekerja Di Hari</th>
                                </tr>
                                <tr className="bg-gray-50 uppercase">
                                    <th className="border-2 border-black p-1" colSpan={4}></th>
                                    <th className="border-2 border-black p-1 w-14 text-center">Biasa</th>
                                    <th className="border-2 border-black p-1 w-14 text-center">C.Umum</th>
                                    <th className="border-2 border-black p-1 w-14 text-center">C.Awam</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredLogs.map(log => (
                                    <tr key={log.id}>
                                        <td className="border-2 border-black p-2 text-center">{log.date}</td>
                                        <td className="border-2 border-black p-2 uppercase">{log.reason}</td>
                                        <td className="border-2 border-black p-2 text-center">{log.startTime}</td>
                                        <td className="border-2 border-black p-2 text-center">{log.endTime}</td>
                                        <td className="border-2 border-black p-2 text-center font-bold">{(log.h15 || (log.otType === 'ot15' ? log.duration : 0)).toFixed(1)}</td>
                                        <td className="border-2 border-black p-2 text-center font-bold">{(log.h20 || (log.otType === 'ot20' ? log.duration : 0)).toFixed(1)}</td>
                                        <td className="border-2 border-black p-2 text-center font-bold">{(log.h30 || (log.otType === 'ot30' ? log.duration : 0)).toFixed(1)}</td>
                                    </tr>
                                ))}
                                {/* Fill empty rows to match sample aesthetic if needed */}
                                {[...Array(Math.max(0, 10 - filteredLogs.length))].map((_, i) => (
                                    <tr key={`empty-${i}`} className="h-8">
                                        <td className="border-2 border-black"></td>
                                        <td className="border-2 border-black"></td>
                                        <td className="border-2 border-black"></td>
                                        <td className="border-2 border-black"></td>
                                        <td className="border-2 border-black"></td>
                                        <td className="border-2 border-black"></td>
                                        <td className="border-2 border-black"></td>
                                    </tr>
                                ))}
                                <tr className="bg-gray-100 font-bold italic">
                                    <td className="border-2 border-black p-2 text-center" colSpan={4}>Jumlah Keseluruhan Jam Bekerja</td>
                                    <td className="border-2 border-black p-2 text-center bg-gray-200">{monthlySummary.h15.toFixed(1)}</td>
                                    <td className="border-2 border-black p-2 text-center bg-gray-200">{monthlySummary.h20.toFixed(1)}</td>
                                    <td className="border-2 border-black p-2 text-center bg-gray-200">{monthlySummary.h30.toFixed(1)}</td>
                                </tr>
                            </tbody>
                        </table>

                        <div className="mt-6 grid grid-cols-2 gap-10">
                            <div className="space-y-1">
                                <table className="w-full border-collapse text-[10px]">
                                    <tbody>
                                        <tr>
                                            <td className="border border-black p-1 w-20 italic">Biasa (OT15)</td>
                                            <td className="border border-black p-1 text-center font-mono text-[8px] text-gray-500 italic">Gaji Asas / 26 / 7.5 x 1.5</td>
                                            <td className="border border-black p-1 w-16 text-center font-bold">RM {(hourlyRate * multipliers.ot15).toFixed(2)}</td>
                                            <td className="border border-black p-1 w-20 text-center font-bold bg-gray-50">RM {monthlySummary.p15.toFixed(2)}</td>
                                        </tr>
                                        <tr>
                                            <td className="border border-black p-1 italic">Cuti Umum (OT20)</td>
                                            <td className="border border-black p-1 text-center font-mono text-[8px] text-gray-500 italic">Gaji Asas / 26 / 7.5 x 2.0</td>
                                            <td className="border border-black p-1 text-center font-bold">RM {(hourlyRate * multipliers.ot20).toFixed(2)}</td>
                                            <td className="border border-black p-1 w-20 text-center font-bold bg-gray-50">RM {monthlySummary.p20.toFixed(2)}</td>
                                        </tr>
                                        <tr>
                                            <td className="border border-black p-1 italic">Cuti Awam (OT30)</td>
                                            <td className="border border-black p-1 text-center font-mono text-[8px] text-gray-500 italic">Gaji Asas / 26 / 7.5 x 3.0</td>
                                            <td className="border border-black p-1 text-center font-bold">RM {(hourlyRate * multipliers.ot30).toFixed(2)}</td>
                                            <td className="border border-black p-1 w-20 text-center font-bold bg-gray-50">RM {monthlySummary.p30.toFixed(2)}</td>
                                        </tr>
                                        <tr className="bg-gray-100 font-bold uppercase text-xs">
                                            <td className="border border-black p-2" colSpan={2}>Jumlah Keseluruhan Bayaran (RM)</td>
                                            <td className="border-4 border-black p-2 text-center" colSpan={2}>RM {monthlySummary.totalRM.toFixed(2)}</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                            <div className="flex flex-col justify-end items-end pr-10">
                                <div className="text-center">
                                    <p className="text-[10px] mb-16 italic">Di Semak Oleh:</p>
                                    <div className="border-b-2 border-dotted border-black w-40"></div>
                                    <p className="text-[9px] mt-2 italic">(....................................)</p>
                                </div>
                            </div>
                        </div>

                        <style>{`
                            @media print {
                                body * { visibility: hidden; }
                                .print-only, .print-only * { visibility: visible; }
                                .print-only { position: absolute; left: 0; top: 0; width: 100%; }
                            }
                        `}</style>
                    </div>
                </div>
            )}
        </div >
    );
};
