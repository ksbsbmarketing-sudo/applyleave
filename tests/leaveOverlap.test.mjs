import { test } from 'node:test';
import assert from 'node:assert';
import {
  NON_BLOCKING_STATUSES, isBlockingStatus, datesOverlap,
  findOverlappingLeaves, overlapsOtherLeaves, describeOverlaps,
} from '../src/leaveOverlap.js';

// Mirrors the real `leaves` collection: numeric `id` (Date.now()), `ic` as the
// staff key, 'YYYY-MM-DD' dates, uppercase status strings.
const REC = (over) => ({
  id: 1, ic: '900101015555', type: 'MC',
  startDate: '2026-08-05', endDate: '2026-08-07', status: 'PENDING', ...over,
});

const ids = (recs) => recs.map(r => r.id).sort((a, b) => a - b);
const find = (records, over = {}) => {
  const q = { ic: '900101015555', startDate: '2026-08-05', endDate: '2026-08-07', ...over };
  return findOverlappingLeaves(records, q.ic, q.startDate, q.endDate, q.opts);
};

// ── Date arithmetic ───────────────────────────────────────────────────
test('identical ranges overlap', () => {
  assert.strictEqual(datesOverlap('2026-08-05', '2026-08-07', '2026-08-05', '2026-08-07'), true);
});

test('a range overlapping only at its tail counts', () => {
  assert.strictEqual(datesOverlap('2026-08-05', '2026-08-07', '2026-08-07', '2026-08-09'), true);
});

test('a range overlapping only at its head counts', () => {
  assert.strictEqual(datesOverlap('2026-08-05', '2026-08-07', '2026-08-03', '2026-08-05'), true);
});

test('a range fully containing another overlaps', () => {
  assert.strictEqual(datesOverlap('2026-08-01', '2026-08-31', '2026-08-05', '2026-08-07'), true);
});

test('adjacent but separate ranges do NOT overlap', () => {
  // The off-by-one that would wrongly block legitimate back-to-back leave.
  assert.strictEqual(datesOverlap('2026-08-05', '2026-08-07', '2026-08-08', '2026-08-10'), false);
});

test('single-day leave overlaps a range containing it', () => {
  assert.strictEqual(datesOverlap('2026-08-06', '2026-08-06', '2026-08-05', '2026-08-07'), true);
});

test('dates compare as strings across a year boundary', () => {
  assert.strictEqual(datesOverlap('2026-12-31', '2027-01-02', '2027-01-01', '2027-01-01'), true);
});

// ── Which statuses block ──────────────────────────────────────────────
test('REJECTED and CANCELLED never block', () => {
  assert.strictEqual(isBlockingStatus('REJECTED'), false);
  assert.strictEqual(isBlockingStatus('CANCELLED'), false);
  assert.deepStrictEqual(find([REC({ id: 1, status: 'REJECTED' }), REC({ id: 2, status: 'CANCELLED' })]), []);
});

test('every live status blocks', () => {
  for (const status of ['PENDING', 'TL APPROVED', 'HOD APPROVED', 'HOD RECOMMENDED', 'APPROVED']) {
    assert.strictEqual(isBlockingStatus(status), true, `${status} should block`);
  }
});

test('an unknown or future status blocks by default', () => {
  // Deny-list behaviour, asserted rather than assumed: a status added later
  // must not silently open a hole.
  assert.strictEqual(isBlockingStatus('HR REVIEWING'), true);
  assert.strictEqual(isBlockingStatus(''), true);
  assert.strictEqual(isBlockingStatus(undefined), true);
});

test('status matching tolerates case and whitespace', () => {
  assert.strictEqual(isBlockingStatus(' rejected '), false);
  assert.strictEqual(isBlockingStatus('Cancelled'), false);
});

test('NON_BLOCKING_STATUSES is frozen against a caller mutating it', () => {
  assert.strictEqual(Object.isFrozen(NON_BLOCKING_STATUSES), true);
  assert.throws(() => { NON_BLOCKING_STATUSES.push('APPROVED'); });
});

// ── findOverlappingLeaves ─────────────────────────────────────────────
test('a live record on the same dates is returned', () => {
  assert.deepStrictEqual(ids(find([REC({ id: 7 })])), [7]);
});

test('overlap is checked regardless of leave type', () => {
  // Holding MC for 5-7 Aug blocks AL for 6 Aug.
  const got = find([REC({ id: 7, type: 'MC' })], { startDate: '2026-08-06', endDate: '2026-08-06' });
  assert.deepStrictEqual(ids(got), [7]);
});

