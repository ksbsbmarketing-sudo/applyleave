import { test } from 'node:test';
import assert from 'node:assert';
import { validateLeaveReason, countReasonLetters } from '../src/leaveReason.js';

test('symbol-only reasons are rejected (the reported bug)', () => {
  for (const r of ['""', "''", '-', '...', '?!', '" "', '123', '1/2', '  ']) {
    assert.notStrictEqual(validateLeaveReason(r), null, `should reject ${JSON.stringify(r)}`);
  }
});

test('empty / missing reasons are rejected', () => {
  assert.match(validateLeaveReason(''), /WAJIB/);
  assert.match(validateLeaveReason(null), /WAJIB/);
  assert.match(validateLeaveReason(undefined), /WAJIB/);
});

test('fewer than 3 letters is rejected', () => {
  assert.match(validateLeaveReason('ok'), /TIDAK SAH/);
  assert.match(validateLeaveReason('"a"'), /TIDAK SAH/);
});

test('real reasons pass, with or without punctuation and numbers', () => {
  for (const r of ['Demam', 'Urusan keluarga', '"Balik kampung"', 'MC 2 hari - demam', 'Kenduri anak.']) {
    assert.strictEqual(validateLeaveReason(r), null, `should accept ${JSON.stringify(r)}`);
  }
});

test('only letters are counted', () => {
  assert.strictEqual(countReasonLetters('a-b c1!'), 3);
  assert.strictEqual(countReasonLetters('""'), 0);
});
