// Year-end ("Tutup Tahun") rollover logic. Pure — no Firebase/DOM — so it is
// unit-testable and reusable. This module is the home for annual leave-year
// operations; future year-end additions (summary PDFs, reminder builders, etc.)
// belong here as new exports without touching the balance engine.
//
// Policy (confirmed): only Annual Leave (AL) carries forward, capped at CF_CAP days;
// anything above the cap is forfeited. All other leave types start fresh each year.

export const CF_CAP = 3; // max AL days carried into the next year

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

// Compute the year-end rollover plan for a set of staff.
//   staffList : array of staff objects (should already exclude inactive if desired)
//   getStats  : function(staff, type, year) -> { bal, ... } (i.e. window.getLeaveStats)
//   year      : the leave year being closed (number or numeric string)
// Returns a preview-friendly plan; performs NO writes.
export function computeYearEndRollover({ staffList = [], getStats, year }) {
  const y = parseInt(year, 10);
  const rows = staffList.map(s => {
    const closingAL = Math.max(0, num(getStats(s, 'AL', y).bal));
    const cfNext = Math.min(closingAL, CF_CAP);
    const forfeited = Math.max(0, closingAL - CF_CAP);
    return {
      ic: s.ic,
      name: s.name,
      branch: s.branch || '',
      closingAL,
      cfNext,
      forfeited,
    };
  });
  const totals = rows.reduce((t, r) => {
    t.staff += 1;
    t.totalCF += r.cfNext;
    t.totalForfeited += r.forfeited;
    return t;
  }, { staff: 0, totalCF: 0, totalForfeited: 0 });
  return { year: y, rows, totals };
}

// Firestore field patch for one staff row from computeYearEndRollover().rows.
// Sets next year's carry-forward and zeroes the current-year baselines so the new
// leave year starts clean. `balanceYear` records which year the reset baselines apply
// to (advisory / audit).
export function buildStaffRolloverPatch(row, closedYear) {
  const nextYear = parseInt(closedYear, 10) + 1;
  return {
    ent_CF: row.cfNext,
    al_used_pre: 0,
    al_pelarasan: 0,
    al_used_sys_adj: 0,
    al_adj: 0,
    mc_used_pre: 0,
    mc_pelarasan: 0,
    mc_used_sys_adj: 0,
    el_used_pre: 0,
    el_pelarasan: 0,
    el_used_sys_adj: 0,
    balanceYear: nextYear,
  };
}
