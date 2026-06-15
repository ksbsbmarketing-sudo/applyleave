// Pure presence-status helpers (Yahoo Messenger style status). No DOM/Firebase.
//
// Statuses mirror classic YM: Available / Busy / Away / Invisible. "Invisible"
// means the user appears offline to everyone else while still using the app.

export const PRESENCE_STATUSES = [
  { id: 'available', label: 'Available', color: '#22c55e', dot: '🟢' },
  { id: 'busy',      label: 'Sibuk',     color: '#ef4444', dot: '🔴' },
  { id: 'away',      label: 'Away',      color: '#f59e0b', dot: '🟡' },
  { id: 'invisible', label: 'Invisible', color: '#9ca3af', dot: '⚪' },
];

export const DEFAULT_STATUS = 'available';
const ONLINE_WINDOW_MS = 3 * 60 * 1000; // matches presence heartbeat staleness

export function getStatusMeta(id) {
  return PRESENCE_STATUSES.find(s => s.id === id)
      || PRESENCE_STATUSES.find(s => s.id === DEFAULT_STATUS);
}

// The effective status meta for a presence doc (defaults to Available).
export function resolveStatus(presenceDoc) {
  const id = presenceDoc && presenceDoc.status ? presenceDoc.status : DEFAULT_STATUS;
  return getStatusMeta(id);
}

// Should this presence doc show as "online" to OTHER users? Invisible and stale
// docs are hidden. `now`/`windowMs` are injectable for testing.
export function isVisibleToOthers(presenceDoc, now = Date.now(), windowMs = ONLINE_WINDOW_MS) {
  if (!presenceDoc || !presenceDoc.online || !presenceDoc.lastSeen) return false;
  if (presenceDoc.status === 'invisible') return false;
  return (now - presenceDoc.lastSeen) < windowMs;
}

// Normalize a free-text mood/status message (trim + cap length).
export function normalizeMood(text, max = 60) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, max);
}
