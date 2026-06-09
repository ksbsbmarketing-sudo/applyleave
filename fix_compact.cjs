const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

// Replace the entire stateGroupedHtml computation block
const OLD_START = '      // Build accordion-style state->branch grouped staff view';
const OLD_END   = '      }).join(\'\');\r\n\r\n      return `';

const startIdx = content.indexOf(OLD_START);
const endIdx   = content.indexOf(OLD_END);
if (startIdx < 0 || endIdx < 0) {
  console.log('Markers not found', startIdx, endIdx);
  process.exit(1);
}

const before = content.slice(0, startIdx);
const after  = content.slice(endIdx + OLD_END.length);

const newBlock = `      // Staff management: accordion by state > branch, compact card rows
      let branchIdCounter = 0;
      const stateGroupedHtml = ['Pahang', 'Terengganu'].map(function(stateName) {
        const stateBranches = branches.filter(function(b) { return b.state === stateName; });
        const stateStaff = filteredStaff.filter(function(s) { return stateBranches.some(function(b) { return b.name === s.branch; }); });
        if (stateStaff.length === 0) return '';
        const stateColor = stateName === 'Pahang' ? '#4361ee' : '#0d9488';
        const stateBg    = stateName === 'Pahang' ? 'rgba(67,97,238,0.07)' : 'rgba(13,148,136,0.07)';
        const stateBar   = stateName === 'Pahang' ? '#4361ee' : '#0d9488';

        const branchPanels = stateBranches.map(function(branchObj) {
          const branchStaff = filteredStaff.filter(function(s) { return s.branch === branchObj.name; });
          if (branchStaff.length === 0) return '';
          const bid = 'b' + (++branchIdCounter);

          // Role mini-summary for accordion header
          const roleCounts = {};
          branchStaff.forEach(function(s) {
            const cat = s.category || s.role || 'Lain';
            roleCounts[cat] = (roleCounts[cat] || 0) + 1;
          });
          const rolePills = Object.keys(roleCounts).map(function(cat) {
            return '<span style="font-size:0.7rem;color:var(--text-muted);background:rgba(163,177,198,0.25);padding:0.1rem 0.45rem;border-radius:999px;white-space:nowrap;">'
              + roleCounts[cat] + ' ' + cat + '</span>';
          }).join(' ');

          // Compact card rows (no table, no horizontal scroll)
          const staffRows = branchStaff.map(function(staff) {
            const al = window.getLeaveStats(staff, 'AL');
            const mc = window.getLeaveStats(staff, 'MC');
            const hl = window.getLeaveStats(staff, 'HL');
            const alLow = al.bal <= 3 && al.ent > 0;
            const inBadge = staff.inactive
              ? '<span style="background:rgba(239,68,68,0.1);color:#ef4444;font-size:0.68rem;padding:0.08rem 0.35rem;border-radius:4px;font-weight:700;border:1px solid rgba(239,68,68,0.2);vertical-align:middle;margin-left:4px;">TIDAK AKTIF</span>'
              : '';
            return '<div style="display:flex;align-items:center;gap:0.75rem;padding:0.55rem 0.9rem;border-bottom:1px solid rgba(163,177,198,0.15);">'
              // Name + role
              + '<div style="flex:1;min-width:0;">'
              +   '<div style="font-size:0.85rem;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + staff.name + inBadge + '</div>'
              +   '<div style="display:flex;align-items:center;gap:0.35rem;margin-top:0.15rem;">'
              +     '<span style="font-size:0.7rem;font-weight:600;color:#fff;background:#4361ee;padding:0.08rem 0.4rem;border-radius:4px;text-transform:capitalize;">' + (staff.role || '-') + '</span>'
              +     '<span style="font-size:0.7rem;color:var(--text-muted);">' + (staff.category || '') + '</span>'
              +   '</div>'
              + '</div>'
              // AL / MC / HL compact stats
              + '<div style="display:flex;gap:0.5rem;align-items:center;flex-shrink:0;">'
              +   statCell('AL', al.used.toFixed(1), al.ent.toFixed(1), alLow ? '#ef4444' : '#38bdf8')
              +   statCell('MC', mc.used, mc.ent, '#10b981')
              +   statCell('HL', hl.used, hl.ent, '#06b6d4')
              + '</div>'
              // Edit button
              + '<button class="btn-logout" data-ic="' + staff.ic + '" onclick="window.setEditingStaff(this.dataset.ic)" style="flex-shrink:0;width:auto;padding:0.2rem 0.65rem;font-size:0.75rem;">Edit</button>'
              + '</div>';
          }).join('');

          function statCell(label, used, ent, color) {
            return '<div style="text-align:center;min-width:38px;">'
              +   '<div style="font-size:0.62rem;font-weight:600;color:var(--text-muted);letter-spacing:0.3px;">' + label + '</div>'
              +   '<div style="font-size:0.8rem;font-weight:700;color:' + color + ';line-height:1.1;">' + used
              +     '<span style="font-size:0.6rem;color:var(--text-muted);font-weight:400;">/' + ent + '</span>'
              +   '</div>'
              + '</div>';
          }

          // Accordion wrapper
          return '<div style="border:1px solid rgba(163,177,198,0.3);border-radius:10px;margin-bottom:0.4rem;overflow:hidden;">'
            // Header (clickable)
            + '<div data-bid="' + bid + '" onclick="window.toggleBranch(this.dataset.bid)"'
            +   ' style="display:flex;align-items:center;justify-content:space-between;padding:0.55rem 0.9rem;background:rgba(255,255,255,0.55);cursor:pointer;user-select:none;gap:0.75rem;">'
            +   '<div style="display:flex;align-items:center;gap:0.6rem;flex-wrap:wrap;flex:1;min-width:0;">'
            +     '<i data-lucide="building-2" width="14" height="14" style="color:var(--text-muted);flex-shrink:0;"></i>'
            +     '<span style="font-size:0.88rem;font-weight:700;color:var(--text-soft);white-space:nowrap;">' + branchObj.name + '</span>'
            +     '<span style="font-size:0.72rem;font-weight:600;color:var(--text-muted);background:rgba(163,177,198,0.2);padding:0.1rem 0.5rem;border-radius:999px;">' + branchStaff.length + ' staf</span>'
            +     rolePills
            +   '</div>'
            +   '<i id="bch-' + bid + '" data-lucide="chevron-down" width="15" height="15" style="color:var(--text-muted);transition:transform 0.2s;flex-shrink:0;"></i>'
            + '</div>'
            // Content (collapsed by default)
            + '<div id="bc-' + bid + '" style="display:none;background:#fff;">'
            +   staffRows
            + '</div>'
            + '</div>';
        }).join('');

        // State section header + branch panels
        return '<div style="margin-bottom:1.25rem;">'
          + '<div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:0.5rem;padding:0.5rem 0.9rem;background:' + stateBg + ';border-radius:8px;border-left:3px solid ' + stateBar + ';">'
          +   '<i data-lucide="map-pin" width="14" height="14" style="color:' + stateColor + ';"></i>'
          +   '<span style="font-size:0.9rem;font-weight:700;color:' + stateColor + ';">Negeri ' + stateName + '</span>'
          +   '<span style="font-size:0.75rem;color:var(--text-muted);">' + stateStaff.length + ' staf</span>'
          + '</div>'
          + branchPanels
          + '</div>';
      }).join('');

`;

