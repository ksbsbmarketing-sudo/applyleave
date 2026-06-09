/**
 * KSB Leave Apply — Word Document Generator
 * Jana fail .docx dari kandungan manual
 */

const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
  AlignmentType, WidthType, BorderStyle, PageBreak, NumberFormat,
  TableOfContents, StyleLevel, LevelFormat, convertInchesToTwip, ShadingType,
  UnderlineType, Header, Footer
} = require('docx');
const fs = require('fs');

// ── Warna & font ──────────────────────────────────────────────────────────────
const BLUE      = '1D4ED8';
const DARK      = '1E293B';
const MUTED     = '64748B';
const GREEN     = '059669';
const AMBER     = 'B45309';
const RED       = 'DC2626';
const BG_BLUE   = 'EFF6FF';
const BG_GREEN  = 'F0FDF4';
const BG_AMBER  = 'FFFBEB';
const FONT      = 'Calibri';

// ── Helper: teks biasa ────────────────────────────────────────────────────────
const t = (text, opts = {}) => new TextRun({
  text,
  font: FONT,
  size: (opts.size || 22),
  bold: opts.bold || false,
  italics: opts.italic || false,
  color: opts.color || DARK,
  underline: opts.underline ? { type: UnderlineType.SINGLE } : undefined,
});

// ── Helper: perenggan ─────────────────────────────────────────────────────────
const p = (children, opts = {}) => new Paragraph({
  children: Array.isArray(children) ? children : [children],
  spacing: { before: opts.before ?? 80, after: opts.after ?? 80 },
  alignment: opts.align || AlignmentType.LEFT,
  indent: opts.indent ? { left: convertInchesToTwip(opts.indent) } : undefined,
});

// ── Helper: heading ───────────────────────────────────────────────────────────
const h1 = (text) => new Paragraph({
  children: [new TextRun({ text, font: FONT, size: 40, bold: true, color: BLUE })],
  heading: HeadingLevel.HEADING_1,
  spacing: { before: 400, after: 160 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: BLUE, space: 4 } },
});

const h2 = (text) => new Paragraph({
  children: [new TextRun({ text, font: FONT, size: 28, bold: true, color: BLUE })],
  heading: HeadingLevel.HEADING_2,
  spacing: { before: 320, after: 120 },
});

const h3 = (text) => new Paragraph({
  children: [new TextRun({ text, font: FONT, size: 24, bold: true, color: DARK })],
  heading: HeadingLevel.HEADING_3,
  spacing: { before: 240, after: 80 },
});

const h4 = (text) => new Paragraph({
  children: [new TextRun({ text, font: FONT, size: 22, bold: true, color: MUTED })],
  heading: HeadingLevel.HEADING_4,
  spacing: { before: 180, after: 60 },
});

// ── Helper: bullet ────────────────────────────────────────────────────────────
const bullet = (children, level = 0) => new Paragraph({
  children: Array.isArray(children) ? children : [t(children)],
  bullet: { level },
  spacing: { before: 40, after: 40 },
  indent: { left: convertInchesToTwip(0.25 + level * 0.25) },
});

// ── Helper: numbered ─────────────────────────────────────────────────────────
const numbered = (children, num) => new Paragraph({
  children: [t(`${num}. `, { bold: true }), ...(Array.isArray(children) ? children : [t(children)])],
  spacing: { before: 60, after: 60 },
  indent: { left: convertInchesToTwip(0.3) },
});

// ── Helper: callout box ───────────────────────────────────────────────────────
const callout = (icon, label, text, color = BLUE, bg = BG_BLUE) => [
  new Paragraph({
    children: [t(`${icon}  ${label}: `, { bold: true, color }), t(text, { color: DARK })],
    spacing: { before: 120, after: 120 },
    indent: { left: convertInchesToTwip(0.2), right: convertInchesToTwip(0.2) },
    shading: { type: ShadingType.CLEAR, fill: bg },
    border: {
      left:   { style: BorderStyle.SINGLE, size: 16, color, space: 8 },
      top:    { style: BorderStyle.NONE },
      bottom: { style: BorderStyle.NONE },
      right:  { style: BorderStyle.NONE },
    },
  }),
];

