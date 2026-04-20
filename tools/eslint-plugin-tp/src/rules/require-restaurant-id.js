// require-restaurant-id — block Prisma queries whose `where` clause is missing
// `restaurant_id`. The design-review + risk-log rationale is DEC-012:
// "single-restaurant MVP masks multi-tenant assumptions". Day-one multi-tenant
// readiness depends on every read/write naming its tenant.
//
// What the rule flags:
//   prisma.ingredient.findMany({ where: { id: ... } })   ← MISSING restaurant_id
//   prisma.waste_entry.updateMany({ where: { ... } })    ← MISSING
//   tx.recipe.findFirst({ where: { ... } })              ← MISSING
//
// Allowlisted models (cross-tenant / scoped-by-FK):
//   - restaurant                     (tenant root; queried by id)
//   - feature_flag / featureFlag     (global definitions; values are tenant-scoped)
//   - audit_log / auditLog           (queried by entity + restaurant separately)
//   - refresh_token / refreshToken   (scoped via user_id FK)
//   - user / user_account            (auth is cross-tenant at the login step;
//                                     tenant is discovered from the user row
//                                     and encoded into the JWT thereafter)
//
// Escape hatch: developers who genuinely need a cross-tenant query (backfill,
// reporting) can suppress with `// eslint-disable-next-line @tp/require-restaurant-id`
// and add a comment explaining why. The noise of the escape hatch is the point:
// it forces a code-review signal.

const QUERY_METHODS = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
  'updateMany',
  'deleteMany',
  'aggregate',
  'count',
  'groupBy',
]);

const TENANT_FREE_MODELS = new Set([
  'restaurant',
  'featureFlag',
  'feature_flag',
  'auditLog',
  'audit_log',
  'refreshToken',
  'refresh_token',
  'user',
  'user_account',
]);

const CLIENT_IDENTIFIERS = new Set([
  'prisma',
  'db',
  'client',
  'tx',
  'trx',
  'txClient',
  'prismaClient',
]);

function isTenantFreeModel(name) {
  return TENANT_FREE_MODELS.has(name);
}

function hasRestaurantIdInObject(node) {
  if (!node || node.type !== 'ObjectExpression') return false;
  for (const prop of node.properties) {
    if (prop.type !== 'Property' || prop.computed) continue;
    const key = prop.key.type === 'Identifier' ? prop.key.name : prop.key.value;
    if (key === 'restaurant_id' || key === 'restaurantId') return true;
    // Allow nested AND/OR arrays to contribute the predicate.
    if (key === 'AND' || key === 'OR') {
      if (prop.value.type === 'ArrayExpression') {
        if (prop.value.elements.some(hasRestaurantIdInObject)) return true;
      } else if (hasRestaurantIdInObject(prop.value)) {
        return true;
      }
    }
  }
  return false;
}

function findWhereProperty(objNode) {
  if (!objNode || objNode.type !== 'ObjectExpression') return null;
  return objNode.properties.find(
    (p) =>
      p.type === 'Property' &&
      !p.computed &&
      ((p.key.type === 'Identifier' && p.key.name === 'where') ||
        (p.key.type === 'Literal' && p.key.value === 'where')),
  );
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Prisma queries must filter by restaurant_id so single-restaurant MVP stays ready for multi-tenant (DEC-012).',
    },
    schema: [],
    messages: {
      missing:
        'Prisma {{method}} on "{{model}}" must include `restaurant_id` in its where clause (DEC-012). Add `where: { restaurant_id }` or, if this query is genuinely cross-tenant, suppress with // eslint-disable-next-line @tp/require-restaurant-id and explain why.',
      rawSql:
        'Raw SQL passed to Prisma must reference `restaurant_id` (DEC-012). Review the query and include a tenant filter.',
    },
  },
  create(context) {
    function isClientChain(memberNode) {
      // Walk .object chain; accept either a top-level identifier in CLIENT_IDENTIFIERS,
      // or `this.prisma` / `this.db` on a class field.
      let cur = memberNode;
      while (cur && cur.type === 'MemberExpression') cur = cur.object;
      if (cur && cur.type === 'Identifier' && CLIENT_IDENTIFIERS.has(cur.name)) return true;
      if (
        cur &&
        cur.type === 'MemberExpression' &&
        cur.object.type === 'ThisExpression' &&
        cur.property.type === 'Identifier' &&
        CLIENT_IDENTIFIERS.has(cur.property.name)
      ) {
        return true;
      }
      return false;
    }

    function checkRawSql(tagNode, fullNode) {
      if (!tagNode || tagNode.type !== 'MemberExpression') return;
      if (tagNode.property.type !== 'Identifier') return;
      const method = tagNode.property.name;
      if (method !== '$queryRaw' && method !== '$executeRaw' && method !== '$queryRawUnsafe' && method !== '$executeRawUnsafe') return;
      if (!isClientChain(tagNode.object)) return;
      const src = context.getSourceCode().getText(fullNode);
      if (!/restaurant_id/.test(src)) {
        context.report({ node: fullNode, messageId: 'rawSql' });
      }
    }

    return {
      TaggedTemplateExpression(node) {
        checkRawSql(node.tag, node);
      },
      CallExpression(node) {
        const callee = node.callee;
        if (!callee || callee.type !== 'MemberExpression') return;

        // Flag raw SQL called as a plain method: client.$queryRawUnsafe(`...`)
        if (callee.property.type === 'Identifier') {
          const method = callee.property.name;
          if (method === '$queryRaw' || method === '$executeRaw' || method === '$queryRawUnsafe' || method === '$executeRawUnsafe') {
            if (!isClientChain(callee.object)) return;
            const src = context.getSourceCode().getText(node);
            if (!/restaurant_id/.test(src)) {
              context.report({ node, messageId: 'rawSql' });
            }
            return;
          }
        }

        if (callee.property.type !== 'Identifier') return;
        const method = callee.property.name;
        if (!QUERY_METHODS.has(method)) return;

        // prisma.<model>.<method>(...) — object is a MemberExpression whose
        // own `object` walks back to a client identifier.
        const modelAccess = callee.object;
        if (!modelAccess || modelAccess.type !== 'MemberExpression') return;
        if (modelAccess.property.type !== 'Identifier') return;
        const model = modelAccess.property.name;

        if (!isClientChain(modelAccess.object)) return;
        if (isTenantFreeModel(model)) return;

        const arg = node.arguments[0];
        if (!arg) {
          // `findMany()` with no args → spans tenants by definition.
          context.report({ node, messageId: 'missing', data: { method, model } });
          return;
        }
        if (arg.type !== 'ObjectExpression') {
          // Variable passed in — we cannot inspect statically; permit with a
          // conservative pass so real code (composed where-clauses) isn't
          // over-flagged. Developers still see the rule in their typical hits.
          return;
        }
        const whereProp = findWhereProperty(arg);
        if (!whereProp) {
          context.report({ node, messageId: 'missing', data: { method, model } });
          return;
        }
        if (!hasRestaurantIdInObject(whereProp.value)) {
          context.report({ node, messageId: 'missing', data: { method, model } });
        }
      },
    };
  },
};
