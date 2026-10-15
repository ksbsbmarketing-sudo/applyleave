/**
 * Carta Kelulusan Cuti — PDF report generator.
 *
 * Reads the local Firestore snapshots in ./data (refresh them with `npm run pull`)
 * and renders an A4 PDF to the Desktop. Branches are grouped by state so Pahang
 * and Terengganu are reported separately, with Balok (HQ) shown alongside the
 * other branches on a shared scale.
 *
 *   node generate_leave_approval_chart.cjs
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const puppeteer = require("puppeteer");

const ROOT = __dirname;
const OUT = path.join(os.homedir(), "Desktop", "Carta-Kelulusan-Cuti-KSB.pdf");

/* ── Branch registry ────────────────────────────────────────────────────────
   Read from the Firestore `branches` snapshot so the report follows the live
   registry (state assignment included). Branches that show up in staff or leave
   records but not in the registry are listed in the footnote. */
const BRANCHES = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "branches.json"), "utf8"))
  .map((b) => ({ name: b.name, state: b.state }))
  .filter((b) => b.state === "Pahang" || b.state === "Terengganu");

const LEAVE_TYPE_LABEL = {
  AL: "Cuti Tahunan (AL)",
  MC: "Cuti Sakit (MC)",
  EL_EMG: "Cuti Kecemasan (EL)",
  EL: "Cuti Kecemasan (EL)",
  CME: "Cuti CME",
  ML: "Cuti Bersalin (ML)",
  ML_PL: "Cuti Bersalin (ML-PL)",
  PL: "Cuti Isteri Bersalin (PL)",
  HL: "Cuti Hospital (HL)",
  UP: "Cuti Tanpa Gaji (UP)",
  CF: "Cuti Bawa Ke Hadapan (CF)",
  RL: "Cuti Ganti (RL)",
};

/* 'TL APPROVED' is a mid-flow stage (Team Leader endorsed, awaiting the next
   approver) — it is NOT a final approval. See src/main.js:2344. */
const IN_PROGRESS = new Set(["PENDING", "TL APPROVED", "HOD APPROVED", "RECOMMENDED"]);

function bucket(status) {
  const s = String(status || "").toUpperCase();
  if (s === "APPROVED") return "approved";
  if (s === "REJECTED") return "rejected";
  if (s === "CANCELLED") return "cancelled";
  if (IN_PROGRESS.has(s) || s.includes("PENDING") || s.includes("RECOM") || s.includes("HOD")) return "pending";
  return "pending";
}

// ── Load & aggregate ────────────────────────────────────────────────────────
const leaves = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "leaves.json"), "utf8"));
const staff = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "staff.json"), "utf8"));
const snapshotDate = fs.statSync(path.join(ROOT, "data", "leaves.json")).mtime;

const YEAR = String(new Date().getFullYear());
const scoped = leaves.filter((r) => String(r.startDate || "").slice(0, 4) === YEAR);

const blank = () => ({ total: 0, approved: 0, pending: 0, cancelled: 0, rejected: 0, days: 0, staff: 0 });
const byBranch = new Map(BRANCHES.map((b) => [b.name, blank()]));

const unknownBranches = new Set();
for (const s of staff) {
  if (s.inactive) continue;
  const row = byBranch.get(s.branch);
  if (row) row.staff++;
  else unknownBranches.add(s.branch || "(tiada cawangan)");
}

for (const r of scoped) {
  const row = byBranch.get(r.branch);
  if (!row) { unknownBranches.add(r.branch || "(tiada cawangan)"); continue; }
  row.total++;
  row[bucket(r.status)]++;
  if (bucket(r.status) === "approved") row.days += Number(r.days) || 0;
}

const rows = BRANCHES.map((b) => ({ ...b, ...byBranch.get(b.name) }));
const byState = (st) => rows.filter((r) => r.state === st).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
const pahang = byState("Pahang");
const terengganu = byState("Terengganu");

const sum = (list, k) => list.reduce((t, r) => t + r[k], 0);
const stateTotal = (list) => ({
  total: sum(list, "total"), approved: sum(list, "approved"), pending: sum(list, "pending"),
  cancelled: sum(list, "cancelled"), rejected: sum(list, "rejected"),
  days: sum(list, "days"), staff: sum(list, "staff"),
});
const tPahang = stateTotal(pahang);
const tTrg = stateTotal(terengganu);
const grand = stateTotal(rows);

