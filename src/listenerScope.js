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

// ── leaves: whole collection vs. the caller's own records ────────────────────
//
// `leaves` is the one listener that grows without bound — every application adds
// a document, and every user downloaded all of them on every cold load. A plain
// staff member only ever looks at their own leave (history, balance, overlap
// check), so for them `where('ic', '==', myIC)` returns the same screens for a
// handful of reads instead of the whole company's history.
//
// Fail OPEN, not closed: subscribing to too much only costs quota, but
// subscribing to too little silently empties an approval queue or a report. So
// only a role explicitly listed here, whose permissions grant nothing beyond its
// own leave, is narrowed. Approver roles are never narrowed even if RBAC turns
// their flags off, because canManageRequest() and the zone viewers in main.js
// decide by role name, not by RBAC.
export const OWN_LEAVES_ROLES = ['staff', 'juru_xray', 'sonographer', 'juru_audio', 'pemandu'];

// Permissions that only touch the user's own data. Any OTHER permission switched
// on (manage_pending, reports, locum_records, a flag added later…) may open a
// screen that lists colleagues' leave, so it widens the listener.
const OWN_ONLY_PERMS = ['leave_request', 'policy', 'settings', 'inbox', 'wa_setting'];

export function needsAllLeaves(role, perms) {
  if (!role || typeof role !== 'string') return true;
  if (!OWN_LEAVES_ROLES.includes(role)) return true;
  if (!perms || typeof perms !== 'object') return true;
  if (perms.dashboard !== 'staff') return true;          // branch/analisa dashboards list others
  return Object.keys(perms).some(k =>
    k !== 'dashboard' && !OWN_ONLY_PERMS.includes(k)
    // Firestore has held the STRING "true"/"false" — count anything but a real
    // false/"false" as granted, so a malformed flag widens rather than hides.
    && perms[k] !== false && perms[k] !== 'false' && perms[k] != null);
}

// ── staff: whole collection vs. approvers + self ─────────────────────────────
//
// A plain staff member needs exactly two kinds of staff record: their own, and
// the people their application is routed to (TL dropdown, getRoutingP1Approvers,
// hrRecipientsForBranch → WhatsApp + Inbox). Every one of those lookups filters
// staffList by one of these roles, so `where('role', 'in', STAFF_APPROVER_ROLES)`
// plus the user's own doc covers them for ~30 reads instead of ~120.
//
// Same audience as the leaves narrowing — anyone who can open a screen listing
// colleagues gets the full list — so it shares needsAllLeaves' criteria.
export const STAFF_APPROVER_ROLES = ['super_admin', 'admin', 'hr', 'hod_cawangan', 'hod_balok', 'doctor_pic', 'supervisor', 'team_leader'];
export const needsAllStaff = needsAllLeaves;
