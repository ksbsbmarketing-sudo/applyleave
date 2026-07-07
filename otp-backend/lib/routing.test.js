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

test("Pahang doctor (not Bentong / not MCKIP) → doctor_pahang", () => {
  const s = { branch: "Klinik Syed Badaruddin Kuantan", category: "Doctor", role: "doctor" };
  assert.equal(getStaffGroup(s, branches), "doctor_pahang");
});

test("Pahang doctor at Bentong → pahang_lain (not doctor_pahang)", () => {
  const s = { branch: "Klinik Syed Badaruddin Bentong", category: "Doctor", role: "doctor" };
  assert.equal(getStaffGroup(s, branches), "pahang_lain");
});

test("Pahang doctor at MCKIP → pahang_lain (not doctor_pahang)", () => {
  const s = { branch: "Klinik Syed Badaruddin MCKIP", category: "Doctor", role: "doctor" };
  assert.equal(getStaffGroup(s, branches), "pahang_lain");
});

test("unknown / other Pahang staff → pahang_lain", () => {
  const s = { branch: "Klinik Syed Badaruddin Kuantan", category: "Admin Staff", role: "clerk" };
  assert.equal(getStaffGroup(s, branches), "pahang_lain");
});

// ── shouldSkipP1 ─────────────────────────────────────────────────────────────
test("hod_balok skips P1; others do not", () => {
  assert.equal(shouldSkipP1({ role: "hod_balok" }), true);
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

test("pahang_lain applicant → doctor_pic at own branch", () => {
  const applicant = { ic: "A3", branch: "Klinik Syed Badaruddin Kuantan", category: "Admin Staff", role: "clerk" };
  const out = getRoutingP1Approvers(applicant, staffList, branches, ROUTING_DEFAULTS);
  assert.deepEqual(out.map((s) => s.ic), ["PIC1"]);
});

test("hod_balok applicant → no P1 approvers (skips P1)", () => {
  const applicant = { ic: "HOD1", branch: BALOK_HQ, role: "hod_balok" };
  const out = getRoutingP1Approvers(applicant, staffList, branches, ROUTING_DEFAULTS);
  assert.deepEqual(out, []);
});

test("applicant never routes to themselves", () => {
  const applicant = { ic: "SUP1", branch: BALOK_HQ, category: "Operation Staff", role: "supervisor" };
  const out = getRoutingP1Approvers(applicant, staffList, branches, ROUTING_DEFAULTS);
  assert.ok(!out.some((s) => s.ic === "SUP1"));
});
