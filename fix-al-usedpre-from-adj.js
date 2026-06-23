// fix-al-usedpre-from-adj.js
// Betulkan perwakilan Formula B untuk AL: al_adj = "baki AL SEBELUM cuti dalam sistem".
// Maka penggunaan pra-sistem = Jumlah − al_adj, dan dalam mod AUTO cuti dalam sistem
// (rekod diluluskan) tolak SELANJUTNYA ⇒ Baki = al_adj − rekod.
//
//   al_used_pre  = max(0, Jumlah − al_adj)   (penggunaan sebelum sistem)
//   al_pelarasan = 0                          (bukan pelarasan; betulkan paparan)
//   Jumlah = ent_AL (override) + ent_CF
//
// Mod AUTO: Baki = Jumlah − al_used_pre − rekodAL − 0 = al_adj − rekodAL  ✓
//
// Idempotent: tetapkan untuk SEMUA staf al_adj>0 (termasuk yg dimigrasi sebelum ini).
// Guna: node fix-al-usedpre-from-adj.js            (DRY-RUN)
//       node fix-al-usedpre-from-adj.js --commit   (tulis)

import admin from "firebase-admin";
const COMMIT = process.argv.includes("--commit");
admin.initializeApp({ projectId: "apply-leave-89ebb" });
const db = admin.firestore();

async function main() {
  console.log(COMMIT ? "MOD: COMMIT\n" : "MOD: DRY-RUN\n");
  const [staffSnap, leavesSnap] = await Promise.all([
    db.collection("staff").get(),
    db.collection("leaves").get(),
  ]);
  const leaves = leavesSnap.docs.map((d) => d.data());
  const sysAL = (ic) =>
    leaves
      .filter((r) => r.ic === ic && r.status === "APPROVED" && r.type === "AL")
      .reduce((a, r) => a + parseFloat(r.days || 0), 0);

  const plan = [];
  const noEnt = [];
  staffSnap.forEach((docSnap) => {
    const x = docSnap.data();
    const alAdj = parseFloat(x.al_adj || 0);
    if (!(alAdj > 0)) return;
    if (x.ent_AL === undefined || x.ent_AL === null) { noEnt.push(x.name); return; }
    const jumlah = parseFloat(x.ent_AL) + parseFloat(x.ent_CF || 0);
    const usedPre = Math.max(0, +(jumlah - alAdj).toFixed(2));
    const sys = sysAL(x.ic);
    const bakiAuto = +(jumlah - usedPre - sys).toFixed(2); // = alAdj - sys
    plan.push({ ref: docSnap.ref, name: x.name, jumlah, alAdj, usedPre, sys, bakiAuto,
      cur_used_pre: x.al_used_pre, cur_pel: x.al_pelarasan });
  });

  console.log(`Sasaran: ${plan.length} | tiada ent_AL (dilangkau): ${noEnt.length}`, noEnt.length ? noEnt : "");
  console.log("\nContoh perubahan (al_used_pre=Jumlah−al_adj, al_pelarasan=0):");
  plan.slice(0, 12).forEach((p) =>
    console.log(`  ${p.name}: usedPre ${p.cur_used_pre}→${p.usedPre}, pel ${p.cur_pel}→0 | rekodAL ${p.sys} | Baki(AUTO)=${p.bakiAuto} (al_adj ${p.alAdj})`)
  );

  if (!COMMIT) { console.log("\nDRY-RUN selesai. --commit untuk tulis."); process.exit(0); }

  let batch = db.batch(), n = 0;
  for (const p of plan) {
    batch.update(p.ref, { al_used_pre: p.usedPre, al_pelarasan: 0 });
    if (++n % 400 === 0) { await batch.commit(); batch = db.batch(); }
  }
  await batch.commit();
  console.log(`\n✅ Dikemas kini ${plan.length} rekod staf.`);
  process.exit(0);
}
main().catch((e) => { console.error("Gagal:", e.message); process.exit(1); });
