/**
 * Carta Peringkat Pelulus Cuti — PDF generator.
 *
 * Renders the approval chain (Peringkat 0 → 1 → 2) for every staff routing group,
 * split by zone: Balok (HQ), cawangan Pahang, cawangan Terengganu.
 *
 * The routing logic below is a faithful replica of src/main.js —
 * window.getStaffGroup (:1666), window.shouldSkipP1 (:1707) and
 * window.getRoutingP1Approvers (:1713) — applied to the live staff snapshot in
 * ./data, so the chart shows who actually holds each approver seat today.
 *
 *   node generate_carta_pelulus.cjs [--png <dir>]
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const puppeteer = require("puppeteer");

const ROOT = __dirname;
const OUT = path.join(os.homedir(), "Desktop", "Carta-Peringkat-Pelulus-Cuti-KSB.pdf");

// ── Branch registry ─────────────────────────────────────────────────────────
// Prefer the live snapshot (`npm run pull` → data/branches.json). state/daerah
// decide routing, and the seed list below HAS drifted from production (Utama is
// Terengganu/Kemaman live, Pahang/Kuantan here), which would silently put staff
// in the wrong zone on the chart. Fall back to the seed list only if unpulled.
const BRANCH_SNAPSHOT = path.join(ROOT, "data", "branches.json");
const branchesFallback = [
  { name: "Management / HQ", state: "Pahang", daerah: "Kuantan" },
  { name: "Klinik Syed Badaruddin Balok (HQ)", state: "Pahang", daerah: "Kuantan" },
  { name: "Klinik Syed Badaruddin Beserah", state: "Pahang", daerah: "Kuantan" },
  { name: "Klinik Syed Badaruddin Gebeng", state: "Pahang", daerah: "Kuantan" },
  { name: "Klinik Syed Badaruddin Kempadang", state: "Pahang", daerah: "Kuantan" },
  { name: "Uni Klinik Bentong", state: "Pahang", daerah: "Bentong" },
  { name: "Klinik Syed Badaruddin MCKIP", state: "Pahang", daerah: "Kuantan" },
  { name: "Klinik Syed Badaruddin RPCM", state: "Pahang", daerah: "Kuantan" },
  { name: "Klinik Syed Badaruddin Utama", state: "Pahang", daerah: "Kuantan" },
  { name: "Klinik Syed Badaruddin Kerteh", state: "Terengganu", daerah: "Kemaman" },
  { name: "Klinik Syed Badaruddin Paka", state: "Terengganu", daerah: "Dungun" },
  { name: "Klinik Rakyat dan X-Ray Dungun", state: "Terengganu", daerah: "Dungun" },
];
const usingLiveBranches = fs.existsSync(BRANCH_SNAPSHOT);
const branches = usingLiveBranches
  ? JSON.parse(fs.readFileSync(BRANCH_SNAPSHOT, "utf8"))
  : branchesFallback;
console.log(usingLiveBranches
  ? `Branches: live snapshot (${branches.length}) — data/branches.json`
  : "Branches: SEED FALLBACK — run `npm run pull` for live state/daerah.");

/* EFFECTIVE routing config.
   ROUTING_DEFAULTS (src/main.js:1654) merged with the live Firestore doc
   config/approvalRouting, exactly as src/main.js:3368 does — it iterates the
   DEFAULT keys and spreads the stored doc over each. The live doc still carries
   the pre-rename fields p1_hod / p1_pic_hod until 2026-08-03, when the doc was
   rewritten with the current field names, so it now matches the code default. */
const ROUTING = {
  terengganu:       { needs_tl:false, p1_doctor_pic:true,  p1_supervisor:false, p1_hod_balok:false, needs_p2:true  },
  pahang_lain:      { needs_tl:false, p1_doctor_pic:true,  p1_supervisor:false, p1_hod_balok:false, needs_p2:true  },
  admin_balok:      { needs_tl:false, p1_doctor_pic:false, p1_supervisor:false, p1_hod_balok:true,  needs_p2:true  },
  doctor_pahang:    { needs_tl:false, p1_doctor_pic:false, p1_supervisor:true,  p1_hod_balok:false, needs_p2:true  },
  operation_balok:  { needs_tl:true,  p1_doctor_pic:false, p1_supervisor:true,  p1_hod_balok:false, needs_p2:true  },
  xray_sono_balok:  { needs_tl:false, p1_doctor_pic:false, p1_supervisor:true,  p1_hod_balok:false, needs_p2:true  },
  juru_audio_balok: { needs_tl:false, p1_doctor_pic:false, p1_supervisor:false, p1_hod_balok:true,  needs_p2:true  },
  pemandu_balok:    { needs_tl:false, p1_doctor_pic:false, p1_supervisor:true,  p1_hod_balok:false, needs_p2:true  },
};

