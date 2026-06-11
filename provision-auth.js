// provision-auth.js — one-time backfill: Auth accounts + claims + directory for all staff.
// Also creates the break-glass IT super_admin account.
// Run with ADC: node provision-auth.js     (set IT_ADMIN_PASSWORD to provision the IT account)
import admin from "firebase-admin";

admin.initializeApp({ projectId: "apply-leave-89ebb" });
const auth = admin.auth();
const db = admin.firestore();

const DOMAIN = "ksb-leave.local";
const emailForIC = (ic) => `${String(ic).replace(/[^a-zA-Z0-9]/g, "")}@${DOMAIN}`;

async function ensureUser(email, password, name) {
  try { return await auth.getUserByEmail(email); }
  catch { return await auth.createUser({ email, password: password || "changeme00", displayName: name || email }); }
}

async function loadPerms() {
  const s = await db.doc("config/rolePermissions").get();
  if (!s.exists) throw new Error("config/rolePermissions missing — run seed-role-permissions.js first.");
  return s.data();
}

async function main() {
  const perms = await loadPerms();
  const staff = await db.collection("staff").get();
  let n = 0;
  for (const d of staff.docs) {
    const s = d.data();
    const ic = d.id;
    let pwd = (s.password || String(ic)).trim();
    if (pwd.length < 6) {
      pwd = pwd.padEnd(6, "0");
      if (s.password) {
        await db.doc(`staff/${ic}`).update({ password: pwd });
        console.log(`\nUpdated short password for ${s.name} (${ic}) to ${pwd}`);
      }
    }
    const u = await ensureUser(emailForIC(ic), pwd, s.name);
    const rp = perms[s.role] || { canApprove: false, manageStaff: false };
    await auth.setCustomUserClaims(u.uid, { ic, canApprove: !!rp.canApprove, manageStaff: !!rp.manageStaff });
    await auth.updateUser(u.uid, { disabled: !!s.inactive });
    await db.doc(`directory/${ic}`).set({ ic, name: s.name || "", branch: s.branch || "", inactive: !!s.inactive });
    n++;
    if (n % 10 === 0) process.stdout.write(".");
  }
  console.log(`\n✅ Provisioned ${n} staff accounts.`);

  // Break-glass IT super_admin (ic = "itadmin" so emailForIC is stable).
  const itPwd = process.env.IT_ADMIN_PASSWORD;
  if (itPwd) {
    const ic = "itadmin";
    await db.doc(`staff/${ic}`).set({
      ic, name: "IT SUPER ADMIN", branch: "Management / HQ", category: "Super Admin",
      role: "super_admin", phone: "", inactive: false,
      startDate: new Date().toISOString().split("T")[0],
    }, { merge: true });
    const u = await ensureUser(emailForIC(ic), itPwd, "IT SUPER ADMIN");
    await auth.setCustomUserClaims(u.uid, { ic, canApprove: true, manageStaff: true });
    await db.doc(`directory/${ic}`).set({ ic, name: "IT SUPER ADMIN", branch: "Management / HQ", inactive: false });
    console.log("✅ Break-glass IT super_admin provisioned (itadmin).");
  } else {
    console.log("ℹ️  IT_ADMIN_PASSWORD not set — skipped break-glass account.");
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
