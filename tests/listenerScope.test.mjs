import { test } from 'node:test';
import assert from 'node:assert';
import { canSeeAuditLogs, canSeeRegistrations } from '../src/listenerScope.js';

// Shape of window.rbacMatrix: { [role]: { [permission]: boolean } }
const MATRIX = {
  super_admin: { manage_login_audit: true,  manage_pending: true },
  admin:       { manage_login_audit: true,  manage_pending: true },
  hr:          { manage_login_audit: false, manage_pending: true },
  hod:         { manage_login_audit: false, manage_pending: true },
  tl:          { manage_login_audit: false, manage_pending: true },
  staff:       { manage_login_audit: false, manage_pending: false },
};

test('the bug: a plain staff pays 200 audit_logs reads for a screen they cannot open', () => {
  // 200 reads on every cold load, for ~90% of the user base, on a 50k/day plan.
  assert.strictEqual(canSeeAuditLogs('staff', MATRIX), false);
});

test('roles that can actually open the login_audit screen still get the data', () => {
  assert.strictEqual(canSeeAuditLogs('super_admin', MATRIX), true);
  assert.strictEqual(canSeeAuditLogs('admin', MATRIX), true);
});

test('hr is denied login_audit in the matrix, so it must not subscribe either', () => {
  // The listener gate has to track manage_login_audit exactly — not "is an admin-ish
  // role" — or HR silently loses/gains data relative to what the UI shows.
  assert.strictEqual(canSeeAuditLogs('hr', MATRIX), false);
});

test('an unknown or missing role never subscribes', () => {
  assert.strictEqual(canSeeAuditLogs('locum', MATRIX), false);
  assert.strictEqual(canSeeAuditLogs(undefined, MATRIX), false);
  assert.strictEqual(canSeeAuditLogs(null, MATRIX), false);
  assert.strictEqual(canSeeAuditLogs('', MATRIX), false);
});

test('a missing or junk matrix denies rather than throwing', () => {
  // Denying is safe here BECAUSE the caller re-evaluates when settings/rbac lands
  // (config/rolePermissions can grant what the code defaults deny — the RBAC
  // desync gotcha). A throw at init would take out every other listener.
  assert.strictEqual(canSeeAuditLogs('admin', undefined), false);
  assert.strictEqual(canSeeAuditLogs('admin', null), false);
  assert.strictEqual(canSeeAuditLogs('admin', {}), false);
  assert.strictEqual(canSeeAuditLogs('admin', 'nonsense'), false);
  assert.strictEqual(canSeeAuditLogs('admin', { admin: null }), false);
});

test('permission is read as a strict boolean, not a truthy value', () => {
  // Firestore has been seen storing strings; "false" is truthy and would re-open
  // the exact leak this change closes.
  assert.strictEqual(canSeeAuditLogs('admin', { admin: { manage_login_audit: 'false' } }), false);
  assert.strictEqual(canSeeAuditLogs('admin', { admin: { manage_login_audit: 1 } }), false);
  assert.strictEqual(canSeeAuditLogs('admin', { admin: { manage_login_audit: true } }), true);
});

test('a Firestore matrix that grants more than the code defaults is honoured', () => {
  // This is why the caller must re-check when settings/rbac arrives.
  assert.strictEqual(canSeeAuditLogs('hr', { hr: { manage_login_audit: true } }), true);
});

test('registration_requests: needs the manage_registrations flag AND the manageStaff claim', () => {
  const ADMINISH = { manage_registrations: true, manage_staff: true, manage_pending: true };
  for (const r of ['admin', 'hr', 'super_admin']) assert.strictEqual(canSeeRegistrations(r, ADMINISH), true, r);
  // Flag without manage_staff: rules would reject the listener, so do not subscribe.
  assert.strictEqual(canSeeRegistrations('doctor_pic', { manage_registrations: true, manage_staff: false }), false);
  // hod_cawangan's manage_staff is branch-limited and never becomes the claim.
  assert.strictEqual(canSeeRegistrations('hod_cawangan', ADMINISH), false);
  // manage_staff alone is not the tab.
  assert.strictEqual(canSeeRegistrations('hr', { manage_registrations: false, manage_staff: true }), false);
});

test('everyone else skips the registration_requests listener', () => {
  for (const r of ['staff', 'hod', 'tl', 'locum', '', null, undefined]) {
    assert.strictEqual(canSeeRegistrations(r, { manage_registrations: false }), false, String(r) + ' should not subscribe');
  }
  assert.strictEqual(canSeeRegistrations('hr', undefined), false);
});

// ── leaves listener scope ────────────────────────────────────────────────────
import { needsAllLeaves, OWN_LEAVES_ROLES } from '../src/listenerScope.js';

const STAFF_PERMS = {
  dashboard: 'staff', branch_analisa: false, leave_request: true, management: false, policy: true,
  settings: true, wa_setting: false, inbox: true, manage_pending: false, manage_staff: false,
  manage_reports: false, report_attendance: false, can_cancel: false, os_balok: false,
  os_pahang: false, locum_records: false,
};

test('leaves: plain staff with default perms reads only own leave', () => {
  for (const role of OWN_LEAVES_ROLES) assert.strictEqual(needsAllLeaves(role, STAFF_PERMS), false, role);
});

