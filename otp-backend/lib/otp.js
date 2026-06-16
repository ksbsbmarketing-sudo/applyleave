// Pure OTP logic — no I/O, fully unit-testable. The handlers wire this to
// Firestore / Fonnte. Keeping it pure is what lets us trust the security rules
// (expiry, attempt cap, rate limiting) without mocking Firebase.
import { createHash, randomInt, randomBytes } from "node:crypto";

export const OTP_TTL_MS = 10 * 60 * 1000;      // OTP valid for 10 minutes
export const MAX_ATTEMPTS = 5;                  // wrong tries before lockout
export const RESEND_COOLDOWN_MS = 60 * 1000;    // min gap between sends
export const SEND_WINDOW_MS = 60 * 60 * 1000;   // rolling window for send cap
export const MAX_SENDS_PER_WINDOW = 5;          // max sends per window

export function generateOtp() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function makeSalt() {
  return randomBytes(16).toString("hex");
}

export function hashOtp(otp, salt) {
  return createHash("sha256").update(`${salt}:${otp}`).digest("hex");
}

// Malaysian phone normalization → must end up starting with "6" (60xxxxxxxxx).
// Returns null when no usable mobile number is on file.
export function normalizeMyPhone(phone) {
  let p = String(phone || "").replace(/\D/g, "");
  if (!p) return null;
  if (p.startsWith("0")) p = "60" + p.slice(1); // 012... → 6012...
  if (!p.startsWith("6")) return null;
  return p.length >= 10 ? p : null;
}

export function maskPhone(phone) {
  const p = String(phone || "").replace(/\D/g, "");
  return p.length >= 2 ? "…" + p.slice(-2) : "…";
}

// Decide whether a fresh OTP may be sent, given the existing reset doc (or null).
export function canSend(existing, now) {
  if (!existing) return { ok: true };
  if (existing.lastSentAt && now - existing.lastSentAt < RESEND_COOLDOWN_MS) {
    return { ok: false, code: "cooldown", retryAfterMs: RESEND_COOLDOWN_MS - (now - existing.lastSentAt) };
  }
  const recent = (existing.sendTimestamps || []).filter((t) => now - t < SEND_WINDOW_MS);
  if (recent.length >= MAX_SENDS_PER_WINDOW) return { ok: false, code: "rate_limited" };
  return { ok: true };
}

// Trimmed list of send timestamps within the rolling window, plus this send.
export function recordSend(existing, now) {
  const prior = (existing?.sendTimestamps || []).filter((t) => now - t < SEND_WINDOW_MS);
  return [...prior, now];
}

// Verify a submitted OTP against the stored reset doc.
// On mismatch returns the incremented attempt count for the caller to persist.
export function verifyOtp(existing, otp, now) {
  if (!existing) return { ok: false, code: "no_request" };
  if (now > existing.expiresAt) return { ok: false, code: "expired" };
  if ((existing.attempts || 0) >= MAX_ATTEMPTS) return { ok: false, code: "too_many_attempts" };
  if (hashOtp(String(otp), existing.salt) !== existing.otpHash) {
    return { ok: false, code: "mismatch", attempts: (existing.attempts || 0) + 1 };
  }
  return { ok: true };
}
