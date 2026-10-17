// tests/rules.test.mjs — run via: firebase emulators:exec --only firestore "node --test tests/rules.test.mjs"
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { setDoc, getDoc, getDocs, updateDoc, deleteDoc, doc, collection, query, where } from "firebase/firestore";

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

test("staff can update only phone/email/address/photoUrl of own profile", async () => {
  const db = ctxDb(staffAuth("S1"));
  await assertSucceeds(updateDoc(doc(db, "staff", "S1"), { phone: "60111111111" }));
  await assertSucceeds(updateDoc(doc(db, "staff", "S1"), { photoUrl: "https://res.cloudinary.com/x/image/upload/p.jpg" }));
  await assertFails(updateDoc(doc(db, "staff", "S1"), { role: "super_admin" }));
});

test("only manageStaff can write staff records", async () => {
  const approver = ctxDb(approverAuth("SUP"));
  await assertFails(setDoc(doc(approver, "staff", "S9"), { ic: "S9", role: "staff" }));
  const hr = ctxDb(hrAuth("HR1"));
  await assertSucceeds(setDoc(doc(hr, "staff", "S9"), { ic: "S9", role: "staff" }));
});

test("approver (canApprove only) cannot write config/rolePermissions; since v2.5.17 neither can HR (manageStaff)", async () => {
  const approver = ctxDb(approverAuth("SUP"));
  await assertFails(setDoc(doc(approver, "config", "rolePermissions"), { supervisor: { canApprove: true, manageStaff: true } }));
  // Access control is Admin/Super Admin only — see "access control docs" below.
  const hr = ctxDb(hrAuth("HR1"));
  await assertFails(setDoc(doc(hr, "config", "rolePermissions"), { supervisor: { canApprove: true, manageStaff: false } }));
});

// ── config/publicHolidays — HOD Cawangan ──────────────────────────────────────
// The UI grants hod_cawangan the right to edit Terengganu public holidays
// (main.js canEditTerengganu), but the blanket `config/{id}` rule requires
// manageStaff, which hod_cawangan does not have. The save therefore always failed
// with "Ralat menyimpan". There is no claim describing this permission, so the
// rule reads the role off the staff doc — a role change then takes effect
// immediately, with no re-provisioning (onStaffWrite is not deployed).

const seedStaffRole = (ic, role) => testEnv.withSecurityRulesDisabled(async (ctx) => {
  await setDoc(doc(ctx.firestore(), "staff", ic), { ic, role, name: "X" });
});

test("hod_cawangan can save public holidays", async () => {
  await seedStaffRole("HOD1", "hod_cawangan");
  const hod = ctxDb(staffAuth("HOD1"));
  await assertSucceeds(setDoc(doc(hod, "config", "publicHolidays"),
    { terengganu: [{ date: "2026-09-16", name: "Hari Malaysia" }] }, { merge: true }));
});

test("hod_cawangan gains NOTHING else under config/", async () => {
  await seedStaffRole("HOD1", "hod_cawangan");
  const hod = ctxDb(staffAuth("HOD1"));
  await assertFails(setDoc(doc(hod, "config", "rolePermissions"), { staff: { canApprove: true } }));
  await assertFails(setDoc(doc(hod, "config", "approvalRouting"), { operation_balok: { needs_tl: false } }));
});

test("an ordinary staff member still cannot save public holidays", async () => {
  await seedStaffRole("S1", "staff");
  const s = ctxDb(staffAuth("S1"));
  await assertFails(setDoc(doc(s, "config", "publicHolidays"),
    { terengganu: [{ date: "2026-09-16", name: "Hari Malaysia" }] }, { merge: true }));
});

test("a signed-in user with no staff doc cannot save public holidays", async () => {
  const ghost = ctxDb(staffAuth("NOBODY"));
  await assertFails(setDoc(doc(ghost, "config", "publicHolidays"),
    { terengganu: [{ date: "2026-09-16", name: "Hari Malaysia" }] }, { merge: true }));
});

// Since v2.5.19 public holidays are per zone (src/holidayAccess.js mirrors this).
const seedHR = (ic, hrState) => testEnv.withSecurityRulesDisabled(async (ctx) => {
  await setDoc(doc(ctx.firestore(), "staff", ic), { ic, role: "hr", name: "HR", branch: "Klinik A", ...(hrState ? { hrState } : {}) });
});
const PH = (key) => ({ [key]: [{ date: "2026-09-16", name: "Hari Malaysia" }] });

