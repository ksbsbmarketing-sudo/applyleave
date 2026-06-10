# Firebase Auth & Role Enforcement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move identity into Firebase Auth + custom claims so Firestore rules can enforce roles — staff edit only their own leave's date/reason (which resets approval to PENDING), and only approver roles change approval status.

**Architecture:** Each staff gets a Firebase Auth account (`{ic}@ksb-leave.local`). A Cloud Function syncs custom claims `{ic, canApprove, manageStaff}` from the `staff` collection and maintains a sanitized `directory` for the pre-login picker. A one-time script provisions existing staff. The client switches login/password to Auth, gains a staff self-edit UI, and role-aware Firestore rules enforce the boundary.

**Tech Stack:** Vite, Firebase (Auth, Firestore, Cloud Functions Gen2 on Blaze), `firebase-admin`, `@firebase/rules-unit-testing`, Node built-in test runner, Firebase Emulator Suite.

**Spec:** `docs/superpowers/specs/2026-06-09-firebase-auth-role-enforcement-design.md`

**Conventions used throughout:**
- Auth email helper: `emailForIC(ic) = `${String(ic).replace(/[^a-zA-Z0-9]/g,'')}@ksb-leave.local``. The same stripping rule is used everywhere (function, script, client) so a given IC always maps to one email.
- Project id: `apply-leave-89ebb`.
- All work happens on branch `feat/firebase-auth-role-enforcement`.

---

## Phase 0 — Emulator & test tooling

### Task 1: Install dev dependencies and configure emulators

**Files:**
- Modify: `package.json`
- Modify: `firebase.json`

- [ ] **Step 1: Install test/emulator dev deps**

Run:
```bash
npm install --save-dev @firebase/rules-unit-testing firebase-functions-test
```
Expected: packages added to `devDependencies`, no errors. (`firebase-tools`, `firebase-admin`, `firebase` are already present.)

- [ ] **Step 2: Add functions + emulator config to `firebase.json`**

Replace the file contents with:
```json
{
  "firestore": {
    "rules": "firestore.rules",
    "indexes": "firestore.indexes.json"
  },
  "functions": {
    "source": "functions"
  },
  "hosting": {
    "public": "dist",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [{ "source": "**", "destination": "/index.html" }]
  },
  "emulators": {
    "auth": { "port": 9099 },
    "firestore": { "port": 8080 },
    "functions": { "port": 5001 },
    "ui": { "enabled": true }
  }
}
```

- [ ] **Step 3: Verify the Firebase CLI sees the config**

Run: `npx firebase emulators:start --only firestore --project apply-leave-89ebb` then Ctrl-C once it prints "All emulators ready".
Expected: Firestore emulator boots on port 8080 with no config errors.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json firebase.json
git commit -m "chore(auth): add emulator config and rules-testing dev deps"
```

---

## Phase 1 — Role-permission config

### Task 2: Seed `config/rolePermissions`

This document is the single source of truth the Cloud Function reads to derive claims. Keys mirror the in-app RBAC matrix (`manage_pending` → `canApprove`, `manage_staff` → `manageStaff`).

**Files:**
- Create: `seed-role-permissions.js`

- [ ] **Step 1: Write the seed script**

```js
// seed-role-permissions.js — writes config/rolePermissions from the RBAC matrix.
// Run against the emulator OR prod (ADC). Idempotent.
import admin from "firebase-admin";

admin.initializeApp({ projectId: "apply-leave-89ebb" });
const db = admin.firestore();

// canApprove = RBAC manage_pending; manageStaff = RBAC manage_staff
const ROLE_PERMISSIONS = {
  super_admin:  { canApprove: true,  manageStaff: true  },
  admin:        { canApprove: true,  manageStaff: true  },
  hr:           { canApprove: true,  manageStaff: true  },
  hod_cawangan: { canApprove: false, manageStaff: false },
  hod_balok:    { canApprove: true,  manageStaff: false },
  doctor_pic:   { canApprove: true,  manageStaff: false },
  supervisor:   { canApprove: true,  manageStaff: false },
  team_leader:  { canApprove: true,  manageStaff: false },
  staff:        { canApprove: false, manageStaff: false },
  juru_xray:    { canApprove: false, manageStaff: false },
  sonographer:  { canApprove: false, manageStaff: false },
  juru_audio:   { canApprove: false, manageStaff: false },
};

