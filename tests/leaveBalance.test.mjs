import { test } from 'node:test';
import assert from 'node:assert';
import { recordBalances } from '../src/leaveBalance.js';

// Helper to build an approved AL record
const rec = (id, days, startDate, opts = {}) => ({
  id, days, startDate, ic: 'X', type: 'AL', status: 'APPROVED', ...opts,
});

// Scenario: AL entitlement 14; three approved leaves in date order.
// A = 3 days (Jan), B = 2 days (Feb), C = 4 days (Mar). Total used = 9, baki = 5.
const A = rec(1001, 3, '2026-01-05');
const B = rec(1002, 2, '2026-02-10');
const C = rec(1003, 4, '2026-03-15');
const ALL = [A, B, C];

test('first leave: before = full entitlement, after = minus its own days', () => {
  const r = recordBalances({ record: A, ent: 14, records: ALL });
  assert.deepStrictEqual([r.before, r.after], [14, 11]);
});

test('middle leave: before excludes later leaves', () => {
  const r = recordBalances({ record: B, ent: 14, records: ALL });
  assert.deepStrictEqual([r.before, r.after], [11, 9]);
});

test('last leave: after equals current global balance (matches dashboard)', () => {
  const r = recordBalances({ record: C, ent: 14, records: ALL });
  assert.deepStrictEqual([r.before, r.after], [9, 5]);
});

test('al_adj baseline is counted as prior usage', () => {
  const r = recordBalances({ record: A, ent: 14, alAdj: 2, records: ALL });
  assert.deepStrictEqual([r.before, r.after], [12, 9]);
});

test('records of a different type are ignored (MC does not touch AL)', () => {
  const mc = rec(1000, 5, '2026-01-01', { type: 'MC' });
  const r = recordBalances({ record: B, ent: 14, records: [...ALL, mc] });
  assert.deepStrictEqual([r.before, r.after], [11, 9]);
});

test('pending earlier records do not consume balance', () => {
  const pending = rec(999, 6, '2026-01-01', { status: 'PENDING' });
  const r = recordBalances({ record: A, ent: 14, records: [...ALL, pending] });
  assert.deepStrictEqual([r.before, r.after], [14, 11]);
});

test('printing a pending record still projects the deduction', () => {
  const D = rec(1004, 2, '2026-04-20', { status: 'PENDING' });
  const r = recordBalances({ record: D, ent: 14, records: [...ALL, D] });
  // prior approved = A+B+C = 9 → before 5, after 3
  assert.deepStrictEqual([r.before, r.after], [5, 3]);
});

test('balance clamps at zero when overdrawn', () => {
  const big = rec(2000, 20, '2026-05-01');
  const r = recordBalances({ record: big, ent: 14, records: [...ALL, big] });
  // prior = 9, before = max(0,14-9)=5, after = max(0,5-20)=0
  assert.deepStrictEqual([r.before, r.after], [5, 0]);
});

test('ordering uses startDate, not application id', () => {
  // E applied last (highest id) but dated earliest → counts before A
  const E = rec(5000, 1, '2026-01-01');
  const r = recordBalances({ record: A, ent: 14, records: [...ALL, E] });
  // E (1 day) is prior to A → before 13, after 10
  assert.deepStrictEqual([r.before, r.after], [13, 10]);
});

test('same startDate falls back to id order', () => {
  const F = rec(900, 2, '2026-01-05'); // same date as A, lower id → before A
  const r = recordBalances({ record: A, ent: 14, records: [...ALL, F] });
  assert.deepStrictEqual([r.before, r.after], [12, 9]);
});

test('the record itself is never double-counted', () => {
  // C is approved and present in records; must not subtract itself in "before"
  const r = recordBalances({ record: C, ent: 14, records: ALL });
  assert.strictEqual(r.before, 9); // 14 - (A3+B2), NOT minus C
});

import { computeElOverflow } from '../src/leaveBalance.js';

test('EL within the bucket → no overflow', () => {
  assert.strictEqual(computeElOverflow({ entEL: 3, usedSys: 2 }), 0);
});

test('EL exceeding the bucket → overflow is the excess', () => {
  assert.strictEqual(computeElOverflow({ entEL: 3, usedSys: 5 }), 2);
});

test('EL exactly at the bucket edge → no overflow', () => {
  assert.strictEqual(computeElOverflow({ entEL: 3, usedSys: 3 }), 0);
});

test('HR pelarasan counts toward overflow', () => {
  // usedPre 2 + pelarasan 2 = 4, ent 3 → overflow 1
  assert.strictEqual(computeElOverflow({ entEL: 3, usedPre: 2, pelarasan: 2 }), 1);
});

test('pre + system usage combine toward overflow', () => {
  // usedPre 1 + usedSys 3 = 4, ent 3 → overflow 1
  assert.strictEqual(computeElOverflow({ entEL: 3, usedPre: 1, usedSys: 3 }), 1);
});

test('overflow never goes negative', () => {
  assert.strictEqual(computeElOverflow({ entEL: 3 }), 0);
});

test('non-numeric / missing inputs are treated as zero', () => {
  assert.strictEqual(computeElOverflow({ entEL: 3, usedSys: 'x', pelarasan: null }), 0);
});
