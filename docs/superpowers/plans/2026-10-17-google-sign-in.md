# Google Sign-In Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff can log in with Google (linked to their existing IC account), new hires can register with Google, HR approval activates accounts automatically, and staff/HR can unlink.

**Architecture:** One Firebase Auth user per staff (`<ic>@ksb-leave.local`); Google is a linked provider on it. Firestore rules are tightened first so a Firebase user without an `ic` claim has no data access. Admin-only operations (approve registration, HR unlink) run as two new endpoints on the existing Vercel `otp-backend`, which verifies the caller's ID token.

**Tech Stack:** Vite + vanilla JS (`src/main.js`), Firebase JS SDK v12 (`firebase/auth`, `firebase/firestore`), Firestore rules + `@firebase/rules-unit-testing`, Vercel serverless (`otp-backend`, `firebase-admin` v13), `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-17-google-sign-in-design.md`

## Global Constraints

- Spark plan: no Cloud Functions. Server work goes in `otp-backend/` only.
- Auth email for a staff IC: `` `${String(ic).replace(/[^a-zA-Z0-9]/g, '')}@ksb-leave.local` ``.
- Initial password for a created IC account: the IC, right-padded with `"0"` to 6 characters (same as `provision-one.js`).
- Claims are exactly `{ ic, canApprove, manageStaff }`, read from `config/rolePermissions[role]`.
- Subsidiaries list: `['KSB Pharma Sdn. Bhd.']`; group admins: roles `admin`, `super_admin`. Must match `firestore.rules` `subsidiaries()` / `isGroupAdmin()`.
- All user-facing text is Malay, shown with the existing `showToast` / `showConfirm`.
- Backend base URL: the existing `OTP_API_BASE` constant in `src/main.js`.
- Do not deploy rules, backend or hosting from the plan; the final task lists the manual rollout for the user.
- Version bump on the final task: `package.json` `2.5.35` → `2.6.0` (and `package-lock.json`), commit message style `feat(auth): …; bump to v2.6.0`.
- Every commit ends with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. **Stray temporary Google users.** A Gmail that tried to log in unlinked, or opened "Daftar dengan Google" and closed the form, must not leave a Firebase user behind — otherwise a later "Pautkan" fails with `credential-already-in-use`. Covered in Task 7 (delete on unlinked login) and Task 8 (delete on register-modal close).
2. **Deactivated staff via Google.** `completeLogin` must keep the `inactive` check for Google logins. Covered by Task 6 (the check moves into `completeLogin`) and the manual checklist in Task 11.
3. **Approve retried after partial failure.** A request stuck in `approving` with `staff/{ic}` already written must approve on retry, not be rejected as "IC sudah wujud". Test in Task 3.
4. **HR across company boundary.** Clinic HR must not approve or unlink KSB Pharma staff and vice versa. Tests in Task 2 (`companyOK`) and Task 4 (handler 403).
5. **Pending registrant reopens the app.** A Google session with no `ic` and a pending request must show the pending message and land on the login screen, not a blank dashboard. Covered in Task 7 (`resolveGoogleSession` in bootstrap).

---

### Task 1: Firestore rules — require the `ic` claim; Google registration rules

**Files:**
- Modify: `firestore.rules:5-8` (`signedIn`), `firestore.rules:73-76` (`registration_requests`), `firestore.rules` staff self-update allowlist (the `hasOnly(['name', 'phone', 'email', 'address', 'photoUrl'])` line)
- Test: `tests/rules.test.mjs`

**Interfaces:**
- Produces: a Firebase user with no `ic` claim is denied everything gated by `signedIn()`; such a user may create a `registration_requests` doc whose `googleUid` equals their uid, and may `list` requests where `googleUid == auth.uid`. Staff may set `googleEmail` on their own `staff/{ic}`.

- [ ] **Step 1: Write the failing tests** — append to `tests/rules.test.mjs`:

```js
// ── Google sign-in (2026-10-17) ──────────────────────────────────────────────
const googleNoIcAuth = () => ({ firebase: { sign_in_provider: "google.com" } });
const googleDb = (uid) => testEnv.authenticatedContext(uid, googleNoIcAuth()).firestore();

test("google user without ic claim cannot read data", async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "config", "approvalRouting"), { x: 1 });
    await setDoc(doc(ctx.firestore(), "audit_logs", "A1"), { action: "x" });
    await setDoc(doc(ctx.firestore(), "wa_logs", "W1"), { msg: "x" });
  });
  const db = googleDb("G1");
  await assertFails(getDoc(doc(db, "config", "approvalRouting")));
  await assertFails(getDoc(doc(db, "audit_logs", "A1")));
  await assertFails(getDoc(doc(db, "wa_logs", "W1")));
  await assertFails(getDoc(doc(db, "staff", "S1")));
  await assertFails(getDoc(doc(db, "leaves", "L1")));
  await assertFails(setDoc(doc(db, "audit_logs", "A2"), { action: "spam" }));
});

test("google user without ic can still read the login directory", async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "directory", "S1"), { ic: "S1", name: "ALI", branch: "Klinik A" });
  });
  await assertSucceeds(getDoc(doc(googleDb("G1"), "directory", "S1")));
});

test("registration with googleUid must match the caller", async () => {
  const db = googleDb("G1");
  const base = { name: "BARU", ic: "N1", branch: "Klinik A", category: "Operation Staff", phone: "60100000001", status: "pending", submittedAt: 1 };
  await assertSucceeds(setDoc(doc(db, "registration_requests", "r1"), { ...base, googleUid: "G1", googleSub: "111", googleEmail: "a@gmail.com" }));
  await assertFails(setDoc(doc(db, "registration_requests", "r2"), { ...base, googleUid: "G2", googleSub: "222", googleEmail: "b@gmail.com" }));
  // plain (non-Google) registration from the anonymous bootstrap still works
  const anonDb = testEnv.authenticatedContext("anon1", anonAuth()).firestore();
  await assertSucceeds(setDoc(doc(anonDb, "registration_requests", "r3"), base));
});

test("google registrant can list only own requests", async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "registration_requests", "mine"), { ic: "N1", branch: "Klinik A", status: "pending", googleUid: "G1" });
    await setDoc(doc(ctx.firestore(), "registration_requests", "theirs"), { ic: "N2", branch: "Klinik A", status: "pending", googleUid: "G2" });
  });
  const db = googleDb("G1");
  const own = await assertSucceeds(getDocs(query(collection(db, "registration_requests"), where("googleUid", "==", "G1"))));
  assert.strictEqual(own.size, 1);
  await assertFails(getDocs(query(collection(db, "registration_requests"), where("googleUid", "==", "G2"))));
  await assertFails(getDocs(collection(db, "registration_requests")));
});

test("staff can set and clear own googleEmail, not someone else's", async () => {
  await assertSucceeds(updateDoc(doc(ctxDb(staffAuth("S1")), "staff", "S1"), { googleEmail: "ali@gmail.com" }));
  await assertSucceeds(updateDoc(doc(ctxDb(staffAuth("S1")), "staff", "S1"), { googleEmail: null }));
  await assertFails(updateDoc(doc(ctxDb(staffAuth("S2")), "staff", "S1"), { googleEmail: "x@gmail.com" }));
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx firebase emulators:exec --only firestore "node --test tests/rules.test.mjs"`
Expected: the five new tests FAIL (e.g. `google user without ic claim cannot read data` — `config` read succeeds; `staff can set and clear own googleEmail` — update denied). The 50 existing tests pass.

- [ ] **Step 3: Implement the rules**

Replace `signedIn()` in `firestore.rules`:

```
    // A provisioned staff member: not anonymous AND carries the `ic` claim set by
    // provision-one.js / sync-claims.js / otp-backend approve-registration. Without
    // the ic check any self-created Firebase user (Google sign-in, or Email/Password
    // sign-up through the public API key) would pass. 2026-10-17.
    function signedIn() {
      return request.auth != null
        && request.auth.token.firebase.sign_in_provider != 'anonymous'
        && request.auth.token.get('ic', null) is string;
    }
```

Replace the `registration_requests` block:

```
    match /registration_requests/{id} {
      allow read, update, delete: if manageStaff() && companyOK(resource.data.branch);
      // A Google registrant (no ic claim yet) checks whether their own request is
      // still pending — used by the login screen. Only their own googleUid.
      allow list: if request.auth != null
        && resource.data.get('googleUid', null) == request.auth.uid;
      // Created pre-login (anonymous or Google). A Google request may only carry
      // the caller's own uid, so nobody can attach someone else's Google identity.
      allow create: if request.auth != null
        && ( !('googleUid' in request.resource.data)
             || request.resource.data.googleUid == request.auth.uid );
    }
```

In the `staff/{ic}` self-update branch change the allowlist to:

```
                  .hasOnly(['name', 'phone', 'email', 'address', 'photoUrl', 'googleEmail'])
```

- [ ] **Step 4: Run to verify all pass**

