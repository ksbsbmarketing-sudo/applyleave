# HOD Cawangan Branch-Scoped Leave Editing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a HOD Cawangan edit leave entitlements and correct/cancel leave records for staff at their own branch only, enforced by Firestore rules rather than a global custom claim.

**Architecture:** The grant lives in `firestore.rules`, which reads the caller's own `staff/{myIC()}` document and compares `branch` against the target — the pattern the `config/publicHolidays` rule already uses. `hod_cawangan` keeps `manageStaff: false`. The client is updated only so the UI stops offering actions the rules would reject.

**Tech Stack:** Firestore security rules, vanilla ES modules (`src/main.js`), `@firebase/rules-unit-testing` on the Firestore emulator, `node --test`.

**Spec:** `docs/superpowers/specs/2026-08-09-hod-cawangan-branch-scope-design.md`

## Global Constraints

- `hod_cawangan` must remain `canApprove: false`, `manageStaff: false` in `config/rolePermissions`. Do not re-provision claims as part of this work.
- A HOD Cawangan must never be able to write `APPROVED` to a leave record. Approval routing (Staff → Doctor PIC → HR) is unchanged; do not touch `config/approvalRouting` or `getRoutingP1Approvers`.
- `hod_cawangan` must NOT be added to `window.canManageRequest()` — that function also drives approve/reject controls.
- Staff-document fields a HOD may write, exactly these 22 keys:
  `ent_AL, ent_MC, ent_EL, ent_EL_EMG, ent_HL, ent_ML, ent_PL, ent_CF, ent_UP, ent_CME, al_used_pre, mc_used_pre, el_used_pre, cme_used_pre, al_used_sys_adj, mc_used_sys_adj, el_used_sys_adj, cme_used_sys_adj, al_pelarasan, mc_pelarasan, el_pelarasan, cme_pelarasan`
- Leave-record fields a HOD may write, exactly these 6 keys: `startDate, endDate, reason, days, status, type`
- A HOD may not edit their own balance, nor their own leave record.
- Emulator tests need JDK on PATH. Every emulator command in this plan must be prefixed with:
  `export PATH="$PATH:/c/Program Files/Microsoft/jdk-21.0.11.10-hotspot/bin" && `
- All user-facing strings are Malay, matching surrounding copy.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `firestore.rules` | server-side enforcement — the only real boundary | Modify: add `selfStaff()` / `isBranchHodOf()` helpers, extend `staff/{ic}` and `leaves/{id}` update rules |
| `tests/rules.test.mjs` | emulator proof of the rules | Modify: add a branch-HOD describe block |
| `src/main.js` | UI gating so buttons match what rules permit | Modify: `canCorrectBranchLeave()` helper, staff-list branch scope, edit-modal field hiding, branch-dashboard record list |

---

### Task 1: Rules — branch-scoped staff entitlement editing

**Files:**
- Modify: `firestore.rules:34-48` (the `staff/{ic}` block)
- Test: `tests/rules.test.mjs` (append a new section at end of file)

**Interfaces:**
- Produces: rules functions `selfStaff()` and `isBranchHodOf(branch)`, used again by Task 2.

- [ ] **Step 1: Write the failing tests**

Append to `tests/rules.test.mjs`:

