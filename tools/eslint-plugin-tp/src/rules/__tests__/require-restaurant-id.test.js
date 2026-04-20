// Unit tests for @tp/require-restaurant-id (TASK-025 / DEC-012).
// Uses the vitest-runnable RuleTester — equivalent to ESLint's own.

import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';
import rule from '../require-restaurant-id.js';

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

describe('require-restaurant-id', () => {
  it('accepts queries with restaurant_id and rejects queries without', () => {
    tester.run('require-restaurant-id', rule, {
      valid: [
        { code: 'prisma.ingredient.findMany({ where: { restaurant_id } })' },
        { code: 'prisma.ingredient.findFirst({ where: { restaurant_id: rid, name } })' },
        { code: 'prisma.recipe.updateMany({ where: { AND: [{ restaurant_id }, { is_archived: false }] } })' },
        { code: 'prisma.restaurant.findUnique({ where: { id } })' }, // tenant root
        { code: 'prisma.featureFlag.findMany({ where: { key } })' }, // global
        { code: 'prisma.refreshToken.findFirst({ where: { token_hash } })' }, // FK-scoped
        { code: 'prisma.user.findFirst({ where: { email } })' }, // auth — cross-tenant by design
        { code: 'prisma.user.findUnique({ where: { id } })' }, // auth
        { code: 'this.prisma.ingredient.findMany({ where: { restaurant_id } })' },
        { code: 'tx.pos_sale.findMany({ where: { restaurant_id, business_date } })' },
        { code: 'prisma.ingredient.findMany(whereBuilder())' }, // dynamic — skipped
        { code: 'prisma.$queryRaw`SELECT * FROM ingredient WHERE restaurant_id = ${rid}`' },
      ],
      invalid: [
        {
          code: 'prisma.ingredient.findMany({ where: { name: "milk" } })',
          errors: [{ messageId: 'missing' }],
        },
        {
          code: 'prisma.waste_entry.updateMany({ where: { qty: 0 } })',
          errors: [{ messageId: 'missing' }],
        },
        {
          code: 'prisma.recipe.findMany()',
          errors: [{ messageId: 'missing' }],
        },
        {
          code: 'prisma.recipe.findMany({})',
          errors: [{ messageId: 'missing' }],
        },
        {
          code: 'prisma.$executeRaw`UPDATE ingredient SET is_archived = true WHERE id = ${id}`',
          errors: [{ messageId: 'rawSql' }],
        },
      ],
    });
  });
});
