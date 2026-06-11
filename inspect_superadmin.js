// inspect_superadmin.js — diagnose why the super_admin account can't log in.
// Checks BOTH sides of the login chain: the Firestore staff/directory docs AND
// the actual Firebase Auth accounts, for every super-admin ID variant in the code.
//
// Run with ADC:  node inspect_superadmin.js
import admin from "firebase-admin";

admin.initializeApp({ projectId: "apply-leave-89ebb" });
const auth = admin.auth();
const db = admin.firestore();

const DOMAIN = "ksb-leave.local";
const emailForIC = (ic) => `${String(ic).replace(/[^a-zA-Z0-9]/g, "")}@${DOMAIN}`;

// Every identifier the codebase uses for "super admin".
const CANDIDATE_ICS = ["itadmin", "super-admin", "super_admin", "Super Admin"];

async function checkAuth(email) {
  try {
    const u = await auth.getUserByEmail(email);
    return { exists: true, uid: u.uid, disabled: u.disabled, claims: u.customClaims || {} };
  } catch {
    return { exists: false };
  }
}

async function main() {
  console.log("=== 1. Firestore staff docs with role super_admin ===");
  const staff = await db.collection("staff").get();
  let foundRole = 0;
  staff.forEach((d) => {
    const s = d.data();
    if (s.role === "super_admin") {
      foundRole++;
      console.log(`  staff/${d.id}  name="${s.name}"  inactive=${!!s.inactive}  password=${s.password ? "(set)" : "(none)"}`);
    }
  });
  if (!foundRole) console.log("  ⚠️  NO staff doc has role super_admin.");

  console.log("\n=== 2. Per-ID variant: Firestore doc + directory + Auth account ===");
  for (const ic of CANDIDATE_ICS) {
    const email = emailForIC(ic);
    const staffDoc = await db.doc(`staff/${ic}`).get();
    const dirDoc = await db.doc(`directory/${ic}`).get();
    const a = await checkAuth(email);
    console.log(`\n  ID "${ic}"  ->  login email: ${email}`);
    console.log(`    staff/${ic} exists?      ${staffDoc.exists}`);
    console.log(`    directory/${ic} exists?  ${dirDoc.exists}`);
    if (a.exists) {
      console.log(`    Auth account?            ✅ YES  uid=${a.uid}  disabled=${a.disabled}  claims=${JSON.stringify(a.claims)}`);
    } else {
      console.log(`    Auth account?            ❌ NONE — login will fail with auth/invalid-credential`);
    }
  }

  console.log("\n=== 3. Verdict ===");
  const itadminAuth = await checkAuth(emailForIC("itadmin"));
  if (itadminAuth.exists && !itadminAuth.disabled) {
    console.log("  Break-glass 'itadmin' Auth account EXISTS. Log in by selecting the IT SUPER ADMIN");
    console.log("  entry (ic=itadmin) — NOT the phantom 'Super Admin' dropdown seed.");
  } else {
    console.log("  Break-glass 'itadmin' Auth account is MISSING or disabled.");
    console.log("  Fix: run  IT_ADMIN_PASSWORD=<pwd> node provision-auth.js");
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
