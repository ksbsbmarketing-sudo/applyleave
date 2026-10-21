import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLeaveEmail, kindForStatus } from "./leaveEmail.js";
import { makeNotifyLeaveEmailHandler, RESEND_WINDOW_MS } from "../api/notify-leave-email.js";

const REC = { ic: "S1", name: "ALI", branch: "Klinik A", type: "AL", startDate: "2026-10-27", endDate: "2026-10-29", days: 3, reason: "Urusan <keluarga>" };

test("kindForStatus: every non-pending status maps; PENDING sends nothing", () => {
  assert.equal(kindForStatus("TL APPROVED"), "stage_tl");
  assert.equal(kindForStatus("HOD APPROVED"), "stage_p1");
  assert.equal(kindForStatus("HOD RECOMMENDED"), "stage_p1");
  assert.equal(kindForStatus("APPROVED"), "approved");
  assert.equal(kindForStatus("REJECTED"), "rejected");
  assert.equal(kindForStatus("CANCELLED"), "cancelled");
  assert.equal(kindForStatus("PENDING"), null);
  assert.equal(kindForStatus(undefined), null);
});

test("buildLeaveEmail: subject per kind, details present, HTML escaped", () => {
  const m = buildLeaveEmail(REC, "approved", { recipientName: "ALI", actorName: "HR <Zah>" });
  assert.match(m.subject, /DILULUSKAN/);
  assert.match(m.html, /Cuti Tahunan \(AL\)/);
  assert.match(m.html, /2026-10-27 → 2026-10-29/);
  assert.match(m.html, /Urusan &lt;keluarga&gt;/);
  assert.match(m.html, /HR &lt;Zah&gt;/);
  assert.doesNotMatch(m.html, /<keluarga>/);
  assert.match(m.text, /Tempoh: 3 hari/);
  assert.match(buildLeaveEmail(REC, "rejected").subject, /DITOLAK/);
  assert.match(buildLeaveEmail(REC, "cancelled").subject, /DIBATALKAN/);
  assert.match(buildLeaveEmail(REC, "stage_p1").subject, /Peringkat 1/);
  assert.match(buildLeaveEmail(REC, "approved", { isTest: true }).subject, /^\[UJIAN\]/);
});

// ── handler ──
function res() {
  const r = { statusCode: 0, body: null, headers: {} };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.end = () => r;
  return r;
}
function fakeDb(docs) {
  const updates = [];
  return {
    updates,
    doc: (p) => ({
      get: async () => ({ exists: p in docs, data: () => docs[p] }),
      update: async (u) => { updates.push([p, u]); },
    }),
  };
}
const post = (body, token = "t") => ({ method: "POST", headers: { authorization: token ? `Bearer ${token}` : "", origin: "https://cuti-staff.ksbsb.com.my" }, body });
function setup(docs, { decoded = { ic: "H1" }, configured = true, now = 1_000_000_000 } = {}) {
  const db = fakeDb(docs);
  const sent = [];
  const h = makeNotifyLeaveEmailHandler(() => ({
    db, auth: { verifyIdToken: async () => decoded },
    sendMail: async (m) => { sent.push(m); }, configured: () => configured, now: () => now,
  }));
  return { h, db, sent };
}
const BASE = {
  "staff/H1": { name: "HR ZAH", role: "hr", branch: "Klinik A", email: "hr@x.com" },
  "staff/S1": { name: "ALI", role: "staff", branch: "Klinik A", email: "ali@x.com" },
};

test("handler: approved record emails the applicant and logs it", async () => {
  const { h, db, sent } = setup({ ...BASE, "leaves/L1": { ...REC, status: "APPROVED" } });
  const r = res(); await h(post({ leaveId: "L1" }), r);
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.body, { sent: true, kind: "approved" });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "ali@x.com");
  assert.deepEqual(db.updates, [["leaves/L1", { "emailLog.APPROVED": 1_000_000_000 }]]);
});

