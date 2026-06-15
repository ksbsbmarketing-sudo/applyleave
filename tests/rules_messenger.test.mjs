// Messenger DM-privacy rules (roomId-based, no participants/backfill).
// Verifies Firestore accepts the client's query shapes (roomId / documentId)
// and rejects any global scan that would expose other people's DMs.
// run: firebase emulators:exec --only firestore "node --test tests/rules_messenger.test.mjs"
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { setDoc, getDoc, getDocs, deleteDoc, doc, collection, query, where, documentId } from "firebase/firestore";

let testEnv;
const staffAuth = (ic) => ({ ic, canApprove: false, manageStaff: false, firebase: { sign_in_provider: "password" } });

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "apply-leave-89ebb",
    firestore: { rules: readFileSync("firestore.rules", "utf8") },
  });
});
after(async () => { await testEnv.cleanup(); });

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    // NOTE: no `participants` field anywhere — simulating existing (un-migrated) data.
    await setDoc(doc(db, "messenger_rooms", "dm_A__B"), { type: "dm" });
    await setDoc(doc(db, "messenger_rooms", "all_ksb"), { type: "group" });
    await setDoc(doc(db, "messenger_messages", "m_dm1"), { roomId: "dm_A__B", senderIC: "A", text: "rahsia", timestamp: 5 });
    await setDoc(doc(db, "messenger_messages", "m_grp1"), { roomId: "all_ksb", senderIC: "A", text: "hi all", timestamp: 6 });
  });
});

const db = (ic) => testEnv.authenticatedContext(ic, staffAuth(ic)).firestore();

// ---- Single-doc gets (baseline) ----
test("get: A reads own DM message; C denied", async () => {
  await assertSucceeds(getDoc(doc(db("A"), "messenger_messages", "m_dm1")));
  await assertFails(getDoc(doc(db("C"), "messenger_messages", "m_dm1")));
});

// ---- THE KEY QUESTION: open-room query where(roomId == X) ----
test("query where roomId==dm: participant A allowed", async () => {
  await assertSucceeds(getDocs(query(collection(db("A"), "messenger_messages"), where("roomId", "==", "dm_A__B"))));
});
test("query where roomId==dm: third party C DENIED", async () => {
  await assertFails(getDocs(query(collection(db("C"), "messenger_messages"), where("roomId", "==", "dm_A__B"))));
});
test("query where roomId==group: anyone allowed", async () => {
  await assertSucceeds(getDocs(query(collection(db("C"), "messenger_messages"), where("roomId", "==", "all_ksb"))));
});

// ---- Global leak attempts must be rejected ----
test("unfiltered collection query by C is DENIED (would expose DMs)", async () => {
  await assertFails(getDocs(collection(db("C"), "messenger_messages")));
});
test("global timestamp query by C is DENIED", async () => {
  await assertFails(getDocs(query(collection(db("C"), "messenger_messages"), where("timestamp", ">", 0))));
});

// ---- Rooms list via documentId() in [...] ----
test("rooms documentId() in my-room-ids: A allowed", async () => {
  await assertSucceeds(getDocs(query(collection(db("A"), "messenger_rooms"), where(documentId(), "in", ["all_ksb", "dm_A__B"]))));
});
test("rooms documentId() in someone-else-DM: C DENIED", async () => {
  await assertFails(getDocs(query(collection(db("C"), "messenger_rooms"), where(documentId(), "in", ["dm_A__B"]))));
});
test("rooms documentId() in only group: C allowed", async () => {
  await assertSucceeds(getDocs(query(collection(db("C"), "messenger_rooms"), where(documentId(), "in", ["all_ksb"]))));
});

// ---- create / spoof / delete ----
test("A can post into own DM with correct senderIC", async () => {
  await assertSucceeds(setDoc(doc(db("A"), "messenger_messages", "m_new"),
    { roomId: "dm_A__B", senderIC: "A", text: "hi", timestamp: 9 }));
});
test("C cannot post into A&B's DM", async () => {
  await assertFails(setDoc(doc(db("C"), "messenger_messages", "m_hack"),
    { roomId: "dm_A__B", senderIC: "C", text: "intrude", timestamp: 9 }));
});
test("A cannot spoof senderIC as B", async () => {
  await assertFails(setDoc(doc(db("A"), "messenger_messages", "m_spoof"),
    { roomId: "dm_A__B", senderIC: "B", text: "fake", timestamp: 9 }));
});
test("non-sender (even a participant) cannot delete a message", async () => {
  await assertFails(deleteDoc(doc(db("B"), "messenger_messages", "m_dm1"))); // B is in the DM but not the sender
});
test("sender can delete own message", async () => {
  await assertSucceeds(deleteDoc(doc(db("A"), "messenger_messages", "m_dm1"))); // A sent it
});
