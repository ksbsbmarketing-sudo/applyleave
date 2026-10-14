// config/rolePermissions — the two coarse powers firestore.rules enforces through
// custom claims — DERIVED from the RBAC matrix (settings/rbac), so the Access
// Control table is the only place permissions are edited.
//
// WHY: the two documents used to be edited separately and drifted. A role could
// see a Save button (RBAC) that Firestore then rejected (claims), e.g. Supervisor
// with manage_staff in the matrix but manageStaff:false in its claims.
//
//   canApprove  ← manage_pending ("Luluskan Permohonan")
//   manageStaff ← manage_staff   ("Kakitangan")
//
// EXCEPTION — BRANCH_LIMITED_STAFF_ROLES: for HOD Cawangan, manage_staff means
// "staff at MY branch", enforced by isBranchHodOf() in firestore.rules. The
// manageStaff claim is company-wide (any staff doc, roles, config), so granting
// it would let a branch HOD edit everyone. They never get it from the matrix.
//
// Claims only reach a user's token after sync-claims.js runs (Spark has no Cloud
// Functions) and their token refreshes — re-login, or up to an hour.
// Pure module: no Firestore imports, so it is unit-tested directly.

export const BRANCH_LIMITED_STAFF_ROLES = ['hod_cawangan'];

const granted = v => v === true || v === 'true';

export function deriveRolePermissions(rbacMatrix) {
  const out = {};
  if (!rbacMatrix || typeof rbacMatrix !== 'object') return out;
  for (const [role, perms] of Object.entries(rbacMatrix)) {
    if (!perms || typeof perms !== 'object') continue;
    out[role] = {
      canApprove: granted(perms.manage_pending),
      manageStaff: granted(perms.manage_staff) && !BRANCH_LIMITED_STAFF_ROLES.includes(role),
    };
  }
  return out;
}

// Roles whose claims differ between two rolePermissions maps (added, removed or
// changed). These are the roles whose staff need sync-claims.js.
export function changedRoles(before, after) {
  const a = before && typeof before === 'object' ? before : {};
  const b = after && typeof after === 'object' ? after : {};
  const same = (x, y) => !!x && !!y && !!x.canApprove === !!y.canApprove && !!x.manageStaff === !!y.manageStaff;
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter(r => !same(a[r], b[r]))
    .sort();
}
