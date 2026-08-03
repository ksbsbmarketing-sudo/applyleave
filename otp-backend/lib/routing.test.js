// Tests for the ported approval-routing rules. Run: node --test
// These lock the server's approver resolution to the client's behaviour.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ROUTING_DEFAULTS, getStaffGroup, shouldSkipP1, getRoutingP1Approvers,
} from "./routing.js";

const BALOK_HQ = "Klinik Syed Badaruddin Balok (HQ)";

const branches = [
  { name: BALOK_HQ, state: "Pahang", daerah: "Kuantan" },
  { name: "Klinik Syed Badaruddin Kuantan", state: "Pahang", daerah: "Kuantan" },
  { name: "Klinik Syed Badaruddin Bentong", state: "Pahang", daerah: "Bentong" },
  { name: "Klinik Syed Badaruddin MCKIP", state: "Pahang", daerah: "Kuantan" },
  { name: "Klinik Syed Badaruddin Kemaman", state: "Terengganu", daerah: "Kemaman" },
  // Sited in Terengganu, but its approvals are run out of Balok HQ.
  { name: "Klinik Syed Badaruddin Utama", state: "Terengganu", daerah: "Kemaman" },
];

// ── getStaffGroup ────────────────────────────────────────────────────────────
test("Operation Staff at Balok → operation_balok", () => {
  const s = { branch: BALOK_HQ, category: "Operation Staff", role: "nurse" };
  assert.equal(getStaffGroup(s, branches), "operation_balok");
});

test("Admin Staff at Balok → admin_balok", () => {
  const s = { branch: BALOK_HQ, category: "Admin Staff", role: "clerk" };
  assert.equal(getStaffGroup(s, branches), "admin_balok");
});

test("Operation Staff at Balok with leaveAsAdmin → admin_balok (routes to HOD Balok)", () => {
  const s = { branch: BALOK_HQ, category: "Operation Staff", role: "supervisor", leaveAsAdmin: true };
  assert.equal(getStaffGroup(s, branches), "admin_balok");
});

test("leaveAsAdmin does NOT change routing outside Balok", () => {
  const s = { branch: "Klinik Syed Badaruddin Kuantan", category: "Operation Staff", role: "supervisor", leaveAsAdmin: true };
  assert.equal(getStaffGroup(s, branches), "pahang_lain");
});

test("juru_xray / sonographer at Balok → xray_sono_balok", () => {
  assert.equal(getStaffGroup({ branch: BALOK_HQ, role: "juru_xray", category: "Operation Staff" }, branches), "xray_sono_balok");
  assert.equal(getStaffGroup({ branch: BALOK_HQ, role: "sonographer", category: "Operation Staff" }, branches), "xray_sono_balok");
});

test("juru_audio / pemandu at Balok → their special groups", () => {
  assert.equal(getStaffGroup({ branch: BALOK_HQ, role: "juru_audio" }, branches), "juru_audio_balok");
  assert.equal(getStaffGroup({ branch: BALOK_HQ, role: "pemandu" }, branches), "pemandu_balok");
});

test("Terengganu branch → terengganu", () => {
  const s = { branch: "Klinik Syed Badaruddin Kemaman", category: "Admin Staff", role: "nurse" };
  assert.equal(getStaffGroup(s, branches), "terengganu");
});

test("Pahang doctor → doctor_pahang", () => {
  const s = { branch: "Klinik Syed Badaruddin Kuantan", category: "Doctor", role: "doctor" };
  assert.equal(getStaffGroup(s, branches), "doctor_pahang");
});

// Bentong & MCKIP used to be carved out of doctor_pahang. That left their Doctor
// PIC (and, at Bentong, everyone) without a Peringkat-1 approver — removed 2026-08-03.
test("Pahang doctor at Bentong → doctor_pahang (carve-out removed)", () => {
  const s = { branch: "Klinik Syed Badaruddin Bentong", category: "Doctor", role: "doctor" };
  assert.equal(getStaffGroup(s, branches), "doctor_pahang");
});

test("Pahang doctor at MCKIP → doctor_pahang (carve-out removed)", () => {
  const s = { branch: "Klinik Syed Badaruddin MCKIP", category: "Doctor", role: "doctor" };
  assert.equal(getStaffGroup(s, branches), "doctor_pahang");
});

