# Full-List Modal for "Ranking Penggunaan Cuti"

**Date:** 2026-07-09
**Area:** Analytics dashboard → Analisa tab → "Ranking Penggunaan Cuti" section
**File:** `src/main.js` (the analytics dashboard render function containing `filteredRecords` at ~line 5514 and the ranking cards at ~line 5706)

## Problem

The "Ranking Penggunaan Cuti" section shows 3 cards — Annual Leave (`AL`), Medical
Leave (`MC`), Emergency Leave (`EL_EMG`) — each listing only the **Top 3** staff.
Users want to see the **full list** of who took each leave type, not just the top 3.

Two problems with the current cards, beyond the top-3 limit:
1. They list individual leave **records**, so one person can appear multiple times.
2. They include **all statuses** (pending / rejected / cancelled), not just approved.

## Goal

Clicking any of the 3 cards opens a **popup modal** showing the full, per-person,
approved-only list of who took that leave type.

## Behaviour

- Each card becomes clickable, with a visible **"Lihat semua →"** affordance in the
  card footer so it reads as tappable (cursor pointer + hover cue).
- Clicking opens a modal overlay reusing the app's existing modal pattern
  (`position:fixed; inset:0`, blur backdrop, `.glass-pane`/`.glass-card` panel,
  ✕ close button, click-outside-to-close).
- Modal content:
  - Title = the leave type's full label (e.g. "Annual Leave — Senarai Penuh").
  - Sub-line shows the active category filter when not "SEMUA"
    (e.g. "· DOKTOR") and that it counts approved leave only.
  - A ranked list of **every** staff member who has an APPROVED record of that type,
    **aggregated per person**: total days summed, plus number of applications.
  - Sorted by total days descending. Top 3 rows get 🥇🥈🥉; remaining rows get plain
    rank numbers (4, 5, …).
  - Each row: rank badge, name, branch, total days, "(N permohonan)".
  - Scrollable panel (`max-height:80vh; overflow-y:auto`).
  - Empty state ("Tiada rekod diluluskan") when the list is empty.

## Data rules

- **Source records:** the existing `filteredRecords` (already filtered by the active
  month + branch filters), further filtered to `r.status === 'APPROVED'` and to the
  card's `r.type`.
- **Category filter:** respect the active `analyticsCatFilter`
  (SEMUA / Doktor / Admin Staff / Operation Staff), matched via
  `staffList.find(x => x.name === r.name || x.ic === r.ic)` — same logic already used
  for the cards.
- **Aggregation key:** group by `r.ic` (fallback to `r.name` when `ic` is missing).
  For each person: `days = Σ parseFloat(r.days || 1)`, `count = number of records`,
  keep `name` and `branch` from the records.
- **Days display:** the aggregated total days (not a single record's days).

## Consistency fix (in scope)

The Top-3 cards are switched to the **same** logic — aggregated per person,
approved-only — so the card is exactly the top 3 of the modal's full list and the
numbers always match. Concretely:
- A single shared helper builds the ranked, aggregated, approved-only list for a given
  leave type. The card uses `.slice(0, 3)`; the modal uses the whole list.
- The card header **badge** (currently `catFiltered.length`, i.e. all records) changes
  to count **approved records** of that type for the active filters, so the badge is
  consistent with the list it sits above. Label stays "rekod".
- The medal/row rendering inside the card is unchanged except that `r.days` becomes the
  person's aggregated `days` and `r.name`/`r.branch` come from the aggregated entry.

## Mechanics (matches existing app patterns)

State-driven re-render, exactly like `showRegisterModal`:

- New module-scope state var: `let analyticsRankModal = null;`
  (holds `'AL'` / `'MC'` / `'EL_EMG'`, or `null` when closed) declared alongside the
  other analytics state vars.
- `window.openRankModal = function(type) { analyticsRankModal = type; render(); };`
- `window.closeRankModal = function() { analyticsRankModal = null; render(); };`
- Shared helper (module scope), e.g.
  `function rankLeaveUsers(records, type, catFilter) { … }` returning the sorted array
  of `{ ic, name, branch, days, count }`. Used by both card and modal so there is one
  source of truth.
- Modal markup is appended inside the analytics dashboard template (before its outer
  closing `</div>`), rendered only when `analyticsRankModal` is set. It looks up the
  three-card metadata (label/gradient) by the stored type so the modal header matches
  the card's colour.

## Out of scope

- No PDF/export/print of the full list.
- No per-record date breakdown inside the modal (per-person aggregate only).
- No changes to other dashboard sections (branch ranking, donut, KPIs).
- No new filters beyond the ones already on the dashboard.

## Testing / verification

Manual verification in the running app (no automated test harness for this view):
1. Open Analisa tab as an admin/HR role that sees the ranking section.
2. Confirm each card shows "Lihat semua →" and is clickable.
3. Click each card → modal opens with the full per-person approved-only list, correctly
   sorted, medals on top 3.
4. Change category filter (Doktor/Admin/Operasi) then reopen → list reflects the filter.
5. Confirm a rejected/cancelled leave for a staff member is **not** counted, and a person
   with two approved AL records appears once with summed days and "(2 permohonan)".
6. Confirm card Top 3 now matches the first 3 rows of the modal.
7. Close via ✕ and via click-outside.
