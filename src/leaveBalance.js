// Pure running-balance calculation for a single leave record. No Firebase/DOM
// dependencies so it is unit-testable.
//
// The printed leave form must show the balance AS IT STOOD around that leave:
//   BAKI CUTI TERDAHULU = balance before this leave was deducted
//   BAKI CUTI           = balance after this leave was deducted
//
// It is NOT correct to use the staff's CURRENT global balance (that only matches
// the most recent leave). Instead we sum only the same-type, APPROVED leaves that
// occur BEFORE this one (ordered by start date, then application id), then deduct
// this record's own days on top.
//
// recordBalances({ record, ent, alAdj, records }):
//   - record : the leave being printed { id, ic, type, days, startDate, status }
//   - ent    : entitlement base for this type (same value getLeaveStats uses)
//   - alAdj  : manual prior-usage adjustment (AL only; pass 0 otherwise)
//   - records: all leave records (the global leaveRecords array)
//   - returns { before, after, priorUsed } — before/after clamped to >= 0
export function recordBalances({ record, ent, alAdj = 0, records = [] }) {
  const base = num(ent);
  const applied = num(record.days);

  // Only sum prior leaves from the SAME leave year as the record being printed, so a
  // new calendar year starts fresh (matches the year-scoped getLeaveStats). For a
  // 2026 record with only 2026 history this is unchanged.
  const recordYear = leaveYearOf(record);
  const priorUsed = num(alAdj) + records
    .filter(r =>
      r.ic === record.ic &&
      r.type === record.type &&
      r.status === 'APPROVED' &&
      r.id !== record.id &&
      (recordYear === null || leaveYearOf(r) === recordYear) &&
      isBefore(r, record))
    .reduce((acc, r) => acc + num(r.days), 0);

  const before = Math.max(0, base - priorUsed);
  const after = Math.max(0, base - priorUsed - applied);
  return { before, after, priorUsed };
}

// EL overflow into Annual Leave: how many EL days were consumed beyond the EL
// entitlement (the 3-day bucket). Everything that reduces the EL balance counts —
// prior-system usage, in-system usage, and HR pelarasan — matching Formula B.
// Returns days ≥ 0. Consumed by getLeaveStats('AL') to reduce the AL balance.
export function computeElOverflow({ entEL, usedPre = 0, usedSys = 0, pelarasan = 0 }) {
  const total = num(usedPre) + num(usedSys) + num(pelarasan);
  return Math.max(0, total - num(entEL));
}

// CME (Continuing Medical Education) is doctors-only, default 5 days/year. An explicit
// ent_CME (including 0) is an HR override and always wins; otherwise doctors get 5 and
// everyone else 0. Consumed by getLeaveStats('CME') and the HR modal.
export function computeCMEEntitlement({ category, ent_CME } = {}) {
  if (ent_CME !== undefined && ent_CME !== null) return num(ent_CME);
  return category === 'Doctor' ? 5 : 0;
}

// Chronological order: leave start date first, then application id (Date.now())
// as a stable tiebreak when two leaves share a start date.
function isBefore(a, b) {
  const da = a.startDate || '';
  const db = b.startDate || '';
  if (da !== db) return da < db;
  return num(a.id) < num(b.id);
}

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

// Leave year a record belongs to = the year the leave STARTS (startDate), falling
// back to the application year (r.id). Kept in sync with main.js leaveYearOf().
function leaveYearOf(r) {
  if (r && r.startDate) { const d = new Date(r.startDate); if (!isNaN(d.getTime())) return d.getFullYear(); }
  if (r && r.id) return new Date(r.id).getFullYear();
  return null;
}
