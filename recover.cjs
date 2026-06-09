const fs = require('fs');
const { execSync } = require('child_process');

// Get current truncated working file (has accordion + everything before return)
const current = fs.readFileSync('src/main.js', 'utf8');
console.log('Current file lines:', current.split('\n').length);

// Get HEAD version (complete, but dark theme + old staff section)
const headContent = execSync('git show HEAD:src/main.js').toString();
console.log('HEAD file lines:', headContent.split('\n').length);

// Find where current file is cut (ends after stateGroupedHtml }).join(''))
// The current file ends right before the management "return `" template
// Find the equivalent point in HEAD - the "return `" in the management case
const headReturnIdx = headContent.indexOf("      return `\n        <div style=\"display: flex; gap: 0.5rem; justify-content: space-between; align-items: center; margin-bottom: 2.5rem; background: rgba(0,0,0,0.3);");
if (headReturnIdx < 0) {
  // Try CRLF version
  const alt = headContent.indexOf("      return `\r\n        <div style=\"display: flex;");
  console.log('CRLF idx:', alt);
  // Find another anchor
  const anchor = headContent.indexOf("      return `\r\n        <div style=");
  console.log('Alt anchor:', anchor);
  // Just find the management return
  const mgtReturn = headContent.indexOf('manage_pending ? `\r\n                 <button class="neu-tab');
  const mgtReturn2 = headContent.indexOf("manage_pending ? `");
  console.log('mgtReturn:', mgtReturn, mgtReturn2);
}
console.log('HEAD return idx:', headReturnIdx);

// Find anchor: the "      }\n        \n      return `" block in HEAD
const NL = headContent.includes('\r\n') ? '\r\n' : '\n';
console.log('Line endings:', NL === '\r\n' ? 'CRLF' : 'LF');

// Find the management return in HEAD
let mgtReturnIdx = -1;
const searchStr = '      }' + NL + '        ' + NL + '      return `';
mgtReturnIdx = headContent.indexOf(searchStr);
console.log('Management return idx (via searchStr):', mgtReturnIdx);

if (mgtReturnIdx < 0) {
  // Alternative: find by scanning for the specific return
  const lines = headContent.split(NL);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === 'return `' && lines[i+1] && lines[i+1].includes('display: flex; gap: 0.5rem;')) {
      mgtReturnIdx = lines.slice(0, i).join(NL).length + (i > 0 ? NL.length : 0);
      console.log('Found at line:', i);
      break;
    }
  }
}

if (mgtReturnIdx < 0) {
  console.log('Cannot find management return in HEAD. Trying regex...');
  const match = headContent.match(/      return `\r?\n        <div style="display: flex; gap: 0\.5rem;/);
  if (match) {
    mgtReturnIdx = match.index;
    console.log('Regex found at:', mgtReturnIdx);
  }
}

if (mgtReturnIdx < 0) {
  console.log('FAILED to find anchor. Dumping context...');
  // Show content around likely location
  const idx = headContent.indexOf('filteredStaff.filter(s => !s.inactive)');
  console.log('filteredStaff inactive idx:', idx);
  console.log('Context:', JSON.stringify(headContent.slice(idx, idx+200)));
  process.exit(1);
}

// Extract the HEAD tail (from management return to end)
const headTail = headContent.slice(mgtReturnIdx);
console.log('HEAD tail lines:', headTail.split('\n').length);

// Now splice current + head tail
// But we need to fix the staff section in the head tail
// The staff section in HEAD uses old flat table code
// We need to replace it with the new accordion section

// Find staff section in head tail
const staffSectionRe = /\$\{managementTab === 'staff' \? `[\s\S]*?` : ''\}/;
const staffMatch = headTail.match(staffSectionRe);
if (!staffMatch) {
  console.log('Staff section not found in head tail');
} else {
  console.log('Staff section found, length:', staffMatch[0].length);
}

// The new staff section (with accordion reference and correct controls)
const newStaffSection = `\${managementTab === 'staff' ? \`
        <header class="top-bar">
          <h1>Management Hub</h1>
          <button class="btn-primary" onclick="window.openAddStaff()" style="width: auto; padding: 0.75rem 1.5rem;">+ Tambah Staf</button>
        </header>

        <section class="glass-card">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem; flex-wrap: wrap; gap: 0.75rem; border-bottom: 1px solid rgba(163,177,198,0.3); padding-bottom: 1rem;">
            <div style="display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;">
              <div style="display: flex; align-items: center; gap: 0.6rem;">
                <div class="neu-toggle \${showInactiveStaff ? 'active' : ''}" onclick="window.toggleInactive()"></div>
                <span style="font-size: 0.9rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;">Tidak Aktif</span>
              </div>
              <button onclick="window.toggleAllBranches(true)" style="padding:0.35rem 0.9rem;border-radius:999px;border:1px solid rgba(163,177,198,0.5);background:rgba(255,255,255,0.5);font-size:0.82rem;font-weight:600;color:var(--text-soft);cursor:pointer;">Buka Semua</button>
              <button onclick="window.toggleAllBranches(false)" style="padding:0.35rem 0.9rem;border-radius:999px;border:1px solid rgba(163,177,198,0.5);background:rgba(255,255,255,0.5);font-size:0.82rem;font-weight:600;color:var(--text-soft);cursor:pointer;">Tutup Semua</button>
            </div>
            <input type="text" id="manage-staff-search" class="neu-inset" placeholder="Cari nama / IC..." value="\${manageSearchQuery}" oninput="window.setManageSearch(this.value)" style="width: 200px; padding: 0.45rem 0.9rem; border-radius: 12px; font-size: 0.9rem; color-scheme: light;">
          </div>
          \${stateGroupedHtml}
        </section>
        \` : ''}`;

let fixedTail = headTail;
if (staffMatch) {
  fixedTail = fixedTail.replace(staffSectionRe, newStaffSection);
  console.log('Staff section replaced.');
} else {
  console.log('WARNING: Staff section not replaced!');
}

// Apply light neumorphism color fixes to the tail
const colorFixes = [
  // Tab nav background
  ['background: rgba(0,0,0,0.3)', 'background: rgba(163,177,198,0.25)'],
  ['border: 1px solid rgba(255,255,255,0.05)', 'border: 1px solid rgba(163,177,198,0.5)'],
  // Common dark-theme patterns in the management template
  ['background: rgba(255,255,255,0.03)', 'background: rgba(163,177,198,0.08)'],
  ['rgba(255,255,255,0.06)', 'rgba(163,177,198,0.15)'],
  ['rgba(255,255,255,0.08)', 'rgba(163,177,198,0.2)'],
];

for (const [from, to] of colorFixes) {
  const count = (fixedTail.split(from).length - 1);
  if (count > 0) {
    fixedTail = fixedTail.split(from).join(to);
    console.log('Color fix:', from.slice(0,40), '->', count, 'replacements');
  }
}

// Stitch: current (without trailing newlines) + fixed tail
const combined = current.trimEnd() + NL + NL + fixedTail;
fs.writeFileSync('src/main.js', combined, 'utf8');
console.log('Done! Combined file lines:', combined.split('\n').length);
