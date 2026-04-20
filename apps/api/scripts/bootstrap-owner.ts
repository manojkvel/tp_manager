// Local-dev bootstrap: create one restaurant + one owner user so the web app
// has somewhere to log in. Idempotent — safe to re-run.
//
// Usage:  pnpm --filter @tp/api exec tsx scripts/bootstrap-owner.ts
//
// Output: prints the email, password, and restaurant_id on success.

import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/auth/password.js';

const OWNER_EMAIL = process.env.BOOTSTRAP_OWNER_EMAIL ?? 'owner@tp.local';
const OWNER_PASSWORD = process.env.BOOTSTRAP_OWNER_PASSWORD ?? 'tp-dev-owner-1';
const RESTAURANT_NAME = process.env.BOOTSTRAP_RESTAURANT_NAME ?? 'TP Manager Local';

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const existingOwner = await prisma.user.findFirst({
      where: { email: OWNER_EMAIL, role: 'owner' },
    });
    if (existingOwner) {
      console.log('Owner already exists — reset password? (no-op).');
      console.log(`  email:          ${existingOwner.email}`);
      console.log(`  restaurant_id:  ${existingOwner.restaurant_id}`);
      return;
    }

    const restaurantId = randomUUID();
    await prisma.restaurant.create({
      data: { id: restaurantId, name: RESTAURANT_NAME, timezone: 'America/New_York' },
    });

    const hash = await hashPassword(OWNER_PASSWORD);
    await prisma.user.create({
      data: {
        id: randomUUID(),
        restaurant_id: restaurantId,
        email: OWNER_EMAIL.toLowerCase(),
        password_hash: hash,
        role: 'owner',
        active: true,
        name: 'Local Owner',
      },
    });

    console.log('✓ Bootstrap complete');
    console.log(`  restaurant_id:  ${restaurantId}`);
    console.log(`  email:          ${OWNER_EMAIL}`);
    console.log(`  password:       ${OWNER_PASSWORD}`);
    console.log('Login at http://localhost:5173 (web dev) → POST /api/v1/auth/login');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
