import { test } from 'node:test';
import assert from 'node:assert';
import { applyEmoticons } from '../src/emoticons.js';

test('basic smileys convert at word boundaries', () => {
  assert.strictEqual(applyEmoticons('hello :)'), 'hello 🙂');
  assert.strictEqual(applyEmoticons('haha :D yes'), 'haha 😄 yes');
  assert.strictEqual(applyEmoticons('wink ;) ok'), 'wink 😉 ok');
  assert.strictEqual(applyEmoticons('sad :( now'), 'sad 🙁 now');
});

test('<3 converts even though < is HTML-special (runs pre-escape)', () => {
  assert.strictEqual(applyEmoticons('I <3 you'), 'I ❤️ you');
});

test('start and end of string boundaries work', () => {
  assert.strictEqual(applyEmoticons(':) hi'), '🙂 hi');
  assert.strictEqual(applyEmoticons('bye :)'), 'bye 🙂');
});

test('sentence punctuation right after the emoticon still converts', () => {
  assert.strictEqual(applyEmoticons('great :).'), 'great 🙂.');
  assert.strictEqual(applyEmoticons('really :)!'), 'really 🙂!');
});

test('longer token wins over shorter (:-) not :))', () => {
  assert.strictEqual(applyEmoticons('yo :-)'), 'yo 🙂');
});

test('does NOT convert when glued inside a word', () => {
  assert.strictEqual(applyEmoticons('http://x'), 'http://x');
  assert.strictEqual(applyEmoticons('option B) text'), 'option B) text'); // B) not in set
  assert.strictEqual(applyEmoticons('a:)b'), 'a:)b'); // no boundary
});

test('multiple emoticons in one message', () => {
  assert.strictEqual(applyEmoticons(':) :D ;)'), '🙂 😄 😉');
});

test('empty / null safe', () => {
  assert.strictEqual(applyEmoticons(''), '');
  assert.strictEqual(applyEmoticons(null), '');
  assert.strictEqual(applyEmoticons(undefined), '');
});

test('plain text without emoticons is unchanged', () => {
  assert.strictEqual(applyEmoticons('Salam, jumpa esok pukul 9'), 'Salam, jumpa esok pukul 9');
});
