# HOD Role Split + PIC HOD → Doctor PIC — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the `hod` role into `hod_cawangan` (view-only) and `hod_balok` (P1 approver for Balok HQ admin), and rename `pic_hod` → `doctor_pic` (branch P1 approver), including routing-matrix and Firestore migration changes.

**Architecture:** Single-file vanilla-JS PWA (`src/main.js`). Roles live in `rbacMatrix` / `CORE_ROLES` / `staffConfig.roleLabels`; approval routing in `ROUTING_DEFAULTS` + `getStaffGroup()` + `getRoutingP1Approvers()` + `canManageRequest()`. RBAC and routing are also persisted in Firestore (`settings/rbac`, `config/approvalRouting`) which **override code defaults on load**, so a data migration accompanies the code change. Deployed to Firebase Hosting `apply-leave-89ebb`.

**Tech Stack:** Vanilla JS, Vite, Firebase (Firestore + Hosting), firebase-admin (migration), Playwright (UI verification). No unit-test framework — "tests" are standalone Node scripts (`_*.cjs`, deleted after use) + `node --check` + Playwright.

**Spec:** `docs/superpowers/specs/2026-06-08-hod-role-split-design.md`

**Ground rules for every task:** work on `src/main.js` in place; after each task run `node --check src/main.js`; commit per task; do NOT deploy until Task 7. Temp verification scripts are written to the project root (so `firebase-admin`/`playwright` resolve), run, then deleted.

---

### Task 1: Roles in RBAC core (rename keys + add hod_balok)

**Files:**
- Modify: `src/main.js` — `rbacMatrix` (the `hod` and `pic_hod` blocks, ~lines 522-533), `CORE_ROLES` (~597), `staffConfig.roleLabels` (~600).

- [ ] **Step 1: Write the failing check**

Create `_t1.cjs` in project root:

```js
const fs = require('fs');
const src = fs.readFileSync('src/main.js', 'utf8');
const checks = {
  'doctor_pic in rbacMatrix': /doctor_pic:\s*\{/.test(src),
  'hod_cawangan in rbacMatrix': /hod_cawangan:\s*\{/.test(src),
  'hod_balok in rbacMatrix': /hod_balok:\s*\{/.test(src),
  'no legacy pic_hod key block': !/\bpic_hod:\s*\{/.test(src),
  'no legacy hod key block': !/(^|\n)\s{4}hod:\s*\{/.test(src),
  'CORE_ROLES has doctor_pic': /CORE_ROLES = \[[^\]]*'doctor_pic'/.test(src),
  'CORE_ROLES has hod_cawangan': /CORE_ROLES = \[[^\]]*'hod_cawangan'/.test(src),
  'CORE_ROLES has hod_balok': /CORE_ROLES = \[[^\]]*'hod_balok'/.test(src),
  'roleLabels Doctor PIC': /doctor_pic:'Doctor PIC'/.test(src),
  'roleLabels HOD Cawangan': /hod_cawangan:'HOD Cawangan'/.test(src),
  'roleLabels HOD Balok': /hod_balok:'HOD Balok'/.test(src),
};
let ok = true;
for (const [k, v] of Object.entries(checks)) { console.log((v?'PASS':'FAIL')+': '+k); if(!v) ok=false; }
process.exit(ok?0:1);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node _t1.cjs`
Expected: several FAIL lines (doctor_pic/hod_cawangan/hod_balok not present yet).

- [ ] **Step 3: Edit `rbacMatrix`**

Rename the `pic_hod:` block to `doctor_pic:` (keep its permission values identical). Rename the `hod:` block to `hod_cawangan:` and set `manage_pending: false` inside it (leave the rest). Then add a new `hod_balok:` block right after `hod_cawangan`:

