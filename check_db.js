import admin from "firebase-admin";

admin.initializeApp({
  projectId: "apply-leave-89ebb"
});

const db = admin.firestore();

async function check() {
    const snapshot = await db.collection("staff").limit(5).get();
    if (snapshot.empty) {
        console.log("No staff records found in apply-leave-89ebb");
    } else {
        console.log(`Found ${snapshot.size} staff records.`);
        snapshot.forEach(doc => console.log(`- ${doc.id}: ${doc.data().name}`));
    }
    process.exit(0);
}

check();
