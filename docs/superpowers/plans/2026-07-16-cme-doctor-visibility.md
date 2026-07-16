# CME Leave Visibility for Doctors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make CME (doctors-only, 5 days/year) visible as used-vs-remaining on the doctor's dashboard, in the HR staff-edit modal, in the `SENARAI BILANGAN CUTI` report, and via a new printable detailed CME report — and fix the entitlement so it defaults correctly.

**Architecture:** A pure `computeCMEEntitlement` helper drives a `window.getEntitlementCME` wrapper; `getLeaveStats('CME')` uses it (fixing the non-doctor phantom-5 bug and giving doctors 5). CME keeps its simple model (entitlement − in-system approved usage) — no new DB fields. UI surfaces (modal block, report column, print report) are added, and a one-off migration clears stale `ent_CME`.

**Tech Stack:** Vanilla JS (ES modules, Vite), Node `node:test` for unit tests, `firebase-admin` for the migration script, Firestore.

## Global Constraints

- **CME is doctors-only** (`staff.category === 'Doctor'`). Non-doctors: entitlement 0, no dashboard card, no modal block, not in the CME report, no report column.
- **Entitlement rule:** `ent_CME` override if set (`!== undefined && !== null`), else `category === 'Doctor' ? 5 : 0`.
- **Simple model — NO Formula B for CME.** Do NOT add `cme_used_pre`, `cme_used_sys_adj`, or `cme_pelarasan` fields. `getLeaveStats('CME').used` stays as the year-scoped approved-record count (AUTO). CME `bal = max(0, ent − used)`.
- **Year-scoped** to `window.getCurrentLeaveYear()`, consistent with `getLeaveStats`.
- Reuse existing helpers: `window._recalcLeaveBalance` (unchanged), `_modalSysUsed` (already year-scoped), `window.printHeaderHTML`, `fmtBal`. Never hand-roll a print header.
- Design reference: `docs/superpowers/specs/2026-07-16-cme-doctor-visibility-design.md`.

---

### Task 1: Pure `computeCMEEntitlement` helper (TDD)

**Files:**
- Modify: `src/leaveBalance.js` (add exported function alongside `computeElOverflow`)
- Test: `tests/leaveBalance.test.mjs` (append)

**Interfaces:**
- Consumes: nothing.
- Produces: `computeCMEEntitlement({ category, ent_CME }) → number`. Returns `parseFloat(ent_CME)` when `ent_CME` is neither `undefined` nor `null` (coerced via existing `num()`); otherwise `5` when `category === 'Doctor'`, else `0`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/leaveBalance.test.mjs`:

```javascript
import { computeCMEEntitlement } from '../src/leaveBalance.js';

test('CME entitlement: doctor with no override defaults to 5', () => {
  assert.strictEqual(computeCMEEntitlement({ category: 'Doctor' }), 5);
});

test('CME entitlement: non-doctor defaults to 0', () => {
  assert.strictEqual(computeCMEEntitlement({ category: 'Admin Staff' }), 0);
  assert.strictEqual(computeCMEEntitlement({ category: 'Operation Staff' }), 0);
});

test('CME entitlement: explicit override wins for doctor and non-doctor', () => {
  assert.strictEqual(computeCMEEntitlement({ category: 'Doctor', ent_CME: 3 }), 3);
  assert.strictEqual(computeCMEEntitlement({ category: 'Admin Staff', ent_CME: 2 }), 2);
});

test('CME entitlement: explicit 0 override is honored (not treated as unset)', () => {
  assert.strictEqual(computeCMEEntitlement({ category: 'Doctor', ent_CME: 0 }), 0);
});

test('CME entitlement: null/undefined ent_CME falls back to category rule', () => {
  assert.strictEqual(computeCMEEntitlement({ category: 'Doctor', ent_CME: null }), 5);
  assert.strictEqual(computeCMEEntitlement({ category: 'Doctor', ent_CME: undefined }), 5);
});