test("HR edits only its own zone's public holidays", async () => {
  await seedHR("HRP", "Pahang"); await seedHR("HRT", "Terengganu");
  const hrp = ctxDb(hrAuth("HRP")), hrt = ctxDb(hrAuth("HRT"));
  await assertSucceeds(setDoc(doc(hrp, "config", "publicHolidays"), PH("pahang"), { merge: true }));
  await assertFails(setDoc(doc(hrp, "config", "publicHolidays"), PH("terengganu"), { merge: true }));
  await assertSucceeds(setDoc(doc(hrt, "config", "publicHolidays"), PH("terengganu"), { merge: true }));
  // A DIFFERENT Pahang list — writing back identical data changes no key and is a harmless no-op.
  await assertFails(setDoc(doc(hrt, "config", "publicHolidays"), { pahang: [] }, { merge: true }));
});

test("HR without hrState is treated as Pahang (same default as the app)", async () => {
  await seedHR("HRX", null);
  const hr = ctxDb(hrAuth("HRX"));
  await assertSucceeds(setDoc(doc(hr, "config", "publicHolidays"), PH("pahang"), { merge: true }));
  await assertFails(setDoc(doc(hr, "config", "publicHolidays"), PH("terengganu"), { merge: true }));
});

test("hod_cawangan cannot touch the Pahang list; admin edits both", async () => {
  await seedStaffRole("HOD1", "hod_cawangan");
  await assertFails(setDoc(doc(ctxDb(staffAuth("HOD1")), "config", "publicHolidays"), PH("pahang"), { merge: true }));
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "staff", "ADM"), { ic: "ADM", role: "admin", name: "A", branch: "Management / HQ" });
  });
  const adm = ctxDb(hrAuth("ADM"));
  await assertSucceeds(setDoc(doc(adm, "config", "publicHolidays"), PH("pahang"), { merge: true }));
  await assertSucceeds(setDoc(doc(adm, "config", "publicHolidays"), PH("terengganu"), { merge: true }));
});

test("HR keeps other config writes (routing)", async () => {
  await seedHR("HRP", "Pahang");
  await assertSucceeds(setDoc(doc(ctxDb(hrAuth("HRP")), "config", "approvalRouting"), { x: 1 }));
});

// ── Branch-scoped HOD Cawangan ───────────────────────────────────────────────
// hod_cawangan holds NO manageStaff claim. The right to edit leave data for
// their OWN branch is granted by reading the caller's staff doc, the same way
// config/publicHolidays does. The field allowlists are what stop role/branch
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

// ── Anak syarikat: KSB Pharma diasingkan dari data klinik ────────────────────
// Staf/HR KSB Pharma tidak boleh membaca atau mengubah staf, cuti, cawangan,
// log atau konfigurasi klinik. Pengguna klinik tidak berubah.

const PHARMA = "KSB Pharma Sdn. Bhd.";
const seedPharma = () => testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, "staff", "PHR"), { ic: "PHR", name: "SYARIFAH", branch: PHARMA, role: "hr" });
  await setDoc(doc(db, "staff", "PS1"), { ic: "PS1", name: "AMIR", branch: PHARMA, role: "staff" });
  await setDoc(doc(db, "leaves", "LP1"), { ic: "PS1", name: "AMIR", branch: PHARMA, type: "annual", status: "PENDING", startDate: "2026-07-01", endDate: "2026-07-01", days: 1, reason: "x" });
  await setDoc(doc(db, "branches", "B_PHARMA"), { name: PHARMA, state: "Pahang" });
  await setDoc(doc(db, "branches", "B_A"), { name: "Klinik A", state: "Pahang" });
  await setDoc(doc(db, "audit_logs", "A1"), { action: "x" });
  await setDoc(doc(db, "notifications", "N1"), { recipientIC: "S1", title: "x" });
  await setDoc(doc(db, "notifications", "N2"), { recipientIC: "PS1", title: "y" });
});

