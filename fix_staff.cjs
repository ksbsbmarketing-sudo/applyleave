const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

// 1. Replace the broken staff block inside the template with a simple reference
const staffBlockRe = /\$\{managementTab === 'staff' \? `[\s\S]*?` : ''\}/;
const match = content.match(staffBlockRe);
if (!match) { console.log('Block not found'); process.exit(1); }

const simpleBlock = `\${managementTab === 'staff' ? \`
        <header class="top-bar">
          <h1>Management Hub</h1>
          <button class="btn-primary" onclick="window.openAddStaff()" style="width: auto; padding: 0.75rem 1.5rem;">+ Tambah Staf</button>
        </header>

        <section class="glass-card">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; flex-wrap: wrap; gap: 1rem; border-bottom: 1px solid rgba(163,177,198,0.3); padding-bottom: 1rem;">
            <div style="display: flex; align-items: center; gap: 0.75rem;">
              <div class="neu-toggle \${showInactiveStaff ? 'active' : ''}" onclick="window.toggleInactive()"></div>
              <span style="font-size: 1rem; font-weight: 600; color: var(--text-muted); letter-spacing: 0.5px; text-transform: uppercase;">Show Inactive</span>
            </div>
            <input type="text" id="manage-staff-search" class="neu-inset" placeholder="Cari nama / IC..." value="\${manageSearchQuery}" oninput="window.setManageSearch(this.value)" style="width: 220px; padding: 0.5rem 1rem; border-radius: 12px; font-size: 0.97rem; color-scheme: light;">
          </div>
          \${stateGroupedHtml}
        </section>
        \` : ''}`;

content = content.replace(staffBlockRe, simpleBlock);

