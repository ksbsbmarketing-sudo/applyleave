// Approval-routing rules — a faithful, dependency-free port of the client logic
// in `src/main.js` (getStaffGroup / shouldSkipP1 / getRoutingP1Approvers).
//
// ⚠️ KEEP IN SYNC WITH src/main.js. These rules decide who approves a leave, and
// the server-side reminder job (api/check-reminders.js) must resolve the SAME
// approvers the app shows the applicant. If you change routing in one place,
// change it in both. See memory note `approval-routing-config-override`:
// Firestore `config/approvalRouting` overrides these defaults at runtime.

export const ROUTING_DEFAULTS = {
  // Terengganu is 2-stage since 2026-08-03: Doctor PIC then the Terengganu HR.
  terengganu:       { needs_tl: false, p1_doctor_pic: true,  p1_supervisor: false, p1_hod_balok: false, needs_p2: true  },
  pahang_lain:      { needs_tl: false, p1_doctor_pic: true,  p1_supervisor: false, p1_hod_balok: false, needs_p2: true  },
  admin_balok:      { needs_tl: false, p1_doctor_pic: false, p1_supervisor: false, p1_hod_balok: true,  needs_p2: true  },
  supervisor_balok: { needs_tl: false, p1_doctor_pic: true,  p1_supervisor: false, p1_hod_balok: false, needs_p2: true  },
  doctor_pahang:    { needs_tl: false, p1_doctor_pic: false, p1_supervisor: true,  p1_hod_balok: false, needs_p2: true  },
  operation_balok:  { needs_tl: true,  p1_doctor_pic: false, p1_supervisor: true,  p1_hod_balok: false, needs_p2: true  },
  xray_sono_balok:  { needs_tl: false, p1_doctor_pic: false, p1_supervisor: true,  p1_hod_balok: false, needs_p2: true  },
  juru_audio_balok: { needs_tl: false, p1_doctor_pic: false, p1_supervisor: false, p1_hod_balok: true,  needs_p2: true  },
  pemandu_balok:    { needs_tl: false, p1_doctor_pic: false, p1_supervisor: true,  p1_hod_balok: false, needs_p2: true  },
};

// Merge the stored Firestore config over the defaults, PER GROUP — exactly what
// src/main.js:3368 does. A shallow `{...DEFAULTS, ...stored}` is wrong: a stored
// group REPLACES the default wholesale, so any flag the admin's saved doc happens
// to omit (or spells with an old field name) silently disappears, and the cron
// then resolves different approvers than the app shows the applicant.
export function mergeRoutingConfig(stored) {
  const merged = {};
  for (const [group, def] of Object.entries(ROUTING_DEFAULTS)) {
    merged[group] = stored && stored[group] ? { ...def, ...stored[group] } : { ...def };
  }
  return merged;
}

const BALOK_HQ = "Klinik Syed Badaruddin Balok (HQ)";

// Branches sited in Terengganu whose leave approvals are run out of Balok HQ —
// treated as Pahang for ROUTING only; the branch state stays Terengganu for
// reporting and location. (Utama, confirmed 2026-08-03.)
const ROUTES_AS_PAHANG = ["Klinik Syed Badaruddin Utama"];

// The state that decides HR SCOPE for a branch — the branch's own state, except
// for ROUTES_AS_PAHANG branches (Utama), which belong to the Pahang HR zone.
// Mirrors window.scopeStateOfBranch in src/main.js.
export function scopeStateOfBranch(branchName, branches) {
  if (ROUTES_AS_PAHANG.includes(branchName)) return "Pahang";
  const b = branches.find((x) => x.name === branchName);
  return (b && b.state) ? b.state : null;
}

