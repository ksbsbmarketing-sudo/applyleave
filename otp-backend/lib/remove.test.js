import { test } from "node:test";
import assert from "node:assert/strict";
import { removeStaff } from "./remove.js";

const notFound = () => Object.assign(new Error(), { code: "auth/user-not-found" });
const fakeDb = (log) => ({ doc: (p) => ({ delete: async () => { log.push(`delete ${p}`); } }) });

test("removeStaff deletes the auth account first, then directory, session and staff", async () => {
  const log = [];
  const auth = {
    getUserByEmail: async (e) => { assert.equal(e, "S1@ksb-leave.local"); return { uid: "U1" }; },
    deleteUser: async (uid) => { log.push(`deleteUser ${uid}`); },
  };
  assert.deepEqual(await removeStaff({ db: fakeDb(log), auth, ic: "S1" }), { ok: true });
  assert.deepEqual(log, ["deleteUser U1", "delete directory/S1", "delete sessions/S1", "delete staff/S1"]);
});

test("removeStaff: no auth account is fine (retry or never provisioned)", async () => {
  const log = [];
  const auth = { getUserByEmail: async () => { throw notFound(); }, deleteUser: async () => { log.push("deleteUser"); } };
  assert.deepEqual(await removeStaff({ db: fakeDb(log), auth, ic: "S1" }), { ok: true });
  assert.deepEqual(log, ["delete directory/S1", "delete sessions/S1", "delete staff/S1"]);
});

test("removeStaff: other auth errors stop before any Firestore delete", async () => {
  const log = [];
  const auth = { getUserByEmail: async () => { throw Object.assign(new Error("boom"), { code: "auth/internal-error" }); } };
  await assert.rejects(removeStaff({ db: fakeDb(log), auth, ic: "S1" }), /boom/);
  assert.deepEqual(log, []);
});
