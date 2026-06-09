const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

const NL = '\r\n';

// Find and replace the old stateGroupedHtml block
const oldBlock = content.slice(
  content.indexOf('      // Pre-compute state-grouped staff HTML'),
  content.indexOf('      return `\n        <div style="display: flex; gap: 0.5rem; justify-content: space-between;')
);

if (!oldBlock || oldBlock.length < 100) {
  console.log('Old block not found, length:', oldBlock ? oldBlock.length : 0);
  process.exit(1);
}

const newBlock = `      // Build accordion-style state->branch grouped staff view
      let branchIdCounter = 0;
      const stateGroupedHtml = ['Pahang', 'Terengganu'].map(function(stateName) {
        const stateBranches = branches.filter(function(b) { return b.state === stateName; });
        const stateStaff = filteredStaff.filter(function(s) { return stateBranches.some(function(b) { return b.name === s.branch; }); });
        if (stateStaff.length === 0 && !manageSearchQuery && !showInactiveStaff) return '';
        const stateColor = stateName === 'Pahang' ? 'var(--primary)' : '#14b8a6';
        const stateBg = stateName === 'Pahang' ? 'rgba(67,97,238,0.08)' : 'rgba(20,184,166,0.08)';
        const stateAccent = stateName === 'Pahang' ? 'rgba(67,97,238,0.25)' : 'rgba(20,184,166,0.25)';

        const branchPanels = stateBranches.map(function(branchObj) {
          const branchStaff = filteredStaff.filter(function(s) { return s.branch === branchObj.name; });
          if (branchStaff.length === 0) return '';
          const bid = 'b' + (++branchIdCounter);

          const staffRows = branchStaff.map(function(staff) {
            const al = window.getLeaveStats(staff, 'AL');
            const mc = window.getLeaveStats(staff, 'MC');
            const hl = window.getLeaveStats(staff, 'HL');
            const rl = window.getLeaveStats(staff, 'REPLACEMENT');
            const ml = window.getLeaveStats(staff, 'ML');
            const pl = window.getLeaveStats(staff, 'PL');
            const el = window.getLeaveStats(staff, 'EL_EMG');
            const bl = window.getLeaveStats(staff, 'EL');
            const ul = window.getLeaveStats(staff, 'UP');
            const cfEnt = staff.ent_CF || 0;
            const inactive = staff.inactive ? ' <span style="background:rgba(239,68,68,0.12);color:var(--danger);font-size:0.75rem;padding:0.1rem 0.35rem;border-radius:4px;font-weight:600;border:1px solid rgba(239,68,68,0.2);vertical-align:middle;">TIDAK AKTIF</span>' : '';
            const td = 'style="padding:0.3rem 0.5rem;font-size:0.82rem;"';
            return '<tr style="border-bottom:1px solid rgba(163,177,198,0.2);">'
              + '<td style="padding:0.3rem 0.5rem;font-size:0.82rem;position:sticky;left:0;background:rgba(224,229,236,0.97);z-index:5;font-weight:600;white-space:nowrap;">' + staff.name + inactive + '</td>'
              + '<td ' + td + '>' + staff.ic + '</td>'
              + '<td ' + td + '><span style="font-size:0.78rem;font-weight:600;color:var(--primary);text-transform:capitalize;">' + staff.role + '</span><br><span style="font-size:0.75rem;color:var(--text-muted);">' + staff.category + '</span></td>'
              + '<td ' + td + '><b style="color:#38bdf8;">' + al.used.toFixed(1) + '</b><span style="color:var(--text-muted);font-size:0.75rem;">/' + al.ent.toFixed(1) + '</span></td>'
              + '<td ' + td + '><b style="color:#10b981;">' + mc.used + '</b><span style="color:var(--text-muted);font-size:0.75rem;">/' + mc.ent + '</span></td>'
              + '<td ' + td + '><b style="color:#06b6d4;">' + hl.used + '</b><span style="color:var(--text-muted);font-size:0.75rem;">/' + hl.ent + '</span></td>'
              + '<td ' + td + '><b style="color:#14b8a6;">' + rl.used + '</b></td>'
              + '<td ' + td + '><b style="color:#ec4899;">' + ml.used + '</b><span style="color:var(--text-muted);font-size:0.75rem;">/' + ml.ent + '</span></td>'
              + '<td ' + td + '><b style="color:#f472b6;">' + pl.used + '</b></td>'
              + '<td ' + td + '><b style="color:#f59e0b;">' + el.used + '</b></td>'
              + '<td ' + td + '><b style="color:#fbbf24;">' + bl.used + '</b><span style="color:var(--text-muted);font-size:0.75rem;">/' + bl.ent + '</span></td>'
              + '<td ' + td + '><b style="color:#94a3b8;">' + ul.used + '</b></td>'
              + '<td ' + td + '><b style="color:#818cf8;">' + cfEnt + '</b></td>'
              + '<td style="padding:0.3rem 0.5rem;text-align:right;position:sticky;right:0;background:rgba(224,229,236,0.97);z-index:5;">'
              + '<button class="btn-logout" onclick="window.setEditingStaff(\'' + staff.ic + '\')" style="width:auto;padding:0.2rem 0.6rem;font-size:0.78rem;">Edit</button>'
              + '</td>'
              + '</tr>';
          }).join('');

          const th = 'style="padding:0.35rem 0.5rem;font-size:0.78rem;font-weight:600;white-space:nowrap;"';
          const table = '<div style="overflow-x:auto;">'
            + '<table style="width:100%;border-collapse:collapse;min-width:950px;">'
            + '<thead><tr style="background:#1e3a8a;color:#fff;">'
            + '<th style="padding:0.35rem 0.5rem;font-size:0.78rem;font-weight:600;position:sticky;left:0;background:#1e3a8a;z-index:10;white-space:nowrap;">Nama</th>'
            + '<th ' + th + '>No. IC</th>'
            + '<th ' + th + '>Jawatan</th>'
            + '<th ' + th + ' style="color:#93c5fd;">AL</th>'
            + '<th ' + th + ' style="color:#6ee7b7;">MC</th>'
            + '<th ' + th + ' style="color:#67e8f9;">HL</th>'
            + '<th ' + th + ' style="color:#5eead4;">RL</th>'
            + '<th ' + th + ' style="color:#f9a8d4;">ML</th>'
            + '<th ' + th + ' style="color:#f0abfc;">PL</th>'
            + '<th ' + th + ' style="color:#fcd34d;">EL</th>'
            + '<th ' + th + ' style="color:#fde68a;">BL</th>'
            + '<th ' + th + ' style="color:#cbd5e1;">UL</th>'
            + '<th ' + th + ' style="color:#c4b5fd;">CF</th>'
            + '<th style="padding:0.35rem 0.5rem;font-size:0.78rem;text-align:right;position:sticky;right:0;background:#1e3a8a;z-index:10;"></th>'
            + '</tr></thead>'
            + '<tbody>' + staffRows + '</tbody>'
            + '</table></div>';

          return '<div style="border:1px solid rgba(163,177,198,0.35);border-radius:10px;margin-bottom:0.5rem;overflow:hidden;">'
            + '<div onclick="window.toggleBranch(\'' + bid + '\')" style="display:flex;align-items:center;justify-content:space-between;padding:0.6rem 1rem;background:rgba(255,255,255,0.5);cursor:pointer;user-select:none;">'
            + '<div style="display:flex;align-items:center;gap:0.6rem;">'
            + '<i data-lucide="building-2" width="14" height="14" style="color:var(--text-muted);flex-shrink:0;"></i>'
            + '<span style="font-size:0.9rem;font-weight:600;color:var(--text-soft);">' + branchObj.name + '</span>'
            + '<span style="font-size:0.78rem;font-weight:500;color:var(--text-muted);background:rgba(163,177,198,0.25);padding:0.15rem 0.5rem;border-radius:999px;">' + branchStaff.length + ' staf</span>'
            + '</div>'
            + '<i id="bch-' + bid + '" data-lucide="chevron-down" width="16" height="16" style="color:var(--text-muted);transition:transform 0.2s;"></i>'
            + '</div>'
            + '<div id="bc-' + bid + '" style="display:none;">' + table + '</div>'
            + '</div>';
        }).join('');

        return '<div style="margin-bottom:1.5rem;">'
          + '<div style="display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-bottom:0.75rem;padding:0.6rem 1rem;background:' + stateBg + ';border-radius:10px;border-left:3px solid ' + stateColor + ';">'
          + '<div style="display:flex;align-items:center;gap:0.75rem;">'
          + '<i data-lucide="map-pin" width="16" height="16" style="color:' + stateColor + ';"></i>'
          + '<span style="font-size:1rem;font-weight:700;color:' + stateColor + ';">Negeri ' + stateName + '</span>'
          + '<span style="font-size:0.82rem;color:var(--text-muted);">' + stateStaff.length + ' staf · ' + stateBranches.filter(function(b){ return filteredStaff.some(function(s){ return s.branch===b.name; }); }).length + ' cawangan</span>'
          + '</div>'
          + '</div>'
          + branchPanels
          + '</div>';
      }).join('');

`;

