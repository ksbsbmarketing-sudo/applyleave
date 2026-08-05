import { test } from 'node:test';
import assert from 'node:assert';
import { countLeaveDays, weekendDaysForState } from '../src/leaveDays.js';

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

// ── Zone weekends ─────────────────────────────────────────────────────────────
// Pahang rests Sat+Sun; Terengganu rests Fri+Sat. Only Admin Staff are affected —
// everyone else counts calendar days, where the weekend is irrelevant.
// Reference: 2026-07-03 Fri, 04 Sat, 05 Sun, 06 Mon, 07 Tue, 08 Wed, 09 Thu, 10 Fri.

test('weekendDaysForState maps the two zones, and defaults to Pahang', () => {
  assert.deepStrictEqual([...weekendDaysForState('Pahang')].sort(), [0, 6]);
  assert.deepStrictEqual([...weekendDaysForState('Terengganu')].sort(), [5, 6]);
  // Unknown/missing state must not silently produce a 7-day working week.
  assert.deepStrictEqual([...weekendDaysForState(null)].sort(), [0, 6]);
  assert.deepStrictEqual([...weekendDaysForState('Selangor')].sort(), [0, 6]);
});

test('Terengganu admin: Friday is a rest day, not a charged leave day', () => {
  const TR = weekendDaysForState('Terengganu');
  // Thu -> Fri. Only Thursday is a working day in Terengganu.
  assert.strictEqual(countLeaveDays('2026-07-09', '2026-07-10', true, [], false, TR), 1);
  // The same range under Pahang rules charges both days — this is the bug.
  assert.strictEqual(countLeaveDays('2026-07-09', '2026-07-10', true), 2);
});

test('Terengganu admin: Sunday IS a working day', () => {
  const TR = weekendDaysForState('Terengganu');
  assert.strictEqual(countLeaveDays('2026-07-05', '2026-07-05', true, [], false, TR), 1);
  assert.strictEqual(countLeaveDays('2026-07-05', '2026-07-05', true), 0); // Pahang: rest day
});

test('Terengganu admin: full working week Sun->Thu = 5', () => {
  const TR = weekendDaysForState('Terengganu');
  assert.strictEqual(countLeaveDays('2026-07-05', '2026-07-09', true, [], false, TR), 5);
});

test('Terengganu admin: Fri->Sat range charges nothing', () => {
  const TR = weekendDaysForState('Terengganu');
  assert.strictEqual(countLeaveDays('2026-07-03', '2026-07-04', true, [], false, TR), 0);
});

test('a full Mon->Sun week is 5 days in both zones — why the bug stayed hidden', () => {
  const TR = weekendDaysForState('Terengganu');
  const PH = weekendDaysForState('Pahang');
  assert.strictEqual(countLeaveDays('2026-07-06', '2026-07-12', true, [], false, TR), 5);
  assert.strictEqual(countLeaveDays('2026-07-06', '2026-07-12', true, [], false, PH), 5);
});

test('Terengganu admin still skips public holidays', () => {
  const TR = weekendDaysForState('Terengganu');
  // Sun..Tue with Monday a holiday = Sun + Tue = 2.
  assert.strictEqual(countLeaveDays('2026-07-05', '2026-07-07', true, ['2026-07-06'], false, TR), 2);
});

test('zone does not affect non-admin or calendar-only leave', () => {
  const TR = weekendDaysForState('Terengganu');
  // Non-admin: every calendar day counts regardless of zone.
  assert.strictEqual(countLeaveDays('2026-07-03', '2026-07-06', false, [], false, TR), 4);
  // calendarOnly (ML/ML_PL/HL) overrides the working-week logic entirely.
  assert.strictEqual(countLeaveDays('2026-07-03', '2026-07-06', true, [], true, TR), 4);
});
