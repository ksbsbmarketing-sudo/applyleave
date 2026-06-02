# Messenger Online Staff Chips

**Date:** 2026-06-02  
**Status:** Approved

## Problem

The messenger rooms panel lists all staff alphabetically in the DM section. Online staff are indicated by a green dot, but finding them requires scrolling through the entire list. The existing compact online bar only shows a count + mini-avatars with no interaction.

## Solution

Replace the existing online bar (count + mini-avatars) with a **horizontal scrollable chip row**. Each chip represents one online staff member (excluding self) and opens a DM on click.

## UI Layout

```
┌──────────────────────────────────────────────────┐
│ 💬 Messenger                                      │
│                                                   │
│ ● Online:  [● Ali]  [● Siti]  [● Ahmad]  →→      │
│            ← swipe/scroll horizontal →            │
└──────────────────────────────────────────────────┘
```

- Hidden when no other staff is online
- Label "● Online:" fixed on the left
- Chips scroll horizontally (overflow-x: auto, no visible scrollbar)
- Each chip: green dot + first word of name
- Click chip → `window.openDM(ic, name)`

## Scope

**In scope:**
- Replace existing online bar HTML in `renderMessengerView()` (~lines 3539–3554 in `src/main.js`)
- CSS for chips (inline styles, consistent with existing messenger style)

**Out of scope:**
- Changes to presence logic (`initPresence`, `onlineUsers`)
- Changes to DM list sort order
- Mobile/desktop layout changes

## Data

`onlineUsers` is already populated: `{ [ic]: { ic, name, branch, role, lastSeen } }`  
Filter: `Object.values(onlineUsers).filter(u => u.ic !== user.ic)`

## Implementation

Single edit in `renderMessengerView()` — replace the IIFE that builds the online bar with the new chip row HTML.

No new state, no new functions, no Firebase changes.
