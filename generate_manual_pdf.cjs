/**
 * KSB Leave Apply — Manual PDF Generator
 * Takes screenshots of the live system and generates a styled PDF manual.
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const SYSTEM_URL = 'https://apply-leave-89ebb.web.app';
const OUTPUT_PATH = 'C:\\Users\\user\\Desktop\\MANUAL SISTEM KSB LEAVE APPLY.pdf';

// ─── Helpers ────────────────────────────────────────────────────────────────

async function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function screenshot(page, label) {
  console.log(`  📸 Screenshot: ${label}`);
  const buf = await page.screenshot({ encoding: 'base64', fullPage: false });
  return `data:image/png;base64,${buf}`;
}

async function waitForApp(page) {
  await page.waitForFunction(() => {
    const app = document.querySelector('#app');
    return app && app.innerHTML.length > 500;
  }, { timeout: 15000 });
  await delay(1200);
}

// ─── Main ────────────────────────────────────────────────────────────────────

(async () => {
  console.log('🚀 Memulakan Puppeteer...');

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,800'],
    defaultViewport: { width: 1280, height: 800 }
  });

  const page = await browser.newPage();
  const shots = {};

  try {
    // ── 1. Login Page ───────────────────────────────────────────────────────
    console.log('\n[1/8] Halaman Log Masuk');
    await page.goto(SYSTEM_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await waitForApp(page);
    shots.login = await screenshot(page, 'Login Page');

    // ── 2. Login with backdoor ──────────────────────────────────────────────
    console.log('\n[2/8] Log masuk sistem...');

    // Select branch "Management / HQ"
    await page.waitForSelector('#login-branch', { timeout: 10000 });
    await page.select('#login-branch', 'Management / HQ');
    await delay(500);

    // Type IC in search box
    const searchBox = await page.$('#staff-search-input');
    if (searchBox) {
      await searchBox.click();
      await searchBox.type('super admin', { delay: 80 });
      await delay(800);
      // Try clicking first option
      const firstOpt = await page.$('.staff-option');
      if (firstOpt) await firstOpt.click();
      else {
        await page.evaluate(() => {
          window.selectLoginStaff('super-admin', 'Super Admin');
        });
      }
    }

    await delay(400);
    // Enter password
    const pwdInput = await page.$('input[type="password"]');
    if (pwdInput) {
      await pwdInput.click({ clickCount: 3 });
      await pwdInput.type('ksb-super-2026', { delay: 60 });
    }

    // Submit
    const loginBtn = await page.$('button[type="submit"]');
    if (loginBtn) await loginBtn.click();

    await delay(2500);
    await waitForApp(page);

    // ── 3. Dashboard Analytics ──────────────────────────────────────────────
    console.log('\n[3/8] Dashboard Analisa');
    shots.dashboard = await screenshot(page, 'Dashboard');

    // ── 4. Leave Request Form ───────────────────────────────────────────────
    console.log('\n[4/8] Borang Permohonan Cuti');
    await page.evaluate(() => window.setView && window.setView('apply'));
    await delay(1500);
    await waitForApp(page);
    shots.applyLeave = await screenshot(page, 'Apply Leave Form');

    // ── 5. Scroll down leave form to show HOD dropdown & info card ──────────
    console.log('\n[5/8] Borang Cuti — Bahagian Pelulus & Aliran Kelulusan');
    await page.evaluate(() => window.scrollTo(0, 600));
    await delay(600);
    shots.applyLeaveBottom = await screenshot(page, 'Apply Leave — Approver Section');

    // Reset scroll
    await page.evaluate(() => window.scrollTo(0, 0));

    // ── 6. Management — Pending Approvals ───────────────────────────────────
    console.log('\n[6/8] Kelulusan Tertangguh');
    await page.evaluate(() => window.setView && window.setView('management'));
    await delay(1200);
    await waitForApp(page);
    shots.pending = await screenshot(page, 'Management — Pending');

    // ── 7. Staff Tab ────────────────────────────────────────────────────────
    console.log('\n[7/9] Pengurusan Staf');
    await page.evaluate(() => window.setManageTab && window.setManageTab('staff'));
    await delay(1200);
    shots.staff = await screenshot(page, 'Staff Management');

    // ── 7b. Open edit modal for first staff — screenshot AL section ──────────
    console.log('\n[7b/9] Modal Kemaskini Profil & Baki Cuti');
    try {
      const firstEditBtn = await page.$('.edit-staff-btn');
      if (firstEditBtn) {
        await firstEditBtn.click();
        await delay(1200);
        // Scroll modal to AL section
        await page.evaluate(() => {
          const el = document.getElementById('ent-CF');
          if (el) el.scrollIntoView({ block: 'center' });
        });
        await delay(500);
        shots.staffModal = await screenshot(page, 'Modal Kemaskini Profil & Baki Cuti — Bahagian AL');
        // Close modal
        const closeBtn = await page.$('#close-modal');
        if (closeBtn) await closeBtn.click();
        await delay(600);
      }
    } catch (err) {
      console.warn('  ⚠️  Modal screenshot gagal:', err.message);
    }

    // ── 8. Branches Tab ─────────────────────────────────────────────────────
    console.log('\n[8/9] Pengurusan Cawangan');
    await page.evaluate(() => window.setManageTab && window.setManageTab('branches'));
    await delay(1000);
    shots.branches = await screenshot(page, 'Branch Management');

    // ── 9. Messenger ─────────────────────────────────────────────────────────
    console.log('\n[9/9] Messenger');
    await page.evaluate(() => window.setView && window.setView('messenger'));
    await delay(1500);
    await waitForApp(page);
    shots.messenger = await screenshot(page, 'Messenger — Senarai Perbualan');

    // Open All KSB room
    await page.evaluate(() => window.openRoom && window.openRoom('all_ksb', 'Semua Staf KSB', 'group'));
    await delay(1000);
    shots.messengerChat = await screenshot(page, 'Messenger — Ruangan Chat');

  } catch (err) {
    console.error('❌ Error semasa screenshot:', err.message);
  }

  await browser.close();
  console.log('\n✅ Semua screenshots berjaya diambil. Menjana PDF...');

  // ─── Build HTML ────────────────────────────────────────────────────────────

  const imgTag = (src, caption) => src
    ? `<figure class="ss">
         <img src="${src}" alt="${caption}">
         <figcaption>${caption}</figcaption>
       </figure>`
    : `<div class="ss-missing">[ Screenshot tidak tersedia: ${caption} ]</div>`;

  const html = `<!DOCTYPE html>
<html lang="ms">
<head>
<meta charset="UTF-8">
<style>
  /* ── Reset & Base ── */
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html { font-size: 10pt; }
  body {
    font-family: 'Segoe UI', Arial, sans-serif;
    color: #1a1a2e;
    background: #fff;
    line-height: 1.6;
  }

  /* ── Cover Page ── */
  .cover {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    height: 100vh;
    text-align: center;
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
    color: #fff;
    page-break-after: always;
    padding: 3rem;
  }
  .cover .logo-circle {
    width: 90px; height: 90px;
    border-radius: 50%;
    background: linear-gradient(135deg, #4361ee, #7c3aed);
    display: flex; align-items: center; justify-content: center;
    font-size: 2.5rem;
    margin-bottom: 2rem;
    box-shadow: 0 8px 32px rgba(67,97,238,0.5);
  }
  .cover h1 {
    font-size: 2.2rem;
    font-weight: 800;
    letter-spacing: 1px;
    margin-bottom: 0.5rem;
    text-shadow: 0 2px 8px rgba(0,0,0,0.3);
  }
  .cover .subtitle {
    font-size: 1.1rem;
    color: #94a3b8;
    margin-bottom: 0.3rem;
  }
  .cover .org {
    font-size: 1.3rem;
    font-weight: 700;
    color: #7dd3fc;
    margin-bottom: 2.5rem;
  }
  .cover .meta {
    display: flex; gap: 2rem;
    font-size: 0.85rem;
    color: #cbd5e1;
    border-top: 1px solid rgba(255,255,255,0.15);
    padding-top: 1.5rem;
    margin-top: 1.5rem;
  }
  .cover .meta span { display: flex; flex-direction: column; align-items: center; }
  .cover .meta strong { font-size: 1rem; color: #fff; }
  .cover .url {
    margin-top: 2rem;
    background: rgba(255,255,255,0.08);
    border: 1px solid rgba(255,255,255,0.15);
    border-radius: 8px;
    padding: 0.6rem 1.5rem;
    font-size: 0.95rem;
    color: #7dd3fc;
    letter-spacing: 0.5px;
  }

  /* ── TOC Page ── */
  .toc-page {
    padding: 3rem 3.5rem;
    page-break-after: always;
    min-height: 100vh;
  }
  .toc-page h2 {
    font-size: 1.6rem; font-weight: 800;
    color: #4361ee;
    border-bottom: 3px solid #4361ee;
    padding-bottom: 0.5rem;
    margin-bottom: 1.5rem;
  }
  .toc-item {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 0.45rem 0;
    border-bottom: 1px dotted #e2e8f0;
    font-size: 0.95rem;
  }
  .toc-item .num { color: #4361ee; font-weight: 700; min-width: 2rem; }
  .toc-item .title { flex: 1; padding: 0 0.5rem; }
  .toc-item .pg { color: #94a3b8; font-size: 0.85rem; }
  .toc-section { margin-top: 1.2rem; }
  .toc-section-label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    color: #94a3b8;
    font-weight: 700;
    margin-bottom: 0.4rem;
    margin-top: 0.8rem;
  }

  /* ── Section Pages ── */
  .section {
    padding: 2.5rem 3.5rem;
    page-break-before: always;
  }
  .section-header {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1.5rem;
    padding-bottom: 1rem;
    border-bottom: 3px solid #4361ee;
  }
  .section-num {
    width: 42px; height: 42px;
    border-radius: 50%;
    background: linear-gradient(135deg, #4361ee, #7c3aed);
    color: #fff;
    font-size: 1.1rem;
    font-weight: 800;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
  }
  .section-title { font-size: 1.5rem; font-weight: 800; color: #1a1a2e; }

  /* ── Typography ── */
  h3 {
    font-size: 1.05rem;
    font-weight: 700;
    color: #4361ee;
    margin: 1.4rem 0 0.6rem;
  }
  h4 {
    font-size: 0.95rem;
    font-weight: 700;
    color: #1a1a2e;
    margin: 1rem 0 0.4rem;
  }
  p { margin-bottom: 0.7rem; font-size: 0.92rem; }
  ul, ol { margin: 0.5rem 0 0.8rem 1.5rem; font-size: 0.92rem; }
  li { margin-bottom: 0.3rem; }

  /* ── Callout Boxes ── */
  .callout {
    border-radius: 10px;
    padding: 0.9rem 1.1rem;
    margin: 1rem 0;
    font-size: 0.88rem;
    display: flex;
    gap: 0.7rem;
    align-items: flex-start;
  }
  .callout-icon { font-size: 1.1rem; flex-shrink: 0; margin-top: 0.05rem; }
  .callout.info { background: #eff6ff; border-left: 4px solid #3b82f6; }
  .callout.warning { background: #fffbeb; border-left: 4px solid #f59e0b; }
  .callout.danger { background: #fef2f2; border-left: 4px solid #ef4444; }
  .callout.success { background: #f0fdf4; border-left: 4px solid #22c55e; }

  /* ── Tables ── */
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.87rem;
    margin: 0.8rem 0 1.2rem;
  }
  thead tr { background: #4361ee; color: #fff; }
  thead th { padding: 0.6rem 0.8rem; font-weight: 700; text-align: left; }
  tbody tr:nth-child(even) { background: #f8fafc; }
  tbody td { padding: 0.55rem 0.8rem; border-bottom: 1px solid #e2e8f0; }
  td.center { text-align: center; }

  /* ── Flow Diagram ── */
  .flow {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0;
    margin: 1.2rem auto;
    max-width: 420px;
  }
  .flow-box {
    background: #eff6ff;
    border: 2px solid #4361ee;
    border-radius: 10px;
    padding: 0.7rem 1.5rem;
    font-weight: 700;
    font-size: 0.9rem;
    color: #1e3a8a;
    text-align: center;
    width: 100%;
  }
  .flow-box.green { background: #f0fdf4; border-color: #22c55e; color: #14532d; }
  .flow-box.amber { background: #fffbeb; border-color: #f59e0b; color: #713f12; }
  .flow-box.final { background: linear-gradient(135deg,#4361ee,#7c3aed); color:#fff; border-color: transparent; }
  .flow-arrow {
    font-size: 1.4rem;
    color: #94a3b8;
    padding: 0.2rem 0;
    line-height: 1;
  }
  .flow-label {
    font-size: 0.75rem;
    color: #64748b;
    margin: -0.1rem 0;
    font-style: italic;
  }

  /* ── Role Badges ── */
  .badge {
    display: inline-block;
    padding: 0.15rem 0.5rem;
    border-radius: 999px;
    font-size: 0.78rem;
    font-weight: 700;
  }
  .badge-blue { background: #dbeafe; color: #1e40af; }
  .badge-purple { background: #ede9fe; color: #5b21b6; }
  .badge-green { background: #dcfce7; color: #14532d; }
  .badge-amber { background: #fef3c7; color: #92400e; }
  .badge-red { background: #fee2e2; color: #991b1b; }
  .badge-gray { background: #f1f5f9; color: #475569; }

  /* ── Screenshots ── */
  .ss {
    margin: 1.2rem 0;
    border-radius: 12px;
    overflow: hidden;
    box-shadow: 0 4px 24px rgba(0,0,0,0.12);
    border: 1px solid #e2e8f0;
    page-break-inside: avoid;
  }
  .ss img {
    width: 100%;
    display: block;
  }
  .ss figcaption {
    background: #f8fafc;
    border-top: 1px solid #e2e8f0;
    padding: 0.45rem 0.9rem;
    font-size: 0.78rem;
    color: #64748b;
    font-style: italic;
  }
  .ss-missing {
    background: #f8fafc;
    border: 2px dashed #e2e8f0;
    border-radius: 10px;
    padding: 1.5rem;
    text-align: center;
    color: #94a3b8;
    font-size: 0.85rem;
    margin: 1rem 0;
  }
  .ss-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
    margin: 1rem 0;
  }

  /* ── Steps ── */
  .steps { margin: 0.8rem 0; }
  .step {
    display: flex;
    gap: 0.9rem;
    margin-bottom: 0.7rem;
    align-items: flex-start;
  }
  .step-num {
    width: 26px; height: 26px;
    border-radius: 50%;
    background: #4361ee;
    color: #fff;
    font-size: 0.78rem;
    font-weight: 800;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
    margin-top: 2px;
  }
  .step-body { font-size: 0.9rem; }
  .step-body strong { display: block; font-size: 0.88rem; }

  /* ── Footer ── */
  @page { margin: 0; size: A4; }
  .footer-bar {
    position: fixed;
    bottom: 0; left: 0; right: 0;
    height: 28px;
    background: #1a1a2e;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 2rem;
    font-size: 0.7rem;
    color: #64748b;
  }

  /* ── Status chips ── */
  .chip {
    display: inline-block;
    padding: 0.1rem 0.55rem;
    border-radius: 999px;
    font-size: 0.78rem;
    font-weight: 700;
    margin-right: 0.2rem;
  }
  .chip-pending { background:#fef3c7; color:#92400e; }
  .chip-hod { background:#dbeafe; color:#1e40af; }
  .chip-approved { background:#dcfce7; color:#14532d; }
  .chip-rejected { background:#fee2e2; color:#991b1b; }
  .chip-cancelled { background:#f1f5f9; color:#475569; }

  hr.divider { border: none; border-top: 1px solid #e2e8f0; margin: 1.2rem 0; }
</style>
</head>
<body>

<!-- ═══════════════════════════════════════════════════════════ COVER -->
<div class="cover">
  <div class="logo-circle">🏥</div>
  <div class="subtitle">MANUAL PENGGUNA RASMI</div>
  <h1>KSB Leave Apply</h1>
  <div class="org">Klinik Syed Badaruddin (KSB)</div>
  <p style="color:#cbd5e1;max-width:520px;font-size:0.95rem;line-height:1.7;">
    Sistem Pengurusan Cuti Digital bagi semua staf KSB — merangkumi permohonan cuti,
    aliran kelulusan <strong style="color:#fbbf24;">dua atau tiga peringkat</strong> (termasuk Team Leader untuk staf Balok),
    pengurusan staf & cawangan, laporan, notifikasi WhatsApp automatik,
    <strong style="color:#7dd3fc;">Messenger dalaman</strong>, rekod locum, kawalan akses RBAC penuh,
    serta <strong style="color:#86efac;">peringatan automatik</strong> untuk kelulusan tertangguh.
    Kini menyokong peranan paramedik: <strong style="color:#f9a8d4;">Juru X-Ray, Sonographer &amp; Juru Audio</strong>.
  </p>
  <div style="margin: 20px 0; padding: 10px 24px; background: rgba(67, 97, 238, 0.2); border: 2px solid #4361ee; border-radius: 10px; display: inline-block; font-size: 1.15rem; font-weight: 700; letter-spacing: 0.5px; box-shadow: 0 0 12px rgba(67, 97, 238, 0.4); text-align: center;">
    🌐 LINK SISTEM UTAMA: <a href="https://apply-leave-89ebb.web.app" style="color: #7dd3fc; text-decoration: none; border-bottom: 1.5px solid #7dd3fc;">https://apply-leave-89ebb.web.app</a>
  </div>
  <div class="meta">
    <span><strong>Versi</strong>3.0</span>
    <span><strong>Tarikh</strong>Jun 2026</span>
    <span><strong>Platform</strong>Web / PWA</span>
    <span><strong>Bahasa</strong>Bahasa Malaysia</span>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════════ TOC -->
<div class="toc-page">
  <h2>📋 Isi Kandungan</h2>

  <div class="toc-section-label">Permulaan</div>
  <div class="toc-item"><span class="num">1</span><span class="title">Pengenalan Sistem</span></div>
  <div class="toc-item"><span class="num">2</span><span class="title">Log Masuk &amp; Log Keluar</span></div>
  <div class="toc-item"><span class="num">3</span><span class="title">Peranan &amp; Hak Akses (RBAC)</span></div>

  <div class="toc-section-label">Penggunaan Harian</div>
  <div class="toc-item"><span class="num">4</span><span class="title">Dashboard</span></div>
  <div class="toc-item"><span class="num">5</span><span class="title">Permohonan Cuti Baru</span></div>
  <div class="toc-item"><span class="num">6</span><span class="title">Jenis-Jenis Cuti &amp; Kelayakan</span></div>
  <div class="toc-item"><span class="num">7</span><span class="title">Aliran Kelulusan (2 Peringkat / 3 Peringkat untuk Balok)</span></div>
  <div class="toc-item"><span class="num">8</span><span class="title">Modul Kelulusan (Pending Approvals)</span></div>

  <div class="toc-section-label">Pentadbiran</div>
  <div class="toc-item"><span class="num">9</span><span class="title">Pengurusan Staf</span></div>
  <div class="toc-item"><span class="num">10</span><span class="title">Pengurusan Cawangan</span></div>
  <div class="toc-item"><span class="num">11</span><span class="title">Laporan Cuti</span></div>
  <div class="toc-item"><span class="num">12</span><span class="title">Audit Log &amp; Keselamatan</span></div>
  <div class="toc-item"><span class="num">13</span><span class="title">Tetapan &amp; Kata Laluan</span></div>
  <div class="toc-item"><span class="num">14</span><span class="title">Notifikasi WhatsApp</span></div>
  <div class="toc-item"><span class="num">15</span><span class="title">Polisi Cuti &amp; Soalan Lazim</span></div>

  <div class="toc-section-label">Komunikasi</div>
  <div class="toc-item"><span class="num">16</span><span class="title">Messenger — Mesej &amp; Perkongsian Fail</span></div>
  <div class="toc-item"><span class="num">17</span><span class="title">Peringatan Automatik WhatsApp — Kelulusan Tertangguh</span></div>

  <div class="toc-section-label">Pentadbiran Lanjutan</div>
  <div class="toc-item"><span class="num">18</span><span class="title">Permohonan Pendaftaran Staf Baru</span></div>
  <div class="toc-item"><span class="num">19</span><span class="title">Log Masuk Audit (Login Security)</span></div>
  <div class="toc-item"><span class="num">20</span><span class="title">Rekod Locum</span></div>
  <div class="toc-item"><span class="num">21</span><span class="title">Matrix Laluan Kelulusan (Routing)</span></div>
  <div class="toc-item"><span class="num">22</span><span class="title">Kawalan Akses RBAC</span></div>
  <div class="toc-item"><span class="num">23</span><span class="title">Pengurusan Peranan &amp; Kategori</span></div>

  <div class="toc-section-label">Peranan Baru</div>
  <div class="toc-item"><span class="num">24</span><span class="title">Peranan Paramedik — Juru X-Ray, Sonographer &amp; Juru Audio</span></div>

  <div class="toc-section-label">Keselamatan</div>
  <div class="toc-item"><span class="num">25</span><span class="title">Amaran Log Masuk Pertama &amp; Tukar Kata Laluan</span></div>
</div>

<!-- ═══════════════════════════════════════════════════════════ SEC 1 -->
<div class="section">
  <div class="section-header">
    <div class="section-num">1</div>
    <div class="section-title">Pengenalan Sistem</div>
  </div>

  <p><strong>KSB Leave Apply</strong> adalah sistem pengurusan cuti berasaskan web (Progressive Web App) yang direka khas untuk semua staf <strong>Klinik Syed Badaruddin (KSB)</strong>. Sistem ini menggantikan proses permohonan cuti manual dengan aliran digital yang selamat, pantas dan telus.</p>

  <h3>Fungsi Utama</h3>
  <ul>
    <li>Permohonan cuti secara digital oleh staf</li>
    <li>Kelulusan dua peringkat — HOD/PIC/Supervisor (Peringkat 1) kemudian HR/Admin (Peringkat 2)</li>
    <li><strong>Khas Balok:</strong> Tiga peringkat — Team Leader (Peringkat 0) → Supervisor (Peringkat 1) → HR/Admin (Peringkat 2)</li>
    <li>Notifikasi WhatsApp automatik kepada semua pihak berkaitan</li>
    <li>Rekod cuti, baki dan statistik secara masa nyata</li>
    <li>Pengurusan staf, cawangan, laporan dan audit log</li>
  </ul>

  <div class="callout info">
    <span class="callout-icon">🌐</span>
    <div><strong>URL Sistem:</strong> https://apply-leave-89ebb.web.app<br>
    <strong>Pelayar disokong:</strong> Chrome, Safari, Edge, Firefox (versi terkini)</div>
  </div>

  <h3>Pasang sebagai Aplikasi Mudah Alih (PWA)</h3>
  <p>Sistem boleh dipasang terus pada skrin utama telefon pintar tanpa memuat turun dari App Store:</p>
  <ul>
    <li><strong>Android (Chrome):</strong> Menu → "Tambah ke Skrin Utama"</li>
    <li><strong>iPhone (Safari):</strong> Ikon kongsi → "Add to Home Screen"</li>
  </ul>

  ${imgTag(shots.login, 'Halaman Log Masuk Sistem KSB Leave Apply')}
</div>

<!-- ═══════════════════════════════════════════════════════════ SEC 2 -->
<div class="section">
  <div class="section-header">
    <div class="section-num">2</div>
    <div class="section-title">Log Masuk &amp; Log Keluar</div>
  </div>

  <div style="background: linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%); border: 2.5px dashed #3b82f6; border-radius: 12px; padding: 18px; margin: 18px 0; text-align: center; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.15);">
    <span style="font-size: 9pt; text-transform: uppercase; letter-spacing: 1.5px; color: #93c5fd; font-weight: bold; display: block; margin-bottom: 6px;">URL AKSES UTAMA SISTEM (LINK)</span>
    <a href="https://apply-leave-89ebb.web.app" style="font-size: 1.45rem; font-weight: 800; color: #fff; text-decoration: none; letter-spacing: 0.5px; border-bottom: 2px solid #60a5fa; word-break: break-all;">https://apply-leave-89ebb.web.app</a>
    <span style="font-size: 8.5pt; color: #cbd5e1; display: block; margin-top: 8px;">(Sila simpan link ini di bookmark pelayar atau "Add to Home Screen" telefon anda)</span>
  </div>

  <div class="callout warning" style="background: #fffbeb; border: 2.5px solid #f59e0b; border-left: 8px solid #d97706; border-radius: 10px; padding: 16px; margin: 16px 0; color: #78350f; box-shadow: 0 4px 12px rgba(245, 158, 11, 0.12); display: flex; gap: 12px; align-items: flex-start;">
    <span style="font-size: 20pt; line-height: 1;">🔐</span>
    <div>
      <strong style="font-size: 11pt; color: #b45309; display: block; margin-bottom: 4px; text-transform: uppercase;">⚠️ MAKLUMAN PENTING: TUKAR KATA LALUAN SELEPAS LOG MASUK PERTAMA!</strong>
      <p style="margin: 0; font-size: 9.2pt; line-height: 1.45;">
        Demi keselamatan akaun anda, anda <strong>WAJIB menukar kata laluan lalai</strong> (nombor IC anda) sejurus selepas log masuk kali pertama:
      </p>
      <ol style="margin: 6px 0 6px 20px; font-size: 9.2pt; font-weight: bold;">
        <li>Pergi ke menu <strong>Settings</strong> (ikon gear) dari bar navigasi.</li>
        <li>Pilih sub-menu <strong>Security (Keselamatan)</strong>.</li>
        <li>Masukkan kata laluan semasa (nombor IC anda).</li>
        <li>Masukkan kata laluan baharu pilihan anda dan klik butang <strong>"Tukar Kata Laluan"</strong>.</li>
      </ol>
      <span style="font-size: 8.5pt; color: #92400e; font-style: italic; display: block;">* Sila simpan kata laluan baharu anda dengan selamat.</span>
    </div>
  </div>

  <h3>Cara Log Masuk</h3>
  <div class="steps">
    <div class="step"><div class="step-num">1</div><div class="step-body"><strong>Pilih Cawangan</strong> dari senarai dropdown "Pilih Cawangan Anda"</div></div>
    <div class="step"><div class="step-num">2</div><div class="step-body"><strong>Taip nama</strong> dalam kotak carian — senarai nama akan muncul automatik</div></div>
    <div class="step"><div class="step-num">3</div><div class="step-body"><strong>Klik nama</strong> anda dari senarai yang terpapar</div></div>
    <div class="step"><div class="step-num">4</div><div class="step-body"><strong>Masukkan Kata Laluan</strong> (untuk kali pertama, kata laluan asal ialah nombor IC anda tanpa tanda "-")</div></div>
    <div class="step"><div class="step-num">5</div><div class="step-body"><strong>Tekan LOG MASUK</strong></div></div>
  </div>

  <h3>Lupa Kata Laluan</h3>
  <p>Pilih cawangan dan nama anda terlebih dahulu, kemudian tekan pautan <strong>"Lupa Kata Laluan?"</strong>. Sistem akan menghantar kata laluan ke nombor WhatsApp anda yang berdaftar.</p>

  <div class="callout warning">
    <span class="callout-icon">⚠️</span>
    <div>Jika nombor WhatsApp anda belum didaftarkan dalam sistem, hubungi HR/Admin secara terus untuk mendapatkan kata laluan anda.</div>
  </div>

  <h3>Log Keluar</h3>
  <ul>
    <li>Tekan butang <strong>"Log Keluar"</strong> di bahagian atas skrin</li>
    <li>Sistem log keluar automatik selepas <strong>30 minit</strong> tidak aktif</li>
    <li>Sesi hanya boleh aktif pada <strong>satu pelayar/tab</strong> pada satu masa</li>
  </ul>

  <div class="callout danger">
    <span class="callout-icon">🔐</span>
    <div><strong>Keselamatan:</strong> Jangan kongsikan kata laluan anda. Tukar kata laluan segera selepas log masuk pertama melalui <em>Tetapan → Keselamatan</em>.</div>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════════ SEC 3 -->
<div class="section">
  <div class="section-header">
    <div class="section-num">3</div>
    <div class="section-title">Peranan &amp; Hak Akses (RBAC)</div>
  </div>

  <p>Sistem menggunakan <strong>Role-Based Access Control (RBAC)</strong> — setiap peranan mempunyai hak akses yang berbeza dan boleh dikonfigurasi oleh Super Admin.</p>

  <h3>Jadual Hak Akses</h3>
  <table>
    <thead>
      <tr>
        <th>Peranan</th>
        <th class="center">Dashboard</th>
        <th class="center">Mohon Cuti</th>
        <th class="center">Luluskan</th>
        <th class="center">Urus Staf</th>
        <th class="center">Laporan</th>
        <th class="center">Audit</th>
        <th class="center">Messenger</th>
        <th class="center">RBAC</th>
      </tr>
    </thead>
    <tbody>
      <tr><td><span class="badge badge-purple">Super Admin</span></td><td class="center">Analisa</td><td class="center">✓</td><td class="center">✓ (Semua)</td><td class="center">✓</td><td class="center">✓</td><td class="center">✓</td><td class="center">✓</td><td class="center">✓</td></tr>
      <tr><td><span class="badge badge-blue">Admin</span></td><td class="center">Analisa</td><td class="center">✓</td><td class="center">✓ (Semua)</td><td class="center">✓</td><td class="center">✓</td><td class="center">✓</td><td class="center">✓</td><td class="center">—</td></tr>
      <tr><td><span class="badge badge-green">HR</span></td><td class="center">Staff</td><td class="center">✓</td><td class="center">✓ (Semua)</td><td class="center">✓</td><td class="center">—</td><td class="center">—</td><td class="center">✓</td><td class="center">—</td></tr>
      <tr><td><span class="badge badge-amber">HOD</span></td><td class="center">Staff</td><td class="center">✓</td><td class="center">✓ (Ptgkt 1)</td><td class="center">—</td><td class="center">—</td><td class="center">—</td><td class="center">✓</td><td class="center">—</td></tr>
      <tr><td><span class="badge badge-amber">PIC/HOD</span></td><td class="center">Staff</td><td class="center">✓</td><td class="center">✓ (Ptgkt 1)</td><td class="center">—</td><td class="center">—</td><td class="center">—</td><td class="center">✓</td><td class="center">—</td></tr>
      <tr><td><span class="badge badge-amber">Supervisor</span></td><td class="center">Staff</td><td class="center">✓</td><td class="center">✓ (Ptgkt 1)</td><td class="center">—</td><td class="center">—</td><td class="center">—</td><td class="center">✓</td><td class="center">—</td></tr>
      <tr><td><span class="badge badge-red">Team Leader</span></td><td class="center">Staff</td><td class="center">✓</td><td class="center">✓ (Ptgkt 0)</td><td class="center">—</td><td class="center">—</td><td class="center">—</td><td class="center">✓</td><td class="center">—</td></tr>
      <tr><td><span class="badge badge-gray">Staff</span></td><td class="center">Staff</td><td class="center">✓</td><td class="center">—</td><td class="center">—</td><td class="center">—</td><td class="center">—</td><td class="center">✓</td><td class="center">—</td></tr>
    </tbody>
  </table>

  <h3>Penerangan Peranan</h3>
  <table>
    <thead><tr><th>Peranan</th><th>Penerangan</th></tr></thead>
    <tbody>
      <tr><td><strong>Super Admin</strong></td><td>Akses penuh — termasuk konfigurasi RBAC dan token WhatsApp</td></tr>
      <tr><td><strong>Admin</strong></td><td>Pengurusan penuh kecuali konfigurasi WhatsApp</td></tr>
      <tr><td><strong>HR</strong></td><td>Kelulusan akhir semua cuti, pengurusan staf dan cawangan</td></tr>
      <tr><td><strong>HOD</strong></td><td>Ketua Jabatan — luluskan cuti Peringkat 1 cawangan sendiri</td></tr>
      <tr><td><strong>PIC/HOD</strong></td><td>Penolong Ketua — kuasa sama seperti HOD</td></tr>
      <tr><td><strong>Supervisor</strong></td><td>Penyelia — Peringkat 1 khusus untuk Balok HQ (selepas TL) &amp; Doktor Pahang</td></tr>
      <tr><td><strong>Team Leader</strong></td><td><strong>Peringkat 0 (Balok sahaja)</strong> — menyokong permohonan cuti Staff Operasi Balok sebelum ke Supervisor</td></tr>
      <tr><td><strong>Staff</strong></td><td>Hanya boleh membuat dan melihat permohonan cuti sendiri</td></tr>
      <tr><td><strong>Juru X-Ray</strong></td><td>Paramedik Pengimejan — mohon cuti melalui Supervisor Balok (Balok sahaja)</td></tr>
      <tr><td><strong>Sonographer</strong></td><td>Paramedik Ultrasound — mohon cuti melalui Supervisor Balok (Balok sahaja)</td></tr>
      <tr><td><strong>Juru Audio</strong></td><td>Paramedik Audiologi — mohon cuti melalui HOD (Balok sahaja)</td></tr>
    </tbody>
  </table>
</div>

<!-- ═══════════════════════════════════════════════════════════ SEC 4 -->
<div class="section">
  <div class="section-header">
    <div class="section-num">4</div>
    <div class="section-title">Dashboard</div>
  </div>

  ${imgTag(shots.dashboard, 'Dashboard Analisa — Paparan Admin/Super Admin')}

  <h3>Dashboard Staf</h3>
  <p>Dipaparkan kepada Staff, HOD, PIC, Supervisor dan HR:</p>
  <ul>
    <li><strong>Kad Profil</strong> — nama, cawangan, kategori dan tempoh perkhidmatan</li>
    <li><strong>Kad AL (Annual Leave)</strong> — baki AL semasa dengan pecahan terperinci: <em>Bawa Lepas (CF) | Peruntukan Tahun Ini | Digunakan | Pelarasan HR</em> <span class="badge badge-green">BAHARU</span></li>
    <li><strong>Kad MC</strong> — baki Medical Leave dengan bar progres</li>
    <li><strong>Rekod Cuti Saya</strong> — semua permohonan dengan penapis status</li>
    <li><strong>Tab Tertangguh</strong> — permohonan menunggu tindakan anda (pelulus sahaja)</li>
  </ul>

  <h3>Dashboard Analisa</h3>
  <p>Dipaparkan kepada Admin dan Super Admin:</p>
  <ul>
    <li><strong>Carta Bar Bulanan</strong> — jumlah cuti mengikut bulan (AL, MC, EL)</li>
    <li><strong>Carta Donut</strong> — pecahan jenis cuti sepanjang tahun</li>
    <li><strong>Statistik Staf</strong> — baki AL dan MC semua staf</li>
    <li>Klik pada bulan dalam carta untuk melihat rekod terperinci</li>
  </ul>
</div>

<!-- ═══════════════════════════════════════════════════════════ SEC 5 -->
<div class="section">
  <div class="section-header">
    <div class="section-num">5</div>
    <div class="section-title">Permohonan Cuti Baru</div>
  </div>

  <div class="ss-row">
    ${imgTag(shots.applyLeave, 'Borang Permohonan Cuti — Bahagian Atas')}
    ${imgTag(shots.applyLeaveBottom, 'Borang Permohonan Cuti — Pelulus &amp; Aliran Kelulusan')}
  </div>

  <h3>Langkah-Langkah Permohonan</h3>
  <div class="steps">
    <div class="step"><div class="step-num">1</div><div class="step-body"><strong>Pilih Jenis Cuti</strong> dari senarai kad yang terpapar</div></div>
    <div class="step"><div class="step-num">2</div><div class="step-body"><strong>Pilih Tarikh Mula dan Tarikh Tamat</strong> (sistem kira hari bekerja automatik)</div></div>
    <div class="step"><div class="step-num">3</div><div class="step-body"><strong>Tandakan "Separuh Hari"</strong> jika perlu (0.5 hari)</div></div>
    <div class="step"><div class="step-num">4</div><div class="step-body"><strong>Pilih Pelulus</strong> — sistem tunjuk senarai berdasarkan kategori anda. <strong>Staff Operasi Balok:</strong> wajib pilih Team Leader (Peringkat 0) dahulu, Supervisor (Peringkat 1) ditetapkan automatik</div></div>
    <div class="step"><div class="step-num">5</div><div class="step-body"><strong>Masukkan Catatan/Sebab</strong> permohonan (pilihan)</div></div>
    <div class="step"><div class="step-num">6</div><div class="step-body"><strong>Muat naik Dokumen</strong> jika diperlukan (MC wajib lampirkan sijil)</div></div>
    <div class="step"><div class="step-num">7</div><div class="step-body"><strong>Tekan HANTAR PERMOHONAN</strong></div></div>
  </div>

  <h3>Pemilihan Pelulus Mengikut Kategori & Cawangan</h3>
  <table>
    <thead><tr><th>Kategori Staf</th><th>Cawangan</th><th>Peringkat 0</th><th>Peringkat 1</th><th>Peringkat 2</th></tr></thead>
    <tbody>
      <tr style="background:#fff0f0;"><td><strong>Staff Operasi</strong></td><td><strong>Balok HQ</strong></td><td><strong style="color:#dc2626;">Team Leader (WAJIB)</strong></td><td>Supervisor — Balok HQ</td><td>HR / Admin</td></tr>
      <tr><td>Doktor</td><td>Pahang (kecuali MCKIP &amp; Bentong)</td><td>—</td><td>Supervisor — Balok HQ</td><td>HR / Admin</td></tr>
      <tr><td>Doktor</td><td>MCKIP / Bentong</td><td>—</td><td>HOD / PIC_HOD cawangan sendiri</td><td>HR / Admin</td></tr>
      <tr><td>Doktor</td><td>Terengganu</td><td>—</td><td>HOD / PIC_HOD cawangan sendiri</td><td>—</td></tr>
      <tr><td>Staff Admin</td><td>Pahang</td><td>—</td><td>HOD klinik → (tiada: PIC)</td><td>HR / Admin</td></tr>
      <tr><td>Staff Admin</td><td>Terengganu</td><td>—</td><td>HOD klinik → (tiada: PIC)</td><td>—</td></tr>
      <tr><td>Staff Operasi</td><td>Cawangan lain</td><td>—</td><td>Doctor PIC cawangan sendiri</td><td>HR / Admin</td></tr>
    </tbody>
  </table>
  <div class="callout danger">
    <span class="callout-icon">⚠️</span>
    <div><strong>Staff Operasi Balok sahaja:</strong> Mesti pilih Team Leader (TL) ketika mengisi borang permohonan. Permohonan TIDAK akan diteruskan ke Supervisor jika TL tidak dipilih. TL menyokong dahulu (Peringkat 0), kemudian baru Supervisor menilai (Peringkat 1), akhirnya HR/Admin (Peringkat 2).</div>
  </div>

  <h3>Status Permohonan</h3>
  <table>
    <thead><tr><th>Status</th><th>Maksud</th></tr></thead>
    <tbody>
      <tr><td><span class="chip chip-pending">PENDING</span></td><td>Menunggu sokongan Peringkat 0 (TL — Balok sahaja) atau Peringkat 1 (HOD / PIC / Supervisor)</td></tr>
      <tr><td><span class="chip" style="background:#fce7f3;color:#9d174d;">TL APPROVED</span></td><td><strong>Khas Balok:</strong> Team Leader telah menyokong — menunggu penilaian Supervisor (Peringkat 1)</td></tr>
      <tr><td><span class="chip chip-hod">HOD APPROVED</span></td><td>Diluluskan Peringkat 1 — menunggu kelulusan akhir HR / Admin (Peringkat 2)</td></tr>
      <tr><td><span class="chip chip-approved">APPROVED</span></td><td>Diluluskan sepenuhnya — cuti SAH dan dikira dalam rekod</td></tr>
      <tr><td><span class="chip chip-rejected">REJECTED</span></td><td>Ditolak oleh pelulus — staf menerima notifikasi WhatsApp</td></tr>
      <tr><td><span class="chip chip-cancelled">CANCELLED</span></td><td>Dibatalkan oleh staf atau HOD / HR sebelum kelulusan akhir</td></tr>
    </tbody>
  </table>

  <h3>Polisi Notis Awal Permohonan AL</h3>
  <table>
    <thead><tr><th>Kategori Staf</th><th>Notis Minimum</th><th>Dikecualikan</th></tr></thead>
    <tbody>
      <tr><td>Staff Admin</td><td><strong>3 hari</strong> bekerja sebelum tarikh cuti</td><td>MC, EL, EL_EMG</td></tr>
      <tr><td>Doktor, Staff Operasi &amp; lain</td><td><strong>7 hari</strong> bekerja sebelum tarikh cuti</td><td>MC, EL, EL_EMG</td></tr>
    </tbody>
  </table>
  <div class="callout warning">
    <span class="callout-icon">⏰</span>
    <div>Permohonan AL yang tidak mematuhi notis minimum akan <strong>ditolak secara automatik</strong> oleh sistem semasa penghantaran. MC dan cuti kecemasan (EL / EL_EMG) dikecualikan daripada polisi ini.</div>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════════ SEC 6 -->
<div class="section">
  <div class="section-header">
    <div class="section-num">6</div>
    <div class="section-title">Jenis-Jenis Cuti &amp; Kelayakan</div>
  </div>

  <table>
    <thead><tr><th>Kod</th><th>Nama</th><th>Kelayakan</th><th>Penerangan</th></tr></thead>
    <tbody>
      <tr><td><strong>AL</strong></td><td>Annual Leave</td><td>8–16 hari</td><td>Cuti tahunan, dikira pro-rata ikut tempoh berkhidmat</td></tr>
      <tr><td><strong>MC</strong></td><td>Medical Leave</td><td>14 hari/tahun</td><td>Cuti sakit — wajib lampirkan sijil doktor</td></tr>
      <tr><td><strong>EL</strong></td><td>Emergency / Compassionate</td><td>3 hari</td><td>Kematian ahli keluarga terdekat</td></tr>
      <tr><td><strong>EL_EMG</strong></td><td>Emergency (Non-Ehsan)</td><td>—</td><td>Kecemasan am (bukan kematian)</td></tr>
      <tr><td><strong>UP</strong></td><td>Unpaid Leave (UL)</td><td>—</td><td>Cuti tanpa gaji selepas baki AL habis</td></tr>
      <tr><td><strong>HL</strong></td><td>Hospitalization</td><td>60 hari</td><td>Cuti wad / hospitalisasi dengan surat hospital</td></tr>
      <tr><td><strong>ML</strong></td><td>Maternity Leave</td><td>98 hari</td><td>Cuti bersalin untuk staf wanita</td></tr>
      <tr><td><strong>PL</strong></td><td>Paternity Leave</td><td>7 hari</td><td>Cuti paterniti untuk staf lelaki</td></tr>
      <tr><td><strong>CME</strong></td><td>CME Leave</td><td>5 hari</td><td>Pendidikan perubatan berterusan — Doktor sahaja</td></tr>
      <tr><td><strong>UP_MC</strong></td><td>Unpaid MC</td><td>—</td><td>MC tanpa gaji bila kelayakan MC habis</td></tr>
      <tr><td><strong>NPL</strong></td><td>No-Pay Leave</td><td>—</td><td>Cuti tanpa gaji panjang / khas</td></tr>
      <tr><td><strong>REPLACEMENT</strong></td><td>Replacement Leave</td><td>—</td><td>Gantian hari bekerja semasa cuti umum / off-day</td></tr>
    </tbody>
  </table>

  <h3>Kelayakan Annual Leave (AL) Mengikut Tempoh Berkhidmat</h3>
  <table>
    <thead><tr><th>Tempoh Perkhidmatan</th><th>Kelayakan AL Setahun</th></tr></thead>
    <tbody>
      <tr><td>Kurang 2 tahun</td><td>8 hari</td></tr>
      <tr><td>2 – 5 tahun</td><td>12 hari</td></tr>
      <tr><td>Lebih 5 tahun</td><td>16 hari</td></tr>
    </tbody>
  </table>

  <div class="callout info">
    <span class="callout-icon">ℹ️</span>
    <div>AL dikira secara <strong>pro-rata</strong> mengikut bilangan bulan bekerja dalam tahun semasa bagi staf baru.</div>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════════ SEC 7 -->
<div class="section">
  <div class="section-header">
    <div class="section-num">7</div>
    <div class="section-title">Aliran Kelulusan (2 Peringkat / 3 Peringkat untuk Balok)</div>
  </div>

  <p>Sistem mempunyai dua jenis aliran kelulusan bergantung pada cawangan dan kategori staf:</p>

  <!-- ── Aliran A: Op Balok — 3 peringkat ── -->
  <h3 style="color:#dc2626;">A. Aliran Kelulusan KHAS — Staff Operasi Balok HQ (3 Peringkat)</h3>
  <p>Hanya untuk <strong>Staff Operasi di Klinik Syed Badaruddin Balok (HQ)</strong>. Permohonan mesti melalui <strong>tiga peringkat</strong> sebelum dikira sah:</p>

  <div class="flow">
    <div class="flow-box">📝 STAFF OPERASI BALOK MEMOHON CUTI<br><small style="font-weight:400">Status: PENDING — WA dihantar kepada TL yang dipilih</small></div>
    <div class="flow-arrow">↓</div>
    <div class="flow-box" style="background:#fef2f2;border-color:#dc2626;color:#7f1d1d;">🔴 PERINGKAT 0 — Sokongan Team Leader (TL)<br><small style="font-weight:400">Team Leader Balok yang dipilih semasa mengisi borang</small></div>
    <div class="flow-arrow">↓</div>
    <div class="flow-label">Status: TL APPROVED — WA dihantar kepada Supervisor Balok</div>
    <div class="flow-arrow">↓</div>
    <div class="flow-box amber">⏰ PERINGKAT 1 — Penilaian Supervisor<br><small style="font-weight:400">Supervisor Klinik Syed Badaruddin Balok HQ</small></div>
    <div class="flow-arrow">↓</div>
    <div class="flow-label">Status: HOD APPROVED — WA dihantar kepada HR/Admin</div>
    <div class="flow-arrow">↓</div>
    <div class="flow-box green">✅ PERINGKAT 2 — Kelulusan Akhir HR/Admin<br><small style="font-weight:400">HR / Admin KSB</small></div>
    <div class="flow-arrow">↓</div>
    <div class="flow-box final">🎉 APPROVED — CUTI SAH<br><small style="font-weight:400">WA dihantar kepada pemohon</small></div>
  </div>

  <div class="callout danger">
    <span class="callout-icon">⚠️</span>
    <div><strong>PENTING — Staff Operasi Balok:</strong> Team Leader (TL) WAJIB dipilih semasa mengisi borang permohonan. Permohonan tidak dapat diteruskan tanpa pemilihan TL. Supervisor hanya akan menerima permohonan <em>selepas</em> TL menyokong.</div>
  </div>

  <!-- ── Aliran B: Semua lain — 2 peringkat ── -->
  <h3 style="color:#4361ee;">B. Aliran Kelulusan Biasa — Semua Staf Lain (2 Peringkat)</h3>
  <p>Untuk semua staf selain Staff Operasi Balok:</p>

  <div class="flow">
    <div class="flow-box">📝 STAF MEMOHON CUTI<br><small style="font-weight:400">Status: PENDING — WA dihantar kepada Pelulus Peringkat 1</small></div>
    <div class="flow-arrow">↓</div>
    <div class="flow-box amber">⏰ PERINGKAT 1 — Sokongan<br><small style="font-weight:400">HOD / PIC_HOD / Supervisor / Doctor PIC</small></div>
    <div class="flow-arrow">↓</div>
    <div class="flow-label">Status: HOD APPROVED — WA dihantar kepada HR/Admin</div>
    <div class="flow-arrow">↓</div>
    <div class="flow-box green">✅ PERINGKAT 2 — Kelulusan Akhir<br><small style="font-weight:400">HR / Admin</small></div>
    <div class="flow-arrow">↓</div>
    <div class="flow-box final">🎉 APPROVED — CUTI SAH<br><small style="font-weight:400">Notifikasi dihantar kepada pemohon</small></div>
  </div>

  <h3>Jadual Ringkas Aliran Mengikut Kategori</h3>
  <table>
    <thead><tr><th>Kategori</th><th>Cawangan</th><th>Peringkat 0</th><th>Peringkat 1</th><th>Peringkat 2</th></tr></thead>
    <tbody>
      <tr style="background:#fef2f2;"><td><strong>Staff Operasi</strong></td><td><strong>Balok HQ</strong></td><td><strong style="color:#dc2626;">Team Leader ★</strong></td><td>Supervisor Balok HQ</td><td>HR / Admin</td></tr>
      <tr><td>Doktor</td><td>Pahang (kec. MCKIP &amp; Bentong)</td><td>—</td><td>Supervisor Balok HQ</td><td>HR / Admin</td></tr>
      <tr><td>Doktor</td><td>MCKIP / Bentong / lain</td><td>—</td><td>HOD / PIC_HOD sendiri</td><td>HR / Admin</td></tr>
      <tr><td>Doktor</td><td>Terengganu</td><td>—</td><td>HOD / PIC_HOD sendiri</td><td>— (tidak diperlukan)</td></tr>
      <tr><td>Staff Admin</td><td>Pahang / Semua</td><td>—</td><td>HOD → (tiada: PIC)</td><td>HR / Admin</td></tr>
      <tr><td>Staff Admin</td><td>Terengganu</td><td>—</td><td>HOD → (tiada: PIC)</td><td>— (tidak diperlukan)</td></tr>
      <tr><td>Staff Operasi</td><td>Cawangan lain</td><td>—</td><td>Doctor PIC cawangan</td><td>HR / Admin</td></tr>
    </tbody>
  </table>
  <p style="font-size:0.8rem;color:#64748b;">★ Peringkat 0 adalah <strong>eksklusif untuk Staff Operasi Balok HQ</strong> sahaja.</p>

  <div class="callout warning">
    <span class="callout-icon">⚡</span>
    <div><strong>Bypass oleh HR/Admin:</strong> HR/Admin boleh meluluskan terus walaupun Peringkat 1 belum selesai. Walau bagaimanapun, untuk permohonan Staff Operasi Balok yang masih TL APPROVED (belum Supervisor), HR/Admin tidak boleh bypass — mesti tunggu Supervisor lulus dahulu.</div>
  </div>

  <h3>Keperluan Locum (Doktor Sahaja)</h3>
  <p>Untuk semua cuti doktor, maklumat <strong>Doktor Locum</strong> wajib diisi oleh HOD/PIC dalam sistem sebelum kelulusan akhir boleh diberikan:</p>
  <ul>
    <li>Nama doktor locum</li>
    <li>Tarikh dan masa penggantian</li>
  </ul>
</div>

<!-- ═══════════════════════════════════════════════════════════ SEC 8 -->
<div class="section">
  <div class="section-header">
    <div class="section-num">8</div>
    <div class="section-title">Modul Kelulusan (Pending Approvals)</div>
  </div>

  ${imgTag(shots.pending, 'Modul Kelulusan — Senarai Permohonan Tertangguh')}

  <p>Modul ini hanya kelihatan kepada <span class="badge badge-red">Team Leader</span> <span class="badge badge-amber">HOD</span> <span class="badge badge-amber">PIC/HOD</span> <span class="badge badge-amber">Supervisor</span> <span class="badge badge-green">HR</span> <span class="badge badge-blue">Admin</span></p>

  <h3>Tindakan Mengikut Peranan</h3>
  <table>
    <thead><tr><th>Peranan</th><th>Status Permohonan</th><th>Butang Tindakan</th><th>Kesan</th></tr></thead>
    <tbody>
      <tr style="background:#fef2f2;"><td><strong>Team Leader</strong><br><small>(Balok sahaja)</small></td><td>PENDING</td><td>Sokong (Peringkat 0)</td><td>Status → <strong>TL APPROVED</strong>. WA dihantar kepada Supervisor Balok</td></tr>
      <tr><td>Supervisor<br><small>(Balok — selepas TL)</small></td><td>TL APPROVED</td><td>Nilai &amp; Luluskan (Peringkat 1)</td><td>Status → HOD APPROVED. WA dihantar kepada HR/Admin</td></tr>
      <tr><td>HOD / PIC / Supervisor<br><small>(Staf lain)</small></td><td>PENDING</td><td>Sokong &amp; Hantar ke HR/Admin</td><td>Status → HOD APPROVED</td></tr>
      <tr><td>HR / Admin</td><td>HOD APPROVED</td><td>Luluskan Akhir (Peringkat 2)</td><td>Status → APPROVED</td></tr>
      <tr><td>HR / Admin</td><td>PENDING</td><td>Luluskan Terus (Bypass)</td><td>Status → APPROVED (dengan pengesahan)</td></tr>
    </tbody>
  </table>

  <div class="callout danger">
    <span class="callout-icon">🔴</span>
    <div><strong>HR/Admin tidak boleh bypass TL APPROVED:</strong> Untuk permohonan Staff Operasi Balok yang berstatus TL APPROVED, HR/Admin tidak boleh meluluskan terus — mesti tunggu Supervisor Balok lulus (Peringkat 1) dahulu baru boleh bagi kelulusan akhir.</div>
  </div>

  <h3>Penunjuk Peringkat (Badge Warna)</h3>
  <ul>
    <li><strong>Badge Merah Jambu</strong> — TL APPROVED: Menunggu penilaian Supervisor (khas Balok)</li>
    <li><strong>Badge Kuning</strong> — Peringkat 1: Menunggu sokongan HOD/PIC_HOD/Supervisor</li>
    <li><strong>Badge Hijau</strong> — Peringkat 2: Menunggu kelulusan akhir HR/Admin</li>
  </ul>

  <h3>Cetak Borang Cuti</h3>
  <p>Tekan ikon pencetak (🖨️) pada mana-mana kad permohonan untuk mencetak borang cuti rasmi KSB dalam format A4.</p>
</div>

<!-- ═══════════════════════════════════════════════════════════ SEC 9 -->
<div class="section">
  <div class="section-header">
    <div class="section-num">9</div>
    <div class="section-title">Pengurusan Staf</div>
  </div>

  ${imgTag(shots.staff, 'Modul Pengurusan Staf')}

  <p>Hanya boleh diakses oleh <span class="badge badge-green">HR</span> <span class="badge badge-blue">Admin</span> <span class="badge badge-purple">Super Admin</span></p>

  <h3>Tambah Staf Baru</h3>
  <div class="steps">
    <div class="step"><div class="step-num">1</div><div class="step-body">Tekan butang <strong>"+ Tambah Staf"</strong></div></div>
    <div class="step"><div class="step-num">2</div><div class="step-body">Isi maklumat: Nama, IC, Cawangan, Kategori, Peranan, Telefon, Tarikh Mula</div></div>
    <div class="step"><div class="step-num">3</div><div class="step-body">Tekan <strong>SIMPAN</strong></div></div>
  </div>

  <div class="callout info">
    <span class="callout-icon">🔑</span>
    <div><strong>Kata laluan awal</strong> staf baru = Nombor IC mereka. Staf perlu tukar kata laluan sendiri selepas log masuk pertama.</div>
  </div>

  <h3>Maklumat yang Boleh Diisi</h3>
  <table>
    <thead><tr><th>Medan</th><th>Penerangan</th></tr></thead>
    <tbody>
      <tr><td>Nama Penuh</td><td>Nama seperti dalam IC</td></tr>
      <tr><td>Nombor IC</td><td>Digunakan sebagai ID unik dan kata laluan awal</td></tr>
      <tr><td>Cawangan</td><td>Klinik/cawangan staf bertugas</td></tr>
      <tr><td>Kategori</td><td>Admin Staff / Operation Staff / Doctor</td></tr>
      <tr><td>Peranan</td><td>Staff / HOD / PIC_HOD / Supervisor / HR / Admin / Super Admin</td></tr>
      <tr><td>Nombor Telefon</td><td>Untuk notifikasi WhatsApp (format: 601xxxxxxxx)</td></tr>
      <tr><td>Tarikh Mula</td><td>Tarikh mula berkhidmat — digunakan untuk kira baki AL</td></tr>
    </tbody>
  </table>

  <h3>Nyahaktifkan Staf</h3>
  <p>Togol "Staf Tidak Aktif" untuk menyembunyikan staf yang telah berhenti. Staf tidak aktif tidak dapat log masuk tetapi rekod cuti mereka kekal tersimpan.</p>

  <hr class="divider">

  <h3>Kemaskini Profil &amp; Baki Cuti</h3>
  <p>Klik ikon edit pada kad staf untuk membuka modal <strong>Kemaskini Profil &amp; Baki Cuti</strong>. Modal ini mengandungi dua baris dalam bahagian AL:</p>

  ${imgTag(shots.staffModal, 'Modal Kemaskini Profil & Baki Cuti — Bahagian Peruntukan AL')}

  <h4>Baris 1 — Peruntukan AL</h4>
  <table>
    <thead><tr><th>Medan</th><th>Penerangan</th></tr></thead>
    <tbody>
      <tr><td><strong>Baki AL Tahun Lepas (CF)</strong></td><td>Hari AL yang dibawa dari tahun lepas — maksimum 3 hari</td></tr>
      <tr><td><strong>AL Diperuntukkan Tahun Ini</strong></td><td>Kelayakan AL penuh untuk tahun semasa (set oleh HR)</td></tr>
      <tr><td><strong>Jumlah AL Terkini</strong></td><td>Auto-kira: CF + AL Tahun Ini — tidak boleh diedit</td></tr>
    </tbody>
  </table>

  <h4>Baris 2 — Penggunaan &amp; Baki Sebenar <span class="badge badge-green">BAHARU</span></h4>
  <table>
    <thead><tr><th>Medan</th><th>Penerangan</th></tr></thead>
    <tbody>
      <tr><td><strong>AL Digunakan (Rekod Sistem)</strong></td><td>Dikira automatik dari rekod cuti APPROVED dalam sistem — read-only</td></tr>
      <tr><td><strong>Pelarasan HR</strong></td><td>Hari AL yang digunakan <em>sebelum</em> sistem diaktifkan atau pindahan dari rekod HR — diisi oleh HR</td></tr>
      <tr><td><strong>Baki AL Sebenar</strong></td><td>Auto-kira: Jumlah AL − Digunakan − Pelarasan HR — read-only</td></tr>
    </tbody>
  </table>

  <div class="callout warning">
    <span class="callout-icon">🔄</span>
    <div>
      <strong>Cara Sync Baki Cuti HR dengan Sistem:</strong><br>
      Jika staf sudah menggunakan cuti sebelum sistem diaktifkan (contoh: Jan–Mei), masukkan jumlah hari tersebut dalam medan <strong>Pelarasan HR</strong>. Sistem akan mengira Baki AL Sebenar secara automatik supaya sama dengan rekod HR.
    </div>
  </div>

  <div class="callout info">
    <span class="callout-icon">💡</span>
    <div>
      <strong>Contoh:</strong> Staf diperuntukkan 14 hari AL + 2 hari CF = 16 hari. Staf sudah guna 5 hari dari Jan–Apr sebelum sistem, dan 2 hari dalam sistem.<br>
      Masukkan <strong>5</strong> dalam Pelarasan HR → Baki Sebenar = 16 − 2 − 5 = <strong>9 hari</strong>.
    </div>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════════ SEC 10 -->
<div class="section">
  <div class="section-header">
    <div class="section-num">10</div>
    <div class="section-title">Pengurusan Cawangan</div>
  </div>

  ${imgTag(shots.branches, 'Modul Pengurusan Cawangan')}

  <p>Hanya boleh diakses oleh <span class="badge badge-green">HR</span> <span class="badge badge-blue">Admin</span> <span class="badge badge-purple">Super Admin</span></p>

  <h3>Fungsi Utama</h3>
  <ul>
    <li>Tambah cawangan baru dengan nama dan negeri</li>
    <li>Kemaskini negeri cawangan menggunakan dropdown terus dalam senarai</li>
    <li>Padam cawangan yang tidak aktif (cawangan ada staf tidak boleh dipadam)</li>
    <li>Lihat bilangan staf aktif bagi setiap cawangan</li>
  </ul>

  <div class="callout info">
    <span class="callout-icon">📍</span>
    <div>Negeri cawangan adalah penting kerana ia menentukan aliran kelulusan cuti — khususnya untuk Doktor Pahang yang menggunakan Supervisor Balok HQ sebagai pelulus Peringkat 1.</div>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════════ SEC 11 -->
<div class="section">
  <div class="section-header">
    <div class="section-num">11</div>
    <div class="section-title">Laporan Cuti</div>
  </div>

  <p>Hanya boleh diakses oleh <span class="badge badge-blue">Admin</span> <span class="badge badge-purple">Super Admin</span></p>

  <h3>Jana Laporan</h3>
  <div class="steps">
    <div class="step"><div class="step-num">1</div><div class="step-body">Pergi ke <strong>Pengurusan → Laporan</strong></div></div>
    <div class="step"><div class="step-num">2</div><div class="step-body">Tapis mengikut tahun, cawangan, atau jenis cuti</div></div>
    <div class="step"><div class="step-num">3</div><div class="step-body">Tekan <strong>"Jana Laporan"</strong> untuk mencetak dalam format A4</div></div>
  </div>

  <h3>Kandungan Laporan</h3>
  <ul>
    <li>Nama staf dan cawangan</li>
    <li>Jenis cuti, tarikh mula, tarikh tamat, tempoh (hari)</li>
    <li>Status kelulusan</li>
    <li>Jumlah hari cuti diambil sepanjang tempoh</li>
  </ul>
</div>

<!-- ═══════════════════════════════════════════════════════════ SEC 12 -->
<div class="section">
  <div class="section-header">
    <div class="section-num">12</div>
    <div class="section-title">Audit Log &amp; Keselamatan</div>
  </div>

  <p>Sistem merekodkan semua aktiviti penting secara automatik dalam pangkalan data.</p>

  <table>
    <thead><tr><th>Aktiviti Direkodkan</th><th>Siapa</th><th>Masa</th></tr></thead>
    <tbody>
      <tr><td>Log masuk ke sistem</td><td>Pengguna</td><td>Automatik</td></tr>
      <tr><td>Permohonan cuti baru dihantar</td><td>Pemohon</td><td>Automatik</td></tr>
      <tr><td>Kelulusan / Penolakan cuti</td><td>Pelulus</td><td>Automatik</td></tr>
      <tr><td>Tambah / Edit / Nyahaktif staf</td><td>Admin/HR</td><td>Automatik</td></tr>
      <tr><td>Tukar kata laluan</td><td>Pengguna</td><td>Automatik</td></tr>
      <tr><td>Perubahan tetapan RBAC</td><td>Super Admin</td><td>Automatik</td></tr>
    </tbody>
  </table>

  <div class="callout info">
    <span class="callout-icon">🔍</span>
    <div>Audit Log boleh dilihat di <strong>Pengurusan → Master Logs</strong>. Hanya Admin dan Super Admin mempunyai akses penuh.</div>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════════ SEC 13 -->
<div class="section">
  <div class="section-header">
    <div class="section-num">13</div>
    <div class="section-title">Tetapan &amp; Kata Laluan</div>
  </div>

  <h3>Tetapan Peribadi (Semua Pengguna)</h3>
  <p>Boleh diakses melalui ikon ⚙️ di menu navigasi:</p>
  <ul>
    <li>Tukar nama paparan</li>
    <li>Tukar nombor telefon (untuk notifikasi WhatsApp)</li>
    <li>Tukar jantina</li>
  </ul>

  <h3>Tukar Kata Laluan</h3>
  <div class="steps">
    <div class="step"><div class="step-num">1</div><div class="step-body">Pergi ke <strong>Tetapan → Keselamatan</strong></div></div>
    <div class="step"><div class="step-num">2</div><div class="step-body">Masukkan kata laluan lama</div></div>
    <div class="step"><div class="step-num">3</div><div class="step-body">Masukkan dan sahkan kata laluan baru (minimum 6 aksara)</div></div>
    <div class="step"><div class="step-num">4</div><div class="step-body">Tekan <strong>SIMPAN</strong></div></div>
  </div>

  <h3>Konfigurasi RBAC (Super Admin Sahaja)</h3>
  <p>Pergi ke <strong>Pengurusan → Kawalan Akses</strong> untuk mengubah hak akses setiap peranan. Togol setiap modul kemudian tekan <strong>SIMPAN KONFIGURASI</strong>.</p>

  <div class="callout danger">
    <span class="callout-icon">⚠️</span>
    <div>Berhati-hati semasa mengubah konfigurasi RBAC. Perubahan yang salah boleh menyebabkan staf kehilangan akses kepada modul penting.</div>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════════ SEC 14 -->
<div class="section">
  <div class="section-header">
    <div class="section-num">14</div>
    <div class="section-title">Notifikasi WhatsApp</div>
  </div>

  <p>Sistem menghantar notifikasi WhatsApp secara automatik melalui <strong>Fonnte.com</strong> kepada pihak berkaitan pada setiap peristiwa:</p>

  <table>
    <thead><tr><th>Peristiwa</th><th>Penerima Notifikasi</th></tr></thead>
    <tbody>
      <tr><td>Permohonan baru dihantar</td><td>Pelulus Peringkat 1 yang dipilih</td></tr>
      <tr><td>Cuti diluluskan Peringkat 1</td><td>Pemohon + semua HR/Admin</td></tr>
      <tr><td>Cuti diluluskan sepenuhnya</td><td>Pemohon</td></tr>
      <tr><td>Cuti ditolak</td><td>Pemohon</td></tr>
      <tr><td>Cuti dibatalkan</td><td>Pemohon</td></tr>
      <tr><td>Pemulihan kata laluan</td><td>Pemohon (ke nombor WA sendiri)</td></tr>
    </tbody>
  </table>

  <h3>Konfigurasi Token WhatsApp (Super Admin)</h3>
  <div class="steps">
    <div class="step"><div class="step-num">1</div><div class="step-body">Daftar akaun di <strong>fonnte.com</strong> dan sambungkan nombor WhatsApp penghantar</div></div>
    <div class="step"><div class="step-num">2</div><div class="step-body">Pergi ke <strong>Pengurusan → Tetapan WhatsApp</strong> dalam sistem</div></div>
    <div class="step"><div class="step-num">3</div><div class="step-body">Masukkan <strong>Token Fonnte</strong> dan tekan <strong>SIMPAN TOKEN</strong></div></div>
    <div class="step"><div class="step-num">4</div><div class="step-body">Tekan <strong>HANTAR UJIAN</strong> untuk mengesahkan sambungan berjaya</div></div>
  </div>

  <div class="callout info">
    <span class="callout-icon">💬</span>
    <div>Jika token tidak dikonfigurasi, notifikasi WhatsApp tidak akan dihantar — tetapi sistem tetap berfungsi sepenuhnya. Nombor telefon staf perlu didaftarkan dalam format: <strong>601xxxxxxxx</strong></div>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════════ SEC 15 -->
<div class="section">
  <div class="section-header">
    <div class="section-num">15</div>
    <div class="section-title">Polisi Cuti &amp; Soalan Lazim</div>
  </div>

  <h3>Polisi Utama</h3>
  <table>
    <thead><tr><th>Polisi</th><th>Peraturan</th></tr></thead>
    <tbody>
      <tr><td>Notis awal AL — Staff Admin</td><td>Minimum <strong>3 hari</strong> sebelum tarikh cuti</td></tr>
      <tr><td>Notis awal AL — Semua lain</td><td>Minimum <strong>7 hari</strong> sebelum tarikh cuti</td></tr>
      <tr><td>Lampiran MC</td><td>Wajib disertakan sijil doktor untuk Medical Leave</td></tr>
      <tr><td>Locum doktor</td><td>Wajib diisi sebelum kelulusan akhir cuti doktor</td></tr>
      <tr><td>Pembatalan oleh staf</td><td>Hanya boleh batal permohonan berstatus PENDING</td></tr>
      <tr><td>Pembatalan oleh HOD/HR</td><td>Boleh batal mana-mana permohonan yang belum APPROVED</td></tr>
      <tr><td>Cuti separuh hari</td><td>Hanya untuk Annual Leave (AL) — dikira 0.5 hari</td></tr>
    </tbody>
  </table>

  <h3>Soalan Lazim (FAQ)</h3>

  <h4>S: Saya tidak dapat log masuk walaupun kata laluan betul?</h4>
  <p>Pastikan anda memilih <strong>cawangan yang betul</strong> dahulu. Sistem berbeza mengikut cawangan. Jika masih gagal, hubungi HR/Admin untuk set semula kata laluan.</p>

  <h4>S: Tiada nama muncul dalam dropdown pelulus semasa mohon cuti?</h4>
  <p>Ini bermakna tiada HOD/PIC/Doctor PIC yang berdaftar untuk cawangan anda. Hantar sahaja permohonan — HR/Admin akan meluluskan terus.</p>

  <h4>S: Bolehkah saya edit permohonan yang sudah dihantar?</h4>
  <p>Ya, permohonan berstatus <span class="chip chip-pending">PENDING</span> boleh diedit. Permohonan yang sudah diluluskan tidak boleh diubah.</p>

  <h4>S: Mengapa saya tidak terima notifikasi WhatsApp?</h4>
  <p>Semak sama ada nombor telefon anda telah didaftarkan dalam sistem (format: 601xxxxxxxx). Hubungi Admin jika token WhatsApp belum dikonfigurasi.</p>

  <h4>S: Bagaimana cara pasang aplikasi pada telefon?</h4>
  <p><strong>Android:</strong> Buka Chrome → menu tiga titik → "Tambah ke Skrin Utama".<br>
  <strong>iPhone:</strong> Buka Safari → ikon kongsi (□↑) → "Add to Home Screen".</p>

  <h4>S: Baki AL saya tidak tepat. Apa yang perlu dilakukan?</h4>
  <p>Baki AL dikira berdasarkan tarikh mula berkhidmat yang didaftarkan. Hubungi HR/Admin untuk mengesahkan tarikh mula anda dalam sistem.</p>

  <hr class="divider">
  <p style="text-align:center;color:#94a3b8;font-size:0.82rem;margin-top:1.5rem;">
    <em>Manual Rasmi Sistem KSB Leave Apply — Versi 2.4 — Jun 2026</em><br>
    Untuk pertanyaan lanjut, hubungi HR/Admin KSB<br>
    🌐 https://apply-leave-89ebb.web.app
  </p>
</div>

<!-- ═══════════════════════════════════════════════════════════ SEC 16 -->
<div class="section">
  <div class="section-header">
    <div class="section-num">16</div>
    <div class="section-title">Messenger — Mesej & Perkongsian Fail</div>
  </div>

  <p><strong>Messenger</strong> adalah modul komunikasi dalaman KSB yang membolehkan semua staf menghantar mesej teks dan fail secara langsung dalam sistem — tanpa perlu menggunakan WhatsApp peribadi untuk urusan kerja.</p>

  <div class="callout success">
    <span class="callout-icon">💬</span>
    <div>Messenger boleh diakses oleh <strong>semua peranan</strong> — dari Staff biasa hingga Super Admin. Tidak memerlukan sebarang tetapan tambahan.</div>
  </div>

  ${imgTag(shots.messenger, 'Messenger — Panel Senarai Perbualan')}

  <h3>Cara Membuka Messenger</h3>
  <div class="steps">
    <div class="step"><div class="step-num">1</div><div class="step-body">Klik ikon <strong>Messenger</strong> dalam menu navigasi sebelah kiri (atau FAB menu pada telefon)</div></div>
    <div class="step"><div class="step-num">2</div><div class="step-body">Pilih mana-mana kumpulan atau staf dari senarai di sebelah kiri</div></div>
    <div class="step"><div class="step-num">3</div><div class="step-body">Taip mesej dan tekan ikon hantar, atau lampirkan fail</div></div>
  </div>

  <h3>Jenis Perbualan</h3>
  <table>
    <thead><tr><th>Jenis</th><th>Nama</th><th>Penerangan</th></tr></thead>
    <tbody>
      <tr><td>🏥 Umum</td><td>Semua Staf KSB</td><td>Kumpulan global — semua staf dari semua cawangan boleh menghantar dan membaca mesej</td></tr>
      <tr><td>🏢 Mengikut Cawangan</td><td>Nama cawangan</td><td>Satu kumpulan bagi setiap cawangan (12 cawangan) — mesej khusus untuk staf cawangan tersebut</td></tr>
      <tr><td>👥 Mengikut Peranan</td><td>Doktor / Staff Admin / Staff Operasi / Management / HOD & PIC / Supervisor</td><td>Kumpulan berasaskan peranan — untuk perbincangan sesama kumpulan yang sama</td></tr>
      <tr><td>💬 Mesej Terus</td><td>Nama staf</td><td>Perbualan peribadi antara dua orang staf — hanya dua pihak yang boleh lihat</td></tr>
    </tbody>
  </table>

  <h3>Kumpulan Mengikut Peranan</h3>
  <table>
    <thead><tr><th>Kumpulan</th><th>Sesuai Untuk</th></tr></thead>
    <tbody>
      <tr><td>👨‍⚕️ Semua Doktor</td><td>Perbincangan klinikal, jadual locum, maklumat perubatan</td></tr>
      <tr><td>💼 Staff Admin</td><td>Urusan pentadbiran, borang, bil dan kerani</td></tr>
      <tr><td>⚙️ Staff Operasi</td><td>Operasi harian, logistik dan sokongan klinik</td></tr>
      <tr><td>👑 Management</td><td>Admin, HR dan Super Admin — perbincangan pengurusan</td></tr>
      <tr><td>🏅 HOD & PIC HOD</td><td>Ketua-ketua jabatan merentas cawangan</td></tr>
      <tr><td>👔 Supervisor</td><td>Penyelia-penyelia klinik</td></tr>
    </tbody>
  </table>

  ${imgTag(shots.messengerChat, 'Messenger — Ruangan Chat dengan Mesej')}

  <h3>Menghantar Mesej</h3>
  <div class="steps">
    <div class="step"><div class="step-num">1</div><div class="step-body">Taip mesej dalam kotak teks di bahagian bawah</div></div>
    <div class="step"><div class="step-num">2</div><div class="step-body">Tekan <strong>Enter</strong> atau ikon hantar (➤) untuk menghantar</div></div>
  </div>

  <h3>Menghantar Fail</h3>
  <div class="steps">
    <div class="step"><div class="step-num">1</div><div class="step-body">Tekan ikon klip 📎 di sebelah kiri kotak mesej</div></div>
    <div class="step"><div class="step-num">2</div><div class="step-body">Pilih fail dari peranti anda — pratonton fail akan terpapar</div></div>
    <div class="step"><div class="step-num">3</div><div class="step-body">Tambah teks jika perlu, kemudian tekan hantar</div></div>
  </div>

  <h3>Jenis Fail yang Disokong</h3>
  <table>
    <thead><tr><th>Jenis</th><th>Format</th><th>Paparan</th></tr></thead>
    <tbody>
      <tr><td>Gambar</td><td>JPG, PNG, GIF, WebP</td><td>Dipaparkan terus sebagai imej dalam perbualan</td></tr>
      <tr><td>Dokumen PDF</td><td>.pdf</td><td>Pautan muat turun dengan ikon PDF</td></tr>
      <tr><td>Word</td><td>.doc, .docx</td><td>Pautan muat turun dengan ikon dokumen</td></tr>
      <tr><td>Excel</td><td>.xls, .xlsx</td><td>Pautan muat turun dengan ikon hamparan</td></tr>
      <tr><td>PowerPoint</td><td>.ppt, .pptx</td><td>Pautan muat turun dengan ikon pembentangan</td></tr>
      <tr><td>Teks / CSV</td><td>.txt, .csv</td><td>Pautan muat turun</td></tr>
    </tbody>
  </table>

  <div class="callout warning">
    <span class="callout-icon">📏</span>
    <div><strong>Had saiz fail:</strong> Maksimum <strong>10MB</strong> setiap fail. Fail disimpan selamat di Firebase Storage dan boleh dimuat turun bila-bila masa.</div>
  </div>

  <h3>Ciri-Ciri Lain</h3>
  <ul>
    <li><strong>Mesej Masa Nyata</strong> — mesej terpapar serta-merta tanpa perlu refresh halaman</li>
    <li><strong>Tanda Belum Baca</strong> — titik merah pada ikon Messenger dan senarai perbualan menunjukkan mesej baru</li>
    <li><strong>Cari Staf</strong> — gunakan kotak carian dalam seksyen "Mesej Terus" untuk mencari staf dengan cepat</li>
    <li><strong>Padam Mesej</strong> — tatal pada mesej anda sendiri untuk memaparkan butang padam (×)</li>
    <li><strong>Pratonton Fail</strong> — fail yang dipilih akan dipaparkan sebelum dihantar</li>
    <li><strong>Mesej Terakhir</strong> — senarai kumpulan memaparkan pratonton mesej terkini dan masa</li>
  </ul>

  <div class="callout info">
    <span class="callout-icon">📱</span>
    <div><strong>Pada telefon:</strong> Panel senarai dan panel chat bertukar ganti. Tekan nama kumpulan untuk buka chat, tekan anak panah kiri (←) untuk kembali ke senarai.</div>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════════ SEC 17 -->
<div class="section">
  <div class="section-header">
    <div class="section-num">17</div>
    <div class="section-title">Peringatan Automatik WhatsApp — Kelulusan Tertangguh</div>
  </div>

  <p>Sistem secara automatik menghantar <strong>mesej peringatan WhatsApp</strong> kepada pelulus yang berkaitan apabila sesebuah permohonan cuti kekal dalam status menunggu kelulusan selama <strong>7 hari atau lebih</strong>. Fungsi ini memastikan tiada permohonan cuti terbiar tanpa tindakan.</p>

  <div class="callout success">
    <span class="callout-icon">⏰</span>
    <div>Peringatan dihantar <strong>sekali setiap 24 jam</strong> selagi permohonan masih belum diluluskan. Tiada tindakan diperlukan daripada staf — sistem berfungsi secara automatik sebaik sahaja log masuk.</div>
  </div>

  <h3>Syarat Pencetus Peringatan</h3>
  <table>
    <thead><tr><th>Keadaan</th><th>Tindakan Sistem</th></tr></thead>
    <tbody>
      <tr><td>Permohonan berstatus <span class="chip chip-pending">PENDING</span> selama ≥ 7 hari</td><td>Hantar peringatan kepada Pelulus Peringkat 0/1 (TL untuk Balok, atau HOD / PIC / Supervisor)</td></tr>
      <tr style="background:#fef2f2;"><td>Permohonan berstatus <span class="chip" style="background:#fce7f3;color:#9d174d;">TL APPROVED</span> selama ≥ 7 hari<br><small>(Khas Staff Operasi Balok)</small></td><td>Hantar peringatan kepada <strong>Supervisor Balok</strong> supaya segera nilai permohonan (Peringkat 1)</td></tr>
      <tr><td>Permohonan berstatus <span class="chip chip-hod">HOD APPROVED</span> selama ≥ 7 hari</td><td>Hantar peringatan kepada semua HR dan Admin (Peringkat 2)</td></tr>
    </tbody>
  </table>

  <h3>Siapa yang Menerima Peringatan</h3>

  <h4>Peringkat 0 — Status: PENDING (Staff Operasi Balok sahaja)</h4>
  <p>Peringatan dihantar kepada <strong>Team Leader (TL) yang telah dipilih</strong> semasa staf Operasi Balok menghantar permohonan. Hanya TL yang berkenaan sahaja menerima peringatan ini.</p>

  <h4>Peringkat 1 — Status: PENDING (Staf lain) atau TL APPROVED (Balok)</h4>
  <p>Peringatan dihantar kepada pelulus Peringkat 1 yang ditentukan berdasarkan aliran kelulusan permohonan:</p>
  <ul>
    <li><strong>Supervisor Balok HQ</strong> — untuk Staff Operasi Balok (status: TL APPROVED)</li>
    <li><strong>HOD atau PIC/HOD</strong> cawangan pemohon — untuk Staff Admin dan kebanyakan Doktor</li>
    <li><strong>Supervisor Balok HQ</strong> — untuk Doktor Pahang (kecuali MCKIP &amp; Bentong)</li>
    <li><strong>Doctor PIC cawangan</strong> — untuk Staff Operasi di cawangan lain</li>
  </ul>

  <h4>Peringkat 2 — Status: HOD APPROVED</h4>
  <p>Peringatan dihantar kepada <strong>semua staf berdaftar dengan peranan HR dan Admin</strong> dalam sistem — memastikan sekurang-kurangnya seorang pelulus Peringkat 2 menerima peringatan.</p>

  <div class="flow">
    <div class="flow-box amber">📋 PERMOHONAN TERTANGGUH ≥ 7 HARI<br><small style="font-weight:400">Status: PENDING, TL APPROVED, atau HOD APPROVED</small></div>
    <div class="flow-arrow">↓</div>
    <div class="flow-label">Semakan dijalankan setiap 2 jam oleh sistem</div>
    <div class="flow-arrow">↓</div>
    <div class="flow-box">📱 PERINGATAN WHATSAPP DIHANTAR<br><small style="font-weight:400">PENDING→TL (Balok) / HOD / PIC / Supervisor · TL APPROVED→Supervisor Balok · HOD APPROVED→HR/Admin</small></div>
    <div class="flow-arrow">↓</div>
    <div class="flow-label">Masa peringatan terakhir disimpan — seterusnya hanya selepas 24 jam</div>
    <div class="flow-arrow">↓</div>
    <div class="flow-box green">✅ PELULUS MENGAMBIL TINDAKAN<br><small style="font-weight:400">Peringatan berhenti apabila status berubah</small></div>
  </div>

  <h3>Jadual Masa Semakan</h3>
  <table>
    <thead><tr><th>Masa</th><th>Tindakan</th></tr></thead>
    <tbody>
      <tr><td><strong>15 saat selepas log masuk</strong></td><td>Semakan pertama dijalankan secara automatik</td></tr>
      <tr><td><strong>Setiap 2 jam</strong></td><td>Semakan berterusan selama sesi aktif</td></tr>
      <tr><td><strong>Semasa log keluar</strong></td><td>Semakan berhenti — tiada peringatan dihantar semasa tidak log masuk</td></tr>
    </tbody>
  </table>

  <h3>Mekanisme Anti-Spam</h3>
  <p>Untuk mengelakkan pelulus menerima terlalu banyak peringatan, sistem menguatkuasakan had berikut:</p>
  <ul>
    <li>Setiap permohonan hanya akan dihantar <strong>sekali setiap 24 jam</strong> — walaupun terdapat ramai pengguna yang sedang log masuk</li>
    <li>Masa peringatan terakhir disimpan dalam pangkalan data Firestore — berkesan walaupun merentas sesi dan peranti</li>
    <li>Peringatan <strong>berhenti serta-merta</strong> sebaik sahaja permohonan diluluskan atau ditolak</li>
  </ul>

  <div class="callout info">
    <span class="callout-icon">🔒</span>
    <div>Rekod masa peringatan terakhir (<code>lastReminderSent</code>) disimpan dalam dokumen cuti di Firestore. Ini memastikan koordinasi yang tepat walaupun beberapa pentadbir log masuk serentak.</div>
  </div>

  <h3>Contoh Format Mesej Peringatan WhatsApp</h3>
  <p>Mesej yang diterima oleh pelulus adalah seperti berikut:</p>

  <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:12px;padding:1rem 1.2rem;margin:1rem 0;font-family:monospace;font-size:0.85rem;line-height:1.7;color:#14532d;">
    ⏰ *PERINGATAN KELULUSAN CUTI*<br><br>
    Permohonan cuti berikut masih menunggu tindakan selama <em>[X hari]</em>:<br><br>
    👤 *Pemohon:* [Nama Staf]<br>
    🏢 *Cawangan:* [Nama Cawangan]<br>
    📋 *Jenis Cuti:* [Jenis Cuti]<br>
    📅 *Tarikh:* [Tarikh Mula] – [Tarikh Tamat]<br>
    ⏱️ *Tempoh:* [X] hari<br>
    🔄 *Status:* [PENDING / HOD APPROVED]<br>
    📆 *Dalam Sistem:* [X] hari<br><br>
    Sila log masuk ke sistem untuk meluluskan atau menolak permohonan ini.<br>
    🌐 https://apply-leave-89ebb.web.app
  </div>

  <h3>Keperluan untuk Fungsi Ini Berfungsi</h3>
  <table>
    <thead><tr><th>Keperluan</th><th>Cara Semak / Konfigurasi</th></tr></thead>
    <tbody>
      <tr><td>Token WhatsApp (Fonnte) dikonfigurasi</td><td>Pengurusan → Tetapan WhatsApp → masukkan token</td></tr>
      <tr><td>Nombor telefon pelulus didaftarkan</td><td>Pengurusan → Staf → edit profil pelulus berkenaan</td></tr>
      <tr><td>Format nombor telefon betul</td><td>Mesti dalam format <strong>601xxxxxxxx</strong> (tanpa + atau tanda sempang)</td></tr>
      <tr><td>Pengguna log masuk ke sistem</td><td>Peringatan hanya berjalan semasa sesi aktif</td></tr>
    </tbody>
  </table>

  <div class="callout warning">
    <span class="callout-icon">⚠️</span>
    <div>Jika token WhatsApp tidak dikonfigurasi atau nombor telefon pelulus tidak didaftarkan, peringatan <strong>tidak akan dihantar</strong>. Walau bagaimanapun, sistem pengurusan cuti tetap berfungsi sepenuhnya.</div>
  </div>

  <hr class="divider">
  <p style="text-align:center;color:#94a3b8;font-size:0.82rem;margin-top:1.5rem;">
    <em>Manual Rasmi Sistem KSB Leave Apply — Versi 3.0 — Jun 2026</em><br>
    Untuk pertanyaan lanjut, hubungi HR/Admin KSB<br>
    🌐 https://apply-leave-89ebb.web.app
  </p>
</div>

<!-- ═══════════════════════════════════════════════════════════ SEC 18 -->
<div class="section">
  <div class="section-header">
    <div class="section-num">18</div>
    <div class="section-title">Permohonan Pendaftaran Staf Baru</div>
  </div>

  <p>Staf baharu boleh mendaftar sendiri melalui butang <strong>"Daftar di sini"</strong> pada halaman log masuk. Permohonan akan dihantar kepada HR/Admin untuk disemak dan diluluskan.</p>

  <div class="callout info">
    <span class="callout-icon">📝</span>
    <div>Tab <strong>Pengurusan → Permohonan Pendaftaran</strong> hanya kelihatan kepada <span class="badge badge-green">HR</span> <span class="badge badge-blue">Admin</span> <span class="badge badge-purple">Super Admin</span></div>
  </div>

  <h3>Maklumat yang Diisi Semasa Mendaftar</h3>
  <table>
    <thead><tr><th>Medan</th><th>Keterangan</th><th>Wajib</th></tr></thead>
    <tbody>
      <tr><td>Nama Penuh</td><td>Seperti dalam Kad Pengenalan (huruf besar)</td><td class="center">✓</td></tr>
      <tr><td>No. IC</td><td>Digunakan sebagai ID unik dan kata laluan awal</td><td class="center">✓</td></tr>
      <tr><td>Cawangan</td><td>Klinik/cawangan staf bertugas</td><td class="center">✓</td></tr>
      <tr><td>Kategori</td><td>Admin Staff / Operation Staff / Doctor</td><td class="center">✓</td></tr>
      <tr><td>No. WhatsApp</td><td>Untuk notifikasi (format: 601xxxxxxxx)</td><td class="center">✓</td></tr>
    </tbody>
  </table>

  <h3>Proses Kelulusan Pendaftaran</h3>
  <div class="flow">
    <div class="flow-box">👤 Staf Mengisi Borang Pendaftaran<br><small style="font-weight:400">Dari halaman log masuk → "Daftar di sini"</small></div>
    <div class="flow-arrow">↓</div>
    <div class="flow-box amber">📋 Menunggu Semakan HR/Admin<br><small style="font-weight:400">Tab: Pengurusan → Permohonan Pendaftaran</small></div>
    <div class="flow-arrow">↓</div>
    <div class="flow-box green">✅ Diluluskan — Akaun Dicipta<br><small style="font-weight:400">Kata laluan awal = No. IC staf</small></div>
  </div>

  <h3>Tindakan HR/Admin</h3>
  <table>
    <thead><tr><th>Tindakan</th><th>Kesan</th></tr></thead>
    <tbody>
      <tr><td><strong>Luluskan</strong></td><td>Akaun staf dicipta dalam sistem dengan kata laluan awal = No. IC</td></tr>
      <tr><td><strong>Tolak</strong></td><td>Permohonan dipadam dari senarai</td></tr>
    </tbody>
  </table>

  <div class="callout warning">
    <span class="callout-icon">🔑</span>
    <div>Staf baharu wajib tukar kata laluan segera selepas log masuk pertama. Sistem akan memaparkan <strong>amaran merah</strong> jika kata laluan masih menggunakan No. IC.</div>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════════ SEC 19 -->
<div class="section">
  <div class="section-header">
    <div class="section-num">19</div>
    <div class="section-title">Log Masuk Audit (Login Security)</div>
  </div>

  <p>Sistem merekodkan setiap sesi log masuk staf untuk tujuan keselamatan dan pemantauan. Rekod ini boleh disemak oleh Admin dan Super Admin.</p>

  <div class="callout info">
    <span class="callout-icon">🔒</span>
    <div>Akses melalui <strong>Pengurusan → Log Masuk</strong>. Hanya <span class="badge badge-blue">Admin</span> <span class="badge badge-purple">Super Admin</span> mempunyai akses.</div>
  </div>

  <h3>Maklumat yang Direkodkan</h3>
  <table>
    <thead><tr><th>Maklumat</th><th>Keterangan</th></tr></thead>
    <tbody>
      <tr><td>Nama Pengguna</td><td>Nama staf yang log masuk</td></tr>
      <tr><td>Masa Log Masuk</td><td>Tarikh dan masa tepat sesi dimulakan</td></tr>
      <tr><td>Platform/Peranti</td><td>Jenis pelayar dan sistem operasi yang digunakan</td></tr>
      <tr><td>Zon Masa</td><td>Zon masa peranti pengguna</td></tr>
      <tr><td>ID Sesi</td><td>Pengecam unik setiap sesi (digunakan untuk pengesanan sesi berganda)</td></tr>
    </tbody>
  </table>

  <h3>Pengesanan Sesi Berganda</h3>
  <p>Sistem mengesan jika akaun yang sama dilog masuk dari dua peranti atau lokasi berbeza secara serentak. Apabila ini berlaku:</p>
  <ul>
    <li>Banner amaran merah muncul di bahagian atas skrin</li>
    <li>Pengguna digalakkan log keluar segera jika bukan mereka yang log masuk</li>
    <li>Sesi hanya boleh aktif pada <strong>satu peranti/tab</strong> pada satu masa</li>
  </ul>

  <div class="callout danger">
    <span class="callout-icon">⚠️</span>
    <div>Jika anda menerima amaran sesi berganda tanpa sebab, kemungkinan kata laluan anda telah dikongsi atau dikompromikan. Tukar kata laluan segera melalui <em>Tetapan → Keselamatan</em>.</div>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════════ SEC 20 -->
<div class="section">
  <div class="section-header">
    <div class="section-num">20</div>
    <div class="section-title">Rekod Locum</div>
  </div>

  <p>Modul <strong>Rekod Locum</strong> membolehkan HR/Admin/Supervisor merekodkan maklumat doktor locum yang menggantikan doktor yang bercuti.</p>

  <div class="callout info">
    <span class="callout-icon">👨‍⚕️</span>
    <div>Akses melalui <strong>Pengurusan → Rekod Locum</strong>. Boleh diakses oleh <span class="badge badge-green">HR</span> <span class="badge badge-blue">Admin</span> <span class="badge badge-purple">Super Admin</span> <span class="badge badge-amber">Supervisor</span></div>
  </div>

  <h3>Maklumat Locum yang Direkodkan</h3>
  <table>
    <thead><tr><th>Medan</th><th>Keterangan</th></tr></thead>
    <tbody>
      <tr><td>Nama Doktor Locum</td><td>Nama penuh doktor yang bertugas mengganti</td></tr>
      <tr><td>Tarikh Penggantian</td><td>Tarikh doktor locum bertugas</td></tr>
      <tr><td>Masa Penggantian</td><td>Waktu shift (pagi/petang/malam)</td></tr>
      <tr><td>Cawangan</td><td>Klinik tempat locum bertugas</td></tr>
      <tr><td>Doktor Digantikan</td><td>Nama doktor yang bercuti (dikaitkan dengan rekod cuti)</td></tr>
    </tbody>
  </table>

  <h3>Borang Pelantikan Locum</h3>
  <p>Sistem boleh menjana <strong>Borang Pelantikan Doktor Locum</strong> dalam format cetak rasmi KSB untuk setiap rekod. Tekan ikon cetak (🖨️) pada rekod berkenaan.</p>

  <div class="callout warning">
    <span class="callout-icon">⏰</span>
    <div>Maklumat locum perlu diisi <strong>sebelum kelulusan akhir</strong> boleh diberikan bagi cuti doktor. HR/Admin tidak akan dapat melulus cuti doktor jika maklumat locum belum lengkap.</div>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════════ SEC 21 -->
<div class="section">
  <div class="section-header">
    <div class="section-num">21</div>
    <div class="section-title">Matrix Laluan Kelulusan (Routing)</div>
  </div>

  <p>Modul <strong>Matrix Laluan Kelulusan</strong> membolehkan Super Admin mengkonfigurasi siapa yang perlu meluluskan cuti bagi setiap kumpulan kakitangan.</p>

  <div class="callout info">
    <span class="callout-icon">⚡</span>
    <div>Akses melalui <strong>Pengurusan → Laluan Kelulusan</strong>. Hanya <span class="badge badge-purple">Super Admin</span> <span class="badge badge-blue">Admin</span> mempunyai akses.</div>
  </div>

  <h3>Kumpulan Kakitangan dalam Matrix</h3>
  <table>
    <thead><tr><th>Kumpulan</th><th>Skop</th><th>P0 (TL)</th><th>P1 Pelulus</th><th>P2 HR/Admin</th></tr></thead>
    <tbody>
      <tr style="background:#fef2f2;"><td><strong>Kak. Operasi</strong></td><td>Balok (HQ)</td><td><strong style="color:#dc2626;">Wajib</strong></td><td>Supervisor Balok</td><td>✓</td></tr>
      <tr><td>Doktor</td><td>Kuantan/Pahang</td><td>—</td><td>Supervisor Balok</td><td>✓</td></tr>
      <tr><td>Doktor</td><td>Bentong / MCKIP</td><td>—</td><td>HOD / PIC HOD</td><td>✓</td></tr>
      <tr><td>Doktor</td><td>Terengganu</td><td>—</td><td>HOD / PIC HOD</td><td>—</td></tr>
      <tr><td>Kak. Admin</td><td>Pahang</td><td>—</td><td>HOD</td><td>✓</td></tr>
      <tr><td>Kak. Admin</td><td>Terengganu</td><td>—</td><td>HOD</td><td>—</td></tr>
      <tr><td>Kak. Operasi</td><td>Cawangan Lain</td><td>—</td><td>PIC HOD</td><td>✓</td></tr>
      <tr><td>Juru X-Ray / Sono</td><td>Balok (HQ)</td><td>—</td><td>Supervisor Balok</td><td>✓</td></tr>
      <tr><td>Juru Audio</td><td>Balok (HQ)</td><td>—</td><td>HOD</td><td>✓</td></tr>
    </tbody>
  </table>

  <h3>Cara Mengubah Tetapan Routing</h3>
  <div class="steps">
    <div class="step"><div class="step-num">1</div><div class="step-body">Pergi ke <strong>Pengurusan → Laluan Kelulusan</strong></div></div>
    <div class="step"><div class="step-num">2</div><div class="step-body">Klik pada mana-mana sel dalam jadual untuk togol aktif/tidak aktif</div></div>
    <div class="step"><div class="step-num">3</div><div class="step-body">Tekan butang <strong>"Simpan Matrix"</strong> — perubahan berkuat kuasa serta-merta</div></div>
  </div>

  <div class="callout danger">
    <span class="callout-icon">⚠️</span>
    <div>Perubahan pada matrix routing <strong>mempengaruhi semua permohonan baru</strong> yang dihantar selepas simpan. Permohonan sedia ada tidak terjejas.</div>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════════ SEC 22 -->
<div class="section">
  <div class="section-header">
    <div class="section-num">22</div>
    <div class="section-title">Kawalan Akses RBAC</div>
  </div>

  <p><strong>Role-Based Access Control (RBAC)</strong> menentukan modul dan fungsi yang boleh diakses oleh setiap peranan. Matrix ini boleh dikonfigurasi sepenuhnya oleh Super Admin.</p>

  <div class="callout info">
    <span class="callout-icon">🔒</span>
    <div>Akses melalui <strong>Pengurusan → Access Control</strong>. Hanya <span class="badge badge-purple">Super Admin</span> <span class="badge badge-blue">Admin</span> mempunyai akses.</div>
  </div>

  <h3>Modul yang Boleh Dikonfigurasi</h3>
  <table>
    <thead><tr><th>Kumpulan</th><th>Modul</th></tr></thead>
    <tbody>
      <tr><td><strong>Navigasi</strong></td><td>Dashboard (Analisa/Cawangan/Staff), Analisa Cawangan, Permohonan Cuti, Pengurusan</td></tr>
      <tr><td><strong>Tetapan</strong></td><td>Polisi, Tetapan Sistem, WhatsApp</td></tr>
      <tr><td><strong>Pengurusan</strong></td><td>Luluskan, Kakitangan, Cawangan, Audit, Log Masuk, Laporan, Laluan Kelulusan, Kawalan Akses, Peranan &amp; Kategori</td></tr>
      <tr><td><strong>Skop Laporan</strong></td><td>Daerah Kuantan sahaja, Cawangan sendiri sahaja, Rekod Kedatangan</td></tr>
      <tr><td><strong>Operasi</strong></td><td>Batal Cuti, O/S Balok, O/S Pahang, Rekod Locum</td></tr>
    </tbody>
  </table>

  <h3>Cara Reset RBAC ke Nilai Lalai</h3>
  <p>Tekan butang <strong>"Reset Lalai"</strong> untuk mengembalikan semua kebenaran kepada nilai asal sistem. Tindakan ini tidak boleh dibatalkan — sila pastikan perubahan yang perlu disimpan dahulu sebelum reset.</p>
</div>

<!-- ═══════════════════════════════════════════════════════════ SEC 23 -->
<div class="section">
  <div class="section-header">
    <div class="section-num">23</div>
    <div class="section-title">Pengurusan Peranan &amp; Kategori</div>
  </div>

  <p>Modul ini membolehkan Super Admin dan HR menambah, mengubah atau memadam peranan dan kategori kakitangan dalam sistem.</p>

  <div class="callout info">
    <span class="callout-icon">👥</span>
    <div>Akses melalui <strong>Pengurusan → Peranan &amp; Kategori</strong>. Boleh diakses oleh <span class="badge badge-purple">Super Admin</span> <span class="badge badge-blue">Admin</span> <span class="badge badge-green">HR</span></div>
  </div>

  <h3>Peranan Teras (Tidak Boleh Dipadam)</h3>
  <table>
    <thead><tr><th>Peranan</th><th>Label</th></tr></thead>
    <tbody>
      <tr><td>super_admin</td><td>Super Admin</td></tr>
      <tr><td>admin</td><td>Admin</td></tr>
      <tr><td>hr</td><td>HR</td></tr>
      <tr><td>hod</td><td>HOD</td></tr>
      <tr><td>pic_hod</td><td>PIC HOD</td></tr>
      <tr><td>supervisor</td><td>Supervisor</td></tr>
      <tr><td>team_leader</td><td>Team Leader</td></tr>
      <tr><td>staff</td><td>Staff</td></tr>
      <tr><td>juru_xray</td><td>Juru X-Ray</td></tr>
      <tr><td>sonographer</td><td>Sonographer</td></tr>
      <tr><td>juru_audio</td><td>Juru Audio</td></tr>
    </tbody>
  </table>

  <h3>Kategori Sedia Ada</h3>
  <table>
    <thead><tr><th>Kategori</th><th>Keterangan</th></tr></thead>
    <tbody>
      <tr><td>Admin Staff</td><td>Kakitangan pentadbiran klinik</td></tr>
      <tr><td>Operation Staff</td><td>Kakitangan operasi harian</td></tr>
      <tr><td>Doctor</td><td>Doktor perubatan</td></tr>
    </tbody>
  </table>

  <div class="callout warning">
    <span class="callout-icon">⚠️</span>
    <div>Memadam kategori yang masih digunakan oleh staf aktif boleh menyebabkan ralat dalam pengiraan cuti. Pastikan tiada staf menggunakan kategori tersebut sebelum memadamnya.</div>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════════ SEC 24 -->
<div class="section">
  <div class="section-header">
    <div class="section-num">24</div>
    <div class="section-title">Peranan Paramedik — Juru X-Ray, Sonographer &amp; Juru Audio</div>
  </div>

  <p>Sistem KSB Leave Apply kini menyokong tiga peranan paramedik klinikal yang bertugas di Klinik Syed Badaruddin Balok (HQ).</p>

  <h3>Penerangan Peranan</h3>
  <table>
    <thead><tr><th>Peranan</th><th>Bidang</th><th>Pelulus P1</th><th>Pelulus P2</th></tr></thead>
    <tbody>
      <tr style="background:#fdf2f8;">
        <td><strong>Juru X-Ray</strong></td>
        <td>Paramedik Pengimejan / Radiografi</td>
        <td>Supervisor Balok</td>
        <td>HR / Admin</td>
      </tr>
      <tr style="background:#fdf2f8;">
        <td><strong>Sonographer</strong></td>
        <td>Paramedik Ultrasound</td>
        <td>Supervisor Balok</td>
        <td>HR / Admin</td>
      </tr>
      <tr style="background:#f0fdfa;">
        <td><strong>Juru Audio</strong></td>
        <td>Paramedik Audiologi</td>
        <td>HOD Klinik</td>
        <td>HR / Admin</td>
      </tr>
    </tbody>
  </table>

  <h3>Hak Akses Peranan Paramedik</h3>
  <table>
    <thead><tr><th>Modul</th><th>Juru X-Ray</th><th>Sonographer</th><th>Juru Audio</th></tr></thead>
    <tbody>
      <tr><td>Dashboard (Baki Cuti)</td><td class="center">✓</td><td class="center">✓</td><td class="center">✓</td></tr>
      <tr><td>Mohon Cuti</td><td class="center">✓</td><td class="center">✓</td><td class="center">✓</td></tr>
      <tr><td>Polisi Cuti</td><td class="center">✓</td><td class="center">✓</td><td class="center">✓</td></tr>
      <tr><td>Tetapan Akaun</td><td class="center">✓</td><td class="center">✓</td><td class="center">✓</td></tr>
      <tr><td>Messenger</td><td class="center">✓</td><td class="center">✓</td><td class="center">✓</td></tr>
      <tr><td>Luluskan Cuti</td><td class="center">—</td><td class="center">—</td><td class="center">—</td></tr>
      <tr><td>Pengurusan Staf</td><td class="center">—</td><td class="center">—</td><td class="center">—</td></tr>
    </tbody>
  </table>

  <h3>Cara Daftar Staf Paramedik Baru</h3>
  <div class="steps">
    <div class="step"><div class="step-num">1</div><div class="step-body">Pergi ke <strong>Pengurusan → Staff Management → + Tambah Staf</strong></div></div>
    <div class="step"><div class="step-num">2</div><div class="step-body">Isi nama, No. IC, cawangan (<strong>Balok HQ</strong>), dan kategori (<strong>Operation Staff</strong>)</div></div>
    <div class="step"><div class="step-num">3</div><div class="step-body">Pilih peranan: <strong>Juru X-Ray</strong>, <strong>Sonographer</strong>, atau <strong>Juru Audio</strong></div></div>
    <div class="step"><div class="step-num">4</div><div class="step-body">Masukkan nombor WhatsApp dan tekan <strong>SIMPAN</strong></div></div>
  </div>

  <div class="callout info">
    <span class="callout-icon">📍</span>
    <div>Peranan paramedik ini <strong>hanya terpakai di cawangan Balok (HQ)</strong>. Jika staf ditempatkan di cawangan lain, laluan kelulusan akan mengikut kategori Operation Staff biasa.</div>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════════ SEC 25 -->
<div class="section">
  <div class="section-header">
    <div class="section-num">25</div>
    <div class="section-title">Amaran Log Masuk Pertama &amp; Tukar Kata Laluan</div>
  </div>

  <p>Demi keselamatan, sistem mengesan apabila staf masih menggunakan <strong>kata laluan lalai (No. IC)</strong> dan akan memaparkan amaran mendesak untuk segera menukar kata laluan.</p>

  <h3>Proses Amaran Log Masuk Pertama</h3>
  <div class="flow">
    <div class="flow-box">🔐 Staf Log Masuk dengan Kata Laluan = No. IC</div>
    <div class="flow-arrow">↓</div>
    <div class="flow-box amber" style="background:#fef2f2;border-color:#dc2626;color:#7f1d1d;">⚠️ AMARAN MERAH TERPAPAR<br><small style="font-weight:400">Modal penuh skrin — tidak boleh diabaikan dengan mudah</small></div>
    <div class="flow-arrow">↓</div>
    <div class="flow-box green">🔒 Staf Tukar Kata Laluan Baharu<br><small style="font-weight:400">Tetapan → Keselamatan → Tukar Kata Laluan</small></div>
  </div>

  <h3>Petunjuk pada Halaman Log Masuk</h3>
  <p>Halaman log masuk memaparkan maklumat berikut untuk membantu staf baharu:</p>
  <ul>
    <li><strong>URL Sistem</strong> — pautan terus ke sistem boleh diklik dan dikongsi</li>
    <li><strong>Peringatan Kata Laluan Pertama</strong> — kotak merah menerangkan bahawa kata laluan awal adalah No. IC</li>
    <li><strong>Lupa Kata Laluan</strong> — pautan untuk hantar semula kata laluan ke WhatsApp</li>
  </ul>

  <h3>Cara Tukar Kata Laluan</h3>
  <div class="steps">
    <div class="step"><div class="step-num">1</div><div class="step-body">Klik butang merah <strong>"Tukar Kata Laluan Sekarang"</strong> dalam amaran, ATAU pergi ke <strong>Tetapan → Keselamatan</strong></div></div>
    <div class="step"><div class="step-num">2</div><div class="step-body">Masukkan kata laluan semasa (No. IC untuk kali pertama)</div></div>
    <div class="step"><div class="step-num">3</div><div class="step-body">Masukkan kata laluan baharu (minimum 6 aksara)</div></div>
    <div class="step"><div class="step-num">4</div><div class="step-body">Masukkan semula kata laluan baharu untuk pengesahan</div></div>
    <div class="step"><div class="step-num">5</div><div class="step-body">Tekan <strong>SIMPAN</strong> — kata laluan dikemaskini serta-merta</div></div>
  </div>

  <div class="callout danger">
    <span class="callout-icon">🔐</span>
    <div><strong>PENTING:</strong> Jangan kongsikan kata laluan anda kepada sesiapa. HR/Admin tidak akan pernah meminta kata laluan anda. Jika anda syak akaun telah dikompromikan, tukar kata laluan segera dan hubungi HR.</div>
  </div>

  <hr class="divider">
  <p style="text-align:center;color:#94a3b8;font-size:0.82rem;margin-top:1.5rem;">
    <em>Manual Rasmi Sistem KSB Leave Apply — Versi 3.0 — Jun 2026</em><br>
    Untuk pertanyaan lanjut, hubungi HR/Admin KSB<br>
    🌐 https://apply-leave-89ebb.web.app
  </p>
</div>

</body>
</html>`;

  // ─── Write HTML and convert to PDF ────────────────────────────────────────

  const tmpHtml = path.join(__dirname, '_manual_tmp.html');
  fs.writeFileSync(tmpHtml, html, 'utf8');
  console.log('HTML tulis ke:', tmpHtml);

  // Launch browser again for PDF generation
  const browser2 = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const pdfPage = await browser2.newPage();
  await pdfPage.goto(`file:///${tmpHtml.replace(/\\/g, '/')}`, { waitUntil: 'networkidle0' });
  await delay(1000);

  await pdfPage.pdf({
    path: OUTPUT_PATH,
    format: 'A4',
    printBackground: true,
    margin: { top: '0', right: '0', bottom: '0', left: '0' }
  });

  await browser2.close();
  fs.unlinkSync(tmpHtml);

  console.log(`\n✅ PDF berjaya dijana: ${OUTPUT_PATH}`);
})();
