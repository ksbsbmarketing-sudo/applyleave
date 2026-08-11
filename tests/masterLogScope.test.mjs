import { test } from 'node:test';
import assert from 'node:assert';
import {
  ALL, NO_BRANCH, visibleStates, branchOptions, filterByScope,
} from '../src/masterLogScope.js';

// Mirrors the real branch collection closely enough to be meaningful. Utama's
// `state` is Terengganu but it routes through Balok HQ, so the resolver below
// reports it as Pahang — exactly like window.scopeStateOfBranch in main.js.
const BRANCHES = [
  { name: 'Klinik Syed Badaruddin Balok (HQ)', state: 'Pahang' },
  { name: 'Klinik Syed Badaruddin Beserah',    state: 'Pahang' },
  { name: 'Klinik Syed Badaruddin Utama',      state: 'Terengganu' },
  { name: 'Klinik Syed Badaruddin Kerteh',     state: 'Terengganu' },
  { name: 'Klinik Rakyat dan X-Ray Dungun',    state: 'Terengganu' },
];

const ROUTES_AS_PAHANG = ['Klinik Syed Badaruddin Utama'];
const stateOfBranch = (name) => {
  if (ROUTES_AS_PAHANG.includes(name)) return 'Pahang';
  const b = BRANCHES.find(x => x.name === name);
  return b ? b.state : null;
};

const RECORDS = [
  { id: 1, branch: 'Klinik Syed Badaruddin Balok (HQ)' },
  { id: 2, branch: 'Klinik Syed Badaruddin Beserah' },
  { id: 3, branch: 'Klinik Syed Badaruddin Utama' },
  { id: 4, branch: 'Klinik Syed Badaruddin Kerteh' },
  { id: 5, branch: 'Klinik Rakyat dan X-Ray Dungun' },
  { id: 6, branch: 'Klinik Yang Sudah Ditutup' },   // stranded: not in BRANCHES
];

const ids = (recs) => recs.map(r => r.id).sort((a, b) => a - b);
const run = (opts) => filterByScope(RECORDS, { stateOfBranch, ...opts });

// ── The zone boundary ─────────────────────────────────────────────────
test('Utama belongs to the Pahang zone, not Terengganu', () => {
  // The decision this whole feature turns on: the split follows who MANAGES
  // a branch, not where the building is.
  assert.deepStrictEqual(ids(run({ userScope: 'Pahang' })), [1, 2, 3]);
});

test('a Pahang HR never receives a Terengganu record', () => {
  const got = run({ userScope: 'Pahang' });
  assert.ok(got.every(r => ![4, 5].includes(r.id)), 'Kerteh/Dungun leaked to Pahang');
});

test('a Terengganu HR never receives a Pahang record, and never sees Utama', () => {
  assert.deepStrictEqual(ids(run({ userScope: 'Terengganu' })), [4, 5]);
});

test('the zone filter does not trust the state tab — the tab cannot widen scope', () => {
  // A Pahang HR asking for Terengganu gets nothing, NOT Terengganu's records.
  assert.deepStrictEqual(run({ userScope: 'Pahang', state: 'Terengganu' }), []);
  assert.deepStrictEqual(run({ userScope: 'Terengganu', state: 'Pahang' }), []);
});

test('the zone filter does not trust the branch tab either', () => {
  assert.deepStrictEqual(
    run({ userScope: 'Pahang', branch: 'Klinik Syed Badaruddin Kerteh' }), []);
});

test('admin sees both zones', () => {
  assert.deepStrictEqual(ids(run({ userScope: 'all' })), [1, 2, 3, 4, 5, 6]);
});

test('an unresolvable scope sees nothing — fail closed', () => {
  assert.deepStrictEqual(run({ userScope: null }), []);
  assert.deepStrictEqual(run({ userScope: undefined }), []);
});

// ── Tab narrowing, on top of the zone ─────────────────────────────────
test('the state tab narrows an admin to one zone', () => {
  assert.deepStrictEqual(ids(run({ userScope: 'all', state: 'Pahang' })), [1, 2, 3]);
  assert.deepStrictEqual(ids(run({ userScope: 'all', state: 'Terengganu' })), [4, 5]);
});

test('the branch tab narrows to one branch', () => {
  assert.deepStrictEqual(
    ids(run({ userScope: 'all', state: 'Pahang', branch: 'Klinik Syed Badaruddin Beserah' })),
    [2]);
});

test('omitted state and branch default to ALL', () => {
  assert.deepStrictEqual(
    ids(run({ userScope: 'Terengganu' })),
    ids(run({ userScope: 'Terengganu', state: ALL, branch: ALL })));
});

// ── Stranded records ──────────────────────────────────────────────────
test('a stranded record is hidden from both HRs', () => {
  assert.ok(!ids(run({ userScope: 'Pahang' })).includes(6));
  assert.ok(!ids(run({ userScope: 'Terengganu' })).includes(6));
});

test('a stranded record reaches admin via SEMUA and via the Lain-lain tab', () => {
  assert.ok(ids(run({ userScope: 'all', state: ALL, branch: ALL })).includes(6));
  assert.deepStrictEqual(ids(run({ userScope: 'all', state: ALL, branch: NO_BRANCH })), [6]);
});

test('a stranded record does not appear under a named state — it has no state', () => {
  assert.ok(!ids(run({ userScope: 'all', state: 'Pahang' })).includes(6));
  assert.ok(!ids(run({ userScope: 'all', state: 'Terengganu' })).includes(6));
});

