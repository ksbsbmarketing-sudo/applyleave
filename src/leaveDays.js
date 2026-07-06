// Pure leave-day counting. No Firebase/DOM dependencies so it is unit-testable.
//
// countLeaveDays(startDate, endDate, isAdminStaff, holidayDates, calendarOnly):
//   - isAdminStaff false → inclusive calendar-day count (legacy behaviour)
//   - isAdminStaff true  → only Mon–Fri days that are not public holidays
//   - holidayDates: array or Set of 'YYYY-MM-DD' strings (the staff's state holidays)
//   - calendarOnly true  → always inclusive calendar-day count, even for admin staff.
//       Used for statutory calendar-day entitlements (maternity/paternity/hospitalisation)
//       which run as consecutive calendar days and must NOT skip weekends/holidays.
//   - returns 0 when the range is invalid (end before start)
export function countLeaveDays(startDate, endDate, isAdminStaff, holidayDates = [], calendarOnly = false) {
  const start = parseYMD(startDate);
  const end = parseYMD(endDate);
  if (!start || !end || end < start) return 0;

  if (!isAdminStaff || calendarOnly) {
    return Math.round((end - start) / 86400000) + 1; // inclusive calendar days
  }

  const holidays = holidayDates instanceof Set ? holidayDates : new Set(holidayDates);
  let count = 0;
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const day = d.getDay();               // 0=Sun … 6=Sat (local)
    if (day === 0 || day === 6) continue; // weekend
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
