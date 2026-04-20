// TASK-045 — migration atomic batch tests (AD-7, §6.14 AC-6).
//
// Behaviour contract:
//   - All parsers run first. Only on full success does the writer run.
//   - If any parser throws, zero rows are persisted.
//   - Parse-level errors (malformed rows) land in `errors[]` but do NOT abort.

import { describe, it, expect } from 'vitest';
import { runBatch, type BatchTask, type BatchWriter, type StagingBundle } from '../atomic_batch.js';
import type { BatchContext, ParseResult } from '../types.js';

const ctx: BatchContext = {
  batch_id: 'b1',
  source_file: 'mixed',
  parser_version: '1.0',
  restaurant_id: 'rid',
  started_at: new Date('2026-04-19T00:00:00Z'),
};

describe('runBatch', () => {
  it('writes only after every parser succeeds', async () => {
    const written: StagingBundle[] = [];
    const writer: BatchWriter = async (b) => { written.push(b); };
    const tasks: BatchTask[] = [
      { parser: 'p1', run: (): ParseResult<number> => ({ rows: [1, 2], errors: [] }) },
      { parser: 'p2', run: (): ParseResult<number> => ({ rows: [3], errors: [] }) },
    ];
    const out = await runBatch(ctx, tasks, writer);
    expect(out.written).toBe(true);
    expect(written).toHaveLength(1);
    expect(written[0]!.files.map((f) => f.parser)).toEqual(['p1', 'p2']);
  });

  it('surfaces row-level errors but still writes', async () => {
    const written: StagingBundle[] = [];
    const writer: BatchWriter = async (b) => { written.push(b); };
    const tasks: BatchTask[] = [
      { parser: 'p1', run: (): ParseResult<number> => ({
        rows: [1],
        errors: [{ source_row_ref: 'row:2', message: 'bad row' }],
      }) },
    ];
    const out = await runBatch(ctx, tasks, writer);
    expect(out.written).toBe(true);
    expect(out.files[0]!.error_count).toBe(1);
    expect(written).toHaveLength(1);
  });

  it('writes zero rows when any parser throws (AD-7)', async () => {
    const written: StagingBundle[] = [];
    const writer: BatchWriter = async (b) => { written.push(b); };
    const tasks: BatchTask[] = [
      { parser: 'good', run: () => ({ rows: [1, 2], errors: [] }) },
      { parser: 'bad',  run: () => { throw new Error('parser exploded'); } },
      { parser: 'never_runs', run: () => ({ rows: [99], errors: [] }) },
    ];
    const out = await runBatch(ctx, tasks, writer);
    expect(out.written).toBe(false);
    expect(out.error?.parser).toBe('bad');
    expect(written).toHaveLength(0);
  });

  it('stops at the first failing parser (does not keep going)', async () => {
    const calls: string[] = [];
    const writer: BatchWriter = async () => {};
    const tasks: BatchTask[] = [
      { parser: 'a', run: () => { calls.push('a'); return { rows: [], errors: [] }; } },
      { parser: 'b', run: () => { calls.push('b'); throw new Error('b failed'); } },
      { parser: 'c', run: () => { calls.push('c'); return { rows: [], errors: [] }; } },
    ];
    const out = await runBatch(ctx, tasks, writer);
    expect(calls).toEqual(['a', 'b']);
    expect(out.written).toBe(false);
  });
});