async function main() {
  await db.doc("config/rolePermissions").set(ROLE_PERMISSIONS);
  console.log("✅ Wrote config/rolePermissions:", Object.keys(ROLE_PERMISSIONS).length, "roles");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

> Note: `hod_cawangan` has `manage_pending: false` in the matrix (main.js:732), so `canApprove: false` — it is NOT an approver. This matches the current code.

- [ ] **Step 2: Run it against the emulator to verify**

Run:
```bash
npx firebase emulators:exec --only firestore --project apply-leave-89ebb "node seed-role-permissions.js"
```
Expected: prints `✅ Wrote config/rolePermissions: 12 roles` and exits 0.

- [ ] **Step 3: Commit**

```bash
git add seed-role-permissions.js
git commit -m "feat(auth): seed config/rolePermissions for claim derivation"
```

---

## Phase 2 — Firestore rules (TDD)

### Task 3: Write failing rules tests

**Files:**
- Create: `tests/rules.test.mjs`

- [ ] **Step 1: Write the rules test suite**

```js
// tests/rules.test.mjs — run via: firebase emulators:exec --only firestore "node --test tests/rules.test.mjs"
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { setDoc, getDoc, updateDoc, doc } from "firebase/firestore";

let testEnv;

// Auth-token shapes -----------------------------------------------------------
const staffAuth   = (ic) => ({ ic, canApprove: false, manageStaff: false, firebase: { sign_in_provider: "password" } });
const approverAuth = (ic) => ({ ic, canApprove: true,  manageStaff: false, firebase: { sign_in_provider: "password" } });
const hrAuth      = (ic) => ({ ic, canApprove: true,  manageStaff: true,  firebase: { sign_in_provider: "password" } });
const anonAuth    = ()   => ({ firebase: { sign_in_provider: "anonymous" } });

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "apply-leave-89ebb",
    firestore: { rules: readFileSync("firestore.rules", "utf8") },
  });
});
after(async () => { await testEnv.cleanup(); });

beforeEach(async () => {
  await testEnv.clearFirestore();
  // Seed an existing PENDING leave owned by staff "S1"
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "leaves", "L1"), {
      ic: "S1", name: "ALI", branch: "Klinik A", type: "annual",
      startDate: "2026-07-01", endDate: "2026-07-03", days: 3, reason: "cuti", status: "PENDING",
    });
    await setDoc(doc(db, "leaves", "L2"), {
      ic: "S1", name: "ALI", branch: "Klinik A", type: "annual",
      startDate: "2026-08-01", endDate: "2026-08-02", days: 2, reason: "x", status: "TL APPROVED",
    });
    await setDoc(doc(db, "staff", "S1"), { ic: "S1", name: "ALI", branch: "Klinik A", role: "staff", phone: "60100000000" });
  });
});

const ctxDb = (authToken) =>
  (authToken ? testEnv.authenticatedContext(authToken.ic || "anon", authToken) : testEnv.unauthenticatedContext()).firestore();

test("owner can edit own PENDING leave date/reason (status stays PENDING)", async () => {
  const db = ctxDb(staffAuth("S1"));
  await assertSucceeds(updateDoc(doc(db, "leaves", "L1"), { startDate: "2026-07-05", reason: "tukar", status: "PENDING" }));
});

test("owner editing a TL APPROVED leave must reset status to PENDING", async () => {
  const db = ctxDb(staffAuth("S1"));
  // changing date but leaving status TL APPROVED → denied
  await assertFails(updateDoc(doc(db, "leaves", "L2"), { startDate: "2026-08-05", status: "TL APPROVED" }));
  // resetting to PENDING → allowed
  await assertSucceeds(updateDoc(doc(db, "leaves", "L2"), { startDate: "2026-08-05", status: "PENDING" }));
});

test("owner cannot self-approve own leave", async () => {
  const db = ctxDb(staffAuth("S1"));
  await assertFails(updateDoc(doc(db, "leaves", "L1"), { status: "APPROVED" }));
});

test("owner cannot edit a leave that is not theirs", async () => {
  const db = ctxDb(staffAuth("S2"));
  await assertFails(updateDoc(doc(db, "leaves", "L1"), { reason: "hack", status: "PENDING" }));
});

test("approver can change status to HOD APPROVED", async () => {
  const db = ctxDb(approverAuth("SUP"));
  await assertSucceeds(updateDoc(doc(db, "leaves", "L1"), { status: "HOD APPROVED" }));
});

test("staff can create own PENDING leave", async () => {
  const db = ctxDb(staffAuth("S1"));
  await assertSucceeds(setDoc(doc(db, "leaves", "L3"), { ic: "S1", status: "PENDING", startDate: "x", endDate: "y", reason: "z" }));
});

test("staff cannot create a leave for someone else", async () => {
  const db = ctxDb(staffAuth("S1"));
  await assertFails(setDoc(doc(db, "leaves", "L4"), { ic: "S2", status: "PENDING" }));
});

test("anonymous can read directory but not staff", async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "directory", "S1"), { ic: "S1", name: "ALI", branch: "Klinik A" });
  });
  const db = ctxDb(anonAuth());
  await assertSucceeds(getDoc(doc(db, "directory", "S1")));
  await assertFails(getDoc(doc(db, "staff", "S1")));
});

test("staff can update only phone/email/address of own profile", async () => {
  const db = ctxDb(staffAuth("S1"));
  await assertSucceeds(updateDoc(doc(db, "staff", "S1"), { phone: "60111111111" }));
  await assertFails(updateDoc(doc(db, "staff", "S1"), { role: "super_admin" }));
});

test("only manageStaff can write staff records", async () => {
  const approver = ctxDb(approverAuth("SUP"));
  await assertFails(setDoc(doc(approver, "staff", "S9"), { ic: "S9", role: "staff" }));
  const hr = ctxDb(hrAuth("HR1"));
  await assertSucceeds(setDoc(doc(hr, "staff", "S9"), { ic: "S9", role: "staff" }));
});
```

- [ ] **Step 2: Run the tests against the CURRENT rules — expect failures**

Run:
```bash
npx firebase emulators:exec --only firestore --project apply-leave-89ebb "node --test tests/rules.test.mjs"
```
Expected: multiple FAILs. The current rules (`allow read, write: if request.auth != null`) permit everything, so the "cannot"/"only" assertions (`assertFails`) fail. This confirms the tests exercise real behavior.

- [ ] **Step 3: Commit the failing tests**

```bash
git add tests/rules.test.mjs package.json
git commit -m "test(rules): add role-enforcement rules tests (failing)"
```

### Task 4: Write the role-aware rules to make tests pass

**Files:**
- Modify: `firestore.rules`

- [ ] **Step 1: Replace `firestore.rules` with the role-aware ruleset**

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function signedIn() {
      return request.auth != null
        && request.auth.token.firebase.sign_in_provider != 'anonymous';
    }
    function myIC() { return request.auth.token.ic; }
    function canApprove() { return signedIn() && request.auth.token.canApprove == true; }
    function manageStaff() { return signedIn() && request.auth.token.manageStaff == true; }

    // Pre-login picker — readable by anyone (incl. anonymous bootstrap). Written only by the Cloud Function (Admin SDK bypasses rules).
    match /directory/{id} {
      allow read: if request.auth != null;
      allow write: if false;
    }

    // Account signup is created by not-yet-staff (anonymous allowed); managed by HR/Admin.
    match /registration_requests/{id} {
      allow read, update, delete: if manageStaff();
      allow create: if request.auth != null;
    }

    match /staff/{ic} {
      allow read: if signedIn();
      allow create, delete: if manageStaff();
      allow update: if manageStaff()
        || ( myIC() == ic
             && request.resource.data.diff(resource.data).affectedKeys()
                  .hasOnly(['phone', 'email', 'address']) );
    }

    match /leaves/{id} {
      allow read: if signedIn();
      allow create: if canApprove()
        || ( signedIn()
             && request.resource.data.ic == myIC()
             && request.resource.data.status in ['PENDING', 'HOD APPROVED'] );
      allow update: if canApprove()
        || ( signedIn()
             && resource.data.ic == myIC()
             && request.resource.data.status == 'PENDING'
             && request.resource.data.ic == resource.data.ic
             && request.resource.data.name == resource.data.name
             && request.resource.data.branch == resource.data.branch
             && request.resource.data.type == resource.data.type
             && request.resource.data.diff(resource.data).affectedKeys()
                  .hasOnly(['startDate', 'endDate', 'reason', 'days', 'status']) );
      allow delete: if canApprove();
    }

    match /branches/{id} {
      allow read: if signedIn();
      allow write: if manageStaff();
    }

    match /config/{id}        { allow read: if signedIn(); allow write: if canApprove(); }
    match /system_config/{id} { allow read: if signedIn(); allow write: if canApprove(); }
    match /settings/{id}      { allow read: if signedIn(); allow write: if canApprove(); }

    match /sessions/{ic} {
      allow read: if signedIn();
      allow create, update: if signedIn() && myIC() == ic;
      allow delete: if signedIn();
    }

    match /messenger_rooms/{id}    { allow read, write: if signedIn(); }
    match /messenger_messages/{id} { allow read, write: if signedIn(); }
    match /notifications/{id}      { allow read, write: if signedIn(); }
    match /user_presence/{id}      { allow read, write: if signedIn(); }

    match /audit_logs/{id} { allow read, create: if signedIn(); allow update: if false; allow delete: if manageStaff(); }
    match /wa_logs/{id}    { allow read, create: if signedIn(); allow update: if false; allow delete: if manageStaff(); }
  }
}
```

- [ ] **Step 2: Run the rules tests — expect all pass**

Run:
```bash
npx firebase emulators:exec --only firestore --project apply-leave-89ebb "node --test tests/rules.test.mjs"
```
Expected: all tests PASS (0 failures).

- [ ] **Step 3: Commit**

```bash
git add firestore.rules
git commit -m "feat(rules): enforce roles — staff edit own pending leave, approvers approve"
```

---

## Phase 3 — Cloud Function (claims sync + password reset)

### Task 5: Scaffold the functions package

**Files:**
- Create: `functions/package.json`
- Create: `functions/index.js`
- Create: `functions/.gitignore`

- [ ] **Step 1: Create `functions/package.json`**

```json
{
  "name": "ksb-leave-functions",
  "description": "Auth claim sync + admin password reset for KSB Leave Apply",
  "type": "module",
  "engines": { "node": "20" },
  "main": "index.js",
  "dependencies": {
    "firebase-admin": "^13.7.0",
    "firebase-functions": "^6.0.0"
  }
}
```

- [ ] **Step 2: Create `functions/.gitignore`**

```
node_modules/
```

- [ ] **Step 3: Create `functions/index.js` with the claim-sync trigger and password callable**

```js
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";

