import { test } from 'node:test';
import assert from 'node:assert';
import { canEditHolidayState } from '../src/holidayAccess.js';

const ON = { manage_holidays: true };

test('admin and super_admin edit both states', () => {
  for (const role of ['admin', 'super_admin'])
    for (const st of ['pahang', 'terengganu'])
      assert.strictEqual(canEditHolidayState({ role, perms: ON, zone: 'all' }, st), true, role + st);
});

test('HR edits only its own zone', () => {
  assert.strictEqual(canEditHolidayState({ role: 'hr', perms: ON, zone: 'Pahang' }, 'pahang'), true);
  assert.strictEqual(canEditHolidayState({ role: 'hr', perms: ON, zone: 'Pahang' }, 'terengganu'), false);
  assert.strictEqual(canEditHolidayState({ role: 'hr', perms: ON, zone: 'Terengganu' }, 'terengganu'), true);
  assert.strictEqual(canEditHolidayState({ role: 'hr', perms: ON, zone: 'Terengganu' }, 'pahang'), false);
});

test('HOD Cawangan edits its branch state only — a Pahang HOD cannot touch Terengganu', () => {
  assert.strictEqual(canEditHolidayState({ role: 'hod_cawangan', perms: ON, zone: 'Terengganu' }, 'terengganu'), true);
  assert.strictEqual(canEditHolidayState({ role: 'hod_cawangan', perms: ON, zone: 'Pahang' }, 'terengganu'), false);
});

test('without manage_holidays nobody edits, not even admin', () => {
  assert.strictEqual(canEditHolidayState({ role: 'admin', perms: { manage_holidays: false }, zone: 'all' }, 'pahang'), false);
  assert.strictEqual(canEditHolidayState({ role: 'hod_balok', perms: {}, zone: 'Pahang' }, 'pahang'), false);
});

test('KSB Pharma zone matches no holiday list', () => {
  assert.strictEqual(canEditHolidayState({ role: 'hr', perms: ON, zone: 'KSB Pharma' }, 'pahang'), false);
});
