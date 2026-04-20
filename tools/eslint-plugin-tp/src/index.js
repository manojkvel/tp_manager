// @tp/eslint-plugin-tp — organisation-specific ESLint rules (TASK-025 / DEC-012).
//
// Exported rules:
//   - require-restaurant-id: block Prisma queries that would span tenants.
//
// Consumed by the repo-root `.eslintrc.cjs`. Kept in-repo (not published)
// because the policy is coupled to the TP Manager schema.

import requireRestaurantId from './rules/require-restaurant-id.js';

export default {
  rules: {
    'require-restaurant-id': requireRestaurantId,
  },
};
