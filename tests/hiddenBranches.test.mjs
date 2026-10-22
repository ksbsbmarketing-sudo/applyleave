import { test } from 'node:test';
import assert from 'node:assert';
import { isHiddenBranch, canSeeHiddenBranches, filterHiddenBranches } from '../src/hiddenBranches.js';

const rows = [
  { name: 'A', branch: 'Management / HQ' },
  { name: 'Reviewer', branch: 'DEMO' },
  { name: 'B', branch: ' demo ' },
];

test('isHiddenBranch ignores case and whitespace', () => {
  assert.equal(isHiddenBranch('DEMO'), true);
  assert.equal(isHiddenBranch(' demo '), true);
  assert.equal(isHiddenBranch('Management / HQ'), false);
  assert.equal(isHiddenBranch(undefined), false);
});

test('only admin, super_admin and DEMO staff can see hidden branches', () => {
  assert.equal(canSeeHiddenBranches({ role: 'admin', branch: 'X' }), true);
  assert.equal(canSeeHiddenBranches({ role: 'super_admin', branch: 'X' }), true);
  assert.equal(canSeeHiddenBranches({ role: 'staff', branch: 'DEMO' }), true);
  assert.equal(canSeeHiddenBranches({ role: 'hr', branch: 'Management / HQ' }), false);
  assert.equal(canSeeHiddenBranches(null), false);
});

test('filterHiddenBranches removes DEMO rows for HR, keeps them for admin', () => {
  assert.deepEqual(filterHiddenBranches(rows, { role: 'hr', branch: 'Management / HQ' }).map(r => r.name), ['A']);
  assert.equal(filterHiddenBranches(rows, { role: 'super_admin' }).length, 3);
});

test('filterHiddenBranches can filter branch docs by name', () => {
  const branches = [{ name: 'DEMO' }, { name: 'Uni Klinik Bentong' }];
  assert.deepEqual(filterHiddenBranches(branches, { role: 'hr' }, 'name'), [{ name: 'Uni Klinik Bentong' }]);
});

test('filterHiddenBranches tolerates bad input', () => {
  assert.deepEqual(filterHiddenBranches(null, { role: 'hr' }), []);
  assert.deepEqual(filterHiddenBranches([null, { branch: 'X' }], { role: 'hr' }), [null, { branch: 'X' }]);
});