// ── Helper: divider ───────────────────────────────────────────────────────────
const divider = () => new Paragraph({
  children: [],
  spacing: { before: 80, after: 80 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' } },
});

// ── Helper: page break ────────────────────────────────────────────────────────
const pageBreak = () => new Paragraph({ children: [new PageBreak()] });

// ── Helper: cell ─────────────────────────────────────────────────────────────
const cell = (text, opts = {}) => new TableCell({
  children: [new Paragraph({
    children: [new TextRun({ text: text ?? '', font: FONT, size: 20, bold: opts.bold || false, color: opts.color || DARK })],
    alignment: opts.align || AlignmentType.LEFT,
    spacing: { before: 60, after: 60 },
  })],
  shading: opts.shade ? { type: ShadingType.CLEAR, fill: opts.shade } : undefined,
  width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
  columnSpan: opts.span,
  margins: { top: 60, bottom: 60, left: 120, right: 120 },
  borders: {
    top:    { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
    bottom: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
    left:   { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
    right:  { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
  },
});

const headerCell = (text, width) => cell(text, { bold: true, shade: BLUE, color: 'FFFFFF', width });

// ── Helper: table ─────────────────────────────────────────────────────────────
const makeTable = (headers, rows, widths) => new Table({
  width: { size: 100, type: WidthType.PERCENTAGE },
  rows: [
    new TableRow({ children: headers.map((h, i) => headerCell(h, widths?.[i])), tableHeader: true }),
    ...rows.map((row, ri) => new TableRow({
      children: row.map((c, ci) => cell(c, { shade: ri % 2 === 1 ? 'F8FAFC' : undefined, width: widths?.[ci] })),
    })),
  ],
  margins: { top: 80, bottom: 80 },
});

// ─────────────────────────────────────────────────────────────────────────────
// DOCUMENT CONTENT
// ─────────────────────────────────────────────────────────────────────────────

const children = [

  // ═══════════════════════════════════════════════════════════════ COVER PAGE
  new Paragraph({
    children: [],
    spacing: { before: 2000 },
  }),
  new Paragraph({
    children: [new TextRun({ text: '🏥', font: FONT, size: 72 })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 200 },
  }),
  new Paragraph({
    children: [new TextRun({ text: 'MANUAL PENGGUNA RASMI', font: FONT, size: 24, color: MUTED, bold: true })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 120 },
  }),
  new Paragraph({
    children: [new TextRun({ text: 'KSB Leave Apply', font: FONT, size: 64, bold: true, color: BLUE })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 120 },
  }),
  new Paragraph({
    children: [new TextRun({ text: 'Sistem Pengurusan Cuti Digital', font: FONT, size: 28, color: MUTED })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 80 },
  }),
  new Paragraph({
    children: [new TextRun({ text: 'Klinik Syed Badaruddin (KSB)', font: FONT, size: 28, bold: true, color: DARK })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 600 },
  }),
  new Paragraph({
    children: [
      new TextRun({ text: '🌐  LINK SISTEM UTAMA: ', font: FONT, size: 24, bold: true, color: BLUE }),
      new TextRun({ text: 'https://apply-leave-89ebb.web.app', font: FONT, size: 24, bold: true, color: BLUE, underline: true })
    ],
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 200 },
  }),
  new Paragraph({
    children: [new TextRun({ text: 'Versi 1.2  |  Jun 2026  |  Platform: Web / PWA', font: FONT, size: 20, color: MUTED })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 0 },
  }),
  pageBreak(),

  // ═════════════════════════════════════════════════════════════ ISI KANDUNGAN
  h1('ISI KANDUNGAN'),
  ...[
    ['1', 'Pengenalan Sistem'],
    ['2', 'Log Masuk & Log Keluar'],
    ['3', 'Peranan & Hak Akses (RBAC)'],
    ['4', 'Dashboard'],
    ['5', 'Permohonan Cuti Baru'],
    ['6', 'Jenis-Jenis Cuti & Kelayakan'],
    ['7', 'Aliran Kelulusan Dua Peringkat'],
    ['8', 'Modul Kelulusan (Pending Approvals)'],
    ['9', 'Modul Pengurusan Staf'],
    ['10', 'Modul Pengurusan Cawangan'],
    ['11', 'Laporan Cuti'],
    ['12', 'Audit Log'],
    ['13', 'Tetapan Sistem'],
    ['14', 'Notifikasi WhatsApp'],
    ['15', 'Polisi Cuti'],
    ['', 'Lampiran — Senarai Cawangan KSB'],
    ['', 'Soalan Lazim (FAQ)'],
    ['', 'Sejarah Versi'],
  ].map(([num, title]) => new Paragraph({
    children: [
      new TextRun({ text: num ? `${num}.  ` : '      ', font: FONT, size: 22, bold: !!num, color: BLUE }),
      new TextRun({ text: title, font: FONT, size: 22, color: DARK }),
    ],
    spacing: { before: 60, after: 60 },
    indent: { left: convertInchesToTwip(0.3) },
  })),
  pageBreak(),

  // ═══════════════════════════════════════════════════════════ 1. PENGENALAN
  h1('1.  Pengenalan Sistem'),
  p([t('KSB Leave Apply', { bold: true }), t(' adalah sistem pengurusan cuti dalam talian (web-based) untuk semua staf Klinik Syed Badaruddin (KSB). Sistem ini membolehkan:')]),
  bullet('Staf membuat permohonan cuti secara digital'),
  bullet('HOD / PIC / Supervisor meluluskan cuti Peringkat 1 (Sokongan)'),
  bullet('HR / Admin meluluskan cuti Peringkat 2 (Kelulusan Akhir)'),
  bullet('Semua pergerakan cuti direkodkan secara automatik'),
  bullet('Notifikasi WhatsApp dihantar kepada semua pihak berkaitan'),
  p([t('URL UTAMA SISTEM: ', { bold: true }), t('https://apply-leave-89ebb.web.app', { color: BLUE, underline: true, bold: true })], { before: 160 }),
  p([t('Pelayar yang disokong: ', { bold: true }), t('Chrome, Safari, Edge, Firefox (versi terkini)')]),
  p([t('Aplikasi Mudah Alih: ', { bold: true }), t('Sistem boleh dipasang sebagai PWA (Progressive Web App) pada telefon pintar — tekan butang "Tambah ke Skrin Utama" pada pelayar anda.')]),
  pageBreak(),

  // ═══════════════════════════════════════════════════════════ 2. LOG MASUK
  h1('2.  Log Masuk & Log Keluar'),
  h2('Cara Log Masuk'),
  ...callout('🔐', 'WAJIB: TUKAR KATA LALUAN SELEPAS LOG MASUK PERTAMA!', 'Demi keselamatan akaun anda, anda WAJIB menukar kata laluan lalai (nombor IC anda) sejurus selepas log masuk kali pertama. Cara-caranya:\n1. Pergi ke Settings (ikon gear) dari bar navigasi.\n2. Pilih sub-menu Security (Keselamatan).\n3. Masukkan kata laluan semasa (nombor IC anda).\n4. Masukkan kata laluan baharu dan klik SIMPAN.', AMBER, BG_AMBER),
  numbered([t('Layari URL Utama Sistem: '), t('https://apply-leave-89ebb.web.app', { bold: true, color: BLUE, underline: true })], 1),
  numbered([t('Pilih Cawangan', { bold: true }), t(' anda dari senarai dropdown')], 2),
  numbered([t('Taip nama', { bold: true }), t(' anda dalam kotak carian — senarai nama akan muncul secara automatik')], 3),
  numbered([t('Pilih nama', { bold: true }), t(' anda dari senarai')], 4),
  numbered([t('Masukkan Kata Laluan', { bold: true }), t(' (kata laluan asal = nombor IC anda tanpa tanda "-")')], 5),
  numbered([t('Tekan butang ', {}), t('LOG MASUK', { bold: true })], 6),

  h2('Lupa Kata Laluan'),
  numbered('Pilih cawangan dan nama anda terlebih dahulu', 1),
  numbered([t('Tekan pautan '), t('"Lupa Kata Laluan?"', { bold: true })], 2),
  numbered('Sistem akan menghantar kata laluan ke nombor WhatsApp anda yang berdaftar', 3),
  numbered('Hubungi HR/Admin jika nombor WhatsApp belum didaftarkan', 4),

  h2('Log Keluar'),
  bullet([t('Tekan butang '), t('"Log Keluar"', { bold: true }), t(' di bahagian atas skrin')]),
  bullet([t('Sistem akan log keluar secara automatik selepas '), t('30 minit', { bold: true }), t(' tidak aktif')]),
  ...callout('⚠️', 'PENTING', 'Jangan kongsi kata laluan anda dengan orang lain. Tukar kata laluan segera selepas log masuk pertama melalui Tetapan → Keselamatan.', AMBER, BG_AMBER),
  pageBreak(),

  // ═══════════════════════════════════════════════════════════ 3. PERANAN
  h1('3.  Peranan & Hak Akses'),
  p([t('Sistem menggunakan sistem kawalan akses berasaskan peranan (RBAC). Setiap peranan mempunyai hak akses yang berbeza:')]),
  makeTable(
    ['Peranan', 'Dashboard', 'Mohon Cuti', 'Kelulusan', 'Urus Staf', 'Laporan', 'Audit'],
    [
      ['Super Admin', 'Analisa', '✓', '✓', '✓', '✓', '✓'],
      ['Admin',       'Analisa', '✓', '✓', '✓', '✓', '✓'],
      ['HR',          'Staff',   '✓', '✓ (P1+P2)', '✓', '✓', '—'],
      ['HOD',         'Staff',   '✓', '✓ (P1)',    '—', '—', '—'],
      ['PIC/HOD',     'Staff',   '✓', '✓ (P1)',    '—', '—', '—'],
      ['Supervisor',  'Staff',   '✓', '✓ (P1)',    '—', '—', '—'],
      ['Staff',       'Staff',   '✓', '—',         '—', '—', '—'],
    ],
    [20, 13, 13, 15, 13, 13, 13]
  ),
  h2('Penerangan Peranan'),
  makeTable(
    ['Peranan', 'Penerangan'],
    [
      ['Super Admin', 'Akses penuh kepada semua modul termasuk konfigurasi RBAC dan token WhatsApp'],
      ['Admin',       'Pengurusan penuh kecuali konfigurasi WhatsApp'],
      ['HR',          'Kelulusan akhir cuti, pengurusan staf dan cawangan'],
      ['HOD',         'Ketua Jabatan — meluluskan cuti Peringkat 1 untuk cawangan sendiri'],
      ['PIC/HOD',     'Penolong Ketua — meluluskan cuti Peringkat 1 (sama seperti HOD)'],
      ['Supervisor',  'Penyelia — meluluskan cuti Peringkat 1 khusus Balok HQ dan Doktor Pahang'],
      ['Staff',       'Staf biasa — hanya boleh membuat permohonan cuti sendiri'],
    ],
    [20, 80]
  ),
  pageBreak(),

  // ═══════════════════════════════════════════════════════════ 4. DASHBOARD
  h1('4.  Dashboard'),
  p([t('Dashboard adalah skrin utama selepas log masuk. Paparan berbeza mengikut peranan pengguna.')]),
  h2('Dashboard Staf (Staff, HOD, PIC, Supervisor, HR)'),
  bullet([t('Kad Profil', { bold: true }), t(' — Nama, cawangan, kategori, dan tempoh perkhidmatan')]),
  bullet([t('Kad AL (Annual Leave)', { bold: true }), t(' — Baki hari AL dengan pecahan terperinci:')]),
  bullet([t('Bawa Lepas (CF)', { bold: true, color: MUTED }), t(' — Hari AL dibawa dari tahun lepas')], 1),
  bullet([t('Peruntukan Tahun Ini', { bold: true, color: MUTED }), t(' — AL yang diperuntukkan untuk tahun semasa')], 1),
  bullet([t('Digunakan', { bold: true, color: MUTED }), t(' — Jumlah hari AL yang telah diluluskan dalam sistem')], 1),
  bullet([t('Pelarasan HR', { bold: true, color: MUTED }), t(' — Hari AL yang digunakan sebelum sistem diaktifkan (jika ada)')], 1),
  bullet([t('Kad MC', { bold: true }), t(' — Baki Medical Leave semasa dengan bar progres')]),
  bullet([t('Rekod Cuti Saya', { bold: true }), t(' — Senarai semua permohonan cuti (boleh tapis mengikut status)')]),
  bullet([t('Pelulusan Tertangguh', { bold: true }), t(' — Permohonan yang menunggu tindakan (untuk HOD/PIC/HR)')]),

  h2('Dashboard Analisa (Admin, Super Admin)'),
  bullet([t('Carta Bar Bulanan', { bold: true }), t(' — Jumlah cuti mengikut bulan (AL, MC, EL)')]),
  bullet([t('Carta Donut', { bold: true }), t(' — Pecahan jenis cuti sepanjang tahun')]),
  bullet([t('Statistik Staf', { bold: true }), t(' — Baki AL dan MC untuk semua staf')]),
  bullet([t('Tapis Mengikut Bulan', { bold: true }), t(' — Klik pada bulan untuk melihat rekod terperinci')]),
  pageBreak(),

  // ═══════════════════════════════════════════════════════════ 5. PERMOHONAN
  h1('5.  Permohonan Cuti Baru'),
  h2('Langkah-Langkah'),
  numbered([t('Dari menu navigasi, pilih '), t('"Mohon Cuti"', { bold: true }), t(' (atau ikon tambah pada menu terapung di mudah alih)')], 1),
  numbered([t('Pilih Jenis Cuti', { bold: true }), t(' dari senarai kad yang terpapar')], 2),
  numbered([t('Pilih Tarikh Mula', { bold: true }), t(' dan '), t('Tarikh Tamat', { bold: true })], 3),
  numbered([t('Jika separuh hari, tandakan '), t('"Separuh Hari"', { bold: true })], 4),
  numbered([t('Pilih Pelulus Peringkat 1', { bold: true }), t(' dari dropdown (mengikut kategori staf)')], 5),
  numbered([t('Masukkan '), t('Catatan/Sebab', { bold: true }), t(' permohonan (pilihan)')], 6),
  numbered([t('Muat naik '), t('Dokumen Sokongan', { bold: true }), t(' jika diperlukan (MC wajib untuk Medical Leave)')], 7),
  numbered([t('Semak '), t('Kiraan Hari', { bold: true }), t(' yang dikira secara automatik')], 8),
  numbered([t('Tekan butang '), t('HANTAR PERMOHONAN', { bold: true })], 9),

  h2('Pemilihan Pelulus Peringkat 1'),
  makeTable(
    ['Kategori', 'Cawangan', 'Pelulus Peringkat 1'],
    [
      ['Doktor', 'Pahang (kecuali MCKIP & Bentong)', 'Supervisor — Balok HQ'],
      ['Doktor', 'MCKIP / Bentong', 'HOD / PIC_HOD cawangan sendiri'],
      ['Doktor', 'Terengganu & lain', 'HOD / PIC_HOD cawangan sendiri'],
      ['Staff Admin', 'Semua cawangan', 'HOD klinik sendiri (jika tiada HOD → PIC)'],
      ['Staff Operasi', 'Balok HQ', 'Supervisor — Balok HQ'],
      ['Staff Operasi', 'Cawangan lain', 'Doctor PIC cawangan sendiri'],
    ],
    [20, 35, 45]
  ),

  h2('Polisi Notis Awal'),
  bullet([t('Staff Admin: ', { bold: true }), t('Permohonan AL perlu dibuat sekurang-kurangnya '), t('3 hari', { bold: true }), t(' awal')]),
  bullet([t('Semua lain: ', { bold: true }), t('Permohonan AL perlu dibuat sekurang-kurangnya '), t('7 hari', { bold: true }), t(' awal')]),
  bullet('MC dan EL dikecualikan dari polisi notis awal'),

  h2('Status Permohonan'),
  makeTable(
    ['Status', 'Penerangan'],
    [
      ['PENDING',      'Menunggu sokongan Peringkat 1 (HOD/PIC/Supervisor)'],
      ['HOD APPROVED', 'Diluluskan Peringkat 1 — menunggu kelulusan HR/Admin'],
      ['APPROVED',     'Diluluskan sepenuhnya — cuti SAH'],
      ['REJECTED',     'Ditolak'],
      ['CANCELLED',    'Dibatalkan'],
    ],
    [25, 75]
  ),
  pageBreak(),

  // ═══════════════════════════════════════════════════════════ 6. JENIS CUTI
  h1('6.  Jenis-Jenis Cuti & Kelayakan'),
  makeTable(
    ['Kod', 'Nama', 'Kelayakan', 'Penerangan'],
    [
      ['AL',          'Annual Leave',              '14–20 hari',  'Cuti tahunan, dikira pro-rata'],
      ['MC',          'Medical Leave',             '14 hari',     'Cuti sakit — wajib lampirkan MC'],
      ['EL',          'Emergency/Compassionate',   '3 hari',      'Kematian keluarga terdekat'],
      ['EL_EMG',      'Emergency (Non-Ehsan)',      '—',           'Kecemasan am (bukan kematian)'],
      ['UP',          'Unpaid Leave (UL)',          '—',           'Cuti tanpa gaji selepas AL habis'],
      ['HL',          'Hospitalization',           '60 hari',     'Cuti wad / hospitalisasi'],
      ['ML',          'Maternity Leave',           '98 hari',     'Cuti bersalin (wanita)'],
      ['PL',          'Paternity Leave',           '7 hari',      'Cuti paterniti (lelaki)'],
      ['CME',         'CME Leave',                 '5 hari',      'Pendidikan perubatan — Doktor sahaja'],
      ['REPLACEMENT', 'Replacement Leave',         '—',           'Gantian hari bekerja semasa cuti umum'],
    ],
    [12, 28, 15, 45]
  ),

  h2('Kelayakan Annual Leave (AL)'),
  makeTable(
    ['Tempoh Perkhidmatan', 'Hari AL Setahun'],
    [
      ['Kurang 2 tahun', '8 hari'],
      ['2 – 5 tahun',    '12 hari'],
      ['Lebih 5 tahun',  '16 hari'],
    ],
    [50, 50]
  ),
  ...callout('ℹ️', 'Nota', 'AL dikira secara pro-rata berdasarkan bulan bekerja dalam tahun semasa bagi staf baru.', BLUE, BG_BLUE),
  pageBreak(),

  // ═══════════════════════════════════════════════════════════ 7. ALIRAN
  h1('7.  Aliran Kelulusan Dua Peringkat'),
  p([t('Sistem menggunakan aliran '), t('DUA PERINGKAT', { bold: true }), t(' untuk semua permohonan cuti:')]),

  new Paragraph({ children: [t('STAF MEMOHON', { bold: true, color: BLUE })], alignment: AlignmentType.CENTER, spacing: { before: 120, after: 40 } }),
  new Paragraph({ children: [t('↓', { color: MUTED, size: 28 })], alignment: AlignmentType.CENTER, spacing: { before: 0, after: 40 } }),
  new Paragraph({ children: [t('PERINGKAT 1 — Sokongan', { bold: true, color: AMBER })], alignment: AlignmentType.CENTER, spacing: { before: 0, after: 0 } }),
  new Paragraph({ children: [t('(HOD / PIC_HOD / Supervisor / Doctor PIC)', { color: MUTED, size: 20 })], alignment: AlignmentType.CENTER, spacing: { before: 0, after: 40 } }),
  new Paragraph({ children: [t('↓', { color: MUTED, size: 28 })], alignment: AlignmentType.CENTER, spacing: { before: 0, after: 40 } }),
  new Paragraph({ children: [t('Status: HOD APPROVED', { bold: true, color: AMBER })], alignment: AlignmentType.CENTER, spacing: { before: 0, after: 40 } }),
  new Paragraph({ children: [t('↓', { color: MUTED, size: 28 })], alignment: AlignmentType.CENTER, spacing: { before: 0, after: 40 } }),
  new Paragraph({ children: [t('PERINGKAT 2 — Kelulusan Akhir', { bold: true, color: GREEN })], alignment: AlignmentType.CENTER, spacing: { before: 0, after: 0 } }),
  new Paragraph({ children: [t('(HR / Admin)', { color: MUTED, size: 20 })], alignment: AlignmentType.CENTER, spacing: { before: 0, after: 40 } }),
  new Paragraph({ children: [t('↓', { color: MUTED, size: 28 })], alignment: AlignmentType.CENTER, spacing: { before: 0, after: 40 } }),
  new Paragraph({ children: [t('✅  Status: APPROVED', { bold: true, color: GREEN })], alignment: AlignmentType.CENTER, spacing: { before: 0, after: 120 } }),

  h2('Bypass oleh HR/Admin'),
  p([t('Jika Peringkat 1 belum dilakukan, HR/Admin '), t('boleh meluluskan terus', { bold: true }), t(' (bypass). Sistem akan menunjukkan amaran pengesahan sebelum tindakan ini dilaksanakan.')]),

  h2('Penolakan'),
  p([t('Mana-mana pelulus (Peringkat 1 atau 2) boleh menolak permohonan. Pemohon akan menerima notifikasi WhatsApp.')]),

  h2('Pembatalan'),
  bullet([t('Staf boleh membatalkan permohonan yang berstatus '), t('PENDING', { bold: true }), t(' sahaja')]),
  bullet('HOD/PIC/HR boleh membatalkan mana-mana permohonan yang belum diluluskan'),
  pageBreak(),

  // ═══════════════════════════════════════════════════════════ 8. KELULUSAN
  h1('8.  Modul Kelulusan (Pending Approvals)'),
  p([t('Modul ini hanya kelihatan kepada HOD, PIC_HOD, Supervisor, HR, dan Admin.')]),
  h2('Paparan Kad Kelulusan'),
  p([t('Setiap permohonan dipaparkan dalam kad yang mengandungi:')]),
  bullet('Nama pemohon, cawangan, dan kategori'),
  bullet('Jenis cuti dan tempoh'),
  bullet('Status semasa (badge berwarna)'),
  bullet('Peringkat kelulusan (Peringkat 1 atau 2)'),
  bullet([t('Butang tindakan: '), t('Luluskan', { bold: true, color: GREEN }), t(', '), t('Tolak', { bold: true, color: RED }), t(', '), t('Batal', { bold: true, color: MUTED })]),

  h2('Butang Tindakan Mengikut Peranan'),
  makeTable(
    ['Peranan', 'Nama Butang', 'Tindakan'],
    [
      ['HOD / PIC_HOD / Supervisor', '"Sokong & Hantar ke HR/Admin"', 'Luluskan P1 → status jadi HOD APPROVED'],
      ['HR / Admin (HOD APPROVED)',  '"Luluskan Akhir (Peringkat 2)"','Kelulusan akhir → status jadi APPROVED'],
      ['HR / Admin (PENDING)',       '"Luluskan Terus (Bypass HOD)"', 'Bypass Peringkat 1 dengan pengesahan'],
    ],
    [30, 35, 35]
  ),

  h2('Maklumat Locum (Doktor Sahaja)'),
  p([t('Untuk cuti doktor, HOD perlu mengisi maklumat '), t('Doktor Locum', { bold: true }), t(' sebelum cuti boleh diluluskan: nama doktor locum, tarikh dan masa penggantian.')]),

  h2('Hantar Semula Notifikasi WhatsApp'),
  p([t('Jika staf tidak menerima notifikasi WhatsApp selepas cuti diluluskan, HR/Admin boleh menghantar semula notifikasi:')]),
  numbered([t('Pergi ke '), t('Pengurusan → Laporan → Tab "Diluluskan"', { bold: true })], 1),
  numbered('Cari rekod cuti staf berkenaan', 2),
  numbered([t('Tekan butang '), t('Hantar Semula', { bold: true, color: GREEN }), t(' (ikon WhatsApp hijau) pada baris rekod tersebut')], 3),
  pageBreak(),

  // ═══════════════════════════════════════════════════════════ 9. STAF
  h1('9.  Modul Pengurusan Staf'),
  p([t('Hanya boleh diakses oleh '), t('Admin, HR, dan Super Admin', { bold: true }), t('.')]),

  h2('Lihat Senarai Staf'),
  bullet([t('Paparan kad maklumat setiap staf')]),
  bullet([t('Baki AL dan MC terkini')]),
  bullet([t('Tanda amaran (merah) jika baki AL rendah (kurang 3 hari)')]),
  bullet([t('Cari staf mengikut nama atau IC')]),

  h2('Tambah Staf Baru'),
  numbered([t('Tekan butang '), t('"+ Tambah Staf"', { bold: true })], 1),
  numbered('Isi maklumat: Nama, IC, Cawangan, Kategori, Peranan, Nombor Telefon, Tarikh Mula', 2),
  numbered([t('Tekan '), t('SIMPAN', { bold: true })], 3),
  ...callout('🔑', 'Kata Laluan Awal', 'Kata laluan awal staf baru = Nombor IC mereka. Staf perlu tukar kata laluan sendiri selepas log masuk pertama.', AMBER, BG_AMBER),

  h2('Kemaskini Profil & Baki Cuti'),
  p([t('Klik ikon edit pada mana-mana kad staf untuk membuka modal '), t('Kemaskini Profil & Baki Cuti', { bold: true }), t('. Modal ini mengandungi dua bahagian untuk AL:')]),

  h3('Bahagian 1 — Peruntukan AL'),
  makeTable(
    ['Medan', 'Penerangan'],
    [
      ['Baki AL Tahun Lepas (CF)', 'Hari AL yang dibawa dari tahun lepas — maksimum 3 hari'],
      ['AL Diperuntukkan Tahun Ini', 'Kelayakan AL penuh untuk tahun semasa'],
      ['Jumlah AL Terkini', 'Dikira secara automatik: CF + AL Tahun Ini'],
    ],
    [35, 65]
  ),

  h3('Bahagian 2 — Penggunaan & Baki Sebenar (BAHARU)'),
  makeTable(
    ['Medan', 'Penerangan'],
    [
      ['AL Digunakan (Rekod Sistem)', 'Dikira automatik dari rekod cuti yang diluluskan dalam sistem — tidak boleh diedit'],
      ['Pelarasan HR (Cuti Sebelum Sistem)', 'Input manual oleh HR — hari AL yang telah digunakan sebelum sistem digunakan atau pindahan dari rekod HR'],
      ['Baki AL Sebenar', 'Dikira automatik: Jumlah AL − Digunakan − Pelarasan HR'],
    ],
    [35, 65]
  ),

  h3('Cara Sync Baki Cuti HR dengan Sistem'),
  numbered([t('Buka modal '), t('Kemaskini Profil & Baki Cuti', { bold: true }), t(' untuk staf berkenaan')], 1),
  numbered([t('Pastikan '), t('Baki AL Tahun Lepas (CF)', { bold: true }), t(' dan '), t('AL Diperuntukkan Tahun Ini', { bold: true }), t(' sudah betul')], 2),
  numbered([t('Lihat '), t('AL Digunakan (Rekod Sistem)', { bold: true }), t(' — ini dikira dari rekod cuti dalam sistem')], 3),
  numbered([t('Jika staf ada menggunakan cuti sebelum sistem digunakan (contoh: Jan–Apr), masukkan jumlah hari tersebut dalam '), t('Pelarasan HR', { bold: true })], 4),
  numbered([t('Semak '), t('Baki AL Sebenar', { bold: true }), t(' — nilai ini akan sama dengan baki dalam rekod HR')], 5),
  numbered([t('Tekan '), t('Commit Changes', { bold: true }), t(' untuk simpan')], 6),
  ...callout('💡', 'Contoh', 'Staf diperuntukkan 14 hari AL + 2 hari CF = 16 hari. Staf guna 5 hari dari Jan–Apr sebelum sistem, dan 2 hari dalam sistem. Masukkan 5 dalam Pelarasan HR. Baki Sebenar = 16 − 2 − 5 = 9 hari.', GREEN, BG_GREEN),

  h2('Nyahaktifkan / Aktifkan Staf'),
  bullet([t('Togol "Staf Tidak Aktif" untuk menyembunyikan staf dari senarai')]),
  bullet([t('Staf tidak aktif tidak boleh log masuk')]),
  bullet([t('Rekod cuti staf tidak aktif kekal tersimpan')]),
  pageBreak(),

  // ═══════════════════════════════════════════════════════════ 10. CAWANGAN
  h1('10.  Modul Pengurusan Cawangan'),
  p([t('Hanya boleh diakses oleh '), t('Admin, HR, dan Super Admin', { bold: true }), t('.')]),
  h2('Fungsi Utama'),
  bullet('Tambah cawangan baru dengan nama dan negeri'),
  bullet('Kemaskini negeri cawangan menggunakan dropdown dalam senarai'),
  bullet('Padam cawangan yang tidak aktif (cawangan ada staf tidak boleh dipadam)'),
  bullet('Lihat bilangan staf aktif bagi setiap cawangan'),
  ...callout('📍', 'Nota', 'Negeri cawangan adalah penting kerana ia menentukan aliran kelulusan cuti — khususnya untuk Doktor Pahang yang menggunakan Supervisor Balok HQ sebagai pelulus Peringkat 1.', BLUE, BG_BLUE),
  pageBreak(),

  // ═══════════════════════════════════════════════════════════ 11. LAPORAN
  h1('11.  Laporan Cuti'),
  p([t('Hanya boleh diakses oleh '), t('Admin dan Super Admin', { bold: true }), t('.')]),
  h2('Jana Laporan'),
  numbered([t('Pergi ke modul '), t('Pengurusan → Laporan', { bold: true })], 1),
  numbered('Tapis mengikut tahun, cawangan, atau jenis cuti', 2),
  numbered([t('Tekan '), t('"Jana Laporan"', { bold: true }), t(' untuk mencetak dalam format A4')], 3),
  h2('Kandungan Laporan'),
  bullet('Nama staf dan cawangan'),
  bullet('Jenis cuti, tarikh mula, tarikh tamat, tempoh (hari)'),
  bullet('Status kelulusan'),
  bullet('Jumlah hari cuti diambil sepanjang tempoh'),
  pageBreak(),

  // ═══════════════════════════════════════════════════════════ 12. AUDIT
  h1('12.  Audit Log'),
  p([t('Sistem merekodkan semua aktiviti penting secara automatik dalam pangkalan data.')]),
  makeTable(
    ['Aktiviti Direkodkan', 'Masa'],
    [
      ['Log masuk ke sistem',              'Automatik'],
      ['Permohonan cuti baru dihantar',    'Automatik'],
      ['Kelulusan / Penolakan cuti',       'Automatik'],
      ['Tambah / Edit / Nyahaktif staf',   'Automatik'],
      ['Tukar kata laluan',                'Automatik'],
      ['Perubahan tetapan RBAC',           'Automatik'],
    ],
    [70, 30]
  ),
  ...callout('🔍', 'Akses', 'Audit Log boleh dilihat di Pengurusan → Master Logs. Hanya Admin dan Super Admin mempunyai akses penuh.', BLUE, BG_BLUE),
  pageBreak(),

  // ═══════════════════════════════════════════════════════════ 13. TETAPAN
  h1('13.  Tetapan Sistem'),
  h2('Tetapan Peribadi (Semua Pengguna)'),
  p([t('Boleh diakses melalui ikon tetapan di menu navigasi:')]),
  bullet('Tukar Nama Paparan'),
  bullet('Tukar Nombor Telefon'),
  bullet('Tukar Jantina'),
  h2('Tukar Kata Laluan'),
  numbered([t('Pergi ke '), t('Tetapan → Keselamatan', { bold: true })], 1),
  numbered('Masukkan kata laluan lama', 2),
  numbered('Masukkan kata laluan baru (minimum 6 aksara)', 3),
  numbered([t('Tekan '), t('SIMPAN', { bold: true })], 4),
  h2('Konfigurasi RBAC (Super Admin Sahaja)'),
  bullet([t('Pergi ke '), t('Pengurusan → Kawalan Akses', { bold: true })]),
  bullet('Togol setiap modul untuk mengaktifkan atau menyahaktifkan akses bagi setiap peranan'),
  bullet([t('Tekan '), t('SIMPAN KONFIGURASI', { bold: true }), t(' untuk menyimpan')]),
  pageBreak(),

  // ═══════════════════════════════════════════════════════════ 14. WHATSAPP
  h1('14.  Notifikasi WhatsApp'),
  p([t('Sistem menghantar notifikasi WhatsApp automatik melalui '), t('Fonnte.com', { bold: true }), t(' untuk setiap peristiwa berikut:')]),
  makeTable(
    ['Peristiwa', 'Penerima'],
    [
      ['Permohonan baru diterima',       'Pelulus Peringkat 1 yang dipilih'],
      ['Cuti diluluskan Peringkat 1',    'Pemohon + HR/Admin'],
      ['Cuti diluluskan sepenuhnya',     'Pemohon'],
      ['Cuti ditolak',                   'Pemohon'],
      ['Cuti dibatalkan',                'Pemohon'],
      ['Pemulihan kata laluan',          'Pemohon'],
      ['Hantar Semula (manual oleh HR)', 'Pemohon'],
    ],
    [55, 45]
  ),
  h2('Konfigurasi Token WhatsApp (Super Admin)'),
  numbered([t('Pergi ke '), t('Pengurusan → Tetapan WhatsApp', { bold: true })], 1),
  numbered([t('Masukkan '), t('Token Fonnte', { bold: true }), t(' yang diperoleh dari https://fonnte.com')], 2),
  numbered([t('Tekan '), t('SIMPAN TOKEN', { bold: true })], 3),
  numbered([t('Tekan '), t('HANTAR UJIAN', { bold: true }), t(' untuk mengesahkan sambungan')], 4),
  ...callout('⚠️', 'Penting', 'Token WhatsApp kini disimpan dalam pangkalan data dan dikongsi antara semua device. Pastikan token disimpan sekali sahaja melalui Super Admin — semua device lain akan menggunakan token yang sama secara automatik.', AMBER, BG_AMBER),
  pageBreak(),

  // ═══════════════════════════════════════════════════════════ 15. POLISI
  h1('15.  Polisi Cuti'),
  h2('Notis Awal Permohonan AL'),
  bullet([t('Staff Admin: ', { bold: true }), t('Minimum '), t('3 hari', { bold: true }), t(' sebelum tarikh cuti')]),
  bullet([t('Semua kategori lain: ', { bold: true }), t('Minimum '), t('7 hari', { bold: true }), t(' sebelum tarikh cuti')]),
  h2('Cuti Separuh Hari'),
  bullet('Pilihan separuh hari tersedia untuk Annual Leave (AL)'),
  bullet('Dikira sebagai 0.5 hari dari baki AL'),
  h2('Cuti Doktor — Keperluan Locum'),
  bullet([t('Semua cuti doktor '), t('WAJIB', { bold: true }), t(' mempunyai maklumat doktor locum')]),
  bullet('Maklumat locum perlu diisi oleh HOD/PIC dalam sistem sebelum cuti diluluskan sepenuhnya'),
  bullet('Borang locum boleh dicetak terus dari sistem'),
  h2('Pembatalan Cuti'),
  bullet([t('Staf boleh membatalkan cuti sendiri jika status masih '), t('PENDING', { bold: true })]),
  bullet([t('Cuti yang sudah diluluskan (HOD APPROVED / APPROVED) hanya boleh dibatalkan oleh HOD atau HR/Admin')]),
  pageBreak(),

  // ═══════════════════════════════════════════════════════════ LAMPIRAN
  h1('Lampiran — Senarai Cawangan KSB'),
  makeTable(
    ['Cawangan', 'Negeri'],
    [
      ['Klinik Syed Badaruddin Balok (HQ)',  'Pahang'],
      ['Klinik Syed Badaruddin MCKIP',       'Pahang'],
      ['Uni Klinik Bentong',                 'Pahang'],
      ['Klinik Syed Badaruddin Beserah',     'Pahang'],
      ['Klinik Syed Badaruddin Gebeng',      'Pahang'],
      ['Klinik Syed Badaruddin Utama',       'Pahang'],
      ['Klinik Syed Badaruddin Kerteh',      'Terengganu'],
      ['Klinik Syed Badaruddin Paka',        'Terengganu'],
      ['Klinik Rakyat dan X-Ray Dungun',     'Terengganu'],
    ],
    [65, 35]
  ),
  pageBreak(),

  // ═══════════════════════════════════════════════════════════ FAQ
  h1('Soalan Lazim (FAQ)'),
  h3('S: Saya tidak dapat log masuk. Apa yang perlu dilakukan?'),
  p([t('J: ', { bold: true }), t('Pastikan anda memilih cawangan yang betul. Kata laluan asal = nombor IC anda. Jika masih gagal, hubungi HR/Admin.')]),
  h3('S: Pelulus tidak muncul dalam dropdown semasa mohon cuti.'),
  p([t('J: ', { bold: true }), t('Ini bermakna tiada HOD/PIC/Supervisor yang berdaftar untuk cawangan anda. HR/Admin akan meluluskan terus.')]),
  h3('S: Bolehkah saya edit permohonan yang sudah dihantar?'),
  p([t('J: ', { bold: true }), t('Ya, permohonan yang berstatus PENDING boleh diedit. Permohonan yang sudah diluluskan tidak boleh diedit.')]),
  h3('S: Mengapa saya tidak menerima notifikasi WhatsApp?'),
  p([t('J: ', { bold: true }), t('Pastikan nombor telefon anda telah didaftarkan dalam sistem. Jika tiada, minta HR/Admin kemaskini nombor telefon dalam profil anda. HR/Admin juga boleh hantar semula notifikasi dari tab Laporan → Diluluskan.')]),
  h3('S: Bagaimana cara memasang aplikasi di telefon?'),
  p([t('J: ', { bold: true }), t('Buka sistem pada Chrome (Android) atau Safari (iPhone), tekan menu pelayar, dan pilih "Tambah ke Skrin Utama" / "Add to Home Screen".')]),
  pageBreak(),

  // ═══════════════════════════════════════════════════════════ SEJARAH
  h1('Sejarah Versi'),
  makeTable(
    ['Versi', 'Tarikh', 'Perubahan'],
    [
      ['1.0', 'Mei 2026', 'Versi asal'],
      ['1.1', 'Mei 2026', 'Tambah paparan pecahan baki AL (CF + Tahun Ini + Digunakan) dalam dashboard staf; tambah fungsi Pelarasan HR untuk sync baki cuti dengan rekod HR; tambah butang Hantar Semula WA dalam laporan cuti diluluskan; perbaiki token WA disimpan dalam Firestore supaya berfungsi di semua device'],
    ],
    [10, 15, 75]
  ),

  divider(),
  p([t('Dokumen ini adalah panduan rasmi Sistem KSB Leave Apply.', { italic: true, color: MUTED })], { align: AlignmentType.CENTER, before: 200 }),
  p([t('Untuk pertanyaan lanjut, hubungi HR/Admin KSB.', { italic: true, color: MUTED })], { align: AlignmentType.CENTER }),
];

// ─────────────────────────────────────────────────────────────────────────────
// BUILD & SAVE
// ─────────────────────────────────────────────────────────────────────────────

const doc = new Document({
  styles: {
    default: {
      document: {
        run: { font: FONT, size: 22, color: DARK },
        paragraph: { spacing: { line: 276 } },
      },
    },
  },
  sections: [{
    properties: {
      page: {
        margin: {
          top:    convertInchesToTwip(1),
          bottom: convertInchesToTwip(1),
          left:   convertInchesToTwip(1.2),
          right:  convertInchesToTwip(1.2),
        },
      },
    },
    headers: {
      default: new Header({
        children: [new Paragraph({
          children: [
            new TextRun({ text: 'MANUAL PENGGUNA — KSB Leave Apply', font: FONT, size: 16, color: MUTED }),
          ],
          border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' } },
        })],
      }),
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          children: [
            new TextRun({ text: 'Versi 1.1  |  Mei 2026  |  https://apply-leave-89ebb.web.app', font: FONT, size: 16, color: MUTED }),
            new TextRun({ text: '  •  ms. ', font: FONT, size: 16, color: MUTED }),
          ],
          alignment: AlignmentType.RIGHT,
          border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' } },
        })],
      }),
    },
    children,
  }],
});

const OUTPUT = 'C:\\Users\\user\\Desktop\\MANUAL SISTEM KSB LEAVE APPLY.docx';

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(OUTPUT, buf);
  console.log('✅ Fail Word berjaya dijana:', OUTPUT);
}).catch(err => {
  console.error('❌ Ralat:', err.message);
});
