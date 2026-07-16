# Per-Type Leave Printable Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a printable single-type leave report (one button per type) alongside the existing all-leave report, by extracting shared helpers first (DRY) and reusing them.

**Architecture:** Task 1 refactors the just-shipped `printAllLeaveReport` into shared module-level helpers with byte-identical output. Task 2 adds `window.printLeaveTypeReport(type)` + one toolbar button per type, reusing those helpers.

**Tech Stack:** Vanilla JS (ES modules, Vite), Firestore (read-only here).

## Global Constraints

- Task 1 must keep `printAllLeaveReport`'s rendered output **byte-identical** — extracted HTML strings are copied verbatim.
- Reuse existing globals: `staffList`, `leaveRecords`, `branches`, `user`, `attendanceReportBranch`, `leaveYearOf`, `getCurrentLeaveYear`, `getLeaveStats`, `printHeaderHTML`, `LEAVE_TYPE_NAMES`. Do NOT touch `printCMEReport` or other reports.
- New helper names must not collide with existing ones (the file has locals named `MONTHS_MS`, `fmtDate`, `fmtRange` inside other functions — use the new names below).
- Per-staff balances from `getLeaveStats(s, type)`; `ent === 0` types (EL_EMG, UP) show `Guna` only.
- Type buttons for `AL, MC, EL, EL_EMG, HL, ML, ML_PL, UP` (NOT CME — it has its own button). Gated by `userPerms.report_attendance` (inside the existing ternary branch).
- Design reference: `docs/superpowers/specs/2026-07-16-per-type-leave-print-report-design.md`.

---

### Task 1: Extract shared print-report helpers (refactor, output-preserving)

**Files:**
- Modify: `src/main.js:2754-2848` (insert helpers before `printAllLeaveReport`; rewrite `printAllLeaveReport` as a thin consumer)

**Interfaces:**
- Produces (module-level): `getReportStaffPool()`, `fmtLeaveDate(d)`, `fmtLeaveRange(r)`,
  `renderLeaveSections(types, pool, year) → { html, sectionCount, grandTotal, staffCount }`,
  and constants `REPORT_MONTHS_MS`, `LEAVE_TYPE_COLOR`, `ALL_LEAVE_TYPES`. Consumed by `printAllLeaveReport` (this task) and `printLeaveTypeReport` (Task 2).

- [ ] **Step 1: Insert the shared helpers immediately BEFORE `window.printAllLeaveReport = function() {` (`src/main.js:2754`)**

