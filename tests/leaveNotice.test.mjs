import { test } from 'node:test';
import assert from 'node:assert';
import { getNoticeDays, isNoticeExempt } from '../src/leaveNotice.js';

// Bentuk objek staff sama seperti dokumen `staff/{ic}` sebenar.
const S = (over) => ({
  ic: '900101015555', category: 'Operation Staff', role: 'staff',
  branch: 'Klinik Syed Badaruddin Kerteh', ...over,
});

const BALOK = 'Klinik Syed Badaruddin Balok (HQ)';

// ── Staff Admin — kekal 3 hari di mana-mana ──
test('Admin Staff di cawangan: 3 hari', () => {
  assert.strictEqual(getNoticeDays(S({ category: 'Admin Staff' })), 3);
});

test('Admin Staff di Balok HQ: 3 hari', () => {
  assert.strictEqual(getNoticeDays(S({ category: 'Admin Staff', branch: BALOK })), 3);
});

test('kategori lama "Admin" dilayan sama seperti "Admin Staff"', () => {
  assert.strictEqual(getNoticeDays(S({ category: 'Admin' })), 3);
});

test('super_admin (kategori "Super Admin") kekal 7 hari — polisi ikut KATEGORI sahaja', () => {
  // Sengaja tidak diringankan: polisi 2026-08-24 hanya menyentuh Staff Operasi
  // di cawangan. Jangan tambah semakan `role` di sini tanpa arahan HR.
  assert.strictEqual(
    getNoticeDays(S({ category: 'Super Admin', role: 'super_admin', branch: 'Management / HQ' })), 7);
});

test('Admin Staff berjawatan admin di Management / HQ: 3 hari', () => {
  assert.strictEqual(
    getNoticeDays(S({ category: 'Admin Staff', role: 'admin', branch: 'Management / HQ' })), 3);
});

// ── POLISI BARU: Operation Staff di cawangan — 3 hari ──
test('Operation Staff cawangan Pahang: 3 hari', () => {
  assert.strictEqual(getNoticeDays(S({ branch: 'Klinik Syed Badaruddin Gebeng' })), 3);
});

test('Operation Staff cawangan Terengganu: 3 hari', () => {
  assert.strictEqual(getNoticeDays(S({ branch: 'Klinik Syed Badaruddin Paka' })), 3);
});

test('Operation Staff berjawatan khas (juru_xray) di cawangan: 3 hari', () => {
  assert.strictEqual(
    getNoticeDays(S({ role: 'juru_xray', branch: 'Klinik Rakyat dan X-Ray Dungun' })), 3);
});

test('Operation Staff di Utama: 3 hari — polisi ikut lokasi fizikal, bukan routing', () => {
  // Utama ialah cawangan Terengganu yang kelulusannya melalui Balok HQ
  // (ROUTES_AS_PAHANG). Routing tidak menjadikannya HQ.
  assert.strictEqual(getNoticeDays(S({ branch: 'Klinik Syed Badaruddin Utama' })), 3);
});

// ── Kekal 7 hari ──
test('Operation Staff di Balok HQ: kekal 7 hari', () => {
  assert.strictEqual(getNoticeDays(S({ branch: BALOK })), 7);
});

test('Team Leader operasi di Balok HQ: kekal 7 hari', () => {
  assert.strictEqual(getNoticeDays(S({ role: 'team_leader', branch: BALOK })), 7);
});

test('Doktor di cawangan: kekal 7 hari', () => {
  assert.strictEqual(getNoticeDays(S({ category: 'Doctor', role: 'doctor_pic' })), 7);
});

test('Doktor di Balok HQ: kekal 7 hari', () => {
  assert.strictEqual(getNoticeDays(S({ category: 'Doctor', branch: BALOK })), 7);
});

// ── Kes tepi ──
test('staff tiada / kosong: pulang 7 hari (paling ketat)', () => {
  assert.strictEqual(getNoticeDays(null), 7);
  assert.strictEqual(getNoticeDays({}), 7);
});

test('Operation Staff tanpa cawangan: 7 hari — tiada bukti dia di cawangan', () => {
  assert.strictEqual(getNoticeDays(S({ branch: '' })), 7);
});

test('kategori bercelaru ruang/huruf besar tetap dikenali', () => {
  assert.strictEqual(getNoticeDays(S({ category: '  operation staff ' })), 3);
  assert.strictEqual(getNoticeDays(S({ category: ' admin staff ', branch: BALOK })), 3);
});

// ── Pengecualian jenis cuti daripada polisi notis ──
test('HL (hospitalisasi) dikecualikan — masuk wad tidak boleh dirancang', () => {
  assert.strictEqual(isNoticeExempt('HL'), true);
});

test('jenis cuti tak boleh dirancang kekal dikecualikan', () => {
  for (const t of ['MC', 'EL_EMG', 'EL', 'CME', 'RL']) {
    assert.strictEqual(isNoticeExempt(t), true, `${t} sepatutnya dikecualikan`);
  }
});

test('AL dan UP TIDAK dikecualikan — kedua-duanya boleh dirancang awal', () => {
  assert.strictEqual(isNoticeExempt('AL'), false);
  assert.strictEqual(isNoticeExempt('UP'), false);
});

test('ML / ML_PL TIDAK dikecualikan — bersalin & paterniti boleh dirancang', () => {
  assert.strictEqual(isNoticeExempt('ML'), false);
  assert.strictEqual(isNoticeExempt('ML_PL'), false);
});

test('isNoticeExempt kebal terhadap nilai pelik', () => {
  assert.strictEqual(isNoticeExempt(''), false);
  assert.strictEqual(isNoticeExempt(null), false);
  assert.strictEqual(isNoticeExempt(undefined), false);
  assert.strictEqual(isNoticeExempt('hl'), true);   // huruf kecil tetap dikenali
  assert.strictEqual(isNoticeExempt(' HL '), true); // ruang lebih dibuang
});
