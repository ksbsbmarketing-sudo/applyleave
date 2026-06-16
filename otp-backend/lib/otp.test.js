// Tests for the pure OTP logic. Run: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateOtp, makeSalt, hashOtp, normalizeMyPhone, maskPhone,
  canSend, recordSend, verifyOtp,
  OTP_TTL_MS, MAX_ATTEMPTS, RESEND_COOLDOWN_MS, MAX_SENDS_PER_WINDOW,
} from "./otp.js";

test("generateOtp is always a 6-digit string", () => {
  for (let i = 0; i < 1000; i++) {
    const otp = generateOtp();
    assert.match(otp, /^\d{6}$/);
  }
});

test("hashOtp is deterministic and salt-dependent", () => {
  const s1 = makeSalt(), s2 = makeSalt();
  assert.equal(hashOtp("123456", s1), hashOtp("123456", s1));
  assert.notEqual(hashOtp("123456", s1), hashOtp("123456", s2));
  assert.notEqual(hashOtp("123456", s1), hashOtp("654321", s1));
  assert.doesNotMatch(hashOtp("123456", s1), /123456/); // never stores plaintext
});

test("normalizeMyPhone handles MY formats and rejects junk", () => {
  assert.equal(normalizeMyPhone("0123456789"), "60123456789");
  assert.equal(normalizeMyPhone("60123456789"), "60123456789");
  assert.equal(normalizeMyPhone("+6012-345 6789"), "60123456789");
  assert.equal(normalizeMyPhone(""), null);
  assert.equal(normalizeMyPhone("12345"), null);   // too short / no 6 prefix
  assert.equal(normalizeMyPhone(null), null);
});

test("maskPhone reveals only the last two digits", () => {
  assert.equal(maskPhone("60123456745"), "…45");
});

test("canSend allows first send, blocks within cooldown", () => {
  const now = 1_000_000_000;
  assert.equal(canSend(null, now).ok, true);
  const just = { lastSentAt: now - 1000, sendTimestamps: [now - 1000] };
  const r = canSend(just, now);
  assert.equal(r.ok, false);
  assert.equal(r.code, "cooldown");
  assert.ok(r.retryAfterMs > 0 && r.retryAfterMs <= RESEND_COOLDOWN_MS);
});

test("canSend rate-limits after max sends in the window", () => {
  const now = 1_000_000_000;
  const stamps = [];
  for (let i = 0; i < MAX_SENDS_PER_WINDOW; i++) stamps.push(now - (i + 2) * 1000);
  const existing = { lastSentAt: now - 90 * 1000, sendTimestamps: stamps };
  assert.equal(canSend(existing, now).code, "rate_limited");
});

test("canSend ignores sends older than the window", () => {
  const now = 1_000_000_000;
  const old = now - 2 * 60 * 60 * 1000; // 2h ago, outside 1h window
  const existing = { lastSentAt: old, sendTimestamps: [old, old, old, old, old] };
  assert.equal(canSend(existing, now).ok, true);
});

test("recordSend appends now and trims expired stamps", () => {
  const now = 1_000_000_000;
  const old = now - 2 * 60 * 60 * 1000;
  const out = recordSend({ sendTimestamps: [old, now - 1000] }, now);
  assert.deepEqual(out, [now - 1000, now]);
});

test("verifyOtp: no request", () => {
  assert.equal(verifyOtp(null, "123456", Date.now()).code, "no_request");
});

test("verifyOtp: expired", () => {
  const now = 2_000_000;
  const salt = makeSalt();
  const doc = { otpHash: hashOtp("123456", salt), salt, expiresAt: now - 1, attempts: 0 };
  assert.equal(verifyOtp(doc, "123456", now).code, "expired");
});

test("verifyOtp: too many attempts", () => {
  const now = 2_000_000;
  const salt = makeSalt();
  const doc = { otpHash: hashOtp("123456", salt), salt, expiresAt: now + OTP_TTL_MS, attempts: MAX_ATTEMPTS };
  assert.equal(verifyOtp(doc, "123456", now).code, "too_many_attempts");
});

test("verifyOtp: mismatch increments attempts", () => {
  const now = 2_000_000;
  const salt = makeSalt();
  const doc = { otpHash: hashOtp("123456", salt), salt, expiresAt: now + OTP_TTL_MS, attempts: 1 };
  const r = verifyOtp(doc, "000000", now);
  assert.equal(r.ok, false);
  assert.equal(r.code, "mismatch");
  assert.equal(r.attempts, 2);
});

test("verifyOtp: correct OTP succeeds", () => {
  const now = 2_000_000;
  const salt = makeSalt();
  const doc = { otpHash: hashOtp("123456", salt), salt, expiresAt: now + OTP_TTL_MS, attempts: 0 };
  assert.equal(verifyOtp(doc, "123456", now).ok, true);
});