```javascript
// ── Branch-scoped HOD Cawangan ───────────────────────────────────────────────
// hod_cawangan holds NO manageStaff claim. The right to edit leave data for
// their OWN branch is granted by reading the caller's staff doc, the same way
// config/publicHolidays does. Field allowlists are what stop role/branch
// escalation, so every negative case below matters.

const seedBranchHodFixtures = () => testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, "staff", "HODA"), { ic: "HODA", name: "HOD A", role: "hod_cawangan", branch: "Klinik A" });
  await setDoc(doc(db, "staff", "HODB"), { ic: "HODB", name: "HOD B", role: "hod_cawangan", branch: "Klinik B" });
  await setDoc(doc(db, "staff", "SA"), { ic: "SA", name: "STAF A", role: "staff", branch: "Klinik A", ent_AL: 14, ent_MC: 14, al_used_pre: 0 });
  await setDoc(doc(db, "staff", "SB"), { ic: "SB", name: "STAF B", role: "staff", branch: "Klinik B", ent_AL: 14 });
});

test("branch HOD can edit leave entitlements for staff at own branch", async () => {
  await seedBranchHodFixtures();
  const hod = ctxDb(staffAuth("HODA"));
  await assertSucceeds(updateDoc(doc(hod, "staff", "SA"), { ent_AL: 16, al_used_pre: 2, al_pelarasan: 1 }));
});

test("branch HOD cannot edit staff at another branch", async () => {
  await seedBranchHodFixtures();
  const hod = ctxDb(staffAuth("HODA"));
  await assertFails(updateDoc(doc(hod, "staff", "SB"), { ent_AL: 16 }));
});

test("branch HOD cannot change role or branch of own-branch staff", async () => {
  await seedBranchHodFixtures();
  const hod = ctxDb(staffAuth("HODA"));
  await assertFails(updateDoc(doc(hod, "staff", "SA"), { role: "admin" }));
  await assertFails(updateDoc(doc(hod, "staff", "SA"), { branch: "Klinik B" }));
  await assertFails(updateDoc(doc(hod, "staff", "SA"), { inactive: true }));
  await assertFails(updateDoc(doc(hod, "staff", "SA"), { ent_AL: 16, role: "admin" }));
});

test("branch HOD cannot edit their own leave balance", async () => {
  await seedBranchHodFixtures();
  const hod = ctxDb(staffAuth("HODA"));
  await assertFails(updateDoc(doc(hod, "staff", "HODA"), { ent_AL: 99 }));
});

test("ordinary staff cannot edit anyone's entitlements", async () => {
  await seedBranchHodFixtures();
  const s = ctxDb(staffAuth("SA"));
  await assertFails(updateDoc(doc(s, "staff", "SB"), { ent_AL: 99 }));
  await assertFails(updateDoc(doc(s, "staff", "SA"), { ent_AL: 99 }));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
export PATH="$PATH:/c/Program Files/Microsoft/jdk-21.0.11.10-hotspot/bin" && npx firebase emulators:exec --only firestore --project apply-leave-89ebb "node --test tests/rules.test.mjs"
```

Expected: the four `assertSucceeds`/`assertFails` cases that require the new grant fail. Specifically "branch HOD can edit leave entitlements for staff at own branch" FAILS (permission denied) because no rule grants it yet.

- [ ] **Step 3: Add the rule helpers**

In `firestore.rules`, directly after the existing `manageStaff()` function (line 11), add:

```
    // hod_cawangan carries NO claim describing branch authority — the token holds
    // only ic/canApprove/manageStaff, and manageStaff is global so it cannot say
    // "my branch only". So read the caller's own staff doc and compare branches,
    // exactly as the config/publicHolidays rule below does. Costs one document
    // read per HOD write; HOD saves are rare. A role change then takes effect on
    // the next write with nothing to re-provision (onStaffWrite is not deployed).
    function selfStaff() {
      return get(/databases/$(database)/documents/staff/$(myIC())).data;
    }
    function isBranchHodOf(branch) {
      return signedIn()
        && exists(/databases/$(database)/documents/staff/$(myIC()))
        && selfStaff().role == 'hod_cawangan'
        && selfStaff().branch == branch;
    }
```

- [ ] **Step 4: Extend the `staff/{ic}` update rule**

Replace the closing of the existing `allow update:` in the `staff/{ic}` block so it reads:

```
      allow update: if manageStaff()
        || ( myIC() == ic
             && request.resource.data.diff(resource.data).affectedKeys()
                  .hasOnly(['name', 'phone', 'email', 'address', 'photoUrl'])
             && request.resource.data.name is string
             && request.resource.data.name.size() >= 3
             && request.resource.data.name.size() <= 80 )
        // A HOD Cawangan maintains leave figures for their own branch. The field
        // allowlist is the security boundary: role and branch are absent, so a HOD
        // cannot promote anyone, move staff between branches, deactivate an account
        // or reset a password. myIC() != ic keeps them out of their own balance.
        || ( isBranchHodOf(resource.data.branch)
             && myIC() != ic
             && request.resource.data.diff(resource.data).affectedKeys().hasOnly([
                  'ent_AL', 'ent_MC', 'ent_EL', 'ent_EL_EMG', 'ent_HL',
                  'ent_ML', 'ent_PL', 'ent_CF', 'ent_UP', 'ent_CME',
                  'al_used_pre', 'mc_used_pre', 'el_used_pre', 'cme_used_pre',
                  'al_used_sys_adj', 'mc_used_sys_adj', 'el_used_sys_adj', 'cme_used_sys_adj',
                  'al_pelarasan', 'mc_pelarasan', 'el_pelarasan', 'cme_pelarasan'
                ]) );
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
export PATH="$PATH:/c/Program Files/Microsoft/jdk-21.0.11.10-hotspot/bin" && npx firebase emulators:exec --only firestore --project apply-leave-89ebb "node --test tests/rules.test.mjs"
```

