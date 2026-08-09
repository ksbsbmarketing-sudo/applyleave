// CORS + preflight. Locked to ALLOWED_ORIGIN (the app) so random sites can't
// drive the reset endpoints from a user's browser.
//
// The app is served from more than one origin: the cPanel domain staff actually
// use (and that the Android TWA ships), plus the legacy Firebase Hosting URLs
// still sitting in old bookmarks. Emitting ONE hard-coded origin for every
// caller silently broke password reset everywhere except that one host — the
// browser dropped the response and the UI blamed the network ("Tiada sambungan
// internet"). So echo the caller's origin back, but only when it is on the list.
//
// These origins are baked in on purpose rather than left to ALLOWED_ORIGIN
// alone: they are our own fixed domains, and the outage above happened because
// that env var still pointed at the retired web.app host after the move to
// cPanel. Deploying this file is now enough to keep reset working; ALLOWED_ORIGIN
// stays supported and is ADDED to this list (set it to "*" only for local dev).
const DEFAULT_ORIGINS = [
  "https://cuti-staff.ksbsb.com.my",
  "https://apply-leave-89ebb.web.app",
  "https://apply-leave-89ebb.firebaseapp.com",
];

const normalize = (o) => String(o || "").trim().replace(/\/+$/, "");

export function applyCors(req, res) {
  const configured = (process.env.ALLOWED_ORIGIN || "").trim();
  const origin = normalize(req.headers?.origin);

  if (configured === "*") {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else {
    const list = [...DEFAULT_ORIGINS, ...configured.split(",").map(normalize).filter(Boolean)];
    // Fall back to the first known origin so a non-matching caller gets a header
    // it cannot use, rather than free-for-all access.
    res.setHeader("Access-Control-Allow-Origin", list.includes(origin) ? origin : list[0]);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") { res.status(204).end(); return true; }
  return false;
}

// Vercel parses JSON bodies automatically, but be defensive if a string arrives.
export function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch { return {}; } }
  return {};
}
