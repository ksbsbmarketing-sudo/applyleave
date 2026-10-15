import { test } from 'node:test';
import assert from 'node:assert';
import { sortMyRecords, statusTextMs, approvedDaysByType } from '../src/myLeaveReport.js';

test('sortMyRecords: terbaru dahulu ikut tarikh mula, tidak ubah senarai asal', () => {
  const recs = [
    { id: 1, startDate: '2026-06-01' },
    { id: 2, startDate: '2026-10-20' },
    { id: 3, startDate: '2026-08-05' },
  ];
  assert.deepStrictEqual(sortMyRecords(recs).map(r => r.id), [2, 3, 1]);
  assert.deepStrictEqual(recs.map(r => r.id), [1, 2, 3]);
});

test('sortMyRecords: tarikh sama → permohonan terkini (id) dahulu', () => {
  const recs = [{ id: 10, startDate: '2026-06-01' }, { id: 20, startDate: '2026-06-01' }];
  assert.deepStrictEqual(sortMyRecords(recs).map(r => r.id), [20, 10]);
});

test('statusTextMs: label Bahasa Melayu bagi setiap status', () => {
  assert.strictEqual(statusTextMs('APPROVED'), 'Diluluskan');
  assert.strictEqual(statusTextMs('PENDING'), 'Menunggu');
  assert.strictEqual(statusTextMs('TL APPROVED'), 'Disokong TL');
  assert.strictEqual(statusTextMs('HOD APPROVED'), 'Disokong Peringkat 1');
  assert.strictEqual(statusTextMs('REJECTED'), 'Ditolak');
  assert.strictEqual(statusTextMs('CANCELLED'), 'Dibatalkan');
  assert.strictEqual(statusTextMs('ODD'), 'ODD');
});

test('approvedDaysByType: jumlah hari diluluskan sahaja, terbanyak dahulu', () => {
  const recs = [
    { type: 'AL', days: 2, status: 'APPROVED' },
    { type: 'MC', days: 1, status: 'APPROVED' },
    { type: 'AL', days: 0.5, status: 'APPROVED' },
    { type: 'AL', days: 3, status: 'REJECTED' },
    { type: 'EL', days: '1', status: 'APPROVED' },
  ];
  assert.deepStrictEqual(approvedDaysByType(recs), [['AL', 2.5], ['EL', 1], ['MC', 1]]);
});

import { shortReason } from '../src/myLeaveReport.js';

test('shortReason: sebab panjang dipendekkan dengan …, ruang berlebihan dibuang', () => {
  assert.strictEqual(shortReason('Urusan  keluarga\n'), 'Urusan keluarga');
  const long = 'CME ACCS XI '.repeat(20);
  const out = shortReason(long, 40);
  assert.ok(out.length <= 40, out.length);
  assert.ok(out.endsWith('…'));
  assert.strictEqual(shortReason(''), '—');
  assert.strictEqual(shortReason(undefined), '—');
});
