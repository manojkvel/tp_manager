// TASK-047 — Atomic batch runner (AD-7).
//
// Contract: parse-all-then-insert. If *any* parser throws or produces hard
// errors, nothing is written. On success, the writer receives the full bundle
// in one call and is expected to persist behind a single transaction.
//
// We do NOT let row-level `ParseError`s (malformed rows) abort the batch — those
// land in `staging.parse_errors` (§6.14 edge case). Only thrown exceptions abort.

import type { BatchContext, ParseResult } from './types.js';

export interface StagingBundle {
  ctx: BatchContext;
  files: Array<{
    parser: string;
    result: ParseResult<unknown>;
  }>;
}

export type BatchWriter = (bundle: StagingBundle) => Promise<void>;

export interface BatchTask {
  parser: string;
  run: (ctx: BatchContext) => ParseResult<unknown>;
}

export interface RunBatchResult {
  written: boolean;
  files: Array<{ parser: string; row_count: number; error_count: number }>;
  error?: { parser: string; message: string };
}

export async function runBatch(
  ctx: BatchContext,
  tasks: BatchTask[],
  writer: BatchWriter,
): Promise<RunBatchResult> {
  const files: Array<{ parser: string; result: ParseResult<unknown> }> = [];
  for (const task of tasks) {
    try {
      const result = task.run(ctx);
      files.push({ parser: task.parser, result });
    } catch (err) {
      return {
        written: false,
        files: files.map((f) => ({ parser: f.parser, row_count: f.result.rows.length, error_count: f.result.errors.length })),
        error: { parser: task.parser, message: (err as Error).message },
      };
    }
  }
  // All parsers succeeded → write the full bundle in one transactional call.
  await writer({ ctx, files });
  return {
    written: true,
    files: files.map((f) => ({ parser: f.parser, row_count: f.result.rows.length, error_count: f.result.errors.length })),
  };
}