const BALOK = "Klinik Syed Badaruddin Balok (HQ)";
const staffList = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "staff.json"), "utf8")).filter((s) => !s.inactive);
const snapshotDate = fs.statSync(path.join(ROOT, "data", "staff.json")).mtime;

// ── Routing logic (replica of src/main.js) ──────────────────────────────────
// Terletak di Terengganu tetapi kelulusan diuruskan Balok HQ — routing ikut Pahang.
const ROUTES_AS_PAHANG = ["Klinik Syed Badaruddin Utama"];

function getStaffGroup(s) {
  const b = branches.find((x) => x.name === s.branch);
  const routesAsPahang = ROUTES_AS_PAHANG.includes(s.branch);
  const isTerengganu = b && b.state === "Terengganu" && !routesAsPahang;
  const isBalok = (s.branch || "").includes("Balok");
  if (["juru_xray", "sonographer"].includes(s.role) && isBalok) return "xray_sono_balok";
  if (s.role === "juru_audio" && isBalok) return "juru_audio_balok";
  if (s.role === "pemandu" && isBalok) return "pemandu_balok";
  if (isBalok && s.leaveAsAdmin) return "admin_balok";
  if (isBalok && s.category === "Operation Staff") return "operation_balok";
  if (isBalok && s.category === "Admin Staff") return "admin_balok";
  if (isTerengganu) return "terengganu";
  if (s.category === "Doctor" && b && (b.state === "Pahang" || routesAsPahang)) return "doctor_pahang";
  return "pahang_lain";
}

// Peringkat-1 approvers don't approve each other — HOD Balok & Supervisor go straight to HR.
const shouldSkipP1 = (s) => s.role === "hod_balok" || s.role === "supervisor";

function getRoutingP1Approvers(s) {
  if (shouldSkipP1(s)) return [];
  const group = getStaffGroup(s);
  const cfg = ROUTING[group] || {};
  const out = [];
  if (cfg.p1_supervisor) {
    const useBalok = ["operation_balok", "xray_sono_balok", "doctor_pahang"].includes(group);
    const supBranch = useBalok ? BALOK : s.branch;
    out.push(...staffList.filter((x) => x.role === "supervisor" && x.branch === supBranch && x.ic !== s.ic));
  }
  if (cfg.p1_doctor_pic) out.push(...staffList.filter((x) => x.role === "doctor_pic" && x.branch === s.branch && x.ic !== s.ic));
  if (cfg.p1_hod_balok) out.push(...staffList.filter((x) => x.role === "hod_balok" && x.branch === BALOK && x.ic !== s.ic));
  return [...new Map(out.map((c) => [c.ic, c])).values()];
}

// ── Seat holders ────────────────────────────────────────────────────────────
const holders = (role, branch) => staffList.filter((s) => s.role === role && (!branch || s.branch === branch));
const nm = (s) => s.name.replace(/\s+/g, " ").trim();
const shortPerson = (s) => {
  const parts = nm(s).split(" ");
  return parts.length > 4 ? parts.slice(0, 4).join(" ") + "…" : nm(s);
};
const nameList = (list) => (list.length ? list.map(shortPerson).join(" · ") : "");

const TL = holders("team_leader", BALOK);
const SUP_BALOK = holders("supervisor", BALOK);
const HOD_BALOK = holders("hod_balok", BALOK);
const HR = holders("hr");
const ADMINS = staffList.filter((s) => ["admin", "super_admin"].includes(s.role));

const shortBranch = (n) => n.replace(/^Klinik Syed Badaruddin /, "").replace(/^Klinik Rakyat dan X-Ray /, "KR X-Ray ");

// ── Build the route rows ────────────────────────────────────────────────────
const zoneOf = (s) => {
  const b = branches.find((x) => x.name === s.branch);
  if ((s.branch || "").includes("Balok")) return "balok";
  if (ROUTES_AS_PAHANG.includes(s.branch)) return "pahang";
  if (b && b.state === "Terengganu") return "terengganu";
  return "pahang";
};

