import { test } from 'node:test';
import assert from 'node:assert';
import { emptyState, emptyRow, dashboardSkeleton } from '../src/uiStates.js';

test('empty state renders title, text and escapes them', () => {
  const html = emptyState({ icon: 'check', title: 'Tiada <b>', text: 'Semua "selesai"' });
  assert.match(html, /class="empty-state"/);
  assert.match(html, /Tiada &lt;b&gt;/);
  assert.match(html, /Semua &quot;selesai&quot;/);
  assert.doesNotMatch(html, /empty-state-action/);
});

test('action button only when given', () => {
  const html = emptyState({ title: 'x', action: { label: 'Mohon Cuti', onclick: "window.setView('leave-form')" } });
  assert.match(html, /empty-state-action/);
  assert.match(html, /Mohon Cuti/);
});

test('unknown icon falls back instead of rendering nothing', () => {
  assert.match(emptyState({ icon: 'nope' }), /<svg/);
});

test('emptyRow spans the table and is compact', () => {
  const html = emptyRow(6, { title: 'Tiada rekod' });
  assert.match(html, /^<tr><td colspan="6"/);
  assert.match(html, /empty-state compact/);
});

test('skeleton is marked busy for screen readers', () => {
  assert.match(dashboardSkeleton(), /aria-busy="true"/);
});

import { userAvatar } from '../src/uiStates.js';

test('userAvatar: tunjuk gambar profil jika staf ada photoUrl', () => {
  const html = userAvatar({ name: 'ADILAH BINTI HASSAN', photoUrl: 'https://res.cloudinary.com/x/p.jpg' });
  assert.match(html, /<img src="https:\/\/res\.cloudinary\.com\/x\/p\.jpg"/);
  assert.match(html, /alt="ADILAH BINTI HASSAN"/);
  // huruf awal kekal di bawah gambar sebagai sandaran jika gambar gagal dimuat
  assert.match(html, />A</);
});

test('userAvatar: tanpa gambar → huruf pertama nama sahaja', () => {
  const html = userAvatar({ name: 'siti' });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /class="user-avatar"[^>]*>S</);
  assert.match(userAvatar({}), />\?</);
});

test('userAvatar: URL dan nama di-escape', () => {
  const html = userAvatar({ name: 'A"><b>', photoUrl: 'https://x/"onerror="alert(1)' });
  assert.doesNotMatch(html, /"onerror="alert/);
  assert.doesNotMatch(html, /<b>/);
});

test('userAvatar: saiz besar menambah kelas is-lg', () => {
  assert.match(userAvatar({ name: 'ADILAH' }, { large: true }), /class="user-avatar is-lg"/);
  assert.match(userAvatar({ name: 'ADILAH' }), /class="user-avatar"/);
});
