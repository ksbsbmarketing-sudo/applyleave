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