```js
    hod_balok: {
        dashboard: 'branch', branch_analisa: true, leave_request: true, management: false, policy: true, settings: true, wa_setting: false, messenger: true, inbox: true,
        manage_pending: true, manage_staff: false, manage_branches: false, manage_audit: false, manage_login_audit: false, manage_reports: true, manage_routing: false, manage_access: false, manage_roles_categories: false, manage_holidays: true, manage_policy: false,
        report_kuantan_only: false, report_own_branch_only: true, report_attendance: true,
        can_cancel: true, os_balok: true, os_pahang: true, locum_records: false
    },
```

- [ ] **Step 4: Edit `CORE_ROLES`**

Replace `'hod', 'pic_hod'` with `'hod_cawangan', 'hod_balok', 'doctor_pic'`:

```js
const CORE_ROLES = ['super_admin', 'admin', 'hr', 'hod_cawangan', 'hod_balok', 'doctor_pic', 'supervisor', 'team_leader', 'staff', 'juru_xray', 'sonographer', 'juru_audio'];
```

- [ ] **Step 5: Edit `staffConfig.roleLabels`**

Remove `hod:'HOD'` and `pic_hod:'PIC HOD'`; add the three new labels:

```js
    roleLabels: { super_admin:'Super Admin', admin:'Admin', hr:'HR', hod_cawangan:'HOD Cawangan', hod_balok:'HOD Balok', doctor_pic:'Doctor PIC', supervisor:'Supervisor', team_leader:'Team Leader', staff:'Staff', juru_xray:'Juru X-Ray', sonographer:'Sonographer', juru_audio:'Juru Audio' },
```

- [ ] **Step 6: Run check + syntax**

Run: `node _t1.cjs && node --check src/main.js`
Expected: all PASS, syntax OK. Then `del _t1.cjs` (PowerShell `Remove-Item _t1.cjs`).

- [ ] **Step 7: Commit**

```bash
git add src/main.js
git commit -m "refactor(rbac): rename pic_hod->doctor_pic, hod->hod_cawangan, add hod_balok role"
```

---

### Task 2: Routing defaults + getStaffGroup

**Files:**
- Modify: `src/main.js` — `ROUTING_DEFAULTS` (~1174-1180), `getStaffGroup()` (~1182-1203).

- [ ] **Step 1: Write the failing check**

Create `_t2.cjs` — a faithful copy of the target `getStaffGroup` branching + target `ROUTING_DEFAULTS`, asserting the routing decisions:

