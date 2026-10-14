// sync-claims.js — push config/rolePermissions into staff custom claims.
//
// The Access Control screen (RBAC) is the only place permissions are edited. When
// it saves, it also writes config/rolePermissions (derived — src/rolePermissions.js)
// and lists the roles whose claims changed in config/rolePermissionsSync.pendingRoles.
// Firestore rules trust the CLAIMS, and on the Spark plan there is no Cloud Function
// to update them, so until this runs those roles see buttons that Firestore rejects.
//
//   node sync-claims.js          # only staff in pendingRoles (the usual case)
//   node sync-claims.js --all    # every staff member (after a manual fix, or to audit)
//   node sync-claims.js --dry    # show what would change, write nothing
//
// Claims shape matches provision-one.js: { ic, canApprove, manageStaff }.
// A user's token picks the new claims up on re-login, or within an hour.
// Uses ADC, same as provision-one.js.
import admin from "firebase-admin";

admin.initializeApp({ projectId: "apply-leave-89ebb" });
const db = admin.firestore();
const auth = admin.auth();

const DOMAIN = "ksb-leave.local";
const emailForIC = (ic) => `${String(ic).replace(/[^a-zA-Z0-9]/g, "")}@${DOMAIN}`;

const ALL = process.argv.includes("--all");
const DRY = process.argv.includes("--dry");

async function staffForRoles(roles) {
  if (ALL) return (await db.collection("staff").get()).docs;
  const docs = [];
  for (let i = 0; i < roles.length; i += 30) {   // Firestore 'in' takes at most 30 values
    const snap = await db.collection("staff").where("role", "in", roles.slice(i, i + 30)).get();
    docs.push(...snap.docs);
  }
  return docs;
}

async function run() {
  const permSnap = await db.doc("config/rolePermissions").get();
  if (!permSnap.exists) throw new Error("config/rolePermissions tiada — simpan matriks dari skrin Kawalan Akses dahulu.");
  const perms = permSnap.data();

  const syncRef = db.doc("config/rolePermissionsSync");
  const pending = ((await syncRef.get()).data() || {}).pendingRoles || [];
  if (!ALL && !pending.length) {
    console.log("✅ Tiada peranan menunggu sync. (Guna --all untuk semak semua staf.)");
    return;
  }
  console.log(ALL ? "Mod: SEMUA staf" : `Peranan menunggu: ${pending.join(", ")}`);

  let changed = 0, same = 0, missing = 0;
  for (const d of await staffForRoles(pending)) {
    const s = d.data();
    const ic = d.id;
    const rp = perms[s.role] || { canApprove: false, manageStaff: false };
    const want = { ic, canApprove: !!rp.canApprove, manageStaff: !!rp.manageStaff };

    let u;
    try { u = await auth.getUserByEmail(emailForIC(ic)); }
    catch { missing++; console.log(`⚠️  ${ic} ${s.name || ""}: tiada akaun Auth — jalankan provision-one.js ${ic}`); continue; }

    const have = u.customClaims || {};
    if (have.ic === want.ic && !!have.canApprove === want.canApprove && !!have.manageStaff === want.manageStaff) { same++; continue; }

    changed++;
    console.log(`${DRY ? "🔎" : "✅"} ${s.name || ic} (${s.role}): canApprove ${!!have.canApprove}→${want.canApprove}, manageStaff ${!!have.manageStaff}→${want.manageStaff}`);
    if (!DRY) await auth.setCustomUserClaims(u.uid, { ...have, ...want });
  }

  if (!DRY) {
    await syncRef.set({ pendingRoles: ALL ? [] : admin.firestore.FieldValue.arrayRemove(...pending), syncedAt: Date.now() }, { merge: true });
  }
  console.log(`\nSiap${DRY ? " (dry run — tiada perubahan ditulis)" : ""}: ${changed} dikemas kini, ${same} sudah betul, ${missing} tiada akaun.`);
  if (changed && !DRY) console.log("Staf berkenaan perlu log masuk semula (atau tunggu sehingga 1 jam) supaya kuasa baru berkuat kuasa.");
}

run().then(() => process.exit(0)).catch((e) => {
  if (e.code === 8 || /RESOURCE_EXHAUSTED|Quota exceeded/i.test(e.message || "")) {
    console.error("❌ Kuota harian Firestore habis. Kuota reset 3:00 PM waktu Malaysia — cuba semula selepas itu.");
  } else {
    console.error("FATAL:", e.code || e.message);
  }
  process.exit(1);
});
