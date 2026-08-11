# Master Logs — asingkan mengikut negeri & cawangan

**Date:** 2026-08-11
**Status:** design approved, awaiting implementation plan

## Problem

Master Logs (Management → Master Logs) renders the raw leave collection:

```js
// src/main.js:7602
${leaveRecords.map((r, index) => `
```

No scoping of any kind. The two HRs have exclusive zones — Norhazlinah owns Pahang + Utama, Zahirah owns Kerteh, Paka and KR X-Ray Dungun — and every other screen respects that boundary. Master Logs does not. **Zahirah currently sees every Pahang leave record, and Norhazlinah sees every Terengganu one.**

The scoping helpers already exist and already handle the awkward cases:

| Helper | `src/main.js` | Does |
|---|---|---|
| `getUserStateScope(u)` | 1034 | `'all'` for admin/super_admin, `hrState` for HR, branch state otherwise |
| `scopeStateOfBranch(name)` | 1024 | Branch → zone, with the Utama exception baked in |
| `recordsInUserScope(records)` | 1045 | Filters a record list to the caller's zone |
| `branchesInUserScope()` | 1052 | Branches the caller may see |

They are called in exactly one place — Analisa, `src/main.js:5290`. Master Logs never calls them.

A second, related leak sits on a different tab: `window.generateLeaveReport()` (`src/main.js:3387`, the **"PDF — Semua Rekod"** button on HR Reports) also maps raw `leaveRecords` at `:3408`. Closing Master Logs alone would leave the same data reachable one tab over, as a downloadable PDF.

## Goal

1. An HR sees only their own zone in Master Logs. Admin and super_admin see both.
2. Within the visible zone, records can be narrowed to one branch via sub-tabs.
3. The HR Reports "PDF — Semua Rekod" export obeys the same zone boundary.

## Non-goals

- **No `firestore.rules` change.** See [Limitation](#limitation).
- The **Locum Records** tab (`src/main.js:7697`) and `printAllLocum` (`:1362`) are also unscoped by zone. Same class of bug, different feature, not touched here.
- No change to which roles can open Master Logs. It stays gated on `manage_audit`, which only `super_admin`, `admin` and `hr` hold (`src/main.js:795, 801, 807`).
- No change to `hrState`, `ROUTES_AS_PAHANG`, or any approval routing.

## Decisions taken

**Klinik Syed Badaruddin Utama appears under PAHANG.** Its `state` field says Terengganu, but its leave routes through Balok HQ and Norhazlinah manages it — which is precisely what `scopeStateOfBranch` already encodes via `ROUTES_AS_PAHANG`. Filing it under Terengganu would show Zahirah a tab full of records she does not administer, while hiding them from the HR who does. The zone split follows *who manages the branch*, not where the building is.

This gives 10 branches in the Pahang zone and 3 in Terengganu:

| Pahang zone (10) | Terengganu zone (3) |
|---|---|
| Balok (HQ), Beserah, Gebeng, Kempadang, MCKIP, RPCM, KSBYMC, Uni Klinik Bentong, Management / HQ, **Utama** | Kerteh, Paka, KR X-Ray Dungun |

## Design

### 1. New module `src/masterLogScope.js`

Three pure functions. The branch→state resolver is **injected**, so the module never imports `branches`, Firebase or the DOM — which is what makes it unit-testable, and what lets a test pin the Utama rule.

```js
// userScope: 'all' | 'Pahang' | 'Terengganu' | null
// stateOfBranch: (branchName) => 'Pahang' | 'Terengganu' | null

export function visibleStates(userScope)
// 'all' → ['Pahang','Terengganu']; a zone → [zone]; null → []

export function branchOptions(branches, { userScope, state, stateOfBranch })
// branch names for the selected state tab, within the caller's zone