```javascript
// ── Shared print-report helpers (used by printAllLeaveReport + printLeaveTypeReport) ──
const REPORT_MONTHS_MS = ['Januari','Februari','Mac','April','Mei','Jun','Julai','Ogos','September','Oktober','November','Disember'];
const LEAVE_TYPE_COLOR = { AL:'#3b82f6', MC:'#10b981', EL:'#f59e0b', EL_EMG:'#ef4444', HL:'#06b6d4', ML:'#ec4899', ML_PL:'#6366f1', CME:'#8b5cf6', UP:'#64748b' };
const ALL_LEAVE_TYPES = ['AL','MC','EL','EL_EMG','HL','ML','ML_PL','CME','UP'];

// Active staff within the current user's report scope (same predicate as the attendance/CME report).
function getReportStaffPool() {
  const reportBranch = window.getUserReportBranch(user);
  const reportDaerah = window.getUserReportDaerah(user);
  const userStateScope = window.getUserStateScope(user);
  const activeBranch = attendanceReportBranch;
  return staffList.filter(s => {
    if (s.inactive) return false;
    if (reportBranch && s.branch !== reportBranch) return false;
    if (activeBranch && activeBranch !== 'SEMUA' && s.branch !== activeBranch) return false;
    const bObj = branches.find(b => b.name === s.branch);
    if (!bObj && userStateScope !== 'all') return false;
    if (bObj && userStateScope !== 'all' && bObj.state !== userStateScope) return false;
    if (bObj && reportDaerah && bObj.daerah !== reportDaerah) return false;
    return true;
  });
}

function fmtLeaveDate(d) {
  if (!d) return '-';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return `${dt.getDate()} ${REPORT_MONTHS_MS[dt.getMonth()]} ${dt.getFullYear()}`;
}
function fmtLeaveRange(r) {
  return (r.startDate && r.endDate && r.startDate !== r.endDate)
    ? `${fmtLeaveDate(r.startDate)} – ${fmtLeaveDate(r.endDate)}` : fmtLeaveDate(r.startDate || r.endDate);
}

// Build HTML for the given leave-type sections. Returns { html, sectionCount, grandTotal, staffCount }.
// Only staff with >=1 APPROVED record of a type in `year` are listed (sorted branch, then name);
// empty sections are skipped. Per staff: Kelayakan/Guna/Baki from getLeaveStats, or Guna only when ent===0.
function renderLeaveSections(types, pool, year) {
  let grandTotal = 0, sectionCount = 0, staffCount = 0;
  const html = types.map(type => {
    const perStaff = pool.map(s => {
      const recs = leaveRecords
        .filter(r => r.ic === s.ic && r.type === type && r.status === 'APPROVED' && leaveYearOf(r) === year)
        .sort((a,b) => (a.startDate||'').localeCompare(b.startDate||''));
      return { s, recs };
    }).filter(x => x.recs.length > 0)
      .sort((a,b) => (a.s.branch||'').localeCompare(b.s.branch||'') || a.s.name.localeCompare(b.s.name));

    if (!perStaff.length) return '';
    sectionCount++;
    staffCount += perStaff.length;
    const accent = LEAVE_TYPE_COLOR[type] || '#334155';
    const blocks = perStaff.map(({ s, recs }) => {
      const st = window.getLeaveStats(s, type);
      const used = recs.reduce((acc,r) => acc + parseFloat(r.days||0), 0);
      grandTotal += used;
      const summary = st.ent > 0
        ? `Kelayakan: ${Math.round(st.ent)} &nbsp;|&nbsp; Guna: ${parseFloat(st.used.toFixed(1))} &nbsp;|&nbsp; Baki: ${parseFloat(st.bal.toFixed(1))}`
        : `Guna: ${parseFloat(used.toFixed(1))}`;
      const rows = recs.map(r => `<div style="padding:3px 0 3px 18px;font-size:11px;color:#334155;">• ${fmtLeaveRange(r)} &nbsp;(${parseFloat(r.days||0)} hari)&nbsp; ${r.reason ? '— ' + r.reason : ''}</div>`).join('');
      return `
        <div style="margin-bottom:10px;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;">
          <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 12px;background:${accent}12;border-bottom:1px solid #e2e8f0;">
            <div style="font-size:12px;font-weight:700;color:${accent};">${s.name} <span style="font-weight:500;color:#64748b;">— ${s.branch || '-'}</span></div>
            <div style="font-size:11px;font-weight:700;color:#334155;">${summary}</div>
          </div>
          <div style="padding:6px 12px;">${rows}</div>
        </div>`;
    }).join('');
    return `
      <div style="margin-bottom:22px;">
        <div style="padding:8px 12px;background:${accent};color:#fff;font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:1px;border-radius:4px;margin-bottom:10px;">${LEAVE_TYPE_NAMES[type] || type}</div>
        ${blocks}
      </div>`;
  }).join('');
  return { html, sectionCount, grandTotal, staffCount };
}
```

- [ ] **Step 2: Rewrite `printAllLeaveReport` (currently `src/main.js:2754-2848`) as a thin consumer**

Replace the ENTIRE existing `window.printAllLeaveReport = function() { ... };` block with:

