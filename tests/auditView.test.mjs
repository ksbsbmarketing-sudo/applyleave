import { test } from 'node:test';
import assert from 'node:assert';
import { auditCategoryKey, auditCategory, auditDevice, filterAuditLogs, auditCounts, auditTodayStats } from '../src/auditView.js';

test('every activity text written by logSystemActivity maps to a category', () => {
  const cases = {
    'Logged into system': 'login',
    'Applied for Medical Leave (MC) (1 days)': 'apply',
    'Staff edited own leave 123 (reset to PENDING)': 'apply',
    'Edited leave 123 → 2026-10-01..2026-10-02, 2 hari, status PENDING': 'apply',
    'Re-uploaded proof for leave 123 (MC)': 'apply',
    'Dikemaskini maklumat Locum untuk cuti ALI': 'apply',
    'Approved Leave (Final) for ALI': 'approve',
    'Supervisor Supported Leave (Peringkat 1) for ALI': 'approve',
    'Team Leader Supported Leave (Peringkat 0) for ALI': 'approve',
    'Approved registration: ALI (900101)': 'approve',
    'Rejected Leave for ALI': 'reject',
    'Rejected registration: ALI (900101)': 'reject',
    'Cancelled Leave for ALI': 'reject',
    'Added new staff: ALI': 'account',
    'Deleted staff record: ALI (900101)': 'account',
    'Linked Google account': 'account',
    'Unlinked Google account: ALI (900101)': 'account',
    'Updated System Profile details for ALI': 'account',
    'Staff renamed self: "A" → "B" (900101)': 'account',
    'Set AUTO "Guna Dalam Sistem" = ON (auto rekod)': 'system',
  };
  for (const [text, key] of Object.entries(cases)) assert.strictEqual(auditCategoryKey(text), key, text);
});

test('missing activity is "system", not a crash', () => {
  assert.strictEqual(auditCategoryKey(undefined), 'system');
  assert.match(auditCategory(null).svg, /<circle/);
});

test('device label from the ip field', () => {
  assert.strictEqual(auditDevice({ ip: 'Mobile/Web' }).label, 'Telefon / Web');
  assert.strictEqual(auditDevice({ ip: 'Windows Web' }).label, 'Windows Web');
  assert.strictEqual(auditDevice({}).label, 'Tidak diketahui');
});

const LOGS = [
  { name: 'ALI BIN ABU', userId: '900101', branch: 'KSB MCKIP', activity: 'Logged into system', t: 3 },
  { name: 'SITI', userId: '900202', branch: 'KSB BALOK', activity: 'Approved Leave (Final) for ALI BIN ABU', t: 2 },
  { name: 'ALI BIN ABU', userId: '900101', branch: 'KSB MCKIP', activity: 'Applied for Annual Leave (2 days)', t: 1 },
];

test('filter by category and search (name, IC, branch, activity)', () => {
  assert.strictEqual(filterAuditLogs(LOGS, { cat: 'login' }).length, 1);
  assert.strictEqual(filterAuditLogs(LOGS, { q: 'ali' }).length, 3);           // nama + teks aktiviti
  assert.strictEqual(filterAuditLogs(LOGS, { q: '900202' }).length, 1);
  assert.strictEqual(filterAuditLogs(LOGS, { q: 'balok' }).length, 1);
  assert.strictEqual(filterAuditLogs(LOGS, { cat: 'apply', q: 'ali' }).length, 1);
  assert.deepStrictEqual(filterAuditLogs(LOGS, {}).map(l => l.t), [3, 2, 1]);
  assert.deepStrictEqual(filterAuditLogs(null, {}), []);
});

test('counts per category', () => {
  const c = auditCounts(LOGS);
  assert.strictEqual(c.all, 3);
  assert.strictEqual(c.login, 1);
  assert.strictEqual(c.approve, 1);
  assert.strictEqual(c.reject, 0);
});

test('today stats only count entries since local midnight', () => {
  const now = new Date(2026, 9, 19, 12, 0).getTime();
  const msOf = (l) => l.ms;
  const list = [
    { ms: now - 3600000, userId: 'A', activity: 'Logged into system' },
    { ms: now - 7200000, userId: 'A', activity: 'Applied for MC (1 days)' },
    { ms: now - 2 * 86400000, userId: 'B', activity: 'Logged into system' },
  ];
  assert.deepStrictEqual(auditTodayStats(list, msOf, now), { events: 2, logins: 1, users: 1 });
});
