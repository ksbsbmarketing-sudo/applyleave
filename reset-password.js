// reset-password.js — IT resets a single staff's Firebase Auth password.
// No-Blaze setup: admins cannot reset passwords from the app, so IT runs this.
// Run with ADC: node reset-password.js <ic> <newPassword>
//   <newPassword> must be at least 6 characters (Firebase Auth requirement).
import admin from "firebase-admin";

admin.initializeApp({ projectId: "apply-leave-89ebb" });

const DOMAIN = "ksb-leave.local";
const emailForIC = (ic) => `${String(ic).replace(/[^a-zA-Z0-9]/g, "")}@${DOMAIN}`;

async function main() {
  const [ic, newPassword] = process.argv.slice(2);
  if (!ic || !newPassword || String(newPassword).length < 6) {
    console.error("Usage: node reset-password.js <ic> <newPassword(min 6 chars)>");
    process.exit(1);
  }
  let u;
  try {
    u = await admin.auth().getUserByEmail(emailForIC(ic));
  } catch {
    console.error(`❌ No Auth account for IC ${ic}. Run "node provision-auth.js" first to create accounts.`);
    process.exit(1);
  }
  await admin.auth().updateUser(u.uid, { password: String(newPassword) });
  console.log(`✅ Password reset for ${ic} (${emailForIC(ic)}).`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