```js
const branches = [
  { name:'Klinik Syed Badaruddin Utama', state:'Pahang', daerah:'Kuantan' },
  { name:'Klinik Syed Badaruddin Balok (HQ)', state:'Pahang', daerah:'Kuantan' },
  { name:'Uni Klinik Bentong', state:'Pahang', daerah:'Bentong' },
  { name:'Klinik Syed Badaruddin Kerteh', state:'Terengganu', daerah:'Kemaman' },
];
function getStaffGroup(s){
  const b=branches.find(x=>x.name===s.branch);
  const isT=b&&b.state==='Terengganu';
  const isBalok=(s.branch||'').includes('Balok');
  if(['juru_xray','sonographer'].includes(s.role)&&isBalok)return'xray_sono_balok';
  if(s.role==='juru_audio'&&isBalok)return'juru_audio_balok';
  if(isBalok&&s.category==='Operation Staff')return'operation_balok';
  if(isBalok&&s.category==='Admin Staff')return'admin_balok';            // NEW
  if(isT)return'terengganu';
  if(s.category==='Doctor'&&b&&b.state==='Pahang'&&b.daerah!=='Bentong'&&s.branch!=='Klinik Syed Badaruddin MCKIP')return'doctor_pahang';
  return'pahang_lain';
}
const D = {
  terengganu:{p1_doctor_pic:true,p1_supervisor:false,p1_hod_balok:false,needs_p2:false},
  pahang_lain:{p1_doctor_pic:true,p1_supervisor:false,p1_hod_balok:false,needs_p2:true},
  admin_balok:{p1_doctor_pic:false,p1_supervisor:false,p1_hod_balok:true,needs_p2:true},
  doctor_pahang:{p1_doctor_pic:false,p1_supervisor:true,p1_hod_balok:false,needs_p2:true},
  operation_balok:{needs_tl:true,p1_supervisor:true,needs_p2:true},
  xray_sono_balok:{p1_supervisor:true,needs_p2:true},
  juru_audio_balok:{p1_doctor_pic:false,p1_supervisor:false,p1_hod_balok:true,needs_p2:true},
};
const cases = [
  [{category:'Admin Staff',branch:'Klinik Syed Badaruddin Balok (HQ)',role:'staff'},'admin_balok'],
  [{category:'Admin Staff',branch:'Klinik Syed Badaruddin Utama',role:'staff'},'pahang_lain'],
  [{category:'Doctor',branch:'Klinik Syed Badaruddin Utama',role:'staff'},'doctor_pahang'],
  [{category:'Doctor',branch:'Uni Klinik Bentong',role:'staff'},'pahang_lain'],
  [{role:'juru_audio',branch:'Klinik Syed Badaruddin Balok (HQ)',category:'Operation Staff'},'juru_audio_balok'],
  [{category:'Admin Staff',branch:'Klinik Syed Badaruddin Kerteh',role:'staff'},'terengganu'],
];
let ok=true;
for(const [s,exp] of cases){const g=getStaffGroup(s);const p=g===exp;console.log((p?'PASS':'FAIL')+`: ${s.category||s.role}@${s.branch} -> ${g} (exp ${exp})`);if(!p)ok=false;}
console.log('admin_balok->HOD Balok:', D.admin_balok.p1_hod_balok===true?'PASS':'FAIL');
console.log('terengganu->Doctor PIC only:', (D.terengganu.p1_doctor_pic&&!D.terengganu.p1_hod_balok&&!D.terengganu.p1_supervisor)?'PASS':'FAIL');
console.log('juru_audio_balok->HOD Balok:', D.juru_audio_balok.p1_hod_balok===true?'PASS':'FAIL');
process.exit(ok?0:1);
```

- [ ] **Step 2: Run it (verifies the EXPECTED logic before editing source)**

Run: `node _t2.cjs`
Expected: all PASS (this script encodes the target; it documents intended behaviour. Keep it as the oracle for Step 4.)

- [ ] **Step 3: Edit `ROUTING_DEFAULTS`**

Replace the block so flags are `p1_doctor_pic` / `p1_supervisor` / `p1_hod_balok` (drop `p1_hod` and `p1_pic_hod`), add `admin_balok`, flip `juru_audio_balok`, set `terengganu` to doctor_pic only:

```js
const ROUTING_DEFAULTS = {
  terengganu:       { needs_tl: false, p1_doctor_pic: true,  p1_supervisor: false, p1_hod_balok: false, needs_p2: false },
  pahang_lain:      { needs_tl: false, p1_doctor_pic: true,  p1_supervisor: false, p1_hod_balok: false, needs_p2: true  },
  admin_balok:      { needs_tl: false, p1_doctor_pic: false, p1_supervisor: false, p1_hod_balok: true,  needs_p2: true  },
  doctor_pahang:    { needs_tl: false, p1_doctor_pic: false, p1_supervisor: true,  p1_hod_balok: false, needs_p2: true  },
  operation_balok:  { needs_tl: true,  p1_doctor_pic: false, p1_supervisor: true,  p1_hod_balok: false, needs_p2: true  },
  xray_sono_balok:  { needs_tl: false, p1_doctor_pic: false, p1_supervisor: true,  p1_hod_balok: false, needs_p2: true  },
  juru_audio_balok: { needs_tl: false, p1_doctor_pic: false, p1_supervisor: false, p1_hod_balok: true,  needs_p2: true  },
};
```

- [ ] **Step 4: Edit `getStaffGroup()`**

Add the `admin_balok` rule immediately after the `operation_balok` line and before the `isTerengganu` line:

