import { defineConfig } from 'vitest/config';

// Pick up both co-located unit tests under `src/**` (e.g., feature-flags) and
// integration tests under `test/**` (DB-backed; gated on TEST_DATABASE_URL).
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
});
