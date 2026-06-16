# Self-Service WhatsApp OTP Password Reset (No Blaze)

**Date:** 2026-06-16
**Status:** Approved — pending implementation plan

## Problem

After migrating login to Firebase Auth, staff who changed their password in the
old (Firestore `password` field) system are locked out: provisioning was a
one-time sync, so their Auth password no longer matches what they expect. The
existing "Lupa Kata Laluan?" button is a placeholder — it only shows an alert
telling them to contact HR/Admin. We want real self-service recovery.

A forgotten **Firebase Auth** password can only be reset by the Firebase **Admin
SDK** (a trusted server) — a browser cannot do it. Normally that server is a
Firebase Cloud Function, which requires the Blaze plan. The owner does **not**
want Blaze.

## Constraint & Key Insight

The Firebase **Admin SDK works on the free Spark plan** when run from a server
*outside* Firebase. Blaze is only required to host functions *inside* Firebase.
So we host a tiny backend on a **free external host (Vercel Hobby)** and get full
self-service OTP reset at **$0**.

Identity proof = the WhatsApp number HR has on file for the staff. If that number
is wrong/missing, OTP can't reach them and IT must fall back to `reset-password.js`.

## Architecture

### 1. Vercel backend (`/api`, Node serverless, `firebase-admin` + Fonnte)

Two endpoints. Secrets live only as Vercel env vars:
- `FIREBASE_SERVICE_ACCOUNT` — service-account JSON (admin-powerful; never in repo)
- `FONNTE_TOKEN` — existing Fonnte WhatsApp token
- `ALLOWED_ORIGIN` — `https://apply-leave-89ebb.web.app`

**`POST /api/request-otp { ic }`**
1. Look up `staff/{ic}` via Admin SDK; read phone. Normalize (must start with `6`).
2. If no valid phone → `404` "phone not registered, contact HR."
3. Anti-abuse: read `password_resets/{ic}`. Reject if last send < 60s ago, or > 5 sends in the past hour.
4. Generate 6-digit OTP. Store in `password_resets/{ic}`: `{ otpHash: sha256(otp+salt), salt, expiresAt: now+10min, attempts: 0, sends, lastSentAt, createdAt }`.
5. Send OTP via Fonnte. Handle Fonnte's "HTTP 200 but `status:false`" gotcha — only report success on real success; otherwise `502`.
6. Return `{ ok: true, phoneHint: "…45" }` (masked).

**`POST /api/confirm-otp { ic, otp, newPassword }`**
1. Validate `newPassword` length ≥ 6.
2. Read `password_resets/{ic}`. If missing/expired → `400`.
3. If `attempts >= 5` → `429` and delete doc.
4. Compare `sha256(otp+salt)`. On mismatch → increment `attempts`, `400`.
5. On match → `admin.auth().updateUser(uid, { password: newPassword })`, delete the reset doc, return `{ ok: true }`.

**CORS:** restrict to `ALLOWED_ORIGIN`; handle `OPTIONS` preflight.

### 2. Firestore

- New collection `password_resets/{ic}` — written/read only by Admin SDK.
- Rule: `match /password_resets/{id} { allow read, write: if false; }`
  (Admin SDK bypasses rules; browsers can never read OTPs.)

### 3. Client (`src/main.js`)

- New constant `OTP_API_BASE = 'https://<app>.vercel.app'` (hardcoded — pre-login,
  cannot read Firestore config).
- Replace placeholder `forgotPassword` with a 2-step modal:
  1. Uses the branch+name already selected on the login screen → derives `ic`.
     Calls `request-otp`. Shows "OTP sent to …45".
  2. Inputs: OTP, new password (min 6), confirm. Calls `confirm-otp`.
     On success → "Berjaya — sila log masuk."
- Error messages (Malay) for: no phone on file, wrong/expired OTP, too many
  attempts, rate-limited, network/Fonnte failure.
- Fix the help-bot text to describe the real flow.

## Security

- OTP hashed + salted at rest; never stored or logged in plaintext.
- 10-min expiry; max 5 verify attempts; per-IC send rate limit (60s + 5/hour).
- New password ≥ 6 chars (Firebase requirement), enforced client + server.
- CORS locked to the app origin.
- Service-account key only in Vercel env, never committed.

## Out of Scope

- Bulk unlock of currently locked-out staff (owner chose "wait for OTP").
- Migrating Fonnte sending off the client for *other* flows (unchanged).

## Owner Deployment Steps (documented for handoff)

1. Create free Vercel project; deploy `/api`.
2. Firebase Console → Project Settings → Service Accounts → generate key → paste
   as Vercel `FIREBASE_SERVICE_ACCOUNT`.
3. Set `FONNTE_TOKEN` and `ALLOWED_ORIGIN` env vars.
4. Provide the Vercel URL → set `OTP_API_BASE`, rebuild, redeploy hosting + rule.

## Testing

- Unit (backend): OTP hash/verify, expiry, attempt cap, rate limit, Fonnte
  failure handling, missing-phone path.
- Rules: `password_resets` denies all client read/write.
- Manual E2E: real staff IC → receive WhatsApp OTP → set new password → log in.
- Negative: wrong OTP, expired OTP, 6th attempt, unregistered phone.