```js
  if (isBalok && s.category === 'Operation Staff') return 'operation_balok';
  // Admin Staff di Balok HQ → HOD Balok
  if (isBalok && s.category === 'Admin Staff') return 'admin_balok';
  if (isTerengganu)  return 'terengganu';
```

- [ ] **Step 5: Re-run oracle + syntax**

Run: `node _t2.cjs && node --check src/main.js`
Expected: all PASS, syntax OK. Then remove `_t2.cjs`.

- [ ] **Step 6: Commit**

```bash
git add src/main.js
git commit -m "feat(routing): doctor_pic/hod_balok flags, admin_balok group, terengganu->doctor_pic"
```

---

### Task 3: Routing engine — getRoutingP1Approvers + canManageRequest

**Files:**
- Modify: `src/main.js` — `getRoutingP1Approvers()` (~1204-1225), `canManageRequest()` (~662-722).

- [ ] **Step 1: Edit `getRoutingP1Approvers()`**

Replace the flag→role mapping. Supervisor block unchanged (keeps `doctor_pahang`/`operation_balok`/`xray_sono_balok` → Balok HQ). Replace the `cfg.p1_hod` and `cfg.p1_pic_hod` blocks with:

```js
  if (cfg.p1_doctor_pic) {
    candidates.push(...staffList.filter(s => s.role === 'doctor_pic' && s.branch === staffMember.branch && !s.inactive && s.ic !== staffMember.ic));
  }
  if (cfg.p1_hod_balok) {
    // HOD Balok duduk di Balok HQ — pelulus pusat untuk admin Balok & juru audio Balok
    candidates.push(...staffList.filter(s => s.role === 'hod_balok' && s.branch === 'Klinik Syed Badaruddin Balok (HQ)' && !s.inactive && s.ic !== staffMember.ic));
  }
```

(Delete the old `if (cfg.p1_hod) {...}` block including its `staffMember.role === 'hod'` self-approval sub-case, and the old `if (cfg.p1_pic_hod) {...}` block.)

- [ ] **Step 2: Edit `canManageRequest()` — approver role gate**

Change the early role gate (currently `if (!['hod', 'pic_hod', 'supervisor'].includes(user.role)) return false;`) to:

```js
    if (!['doctor_pic', 'hod_balok', 'supervisor'].includes(user.role)) return false;
```

- [ ] **Step 3: Edit `canManageRequest()` — isP1 mapping + branch check**

Replace the `isP1` expression to use the new flags/roles:

```js
    const isP1 = (
        (cfg.p1_doctor_pic && user.role === 'doctor_pic') ||
        (cfg.p1_hod_balok  && user.role === 'hod_balok') ||
        (cfg.p1_supervisor && user.role === 'supervisor')
    );
    if (!isP1) return false;
```

Then update the branch-scope checks below it: keep the supervisor `useBalok` block as-is; replace the `cfg.p1_pic_hod`/`p1_hod` branch checks with:

```js
    if (cfg.p1_doctor_pic && user.role === 'doctor_pic') {
        return req.branch === user.branch;
    }
    if (cfg.p1_hod_balok && user.role === 'hod_balok') {
        return (user.branch || '') === 'Klinik Syed Badaruddin Balok (HQ)';
    }
```

- [ ] **Step 4: Verify no stale approver-role refs remain in these two functions**

Run: `node -e "const s=require('fs').readFileSync('src/main.js','utf8');const win=s.slice(s.indexOf('canManageRequest'),s.indexOf('toggleRouting'));console.log('stale hod/pic_hod in routing region:', /'pic_hod'|'hod'\b|p1_pic_hod|p1_hod\b/.test(win)?'FOUND-FIX':'clean')"`
Expected: `clean`. Then `node --check src/main.js`.

- [ ] **Step 5: Commit**

```bash
git add src/main.js
git commit -m "feat(routing): engine maps doctor_pic/hod_balok approvers; HOD no longer approves"
```

