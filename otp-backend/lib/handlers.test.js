import { test } from "node:test";
import assert from "node:assert/strict";
import { makeApproveHandler } from "../api/approve-registration.js";
import { makeUnlinkHandler } from "../api/unlink-google.js";
import { makeDeleteStaffHandler } from "../api/delete-staff.js";

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

test("approve: malformed docId → 400 missing_fields", async () => {
  const hr = makeApproveHandler(() => ({ db: db({ "staff/H1": { role: "hr", branch: "Klinik A" } }), auth: auth({ ic: "H1", manageStaff: true }) }));
  for (const docId of ["a/b", "../x", "r 1", "r1.json"]) {
    const r = res(); await hr(post({ docId }), r);
    assert.equal(r.statusCode, 400);
    assert.deepEqual(r.body, { error: "missing_fields" });
  }
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

test("unlink: only hr, admin and super_admin may unlink, even with manageStaff", async () => {
  for (const role of ["hod_cawangan", "supervisor", "staff"]) {
    const h = makeUnlinkHandler(() => ({
      db: db({ "staff/X1": { role, branch: "Klinik A" }, "staff/S1": { role: "staff", branch: "Klinik A" } }),
      auth: auth({ ic: "X1", manageStaff: true }),
    }));
    const r = res();
    await h(post({ ic: "S1" }), r);
    assert.equal(r.statusCode, 403, role);
    assert.deepEqual(r.body, { error: "forbidden" });
  }
});

test("unlink: unknown staff → 404", async () => {
  const h = makeUnlinkHandler(() => ({ db: db({ "staff/H1": { role: "hr", branch: "Klinik A" } }), auth: auth({ ic: "H1", manageStaff: true }) }));
  const r = res();
  await h(post({ ic: "NOPE" }), r);
  assert.equal(r.statusCode, 404);
});

test("delete-staff: cannot delete yourself; clinic HR cannot delete pharma staff; unknown → 404", async () => {
  const docs = { "staff/H1": { role: "hr", branch: "Klinik A" }, "staff/P1": { role: "staff", branch: PHARMA } };
  const h = makeDeleteStaffHandler(() => ({ db: db(docs), auth: auth({ ic: "H1", manageStaff: true }) }));
  const r1 = res(); await h(post({ ic: "H1" }), r1);
  assert.equal(r1.statusCode, 400); assert.deepEqual(r1.body, { error: "self_delete" });
  const r2 = res(); await h(post({ ic: "P1" }), r2);
  assert.equal(r2.statusCode, 403);
  const r3 = res(); await h(post({ ic: "NOPE" }), r3);
  assert.equal(r3.statusCode, 404);
});

test("delete-staff: staff without manageStaff → 403", async () => {
  const h = makeDeleteStaffHandler(() => ({ db: db({ "staff/S1": { role: "staff", branch: "Klinik A" } }), auth: auth({ ic: "S1", manageStaff: false }) }));
  const r = res(); await h(post({ ic: "S2" }), r);
  assert.equal(r.statusCode, 403);
});

test("OPTIONS preflight allows the Authorization header", async () => {
  const h = makeUnlinkHandler(() => ({ db: db({}), auth: auth({}) }));
  const r = res();
  await h({ method: "OPTIONS", headers: { origin: "https://cuti-staff.ksbsb.com.my" } }, r);
  assert.equal(r.statusCode, 204);
  assert.match(r.headers["Access-Control-Allow-Headers"], /Authorization/);
});
