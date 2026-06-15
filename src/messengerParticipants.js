// Pure: derive the `participants` array for a messenger room/message from its
// roomId. DM room ids look like "dm_<icA>__<icB>"; everything else is a public
// group room (all_ksb, branch_*, role_*). The 'ALL' sentinel marks a public
// group so Firestore rules can allow any signed-in staff to read it, while DMs
// are restricted to the two ICs.
//
// This MUST stay in sync with the Firestore rules' access check.

export const GROUP_PARTICIPANT = 'ALL';

export function isDM(roomId) {
  return typeof roomId === 'string' && roomId.startsWith('dm_');
}

export function roomParticipants(roomId) {
  if (isDM(roomId)) {
    return roomId.slice(3).split('__').filter(Boolean);
  }
  return [GROUP_PARTICIPANT];
}

// Mirror of the rules check: can a user with this IC access a doc carrying these
// participants? (Public groups carry 'ALL'.)
export function canAccess(participants, ic) {
  if (!Array.isArray(participants)) return false;
  return participants.includes(GROUP_PARTICIPANT) || participants.includes(ic);
}
