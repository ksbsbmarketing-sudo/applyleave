import { test } from 'node:test';
import assert from 'node:assert';
import { classifyToast, toastDuration } from '../src/notify.js';

test('leading emoji wins over keywords', () => {
  assert.strictEqual(classifyToast('✅ Cuti diluluskan. Notifikasi tidak dihantar.'), 'success');
  assert.strictEqual(classifyToast('❌ Kata laluan baharu tidak sepadan.'), 'error');
  assert.strictEqual(classifyToast('⚠️ Akaun anda tidak aktif.'), 'warning');
  assert.strictEqual(classifyToast('🔴 SEBAB CUTI WAJIB DIISI'), 'error');
});

test('keyword fallback', () => {
  assert.strictEqual(classifyToast('Ralat menyimpan: permission-denied'), 'error');
  assert.strictEqual(classifyToast('Gagal padam: x'), 'error');
  assert.strictEqual(classifyToast('Rekod cuti berjaya dipadam.'), 'success');
  assert.strictEqual(classifyToast('Sila masukkan kata laluan.'), 'warning');
  assert.strictEqual(classifyToast('Tiada perubahan dibuat.'), 'warning');
  assert.strictEqual(classifyToast('Hello'), 'info');
  assert.strictEqual(classifyToast(null), 'info');
});

test('longer and error messages stay longer, capped', () => {
  assert.ok(toastDuration('x'.repeat(200), 'info') > toastDuration('x', 'info'));
  assert.ok(toastDuration('x', 'error') > toastDuration('x', 'info'));
  assert.ok(toastDuration('x'.repeat(5000), 'info') <= 12000);
});

test('leading status emoji is stripped (toast icon already shows it)', async () => {
  const { stripLeadEmoji } = await import('../src/notify.js');
  assert.strictEqual(stripLeadEmoji('✅ Berjaya disimpan.'), 'Berjaya disimpan.');
  assert.strictEqual(stripLeadEmoji('⚠️ Akaun tidak aktif.'), 'Akaun tidak aktif.');
  assert.strictEqual(stripLeadEmoji('🔴 SEBAB CUTI WAJIB DIISI\n\nSila…'), 'SEBAB CUTI WAJIB DIISI\n\nSila…');
  assert.strictEqual(stripLeadEmoji('Tiada emoji ✅'), 'Tiada emoji ✅');
});