content = content.replace(oldBlock, newBlock);

// Update controls: use regex to handle CRLF and replace the controls div
content = content.replace(
  /(<section class="glass-card">[\r\n\s]+)<div style="display: flex; justify-content: space-between[^<]+<div style="display: flex; align-items: center; gap: 0\.75rem;">[\s\S]*?Cari nama \/ IC[^>]+>[\r\n\s]+<\/div>/,
  function(m, prefix) {
    return prefix + '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem; flex-wrap: wrap; gap: 0.75rem; border-bottom: 1px solid rgba(163,177,198,0.3); padding-bottom: 1rem;">\r\n'
      + '            <div style="display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;">\r\n'
      + '              <div style="display: flex; align-items: center; gap: 0.6rem;">\r\n'
      + '                <div class="neu-toggle ${showInactiveStaff ? \'active\' : \'\'}" onclick="window.toggleInactive()"></div>\r\n'
      + '                <span style="font-size: 0.9rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;">Tidak Aktif</span>\r\n'
      + '              </div>\r\n'
      + '              <button onclick="window.toggleAllBranches(true)" style="padding:0.35rem 0.9rem;border-radius:999px;border:1px solid rgba(163,177,198,0.5);background:rgba(255,255,255,0.5);font-size:0.82rem;font-weight:600;color:var(--text-soft);cursor:pointer;">Buka Semua</button>\r\n'
      + '              <button onclick="window.toggleAllBranches(false)" style="padding:0.35rem 0.9rem;border-radius:999px;border:1px solid rgba(163,177,198,0.5);background:rgba(255,255,255,0.5);font-size:0.82rem;font-weight:600;color:var(--text-soft);cursor:pointer;">Tutup Semua</button>\r\n'
      + '            </div>\r\n'
      + '            <input type="text" id="manage-staff-search" class="neu-inset" placeholder="Cari nama / IC..." value="${manageSearchQuery}" oninput="window.setManageSearch(this.value)" style="width: 200px; padding: 0.45rem 0.9rem; border-radius: 12px; font-size: 0.9rem; color-scheme: light;">\r\n'
      + '          </div>';
  }
);
console.log('Controls updated');

fs.writeFileSync('src/main.js', content, 'utf8');
console.log('Done!');
