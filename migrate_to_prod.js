import admin from "firebase-admin";
import fs from "fs";

// Initialize with ADC (Application Default Credentials)
admin.initializeApp({
  projectId: "apply-leave-89ebb"
});

const db = admin.firestore();

async function migrate() {
    try {
        console.log("Reading local data...");
        const staff = JSON.parse(fs.readFileSync("./public/data/staff.json", "utf8"));
        const leaves = JSON.parse(fs.readFileSync("./public/data/leaves.json", "utf8"));

        console.log(`Starting migration to Firestore (apply-leave-89ebb)...`);

        // Migrate Staff
        let staffCount = 0;
        for (const s of staff) {
            await db.collection("staff").doc(s.ic).set(s);
            staffCount++;
            if (staffCount % 10 === 0) process.stdout.write(".");
        }
        console.log(`\n✅ Migrated ${staffCount} staff records.`);

        // Migrate Leaves
        let leaveCount = 0;
        for (const l of leaves) {
            await db.collection("leaves").doc(l.id.toString()).set(l);
            leaveCount++;
            if (leaveCount % 10 === 0) process.stdout.write(".");
        }
        console.log(`\n✅ Migrated ${leaveCount} leave records.`);

        process.exit(0);
    } catch (err) {
        console.error("Migration failed:", err);
        process.exit(1);
    }
}

migrate();
