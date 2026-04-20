// TASK-047 — Staging writer.
//
// Abstracted from Prisma so we can unit-test the batch runner. The real
// implementation lives in `prisma-staging-writer.ts` (created alongside
// migrations that provision `staging.*` tables — not yet in scope for Wave 5).

import type { BatchWriter, StagingBundle } from './atomic_batch.js';

export interface BatchPersistence {
  writeBundle(bundle: StagingBundle): Promise<{ rows_written: number }>;
}

export function stagingBatchWriter(persistence: BatchPersistence): BatchWriter {
  return async (bundle) => {
    await persistence.writeBundle(bundle);
  };
}