// Which routing group a staff member falls into. Mirrors src/main.js getStaffGroup.
export function getStaffGroup(s, branches) {
  const branchObj   = branches.find((b) => b.name === s.branch);
  const routesAsPahang = ROUTES_AS_PAHANG.includes(s.branch);
  const isTerengganu = !!(branchObj && branchObj.state === "Terengganu") && !routesAsPahang;
  const isBalok      = (s.branch || "").includes("Balok");

  // Paramedic roles — special routing, Balok only.
  if (["juru_xray", "sonographer"].includes(s.role) && isBalok) return "xray_sono_balok";
  if (s.role === "juru_audio" && isBalok) return "juru_audio_balok";
  if (s.role === "pemandu" && isBalok) return "pemandu_balok";

  // A Supervisor sited at Balok is endorsed by the Balok Doctor PIC (2026-08-18).
  // Checked BEFORE leaveAsAdmin: the flag would otherwise route them to HOD Balok.
  if (isBalok && s.role === "supervisor") return "supervisor_balok";
  // Per-staff override: Operation Staff flagged leaveAsAdmin follow the Admin Staff
  // leave route (→ HOD Balok), while staying Operation Staff everywhere else.
  if (isBalok && s.leaveAsAdmin) return "admin_balok";
  // Operation Staff at Balok → TL → Supervisor → HR
  if (isBalok && s.category === "Operation Staff") return "operation_balok";
  // Admin Staff at Balok HQ → HOD Balok
  if (isBalok && s.category === "Admin Staff") return "admin_balok";
  if (isTerengganu) return "terengganu";

  // Doctors in ALL Pahang branches → Supervisor Balok (HQ) → HR, not HOD.
  // The Bentong & MCKIP carve-outs were removed (2026-08-03): the Doctor PIC at
  // those branches had no P1 approver of their own, so their leave stalled.
  if (s.category === "Doctor" && branchObj && (branchObj.state === "Pahang" || routesAsPahang)) {
    return "doctor_pahang";
  }

  return "pahang_lain";
}

// Whether Peringkat 1 (HOD/Supervisor/PIC) is skipped entirely. Mirrors shouldSkipP1.
// Peringkat-1 approvers do not approve each other: HOD Balok and Supervisor go
// straight to HR for their own leave. Doctor PIC and Team Leader are NOT included.
export function shouldSkipP1(applicant) {
  if (!applicant) return false;
  if (applicant.role === "hod_balok") return true;
  // Supervisors outside Balok still go straight to HR. A Balok Supervisor does
  // NOT: their leave is endorsed by the Balok Doctor PIC first (2026-08-18).
  if (applicant.role === "supervisor" && !(applicant.branch || "").includes("Balok")) return true;
  return false;
}

// The Peringkat-1 approvers for an applicant. Mirrors getRoutingP1Approvers.
// `approvalRouting` is the live Firestore config (or ROUTING_DEFAULTS).
export function getRoutingP1Approvers(applicant, staffList, branches, approvalRouting) {
  if (shouldSkipP1(applicant)) return [];
  const group = getStaffGroup(applicant, branches);
  const cfg   = approvalRouting[group] || {};
  const candidates = [];

  if (cfg.p1_supervisor) {
    const useBalok = group === "operation_balok" || group === "xray_sono_balok" || group === "doctor_pahang";
    const supBranch = useBalok ? BALOK_HQ : applicant.branch;
    candidates.push(...staffList.filter((s) =>
      s.role === "supervisor" && s.branch === supBranch && !s.inactive && s.ic !== applicant.ic));
  }
  if (cfg.p1_doctor_pic) {
    candidates.push(...staffList.filter((s) =>
      s.role === "doctor_pic" && s.branch === applicant.branch && !s.inactive && s.ic !== applicant.ic));
  }
  if (cfg.p1_hod_balok) {
    candidates.push(...staffList.filter((s) =>
      s.role === "hod_balok" && s.branch === BALOK_HQ && !s.inactive && s.ic !== applicant.ic));
  }
  // De-dupe by IC.
  return [...new Map(candidates.map((c) => [c.ic, c])).values()];
}
