import { test } from 'node:test';
import assert from 'node:assert';
import { deriveRolePermissions, changedRoles } from '../src/rolePermissions.js';

// Live config/rolePermissions on 2026-10-14 — deriving from the live matrix must
// reproduce it exactly (plus pemandu, which the live doc was missing).
const LIVE_CLAIMS = {
  super_admin: { canApprove: true, manageStaff: true }, admin: { canApprove: true, manageStaff: true },
  hr: { canApprove: true, manageStaff: true }, hod_balok: { canApprove: true, manageStaff: false },
  doctor_pic: { canApprove: true, manageStaff: false }, supervisor: { canApprove: true, manageStaff: false },
  team_leader: { canApprove: true, manageStaff: false }, staff: { canApprove: false, manageStaff: false },
  juru_xray: { canApprove: false, manageStaff: false }, sonographer: { canApprove: false, manageStaff: false },
  juru_audio: { canApprove: false, manageStaff: false }, hod_cawangan: { canApprove: false, manageStaff: false },
};
const P = (pending, staff) => ({ manage_pending: pending, manage_staff: staff });
const LIVE_MATRIX = {
  super_admin: P(true, true), admin: P(true, true), hr: P(true, true), hod_balok: P(true, false),
  doctor_pic: P(true, false), supervisor: P(true, false), team_leader: P(true, false), staff: P(false, false),
  juru_xray: P(false, false), sonographer: P(false, false), juru_audio: P(false, false),
  hod_cawangan: P(false, true), pemandu: P(false, false),
};

test('derived claims match the live rolePermissions for every existing role', () => {
  const d = deriveRolePermissions(LIVE_MATRIX);
  for (const [role, rp] of Object.entries(LIVE_CLAIMS)) assert.deepStrictEqual(d[role], rp, role);
  assert.deepStrictEqual(d.pemandu, { canApprove: false, manageStaff: false });
});

test('hod_cawangan never gets the company-wide manageStaff claim', () => {
  assert.strictEqual(deriveRolePermissions({ hod_cawangan: P(true, true) }).hod_cawangan.manageStaff, false);
});

test('string "true" grants, string "false" and missing do not', () => {
  const d = deriveRolePermissions({ a: P('true', 'false'), b: {} });
  assert.deepStrictEqual(d.a, { canApprove: true, manageStaff: false });
  assert.deepStrictEqual(d.b, { canApprove: false, manageStaff: false });
});

test('changedRoles reports added, removed and changed roles only', () => {
  const before = { a: { canApprove: true, manageStaff: false }, b: { canApprove: false, manageStaff: false }, gone: { canApprove: false, manageStaff: false } };
  const after = { a: { canApprove: true, manageStaff: false }, b: { canApprove: true, manageStaff: false }, added: { canApprove: false, manageStaff: false } };
  assert.deepStrictEqual(changedRoles(before, after), ['added', 'b', 'gone']);
  assert.deepStrictEqual(changedRoles(LIVE_CLAIMS, deriveRolePermissions(LIVE_MATRIX)), ['pemandu']);
});