test("pharma: cannot read clinic staff or clinic leave", async () => {
  await seedPharma();
  for (const tok of [hrAuth("PHR"), staffAuth("PS1")]) {
    const db = ctxDb(tok);
    await assertFails(getDoc(doc(db, "staff", "S1")));
    await assertFails(getDoc(doc(db, "leaves", "L1")));
    await assertFails(getDocs(collection(db, "leaves")));
    await assertFails(getDocs(collection(db, "staff")));
  }
});

test("pharma: can read own company staff/leave with a branch-filtered query", async () => {
  await seedPharma();
  const db = ctxDb(hrAuth("PHR"));
  const st = await assertSucceeds(getDocs(query(collection(db, "staff"), where("branch", "==", PHARMA))));
  assert.strictEqual(st.size, 2);
  const lv = await assertSucceeds(getDocs(query(collection(db, "leaves"), where("branch", "==", PHARMA))));
  assert.strictEqual(lv.size, 1);
  await assertSucceeds(getDoc(doc(db, "staff", "PS1")));
  const br = await assertSucceeds(getDocs(query(collection(db, "branches"), where("name", "==", PHARMA))));
  assert.strictEqual(br.size, 1);
  await assertFails(getDocs(collection(db, "branches")));
});

test("pharma HR: can approve own company leave but not clinic leave", async () => {
  await seedPharma();
  const db = ctxDb(hrAuth("PHR"));
  await assertSucceeds(updateDoc(doc(db, "leaves", "LP1"), { status: "APPROVED" }));
  await assertFails(updateDoc(doc(db, "leaves", "L1"), { status: "APPROVED" }));
  await assertFails(deleteDoc(doc(db, "leaves", "L1")));
  await assertFails(updateDoc(doc(db, "leaves", "LP1"), { branch: "Klinik A" }));
});

test("pharma HR: manages own company staff only, cannot move staff into a clinic", async () => {
  await seedPharma();
  const db = ctxDb(hrAuth("PHR"));
  await assertSucceeds(setDoc(doc(db, "staff", "PS2"), { ic: "PS2", name: "BARU", branch: PHARMA, role: "staff" }));
  await assertFails(setDoc(doc(db, "staff", "S9"), { ic: "S9", name: "X", branch: "Klinik A", role: "staff" }));
  await assertFails(updateDoc(doc(db, "staff", "S1"), { role: "hr" }));
  await assertFails(updateDoc(doc(db, "staff", "PS1"), { branch: "Klinik A" }));
  await assertFails(deleteDoc(doc(db, "staff", "S1")));
});

test("pharma HR: cannot write shared config, branches or clinic policy", async () => {
  await seedPharma();
  const db = ctxDb(hrAuth("PHR"));
  await assertFails(setDoc(doc(db, "config", "rolePermissions"), { hr: { manageStaff: true } }));
  await assertFails(setDoc(doc(db, "config", "policyContent"), { notice: "x" }, { merge: true }));
  await assertFails(setDoc(doc(db, "config", "publicHolidays"), { pahang: [] }, { merge: true }));
  await assertFails(setDoc(doc(db, "settings", "rbac"), {}));
  await assertFails(setDoc(doc(db, "branches", "B_NEW"), { name: "X" }));
});

test("pharma HR: can edit own company policy; staff can read it; clinic users unaffected", async () => {
  await seedPharma();
  await assertSucceeds(setDoc(doc(ctxDb(hrAuth("PHR")), "companyPolicy", PHARMA), { notice: "hi" }));
  await assertSucceeds(getDoc(doc(ctxDb(staffAuth("PS1")), "companyPolicy", PHARMA)));
  await assertFails(setDoc(doc(ctxDb(staffAuth("PS1")), "companyPolicy", PHARMA), { notice: "x" }));
  await assertFails(setDoc(doc(ctxDb(hrAuth("PHR")), "companyPolicy", "Klinik A"), { notice: "x" }));
});

test("pharma: no audit/wa logs, and only own notifications", async () => {
  await seedPharma();
  const db = ctxDb(staffAuth("PS1"));
  await assertFails(getDocs(collection(db, "audit_logs")));
  await assertFails(getDocs(collection(db, "wa_logs")));
  await assertFails(getDoc(doc(db, "notifications", "N1")));
  await assertSucceeds(getDoc(doc(db, "notifications", "N2")));
  await assertSucceeds(getDocs(query(collection(db, "notifications"), where("recipientIC", "==", "PS1"))));
});

