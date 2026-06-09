const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

// ── 1. Change `const branches` to `let branches` ──────────────────────────
content = content.replace(
  'const branches = [',
  'let branches = ['
);

// ── 2. Add Firestore branch listener + window functions after initData opens ──
const AFTER_INIT = "async function initData() {\n  console.log('Initializing Firestore listeners...');\n  \n  // Real-time Staff List";
const NEW_BRANCH_LISTENER = `async function initData() {
  console.log('Initializing Firestore listeners...');

  // Branches — Firestore backed (seeds from hardcoded list on first run)
  onSnapshot(collection(db, "branches"), (snapshot) => {
    if (snapshot.empty) {
      // Seed Firestore with default branches (one-time)
      branches.forEach(function(b) {
        const id = b.name.replace(/[^a-zA-Z0-9]/g, '_');
        setDoc(doc(db, "branches", id), { name: b.name, state: b.state, manager: b.manager || 'Admin' });
      });
    } else {
      branches = snapshot.docs.map(function(d) {
        return Object.assign({}, d.data(), { docId: d.id });
      });
    }
    render();
  });

  // Real-time Staff List`;

if (!content.includes(AFTER_INIT)) {
  // Try with \r\n
  const alt = "async function initData() {\r\n  console.log('Initializing Firestore listeners...');\r\n  \r\n  // Real-time Staff List";
  if (!content.includes(alt)) { console.log('initData anchor not found'); process.exit(1); }
  content = content.replace(alt, NEW_BRANCH_LISTENER.replace(/\n/g, '\r\n'));
} else {
  content = content.replace(AFTER_INIT, NEW_BRANCH_LISTENER);
}
console.log('✓ Branch Firestore listener added');

// ── 3. Add window functions for branch editing ────────────────────────────
const AFTER_TOGGLE_ALL = "window.toggleAllBranches = function(show) {\n  document.querySelectorAll('[id^=\"bc-\"]').forEach(function(el) { el.style.display = show ? 'block' : 'none'; });\n  document.querySelectorAll('[id^=\"bch-\"]').forEach(function(el) { el.style.transform = show ? 'rotate(180deg)' : 'rotate(0deg)'; });\n};";

const BRANCH_WINDOW_FNS = `window.toggleAllBranches = function(show) {
  document.querySelectorAll('[id^="bc-"]').forEach(function(el) { el.style.display = show ? 'block' : 'none'; });
  document.querySelectorAll('[id^="bch-"]').forEach(function(el) { el.style.transform = show ? 'rotate(180deg)' : 'rotate(0deg)'; });
};

window.saveBranchState = async function(docId, newState) {
  try {
    await updateDoc(doc(db, "branches", docId), { state: newState });
  } catch(e) { alert('Gagal simpan negeri: ' + e.message); }
};

window.addNewBranch = async function() {
  const nameEl = document.getElementById('new-branch-name');
  const stateEl = document.getElementById('new-branch-state');
  if (!nameEl || !stateEl) return;
  const name = nameEl.value.trim();
  const state = stateEl.value;
  if (!name) return;
  const id = name.replace(/[^a-zA-Z0-9]/g, '_') + '_' + Date.now();
  await setDoc(doc(db, "branches", id), { name, state, manager: user ? user.name : 'Admin' });
  nameEl.value = '';
};

window.deleteBranchById = async function(docId, branchName) {
  if (!confirm('Padam cawangan "' + branchName + '"?')) return;
  try {
    await deleteDoc(doc(db, "branches", docId));
  } catch(e) { alert('Gagal padam: ' + e.message); }
};`;

// Find toggleAllBranches in file (handle \r\n)
const toggleIdx = content.indexOf('window.toggleAllBranches = function(show)');
if (toggleIdx < 0) { console.log('toggleAllBranches not found'); process.exit(1); }
const endOfToggle = content.indexOf('};', toggleIdx) + 2;
content = content.slice(0, endOfToggle) + '\n\n' + BRANCH_WINDOW_FNS.replace(/^window\.toggleAllBranches[\s\S]*?^};/m, '').trimStart() + content.slice(endOfToggle);
// Actually just replace the toggleAllBranches block with the full set
content = content.replace(
  /window\.toggleAllBranches = function\(show\) \{[\s\S]*?\};/,
  BRANCH_WINDOW_FNS
);
console.log('✓ Branch window functions added');

// ── 4. Replace the Branches tab HTML ─────────────────────────────────────
const MALAYSIAN_STATES = ['Pahang','Terengganu','Kelantan','Perak','Selangor','Negeri Sembilan','Melaka','Johor','Kedah','Perlis','Pulau Pinang','Sabah','Sarawak','Kuala Lumpur','Putrajaya'];

const stateOptions = MALAYSIAN_STATES.map(function(s) {
  return '<option value="' + s + '">' + s + '</option>';
}).join('');

