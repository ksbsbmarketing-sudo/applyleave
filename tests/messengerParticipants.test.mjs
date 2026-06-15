import { test } from 'node:test';
import assert from 'node:assert';
import { isDM, roomParticipants, canAccess, GROUP_PARTICIPANT } from '../src/messengerParticipants.js';

test('isDM detects dm_ room ids only', () => {
  assert.strictEqual(isDM('dm_111__222'), true);
  assert.strictEqual(isDM('all_ksb'), false);
  assert.strictEqual(isDM('branch_klinik_a'), false);
  assert.strictEqual(isDM('role_doktor'), false);
  assert.strictEqual(isDM(null), false);
});

test('DM participants are the two ICs parsed from the room id', () => {
  assert.deepStrictEqual(roomParticipants('dm_111__222'), ['111', '222']);
});

test('group rooms get the ALL sentinel', () => {
  assert.deepStrictEqual(roomParticipants('all_ksb'), [GROUP_PARTICIPANT]);
  assert.deepStrictEqual(roomParticipants('branch_x'), [GROUP_PARTICIPANT]);
  assert.deepStrictEqual(roomParticipants('role_hod'), [GROUP_PARTICIPANT]);
});

test('canAccess: DM only the two participants', () => {
  const parts = roomParticipants('dm_111__222');
  assert.strictEqual(canAccess(parts, '111'), true);
  assert.strictEqual(canAccess(parts, '222'), true);
  assert.strictEqual(canAccess(parts, '333'), false); // third party denied
});

test('canAccess: group (ALL) is readable by anyone', () => {
  const parts = roomParticipants('all_ksb');
  assert.strictEqual(canAccess(parts, '333'), true);
  assert.strictEqual(canAccess(parts, 'anybody'), true);
});

test('canAccess: missing/garbage participants denied', () => {
  assert.strictEqual(canAccess(undefined, '111'), false);
  assert.strictEqual(canAccess([], '111'), false);
});