---

### Task 4: UI — routing matrix, approver dropdown, leave-form flow text

**Files:**
- Modify: `src/main.js` — routing matrix `rows`/`cols`/`flowRows`/`getP1Label` (~7803-7950), third matrix table (~8520), approver dropdown `rl` map (~5555), leave-form step-flow text (~5566-5620).

- [ ] **Step 1: Routing matrix — columns**

In the `cols` array (the matrix editor), remove the `p1_hod` (HOD) column, rename the `p1_pic_hod` column to `{ field:'p1_doctor_pic', label:'Doctor PIC', grp:'p1', color:'#818cf8' }`, and add `{ field:'p1_hod_balok', label:'HOD Balok', grp:'p1', color:'#38bdf8' }`. Apply the same column changes to the third summary table's header cells (~8515-8516) and its `mkCell` calls (~8543-8547): drop the `p1_hod` cell, rename `p1_pic_hod`→`p1_doctor_pic`, add a `p1_hod_balok` cell.

- [ ] **Step 2: Routing matrix — rows (add admin_balok)**

In all three `rows`/`flowRows` arrays (~7803, ~7929, ~8520), insert an `admin_balok` row after `pahang_lain`:

```js
            { key:'admin_balok',     label:'Kakitangan Admin',  sub:'Balok (HQ)',            color:'#0ea5e9', bg:'rgba(14,165,233,0.06)'  },
```

(Use matching `grp`/`scope`/`gColor` shape for the `flowRows` variant.)

- [ ] **Step 3: Routing matrix — getP1Label**

Replace the label helper so it reflects the new flags:

```js
                      const getP1Label = (key, cfg) => {
                        if (cfg.needs_tl && cfg.p1_supervisor) return 'Supervisor Balok';
                        if (cfg.p1_supervisor) return 'Supervisor Balok';
                        if (cfg.p1_hod_balok) return 'HOD Balok';
                        if (cfg.p1_doctor_pic) return 'Doctor PIC';
                        return null;
                      };
```

- [ ] **Step 4: Approver dropdown labels**

In the leave-form approver `<select>` builder, update the role-label map:

```js
                            const rl = { doctor_pic:'Doctor PIC', hod_balok:'HOD Balok', supervisor:'Supervisor' };
```

- [ ] **Step 5: Leave-form step-flow text**

In the `isDoctor`/branch step-flow block (~5566-5620), replace user-facing "HOD / PIC_HOD" wording with "Doctor PIC", and for Admin Staff at Balok HQ show step1 = "HOD Balok — Klinik Syed Badaruddin Balok (HQ)". Specifically the Admin Staff branch (`else if (user.category === 'Admin Staff')`) becomes:

```js
                } else if (user.category === 'Admin Staff') {
                    const _isBalokHQ = user.branch === 'Klinik Syed Badaruddin Balok (HQ)';
                    step1Who = _isBalokHQ ? 'HOD Balok — Klinik Syed Badaruddin Balok (HQ)' : `Doctor PIC — ${user.branch || 'Klinik Anda'}`;
                    step1Note = _isBalokHQ ? 'Staff admin Balok HQ mendapat kelulusan HOD Balok pada peringkat pertama.' : 'Staff admin mendapat kelulusan Doctor PIC klinik masing-masing pada peringkat pertama.';
                    flowColor = '#0ea5e9';
                    flowIcon = 'M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z';
                }
```

Also update the doctor branch notes that say "HOD/PIC_HOD" to "Doctor PIC" (Bentong/MCKIP/Terengganu sub-cases).

- [ ] **Step 6: Syntax + build + Playwright screenshot**