const NEW_BRANCHES_TAB = `        \${managementTab === 'branches' ? \`
        <header class="top-bar" style="margin-bottom: 1rem;">
          <h1>Pengurusan Cawangan</h1>
          \${canManageBranches ? \`
          <div style="display:flex;gap:0.6rem;align-items:center;flex-wrap:wrap;">
            <input id="new-branch-name" type="text" class="neu-inset" placeholder="Nama cawangan baru..." style="padding:0.45rem 0.9rem;border-radius:10px;font-size:0.88rem;width:220px;color-scheme:light;">
            <select id="new-branch-state" class="neu-inset" style="padding:0.45rem 0.9rem;border-radius:10px;font-size:0.88rem;color-scheme:light;cursor:pointer;">
              ${stateOptions}
            </select>
            <button onclick="window.addNewBranch()" class="btn-primary" style="width:auto;padding:0.45rem 1rem;font-size:0.88rem;">+ Tambah</button>
          </div>
          \` : ''}
        </header>

        <section class="glass-card" style="padding:1rem 1.25rem;">
          \${['Pahang','Terengganu'].concat(
            [...new Set(branches.filter(b => b.state !== 'Pahang' && b.state !== 'Terengganu').map(b => b.state))]
          ).map(stateName => {
            const stateBranches = branches.filter(b => b.state === stateName);
            if (stateBranches.length === 0) return '';
            const stateColor = stateName === 'Pahang' ? '#4361ee' : stateName === 'Terengganu' ? '#0d9488' : '#7c3aed';
            const stateBg    = stateName === 'Pahang' ? 'rgba(67,97,238,0.07)' : stateName === 'Terengganu' ? 'rgba(13,148,136,0.07)' : 'rgba(124,58,237,0.07)';
            return \`
            <div style="margin-bottom:1.25rem;">
              <div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:0.6rem;padding:0.45rem 0.9rem;background:\${stateBg};border-radius:8px;border-left:3px solid \${stateColor};">
                <i data-lucide="map-pin" width="14" height="14" style="color:\${stateColor};"></i>
                <span style="font-size:0.9rem;font-weight:700;color:\${stateColor};">Negeri \${stateName}</span>
                <span style="font-size:0.75rem;color:var(--text-muted);">\${stateBranches.length} cawangan</span>
              </div>
              \${stateBranches.map(b => \`
              <div style="display:flex;align-items:center;gap:0.6rem;padding:0.55rem 0.9rem;border-bottom:1px solid rgba(163,177,198,0.15);flex-wrap:wrap;">
                <i data-lucide="building-2" width="13" height="13" style="color:var(--text-muted);flex-shrink:0;"></i>
                <span style="flex:1;font-size:0.85rem;font-weight:600;color:var(--text);min-width:150px;">\${b.name}</span>
                \${canManageBranches && b.docId ? \`
                <select onchange="window.saveBranchState('\${b.docId}', this.value)" style="padding:0.25rem 0.5rem;border-radius:8px;border:1px solid rgba(163,177,198,0.5);background:rgba(255,255,255,0.7);color:var(--text);font-size:0.78rem;cursor:pointer;color-scheme:light;">
                  ${stateOptions.replace(/<option /g, "<option '\" + (b.state === '").replace(/>(.*?)<\/option>/g, "' selected : '') + \">")}
                  \${[${MALAYSIAN_STATES.map(s => "'" + s + "'").join(',')}].map(s => '<option value="' + s + '"' + (b.state === s ? ' selected' : '') + '>' + s + '</option>').join('')}
                </select>
                <button onclick="window.deleteBranchById('\${b.docId}','\${b.name.replace(/'/g,'')}')" style="padding:0.2rem 0.5rem;border-radius:6px;border:1px solid rgba(239,68,68,0.3);background:rgba(239,68,68,0.08);color:#ef4444;font-size:0.72rem;cursor:pointer;">Padam</button>
                \` : \`<span style="font-size:0.75rem;color:var(--text-muted);">\${b.state}</span>\`}
              </div>\`).join('')}
            </div>\`;
          }).join('')}
        </section>
        \` : ''}`;

// Replace old branches tab
const OLD_BRANCHES_START = "${managementTab === 'branches' ? `";
const OLD_BRANCHES_END_MARKER = "` : ''}\n\n        ${managementTab === 'access_control'";

// Find the branches section more precisely
const branchesIdx = content.indexOf("${managementTab === 'branches' ? `\n        <section class=\"glass-card\">\n          <h3>Branches");
if (branchesIdx < 0) {
  console.log('Branches tab not found, searching...');
  const idx = content.indexOf("Branches & Log Preview");
  console.log('Branches Log Preview idx:', idx);
  const ctx = content.slice(idx - 200, idx + 50);
  console.log('Context:', ctx.replace(/\r\n/g, '\\n'));
  process.exit(1);
}

const branchesEndIdx = content.indexOf("` : ''}\n\n        ${managementTab === 'access_control'", branchesIdx);
const branchesEndIdx2 = content.indexOf("` : ''}\r\n\r\n        ${managementTab === 'access_control'", branchesIdx);
const branchesEnd = branchesEndIdx >= 0 ? branchesEndIdx : branchesEndIdx2;

if (branchesEnd < 0) {
  console.log('Branches end not found');
  process.exit(1);
}

const endLen = content[branchesEnd + 7] === '\r' ? "` : ''}\r\n\r\n        ${managementTab === 'access_control'".length : "` : ''}\n\n        ${managementTab === 'access_control'".length;

const NL = content.includes('\r\n') ? '\r\n' : '\n';
content = content.slice(0, branchesIdx)
  + NEW_BRANCHES_TAB + NL + NL
  + '        ${managementTab === \'access_control\''
  + content.slice(branchesEnd + endLen);

console.log('✓ Branches tab replaced');
fs.writeFileSync('src/main.js', content, 'utf8');
console.log('Done! Lines:', content.split('\n').length);
