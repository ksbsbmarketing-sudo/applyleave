import React, { useState, useEffect } from 'react';
import { Calendar, Plus, Trash2, Edit3, Save, X, CheckCircle } from 'lucide-react';
import { NeuCard, NeuButton, NeuInput } from './NeuElements';
import { PublicHoliday } from '../types';
import { subscribeHolidays, addHoliday, updateHoliday, deleteHoliday } from '../services/firebase';

interface Props {
    allowEdit?: boolean; // HR and above only
}

const CURRENT_YEAR = new Date().getFullYear();

const DEFAULT_HOLIDAYS_2026: Omit<PublicHoliday, 'id'>[] = [
    { date: '2026-01-01', name: 'Tahun Baru', days: 1, site: 'Both', year: 2026 },
    { date: '2026-02-17', name: 'Tahun Baru Cina', days: 1, site: 'Both', year: 2026 },
    { date: '2026-03-21', name: 'Hari Raya Aidilfitri (Hari 1)', days: 1, site: 'Both', year: 2026 },
    { date: '2026-03-22', name: 'Hari Raya Aidilfitri (Hari 2)', days: 1, site: 'Both', year: 2026 },
    { date: '2026-03-23', name: 'Hari Raya Aidilfitri (Hari 3)', days: 1, site: 'Pahang', year: 2026 },
    { date: '2026-05-01', name: 'Hari Pekerja', days: 1, site: 'Both', year: 2026 },
    { date: '2026-05-27', name: 'Hari Raya Aidiladha (Hari 1)', days: 1, site: 'Both', year: 2026 },
    { date: '2026-05-28', name: 'Hari Raya Aidiladha (Hari 2)', days: 1, site: 'Terengganu', year: 2026 },
    { date: '2026-06-01', name: 'Hari Keputeraan YDP Agong', days: 1, site: 'Both', year: 2026 },
    { date: '2026-06-17', name: 'Awal Muharram', days: 1, site: 'Both', year: 2026 },
    { date: '2026-07-31', name: 'Keputeraan Sultan Pahang', days: 1, site: 'Pahang', year: 2026 },
    { date: '2026-08-25', name: 'Maulidur Rasul', days: 1, site: 'Both', year: 2026 },
    { date: '2026-08-31', name: 'Hari Kebangsaan', days: 1, site: 'Both', year: 2026 },
    { date: '2026-09-16', name: 'Hari Malaysia', days: 1, site: 'Both', year: 2026 },
    { date: '2026-12-25', name: 'Hari Krismas', days: 1, site: 'Both', year: 2026 },
];