test("non-doctor at MCKIP still → pahang_lain", () => {
  const s = { branch: "Klinik Syed Badaruddin MCKIP", category: "Operation Staff", role: "nurse" };
  assert.equal(getStaffGroup(s, branches), "pahang_lain");
});

// Utama is in Terengganu but Balok HQ runs its approvals, so it must NOT fall into
// the one-stage terengganu group (confirmed 2026-08-03).
test("doctor at Utama (Terengganu) → doctor_pahang, not terengganu", () => {
  const s = { branch: "Klinik Syed Badaruddin Utama", category: "Doctor", role: "doctor_pic" };
  assert.equal(getStaffGroup(s, branches), "doctor_pahang");
});

test("non-doctor at Utama → pahang_lain (own Doctor PIC + HR), not terengganu", () => {
  const s = { branch: "Klinik Syed Badaruddin Utama", category: "Operation Staff", role: "staff" };
  assert.equal(getStaffGroup(s, branches), "pahang_lain");
});

test("other Terengganu branches keep the one-stage terengganu route", () => {
  const s = { branch: "Klinik Syed Badaruddin Kemaman", category: "Doctor", role: "doctor_pic" };
  assert.equal(getStaffGroup(s, branches), "terengganu");
});

test("unknown / other Pahang staff → pahang_lain", () => {
  const s = { branch: "Klinik Syed Badaruddin Kuantan", category: "Admin Staff", role: "clerk" };
  assert.equal(getStaffGroup(s, branches), "pahang_lain");
});

// ── shouldSkipP1 ─────────────────────────────────────────────────────────────
test("hod_balok and supervisor skip P1; others do not", () => {
  assert.equal(shouldSkipP1({ role: "hod_balok" }), true);
  assert.equal(shouldSkipP1({ role: "supervisor" }), true);
  // Peringkat-1 approvers that are NOT exempt.
  assert.equal(shouldSkipP1({ role: "doctor_pic" }), false);
  assert.equal(shouldSkipP1({ role: "team_leader" }), false);
  assert.equal(shouldSkipP1({ role: "nurse" }), false);
  assert.equal(shouldSkipP1(null), false);
});

// ── getRoutingP1Approvers ────────────────────────────────────────────────────
const staffList = [
  { ic: "SUP1", role: "supervisor", branch: BALOK_HQ, category: "Operation Staff" },
  { ic: "SUP2", role: "supervisor", branch: BALOK_HQ, inactive: true }, // inactive → excluded
  { ic: "HOD1", role: "hod_balok", branch: BALOK_HQ },
  { ic: "PIC1", role: "doctor_pic", branch: "Klinik Syed Badaruddin Kuantan" },
  { ic: "SUPK", role: "supervisor", branch: "Klinik Syed Badaruddin Kuantan" },
  { ic: "PICM", role: "doctor_pic", branch: "Klinik Syed Badaruddin MCKIP", category: "Doctor" },
];

test("operation_balok applicant → Balok HQ supervisors (active only)", () => {
  const applicant = { ic: "A1", branch: BALOK_HQ, category: "Operation Staff", role: "nurse" };
  const out = getRoutingP1Approvers(applicant, staffList, branches, ROUTING_DEFAULTS);
  assert.deepEqual(out.map((s) => s.ic), ["SUP1"]);
});

test("admin_balok applicant → HOD Balok", () => {
  const applicant = { ic: "A2", branch: BALOK_HQ, category: "Admin Staff", role: "clerk" };
  const out = getRoutingP1Approvers(applicant, staffList, branches, ROUTING_DEFAULTS);
  assert.deepEqual(out.map((s) => s.ic), ["HOD1"]);
});

test("Operation Staff at Balok with leaveAsAdmin → HOD Balok (P1 approver)", () => {
  const applicant = { ic: "A5", branch: BALOK_HQ, category: "Operation Staff", role: "nurse", leaveAsAdmin: true };
  const out = getRoutingP1Approvers(applicant, staffList, branches, ROUTING_DEFAULTS);
  assert.deepEqual(out.map((s) => s.ic), ["HOD1"]);
});

