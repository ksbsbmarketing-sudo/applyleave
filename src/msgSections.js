// Pure state logic for the Messenger collapsible (accordion) sections.
// No DOM/Firebase deps so it is unit-testable. The UI layer reads this state
// to decide which sections render open, and persists it via localStorage.
//
// true  = section expanded (open)
// false = section collapsed (hidden)

export const MSG_SECTION_KEYS = ['online', 'recent', 'branch', 'role', 'dm'];

// Default on first load: "Sedang Aktif" + "Perbualan Terkini" + "Mesej Terus"
// open; the long Cawangan/Peranan lists collapsed so the panel stays tidy.
export const MSG_SECTION_DEFAULTS = Object.freeze({
  online: true,
  recent: true,
  branch: false,
  role: false,
  dm: true,
});

const STORAGE_KEY = 'ksb_msg_sections';

// Build the active state from saved storage, falling back to defaults for any
// missing/invalid key. Unknown keys in storage are ignored.
export function loadSectionState(storage, defaults = MSG_SECTION_DEFAULTS) {
  let saved = {};
  try {
    const raw = storage && storage.getItem ? storage.getItem(STORAGE_KEY) : null;
    if (raw) saved = JSON.parse(raw) || {};
  } catch (_) {
    saved = {};
  }
  const state = {};
  for (const k of MSG_SECTION_KEYS) {
    state[k] = typeof saved[k] === 'boolean' ? saved[k] : defaults[k];
  }
  return state;
}

// Return a NEW state with `key` flipped (immutable).
export function toggleSection(state, key) {
  return { ...state, [key]: !isOpen(state, key) };
}

export function saveSectionState(storage, state) {
  try {
    if (storage && storage.setItem) storage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (_) { /* storage unavailable — ignore */ }
}

export function isOpen(state, key, defaults = MSG_SECTION_DEFAULTS) {
  return typeof (state && state[key]) === 'boolean' ? state[key] : defaults[key];
}
