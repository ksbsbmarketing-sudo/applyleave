# KSB Leave Apply — Messenger Retro Reskin + BUZZ Design Spec

**Date:** 2026-07-07
**Status:** Approved (brainstorming)
**Repo:** KSB Leave Apply (Vite + Firebase), `src/main.js` + `src/style.css`

Give the leave app's existing messenger the retro Yahoo Messenger look (matching
the standalone `ksbsb-chats-group` app) and add the classic **BUZZ** feature —
using the app's own JS + Firestore, no separate server, same staff logins.

## 1. Context (existing messenger)

The messenger is already fully built on Firestore:

- Collections: `messenger_rooms`, `messenger_messages` (messages carry `roomId`).
- DMs keyed by staff IC: `dm_<ic1>__<ic2>` (sorted). Group/branch/role rooms too.
- Presence with Yahoo-style status + mood (`src/presenceStatus.js`), online dots.
- Emoticons (`src/emoticons.js`), message toasts, browser notifications, unread badges.
- Firestore security rules authorize message access by `roomId` (DM privacy).
- Rendered by `renderMessengerView()` in `src/main.js`; markup uses classes like
  `.messenger-layout`, `.msg-rooms-panel`, `.msg-rooms-header`, `.msg-mystatus`,
  `.msg-status-dot`. Styles live in `src/style.css`.

This work is a **reskin + BUZZ**, NOT a rewrite. All existing realtime logic,
rooms, presence, emoticons, toasts, and privacy rules are preserved.

## 2. Decisions

| Decision | Choice |
|---|---|
| Retro scope | **Messenger page only** (scoped CSS under `.messenger-layout`); rest of app unchanged |
| BUZZ scope | **DMs only** (classic Yahoo); shakes recipient window, plays sound, prints system line |
| BUZZ transport | **Firestore** message doc `type:'buzz'` (no server / no WebSocket) |
| Sound | Synthesized via **Web Audio** (ported from ksbsb-chats-group `playBuzz()`) |
| Reskin technique | **Scoped CSS** + minimal markup tweaks (avoid rewriting render logic) |
| Files | `src/style.css`, `src/main.js`, `firestore.rules` (only if needed) |

## 3. Retro visual (scoped to `.messenger-layout`)

All new CSS rules are prefixed with `.messenger-layout` so nothing leaks to the
rest of the leave app (which keeps its maroon corporate branding):

- Purple/grey gradient title bars on the rooms panel header and chat header.
- Classic yellow smiley (inline SVG) in the header.
- Beveled 3D buttons (`border: outset`), Tahoma / MS-Sans font stack.
- Buddy/room rows restyled with hover; reuse existing green/grey presence dots.
- Chat message area as an inset "window" panel; chat header as a window title bar.
- Yellow beveled **BUZZ** button in the DM composer.

Preserved as-is (just restyled): presence status/mood dropdown, emoticons, message
toasts, browser notifications, unread badges, group/branch/role rooms, file UI.

## 4. BUZZ (DMs only)

1. A yellow **BUZZ** button renders in the composer **only when the open room id
   starts with `dm_`**.
2. On click: client-side rate limit (**1 buzz / 2s per room**), then
   `addDoc(collection(db,'messenger_messages'), { roomId, type:'buzz',
   senderIc, senderName, createdAt: serverTimestamp() })`.
3. The existing `messenger_messages` `onSnapshot` listener receives the buzz doc.
   Rendering a `type:'buzz'` message:
   - Prints a system line: `[System]: You received a BUZZ!` (recipient) or
     `[System]: You just sent a BUZZ!` (sender).
   - For **newly arrived** buzzes only (snapshot `docChanges()` type `added`, and
     `createdAt` newer than listener start — not on history load): add
     `.buzz-shake` to the chat window (auto-removed after ~800ms) and call
     `playBuzz()` (Web Audio).
4. `playBuzz()`: square-wave oscillator 110→70Hz over ~0.5s with gain decay
   (ported from ksbsb-chats-group). Fails silently if Web Audio is unavailable.

### Firestore rules
If the current `messenger_messages` create rule validates a fixed message shape
(e.g. requires a `text` field or restricts allowed fields), extend it to permit a
buzz-shaped doc (`type == 'buzz'`) for authorized `roomId`s. If the rule only
checks `roomId` authorization, no rules change is needed. Verify before assuming.

## 5. Testing / Verification

Manual, in the real app:
1. `npm run dev`; log in as two different staff in two browsers.
2. Open a DM between them; exchange messages (live both sides).
3. Click **BUZZ** → sender window shakes + sound + "You just sent a BUZZ!";
   recipient window shakes + sound + "You received a BUZZ!".
4. Confirm the rest of the leave app (dashboard, forms) looks unchanged.
5. If rules changed: validate via the Firebase emulator (JDK PATH prefix per
   project setup) before deploying rules.

## 6. Deployment

- Build: `npm run build`.
- Deploy hosting: `firebase deploy` (hosting; and `firestore:rules` only if rules
  changed). This is a production app used by staff — build and smoke-test locally
  first, then deploy.

## 7. Out of scope (YAGNI)

- Re-theming the rest of the leave app.
- BUZZ in group/branch/role rooms.
- Fixing the (separately known) broken file upload / Firebase Storage.
- Any change to the standalone `ksbsb-chats-group` app.