Expected: all tests pass, including the 11 pre-existing ones.

- [ ] **Step 6: Commit**

```bash
git add firestore.rules tests/rules.test.mjs
git commit -m "feat(rules): let HOD Cawangan edit leave figures for their own branch"
```

---

### Task 2: Rules — branch-scoped leave correction and cancellation

**Files:**
- Modify: `firestore.rules` (the `leaves/{id}` block, `allow update`)
- Test: `tests/rules.test.mjs` (append to the branch-HOD section from Task 1)

**Interfaces:**
- Consumes: `isBranchHodOf(branch)` from Task 1.

- [ ] **Step 1: Write the failing tests**

Append to `tests/rules.test.mjs`:

```javascript
const seedBranchHodLeaves = () => testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, "leaves", "LA"), {
    ic: "SA", name: "STAF A", branch: "Klinik A", type: "AL",
    startDate: "2026-09-01", endDate: "2026-09-02", days: 2, reason: "cuti", status: "PENDING",
  });
  await setDoc(doc(db, "leaves", "LB"), {
    ic: "SB", name: "STAF B", branch: "Klinik B", type: "AL",
    startDate: "2026-09-01", endDate: "2026-09-02", days: 2, reason: "cuti", status: "PENDING",
  });
  await setDoc(doc(db, "leaves", "LOWN"), {
    ic: "HODA", name: "HOD A", branch: "Klinik A", type: "AL",
    startDate: "2026-09-05", endDate: "2026-09-06", days: 2, reason: "sendiri", status: "PENDING",
  });
});

test("branch HOD can correct dates on an own-branch leave", async () => {
  await seedBranchHodFixtures();
  await seedBranchHodLeaves();
  const hod = ctxDb(staffAuth("HODA"));
  await assertSucceeds(updateDoc(doc(hod, "leaves", "LA"),
    { startDate: "2026-09-03", endDate: "2026-09-04", days: 2, reason: "betulkan", status: "PENDING" }));
});

test("branch HOD can cancel an own-branch leave", async () => {
  await seedBranchHodFixtures();
  await seedBranchHodLeaves();
  const hod = ctxDb(staffAuth("HODA"));
  await assertSucceeds(updateDoc(doc(hod, "leaves", "LA"), { status: "CANCELLED" }));
});

test("branch HOD cannot approve a leave", async () => {
  await seedBranchHodFixtures();
  await seedBranchHodLeaves();
  const hod = ctxDb(staffAuth("HODA"));
  await assertFails(updateDoc(doc(hod, "leaves", "LA"), { status: "APPROVED" }));
  await assertFails(updateDoc(doc(hod, "leaves", "LA"), { status: "HOD APPROVED" }));
});

test("branch HOD cannot touch a leave at another branch", async () => {
  await seedBranchHodFixtures();
  await seedBranchHodLeaves();
  const hod = ctxDb(staffAuth("HODA"));
  await assertFails(updateDoc(doc(hod, "leaves", "LB"), { status: "CANCELLED" }));
});

test("branch HOD cannot edit their own leave record", async () => {
  await seedBranchHodFixtures();
  await seedBranchHodLeaves();
  const hod = ctxDb(staffAuth("HODA"));
  await assertFails(updateDoc(doc(hod, "leaves", "LOWN"), { status: "CANCELLED" }));
});

test("branch HOD cannot reassign a leave to another person or branch", async () => {
  await seedBranchHodFixtures();
  await seedBranchHodLeaves();
  const hod = ctxDb(staffAuth("HODA"));
  await assertFails(updateDoc(doc(hod, "leaves", "LA"), { ic: "SB", status: "PENDING" }));
  await assertFails(updateDoc(doc(hod, "leaves", "LA"), { branch: "Klinik B", status: "PENDING" }));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
export PATH="$PATH:/c/Program Files/Microsoft/jdk-21.0.11.10-hotspot/bin" && npx firebase emulators:exec --only firestore --project apply-leave-89ebb "node --test tests/rules.test.mjs"
```

