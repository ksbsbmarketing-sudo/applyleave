import admin from "firebase-admin";
import fs from "fs";

// Pull live Firestore data down to local public/data/*.json snapshots.
// Read-only on prod: it only reads collections, never writes to Firestore.
// Uses ADC (Application Default Credentials) — run `gcloud auth application-default login`
// (or set GOOGLE_APPLICATION_CREDENTIALS to a service-account key) first.

admin.initializeApp({
  projectId: "apply-leave-89ebb"
});

const db = admin.firestore();

// Firestore Timestamps / GeoPoints / refs don't JSON-serialize cleanly.
// Walk the object and convert Timestamps to ISO strings so the snapshot is readable.
function sanitize(value) {
  if (value === null || value === undefined) return value;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(sanitize);
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = sanitize(v);
    return out;
  }
  return value;
}

async function pullCollection(name, sortFn) {
  const snap = await db.collection(name).get();
  const rows = snap.docs.map(doc => sanitize(doc.data()));
  if (sortFn) rows.sort(sortFn);
  return rows;
}

async function pull() {
  try {
    console.log("Pulling from Firestore (apply-leave-89ebb)...\n");

    // Leaves — sort by numeric id for a stable, diff-friendly file.
    const leaves = await pullCollection("leaves", (a, b) => Number(a.id) - Number(b.id));
    fs.writeFileSync("./public/data/leaves.json", JSON.stringify(leaves, null, 2) + "\n");
    console.log(`✅ Pulled ${leaves.length} leave records  → public/data/leaves.json`);

    // Staff — sort by name to keep the snapshot pair in sync.
    const staff = await pullCollection("staff", (a, b) =>
      String(a.name || "").localeCompare(String(b.name || ""))
    );
    fs.writeFileSync("./public/data/staff.json", JSON.stringify(staff, null, 2) + "\n");
    console.log(`✅ Pulled ${staff.length} staff records  → public/data/staff.json`);

    process.exit(0);
  } catch (err) {
    console.error("\nPull failed:", err.message);
    if (/credential|authenticate|ADC|permission|UNAUTHENTICATED/i.test(err.message)) {
      console.error("\nAuthenticate first:  gcloud auth application-default login");
      console.error("or set GOOGLE_APPLICATION_CREDENTIALS to a service-account key JSON.");
    }
    process.exit(1);
  }
}

pull();
