// TASK-029 — argon2id password hashing (§6.13 AC-1, AD-6).
//
// Uses node-argon2. Parameters are production-grade defaults:
//   - type: argon2id (hybrid, best general recommendation)
//   - memoryCost: 19 MiB, timeCost: 2, parallelism: 1 (OWASP 2024 guidance,
//     balanced for CPU-bound Fastify servers)
//
// Minimum password length is 8 chars — enforced server-side. PWA enforces UX
// validation but never trusts the client. Verify always returns a boolean —
// malformed hashes degrade to `false` rather than throwing so auth routes
// cannot leak timing/shape information about legacy or corrupted rows.

import argon2 from 'argon2';

const MIN_LENGTH = 8;

const HASH_OPTS = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plaintext: string): Promise<string> {
  if (plaintext.length < MIN_LENGTH) {
    throw new Error(`password must be at least ${MIN_LENGTH} characters`);
  }
  return argon2.hash(plaintext, HASH_OPTS);
}

export async function verifyPassword(hash: string, plaintext: string): Promise<boolean> {
  if (!hash || !plaintext) return false;
  try {
    return await argon2.verify(hash, plaintext);
  } catch {
    return false;
  }
}
