# All-Leave Printable Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single printable report covering all leave types, each in its own section, listing per-staff Kelayakan/Guna/Baki + dated approved records — same detail as the CME report.

**Architecture:** One new `window.printAllLeaveReport()` modelled on the existing `window.printCMEReport()` (same scope predicate, year-scoping, `printHeaderHTML`, print-window mechanics), plus one toolbar button. Read-only over existing records/entitlements; no data model changes.

**Tech Stack:** Vanilla JS (ES modules, Vite), Firestore (read-only here).

## Global Constraints

- Year-scoped to `window.getCurrentLeaveYear()`; records filtered `type === <T>`, `status === 'APPROVED'`, `leaveYearOf(r) === year`.
- Staff scope = active staff via the SAME predicate as `generateAttendanceReport`/`printCMEReport` (`getUserReportBranch`, `getUserReportDaerah`, `getUserStateScope`, `attendanceReportBranch`, `branches`).
- Section order fixed: `AL, MC, EL, EL_EMG, HL, ML, ML_PL, CME, UP`. Titles from `LEAVE_TYPE_NAMES`.
- Per section, list only staff with ≥ 1 approved record of that type/year, sorted by branch then name. Empty sections skipped.
- Balances from `getLeaveStats(s, type)` (`.ent`/`.used`/`.bal`) so they match the dashboard. When `ent === 0` (EL_EMG, UP) show `Guna` only.
- Use `window.printHeaderHTML` (never hand-roll a header). Do NOT modify `printCMEReport` or any other report.
- Button gated by `userPerms.report_attendance` (same as the CME/attendance buttons).
- Design reference: `docs/superpowers/specs/2026-07-16-all-leave-print-report-design.md`.

---

### Task 1: `printAllLeaveReport` function + toolbar button

**Files:**
- Modify: `src/main.js` (add `window.printAllLeaveReport` next to `window.printCMEReport`, ~`src/main.js:2754`)
- Modify: `src/main.js:~8557` (add "Semua Cuti" button after the CME button)

**Interfaces:**
- Consumes: `window.getLeaveStats`, `window.printHeaderHTML`, `LEAVE_TYPE_NAMES`, `leaveYearOf`, `window.getCurrentLeaveYear`, `getUserReportBranch`/`getUserReportDaerah`/`getUserStateScope`, `attendanceReportBranch`, `branches`, `leaveRecords`, `staffList`.
- Produces: `window.printAllLeaveReport()` opens a print window with one section per leave type.

- [ ] **Step 1: Add the `printAllLeaveReport` function**

Insert immediately BEFORE `window.printCMEReport = function() {` (find it near `src/main.js:2754`):

```javascript
window.printAllLeaveReport = function() {
  const MONTHS_MS = ['Januari','Februari','Mac','April','Mei','Jun','Julai','Ogos','September','Oktober','November','Disember'];
  const year = window.getCurrentLeaveYear();
  const reportBranch = window.getUserReportBranch(user);
  const reportDaerah = window.getUserReportDaerah(user);
  const userStateScope = window.getUserStateScope(user);
  const activeBranch = attendanceReportBranch;

  // Active staff within the current user's report scope (same predicate as the attendance/CME report).
  const pool = staffList.filter(s => {
    if (s.inactive) return false;
    if (reportBranch && s.branch !== reportBranch) return false;
    if (activeBranch && activeBranch !== 'SEMUA' && s.branch !== activeBranch) return false;
    const bObj = branches.find(b => b.name === s.branch);
    if (!bObj && userStateScope !== 'all') return false;
    if (bObj && userStateScope !== 'all' && bObj.state !== userStateScope) return false;
    if (bObj && reportDaerah && bObj.daerah !== reportDaerah) return false;
    return true;
  });

  const fmtDate = d => {
    if (!d) return '-';
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return d;
    return `${dt.getDate()} ${MONTHS_MS[dt.getMonth()]} ${dt.getFullYear()}`;
  };
  const fmtRange = r => (r.startDate && r.endDate && r.startDate !== r.endDate)
    ? `${fmtDate(r.startDate)} – ${fmtDate(r.endDate)}` : fmtDate(r.startDate || r.endDate);

  const TYPES = ['AL','MC','EL','EL_EMG','HL','ML','ML_PL','CME','UP'];
  const typeColor = { AL:'#3b82f6', MC:'#10b981', EL:'#f59e0b', EL_EMG:'#ef4444', HL:'#06b6d4', ML:'#ec4899', ML_PL:'#6366f1', CME:'#8b5cf6', UP:'#64748b' };

  let grandTotal = 0, sectionCount = 0;
  const sections = TYPES.map(type => {
    const perStaff = pool.map(s => {
      const recs = leaveRecords
        .filter(r => r.ic === s.ic && r.type === type && r.status === 'APPROVED' && leaveYearOf(r) === year)
        .sort((a,b) => (a.startDate||'').localeCompare(b.startDate||''));
      return { s, recs };
    }).filter(x => x.recs.length > 0)
      .sort((a,b) => (a.s.branch||'').localeCompare(b.s.branch||'') || a.s.name.localeCompare(b.s.name));

    if (!perStaff.length) return '';
    sectionCount++;
    const accent = typeColor[type] || '#334155';
    const blocks = perStaff.map(({ s, recs }) => {
      const st = window.getLeaveStats(s, type);
      const used = recs.reduce((acc,r) => acc + parseFloat(r.days||0), 0);
      grandTotal += used;
      const summary = st.ent > 0
        ? `Kelayakan: ${Math.round(st.ent)} &nbsp;|&nbsp; Guna: ${parseFloat(st.used.toFixed(1))} &nbsp;|&nbsp; Baki: ${parseFloat(st.bal.toFixed(1))}`
        : `Guna: ${parseFloat(used.toFixed(1))}`;
      const rows = recs.map(r => `<div style="padding:3px 0 3px 18px;font-size:11px;color:#334155;">• ${fmtRange(r)} &nbsp;(${parseFloat(r.days||0)} hari)&nbsp; ${r.reason ? '— ' + r.reason : ''}</div>`).join('');
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

- [ ] **Step 2: Add the "Semua Cuti" toolbar button**

Find the CME button (currently `src/main.js:8557`, `onclick="window.printCMEReport()"`). Immediately AFTER its closing `</button>` (and before the closing `` ` `` of the attendance ternary branch), insert:

