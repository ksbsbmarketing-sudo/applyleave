import { test } from 'node:test';
import assert from 'node:assert';
import { notifyChannelOf, wantsWhatsApp, isValidEmail, needsNotifySetup } from '../src/notifyPrefs.js';

test('notifyChannelOf defaults to both for missing or unknown values', () => {
  assert.equal(notifyChannelOf({}), 'both');
  assert.equal(notifyChannelOf(null), 'both');
  assert.equal(notifyChannelOf({ notifyChannel: 'sms' }), 'both');
  assert.equal(notifyChannelOf({ notifyChannel: 'email' }), 'email');
  assert.equal(notifyChannelOf({ notifyChannel: 'whatsapp' }), 'whatsapp');
});

test('wantsWhatsApp: off only for email-only staff who have a valid email', () => {
  assert.equal(wantsWhatsApp({ notifyChannel: 'both', email: 'a@b.com' }), true);
  assert.equal(wantsWhatsApp({ notifyChannel: 'whatsapp' }), true);
  assert.equal(wantsWhatsApp({ notifyChannel: 'email', email: 'a@b.com' }), false);
  assert.equal(wantsWhatsApp({ notifyChannel: 'email', email: '' }), true);
  assert.equal(wantsWhatsApp({ notifyChannel: 'email', email: 'bukan-email' }), true);
  assert.equal(wantsWhatsApp(undefined), true);
});

test('isValidEmail', () => {
  assert.equal(isValidEmail('kliniksyed.it@gmail.com'), true);
  assert.equal(isValidEmail(' a@b.co '), true);
  for (const bad of ['', 'a@b', 'a b@c.com', '@b.com', null]) assert.equal(isValidEmail(bad), false);
});

test('needsNotifySetup: needs a valid email AND an explicit channel choice', () => {
  assert.equal(needsNotifySetup({ email: 'a@b.com', notifyChannel: 'both' }), false);
  assert.equal(needsNotifySetup({ email: 'a@b.com', notifyChannel: 'whatsapp' }), false);
  assert.equal(needsNotifySetup({ email: 'a@b.com' }), true);
  assert.equal(needsNotifySetup({ email: '', notifyChannel: 'email' }), true);
  assert.equal(needsNotifySetup({ email: 'bukan', notifyChannel: 'both' }), true);
  assert.equal(needsNotifySetup(null), false);
});
