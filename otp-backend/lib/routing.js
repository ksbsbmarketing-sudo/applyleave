// Approval-routing rules — a faithful, dependency-free port of the client logic
// in `src/main.js` (getStaffGroup / shouldSkipP1 / getRoutingP1Approvers).
//
// ⚠️ KEEP IN SYNC WITH src/main.js. These rules decide who approves a leave, and
// the server-side reminder job (api/check-reminders.js) must resolve the SAME
// approvers the app shows the applicant. If you change routing in one place,
// change it in both. See memory note `approval-routing-config-override`:
// Firestore `config/approvalRouting` overrides these defaults at runtime.

export const ROUTING_DEFAULTS = {
  terengganu:       { needs_tl: false, p1_doctor_pic: true,  p1_supervisor: false, p1_hod_balok: false, needs_p2: false },
  pahang_lain:      { needs_tl: false, p1_doctor_pic: true,  p1_supervisor: false, p1_hod_balok: false, needs_p2: true  },
  admin_balok:      { needs_tl: false, p1_doctor_pic: false, p1_supervisor: false, p1_hod_balok: true,  needs_p2: true  },
  doctor_pahang:    { needs_tl: false, p1_doctor_pic: false, p1_supervisor: true,  p1_hod_balok: false, needs_p2: true  },
  operation_balok:  { needs_tl: true,  p1_doctor_pic: false, p1_supervisor: true,  p1_hod_balok: false, needs_p2: true  },
  xray_sono_balok:  { needs_tl: false, p1_doctor_pic: false, p1_supervisor: true,  p1_hod_balok: false, needs_p2: true  },
  juru_audio_balok: { needs_tl: false, p1_doctor_pic: false, p1_supervisor: false, p1_hod_balok: true,  needs_p2: true  },
  pemandu_balok:    { needs_tl: false, p1_doctor_pic: false, p1_supervisor: true,  p1_hod_balok: false, needs_p2: true  },
};

const BALOK_HQ = "Klinik Syed Badaruddin Balok (HQ)";

// Which routing group a staff member falls into. Mirrors src/main.js getStaffGroup.
export function getStaffGroup(s, branches) {
  const branchObj   = branches.find((b) => b.name === s.branch);
  const isTerengganu = !!(branchObj && branchObj.state === "Terengganu");
  const isBalok      = (s.branch || "").includes("Balok");

  // Paramedic roles — special routing, Balok only.
  if (["juru_xray", "sonographer"].includes(s.role) && isBalok) return "xray_sono_balok";
  if (s.role === "juru_audio" && isBalok) return "juru_audio_balok";
  if (s.role === "pemandu" && isBalok) return "pemandu_balok";

  // Operation Staff at Balok → TL → Supervisor → HR
  if (isBalok && s.category === "Operation Staff") return "operation_balok";
  // Admin Staff at Balok HQ → HOD Balok
  if (isBalok && s.category === "Admin Staff") return "admin_balok";
  if (isTerengganu) return "terengganu";

  // Doctors in Pahang EXCEPT Bentong & MCKIP → Supervisor Balok (HQ) → HR, not HOD
  if (s.category === "Doctor" && branchObj && branchObj.state === "Pahang"
      && branchObj.daerah !== "Bentong"
      && s.branch !== "Klinik Syed Badaruddin MCKIP") {
    return "doctor_pahang";
  }

  return "pahang_lain";
}

// Whether Peringkat 1 (HOD/Supervisor/PIC) is skipped entirely. Mirrors shouldSkipP1.
export function shouldSkipP1(applicant) {
  if (!applicant) return false;
  if (applicant.role === "hod_balok") return true;
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
