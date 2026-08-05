// Pure leave-day counting. No Firebase/DOM dependencies so it is unit-testable.
//
// countLeaveDays(startDate, endDate, isAdminStaff, holidayDates, calendarOnly, weekendDays):
//   - isAdminStaff false → inclusive calendar-day count (legacy behaviour)
//   - isAdminStaff true  → only working days that are not public holidays
//   - holidayDates: array or Set of 'YYYY-MM-DD' strings (the staff's state holidays)
//   - calendarOnly true  → always inclusive calendar-day count, even for admin staff.
//       Used for statutory calendar-day entitlements (maternity/paternity/hospitalisation)
//       which run as consecutive calendar days and must NOT skip weekends/holidays.
//   - weekendDays: day numbers treated as rest days; see weekendDaysForState below.
//       Defaults to Pahang (Sat+Sun), which is the majority of branches.
//   - returns 0 when the range is invalid (end before start)

// The working week is not the same in both zones the clinics operate in:
//   Pahang     → rests Saturday + Sunday (works Mon–Fri)
//   Terengganu → rests Friday + Saturday (works Sun–Thu)
// This is geography, not administration: Klinik Utama sits in Terengganu and
// keeps the Terengganu weekend even though ROUTES_AS_PAHANG sends its leave
// approvals through Balok HQ. Resolve the zone from the branch's own `state`,
// never from scopeStateOfBranch().
const SUN = 0, FRI = 5, SAT = 6;
export const WEEKEND_DAYS = Object.freeze({
  Pahang: Object.freeze([SAT, SUN]),
  Terengganu: Object.freeze([FRI, SAT]),
});

// Unknown or missing state falls back to Pahang rather than to "no weekend at
// all", so a branch with an unset `state` still gets a five-day working week.
export function weekendDaysForState(state) {
  return WEEKEND_DAYS[state] || WEEKEND_DAYS.Pahang;
}

export function countLeaveDays(startDate, endDate, isAdminStaff, holidayDates = [], calendarOnly = false, weekendDays = WEEKEND_DAYS.Pahang) {
  const start = parseYMD(startDate);
  const end = parseYMD(endDate);
  if (!start || !end || end < start) return 0;

  if (!isAdminStaff || calendarOnly) {
    return Math.round((end - start) / 86400000) + 1; // inclusive calendar days
  }

  const holidays = holidayDates instanceof Set ? holidayDates : new Set(holidayDates);
  const weekend = new Set(weekendDays);
  let count = 0;
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const day = d.getDay();                // 0=Sun … 6=Sat (local)
    if (weekend.has(day)) continue;        // rest day for this zone
    if (holidays.has(fmtYMD(d))) continue; // public holiday
    count++;
  }
  return count;
}

// Build dates from Y/M/D parts at LOCAL midnight so getDay()/formatting are not
// skewed by UTC conversion. Inputs come from <input type="date"> ('YYYY-MM-DD').
function parseYMD(s) {
  if (!s) return null;
  const [y, m, d] = String(s).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function fmtYMD(dt) {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
