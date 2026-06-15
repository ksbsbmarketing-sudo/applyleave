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

  const priorUsed = num(alAdj) + records
    .filter(r =>
      r.ic === record.ic &&
      r.type === record.type &&
      r.status === 'APPROVED' &&
      r.id !== record.id &&
      isBefore(r, record))
    .reduce((acc, r) => acc + num(r.days), 0);

  const before = Math.max(0, base - priorUsed);
  const after = Math.max(0, base - priorUsed - applied);
  return { before, after, priorUsed };
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
