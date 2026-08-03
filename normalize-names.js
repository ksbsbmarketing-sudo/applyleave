// normalize-names.js — one-off cleanup: put every stored person name in ALL CAPS.
//
// Staff records were a mix of ALL CAPS and lowercase. This rewrites them to the
// same casing the app now applies on save, across all three places a name is
// stored:
//   staff/{ic}.name      — the source of truth
//   directory/{ic}.name  — the login-screen picker
//   leaves/*.name        — denormalised onto every leave record at submit time
//
// Dry run (default, writes nothing):   node normalize-names.js
// Apply:                               node normalize-names.js --apply
//
// Uses ADC, same as pull_from_prod.js.
import admin from "firebase-admin";
// Fungsi yang SAMA seperti aplikasi — bukan salinan, supaya tak boleh terpesong.
import { formatPersonName } from "./src/nameFormat.js";

admin.initializeApp({ projectId: "apply-leave-89ebb" });
const db = admin.firestore();

const APPLY = process.argv.includes("--apply");

async function run() {
  console.log(APPLY ? "MOD: APPLY — akan menulis ke Firestore\n" : "MOD: DRY RUN — tiada tulisan (guna --apply untuk laksana)\n");

  const [staffSnap, dirSnap, leaveSnap] = await Promise.all([
    db.collection("staff").get(),
    db.collection("directory").get(),
    db.collection("leaves").get(),
  ]);

  const plan = { staff: [], directory: [], leaves: [] };

  for (const d of staffSnap.docs) {
    const before = d.data().name || "";
    const after = formatPersonName(before);
    if (after && after !== before) plan.staff.push({ ref: d.ref, id: d.id, before, after });
  }
  for (const d of dirSnap.docs) {
    const before = d.data().name || "";
    const after = formatPersonName(before);
    if (after && after !== before) plan.directory.push({ ref: d.ref, id: d.id, before, after });
  }
  for (const d of leaveSnap.docs) {
    const before = d.data().name || "";
    const after = formatPersonName(before);
    if (after && after !== before) plan.leaves.push({ ref: d.ref, id: d.id, before, after });
  }

  console.log("=== staff (" + plan.staff.length + " / " + staffSnap.size + " berubah) ===");
  plan.staff.forEach((c) => console.log("  " + c.before.padEnd(42) + " → " + c.after));
  console.log("\n=== directory (" + plan.directory.length + " / " + dirSnap.size + ") ===");
  console.log("  (nama sama seperti staff — dipapar ringkas)");
  console.log("\n=== leaves (" + plan.leaves.length + " / " + leaveSnap.size + " rekod) ===");
  const byName = {};
  plan.leaves.forEach((c) => { byName[c.before] = (byName[c.before] || 0) + 1; });
  Object.entries(byName).forEach(([n, count]) => console.log("  " + n.padEnd(42) + " × " + count));

  if (!APPLY) {
    console.log("\nTiada perubahan ditulis. Jalankan dengan --apply untuk laksana.");
    return;
  }

  // Batched writes — Firestore caps a batch at 500 operations.
  const all = [...plan.staff, ...plan.directory, ...plan.leaves];
  let written = 0;
  for (let i = 0; i < all.length; i += 400) {
    const batch = db.batch();
    all.slice(i, i + 400).forEach((c) => batch.update(c.ref, { name: c.after }));
    await batch.commit();
    written += Math.min(400, all.length - i);
    process.stdout.write(".");
  }
  console.log("\n✅ Dikemas kini: " + plan.staff.length + " staff, " + plan.directory.length + " directory, " + plan.leaves.length + " rekod cuti (" + written + " tulisan).");
}

run().then(() => process.exit(0)).catch((e) => {
  console.error("\nGagal:", e.message);
  if (/RESOURCE_EXHAUSTED|Quota/i.test(e.message)) {
    console.error("Kuota Firestore harian (pelan Spark) sudah habis — cuba semula selepas ia ditetapkan semula (tengah malam waktu Pasifik ≈ 4 petang MYT).");
  }
  process.exit(1);
});