Expected: "branch HOD can correct dates on an own-branch leave" and "branch HOD can cancel an own-branch leave" FAIL with permission denied.

- [ ] **Step 3: Extend the `leaves/{id}` update rule**

Replace the existing `allow update:` in the `leaves/{id}` block so it reads:

```
      allow update: if canApprove()
        || ( signedIn()
             && resource.data.ic == myIC()
             && request.resource.data.status == 'PENDING'
             && request.resource.data.ic == resource.data.ic
             && request.resource.data.name == resource.data.name
             && request.resource.data.branch == resource.data.branch
             && request.resource.data.type == resource.data.type
             && request.resource.data.diff(resource.data).affectedKeys()
                  .hasOnly(['startDate', 'endDate', 'reason', 'days', 'status']) )
        // A HOD Cawangan corrects and cancels leave for their own branch, but is NOT
        // an approver — applications still route Staff → Doctor PIC → HR. The status
        // allowlist is what enforces that: 'APPROVED' is unreachable here even if a
        // future UI change offered the button. Their own record is excluded, matching
        // the separation of duties in canManageRequest().
        || ( isBranchHodOf(resource.data.branch)
             && resource.data.ic != myIC()
             && request.resource.data.status in ['PENDING', 'CANCELLED']
             && request.resource.data.ic == resource.data.ic
             && request.resource.data.branch == resource.data.branch
             && request.resource.data.diff(resource.data).affectedKeys()
                  .hasOnly(['startDate', 'endDate', 'reason', 'days', 'status', 'type']) );
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
export PATH="$PATH:/c/Program Files/Microsoft/jdk-21.0.11.10-hotspot/bin" && npx firebase emulators:exec --only firestore --project apply-leave-89ebb "node --test tests/rules.test.mjs"
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add firestore.rules tests/rules.test.mjs
git commit -m "feat(rules): let HOD Cawangan correct and cancel own-branch leave"
```

---

### Task 3: Deploy the rules

**Files:** none changed.

Rules must be live before the UI starts offering the buttons, otherwise the HOD sees the same failure this whole change exists to remove.

- [ ] **Step 1: Deploy**

```bash
npx firebase deploy --only firestore:rules --project apply-leave-89ebb
```

Expected: `✔  Deploy complete!`

- [ ] **Step 2: Verify the deployed rules are the new ones**

```bash
npx firebase firestore:rules get --project apply-leave-89ebb 2>/dev/null | grep -c "isBranchHodOf"
```

Expected: a non-zero count. If the command is unavailable in this CLI version, open the Firebase console → Firestore → Rules and confirm `isBranchHodOf` appears.

---

### Task 4: Client — scope the staff list and hide add/delete

**Files:**
- Modify: `src/main.js:6813-6821` (the `filteredStaff` chain)
- Modify: `src/main.js:8661` (the "+ Tambah Staf" button)
- Modify: `src/main.js:6895` (the delete button in the staff row)

**Interfaces:**
- Produces: `window.isBranchScopedHod(u)` — returns `true` when `u.role === 'hod_cawangan'`. Used by Tasks 5 and 6.

- [ ] **Step 1: Add the helper**

In `src/main.js`, immediately before `window.canManageRequest = function(user, req) {` (line 1060), add:

```javascript
// A HOD Cawangan sees and edits only their own branch. Deliberately NOT folded
// into canManageRequest(): that function also gates the approve/reject controls,
// and a HOD Cawangan is not an approver — leave still routes through Doctor PIC.
window.isBranchScopedHod = function(u) {
  return !!u && u.role === 'hod_cawangan';
};
```

- [ ] **Step 2: Scope the staff list to the HOD's branch**

In `src/main.js`, immediately after the `filteredStaff` initialiser block that ends at line 6818 (`});`), insert:

```javascript
      // A HOD Cawangan manages leave figures for their own branch only; the rules
      // reject anything else, so do not list staff they cannot save.
      if (window.isBranchScopedHod(user)) {
          filteredStaff = filteredStaff.filter(s => s.branch === user.branch);
      }
```

