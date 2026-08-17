// Which whole-collection listeners a given role is allowed to attach.
//
// WHY THIS EXISTS: initData() used to subscribe every logged-in user to
// `audit_logs` (200 docs) and `registration_requests`, regardless of role. A
// plain staff member cannot open either screen, so those reads bought nothing —
// yet they were the single largest slice of a cold page-load:
//
//   audit_logs 200 + staff 122 + leaves 138 + branches 13  ≈ 475 reads
//
// On the Spark plan (50k reads/day) that is ~105 cold loads before the whole
// project starts returning `8 RESOURCE_EXHAUSTED`. With ~122 staff that ceiling
// is reachable before noon, and when it is hit NOTHING works — including the
// WhatsApp OTP password reset, which reads `staff/{ic}` before it can send a
// code and so fails with a generic 500 that looks like a broken account.
//
// Gating by role is the safe half of the fix: it changes who subscribes, never
// what any screen can display, so no report loses data.
//
// Kept as a pure module (no Firestore imports) so the rules can be tested
// directly — the listeners themselves are not reachable from a test.

// The "Daftar Baharu" management tab is rendered for exactly these roles in
// src/main.js. The listener gate MUST stay in step with that check: subscribing
// less than the UI shows produces an empty tab with no error.
export const REGISTRATION_ROLES = ['admin', 'hr', 'super_admin'];

// `audit_logs` is gated on the same RBAC permission that gates the `login_audit`
// view, rather than on a hardcoded role list, because that permission is
// editable from the Access Control screen at runtime.
//
// Returns false for an absent/!malformed matrix instead of throwing: this runs
// during init, and a throw would take out every listener after it. The caller
// compensates by re-checking whenever settings/rbac arrives, so a permission
// that only Firestore grants still takes effect.
export function canSeeAuditLogs(role, rbacMatrix) {
  if (!role || typeof role !== 'string') return false;
  if (!rbacMatrix || typeof rbacMatrix !== 'object') return false;
  const perms = rbacMatrix[role];
  if (!perms || typeof perms !== 'object') return false;
  // Strict boolean: Firestore has been seen holding the STRING "false", which is
  // truthy and would quietly re-open the leak this module exists to close.
  return perms.manage_login_audit === true;
}

export function canSeeRegistrations(role) {
  if (!role || typeof role !== 'string') return false;
  return REGISTRATION_ROLES.includes(role);
}
