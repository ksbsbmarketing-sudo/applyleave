import { test } from 'node:test';
import assert from 'node:assert';
import { FORMULA_B_TYPES, usesFormulaB, formulaBBalance } from '../src/leaveBalance.js';

// Formula B: Baki = Jumlah − Guna Sebelum Sistem − Guna Dalam Sistem − Pelarasan HR.
//
// This list was duplicated in three places in main.js — the getLeaveStats gate,
// the HR save loop, and implicitly in which modal blocks got rendered. CME was
// added to the app but never to any of them, so "Guna Sebelum Sistem" silently
// did not exist for it. One list, one place, so the three cannot drift again.

test('CME uses Formula B — the bug this list exists to prevent', () => {
  assert.ok(usesFormulaB('CME'), 'CME must use Formula B so pre-system usage counts');
  assert.ok(FORMULA_B_TYPES.includes('CME'));
});

test('AL, MC and EL keep using Formula B', () => {
  ['AL', 'MC', 'EL'].forEach(t => assert.ok(usesFormulaB(t), `${t} should use Formula B`));
});

test('leave types without HR balance tracking are excluded', () => {
  ['HL', 'ML', 'ML_PL', 'EL_EMG', 'UP', 'CF'].forEach(t =>
    assert.strictEqual(usesFormulaB(t), false, `${t} should not use Formula B`));
});

test('unknown, empty and non-string types are rejected, not crashed on', () => {
  [undefined, null, '', 'nonsense', 42, {}].forEach(t =>
    assert.strictEqual(usesFormulaB(t), false));
});

test('type matching is exact and case-sensitive — "cme" is not a leave type id', () => {
  assert.strictEqual(usesFormulaB('cme'), false);
  assert.strictEqual(usesFormulaB('Al'), false);
});

test('the exported list cannot be mutated by a caller', () => {
  const before = [...FORMULA_B_TYPES];
  try { FORMULA_B_TYPES.push('HL'); } catch { /* frozen throws in strict mode */ }
  assert.deepStrictEqual([...FORMULA_B_TYPES], before);
});

// ── formulaBBalance ───────────────────────────────────────────────────
test('balance subtracts pre-system usage, in-system usage and HR pelarasan', () => {
  // CME: 5 days entitlement, 2 used before the system existed, 1 recorded in it.
  assert.strictEqual(formulaBBalance({ ent: 5, usedPre: 2, usedSys: 1, pelarasan: 0 }), 2);
});

test('the reported CME case: days used before the system now reduce the balance', () => {
  // Before the fix usedPre was forced to 0, so this returned the full 5.
  assert.strictEqual(formulaBBalance({ ent: 5, usedPre: 3, usedSys: 0, pelarasan: 0 }), 2);
});

test('balance never goes negative', () => {
  assert.strictEqual(formulaBBalance({ ent: 5, usedPre: 4, usedSys: 3, pelarasan: 0 }), 0);
});

test('overflow days are deducted when supplied (AL absorbs EL spillover)', () => {
  assert.strictEqual(formulaBBalance({ ent: 14, usedPre: 2, usedSys: 3, pelarasan: 1, overflow: 2 }), 6);
});

test('missing and non-numeric parts are treated as zero', () => {
  assert.strictEqual(formulaBBalance({ ent: 5 }), 5);
  assert.strictEqual(formulaBBalance({ ent: 5, usedPre: '', usedSys: null, pelarasan: undefined }), 5);
  assert.strictEqual(formulaBBalance({ ent: 5, usedPre: 'abc' }), 5);
  assert.strictEqual(formulaBBalance({}), 0);
});

test('half days survive the arithmetic', () => {
  assert.strictEqual(formulaBBalance({ ent: 5, usedPre: 1.5, usedSys: 0.5 }), 3);
});

test('numeric strings from form inputs are accepted', () => {
  assert.strictEqual(formulaBBalance({ ent: '5', usedPre: '2', usedSys: '1' }), 2);
});
