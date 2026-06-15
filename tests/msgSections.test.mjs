import { test } from 'node:test';
import assert from 'node:assert';
import {
  loadSectionState, toggleSection, saveSectionState, isOpen,
  MSG_SECTION_DEFAULTS, MSG_SECTION_KEYS,
} from '../src/msgSections.js';

// Minimal in-memory localStorage stand-in
const memStore = (init = null) => {
  let v = init;
  return { getItem: () => v, setItem: (_k, val) => { v = val; }, _raw: () => v };
};

test('empty storage falls back to defaults (Sedang Aktif + Mesej Terus open)', () => {
  const s = loadSectionState(memStore());
  assert.deepStrictEqual(s, { online: true, branch: false, role: false, dm: true });
});

test('null storage is safe and uses defaults', () => {
  assert.deepStrictEqual(loadSectionState(null), { ...MSG_SECTION_DEFAULTS });
});

test('saved values override defaults', () => {
  const store = memStore(JSON.stringify({ branch: true, dm: false }));
  const s = loadSectionState(store);
  assert.strictEqual(s.branch, true);   // overridden
  assert.strictEqual(s.dm, false);      // overridden
  assert.strictEqual(s.online, true);   // default
  assert.strictEqual(s.role, false);    // default
});

test('invalid JSON in storage falls back to defaults', () => {
  const s = loadSectionState(memStore('{not json'));
  assert.deepStrictEqual(s, { ...MSG_SECTION_DEFAULTS });
});

test('non-boolean saved values are ignored', () => {
  const s = loadSectionState(memStore(JSON.stringify({ branch: 'yes', role: 1 })));
  assert.strictEqual(s.branch, MSG_SECTION_DEFAULTS.branch);
  assert.strictEqual(s.role, MSG_SECTION_DEFAULTS.role);
});

test('unknown keys in storage do not leak into state', () => {
  const s = loadSectionState(memStore(JSON.stringify({ bogus: true })));
  assert.deepStrictEqual(Object.keys(s).sort(), [...MSG_SECTION_KEYS].sort());
});

test('toggleSection flips one key and is immutable', () => {
  const a = { online: true, branch: false, role: false, dm: true };
  const b = toggleSection(a, 'branch');
  assert.strictEqual(b.branch, true);
  assert.strictEqual(a.branch, false); // original untouched
  assert.strictEqual(b.online, true);  // others unchanged
});

test('toggle twice returns to original value', () => {
  const a = { ...MSG_SECTION_DEFAULTS };
  const b = toggleSection(toggleSection(a, 'dm'), 'dm');
  assert.strictEqual(b.dm, a.dm);
});

test('save then load round-trips through storage', () => {
  const store = memStore();
  const state = toggleSection(loadSectionState(store), 'role'); // role -> true
  saveSectionState(store, state);
  const reloaded = loadSectionState(store);
  assert.strictEqual(reloaded.role, true);
  assert.deepStrictEqual(reloaded, state);
});

test('isOpen reads state with default fallback', () => {
  assert.strictEqual(isOpen({ branch: true }, 'branch'), true);
  assert.strictEqual(isOpen({}, 'dm'), true);     // default open
  assert.strictEqual(isOpen({}, 'branch'), false); // default closed
  assert.strictEqual(isOpen(null, 'online'), true);
});

test('saveSectionState does not throw on broken storage', () => {
  const bad = { setItem: () => { throw new Error('quota'); } };
  assert.doesNotThrow(() => saveSectionState(bad, { ...MSG_SECTION_DEFAULTS }));
});