- [ ] **Step 3: Hide "+ Tambah Staf" from a branch HOD**

Replace line 8661:

```javascript
          <button class="btn-primary" onclick="window.openAddStaff()" style="width: auto; padding: 0.75rem 1.5rem;">+ Tambah Staf</button>
```

with:

```javascript
          ${window.isBranchScopedHod(user) ? '' : `<button class="btn-primary" onclick="window.openAddStaff()" style="width: auto; padding: 0.75rem 1.5rem;">+ Tambah Staf</button>`}
```

- [ ] **Step 4: Hide the per-row delete button from a branch HOD**

Replace line 6895:

```javascript
              + '<button class="btn-logout" data-ic="' + staff.ic + '" onclick="window.deleteStaff(this.dataset.ic)" style="flex-shrink:0;width:auto;padding:0.2rem 0.65rem;font-size:0.75rem;background:rgba(239,68,68,0.1);color:#ef4444;border:1px solid rgba(239,68,68,0.25);" title="Buang dari sistem">&#10005;</button>'
```

with:

```javascript
              + (window.isBranchScopedHod(user) ? '' : '<button class="btn-logout" data-ic="' + staff.ic + '" onclick="window.deleteStaff(this.dataset.ic)" style="flex-shrink:0;width:auto;padding:0.2rem 0.65rem;font-size:0.75rem;background:rgba(239,68,68,0.1);color:#ef4444;border:1px solid rgba(239,68,68,0.25);" title="Buang dari sistem">&#10005;</button>')
```

- [ ] **Step 5: Build to confirm no syntax error**

```bash
npm run build
```

Expected: `✓ built in …`, no errors.

- [ ] **Step 6: Commit**

```bash
git add src/main.js
git commit -m "feat(staff): scope the staff list to own branch for HOD Cawangan"
```

---

### Task 5: Client — hide non-leave fields in the Edit Staff modal

**Files:**
- Modify: `src/main.js:10197-10269` (profile field block plus the two checkbox blocks inside `#edit-entitlement-form`)

**Interfaces:**
- Consumes: `window.isBranchScopedHod(u)` from Task 4.

**Background the implementer needs:** the submit handler at `src/main.js:5099-5117` reads these controls defensively — `if (branchSelect) …`, `if (statusSelect) …` — and only adds a key to `updates` when the control exists. All four `<select>` elements in `#edit-entitlement-form` (branch, category, role, status) live inside the block being hidden, and the positional lookups `editForm.querySelectorAll('select')[0..2]` therefore return `undefined` rather than picking up a different control. So hiding the markup is sufficient; the handler needs no change. `apply_prorate` and `leaveAsAdmin` sit just below and are NOT in the 22-key allowlist, so they must be hidden too or every HOD save fails `hasOnly`.

- [ ] **Step 1: Wrap the profile block in a permission check**

In `src/main.js`, wrap the region from the opening `<div style="margin-bottom: 3rem; display: flex; flex-direction: column; gap: 1.5rem;">` (line 10197) through the closing `</div>` of the `leaveAsAdmin` block (line 10269) so it renders only for full staff managers. Change line 10197 from:

```html
          <div style="margin-bottom: 3rem; display: flex; flex-direction: column; gap: 1.5rem;">
```

to:

```html
          ${window.isBranchScopedHod(user) ? `
          <div style="margin-bottom: 2rem; padding: 0.9rem 1.1rem; border-radius: 10px; background: rgba(56,189,248,0.07); border-left: 4px solid #38bdf8;">
            <span style="font-size:0.78rem;font-weight:700;color:#38bdf8;">Anda boleh kemaskini baki &amp; kelayakan cuti sahaja.</span>
            <div style="font-size:0.7rem;color:var(--text-muted);margin-top:0.25rem;line-height:1.4;">Peranan, cawangan, kategori, status akaun, telefon dan kata laluan diuruskan oleh HR/Admin.</div>
          </div>` : `
          <div style="margin-bottom: 3rem; display: flex; flex-direction: column; gap: 1.5rem;">
```

- [ ] **Step 2: Close the conditional after the leaveAsAdmin block**

Change line 10269 (the `</div>` that closes the `leaveAsAdmin` block) from:

```html
          </div>
```

to:

```html
          </div>`}
```

Note the backtick-brace closes the template literal opened in Step 1.

