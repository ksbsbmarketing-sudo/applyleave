// Who may edit which public-holiday list (config/publicHolidays has one key per
// state: `pahang`, `terengganu`). Mirrors the config/publicHolidays rule in
// firestore.rules — keep the two in step.
//
// WHY: the tab was gated by RBAC manage_holidays, but the edit rights inside it
// were a separate hardcoded role list, so they disagreed: HOD Balok had the tab
// but could edit nothing, and any HOD Cawangan could edit Terengganu regardless
// of their own state. Now:
//   • no manage_holidays                → nothing
//   • admin / super_admin               → every state
//   • everyone else (HR, HOD Cawangan…) → their own zone only
// The zone is getUserStateScope(): hrState for HR, the branch's state otherwise.
// Utama is a Terengganu branch run from Pahang; its HR (Pahang) does not edit the
// Terengganu list — HR Terengganu does.

export function canEditHolidayState({ role, perms, zone }, state) {
  if (!state || typeof state !== 'string') return false;
  const p = perms && typeof perms === 'object' ? perms : {};
  if (!(p.manage_holidays === true || p.manage_holidays === 'true')) return false;
  if (role === 'admin' || role === 'super_admin') return true;
  return typeof zone === 'string' && zone.toLowerCase() === state.toLowerCase();
}
