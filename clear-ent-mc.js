// clear-ent-mc.js
// Kosongkan medan ent_MC (nilai tidak konsisten) supaya peruntukan MC dikuasai
// formula tahun khidmat getEntitlementMC (14/18/22). ent_MC kekal sebagai override
// HR jika diset semula kemudian.
//
// Guna: node clear-ent-mc.js            (DRY-RUN)
//       node clear-ent-mc.js --commit   (tulis — padam ent_MC)

import admin from "firebase-admin";
const COMMIT = process.argv.includes("--commit");
admin.initializeApp({ projectId: "apply-leave-89ebb" });
const db = admin.firestore();

async function main() {
  console.log(COMMIT ? "MOD: COMMIT (padam ent_MC)\n" : "MOD: DRY-RUN\n");
  const snap = await db.collection("staff").get();
  const targets = [];
  snap.forEach((d) => {
    const x = d.data();
    if (x.ent_MC !== undefined) targets.push({ ref: d.ref, name: x.name, ent_MC: x.ent_MC });
  });
  console.log(`Staf dengan ent_MC diset: ${targets.length}`);
  targets.slice(0, 12).forEach((t) => console.log(`  ${t.name}: ent_MC ${t.ent_MC} → (padam)`));
  if (targets.length > 12) console.log(`  …dan ${targets.length - 12} lagi`);

  if (!COMMIT) { console.log("\nDRY-RUN selesai. --commit untuk padam."); process.exit(0); }

  let batch = db.batch(), n = 0;
  for (const t of targets) {
    batch.update(t.ref, { ent_MC: admin.firestore.FieldValue.delete() });
    if (++n % 400 === 0) { await batch.commit(); batch = db.batch(); }
  }
  await batch.commit();
  console.log(`\n✅ Dipadam ent_MC daripada ${targets.length} rekod staf.`);
  process.exit(0);
}
main().catch((e) => { console.error("Gagal:", e.message); process.exit(1); });