const seedClinicHR = () => testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, "staff", "HR1"), { ic: "HR1", name: "NORHAZLINAH", branch: "Klinik A", role: "hr", hrState: "Pahang" });
  await setDoc(doc(db, "staff", "ADM"), { ic: "ADM", name: "ADMIN", branch: "Management / HQ", role: "admin" });
});

test("clinic HR: cannot read KSB Pharma leave, staff or branch", async () => {
  await seedPharma(); await seedClinicHR();
  const db = ctxDb(hrAuth("HR1"));
  await assertFails(getDoc(doc(db, "leaves", "LP1")));
  await assertFails(getDoc(doc(db, "staff", "PS1")));
  await assertFails(getDoc(doc(db, "branches", "B_PHARMA")));
  await assertFails(getDoc(doc(db, "companyPolicy", PHARMA)));
  // Pertanyaan tanpa tapis ditolak — mesti kecualikan anak syarikat.
  await assertFails(getDocs(collection(db, "leaves")));
});

test("clinic HR: cannot approve or edit KSB Pharma records", async () => {
  await seedPharma(); await seedClinicHR();
  const db = ctxDb(hrAuth("HR1"));
  await assertFails(updateDoc(doc(db, "leaves", "LP1"), { status: "APPROVED" }));
  await assertFails(updateDoc(doc(db, "staff", "PS1"), { role: "hr" }));
  await assertFails(setDoc(doc(db, "staff", "S9"), { ic: "S9", name: "X", branch: PHARMA, role: "staff" }));
  await assertFails(updateDoc(doc(db, "staff", "S1"), { branch: PHARMA }));
});

test("clinic users: not-in query sees all clinic data; HR keeps config writes", async () => {
  await seedPharma(); await seedClinicHR();
  for (const tok of [hrAuth("HR1"), staffAuth("S1")]) {
    const db = ctxDb(tok);
    const lv = await assertSucceeds(getDocs(query(collection(db, "leaves"), where("branch", "not-in", [PHARMA]))));
    assert.strictEqual(lv.size, 2);
    // Whole staff list: HR yes; a plain staff member no (v2.5.22 — see "staff reads" tests).
    if (tok.manageStaff) {
      const st = await assertSucceeds(getDocs(query(collection(db, "staff"), where("branch", "not-in", [PHARMA]))));
      assert.ok(st.docs.every(d => d.data().branch !== PHARMA));
    } else {
      await assertFails(getDocs(query(collection(db, "staff"), where("branch", "not-in", [PHARMA]))));
    }
    const br = await assertSucceeds(getDocs(query(collection(db, "branches"), where("name", "not-in", [PHARMA]))));
    assert.strictEqual(br.size, 1);
    await assertSucceeds(getDoc(doc(db, "leaves", "L1")));
  }
  const hr = ctxDb(hrAuth("HR1"));
  await assertSucceeds(getDocs(collection(hr, "audit_logs")));
  await assertSucceeds(setDoc(doc(hr, "config", "policyContent"), { notice: "x" }, { merge: true }));
});

test("group admin: sees and manages both clinics and KSB Pharma", async () => {
  await seedPharma(); await seedClinicHR();
  const db = ctxDb(hrAuth("ADM"));
  const lv = await assertSucceeds(getDocs(collection(db, "leaves")));
  assert.strictEqual(lv.size, 3);
  await assertSucceeds(getDocs(collection(db, "staff")));
  await assertSucceeds(getDocs(collection(db, "branches")));
  await assertSucceeds(updateDoc(doc(db, "leaves", "LP1"), { status: "APPROVED" }));
});

// ── Cuti sendiri: staf biasa langgan `where ic ==` sahaja (ensureLeavesListener) ──
test("staff can query own leaves by ic alone", async () => {
  const db = testEnv.authenticatedContext("S1", staffAuth("S1")).firestore();
  const snap = await assertSucceeds(getDocs(query(collection(db, "leaves"), where("ic", "==", "S1"))));
  assert.ok(snap.size >= 1);
});

