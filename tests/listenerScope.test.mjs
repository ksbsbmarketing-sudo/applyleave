import { test } from 'node:test';
import assert from 'node:assert';
import { canSeeAuditLogs, canSeeRegistrations, REGISTRATION_ROLES } from '../src/listenerScope.js';

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

test('registration_requests follows the same three roles the UI tab uses', () => {
  // src/main.js renders the "Daftar Baharu" tab for exactly these roles.
  assert.deepStrictEqual([...REGISTRATION_ROLES].sort(), ['admin', 'hr', 'super_admin']);
  for (const r of ['admin', 'hr', 'super_admin']) {
    assert.strictEqual(canSeeRegistrations(r), true, r + ' should subscribe');
  }
});

test('everyone else skips the registration_requests listener', () => {
  for (const r of ['staff', 'hod', 'tl', 'locum', '', null, undefined]) {
    assert.strictEqual(canSeeRegistrations(r), false, String(r) + ' should not subscribe');
  }
});
