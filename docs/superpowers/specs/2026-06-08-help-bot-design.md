# Design: Staff Help Bot ("FAQ Pintar")

**Date:** 2026-06-08
**App:** KSB Leave Apply (`src/main.js`, Firebase Hosting `apply-leave-89ebb`, Spark/free plan)
**Status:** Approved (design); pending implementation plan

## Context

Staff sometimes get stuck using the leave system (submitting AL/MC/emergency leave,
understanding who approves them, account issues). The clinic wants an in-app help
assistant so staff can self-serve answers. The app is a static vanilla-JS PWA on the
free Firebase plan and recently hit Firestore quota limits, so the solution must be
**zero-backend, zero-API-cost, zero-extra-Firestore**.

## Decisions (locked during brainstorming)
- **Type:** rule-based guided FAQ ("FAQ pintar") — no LLM, no backend, no network.
- **Interaction:** a typing box with keyword search **plus** popular-topic chips.
- **Location:** a floating "?" button in a bottom corner, present on all screens, opening a help panel.
- **Content scope (all four):** leave-type guides; form-submission troubleshooting;
  approval status/routing; account & contact.
- **Content management:** hard-coded in `src/main.js` (no Firestore-editable admin UI).
- **Personalization:** lightweight, using already-loaded client data (no extra cost).

## Goals
A self-contained, offline-capable help widget that lets a logged-in staff member type
a question in Malay, see the best-matching FAQ answers, and tap through to a clear
answer — with a couple of answers personalized to the current user.

Non-goals: LLM/AI, Firestore reads/writes, HR-editable content, languages other than
Malay, general (non-system) Q&A.

## Architecture

All in `src/main.js`, as a self-contained module appended near other UI code,
following the existing single-file vanilla-JS pattern. Three units:

### 1. Knowledge base — `HELP_FAQ`
A module-level array of ~20-25 entries:
```js
{ id: 'mc-submit', cat: 'cuti', keywords: ['mc','sakit','medical','sijil','cuti sakit'],
  q: 'Macam mana mohon Cuti Sakit (MC)?', a: '...Malay answer (may include <strong>, <br>, steps)...',
  action: { label: 'Pergi ke Borang Cuti', view: 'leave-form' } /* optional shortcut */ }
```
Categories: `cuti` (leave-type guides), `masalah` (troubleshooting), `kelulusan`
(status/routing), `akaun` (account & contact). Content authored from existing policy
constants (`rulesAL`, `rulesMC`, `rulesCME`, `rulesNotice`, `leaveCategories`
descriptions) and the flows built this session (MC → HR/HOD by state; approvers
Doctor PIC / HOD Balok / Supervisor / HR; Peringkat 1/2; no-approver-direct-to-HR;
notice 3/7-day; MC cert mandatory; emergency/ehsan proof mandatory).

### 2. Search — `helpSearch(query)`
- Lowercase + tokenize the query; strip very short stop-tokens.
- Score each FAQ entry: +N for each query token that matches an entry keyword or
  appears in its `q`. Apply a small **synonym map** (e.g. `sakit→mc`, `tahunan→al`,
  `kecemasan→emergency`, `bersalin→maternity`, `pelulus|lulus→kelulusan`,
  `baki→balance`, `lupa|password→akaun`).
- Return entries sorted by score desc, score > 0, capped at ~6. Empty query → return
  the "popular" subset (a curated flag `popular: true` on a handful of entries).

### 3. UI — floating button + panel
- A fixed-position circular **"?"** button (bottom-right), injected once into the app
  shell (rendered for logged-in users; hidden on the login screen).
- Click toggles a panel (bottom-sheet on mobile, card on desktop) containing: a header,
  a search `<input>` (filters live on `input`), popular-topic chips, a results list of
  matching questions, and — when one is tapped — the answer view with an optional
  shortcut button and a back link. A "Tiada padanan — cuba topik popular atau hubungi
  HR/Admin" empty state. Styled with the app's existing neu/glass classes.
- State held in a few module-level vars (`helpOpen`, `helpQuery`, `helpSelectedId`);
  the widget renders independently of the main `render()` to avoid coupling (its own
  small `renderHelpWidget()` invoked from the app shell + on its own events).

### Personalization (free, client-only)
Two entries call helper functions using the in-memory `user`/`staffList`:
- "Siapa pelulus cuti saya?" → uses `window.getRoutingP1Approvers(user)` to name the
  actual P1 approver(s) and explains Peringkat 1 → 2 (HR) for their group.
- "Berapa baki cuti saya?" → uses existing balance helpers (e.g. `getLeaveStats`) to
  show the user's AL/MC balances.
If `user` is null, these fall back to a generic answer.

## Data flow
tap "?" → panel opens showing popular chips → user types → `helpSearch` runs on each
input → ranked question list → tap question → answer view (personalized if applicable)
→ optional shortcut navigates (`setView(...)`) and closes the panel. No network at any
step.

## Error handling
No I/O, so the only failure mode is "no match" → handled by the empty state + contact
prompt. Personalization helpers are wrapped defensively (null user / missing data →
generic text). The widget must never throw into the main app.

## Testing / verification
- `node --check src/main.js` for syntax.
- A small Node oracle for `helpSearch` (pure function over the `HELP_FAQ` array): given
  sample queries ("macam mana hantar mc", "tiada pelulus", "baki cuti", "lupa kata
  laluan"), assert the expected entry id ranks first.
- Playwright: load the deployed/built app, click the "?" button, type a query, confirm
  the panel shows matching results and an answer; screenshot.

## Files
- `src/main.js` — add `HELP_FAQ`, `helpSearch`, `renderHelpWidget` + a button mount in
  the app shell, and minimal CSS (reuse existing classes; add a few rules to
  `src/style.css` if needed for the floating button/panel).

## Out of scope
LLM/AI, Firestore, HR-editable FAQ, non-Malay languages, analytics.