test("pahang_lain applicant → doctor_pic at own branch", () => {
  const applicant = { ic: "A3", branch: "Klinik Syed Badaruddin Kuantan", category: "Admin Staff", role: "clerk" };
  const out = getRoutingP1Approvers(applicant, staffList, branches, ROUTING_DEFAULTS);
  assert.deepEqual(out.map((s) => s.ic), ["PIC1"]);
});

test("Doctor PIC at MCKIP → Balok HQ supervisor, not an empty list", () => {
  const applicant = { ic: "PICM", branch: "Klinik Syed Badaruddin MCKIP", category: "Doctor", role: "doctor_pic" };
  const out = getRoutingP1Approvers(applicant, staffList, branches, ROUTING_DEFAULTS);
  assert.deepEqual(out.map((s) => s.ic), ["SUP1"]);
});

test("doctor at Bentong → Balok HQ supervisor", () => {
  const applicant = { ic: "DRB", branch: "Klinik Syed Badaruddin Bentong", category: "Doctor", role: "doctor" };
  const out = getRoutingP1Approvers(applicant, staffList, branches, ROUTING_DEFAULTS);
  assert.deepEqual(out.map((s) => s.ic), ["SUP1"]);
});

test("Operation Staff at MCKIP still → Doctor PIC at own branch", () => {
  const applicant = { ic: "A4", branch: "Klinik Syed Badaruddin MCKIP", category: "Operation Staff", role: "nurse" };
  const out = getRoutingP1Approvers(applicant, staffList, branches, ROUTING_DEFAULTS);
  assert.deepEqual(out.map((s) => s.ic), ["PICM"]);
});

test("Doctor PIC at Utama → Balok HQ supervisor (was: no approver at all)", () => {
  const applicant = { ic: "PICU", branch: "Klinik Syed Badaruddin Utama", category: "Doctor", role: "doctor_pic" };
  const out = getRoutingP1Approvers(applicant, staffList, branches, ROUTING_DEFAULTS);
  assert.deepEqual(out.map((s) => s.ic), ["SUP1"]);
});

test("Operation Staff at Utama → Doctor PIC of their own branch", () => {
  const list = [...staffList, { ic: "PICU", role: "doctor_pic", branch: "Klinik Syed Badaruddin Utama", category: "Doctor" }];
  const applicant = { ic: "A6", branch: "Klinik Syed Badaruddin Utama", category: "Operation Staff", role: "staff" };
  const out = getRoutingP1Approvers(applicant, list, branches, ROUTING_DEFAULTS);
  assert.deepEqual(out.map((s) => s.ic), ["PICU"]);
});

test("hod_balok applicant → no P1 approvers (skips P1)", () => {
  const applicant = { ic: "HOD1", branch: BALOK_HQ, role: "hod_balok" };
  const out = getRoutingP1Approvers(applicant, staffList, branches, ROUTING_DEFAULTS);
  assert.deepEqual(out, []);
});

test("supervisor applicant → no P1 approvers (straight to HR)", () => {
  const applicant = { ic: "SUP1", branch: BALOK_HQ, category: "Operation Staff", role: "supervisor" };
  const out = getRoutingP1Approvers(applicant, staffList, branches, ROUTING_DEFAULTS);
  assert.deepEqual(out, []);
});

test("supervisor with leaveAsAdmin still skips P1 (does not go to HOD Balok)", () => {
  const applicant = { ic: "SUP1", branch: BALOK_HQ, category: "Operation Staff", role: "supervisor", leaveAsAdmin: true };
  const out = getRoutingP1Approvers(applicant, staffList, branches, ROUTING_DEFAULTS);
  assert.deepEqual(out, []);
});

test("team_leader applicant still gets P1 approvers (not exempt)", () => {
  const applicant = { ic: "TL1", branch: BALOK_HQ, category: "Operation Staff", role: "team_leader" };
  const out = getRoutingP1Approvers(applicant, staffList, branches, ROUTING_DEFAULTS);
  assert.deepEqual(out.map((s) => s.ic), ["SUP1"]);
});

test("applicant never routes to themselves", () => {
  const applicant = { ic: "PIC1", branch: "Klinik Syed Badaruddin Kuantan", category: "Admin Staff", role: "doctor_pic" };
  const out = getRoutingP1Approvers(applicant, staffList, branches, ROUTING_DEFAULTS);
  assert.ok(!out.some((s) => s.ic === "PIC1"));
});
