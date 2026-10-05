import { test } from 'node:test';
import assert from 'node:assert';
import { statusVariant, statusBadge, compactStatusLabel } from '../src/statusBadge.js';

test('every leave status maps to one variant', () => {
  assert.strictEqual(statusVariant('APPROVED'), 'approved');
  assert.strictEqual(statusVariant('PENDING'), 'pending');
  assert.strictEqual(statusVariant('REJECTED'), 'rejected');
  assert.strictEqual(statusVariant('CANCELLED'), 'cancelled');
  for (const s of ['HOD APPROVED', 'HOD RECOMMENDED', 'TL APPROVED']) {
    assert.strictEqual(statusVariant(s), 'progress', s);
  }
});

test('cancelled is never shown as approved (old Master Logs bug)', () => {
  assert.notStrictEqual(statusVariant('CANCELLED'), statusVariant('APPROVED'));
});

test('registration requests use lowercase statuses', () => {
  assert.strictEqual(statusVariant('approved'), 'approved');
  assert.strictEqual(statusVariant('pending'), 'pending');
  assert.strictEqual(statusVariant('rejected'), 'rejected');
});

test('unknown / empty status is neutral, not a crash', () => {
  assert.strictEqual(statusVariant(undefined), 'neutral');
  assert.strictEqual(statusVariant('WHATEVER'), 'neutral');
  assert.match(statusBadge(null), /is-neutral/);
});

test('badge html: class, compact label, custom label, escaping', () => {
  assert.strictEqual(statusBadge('APPROVED'), '<span class="status-badge is-approved">APPROVED</span>');
  assert.strictEqual(statusBadge('TL APPROVED', { compact: true }), '<span class="status-badge is-progress sm">TL OK</span>');
  assert.strictEqual(statusBadge('approved', { label: 'Diluluskan' }), '<span class="status-badge is-approved">Diluluskan</span>');
  assert.strictEqual(compactStatusLabel('HOD RECOMMENDED'), 'HOD RECOM');
  assert.match(statusBadge('<b>'), /&lt;b&gt;/);
});