test("handler: status with a space is logged under an underscore key", async () => {
  const { h, db } = setup({ ...BASE, "leaves/L1": { ...REC, status: "HOD APPROVED" } });
  const r = res(); await h(post({ leaveId: "L1" }), r);
  assert.equal(r.body.kind, "stage_p1");
  assert.deepEqual(db.updates[0][1], { "emailLog.HOD_APPROVED": 1_000_000_000 });
});

test("handler: same status within the window is not re-sent; after it, it is", async () => {
  const rec = { ...REC, status: "REJECTED", emailLog: { REJECTED: 1_000_000_000 - 1000 } };
  const a = setup({ ...BASE, "leaves/L1": rec });
  const r1 = res(); await a.h(post({ leaveId: "L1" }), r1);
  assert.deepEqual(r1.body, { sent: false, reason: "already_sent" });
  assert.equal(a.sent.length, 0);
  const b = setup({ ...BASE, "leaves/L1": rec }, { now: 1_000_000_000 + RESEND_WINDOW_MS });
  const r2 = res(); await b.h(post({ leaveId: "L1" }), r2);
  assert.equal(r2.body.sent, true);
});

test("handler: PENDING sends nothing; missing applicant email sends nothing", async () => {
  const a = setup({ ...BASE, "leaves/L1": { ...REC, status: "PENDING" } });
  const r1 = res(); await a.h(post({ leaveId: "L1" }), r1);
  assert.deepEqual(r1.body, { sent: false, reason: "no_email_for_status" });
  const b = setup({ ...BASE, "staff/S1": { name: "ALI", branch: "Klinik A" }, "leaves/L1": { ...REC, status: "APPROVED" } });
  const r2 = res(); await b.h(post({ leaveId: "L1" }), r2);
  assert.deepEqual(r2.body, { sent: false, reason: "no_email" });
  assert.equal(b.sent.length, 0);
});

test("handler: test record goes to the caller, never the applicant", async () => {
  const { h, sent } = setup({ ...BASE, "leaves/L1": { ...REC, status: "APPROVED", isTest: true } });
  const r = res(); await h(post({ leaveId: "L1" }), r);
  assert.equal(sent[0].to, "hr@x.com");
  assert.match(sent[0].subject, /^\[UJIAN\]/);
});

test("handler: auth and input guards", async () => {
  const noTok = setup({ ...BASE, "leaves/L1": { ...REC, status: "APPROVED" } });
  const r1 = res(); await noTok.h(post({ leaveId: "L1" }, ""), r1); assert.equal(r1.statusCode, 401);
  const inactive = setup({ ...BASE, "staff/H1": { ...BASE["staff/H1"], inactive: true }, "leaves/L1": { ...REC, status: "APPROVED" } });
  const r2 = res(); await inactive.h(post({ leaveId: "L1" }), r2); assert.equal(r2.statusCode, 403);
  const pharma = setup({ ...BASE, "staff/H1": { ...BASE["staff/H1"], branch: "KSB Pharma Sdn. Bhd." }, "leaves/L1": { ...REC, status: "APPROVED" } });
  const r3 = res(); await pharma.h(post({ leaveId: "L1" }), r3); assert.equal(r3.statusCode, 403);
  const bad = setup(BASE);
  for (const leaveId of ["", "a/b", "../x"]) { const r = res(); await bad.h(post({ leaveId }), r); assert.equal(r.statusCode, 400); }
  const missing = setup(BASE);
  const r4 = res(); await missing.h(post({ leaveId: "NOPE" }), r4); assert.equal(r4.statusCode, 404);
  assert.equal(noTok.sent.length + inactive.sent.length + pharma.sent.length, 0);
});

test("handler: mail not configured → no send, no log", async () => {
  const { h, db, sent } = setup({ ...BASE, "leaves/L1": { ...REC, status: "APPROVED" } }, { configured: false });
  const r = res(); await h(post({ leaveId: "L1" }), r);
  assert.deepEqual(r.body, { sent: false, reason: "mail_not_configured" });
  assert.equal(sent.length, 0);
  assert.equal(db.updates.length, 0);
});