```javascript
window.printAllLeaveReport = function() {
  const year = window.getCurrentLeaveYear();
  const activeBranch = attendanceReportBranch;
  const pool = getReportStaffPool();
  const { html: sections, sectionCount, grandTotal } = renderLeaveSections(ALL_LEAVE_TYPES, pool, year);

  const pw = window.open('', '_blank');
  pw.document.write(`<!DOCTYPE html><html><head>
    <meta charset="UTF-8">
    <title>Laporan Cuti Kakitangan — ${year}</title>
    <style>
      *{margin:0;padding:0;box-sizing:border-box;}
      body{font-family:Arial,sans-serif;padding:24px;color:#111;background:#fff;}
      .print-btn{margin:16px 0;text-align:right;}
      .print-btn button{padding:8px 20px;background:#334155;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:700;font-size:12px;}
      @media print{.print-btn{display:none;} body{padding:16px;}}
    </style>
  </head><body>
    <div class="print-btn"><button onclick="window.print()">🖨️ PRINT / SIMPAN PDF</button></div>
    ${window.printHeaderHTML({ isReport: true, branch: activeBranch, title: 'LAPORAN CUTI KAKITANGAN', meta: [{ label: 'Tahun', value: String(year) }, { label: 'Bilangan', value: pool.length + ' kakitangan' }] })}
    ${sectionCount ? sections : '<div style="padding:24px;text-align:center;color:#64748b;font-size:12px;">Tiada rekod cuti diluluskan bagi tahun ini dalam skop ini.</div>'}
    <div style="margin-top:14px;padding-top:10px;border-top:2px solid #cbd5e1;font-size:11px;font-weight:700;color:#334155;display:flex;gap:24px;">
      <span>Jumlah kakitangan (skop): ${pool.length}</span>
      <span>Seksyen jenis cuti: ${sectionCount}</span>
      <span>Jumlah hari cuti diluluskan: ${parseFloat(grandTotal.toFixed(1))} hari</span>
    </div>
    <div style="margin-top:14px;font-size:9px;color:#718096;border-top:1px solid #e2e8f0;padding-top:8px;">
      Laporan dijana oleh KSB Leave Apply System pada ${new Date().toLocaleString('ms-MY')}. Rekod berstatus APPROVED, tahun ${year}.
    </div>
  </body></html>`);
  pw.document.close();
};
```

- [ ] **Step 3: Verify the build compiles**

Run: `npm run build`
Expected: build completes with no error.

- [ ] **Step 4: Manual verification (output-preserving)**

Run `npm run dev`, open the "Semua Cuti" report. Confirm it looks **exactly** as before: same maroon header "LAPORAN CUTI KAKITANGAN", same per-type sections (AL, MC, EL, EL_EMG, HL, ML, ML_PL, CME, UP order, empty ones skipped), same per-staff Kelayakan/Guna/Baki and dated records, and the same 3-span footer (Jumlah kakitangan / Seksyen jenis cuti / Jumlah hari). No visible change.

- [ ] **Step 5: Commit**

```bash
git add src/main.js
git commit -m "refactor(report): extract shared print-report helpers (output unchanged)"
```

---

### Task 2: `printLeaveTypeReport(type)` + per-type toolbar buttons

**Files:**
- Modify: `src/main.js` (add `window.printLeaveTypeReport` next to `printAllLeaveReport`)
- Modify: `src/main.js:~8657-8660` (add 8 type buttons after the "Semua Cuti" button)

**Interfaces:**
- Consumes: `getReportStaffPool`, `renderLeaveSections`, `LEAVE_TYPE_NAMES`, `getCurrentLeaveYear`, `attendanceReportBranch`, `printHeaderHTML` (Task 1 + existing).
- Produces: `window.printLeaveTypeReport(type)` opens a single-type detailed print report.

- [ ] **Step 1: Add `printLeaveTypeReport` immediately AFTER the `window.printAllLeaveReport = function() { ... };` block**

```javascript
window.printLeaveTypeReport = function(type) {
  const year = window.getCurrentLeaveYear();
  const activeBranch = attendanceReportBranch;
  const pool = getReportStaffPool();
  const { html: sections, sectionCount, grandTotal, staffCount } = renderLeaveSections([type], pool, year);
  const typeName = LEAVE_TYPE_NAMES[type] || type;

  const pw = window.open('', '_blank');
  pw.document.write(`<!DOCTYPE html><html><head>
    <meta charset="UTF-8">
    <title>Laporan ${typeName} — ${year}</title>
    <style>
      *{margin:0;padding:0;box-sizing:border-box;}
      body{font-family:Arial,sans-serif;padding:24px;color:#111;background:#fff;}
      .print-btn{margin:16px 0;text-align:right;}
      .print-btn button{padding:8px 20px;background:#334155;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:700;font-size:12px;}
      @media print{.print-btn{display:none;} body{padding:16px;}}
    </style>
  </head><body>
    <div class="print-btn"><button onclick="window.print()">🖨️ PRINT / SIMPAN PDF</button></div>
    ${window.printHeaderHTML({ isReport: true, branch: activeBranch, title: 'LAPORAN ' + typeName.toUpperCase(), meta: [{ label: 'Tahun', value: String(year) }, { label: 'Bilangan', value: staffCount + ' kakitangan' }] })}
    ${sectionCount ? sections : `<div style="padding:24px;text-align:center;color:#64748b;font-size:12px;">Tiada rekod cuti ${typeName} diluluskan bagi tahun ini dalam skop ini.</div>`}
    <div style="margin-top:14px;padding-top:10px;border-top:2px solid #cbd5e1;font-size:11px;font-weight:700;color:#334155;display:flex;gap:24px;">
      <span>Bilangan kakitangan: ${staffCount}</span>
      <span>Jumlah hari diluluskan: ${parseFloat(grandTotal.toFixed(1))} hari</span>
    </div>
    <div style="margin-top:14px;font-size:9px;color:#718096;border-top:1px solid #e2e8f0;padding-top:8px;">
      Laporan dijana oleh KSB Leave Apply System pada ${new Date().toLocaleString('ms-MY')}. Rekod berstatus APPROVED, tahun ${year}.
    </div>
  </body></html>`);
  pw.document.close();
};
```

- [ ] **Step 2: Add the per-type buttons after the "Semua Cuti" button**

Find the "Semua Cuti" button end (currently `src/main.js:8659-8660`):

```javascript
                  Semua Cuti
                </button>` : '')
```

Change it to (insert the 8 type buttons between the `</button>` and `` ` : '') ``):

```javascript
                  Semua Cuti
                </button>
                ${['AL','MC','EL','EL_EMG','HL','ML','ML_PL','UP'].map(t => `<button onclick="window.printLeaveTypeReport('${t}')" title="Cetak Laporan ${t}" class="neu-btn" style="background:rgba(51,65,85,0.06);border:1px solid rgba(51,65,85,0.18);color:#334155;font-weight:700;padding:0.45rem 0.7rem;font-size:0.72rem;flex:none;white-space:nowrap;">${t}</button>`).join('')}` : '')