```javascript
                <button onclick="window.printAllLeaveReport()" title="Cetak Laporan Semua Cuti (ikut jenis)" class="neu-btn" style="background:rgba(51,65,85,0.1);border:1px solid rgba(51,65,85,0.3);color:#334155;font-weight:600;display:flex;align-items:center;gap:0.4rem;padding:0.45rem 0.85rem;font-size:0.75rem;flex:none;white-space:nowrap;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="8" y1="13" x2="16" y2="13"></line><line x1="8" y1="17" x2="16" y2="17"></line></svg>
                  Semua Cuti
                </button>
```

(The exact indentation should match the neighbouring CME button; the key is that the new `<button>` sits inside the same `userPerms.report_attendance ? \`…\` : ''` template branch as the CME and attendance PDF buttons.)

- [ ] **Step 3: Verify the build compiles**

Run: `npm run build`
Expected: build completes with no error.

- [ ] **Step 4: Manual verification**

Run `npm run dev`. In the HR reports "Rekod Kedatangan" tab, a new "Semua Cuti" button sits beside "CME" and "PDF". Click it: a print window opens titled "LAPORAN CUTI KAKITANGAN" with the maroon header, one coloured section per leave type that has approved records this year (AL, MC, EL, EL_EMG, HL, ML, ML_PL, CME, UP order; empty types absent). Each staff shows `Kelayakan/Guna/Baki` (matching their dashboard) — or `Guna` only for EL_EMG/UP — followed by their dated records. Footer shows staff count, section count, and total approved days. A branch-restricted HR sees only their scope's staff.

- [ ] **Step 5: Commit**

```bash
git add src/main.js
git commit -m "feat(report): printable all-leave report sectioned by type"
```

---

## Self-Review Notes

- **Spec coverage:** function + sectioning + per-type detail + skip-empty + footer → Step 1; button → Step 2; scope/year/balance rules → Global Constraints. All mapped.
- **Consistency with dashboard:** per-staff Kelayakan/Guna/Baki come from `getLeaveStats(s, type)`, so AL/MC/EL Formula-B, EL→AL overflow, and CME doctor entitlement are all reflected automatically. `ent === 0` types (EL_EMG, UP) show Guna only, per spec.
- **No refactor of `printCMEReport`** — the new function is parallel, not shared, per the constraint.
- **Names/interfaces:** `window.printAllLeaveReport`, `LEAVE_TYPE_NAMES`, `getLeaveStats`, `leaveYearOf`, `getCurrentLeaveYear` used exactly as they exist in `main.js`.
- **Testing honesty:** DOM/print-coupled, no unit test; `npm run build` + manual verification stated explicitly.