/** Route definitions. `pick` selects members; the chain is derived from ROUTING. */
const ROUTES = [
  // ── Balok (HQ) ──
  { zone: "balok", group: "operation_balok", label: "Operation Staff",
    sub: "Staf operasi Balok",
    pick: (s) => zoneOf(s) === "balok" && getStaffGroup(s) === "operation_balok" },
  { zone: "balok", group: "admin_balok", label: "Admin Staff",
    sub: "Termasuk HR &amp; staf pentadbiran",
    pick: (s) => zoneOf(s) === "balok" && getStaffGroup(s) === "admin_balok" && !shouldSkipP1(s) && !s.leaveAsAdmin },
  { zone: "balok", group: "doctor_pahang", label: "Doktor",
    sub: "Doktor di Balok HQ",
    pick: (s) => zoneOf(s) === "balok" && getStaffGroup(s) === "doctor_pahang" },
  { zone: "balok", group: "xray_sono_balok", label: "Juru X-Ray &amp; Sonographer",
    sub: "Laluan paramedik",
    pick: (s) => getStaffGroup(s) === "xray_sono_balok" },
  { zone: "balok", group: "juru_audio_balok", label: "Juru Audio",
    sub: "Laluan paramedik",
    pick: (s) => getStaffGroup(s) === "juru_audio_balok" },
  { zone: "balok", group: "pemandu_balok", label: "Pemandu",
    sub: "Laluan pemandu",
    pick: (s) => getStaffGroup(s) === "pemandu_balok" },
  // ── Balok exceptions ──
  { zone: "balok", group: "admin_balok", label: "HOD Balok &amp; Supervisor (cuti sendiri)", exception: true,
    sub: "Peringkat 1 DILANGKAU — terus ke HR", skipP1: true,
    pick: (s) => shouldSkipP1(s) },
  { zone: "balok", group: "admin_balok", label: "Operation Staff bertanda <i>leaveAsAdmin</i>", exception: true,
    sub: "Ikut laluan Admin Staff untuk cuti sahaja",
    pick: (s) => zoneOf(s) === "balok" && !!s.leaveAsAdmin },
  // ── Cawangan Pahang ──
  { zone: "pahang", group: "doctor_pahang", label: "Doktor cawangan Pahang",
    sub: "SEMUA cawangan — naik ke Supervisor Balok",
    pick: (s) => zoneOf(s) === "pahang" && getStaffGroup(s) === "doctor_pahang" },
  { zone: "pahang", group: "pahang_lain", label: "Semua staf lain",
    sub: "Staf bukan doktor — Doctor PIC cawangan sendiri",
    pick: (s) => zoneOf(s) === "pahang" && getStaffGroup(s) === "pahang_lain" },
  // ── Cawangan Terengganu ──
  { zone: "terengganu", group: "terengganu", label: "Semua staf Terengganu",
    sub: "Kerteh · Paka · KR X-Ray Dungun",
    pick: (s) => zoneOf(s) === "terengganu" },
];

for (const r of ROUTES) {
  r.members = staffList.filter(r.pick);
  r.n = r.members.length;
  r.cfg = ROUTING[r.group];
  r.noP1 = r.members.filter((s) => !shouldSkipP1(s) && getRoutingP1Approvers(s).length === 0).length;
}

// Every staff member must appear in at least one route row (exception rows count —
// leaveAsAdmin staff and HOD Balok are deliberately shown only as exceptions).
const covered = new Set();
ROUTES.forEach((r) => r.members.forEach((s) => covered.add(s.ic)));
const uncovered = staffList.filter((s) => !covered.has(s.ic) && !shouldSkipP1(s));

const gaps = staffList
  .filter((s) => !shouldSkipP1(s) && getRoutingP1Approvers(s).length === 0)
  .sort((a, b) => a.branch.localeCompare(b.branch) || nm(a).localeCompare(nm(b)));

const zoneCount = (z) => staffList.filter((s) => zoneOf(s) === z).length;

// ── Rendering ───────────────────────────────────────────────────────────────
const logo = "data:image/png;base64," +
  fs.readFileSync(path.join(ROOT, "public", "logo-ksb.png")).toString("base64");
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

