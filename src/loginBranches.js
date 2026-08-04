// Branch list for the login-screen picker.
//
// WHY THIS EXISTS: the login page cannot read the `branches` collection —
// firestore.rules gives it `allow read: if signedIn()`, and signedIn() rejects
// the anonymous bootstrap session the login screen runs under. So the page used
// to render a hardcoded array of branch names instead. When KSBYMC was added to
// Firestore nobody updated that array, the branch never appeared in the
// dropdown, and its six staff could not select themselves or log in at all.
//
// The `directory` collection IS readable pre-login (that is its whole purpose),
// and every directory doc carries a `branch`. Deriving the list from it costs no
// extra reads, needs no rules change, and cannot drift again: a new branch shows
// up the moment someone is provisioned into it.
//
// `orderHint` keeps the familiar ordering for branches we already know about —
// anything else is appended alphabetically.

const norm = s => String(s == null ? '' : s).trim().toLowerCase();
const hintName = h => (h && typeof h === 'object' ? h.name : h);

export function deriveLoginBranches(directoryList, orderHint) {
  // Map keyed by normalised name so case/whitespace variants collapse; the value
  // keeps the first spelling actually seen, which is what we display.
  const found = new Map();
  for (const entry of Array.isArray(directoryList) ? directoryList : []) {
    if (!entry || typeof entry !== 'object') continue;
    if (entry.inactive) continue;
    const branch = String(entry.branch == null ? '' : entry.branch).trim();
    if (!branch) continue;
    const key = norm(branch);
    if (!found.has(key)) found.set(key, branch);
  }

  const known = [];
  const hinted = new Set();
  for (const h of Array.isArray(orderHint) ? orderHint : []) {
    const name = String(hintName(h) == null ? '' : hintName(h)).trim();
    const key = norm(name);
    if (!key || hinted.has(key)) continue;
    hinted.add(key);
    // A hinted branch with nobody in it is deliberately not offered — there is
    // no one to log in as.
    // Display the hint's canonical spelling, not whatever casing happens to sit
    // in the staff record, so sloppy data entry cannot make the dropdown ugly.
    if (found.has(key)) known.push(name);
  }

  const extra = [...found.entries()]
    .filter(([key]) => !hinted.has(key))
    .map(([, name]) => name)
    .sort((a, b) => a.localeCompare(b));

  return [...known, ...extra];
}
