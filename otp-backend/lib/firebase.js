// Firebase Admin init from a service-account JSON stored in an env var.
// Works on the free Spark plan — Blaze is only needed to host functions INSIDE
// Firebase, not to use the Admin SDK from an external server like Vercel.
import admin from "firebase-admin";

let app;
function init() {
  if (app) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT env var is not set");
  const svc = JSON.parse(raw);
  app = admin.initializeApp({ credential: admin.credential.cert(svc) });
}

export function db() { init(); return admin.firestore(); }
export function auth() { init(); return admin.auth(); }
