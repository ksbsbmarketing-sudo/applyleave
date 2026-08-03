import { test } from 'node:test';
import assert from 'node:assert';
import { formatPersonName } from '../src/nameFormat.js';

test('lowercase becomes ALL CAPS', () => {
  assert.strictEqual(
    formatPersonName('zahirah dahria binti mohamed basri'),
    'ZAHIRAH DAHRIA BINTI MOHAMED BASRI'
  );
});

test('mixed / title case becomes ALL CAPS', () => {
  assert.strictEqual(
    formatPersonName('Zahirah Dahria Binti Mohamed Basri'),
    'ZAHIRAH DAHRIA BINTI MOHAMED BASRI'
  );
});

test('already ALL CAPS is left alone', () => {
  assert.strictEqual(
    formatPersonName('MUHAMMAD LUKHMAN BIN ISMAIL'),
    'MUHAMMAD LUKHMAN BIN ISMAIL'
  );
});

test('@ segments survive', () => {
  assert.strictEqual(
    formatPersonName('mohd akmal bin seman @ abd jabar'),
    'MOHD AKMAL BIN SEMAN @ ABD JABAR'
  );
});

test('hyphens and apostrophes survive', () => {
  assert.strictEqual(formatPersonName("abd-rahman d'cruz"), "ABD-RAHMAN D'CRUZ");
});

test('a/p, a/l, s/o, d/o stay uppercase', () => {
  assert.strictEqual(formatPersonName('siti a/p ramasamy'), 'SITI A/P RAMASAMY');
  assert.strictEqual(formatPersonName('raj a/l muthu'), 'RAJ A/L MUTHU');
});

test('extra whitespace is collapsed and trimmed', () => {
  assert.strictEqual(
    formatPersonName('  yumni   radhiah  binti   hamzah  '),
    'YUMNI RADHIAH BINTI HAMZAH'
  );
});

test('empty and nullish inputs give an empty string', () => {
  assert.strictEqual(formatPersonName(''), '');
  assert.strictEqual(formatPersonName('   '), '');
  assert.strictEqual(formatPersonName(null), '');
  assert.strictEqual(formatPersonName(undefined), '');
});

test('digits are preserved', () => {
  assert.strictEqual(formatPersonName('staff 2 bin ali'), 'STAFF 2 BIN ALI');
});