test('leaves: approver and admin roles always read everything, whatever RBAC says', () => {
  for (const role of ['super_admin', 'admin', 'hr', 'hod_cawangan', 'hod_balok', 'doctor_pic', 'supervisor', 'team_leader'])
    assert.strictEqual(needsAllLeaves(role, STAFF_PERMS), true, role);
});

test('leaves: a staff role granted any extra permission widens to everything', () => {
  assert.strictEqual(needsAllLeaves('staff', { ...STAFF_PERMS, manage_pending: true }), true);
  assert.strictEqual(needsAllLeaves('staff', { ...STAFF_PERMS, locum_records: true }), true);
  assert.strictEqual(needsAllLeaves('staff', { ...STAFF_PERMS, dashboard: 'branch' }), true);
  assert.strictEqual(needsAllLeaves('staff', { ...STAFF_PERMS, some_future_flag: true }), true);
});

test('leaves: string "true" counts as granted, string "false" does not', () => {
  assert.strictEqual(needsAllLeaves('staff', { ...STAFF_PERMS, manage_reports: 'true' }), true);
  assert.strictEqual(needsAllLeaves('staff', { ...STAFF_PERMS, manage_reports: 'false' }), false);
});

test('leaves: unknown role or missing perms fails open (reads everything)', () => {
  assert.strictEqual(needsAllLeaves('custom_role', STAFF_PERMS), true);
  assert.strictEqual(needsAllLeaves('staff', undefined), true);
  assert.strictEqual(needsAllLeaves(undefined, STAFF_PERMS), true);
});

import { STAFF_APPROVER_ROLES, needsAllStaff } from '../src/listenerScope.js';

test('staff: approver set and plain set do not overlap — a plain role is never fetched as an approver', () => {
  for (const r of OWN_LEAVES_ROLES) assert.ok(!STAFF_APPROVER_ROLES.includes(r), r);
});

test('staff: every approver role loads the full staff list itself', () => {
  for (const r of STAFF_APPROVER_ROLES) assert.strictEqual(needsAllStaff(r, STAFF_PERMS), true, r);
  assert.strictEqual(needsAllStaff('staff', STAFF_PERMS), false);
});

import { listenerScope, canSeeWaLogs } from '../src/listenerScope.js';

const DOCTOR_PERMS = {
  dashboard: 'branch', branch_analisa: true, leave_request: true, management: false, policy: true,
  settings: true, wa_setting: false, inbox: true, manage_pending: true, manage_staff: false,
  manage_reports: false, report_attendance: false, can_cancel: true, os_balok: true, os_pahang: true,
  locum_records: false,
};

test('scope: plain staff → own, default doctor_pic → branch, everyone else → all', () => {
  assert.strictEqual(listenerScope('staff', STAFF_PERMS), 'own');
  assert.strictEqual(listenerScope('doctor_pic', DOCTOR_PERMS), 'branch');
  for (const r of ['super_admin', 'admin', 'hr', 'hod_cawangan', 'hod_balok', 'supervisor'])
    assert.strictEqual(listenerScope(r, DOCTOR_PERMS), 'all', r);
});

test('scope: doctor_pic granted reports/locum/staff/analisa widens to all', () => {
  for (const k of ['manage_reports', 'report_attendance', 'locum_records', 'manage_staff'])
    assert.strictEqual(listenerScope('doctor_pic', { ...DOCTOR_PERMS, [k]: true }), 'all', k);
  assert.strictEqual(listenerScope('doctor_pic', { ...DOCTOR_PERMS, dashboard: 'analisa' }), 'all');
  assert.strictEqual(listenerScope('doctor_pic', undefined), 'all');
});

test('wa_logs: only roles with wa_setting load them', () => {
  const m = { super_admin: { wa_setting: true }, admin: { wa_setting: false }, staff: { wa_setting: 'false' }, x: { wa_setting: 'true' } };
  assert.strictEqual(canSeeWaLogs('super_admin', m), true);
  assert.strictEqual(canSeeWaLogs('admin', m), false);
  assert.strictEqual(canSeeWaLogs('staff', m), false);
  assert.strictEqual(canSeeWaLogs('x', m), true);
  assert.strictEqual(canSeeWaLogs('nobody', m), false);
});

test('scope: team_leader with default perms (staff dashboard, manage_pending) → branch', () => {
  const TL = { ...STAFF_PERMS, manage_pending: true, os_balok: true };
  assert.strictEqual(listenerScope('team_leader', TL), 'branch');
  assert.strictEqual(listenerScope('team_leader', { ...TL, manage_reports: true }), 'all');
});

test('scope: retired flags (os_*, messenger, management) never widen the scope', () => {
  const retired = { os_balok: true, os_pahang: true, messenger: true, management: true };
  assert.strictEqual(listenerScope('staff', { ...STAFF_PERMS, ...retired }), 'own');
  assert.strictEqual(listenerScope('doctor_pic', { ...DOCTOR_PERMS, ...retired }), 'branch');
});

test('scope: leave_calendar keeps doctor_pic/TL branch-scoped but widens plain staff', () => {
  assert.strictEqual(listenerScope('doctor_pic', { ...DOCTOR_PERMS, leave_calendar: true }), 'branch');
  assert.strictEqual(listenerScope('staff', { ...STAFF_PERMS, leave_calendar: true }), 'all');
});
