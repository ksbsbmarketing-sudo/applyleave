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
