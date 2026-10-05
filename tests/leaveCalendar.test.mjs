import { test } from 'node:test';
import assert from 'node:assert';
import { monthGrid, leavesByDay, shiftMonth, monthLabel, isOnCalendar } from '../src/leaveCalendar.js';

test('grid starts on Monday and covers whole weeks', () => {
  // 1 Oktober 2026 ialah hari Khamis
  const weeks = monthGrid(2026, 10);
  assert.strictEqual(weeks[0][0].date, '2026-09-28');            // Isnin sebelumnya
  assert.strictEqual(weeks[0][3].date, '2026-10-01');
  assert.strictEqual(weeks[0][3].inMonth, true);
  assert.strictEqual(weeks[0][0].inMonth, false);
  assert.ok(weeks.every(w => w.length === 7));
  const inMonth = weeks.flat().filter(c => c.inMonth);
  assert.strictEqual(inMonth.length, 31);
});

test('February in a leap year', () => {
  assert.strictEqual(monthGrid(2028, 2).flat().filter(c => c.inMonth).length, 29);
});

test('multi-day leave fills every day, clipped to range', () => {
  const recs = [{ id: 1, name: 'A', status: 'APPROVED', startDate: '2026-09-29', endDate: '2026-10-02' }];
  const map = leavesByDay(recs, '2026-10-01', '2026-10-31');
  assert.deepStrictEqual([...map.keys()], ['2026-10-01', '2026-10-02']);
});

test('rejected and cancelled leaves are hidden; pending shown', () => {
  const recs = [
    { id: 1, name: 'R', status: 'REJECTED', startDate: '2026-10-05', endDate: '2026-10-05' },
    { id: 2, name: 'C', status: 'CANCELLED', startDate: '2026-10-05', endDate: '2026-10-05' },
    { id: 3, name: 'P', status: 'PENDING', startDate: '2026-10-05', endDate: '2026-10-05' },
    { id: 4, name: 'H', status: 'HOD APPROVED', startDate: '2026-10-05', endDate: '2026-10-05' },
  ];
  const day = leavesByDay(recs, '2026-10-01', '2026-10-31').get('2026-10-05');
  assert.deepStrictEqual(day.map(r => r.id).sort(), [3, 4]);
});

test('approved sorted before pending within a day', () => {
  const recs = [
    { id: 1, name: 'Ali', status: 'PENDING', startDate: '2026-10-05' },
    { id: 2, name: 'Zul', status: 'APPROVED', startDate: '2026-10-05' },
  ];
  assert.deepStrictEqual(leavesByDay(recs, '2026-10-01', '2026-10-31').get('2026-10-05').map(r => r.id), [2, 1]);
});

test('missing / inverted endDate counts as one day', () => {
  const recs = [
    { id: 1, name: 'A', status: 'APPROVED', startDate: '2026-10-05' },
    { id: 2, name: 'B', status: 'APPROVED', startDate: '2026-10-07', endDate: '2026-10-06' },
  ];
  const map = leavesByDay(recs, '2026-10-01', '2026-10-31');
  assert.deepStrictEqual([...map.keys()].sort(), ['2026-10-05', '2026-10-07']);
});

test('records without startDate are ignored', () => {
  assert.strictEqual(isOnCalendar({ status: 'APPROVED' }), false);
  assert.strictEqual(isOnCalendar(null), false);
});

test('month navigation crosses year boundaries', () => {
  assert.strictEqual(shiftMonth('2026-01', -1), '2025-12');
  assert.strictEqual(shiftMonth('2026-12', 1), '2027-01');
  assert.strictEqual(monthLabel('2026-10'), 'Oktober 2026');
});