admin.initializeApp();

const AUTH_EMAIL_DOMAIN = "ksb-leave.local";
const emailForIC = (ic) => `${String(ic).replace(/[^a-zA-Z0-9]/g, "")}@${AUTH_EMAIL_DOMAIN}`;

async function loadRolePerms() {
  const snap = await admin.firestore().doc("config/rolePermissions").get();
  return snap.exists ? snap.data() : {};
}

async function ensureAuthUser(email, password, name) {
  try {
    return await admin.auth().getUserByEmail(email);
  } catch {
    return await admin.auth().createUser({ email, password: password || "changeme00", displayName: name || email });
  }
}

// Keep custom claims + directory in sync with the staff collection.
export const onStaffWrite = onDocumentWritten("staff/{ic}", async (event) => {
  const ic = event.params.ic;
  const email = emailForIC(ic);
  const after = event.data?.after?.exists ? event.data.after.data() : null;

  // Deleted staff → disable auth account + drop directory entry.
  if (!after) {
    try {
      const u = await admin.auth().getUserByEmail(email);
      await admin.auth().updateUser(u.uid, { disabled: true });
    } catch { /* no auth account */ }
    await admin.firestore().doc(`directory/${ic}`).delete().catch(() => {});
    return;
  }

  const perms = await loadRolePerms();
  const rp = perms[after.role] || { canApprove: false, manageStaff: false };
  const claims = { ic, canApprove: !!rp.canApprove, manageStaff: !!rp.manageStaff };

  const u = await ensureAuthUser(email, after.password || String(ic), after.name);
  await admin.auth().setCustomUserClaims(u.uid, claims);
  await admin.auth().updateUser(u.uid, { disabled: !!after.inactive });

  await admin.firestore().doc(`directory/${ic}`).set({
    ic,
    name: after.name || "",
    branch: after.branch || "",
    inactive: !!after.inactive,
  });
});

