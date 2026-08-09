import test from "node:test";
import assert from "node:assert/strict";
import { applyCors } from "./cors.js";

// Minimal req/res doubles — applyCors only touches these few members.
const mkRes = () => {
  const headers = {};
  return {
    headers,
    statusCode: null,
    ended: false,
    setHeader(k, v) { headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    end() { this.ended = true; return this; },
  };
};
const mkReq = (origin, method = "POST") => ({ method, headers: origin ? { origin } : {} });

const APP = "https://cuti-staff.ksbsb.com.my";
const LEGACY = "https://apply-leave-89ebb.web.app";

test("allows the production cPanel origin when listed", () => {
  process.env.ALLOWED_ORIGIN = `${LEGACY},${APP}`;
  const res = mkRes();
  applyCors(mkReq(APP), res);
  assert.equal(res.headers["Access-Control-Allow-Origin"], APP);
});

test("still allows the legacy Firebase Hosting origin", () => {
  process.env.ALLOWED_ORIGIN = `${LEGACY},${APP}`;
  const res = mkRes();
  applyCors(mkReq(LEGACY), res);
  assert.equal(res.headers["Access-Control-Allow-Origin"], LEGACY);
});

test("does not echo an origin that is not on the list", () => {
  process.env.ALLOWED_ORIGIN = `${LEGACY},${APP}`;
  const res = mkRes();
  applyCors(mkReq("https://evil.example"), res);
  assert.notEqual(res.headers["Access-Control-Allow-Origin"], "https://evil.example");
});

test("tolerates spaces and trailing slashes in the env list", () => {
  process.env.ALLOWED_ORIGIN = `${LEGACY}/ , ${APP}/`;
  const res = mkRes();
  applyCors(mkReq(APP), res);
  assert.equal(res.headers["Access-Control-Allow-Origin"], APP);
});

// The actual outage: ALLOWED_ORIGIN on Vercel still named only the retired
// web.app host, so every reset from the real staff domain was CORS-blocked and
// surfaced as "Tiada sambungan internet". Deploying the file must fix it even
// if nobody ever touches the env var.
test("stale legacy-only ALLOWED_ORIGIN still allows the production domain", () => {
  process.env.ALLOWED_ORIGIN = LEGACY;
  const res = mkRes();
  applyCors(mkReq(APP), res);
  assert.equal(res.headers["Access-Control-Allow-Origin"], APP);
});

test("unset ALLOWED_ORIGIN allows the production domain (not a wildcard)", () => {
  delete process.env.ALLOWED_ORIGIN;
  const res = mkRes();
  applyCors(mkReq(APP), res);
  assert.equal(res.headers["Access-Control-Allow-Origin"], APP);
});

test("unset ALLOWED_ORIGIN does not fall open to any origin", () => {
  delete process.env.ALLOWED_ORIGIN;
  const res = mkRes();
  applyCors(mkReq("https://evil.example"), res);
  assert.notEqual(res.headers["Access-Control-Allow-Origin"], "*");
  assert.notEqual(res.headers["Access-Control-Allow-Origin"], "https://evil.example");
});

test("extra origin from ALLOWED_ORIGIN is added to the built-in list", () => {
  process.env.ALLOWED_ORIGIN = "https://staging.ksbsb.com.my";
  const res = mkRes();
  applyCors(mkReq("https://staging.ksbsb.com.my"), res);
  assert.equal(res.headers["Access-Control-Allow-Origin"], "https://staging.ksbsb.com.my");
});

test("preflight short-circuits with 204 and reports handled", () => {
  process.env.ALLOWED_ORIGIN = APP;
  const res = mkRes();
  const handled = applyCors(mkReq(APP, "OPTIONS"), res);
  assert.equal(handled, true);
  assert.equal(res.statusCode, 204);
  assert.equal(res.ended, true);
});

test("Vary: Origin is always set so caches don't cross-serve origins", () => {
  process.env.ALLOWED_ORIGIN = `${LEGACY},${APP}`;
  const res = mkRes();
  applyCors(mkReq(APP), res);
  assert.equal(res.headers["Vary"], "Origin");
});

test("explicit wildcard is still honoured for local dev", () => {
  process.env.ALLOWED_ORIGIN = "*";
  const res = mkRes();
  applyCors(mkReq("http://localhost:5173"), res);
  assert.equal(res.headers["Access-Control-Allow-Origin"], "*");
});
