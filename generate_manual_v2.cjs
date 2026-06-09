/**
 * generate_manual_v2.cjs
 * Generate PDF manual for KSB Leave Apply system using Puppeteer
 * Includes all clinic brand logos embedded as base64
 */
const puppeteer = require('puppeteer');
const https = require('https');
const fs = require('fs');
const path = require('path');

const OUTPUT_PATH = path.join('C:\\Users\\user\\Desktop', 'Manual_KSB_Leave_Apply.pdf');

// ── Fetch remote image and return base64 data URI ──────────────────────────
function fetchBase64(url) {
  return new Promise((resolve) => {
    https.get(url, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const mime = res.headers['content-type'] || 'image/jpeg';
        resolve(`data:${mime};base64,${buf.toString('base64')}`);
      });
      res.on('error', () => resolve(''));
    }).on('error', () => resolve(''));
  });
}

// ── Read local file as base64 data URI ────────────────────────────────────
function localBase64(filePath, mime) {
  try {
    const buf = fs.readFileSync(filePath);
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch { return ''; }
}

(async () => {
  console.log('Memuat turun logo-logo klinik...');

  // Fetch all logos in parallel
  const [logoKSB, logoKR, logoBentong] = await Promise.all([
    fetchBase64('https://ksbsb-leave-trcker.firebaseapp.com/logo-ksb.jpg'),
    fetchBase64('https://ksbsb-leave-trcker.firebaseapp.com/logo-kr.jpg'),
    fetchBase64('https://ksbsb-leave-trcker.firebaseapp.com/logo-bentong.jpg'),
  ]);

  // Local app icon (PNG)
  const appIcon = localBase64(
    path.join(__dirname, 'public', 'icon-512.png'),
    'image/png'
  );
  // Local KSB SVG icon as inline
  const iconSvg = fs.readFileSync(path.join(__dirname, 'public', 'icon.svg'), 'utf8');

  console.log(`Logo KSB      : ${logoKSB     ? '✅' : '❌ Gagal'}`);
  console.log(`Logo KR       : ${logoKR      ? '✅' : '❌ Gagal'}`);
  console.log(`Logo Bentong  : ${logoBentong ? '✅' : '❌ Gagal'}`);
  console.log(`App Icon (PNG): ${appIcon     ? '✅' : '❌ Gagal'}`);

  // Helper: render logo box (graceful if logo failed)
  const logoBox = (src, label, sub, color = '#1e40af') => {
    const img = src
      ? `<img src="${src}" alt="${label}" style="width:80px;height:80px;object-fit:contain;border-radius:10px;">`
      : `<div style="width:80px;height:80px;border-radius:10px;background:#e2e8f0;display:flex;align-items:center;justify-content:center;font-size:28px;">🏥</div>`;
    return `
      <div style="display:flex;flex-direction:column;align-items:center;gap:8px;min-width:130px;">
        <div style="width:90px;height:90px;border-radius:14px;background:#fff;box-shadow:0 4px 16px rgba(0,0,0,0.18);display:flex;align-items:center;justify-content:center;padding:5px;">
          ${img}
        </div>
        <div style="text-align:center;">
          <div style="font-size:8.5pt;font-weight:700;color:#fff;letter-spacing:0.3px;">${label}</div>
          ${sub ? `<div style="font-size:7.5pt;color:rgba(255,255,255,0.7);">${sub}</div>` : ''}
        </div>
      </div>`;
  };

  const html = `<!DOCTYPE html>
<html lang="ms">
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Segoe UI', Arial, sans-serif;
    font-size: 10.5pt;
    color: #1e293b;
    background: #fff;
    line-height: 1.6;
  }

  /* ── Cover ── */
  .cover {
    page-break-after: always;
    break-after: page;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    background: linear-gradient(160deg, #1e40af 0%, #0f172a 100%);
    color: #fff;
    padding: 36px 40px;
  }
  .cover h1 { font-size: 26pt; font-weight: 800; letter-spacing: -0.5px; margin-bottom: 6px; }
  .cover h2 { font-size: 14pt; font-weight: 400; opacity: 0.85; margin-bottom: 10px; }
  .cover-badge {
    background: rgba(255,255,255,0.12);
    border: 1px solid rgba(255,255,255,0.25);
    border-radius: 999px;
    padding: 5px 18px;
    font-size: 9pt;
    letter-spacing: 0.5px;
    margin-bottom: 8px;
    display: inline-block;
  }
  .cover-date { font-size: 8.5pt; opacity: 0.6; margin-top: 32px; }
  .logos-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 28px;
    flex-wrap: wrap;
    margin: 28px 0 20px;
  }
  .logo-divider {
    width: 1px; height: 70px;
    background: rgba(255,255,255,0.2);
  }
  .app-icon-wrap {
    width: 80px; height: 80px;
    border-radius: 18px;
    overflow: hidden;
    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    margin-bottom: 24px;
  }
  .app-icon-wrap svg, .app-icon-wrap img {
    width: 100%; height: 100%;
  }

  /* ── TOC ── */
  .toc-page { padding: 48px 56px; }
  .toc-page h2 { font-size: 16pt; color: #1e40af; margin-bottom: 20px; border-bottom: 3px solid #1e40af; padding-bottom: 8px; }
  .toc-entry { display: flex; justify-content: space-between; padding: 5px 0; border-bottom: 1px dotted #cbd5e1; font-size: 10pt; }
  .toc-entry.main { font-weight: 700; color: #1e40af; margin-top: 10px; font-size: 10.5pt; }
  .toc-entry.sub { padding-left: 20px; color: #475569; }

  /* ── General layout ── */
  .page { padding: 48px 56px; }
  .chapter-break { page-break-before: always; break-before: page; }
  h1.chapter {
    font-size: 18pt; font-weight: 800; color: #fff;
    background: linear-gradient(135deg, #1e40af, #1e3a8a);
    padding: 16px 24px; border-radius: 10px; margin-bottom: 24px;
  }
  h2.section {
    font-size: 13pt; font-weight: 700; color: #1e40af;
    border-left: 4px solid #3b82f6; padding-left: 12px; margin: 22px 0 10px;
  }
  h3.subsection { font-size: 11pt; font-weight: 700; color: #334155; margin: 14px 0 6px; }
  p { margin-bottom: 8px; }
  ul, ol { margin: 6px 0 10px 22px; }
  li { margin-bottom: 4px; }

  /* ── Info boxes ── */
  .info-box { background:#eff6ff; border:1px solid #bfdbfe; border-left:4px solid #3b82f6; border-radius:8px; padding:12px 16px; margin:12px 0; font-size:9.5pt; color:#1e3a8a; }
  .warn-box  { background:#fff7ed; border:1px solid #fed7aa; border-left:4px solid #f97316; border-radius:8px; padding:12px 16px; margin:12px 0; font-size:9.5pt; color:#7c2d12; }
  .success-box { background:#f0fdf4; border:1px solid #bbf7d0; border-left:4px solid #22c55e; border-radius:8px; padding:12px 16px; margin:12px 0; font-size:9.5pt; color:#14532d; }

  /* ── Table ── */
  table { width:100%; border-collapse:collapse; margin:12px 0; font-size:9.5pt; }
  th { background:#1e40af; color:#fff; padding:8px 10px; text-align:left; font-weight:600; }
  td { padding:7px 10px; border-bottom:1px solid #e2e8f0; }
  tr:nth-child(even) td { background:#f8fafc; }

  /* ── Steps ── */
  .steps { counter-reset:step; margin:12px 0; }
  .step { counter-increment:step; display:flex; gap:14px; margin-bottom:10px; align-items:flex-start; }
  .step-num { min-width:28px; height:28px; border-radius:50%; background:#1e40af; color:#fff; font-weight:700; font-size:10pt; display:flex; align-items:center; justify-content:center; flex-shrink:0; margin-top:1px; }
  .step-body { flex:1; }
  .step-body strong { color:#1e3a8a; }

  /* ── Badges ── */
  .badge { display:inline-block; border-radius:999px; padding:2px 10px; font-size:8.5pt; font-weight:600; margin:1px; }
  .b-blue   { background:#dbeafe; color:#1d4ed8; }
  .b-green  { background:#dcfce7; color:#15803d; }
  .b-orange { background:#ffedd5; color:#c2410c; }
  .b-purple { background:#ede9fe; color:#6d28d9; }
  .b-red    { background:#fee2e2; color:#b91c1c; }
  .b-gray   { background:#f1f5f9; color:#475569; }
  .b-pink   { background:#fce7f3; color:#be185d; }

  /* ── Branch cards ── */
  .branch-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin: 14px 0;
  }
  .branch-card {
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 12px 14px;
    background: #f8fafc;
    display: flex;
    gap: 12px;
    align-items: center;
  }
  .branch-card-logo {
    width: 48px; height: 48px;
    border-radius: 8px;
    background: #fff;
    box-shadow: 0 2px 6px rgba(0,0,0,0.1);
    flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    overflow: hidden;
  }
  .branch-card-logo img { width:44px; height:44px; object-fit:contain; }
  .branch-card-body { flex:1; }
  .branch-card-name { font-weight:700; font-size:9.5pt; color:#1e293b; margin-bottom:2px; }
  .branch-card-meta { font-size:8.5pt; color:#64748b; }
  .brand-section-header {
    display: flex;
    align-items: center;
    gap: 12px;
    background: linear-gradient(135deg,#1e40af,#1d4ed8);
    color:#fff;
    padding: 10px 16px;
    border-radius: 8px;
    margin: 18px 0 10px;
    font-weight: 700;
    font-size: 11pt;
  }
  .brand-section-header img {
    width:36px; height:36px;
    border-radius:6px;
    background:#fff;
    object-fit:contain;
    padding:2px;
  }

  /* ── Workflow ── */
  .workflow { display:flex; align-items:center; gap:6px; flex-wrap:wrap; margin:14px 0; font-size:9pt; }
  .wf-box { border:1.5px solid #93c5fd; background:#eff6ff; border-radius:8px; padding:6px 12px; font-weight:600; color:#1e40af; text-align:center; min-width:80px; }
  .wf-arrow { color:#3b82f6; font-size:14pt; font-weight:700; }

  @page { margin:20mm 18mm; }
  .footer { margin-top:40px; text-align:center; font-size:8pt; color:#94a3b8; border-top:1px solid #e2e8f0; padding-top:12px; }
</style>
</head>
<body>

<!-- ═══════════════════════════════════════════════ COVER ═══ -->
<div class="cover">

  <!-- App Icon -->
  <div class="app-icon-wrap">
    ${appIcon ? `<img src="${appIcon}" alt="KSB App">` : iconSvg}
  </div>

  <h1>KSB Leave Apply</h1>
  <h2>Sistem Pengurusan Cuti Kakitangan</h2>

  <!-- Clinic Brand Logos -->
  <div class="logos-row">
    ${logoBox(logoKSB,      'Klinik Syed Badaruddin', 'Kuantan · Kerteh · Paka')}
    <div class="logo-divider"></div>
    ${logoBox(logoBentong,  'Uni Klinik Bentong',     'Pahang')}
    <div class="logo-divider"></div>
    ${logoBox(logoKR,       'Klinik Rakyat &amp;',    'X-Ray Dungun')}
  </div>

  <div class="cover-badge">MANUAL PENGGUNA — EDISI JUN 2026</div>
  <div class="cover-badge">Progressive Web App (PWA) · Firebase · Multi-Cawangan</div>
  <div style="margin: 20px 0; padding: 12px 28px; background: rgba(59, 130, 246, 0.25); border: 2px solid #60a5fa; border-radius: 12px; display: inline-block; font-size: 12pt; font-weight: 700; letter-spacing: 0.5px; box-shadow: 0 0 15px rgba(59, 130, 246, 0.4);">
    🌐 LINK SISTEM: <a href="https://apply-leave-89ebb.web.app" style="color: #93c5fd; text-decoration: none; border-bottom: 1.5px solid #93c5fd;">https://apply-leave-89ebb.web.app</a>
  </div>
  <div class="cover-date">Kumpulan Klinik Syed Badaruddin (KSB) &nbsp;|&nbsp; Pahang &amp; Terengganu &nbsp;|&nbsp; Dikemaskini: 2 Jun 2026</div>
</div>

<!-- ═══════════════════════════════════════════════ TOC ═══ -->
<div class="toc-page">
  <h2>ISI KANDUNGAN</h2>
  <div class="toc-entry main"><span>1. Pengenalan Sistem</span><span>3</span></div>
  <div class="toc-entry sub"><span>1.1 Apakah KSB Leave Apply?</span><span>3</span></div>
  <div class="toc-entry sub"><span>1.2 Kumpulan Klinik KSB &amp; Cawangan</span><span>3</span></div>
  <div class="toc-entry sub"><span>1.3 Cara Akses &amp; Log Masuk</span><span>4</span></div>
  <div class="toc-entry sub"><span>1.4 Peranan &amp; Hak Akses</span><span>5</span></div>
  <div class="toc-entry main"><span>2. Jenis-Jenis Cuti</span><span>6</span></div>
  <div class="toc-entry sub"><span>2.1 Jadual Kelayakan Cuti</span><span>6</span></div>
  <div class="toc-entry sub"><span>2.2 Baki Annual Leave (AL)</span><span>7</span></div>
  <div class="toc-entry main"><span>3. Permohonan Cuti (Staff)</span><span>8</span></div>
  <div class="toc-entry sub"><span>3.1 Cara Mohon Cuti</span><span>8</span></div>
  <div class="toc-entry sub"><span>3.2 Dashboard Peribadi</span><span>9</span></div>
  <div class="toc-entry sub"><span>3.3 Semak Status Permohonan</span><span>9</span></div>
  <div class="toc-entry main"><span>4. Aliran Kelulusan</span><span>10</span></div>
  <div class="toc-entry sub"><span>4.1 Carta Aliran Kelulusan</span><span>10</span></div>
  <div class="toc-entry sub"><span>4.2 Peringkat 0 — Team Leader (Operasi Balok)</span><span>10</span></div>
  <div class="toc-entry sub"><span>4.3 Peringkat 1 — HOD / Supervisor</span><span>11</span></div>
  <div class="toc-entry sub"><span>4.4 Peringkat 2 — HR / Admin</span><span>11</span></div>
  <div class="toc-entry sub"><span>4.5 Notifikasi WhatsApp Automatik</span><span>12</span></div>
  <div class="toc-entry main"><span>5. Pengurusan (HR &amp; Admin)</span><span>13</span></div>
  <div class="toc-entry main"><span>6. Tetapan &amp; Konfigurasi</span><span>15</span></div>
  <div class="toc-entry main"><span>7. Messenger Dalaman</span><span>17</span></div>
  <div class="toc-entry main"><span>8. Dasar Cuti (Polisi)</span><span>18</span></div>
  <div class="toc-entry main"><span>9. Soalan Lazim (FAQ)</span><span>19</span></div>
  <div class="toc-entry main"><span>10. Hubungi Admin</span><span>20</span></div>
</div>

<!-- ═══════════════════════════════════════════ BAB 1 ═══ -->
<div class="page chapter-break">
  <h1 class="chapter">1. Pengenalan Sistem</h1>

  <h2 class="section">1.1 Apakah KSB Leave Apply?</h2>
  <p><strong>KSB Leave Apply</strong> ialah sistem pengurusan cuti berbentuk <em>Progressive Web App (PWA)</em> untuk kakitangan Kumpulan Klinik Syed Badaruddin (KSB) merentas semua cawangan di <strong>Pahang</strong> dan <strong>Terengganu</strong>. Sistem ini membolehkan:</p>
  <ul>
    <li>Kakitangan memohon cuti secara dalam talian dengan mudah.</li>
    <li>HOD / Supervisor meluluskan atau menolak permohonan dalam masa nyata.</li>
    <li>HR &amp; Admin memantau keseimbangan cuti, laporan, dan rekod seluruh cawangan.</li>
    <li>Notifikasi automatik melalui <strong>WhatsApp</strong> pada setiap tindakan penting.</li>
  </ul>

  <div class="info-box">
    💡 <strong>Akses tanpa install:</strong> Sistem ini boleh diakses terus dari pelayar web (Chrome, Edge, Safari). Anda juga boleh "Add to Home Screen" untuk pengalaman seperti aplikasi mudah alih.
  </div>

  <h2 class="section">1.2 Kumpulan Klinik KSB &amp; Cawangan</h2>
  <p>Sistem ini merangkumi <strong>3 jenama klinik</strong> dalam kumpulan KSB dengan 11 cawangan:</p>

  <!-- BRAND 1: Klinik Syed Badaruddin -->
  <div class="brand-section-header">
    ${logoKSB ? `<img src="${logoKSB}" alt="KSB">` : '<span>🏥</span>'}
    Klinik Syed Badaruddin (KSB)
  </div>
  <div class="branch-grid">
    <div class="branch-card">
      <div class="branch-card-logo">${logoKSB ? `<img src="${logoKSB}" alt="KSB">` : '🏥'}</div>
      <div class="branch-card-body">
        <div class="branch-card-name">KSB Balok (HQ)</div>
        <div class="branch-card-meta">Kuantan, Pahang · Ibu Pejabat</div>
      </div>
    </div>
    <div class="branch-card">
      <div class="branch-card-logo">${logoKSB ? `<img src="${logoKSB}" alt="KSB">` : '🏥'}</div>
      <div class="branch-card-body">
        <div class="branch-card-name">KSB Beserah</div>
        <div class="branch-card-meta">Kuantan, Pahang</div>
      </div>
    </div>
    <div class="branch-card">
      <div class="branch-card-logo">${logoKSB ? `<img src="${logoKSB}" alt="KSB">` : '🏥'}</div>
      <div class="branch-card-body">
        <div class="branch-card-name">KSB Gebeng</div>
        <div class="branch-card-meta">Kuantan, Pahang</div>
      </div>
    </div>
    <div class="branch-card">
      <div class="branch-card-logo">${logoKSB ? `<img src="${logoKSB}" alt="KSB">` : '🏥'}</div>
      <div class="branch-card-body">
        <div class="branch-card-name">KSB Kempadang</div>
        <div class="branch-card-meta">Kuantan, Pahang</div>
      </div>
    </div>
    <div class="branch-card">
      <div class="branch-card-logo">${logoKSB ? `<img src="${logoKSB}" alt="KSB">` : '🏥'}</div>
      <div class="branch-card-body">
        <div class="branch-card-name">KSB MCKIP</div>
        <div class="branch-card-meta">Kuantan, Pahang</div>
      </div>
    </div>
    <div class="branch-card">
      <div class="branch-card-logo">${logoKSB ? `<img src="${logoKSB}" alt="KSB">` : '🏥'}</div>
      <div class="branch-card-body">
        <div class="branch-card-name">KSB RPCM</div>
        <div class="branch-card-meta">Kuantan, Pahang</div>
      </div>
    </div>
    <div class="branch-card">
      <div class="branch-card-logo">${logoKSB ? `<img src="${logoKSB}" alt="KSB">` : '🏥'}</div>
      <div class="branch-card-body">
        <div class="branch-card-name">KSB Utama</div>
        <div class="branch-card-meta">Kuantan, Pahang</div>
      </div>
    </div>
    <div class="branch-card">
      <div class="branch-card-logo">${logoKSB ? `<img src="${logoKSB}" alt="KSB">` : '🏥'}</div>
      <div class="branch-card-body">
        <div class="branch-card-name">KSB Kerteh</div>
        <div class="branch-card-meta">Kemaman, Terengganu</div>
      </div>
    </div>
    <div class="branch-card">
      <div class="branch-card-logo">${logoKSB ? `<img src="${logoKSB}" alt="KSB">` : '🏥'}</div>
      <div class="branch-card-body">
        <div class="branch-card-name">KSB Paka</div>
        <div class="branch-card-meta">Dungun, Terengganu</div>
      </div>
    </div>
  </div>

  <!-- BRAND 2: Uni Klinik Bentong -->
  <div class="brand-section-header" style="background:linear-gradient(135deg,#0f766e,#0d9488);">
    ${logoBentong ? `<img src="${logoBentong}" alt="Bentong">` : '<span>🏥</span>'}
    Uni Klinik Bentong
  </div>
  <div class="branch-grid">
    <div class="branch-card">
      <div class="branch-card-logo">${logoBentong ? `<img src="${logoBentong}" alt="Bentong">` : '🏥'}</div>
      <div class="branch-card-body">
        <div class="branch-card-name">Uni Klinik Bentong</div>
        <div class="branch-card-meta">Bentong, Pahang</div>
      </div>
    </div>
  </div>

  <!-- BRAND 3: Klinik Rakyat & X-Ray Dungun -->
  <div class="brand-section-header" style="background:linear-gradient(135deg,#7c3aed,#6d28d9);">
    ${logoKR ? `<img src="${logoKR}" alt="KR">` : '<span>🏥</span>'}
    Klinik Rakyat &amp; X-Ray Dungun
  </div>
  <div class="branch-grid">
    <div class="branch-card">
      <div class="branch-card-logo">${logoKR ? `<img src="${logoKR}" alt="KR">` : '🏥'}</div>
      <div class="branch-card-body">
        <div class="branch-card-name">Klinik Rakyat &amp; X-Ray Dungun</div>
        <div class="branch-card-meta">Dungun, Terengganu</div>
      </div>
    </div>
  </div>
</div>

<!-- ═══════════════════════════════════════════ LOG MASUK ═══ -->
<div class="page chapter-break">
  <h2 class="section">1.3 Cara Akses &amp; Log Masuk</h2>
  
  <div style="background: linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%); border: 2.5px dashed #3b82f6; border-radius: 12px; padding: 18px; margin: 18px 0; text-align: center; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.15);">
    <span style="font-size: 9pt; text-transform: uppercase; letter-spacing: 1.5px; color: #93c5fd; font-weight: bold; display: block; margin-bottom: 6px;">URL AKSES UTAMA SISTEM (LINK)</span>
    <a href="https://apply-leave-89ebb.web.app" style="font-size: 16pt; font-weight: 800; color: #fff; text-decoration: none; letter-spacing: 0.5px; border-bottom: 2px solid #60a5fa; word-break: break-all;">https://apply-leave-89ebb.web.app</a>
    <span style="font-size: 8.5pt; color: #cbd5e1; display: block; margin-top: 8px;">(Sila simpan link ini di bookmark pelayar atau "Add to Home Screen" telefon anda)</span>
  </div>

  <div class="warn-box" style="background: #fffbeb; border: 2.5px solid #f59e0b; border-left: 8px solid #d97706; border-radius: 12px; padding: 18px; margin: 18px 0; color: #78350f; box-shadow: 0 4px 12px rgba(245, 158, 11, 0.12);">
    <div style="display: flex; gap: 12px; align-items: flex-start;">
      <span style="font-size: 20pt; line-height: 1;">🔐</span>
      <div>
        <strong style="font-size: 11.5pt; color: #b45309; display: block; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.3px;">⚠️ MAKLUMAN PENTING: TUKAR KATA LALUAN SELEPAS LOG MASUK PERTAMA!</strong>
        <p style="margin: 0; font-size: 9.5pt; line-height: 1.5;">
          Demi keselamatan akaun anda, anda <strong>WAJIB menukar kata laluan lalai</strong> (nombor IC anda) sejurus selepas log masuk kali pertama:
        </p>
        <ol style="margin: 8px 0 8px 20px; font-size: 9.5pt; font-weight: bold;">
          <li>Pergi ke menu <strong>Settings</strong> (ikon gear) dari bar navigasi.</li>
          <li>Pilih sub-menu <strong>Security (Keselamatan)</strong>.</li>
          <li>Masukkan kata laluan semasa (nombor IC anda), kemudian masukkan kata laluan baharu pilihan anda.</li>
          <li>Klik butang <strong>"Tukar Kata Laluan" / "Simpan"</strong> untuk menyimpan perubahan anda.</li>
        </ol>
        <span style="font-size: 8.5pt; color: #92400e; font-style: italic; display: block;">* Nota: Sila simpan/ingat kata laluan baharu anda dengan selamat untuk log masuk seterusnya.</span>
      </div>
    </div>
  </div>

  <div class="steps">
    <div class="step"><div class="step-num">1</div><div class="step-body"><strong>Buka URL Sistem</strong> — Layari <code style="background: rgba(59,130,246,0.1); color: #2563eb; padding: 2px 6px; border-radius: 4px; font-weight: bold;">https://apply-leave-89ebb.web.app</code> di pelayar anda.</div></div>
    <div class="step"><div class="step-num">2</div><div class="step-body"><strong>Pilih Cawangan</strong> — Klik dropdown cawangan dan pilih lokasi bertugas anda.</div></div>
    <div class="step"><div class="step-num">3</div><div class="step-body"><strong>Pilih Nama</strong> — Pilih nama anda dari senarai dropdown yang muncul (boleh taip nama untuk carian pantas).</div></div>
    <div class="step"><div class="step-num">4</div><div class="step-body"><strong>Masukkan Kata Laluan</strong> — Untuk kali pertama, masukkan nombor IC anda (tanpa tanda "-") sebagai kata laluan awal.</div></div>
    <div class="step"><div class="step-num">5</div><div class="step-body"><strong>Klik "Log Masuk"</strong> — Sistem akan mengesahkan akaun dan mengarahkan anda ke Dashboard utama.</div></div>
  </div>
  <div class="warn-box">
    🔐 <strong>Terlupa kata laluan?</strong> Klik pautan <em>"Lupa Kata Laluan?"</em> di skrin log masuk. Kata laluan semasa akan dihantar secara automatik ke nombor WhatsApp anda yang berdaftar.
  </div>

  <h2 class="section">1.4 Peranan &amp; Hak Akses</h2>
  <p>Sistem menggunakan <strong>RBAC (Role-Based Access Control)</strong> — setiap peranan mempunyai hak akses berbeza:</p>
  <table>
    <tr><th>Peranan</th><th>Papan Pemuka</th><th>Kelulusan</th><th>Pengurusan Staf</th><th>Laporan HR</th></tr>
    <tr><td><span class="badge b-red">Super Admin</span></td><td>Analitik Penuh</td><td>✅ Ya</td><td>✅ Ya</td><td>✅ Ya</td></tr>
    <tr><td><span class="badge b-blue">Admin</span></td><td>Analitik Penuh</td><td>✅ Ya</td><td>✅ Ya</td><td>✅ Ya</td></tr>
    <tr><td><span class="badge b-green">HR</span></td><td>Senarai Staf</td><td>✅ Ya (P2)</td><td>✅ Ya</td><td>✅ Ya (Kuantan)</td></tr>
    <tr><td><span class="badge b-orange">HOD</span></td><td>Cawangan</td><td>✅ Ya (P1)</td><td>❌ Tidak</td><td>✅ (Cawangan)</td></tr>
    <tr><td><span class="badge b-orange">PIC HOD</span></td><td>Cawangan</td><td>✅ Ya (P1)</td><td>❌ Tidak</td><td>❌ Tidak</td></tr>
    <tr><td><span class="badge b-purple">Supervisor</span></td><td>Senarai Staf</td><td>✅ Ya (P1)</td><td>❌ Tidak</td><td>❌ Tidak</td></tr>
    <tr><td><span class="badge b-purple">Team Leader</span></td><td>Senarai Staf</td><td>✅ Ya (P0)</td><td>❌ Tidak</td><td>❌ Tidak</td></tr>
    <tr><td><span class="badge b-gray">Staff</span></td><td>Peribadi</td><td>❌ Tidak</td><td>❌ Tidak</td><td>❌ Tidak</td></tr>
  </table>
  <div class="info-box">ℹ️ Hak akses boleh diubah suai oleh Super Admin melalui tab <strong>Access Control</strong> dalam modul Pengurusan.</div>
</div>

<!-- ═══════════════════════════════════════════ BAB 2 ═══ -->
<div class="page chapter-break">
  <h1 class="chapter">2. Jenis-Jenis Cuti</h1>

  <h2 class="section">2.1 Jadual Kelayakan Cuti</h2>
  <table>
    <tr><th>Kod</th><th>Nama Cuti</th><th>Kelayakan</th><th>Catatan</th></tr>
    <tr><td><span class="badge b-blue">AL</span></td><td>Annual Leave (Cuti Tahunan)</td><td>14 – 25 hari*</td><td>Pro-rata mengikut bulan bekerja. Bawa lepas max 3 hari.</td></tr>
    <tr><td><span class="badge b-green">MC</span></td><td>Medical Leave (Cuti Sakit)</td><td>14 hari</td><td>Diluluskan automatik. Sijil MC mesti disertakan.</td></tr>
    <tr><td><span class="badge b-orange">EL</span></td><td>Emergency / Compassionate (Ehsan)</td><td>3 hari</td><td>Kematian ahli keluarga terdekat. Percuma — tidak tolak AL.</td></tr>
    <tr><td><span class="badge b-red">EL_EMG</span></td><td>Emergency (Bukan Ehsan)</td><td>—</td><td>Kecemasan am. Ditolak dari AL.</td></tr>
    <tr><td><span class="badge b-gray">UL</span></td><td>Unpaid Leave (Cuti Tanpa Gaji)</td><td>—</td><td>Setelah baki AL habis digunakan.</td></tr>
    <tr><td><span class="badge b-blue" style="background:#cffafe;color:#0e7490;">HL</span></td><td>Hospitalization (Cuti Wad)</td><td>60 hari</td><td>Rawatan wad / pembedahan.</td></tr>
    <tr><td><span class="badge b-pink">ML</span></td><td>Cuti Bersalin</td><td>98 hari</td><td>Kakitangan wanita sahaja.</td></tr>
    <tr><td><span class="badge b-purple">ML_PL</span></td><td>Cuti Paterniti</td><td>7 hari</td><td>Kakitangan lelaki — isteri bersalin.</td></tr>
    <tr><td><span class="badge b-purple">CME</span></td><td>Latihan CME</td><td>5 hari</td><td>Pendidikan Perubatan Berterusan — Doktor sahaja.</td></tr>
  </table>

  <p>* Kelayakan AL mengikut kategori:</p>
  <table>
    <tr><th>Kategori</th><th>Tahun Perkhidmatan</th><th>Kelayakan AL</th></tr>
    <tr><td>Admin &amp; Operation Staff</td><td>Semua</td><td>14 hari</td></tr>
    <tr><td>Doktor</td><td>&lt; 2 tahun</td><td>20 hari</td></tr>
    <tr><td>Doktor</td><td>≥ 2 tahun</td><td>25 hari</td></tr>
  </table>

  <h2 class="section">2.2 Baki Annual Leave (AL)</h2>
  <div class="info-box">
    <strong>Baki AL = (Peruntukan AL + Bawa Lepas CF) − Digunakan − Pelarasan HR (al_adj)</strong><br><br>
    • <strong>Peruntukan AL (ent_AL)</strong>: Ditetapkan oleh HR dalam profil staf.<br>
    • <strong>Bawa Lepas (ent_CF)</strong>: Maksimum 3 hari dari tahun sebelumnya.<br>
    • <strong>Digunakan</strong>: Jumlah hari AL yang telah diluluskan (status APPROVED).<br>
    • <strong>Pelarasan HR (al_adj)</strong>: Hari AL digunakan sebelum sistem / pelarasan manual HR.
  </div>
  <div class="warn-box">⚠️ <strong>Pro-Rata:</strong> Jika staf mula bekerja dalam tahun semasa, AL dikira secara pro-rata mengikut bilangan bulan bekerja. Ciri ini boleh didayakan dalam profil staf oleh HR/Admin.</div>
</div>

<!-- ═══════════════════════════════════════════ BAB 3 ═══ -->
<div class="page chapter-break">
  <h1 class="chapter">3. Permohonan Cuti (Staff)</h1>

  <h2 class="section">3.1 Cara Mohon Cuti</h2>
  <div class="steps">
    <div class="step"><div class="step-num">1</div><div class="step-body"><strong>Buka Borang Permohonan</strong> — Dari papan pemuka, klik butang <strong>"Mohon Cuti"</strong> atau ikon tambah (+). Anda juga boleh klik menu <em>"Leave Request"</em> dari bar navigasi bawah.</div></div>
    <div class="step"><div class="step-num">2</div><div class="step-body"><strong>Pilih Jenis Cuti</strong> — Pilih jenis cuti yang sesuai. Jenis cuti yang tidak berkenaan (contoh: ML untuk lelaki) tidak akan dipaparkan.</div></div>
    <div class="step"><div class="step-num">3</div><div class="step-body"><strong>Pilih Tarikh</strong> — Masukkan tarikh mula dan tamat. Sistem akan kira bilangan hari bekerja secara automatik (tidak termasuk Sabtu, Ahad, dan cuti umum).</div></div>
    <div class="step"><div class="step-num">4</div><div class="step-body"><strong>Pilih Pelulus</strong> — Sistem akan cadangkan pelulus berdasarkan konfigurasi routing cawangan anda.</div></div>
    <div class="step"><div class="step-num">5</div><div class="step-body"><strong>Cuti Separuh Hari</strong> — Togol pilihan <em>"Half Day"</em> jika memohon separuh hari sahaja.</div></div>
    <div class="step"><div class="step-num">6</div><div class="step-body"><strong>Hantar Permohonan</strong> — Klik <strong>"Hantar Permohonan"</strong>. Notifikasi WhatsApp dihantar kepada pelulus secara automatik.</div></div>
  </div>
  <div class="success-box">✅ <strong>Medical Leave (MC)</strong> diluluskan secara automatik — tiada kelulusan HOD atau HR diperlukan. Pastikan sijil MC disertakan apabila kembali bekerja.</div>
  <div class="warn-box">⚠️ <strong>Permohonan AL melebihi baki:</strong> Sistem akan automatik bahagikan kepada AL yang tinggal + Unpaid Leave (UL) dan memaparkan notis sebelum penghantaran.</div>

  <h2 class="section">3.2 Dashboard Peribadi</h2>
  <ul>
    <li><strong>Baki Annual Leave (AL)</strong> — bar kemajuan dengan jumlah peruntukan, bawa lepas (CF), dan baki semasa.</li>
    <li><strong>Baki Medical Leave (MC)</strong> — jumlah MC digunakan vs kelayakan.</li>
    <li><strong>Sejarah Permohonan</strong> — semua permohonan dengan status terkini.</li>
    <li><strong>Gambar Rajah Aktiviti</strong> — carta bulanan permohonan cuti sepanjang tahun.</li>
  </ul>

  <h2 class="section">3.3 Semak Status Permohonan</h2>
  <table>
    <tr><th>Status</th><th>Maksud</th></tr>
    <tr><td><span class="badge b-orange">PENDING</span></td><td>Menunggu kelulusan — Team Leader (P0, Balok) atau HOD/Supervisor (P1)</td></tr>
    <tr><td><span class="badge b-red">TL APPROVED</span></td><td>Disokong Team Leader (P0) — menunggu Supervisor Balok (P1)</td></tr>
    <tr><td><span class="badge b-blue">HOD APPROVED</span></td><td>Diluluskan Peringkat 1 — menunggu HR/Admin (Peringkat 2)</td></tr>
    <tr><td><span class="badge b-green">APPROVED</span></td><td>Diluluskan sepenuhnya</td></tr>
    <tr><td><span class="badge b-red">REJECTED</span></td><td>Ditolak</td></tr>
    <tr><td><span class="badge b-gray">CANCELLED</span></td><td>Dibatalkan oleh staf atau Admin</td></tr>
  </table>
</div>

<!-- ═══════════════════════════════════════════ BAB 4 ═══ -->
<div class="page chapter-break">
  <h1 class="chapter">4. Aliran Kelulusan</h1>

  <h2 class="section">4.1 Carta Aliran Kelulusan</h2>
  <h3 class="subsection">Laluan A — Staf Umum (Semua Cawangan kecuali Operasi Balok)</h3>
  <div class="workflow">
    <div class="wf-box">Staff<br>Mohon Cuti</div><div class="wf-arrow">→</div>
    <div class="wf-box" style="border-color:#f97316;background:#fff7ed;color:#c2410c;">P1: HOD /<br>Supervisor /<br>PIC HOD</div><div class="wf-arrow">→</div>
    <div class="wf-box" style="border-color:#22c55e;background:#f0fdf4;color:#15803d;">P2: HR /<br>Admin</div><div class="wf-arrow">→</div>
    <div class="wf-box" style="border-color:#22c55e;background:#f0fdf4;color:#15803d;">✅ APPROVED</div>
  </div>

  <h3 class="subsection">Laluan B — Staf Operasi Balok (3 Peringkat, jika needs_tl aktif)</h3>
  <div class="workflow">
    <div class="wf-box">Staff<br>Mohon Cuti</div><div class="wf-arrow">→</div>
    <div class="wf-box" style="border-color:#f43f5e;background:#fff1f2;color:#be123c;">P0: Team<br>Leader</div><div class="wf-arrow">→</div>
    <div class="wf-box" style="border-color:#f97316;background:#fff7ed;color:#c2410c;">P1: Supervisor<br>Balok</div><div class="wf-arrow">→</div>
    <div class="wf-box" style="border-color:#22c55e;background:#f0fdf4;color:#15803d;">P2: HR /<br>Admin</div><div class="wf-arrow">→</div>
    <div class="wf-box" style="border-color:#22c55e;background:#f0fdf4;color:#15803d;">✅ APPROVED</div>
  </div>
  <div class="info-box">📋 <strong>Pengecualian:</strong> Medical Leave (MC) diluluskan <em>automatik</em> tanpa melalui mana-mana peringkat. Ia terus berstatus APPROVED sebaik dihantar.</div>

  <h2 class="section">4.2 Peringkat 0 — Team Leader (Khas Operasi Balok)</h2>
  <p>Peringkat ini <strong>hanya untuk staf Operasi di cawangan Balok (Klinik Syed Badaruddin Balok HQ)</strong> apabila pilihan <em>needs_tl</em> didayakan dalam konfigurasi Routing. Pemohon <strong>wajib</strong> memilih Team Leader semasa mengisi borang cuti.</p>
  <div class="steps">
    <div class="step"><div class="step-num">1</div><div class="step-body">Team Leader menerima notifikasi WhatsApp — <em>"Permohonan Cuti Baru — Peringkat 0 (Sokongan Team Leader)"</em>.</div></div>
    <div class="step"><div class="step-num">2</div><div class="step-body">Log masuk → <strong>Management → Pending</strong>. Permohonan berstatus <span class="badge b-orange">PENDING</span> dipaparkan di bawah antrian Team Leader.</div></div>
    <div class="step"><div class="step-num">3</div><div class="step-body">Klik <strong>"Sokong"</strong> — status bertukar kepada <span class="badge b-red">TL APPROVED</span> dan Supervisor Balok menerima notifikasi.</div></div>
    <div class="step"><div class="step-num">4</div><div class="step-body">Jika ditolak, permohonan terus ditolak dan pemohon diberitahu melalui WhatsApp.</div></div>
  </div>
  <div class="warn-box">⚠️ Supervisor Balok <strong>tidak boleh</strong> melangkau peringkat ini — permohonan mesti disokong Team Leader dahulu.</div>

  <h2 class="section">4.3 Peringkat 1 — HOD / Supervisor / PIC HOD</h2>
  <div class="steps">
    <div class="step"><div class="step-num">1</div><div class="step-body">Log masuk. Notifikasi WhatsApp diterima apabila ada permohonan baru (atau TL APPROVED untuk Supervisor Balok).</div></div>
    <div class="step"><div class="step-num">2</div><div class="step-body">Klik <strong>Management → Pending</strong> untuk melihat senarai permohonan menunggu.</div></div>
    <div class="step"><div class="step-num">3</div><div class="step-body">Semak butiran: nama pemohon, jenis cuti, tarikh, tempoh, dan baki AL terkini.</div></div>
    <div class="step"><div class="step-num">4</div><div class="step-body">Klik <strong>"Sokong"</strong> (→ HOD APPROVED → ke P2) atau <strong>"Tolak"</strong>. Masukkan sebab jika ditolak.</div></div>
  </div>
  <div class="warn-box">⏰ <strong>Peringatan Automatik:</strong> Permohonan tertangguh lebih <strong>7 hari</strong> akan mencetuskan notifikasi WhatsApp peringatan kepada pelulus berkaitan setiap hari.</div>

  <h2 class="section">4.4 Peringkat 2 — HR / Admin</h2>
  <div class="steps">
    <div class="step"><div class="step-num">1</div><div class="step-body">Buka tab <strong>Pending</strong>. Permohonan berstatus <span class="badge b-blue">HOD APPROVED</span> menunggu tindakan.</div></div>
    <div class="step"><div class="step-num">2</div><div class="step-body">Semak rekod staf, baki cuti, dan kesesuaian jadual kerja.</div></div>
    <div class="step"><div class="step-num">3</div><div class="step-body">Klik <strong>"Luluskan"</strong> atau <strong>"Tolak"</strong>. Notifikasi WhatsApp dihantar kepada pemohon automatik.</div></div>
  </div>

  <h2 class="section">4.5 Notifikasi WhatsApp Automatik</h2>
  <table>
    <tr><th>Peristiwa</th><th>Penerima Notifikasi</th></tr>
    <tr><td>Permohonan baru — Staf Operasi Balok (needs_tl aktif)</td><td><span class="badge b-red">Team Leader (P0)</span> + makluman Supervisor</td></tr>
    <tr><td>Permohonan baru — Staf lain</td><td><span class="badge b-orange">HOD / Supervisor / PIC HOD (P1)</span></td></tr>
    <tr><td>Disokong Team Leader (TL APPROVED)</td><td>Pemohon (makluman) + Supervisor Balok (P1)</td></tr>
    <tr><td>Diluluskan Peringkat 1 (HOD APPROVED)</td><td>HR / Admin (Peringkat 2)</td></tr>
    <tr><td>Diluluskan / Ditolak (Akhir)</td><td>Pemohon (Staff)</td></tr>
    <tr><td>Permohonan dibatalkan</td><td>Pemohon (Staff)</td></tr>
    <tr><td>Tertangguh &gt; 7 hari</td><td>Pelulus berkaitan — Team Leader / Supervisor / HR (harian)</td></tr>
    <tr><td>Terlupa kata laluan</td><td>Staff (kata laluan dihantar ke WA)</td></tr>
  </table>
</div>

<!-- ═══════════════════════════════════════════ BAB 5 ═══ -->
<div class="page chapter-break">
  <h1 class="chapter">5. Pengurusan (HR &amp; Admin)</h1>

  <h2 class="section">5.1 Pengurusan Staf</h2>
  <p>Subtab: <strong>Staff Management</strong></p>
  <h3 class="subsection">Tambah Staf Baru</h3>
  <div class="steps">
    <div class="step"><div class="step-num">1</div><div class="step-body">Klik butang <strong>"+ Tambah Staf"</strong>.</div></div>
    <div class="step"><div class="step-num">2</div><div class="step-body">Isikan maklumat: Nama (huruf besar), No. IC, No. Telefon (WhatsApp), Cawangan, Peranan, Kategori, Jantina, dan Tarikh Mula Bekerja.</div></div>
    <div class="step"><div class="step-num">3</div><div class="step-body">Tetapkan kelayakan cuti jika berbeza dari lalai (ent_AL, ent_MC, ent_EL, ent_HL).</div></div>
    <div class="step"><div class="step-num">4</div><div class="step-body">Klik <strong>"Simpan"</strong>. Staf boleh log masuk menggunakan nombor IC sebagai kata laluan awal.</div></div>
  </div>
  <h3 class="subsection">Edit Profil Staf</h3>
  <ul>
    <li>Klik nama staf dalam senarai untuk buka modal Edit.</li>
    <li>HR boleh kemaskini: Kelayakan AL (<em>ent_AL</em>), Bawa Lepas (<em>ent_CF</em>), Pelarasan HR (<em>al_adj</em>), Kelayakan MC, EL, HL.</li>
    <li>Togol <strong>"Pro-Rata AL"</strong> untuk staf yang baru bekerja dalam tahun semasa.</li>
    <li>Togol <strong>"Tidak Aktif"</strong> untuk nyahaktifkan staf yang berhenti (data dikekalkan).</li>
  </ul>
  <div class="info-box">ℹ️ <strong>Pelarasan HR (al_adj)</strong>: Untuk memasukkan hari AL yang digunakan <em>sebelum</em> sistem dilaksanakan, atau rekonsiliasi manual dengan rekod HR sedia ada.</div>

  <h2 class="section">5.2 Laporan HR</h2>
  <table>
    <tr><th>Tab Laporan</th><th>Kandungan</th></tr>
    <tr><td>Semua Permohonan</td><td>Senarai semua permohonan cuti dengan penapisan mengikut cawangan, jenis, dan tahun. Boleh cetak / eksport.</td></tr>
    <tr><td>Laporan Diluluskan</td><td>Rekod cuti APPROVED sahaja, dengan ringkasan jumlah hari mengikut jenis cuti.</td></tr>
    <tr><td>Laporan Baki Cuti</td><td>Baki cuti semua staf bagi jenis cuti yang dipilih.</td></tr>
    <tr><td>Laporan Jenis Cuti</td><td>Pecahan statistik penggunaan cuti mengikut jenis, dengan carta perbandingan antara cawangan.</td></tr>
  </table>

  <h2 class="section">5.3 Rekod Locum</h2>
  <ul>
    <li>Tambah rekod locum baru: nama doktor, cawangan, tarikh, dan anggaran kos.</li>
    <li>Statistik penggunaan locum mengikut bulan dan cawangan.</li>
    <li>Diakses oleh: Admin, HR, Super Admin, dan Supervisor.</li>
  </ul>

  <h2 class="section">5.4 Log Sistem</h2>
  <table>
    <tr><th>Jenis Log</th><th>Kandungan</th></tr>
    <tr><td>Master Logs</td><td>Semua tindakan sistem: tambah staf, edit, luluskan, tolak, dan sebagainya.</td></tr>
    <tr><td>Login Audit</td><td>Rekod semua sesi log masuk: siapa, bila, dari peranti mana. Untuk keselamatan dan audit.</td></tr>
  </table>
</div>

<!-- ═══════════════════════════════════════════ BAB 6 ═══ -->
<div class="page chapter-break">
  <h1 class="chapter">6. Tetapan &amp; Konfigurasi</h1>

  <h2 class="section">6.1 Tetapan WhatsApp (Fonnte)</h2>
  <p>Notifikasi WhatsApp dihantar melalui <strong>Fonnte.com</strong>. Hanya boleh dikonfigurasi oleh <span class="badge b-red">Super Admin</span>.</p>
  <div class="steps">
    <div class="step"><div class="step-num">1</div><div class="step-body">Daftar akaun di <strong>fonnte.com</strong> dan sambungkan nombor WhatsApp pejabat KSB.</div></div>
    <div class="step"><div class="step-num">2</div><div class="step-body">Salin <strong>Token API</strong> dari papan pemuka Fonnte.</div></div>
    <div class="step"><div class="step-num">3</div><div class="step-body">Dalam sistem, buka <strong>Management → WhatsApp Settings</strong>.</div></div>
    <div class="step"><div class="step-num">4</div><div class="step-body">Tampal token dan klik <strong>"Simpan Token"</strong>.</div></div>
    <div class="step"><div class="step-num">5</div><div class="step-body">Uji dengan memasukkan nombor telefon dan klik <strong>"Hantar Ujian"</strong>.</div></div>
  </div>

  <h2 class="section">6.2 Kawalan Akses (RBAC)</h2>
  <table>
    <tr><th>Modul / Kebenaran</th><th>Penerangan</th></tr>
    <tr><td>Dashboard</td><td>Jenis papan pemuka: Analitik / Cawangan / Peribadi</td></tr>
    <tr><td>Leave Request</td><td>Boleh mohon cuti</td></tr>
    <tr><td>Management</td><td>Akses ke modul pengurusan</td></tr>
    <tr><td>Manage Pending</td><td>Boleh luluskan / tolak permohonan</td></tr>
    <tr><td>Manage Staff</td><td>Boleh tambah / edit staf</td></tr>
    <tr><td>Manage Reports</td><td>Boleh lihat laporan HR</td></tr>
    <tr><td>WA Setting</td><td>Boleh ubah token Fonnte</td></tr>
    <tr><td>Locum Records</td><td>Akses rekod locum</td></tr>
    <tr><td>Can Cancel</td><td>Boleh batalkan permohonan orang lain</td></tr>
  </table>

  <h2 class="section">6.3 Routing Kelulusan</h2>
  <ul>
    <li>Routing dikonfigurasi mengikut <em>Cawangan → Kategori Staf → Pelulus P0, P1 &amp; P2</em>.</li>
    <li>Peringkat 0 (P0): Team Leader (khas Operasi Balok, togol needs_tl).</li>
    <li>Peringkat 1 (P1): HOD, PIC HOD, Supervisor, atau Team Leader.</li>
    <li>Peringkat 2 (P2): HR atau Admin.</li>
  </ul>

  <h2 class="section">6.4 Tetapan Peribadi</h2>
  <ul>
    <li><strong>Tukar Kata Laluan</strong> — Masukkan kata laluan lama, kemudian kata laluan baru dua kali.</li>
    <li><strong>Profil Peribadi</strong> — Semak maklumat profil anda.</li>
    <li><strong>Tema</strong> — Togol mod gelap / terang.</li>
  </ul>
</div>

<!-- ═══════════════════════════════════════════ BAB 7 ═══ -->
<div class="page chapter-break">
  <h1 class="chapter">7. Messenger Dalaman</h1>
  <h2 class="section">7.1 Jenis Bilik Sembang</h2>
  <table>
    <tr><th>Jenis</th><th>Penerangan</th></tr>
    <tr><td>Mesej Terus (DM)</td><td>Perbualan peribadi antara dua kakitangan.</td></tr>
    <tr><td>Kumpulan Cawangan</td><td>Bilik sembang untuk semua kakitangan di sesebuah cawangan.</td></tr>
    <tr><td>Kumpulan Peranan</td><td>Bilik sembang khusus untuk kumpulan peranan (cth: Staff Admin, Doctor).</td></tr>
    <tr><td>Bilik Am</td><td>Bilik sembang umum untuk semua kakitangan KSB.</td></tr>
  </table>
  <h2 class="section">7.2 Ciri Messenger</h2>
  <ul>
    <li><strong>Hantar mesej teks</strong> — Taip dan tekan Enter atau butang Hantar.</li>
    <li><strong>Kongsikan fail</strong> — Klik ikon klip kertas untuk lampirkan gambar, PDF, atau fail lain.</li>
    <li><strong>Penunjuk dalam talian</strong> — Tanda hijau menunjukkan pengguna sedang aktif.</li>
    <li><strong>Notifikasi Toast</strong> — Mesej baru dipaparkan sebagai pop-up walau anda di mana-mana bahagian sistem.</li>
    <li><strong>Bilangan mesej belum baca</strong> — Lencana merah pada ikon Messenger.</li>
  </ul>
  <div class="info-box">💡 Tekan <strong>Enter</strong> untuk hantar. Tekan <strong>Shift+Enter</strong> untuk baris baru dalam mesej.</div>
</div>

<!-- ═══════════════════════════════════════════ BAB 8 ═══ -->
<div class="page chapter-break">
  <h1 class="chapter">8. Dasar Cuti (Polisi)</h1>

  <h2 class="section">8.1 Annual Leave (AL)</h2>
  <table>
    <tr><th>Perkara</th><th>Peraturan</th></tr>
    <tr><td>Kelayakan Admin/Operation</td><td>14 hari setahun</td></tr>
    <tr><td>Kelayakan Doktor (&lt;2 tahun)</td><td>20 hari setahun</td></tr>
    <tr><td>Kelayakan Doktor (≥2 tahun)</td><td>25 hari setahun</td></tr>
    <tr><td>Bawa Lepas (Carry Forward)</td><td>Maksimum 3 hari ke tahun berikutnya</td></tr>
    <tr><td>Permohonan Minimum</td><td>Hantar sekurang-kurangnya 3 hari bekerja lebih awal</td></tr>
    <tr><td>Cuti Separuh Hari</td><td>Dibenarkan (dikira 0.5 hari)</td></tr>
  </table>

  <h2 class="section">8.2 Medical Leave (MC)</h2>
  <ul>
    <li>Kelayakan: <strong>14 hari</strong> setahun.</li>
    <li>Diluluskan <strong>automatik</strong> — tiada kelulusan HOD/HR diperlukan.</li>
    <li>Sijil MC <strong>mesti disertakan</strong> pada hari pertama bekerja semula.</li>
    <li>MC lebih 2 hari berturut-turut: maklumkan HOD dan HR.</li>
  </ul>

  <h2 class="section">8.3 Cuti Kecemasan (EL)</h2>
  <table>
    <tr><th>Jenis EL</th><th>Kelayakan</th><th>Catatan</th></tr>
    <tr><td>EL (Compassionate/Ehsan)</td><td>3 hari</td><td>Kematian ahli keluarga terdekat. Percuma — tidak tolak dari AL.</td></tr>
    <tr><td>EL_EMG (Kecemasan Am)</td><td>Fleksibel</td><td>Ditolak dari baki Annual Leave (AL).</td></tr>
  </table>

  <h2 class="section">8.4 Cuti Lain</h2>
  <ul>
    <li><strong>Hospitalisasi (HL):</strong> Maksimum 60 hari. Memerlukan surat pengesahan wad.</li>
    <li><strong>Cuti Bersalin (ML):</strong> 98 hari untuk kakitangan wanita.</li>
    <li><strong>Cuti Paterniti (ML_PL):</strong> 7 hari untuk kakitangan lelaki apabila isteri bersalin.</li>
    <li><strong>CME:</strong> 5 hari untuk doktor bagi tujuan pendidikan perubatan berterusan.</li>
    <li><strong>Cuti Tanpa Gaji (UL):</strong> Setelah baki AL habis. Memerlukan kelulusan khas dari HR.</li>
  </ul>
</div>

<!-- ═══════════════════════════════════════════ BAB 9 ═══ -->
<div class="page chapter-break">
  <h1 class="chapter">9. Soalan Lazim (FAQ)</h1>

  <h3 class="subsection">S: Saya tidak nampak nama saya dalam senarai drop-down. Apa perlu buat?</h3>
  <p>J: Pastikan anda memilih <em>cawangan</em> yang betul terlebih dahulu. Jika masih tidak muncul, hubungi HR/Admin untuk memastikan profil anda telah didaftarkan.</p>

  <h3 class="subsection">S: Saya terlupa kata laluan. Bagaimana?</h3>
  <p>J: Klik <strong>"Lupa Kata Laluan?"</strong> di skrin log masuk. Kata laluan semasa akan dihantar ke nombor WhatsApp anda.</p>

  <h3 class="subsection">S: Berapa lama untuk permohonan diluluskan?</h3>
  <p>J: Tiada had masa ditetapkan, tetapi sistem akan hantar peringatan automatik kepada pelulus selepas 7 hari jika masih belum diambil tindakan.</p>

  <h3 class="subsection">S: Bolehkah saya batalkan permohonan yang sudah dihantar?</h3>
  <p>J: Permohonan berstatus PENDING boleh dibatalkan sendiri. Permohonan yang sudah diluluskan hanya boleh dibatalkan oleh HR atau Admin.</p>

  <h3 class="subsection">S: Mengapa baki AL saya berbeza dari rekod HR?</h3>
  <p>J: Kemungkinan terdapat pelarasan manual (al_adj) yang belum dimasukkan. Hubungi HR untuk rekonsiliasi baki AL anda.</p>

  <h3 class="subsection">S: Saya mendapat mesej "Duplicate Session". Apa maksudnya?</h3>
  <p>J: Akaun anda sedang digunakan pada peranti lain. Sesi lebih awal akan ditamatkan automatik. Klik "Log Masuk Semula" untuk teruskan.</p>

  <h3 class="subsection">S: Notifikasi WhatsApp tidak diterima. Apa masalahnya?</h3>
  <p>J: Semak dengan Admin bahawa token Fonnte masih aktif. Pastikan nombor WhatsApp anda didaftarkan dalam sistem. Admin boleh uji dari <em>Management → WhatsApp Settings</em>.</p>

  <h3 class="subsection">S: Apa perbezaan EL (Ehsan) dan EL_EMG (Kecemasan)?</h3>
  <p>J: <strong>EL Ehsan</strong> khusus untuk kematian ahli keluarga terdekat — percuma (tidak tolak AL), had 3 hari. <strong>EL_EMG</strong> untuk kecemasan am lain (kereta rosak, anak sakit) — ditolak dari baki AL.</p>

  <h3 class="subsection">S: Bolehkah saya akses sistem dari telefon bimbit?</h3>
  <p>J: Ya. Buka pelayar, pergi ke URL sistem, dan pilih "Tambah ke Skrin Utama" untuk pengalaman seperti aplikasi mudah alih.</p>
</div>

<!-- ═══════════════════════════════════════════ BAB 10 ═══ -->
<div class="page chapter-break">
  <h1 class="chapter">10. Hubungi Admin</h1>
  <table>
    <tr><th>Perkara</th><th>Tindakan</th></tr>
    <tr><td>Masalah log masuk / kata laluan</td><td>Hubungi HR atau Admin cawangan anda</td></tr>
    <tr><td>Ralat dalam rekod cuti</td><td>Hubungi HR untuk semakan dan pembetulan</td></tr>
    <tr><td>Notifikasi WhatsApp bermasalah</td><td>Hubungi Super Admin untuk semak token Fonnte</td></tr>
    <tr><td>Permintaan ciri baru / bug report</td><td>Hubungi pembangun sistem secara terus</td></tr>
    <tr><td>Akses tambahan / tukar peranan</td><td>Hubungi Super Admin melalui Messenger atau WhatsApp</td></tr>
  </table>

  <h2 class="section">Maklumat Sistem</h2>
  <table>
    <tr><th>Perkara</th><th>Maklumat</th></tr>
    <tr><td>URL Sistem</td><td>https://apply-leave-89ebb.web.app</td></tr>
    <tr><td>Platform</td><td>Progressive Web App (PWA)</td></tr>
    <tr><td>Pangkalan Data</td><td>Firebase Firestore (Google Cloud)</td></tr>
    <tr><td>Notifikasi</td><td>WhatsApp melalui Fonnte.com</td></tr>
    <tr><td>Versi Manual</td><td>Edisi Mei 2026</td></tr>
    <tr><td>Dikemaskini</td><td>26 Mei 2026</td></tr>
  </table>

  <!-- Logo bar at bottom -->
  <div style="display:flex;align-items:center;justify-content:center;gap:24px;margin:32px 0 16px;flex-wrap:wrap;">
    ${logoKSB     ? `<img src="${logoKSB}"     alt="KSB"     style="height:52px;object-fit:contain;border-radius:8px;">` : ''}
    ${logoBentong ? `<img src="${logoBentong}" alt="Bentong" style="height:52px;object-fit:contain;border-radius:8px;">` : ''}
    ${logoKR      ? `<img src="${logoKR}"      alt="KR"      style="height:52px;object-fit:contain;border-radius:8px;">` : ''}
  </div>

  <div class="success-box">✅ <strong>Tip Keselamatan:</strong> Tukar kata laluan anda secara berkala melalui <em>Settings → Security</em>. Jangan kongsi kata laluan anda dengan sesiapa. Log keluar (<em>Sign Out</em>) apabila menggunakan peranti bersama.</div>
  <div class="footer">
    Manual Pengguna KSB Leave Apply &nbsp;·&nbsp; Edisi Mei 2026 &nbsp;·&nbsp; Kumpulan Klinik Syed Badaruddin (KSB) &nbsp;·&nbsp; SULIT — Untuk Kegunaan Dalaman Sahaja
  </div>
</div>

</body>
</html>`;

  console.log('\nMembuka Puppeteer...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });

  console.log('Menjana PDF...');
  await page.pdf({
    path: OUTPUT_PATH,
    format: 'A4',
    printBackground: true,
    margin: { top: '15mm', bottom: '15mm', left: '12mm', right: '12mm' }
  });

  await browser.close();
  console.log('✅ PDF berjaya dijana: ' + OUTPUT_PATH);
})();