test('the Lain-lain tab shows ONLY stranded records, never real ones', () => {
  const got = run({ userScope: 'all', state: ALL, branch: NO_BRANCH });
  assert.ok(got.every(r => r.id === 6));
});

// ── Branches in a state outside any HR's zone (not stranded — the branch
// exists and resolves to a real state, it just has no owning HR zone) ─────
const BRANCHES_WITH_THIRD_STATE = [
  ...BRANCHES,
  { name: 'Klinik Kelantan', state: 'Kelantan' },
];
const stateOfBranchWithThirdState = (name) => {
  if (ROUTES_AS_PAHANG.includes(name)) return 'Pahang';
  const b = BRANCHES_WITH_THIRD_STATE.find(x => x.name === name);
  return b ? b.state : null;
};
const RECORDS_WITH_THIRD_STATE = [
  ...RECORDS,
  { id: 7, branch: 'Klinik Kelantan' },
];
const runThird = (opts) => filterByScope(RECORDS_WITH_THIRD_STATE, { stateOfBranch: stateOfBranchWithThirdState, ...opts });

test('a branch outside any zone (e.g. a new Kelantan branch) reaches admin via SEMUA and via Lain-lain', () => {
  assert.ok(ids(runThird({ userScope: 'all', state: ALL, branch: ALL })).includes(7));
  assert.deepStrictEqual(ids(runThird({ userScope: 'all', state: ALL, branch: NO_BRANCH })), [6, 7]);
});

test('a branch outside any zone is hidden from both the Pahang HR and the Terengganu HR', () => {
  assert.ok(!ids(runThird({ userScope: 'Pahang' })).includes(7));
  assert.ok(!ids(runThird({ userScope: 'Terengganu' })).includes(7));
});

test('a branch outside any zone does not appear under the named Pahang or Terengganu state tabs', () => {
  assert.ok(!ids(runThird({ userScope: 'all', state: 'Pahang' })).includes(7));
  assert.ok(!ids(runThird({ userScope: 'all', state: 'Terengganu' })).includes(7));
});

test('a branch outside any zone does not appear in branchOptions for any scope', () => {
  assert.ok(!branchOptions(BRANCHES_WITH_THIRD_STATE, { userScope: 'all', state: ALL, stateOfBranch: stateOfBranchWithThirdState }).includes('Klinik Kelantan'));
  assert.ok(!branchOptions(BRANCHES_WITH_THIRD_STATE, { userScope: 'Pahang', state: ALL, stateOfBranch: stateOfBranchWithThirdState }).includes('Klinik Kelantan'));
  assert.ok(!branchOptions(BRANCHES_WITH_THIRD_STATE, { userScope: 'Terengganu', state: ALL, stateOfBranch: stateOfBranchWithThirdState }).includes('Klinik Kelantan'));
});

// ── visibleStates ─────────────────────────────────────────────────────
test('visibleStates: admin gets both, an HR gets only their own, null gets none', () => {
  assert.deepStrictEqual(visibleStates('all'), ['Pahang', 'Terengganu']);
  assert.deepStrictEqual(visibleStates('Pahang'), ['Pahang']);
  assert.deepStrictEqual(visibleStates('Terengganu'), ['Terengganu']);
  assert.deepStrictEqual(visibleStates(null), []);
});

test('visibleStates never returns the ALL sentinel — the caller renders that tab', () => {
  assert.ok(!visibleStates('all').includes(ALL));
});

// ── branchOptions ─────────────────────────────────────────────────────
test('branchOptions returns only in-zone branches', () => {
  assert.deepStrictEqual(
    branchOptions(BRANCHES, { userScope: 'Terengganu', state: ALL, stateOfBranch }),
    ['Klinik Syed Badaruddin Kerteh', 'Klinik Rakyat dan X-Ray Dungun']);
});

test('branchOptions puts Utama in the Pahang list', () => {
  const got = branchOptions(BRANCHES, { userScope: 'Pahang', state: ALL, stateOfBranch });
  assert.ok(got.includes('Klinik Syed Badaruddin Utama'));
});

test('branchOptions narrows to the selected state for an admin', () => {
  assert.deepStrictEqual(
    branchOptions(BRANCHES, { userScope: 'all', state: 'Terengganu', stateOfBranch }),
    ['Klinik Syed Badaruddin Kerteh', 'Klinik Rakyat dan X-Ray Dungun']);
});

test('branchOptions survives an empty or missing branch list — first paint', () => {
  // Firestore has not delivered `branches` yet. Must not throw.
  assert.deepStrictEqual(branchOptions([], { userScope: 'all', state: ALL, stateOfBranch }), []);
  assert.deepStrictEqual(branchOptions(undefined, { userScope: 'all', state: ALL, stateOfBranch }), []);
});

test('branchOptions returns nothing for an unresolvable scope', () => {
  assert.deepStrictEqual(branchOptions(BRANCHES, { userScope: null, state: ALL, stateOfBranch }), []);
});

// ── Robustness ────────────────────────────────────────────────────────
test('a missing record list does not throw', () => {
  assert.deepStrictEqual(filterByScope(undefined, { userScope: 'all', stateOfBranch }), []);
});

test('a record with no branch field is treated as stranded, not as a crash', () => {
  const odd = [{ id: 9 }, { id: 10, branch: '' }];
  assert.deepStrictEqual(filterByScope(odd, { userScope: 'Pahang', stateOfBranch }), []);
  assert.strictEqual(filterByScope(odd, { userScope: 'all', stateOfBranch }).length, 2);
});