// 2. Build the preCompute string (no template literal nesting issues since this is plain JS)
const preCompute = `
      // Pre-compute state-grouped staff HTML (Pahang then Terengganu, grouped by branch)
      const stateGroupedHtml = ['Pahang', 'Terengganu'].map(function(stateName) {
        const stateBranches = branches.filter(function(b) { return b.state === stateName; });
        const stateStaff = filteredStaff.filter(function(s) { return stateBranches.some(function(b) { return b.name === s.branch; }); });
        const stateColor = stateName === 'Pahang' ? 'var(--primary)' : '#14b8a6';
        const stateBg = stateName === 'Pahang' ? 'rgba(67,97,238,0.1)' : 'rgba(20,184,166,0.1)';
        const stateBorder = stateName === 'Pahang' ? 'rgba(67,97,238,0.4)' : 'rgba(20,184,166,0.4)';

        const branchRows = stateBranches.map(function(branchObj) {
          const branchStaff = filteredStaff.filter(function(s) { return s.branch === branchObj.name; });
          if (branchStaff.length === 0) return '';
          let html = '<tr><td colspan="14" style="background:rgba(255,255,255,0.55);padding:0.55rem 1rem;font-weight:700;font-size:0.95rem;color:var(--text-soft);border-top:2px solid ' + stateBorder + ';border-bottom:1px solid rgba(163,177,198,0.3);">'
            + '<i data-lucide="building-2" width="13" height="13" style="vertical-align:middle;margin-right:6px;"></i>'
            + branchObj.name
            + ' <span style="font-weight:400;color:var(--text-muted);font-size:0.88rem;margin-left:8px;">(' + branchStaff.length + ' staf)</span>'
            + '</td></tr>';
          html += branchStaff.map(function(staff) {
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
            const inactiveBadge = staff.inactive ? '<br><span style="margin-top:4px;display:inline-block;background:rgba(239,68,68,0.1);color:var(--danger);font-size:0.88rem;padding:0.15rem 0.4rem;border-radius:4px;font-weight:600;border:1px solid rgba(239,68,68,0.2);">TIDAK AKTIF</span>' : '';
            return '<tr>'
              + '<td style="position:sticky;left:0;background:rgba(224,229,236,0.95);z-index:5;font-weight:700;backdrop-filter:blur(10px);">' + staff.name + inactiveBadge + '</td>'
              + '<td>' + staff.ic + '</td>'
              + '<td><span class="status-badge approved" style="text-transform:capitalize;margin-bottom:4px;display:inline-block;">' + staff.role + '</span><br><span style="font-size:0.97rem;color:var(--text-muted);">' + staff.category + '</span></td>'
              + '<td><span style="font-weight:700;color:#38bdf8;">' + al.used.toFixed(1) + '</span><span style="font-size:0.97rem;color:var(--text-muted);">/' + al.ent.toFixed(1) + '</span></td>'
              + '<td><span style="font-weight:700;color:#10b981;">' + mc.used + '</span><span style="font-size:0.97rem;color:var(--text-muted);">/' + mc.ent + '</span></td>'
              + '<td><span style="font-weight:700;color:#06b6d4;">' + hl.used + '</span><span style="font-size:0.97rem;color:var(--text-muted);">/' + hl.ent + '</span></td>'
              + '<td><span style="font-weight:700;color:#14b8a6;">' + rl.used + '</span></td>'
              + '<td><span style="font-weight:700;color:#ec4899;">' + ml.used + '</span><span style="font-size:0.97rem;color:var(--text-muted);">/' + ml.ent + '</span></td>'
              + '<td><span style="font-weight:700;color:#f472b6;">' + pl.used + '</span></td>'
              + '<td><span style="font-weight:700;color:#f59e0b;">' + el.used + '</span></td>'
              + '<td><span style="font-weight:700;color:#fbbf24;">' + bl.used + '</span><span style="font-size:0.97rem;color:var(--text-muted);">/' + bl.ent + '</span></td>'
              + '<td><span style="font-weight:700;color:#94a3b8;">' + ul.used + '</span></td>'
              + '<td><span style="font-weight:700;color:#818cf8;">' + cfEnt + '</span></td>'
              + '<td style="text-align:right;position:sticky;right:0;background:rgba(224,229,236,0.95);z-index:5;backdrop-filter:blur(10px);"><button class="btn-logout" onclick="window.setEditingStaff(\\'' + staff.ic + '\\')" style="width:auto;padding:0.25rem 0.75rem;font-size:0.97rem;">Edit</button></td>'
              + '</tr>';
          }).join('');
          return html;
        }).join('');

        return '<div style="margin-bottom:2.5rem;">'
          + '<div style="display:flex;align-items:center;gap:1rem;margin-bottom:1rem;padding:0.75rem 1.25rem;background:' + stateBg + ';border-radius:12px;border-left:4px solid ' + stateColor + ';">'
          + '<i data-lucide="map-pin" width="18" height="18" style="color:' + stateColor + ';"></i>'
          + '<span style="font-size:1.1rem;font-weight:700;color:' + stateColor + ';">Negeri ' + stateName + '</span>'
          + '<span style="font-size:0.97rem;color:var(--text-muted);">' + stateStaff.length + ' staf</span>'
          + '</div>'
          + '<div style="overflow-x:auto;border-radius:12px;border:1px solid ' + stateBorder + ';background:rgba(163,177,198,0.12);">'
          + '<table class="data-table" style="min-width:1200px;">'
          + '<thead><tr>'
          + '<th style="position:sticky;left:0;background:#1e3a8a;z-index:10;">Nama</th>'
          + '<th style="min-width:120px;">No. IC</th>'
          + '<th style="min-width:130px;">Jawatan / Kat</th>'
          + '<th style="min-width:85px;color:#38bdf8;">AL</th>'
          + '<th style="min-width:85px;color:#10b981;">MC</th>'
          + '<th style="min-width:85px;color:#06b6d4;">HL</th>'
          + '<th style="min-width:85px;color:#14b8a6;">RL</th>'
          + '<th style="min-width:85px;color:#ec4899;">ML</th>'
          + '<th style="min-width:85px;color:#f472b6;">PL</th>'
          + '<th style="min-width:85px;color:#f59e0b;">EL</th>'
          + '<th style="min-width:85px;color:#fbbf24;">BL</th>'
          + '<th style="min-width:85px;color:var(--text-muted);">UL</th>'
          + '<th style="min-width:85px;color:#818cf8;">CF</th>'
          + '<th style="text-align:right;position:sticky;right:0;background:#1e3a8a;z-index:10;">Tindakan</th>'
          + '</tr></thead>'
          + '<tbody>'
          + (branchRows || '<tr><td colspan="14" style="text-align:center;padding:2rem;color:var(--text-muted);">Tiada rekod staff.</td></tr>')
          + '</tbody></table></div></div>';
      }).join('');

`;

// Insert before the management return statement
// File uses CRLF line endings
const NL = '\r\n';
const returnMarker = '      if (!showInactiveStaff) {' + NL
  + '          filteredStaff = filteredStaff.filter(s => !s.inactive);' + NL
  + '      }' + NL
  + '        ' + NL
  + '      return `';
if (!content.includes(returnMarker)) {
  const alt = '      if (!showInactiveStaff) {';
  const idx = content.indexOf(alt);
  console.log('Alt marker idx:', idx);
  console.log('Context at idx:', JSON.stringify(content.slice(idx, idx+200)));
  process.exit(1);
}
content = content.replace(returnMarker, returnMarker.replace('      return `', preCompute + '      return `'));

fs.writeFileSync('src/main.js', content, 'utf8');
console.log('Done!');
