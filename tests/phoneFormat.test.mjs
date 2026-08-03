import { test } from 'node:test';
import assert from 'node:assert';
import { normalizePhone, isValidPhone } from '../src/phoneFormat.js';

test('leading 0 becomes 6 (the reported bug)', () => {
  assert.strictEqual(normalizePhone('0136529531'), '60136529531');
  assert.strictEqual(normalizePhone('01112337591'), '601112337591');
  assert.strictEqual(normalizePhone('0199149612'), '60199149612');
});

test('already-normalised numbers are left alone', () => {
  assert.strictEqual(normalizePhone('60178998771'), '60178998771');
  assert.strictEqual(normalizePhone('60179174735'), '60179174735');
});

test('formatting characters are stripped', () => {
  assert.strictEqual(normalizePhone('013-652 9531'), '60136529531');
  assert.strictEqual(normalizePhone('+60 17-899 8771'), '60178998771');
  assert.strictEqual(normalizePhone(' 013 652 9531 '), '60136529531');
});

test('a number typed without its leading 0 gets the full 60 prefix', () => {
  assert.strictEqual(normalizePhone('136529531'), '60136529531');
});

test('empty and nullish inputs stay empty (phone is optional)', () => {
  assert.strictEqual(normalizePhone(''), '');
  assert.strictEqual(normalizePhone('   '), '');
  assert.strictEqual(normalizePhone(null), '');
  assert.strictEqual(normalizePhone(undefined), '');
});

test('normalising is idempotent', () => {
  const once = normalizePhone('0136529531');
  assert.strictEqual(normalizePhone(once), once);
});

test('every stored number that was blocking a profile save now validates', () => {
  const blocked = ['0136529531', '0139406340', '0199149612', '0197326286',
                   '0145295674', '0129874685', '0139174522', '01112337591'];
  for (const p of blocked) {
    assert.ok(isValidPhone(normalizePhone(p)), `${p} should validate after normalising`);
  }
});

test('an empty phone is valid — the field is optional', () => {
  assert.ok(isValidPhone(''));
});

test('nonsense lengths are still rejected', () => {
  assert.ok(!isValidPhone(normalizePhone('123')));
  assert.ok(!isValidPhone(normalizePhone('0123456789012345')));
});