const maxTotal = Math.max(1, ...rows.map((r) => r.total));
const rate = (a, n) => (n ? (a / n) * 100 : 0);

const MONTHS = ["Jan", "Feb", "Mac", "Apr", "Mei", "Jun", "Jul", "Ogo", "Sep", "Okt", "Nov", "Dis"];
const today = new Date();
const curMonth = String(today.getFullYear()) === YEAR ? today.getMonth() : 11;
const months = MONTHS.map((label, i) => ({ label, i, ...blank() }));
for (const r of scoped) {
  if (!byBranch.has(r.branch)) continue;
  const m = months[Number(String(r.startDate).slice(5, 7)) - 1];
  if (!m) continue;
  m.total++;
  m[bucket(r.status)]++;
}
const firstMonth = months.findIndex((m) => m.total > 0);
const lastMonth = Math.max(curMonth, ...months.filter((m) => m.total).map((m) => m.i));
const monthRows = firstMonth < 0 ? [] : months.slice(firstMonth, lastMonth + 1);
const maxMonth = Math.max(1, ...monthRows.map((m) => m.total));

const typeCounts = {};
for (const r of scoped) {
  if (bucket(r.status) !== "approved") continue;
  const key = LEAVE_TYPE_LABEL[r.type] || r.type || "Lain-lain";
  typeCounts[key] = (typeCounts[key] || 0) + 1;
}
const typeRows = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
const maxType = Math.max(1, ...typeRows.map((t) => t[1]));

const perStaff = rows
  .filter((r) => r.staff > 0)
  .map((r) => ({ ...r, ratio: r.total / r.staff }))
  .sort((a, b) => b.ratio - a.ratio);
const maxRatio = Math.max(0.001, ...perStaff.map((r) => r.ratio));

// ── Rendering helpers ───────────────────────────────────────────────────────
const logo = "data:image/png;base64," +
  fs.readFileSync(path.join(ROOT, "public", "logo-ksb.png")).toString("base64");

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const n1 = (v) => (Math.round(v * 10) / 10).toString();
const shortName = (n) => n.replace(/^Klinik Syed Badaruddin /, "").replace(/ Sdn\. Bhd\.$/, "").replace(/^Klinik Rakyat dan X-Ray /, "KR X-Ray ");

/* Stacked status bar. Segments are separated by a 2px surface gap rather than a
   border, and every row carries a direct total label — the amber "dalam proses"
   fill sits under 3:1 on white, so the label is the required relief. */
function statusBar(r) {
  const pct = (v) => (v / maxTotal) * 100;
  const seg = (v, cls) =>
    v > 0 ? `<span class="seg ${cls}" style="width:${pct(v)}%" title="${v}"></span>` : "";
  const empty = r.total === 0;
  return `
    <div class="row${empty ? " row-empty" : ""}">
      <div class="rlabel">${esc(shortName(r.name))}</div>
      <div class="track">
        ${seg(r.approved, "s-ok")}${seg(r.pending, "s-wait")}${seg(r.cancelled + r.rejected, "s-void")}
        ${empty ? '<span class="nodata">tiada rekod</span>' : ""}
      </div>
      <div class="rval">${empty ? "0" : r.total}</div>
    </div>`;
}

/* Monthly columns share the status colours of the branch bars. The current
   month is still filling up and later months only hold advance bookings, so
   both are marked rather than read as a drop. */
function monthChart() {
  const H = 120;
  const col = (m) => {
    const h = (v) => (v / maxMonth) * H;
    const seg = (v, cls) => (v > 0 ? `<span class="cseg ${cls}" style="height:${h(v)}px"></span>` : "");
    const tag = m.i === curMonth ? "setakat " + today.getDate() + " hb" : m.i > curMonth ? "tempahan awal" : "";
    return `
      <div class="col${m.i > curMonth ? " col-future" : ""}">
        <div class="cstack" style="height:${H + 14}px">
          <div class="cval">${m.total || ""}</div>
          ${seg(m.cancelled + m.rejected, "s-void")}${seg(m.pending, "s-wait")}${seg(m.approved, "s-ok")}
        </div>
        <div class="clab">${m.label}</div>
        <div class="ctag">${tag}</div>
      </div>`;
  };
  return `<div class="cols">${monthRows.map(col).join("")}</div>`;
}

