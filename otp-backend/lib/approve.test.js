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
    getUser: async (uid) => { const u = byUid[uid]; if (!u) throw notFound(); return u; },
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
const ALI_GOOGLE = [{ providerId: "google.com", uid: "1234567890", email: "ali@gmail.com" }];

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
  const db = fakeDb({ ...PERMS, "registration_requests/r1": { ...REQ, googleUid: "G1" } });
  const auth = fakeAuth({ G1: { uid: "G1", email: "ali@gmail.com", providerData: ALI_GOOGLE } });
  const res = await approveRegistration({ db, auth, docId: "r1", name: "Ali Bin Abu", now: NOW });
  assert.deepEqual(res, { ok: true, ic: "900101015555", googleEmail: "ali@gmail.com" });
  assert.equal(auth.byUid.G1, undefined);
  const u = await auth.getUserByEmail(emailForIC("900101015555"));
  assert.deepEqual(u.providerData.find((p) => p.providerId === "google.com"),
    { providerId: "google.com", uid: "1234567890", email: "ali@gmail.com", displayName: "Ali Bin Abu" });
  assert.equal(db.docs["staff/900101015555"].googleEmail, "ali@gmail.com");
  assert.equal(db.docs["registration_requests/r1"].verifiedGoogleSub, "1234567890");
});

test("request-supplied googleSub/googleEmail are ignored; the verified Firebase identity is linked", async () => {
  const db = fakeDb({ ...PERMS, "registration_requests/r1": { ...REQ, googleUid: "G1", googleSub: "999", googleEmail: "victim@gmail.com" } });
  const auth = fakeAuth({ G1: { uid: "G1", email: "ali@gmail.com", providerData: ALI_GOOGLE } });
  const res = await approveRegistration({ db, auth, docId: "r1", name: "Ali Bin Abu", now: NOW });
  assert.deepEqual(res, { ok: true, ic: "900101015555", googleEmail: "ali@gmail.com" });
  const u = await auth.getUserByEmail(emailForIC("900101015555"));
  const linked = u.providerData.filter((p) => p.providerId === "google.com");
  assert.equal(linked.length, 1);
  assert.equal(linked[0].uid, "1234567890");
  assert.equal(db.docs["staff/900101015555"].googleEmail, "ali@gmail.com");
});

test("googleUid set but temp user gone and nothing verified → plain registration", async () => {
  const db = fakeDb({ ...PERMS, "registration_requests/r1": { ...REQ, googleUid: "G9" } });
  const auth = fakeAuth();
  const res = await approveRegistration({ db, auth, docId: "r1", name: "Ali Bin Abu", now: NOW });
  assert.deepEqual(res, { ok: true, ic: "900101015555", googleEmail: null });
  const u = await auth.getUserByEmail(emailForIC("900101015555"));
  assert.equal(u.providerData.some((p) => p.providerId === "google.com"), false);
  assert.equal(db.docs["staff/900101015555"].googleEmail, undefined);
});

test("googleUid pointing at a provisioned IC user → plain registration; that user is not deleted", async () => {
  const db = fakeDb({ ...PERMS, "registration_requests/r1": { ...REQ, googleUid: "P1" } });
  const auth = fakeAuth({ P1: { uid: "P1", email: "880202025555@ksb-leave.local", customClaims: { ic: "880202025555" },
    providerData: [{ providerId: "password" }, { providerId: "google.com", uid: "777", email: "other@gmail.com" }] } });
  const res = await approveRegistration({ db, auth, docId: "r1", name: "Ali Bin Abu", now: NOW });
  assert.deepEqual(res, { ok: true, ic: "900101015555", googleEmail: null });
  assert.ok(auth.byUid.P1, "provisioned user must not be deleted");
  assert.equal(auth.byUid.P1.providerData.length, 2);
  const u = await auth.getUserByEmail(emailForIC("900101015555"));
  assert.equal(u.providerData.some((p) => p.providerId === "google.com"), false);
  assert.equal(db.docs["staff/900101015555"].googleEmail, undefined);
  assert.equal(db.docs["registration_requests/r1"].verifiedGoogleSub, undefined);
  assert.equal(db.docs["registration_requests/r1"].status, "approved");
});

test("googleUid pointing at an ic@ksb-leave.local user without claims → not treated as a Google registrant", async () => {
  const db = fakeDb({ ...PERMS, "registration_requests/r1": { ...REQ, googleUid: "P2" } });
  const auth = fakeAuth({ P2: { uid: "P2", email: "880202025555@ksb-leave.local", providerData: [{ providerId: "google.com", uid: "777", email: "other@gmail.com" }] } });
  const res = await approveRegistration({ db, auth, docId: "r1", name: "Ali", now: NOW });
  assert.equal(res.googleEmail, null);
  assert.ok(auth.byUid.P2);
});