test('CME entitlement: missing category treated as non-doctor', () => {
  assert.strictEqual(computeCMEEntitlement({}), 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/leaveBalance.test.mjs`
Expected: FAIL — `computeCMEEntitlement` is not exported.

- [ ] **Step 3: Implement the helper**

Add to `src/leaveBalance.js` (after `computeElOverflow`, reusing the module-local `num()`):

```javascript
// CME (Continuing Medical Education) is doctors-only, default 5 days/year. An explicit
// ent_CME (including 0) is an HR override and always wins; otherwise doctors get 5 and
// everyone else 0. Consumed by getLeaveStats('CME') and the HR modal.
export function computeCMEEntitlement({ category, ent_CME } = {}) {
  if (ent_CME !== undefined && ent_CME !== null) return num(ent_CME);
  return category === 'Doctor' ? 5 : 0;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/leaveBalance.test.mjs`
Expected: PASS — all prior tests plus the 6 new ones.

- [ ] **Step 5: Commit**

```bash
git add src/leaveBalance.js tests/leaveBalance.test.mjs
git commit -m "feat(leave): add computeCMEEntitlement helper (doctors-only, default 5)"
```

---

### Task 2: Wire CME entitlement into `getEntitlementCME` + `getLeaveStats`

**Files:**
- Modify: `src/main.js:3` (import), near `src/main.js:3994` (add `getEntitlementCME`), `src/main.js:4053-4060` (getLeaveStats CME branch)

**Interfaces:**
- Consumes: `computeCMEEntitlement` from Task 1.
- Produces: `window.getEntitlementCME(staff) → number`; `getLeaveStats(staff,'CME').ent` now equals `getEntitlementCME(staff)` (doctors 5, non-doctors 0, override respected). Consumed by Tasks 3, 4, 5.

- [ ] **Step 1: Extend the import**

Change `src/main.js:3` from:

```javascript
import { recordBalances, computeElOverflow } from './leaveBalance.js';
```

to:

```javascript
import { recordBalances, computeElOverflow, computeCMEEntitlement } from './leaveBalance.js';
```

- [ ] **Step 2: Add `window.getEntitlementCME`**

Immediately AFTER the `window.getEntitlementMC = function(staffObj) { ... };` block (ends ~`src/main.js:4008`), add:

```javascript
// CME entitlement (doctors-only, default 5). ent_CME is an optional HR override.
// Mirrors getEntitlementMC. Delegates the rule to the pure computeCMEEntitlement helper.
window.getEntitlementCME = function(staffObj) {
  if (!staffObj) return 0;
  return computeCMEEntitlement({ category: staffObj.category, ent_CME: staffObj.ent_CME });
};
```

- [ ] **Step 3: Use it in `getLeaveStats`**

In `getLeaveStats`, the entitlement resolution currently reads (around `src/main.js:4053-4060`):

```javascript
  } else {
    // ML_PL entitlement is saved as ent_PL by the HR form (legacy key)
    const entKey = type === 'ML_PL' ? 'ent_PL' : `ent_${type}`;
    const stored = staff[entKey];
    ent = (stored !== undefined && stored !== null)
      ? parseFloat(stored)
      : (leaveCategories.find(c => c.id === type)?.entitlement || 0);
  }
```

Insert a CME branch BEFORE that `else` so CME never hits the generic fallback:

```javascript
  } else if (type === 'CME') {
    ent = window.getEntitlementCME(staff); // doctors 5, non-doctors 0, ent_CME overrides
  } else {
    // ML_PL entitlement is saved as ent_PL by the HR form (legacy key)
    const entKey = type === 'ML_PL' ? 'ent_PL' : `ent_${type}`;
    const stored = staff[entKey];
    ent = (stored !== undefined && stored !== null)
      ? parseFloat(stored)
      : (leaveCategories.find(c => c.id === type)?.entitlement || 0);
  }
```

- [ ] **Step 4: Verify the build compiles**

Run: `npm run build`
Expected: build completes with no error.

- [ ] **Step 5: Manual behavior verification**

Run `npm run dev`. On a doctor's personal dashboard, the "Baki Cuti Lain" → "Latihan CME" card now appears showing `bal / 5`; after an approved 2-day CME it reads `3 / 5`. A non-doctor shows NO CME card (entitlement 0). (Note: doctors whose `ent_CME` was previously saved as 0 still show 0 until Task 6's migration runs — that is expected here.)

- [ ] **Step 6: Commit**

```bash
git add src/main.js
git commit -m "feat(leave): CME entitlement via getEntitlementCME (fixes phantom non-doctor CME)"
```

---

### Task 3: Simple CME breakdown block in the HR staff-edit modal (doctors only)

**Files:**
- Modify: `src/main.js:10827-10830` (remove bare CME input from the "other leaves" grid)
- Modify: `src/main.js:~10756` (add the CME block after the EL breakdown section)

**Interfaces:**
- Consumes: `window.getEntitlementCME` (Task 2), `_modalSysUsed` (existing, year-scoped), `window._recalcLeaveBalance` (existing, unchanged).
- Produces: modal DOM ids `ent-CME` (editable), `cme-sys-used-display` (read-only, `data-used`), `cme-balance-display` (read-only) — rendered only for doctors. The save handler already persists `ent-CME`.

- [ ] **Step 1: Remove the bare CME input from the "other leaves" grid**

Delete this block (currently `src/main.js:10827-10830`):

```javascript
            <div style="display: flex; flex-direction: column;">
               <label style="font-size: 0.85rem; margin-bottom: 0.5rem; color: var(--text-muted); font-weight: 500;">CME &mdash; Cuti Pendidikan Perubatan</label>
               <input type="number" id="ent-CME" class="neu-inset" value="${staff.ent_CME !== undefined ? staff.ent_CME : 0}">
            </div>
```

(Leave the surrounding grid and its other entries intact.)

- [ ] **Step 2: Add the CME breakdown block after the EL breakdown**

Find the EL breakdown render call (currently `src/main.js:10756`):

```javascript
          ${_leaveBreakdownHTML('el', 'EL', 'EL — Cuti Ehsan', 3, '#f59e0b')}
```

Insert immediately AFTER it:

```javascript
          ${(() => {
            const _cmeEnt = window.getEntitlementCME(staff);
            if (_cmeEnt <= 0) return ''; // doctors only
            const _cmeSys = _modalSysUsed('CME');
            const _cmeBal = Math.max(0, _cmeEnt - _cmeSys);
            const _lbl = 'font-size:0.75rem;margin-bottom:0.5rem;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;';
            return `
      <div style="margin-top:1.75rem;padding-top:1.5rem;border-top:1px solid rgba(163,177,198,0.15);">
        <div style="font-size:0.7rem;text-transform:uppercase;color:#8b5cf6;font-weight:700;letter-spacing:1px;margin-bottom:1rem;">CME — Cuti Pendidikan Perubatan (Doktor)</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:1.25rem;">
          <div style="display:flex;flex-direction:column;">
            <label style="${_lbl}color:var(--text-muted);">Peruntukan Setahun</label>
            <input type="number" id="ent-CME" class="neu-inset" min="0" step="0.5" value="${_cmeEnt}" oninput="window._recalcLeaveBalance('cme')" style="border-left:3px solid #8b5cf6;">
          </div>
          <div style="display:flex;flex-direction:column;">
            <label style="${_lbl}color:#ef4444;">Guna Dalam Sistem</label>
            <input type="number" id="cme-sys-used-display" class="neu-inset" disabled value="${_cmeSys.toFixed(1)}" data-used="${_cmeSys}" style="border-left:3px solid #ef4444;color:#ef4444;font-weight:700;opacity:1;cursor:default;">
            <span style="font-size:0.68rem;color:var(--text-muted);margin-top:0.35rem;">Auto dari rekod CME diluluskan (tahun ini)</span>
          </div>
          <div style="display:flex;flex-direction:column;">
            <label style="${_lbl}color:#10b981;">Baki CME</label>
            <input type="number" id="cme-balance-display" class="neu-inset" disabled value="${_cmeBal.toFixed(1)}" style="border-left:3px solid #10b981;font-weight:800;color:#10b981;opacity:1;cursor:default;">
          </div>
        </div>
      </div>`;
          })()}
```

- [ ] **Step 3: Verify the build compiles**

Run: `npm run build`
Expected: build completes with no error.

- [ ] **Step 4: Manual verification**

Run `npm run dev`. Open the HR staff-edit modal for a **doctor**: the new "CME — Cuti Pendidikan Perubatan (Doktor)" block shows Peruntukan (5), Guna Dalam Sistem (approved CME days this year), and Baki CME. Editing Peruntukan live-updates Baki CME (via the existing `_recalcLeaveBalance('cme')`). Saving persists `ent_CME`. Open a **non-doctor** modal: no CME block appears, and no `ent-CME` field exists. Confirm no duplicate `ent-CME` id remains in the "other leaves" grid.

- [ ] **Step 5: Commit**

```bash
git add src/main.js
git commit -m "feat(leave): CME used/remaining breakdown in HR modal (doctors only)"
```

---

### Task 4: "Baki CME" column in `SENARAI BILANGAN CUTI` (doctor section)

**Files:**
- Modify: `src/main.js:2783-2841` (print builder: `renderRows` + `renderSection`)
- Modify: `src/main.js:9025-9100` (on-screen: `renderAttRow` + `renderAttSection`)

**Interfaces:**
- Consumes: `getLeaveStats(s,'CME')` (Task 2), existing `fmtBal`.
- Produces: an `isDoctor`-only extra "Baki CME" column after "Baki MC" in both report renderers. Non-doctor sections unchanged.

- [ ] **Step 1 (print): add the cell in `renderRows`**

In the print `renderRows` (`src/main.js:2783`), after the `mcSt` lines add a CME stat, and after the "Baki MC" `<td>` (currently `src/main.js:2802`) append an `isDoctor`-only cell.

Add after `const mcEnt = mcSt.ent, mcRem = mcSt.bal;` (~`src/main.js:2789`):

```javascript
    const cmeSt = isDoctor ? window.getLeaveStats(s, 'CME') : null;
```

Change the "Baki MC" row cell (currently `src/main.js:2802`) from:

```javascript
      <td style="padding:5px 8px;text-align:center;font-size:10px;font-weight:700;color:#065f46;">${fmtBal(mcRem,mcEnt)}</td>
    </tr>`;
```

to:

```javascript
      <td style="padding:5px 8px;text-align:center;font-size:10px;font-weight:700;color:#065f46;">${fmtBal(mcRem,mcEnt)}</td>
      ${isDoctor ? `<td style="padding:5px 8px;text-align:center;font-size:10px;font-weight:700;color:#6d28d9;">${fmtBal(cmeSt.bal,cmeSt.ent)}</td>` : ''}
    </tr>`;
```

- [ ] **Step 2 (print): add the header + fix footer colspan in `renderSection`**

Change the "Baki MC" header (currently `src/main.js:2824`) from:

```javascript
            <th style="padding:7px 8px;text-align:center;font-size:10px;color:#065f46;">Baki MC</th>
          </tr>
```

to:

```javascript
            <th style="padding:7px 8px;text-align:center;font-size:10px;color:#065f46;">Baki MC</th>
            ${isDoctor ? `<th style="padding:7px 8px;text-align:center;font-size:10px;color:#6d28d9;">Baki CME</th>` : ''}
          </tr>
```

Change the footer's trailing cell (currently `src/main.js:2836`) from:

```javascript
            <td colspan="2"></td>
```

to:

```javascript
            <td colspan="${isDoctor ? 3 : 2}"></td>
```

- [ ] **Step 3 (on-screen): add the cell in `renderAttRow`**

In `renderAttRow` (`src/main.js:9025`), after `const mcEnt = mcSt.ent, mcRem = mcSt.bal;` (~`src/main.js:9031`) add:

```javascript
              const cmeSt = isDoctor ? window.getLeaveStats(s, 'CME') : null;
```

Change the "Baki MC" cell (currently `src/main.js:9046`) from:

```javascript
                <td style="padding:0.55rem 0.75rem;text-align:center;font-size:0.75rem;color:#10b981;">${fmtBal(mcRem,mcEnt)}</td>
              </tr>`;
```

to:

```javascript
                <td style="padding:0.55rem 0.75rem;text-align:center;font-size:0.75rem;color:#10b981;">${fmtBal(mcRem,mcEnt)}</td>
                ${isDoctor ? `<td style="padding:0.55rem 0.75rem;text-align:center;font-size:0.75rem;color:#8b5cf6;">${fmtBal(cmeSt.bal,cmeSt.ent)}</td>` : ''}
              </tr>`;
```

- [ ] **Step 4 (on-screen): add the header + fix footer colspan in `renderAttSection`**

Change the "Baki MC" header (currently `src/main.js:9079`) from:

```javascript
                          <th style="padding:0.55rem 0.75rem;text-align:center;font-size:0.6rem;font-weight:700;color:#10b981;min-width:62px;">Baki MC</th>
                        </tr>
```

to:

```javascript
                          <th style="padding:0.55rem 0.75rem;text-align:center;font-size:0.6rem;font-weight:700;color:#10b981;min-width:62px;">Baki MC</th>
                          ${isDoctor ? `<th style="padding:0.55rem 0.75rem;text-align:center;font-size:0.6rem;font-weight:700;color:#8b5cf6;min-width:72px;">Baki CME</th>` : ''}
                        </tr>
```

Change the footer's trailing cell (currently `src/main.js:9093`) from:

```javascript
                          <td colspan="2"></td>
```

to:

```javascript
                          <td colspan="${isDoctor ? 3 : 2}"></td>
```

- [ ] **Step 5: Verify the build compiles**

Run: `npm run build`
Expected: build completes with no error.

- [ ] **Step 6: Manual verification**

Run `npm run dev`. In the HR "Rekod Kedatangan / SENARAI BILANGAN CUTI" view (on-screen), the DOKTOR section shows a new "Baki CME" column (`bal/ent`) matching the doctor's dashboard; the KAKITANGAN (non-doctor) section is unchanged (no CME column, footer aligned). Click the attendance PDF (`generateAttendanceReport`) and confirm the printed DOKTOR table has the "Baki CME" column and the footer row spans correctly.

- [ ] **Step 7: Commit**

```bash
git add src/main.js
git commit -m "feat(report): add Baki CME column to doctor section of leave report"
```

---

### Task 5: Printable detailed CME report + toolbar button

**Files:**
- Modify: `src/main.js` (add `window.printCMEReport` near `generateAttendanceReport`, ~`src/main.js:2754`)
- Modify: `src/main.js:8464-8467` (add the CME button beside the attendance PDF button)

**Interfaces:**
- Consumes: `window.getEntitlementCME`, `getLeaveStats(s,'CME')`, `window.printHeaderHTML`, `leaveYearOf`, `window.getCurrentLeaveYear`, the same report-scoping helpers `generateAttendanceReport` uses (`getUserReportBranch`, `getUserReportDaerah`, `getUserStateScope`, `attendanceReportBranch`).
- Produces: `window.printCMEReport()` opens a print window listing active doctors with CME entitlement/used/balance and their dated approved CME records for the current leave year.

- [ ] **Step 1: Add `window.printCMEReport`**

Insert BEFORE `window.generateAttendanceReport = function() {` (`src/main.js:2754`):

```javascript
window.printCMEReport = function() {
  const MONTHS_MS = ['Januari','Februari','Mac','April','Mei','Jun','Julai','Ogos','September','Oktober','November','Disember'];
  const year = window.getCurrentLeaveYear();
  const reportBranch = window.getUserReportBranch(user);
  const reportDaerah = window.getUserReportDaerah(user);
  const userStateScope = window.getUserStateScope(user);
  const activeBranch = attendanceReportBranch;

  // Active doctors within the current user's report scope (same predicate as the attendance report).
  const doctors = staffList.filter(s => {
    if (s.category !== 'Doctor' || s.inactive) return false;
    if (reportBranch && s.branch !== reportBranch) return false;
    if (activeBranch && activeBranch !== 'SEMUA' && s.branch !== activeBranch) return false;
    const bObj = branches.find(b => b.name === s.branch);
    if (!bObj && userStateScope !== 'all') return false;
    if (bObj && userStateScope !== 'all' && bObj.state !== userStateScope) return false;
    if (bObj && reportDaerah && bObj.daerah !== reportDaerah) return false;
    return true;
  }).sort((a,b) => (a.branch||'').localeCompare(b.branch||'') || a.name.localeCompare(b.name));

  const fmtDate = d => {
    if (!d) return '-';
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return d;
    return `${dt.getDate()} ${MONTHS_MS[dt.getMonth()]} ${dt.getFullYear()}`;
  };
  const fmtRange = r => (r.startDate && r.endDate && r.startDate !== r.endDate)
    ? `${fmtDate(r.startDate)} – ${fmtDate(r.endDate)}` : fmtDate(r.startDate || r.endDate);

  let totUsed = 0, totBal = 0;
  const blocks = doctors.map(s => {
    const st = window.getLeaveStats(s, 'CME');
    const ent = window.getEntitlementCME(s);
    totUsed += st.used; totBal += st.bal;
    const recs = leaveRecords
      .filter(r => r.ic === s.ic && r.type === 'CME' && r.status === 'APPROVED' && leaveYearOf(r) === year)
      .sort((a,b) => (a.startDate||'').localeCompare(b.startDate||''));
    const rows = recs.length
      ? recs.map(r => `<div style="padding:3px 0 3px 18px;font-size:11px;color:#334155;">• ${fmtRange(r)} &nbsp;(${parseFloat(r.days||0)} hari)&nbsp; ${r.reason ? '— ' + r.reason : ''}</div>`).join('')
      : `<div style="padding:3px 0 3px 18px;font-size:11px;color:#94a3b8;font-style:italic;">(tiada cuti CME direkodkan)</div>`;
    return `
      <div style="margin-bottom:12px;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 12px;background:#f5f3ff;border-bottom:1px solid #e2e8f0;">
          <div style="font-size:12px;font-weight:700;color:#5b21b6;">${s.name} <span style="font-weight:500;color:#64748b;">— ${s.branch || '-'}</span></div>
          <div style="font-size:11px;font-weight:700;color:#334155;">Kelayakan: ${Math.round(ent)} &nbsp;|&nbsp; Guna: ${parseFloat(st.used.toFixed(1))} &nbsp;|&nbsp; Baki: ${parseFloat(st.bal.toFixed(1))}</div>
        </div>
        <div style="padding:6px 12px;">${rows}</div>
      </div>`;
  }).join('');

  const pw = window.open('', '_blank');
  pw.document.write(`<!DOCTYPE html><html><head>
    <meta charset="UTF-8">
    <title>Laporan Cuti CME — Doktor — ${year}</title>
    <style>
      *{margin:0;padding:0;box-sizing:border-box;}
      body{font-family:Arial,sans-serif;padding:24px;color:#111;background:#fff;}
      .print-btn{margin:16px 0;text-align:right;}
      .print-btn button{padding:8px 20px;background:#5b21b6;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:700;font-size:12px;}
      @media print{.print-btn{display:none;} body{padding:16px;}}
    </style>
  </head><body>
    <div class="print-btn"><button onclick="window.print()">🖨️ PRINT / SIMPAN PDF</button></div>
    ${window.printHeaderHTML({ isReport: true, branch: activeBranch, title: 'LAPORAN CUTI CME — DOKTOR', meta: [{ label: 'Tahun', value: String(year) }, { label: 'Bilangan', value: doctors.length + ' doktor' }] })}
    ${doctors.length ? blocks : '<div style="padding:24px;text-align:center;color:#64748b;font-size:12px;">Tiada doktor dalam skop ini.</div>'}
    <div style="margin-top:14px;padding-top:10px;border-top:2px solid #cbd5e1;font-size:11px;font-weight:700;color:#334155;display:flex;gap:24px;">
      <span>Jumlah: ${doctors.length} doktor</span>
      <span>Jumlah Guna: ${parseFloat(totUsed.toFixed(1))} hari</span>
      <span>Jumlah Baki: ${parseFloat(totBal.toFixed(1))} hari</span>
    </div>
    <div style="margin-top:14px;font-size:9px;color:#718096;border-top:1px solid #e2e8f0;padding-top:8px;">
      Laporan CME dijana oleh KSB Leave Apply System pada ${new Date().toLocaleString('ms-MY')}. Rekod berstatus APPROVED, tahun ${year}.
    </div>
  </body></html>`);
  pw.document.close();
};
```

- [ ] **Step 2: Add the toolbar button**

In the HR reports toolbar, the attendance branch (currently `src/main.js:8464-8467`) reads:

```javascript
              : (userPerms.report_attendance ? `<button onclick="window.generateAttendanceReport()" title="Muat turun PDF — Rekod Kedatangan" class="neu-btn" style="background:rgba(30,41,59,0.1);border:1px solid rgba(30,41,59,0.3);color:var(--text);font-weight:600;display:flex;align-items:center;gap:0.4rem;padding:0.45rem 0.85rem;font-size:0.75rem;flex:none;white-space:nowrap;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V2h12v7"></path><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
                  PDF
                </button>` : '')
```

Change it to render the attendance button AND a CME button (both gated by `report_attendance`):

```javascript
              : (userPerms.report_attendance ? `<button onclick="window.generateAttendanceReport()" title="Muat turun PDF — Rekod Kedatangan" class="neu-btn" style="background:rgba(30,41,59,0.1);border:1px solid rgba(30,41,59,0.3);color:var(--text);font-weight:600;display:flex;align-items:center;gap:0.4rem;padding:0.45rem 0.85rem;font-size:0.75rem;flex:none;white-space:nowrap;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V2h12v7"></path><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
                  PDF
                </button>
                <button onclick="window.printCMEReport()" title="Cetak Laporan CME — Doktor" class="neu-btn" style="background:rgba(124,58,237,0.1);border:1px solid rgba(124,58,237,0.25);color:#7c3aed;font-weight:600;display:flex;align-items:center;gap:0.4rem;padding:0.45rem 0.85rem;font-size:0.75rem;flex:none;white-space:nowrap;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 2H9a2 2 0 0 0-2 2v2"></path><rect x="3" y="8" width="13" height="13" rx="2"></rect></svg>
                  CME
                </button>` : '')
```

- [ ] **Step 3: Verify the build compiles**

Run: `npm run build`
Expected: build completes with no error.

- [ ] **Step 4: Manual verification**

Run `npm run dev`. In the HR reports "Rekod Kedatangan" tab, a new purple "CME" button sits beside the "PDF" button. Click it: a print window opens titled "LAPORAN CUTI CME — DOKTOR" with the maroon corporate header, one block per active doctor showing "Kelayakan / Guna / Baki" and their dated approved CME records (or "(tiada cuti CME direkodkan)"), and a totals footer. A branch-restricted HR sees only their scope's doctors.

- [ ] **Step 5: Commit**

```bash
git add src/main.js
git commit -m "feat(report): printable detailed CME report for doctors"
```

---

### Task 6: `fix-cme.js` migration — clear stale `ent_CME`

**Files:**
- Create: `fix-cme.js` (repo root)

**Interfaces:**
- Consumes: Firestore `staff` collection.
- Produces: deletes the `ent_CME` field where it is `0`, or where the staff is not a doctor. Dry-run by default; `--commit` writes. Doctors with an explicit `ent_CME > 0` override are untouched.

- [ ] **Step 1: Create the script**

Create `fix-cme.js` (mirrors `clear-ent-mc.js`):

```javascript
// fix-cme.js
// Kosongkan medan ent_CME yang usang supaya peruntukan CME dikuasai getEntitlementCME
// (Doctor → 5, bukan-doktor → 0). Sasaran: ent_CME === 0 (mana-mana staf) ATAU staf
// bukan-doktor yang ada ent_CME. Doktor dengan override sebenar (ent_CME > 0) dikekalkan.
//
// Guna: node fix-cme.js            (DRY-RUN)
//       node fix-cme.js --commit   (tulis — padam ent_CME)

import admin from "firebase-admin";
const COMMIT = process.argv.includes("--commit");
admin.initializeApp({ projectId: "apply-leave-89ebb" });
const db = admin.firestore();

async function main() {
  console.log(COMMIT ? "MOD: COMMIT (padam ent_CME usang)\n" : "MOD: DRY-RUN\n");
  const snap = await db.collection("staff").get();
  const targets = [];
  snap.forEach((d) => {
    const x = d.data();
    if (x.ent_CME === undefined || x.ent_CME === null) return;
    const isDoctor = x.category === "Doctor";
    const stale = parseFloat(x.ent_CME) === 0 || !isDoctor;
    if (stale) targets.push({ ref: d.ref, name: x.name, ent_CME: x.ent_CME, category: x.category });
  });
  console.log(`Staf dengan ent_CME usang: ${targets.length}`);
  targets.slice(0, 12).forEach((t) => console.log(`  ${t.name} [${t.category}]: ent_CME ${t.ent_CME} → (padam)`));
  if (targets.length > 12) console.log(`  …dan ${targets.length - 12} lagi`);

  if (!COMMIT) { console.log("\nDRY-RUN selesai. --commit untuk padam."); process.exit(0); }

  let batch = db.batch(), n = 0;
  for (const t of targets) {
    batch.update(t.ref, { ent_CME: admin.firestore.FieldValue.delete() });
    if (++n % 400 === 0) { await batch.commit(); batch = db.batch(); }
  }
  await batch.commit();
  console.log(`\n✅ Dipadam ent_CME daripada ${targets.length} rekod staf.`);
  process.exit(0);
}
main().catch((e) => { console.error("Gagal:", e.message); process.exit(1); });
```

- [ ] **Step 2: Run the dry-run to verify it lists targets without writing**

Run: `node fix-cme.js`
Expected: prints "MOD: DRY-RUN", a count, and a sample of staff whose `ent_CME` would be deleted (doctors with 0, and any non-doctor with `ent_CME` set). No writes occur. (If it errors on credentials, the runner must have Firebase admin access configured — the controller handles the actual `--commit` run against prod, not this task.)

- [ ] **Step 3: Commit**

```bash
git add fix-cme.js
git commit -m "chore(migration): fix-cme.js to clear stale ent_CME"
```

---

## Self-Review Notes

- **Spec coverage:** §1 entitlement helper/fix → Tasks 1+2; §1 migration → Task 6; §2 modal block → Task 3; §3 report column → Task 4; §4 printable report → Task 5. All mapped.
- **Doctors-only invariant** is enforced consistently: Task 2 (`getEntitlementCME` → 0 for non-doctors ⇒ no dashboard card), Task 3 (`_cmeEnt <= 0` ⇒ no modal block), Task 4 (`isDoctor` guards the column), Task 5 (`category === 'Doctor'` filter).
- **No new DB fields** — Task 3 reuses `ent-CME` + the existing `_recalcLeaveBalance` (which reads absent `cme-used-pre-input`/`cme-sys-adj-input`/`cme-pelarasan-input` as 0), so CME stays the simple model.
- **Type/name consistency:** `computeCMEEntitlement({ category, ent_CME })`, `window.getEntitlementCME(staff)`, ids `ent-CME`/`cme-sys-used-display`/`cme-balance-display`, and `window.printCMEReport` are used identically across tasks.
- **Migration safety:** dry-run default; deletes only `ent_CME === 0` or non-doctor `ent_CME`; preserves real doctor overrides.
- **Testing honesty:** only Task 1 (pure helper) has unit tests; Tasks 2–6 are DOM/Firestore-coupled and verified via `npm run build` + manual checks / dry-run, stated explicitly per task.