Run: `npx firebase emulators:exec --only firestore "node --test tests/rules.test.mjs"`
Expected: `# pass 55`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add firestore.rules tests/rules.test.mjs
git commit -m "fix(rules): signedIn() requires the ic claim; Google registration rules

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: otp-backend — caller authorization helpers

**Files:**
- Create: `otp-backend/lib/authz.js`
- Modify: `otp-backend/lib/cors.js` (`Access-Control-Allow-Headers`)
- Test: `otp-backend/lib/authz.test.js`

**Interfaces:**
- Produces:
  - `SUBSIDIARIES: string[]`
  - `companyOK(caller: {role, branch}, branch: string): boolean`
  - `bearerToken(req): string | null`
  - `async requireManageStaff(req, { auth, db }): Promise<{ ok: true, caller: {ic, role, branch} } | { ok: false, status: 401|403, error: string }>` — verifies the ID token, requires `manageStaff === true` and `ic` claims, loads `staff/{ic}`.

- [ ] **Step 1: Write the failing test** — `otp-backend/lib/authz.test.js`:

```js
// Tests for caller authorization. Run: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { companyOK, bearerToken, requireManageStaff } from "./authz.js";

const PHARMA = "KSB Pharma Sdn. Bhd.";

test("companyOK: clinic HR reaches clinic branches, not KSB Pharma", () => {
  const hr = { role: "hr", branch: "Klinik A" };
  assert.equal(companyOK(hr, "Klinik B"), true);
  assert.equal(companyOK(hr, PHARMA), false);
});

test("companyOK: pharma HR reaches only its own company", () => {
  const hr = { role: "hr", branch: PHARMA };
  assert.equal(companyOK(hr, PHARMA), true);
  assert.equal(companyOK(hr, "Klinik A"), false);
});

test("companyOK: group admin reaches both", () => {
  for (const role of ["admin", "super_admin"]) {
    const a = { role, branch: "Klinik Syed Badaruddin Balok (HQ)" };
    assert.equal(companyOK(a, PHARMA), true);
    assert.equal(companyOK(a, "Klinik A"), true);
  }
});

test("bearerToken parses the Authorization header", () => {
  assert.equal(bearerToken({ headers: { authorization: "Bearer abc.def" } }), "abc.def");
  assert.equal(bearerToken({ headers: { authorization: "Basic x" } }), null);
  assert.equal(bearerToken({ headers: {} }), null);
});

const fakeDb = (docs) => ({
  doc: (path) => ({ get: async () => ({ exists: path in docs, data: () => docs[path] }) }),
});
const fakeAuth = (decoded) => ({
  verifyIdToken: async (t) => { if (t !== "good") throw new Error("bad"); return decoded; },
});
const req = (token) => ({ headers: token ? { authorization: `Bearer ${token}` } : {} });

test("requireManageStaff: missing or invalid token → 401", async () => {
  const deps = { auth: fakeAuth({}), db: fakeDb({}) };
  assert.deepEqual(await requireManageStaff(req(null), deps), { ok: false, status: 401, error: "unauthenticated" });
  assert.deepEqual(await requireManageStaff(req("bad"), deps), { ok: false, status: 401, error: "unauthenticated" });
});

test("requireManageStaff: no manageStaff claim → 403", async () => {
  const deps = { auth: fakeAuth({ ic: "S1", manageStaff: false }), db: fakeDb({ "staff/S1": { role: "staff", branch: "Klinik A" } }) };
  assert.deepEqual(await requireManageStaff(req("good"), deps), { ok: false, status: 403, error: "forbidden" });
});

test("requireManageStaff: HR with staff doc → ok with caller", async () => {
  const deps = { auth: fakeAuth({ ic: "H1", manageStaff: true }), db: fakeDb({ "staff/H1": { role: "hr", branch: "Klinik A" } }) };
  assert.deepEqual(await requireManageStaff(req("good"), deps), { ok: true, caller: { ic: "H1", role: "hr", branch: "Klinik A" } });
});

test("requireManageStaff: inactive or missing staff doc → 403", async () => {
  const inactive = { auth: fakeAuth({ ic: "H1", manageStaff: true }), db: fakeDb({ "staff/H1": { role: "hr", branch: "Klinik A", inactive: true } }) };
  assert.equal((await requireManageStaff(req("good"), inactive)).status, 403);
  const missing = { auth: fakeAuth({ ic: "H1", manageStaff: true }), db: fakeDb({}) };
  assert.equal((await requireManageStaff(req("good"), missing)).status, 403);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd otp-backend && node --test lib/authz.test.js`
Expected: FAIL — `Cannot find module './authz.js'`.

- [ ] **Step 3: Implement** — `otp-backend/lib/authz.js`:

```js
// Caller authorization for the admin endpoints (approve-registration, unlink-google).
// The browser sends its Firebase ID token as `Authorization: Bearer <token>`; we
// verify it with the Admin SDK and require the manageStaff claim.
//
// ⚠️ KEEP IN SYNC WITH firestore.rules subsidiaries() / isGroupAdmin() / companyOK().
// The rules guard the same boundary for writes made from the browser.

export const SUBSIDIARIES = ["KSB Pharma Sdn. Bhd."];
const GROUP_ADMIN_ROLES = ["admin", "super_admin"];

export function companyOK(caller, branch) {
  const isSubsidiaryUser = SUBSIDIARIES.includes(caller.branch);
  const isGroupAdmin = GROUP_ADMIN_ROLES.includes(caller.role);
  if (isSubsidiaryUser) return branch === caller.branch;
  return !SUBSIDIARIES.includes(branch) || isGroupAdmin;
}

export function bearerToken(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || "";
  const m = /^Bearer\s+(.+)$/.exec(h);
  return m ? m[1].trim() : null;
}

export async function requireManageStaff(req, { auth, db }) {
  const token = bearerToken(req);
  if (!token) return { ok: false, status: 401, error: "unauthenticated" };
  let decoded;
  try { decoded = await auth.verifyIdToken(token); }
  catch { return { ok: false, status: 401, error: "unauthenticated" }; }
  if (decoded.manageStaff !== true || typeof decoded.ic !== "string") {
    return { ok: false, status: 403, error: "forbidden" };
  }
  const snap = await db.doc(`staff/${decoded.ic}`).get();
  if (!snap.exists || snap.data().inactive) return { ok: false, status: 403, error: "forbidden" };
  const s = snap.data();
  return { ok: true, caller: { ic: decoded.ic, role: s.role, branch: s.branch } };
}
```

In `otp-backend/lib/cors.js` change:

```js
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd otp-backend && node --test lib/`
Expected: all tests pass (authz + existing cors/otp/routing).

- [ ] **Step 5: Commit**

```bash
git add otp-backend/lib/authz.js otp-backend/lib/authz.test.js otp-backend/lib/cors.js
git commit -m "feat(otp-backend): verify caller ID token and company scope for admin endpoints

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: otp-backend — approve-registration logic

**Files:**
- Create: `otp-backend/lib/approve.js`
- Test: `otp-backend/lib/approve.test.js`

**Interfaces:**
- Consumes: nothing from Task 2 (pure logic with injected `db`/`auth`).
- Produces:
  - `emailForIC(ic: string): string`
  - `async approveRegistration({ db, auth, docId, name, now }): Promise<{ ok: true, ic, googleEmail: string|null } | { ok: false, status: 404|409, error: 'not_found'|'not_pending'|'ic_exists' }>`
  - `db` shape used: `db.doc(path).get() → {exists, data()}`, `.set(data, {merge})`, `.update(data)`.
  - `auth` shape used: `getUserByEmail`, `createUser`, `setCustomUserClaims`, `updateUser`, `deleteUser`.

- [ ] **Step 1: Write the failing test** — `otp-backend/lib/approve.test.js`:

```js
// Tests for registration approval. Run: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { approveRegistration, emailForIC } from "./approve.js";

function fakeDb(initial) {
  const docs = structuredClone(initial);
  return {
    docs,
    doc: (path) => ({
      get: async () => ({ exists: path in docs, data: () => docs[path] }),
      set: async (data, opts) => { docs[path] = opts?.merge ? { ...(docs[path] || {}), ...data } : { ...data }; },
      update: async (data) => { if (!(path in docs)) throw new Error("no doc"); docs[path] = { ...docs[path], ...data }; },
    }),
  };
}

function fakeAuth(users = {}) {
  const byUid = structuredClone(users);
  let n = 0;
  const notFound = () => Object.assign(new Error("not found"), { code: "auth/user-not-found" });
  return {
    byUid,
    getUserByEmail: async (email) => { const u = Object.values(byUid).find((x) => x.email === email); if (!u) throw notFound(); return u; },
    createUser: async ({ email, password, displayName }) => { const uid = `U${++n}`; byUid[uid] = { uid, email, password, displayName, providerData: [{ providerId: "password" }] }; return byUid[uid]; },
    setCustomUserClaims: async (uid, claims) => { byUid[uid].customClaims = claims; },
    updateUser: async (uid, upd) => {
      const u = byUid[uid];
      if ("disabled" in upd) u.disabled = upd.disabled;
      if (upd.providerToLink) u.providerData.push({ ...upd.providerToLink });
      if (upd.providersToUnlink) u.providerData = u.providerData.filter((p) => !upd.providersToUnlink.includes(p.providerId));
      return u;
    },
    deleteUser: async (uid) => { if (!byUid[uid]) throw notFound(); delete byUid[uid]; },
  };
}

