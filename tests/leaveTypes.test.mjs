import { test } from 'node:test';
import assert from 'node:assert';
import {
  LEAVE_CATEGORIES, LEAVE_TYPE_NAMES, LEAVE_TYPE_SHORT,
  leaveTypeName, leaveTypeShort,
} from '../src/leaveTypes.js';
import { FORMULA_B_TYPES } from '../src/leaveBalance.js';

// Storage codes (EL_EMG, ML_PL) are frozen into every historical Firestore record.
// Only what a human READS changes. These tests pin that boundary.

test('storage ids are unchanged — renaming is a display concern only', () => {
  const ids = LEAVE_CATEGORIES.map(c => c.id);
  ['AL', 'MC', 'EL', 'EL_EMG', 'UP', 'HL', 'ML', 'ML_PL', 'CME'].forEach(id =>
    assert.ok(ids.includes(id), `${id} must survive — old records still use it`));
});

test('ids are unique', () => {
  const ids = LEAVE_CATEGORIES.map(c => c.id);
  assert.strictEqual(new Set(ids).size, ids.length);
});

test('the three renamed types read as agreed', () => {
  assert.strictEqual(leaveTypeName('EL'), 'Cuti Ehsan');
  assert.strictEqual(leaveTypeName('EL_EMG'), 'Cuti Kecemasan');
  assert.strictEqual(leaveTypeName('ML_PL'), 'Cuti Paterniti (PL)');
});

test('short codes never show the raw storage code', () => {
  assert.strictEqual(leaveTypeShort('EL'), 'EHSAN');
  assert.strictEqual(leaveTypeShort('EL_EMG'), 'EMG');
  assert.strictEqual(leaveTypeShort('ML_PL'), 'PL');
});

test('short codes stay unique — EMG exists so EL_EMG cannot collide with EL', () => {
  const shorts = LEAVE_CATEGORIES.map(c => leaveTypeShort(c.id));
  assert.strictEqual(new Set(shorts).size, shorts.length,
    `duplicate short code in ${shorts.join(',')}`);
});

test('no display string anywhere contains an underscore code', () => {
  LEAVE_CATEGORIES.forEach(c => {
    assert.ok(!c.name.includes('_'), `${c.id} name leaks a storage code: ${c.name}`);
    assert.ok(!leaveTypeShort(c.id).includes('_'), `${c.id} short code leaks an underscore`);
  });
});

// ── Cuti Ganti (RL) ───────────────────────────────────────────────────
test('RL exists, is called Cuti Ganti, and has no quota', () => {
  const rl = LEAVE_CATEGORIES.find(c => c.id === 'RL');
  assert.ok(rl, 'RL must be in the catalogue');
  assert.strictEqual(rl.name, 'Cuti Ganti');
  assert.strictEqual(rl.entitlement, 0, 'replacement leave is earned, not allocated');
});

test('RL is not a Formula B type — there is no balance to track', () => {
  assert.strictEqual(FORMULA_B_TYPES.includes('RL'), false);
});

// ── Fallbacks ─────────────────────────────────────────────────────────
test('legacy and unknown codes fall back to the raw code, not undefined', () => {
  assert.strictEqual(leaveTypeName('PL'), 'Cuti Paterniti (PL)'); // legacy alias, mapped
  assert.strictEqual(leaveTypeName('CF'), 'Cuti Bawa Ke Hadapan (CF)');
  assert.strictEqual(leaveTypeName('NONSENSE'), 'NONSENSE');
  assert.strictEqual(leaveTypeShort('NONSENSE'), 'NONSENSE');
});

test('the exported maps cannot be mutated by a caller', () => {
  const before = LEAVE_TYPE_SHORT.EL_EMG;
  try { LEAVE_TYPE_SHORT.EL_EMG = 'HACKED'; } catch { /* frozen throws in strict mode */ }
  assert.strictEqual(LEAVE_TYPE_SHORT.EL_EMG, before);
  try { LEAVE_TYPE_NAMES.EL = 'HACKED'; } catch { /* frozen */ }
  assert.strictEqual(LEAVE_TYPE_NAMES.EL, 'Cuti Ehsan');
});
