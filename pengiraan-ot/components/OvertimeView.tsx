import React, { useState, useMemo, useEffect } from 'react';
import {
    Clock, Trash2, Calendar, Save, Filter, AlertCircle, Printer, Edit3, User, Download, Info, X
} from 'lucide-react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { NeuCard, NeuButton, NeuInput, NeuTextArea } from './NeuElements';

export interface LocalOTLog {
    id: string;
    date: string;
    startTime: string;
    endTime: string;
    duration: number;
    reason: string;
    otType: 'ot15' | 'ot20' | 'ot30' | 'mixed';
    h15: number;
    h20: number;
    h30: number;
    p15: number;
    p20: number;
    p30: number;
    paymentAmount: number;
    hourlyRate: number;
}

export const OvertimeView: React.FC<{ isPrintMode?: boolean, isDownloadMode?: boolean }> = ({ isPrintMode, isDownloadMode }) => {
    const [userName, setUserName] = useState<string>(() => localStorage.getItem('ksb_ot_name') || '');
    const [basicSalary, setBasicSalary] = useState<number>(() => Number(localStorage.getItem('ksb_ot_salary')) || 0);
    const [icNumber, setIcNumber] = useState<string>(() => localStorage.getItem('ksb_ot_ic') || '');
    const [showHolidayImage, setShowHolidayImage] = useState(false);

    const [logs, setLogs] = useState<LocalOTLog[]>(() => {
        try { return JSON.parse(localStorage.getItem('ksb_ot_calc') || '[]'); } catch { return []; }
    });

    useEffect(() => { localStorage.setItem('ksb_ot_name', userName); }, [userName]);
    useEffect(() => { localStorage.setItem('ksb_ot_salary', basicSalary.toString()); }, [basicSalary]);
    useEffect(() => { localStorage.setItem('ksb_ot_ic', icNumber); }, [icNumber]);
    useEffect(() => { localStorage.setItem('ksb_ot_calc', JSON.stringify(logs)); }, [logs]);

    const [date, setDate] = useState('');
    const [startTime, setStartTime] = useState('');
    const [endTime, setEndTime] = useState('');
    const [reason, setReason] = useState('');
    const [filterMonth, setFilterMonth] = useState(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const monthParam = urlParams.get('month');
        if (monthParam) return monthParam;
        
        // Fallback to current local YYYY-MM
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    });
    
    useEffect(() => {
        if (isPrintMode && !isDownloadMode) {
            setTimeout(() => window.print(), 800);
        } else if (isDownloadMode) {
            setTimeout(() => {
                const element = document.getElementById('pdf-content');
                if (!element) return;
                
                html2canvas(element, { scale: 2, useCORS: true }).then((canvas) => {
                    const imgData = canvas.toDataURL('image/png');
                    const pdf = new jsPDF('p', 'mm', 'a4');
                    
                    const pdfWidth = pdf.internal.pageSize.getWidth();
                    const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
                    
                    pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
                    pdf.save(`Kerja_Lebih_Masa_${userName || 'Staf'}_${filterMonth}.pdf`);
                    
                    setTimeout(() => window.close(), 1500);
                });
            }, 800);
        }
    }, [isPrintMode, isDownloadMode, filterMonth, userName]);

    const [editingId, setEditingId] = useState<string | null>(null);
    const [h15, setH15] = useState<string>('');
    const [h20, setH20] = useState<string>('');
    const [h30, setH30] = useState<string>('');

    const calculateDuration = (start: string, end: string) => {
        if (!start || !end) return 0;
        const [h1, m1] = start.split(':').map(Number);
        const [h2, m2] = end.split(':').map(Number);
        const totalMinutes = (h2 * 60 + m2) - (h1 * 60 + m1);
        return Math.max(0, totalMinutes / 60);
    };

    const multipliers = { ot15: 1.5, ot20: 2.0, ot30: 3.0, mixed: 0 };
    const [otType, setOtType] = useState<'ot15' | 'ot20' | 'ot30' | 'mixed'>('ot15');

    const publicHolidays2026 = [
        '2026-01-01', // Tahun Baru
        '2026-02-17', // Tahun Baru Cina
        '2026-03-21', // Hari Raya Aidilfitri
        '2026-03-22', // Hari Raya Aidilfitri
        '2026-03-23', // Hari Raya Aidilfitri
        '2026-03-24', // Hari Raya Aidilfitri
        '2026-05-01', // Hari Pekerja
        '2026-05-27', // Hari Raya Aidiladha
        '2026-05-28', // Hari Raya Aidiladha
        '2026-06-01', // Hari Keputeraan YDP Agong
        '2026-07-31', // Keputeraan Sultan Pahang
        '2026-08-25', // Maulidur Rasul
        '2026-08-31', // Hari Kebangsaan
        '2026-09-16', // Hari Malaysia
        '2026-12-25', // Hari Krismas
    ];

    useEffect(() => {
        if (date && !editingId) {
            if (publicHolidays2026.includes(date)) {
                setOtType('ot30');
            } else {
                const selectedDate = new Date(date);
                const dayOfWeek = selectedDate.getDay();
                if (dayOfWeek === 0 || dayOfWeek === 6) {
                    setOtType('ot20');
                } else {
                    setOtType('ot15');
                }
            }
        }
    }, [date, editingId]);

    const hourlyRate = (basicSalary || 0) / 26 / 7.5;
    const currentDuration = calculateDuration(startTime, endTime);

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
        let list = [...logs].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        if (filterMonth) {
            list = list.filter(l => l.date.substring(0, 7) === filterMonth);
        }
        return list;
    }, [logs, filterMonth]);

    const stats = useMemo(() => {
        const thisMonth = logs.filter(l => l.date.substring(0, 7) === filterMonth);
        return {
            totalHours: logs.reduce((acc, curr) => acc + curr.duration, 0),
            monthHours: thisMonth.reduce((acc, curr) => acc + curr.duration, 0),
            totalPayment: logs.reduce((acc, curr) => acc + (curr.paymentAmount || 0), 0),
            monthPayment: thisMonth.reduce((acc, curr) => acc + (curr.paymentAmount || 0), 0),
        };
    }, [logs, filterMonth]);

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

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const duration = calculateDuration(startTime, endTime);
        if (duration <= 0) {
            alert("End time must be after start time");
            return;
        }

        const finalHours = {
            ot15: parseFloat(h15) || 0,
            ot20: parseFloat(h20) || 0,
            ot30: parseFloat(h30) || 0
        };

        if (finalHours.ot15 === 0 && finalHours.ot20 === 0 && finalHours.ot30 === 0) {
            (finalHours as any)[otType] = duration;
        }

        const newLog: LocalOTLog = {
            id: editingId || Date.now().toString(),
            date,
            startTime,
            endTime,
            duration: finalHours.ot15 + finalHours.ot20 + finalHours.ot30,
            reason,
            otType: (finalHours.ot15 > 0 && (finalHours.ot20 > 0 || finalHours.ot30 > 0)) || (finalHours.ot20 > 0 && finalHours.ot30 > 0) ? 'mixed' :
                finalHours.ot30 > 0 ? 'ot30' : finalHours.ot20 > 0 ? 'ot20' : 'ot15',
            hourlyRate: hourlyRate,
            paymentAmount: (finalHours.ot15 * 1.5 + finalHours.ot20 * 2.0 + finalHours.ot30 * 3.0) * hourlyRate,
            h15: finalHours.ot15,
            h20: finalHours.ot20,
            h30: finalHours.ot30,
            p15: finalHours.ot15 * 1.5 * hourlyRate,
            p20: finalHours.ot20 * 2.0 * hourlyRate,
            p30: finalHours.ot30 * 3.0 * hourlyRate,
        };

        if (editingId) {
            setLogs(logs.map(l => l.id === editingId ? newLog : l));
            setEditingId(null);
        } else {
            setLogs([...logs, newLog]);
        }
        
        setFilterMonth(date.substring(0, 7));
        setDate('');
        setStartTime('');
        setEndTime('');
        setReason('');
        setH15('');
        setH20('');
        setH30('');
    };

    const handleEdit = (log: LocalOTLog) => {
        setEditingId(log.id);
        setDate(log.date);
        setStartTime(log.startTime);
        setEndTime(log.endTime);
        setReason(log.reason);
        setOtType(log.otType);
        setH15(log.h15?.toString() || '');
        setH20(log.h20?.toString() || '');
        setH30(log.h30?.toString() || '');
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

    const resetCalculator = () => {
        if (confirm("Adakah anda pasti mahu memadam SEMUA (Kosongkan Cache)? Sejarah OT dan data pekerja akan dibuang.")) {
            setLogs([]);
            setUserName('');
            setBasicSalary(0);
            setIcNumber('');
            localStorage.clear();
        }
    };

    if (isPrintMode || isDownloadMode) {
        return (
            <div id="pdf-content" className="bg-white min-h-screen relative overflow-hidden py-10 w-full max-w-4xl mx-auto">
                <style>{`
                    @media print {
                        @page { margin: 10mm; }
                        body { background-color: white !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
                    }
                `}</style>
                <div style={{
                    position: 'fixed',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    zIndex: 0,
                    opacity: 0.20,
                    pointerEvents: 'none'
                }}>
                    <img src="/logo-ksb.jpg" alt="Watermark" style={{ width: '600px', filter: 'grayscale(100%)' }} />
                </div>
                {/* Print Template Body */}
                <div className="text-black font-serif relative z-10 w-full px-8">
                    <div className="text-center mb-10">
                        <h2 className="text-xl font-bold uppercase underline">Klinik Syed Badaruddin Sdn. Bhd</h2>
                        <h3 className="text-lg font-bold uppercase mt-1">Borang Kerja Lebih Masa (O.T)</h3>
                    </div>

                    <div className="grid grid-cols-2 gap-x-20 gap-y-2 mb-6 text-sm">
                        <div className="flex gap-4">
                            <span className="font-bold w-20">NAMA</span>
                            <span className="border-b border-black flex-1 uppercase">: {userName || '___________________________'}</span>
                        </div>
                        <div className="flex gap-4">
                            <span className="font-bold w-20">BULAN</span>
                            <span className="border-b border-black flex-1 uppercase">: {new Date(filterMonth + '-01').toLocaleString('default', { month: 'short', year: '2-digit' })}</span>
                        </div>
                        <div className="flex gap-4">
                            <span className="font-bold w-20">NO. K/P</span>
                            <span className="border-b border-black flex-1">: {icNumber || '___________________________'}</span>
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
                            {/* Fill empty rows */}
                            {[...Array(Math.max(0, 10 - filteredLogs.length))].map((_, i) => (
                                <tr key={`empty-${i}`} className="h-8">
                                    <td className="border-2 border-black"></td><td className="border-2 border-black"></td><td className="border-2 border-black"></td><td className="border-2 border-black"></td><td className="border-2 border-black"></td><td className="border-2 border-black"></td><td className="border-2 border-black"></td>
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
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-10 animate-fade-in max-w-6xl mx-auto w-full">
            
            {/* PROFILE SETTINGS */}
            <NeuCard className="bg-gradient-to-r from-blue-500/10 to-transparent border-l-4 border-blue-500">
                <div className="flex flex-col sm:flex-row gap-6 items-start sm:items-center justify-between">
                    <div className="flex items-center gap-4">
                        <div className="bg-blue-100 p-4 rounded-full shadow-inner">
                            <User className="w-8 h-8 text-blue-500" />
                        </div>
                        <div>
                            <h2 className="text-xl font-black text-gray-700">Maklumat Staf</h2>
                            <p className="text-xs text-gray-400 font-bold uppercase tracking-widest mt-1 mb-2">Sila isi sebelum pengiraan OT</p>
                            <button type="button" onClick={resetCalculator} className="text-[10px] font-black uppercase text-red-500 hover:text-red-700 hover:underline flex items-center gap-1 transition-all">
                                <Trash2 className="w-3 h-3" /> Clear Cache & Reset Semua
                            </button>
                        </div>
                    </div>
                    <div className="flex-1 w-full max-w-2xl grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="space-y-1">
                            <label className="text-[10px] font-black tracking-widest uppercase text-gray-500 ml-2">Nama Penuh</label>
                            <input
                                type="text"
                                placeholder="Cth: Ali Bin Abu"
                                value={userName}
                                onChange={e => setUserName(e.target.value)}
                                className="w-full p-4 bg-neu-base rounded-2xl shadow-neu-pressed text-sm font-bold text-gray-700 outline-none focus:bg-white transition-colors"
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-[10px] font-black tracking-widest uppercase text-gray-500 ml-2">NO. K/P</label>
                            <input
                                type="text"
                                placeholder="Cth: 890611-11-5521"
                                value={icNumber}
                                onChange={e => {
                                    let val = e.target.value.replace(/[^0-9]/g, '');
                                    if (val.length > 6) val = val.substring(0,6) + '-' + val.substring(6);
                                    if (val.length > 9) val = val.substring(0,9) + '-' + val.substring(9);
                                    if (val.length > 14) val = val.substring(0,14);
                                    setIcNumber(val);
                                }}
                                className="w-full p-4 bg-neu-base rounded-2xl shadow-neu-pressed text-sm font-bold text-gray-700 outline-none focus:bg-white transition-colors"
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-[10px] font-black tracking-widest uppercase text-gray-500 ml-2">Gaji Asas (RM)</label>
                            <input
                                type="number"
                                placeholder="Cth: 2000"
                                value={basicSalary || ''}
                                onChange={e => setBasicSalary(parseFloat(e.target.value))}
                                className="w-full p-4 bg-neu-base rounded-2xl shadow-neu-pressed text-sm font-bold text-gray-700 outline-none focus:bg-white transition-colors"
                            />
                        </div>
                    </div>
                </div>
            </NeuCard>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
                {/* LEFT COLUMN: Submit Form & Stats */}
                <div className="lg:col-span-4 space-y-10">
                    <NeuCard className="bg-blue-500/5 relative overflow-hidden group">
                        <div className="absolute top-0 left-0 w-2 h-full bg-blue-500"></div>
                        <div className="flex items-center gap-3 mb-8">
                            <Clock className="w-6 h-6 text-blue-500" />
                            <h3 className="text-xl font-black text-gray-700">{editingId ? 'Edit Overtime Claim' : 'Kira Overtime'}</h3>
                        </div>
                        <form onSubmit={handleSubmit} className="space-y-8">
                            <NeuInput type="date" label="Work Date" value={date} onChange={e => setDate(e.target.value)} required />
                            <div className="grid grid-cols-2 gap-4">
                                <NeuInput type="time" label="Start Time" value={startTime} onChange={e => setStartTime(e.target.value)} required />
                                <NeuInput type="time" label="End Time" value={endTime} onChange={e => setEndTime(e.target.value)} required />
                            </div>

                            <div className="space-y-2">
                                <div className="flex justify-between items-center pr-1">
                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Kategori OT</label>
                                    <button type="button" onClick={() => setShowHolidayImage(true)} className="text-[10px] text-blue-500 font-bold flex items-center gap-1 hover:underline">
                                        <Info className="w-3 h-3" /> Rujukan Cuti Umum 2026
                                    </button>
                                </div>
                                <select
                                    value={otType}
                                    title="Kategori Overtime"
                                    onChange={e => setOtType(e.target.value as any)}
                                    className="w-full p-4 bg-neu-base rounded-2xl shadow-neu-pressed text-sm font-bold text-gray-700 outline-none border border-transparent focus:border-blue-300 transition-all appearance-none"
                                >
                                    <option value="ot15">OT15: Hari Biasa (1.5x)</option>
                                    <option value="ot20">OT20: Ahad / Cuti Rehat (2.0x)</option>
                                    <option value="ot30">OT30: Cuti Am / Public Holiday (3.0x)</option>
                                </select>
                            </div>

                            <div className="grid grid-cols-3 gap-2">
                                <div className="space-y-1">
                                    <label className="text-[8px] font-black text-blue-500 uppercase ml-1">Jam 1.5x</label>
                                    <input
                                        type="number"
                                        placeholder={otType === 'ot15' ? currentDuration.toFixed(1) : "0"}
                                        value={h15}
                                        onChange={e => setH15(e.target.value)}
                                        className="w-full p-2 bg-neu-base rounded-lg shadow-neu-pressed text-xs font-bold text-gray-700 outline-none"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[8px] font-black text-green-500 uppercase ml-1">Jam 2.0x</label>
                                    <input
                                        type="number"
                                        placeholder={otType === 'ot20' ? currentDuration.toFixed(1) : "0"}
                                        value={h20}
                                        onChange={e => setH20(e.target.value)}
                                        className="w-full p-2 bg-neu-base rounded-lg shadow-neu-pressed text-xs font-bold text-gray-700 outline-none"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[8px] font-black text-purple-500 uppercase ml-1">Jam 3.0x</label>
                                    <input
                                        type="number"
                                        placeholder={otType === 'ot30' ? currentDuration.toFixed(1) : "0"}
                                        value={h30}
                                        onChange={e => setH30(e.target.value)}
                                        className="w-full p-2 bg-neu-base rounded-lg shadow-neu-pressed text-xs font-bold text-gray-700 outline-none"
                                    />
                                </div>
                            </div>

                            <NeuTextArea label="Sebab / Kerja" value={reason} onChange={e => setReason(e.target.value)} placeholder="Tujuan overtime..." required />

                            <div className="p-6 bg-neu-base rounded-2xl shadow-neu-pressed flex flex-col gap-4 group-hover:bg-blue-50/10 transition-colors">
                                <div className="flex justify-between items-center">
                                    <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Total OT Hours</span>
                                    <span className="text-xl font-black text-gray-700">{totalHours > 0 ? totalHours.toFixed(2) : currentDuration.toFixed(2)} <span className="text-xs uppercase ml-1">Hours</span></span>
                                </div>
                                <div className="h-px bg-gray-100 italic flex items-center justify-center relative">
                                    <span className="bg-neu-base px-2 text-[8px] font-black text-gray-300 uppercase">Calculation</span>
                                </div>
                                <div className="space-y-1">
                                    {hours.ot15 > 0 && <div className="flex justify-between text-[10px] font-bold text-gray-500">
                                        <span>1.5x ({hours.ot15}h)</span>
                                        <span>RM {payments.ot15.toFixed(2)}</span>
                                    </div>}
                                    {hours.ot20 > 0 && <div className="flex justify-between text-[10px] font-bold text-gray-500">
                                        <span>2.0x ({hours.ot20}h)</span>
                                        <span>RM {payments.ot20.toFixed(2)}</span>
                                    </div>}
                                    {hours.ot30 > 0 && <div className="flex justify-between text-[10px] font-bold text-gray-500">
                                        <span>3.0x ({hours.ot30}h)</span>
                                        <span>RM {payments.ot30.toFixed(2)}</span>
                                    </div>}
                                    {totalHours === 0 && (
                                        <div className="flex justify-between text-[10px] font-bold text-blue-400 italic">
                                            <span>{multipliers[otType]}x ({currentDuration.toFixed(2)}h)</span>
                                            <span>RM {estimatedPayment.toFixed(2)}</span>
                                        </div>
                                    )}
                                </div>
                                <div className="flex justify-between items-center pt-2 border-t border-blue-100">
                                    <span className="text-[10px] font-black text-blue-400 uppercase tracking-widest">Jumlah Bayaran</span>
                                    <span className="text-2xl font-black text-blue-600">RM {totalHours > 0 ? estimatedPayment.toFixed(2) : (currentDuration * multipliers[otType] * hourlyRate).toFixed(2)}</span>
                                </div>
                                {(!basicSalary || basicSalary === 0) && (
                                    <div className="mt-2 p-2 bg-red-50 rounded-lg flex items-center gap-2">
                                        <AlertCircle className="w-3 h-3 text-red-500" />
                                        <span className="text-[8px] font-bold text-red-500 uppercase">Input Gaji Asas di atas terlebih dahulu.</span>
                                    </div>
                                )}
                            </div>

                            <NeuButton type="submit" variant="primary" className="w-full py-5 flex justify-center items-center gap-3 rounded-2xl shadow-neu-flat text-xs font-black tracking-widest uppercase mt-4" disabled={!basicSalary || basicSalary === 0}>
                                <Save className="w-5 h-5" />
                                {editingId ? 'Kemaskini OT' : 'Tambah Ke Senarai'}
                            </NeuButton>
                            {editingId && (
                                <button
                                    type="button"
                                    onClick={handleCancelEdit}
                                    className="w-full py-2 text-[10px] font-black uppercase text-gray-400 hover:text-red-500 transition-colors"
                                >
                                    Batal Edit
                                </button>
                            )}
                        </form>
                    </NeuCard>

                    <div className="grid grid-cols-1 gap-6">
                        <NeuCard className="text-center py-6 border-t-8 border-green-500 shadow-neu-flat bg-neu-base">
                            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Total Bulan {new Date(filterMonth + '-01').toLocaleString('default', { month: 'short' })}</p>
                            <h4 className="text-3xl font-black text-green-500 tracking-tighter">{stats.monthHours.toFixed(1)} <span className="text-sm">HRS</span></h4>
                            <p className="text-xs font-bold text-green-600">RM {stats.monthPayment.toFixed(2)}</p>
                        </NeuCard>
                    </div>
                </div>

                {/* RIGHT COLUMN: List */}
                <div className="lg:col-span-8 space-y-10">
                    <div className="flex flex-col sm:flex-row justify-between items-center gap-6 px-2">
                        <div className="flex flex-col sm:flex-row items-center sm:items-start sm:gap-6 gap-3 flex-1">
                            <div className="flex items-center gap-3">
                                <Filter className="w-6 h-6 text-blue-500" />
                                <h3 className="text-2xl font-black text-gray-700 tracking-tight">Senarai OT Anda</h3>
                            </div>
                        </div>
                        <div className="w-full sm:w-48">
                            <NeuInput type="month" value={filterMonth} onChange={e => setFilterMonth(e.target.value)} />
                        </div>
                        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                            <NeuButton
                                onClick={() => {
                                    window.open(`${window.location.origin}${window.location.pathname}?print=true&month=${filterMonth}`, '_blank');
                                }}
                                className="flex items-center justify-center gap-2 bg-green-500 hover:bg-green-600 text-white shadow-lg flex-1"
                                disabled={filteredLogs.length === 0}
                            >
                                <Printer className="w-4 h-4" />
                                Cetak PDF
                            </NeuButton>
                            <NeuButton
                                onClick={() => {
                                    window.open(`${window.location.origin}${window.location.pathname}?download=true&month=${filterMonth}`, '_blank');
                                }}
                                className="flex items-center justify-center gap-2 bg-teal-600 hover:bg-teal-700 text-white shadow-lg flex-1"
                                disabled={filteredLogs.length === 0}
                            >
                                <Download className="w-4 h-4" />
                                Simpan PDF
                            </NeuButton>
                        </div>
                    </div>

                    <NeuCard className="p-0 overflow-hidden shadow-neu-flat border-0">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="border-b border-gray-200">
                                        <th className="p-6 text-[10px] font-black text-gray-400 uppercase tracking-widest">Date & Period</th>
                                        <th className="p-6 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">OT 1.5x</th>
                                        <th className="p-6 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">OT 2.0x</th>
                                        <th className="p-6 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">OT 3.0x</th>
                                        <th className="p-6 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">Total RM</th>
                                        <th className="p-6 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-50">
                                    {filteredLogs.map(log => (
                                        <tr key={log.id} className="hover:bg-white transition-colors group">
                                            <td className="p-6">
                                                <p className="text-sm font-black text-gray-700">{log.date}</p>
                                                <p className="text-[10px] text-gray-400 font-bold group-hover:text-blue-400 transition-colors uppercase">{log.startTime} - {log.endTime}</p>
                                            </td>
                                            <td className="p-6 text-center">
                                                <div className="flex flex-col">
                                                    <span className="text-sm font-black text-gray-700">{(log.h15 || (log.otType === 'ot15' ? log.duration : 0)).toFixed(1)}h</span>
                                                    <span className="text-[8px] text-gray-400 font-bold">RM {(log.p15 || (log.otType === 'ot15' ? log.paymentAmount : 0)).toFixed(2)}</span>
                                                </div>
                                            </td>
                                            <td className="p-6 text-center">
                                                <div className="flex flex-col">
                                                    <span className="text-sm font-black text-gray-700">{(log.h20 || (log.otType === 'ot20' ? log.duration : 0)).toFixed(1)}h</span>
                                                    <span className="text-[8px] text-gray-400 font-bold">RM {(log.p20 || (log.otType === 'ot20' ? log.paymentAmount : 0)).toFixed(2)}</span>
                                                </div>
                                            </td>
                                            <td className="p-6 text-center">
                                                <div className="flex flex-col">
                                                    <span className="text-sm font-black text-gray-700">{(log.h30 || (log.otType === 'ot30' ? log.duration : 0)).toFixed(1)}h</span>
                                                    <span className="text-[8px] text-gray-400 font-bold">RM {(log.p30 || (log.otType === 'ot30' ? log.paymentAmount : 0)).toFixed(2)}</span>
                                                </div>
                                            </td>
                                            <td className="p-6 text-right">
                                                <p className="text-sm font-black text-blue-600">RM {(log.paymentAmount || 0).toFixed(2)}</p>
                                                <p className="text-[8px] text-gray-400 italic">{log.reason}</p>
                                            </td>
                                            <td className="p-6 text-right">
                                                <div className="flex justify-end gap-3 opacity-80 group-hover:opacity-100 transition-opacity">
                                                    <button onClick={() => handleEdit(log)} className="p-2 text-blue-400 hover:text-blue-600 transition-colors" title="Edit">
                                                        <Edit3 className="w-5 h-5" />
                                                    </button>
                                                    <button onClick={() => {
                                                        if (confirm("Delete this overtime record?")) setLogs(logs.filter(l => l.id !== log.id));
                                                    }} className="p-2 text-gray-300 hover:text-red-400 transition-colors" title="Delete">
                                                        <Trash2 className="w-5 h-5" />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                    {filteredLogs.length > 0 && (
                                        <tr className="bg-gray-50/50 font-black border-t-2 border-gray-100">
                                            <td className="p-6 text-xs uppercase text-gray-400">Monthly Total</td>
                                            <td className="p-6 text-center text-xs text-blue-500">{monthlySummary.h15.toFixed(1)}h</td>
                                            <td className="p-6 text-center text-xs text-green-500">{monthlySummary.h20.toFixed(1)}h</td>
                                            <td className="p-6 text-center text-xs text-purple-500">{monthlySummary.h30.toFixed(1)}h</td>
                                            <td className="p-6 text-right">
                                                <span className="text-blue-600 text-base">RM {monthlySummary.totalRM.toFixed(2)}</span>
                                            </td>
                                            <td className="p-6 text-right">
                                                <button onClick={resetCalculator} className="text-[10px] text-red-500 uppercase flex items-center gap-1 hover:underline ml-auto">
                                                    Padam Semua (Reset Cache)
                                                </button>
                                            </td>
                                        </tr>
                                    )}
                                    {filteredLogs.length === 0 && (
                                        <tr>
                                            <td colSpan={6} className="p-12 text-center text-gray-400 italic text-sm">
                                                Tiada rekod untuk {new Date(filterMonth + '-02').toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}. <br/>Sila tambah OT di ruangan kiri.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </NeuCard>
                </div>
            </div >

            {/* Holiday Image Modal */}
            {showHolidayImage && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in" onClick={() => setShowHolidayImage(false)}>
                    <div className="bg-white rounded-3xl p-4 max-w-2xl w-full max-h-[90vh] overflow-y-auto relative shadow-2xl" onClick={e => e.stopPropagation()}>
                        <button type="button" onClick={() => setShowHolidayImage(false)} className="absolute top-4 right-4 bg-gray-100 hover:bg-gray-200 p-2 rounded-full transition-colors z-10">
                            <X className="w-5 h-5 text-gray-600" />
                        </button>
                        <h3 className="text-lg font-black text-gray-700 mb-4 text-center">Rujukan Cuti Umum KSB Tahun 2026</h3>
                        <img src="/cuti-umum-2026.png" alt="Rujukan Cuti Umum 2026" className="w-full h-auto rounded-xl border border-gray-100" />
                    </div>
                </div>
            )}

            </div >
    );
};
