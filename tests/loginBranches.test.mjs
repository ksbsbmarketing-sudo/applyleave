import { test } from 'node:test';
import assert from 'node:assert';
import { deriveLoginBranches } from '../src/loginBranches.js';

// The hardcoded list the login page used to render on its own. It stays only as
// an ORDER HINT now — never as the source of truth.
const ORDER_HINT = [
  { name: 'Management / HQ' },
  { name: 'Klinik Syed Badaruddin Balok (HQ)' },
  { name: 'Klinik Syed Badaruddin Beserah' },
  { name: 'Uni Klinik Bentong' },
];

const dir = (...pairs) => pairs.map(([name, branch, inactive]) => ({ name, branch, inactive }));

test('the bug: a branch that exists in the directory but not in the hint still shows', () => {
  // KSBYMC was added to Firestore long after the hardcoded array was written.
  // Six real staff were stranded because the branch was never selectable.
  const out = deriveLoginBranches(dir(
    ['YUMNI RADHIAH BINTI HAMZAH', 'KSBYMC'],
    ['NUR NABILAH BINTI NARZLAN', 'KSBYMC'],
  ), ORDER_HINT);
  assert.deepStrictEqual(out, ['KSBYMC']);
});

test('known branches keep the familiar hint order, new ones are appended', () => {
  const out = deriveLoginBranches(dir(
    ['a', 'KSBYMC'],
    ['b', 'Uni Klinik Bentong'],
    ['c', 'Management / HQ'],
    ['d', 'Klinik Syed Badaruddin Balok (HQ)'],
  ), ORDER_HINT);
  assert.deepStrictEqual(out, [
    'Management / HQ',
    'Klinik Syed Badaruddin Balok (HQ)',
    'Uni Klinik Bentong',
    'KSBYMC',
  ]);
});

test('several unknown branches are appended alphabetically, not in scan order', () => {
  const out = deriveLoginBranches(dir(
    ['a', 'Zulu Klinik'],
    ['b', 'Alpha Klinik'],
    ['c', 'Management / HQ'],
  ), ORDER_HINT);
  assert.deepStrictEqual(out, ['Management / HQ', 'Alpha Klinik', 'Zulu Klinik']);
});

test('a hint branch with no staff is NOT offered — you cannot log into an empty branch', () => {
  const out = deriveLoginBranches(dir(['a', 'Management / HQ']), ORDER_HINT);
  assert.deepStrictEqual(out, ['Management / HQ']);
});

test('duplicates collapse, and the first spelling seen is the one displayed', () => {
  const out = deriveLoginBranches(dir(
    ['a', 'KSBYMC'],
    ['b', '  ksbymc  '],
    ['c', 'KSBymc'],
  ), ORDER_HINT);
  assert.deepStrictEqual(out, ['KSBYMC']);
});

test('branch matching ignores case and surrounding whitespace against the hint', () => {
  const out = deriveLoginBranches(dir(['a', '  management / hq ']), ORDER_HINT);
  assert.deepStrictEqual(out, ['Management / HQ']);
});

test('inactive staff do not keep a branch alive on their own', () => {
  const out = deriveLoginBranches(dir(
    ['gone', 'Klinik Tutup', true],
    ['here', 'Management / HQ'],
  ), ORDER_HINT);
  assert.deepStrictEqual(out, ['Management / HQ']);
});

test('but an inactive staff member does not remove a branch that still has active staff', () => {
  const out = deriveLoginBranches(dir(
    ['gone', 'KSBYMC', true],
    ['here', 'KSBYMC'],
  ), ORDER_HINT);
  assert.deepStrictEqual(out, ['KSBYMC']);
});

test('blank, missing and whitespace-only branches are ignored', () => {
  const out = deriveLoginBranches([
    { name: 'a', branch: '' },
    { name: 'b', branch: '   ' },
    { name: 'c' },
    { name: 'd', branch: null },
    { name: 'e', branch: 'Management / HQ' },
  ], ORDER_HINT);
  assert.deepStrictEqual(out, ['Management / HQ']);
});

test('empty or missing directory yields an empty list, never a crash', () => {
  assert.deepStrictEqual(deriveLoginBranches([], ORDER_HINT), []);
  assert.deepStrictEqual(deriveLoginBranches(undefined, ORDER_HINT), []);
  assert.deepStrictEqual(deriveLoginBranches(null, null), []);
});

test('junk entries in the directory are skipped without throwing', () => {
  const out = deriveLoginBranches([null, undefined, 'nonsense', 42, { branch: 'KSBYMC' }], ORDER_HINT);
  assert.deepStrictEqual(out, ['KSBYMC']);
});

test('the hint accepts plain strings as well as {name} objects', () => {
  const out = deriveLoginBranches(dir(['a', 'KSBYMC'], ['b', 'Management / HQ']),
    ['Management / HQ', 'Klinik Syed Badaruddin Beserah']);
  assert.deepStrictEqual(out, ['Management / HQ', 'KSBYMC']);
});

test('a duplicated hint entry does not duplicate the option', () => {
  const out = deriveLoginBranches(dir(['a', 'Management / HQ']),
    ['Management / HQ', 'management / hq']);
  assert.deepStrictEqual(out, ['Management / HQ']);
});

test('real shape: 13 Firestore branches, 12 in the hint, nobody stranded', () => {
  const hint = [
    'Management / HQ', 'Klinik Syed Badaruddin Balok (HQ)', 'Klinik Syed Badaruddin Beserah',
    'Klinik Syed Badaruddin Gebeng', 'Klinik Syed Badaruddin Kempadang', 'Uni Klinik Bentong',
    'Klinik Syed Badaruddin MCKIP', 'Klinik Syed Badaruddin RPCM', 'Klinik Syed Badaruddin Utama',
    'Klinik Syed Badaruddin Kerteh', 'Klinik Syed Badaruddin Paka', 'Klinik Rakyat dan X-Ray Dungun',
  ];
  const directory = hint.map((b, i) => ({ name: 'staff' + i, branch: b }))
    .concat([{ name: 'yumni', branch: 'KSBYMC' }]);
  const out = deriveLoginBranches(directory, hint);
  assert.strictEqual(out.length, 13);
  assert.deepStrictEqual(out.slice(0, 12), hint);
  assert.strictEqual(out[12], 'KSBYMC');
});