test("pharma staff: own-ic query works, but cannot reach clinic leave by ic", async () => {
  // Clinic staff could already read clinic leave via companyOK; the new clause must
  // not open anything for KSB Pharma staff, who are confined to their own company.
  await seedPharma();
  const db = testEnv.authenticatedContext("PS1", staffAuth("PS1")).firestore();
  await assertSucceeds(getDocs(query(collection(db, "leaves"), where("ic", "==", "PS1"))));
  await assertFails(getDocs(query(collection(db, "leaves"), where("ic", "==", "S1"))));
});

// ── Staf biasa klinik: langgan pelulus sahaja (ensureStaffListener) ──────────
const APPROVER_ROLES_Q = ['super_admin', 'admin', 'hr', 'hod_cawangan', 'hod_balok', 'doctor_pic', 'supervisor', 'team_leader'];
test("clinic staff: approver-roles query excluding KSB Pharma is allowed", async () => {
  await seedPharma();
  const db = ctxDb(staffAuth("S1"));
  await assertSucceeds(getDocs(query(collection(db, "staff"),
    where("role", "in", APPROVER_ROLES_Q), where("branch", "!=", PHARMA))));
  // Without the branch filter it would include Pharma HR and must be rejected.
  await assertFails(getDocs(query(collection(db, "staff"), where("role", "in", APPROVER_ROLES_Q))));
});

// ── Doctor PIC: langgan cawangan sendiri sahaja (listenerScope 'branch') ──────
test("clinic doctor_pic: branch-equality queries on leaves and staff are allowed", async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "staff", "D1"), { ic: "D1", name: "DR A", branch: "Klinik A", role: "doctor_pic" });
    await setDoc(doc(ctx.firestore(), "leaves", "LBR"), { ic: "S9", name: "X", branch: "Klinik A", status: "PENDING" });
  });
  const db = ctxDb(approverAuth("D1"));
  const lv = await assertSucceeds(getDocs(query(collection(db, "leaves"), where("branch", "==", "Klinik A"))));
  assert.ok(lv.size >= 1);
  await assertSucceeds(getDocs(query(collection(db, "staff"), where("branch", "==", "Klinik A"))));
});

// ── Kawalan akses: RBAC + rolePermissions hanya Admin/Super Admin ─────────────
test("access control docs: only admin/super_admin can write; HR keeps other config", async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.firestore();
    await setDoc(doc(d, "staff", "ADM"), { ic: "ADM", name: "ADMIN", branch: "Management / HQ", role: "admin" });
    await setDoc(doc(d, "staff", "HR1"), { ic: "HR1", name: "HR", branch: "Klinik A", role: "hr" });
  });
  const hr = ctxDb(hrAuth("HR1"));
  await assertFails(setDoc(doc(hr, "settings", "rbac"), { staff: {} }));
  await assertFails(setDoc(doc(hr, "config", "rolePermissions"), { staff: { canApprove: true } }));
  await assertFails(setDoc(doc(hr, "config", "rolePermissionsSync"), { pendingRoles: [] }));
  await assertSucceeds(setDoc(doc(hr, "settings", "staff_config"), { staffCategories: [] }));
  await assertSucceeds(setDoc(doc(hr, "config", "approvalRouting"), { x: 1 }));
  await assertSucceeds(getDoc(doc(hr, "settings", "rbac")));

  const adm = ctxDb(hrAuth("ADM"));
  await assertSucceeds(setDoc(doc(adm, "settings", "rbac"), { staff: {} }));
  await assertSucceeds(setDoc(doc(adm, "config", "rolePermissions"), { staff: { canApprove: false } }));
  await assertSucceeds(setDoc(doc(adm, "config", "rolePermissionsSync"), { pendingRoles: [] }));
});

// ── Bacaan staf (v2.5.22): sendiri, pelulus, pemegang claim, HOD cawangan ─────
const seedStaffReads = () => testEnv.withSecurityRulesDisabled(async (ctx) => {
  const d = ctx.firestore();
  await setDoc(doc(d, "staff", "P1"), { ic: "P1", role: "staff", name: "PLAIN 1", branch: "Klinik A" });
  await setDoc(doc(d, "staff", "P2"), { ic: "P2", role: "staff", name: "PLAIN 2", branch: "Klinik A" });
  await setDoc(doc(d, "staff", "PB"), { ic: "PB", role: "staff", name: "PLAIN B", branch: "Klinik B" });
  await setDoc(doc(d, "staff", "DR"), { ic: "DR", role: "doctor_pic", name: "DR", branch: "Klinik A" });
  await setDoc(doc(d, "staff", "HODA"), { ic: "HODA", role: "hod_cawangan", name: "HOD A", branch: "Klinik A" });
});
const APPROVER_ROLES_R = ['super_admin', 'admin', 'hr', 'hod_cawangan', 'hod_balok', 'doctor_pic', 'supervisor', 'team_leader'];