const PERMS = { "config/rolePermissions": { staff: { canApprove: false, manageStaff: false } } };
const REQ = { name: "ALI BIN ABU", ic: "900101015555", branch: "Klinik A", category: "Operation Staff", phone: "60123456789", status: "pending" };
const NOW = Date.UTC(2026, 9, 17);

test("plain registration: creates staff, auth user, claims, directory; marks approved", async () => {
  const db = fakeDb({ ...PERMS, "registration_requests/r1": REQ });
  const auth = fakeAuth();
  const res = await approveRegistration({ db, auth, docId: "r1", name: "Ali Bin Abu", now: NOW });
  assert.deepEqual(res, { ok: true, ic: "900101015555", googleEmail: null });
  const staff = db.docs["staff/900101015555"];
  assert.equal(staff.name, "Ali Bin Abu");
  assert.equal(staff.role, "staff");
  assert.equal(staff.inactive, false);
  assert.equal(staff.startDate, "2026-10-17");
  assert.equal(staff.registrationDocId, "r1");
  const u = await auth.getUserByEmail(emailForIC("900101015555"));
  assert.equal(u.password, "900101015555");
  assert.deepEqual(u.customClaims, { ic: "900101015555", canApprove: false, manageStaff: false });
  assert.deepEqual(db.docs["directory/900101015555"], { ic: "900101015555", name: "Ali Bin Abu", branch: "Klinik A", inactive: false });
  assert.equal(db.docs["registration_requests/r1"].status, "approved");
  assert.equal(db.docs["registration_requests/r1"].approvedAt, NOW);
});

test("google registration: deletes temp user and links google to the IC account", async () => {
  const db = fakeDb({ ...PERMS, "registration_requests/r1": { ...REQ, googleUid: "G1", googleSub: "1234567890", googleEmail: "ali@gmail.com" } });
  const auth = fakeAuth({ G1: { uid: "G1", email: "ali@gmail.com", providerData: [{ providerId: "google.com", uid: "1234567890" }] } });
  const res = await approveRegistration({ db, auth, docId: "r1", name: "Ali Bin Abu", now: NOW });
  assert.deepEqual(res, { ok: true, ic: "900101015555", googleEmail: "ali@gmail.com" });
  assert.equal(auth.byUid.G1, undefined);
  const u = await auth.getUserByEmail(emailForIC("900101015555"));
  assert.deepEqual(u.providerData.find((p) => p.providerId === "google.com"),
    { providerId: "google.com", uid: "1234567890", email: "ali@gmail.com", displayName: "Ali Bin Abu" });
  assert.equal(db.docs["staff/900101015555"].googleEmail, "ali@gmail.com");
});

test("short IC is padded to a 6-character initial password", async () => {
  const db = fakeDb({ ...PERMS, "registration_requests/r1": { ...REQ, ic: "A12" } });
  const auth = fakeAuth();
  await approveRegistration({ db, auth, docId: "r1", name: "Ali", now: NOW });
  assert.equal((await auth.getUserByEmail(emailForIC("A12"))).password, "A12000");
});

test("missing request → 404; already approved → 409", async () => {
  const db = fakeDb({ ...PERMS, "registration_requests/done": { ...REQ, status: "approved" } });
  assert.deepEqual(await approveRegistration({ db, auth: fakeAuth(), docId: "nope", name: "x", now: NOW }), { ok: false, status: 404, error: "not_found" });
  assert.deepEqual(await approveRegistration({ db, auth: fakeAuth(), docId: "done", name: "x", now: NOW }), { ok: false, status: 409, error: "not_pending" });
});

test("IC already belongs to another staff → rejected with reason", async () => {
  const db = fakeDb({ ...PERMS, "registration_requests/r1": REQ, "staff/900101015555": { ic: "900101015555", name: "Lain" } });
  const res = await approveRegistration({ db, auth: fakeAuth(), docId: "r1", name: "x", now: NOW });
  assert.deepEqual(res, { ok: false, status: 409, error: "ic_exists" });
  assert.equal(db.docs["registration_requests/r1"].status, "rejected");
  assert.equal(db.docs["registration_requests/r1"].rejectedReason, "IC sudah wujud");
  assert.equal(db.docs["staff/900101015555"].name, "Lain");
});

test("retry after partial failure (status approving, staff written by this request) succeeds", async () => {
  const db = fakeDb({
    ...PERMS,
    "registration_requests/r1": { ...REQ, status: "approving", googleUid: "G1", googleSub: "1234567890", googleEmail: "ali@gmail.com" },
    "staff/900101015555": { ic: "900101015555", name: "Ali Bin Abu", registrationDocId: "r1", branch: "Klinik A" },
  });
  // temp Google user already deleted in the failed run
  const auth = fakeAuth();
  const res = await approveRegistration({ db, auth, docId: "r1", name: "Ali Bin Abu", now: NOW });
  assert.equal(res.ok, true);
  const u = await auth.getUserByEmail(emailForIC("900101015555"));
  assert.equal(u.providerData.filter((p) => p.providerId === "google.com").length, 1);
  assert.equal(db.docs["registration_requests/r1"].status, "approved");
});

