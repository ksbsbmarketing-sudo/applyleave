// provision-one.js — provision named staff only, instead of all 119.
//
// provision-auth.js walks every staff doc: ~119 reads plus ~119 directory writes
// every run. On the Spark plan that is a meaningful slice of the daily quota, and
// it is wasted when only one new hire needs an account. This does the same three
// things for the ICs you name:
//   1. create the Firebase Auth user (password = IC unless staff.password is set)
//   2. set custom claims (ic, canApprove, manageStaff) from config/rolePermissions
//   3. write directory/{ic} — the login-screen picker reads this, not staff/{ic},
//      so without it the name never appears at login and cannot be typed either
//
//   node provision-one.js 741216065312 771025115484
//
// Safe to re-run: an existing Auth user is reused and its password left alone.
// Uses ADC, same as provision-auth.js.
import admin from "firebase-admin";

admin.initializeApp({ projectId: "apply-leave-89ebb" });
const db = admin.firestore();
const auth = admin.auth();

const DOMAIN = "ksb-leave.local";
const emailForIC = (ic) => `${String(ic).replace(/[^a-zA-Z0-9]/g, "")}@${DOMAIN}`;

const ics = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!ics.length) {
  console.error("Guna: node provision-one.js <ic> [ic...]");
  process.exit(1);
}

async function run() {
  const permSnap = await db.doc("config/rolePermissions").get();
  if (!permSnap.exists) throw new Error("config/rolePermissions missing — run seed-role-permissions.js first.");
  const perms = permSnap.data();

  for (const ic of ics) {
    const d = await db.collection("staff").doc(ic).get();
    if (!d.exists) { console.log(`❌ ${ic}: tiada dokumen staff — langkau.`); continue; }
    const s = d.data();

    let pwd = String(s.password || ic).trim();
    if (pwd.length < 6) pwd = pwd.padEnd(6, "0");

    let u, created = false;
    try {
      u = await auth.getUserByEmail(emailForIC(ic));
    } catch {
      u = await auth.createUser({ email: emailForIC(ic), password: pwd, displayName: s.name || ic });
      created = true;
    }

    const rp = perms[s.role] || { canApprove: false, manageStaff: false };
    await auth.setCustomUserClaims(u.uid, { ic, canApprove: !!rp.canApprove, manageStaff: !!rp.manageStaff });
    await auth.updateUser(u.uid, { disabled: !!s.inactive });
    await db.doc(`directory/${ic}`).set({
      ic, name: s.name || "", branch: s.branch || "", inactive: !!s.inactive,
    });

    console.log(`✅ ${ic} — ${s.name}`);
    console.log(`   auth      : ${created ? `DICIPTA (kata laluan awal: ${pwd})` : "sudah ada (kata laluan tidak diubah)"}`);
    console.log(`   claims    : role=${s.role} canApprove=${!!rp.canApprove} manageStaff=${!!rp.manageStaff}`);
    console.log(`   directory : "${s.name}" @ ${s.branch}`);
  }
  console.log(`\nSiap. Staf berkenaan patut muncul di senarai log masuk selepas app dimuat semula.`);
}

run().then(() => process.exit(0)).catch((e) => {
  if (e.code === 8 || /RESOURCE_EXHAUSTED|Quota exceeded/i.test(e.message || "")) {
    console.error("❌ Kuota harian Firestore habis. Kuota reset 3:00 PM waktu Malaysia — cuba semula selepas itu.");
  } else {
    console.error("FATAL:", e.code || e.message);
  }
  process.exit(1);
});