test("staff reads: plain staff sees own doc and approvers, not colleagues", async () => {
  await seedStaffReads(); await seedPharma();
  const db = ctxDb(staffAuth("P1"));
  await assertSucceeds(getDoc(doc(db, "staff", "P1")));
  await assertFails(getDoc(doc(db, "staff", "P2")));
  await assertFails(getDoc(doc(db, "staff", "PB")));
  await assertSucceeds(getDoc(doc(db, "staff", "DR")));
  await assertSucceeds(getDocs(query(collection(db, "staff"),
    where("role", "in", APPROVER_ROLES_R), where("branch", "!=", PHARMA))));
  await assertFails(getDocs(query(collection(db, "staff"), where("branch", "==", "Klinik A"))));
});

test("staff reads: HOD Cawangan reads own branch, not other branches' plain staff", async () => {
  await seedStaffReads();
  const db = ctxDb(staffAuth("HODA"));
  await assertSucceeds(getDocs(query(collection(db, "staff"), where("branch", "==", "Klinik A"))));
  await assertSucceeds(getDoc(doc(db, "staff", "P2")));
  await assertFails(getDoc(doc(db, "staff", "PB")));
  await assertFails(getDocs(query(collection(db, "staff"), where("branch", "==", "Klinik B"))));
});

test("staff reads: approver (canApprove) still reads the whole clinic list", async () => {
  await seedStaffReads(); await seedPharma();
  const db = ctxDb(approverAuth("DR"));
  await assertSucceeds(getDocs(query(collection(db, "staff"), where("branch", "not-in", [PHARMA]))));
  await assertSucceeds(getDoc(doc(db, "staff", "PB")));
});

test("staff reads: KSB Pharma plain staff reads own-company approvers only", async () => {
  await seedPharma();
  const db = ctxDb(staffAuth("PS1"));
  await assertSucceeds(getDocs(query(collection(db, "staff"),
    where("role", "in", APPROVER_ROLES_R), where("branch", "==", PHARMA))));
  await assertFails(getDocs(query(collection(db, "staff"), where("branch", "==", PHARMA))));
});

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

test("a new registration request must start as pending", async () => {
  const base = { name: "BARU", ic: "N1", branch: "Klinik A", category: "Operation Staff", phone: "60100000001", submittedAt: 1 };
  const anonDb = testEnv.authenticatedContext("anon1", anonAuth()).firestore();
  await assertFails(setDoc(doc(anonDb, "registration_requests", "s1"), { ...base, status: "approved" }));
  await assertFails(setDoc(doc(anonDb, "registration_requests", "s2"), base));
  await assertSucceeds(setDoc(doc(anonDb, "registration_requests", "s3"), { ...base, status: "pending" }));
  const db = googleDb("G1");
  await assertFails(setDoc(doc(db, "registration_requests", "s4"), { ...base, googleUid: "G1", status: "approving" }));
  await assertSucceeds(setDoc(doc(db, "registration_requests", "s5"), { ...base, googleUid: "G1", status: "pending" }));
});

test("registrant cannot pre-write the server-only verified Google fields", async () => {
  const db = googleDb("G1");
  const base = { name: "BARU", ic: "N1", branch: "Klinik A", category: "Operation Staff", phone: "60100000001", status: "pending", submittedAt: 1, googleUid: "G1" };
  await assertFails(setDoc(doc(db, "registration_requests", "v1"), { ...base, verifiedGoogleSub: "999" }));
  await assertFails(setDoc(doc(db, "registration_requests", "v2"), { ...base, verifiedGoogleEmail: "victim@gmail.com" }));
  await assertSucceeds(setDoc(doc(db, "registration_requests", "v3"), base));
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
