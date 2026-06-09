# Messenger Online Staff Chips — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the compact online-users bar in the messenger with a horizontal scrollable chip row where each chip shows a staff member's first name and opens a DM on click.

**Architecture:** Two edits only — update CSS classes in `src/style.css` and replace the online-bar IIFE in `renderMessengerView()` in `src/main.js`. No new state, no new functions, no Firebase changes.

**Tech Stack:** Vanilla JS, CSS, Vite

---

### Task 1: Replace CSS — online bar → chip row

**Files:**
- Modify: `src/style.css:813-840`

- [ ] **Step 1: Open `src/style.css` and find the online bar block**

  Locate lines 813–840. They look like this:

  ```css
  .msg-online-bar {
    display: flex; align-items: center; gap: 0.5rem;
    background: rgba(34,197,94,0.08);
    border: 1px solid rgba(34,197,94,0.2);
    border-radius: 10px;
    padding: 0.35rem 0.65rem;
    margin-top: 0.1rem;
  }
  .msg-online-pulse { ... }
  @keyframes onlinePulse { ... }
  .msg-online-mini-avatar {
    width: 22px; height: 22px; border-radius: 50%;
    background: linear-gradient(135deg, #4361ee, #7209b7);
    color: white; font-size: 0.65rem; font-weight: 700;
    display: flex; align-items: center; justify-content: center;
    border: 2px solid var(--surface);
    margin-left: -4px; flex-shrink: 0;
  }
  .msg-online-mini-avatar:first-child { margin-left: 0; }
  ```

- [ ] **Step 2: Replace `.msg-online-bar` and `.msg-online-mini-avatar` blocks**

  Keep `.msg-online-pulse` and `@keyframes onlinePulse` untouched. Replace only `.msg-online-bar`, `.msg-online-mini-avatar`, and `.msg-online-mini-avatar:first-child` with:

  ```css
  .msg-online-chips-bar {
    display: flex; align-items: center; gap: 0.5rem;
    padding: 0.35rem 0;
    margin-top: 0.1rem;
    overflow: hidden;
  }
  .msg-online-chips-scroll {
    display: flex; gap: 0.4rem;
    overflow-x: auto; padding-bottom: 2px;
    scrollbar-width: none;
  }
  .msg-online-chips-scroll::-webkit-scrollbar { display: none; }
  .msg-online-chip {
    display: inline-flex; align-items: center; gap: 0.3rem;
    padding: 0.25rem 0.65rem;
    border-radius: 20px;
    background: rgba(34,197,94,0.1);
    border: 1px solid rgba(34,197,94,0.25);
    color: #16a34a;
    font-size: 0.75rem; font-weight: 700;
    cursor: pointer; white-space: nowrap;
    font-family: inherit;
    transition: background 0.15s;
    flex-shrink: 0;
  }
  .msg-online-chip:hover { background: rgba(34,197,94,0.2); }
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add src/style.css
  git commit -m "style: replace online bar with chip row CSS"
  ```

---

### Task 2: Replace HTML — online bar IIFE in renderMessengerView()

**Files:**
- Modify: `src/main.js:3539-3554`

- [ ] **Step 1: Locate the existing IIFE in `renderMessengerView()`**

  Around line 3539 inside `renderMessengerView()`, find this block:

  ```js
  ${(function() {
    const onlineOthers = Object.values(onlineUsers).filter(u => u.ic !== user.ic);
    const onlineCount = onlineOthers.length + (onlineUsers[user.ic] ? 1 : 0);
    if (onlineCount === 0) return '';
    const avatars = onlineOthers.slice(0, 5);
    return `<div class="msg-online-bar">
      <div style="display:flex;align-items:center;gap:0.3rem;flex:1;min-width:0;">
        <span class="msg-online-pulse"></span>
        <span style="font-size:0.78rem;font-weight:700;color:#16a34a;">${onlineCount} Sedang Online</span>
      </div>
      <div style="display:flex;gap:-4px;">
        ${avatars.map(u => `<div class="msg-online-mini-avatar" title="${u.name}">${(u.name||'?')[0]}</div>`).join('')}
        ${onlineOthers.length > 5 ? `<div class="msg-online-mini-avatar" style="background:rgba(163,177,198,0.3);color:var(--text-muted);font-size:0.6rem;">+${onlineOthers.length - 5}</div>` : ''}
      </div>
    </div>`;
  })()}
  ```

- [ ] **Step 2: Replace the entire IIFE with the chip row version**

  ```js
  ${(function() {
    const onlineOthers = Object.values(onlineUsers).filter(u => u.ic !== user.ic);
    if (onlineOthers.length === 0) return '';
    return `<div class="msg-online-chips-bar">
      <span class="msg-online-pulse" style="flex-shrink:0;"></span>
      <span style="font-size:0.75rem;font-weight:700;color:#16a34a;flex-shrink:0;">Online:</span>
      <div class="msg-online-chips-scroll">
        ${onlineOthers.map(u => {
          const firstName = (u.name || '?').split(' ')[0];
          return `<button class="msg-online-chip" onclick="window.openDM('${u.ic}','${(u.name||'').replace(/'/g,"\\'")}');event.stopPropagation();" title="${u.name} — ${u.branch||''}"><span style="width:7px;height:7px;border-radius:50%;background:#22c55e;flex-shrink:0;display:inline-block;"></span>${firstName}</button>`;
        }).join('')}
      </div>
    </div>`;
  })()}
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add src/main.js
  git commit -m "feat: messenger online staff chip row"
  ```

---

### Task 3: Build and deploy

- [ ] **Step 1: Build**

  ```bash
  npm run build
  ```

  Expected: `✓ built in ~500ms` with no errors.

- [ ] **Step 2: Deploy**

  ```bash
  npx firebase deploy --only hosting
  ```

  Expected: `+ Deploy complete!`

- [ ] **Step 3: Verify in browser**

  Open the live URL. Navigate to Messenger. If another account is online, the chip row should appear below the "Messenger" heading. Click a chip — it should open the DM panel with that staff member.

  If you have only one account available, open a second browser tab, log in as another staff, and confirm both tabs show each other's chip.
