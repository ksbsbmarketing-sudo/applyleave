// migrate-al-adj-to-pelarasan.js
// Pindah baki AL warisan (al_adj) ke medan Formula B "Pelarasan HR" (al_pelarasan)
// tanpa mengubah baki AL sebenar.
//
//   Baki (sebelum, via fallback) = al_adj − GunaDalamSistem
//   Selepas migrasi: al_used_pre = 0, al_pelarasan = Jumlah − al_adj
//   ⇒ Baki = Jumlah − 0 − GunaDalamSistem − (Jumlah − al_adj) = al_adj − GunaDalamSistem  (SAMA)
//
// Jumlah = ent_AL (override tersimpan) + ent_CF. Hanya staf dengan ent_AL ditetapkan
// dimigrasi; jika tiada ent_AL, staf DILANGKAU & dilaporkan (tiada tekaan).
//
// Kriteria sasaran (sama dengan syarat fallback dalam getLeaveStats):
//   al_adj > 0  DAN  al_used_pre belum ada  DAN  al_pelarasan belum ada.
//
// Guna: node migrate-al-adj-to-pelarasan.js            (DRY-RUN, tiada tulis)
//       node migrate-al-adj-to-pelarasan.js --commit   (tulis ke Firestore)
//
// Perlu ADC: gcloud auth application-default login (atau GOOGLE_APPLICATION_CREDENTIALS).

import admin from "firebase-admin";

const COMMIT = process.argv.includes("--commit");

admin.initializeApp({ projectId: "apply-leave-89ebb" });
const db = admin.firestore();

async function main() {
  console.log(COMMIT ? "MOD: COMMIT (akan tulis ke Firestore)\n" : "MOD: DRY-RUN (tiada tulis)\n");

  const snap = await db.collection("staff").get();
  const plan = [];
  const skippedExisting = [];
  const skippedNoEnt = [];

  snap.forEach((docSnap) => {
    const x = docSnap.data();
    const alAdj = parseFloat(x.al_adj || 0);
    if (!(alAdj > 0)) return;

    // Hanya jika fallback masih terpakai (tiada nilai Formula B AL)
    if (x.al_used_pre !== undefined || x.al_pelarasan !== undefined) {
      skippedExisting.push(x.name);
      return;
    }
    // Perlu ent_AL tersimpan untuk kira Jumlah dengan pasti
    if (x.ent_AL === undefined || x.ent_AL === null) {
      skippedNoEnt.push(x.name);
      return;
    }

    const jumlah = parseFloat(x.ent_AL) + parseFloat(x.ent_CF || 0);
    const pelarasan = +(jumlah - alAdj).toFixed(2);
    plan.push({ ref: docSnap.ref, name: x.name, jumlah, alAdj, pelarasan });
  });

  console.log(`Sasaran migrasi : ${plan.length}`);
  console.log(`Dilangkau (sudah ada nilai Formula B) : ${skippedExisting.length}`);
  console.log(`Dilangkau (tiada ent_AL) : ${skippedNoEnt.length}`, skippedNoEnt.length ? skippedNoEnt : "");

  const negatives = plan.filter((p) => p.pelarasan < 0);
  if (negatives.length) {
    console.log("\n⚠️ pelarasan negatif (al_adj > Jumlah) — DIHENTIKAN, sila semak:");
    negatives.forEach((p) => console.log(`   ${p.name}: Jumlah ${p.jumlah}, al_adj ${p.alAdj}`));
    process.exit(1);
  }

  console.log("\nPerubahan (al_used_pre=0, al_pelarasan=Jumlah−al_adj):");
  plan.forEach((p) =>
    console.log(`   ${p.name}: ${p.jumlah} − ${p.alAdj} ⇒ al_pelarasan=${p.pelarasan}`)
  );

  if (!COMMIT) {
    console.log("\nDRY-RUN selesai. Jalankan dengan --commit untuk tulis.");
    process.exit(0);
  }

  // Tulis berkumpulan (batch maks 500)
  let batch = db.batch();
  let n = 0;
  for (const p of plan) {
    batch.update(p.ref, { al_used_pre: 0, al_pelarasan: p.pelarasan });
    n++;
    if (n % 400 === 0) { await batch.commit(); batch = db.batch(); }
  }
  await batch.commit();
  console.log(`\n✅ Dikemas kini ${plan.length} rekod staf.`);
  process.exit(0);
}

main().catch((e) => { console.error("Migrasi gagal:", e.message); process.exit(1); });
