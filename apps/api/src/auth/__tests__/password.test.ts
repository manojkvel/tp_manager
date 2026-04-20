// TASK-026 — argon2 hash + verify unit tests.
// Validates §6.13 AC-1 (argon2 hashing) and AD-6 (auth primitives).
//
// Not a property test — argon2 is non-deterministic by design (random salt per
// call), so we assert the inverse relation: hash(p) verifies against p and
// rejects any other input, and two hashes of the same password differ.

import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../password.js';

describe('password (argon2id)', () => {
  it('hash + verify roundtrip succeeds for the correct password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(hash, 'correct horse battery staple')).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('hunter2!!');
    expect(await verifyPassword(hash, 'Hunter2!!')).toBe(false);
    expect(await verifyPassword(hash, '')).toBe(false);
    expect(await verifyPassword(hash, 'hunter2!! ')).toBe(false);
  });

  it('produces a different hash each call for the same password (random salt)', async () => {
    const a = await hashPassword('same-password');
    const b = await hashPassword('same-password');
    expect(a).not.toBe(b);
    expect(await verifyPassword(a, 'same-password')).toBe(true);
    expect(await verifyPassword(b, 'same-password')).toBe(true);
  });

  it('treats a malformed hash as a failed verify, not a throw', async () => {
    expect(await verifyPassword('not-a-valid-hash', 'anything')).toBe(false);
    expect(await verifyPassword('', 'anything')).toBe(false);
  });

  it('enforces a minimum password length on hash', async () => {
    await expect(hashPassword('short')).rejects.toThrow(/at least 8/i);
  });
});
