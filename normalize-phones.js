// normalize-phones.js — one-off cleanup: store every phone as 60XXXXXXXXX.
//
// "Tambah Staff" and the HR edit form used to save whatever was typed, so some
// records hold 01XXXXXXXX. Those staff could not save their own profile at all:
// saveSelfProfile validates the phone before writing anything, so the stored
// number blocked their name and address edits too. Both forms now normalise on
// save; this fixes the records that predate that.
//
// Dry run (default, writes nothing):   node normalize-phones.js
// Apply:                               node normalize-phones.js --apply
//
// Uses ADC, same as normalize-names.js.
import admin from "firebase-admin";
// Fungsi yang SAMA seperti aplikasi — bukan salinan.
import { normalizePhone, isValidPhone } from "./src/phoneFormat.js";

admin.initializeApp({ projectId: "apply-leave-89ebb" });
const db = admin.firestore();

const APPLY = process.argv.includes("--apply");

async function run() {
  console.log(APPLY ? "MOD: APPLY — akan menulis ke Firestore\n" : "MOD: DRY RUN — tiada tulisan (guna --apply untuk laksana)\n");

  const snap = await db.collection("staff").get();
  const changes = [];
  const stillBad = [];

  snap.docs.forEach((d) => {
    const before = d.data().phone;
    if (before === undefined || before === null || before === "") return;
    const after = normalizePhone(before);
    if (after === String(before)) return;
    changes.push({ id: d.id, name: d.data().name, before, after });
    if (!isValidPhone(after)) stillBad.push({ name: d.data().name, before, after });
  });

  console.log(`=== staff (${changes.length} / ${snap.size} berubah) ===`);
  changes.forEach((c) => console.log(`  ${String(c.name).padEnd(42)} ${c.before} → ${c.after}`));

  if (stillBad.length) {
    console.log(`\n⚠️  ${stillBad.length} nombor masih tidak sah selepas normalisasi — perlu semakan manual:`);
    stillBad.forEach((c) => console.log(`  ${c.name}: "${c.before}" → "${c.after}"`));
  }

  if (!APPLY) {
    console.log("\nTiada perubahan ditulis. Jalankan dengan --apply untuk laksana.");
    return;
  }

  let batch = db.batch();
  let n = 0;
  for (const c of changes) {
    batch.update(db.collection("staff").doc(c.id), { phone: c.after });
    if (++n % 400 === 0) { await batch.commit(); batch = db.batch(); }
  }
  if (n % 400 !== 0) await batch.commit();
  console.log(`\n✅ Dikemas kini: ${changes.length} rekod staff (${changes.length} tulisan).`);
}

run().then(() => process.exit(0)).catch((e) => { console.error("FATAL:", e.code || e.message); process.exit(1); });
