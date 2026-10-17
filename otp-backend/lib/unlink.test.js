import { test } from "node:test";
import assert from "node:assert/strict";
import { unlinkGoogle } from "./unlink.js";

test("unlinkGoogle removes the google provider and clears googleEmail", async () => {
  const docs = { "staff/S1": { ic: "S1", googleEmail: "a@gmail.com" } };
  const db = { doc: (p) => ({ set: async (d, o) => { docs[p] = o?.merge ? { ...docs[p], ...d } : d; } }) };
  const user = { uid: "U1", email: "S1@ksb-leave.local", providerData: [{ providerId: "password" }, { providerId: "google.com" }] };
  let unlinked;
  const auth = {
    getUserByEmail: async (e) => { if (e !== user.email) throw Object.assign(new Error(), { code: "auth/user-not-found" }); return user; },
    updateUser: async (uid, upd) => { unlinked = { uid, upd }; },
  };
  assert.deepEqual(await unlinkGoogle({ db, auth, ic: "S1" }), { ok: true });
  assert.deepEqual(unlinked, { uid: "U1", upd: { providersToUnlink: ["google.com"] } });
  assert.equal(docs["staff/S1"].googleEmail, null);
});

test("unlinkGoogle: no auth account → 404", async () => {
  const auth = { getUserByEmail: async () => { throw Object.assign(new Error(), { code: "auth/user-not-found" }); } };
  assert.deepEqual(await unlinkGoogle({ db: {}, auth, ic: "X" }), { ok: false, status: 404, error: "not_found" });
});
