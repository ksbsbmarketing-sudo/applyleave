import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchStaff } from '../src/staffSearch.js';

const staff = [
  { ic: '900701115518', name: 'NURUL AIN BINTI ALI', branch: 'Kerteh' },
  { ic: '950607035242', name: 'NUR HAZWANIE BT IBRAHIM', branch: 'Paka' },
  { ic: '880101015555', name: 'AHMAD BIN NURDIN', branch: 'Kerteh' },
];

test('kosong → tiada hasil', () => {
  assert.deepEqual(searchStaff(staff, ''), []);
  assert.deepEqual(searchStaff(staff, '   '), []);
});

test('padan sebahagian nama, tidak peka huruf besar', () => {
  assert.deepEqual(searchStaff(staff, 'hazwan').map(s => s.ic), ['950607035242']);
});

test('nama yang bermula dengan carian disenarai dahulu', () => {
  assert.deepEqual(searchStaff(staff, 'nur').map(s => s.ic), ['950607035242', '900701115518', '880101015555']);
});

test('padan semua perkataan, ikut apa-apa susunan', () => {
  assert.deepEqual(searchStaff(staff, 'ali nurul').map(s => s.ic), ['900701115518']);
});

test('padan IC walaupun ditaip dengan sengkang', () => {
  assert.deepEqual(searchStaff(staff, '950607-03').map(s => s.ic), ['950607035242']);
});

test('tapis ikut cawangan', () => {
  assert.deepEqual(searchStaff(staff, 'nur', { branch: 'Kerteh' }).map(s => s.ic), ['900701115518', '880101015555']);
  assert.deepEqual(searchStaff(staff, 'nur', { branch: 'SEMUA' }).length, 3);
});

test('had bilangan hasil', () => {
  assert.equal(searchStaff(staff, 'n', { limit: 2 }).length, 2);
});
