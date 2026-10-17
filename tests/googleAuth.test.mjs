import { test } from 'node:test';
import assert from 'node:assert';
import { googleIdentityOf, googleErrorMessage } from '../src/googleAuth.js';

test('googleIdentityOf picks the google.com provider', () => {
  const user = { providerData: [
    { providerId: 'password', uid: 'S1@ksb-leave.local' },
    { providerId: 'google.com', uid: '1234567890', email: 'ali@gmail.com', displayName: 'Ali Abu' },
  ] };
  assert.deepStrictEqual(googleIdentityOf(user), { sub: '1234567890', email: 'ali@gmail.com', displayName: 'Ali Abu' });
});

test('googleIdentityOf is null when not linked or no user', () => {
  assert.strictEqual(googleIdentityOf({ providerData: [{ providerId: 'password' }] }), null);
  assert.strictEqual(googleIdentityOf(null), null);
});

test('googleErrorMessage: user-cancelled popups are silent', () => {
  assert.strictEqual(googleErrorMessage('auth/popup-closed-by-user'), null);
  assert.strictEqual(googleErrorMessage('auth/cancelled-popup-request'), null);
  assert.strictEqual(googleErrorMessage('auth/user-cancelled'), null);
});

test('googleErrorMessage: known codes get Malay messages', () => {
  assert.match(googleErrorMessage('auth/credential-already-in-use'), /sudah digunakan/);
  assert.match(googleErrorMessage('auth/network-request-failed'), /internet/i);
  assert.match(googleErrorMessage('auth/user-disabled'), /tidak aktif/);
});

test('googleErrorMessage: unknown code gets a generic message with the code', () => {
  assert.match(googleErrorMessage('auth/weird'), /auth\/weird/);
});