- [ ] **Step 3: Build to confirm the template literal is balanced**

```bash
npm run build
```

Expected: `✓ built in …`. A template-literal imbalance shows up here as a parse error — if it fails, re-check the backticks added in Steps 1 and 2.

- [ ] **Step 4: Verify the hidden controls really are absent for the HOD path**

```bash
node -e "
const fs=require('fs');
const s=fs.readFileSync('src/main.js','utf8');
const i=s.indexOf('isBranchScopedHod(user) ?');
console.log('conditional present:', i>0);
console.log('notice copy present:', s.includes('baki &amp; kelayakan cuti sahaja'));
"
```

Expected: both `true`.

- [ ] **Step 5: Commit**

```bash
git add src/main.js
git commit -m "feat(staff): show only leave fields to a HOD Cawangan in the edit modal"
```

---

### Task 6: Client — branch leave records with Edit and Batal

**Files:**
- Modify: `src/main.js` — add `window.canCorrectBranchLeave` next to `window.isBranchScopedHod` (after line 1060 region)
- Modify: `src/main.js:5593-5812` (`renderBranchDashboard`) — add a records table
- Modify: `src/main.js:2581-2595` (`window.cancelLeave`) — accept a branch HOD
- Modify: `src/main.js:5173-5181` (leave edit modal submit guard) — accept a branch HOD

**Background the implementer needs:** `renderBranchDashboard()` currently only aggregates `branchRecords` into counts and charts — it never lists individual records, so there is no existing place for a HOD to click Edit or Batal. This task adds that list. `branchRecords` is already filtered to `user.branch` at line 5598.

**Interfaces:**
- Produces: `window.canCorrectBranchLeave(u, req)` → `boolean`.

- [ ] **Step 1: Add the helper**

Directly below the `window.isBranchScopedHod` function added in Task 4, add:

```javascript
// Correct/cancel rights for a HOD Cawangan over their own branch. Mirrors the
// firestore.rules grant exactly: own branch, never their own record. Approval is
// deliberately absent — the rules reject any status other than PENDING/CANCELLED.
window.canCorrectBranchLeave = function(u, req) {
  if (!u || !req) return false;
  if (!window.isBranchScopedHod(u)) return false;
  if (req.ic === u.ic) return false;
  return req.branch === u.branch;
};
```

- [ ] **Step 2: Let a branch HOD cancel**

In `window.cancelLeave` (line 2592), replace:

```javascript
    if (!window.canManageRequest(user, req)) {
        alert('Anda tidak mempunyai kebenaran untuk menguruskan cawangan/staf ini.');
        return;
    }
```

with:

```javascript
    if (!window.canManageRequest(user, req) && !window.canCorrectBranchLeave(user, req)) {
        alert('Anda tidak mempunyai kebenaran untuk menguruskan cawangan/staf ini.');
        return;
    }
```

- [ ] **Step 3: Let a branch HOD edit a record**

In the leave edit modal submit handler (line 5175), replace:

```javascript
              const isApprover = window.canManageRequest(user, rec);
```

with:

```javascript
              const isApprover = window.canManageRequest(user, rec) || window.canCorrectBranchLeave(user, rec);
```

This reuses the existing non-admin path, which forces `status = 'PENDING'` on save — matching the rules allowlist.

- [ ] **Step 4: Add the records table to the branch dashboard**

