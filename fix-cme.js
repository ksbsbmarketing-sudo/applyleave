// fix-cme.js
// Kosongkan medan ent_CME yang usang supaya peruntukan CME dikuasai getEntitlementCME
// (Doctor → 5, bukan-doktor → 0). Sasaran: ent_CME === 0 (mana-mana staf) ATAU staf
// bukan-doktor yang ada ent_CME. Doktor dengan override sebenar (ent_CME > 0) dikekalkan.
//
// Guna: node fix-cme.js            (DRY-RUN)
//       node fix-cme.js --commit   (tulis — padam ent_CME)

import admin from "firebase-admin";
const COMMIT = process.argv.includes("--commit");
admin.initializeApp({ projectId: "apply-leave-89ebb" });
const db = admin.firestore();

async function main() {
  console.log(COMMIT ? "MOD: COMMIT (padam ent_CME usang)\n" : "MOD: DRY-RUN\n");
  const snap = await db.collection("staff").get();
  const targets = [];
  snap.forEach((d) => {
    const x = d.data();
    if (x.ent_CME === undefined || x.ent_CME === null) return;
    const isDoctor = x.category === "Doctor";
    const stale = parseFloat(x.ent_CME) === 0 || !isDoctor;
    if (stale) targets.push({ ref: d.ref, name: x.name, ent_CME: x.ent_CME, category: x.category });
  });
  console.log(`Staf dengan ent_CME usang: ${targets.length}`);
  targets.slice(0, 12).forEach((t) => console.log(`  ${t.name} [${t.category}]: ent_CME ${t.ent_CME} → (padam)`));
  if (targets.length > 12) console.log(`  …dan ${targets.length - 12} lagi`);

  if (!COMMIT) { console.log("\nDRY-RUN selesai. --commit untuk padam."); process.exit(0); }

  let batch = db.batch(), n = 0;
  for (const t of targets) {
    batch.update(t.ref, { ent_CME: admin.firestore.FieldValue.delete() });
    if (++n % 400 === 0) { await batch.commit(); batch = db.batch(); }
  }
  await batch.commit();
  console.log(`\n✅ Dipadam ent_CME daripada ${targets.length} rekod staf.`);
  process.exit(0);
}
main().catch((e) => { console.error("Gagal:", e.message); process.exit(1); });