// Admin/HR sets another staff's password (the browser cannot under Auth).
export const setStaffPassword = onCall(async (request) => {
  if (!request.auth || request.auth.token.manageStaff !== true) {
    throw new HttpsError("permission-denied", "Hanya HR/Admin boleh menetapkan kata laluan.");
  }
  const ic = request.data?.ic;
  const newPassword = request.data?.newPassword;
  if (!ic || !newPassword || String(newPassword).length < 4) {
    throw new HttpsError("invalid-argument", "IC dan kata laluan (min 4 aksara) diperlukan.");
  }
  const u = await admin.auth().getUserByEmail(emailForIC(ic));
  await admin.auth().updateUser(u.uid, { password: String(newPassword) });
  return { ok: true };
});
```

- [ ] **Step 4: Install function deps**

Run: `cd functions && npm install && cd ..`
Expected: `functions/node_modules` created, no errors.

- [ ] **Step 5: Commit**

```bash
git add functions/package.json functions/.gitignore functions/index.js functions/package-lock.json
git commit -m "feat(functions): scaffold claim-sync trigger and setStaffPassword callable"
```

### Task 6: Emulator test — staff write sets claims + directory

**Files:**
- Create: `tests/functions.test.mjs`

- [ ] **Step 1: Write the function test**

```js
// tests/functions.test.mjs
// Run via: firebase emulators:exec --only firestore,auth,functions "node --test tests/functions.test.mjs"
import { test, before } from "node:test";
import assert from "node:assert";
import admin from "firebase-admin";

// Point Admin SDK at the emulators.
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";

before(() => { admin.initializeApp({ projectId: "apply-leave-89ebb" }); });

const emailForIC = (ic) => `${String(ic).replace(/[^a-zA-Z0-9]/g, "")}@ksb-leave.local`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test("creating a supervisor staff doc yields canApprove claim", async () => {
  const db = admin.firestore();
  await db.doc("config/rolePermissions").set({
    supervisor: { canApprove: true, manageStaff: false },
    staff: { canApprove: false, manageStaff: false },
  });
  await db.doc("staff/T100").set({ ic: "T100", name: "SUP ONE", branch: "Klinik A", role: "supervisor" });

  await wait(4000); // allow the trigger to run in the emulator

  const u = await admin.auth().getUserByEmail(emailForIC("T100"));
  assert.strictEqual(u.customClaims.canApprove, true);
  assert.strictEqual(u.customClaims.manageStaff, false);
  assert.strictEqual(u.customClaims.ic, "T100");

  const dir = await db.doc("directory/T100").get();
  assert.strictEqual(dir.data().name, "SUP ONE");
});
```

- [ ] **Step 2: Run it**

Run:
```bash
npx firebase emulators:exec --only firestore,auth,functions --project apply-leave-89ebb "node --test tests/functions.test.mjs"
```
Expected: PASS. (If it flakes on timing, raise the `wait` to 6000.)

- [ ] **Step 3: Commit**

```bash
git add tests/functions.test.mjs
git commit -m "test(functions): verify onStaffWrite sets claims and directory"
```

---

## Phase 4 — One-time provisioning script

### Task 7: Write `provision-auth.js`

**Files:**
- Create: `provision-auth.js`

- [ ] **Step 1: Write the script**

```js
// provision-auth.js — one-time backfill: Auth accounts + claims + directory for all staff.
// Also creates the break-glass IT super_admin account.
// Run with ADC: node provision-auth.js     (set IT_ADMIN_PASSWORD to provision the IT account)
import admin from "firebase-admin";

admin.initializeApp({ projectId: "apply-leave-89ebb" });
const auth = admin.auth();
const db = admin.firestore();

const DOMAIN = "ksb-leave.local";
const emailForIC = (ic) => `${String(ic).replace(/[^a-zA-Z0-9]/g, "")}@${DOMAIN}`;

async function ensureUser(email, password, name) {
  try { return await auth.getUserByEmail(email); }
  catch { return await auth.createUser({ email, password: password || "changeme00", displayName: name || email }); }
}

async function loadPerms() {
  const s = await db.doc("config/rolePermissions").get();
  if (!s.exists) throw new Error("config/rolePermissions missing — run seed-role-permissions.js first.");
  return s.data();
}

