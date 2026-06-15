import { test } from 'node:test';
import assert from 'node:assert';
import {
  getStatusMeta, resolveStatus, isVisibleToOthers, normalizeMood,
  PRESENCE_STATUSES, DEFAULT_STATUS,
} from '../src/presenceStatus.js';

test('getStatusMeta returns the right entry and falls back to default', () => {
  assert.strictEqual(getStatusMeta('busy').label, 'Sibuk');
  assert.strictEqual(getStatusMeta('nope').id, DEFAULT_STATUS);
  assert.strictEqual(getStatusMeta(undefined).id, DEFAULT_STATUS);
});

test('there are exactly the four classic statuses', () => {
  assert.deepStrictEqual(PRESENCE_STATUSES.map(s => s.id),
    ['available', 'busy', 'away', 'invisible']);
});

test('resolveStatus defaults to available when no status field', () => {
  assert.strictEqual(resolveStatus({}).id, 'available');
  assert.strictEqual(resolveStatus({ status: 'away' }).id, 'away');
  assert.strictEqual(resolveStatus(null).id, 'available');
});

const NOW = 1_000_000_000_000;
const fresh = (extra = {}) => ({ online: true, lastSeen: NOW - 1000, ...extra });

test('a fresh, online, non-invisible doc is visible', () => {
  assert.strictEqual(isVisibleToOthers(fresh(), NOW), true);
  assert.strictEqual(isVisibleToOthers(fresh({ status: 'busy' }), NOW), true);
});

test('invisible doc is hidden from others even if online & fresh', () => {
  assert.strictEqual(isVisibleToOthers(fresh({ status: 'invisible' }), NOW), false);
});

test('stale doc (older than window) is hidden', () => {
  assert.strictEqual(isVisibleToOthers({ online: true, lastSeen: NOW - 5 * 60 * 1000 }, NOW), false);
});

test('offline / malformed docs are hidden', () => {
  assert.strictEqual(isVisibleToOthers({ online: false, lastSeen: NOW }, NOW), false);
  assert.strictEqual(isVisibleToOthers({ online: true }, NOW), false);
  assert.strictEqual(isVisibleToOthers(null, NOW), false);
});

test('normalizeMood trims, collapses whitespace, caps length', () => {
  assert.strictEqual(normalizeMood('  Tengah   on-call  '), 'Tengah on-call');
  assert.strictEqual(normalizeMood(null), '');
  assert.strictEqual(normalizeMood('x'.repeat(100)).length, 60);
});