// Also update the section template controls for cleaner look
const OLD_SECTION = `        <section class="glass-card">
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
        </section>`;

const NEW_SECTION = `        <section class="glass-card" style="padding: 1rem 1.25rem;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;flex-wrap:wrap;gap:0.6rem;">
            <div style="display:flex;align-items:center;gap:0.6rem;flex-wrap:wrap;">
              <button onclick="window.toggleAllBranches(true)" style="padding:0.3rem 0.8rem;border-radius:999px;border:1px solid rgba(163,177,198,0.45);background:rgba(255,255,255,0.6);font-size:0.78rem;font-weight:600;color:var(--text-soft);cursor:pointer;">▼ Buka Semua</button>
              <button onclick="window.toggleAllBranches(false)" style="padding:0.3rem 0.8rem;border-radius:999px;border:1px solid rgba(163,177,198,0.45);background:rgba(255,255,255,0.6);font-size:0.78rem;font-weight:600;color:var(--text-soft);cursor:pointer;">▶ Tutup Semua</button>
              <div style="display:flex;align-items:center;gap:0.4rem;">
                <div class="neu-toggle \${showInactiveStaff ? 'active' : ''}" onclick="window.toggleInactive()"></div>
                <span style="font-size:0.75rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.4px;">Tidak Aktif</span>
              </div>
            </div>
            <input type="text" id="manage-staff-search" class="neu-inset" placeholder="Cari nama / IC..." value="\${manageSearchQuery}" oninput="window.setManageSearch(this.value)" style="width:180px;padding:0.4rem 0.8rem;border-radius:10px;font-size:0.82rem;color-scheme:light;">
          </div>
          \${stateGroupedHtml}
        </section>`;

// Use regex for section replacement (handles CRLF)
const sectionRe = /<section class="glass-card">[\s\S]*?\$\{stateGroupedHtml\}[\s\S]*?<\/section>/;

// Reconstruct file
const newContent = before + newBlock + '      return `' + after;
if (!sectionRe.test(newContent)) {
  console.log('Section regex not found!');
  process.exit(1);
}
const finalContent = newContent.replace(sectionRe, NEW_SECTION);
fs.writeFileSync('src/main.js', finalContent, 'utf8');
console.log('Done! Lines:', finalContent.split('\n').length);
