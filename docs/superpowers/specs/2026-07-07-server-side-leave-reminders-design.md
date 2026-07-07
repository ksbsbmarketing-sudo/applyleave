# Server-Side Leave Reminders (3-Day Threshold) — Design

**Date:** 2026-07-07
**Status:** Approved, implementing

## Problem

Overdue-leave WhatsApp reminders to approvers currently run **client-side** in
`src/main.js` (`checkOverduePendingReminders` + `startReminderScheduler`). Two
issues:

1. **Not reliable** — the scheduler only runs while a staff member has the app
   open in a browser. If nobody is logged in, no reminders fire.
2. **Threshold too long** — reminders only start after **7 days** overdue.

We want reminders to run **automatically on a server** and to trigger after
**3 days** from the application date.

## Constraint

Firebase scheduled functions require the **Blaze** plan, which the user
declines. The project already has a **Vercel serverless backend** (`otp-backend/`)
built as a "free, no-Blaze" server, with `firebase-admin` (reads Firestore on
the Spark plan) and a proven Fonnte `sendWhatsApp()` helper. This is the home
for the scheduled job.

## Approach

Add a **Vercel Cron** job to `otp-backend/` that runs once daily at
**01:00 UTC (09:00 MYT)**. Vercel's free plan allows one run per day; this is
sufficient because the reminder logic already de-dupes to at most one send per
approver per 24h.

### New files

```
otp-backend/
  vercel.json              # crons: "0 1 * * *" → /api/check-reminders
  api/check-reminders.js   # the scheduled job
  lib/routing.js           # ported routing rules (pure functions)
  lib/routing.test.js      # unit tests locking routing behaviour
```

### `lib/routing.js` (port of client routing)

Faithful, dependency-free port of `ROUTING_DEFAULTS`, `getStaffGroup`,
`shouldSkipP1`, and `getRoutingP1Approvers` from `src/main.js`. Pure functions
taking `(staff, branches, approvalRouting)` — no globals, no network — so they
are unit-testable.

**Drift risk:** routing rules now live in two places. Mitigation: unit tests
cover each branch group, and a sync-warning comment links both files. See
memory `approval-routing-config-override`.

### `api/check-reminders.js` (the job)

1. **Auth guard** — reject unless `Authorization: Bearer <CRON_SECRET>`. Vercel
   Cron sends this automatically when `CRON_SECRET` env var is set, so the URL
   cannot be used to trigger blasts by outsiders.
2. Load `staff`, `branches`, and `config/approvalRouting` (fallback
   `ROUTING_DEFAULTS`) once.
3. Query `leaves` where `status in ['PENDING','TL APPROVED','HOD APPROVED']`.
4. Keep records where **age ≥ 3 days** (`now − record.id`, ms) **and**
   `lastReminderSent` ≥ 24h ago (or missing).
5. Resolve recipients — **identical branching to the current client**:
   - `PENDING` + `hodIC` → that specific staff.
   - `PENDING` + `directHR` (or `shouldSkipP1`) → all HR/Admin/Super Admin.
   - `PENDING` auto-route → `getRoutingP1Approvers(applicant)`.
   - `TL APPROVED` → Balok supervisors.
   - `HOD APPROVED` → all HR/Admin/Super Admin.
6. Send the existing `⏰ PERINGATAN — KELULUSAN CUTI TERTANGGUH` message via
   `sendWhatsApp(process.env.FONNTE_TOKEN, phone, msg)`.
7. Write `lastReminderSent = now` on each record (dedupe).
8. Optionally append a `wa_logs` entry (`sentBy: 'System (Cron)'`) so the
   in-app WhatsApp log stays complete.
9. Return a JSON summary `{ checked, overdue, sent }` for observability.

### Config constant

`const OVERDUE_DAYS = 3;` (message wording is already dynamic — no copy change).

### Dry-run

`?dryRun=1` resolves recipients and returns them **without sending or writing**,
so we can verify who would be messaged before the live cron runs.

## Client change

Remove the now-redundant browser scheduler from `src/main.js`:
`startReminderScheduler`, `stopReminderScheduler`, `checkOverduePendingReminders`,
`buildReminderMsg`, and their call sites. Server becomes the single source of
reminders — no double-sends, no dependency on an open browser.

## Environment

- `FIREBASE_SERVICE_ACCOUNT` — exists (OTP feature).
- `FONNTE_TOKEN` — exists (OTP feature); same sender device.
- `CRON_SECRET` — **new**, set in Vercel dashboard.

## Testing

- `lib/routing.test.js` — deterministic unit tests per branch group.
- Dry-run endpoint for a live who-would-be-messaged check before go-live.

## Out of scope (YAGNI)

- No new time-based escalation tiers — mirror today's status-based recipients.
- No change to who gets reminded (behaviour identical, only threshold + venue).