export function filterByScope(records, { userScope, state, branch, stateOfBranch })
// zone filter first (always), then state tab, then branch tab
```

**Sentinel values, used consistently across the module, the tab state and the setters:**

| Value | Meaning |
|---|---|
| `state: 'ALL'` | the SEMUA state tab — no state narrowing |
| `branch: 'ALL'` | the Semua branch tab — no branch narrowing |
| `branch: '__NONE__'` | the `Lain-lain` tab — records whose branch resolves to no state |

`visibleStates` returns only real state names; `'ALL'` is not one of its entries. The SEMUA tab is rendered by the caller ahead of them, and is rendered **only when `userScope === 'all'`** — an HR has nothing to widen to.

`filterByScope` applies the **zone filter unconditionally** — it is the security boundary. The state and branch arguments are navigation on top of it. An HR passing `state: 'Pahang'` still gets nothing, because the zone filter runs first and does not trust the tab.

Records whose branch resolves to `null` are treated as an explicit `'__NONE__'` bucket rather than being silently dropped (see §4).

### 2. Tab rows in Master Logs

Two module-level variables in `src/main.js` beside the existing `managementTab`, plus `window.setMasterLogState(s)` / `window.setMasterLogBranch(b)` setters following the `setManageTab` pattern.

**State row — shown only when `getUserStateScope(user) === 'all'`:**

```
[ SEMUA ]  [ PAHANG ]  [ TERENGGANU ]
```

For an HR this row is **not rendered at all**. A one-option tab row is noise, and a Terengganu tab that returns nothing reads as a broken screen. They get a read-only chip instead — **"Skop: Terengganu"** — reusing the chip already used for "Skop: Kuantan Sahaja" at `src/main.js:7981`, so it looks like something the app already does.

**Branch row — always shown**, with per-branch record counts:

```
[ Semua ]  [ Balok (HQ) (41) ]  [ Beserah (12) ]  [ Gebeng (8) ] …
```

Wrapped in `overflow-x:auto`, per the app-wide mobile pattern — 10 Pahang tabs will not fit a phone.

Switching the state tab **resets the branch tab to Semua**. Otherwise Pahang + Kerteh yields an empty table that looks like a bug rather than an impossible combination.

### 3. The fix itself

`src/main.js:7602` stops mapping `leaveRecords` and maps the filtered result instead. `window.generateLeaveReport()` at `:3408` does the same, using the caller's zone but ignoring the state/branch tabs — the button is labelled "Semua Rekod" and should stay everything-in-your-zone, not everything-in-the-tab-you-happen-to-be-on.

### 4. Stranded records

A record whose `branch` is not in the `branches` collection — a renamed or deleted branch — resolves to no state. Under a plain zone filter it would vanish for both HRs and appear for admin only when they happened to be on SEMUA: a silent disappearance of real records.

Instead these collect in a **`Lain-lain (n)`** branch tab that renders **only when `n > 0`, and only for `userScope === 'all'`**. Admin and super_admin can therefore find and fix stranded records; the tab stays invisible in the normal case where none exist. This matters because a branch going missing from the collection is a failure mode this project has already seen (it is why the login dropdown derives its branch list from `directory` rather than `branches`).

### 5. Error handling

- **No branches loaded yet** (first paint, before the Firestore snapshot lands): `branchOptions` returns `[]`, the branch row renders with just `Semua`, and the table shows the zone-filtered records. No crash, no empty-state flash claiming there are no records.
- **A user with no resolvable zone** (`getUserStateScope` → `null`, e.g. a role not in the matrix that somehow reaches this tab): `visibleStates` returns `[]` and `filterByScope` returns `[]`. Fails closed — showing nothing is the safe direction for an audit log.
- **Selected branch disappears** between renders (branch deleted while the tab is open): the branch no longer appears in `branchOptions`, the table shows zero rows. Acceptable; the next state-tab click resets it.

## Limitation

This is client-side filtering. `firestore.rules` still permits any authenticated HR to read the whole `leaves` collection, so an HR with devtools could still retrieve the other zone's records.

That is the **existing** posture of every zone boundary in this app — `recordsInUserScope`, `canManageRequest` and the HR approval queue are all client-side too. This change closes the accidental-exposure hole (an HR seeing the other zone by simply opening a tab) without pretending to close the deliberate one. Making zone scoping server-side is a real piece of work — it needs `hrState` in a custom claim and a rules rewrite across every leave read — and it should be its own project, applied to all screens at once rather than to Master Logs alone.

## Testing

**Unit — `tests/masterLogScope.test.mjs` (new):**

- Utama resolves into the Pahang zone, not Terengganu — the decision this spec turns on.
- A Pahang HR never receives a Terengganu record, and vice versa, **including when the `state` argument names the other zone** — proves the zone filter does not trust the tab.
- `'all'` receives both zones.
- `visibleStates`: `'all'` → both; a zone → itself only; `null` → `[]`.
- `branchOptions` returns only in-zone branches, and returns `[]` rather than throwing when the branch list is empty.
- A record with an unknown branch lands in the `Lain-lain` bucket, is absent for both HRs, and is present for admin.
- A `null` user scope yields no records (fails closed).

**Manual, after deploy** (hard-refresh first — stale service worker cache has masked deploys on this project):

1. Log in as Zahirah (Terengganu HR) → Master Logs shows only Kerteh / Paka / Dungun records, a "Skop: Terengganu" chip, no state tab row, and 3 branch tabs.
2. Log in as Norhazlinah (Pahang HR) → 10 branch tabs including Utama; no Terengganu record anywhere.
3. Log in as super_admin → state row present; SEMUA shows everything; switching to Terengganu resets the branch tab and shows 3 branches.
4. HR Reports → "PDF — Semua Rekod" as Zahirah contains no Pahang record.
5. Branch counts on the tabs match the row counts in the table.
