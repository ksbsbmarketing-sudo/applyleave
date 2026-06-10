import { test } from 'node:test';
import assert from 'node:assert';
import { countLeaveDays } from '../src/leaveDays.js';

// 2026-07-03 Fri, 04 Sat, 05 Sun, 06 Mon, 07 Tue, 08 Wed, 10 Fri (verified)

test('non-admin counts all calendar days (Fri->Mon = 4)', () => {
  assert.strictEqual(countLeaveDays('2026-07-03', '2026-07-06', false), 4);
});

test('admin skips weekend (Fri->Mon = 2)', () => {
  assert.strictEqual(countLeaveDays('2026-07-03', '2026-07-06', true), 2);
});

test('admin full work week (Mon->Fri = 5)', () => {
  assert.strictEqual(countLeaveDays('2026-07-06', '2026-07-10', true), 5);
});

test('admin excludes a public holiday in range (Mon..Wed, Tue holiday = 2)', () => {
  assert.strictEqual(countLeaveDays('2026-07-06', '2026-07-08', true, ['2026-07-07']), 2);
});

test('admin weekend-only range = 0', () => {
  assert.strictEqual(countLeaveDays('2026-07-04', '2026-07-05', true), 0);
});

test('single weekday = 1 for both admin and non-admin', () => {
  assert.strictEqual(countLeaveDays('2026-07-06', '2026-07-06', true), 1);
  assert.strictEqual(countLeaveDays('2026-07-06', '2026-07-06', false), 1);
});

test('end before start = 0 (defensive)', () => {
  assert.strictEqual(countLeaveDays('2026-07-06', '2026-07-01', true), 0);
  assert.strictEqual(countLeaveDays('2026-07-06', '2026-07-01', false), 0);
});

test('holidayDates accepts a Set', () => {
  assert.strictEqual(countLeaveDays('2026-07-06', '2026-07-08', true, new Set(['2026-07-07'])), 2);
});

test('non-admin ignores holidays (Mon..Wed with Tue holiday = 3)', () => {
  assert.strictEqual(countLeaveDays('2026-07-06', '2026-07-08', false, ['2026-07-07']), 3);
});
