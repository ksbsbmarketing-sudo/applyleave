// seed-role-permissions.js — writes config/rolePermissions from the RBAC matrix.
// Run against the emulator OR prod (ADC). Idempotent.
import admin from "firebase-admin";

admin.initializeApp({ projectId: "apply-leave-89ebb" });
const db = admin.firestore();

// canApprove = RBAC manage_pending; manageStaff = RBAC manage_staff
const ROLE_PERMISSIONS = {
  super_admin:  { canApprove: true,  manageStaff: true  },
  admin:        { canApprove: true,  manageStaff: true  },
  hr:           { canApprove: true,  manageStaff: true  },
  hod_cawangan: { canApprove: false, manageStaff: false },
  hod_balok:    { canApprove: true,  manageStaff: false },
  doctor_pic:   { canApprove: true,  manageStaff: false },
  supervisor:   { canApprove: true,  manageStaff: false },
  team_leader:  { canApprove: true,  manageStaff: false },
  staff:        { canApprove: false, manageStaff: false },
  juru_xray:    { canApprove: false, manageStaff: false },
  sonographer:  { canApprove: false, manageStaff: false },
  juru_audio:   { canApprove: false, manageStaff: false },
  pemandu:      { canApprove: false, manageStaff: false },
};

async function main() {
  await db.doc("config/rolePermissions").set(ROLE_PERMISSIONS);
  console.log("✅ Wrote config/rolePermissions:", Object.keys(ROLE_PERMISSIONS).length, "roles");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