```

- [ ] **Step 3: Verify the build compiles**

Run: `npm run build`
Expected: build completes with no error.

- [ ] **Step 4: Manual verification**

Run `npm run dev`, HR reports "Rekod Kedatangan" tab. Confirm 8 compact type buttons (AL, MC, EL, EL_EMG, HL, ML, ML_PL, UP) appear after "Semua Cuti" and wrap onto a second line if needed. Click "AL": a print window titled "LAPORAN ANNUAL LEAVE (AL)" (or the LEAVE_TYPE_NAMES value) opens, listing only staff who took AL this year with Kelayakan/Guna/Baki + dated records. Click "EL_EMG" / "UP": staff show `Guna` only (no Kelayakan/Baki). Click a type nobody took: the empty-state message shows. Branch-restricted HR sees only their scope's staff. The "Semua Cuti" and "CME" reports still work.

- [ ] **Step 5: Commit**

```bash
git add src/main.js
git commit -m "feat(report): per-type printable leave reports (one button per type)"
```

---

## Self-Review Notes

- **Spec coverage:** shared helpers + output-preserving refactor → Task 1; `printLeaveTypeReport` + buttons → Task 2. All mapped.
- **Output-preserving:** Task 1's `renderLeaveSections` HTML strings and `printAllLeaveReport`'s window/footer are copied verbatim from the current code (only `fmtRange`→`fmtLeaveRange` rename, same output), so the shipped report is unchanged.
- **Name collisions avoided:** new names (`REPORT_MONTHS_MS`, `LEAVE_TYPE_COLOR`, `ALL_LEAVE_TYPES`, `getReportStaffPool`, `fmtLeaveDate`, `fmtLeaveRange`, `renderLeaveSections`) differ from existing function-local `MONTHS_MS`/`fmtDate`/`fmtRange`. `LEAVE_TYPE_NAMES` is the pre-existing global (reused, not redeclared).
- **CME untouched:** no CME button added; `printCMEReport` not modified.
- **Testing honesty:** DOM/print-coupled, no unit tests; `npm run build` + manual verification stated per task.