test("delete step re-checks: a googleUid that is now a provisioned user is never deleted", async () => {
  const db = fakeDb({ ...PERMS, "registration_requests/r1": { ...REQ, status: "approving", googleUid: "P1", verifiedGoogleSub: "1234567890", verifiedGoogleEmail: "ali@gmail.com" } });
  const auth = fakeAuth({ P1: { uid: "P1", email: "880202025555@ksb-leave.local", customClaims: { ic: "880202025555" }, providerData: [{ providerId: "password" }] } });
  const res = await approveRegistration({ db, auth, docId: "r1", name: "Ali", now: NOW });
  assert.equal(res.ok, true);
  assert.ok(auth.byUid.P1, "provisioned user must not be deleted");
});

test("invalid ic in the request → 400 invalid_request before any write", async () => {
  for (const ic of ["A12", "90-01", "", "x".repeat(21)]) {
    const db = fakeDb({ ...PERMS, "registration_requests/r1": { ...REQ, ic } });
    const res = await approveRegistration({ db, auth: fakeAuth(), docId: "r1", name: "x", now: NOW });
    assert.deepEqual(res, { ok: false, status: 400, error: "invalid_request" });
    assert.equal(Object.keys(db.docs).some((k) => k.startsWith("staff/") || k.startsWith("directory/")), false);
    assert.equal(db.docs["registration_requests/r1"].status, "pending");
  }
});

test("IC typed with dashes or spaces is normalised to digits", async () => {
  const db = fakeDb({ ...PERMS, "registration_requests/r1": { ...REQ, ic: "900101-01-5555 " } });
  const auth = fakeAuth();
  const res = await approveRegistration({ db, auth, docId: "r1", name: "Ali", now: NOW });
  assert.deepEqual(res, { ok: true, ic: "900101015555", googleEmail: null });
  assert.equal(db.docs["staff/900101015555"].ic, "900101015555");
  assert.equal(db.docs["directory/900101015555"].ic, "900101015555");
  assert.deepEqual((await auth.getUserByEmail(emailForIC("900101015555"))).customClaims.ic, "900101015555");
});

test("missing branch or category → 400 invalid_request", async () => {
  for (const patch of [{ branch: "" }, { category: 5 }, { branch: undefined }]) {
    const db = fakeDb({ ...PERMS, "registration_requests/r1": { ...REQ, ...patch } });
    const res = await approveRegistration({ db, auth: fakeAuth(), docId: "r1", name: "x", now: NOW });
    assert.deepEqual(res, { ok: false, status: 400, error: "invalid_request" });
    assert.equal(db.docs["staff/900101015555"], undefined);
  }
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
    "registration_requests/r1": { ...REQ, status: "approving", googleUid: "G1", verifiedGoogleSub: "1234567890", verifiedGoogleEmail: "ali@gmail.com" },
    "staff/900101015555": { ic: "900101015555", name: "Ali Bin Abu", registrationDocId: "r1", branch: "Klinik A" },
  });
  // temp Google user already deleted in the failed run; the verified identity was stored by that run
  const auth = fakeAuth();
  const res = await approveRegistration({ db, auth, docId: "r1", name: "Ali Bin Abu", now: NOW });
  assert.equal(res.ok, true);
  const u = await auth.getUserByEmail(emailForIC("900101015555"));
  assert.equal(u.providerData.filter((p) => p.providerId === "google.com").length, 1);
  assert.equal(db.docs["registration_requests/r1"].status, "approved");
});

test("running approve twice does not link google twice", async () => {
  const db = fakeDb({ ...PERMS, "registration_requests/r1": { ...REQ, googleUid: "G1" } });
  const auth = fakeAuth({ G1: { uid: "G1", email: "ali@gmail.com", providerData: ALI_GOOGLE } });
  await approveRegistration({ db, auth, docId: "r1", name: "Ali", now: NOW });
  db.docs["registration_requests/r1"].status = "approving"; // simulate a second click racing the first
  await approveRegistration({ db, auth, docId: "r1", name: "Ali", now: NOW });
  const u = await auth.getUserByEmail(emailForIC("900101015555"));
  assert.equal(u.providerData.filter((p) => p.providerId === "google.com").length, 1);
});