test('another staff member never blocks', () => {
  assert.deepStrictEqual(find([REC({ id: 7, ic: '880202025555' })]), []);
});

test('ic matching tolerates surrounding whitespace', () => {
  assert.deepStrictEqual(ids(find([REC({ id: 7, ic: ' 900101015555 ' })])), [7]);
});

test('excludeId removes the record itself, given a number', () => {
  assert.deepStrictEqual(find([REC({ id: 7 })], { opts: { excludeId: 7 } }), []);
});

test('excludeId removes the record itself, given a string', () => {
  // Call sites pass ids from both numeric records and string doc ids.
  assert.deepStrictEqual(find([REC({ id: 7 })], { opts: { excludeId: '7' } }), []);
});

test('excludeId does not remove a different record', () => {
  assert.deepStrictEqual(ids(find([REC({ id: 7 }), REC({ id: 8 })], { opts: { excludeId: 8 } })), [7]);
});

test('records missing dates are skipped, not matched and not thrown on', () => {
  const records = [
    REC({ id: 7, startDate: undefined }),
    REC({ id: 8, endDate: '' }),
    REC({ id: 9, startDate: null, endDate: null }),
  ];
  assert.deepStrictEqual(find(records), []);
});

test('a null entry in the record list does not throw', () => {
  assert.deepStrictEqual(ids(find([null, undefined, REC({ id: 7 })])), [7]);
});

test('a missing record list returns empty', () => {
  assert.deepStrictEqual(findOverlappingLeaves(undefined, '900101015555', '2026-08-05', '2026-08-07'), []);
});

test('an incomplete query returns empty rather than matching everything', () => {
  // Callers own their own validation; this module must not become a second,
  // silent validator that blocks on garbage input.
  const records = [REC({ id: 7 })];
  assert.deepStrictEqual(findOverlappingLeaves(records, '', '2026-08-05', '2026-08-07'), []);
  assert.deepStrictEqual(findOverlappingLeaves(records, '900101015555', '', '2026-08-07'), []);
  assert.deepStrictEqual(findOverlappingLeaves(records, '900101015555', '2026-08-05', ''), []);
});

// ── overlapsOtherLeaves ───────────────────────────────────────────────
test('overlapsOtherLeaves finds the twin of a duplicate pair', () => {
  const a = REC({ id: 1 });
  const b = REC({ id: 2 });
  assert.deepStrictEqual(ids(overlapsOtherLeaves([a, b], a)), [2]);
  assert.deepStrictEqual(ids(overlapsOtherLeaves([a, b], b)), [1]);
});

test('overlapsOtherLeaves never matches the record against itself', () => {
  const a = REC({ id: 1 });
  assert.deepStrictEqual(overlapsOtherLeaves([a], a), []);
});

test('a cancelled record is not flagged as overlapping', () => {
  const a = REC({ id: 1, status: 'CANCELLED' });
  const b = REC({ id: 2 });
  assert.deepStrictEqual(overlapsOtherLeaves([a, b], a), []);
});

test('overlapsOtherLeaves survives a missing record', () => {
  assert.deepStrictEqual(overlapsOtherLeaves([REC({ id: 1 })], null), []);
});

// ── describeOverlaps ──────────────────────────────────────────────────
test('describeOverlaps names type, dates and status on one line each', () => {
  const labelOf = (code) => ({ MC: 'Cuti Sakit (MC)', AL: 'Cuti Tahunan' }[code] || code);
  const got = describeOverlaps([REC({ id: 1 }), REC({ id: 2, type: 'AL', startDate: '2026-08-09', endDate: '2026-08-09' })], labelOf);
  assert.strictEqual(got,
    '• Cuti Sakit (MC) — 2026-08-05 → 2026-08-07 (PENDING)\n' +
    '• Cuti Tahunan — 2026-08-09 (PENDING)');
});

test('describeOverlaps falls back to the raw type code with no resolver', () => {
  assert.strictEqual(describeOverlaps([REC({ id: 1 })]), '• MC — 2026-08-05 → 2026-08-07 (PENDING)');
});

test('describeOverlaps returns empty string for no overlaps', () => {
  assert.strictEqual(describeOverlaps([]), '');
  assert.strictEqual(describeOverlaps(undefined), '');
});