/** One stage box. `tone` 0|1|2 maps to the ordinal blue ramp. */
function stage(tone, tag, role, people, note) {
  if (!role) return `<div class="box none"><span>—</span></div>`;
  return `
    <div class="box t${tone}">
      <div class="tag">${tag}</div>
      <div class="role">${role}</div>
      ${people ? `<div class="who">${people}</div>` : ""}
      ${note ? `<div class="note">${note}</div>` : ""}
    </div>`;
}

function routeRow(r) {
  const c = r.cfg;
  // Peringkat 0 — Team Leader (operation_balok only).
  const p0 = c.needs_tl
    ? stage(0, "Peringkat 0", "Team Leader", nameList(TL), "pemohon pilih TL sendiri")
    : stage(0, "", "", "");

  // Peringkat 1.
  let p1;
  if (r.skipP1) {
    p1 = `<div class="box skip"><div class="tag">Peringkat 1</div><div class="role">DILANGKAU</div>
          <div class="note">pemohon ialah pelulus P1</div></div>`;
  } else if (c.p1_supervisor) {
    p1 = stage(1, "Peringkat 1", "Supervisor Balok (HQ)", nameList(SUP_BALOK));
  } else if (c.p1_hod_balok) {
    p1 = stage(1, "Peringkat 1", "HOD Balok (HQ)", nameList(HOD_BALOK));
  } else if (c.p1_doctor_pic) {
    p1 = stage(1, "Peringkat 1", "Doctor PIC", "cawangan sendiri", "lihat jadual m/s 3");
  } else {
    p1 = stage(1, "", "", "");
  }

  // Peringkat 2.
  const p2 = c.needs_p2
    ? stage(2, "Peringkat 2", "HR / Admin", nameList(HR), "kelulusan akhir")
    : `<div class="box none p2none"><div class="tag">Peringkat 2</div><div class="role">TIADA</div>
       <div class="note">1 peringkat sahaja</div></div>`;

  return `
    <div class="route${r.exception ? " exc" : ""}">
      <div class="who-col">
        <div class="wname">${r.label}</div>
        <div class="wsub">${r.sub}</div>
        <div class="wn">${r.n} staf${r.noP1 ? ` <span class="warn">· ${r.noP1} tiada P1</span>` : ""}</div>
      </div>
      <div class="arrow">›</div>${p0}
      <div class="arrow">›</div>${p1}
      <div class="arrow">›</div>${p2}
      <div class="sah">SAH</div>
    </div>`;
}

const zoneBlock = (id, title, meta, routes, foot) => `
  <section class="zone">
    <div class="zhead"><h3>${title}</h3><span>${meta}</span></div>
    ${routes.map(routeRow).join("")}
    ${foot ? `<p class="zfoot">${foot}</p>` : ""}
  </section>`;

const header = (title) => `
  <div class="khead">
    <img src="${logo}" alt="">
    <div>
      <h1>KLINIK SYED BADARUDDIN SDN. BHD.</h1>
      <p class="tag2">Servicing Community Since 1991</p>
      <p class="sub2">Cawangan: Semua Cawangan (Pahang &amp; Terengganu)</p>
    </div>
    <img src="${logo}" alt="">
  </div>
  <div class="ktitle"><span>${title}</span></div>`;

const legend = `
  <div class="legend">
    <span><i class="k t0"></i>Peringkat 0 — sokongan Ketua Pasukan</span>
    <span><i class="k t1"></i>Peringkat 1 — sokongan pelulus pertama</span>
    <span><i class="k t2"></i>Peringkat 2 — kelulusan akhir HR/Admin</span>
    <span><i class="k ksah"></i>Cuti SAH</span>
  </div>`;

// Branches that appear on staff records but are absent from the registry (KSBYMC)
// still need a row — their staff fall into pahang_lain and show up in the gap list.
const registryNames = new Set(branches.map((b) => b.name));
const orphanBranches = [...new Set(staffList.map((s) => s.branch).filter((n) => !registryNames.has(n)))]
  .map((name) => ({ name, state: "—", orphan: true }));

