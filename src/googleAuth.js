// Google sign-in helpers. Google is always a provider LINKED onto the staff
// member's IC account (<ic>@ksb-leave.local) — never a separate account. See
// docs/superpowers/specs/2026-10-17-google-sign-in-design.md.
import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  linkWithPopup,
  unlink,
} from 'firebase/auth';

const INTENT_KEY = 'ksb_google_intent';

const provider = () => {
  const p = new GoogleAuthProvider();
  p.setCustomParameters({ prompt: 'select_account' });
  return p;
};

export function googleIdentityOf(user) {
  const p = user && (user.providerData || []).find((x) => x.providerId === 'google.com');
  return p ? { sub: p.uid, email: p.email || null, displayName: p.displayName || null } : null;
}

const SILENT = ['auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/user-cancelled'];
const MESSAGES = {
  'auth/credential-already-in-use': 'Akaun Google ini sudah digunakan oleh akaun lain.',
  'auth/provider-already-linked': 'Akaun Google sudah dipautkan.',
  'auth/network-request-failed': 'Tiada sambungan internet. Sila cuba lagi.',
  'auth/user-disabled': 'Akaun anda tidak aktif. Sila hubungi HR/Admin.',
  'auth/popup-blocked': 'Popup disekat oleh pelayar. Sila benarkan popup dan cuba lagi.',
  'auth/unauthorized-domain': 'Domain ini belum dibenarkan untuk log masuk Google. Sila hubungi IT.',
  'auth/operation-not-allowed': 'Log masuk Google belum diaktifkan. Sila hubungi IT.',
  'auth/requires-recent-login': 'Sila log keluar dan log masuk semula, kemudian cuba lagi.',
};

export function googleErrorMessage(code) {
  if (SILENT.includes(code)) return null;
  return MESSAGES[code] || `Ralat log masuk Google (${code}). Sila cuba lagi.`;
}

const REDIRECT_FALLBACK = ['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'];

export async function signInWithGoogle(auth, intent) {
  try {
    const cred = await signInWithPopup(auth, provider());
    return cred.user;
  } catch (e) {
    if (!REDIRECT_FALLBACK.includes(e.code)) throw e;
    try { sessionStorage.setItem(INTENT_KEY, intent); } catch {}
    await signInWithRedirect(auth, provider());
    return null; // the page navigates away
  }
}

export async function takeRedirectResult(auth) {
  let intent = null;
  try { intent = sessionStorage.getItem(INTENT_KEY); sessionStorage.removeItem(INTENT_KEY); } catch {}
  const cred = await getRedirectResult(auth);
  return cred ? { user: cred.user, intent: intent || 'login' } : null;
}

export async function linkGoogle(user) {
  const cred = await linkWithPopup(user, provider());
  return cred.user;
}

export async function unlinkGoogle(user) {
  return unlink(user, 'google.com');
}