test("running approve twice does not link google twice", async () => {
  const db = fakeDb({ ...PERMS, "registration_requests/r1": { ...REQ, googleUid: "G1", googleSub: "1234567890", googleEmail: "ali@gmail.com" } });
  const auth = fakeAuth({ G1: { uid: "G1", email: "ali@gmail.com", providerData: [] } });
  await approveRegistration({ db, auth, docId: "r1", name: "Ali", now: NOW });
  db.docs["registration_requests/r1"].status = "approving"; // simulate a second click racing the first
  await approveRegistration({ db, auth, docId: "r1", name: "Ali", now: NOW });
  const u = await auth.getUserByEmail(emailForIC("900101015555"));
  assert.equal(u.providerData.filter((p) => p.providerId === "google.com").length, 1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd otp-backend && node --test lib/approve.test.js`
Expected: FAIL — `Cannot find module './approve.js'`.

- [ ] **Step 3: Implement** — `otp-backend/lib/approve.js`:

```js
// Approve a registration request: create the staff record, the IC Auth account,
// its claims and login-directory entry, and — for a Google registration — move
// the Google identity from the registrant's temporary Firebase user onto the IC
// account. Replaces the client-side approveRegistration + manual provision-one.js.
//
// Every step is idempotent so HR can press "Lulus" again after a failure: the
// request is marked "approving" first, and a staff doc carrying this request's
// registrationDocId is treated as ours rather than as "IC already exists".
const AUTH_EMAIL_DOMAIN = "ksb-leave.local";
export const emailForIC = (ic) => `${String(ic).replace(/[^a-zA-Z0-9]/g, "")}@${AUTH_EMAIL_DOMAIN}`;

const isNotFound = (e) => e && e.code === "auth/user-not-found";

export async function approveRegistration({ db, auth, docId, name, now = Date.now() }) {
  const reqRef = db.doc(`registration_requests/${docId}`);
  const reqSnap = await reqRef.get();
  if (!reqSnap.exists) return { ok: false, status: 404, error: "not_found" };
  const r = reqSnap.data();
  if (!["pending", "approving"].includes(r.status)) return { ok: false, status: 409, error: "not_pending" };

  const ic = String(r.ic || "").trim();
  const staffName = String(name || r.name || "").trim();
  const staffRef = db.doc(`staff/${ic}`);
  const staffSnap = await staffRef.get();
  if (staffSnap.exists && staffSnap.data().registrationDocId !== docId) {
    await reqRef.update({ status: "rejected", rejectedAt: now, rejectedReason: "IC sudah wujud" });
    return { ok: false, status: 409, error: "ic_exists" };
  }

  await reqRef.update({ status: "approving" });

  const googleEmail = r.googleSub ? (r.googleEmail || null) : null;
  if (!staffSnap.exists) {
    await staffRef.set({
      name: staffName, ic, branch: r.branch, category: r.category,
      role: "staff", phone: r.phone, inactive: false,
      startDate: new Date(now).toISOString().split("T")[0],
      registrationDocId: docId,
      ...(googleEmail ? { googleEmail } : {}),
    });
  } else if (googleEmail) {
    await staffRef.set({ googleEmail }, { merge: true });
  }

  // Auth account (get-or-create; an existing account keeps its password).
  let user;
  try {
    user = await auth.getUserByEmail(emailForIC(ic));
  } catch (e) {
    if (!isNotFound(e)) throw e;
    const pwd = ic.length < 6 ? ic.padEnd(6, "0") : ic;
    user = await auth.createUser({ email: emailForIC(ic), password: pwd, displayName: staffName || ic });
  }

  const permsSnap = await db.doc("config/rolePermissions").get();
  const rp = (permsSnap.exists ? permsSnap.data() : {}).staff || { canApprove: false, manageStaff: false };
  await auth.setCustomUserClaims(user.uid, { ic, canApprove: !!rp.canApprove, manageStaff: !!rp.manageStaff });
  await auth.updateUser(user.uid, { disabled: false });
  await db.doc(`directory/${ic}`).set({ ic, name: staffName, branch: r.branch || "", inactive: false });

  if (r.googleSub) {
    const fresh = await auth.getUserByEmail(emailForIC(ic));
    const linked = (fresh.providerData || []).some((p) => p.providerId === "google.com");
    if (!linked) {
      // A Google identity can belong to one Firebase user only: remove the
      // registrant's temporary user before linking it to the IC account.
      if (r.googleUid && r.googleUid !== user.uid) {
        try { await auth.deleteUser(r.googleUid); } catch (e) { if (!isNotFound(e)) throw e; }
      }
      await auth.updateUser(user.uid, {
        providerToLink: { providerId: "google.com", uid: r.googleSub, email: r.googleEmail, displayName: staffName },
      });
    }
  }

  await reqRef.update({ status: "approved", approvedAt: now });
  return { ok: true, ic, googleEmail };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd otp-backend && node --test lib/`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add otp-backend/lib/approve.js otp-backend/lib/approve.test.js
git commit -m "feat(otp-backend): idempotent registration approval with Google link

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: otp-backend — endpoints `approve-registration` and `unlink-google`

**Files:**
- Create: `otp-backend/lib/unlink.js`, `otp-backend/api/approve-registration.js`, `otp-backend/api/unlink-google.js`
- Modify: `otp-backend/README.md` (endpoint list)
- Test: `otp-backend/lib/unlink.test.js`, `otp-backend/lib/handlers.test.js`

**Interfaces:**
- Consumes: `requireManageStaff`, `companyOK` (Task 2); `approveRegistration`, `emailForIC` (Task 3).
- Produces (HTTP, both `POST`, header `Authorization: Bearer <idToken>`, JSON body):
  - `/api/approve-registration` `{ docId, name }` → `200 { ok: true, ic, googleEmail }` | `400 {error:'missing_fields'}` | `401/403 {error}` | `404 {error:'not_found'}` | `409 {error:'not_pending'|'ic_exists'}` | `500 {error:'server_error'}`
  - `/api/unlink-google` `{ ic }` → `200 { ok: true }` | `400` | `401/403` | `404 {error:'not_found'}` | `500`
  - `async unlinkGoogle({ db, auth, ic }): Promise<{ok:true}|{ok:false,status:404,error:'not_found'}>`
  - Handler factories for testing: `makeApproveHandler(() => ({ db, auth }))`, `makeUnlinkHandler(() => ({ db, auth }))` returning `(req, res) => Promise`. Deps are a function so the real Admin SDK is only initialised on a real request (never in tests or on an OPTIONS preflight).

- [ ] **Step 1: Write the failing tests**

`otp-backend/lib/unlink.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { unlinkGoogle } from "./unlink.js";

test("unlinkGoogle removes the google provider and clears googleEmail", async () => {
  const docs = { "staff/S1": { ic: "S1", googleEmail: "a@gmail.com" } };
  const db = { doc: (p) => ({ set: async (d, o) => { docs[p] = o?.merge ? { ...docs[p], ...d } : d; } }) };
  const user = { uid: "U1", email: "S1@ksb-leave.local", providerData: [{ providerId: "password" }, { providerId: "google.com" }] };
  let unlinked;
  const auth = {
    getUserByEmail: async (e) => { if (e !== user.email) throw Object.assign(new Error(), { code: "auth/user-not-found" }); return user; },
    updateUser: async (uid, upd) => { unlinked = { uid, upd }; },
  };
  assert.deepEqual(await unlinkGoogle({ db, auth, ic: "S1" }), { ok: true });
  assert.deepEqual(unlinked, { uid: "U1", upd: { providersToUnlink: ["google.com"] } });
  assert.equal(docs["staff/S1"].googleEmail, null);
});

test("unlinkGoogle: no auth account → 404", async () => {
  const auth = { getUserByEmail: async () => { throw Object.assign(new Error(), { code: "auth/user-not-found" }); } };
  assert.deepEqual(await unlinkGoogle({ db: {}, auth, ic: "X" }), { ok: false, status: 404, error: "not_found" });
});
```

`otp-backend/lib/handlers.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeApproveHandler } from "../api/approve-registration.js";
import { makeUnlinkHandler } from "../api/unlink-google.js";

const PHARMA = "KSB Pharma Sdn. Bhd.";
function res() {
  const r = { statusCode: 0, body: null, headers: {} };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.end = () => r;
  return r;
}
const db = (docs) => ({ doc: (p) => ({ get: async () => ({ exists: p in docs, data: () => docs[p] }) }) });
const auth = (decoded) => ({ verifyIdToken: async () => decoded });
const post = (body) => ({ method: "POST", headers: { authorization: "Bearer t", origin: "https://cuti-staff.ksbsb.com.my" }, body });

test("approve: clinic HR cannot approve a KSB Pharma registration", async () => {
  const h = makeApproveHandler(() => ({
    db: db({ "staff/H1": { role: "hr", branch: "Klinik A" }, "registration_requests/r1": { branch: PHARMA, status: "pending" } }),
    auth: auth({ ic: "H1", manageStaff: true }),
  }));
  const r = res();
  await h(post({ docId: "r1", name: "X" }), r);
  assert.equal(r.statusCode, 403);
  assert.deepEqual(r.body, { error: "forbidden" });
});

test("approve: missing docId → 400; plain staff → 403", async () => {
  const hr = makeApproveHandler(() => ({ db: db({ "staff/H1": { role: "hr", branch: "Klinik A" } }), auth: auth({ ic: "H1", manageStaff: true }) }));
  const r1 = res(); await hr(post({}), r1); assert.equal(r1.statusCode, 400);
  const staff = makeApproveHandler(() => ({ db: db({ "staff/S1": { role: "staff", branch: "Klinik A" } }), auth: auth({ ic: "S1", manageStaff: false }) }));
  const r2 = res(); await staff(post({ docId: "r1" }), r2); assert.equal(r2.statusCode, 403);
});

test("unlink: pharma HR cannot unlink clinic staff", async () => {
  const h = makeUnlinkHandler(() => ({
    db: db({ "staff/H1": { role: "hr", branch: PHARMA }, "staff/S1": { role: "staff", branch: "Klinik A" } }),
    auth: auth({ ic: "H1", manageStaff: true }),
  }));
  const r = res();
  await h(post({ ic: "S1" }), r);
  assert.equal(r.statusCode, 403);
});

test("unlink: unknown staff → 404", async () => {
  const h = makeUnlinkHandler(() => ({ db: db({ "staff/H1": { role: "hr", branch: "Klinik A" } }), auth: auth({ ic: "H1", manageStaff: true }) }));
  const r = res();
  await h(post({ ic: "NOPE" }), r);
  assert.equal(r.statusCode, 404);
});

test("OPTIONS preflight allows the Authorization header", async () => {
  const h = makeUnlinkHandler(() => ({ db: db({}), auth: auth({}) }));
  const r = res();
  await h({ method: "OPTIONS", headers: { origin: "https://cuti-staff.ksbsb.com.my" } }, r);
  assert.equal(r.statusCode, 204);
  assert.match(r.headers["Access-Control-Allow-Headers"], /Authorization/);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd otp-backend && node --test lib/`
Expected: FAIL — cannot find `./unlink.js` / `../api/approve-registration.js`.

- [ ] **Step 3: Implement**

`otp-backend/lib/unlink.js`:

```js
// Remove the Google provider from a staff member's IC account (HR/Admin action).
// Staff unlinking themselves do it in the browser; only cross-user unlink needs us.
import { emailForIC } from "./approve.js";

export async function unlinkGoogle({ db, auth, ic }) {
  let user;
  try { user = await auth.getUserByEmail(emailForIC(ic)); }
  catch (e) { if (e && e.code === "auth/user-not-found") return { ok: false, status: 404, error: "not_found" }; throw e; }
  await auth.updateUser(user.uid, { providersToUnlink: ["google.com"] });
  await db.doc(`staff/${ic}`).set({ googleEmail: null }, { merge: true });
  return { ok: true };
}
```

`otp-backend/api/approve-registration.js`:

```js
// POST /api/approve-registration  { docId, name }   (Authorization: Bearer <idToken>)
// HR/Admin approves a registration request. Creates the staff record and login
// account (and links Google when the request came from "Daftar dengan Google"),
// so the new staff can log in straight away — no provision-one.js run needed.
import { db as getDb, auth as getAuth } from "../lib/firebase.js";
import { applyCors, readBody } from "../lib/cors.js";
import { requireManageStaff, companyOK } from "../lib/authz.js";
import { approveRegistration } from "../lib/approve.js";

export function makeApproveHandler(deps) {
  return async function handler(req, res) {
    if (applyCors(req, res)) return;
    if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
    try {
      const { db, auth } = deps();
      const authz = await requireManageStaff(req, { db, auth });
      if (!authz.ok) return res.status(authz.status).json({ error: authz.error });

      const body = readBody(req);
      const docId = String(body.docId ?? "").trim();
      if (!docId) return res.status(400).json({ error: "missing_fields" });

      const reqSnap = await db.doc(`registration_requests/${docId}`).get();
      if (!reqSnap.exists) return res.status(404).json({ error: "not_found" });
      if (!companyOK(authz.caller, reqSnap.data().branch || "")) return res.status(403).json({ error: "forbidden" });

      const result = await approveRegistration({ db, auth, docId, name: body.name });
      if (!result.ok) return res.status(result.status).json({ error: result.error });
      return res.status(200).json(result);
    } catch (e) {
      console.error("approve-registration error:", e);
      return res.status(500).json({ error: "server_error" });
    }
  };
}

export default makeApproveHandler(() => ({ db: getDb(), auth: getAuth() }));
```

`otp-backend/api/unlink-google.js`:

```js
// POST /api/unlink-google  { ic }   (Authorization: Bearer <idToken>)
// HR/Admin removes the Google sign-in from a staff member's account, e.g. after a
// lost phone or a Gmail linked by mistake. Company-scoped like the Firestore rules.
import { db as getDb, auth as getAuth } from "../lib/firebase.js";
import { applyCors, readBody } from "../lib/cors.js";
import { requireManageStaff, companyOK } from "../lib/authz.js";
import { unlinkGoogle } from "../lib/unlink.js";

export function makeUnlinkHandler(deps) {
  return async function handler(req, res) {
    if (applyCors(req, res)) return;
    if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
    try {
      const { db, auth } = deps();
      const authz = await requireManageStaff(req, { db, auth });
      if (!authz.ok) return res.status(authz.status).json({ error: authz.error });

      const ic = String(readBody(req).ic ?? "").replace(/[^a-zA-Z0-9]/g, "");
      if (!ic) return res.status(400).json({ error: "missing_fields" });

      const target = await db.doc(`staff/${ic}`).get();
      if (!target.exists) return res.status(404).json({ error: "not_found" });
      if (!companyOK(authz.caller, target.data().branch || "")) return res.status(403).json({ error: "forbidden" });

      const result = await unlinkGoogle({ db, auth, ic });
      if (!result.ok) return res.status(result.status).json({ error: result.error });
      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error("unlink-google error:", e);
      return res.status(500).json({ error: "server_error" });
    }
  };
}

export default makeUnlinkHandler(() => ({ db: getDb(), auth: getAuth() }));
```

Add to `otp-backend/README.md` under the endpoint list:

```md
- `POST /api/approve-registration` `{ docId, name }` — HR/Admin (Bearer ID token with `manageStaff`). Creates staff + login account, links Google if the registrant used "Daftar dengan Google".
- `POST /api/unlink-google` `{ ic }` — HR/Admin. Removes Google sign-in from a staff account.
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd otp-backend && node --test lib/`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add otp-backend/api/approve-registration.js otp-backend/api/unlink-google.js otp-backend/lib/unlink.js otp-backend/lib/unlink.test.js otp-backend/lib/handlers.test.js otp-backend/README.md
git commit -m "feat(otp-backend): approve-registration and unlink-google endpoints

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Client — `src/googleAuth.js`

**Files:**
- Create: `src/googleAuth.js`
- Test: `tests/googleAuth.test.mjs`

**Interfaces:**
- Produces:
  - `googleIdentityOf(user): { sub: string, email: string|null, displayName: string|null } | null` — from `user.providerData` entry with `providerId === 'google.com'`.
  - `googleErrorMessage(code: string): string | null` — `null` means stay silent.
  - `async signInWithGoogle(auth, intent: 'login'|'register'): Promise<User|null>` — popup; on `auth/popup-blocked` or `auth/operation-not-supported-in-this-environment` stores `intent` in `sessionStorage['ksb_google_intent']` and calls `signInWithRedirect` (returns `null`).
  - `async takeRedirectResult(auth): Promise<{ user, intent } | null>`
  - `async linkGoogle(user): Promise<User>`; `async unlinkGoogle(user): Promise<User>`

- [ ] **Step 1: Write the failing test** — `tests/googleAuth.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert';
import { googleIdentityOf, googleErrorMessage } from '../src/googleAuth.js';

test('googleIdentityOf picks the google.com provider', () => {
  const user = { providerData: [
    { providerId: 'password', uid: 'S1@ksb-leave.local' },
    { providerId: 'google.com', uid: '1234567890', email: 'ali@gmail.com', displayName: 'Ali Abu' },
  ] };
  assert.deepStrictEqual(googleIdentityOf(user), { sub: '1234567890', email: 'ali@gmail.com', displayName: 'Ali Abu' });
});

test('googleIdentityOf is null when not linked or no user', () => {
  assert.strictEqual(googleIdentityOf({ providerData: [{ providerId: 'password' }] }), null);
  assert.strictEqual(googleIdentityOf(null), null);
});

test('googleErrorMessage: user-cancelled popups are silent', () => {
  assert.strictEqual(googleErrorMessage('auth/popup-closed-by-user'), null);
  assert.strictEqual(googleErrorMessage('auth/cancelled-popup-request'), null);
  assert.strictEqual(googleErrorMessage('auth/user-cancelled'), null);
});

test('googleErrorMessage: known codes get Malay messages', () => {
  assert.match(googleErrorMessage('auth/credential-already-in-use'), /sudah digunakan/);
  assert.match(googleErrorMessage('auth/network-request-failed'), /internet/i);
  assert.match(googleErrorMessage('auth/user-disabled'), /tidak aktif/);
});

test('googleErrorMessage: unknown code gets a generic message with the code', () => {
  assert.match(googleErrorMessage('auth/weird'), /auth\/weird/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/googleAuth.test.mjs`
Expected: FAIL — `Cannot find module '../src/googleAuth.js'`.

- [ ] **Step 3: Implement** — `src/googleAuth.js`:

```js
// Google sign-in helpers. Google is always a provider LINKED onto the staff
// member's IC account (<ic>@ksb-leave.local) — never a separate account. See
// docs/superpowers/specs/2026-10-17-google-sign-in-design.md.
import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  linkWithPopup,
  unlink,
} from 'firebase/auth';

const INTENT_KEY = 'ksb_google_intent';

const provider = () => {
  const p = new GoogleAuthProvider();
  p.setCustomParameters({ prompt: 'select_account' });
  return p;
};

export function googleIdentityOf(user) {
  const p = user && (user.providerData || []).find((x) => x.providerId === 'google.com');
  return p ? { sub: p.uid, email: p.email || null, displayName: p.displayName || null } : null;
}

const SILENT = ['auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/user-cancelled'];
const MESSAGES = {
  'auth/credential-already-in-use': 'Akaun Google ini sudah digunakan oleh akaun lain.',
  'auth/provider-already-linked': 'Akaun Google sudah dipautkan.',
  'auth/network-request-failed': 'Tiada sambungan internet. Sila cuba lagi.',
  'auth/user-disabled': 'Akaun anda tidak aktif. Sila hubungi HR/Admin.',
  'auth/popup-blocked': 'Popup disekat oleh pelayar. Sila benarkan popup dan cuba lagi.',
  'auth/unauthorized-domain': 'Domain ini belum dibenarkan untuk log masuk Google. Sila hubungi IT.',
  'auth/operation-not-allowed': 'Log masuk Google belum diaktifkan. Sila hubungi IT.',
  'auth/requires-recent-login': 'Sila log keluar dan log masuk semula, kemudian cuba lagi.',
};

export function googleErrorMessage(code) {
  if (SILENT.includes(code)) return null;
  return MESSAGES[code] || `Ralat log masuk Google (${code}). Sila cuba lagi.`;
}

const REDIRECT_FALLBACK = ['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'];

export async function signInWithGoogle(auth, intent) {
  try {
    const cred = await signInWithPopup(auth, provider());
    return cred.user;
  } catch (e) {
    if (!REDIRECT_FALLBACK.includes(e.code)) throw e;
    try { sessionStorage.setItem(INTENT_KEY, intent); } catch {}
    await signInWithRedirect(auth, provider());
    return null; // the page navigates away
  }
}

export async function takeRedirectResult(auth) {
  let intent = null;
  try { intent = sessionStorage.getItem(INTENT_KEY); sessionStorage.removeItem(INTENT_KEY); } catch {}
  const cred = await getRedirectResult(auth);
  return cred ? { user: cred.user, intent: intent || 'login' } : null;
}

export async function linkGoogle(user) {
  const cred = await linkWithPopup(user, provider());
  return cred.user;
}

export async function unlinkGoogle(user) {
  return unlink(user, 'google.com');
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/googleAuth.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/googleAuth.js tests/googleAuth.test.mjs
git commit -m "feat(auth): Google sign-in helpers

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Client — extract `completeLogin` (no behaviour change)

**Files:**
- Modify: `src/main.js` — the `#login-form` submit handler (currently ~`src/main.js:5145-5213`)

**Interfaces:**
- Produces: `async function completeLogin(ic, { viaGoogle = false, pwd = '' } = {}): Promise<boolean>` (module-level in `src/main.js`). Reads `staff/{ic}`; on missing or `inactive` shows the existing toast, signs out, returns `false`. Otherwise performs every post-login step the form handler does today and returns `true`. `showFirstLoginWarning` is computed only when `!viaGoogle`.

- [ ] **Step 1: Move the code.** In `src/main.js`, cut everything in the `#login-form` handler from `// Load the staff profile for the now-authenticated user.` down to the final `render();` and paste it into a new module-level function directly above `function renderLogin` (or above the handler's enclosing function — next to `restoreSessionUser` is fine):

```js
// Shared by the IC + password form and "Log masuk dengan Google": everything that
// happens once Firebase Auth has a real session for staff `ic`.
async function completeLogin(ic, { viaGoogle = false, pwd = '' } = {}) {
  // Load the staff profile for the now-authenticated user.
  const snap = await getDoc(doc(db, 'staff', ic));
  if (!snap.exists()) { showToast('Profil staf tidak dijumpai. Sila hubungi HR/Admin.'); await signOut(auth); return false; }
  // (keep the existing inactive comment block)
  if (snap.data().inactive) { showToast('⚠️ Akaun anda tidak aktif. Sila hubungi HR/Admin.'); await signOut(auth); return false; }
  user = snap.data();
  initData();

  // Google logins have no password to compare, so the first-login warning only
  // applies to IC + password.
  showFirstLoginWarning = !viaGoogle && (pwd === (user.ic || '').trim());
  // ... rest of the moved block unchanged, ending with:
  view = 'dashboard';
  render();
  return true;
}
```

and replace the moved block in the handler with:

```js
    await completeLogin(ic, { pwd });
```

- [ ] **Step 2: Verify** — run `npx vite build` (expect `✓ built`) and the unit suite: `for f in tests/*.test.mjs; do case $f in *rules*|*functions*) continue;; esac; node --test "$f" || echo "FAIL $f"; done` (expect no `FAIL`). Then manual: `npm run dev`, log in with an IC + password → dashboard appears, first-login warning still appears when password = IC.

- [ ] **Step 3: Commit**

```bash
git add src/main.js
git commit -m "refactor(auth): extract completeLogin from the login form handler

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Client — "Log masuk dengan Google" + session bootstrap for no-`ic` users

**Files:**
- Modify: `src/main.js` — imports (`~L36-46`, `~L60-66`), new functions next to `completeLogin`, login form markup (after `<button type="submit" class="btn-primary">Log Masuk</button>`, ~`L5045`), bootstrap IIFE (~`L4674-4707`)

**Interfaces:**
- Consumes: `completeLogin` (Task 6); `signInWithGoogle`, `takeRedirectResult`, `googleErrorMessage` (Task 5).
- Produces:
  - `async function resolveGoogleSession(): Promise<{ ic: string } | { pending: true } | { unlinked: true }>` — for the current non-anonymous user.
  - `async function backToAnonymousLogin(message?: string): Promise<void>` — shows `message` (if any), ensures an anonymous session, loads the directory, renders the login screen.
  - `window.loginWithGoogle()`.
  - `GOOGLE_PENDING_MSG`, `GOOGLE_UNLINKED_MSG` constants.

- [ ] **Step 1: Imports.** Add to the `src/main.js` imports (`getIdTokenResult` / `delete` are methods on the user object, no import needed):

```js
import { signInWithGoogle, takeRedirectResult, googleErrorMessage, googleIdentityOf, linkGoogle, unlinkGoogle } from './googleAuth.js';
```

- [ ] **Step 2: Add the session helpers** below `completeLogin`:

```js
const GOOGLE_PENDING_MSG = 'Permohonan pendaftaran anda sedang disemak HR/Admin. Anda boleh log masuk dengan Google selepas diluluskan.';
const GOOGLE_UNLINKED_MSG = 'Akaun Google ini belum dipautkan kepada mana-mana staf.\n\nLog masuk dengan IC dahulu dan pautkan di Tetapan Akaun, atau daftar sebagai staf baharu.';

// A non-anonymous Firebase user that is not (yet) a provisioned staff member has
// no `ic` claim. Either they registered with Google and are waiting for HR, or
// they used an unlinked Gmail — in that case delete the throwaway user, otherwise
// it would block linking that Gmail to their IC account later.
async function resolveGoogleSession() {
  const u = auth.currentUser;
  const tok = await u.getIdTokenResult(true);
  if (typeof tok.claims.ic === 'string') return { ic: tok.claims.ic };
  let pending = false;
  try {
    const qs = await getDocs(query(collection(db, 'registration_requests'),
      where('googleUid', '==', u.uid), where('status', 'in', ['pending', 'approving'])));
    pending = !qs.empty;
  } catch (e) { console.warn('[AUTH] pending-registration check failed:', e.code || e.message); }
  if (pending) { await signOut(auth); return { pending: true }; }
  try { await u.delete(); } catch (e) { await signOut(auth).catch(() => {}); }
  return { unlinked: true };
}

async function backToAnonymousLogin(message) {
  if (message) showToast(message);
  if (!auth.currentUser) await signInAnonymously(auth);
  await loadDirectory();
  view = 'login';
  render();
}

window.loginWithGoogle = async function() {
  let gUser;
  try { gUser = await signInWithGoogle(auth, 'login'); }
  catch (e) { const m = googleErrorMessage(e.code); if (m) showToast('⚠️ ' + m); return; }
  if (!gUser) return; // redirect in progress
  const r = await resolveGoogleSession();
  if (r.ic) { await completeLogin(r.ic, { viaGoogle: true }); return; }
  await backToAnonymousLogin(r.pending ? GOOGLE_PENDING_MSG : GOOGLE_UNLINKED_MSG);
};
```

`render()` (`src/main.js:4901`) already forces `view = 'login'` when `user` is null; the explicit assignment just states the intent.

- [ ] **Step 3: Button.** Directly after `<button type="submit" class="btn-primary">Log Masuk</button>` inside `#login-form`'s closing `</form>`, add (outside the form so it never submits it):

```html
        <div style="display:flex; align-items:center; gap:0.6rem; margin:1rem 0 0.75rem; color:var(--text-muted); font-size:0.8rem;">
          <span style="flex:1; height:1px; background:var(--border);"></span>atau<span style="flex:1; height:1px; background:var(--border);"></span>
        </div>
        <button type="button" onclick="window.loginWithGoogle()" class="neu-btn" style="width:100%; display:flex; align-items:center; justify-content:center; gap:0.6rem; padding:0.8rem; font-weight:600;">
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
          Log masuk dengan Google
        </button>
```

- [ ] **Step 4: Bootstrap.** In the auth bootstrap IIFE, right after `await auth.authStateReady();`, add redirect handling, and gate the "real session" branch on the `ic` claim:

```js
    await auth.authStateReady();
    // Returning from a signInWithRedirect fallback (popup blocked).
    let redirect = null;
    try { redirect = await takeRedirectResult(auth); }
    catch (e) { const m = googleErrorMessage(e.code); if (m) showToast('⚠️ ' + m); }

    if (auth.currentUser && !auth.currentUser.isAnonymous) {
      const gs = await resolveGoogleSession();
      if (!gs.ic) {
        await backToAnonymousLogin(gs.pending ? GOOGLE_PENDING_MSG : GOOGLE_UNLINKED_MSG);
        return;
      }
      if (redirect && redirect.intent === 'login') {
        await completeLogin(gs.ic, { viaGoogle: true });
        return;
      }
      console.log('[AUTH] Restored real session:', auth.currentUser.uid);
      // ... existing restoreSessionUser / loadDirectory / initData lines unchanged
```

Note `resolveGoogleSession` returns `{ ic }` immediately for every existing IC + password session (they all carry the claim), so a normal reload is unaffected apart from one token refresh.

- [ ] **Step 5: Verify** — `npx vite build` passes; unit suite passes (command from Task 6). Manual with `npm run dev` **after the Google provider is enabled on a test project or with the Auth emulator** (`npx firebase emulators:start --only auth,firestore` and point the app at it only if the repo already supports that; otherwise defer to Task 11's manual checklist): an unlinked Gmail → toast `GOOGLE_UNLINKED_MSG`, login screen, and the user no longer appears in Firebase Console → Authentication.

- [ ] **Step 6: Commit**

```bash
git add src/main.js
git commit -m "feat(auth): Log masuk dengan Google; no-ic sessions return to login

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Client — "Daftar dengan Google"

**Files:**
- Modify: `src/main.js` — `window.openRegisterModal` / `closeRegisterModal` / `submitRegister` (~`L2026-2072`), register modal markup (~`L5089-5140`), "Staf baharu?" link area (~`L5048-5053`), bootstrap redirect branch from Task 7.

**Interfaces:**
- Consumes: `signInWithGoogle`, `googleIdentityOf`, `googleErrorMessage` (Task 5); `resolveGoogleSession`, `backToAnonymousLogin`, `completeLogin` (Tasks 6-7).
- Produces: module state `let googleRegistrant = null; // { uid, sub, email, displayName }`; `window.registerWithGoogle()`; `async function openGoogleRegistration(gUser)`.

- [ ] **Step 1: State + open.** Next to `let showRegisterModal = false;` add `let googleRegistrant = null;`. Next to `window.openRegisterModal` add:

```js
async function openGoogleRegistration(gUser) {
  const id = googleIdentityOf(gUser);
  googleRegistrant = { uid: gUser.uid, sub: id ? id.sub : null, email: id ? id.email : gUser.email, displayName: (id && id.displayName) || gUser.displayName || '' };
  showRegisterModal = true;
  render();
}

window.registerWithGoogle = async function() {
  let gUser;
  try { gUser = await signInWithGoogle(auth, 'register'); }
  catch (e) { const m = googleErrorMessage(e.code); if (m) showToast('⚠️ ' + m); return; }
  if (!gUser) return; // redirect in progress
  const tok = await gUser.getIdTokenResult(true);
  if (typeof tok.claims.ic === 'string') {
    showToast('Akaun Google ini sudah dipautkan. Anda telah log masuk.');
    await completeLogin(tok.claims.ic, { viaGoogle: true });
    return;
  }
  const gs = await resolvePendingOnly(gUser);
  if (gs === 'pending') { await signOut(auth); await backToAnonymousLogin(GOOGLE_PENDING_MSG); return; }
  await openGoogleRegistration(gUser);
};

// Like resolveGoogleSession but never deletes — the registrant is about to use this user.
async function resolvePendingOnly(u) {
  try {
    const qs = await getDocs(query(collection(db, 'registration_requests'),
      where('googleUid', '==', u.uid), where('status', 'in', ['pending', 'approving'])));
    return qs.empty ? 'none' : 'pending';
  } catch { return 'none'; }
}
```

- [ ] **Step 2: Close discards the throwaway user.** Replace `window.closeRegisterModal`:

```js
window.closeRegisterModal = async function() {
  showRegisterModal = false;
  if (googleRegistrant) {
    // Closed without submitting: delete the temporary Google user so this Gmail
    // can still be linked or used to register later.
    googleRegistrant = null;
    try { await auth.currentUser?.delete(); } catch { await signOut(auth).catch(() => {}); }
    await backToAnonymousLogin();
    return;
  }
  render();
};
```

- [ ] **Step 3: Submit carries the Google fields.** In `window.submitRegister`, change the `reqData` line to:

```js
  const reqData = { name, ic, branch, category, phone, status: 'pending', submittedAt: Date.now(),
    ...(googleRegistrant ? { googleUid: googleRegistrant.uid, googleSub: googleRegistrant.sub, googleEmail: googleRegistrant.email } : {}) };
```

and after `window.closeRegisterModal();` in the success path, make sure the submitted Google user is **not** deleted: set `googleRegistrant = null` **before** calling close, then sign out to the anonymous login:

```js
    const wasGoogle = !!googleRegistrant;
    googleRegistrant = null;
    showRegisterModal = false;
    if (wasGoogle) { await signOut(auth); await backToAnonymousLogin(); } else { render(); }
```

(replace the existing `window.closeRegisterModal();` call in the success path with the block above, keeping the success toast before it).

- [ ] **Step 4: Markup.** In the register modal, directly after the `<p>Permohonan akan disemak oleh HR/Admin</p>` header block and before `<form onsubmit="window.submitRegister(event)">`, add:

```js
        ${googleRegistrant ? `
          <div style="background: rgba(16,185,129,0.08); border: 1px solid rgba(16,185,129,0.25); border-radius: 0.75rem; padding: 0.7rem 0.9rem; margin-bottom: 1rem; font-size: 0.82rem;">
            ✅ Akaun Google: <strong>${escapeHtml(googleRegistrant.email || '')}</strong><br>
            <span style="color: var(--text-muted);">Selepas diluluskan, anda boleh log masuk dengan Google.</span>
          </div>` : `
          <button type="button" onclick="window.registerWithGoogle()" class="neu-btn" style="width:100%; margin-bottom:1rem; padding:0.75rem; font-weight:600;">Daftar dengan Google</button>`}
```

`escapeHtml` is the existing helper at `src/main.js:5745`.

Prefill the name input `#reg-name` by adding `value="${googleRegistrant ? escapeHtml((googleRegistrant.displayName || '').toUpperCase()) : ''}"` to its tag.

- [ ] **Step 5: Redirect fallback.** In the bootstrap IIFE (Task 7 Step 4), insert this **immediately before** `const gs = await resolveGoogleSession();`, so a registrant returning from a redirect keeps their temporary user instead of having it deleted:

```js
      if (redirect && redirect.intent === 'register') {
        const tok = await auth.currentUser.getIdTokenResult(true);
        if (typeof tok.claims.ic === 'string') { await completeLogin(tok.claims.ic, { viaGoogle: true }); return; }
        if ((await resolvePendingOnly(auth.currentUser)) === 'pending') { await signOut(auth); await backToAnonymousLogin(GOOGLE_PENDING_MSG); return; }
        await loadDirectory();
        await openGoogleRegistration(auth.currentUser);
        return;
      }
```

- [ ] **Step 6: "Staf baharu?" link.** Leave "Daftar di sini" as is — the Google button lives inside the modal it opens.

- [ ] **Step 7: Verify** — `npx vite build`; unit suite. Manual deferred to Task 11.

- [ ] **Step 8: Commit**

```bash
git add src/main.js
git commit -m "feat(auth): Daftar dengan Google — registration carries the Google identity

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Client — Tetapan Akaun "Akaun Google" card (self link/unlink)

**Files:**
- Modify: `src/main.js` — `case 'settings':` view, inside the `<section style="display: grid; …">` after the password card (before `</section>` at ~`L11325`); new window functions near `window.changePassword` (~`L1820`).

**Interfaces:**
- Consumes: `linkGoogle`, `unlinkGoogle`, `googleIdentityOf`, `googleErrorMessage` (Task 5).
- Produces: `window.linkMyGoogle()`, `window.unlinkMyGoogle()`.

- [ ] **Step 1: Functions** (next to `window.changePassword`):

```js
window.linkMyGoogle = async function() {
  if (!auth.currentUser || auth.currentUser.isAnonymous || !user) { showToast('Sesi tidak sah. Sila log masuk semula.'); return; }
  try {
    const u = await linkGoogle(auth.currentUser);
    const id = googleIdentityOf(u);
    await updateDoc(doc(db, 'staff', user.ic), { googleEmail: id ? id.email : null });
    window.logSystemActivity('Linked Google account');
    showToast('✅ Akaun Google berjaya dipautkan. Anda kini boleh log masuk dengan Google.');
  } catch (e) {
    const m = googleErrorMessage(e.code); if (m) showToast('⚠️ ' + m);
  }
  render();
};

window.unlinkMyGoogle = async function() {
  if (!auth.currentUser || !user) return;
  if (!await showConfirm('Buang pautan akaun Google? Anda perlu log masuk dengan IC dan kata laluan selepas ini.')) return;
  try {
    await unlinkGoogle(auth.currentUser);
    await updateDoc(doc(db, 'staff', user.ic), { googleEmail: null });
    window.logSystemActivity('Unlinked Google account');
    showToast('Pautan akaun Google telah dibuang.');
  } catch (e) {
    const m = googleErrorMessage(e.code); if (m) showToast('⚠️ ' + m);
  }
  render();
};
```

- [ ] **Step 2: Card markup** — inside the settings `<section>` grid, after the password card's closing `</div>`:

```js
            ${(() => {
              const g = googleIdentityOf(auth.currentUser);
              return `
            <div class="glass-card fade-in" style="padding: 2.5rem;">
                <h2 style="font-size: 1.25rem; font-weight: 600; color: var(--primary); margin-bottom: 1rem;">Akaun Google</h2>
                ${g ? `
                  <p style="margin-bottom: 1.25rem;">✅ Dipautkan: <strong>${escapeHtml(g.email || '')}</strong></p>
                  <button class="neu-btn" onclick="window.unlinkMyGoogle()" style="width: 100%; padding: 0.9rem; color: #ef4444; font-weight: 600;">Buang pautan</button>
                ` : `
                  <p style="color: var(--text-muted); margin-bottom: 1.25rem;">Pautkan akaun Google untuk log masuk tanpa kata laluan. Log masuk dengan IC dan kata laluan masih boleh digunakan.</p>
                  <button class="neu-btn" onclick="window.linkMyGoogle()" style="width: 100%; padding: 0.9rem; color: var(--primary); font-weight: 600;">Pautkan akaun Google</button>
                `}
            </div>`;
            })()}
```

`escapeHtml` is the existing helper at `src/main.js:5745`.

- [ ] **Step 3: Verify** — `npx vite build`; unit suite; manual: Tetapan shows the card with "Pautkan akaun Google" for a password-only account.

- [ ] **Step 4: Commit**

```bash
git add src/main.js
git commit -m "feat(auth): Akaun Google card in Tetapan — link and unlink own Google sign-in

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Client — HR approve via backend; Google status + unlink in staff edit

**Files:**
- Modify: `src/main.js` — after `otpPost` (~`L456`) add `authedPost`; `window.approveRegistration` (~`L2073-2096`); staff edit modal (`renderStaffModal`-area, the "Account Password" row ~`L11503-11506`); reg-request card (~`L8789+`) to show a Google badge.

**Interfaces:**
- Consumes: backend endpoints (Task 4); `formatPersonName` (existing).
- Produces: `async function authedPost(path, payload): Promise<{ ok, status, data }>`; `window.hrUnlinkGoogle(ic)`; `ADMIN_ERR_MS` map.

- [ ] **Step 1: `authedPost`** below `otpPost`:

```js
// Same backend as OTP reset, but for HR/Admin actions: the server verifies our
// Firebase ID token and the manageStaff claim.
async function authedPost(path, payload) {
  if (!auth.currentUser || auth.currentUser.isAnonymous) return { ok: false, status: 401, data: { error: 'unauthenticated' } };
  const token = await auth.currentUser.getIdToken();
  let res;
  try {
    res = await fetch(`${OTP_API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
  } catch { return { ok: false, status: 0, data: { error: 'network' } }; }
  let data = {};
  try { data = await res.json(); } catch { /* non-JSON */ }
  return { ok: res.ok, status: res.status, data };
}

const ADMIN_ERR_MS = {
  network: 'Tidak dapat menghubungi pelayan. Sila cuba lagi.',
  unauthenticated: 'Sesi tidak sah. Sila log masuk semula.',
  forbidden: 'Anda tiada kebenaran untuk tindakan ini.',
  not_found: 'Rekod tidak dijumpai.',
  not_pending: 'Permohonan ini sudah diproses.',
  ic_exists: 'No. IC ini sudah wujud dalam sistem. Permohonan ditolak.',
  missing_fields: 'Maklumat tidak lengkap.',
  server_error: 'Ralat pelayan. Sila cuba lagi — tindakan ini selamat diulang.',
};
const adminErrMsg = (data) => ADMIN_ERR_MS[data && data.error] || 'Ralat tidak dijangka. Sila cuba lagi.';
```

- [ ] **Step 2: Replace `window.approveRegistration`** body:

```js
window.approveRegistration = async function(docId) {
  const req = registrationRequests.find(r => r.docId === docId);
  if (!req) return;
  const name = window.formatPersonName(req.name);
  const r = await authedPost('/api/approve-registration', { docId, name });
  if (!r.ok) { showToast('⚠️ ' + adminErrMsg(r.data)); return; }
  window.logSystemActivity(`Approved registration: ${req.name} (${req.ic})`);
  const googleLine = r.data.googleEmail ? `\nAnda juga boleh log masuk dengan Google (${r.data.googleEmail}).` : '';
  await window.sendWhatsApp(req.phone, `✅ *Selamat datang ke KSB Leave System!*\n\nNama: ${req.name}\nKata Laluan: ${req.ic}${googleLine}\n\nSila log masuk dan tukar kata laluan anda.`);
  showToast(`✅ Permohonan ${req.name} telah diluluskan. Akaun log masuk sudah aktif.\nKata laluan awal ialah No. IC (${req.ic}).`);
};
```

- [ ] **Step 3: Google badge on the request card.** In the reg-request card markup, next to the applicant's name, add `${req.googleEmail ? `<span style="font-size:0.7rem; background:rgba(59,130,246,0.12); color:#3b82f6; border-radius:999px; padding:1px 8px; margin-left:6px;">Google: ${escapeHtml(req.googleEmail)}</span>` : ''}`. (Find the line that renders `req.name` inside the `Permohonan Daftar Baharu` list.)

- [ ] **Step 4: Staff edit modal.** After the "Account Password" `<div>` (the one containing `id="edit-password"`), add:

```js
              <div style="display: flex; flex-direction: column;">
                 <label style="font-size: 0.75rem; text-transform: uppercase; color: var(--text-muted); font-weight: 600; margin-bottom: 0.5rem; letter-spacing: 0.5px;">Akaun Google</label>
                 ${staff.googleEmail ? `
                   <div style="display:flex; align-items:center; gap:0.5rem;">
                     <span style="flex:1;">🔗 ${escapeHtml(staff.googleEmail)}</span>
                     <button type="button" class="neu-btn" onclick="window.hrUnlinkGoogle('${staff.ic}')" style="padding:0.4rem 0.8rem; color:#ef4444; font-size:0.75rem; font-weight:600;">Buang pautan</button>
                   </div>` : `<span style="color: var(--text-muted);">Belum dipautkan</span>`}
              </div>
```

and the handler next to `window.adminSetPassword`:

```js
window.hrUnlinkGoogle = async function(ic) {
  const s = staffList.find(x => x.ic === ic);
  if (!await showConfirm(`Buang pautan akaun Google untuk ${s ? s.name : ic}? Staf perlu log masuk dengan IC dan kata laluan.`)) return;
  const r = await authedPost('/api/unlink-google', { ic });
  if (!r.ok) { showToast('⚠️ ' + adminErrMsg(r.data)); return; }
  window.logSystemActivity(`Unlinked Google account: ${s ? s.name : ''} (${ic})`);
  showToast('Pautan akaun Google telah dibuang.');
};
```

The `staff` listener updates `staffList` when the backend clears `googleEmail`, and the modal re-renders from it.

- [ ] **Step 5: Verify** — `npx vite build`; unit suite.

- [ ] **Step 6: Commit**

```bash
git add src/main.js
git commit -m "feat(auth): HR approval activates accounts via backend; Google status and unlink in staff edit

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Version bump, full verification, rollout checklist

**Files:**
- Modify: `package.json`, `package-lock.json` (version `2.6.0`)
- Modify: `src/main.js` help-bot FAQ (search `Lupa Kata Laluan?` FAQ entry ~`L929`) — add one entry
- Modify: `docs/superpowers/specs/2026-10-17-google-sign-in-design.md` status line → `implemented`

- [ ] **Step 1: FAQ entry.** Directly after the `{ id:'forgot-password', … }` object (~`src/main.js:927`), add:

```js
  { id:'google-login', cat:'Akaun', keywords:['google','gmail','log masuk google','pautkan','daftar google'],
    q:'Log masuk dengan Google',
    a:'Boleh. Log masuk dengan IC dan kata laluan dahulu, kemudian pergi ke <strong>Tetapan → Akaun Google → Pautkan akaun Google</strong>. Selepas itu tekan <strong>"Log masuk dengan Google"</strong> di skrin log masuk. Staf baharu boleh tekan <strong>"Daftar dengan Google"</strong> dalam borang pendaftaran.' },
```

- [ ] **Step 2: Bump version** — `npm version 2.6.0 --no-git-tag-version`.

- [ ] **Step 3: Full verification**

```bash
npx vite build
for f in tests/*.test.mjs; do case $f in *rules*|*functions*) continue;; esac; node --test "$f" >/dev/null 2>&1 || echo "FAIL $f"; done
npx firebase emulators:exec --only firestore "node --test tests/rules.test.mjs"
(cd otp-backend && node --test lib/)
```

Expected: build OK, no `FAIL` lines, rules `# pass 55 # fail 0`, otp-backend all pass.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/main.js docs/superpowers/specs/2026-10-17-google-sign-in-design.md
git commit -m "feat(auth): Google sign-in alongside IC + password; bump to v2.6.0

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: Hand the user the rollout checklist** (do not run deploys without their go-ahead):

1. `npx firebase deploy --only firestore:rules` → log in with IC + password on the live site and confirm the dashboard loads.
2. Deploy `otp-backend` to Vercel (same way as before) → `curl -X OPTIONS -H "Origin: https://cuti-staff.ksbsb.com.my" -i https://otp-backend-ochre.vercel.app/api/unlink-google` shows `Access-Control-Allow-Headers: Content-Type, Authorization`.
3. Firebase Console → Authentication → Sign-in method → enable **Google**; Settings → Authorized domains contains `cuti-staff.ksbsb.com.my`.
4. Deploy the app (push to `main` → existing GitHub Actions cPanel deploy).
5. Manual checks on web **and** the APK:
   - link Google in Tetapan → log out → "Log masuk dengan Google" → dashboard;
   - unlinked Gmail → message, back at login, no new user in Authentication;
   - "Daftar dengan Google" → close the form → no user left; submit → pending message on next Google login → HR Lulus → Google login works; WhatsApp welcome mentions Google;
   - Tetapan "Buang pautan"; HR "Buang pautan" in staff edit;
   - set a linked staff `inactive` → Google login refused;
   - reload after Google login → session restored.
