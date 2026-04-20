# @tp/eslint-plugin-tp

In-repo ESLint plugin for TP Manager. Ships one rule today:

## `@tp/require-restaurant-id`

Blocks Prisma queries that would span tenants. DEC-012 requires every
row-scoped entity to carry `restaurant_id` from day one; this rule enforces
that the ORM callers actually use it.

### Examples

Bad:

```ts
await prisma.ingredient.findMany({ where: { name: 'Milk' } });
await prisma.waste_entry.updateMany({ where: { qty: 0 } });
await prisma.$executeRaw`UPDATE ingredient SET is_archived = TRUE WHERE id = ${id}`;
```

Good:

```ts
await prisma.ingredient.findMany({ where: { restaurant_id, name: 'Milk' } });
await prisma.waste_entry.updateMany({
  where: { AND: [{ restaurant_id }, { qty: 0 }] },
});
await prisma.$executeRaw`UPDATE ingredient SET is_archived = TRUE
  WHERE id = ${id} AND restaurant_id = ${restaurant_id}`;
```

Allowlisted models (rule does not apply):

| Model | Why |
|---|---|
| `restaurant` | the tenant root |
| `featureFlag` / `feature_flag` | global definitions (values are scoped via `feature_flag_value`) |
| `auditLog` / `audit_log` | filter shape varies (entity, entity_id) — audit reader is trusted ops code |
| `refreshToken` / `refresh_token` | scoped via `user_id` FK |

### Escape hatch

```ts
// eslint-disable-next-line @tp/require-restaurant-id -- cross-tenant by design: nightly analytics
const all = await prisma.pos_sale.findMany({ where: { business_date: yesterday } });
```

The comment is the review signal — it forces "why is this cross-tenant?" to be
answered in-diff.
