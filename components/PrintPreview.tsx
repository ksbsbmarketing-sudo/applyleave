import React, { useEffect, useState } from 'react';
import { LeaveLog, Staff } from '../types';
import { Printer, ArrowLeft } from 'lucide-react';

export const PrintPreview: React.FC = () => {
    const [log, setLog] = useState<LeaveLog | null>(null);
    const [staff, setStaff] = useState<Staff | null>(null);
    const [printType, setPrintType] = useState<'leave' | 'locum'>('leave');

    useEffect(() => {
        try {
            const data = localStorage.getItem('printLogData');
            if (data) {
                const parsed = JSON.parse(data);
                setLog(parsed.log);
                setStaff(parsed.staff);
                if (parsed.type) setPrintType(parsed.type);
            }
        } catch (e) {
            console.error(e);
        }
    }, []);

    const calculateHours = (start?: string, end?: string) => {
        if (!start || !end) return '-';
        try {
            const [sH, sM] = start.split(':').map(Number);
            const [eH, eM] = end.split(':').map(Number);
            let diff = (eH * 60 + eM) - (sH * 60 + sM);
            if (diff <= 0) diff += 24 * 60;
            const h = Math.floor(diff / 60);
            const m = diff % 60;
            return m > 0 ? `${h}h ${m}m` : `${h}h`;
        } catch (e) { return '-'; }
    };

    if (!log) {
        return <div className="p-10 text-center font-bold text-gray-500">Loading print data...</div>;
    }

    const entitlementAL = staff?.entitlementAL || '-';
    const balanceALBefore = (staff?.balanceAL || 0) + log.duration;

    let printBrand = {
        logo: '/logo.jpg',
        watermark: '/logo-ksb.jpg',
        title1: 'Klinik',
        title2: staff?.branch?.toLowerCase().startsWith('klinik syed badaruddin')
            ? staff.branch.replace(/^Klinik\s+/i, '')
            : 'Syed Badaruddin'
    };

    if (staff?.branch?.toLowerCase().includes("bentong")) {
        printBrand = {
            logo: '/logo-bentong.jpg',
            watermark: '/logo-bentong.jpg',
            title1: 'Uni Klinik',
            title2: 'Bentong'
        };
    } else if (staff?.branch?.toLowerCase().includes("rakyat") || staff?.branch?.toLowerCase().includes("dungun")) {
        printBrand = {
            logo: '/logo-kr.jpg',
            watermark: '/logo-kr.jpg',
            title1: 'Klinik Rakyat',
            title2: 'Dan X-Ray Dungun'
        };
    }

    // ── LOCUM DUTY RECORD RENDER ──
    if (printType === 'locum') {
        const totalHours = calculateHours(log.locumStartTime, log.locumEndTime);

        // Determine watermark based on locum branch (staff may be null here)
        const branchForWatermark = (log.locumBranch || staff?.branch || '').toLowerCase();
        let watermarkSrc = '/logo-ksb.jpg';
        let clinicName = log.locumBranch || staff?.branch || 'Klinik Syed Badaruddin';
        if (branchForWatermark.includes('bentong')) {
            watermarkSrc = '/logo-bentong.jpg';
        } else if (branchForWatermark.includes('rakyat') || branchForWatermark.includes('dungun')) {
            watermarkSrc = '/logo-kr.jpg';
        }

        return (
            <div className="min-h-screen bg-gray-100 p-0 sm:p-8 flex flex-col items-center">
                <div className="w-full max-w-4xl flex items-center justify-between bg-white/80 backdrop-blur-md px-6 py-4 rounded-2xl shadow-premium-sm mb-6 print:hidden border border-premium-border/50">
                    <button onClick={() => window.close()} className="flex items-center gap-2 text-sm font-bold text-premium-muted hover:text-premium-primary transition-colors">
                        <ArrowLeft className="w-4 h-4" /> Tutup Preview
                    </button>
                    <button onClick={() => window.print()} className="flex items-center gap-2 bg-luxury-gold hover:bg-luxury-gold/90 text-white px-6 py-2 rounded-xl font-bold text-sm shadow-premium-md transition-all">
                        <Printer className="w-4 h-4" /> Cetak Rekod Locum
                    </button>
                </div>

                {/* A4 Page */}
                <div
                    className="w-[210mm] min-h-[297mm] shadow-xl rounded-sm mx-auto relative"
                    style={{ backgroundColor: '#ffffff' }}
                >
                    {/* WATERMARK — absolute centered, behind all content */}
                    <img
                        src={watermarkSrc}
                        alt=""
                        aria-hidden="true"
                        style={{
                            position: 'absolute',
                            top: '50%',
                            left: '50%',
                            transform: 'translate(-50%, -50%)',
                            width: '70%',
                            height: 'auto',
                            objectFit: 'contain',
                            opacity: 0.15,
                            zIndex: 0,
                            pointerEvents: 'none',
                        }}
                    />

                    {/* Content — above watermark */}
                    <div className="relative p-[15mm] text-black print:p-[10mm]" style={{ zIndex: 10 }}>
                        <h1 className="text-center text-2xl font-bold mb-2 font-luxury tracking-widest text-premium-primary">
                            REKOD BERTUGAS LOCUM
                        </h1>
                        <p className="text-center text-[10px] font-black text-premium-muted uppercase tracking-[0.5em] mb-6">
                            Locum Duty Record
                        </p>

                        {/* Replaced Doctor Info */}
                        <div className="text-center mb-8">
                            <p className="text-[11px] font-black uppercase tracking-[0.2em] border border-luxury-gold/30 inline-block px-8 py-3 bg-stone-50 rounded-lg">
                                <span className="text-premium-muted">NAMA DOKTOR YANG DIGANTIKAN:</span> <br/>
                                <span className="text-luxury-gold text-sm font-luxury mt-1 block tracking-normal">{log.staffName}</span>
                            </p>
                        </div>

                        <div className="space-y-10">
                            {/* Section 1: Doctor Particulars */}
                            <section>
                                <h2 className="font-bold text-[13px] mb-4 uppercase tracking-tighter border-l-4 border-black pl-3">MAKLUMAT DOKTOR / PERSONAL PARTICULARS</h2>
                                <div className="grid grid-cols-[180px_1fr] gap-y-4 gap-x-6 text-[13px]">
                                    <span className="font-medium">Nama Penuh:</span>
                                    <div className="border-b border-black font-bold uppercase pb-1">{log.locumDoctor || '____________________________________________________'}</div>

                                    <span className="font-medium">No. MMC / APC:</span>
                                    <div className="border-b border-black pb-1">____________________________________________________</div>

                                    <span className="font-medium">No. Telefon:</span>
                                    <div className="border-b border-black pb-1">____________________________________________________</div>
                                </div>
                            </section>

                            {/* Section 2: Premises Information */}
                            <section>
                                <h2 className="font-bold text-[13px] mb-4 uppercase tracking-tighter border-l-4 border-black pl-3">MAKLUMAT PREMIS / PREMISES INFORMATION</h2>
                                <div className="grid grid-cols-[180px_1fr] gap-y-4 gap-x-6 text-[13px]">
                                    <span className="font-medium">Nama Klinik/Hospital:</span>
                                    <div className="border-b border-black font-bold uppercase pb-1">{printBrand.title1} {printBrand.title2}</div>

                                    <span className="font-medium">Cawangan / Lokasi:</span>
                                    <div className="border-b border-black font-bold uppercase pb-1">{log.locumBranch || staff?.branch}</div>
                                </div>
                            </section>

                            {/* Section 3: Duty Table */}
                            <div className="mt-6">
                                <table className="w-full border-collapse border-2 border-black text-center text-[12px]">
                                    <thead>
                                        <tr>
                                            <th className="border-2 border-black p-3 w-[20%] font-bold bg-gray-100">Tarikh</th>
                                            <th className="border-2 border-black p-3 w-[18%] font-bold bg-gray-100">Masa Mula</th>
                                            <th className="border-2 border-black p-3 w-[18%] font-bold bg-gray-100">Masa Tamat</th>
                                            <th className="border-2 border-black p-3 w-[18%] font-bold bg-gray-100">Jumlah Jam</th>
                                            <th className="border-2 border-black p-3 font-bold bg-gray-100">Pengesahan (Cop/Sign)</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr className="h-12">
                                            <td className="border-2 border-black p-3 font-black">{log.locumDate || '-'}</td>
                                            <td className="border-2 border-black p-3">{log.locumStartTime || '-'}</td>
                                            <td className="border-2 border-black p-3">{log.locumEndTime || '-'}</td>
                                            <td className="border-2 border-black p-3 font-black">{totalHours}</td>
                                            <td className="border-2 border-black p-3"></td>
                                        </tr>
                                        {[...Array(11)].map((_, i) => (
                                            <tr key={i} className="h-10">
                                                <td className="border border-black"></td>
                                                <td className="border border-black"></td>
                                                <td className="border border-black"></td>
                                                <td className="border border-black"></td>
                                                <td className="border border-black"></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            {/* Section 4: Signature Footer */}
                            <div className="grid grid-cols-2 gap-32 mt-16 text-[13px]">
                                <div className="space-y-4">
                                    <div className="h-12 border-b-2 border-black"></div>
                                    <p className="font-bold">Tandatangan Doktor:</p>
                                </div>
                                <div className="space-y-4">
                                    <div className="h-12 border-b-2 border-black"></div>
                                    <p className="font-bold">Tarikh:</p>
                                </div>
                            </div>
                        </div>

                        <div className="mt-12 text-center text-[10px] text-gray-400 italic">
                            Page 1 | Generated from Smart Leave Tracker
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // ── STANDARD LEAVE FORM RENDER ──
    return (
        <div className="min-h-screen bg-gray-100 p-4 sm:p-8 flex flex-col items-center">
            {/* Top Toolbar (Hidden when printing) */}
            <div className="w-full max-w-4xl flex items-center justify-between bg-white/80 backdrop-blur-md px-6 py-4 rounded-2xl shadow-premium-sm mb-6 print:hidden border border-premium-border/50">
                <button
                    onClick={() => window.close()}
                    className="flex items-center gap-2 text-sm font-bold text-premium-muted hover:text-premium-primary transition-colors"
                >
                    <ArrowLeft className="w-4 h-4" /> Tutup Preview
                </button>
                <div className="flex gap-3">
                    <button
                        onClick={() => window.print()}
                        className="flex items-center gap-2 bg-luxury-gold hover:bg-luxury-gold/90 text-white px-6 py-2 rounded-xl font-bold text-sm shadow-premium-md transition-all"
                    >
                        <Printer className="w-4 h-4" /> Cetak Borang (Print)
                    </button>
                </div>
            </div>

            {/* Print Page Container */}
            <div className="w-[210mm] min-h-[297mm] bg-white print:bg-transparent shadow-xl rounded-sm print:shadow-none print:w-[210mm] print:h-[297mm] relative overflow-hidden mx-auto print:m-0 print:border-none print:p-0">

                {/* Background Image Watermark (Centered on the whole A4 page) - FIXED FOR CHROME PRINT */}
                <div
                    className="absolute inset-0 pointer-events-none flex items-center justify-center"
                    style={{ zIndex: 1, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
                >
                    <img
                        src={printBrand.watermark}
                        alt="Watermark"
                        style={{
                            width: '85%',
                            height: 'auto',
                            objectFit: 'contain',
                            opacity: 0.25
                        }}
                    />
                </div>

                {/* ── Content (Same as previous print layout) ── */}
                <div className="p-10 relative" style={{ zIndex: 10 }}>
                    <div className="relative mb-6 pb-2">
                        <div className="relative flex flex-col items-center justify-center pt-6">
                            <div className="flex items-center gap-6 mb-4">
                                <img src={printBrand.logo} alt="Logo" className="w-24 h-24 object-contain" />
                                <div className="text-left">
                                    <h1 className="text-[2.2rem] font-black text-gray-800 tracking-tighter uppercase leading-none">
                                        {printBrand.title1}
                                    </h1>
                                    <h1 className={`font-black text-gray-800 tracking-tighter uppercase leading-none mt-1 ${printBrand.title2.length > 20 ? 'text-[2rem]' : 'text-[2.6rem]'}`}>
                                        {printBrand.title2}
                                    </h1>
                                    <p className="text-[10px] font-bold text-gray-600 uppercase tracking-[0.25em] mt-3 pt-2 border-t border-gray-400">
                                        - SERVICING COMMUNITY SINCE 1991 -
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="text-center py-3 font-bold text-xl uppercase tracking-[0.4em] mb-8 border-y border-premium-border/30 text-premium-primary bg-stone-50/50 font-luxury">
                        Borang Permohonan Cuti
                    </div>

                    {/* Category Selection */}
                    <div className="grid grid-cols-[180px_1fr] items-center gap-2 mb-6">
                        <span className="text-[13px] font-black uppercase tracking-widest text-premium-muted">Kategori Cuti</span>
                        <div className="border border-luxury-gold/50 p-3 min-h-[40px] font-bold text-lg flex items-center bg-stone-50 font-luxury text-premium-accent rounded-lg">
                            {
                                log.type === 'AL' ? 'CUTI TAHUNAN (AL)' :
                                log.type === 'MC' ? 'CUTI SAKIT (MC)' :
                                log.type === 'HL' ? 'CUTI HOSPITALISASI (HL)' :
                                log.type === 'ML' ? 'CUTI BERSALIN (MATERNITY)' :
                                log.type === 'PL' ? 'CUTI ISTERI BERSALIN (PATERNITY)' :
                                log.type === 'BL' ? 'CUTI EHSAN (BL)' :
                                log.type === 'EL' ? 'CUTI KECEMASAN (EL)' :
                                log.type === 'RL' ? 'CUTI GANTI (RL)' :
                                log.type === 'UL' ? 'CUTI TANPA GAJI (UL)' :
                                log.type === 'CME' ? 'CUTI CME (UNTUK DOKTOR)' : log.type
                            }
                        </div>
                    </div>

                    {/* Details Table */}
                    <div className="space-y-4 text-xs font-black">
                        <div className="grid grid-cols-[180px_1fr] items-center gap-2">
                            <span className="uppercase tracking-widest text-premium-muted">Tarikh Memohon</span>
                            <div className="border border-premium-border/50 p-2 min-h-[32px] rounded">{new Date(log.timestamp).toLocaleDateString('en-GB')}</div>
                        </div>
                        <div className="grid grid-cols-[180px_1fr] items-center gap-2">
                            <span className="uppercase tracking-widest text-premium-muted">Nama Pemohon</span>
                            <div className="border border-premium-border/50 p-2 min-h-[32px] font-bold text-premium-primary rounded uppercase">{log.staffName}</div>
                        </div>
                        <div className="grid grid-cols-[180px_1fr] items-center gap-2">
                            <span className="uppercase tracking-widest text-premium-muted">No. K/P</span>
                            <div className="border border-premium-border/50 p-2 min-h-[32px] rounded">{log.staffId}</div>
                        </div>
                        <div className="grid grid-cols-[180px_1fr] items-center gap-2">
                            <span className="uppercase tracking-widest text-premium-muted">Mula Bekerja</span>
                            <div className="border border-premium-border/50 p-2 min-h-[32px] rounded">
                                {staff?.joinDate || '-'}
                            </div>
                        </div>
                        <div className="grid grid-cols-[180px_1fr] items-center gap-2">
                            <span className="uppercase tracking-widest text-premium-muted">Kelayakan AL</span>
                            <div className="border border-premium-border/50 p-2 min-h-[32px] rounded font-bold text-premium-accent">
                                {entitlementAL} Hari
                            </div>
                        </div>
                        <div className="grid grid-cols-[180px_1fr] items-center gap-2">
                            <span className="uppercase tracking-widest text-premium-muted">Baki Terdahulu</span>
                            <div className="border border-premium-border/50 p-2 min-h-[32px] rounded font-bold text-premium-accent">
                                {balanceALBefore} Hari
                            </div>
                        </div>

                        <div className="grid grid-cols-[180px_1fr] gap-2 items-start">
                            <div className="flex flex-col">
                                <span className="uppercase tracking-widest text-premium-muted leading-none mb-1">Cuti Dipohon</span>
                            </div>
                            <div className="flex gap-2 h-full">
                                <div className="border border-luxury-gold/50 p-2 min-h-[32px] w-20 text-center font-bold text-premium-accent bg-stone-50 rounded">{log.duration} Hari</div>
                                <div className="border border-premium-border/50 flex-1 p-2 min-h-[32px] rounded">{log.startDate} to {log.endDate}</div>
                            </div>
                        </div>

                        <div className="grid grid-cols-[180px_1fr] items-center gap-2">
                            <span className="uppercase tracking-widest text-premium-muted">Baki Terkini</span>
                            <div className="border border-premium-border/50 p-2 min-h-[32px] rounded font-bold text-luxury-gold">
                                {staff?.balanceAL || 0} Hari
                            </div>
                        </div>

                        <div className="grid grid-cols-[180px_1fr] items-center gap-2">
                            <span className="uppercase tracking-widest text-premium-muted">Tugas Diambil Alih</span>
                            <div className="border border-premium-border/50 p-2 min-h-[32px] rounded font-medium italic">{log.dutyHandover || '-'}</div>
                        </div>

                        <div className="grid grid-cols-[180px_1fr] gap-2 items-start h-20">
                            <span className="uppercase tracking-widest text-premium-muted inline-block pt-2">Sebab Cuti</span>
                            <div className="border border-premium-border/50 p-2 h-full break-words rounded bg-stone-50 ml-[2px]">
                                {log.reason}
                            </div>
                        </div>

                        {/* Signature Section */}
                        <div className="grid grid-cols-2 gap-8 mt-12 pt-8">
                            <div className="space-y-8">
                                <div className="h-16 border-b border-black relative">
                                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                        {(log.status === 'hod_approved' || log.status === 'approved') && <p className="text-gray-400 italic font-medium">Digitally Signed By HOD</p>}
                                    </div>
                                </div>
                                <p className="text-[10px] uppercase text-center tracking-widest text-gray-500">Tandatangan Pengurus Caw.</p>
                            </div>
                            <div className="space-y-8">
                                <div className="h-16 border-b border-black relative">
                                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                        {log.status === 'approved' && <p className="text-gray-400 italic font-medium">Digitally Signed By GM</p>}
                                    </div>
                                </div>
                                <p className="text-[10px] uppercase text-center tracking-widest text-gray-500">Tandatangan Pengurus Besar</p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer Notes */}
                <div className="mt-12 pt-12 border-t border-gray-100 italic text-[10px] text-gray-400 text-center pb-4 print:absolute print:bottom-4 print:w-full">
                    This is a computer-generated document from the Smart Leave Tracker. No physical signature is required.
                </div>
            </div>
        </div>
    );
};
