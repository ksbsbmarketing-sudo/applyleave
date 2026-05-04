import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from './crypto';

describe('hashPassword', () => {
  it('returns a string starting with "pbkdf2:"', async () => {
    const hash = await hashPassword('mypassword');
    expect(hash.startsWith('pbkdf2:')).toBe(true);
  });

  it('produces a hash with exactly 3 colon-separated parts', async () => {
    const hash = await hashPassword('mypassword');
    expect(hash.split(':').length).toBe(3);
  });

  it('generates a different salt each call', async () => {
    const h1 = await hashPassword('same');
    const h2 = await hashPassword('same');
    expect(h1).not.toBe(h2);
  });

  it('salt part is a 32-character hex string (16 bytes)', async () => {
    const hash = await hashPassword('mypassword');
    const saltHex = hash.split(':')[1];
    expect(saltHex).toHaveLength(32);
    expect(/^[0-9a-f]+$/.test(saltHex)).toBe(true);
  });

  it('hash part is a 64-character hex string (256 bits)', async () => {
    const hash = await hashPassword('mypassword');
    const hashHex = hash.split(':')[2];
    expect(hashHex).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(hashHex)).toBe(true);
  });
});

describe('verifyPassword', () => {
  it('returns true for correct password', async () => {
    const hash = await hashPassword('correct-password');
    expect(await verifyPassword('correct-password', hash)).toBe(true);
  });

  it('returns false for wrong password', async () => {
    const hash = await hashPassword('correct-password');
    expect(await verifyPassword('wrong-password', hash)).toBe(false);
  });

  it('handles legacy plaintext — returns true for matching plaintext', async () => {
    expect(await verifyPassword('plaintextpass', 'plaintextpass')).toBe(true);
  });

  it('handles legacy plaintext — returns false for non-matching plaintext', async () => {
    expect(await verifyPassword('wrong', 'plaintextpass')).toBe(false);
  });

  it('returns false for a malformed pbkdf2 hash (wrong number of parts)', async () => {
    expect(await verifyPassword('password', 'pbkdf2:onlytwoparts')).toBe(false);
  });

  it('returns false if hash part is corrupted', async () => {
    const hash = await hashPassword('mypassword');
    const parts = hash.split(':');
    const corrupted = `${parts[0]}:${parts[1]}:0000000000000000000000000000000000000000000000000000000000000000`;
    expect(await verifyPassword('mypassword', corrupted)).toBe(false);
  });
});
