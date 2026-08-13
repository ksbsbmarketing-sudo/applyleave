import { test } from 'node:test';
import assert from 'node:assert';
import {
  NON_BLOCKING_STATUSES, isBlockingStatus, datesOverlap,
  findOverlappingLeaves, overlapsOtherLeaves, describeOverlaps,
  findApprovedOverlaps, findOverlapGroups,
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

test('a non-overlapping record of the same staff does not block', () => {
  // Guards the filter at the layer the app actually calls. Without this, a
  // findOverlappingLeaves that ignored dates entirely would pass the whole
  // suite — and would block every application a staff member ever made.
  assert.deepStrictEqual(find([REC({ id: 7, startDate: '2026-08-08', endDate: '2026-08-10' })]), []);
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

test('overlapsOtherLeaves ignores a non-overlapping record', () => {
  const a = REC({ id: 1 });
  const b = REC({ id: 2, startDate: '2026-09-01', endDate: '2026-09-02' });
  assert.deepStrictEqual(overlapsOtherLeaves([a, b], a), []);
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

// ── findApprovedOverlaps ──────────────────────────────────────────────
// Same default query as `find`, but through the approved-only matcher.
const findAppr = (records, over = {}) => {
  const q = { ic: '900101015555', startDate: '2026-08-05', endDate: '2026-08-07', ...over };
  return findApprovedOverlaps(records, q.ic, q.startDate, q.endDate, q.opts);
};

test('findApprovedOverlaps returns an overlapping approved record', () => {
  assert.deepStrictEqual(ids(findAppr([REC({ id: 7, status: 'APPROVED' })])), [7]);
});

test('findApprovedOverlaps ignores overlapping records not yet fully approved', () => {
  // Two competing PENDING applications must not block each other — HR
  // approves the right one and rejects the other.
  const records = [
    REC({ id: 1, status: 'PENDING' }),
    REC({ id: 2, status: 'TL APPROVED' }),
    REC({ id: 3, status: 'HOD APPROVED' }),
    REC({ id: 4, status: 'HOD RECOMMENDED' }),
  ];
  assert.deepStrictEqual(findAppr(records), []);
});

test('findApprovedOverlaps ignores rejected and cancelled records', () => {
  const records = [REC({ id: 1, status: 'REJECTED' }), REC({ id: 2, status: 'CANCELLED' })];
  assert.deepStrictEqual(findAppr(records), []);
});

test('findApprovedOverlaps returns [] for a NON-overlapping approved record', () => {
  // Mutation-killer: an implementation that ignored dates would pass the
  // rest of this section. Default query is 08-05..08-07; this is adjacent.
  const rec = REC({ id: 7, status: 'APPROVED', startDate: '2026-08-08', endDate: '2026-08-10' });
  assert.deepStrictEqual(findAppr([rec]), []);
});

test('findApprovedOverlaps honours excludeId', () => {
  assert.deepStrictEqual(findAppr([REC({ id: 7, status: 'APPROVED' })], { opts: { excludeId: 7 } }), []);
});

test('findApprovedOverlaps tolerates lowercase and padded status', () => {
  assert.deepStrictEqual(ids(findAppr([REC({ id: 7, status: ' approved ' })])), [7]);
});

test('findApprovedOverlaps never matches another staff member', () => {
  assert.deepStrictEqual(findAppr([REC({ id: 7, status: 'APPROVED', ic: '880202025555' })]), []);
});

// ── findOverlapGroups ─────────────────────────────────────────────────
test('findOverlapGroups maps both members of a pair to each other', () => {
  const a = REC({ id: 1 }), b = REC({ id: 2 });
  const m = findOverlapGroups([a, b]);
  assert.strictEqual(m.size, 2);
  assert.deepStrictEqual(ids(m.get(1)), [2]);
  assert.deepStrictEqual(ids(m.get(2)), [1]);
});

test('findOverlapGroups returns an empty Map when nothing overlaps', () => {
  const m = findOverlapGroups([REC({ id: 1 }), REC({ id: 2, startDate: '2026-09-01', endDate: '2026-09-02' })]);
  assert.strictEqual(m.size, 0);
});

test('findOverlapGroups does NOT group adjacent-but-separate ranges', () => {
  // The boundary that decides whether legitimate back-to-back leave gets
  // wrongly flagged for every staff member in Master Logs.
  const m = findOverlapGroups([REC({ id: 1 }), REC({ id: 2, startDate: '2026-08-08', endDate: '2026-08-10' })]);
  assert.strictEqual(m.size, 0);
});

test('findOverlapGroups never groups records belonging to different staff', () => {
  const m = findOverlapGroups([REC({ id: 1 }), REC({ id: 2, ic: '880202025555' })]);
  assert.strictEqual(m.size, 0);
});

test('findOverlapGroups excludes rejected and cancelled records', () => {
  const m = findOverlapGroups([
    REC({ id: 1 }), REC({ id: 2, status: 'CANCELLED' }), REC({ id: 3, status: 'REJECTED' }),
  ]);
  assert.strictEqual(m.size, 0);
});

test('findOverlapGroups skips records missing dates', () => {
  // Missing endDate alone doesn't actually exercise the guard: '' sorts
  // before any real date, so datesOverlap already returns false on its own
  // ('2026-08-05' <= '' is false). The case that bites is a missing
  // startDate — datesOverlap('2026-08-05','2026-08-07','','2026-08-06') is
  // true, so without the guard a blank startDate would falsely group a
  // legitimate record. Both must still clear the map.
  const m1 = findOverlapGroups([REC({ id: 1 }), REC({ id: 2, endDate: '' })]);
  assert.strictEqual(m1.size, 0);
  const m2 = findOverlapGroups([REC({ id: 1 }), REC({ id: 2, startDate: '' })]);
  assert.strictEqual(m2.size, 0);
});

test('findOverlapGroups skips records with no id instead of collapsing onto a shared key', () => {
  // Two overlapping records of the same staff member, both missing `id`:
  // without the guard they'd both key onto `undefined` in the output Map,
  // and a has(r.id) lookup would then read true for every undefined-id row
  // — including a different staff member's.
  const m = findOverlapGroups([REC({ id: undefined }), REC({ id: undefined })]);
  assert.strictEqual(m.size, 0);
});

test('findOverlapGroups links all three of a mutually overlapping trio', () => {
  const m = findOverlapGroups([REC({ id: 1 }), REC({ id: 2 }), REC({ id: 3 })]);
  assert.deepStrictEqual(ids(m.get(1)), [2, 3]);
  assert.deepStrictEqual(ids(m.get(2)), [1, 3]);
  assert.deepStrictEqual(ids(m.get(3)), [1, 2]);
});

test('findOverlapGroups survives a missing list and null entries', () => {
  assert.strictEqual(findOverlapGroups(undefined).size, 0);
  assert.strictEqual(findOverlapGroups([null, REC({ id: 1 })]).size, 0);
});
