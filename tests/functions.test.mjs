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
  await db.doc("staff/T100").set({ ic: "T100", name: "SUP ONE", branch: "Klinik A", role: "supervisor", password: "changeme00" });

  await wait(4000); // allow the trigger to run in the emulator

  const u = await admin.auth().getUserByEmail(emailForIC("T100"));
  assert.strictEqual(u.customClaims.canApprove, true);
  assert.strictEqual(u.customClaims.manageStaff, false);
  assert.strictEqual(u.customClaims.ic, "T100");

  const dir = await db.doc("directory/T100").get();
  assert.strictEqual(dir.data().name, "SUP ONE");
});