In `renderBranchDashboard()`, immediately before the final closing `` ` `` of the returned template literal (the last line before `}` at line 5812), insert:

```javascript
      ${window.isBranchScopedHod(user) ? `
      <section class="glass-card" style="padding:1rem 1.25rem;margin-top:1.5rem;">
        <div style="font-size:0.72rem;text-transform:uppercase;color:var(--text-muted);font-weight:700;letter-spacing:0.5px;margin-bottom:0.75rem;">Rekod Cuti Cawangan</div>
        <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:0.82rem;">
          <thead><tr style="text-align:left;color:var(--text-muted);font-size:0.72rem;text-transform:uppercase;">
            <th style="padding:0.4rem 0.5rem;">Nama</th><th style="padding:0.4rem 0.5rem;">Jenis</th>
            <th style="padding:0.4rem 0.5rem;">Tarikh</th><th style="padding:0.4rem 0.5rem;">Hari</th>
            <th style="padding:0.4rem 0.5rem;">Status</th><th style="padding:0.4rem 0.5rem;">Tindakan</th>
          </tr></thead>
          <tbody>
            ${branchRecords.length === 0
              ? '<tr><td colspan="6" style="text-align:center;padding:1.5rem;color:var(--text-muted);">Tiada rekod cuti untuk cawangan ini.</td></tr>'
              : branchRecords.map(r => `
              <tr style="border-top:1px solid rgba(163,177,198,0.18);">
                <td style="padding:0.45rem 0.5rem;font-weight:600;">${r.name || ''}</td>
                <td style="padding:0.45rem 0.5rem;">${leaveTypeName(r.type)}</td>
                <td style="padding:0.45rem 0.5rem;color:var(--text-muted);">${r.startDate} → ${r.endDate}</td>
                <td style="padding:0.45rem 0.5rem;">${r.days}</td>
                <td style="padding:0.45rem 0.5rem;"><span class="status-badge ${(r.status || '').toLowerCase()}">${r.status}</span></td>
                <td style="padding:0.45rem 0.5rem;white-space:nowrap;">
                  ${window.canCorrectBranchLeave(user, r) && !['CANCELLED'].includes(r.status) ? `
                    <button class="neu-btn" onclick="window.editLeave(${r.id})" style="width:auto;padding:0.2rem 0.55rem;font-size:0.72rem;color:#60a5fa;">Edit</button>
                    <button class="neu-btn" onclick="window.cancelLeave(${r.id})" style="width:auto;padding:0.2rem 0.55rem;font-size:0.72rem;color:#ef4444;">Batal</button>
                  ` : ''}
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
        </div>
      </section>` : ''}
```

- [ ] **Step 5: Build**

```bash
npm run build
```

Expected: `✓ built in …`, no errors.

- [ ] **Step 6: Commit**

```bash
git add src/main.js
git commit -m "feat(branch): let a HOD Cawangan correct and cancel own-branch leave"
```

---

### Task 7: Deploy and verify end to end

**Files:** none changed.

- [ ] **Step 1: Run every local test suite**

`tests/rules.test.mjs` and `tests/functions.test.mjs` both need the emulator and fail if run standalone, so list the pure-unit suites explicitly rather than pointing `node --test` at the directory:

```bash
node --test tests/formulaBTypes.test.mjs tests/leaveBalance.test.mjs tests/leaveDays.test.mjs tests/leaveTypes.test.mjs tests/loginBranches.test.mjs tests/nameFormat.test.mjs tests/phoneFormat.test.mjs
(cd otp-backend && node --test lib/cors.test.js lib/otp.test.js lib/routing.test.js)
```

Expected: all pass.

- [ ] **Step 2: Run the emulator rules suite once more**

```bash
export PATH="$PATH:/c/Program Files/Microsoft/jdk-21.0.11.10-hotspot/bin" && npx firebase emulators:exec --only firestore --project apply-leave-89ebb "node --test tests/rules.test.mjs"
```

Expected: all pass.

- [ ] **Step 3: Push (auto-deploys frontend to cPanel)**

```bash
git push origin main
```

- [ ] **Step 4: Confirm the cPanel deploy succeeded**

```bash
gh run list --limit 1
```

Expected: `completed  success  …  Deploy to cPanel`.

- [ ] **Step 5: Confirm the live bundle changed**

```bash
curl -s -L https://cuti-staff.ksbsb.com.my | grep -o -E 'assets/index-[A-Za-z0-9_-]+\.js'
```

Expected: matches the filename printed by the last `npm run build`.

- [ ] **Step 6: Tell the user what to check**

NURUL AIN must log out and log back in, then confirm: the Staff tab lists only Klinik Rakyat dan X-Ray Dungun; the edit modal shows leave fields only; saving a balance succeeds; the branch dashboard lists records with Edit/Batal.

---

## Notes for the reviewer

- `settings/rbac.hod_cawangan.manage_staff` is already `true` in Firestore and the code default in `window.rbacMatrix` was aligned in commit `32a659b`. No RBAC change is part of this plan.
- `config/rolePermissions.hod_cawangan` is `{ canApprove: false, manageStaff: false }` and must stay that way. If a task tempts you to re-provision claims, the design has been misread.
- The broader trap — Access Control can grant permissions the claims do not back, silently — is deliberately out of scope here and remains open.