Run: `node --check src/main.js && npm run build`. Then drive the routing matrix screen with Playwright (reuse the session's static-server + screenshot pattern) and confirm visually: columns read **Doctor PIC** / **HOD Balok** (no HOD), and an **admin_balok** row exists. Capture `matrix_verify.png`, view it, then delete.

- [ ] **Step 7: Commit**

```bash
git add src/main.js
git commit -m "feat(ui): routing matrix + leave-form reflect doctor_pic/hod_balok roles"
```

---

### Task 5: Sweep remaining references

**Files:**
- Modify: `src/main.js` — `waNotifRbac` (~430-433) and any other `'pic_hod'` / bare role `'hod'` references.

- [ ] **Step 1: Grep sweep**

Run: `node -e "const s=require('fs').readFileSync('src/main.js','utf8').split('\n');s.forEach((l,i)=>{ if(/'pic_hod'|\bpic_hod\b|roleLabels?\.hod\b|=== 'hod'|=='hod'|'hod',|\bp1_hod\b|p1_pic_hod/.test(l)) console.log((i+1)+': '+l.trim()); })"`
Expected: a list of any leftover references. Each must be reclassified: `pic_hod`→`doctor_pic`; routing roles `'hod'` as an approver → removed; HOD-as-viewer stays as `hod_cawangan`.

- [ ] **Step 2: Fix `waNotifRbac` defaults**

Update the role arrays so P1 submit/reminder recipients use the new roles, e.g. replace `'hod'`/`'pic_hod'` with `'doctor_pic'` / `'hod_balok'` as appropriate per region (Pahang submit → `['doctor_pic','hod_balok']`; reminders likewise). Apply the exact mapping shown by Step 1's output.

- [ ] **Step 3: Re-run sweep until clean**

Run the Step 1 command again.
Expected: no approver-context `hod`/`pic_hod` matches remain (only `hod_cawangan`/`hod_balok`/`doctor_pic`). Then `node --check src/main.js`.

- [ ] **Step 4: Commit**

```bash
git add src/main.js
git commit -m "chore(rbac): sweep residual hod/pic_hod references to new role keys"
```

---

### Task 6: Firestore migration script

**Files:**
- Create (temporary, project root): `_migrate_roles.cjs` (deleted after run in Task 7).

- [ ] **Step 1: Write the migration script**

```js
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'apply-leave-89ebb' });
const db = admin.firestore();
const ROLE_MAP = { pic_hod: 'doctor_pic', hod: 'hod_cawangan' };
(async () => {
  // 1) staff role remap
  const snap = await db.collection('staff').get();
  let n = 0;
  for (const d of snap.docs) {
    const r = d.data().role;
    if (ROLE_MAP[r]) { await d.ref.update({ role: ROLE_MAP[r] }); n++; console.log(`  ${d.data().name}: ${r} -> ${ROLE_MAP[r]}`); }
  }
  console.log(`staff migrated: ${n}`);
  // 2) settings/rbac: drop stale keys so code defaults (new keys) apply
  const rbacRef = db.collection('settings').doc('rbac');
  const rbac = await rbacRef.get();
  if (rbac.exists) {
    const upd = {};
    if (rbac.data().pic_hod) upd['pic_hod'] = admin.firestore.FieldValue.delete();
    if (rbac.data().hod) upd['hod'] = admin.firestore.FieldValue.delete();
    if (Object.keys(upd).length) { await rbacRef.update(upd); console.log('settings/rbac: removed stale pic_hod/hod keys'); }
  }
  // 3) config/approvalRouting: remove stale doc so new code defaults (new flags/groups) take effect
  const rt = db.collection('config').doc('approvalRouting');
  if ((await rt.get()).exists) { await rt.delete(); console.log('config/approvalRouting: deleted (will rebuild from code defaults / matrix Save)'); }
  process.exit(0);
})().catch(e => { console.log('MIGRATION FAILED:', e.message); process.exit(1); });
```

- [ ] **Step 2: Do NOT run yet**

The migration runs AFTER deploy (Task 7) so the live app already understands the new keys when records flip. Leave the file uncommitted/untracked for now.

---

### Task 7: Build, deploy, migrate, verify

- [ ] **Step 1: Build**

Run: `npm run build`
Expected: `✓ built`.

- [ ] **Step 2: Deploy hosting**

Run: `npx firebase deploy --only hosting --non-interactive`
Expected: `Deploy complete`.

- [ ] **Step 3: Run the Firestore migration**

Run: `node _migrate_roles.cjs`
Expected: staff `pic_hod`→`doctor_pic` / `hod`→`hod_cawangan` lines; stale rbac keys + approvalRouting doc removed. Then re-query to confirm:

```
node -e "const a=require('firebase-admin');a.initializeApp({projectId:'apply-leave-89ebb'});a.firestore().collection('staff').where('role','in',['pic_hod','hod']).get().then(s=>{console.log('legacy-role staff remaining:',s.size);process.exit(0)})"
```
Expected: `legacy-role staff remaining: 0`. Then delete `_migrate_roles.cjs`.

- [ ] **Step 4: Verify approval routing in the live app (Playwright)**

Drive the live site (reuse the session's Playwright pattern): open the routing matrix → confirm columns **Doctor PIC** / **HOD Balok**, an **admin_balok** row, and **no HOD** column. Capture a screenshot, view it.

- [ ] **Step 5: Verify approver resolution (Node, against live data)**

Confirm a Balok-HQ admin staff resolves to an `hod_balok` approver and a branch staff resolves to a `doctor_pic` approver, by checking `staffList` shape in Firestore:

```
node -e "const a=require('firebase-admin');a.initializeApp({projectId:'apply-leave-89ebb'});const db=a.firestore();(async()=>{const s=await db.collection('staff').where('role','in',['doctor_pic','hod_balok','hod_cawangan']).get();const c={};s.forEach(d=>{const r=d.data().role;c[r]=(c[r]||0)+1});console.log('role counts:',c);process.exit(0)})()"
```
Expected: counts for `doctor_pic` and `hod_cawangan` > 0 (from migration); `hod_balok` may be 0 until the admin assigns someone.

- [ ] **Step 6: Hand off to admin**

Tell the user: existing HODs are now **HOD Cawangan** (view-only); they must assign the Balok HQ approver person(s) to **HOD Balok** via Urus Staf. Remind about the update banner / refresh.

- [ ] **Step 7: Commit any final tweaks + push**

```bash
git add -A
git commit -m "chore: finalize HOD role split rollout"
git push origin main
```

---

## Self-Review

**Spec coverage:**
- pic_hod→doctor_pic rename → Task 1 (keys/labels) + Task 3 (engine) + Task 4 (UI) + Task 6 (data). ✓
- hod→hod_cawangan view-only (`manage_pending:false`) → Task 1. ✓
- New hod_balok approver → Task 1 (role) + Task 2 (group/flags) + Task 3 (engine) + Task 4 (UI). ✓
- admin_balok group (Balok HQ admin → HOD Balok) → Task 2. ✓
- juru_audio_balok → HOD Balok → Task 2. ✓
- terengganu → Doctor PIC only → Task 2. ✓
- Firestore migration (staff + settings/rbac + config/approvalRouting) → Task 6/7. ✓
- "Other staff later" via matrix HOD Balok column → Task 4 (column exists, admin toggles). ✓

**Placeholder scan:** No TBD/TODO; each code step shows concrete code. UI tasks reference exact arrays/locations with the precise edit; executor reads current file for surrounding context (acceptable for large generated HTML tables). ✓

**Type/name consistency:** Flags `p1_doctor_pic` / `p1_supervisor` / `p1_hod_balok` and roles `doctor_pic` / `hod_balok` / `hod_cawangan` used consistently across Tasks 1-6. `admin_balok` group name consistent. Balok HQ branch string `'Klinik Syed Badaruddin Balok (HQ)'` consistent. ✓

**Risk note:** This is a key rename touching many sites; Task 5's grep sweep + Task 7's live verification are the safety net. Deploy (Task 7) precedes the data migration so the live app understands new keys before records flip.
