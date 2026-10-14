// strip-password-field.js — delete the legacy plaintext `password` field from
// every staff/{ic} document.
//
// WHY: staff docs are readable by every signed-in clinic user (firestore.rules
// companyOK), and the provision scripts used this field as the INITIAL Firebase
// Auth password. So any staff member could read a colleague's login if it had
// never been changed. Login does not use the field (Firebase Auth holds the real
// password), and the app stopped writing it long ago.
//
//   node strip-password-field.js           # dry run: count only
//   node strip-password-field.js --apply   # delete the field
//
// Never prints a password value. Uses ADC, same as provision-one.js.
import admin from "firebase-admin";

admin.initializeApp({ projectId: "apply-leave-89ebb" });
const db = admin.firestore();
const APPLY = process.argv.includes("--apply");

const snap = await db.collection("staff").get();
const withField = snap.docs.filter((d) => d.data().password !== undefined);
console.log(`${withField.length} / ${snap.size} dokumen staf ada medan "password".`);

if (APPLY && withField.length) {
  for (let i = 0; i < withField.length; i += 400) {      // batch limit 500
    const batch = db.batch();
    withField.slice(i, i + 400).forEach((d) => batch.update(d.ref, { password: admin.firestore.FieldValue.delete() }));
    await batch.commit();
  }
  const left = (await db.collection("staff").get()).docs.filter((d) => d.data().password !== undefined).length;
  console.log(`✅ Dibuang. Baki dokumen dengan medan "password": ${left}`);
} else if (!APPLY) {
  console.log("(dry run — guna --apply untuk membuang)");
}
process.exit(0);