function statePanel(title, list, tot, note) {
  return `
    <section class="panel">
      <header class="phead">
        <h3>${esc(title)}</h3>
        <div class="psum">${tot.total} permohonan · ${tot.approved} diluluskan · ${tot.staff} staf aktif</div>
      </header>
      <div class="bars">${list.map(statusBar).join("")}</div>
      ${note ? `<p class="pnote">${note}</p>` : ""}
    </section>`;
}

const legend = `
  <div class="legend">
    <span><i class="k s-ok"></i>Diluluskan</span>
    <span><i class="k s-wait"></i>Dalam proses</span>
    <span><i class="k s-void"></i>Batal / tolak</span>
  </div>`;

const tableRow = (r) => `
  <tr${r.total === 0 ? ' class="tr-zero"' : ""}>
    <td class="tl">${esc(shortName(r.name))}</td>
    <td>${r.staff}</td><td>${r.total}</td><td class="ok">${r.approved}</td>
    <td>${r.pending}</td><td>${r.cancelled + r.rejected}</td>
    <td>${r.total ? rate(r.approved, r.total).toFixed(1) + "%" : "—"}</td>
    <td>${n1(r.days)}</td>
  </tr>`;

const totalRow = (label, t) => `
  <tr class="tr-total">
    <td class="tl">${label}</td><td>${t.staff}</td><td>${t.total}</td>
    <td class="ok">${t.approved}</td><td>${t.pending}</td><td>${t.cancelled + t.rejected}</td>
    <td>${t.total ? rate(t.approved, t.total).toFixed(1) + "%" : "—"}</td><td>${n1(t.days)}</td>
  </tr>`;

const idle = rows.filter((r) => r.total === 0 && r.staff > 0);
const balok = rows.find((r) => r.name.includes("Balok"));
const balokShare = grand.total ? (balok.total / grand.total) * 100 : 0;

const header = (title) => `
  <div class="khead">
    <img src="${logo}" alt="">
    <div>
      <h1>KLINIK SYED BADARUDDIN SDN. BHD.</h1>
      <p class="tag">Servicing Community Since 1991</p>
      <p class="sub">Cawangan: Semua Cawangan (Pahang &amp; Terengganu)</p>
    </div>
    <img src="${logo}" alt="">
  </div>
  <div class="ktitle"><span>${title}</span></div>`;

const meta = `
  <div class="kmeta">
    <strong>Tahun:</strong> ${YEAR} &nbsp;·&nbsp;
    <strong>Rekod:</strong> ${grand.total} permohonan &nbsp;·&nbsp;
    <strong>Data:</strong> ${snapshotDate.toLocaleString("ms-MY")} &nbsp;·&nbsp;
    <strong>Dijana:</strong> ${new Date().toLocaleString("ms-MY")}
  </div>`;

