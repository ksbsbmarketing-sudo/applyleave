# KSB Leave — WhatsApp OTP Password Reset Backend

A tiny, free (no-Blaze) backend for self-service password reset. It runs on
**Vercel** and uses the Firebase **Admin SDK** + **Fonnte** WhatsApp.

Two endpoints:
- `POST /api/request-otp` `{ ic }` → WhatsApps a 6-digit code to the staff's registered number.
- `POST /api/confirm-otp` `{ ic, otp, newPassword }` → verifies the code and sets the new Firebase Auth password.

Pure OTP logic lives in `lib/otp.js` and is covered by `lib/otp.test.js`
(`npm test`). Everything else is thin I/O glue.

---

## Deploy to Vercel (one-time, ~10 min)

### 1. Get a Firebase service-account key
Firebase Console → ⚙️ **Project settings** → **Service accounts** →
**Generate new private key** → downloads a JSON file. **Keep it secret** — it has
full admin access. It never goes in git; it lives only in Vercel.

### 2. Create the Vercel project
- Push this `otp-backend/` folder to a Git repo (or use the Vercel CLI: `npx vercel`).
- In Vercel → **New Project** → import the repo.
- **Root Directory:** set to `otp-backend` (if it's inside the main repo).
- Framework preset: **Other**. No build command needed.

### 3. Add Environment Variables (Vercel → Project → Settings → Environment Variables)
| Name | Value |
|------|-------|
| `FIREBASE_SERVICE_ACCOUNT` | Paste the **entire** JSON file contents from step 1 (one line is fine). |
| `FONNTE_TOKEN` | Your existing Fonnte device token (same one the app uses). |
| `ALLOWED_ORIGIN` | `https://apply-leave-89ebb.web.app` |

Apply to **Production** (and Preview if you want). **Redeploy** after adding them.

### 4. Grab the URL
After deploy you'll get something like `https://ksb-otp.vercel.app`.
Give this URL to the app: set `OTP_API_BASE` in `src/main.js` to it, then rebuild
and redeploy hosting.

### 5. Smoke test
```bash
curl -X POST https://<your-app>.vercel.app/api/request-otp \
  -H "Content-Type: application/json" -d '{"ic":"<a real staff IC>"}'
```
Expect `{"ok":true,"phoneHint":"…NN"}` and a WhatsApp on that staff's phone.

---

## Notes
- The `password_resets/{ic}` Firestore collection is written/read only by this
  backend (Admin SDK bypasses rules); client rules deny all access to it.
- OTPs are hashed + salted, expire in 10 min, allow 5 attempts, and sends are
  rate-limited (60s cooldown, 5/hour) to protect Fonnte quota.
