import { test } from 'node:test';
import assert from 'node:assert';
import { relativeTime, groupNotifs, filterNotifs, notifKind } from '../src/inboxView.js';

// Rabu 7 Okt 2026, 15:00 waktu tempatan
const NOW = new Date(2026, 9, 7, 15, 0).getTime();
const at = (d, h, m = 0) => new Date(2026, 9, d, h, m).getTime();

test('relativeTime: minit dan jam pada hari yang sama', () => {
  assert.strictEqual(relativeTime(NOW - 20 * 1000, NOW), 'Baru tadi');
  assert.strictEqual(relativeTime(NOW - 5 * 60 * 1000, NOW), '5 minit lalu');
  assert.strictEqual(relativeTime(at(7, 13), NOW), '2 jam lalu');
});

test('relativeTime: semalam, minggu ini, lebih lama', () => {
  assert.strictEqual(relativeTime(at(6, 16, 20), NOW), 'Semalam 16:20');
  assert.strictEqual(relativeTime(at(4, 9, 5), NOW), 'Ahd 09:05');
  assert.strictEqual(relativeTime(at(12, 9) - 30 * 86400000, NOW), '12 Sep');
  assert.strictEqual(relativeTime(new Date(2025, 11, 3).getTime(), NOW), '3 Dis 2025');
});

test('groupNotifs: ikut Hari Ini / Semalam / Minggu Ini / Lebih Awal, kumpulan kosong dibuang', () => {
  const list = [
    { id: 'a', createdAt: at(7, 9) },
    { id: 'b', createdAt: at(6, 23) },
    { id: 'c', createdAt: at(3, 10) },
    { id: 'd', createdAt: at(1, 10) - 86400000 * 20 },
  ];
  const g = groupNotifs(list, NOW);
  assert.deepStrictEqual(g.map(x => x.label), ['Hari Ini', 'Semalam', 'Minggu Ini', 'Lebih Awal']);
  assert.deepStrictEqual(g.map(x => x.items.map(i => i.id)), [['a'], ['b'], ['c'], ['d']]);
  assert.deepStrictEqual(groupNotifs([{ id: 'x', createdAt: at(7, 1) }], NOW).map(x => x.label), ['Hari Ini']);
});

test('filterNotifs: semua vs belum baca', () => {
  const list = [{ id: 1, read: true }, { id: 2, read: false }];
  assert.strictEqual(filterNotifs(list, 'all').length, 2);
  assert.deepStrictEqual(filterNotifs(list, 'unread').map(n => n.id), [2]);
});

test('notifKind: jenis dipetakan ke ikon/tona, jenis tak dikenali → system', () => {
  assert.strictEqual(notifKind('leave_approved').tone, 'ok');
  assert.strictEqual(notifKind('leave_rejected').tone, 'bad');
  assert.strictEqual(notifKind('leave_to_approve').tone, 'action');
  assert.strictEqual(notifKind('apa_ni').tone, 'muted');
});

// ── Gaya emel: pengirim, avatar, subjek, masa penuh ──
import { notifSender, senderInitials, cleanSubject, fullTime } from '../src/inboxView.js';

test('notifSender: guna medan pengirim jika ada', () => {
  assert.deepStrictEqual(
    notifSender({ senderName: 'SITI NORIDAH BINTI ZAKARIA', senderRole: 'HR' }),
    { name: 'SITI NORIDAH BINTI ZAKARIA', role: 'HR', system: false });
});

test('notifSender: notifikasi lama tanpa pengirim → Sistem Cuti KSB', () => {
  assert.deepStrictEqual(notifSender({ title: 'x' }), { name: 'Sistem Cuti KSB', role: '', system: true });
  assert.deepStrictEqual(notifSender({ senderName: '   ' }), { name: 'Sistem Cuti KSB', role: '', system: true });
});

test('senderInitials: dua huruf awal, langkau BIN/BINTI/A/L/A/P', () => {
  assert.strictEqual(senderInitials('MUHAMMAD LUKHMAN BIN ISMAIL'), 'ML');
  assert.strictEqual(senderInitials('SITI NORIDAH BINTI ZAKARIA'), 'SN');
  assert.strictEqual(senderInitials('RAVI A/L KUMAR'), 'RK');
  assert.strictEqual(senderInitials('adilah'), 'A');
  assert.strictEqual(senderInitials(''), '?');
});

test('cleanSubject: buang emoji di depan, kekalkan [TEST]', () => {
  assert.strictEqual(cleanSubject('✅ Cuti Diluluskan!'), 'Cuti Diluluskan!');
  assert.strictEqual(cleanSubject('🗂️ Rekod Kelulusan'), 'Rekod Kelulusan');
  assert.strictEqual(cleanSubject('🧪 [TEST] 📋 Permohonan Cuti Dihantar'), '[TEST] Permohonan Cuti Dihantar');
  assert.strictEqual(cleanSubject('Tanpa emoji'), 'Tanpa emoji');
  assert.strictEqual(cleanSubject(undefined), '');
});

test('fullTime: hari, tarikh penuh dan masa', () => {
  assert.strictEqual(fullTime(at(7, 9, 5)), 'Rab, 7 Okt 2026 · 09:05');
});
