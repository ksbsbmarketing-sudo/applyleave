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