export const PublicHolidayEditor: React.FC<Props> = ({ allowEdit = false }) => {
    const [holidays, setHolidays] = useState<PublicHoliday[]>([]);
    const [filterYear, setFilterYear] = useState(CURRENT_YEAR);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [showForm, setShowForm] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [successMsg, setSuccessMsg] = useState('');

    // New entry form state
    const [formDate, setFormDate] = useState('');
    const [formName, setFormName] = useState('');
    const [formDays, setFormDays] = useState('1');
    const [formSite, setFormSite] = useState<'Pahang' | 'Terengganu' | 'Both'>('Both');
    const [formYear, setFormYear] = useState(CURRENT_YEAR);

    useEffect(() => {
        const unsub = subscribeHolidays(setHolidays);
        return unsub;
    }, []);

    const filtered = holidays.filter(h => h.year === filterYear);

    const resetForm = () => {
        setFormDate('');
        setFormName('');
        setFormDays('1');
        setFormSite('Both');
        setFormYear(CURRENT_YEAR);
        setEditingId(null);
        setShowForm(false);
    };

    const handleAddDefaults = async () => {
        if (!confirm('Ini akan memasukkan senarai cuti umum 2026 (lalai). Teruskan?')) return;
        setIsSaving(true);
        for (const h of DEFAULT_HOLIDAYS_2026) {
            await addHoliday(h);
        }
        setIsSaving(false);
        flashSuccess('Senarai cuti umum 2026 berjaya dimasukkan!');
    };

    const startEdit = (h: PublicHoliday) => {
        setEditingId(h.id);
        setFormDate(h.date);
        setFormName(h.name);
        setFormDays(String(h.days));
        setFormSite(h.site || 'Both');
        setFormYear(h.year);
        setShowForm(true);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formDate || !formName) return;
        setIsSaving(true);
        const data = {
            date: formDate,
            name: formName,
            days: parseInt(formDays) || 1,
            site: formSite,
            year: formYear,
        };
        if (editingId) {
            await updateHoliday(editingId, data);
            flashSuccess('Rekod kemaskini!');
        } else {
            await addHoliday(data);
            flashSuccess('Cuti umum baru ditambah!');
        }
        setIsSaving(false);
        resetForm();
    };

    const handleDelete = async (id: string, name: string) => {
        if (!confirm(`Padam "${name}"?`)) return;
        await deleteHoliday(id);
        flashSuccess(`"${name}" dipadam.`);
    };

    const flashSuccess = (msg: string) => {
        setSuccessMsg(msg);
        setTimeout(() => setSuccessMsg(''), 3000);
    };

    const siteColor: Record<string, string> = {
        'Both': 'bg-stone-100 text-stone-700 border-stone-200',
        'Pahang': 'bg-premium-bg text-premium-accent border-premium-accent/20',
        'Terengganu': 'bg-stone-50 text-luxury-gold border-luxury-gold/20',
    };

    return (
        <div className="space-y-6 animate-fade-in">
            {/* Header */}
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                    <Calendar className="w-6 h-6 text-premium-accent" />
                    <h3 className="text-lg font-bold text-premium-primary uppercase tracking-widest font-luxury">Takwim Cuti Umum</h3>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    {/* Year filter */}
                    <select
                        value={filterYear}
                        onChange={e => setFilterYear(Number(e.target.value))}
                        aria-label="Filter Tahun"
                        className="px-4 py-2 bg-stone-50 rounded-xl border border-premium-border/50 text-sm font-bold text-premium-primary outline-none focus:border-luxury-gold transition-all shadow-premium-sm"
                    >
                        {[CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1].map(y => (
                            <option key={y} value={y}>{y}</option>
                        ))}
                    </select>

                    {allowEdit && (
                        <>
                            {filtered.length === 0 && (
                                <NeuButton onClick={handleAddDefaults} disabled={isSaving} className="flex items-center gap-2 text-sm px-4 py-2 bg-stone-900 text-stone-100 border-transparent hover:bg-black">
                                    ✨ Isi Lalai 2026
                                </NeuButton>
                            )}
                            <NeuButton
                                variant="primary"
                                onClick={() => { setShowForm(!showForm); setEditingId(null); }}
                                className="flex items-center gap-2 text-sm px-4 py-2"
                            >
                                <Plus className="w-4 h-4" /> Tambah Cuti
                            </NeuButton>
                        </>
                    )}
                </div>
            </div>

            {/* Success message */}
            {successMsg && (
                <div className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-700 text-sm font-bold rounded-xl px-4 py-3">
                    <CheckCircle className="w-4 h-4 flex-shrink-0" /> {successMsg}
                </div>
            )}

            {/* Add / Edit Form */}
            {allowEdit && showForm && (
                <NeuCard className="p-6 border-l-4 border-premium-accent bg-premium-bg/50">
                    <p className="text-xs font-black text-premium-accent uppercase tracking-widest mb-4">
                        {editingId ? '✏️ Kemaskini Cuti' : '➕ Tambah Cuti Umum'}
                    </p>
                    <form onSubmit={handleSave} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                        <NeuInput
                            type="date"
                            label="Tarikh Mula"
                            value={formDate}
                            onChange={e => setFormDate(e.target.value)}
                            required
                        />
                        <NeuInput
                            type="text"
                            label="Nama Cuti"
                            value={formName}
                            onChange={e => setFormName(e.target.value)}
                            placeholder="e.g. Hari Raya Aidilfitri"
                            required
                        />
                        <div className="space-y-2">
                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Cawangan</label>
                            <select
                                value={formSite}
                                onChange={e => setFormSite(e.target.value as any)}
                                aria-label="Cawangan"
                                className="w-full px-4 py-4 bg-stone-50 rounded-2xl border border-premium-border/50 text-sm font-bold text-premium-primary outline-none focus:border-luxury-gold transition-all shadow-premium-sm"
                            >
                                <option value="Both">Semua (Both)</option>
                                <option value="Pahang">Pahang sahaja</option>
                                <option value="Terengganu">Terengganu sahaja</option>
                            </select>
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Tahun</label>
                            <select
                                value={formYear}
                                onChange={e => setFormYear(Number(e.target.value))}
                                aria-label="Tahun"
                                className="w-full px-4 py-4 bg-stone-50 rounded-2xl border border-premium-border/50 text-sm font-bold text-premium-primary outline-none focus:border-luxury-gold transition-all shadow-premium-sm"
                            >
                                {[CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1].map(y => (
                                    <option key={y} value={y}>{y}</option>
                                ))}
                            </select>
                        </div>
                        <div className="flex gap-2 items-end col-span-full">
                            <NeuButton type="submit" variant="gold" disabled={isSaving} className="flex items-center gap-2 px-8 py-3 shadow-premium-md">
                                <Save className="w-4 h-4" /> {isSaving ? 'Menyimpan...' : 'Simpan'}
                            </NeuButton>
                            <NeuButton type="button" variant="default" onClick={resetForm} className="flex items-center gap-2 px-6 py-3">
                                <X className="w-4 h-4" /> Batal
                            </NeuButton>
                        </div>
                    </form>
                </NeuCard>
            )}

            {/* Holiday Table */}
            <NeuCard className="overflow-hidden p-0">
                {filtered.length === 0 ? (
                    <div className="text-center py-12 text-gray-400">
                        <Calendar className="w-10 h-10 mx-auto mb-3 opacity-30" />
                        <p className="text-sm font-bold">Tiada cuti umum untuk tahun {filterYear}.</p>
                        {allowEdit && <p className="text-xs mt-1">Klik <strong>"Tambah Cuti"</strong> atau <strong>"Isi Lalai 2026"</strong> untuk mula.</p>}
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-premium-bg/50 border-b border-premium-border/50">
                                    <th className="p-4 text-[10px] font-black text-premium-muted uppercase tracking-widest">Bil</th>
                                    <th className="p-4 text-[10px] font-black text-premium-muted uppercase tracking-widest">Tarikh</th>
                                    <th className="p-4 text-[10px] font-black text-premium-muted uppercase tracking-widest">Hari Kelepasan</th>
                                    <th className="p-4 text-[10px] font-black text-premium-muted uppercase tracking-widest text-center">Cawangan</th>
                                    {allowEdit && <th className="p-4 text-[10px] font-black text-premium-muted uppercase tracking-widest text-right pr-6">Tindakan</th>}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-premium-border/30">
                                {filtered.map((h, i) => {
                                    const d = new Date(h.date + 'T00:00:00');
                                    const dayName = d.toLocaleDateString('ms-MY', { weekday: 'long' });
                                    const dateDisplay = d.toLocaleDateString('ms-MY', { day: 'numeric', month: 'short', year: 'numeric' });
                                    return (
                                        <tr key={h.id} className="hover:bg-stone-50/50 transition-colors group">
                                            <td className="p-4 text-sm font-bold text-stone-400">{i + 1}</td>
                                            <td className="p-4">
                                                <p className="text-sm font-black text-premium-primary uppercase tracking-tight">{dateDisplay}</p>
                                                <p className="text-[11px] text-premium-muted font-bold group-hover:text-premium-accent transition-colors uppercase tracking-widest">{dayName}</p>
                                            </td>
                                            <td className="p-4">
                                                <p className="text-sm font-bold text-premium-primary tracking-tight">{h.name}</p>
                                            </td>
                                            <td className="p-4 text-center">
                                                <span className={`px-2 py-1 rounded-full text-[10px] font-black uppercase ${siteColor[h.site || 'Both']}`}>
                                                    {h.site || 'Both'}
                                                </span>
                                            </td>
                                            {allowEdit && (
                                                <td className="p-4 text-right pr-6">
                                                <div className="flex justify-end gap-3">
                                                        <button onClick={() => startEdit(h)} className="p-2 text-stone-400 hover:text-luxury-gold transition-colors" title="Edit">
                                                            <Edit3 className="w-5 h-5" />
                                                        </button>
                                                        <button onClick={() => handleDelete(h.id, h.name)} className="p-2 text-stone-300 hover:text-rose-500 transition-colors" title="Padam">
                                                            <Trash2 className="w-5 h-5" />
                                                        </button>
                                                    </div>
                                                </td>
                                            )}
                                        </tr>
                                    );
                                })}
                                <tr className="bg-stone-50/50 font-black border-t-2 border-premium-border/30">
                                    <td colSpan={allowEdit ? 4 : 3} className="p-4 text-right text-[10px] text-premium-muted uppercase tracking-widest">
                                        Jumlah Hari ({filterYear})
                                    </td>
                                    <td className="p-4 text-center text-luxury-gold text-lg font-luxury">
                                        {filtered.reduce((sum, h) => sum + h.days, 0)}
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                )}
            </NeuCard>

            <p className="text-[10px] text-gray-400 font-bold italic">
                ⚠️ Tarikh Cuti Raya (Aidilfitri & Aidiladha) tertakluk kepada pengumuman rasmi. Sila kemaskini apabila tarikh disahkan.
            </p>
        </div>
    );
};