async function main() {
  const perms = await loadPerms();
  const staff = await db.collection("staff").get();
  let n = 0;
  for (const d of staff.docs) {
    const s = d.data();
    const ic = d.id;
    const u = await ensureUser(emailForIC(ic), s.password || String(ic), s.name);
    const rp = perms[s.role] || { canApprove: false, manageStaff: false };
    await auth.setCustomUserClaims(u.uid, { ic, canApprove: !!rp.canApprove, manageStaff: !!rp.manageStaff });
    await auth.updateUser(u.uid, { disabled: !!s.inactive });
    await db.doc(`directory/${ic}`).set({ ic, name: s.name || "", branch: s.branch || "", inactive: !!s.inactive });
    n++;
    if (n % 10 === 0) process.stdout.write(".");
  }
  console.log(`\n✅ Provisioned ${n} staff accounts.`);

  // Break-glass IT super_admin (ic = "itadmin" so emailForIC is stable).
  const itPwd = process.env.IT_ADMIN_PASSWORD;
  if (itPwd) {
    const ic = "itadmin";
    await db.doc(`staff/${ic}`).set({
      ic, name: "IT SUPER ADMIN", branch: "Management / HQ", category: "Super Admin",
      role: "super_admin", phone: "", inactive: false,
      startDate: new Date().toISOString().split("T")[0],
    }, { merge: true });
    const u = await ensureUser(emailForIC(ic), itPwd, "IT SUPER ADMIN");
    await auth.setCustomUserClaims(u.uid, { ic, canApprove: true, manageStaff: true });
    await db.doc(`directory/${ic}`).set({ ic, name: "IT SUPER ADMIN", branch: "Management / HQ", inactive: false });
    console.log("✅ Break-glass IT super_admin provisioned (itadmin).");
  } else {
    console.log("ℹ️  IT_ADMIN_PASSWORD not set — skipped break-glass account.");
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Verify against the emulator**

Run:
```bash
npx firebase emulators:exec --only firestore,auth --project apply-leave-89ebb "node seed-role-permissions.js && node -e \"const a=require('firebase-admin');a.initializeApp({projectId:'apply-leave-89ebb'});a.firestore().doc('staff/Z1').set({ic:'Z1',name:'TEST',branch:'Klinik A',role:'staff'}).then(()=>process.exit(0))\" && IT_ADMIN_PASSWORD=test1234 node provision-auth.js"
```
Expected: prints `✅ Provisioned 1 staff accounts.` and `✅ Break-glass IT super_admin provisioned`.

- [ ] **Step 3: Commit**

```bash
git add provision-auth.js
git commit -m "feat(auth): one-time provisioning script for Auth accounts, claims, directory"
```

---

## Phase 5 — Client login rewrite

> The client (`src/main.js`) has no automated test harness. For each client task the verification step is `node --check src/main.js` plus an emulator-backed manual check. Keep `node --check` green after every edit.

### Task 8: Add Auth imports and a directory loader

**Files:**
- Modify: `src/main.js:7` (auth imports)
- Modify: `src/main.js` (add directory state + loader near the firebase init block ~line 56)

- [ ] **Step 1: Expand the auth import**

Replace line 7:
```js
import { getAuth, signInAnonymously } from "firebase/auth";
```
with:
```js
import {
  getAuth,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
  EmailAuthProvider,
  reauthenticateWithCredential,
} from "firebase/auth";
import { getFunctions, httpsCallable } from "firebase/functions";
```

- [ ] **Step 2: Add functions instance + email helper + directory state after `const storage = getStorage(firebaseApp);` (line 56)**

```js
const functions = getFunctions(firebaseApp);
const AUTH_EMAIL_DOMAIN = 'ksb-leave.local';
const emailForIC = (ic) => `${String(ic).replace(/[^a-zA-Z0-9]/g, '')}@${AUTH_EMAIL_DOMAIN}`;

// Pre-login directory (branch + name + ic) loaded under the anonymous bootstrap session.
let directoryList = [];
async function loadDirectory() {
  try {
    const snap = await getDocs(collection(db, 'directory'));
    directoryList = snap.docs.map(d => d.data()).filter(s => !s.inactive);
  } catch (e) { console.error('loadDirectory failed:', e); directoryList = []; }
}
```

- [ ] **Step 3: Verify syntax**

Run: `node --check src/main.js`
Expected: no output (exit 0).

- [ ] **Step 4: Commit**

```bash
git add src/main.js
git commit -m "feat(auth): add Firebase Auth/functions imports and directory loader"
```

### Task 9: Bootstrap directory at startup and render the picker from it

**Files:**
- Modify: `src/main.js:2919` (anonymous sign-in block)
- Modify: `src/main.js:3158`+ (`renderLogin` — source of the branch/name picker)

- [ ] **Step 1: Load the directory right after the anonymous bootstrap sign-in**

Find (around line 2919):
```js
    await signInAnonymously(auth);
    console.log('[AUTH] Anonymous sign-in OK:', auth.currentUser && auth.currentUser.uid);
```
Append immediately after the `console.log`:
```js
    await loadDirectory();
```

- [ ] **Step 2: Point the login picker at `directoryList`**

In `renderLogin` and its helpers, the branch/name picker currently derives options from `staffList`. Replace the picker's data source with `directoryList` (same shape: `{ ic, name, branch }`). Concretely, wherever `renderLogin` filters staff for the dropdown — e.g. `staffList.filter(s => s.branch === selectedLoginBranch && !s.inactive)` — change `staffList` to `directoryList`. Branch list options come from `[...new Set(directoryList.map(s => s.branch))]`.

> If `staffList` is empty on the login screen today it still worked because anon could read `staff`; after the rules change anon can no longer read `staff`, so the picker MUST use `directoryList`.

- [ ] **Step 3: Verify syntax**

Run: `node --check src/main.js`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/main.js
git commit -m "feat(auth): populate login picker from directory under anon bootstrap"
```

### Task 10: Replace login authentication with Firebase Auth

**Files:**
- Modify: `src/main.js:3326-3416` (the `#login-form` submit handler)

- [ ] **Step 1: Replace the entire submit handler body**

Replace the handler registered at line 3326 (`document.querySelector('#login-form').addEventListener('submit', (e) => { ... });`) with:

```js
  document.querySelector('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const icField = document.querySelector('#login-staff');
    const pwdField = document.querySelector('#password');
    const searchInput = document.querySelector('#staff-search-input');

    let ic = (icField ? icField.value : "").trim();
    const pwd = (pwdField ? pwdField.value : "").trim();

    // Fallback: typed name without clicking the dropdown.
    if (!ic && searchInput && searchInput.value.trim()) {
      const typedName = searchInput.value.trim().toLowerCase();
      const matched = directoryList.find(s =>
        (s.branch || "").trim().toLowerCase() === (selectedLoginBranch || "").trim().toLowerCase() &&
        s.name.toLowerCase() === typedName);
      if (matched) ic = matched.ic;
    }

    if (!ic) { alert('Sila pilih nama anda dari senarai (dropdown) atau pastikan ejaan nama betul.'); return; }
    if (!pwd) { alert('Sila masukkan kata laluan.'); return; }

    try {
      await signInWithEmailAndPassword(auth, emailForIC(ic), pwd);
    } catch (err) {
      console.warn('[AUTH_FAIL]', err.code);
      if (err.code === 'auth/user-disabled') alert('⚠️ Akaun anda tidak aktif. Sila hubungi HR/Admin.');
      else alert('⚠️ RALAT: IC atau kata laluan tidak sah. Sila cuba lagi.');
      return;
    }

    // Load the staff profile for the now-authenticated user.
    const snap = await getDoc(doc(db, 'staff', ic));
    if (!snap.exists()) { alert('Profil staf tidak dijumpai. Sila hubungi HR/Admin.'); await signOut(auth); return; }
    user = snap.data();

    showFirstLoginWarning = (pwd === (user.ic || '').trim());
    const _ph = (user.phone || '').replace(/\D/g, '');
    showPhoneReminderModal = !showFirstLoginWarning && (!_ph || !_ph.startsWith('6'));
    currentSessionId = Date.now().toString() + '_' + Math.random().toString(36).substring(2);
    duplicateSessionDetected = false;
    localStorage.setItem('ksb_session_' + user.ic, currentSessionId);
    localStorage.setItem('ksb_logged_in_ic', user.ic);
    localStorage.setItem('ksb_logged_in_sid', currentSessionId);
    setDoc(doc(db, 'sessions', user.ic), {
      sessionId: currentSessionId, loginAt: Date.now(), name: user.name,
      device: navigator.userAgent.slice(0, 150)
    }).then(() => startSessionListener(user.ic, currentSessionId));
    window.logSystemActivity("Logged into system");
    window.initMessengerRooms();
    window.initInbox();
    window.initPresence();
    window.startNewMessageListener();
    window.requestNotifPermission();
    startReminderScheduler();
    view = 'dashboard';
    render();
  });
```

This removes the hardcoded master backdoor (`'superpassword'` / `'ksb-super-2026'`) and the in-browser plaintext password match. The IT break-glass account now logs in as a normal Auth account.

- [ ] **Step 2: Verify syntax**

Run: `node --check src/main.js`
Expected: exit 0.

- [ ] **Step 3: Manual check against emulators**

Run the app pointed at emulators (Task 14 documents the wiring) and confirm: a seeded staff logs in with IC+password; wrong password is rejected; the old `superpassword` no longer works.

- [ ] **Step 4: Commit**

```bash
git add src/main.js
git commit -m "feat(auth): login via Firebase Auth; remove master backdoor and plaintext match"
```

### Task 11: Re-auth on session restore + sign out on logout

**Files:**
- Modify: `src/main.js:2754-2776` (session-restore block)
- Modify: `src/main.js:3619` (logout)

- [ ] **Step 1: On logout, sign out of Firebase Auth**

Find the logout cleanup (around line 3619):
```js
  localStorage.removeItem('ksb_logged_in_ic');
  localStorage.removeItem('ksb_logged_in_sid');
```
Add immediately after:
```js
  signOut(auth).catch(() => {});
```

- [ ] **Step 2: Make session-restore require a live Auth session**

The restore block (around line 2754) re-hydrates `user` from `localStorage` after reload. Because anonymous bootstrap runs at startup, a reloaded page is only "anonymous" until the user logs in again. Update the restore so it only restores the in-app `user` if `auth.currentUser` exists and is non-anonymous:

Find where it reads `savedIC`/`savedSID` and restores the session, and wrap the restore in:
```js
      if (auth.currentUser && !auth.currentUser.isAnonymous) {
        // existing restore logic (set user from staffList/getDoc, startSessionListener, etc.)
      } else {
        // not authenticated for real — clear stale local session, stay on login
        localStorage.removeItem('ksb_logged_in_ic');
        localStorage.removeItem('ksb_logged_in_sid');
      }
```

> Firebase Auth persists the email/password session in IndexedDB across reloads, so `auth.currentUser` will be the real user after a refresh for genuinely logged-in staff; anonymous bootstrap sessions are treated as logged-out.

- [ ] **Step 3: Verify syntax**

Run: `node --check src/main.js`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/main.js
git commit -m "feat(auth): sign out on logout and gate session restore on real Auth session"
```

---

## Phase 6 — Password management

### Task 12: Staff change-password via Firebase Auth

**Files:**
- Modify: `src/main.js:1126-1156` (`window.changePassword`)

- [ ] **Step 1: Replace `changePassword` to use Auth `reauthenticate` + `updatePassword`**

```js
window.changePassword = async function(event) {
  event.preventDefault();
  const current = document.getElementById('pwd-current')?.value;
  const next    = document.getElementById('pwd-new')?.value;
  const confirm  = document.getElementById('pwd-confirm')?.value;

  if (!user) { alert('Sesi tidak sah. Sila log masuk semula.'); return; }
  if (!auth.currentUser || auth.currentUser.isAnonymous) { alert('Sesi tidak sah. Sila log masuk semula.'); return; }
  if (next !== confirm) { alert('❌ Kata laluan baharu tidak sepadan. Sila cuba lagi.'); return; }
  if ((next || '').length < 4) { alert('❌ Kata laluan baharu mesti sekurang-kurangnya 4 aksara.'); return; }

  try {
    const cred = EmailAuthProvider.credential(emailForIC(user.ic), current);
    await reauthenticateWithCredential(auth.currentUser, cred);
    await updatePassword(auth.currentUser, next);
    alert('✅ Kata laluan berjaya ditukar!');
    document.getElementById('pwd-current').value = '';
    document.getElementById('pwd-new').value = '';
    document.getElementById('pwd-confirm').value = '';
  } catch (err) {
    console.error('changePassword error:', err);
    if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
      alert('❌ Kata laluan semasa tidak betul. Sila cuba lagi.');
    } else {
      alert('Ralat menukar kata laluan. Sila cuba lagi.');
    }
  }
};
```

This no longer writes `staff.password`.

- [ ] **Step 2: Verify syntax**

Run: `node --check src/main.js`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/main.js
git commit -m "feat(auth): change password via Firebase Auth (reauth + updatePassword)"
```

### Task 13: Admin "set password" via callable + stop storing passwords on staff create

**Files:**
- Modify: `src/main.js:1331-1362` (`submitAddStaff`)
- Modify: `src/main.js:1290-1313` (`approveRegistration`)
- Modify: the admin "set password" UI handler in management (search `window.setStaffPassword` or the management password input; if none exists, add `window.adminSetPassword`)

- [ ] **Step 1: Add an admin set-password helper that calls the Cloud Function**

Add near `changePassword`:
```js
window.adminSetPassword = async function(ic, newPassword) {
  if (!newPassword || newPassword.length < 4) { alert('Kata laluan mesti sekurang-kurangnya 4 aksara.'); return; }
  try {
    const fn = httpsCallable(functions, 'setStaffPassword');
    await fn({ ic, newPassword });
    alert('✅ Kata laluan staf berjaya ditetapkan.');
  } catch (err) {
    console.error('adminSetPassword error:', err);
    alert('Ralat menetapkan kata laluan: ' + (err.message || err.code));
  }
};
```
Wire the management UI's "set password" control to call `window.adminSetPassword(ic, value)` instead of writing `staff.password`.

- [ ] **Step 2: Stop writing `password` in `submitAddStaff`**

In `submitAddStaff`, remove `password` from the new-staff object. Replace:
```js
  const password = form.querySelector('#as-password').value || ic;
  ...
  const newStaff = { name, ic, branch, category, role, phone, password, inactive: false, startDate: new Date().toISOString().split('T')[0] };
```
with:
```js
  const initialPassword = form.querySelector('#as-password')?.value || ic;
  ...
  const newStaff = { name, ic, branch, category, role, phone, inactive: false, startDate: new Date().toISOString().split('T')[0] };
```
After the `await setDoc(doc(db, 'staff', ic), newStaff);` succeeds, set the initial password through the callable (the Cloud Function will have just created the Auth account from the staff write):
```js
    // Give the trigger a moment to create the Auth account, then set the chosen password.
    setTimeout(() => window.adminSetPassword(ic, initialPassword), 4000);
```

- [ ] **Step 3: Stop writing `password` in `approveRegistration`**

In `approveRegistration`, remove `password: req.ic` from the `newStaff` object (the trigger defaults the Auth password to the IC). The welcome WhatsApp already tells them the password is their IC — keep that message.

- [ ] **Step 4: Verify syntax**

Run: `node --check src/main.js`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/main.js
git commit -m "feat(auth): admin set-password via callable; stop storing plaintext passwords"
```

---

## Phase 7 — Staff self-edit UI (date + reason, with confirm + re-approval)

### Task 14: Add a staff self-edit action with diff-confirmation

**Files:**
- Modify: `src/main.js` — add `window.staffEditOwnLeave(id)` near `editLeave` (~line 1804)
- Modify: `src/main.js` — render an "Edit Tarikh/Sebab" button on the staff's own PENDING/pre-final leave rows (the staff dashboard leave list)

- [ ] **Step 1: Add the self-edit function**

```js
// Staff edits their OWN leave's dates/reason. Resets to PENDING (re-approval),
// after a before→after confirmation of exactly what changed.
window.staffEditOwnLeave = async function(id) {
  const rec = leaveRecords.find(r => r.id === id);
  if (!rec) return;
  if (rec.ic !== user.ic) { alert('Anda hanya boleh mengubah permohonan anda sendiri.'); return; }
  if (['APPROVED', 'REJECTED', 'CANCELLED'].includes(rec.status)) {
    alert('Permohonan ini sudah selesai dan tidak boleh diubah.'); return;
  }

  const newStart = prompt('Tarikh Mula (YYYY-MM-DD):', rec.startDate);
  if (newStart === null) return;
  const newEnd = prompt('Tarikh Akhir (YYYY-MM-DD):', rec.endDate);
  if (newEnd === null) return;
  const newReason = prompt('Sebab:', rec.reason);
  if (newReason === null) return;

  // Build a diff of only what changed.
  const changes = [];
  if (newStart !== rec.startDate) changes.push(`• Tarikh Mula: ${rec.startDate} → ${newStart}`);
  if (newEnd !== rec.endDate)     changes.push(`• Tarikh Akhir: ${rec.endDate} → ${newEnd}`);
  if (newReason !== rec.reason)   changes.push(`• Sebab: "${rec.reason}" → "${newReason}"`);
  if (!changes.length) { alert('Tiada perubahan dibuat.'); return; }

  const days = window.computeLeaveDays ? window.computeLeaveDays(newStart, newEnd)
    : (Math.round((new Date(newEnd) - new Date(newStart)) / 86400000) + 1);

  const warn = rec.status !== 'PENDING'
    ? '\n\n⚠️ Permohonan ini telah disokong/diluluskan separa. Mengubahnya akan MENETAPKAN SEMULA status ke PENDING dan proses kelulusan akan bermula semula.'
    : '';
  if (!confirm(`Sahkan perubahan berikut?\n\n${changes.join('\n')}\n\nTempoh baharu: ${days} hari${warn}`)) return;

  try {
    await updateDoc(doc(db, 'leaves', id.toString()), {
      startDate: newStart, endDate: newEnd, reason: newReason, days, status: 'PENDING',
    });
    window.logSystemActivity(`Staff edited own leave ${id} (reset to PENDING)`);
    // Re-notify approvers that this needs (re-)action.
    const applicant = staffList.find(s => s.ic === rec.ic) || user;
    const approvers = window.getRoutingP1Approvers(applicant).filter(s => s.phone);
    const info = `\n\n👤 Pemohon: *${applicant.name}*\n📅 Tarikh: ${newStart} → ${newEnd}\n⏱ Tempoh: ${days} hari\n💬 Sebab: ${newReason}\n\n🔗 https://apply-leave-89ebb.web.app`;
    approvers.forEach(a => window.sendWhatsApp(a.phone, `🔁 *PERMOHONAN CUTI DIKEMASKINI — Perlu Sokongan Semula*${info}`));
    window.notifyApproversInbox(window.getRoutingP1Approvers(applicant),
      '🔁 Cuti Dikemaskini — Perlu Sokongan Semula',
      `${applicant.name} mengubah permohonan cuti (kini ${newStart} → ${newEnd}); memerlukan sokongan semula.`,
      id.toString(), rec.ic);
    alert('✅ Permohonan dikemaskini. Status ditetapkan semula ke PENDING untuk kelulusan semula.');
  } catch (err) {
    console.error('staffEditOwnLeave error:', err);
    alert('Ralat mengemaskini permohonan. (Mungkin status telah berubah — sila muat semula.)');
  }
};
```

> `window.computeLeaveDays` may not exist; the inline fallback covers it. If the codebase already has a day-counting helper, call that instead and drop the fallback.

- [ ] **Step 2: Render the button on the staff's own editable leaves**

In the staff dashboard leave list (where a staff sees their own applications), add, for rows where `r.ic === user.ic && !['APPROVED','REJECTED','CANCELLED'].includes(r.status)`:
```js
`<button class="neu-btn" onclick="window.staffEditOwnLeave(${r.id})" style="color:#60a5fa;">✏️ Edit Tarikh/Sebab</button>`
```

- [ ] **Step 3: Verify syntax**

Run: `node --check src/main.js`
Expected: exit 0.

- [ ] **Step 4: Manual check against emulators**

Log in as staff, edit own PENDING leave → confirm dialog shows the diff → save → status stays PENDING. Edit a `TL APPROVED` own leave → confirm shows the re-approval warning → save → status becomes PENDING. Attempt (via console) to set another field → rules deny.

- [ ] **Step 5: Commit**

```bash
git add src/main.js
git commit -m "feat(leave): staff self-edit of own leave date/reason with confirm + re-approval reset"
```

---

## Phase 8 — Cutover

### Task 15: Write the cutover runbook and do final verification

**Files:**
- Create: `docs/CUTOVER-firebase-auth.md`

- [ ] **Step 1: Write the runbook**

```markdown
# Cutover — Firebase Auth & Role Enforcement

Do these in order. The live app keeps working as-is until step 6.

1. **Blaze:** Upgrade project `apply-leave-89ebb` to the Blaze plan (Firebase console → Usage and billing). Required for Cloud Functions.
2. **Enable Email/Password:** Firebase console → Authentication → Sign-in method → enable Email/Password. (Keep Anonymous enabled.)
3. **Seed role permissions (prod):** `node seed-role-permissions.js`
4. **Deploy the function:** `npx firebase deploy --only functions --project apply-leave-89ebb`
5. **Provision accounts:** `IT_ADMIN_PASSWORD='<choose-strong>' node provision-auth.js`
   - Verify in console → Authentication that users exist and `directory` is populated.
6. **Deploy rules + client together:**
   - `npm run build`
   - `npx firebase deploy --only firestore:rules,hosting --project apply-leave-89ebb`
7. **Verify (prod):**
   - Staff logs in (IC + password) ✓
   - Staff edits own PENDING leave → stays PENDING; edits a supported leave → resets to PENDING ✓
   - Approver approves a leave ✓
   - Staff CANNOT approve (button hidden; console-forced status write denied by rules) ✓
   - Old `superpassword` no longer works ✓
   - Break-glass `itadmin` logs in ✓
8. **Post-cutover cleanup (after a stable week):** remove the now-unused `password` field from staff docs with a one-off script (optional; the field is simply ignored).
```

- [ ] **Step 2: Commit**

```bash
git add docs/CUTOVER-firebase-auth.md
git commit -m "docs(auth): cutover runbook for Firebase Auth migration"
```

- [ ] **Step 3: Full local regression**

Run, in order:
```bash
npx firebase emulators:exec --only firestore --project apply-leave-89ebb "node --test tests/rules.test.mjs"
npx firebase emulators:exec --only firestore,auth,functions --project apply-leave-89ebb "node --test tests/functions.test.mjs"
node --check src/main.js
npm run build
```
Expected: rules tests pass, function test passes, syntax check clean, build succeeds.

---

## Notes for the implementer

- **Do not deploy piecemeal.** Rules + client must ship together (cutover step 6); provisioning (step 5) must precede them. Earlier commits are safe to land on the branch but must not be deployed to prod until the full cutover.
- **`canApprove` is intentionally coarse.** Fine-grained branch/stage routing stays in the client `canManageRequest` (already hardened in `finalizeLeave`/`rejectLeave`/`cancelLeave`). Do not try to replicate routing in rules.
- **Emulator wiring for manual client checks:** temporarily add, right after the Firebase init in `src/main.js`, `connectAuthEmulator(auth,'http://127.0.0.1:9099'); connectFirestoreEmulator(db,'127.0.0.1',8080); connectFunctionsEmulator(functions,'127.0.0.1',5001);` guarded by `if (location.hostname==='localhost')`. Remove or keep guarded before deploy.
- The reject/cancel/`finalizeLeave` permission guards (issues A/B/D) are already in the working tree on this branch and should be committed alongside or before this work.
```
