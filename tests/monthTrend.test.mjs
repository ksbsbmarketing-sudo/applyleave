import { test } from 'node:test';
import assert from 'node:assert';
import { trendWindow } from '../src/monthTrend.js';

const NOW = new Date(2026, 9, 15); // 15 Okt 2026
const counts = [0, 0, 0, 0, 4, 44, 48, 99, 126, 110, 0, 0];

test('tahun semasa: mula bulan pertama ada data, tamat bulan semasa (separa)', () => {
  assert.deepStrictEqual(trendWindow(counts, { year: '2026', selected: 0, now: NOW }),
    { start: 4, end: 9, partial: 9 });
});

test('tahun lepas: tamat Dis, tiada bulan separa', () => {
  assert.deepStrictEqual(trendWindow(counts, { year: '2025', selected: 0, now: NOW }),
    { start: 4, end: 11, partial: -1 });
});

test('Semua Tahun: Jan–Dis dipangkas ke bulan pertama ada data', () => {
  assert.deepStrictEqual(trendWindow(counts, { year: 'SEMUA', selected: 0, now: NOW }),
    { start: 4, end: 11, partial: -1 });
});

test('bulan dipilih di luar julat → julat dilebarkan', () => {
  assert.deepStrictEqual(trendWindow(counts, { year: '2026', selected: 2, now: NOW }),
    { start: 1, end: 9, partial: 9 });
});

test('tiada data langsung: tahun semasa Jan → bulan semasa', () => {
  assert.deepStrictEqual(trendWindow(Array(12).fill(0), { year: '2026', selected: 0, now: NOW }),
    { start: 0, end: 9, partial: 9 });
});
