import admin from "firebase-admin";
import fs from "fs";

// Pull live Firestore data down to local ./data/*.json snapshots.
// Read-only on prod: it only reads collections, never writes to Firestore.
// Uses ADC (Application Default Credentials) — run `gcloud auth application-default login`
// (or set GOOGLE_APPLICATION_CREDENTIALS to a service-account key) first.
//
// IMPORTANT: write to ./data (project root, NOT public/). Vite copies public/ into
// dist/ on build, so snapshots placed under public/ get DEPLOYED and exposed publicly
// (they contain staff IC numbers / PII). ./data is outside publicDir, never deployed.

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

    // Snapshots go to ./data (NOT public/) so they are never bundled into dist/.
    fs.mkdirSync("./data", { recursive: true });

    // Leaves — sort by numeric id for a stable, diff-friendly file.
    const leaves = await pullCollection("leaves", (a, b) => Number(a.id) - Number(b.id));
    fs.writeFileSync("./data/leaves.json", JSON.stringify(leaves, null, 2) + "\n");
    console.log(`✅ Pulled ${leaves.length} leave records  → data/leaves.json`);

    // Staff — sort by name to keep the snapshot pair in sync.
    const staff = await pullCollection("staff", (a, b) =>
      String(a.name || "").localeCompare(String(b.name || ""))
    );
    fs.writeFileSync("./data/staff.json", JSON.stringify(staff, null, 2) + "\n");
    console.log(`✅ Pulled ${staff.length} staff records  → data/staff.json`);

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