const html = `
<style>
  @page { size: A4 portrait; margin: 13mm 12mm 12mm; }
  * { box-sizing: border-box; }
  body {
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    color: #0b0b0b; background: #fff; margin: 0;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }

  /* ── Corporate header (matches window.printHeaderHTML) ── */
  .khead { display:flex; align-items:center; gap:18px; border-bottom:3px solid #9b2c2c;
           padding-bottom:12px; margin-bottom:14px; }
  .khead img { width:60px; height:60px; object-fit:contain; border-radius:12px; flex-shrink:0; }
  .khead > div { flex:1; text-align:center; }
  .khead h1 { color:#9b2c2c; font-size:19px; font-weight:700; margin:0; letter-spacing:.5px; }
  .tag { color:#7a3b3b; font-size:9px; letter-spacing:1.5px; margin:3px 0 0; text-transform:uppercase; }
  .sub { color:#4a5568; font-size:10px; font-weight:700; margin:5px 0 0; }
  .ktitle { text-align:center; margin-bottom:8px; }
  .ktitle span { border:2px solid #9b2c2c; display:inline-block; padding:4px 24px;
                 font-weight:700; letter-spacing:2px; font-size:12px; color:#9b2c2c; }
  .kmeta { text-align:center; font-size:9px; color:#718096; margin-bottom:16px; }
  .kmeta strong { color:#4a5568; }

  /* ── Stat tiles ── */
  .tiles { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin-bottom:18px; }
  .tile { border:1px solid rgba(11,11,11,.10); border-radius:8px; padding:9px 11px; background:#fcfcfb; }
  .tile .lab { font-size:8.5px; letter-spacing:.7px; text-transform:uppercase; color:#898781; margin-bottom:3px; }
  .tile .val { font-size:24px; font-weight:700; line-height:1.05; }
  .tile .foot { font-size:8.5px; color:#52514e; margin-top:2px; }
  .meter { height:4px; border-radius:2px; background:#ecebe6; margin:5px 0 3px; overflow:hidden; }
  .meter span { display:block; height:100%; background:#0ca30c; border-radius:2px; }

  h2.sect { font-size:12.5px; margin:0 0 2px; color:#0b0b0b; }
  p.dek { font-size:9px; color:#52514e; margin:0 0 10px; line-height:1.45; }

  /* ── Bar chart ── */
  .panel { margin-bottom:14px; }
  .phead { display:flex; align-items:baseline; justify-content:space-between;
           border-bottom:1px solid #e1e0d9; padding-bottom:3px; margin-bottom:8px; }
  .phead h3 { font-size:10px; letter-spacing:1.4px; text-transform:uppercase; color:#9b2c2c; margin:0; font-weight:700; }
  .psum { font-size:8.5px; color:#898781; font-variant-numeric:tabular-nums; }
  .row { display:grid; grid-template-columns:118px 1fr 34px; align-items:center; gap:8px; height:17px; }
  .rlabel { font-size:8.5px; color:#52514e; text-align:right; white-space:nowrap;
            overflow:hidden; text-overflow:ellipsis; }
  .track { position:relative; height:11px; display:flex; border-radius:3px;
           background:linear-gradient(#f4f3ef,#f4f3ef) left/100% 100% no-repeat; }
  .seg { height:11px; border-radius:3px; margin-right:2px; min-width:2px; }
  .seg:last-of-type { margin-right:0; }
  .s-ok   { background:#0ca30c; }
  .s-wait { background:#fab219; }
  .s-void { background:#6f6e69; }
  .rval { font-size:9px; font-weight:700; text-align:right; font-variant-numeric:tabular-nums; }
  .row-empty .rlabel, .row-empty .rval { color:#a5a49e; font-weight:400; }
  .nodata { position:absolute; left:5px; top:-1px; font-size:7.5px; color:#a5a49e; letter-spacing:.3px; }
  .pnote { font-size:8.5px; color:#52514e; margin:7px 0 0; padding-left:126px; line-height:1.45; }

  .legend { display:flex; gap:14px; font-size:8.5px; color:#52514e; padding-left:126px; margin-bottom:9px; }
  .legend i.k { display:inline-block; width:9px; height:9px; border-radius:2px; margin-right:4px;
                vertical-align:-1px; }
  .scale { padding-left:126px; font-size:8px; color:#898781; margin:0 0 10px; }

  /* ── Monthly columns ── */
  .cols { display:flex; gap:10px; align-items:flex-end; padding:0 4px 0 126px; margin-bottom:6px;
          background:linear-gradient(#e1e0d9,#e1e0d9) 126px calc(100% - 27px)/calc(100% - 130px) 1px no-repeat; }
  .col { flex:1; text-align:center; max-width:64px; }
  .cval { font-size:9px; font-weight:700; height:13px; font-variant-numeric:tabular-nums; }
  .cstack { display:flex; flex-direction:column; justify-content:flex-end; gap:2px; }
  .cseg { display:block; width:100%; border-radius:4px 4px 0 0; }
  .cseg + .cseg { border-radius:0; }
  .cval + .cseg { border-radius:4px 4px 0 0; }
  .clab { font-size:8.5px; color:#52514e; margin-top:4px; }
  .ctag { font-size:7px; color:#898781; height:9px; white-space:nowrap; }
  .col-future .cseg { opacity:.45; }

  /* ── Secondary charts ── */
  .row2 { display:grid; grid-template-columns:118px 1fr 40px; align-items:center; gap:8px; height:14px; }
  .bar2 { height:10px; background:#2a78d6; border-radius:3px; min-width:1px; }
  .bar2.zero { background:#e1e0d9; }

  /* ── Table view ── */
  table { width:100%; border-collapse:collapse; font-size:8.5px; font-variant-numeric:tabular-nums; }
  th { text-align:right; font-size:7.5px; letter-spacing:.5px; text-transform:uppercase; color:#898781;
       border-bottom:1px solid #c3c2b7; padding:4px 5px; font-weight:600; }
  td { text-align:right; padding:2.5px 5px; border-bottom:1px solid #f0efec; }
  th.tl, td.tl { text-align:left; }
  td.ok { color:#006300; font-weight:600; }
  .tr-zero td { color:#a5a49e; }
  .tr-state td { background:#faf6f6; color:#9b2c2c; font-weight:700; font-size:8px;
                 letter-spacing:1px; text-transform:uppercase; text-align:left; }
  .tr-total td { border-top:1px solid #c3c2b7; border-bottom:none; font-weight:700; }

  .callout { border-left:3px solid #9b2c2c; background:#faf6f6; padding:8px 11px;
             font-size:9px; color:#52514e; line-height:1.5; margin:12px 0; border-radius:0 5px 5px 0; }
  .callout b { color:#9b2c2c; }
  .foot { margin-top:14px; padding-top:7px; border-top:1px solid #e1e0d9;
          font-size:7.5px; color:#898781; line-height:1.6; }
  .pagebreak { page-break-before: always; }
</style>

${header("CARTA KELULUSAN CUTI")}
${meta}

<div class="tiles">
  <div class="tile"><div class="lab">Jumlah Permohonan</div><div class="val">${grand.total}</div>
    <div class="foot">${grand.staff} staf aktif</div></div>
  <div class="tile"><div class="lab">Kadar Kelulusan</div><div class="val">${rate(grand.approved, grand.total).toFixed(1)}%</div>
    <div class="meter"><span style="width:${rate(grand.approved, grand.total)}%"></span></div>
    <div class="foot">${grand.approved} diluluskan</div></div>
  <div class="tile"><div class="lab">Dalam Proses</div><div class="val">${grand.pending}</div>
    <div class="foot">belum kelulusan akhir</div></div>
  <div class="tile"><div class="lab">Hari Cuti Diluluskan</div><div class="val">${n1(grand.days)}</div>
    <div class="foot">hari terkumpul</div></div>
</div>

<h2 class="sect">Status permohonan cuti mengikut cawangan</h2>
<p class="dek">Setiap bar ialah satu cawangan; segmen menunjukkan status permohonan.
Pahang dan Terengganu dipaparkan berasingan tetapi berkongsi skala yang sama, jadi panjang bar
boleh dibandingkan merentas kedua-dua negeri.</p>
${legend}

${statePanel("Pahang", pahang, tPahang,
  `<b>Balok (HQ)</b> menyumbang ${n1(balokShare)}% daripada semua permohonan (${balok.total} daripada ${grand.total}) — sebab itu bar cawangan lain kelihatan pendek pada skala yang sama.`
    .replace(/<b>/g, "<strong>").replace(/<\/b>/g, "</strong>"))}

${statePanel("Terengganu", terengganu, tTrg,
  tTrg.total === 0
    ? "<strong>Tiada satu pun permohonan cuti direkodkan</strong> bagi ketiga-tiga cawangan Terengganu bagi tahun " + YEAR +
      ", walaupun terdapat " + tTrg.staff + " staf aktif di sana."
    : "")}

<p class="scale">Skala penuh = ${maxTotal} permohonan (cawangan tertinggi).</p>

<h2 class="sect" style="margin-top:4px">Trend bulanan</h2>
<p class="dek">Permohonan mengikut bulan tarikh mula cuti, dengan warna status yang sama seperti di atas.</p>
${monthChart()}

<div class="callout">
  <strong>Perkara utama:</strong> kadar kelulusan keseluruhan
  ${n1(rate(grand.approved, grand.total))}% (${grand.approved}/${grand.total}) —
  ${grand.rejected ? `<strong>${grand.rejected} ditolak</strong>` : "<strong>tiada permohonan ditolak</strong>"},
  ${grand.cancelled} dibatalkan pemohon, ${grand.pending} masih menunggu kelulusan akhir.
  ${idle.length ? `Cawangan tanpa sebarang rekod cuti tahun ini: <strong>${idle.map((r) => esc(shortName(r.name))).join(", ")}</strong>
  (${sum(idle, "staff")} staf aktif) — semak sama ada staf di sana memohon cuti melalui sistem.` : ""}
</div>

<div class="pagebreak"></div>
${header("CARTA KELULUSAN CUTI — LAMPIRAN")}

<h2 class="sect">Permohonan bagi setiap staf aktif</h2>
<p class="dek">Menormalkan saiz cawangan supaya perbandingan adil — bilangan permohonan dibahagi
dengan bilangan staf aktif. Cawangan tanpa staf aktif tidak disenaraikan.</p>
<div>
  ${perStaff.map((r) => `
    <div class="row2">
      <div class="rlabel">${esc(shortName(r.name))}</div>
      <div><div class="bar2${r.ratio === 0 ? " zero" : ""}" style="width:${Math.max(r.ratio / maxRatio * 100, r.ratio === 0 ? 0.6 : 1)}%"></div></div>
      <div class="rval">${r.ratio.toFixed(1)}</div>
    </div>`).join("")}
</div>
<p class="scale">Nilai = permohonan setiap staf aktif (${YEAR}).</p>

<h2 class="sect" style="margin-top:12px">Jenis cuti yang diluluskan</h2>
<p class="dek">Pecahan ${grand.approved} permohonan yang telah diluluskan sepenuhnya.</p>
<div>
  ${typeRows.map(([label, v]) => `
    <div class="row2">
      <div class="rlabel">${esc(label)}</div>
      <div><div class="bar2" style="width:${(v / maxType) * 100}%"></div></div>
      <div class="rval">${v}</div>
    </div>`).join("")}
</div>

<h2 class="sect" style="margin-top:12px">Jadual penuh</h2>
<p class="dek">Nilai penuh bagi setiap carta di atas.</p>
<table>
  <thead>
    <tr>
      <th class="tl">Cawangan</th><th>Staf</th><th>Mohon</th><th>Lulus</th>
      <th>Proses</th><th>Batal</th><th>Kadar</th><th>Hari</th>
    </tr>
  </thead>
  <tbody>
    <tr class="tr-state"><td colspan="8">Pahang</td></tr>
    ${pahang.map(tableRow).join("")}
    ${totalRow("Jumlah Pahang", tPahang)}
    <tr class="tr-state"><td colspan="8">Terengganu</td></tr>
    ${terengganu.map(tableRow).join("")}
    ${totalRow("Jumlah Terengganu", tTrg)}
    ${totalRow("JUMLAH KESELURUHAN", grand)}
  </tbody>
</table>

<div class="foot">
  <strong>Nota.</strong> “Lulus” = status <em>APPROVED</em> (kelulusan akhir sahaja).
  “Proses” termasuk <em>PENDING</em> dan <em>TL APPROVED</em> — sokongan Ketua Pasukan belum dikira lulus.
  “Hari” = jumlah hari cuti bagi permohonan yang diluluskan.
  Skop: permohonan dengan tarikh mula dalam tahun ${YEAR}.<br>
  Negeri setiap cawangan mengikut <em>data/branches.json</em>.
  ${unknownBranches.size ? `<br>Cawangan dalam rekod staf/cuti tetapi tiada dalam senarai cawangan (tidak dikira): ${[...unknownBranches].map(esc).join(", ")}.` : ""}
  <br>Sumber: snapshot Firestore <em>data/leaves.json</em> &amp; <em>data/staff.json</em> (${snapshotDate.toLocaleString("ms-MY")}).
  Jana semula: <em>npm run pull</em> &rarr; <em>node generate_leave_approval_chart.cjs</em>.
</div>
`;

(async () => {
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle0" });
  await page.pdf({ path: OUT, format: "A4", printBackground: true, preferCSSPageSize: true });

  // --png: emit a PNG proof of the same layout for visual review.
  if (process.argv.includes("--png")) {
    const dir = process.argv[process.argv.indexOf("--png") + 1] || ROOT;
    // A4 (210mm) minus the 12mm @page side margins = 186mm ≈ 703px at 96dpi,
    // so the proof matches the PDF's real content box instead of overflowing it.
    await page.setViewport({ width: 703, height: 1123, deviceScaleFactor: 2 });
    await page.emulateMediaType("print");
    await page.screenshot({ path: path.join(dir, "chart-proof.png"), fullPage: true });
    console.log(`   proof: ${path.join(dir, "chart-proof.png")}`);
  }

  await browser.close();
  console.log(`✅ PDF: ${OUT}`);
  console.log(`   ${grand.total} permohonan · ${grand.approved} lulus (${n1(rate(grand.approved, grand.total))}%) · Pahang ${tPahang.total} / Terengganu ${tTrg.total}`);
})();
