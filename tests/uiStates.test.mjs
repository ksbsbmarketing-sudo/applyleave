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