const picTable = [...branches, ...orphanBranches].map((b) => {
  const pics = holders("doctor_pic", b.name);
  const n = staffList.filter((s) => s.branch === b.name).length;
  // Balok routes via Supervisor/HOD, and Management/HQ holds only the global
  // bypass roles — neither needs a Doctor PIC, so neither is a gap.
  const exempt = b.name === BALOK || b.name === "Management / HQ";
  const note = b.name === BALOK
    ? '<span class="mut">tidak berkenaan — guna Supervisor / HOD Balok</span>'
    : '<span class="mut">tidak berkenaan — Admin / Super Admin sahaja</span>';
  return `<tr${!pics.length && !exempt ? ' class="tr-gap"' : ""}>
    <td class="tl">${esc(shortBranch(b.name))}${b.orphan ? '<span class="gap">†</span>' : ""}</td>
    <td class="tl">${b.state}</td><td>${n}</td>
    <td class="tl">${pics.length ? pics.map((p) => esc(shortPerson(p))).join("<br>")
      : (exempt ? note : '<span class="gap">❌ TIADA Doctor PIC</span>')}</td>
  </tr>`;
}).join("");

const html = `
<style>
  @page { size: A4 portrait; margin: 12mm 12mm 11mm; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color:#0b0b0b;
         background:#fff; margin:0; -webkit-print-color-adjust:exact; print-color-adjust:exact; }

  .khead { display:flex; align-items:center; gap:16px; border-bottom:3px solid #9b2c2c;
           padding-bottom:11px; margin-bottom:12px; }
  .khead img { width:56px; height:56px; object-fit:contain; border-radius:11px; flex-shrink:0; }
  .khead > div { flex:1; text-align:center; }
  .khead h1 { color:#9b2c2c; font-size:18px; font-weight:700; margin:0; letter-spacing:.4px; }
  .tag2 { color:#7a3b3b; font-size:8.5px; letter-spacing:1.4px; margin:3px 0 0; text-transform:uppercase; }
  .sub2 { color:#4a5568; font-size:9.5px; font-weight:700; margin:4px 0 0; }
  .ktitle { text-align:center; margin-bottom:9px; }
  .ktitle span { border:2px solid #9b2c2c; display:inline-block; padding:4px 22px;
                 font-weight:700; letter-spacing:1.8px; font-size:11.5px; color:#9b2c2c; }
  .kmeta { text-align:center; font-size:8.5px; color:#718096; margin-bottom:12px; }
  .kmeta strong { color:#4a5568; }

  .legend { display:flex; flex-wrap:wrap; gap:12px; font-size:8px; color:#52514e; margin-bottom:12px;
            padding:7px 9px; background:#fcfcfb; border:1px solid rgba(11,11,11,.10); border-radius:7px; }
  .legend i.k { display:inline-block; width:9px; height:9px; border-radius:2px; margin-right:4px; vertical-align:-1px; }
  i.t0 { background:#86b6ef; } i.t1 { background:#3987e5; } i.t2 { background:#1c5cab; }
  i.ksah { background:#0ca30c; }

  .zone { margin-bottom:13px; }
  .zhead { display:flex; align-items:baseline; justify-content:space-between;
           border-bottom:1px solid #e1e0d9; padding-bottom:3px; margin-bottom:7px; }
  .zhead h3 { font-size:10px; letter-spacing:1.3px; text-transform:uppercase; color:#9b2c2c; margin:0; font-weight:700; }
  .zhead span { font-size:8px; color:#898781; }

  /* Flow row: applicant → P0 → P1 → P2 → SAH */
  .route { display:grid; grid-template-columns:118px 11px 1fr 11px 1fr 11px 1fr 34px;
           align-items:stretch; gap:0; margin-bottom:5px; }
  .who-col { padding:4px 7px 4px 0; border-right:2px solid #9b2c2c; }
  .wname { font-size:8.5px; font-weight:700; line-height:1.25; }
  .wsub  { font-size:7px; color:#898781; line-height:1.3; margin-top:1px; }
  .wn    { font-size:7px; color:#52514e; margin-top:2px; font-weight:600; }
  .warn  { color:#9b2c2c; }
  .arrow { display:flex; align-items:center; justify-content:center; color:#c3c2b7;
           font-size:13px; line-height:1; }

  .box { border:1px solid #e1e0d9; border-left-width:3px; border-radius:5px; padding:4px 6px;
         background:#fcfcfb; min-height:36px; }
  .box .tag  { font-size:6.5px; letter-spacing:.7px; text-transform:uppercase; color:#898781; }
  .box .role { font-size:8.5px; font-weight:700; line-height:1.2; margin-top:1px; }
  .box .who  { font-size:7px; color:#52514e; line-height:1.3; margin-top:1px; }
  .box .note { font-size:6.5px; color:#898781; font-style:italic; margin-top:1px; }
  .box.t0 { border-left-color:#86b6ef; }
  .box.t1 { border-left-color:#3987e5; }
  .box.t2 { border-left-color:#1c5cab; }
  .box.none { border:1px dashed #e1e0d9; background:transparent; display:flex;
              align-items:center; justify-content:center; color:#c3c2b7; font-size:11px; }
  .box.p2none { display:block; border:1px dashed #c9a3a3; background:#faf6f6; }
  .box.p2none .role { color:#9b2c2c; }
  .box.skip { border:1px dashed #c9a3a3; border-left:3px solid #9b2c2c; background:#faf6f6; }
  .box.skip .role { color:#9b2c2c; }

  .sah { display:flex; align-items:center; justify-content:center; font-size:7px; font-weight:700;
         letter-spacing:.4px; color:#fff; background:#0ca30c; border-radius:5px; margin-left:5px; }
  .route.exc .who-col { border-right-color:#c3c2b7; border-right-style:dashed; }
  .route.exc .wname { color:#9b2c2c; }
  .zfoot { font-size:7.5px; color:#52514e; margin:5px 0 0; line-height:1.5; padding-left:120px; }

  h2.sect { font-size:12px; margin:0 0 2px; }
  p.dek { font-size:8.5px; color:#52514e; margin:0 0 9px; line-height:1.45; }

  table { width:100%; border-collapse:collapse; font-size:8px; }
  th { text-align:left; font-size:7px; letter-spacing:.5px; text-transform:uppercase; color:#898781;
       border-bottom:1px solid #c3c2b7; padding:3px 5px; font-weight:600; }
  td { padding:2.6px 5px; border-bottom:1px solid #f0efec; text-align:right; }

  /* Print break control: never split a row or a flow row, and keep each heading
     glued to the table it introduces. */
  tr, .route, .callout { break-inside: avoid; page-break-inside: avoid; }
  h2.sect, p.dek, .zhead { break-after: avoid; page-break-after: avoid; }
  th.tl, td.tl { text-align:left; }
  .gap { color:#9b2c2c; font-weight:700; }
  .mut { color:#a5a49e; font-style:italic; }
  .tr-gap td { background:#faf6f6; }

  .callout { border-left:3px solid #9b2c2c; background:#faf6f6; padding:8px 10px;
             font-size:8.5px; color:#52514e; line-height:1.55; margin:10px 0; border-radius:0 5px 5px 0; }
  .callout strong { color:#9b2c2c; }
  .foot { margin-top:12px; padding-top:6px; border-top:1px solid #e1e0d9;
          font-size:7px; color:#898781; line-height:1.6; }
  .pagebreak { page-break-before:always; }
</style>

${header("CARTA PERINGKAT PELULUS CUTI")}
<div class="kmeta">
  <strong>${staffList.length}</strong> staf aktif &nbsp;·&nbsp;
  <strong>${ROUTES.filter((r) => !r.exception).length}</strong> laluan kelulusan &nbsp;·&nbsp;
  Data: ${snapshotDate.toLocaleString("ms-MY")} &nbsp;·&nbsp;
  Dijana: ${new Date().toLocaleString("ms-MY")}
</div>
${legend}

${zoneBlock("balok", "Zon A · Balok (HQ)", `${zoneCount("balok")} staf aktif`,
  ROUTES.filter((r) => r.zone === "balok"),
  "Hanya <strong>Operation Staff Balok</strong> melalui 3 peringkat (Team Leader → Supervisor → HR). " +
  "Semua kumpulan lain di Balok melalui 2 peringkat. Status <em>TL APPROVED</em> bermakna Peringkat 0 selesai — cuti belum sah.")}

<div class="pagebreak"></div>
${header("CARTA PERINGKAT PELULUS CUTI — ZON B &amp; C")}
${legend}

${zoneBlock("pahang", "Zon B · Laluan Pahang (selain Balok)", `${zoneCount("pahang")} staf aktif · 9 cawangan`,
  ROUTES.filter((r) => r.zone === "pahang"),
  "Doktor di <strong>semua cawangan Pahang</strong> — termasuk <strong>Bentong</strong> dan <strong>MCKIP</strong> — " +
  "tidak diluluskan di cawangan sendiri; permohonan mereka naik ke <strong>Supervisor Balok (HQ)</strong>, " +
  "kemudian HR/Admin. Staf bukan doktor kekal di bawah Doctor PIC cawangan masing-masing. " +
  "<strong>Klinik Syed Badaruddin Utama</strong> terletak di Terengganu tetapi kelulusannya diuruskan oleh " +
  "Balok HQ, jadi ia mengikut laluan zon ini (2 peringkat, tamat di HR) — bukan laluan Terengganu.")}

${zoneBlock("terengganu", "Zon C · Cawangan Terengganu", `${zoneCount("terengganu")} staf aktif · 3 cawangan (Kerteh · Paka · KR X-Ray Dungun)`,
  ROUTES.filter((r) => r.zone === "terengganu"),
  "Sejak 2026-08-03 Terengganu ialah <strong>2 peringkat</strong>: Doctor PIC cawangan menyokong, kemudian " +
  "<strong>HR Terengganu (Zahirah Dahria)</strong> memberi kelulusan akhir — cuti SAH selepas itu. " +
  "HR Pahang (Norhazlinah) tidak nampak zon ini, dan Zahirah tidak nampak zon Pahang; Admin/Super Admin nampak kedua-duanya. " +
  "Cawangan Utama TIDAK termasuk di sini — lihat Zon B.")}

<div class="callout">
  <strong>Pintasan menyeluruh.</strong> ${ADMINS.map((a) => esc(nm(a))).join(" dan ")}
  (peranan <em>admin</em> / <em>super_admin</em>) boleh meluluskan <strong>mana-mana</strong> permohonan
  di mana-mana zon, pada bila-bila peringkat, tanpa mengikut laluan di atas.
  <strong>HR</strong> pula terhad kepada cawangan <strong>Pahang sahaja</strong>.
  <strong>HOD Cawangan</strong> bukan pelulus — peranan itu pemantau/paparan sahaja.
</div>

<div class="callout">
  <strong>Pengasingan tugas.</strong> Tiada sesiapa boleh meluluskan cuti sendiri pada Peringkat 0 atau 1.
  Jika seseorang ialah satu-satunya pelulus di cawangannya, permohonannya sendiri tiada pelulus P1 —
  lihat senarai jurang di muka surat berikutnya.
</div>

<div class="pagebreak"></div>
${header("CARTA PERINGKAT PELULUS CUTI — LAMPIRAN")}

<h2 class="sect">Pemegang jawatan pelulus</h2>
<p class="dek">Siapa yang memegang setiap kerusi pelulus pada tarikh snapshot.</p>
<table>
  <thead><tr><th class="tl">Peringkat</th><th class="tl">Peranan</th><th class="tl">Pemegang</th><th>Bil.</th></tr></thead>
  <tbody>
    <tr><td class="tl">Peringkat 0</td><td class="tl">Team Leader (Balok)</td><td class="tl">${TL.map((s) => esc(nm(s))).join("<br>")}</td><td>${TL.length}</td></tr>
    <tr><td class="tl">Peringkat 1</td><td class="tl">Supervisor Balok (HQ)</td><td class="tl">${SUP_BALOK.map((s) => esc(nm(s))).join("<br>")}</td><td>${SUP_BALOK.length}</td></tr>
    <tr><td class="tl">Peringkat 1</td><td class="tl">HOD Balok (HQ)</td><td class="tl">${HOD_BALOK.map((s) => esc(nm(s))).join("<br>")}</td><td>${HOD_BALOK.length}</td></tr>
    <tr><td class="tl">Peringkat 1</td><td class="tl">Doctor PIC (ikut cawangan)</td><td class="tl">lihat jadual di bawah</td><td>${holders("doctor_pic").length}</td></tr>
    <tr><td class="tl">Peringkat 2</td><td class="tl">HR (Pahang sahaja)</td><td class="tl">${HR.map((s) => esc(nm(s))).join("<br>")}</td><td>${HR.length}</td></tr>
    <tr><td class="tl">Pintasan</td><td class="tl">Admin / Super Admin</td><td class="tl">${ADMINS.map((s) => esc(nm(s))).join("<br>")}</td><td>${ADMINS.length}</td></tr>
  </tbody>
</table>

<h2 class="sect" style="margin-top:12px">Doctor PIC setiap cawangan</h2>
<p class="dek">Pelulus Peringkat 1 bagi staf kumpulan <em>pahang_lain</em> dan <em>terengganu</em>.</p>
<table>
  <thead><tr><th class="tl">Cawangan</th><th class="tl">Negeri</th><th>Staf</th><th class="tl">Doctor PIC</th></tr></thead>
  <tbody>${picTable}</tbody>
</table>

<h2 class="sect" style="margin-top:12px">Jurang: staf tanpa pelulus Peringkat 1 (${gaps.length})</h2>
<p class="dek">Permohonan mereka tiada pelulus P1 yang layak. Hanya Admin / Super Admin boleh meluluskan.</p>
<table>
  <thead><tr><th class="tl">Cawangan</th><th class="tl">Nama</th><th class="tl">Kategori</th><th class="tl">Sebab</th></tr></thead>
  <tbody>
    ${gaps.map((s) => {
      const grp = getStaffGroup(s);
      const solePic = s.role === "doctor_pic";
      const reason = solePic
        ? "Satu-satunya Doctor PIC di cawangan — tak boleh lulus cuti sendiri"
        : ["admin", "super_admin"].includes(s.role)
          ? "Peranan pentadbir — tiada pelulus P1 di atasnya"
          : "Cawangan tiada Doctor PIC";
      return `<tr><td class="tl">${esc(shortBranch(s.branch))}</td><td class="tl">${esc(nm(s))}</td>
        <td class="tl">${esc(s.category)}</td><td class="tl"><span class="gap">${reason}</span>
        <span class="mut"> (${grp})</span></td></tr>`;
    }).join("")}
  </tbody>
</table>

<div class="foot">
  <strong>Sumber logik.</strong> Carta ini menjalankan semula fungsi sebenar sistem —
  <em>getStaffGroup</em> (src/main.js:1666), <em>shouldSkipP1</em> (:1707) dan
  <em>getRoutingP1Approvers</em> (:1713) — ke atas snapshot staf, jadi ia memaparkan laluan yang
  benar-benar berkuatkuasa, bukan gambaran ideal.<br>
  <strong>Config.</strong> Nilai berkuatkuasa = <em>ROUTING_DEFAULTS</em> (src/main.js:1654) digabung dengan
  dokumen Firestore <em>config/approvalRouting</em>. Dokumen live masih menyimpan nama medan lama
  (<em>p1_hod</em>, <em>p1_pic_hod</em>) yang tidak lagi dibaca oleh kod, jadi setiap nilai berkesan
  sama dengan default kod.<br>
  ${uncovered.length ? `<strong>Amaran:</strong> ${uncovered.length} staf tidak dipetakan ke mana-mana laluan.<br>` : ""}
  <strong><span class="gap">†</span> Nota.</strong> KSBYMC tiada dalam senarai cawangan rasmi sistem
  (<em>branches</em>, src/main.js:3309), jadi negerinya tidak dikenali; ia dianggap bukan-Terengganu
  dan seluruh stafnya jatuh ke kumpulan <em>pahang_lain</em> yang memerlukan Doctor PIC — sedangkan
  cawangan itu tiada Doctor PIC.
  Snapshot: <em>data/staff.json</em> (${snapshotDate.toLocaleString("ms-MY")}).
  Jana semula: <em>npm run pull</em> &rarr; <em>node generate_carta_pelulus.cjs</em>.
</div>
`;

(async () => {
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle0" });
  await page.pdf({ path: OUT, format: "A4", printBackground: true, preferCSSPageSize: true });

  if (process.argv.includes("--png")) {
    const dir = process.argv[process.argv.indexOf("--png") + 1] || ROOT;
    await page.setViewport({ width: 703, height: 1123, deviceScaleFactor: 2 });
    await page.emulateMediaType("print");
    await page.screenshot({ path: path.join(dir, "pelulus-proof.png"), fullPage: true });
    console.log(`   proof: ${path.join(dir, "pelulus-proof.png")}`);
  }
  await browser.close();

  console.log(`✅ PDF: ${OUT}`);
  console.log(`   ${staffList.length} staf · ${ROUTES.filter((r) => !r.exception).length} laluan · ${gaps.length} staf tanpa pelulus P1`);
  if (uncovered.length) console.log(`   ⚠ tidak dipetakan: ${uncovered.map((s) => nm(s) + " @" + s.branch).join(", ")}`);
})();
