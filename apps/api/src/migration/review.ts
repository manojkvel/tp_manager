// TASK-061 — Migration review service (§6.14 AC-4..7).
//
// In-memory model for owner-facing review of staged batches. Owner sees four
// buckets (new / matched / ambiguous / unmapped) with a per-row "why this
// match" explanation, and can approve a whole batch (all-or-nothing per AD-7)
// or rollback within 14 days of approval.

import { randomBytes } from 'node:crypto';
import { dedupe, type CanonicalCandidate, type DedupeResult, type StagingProbe } from './dedupe.js';

export type ReviewBatchStatus = 'staged' | 'approved' | 'rolled_back';

export interface StagedBatch {
  id: string;
  restaurant_id: string;
  source_file: string;
  parser_version: string;
  staged_at: Date;
  status: ReviewBatchStatus;
  approved_at: Date | null;
  approved_by: string | null;
  rolled_back_at: Date | null;
}

export interface StagedItem {
  id: string;
  batch_id: string;
  kind: 'ingredient' | 'recipe' | 'pos_sale';
  probe: StagingProbe;
  payload: Record<string, unknown>;
  bucket: DedupeResult['bucket'];
  matches: DedupeResult['matches'];
  decision: 'pending' | 'accept_new' | 'merge' | 'reject';
  decision_target_id: string | null;
}

export interface ReviewBatchRepo {
  insertBatch(b: StagedBatch): Promise<void>;
  findBatch(id: string): Promise<StagedBatch | null>;
  listBatches(restaurant_id: string): Promise<StagedBatch[]>;
  updateBatch(id: string, patch: Partial<StagedBatch>): Promise<void>;
  insertItem(item: StagedItem): Promise<void>;
  itemsFor(batch_id: string): Promise<StagedItem[]>;
  updateItem(id: string, patch: Partial<StagedItem>): Promise<void>;
}

export interface CanonicalSource {
  ingredients(restaurant_id: string): Promise<CanonicalCandidate[]>;
}

export interface PromotionWriter {
  /** Promote all approved items to canonical tables — must be transactional (AD-7). */
  promote(batch: StagedBatch, items: StagedItem[]): Promise<{ inserted: number; merged: number }>;
  rollback(batch: StagedBatch): Promise<{ removed: number }>;
}

export class ReviewBatchNotFoundError extends Error {
  constructor(id: string) { super(`migration batch ${id} not found`); this.name = 'ReviewBatchNotFoundError'; }
}

export class ReviewBatchAlreadyProcessedError extends Error {
  constructor(id: string, status: string) { super(`batch ${id} is already ${status}`); this.name = 'ReviewBatchAlreadyProcessedError'; }
}

export class ReviewRollbackWindowError extends Error {
  constructor() { super('rollback window (14 days) has expired'); this.name = 'ReviewRollbackWindowError'; }
}

function uuidv4(): string {
  const b = randomBytes(16);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = b.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const ROLLBACK_WINDOW_MS = 14 * 86_400_000;

export interface ReviewServiceDeps {
  repo: ReviewBatchRepo;
  canonical: CanonicalSource;
  writer: PromotionWriter;
  now?: () => Date;
}

export class MigrationReviewService {
  private readonly now: () => Date;
  constructor(private readonly deps: ReviewServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async stage(
    restaurant_id: string,
    input: { source_file: string; parser_version: string; ingredients: Array<{ probe: StagingProbe; payload: Record<string, unknown> }> },
  ): Promise<{ batch: StagedBatch; items: StagedItem[] }> {
    const batch: StagedBatch = {
      id: uuidv4(),
      restaurant_id,
      source_file: input.source_file,
      parser_version: input.parser_version,
      staged_at: this.now(),
      status: 'staged',
      approved_at: null,
      approved_by: null,
      rolled_back_at: null,
    };
    await this.deps.repo.insertBatch(batch);

    const candidates = await this.deps.canonical.ingredients(restaurant_id);
    const items: StagedItem[] = [];
    for (const ing of input.ingredients) {
      const result = dedupe(ing.probe, candidates);
      const item: StagedItem = {
        id: uuidv4(),
        batch_id: batch.id,
        kind: 'ingredient',
        probe: ing.probe,
        payload: ing.payload,
        bucket: result.bucket,
        matches: result.matches,
        decision: result.bucket === 'matched' && result.matches[0] ? 'merge' : 'pending',
        decision_target_id: result.bucket === 'matched' && result.matches[0] ? result.matches[0].id : null,
      };
      await this.deps.repo.insertItem(item);
      items.push(item);
    }
    return { batch, items };
  }

  async listBatches(restaurant_id: string): Promise<StagedBatch[]> {
    return this.deps.repo.listBatches(restaurant_id);
  }

  async getBatch(restaurant_id: string, id: string): Promise<{ batch: StagedBatch; items: StagedItem[] }> {
    const batch = await this.deps.repo.findBatch(id);
    if (!batch || batch.restaurant_id !== restaurant_id) throw new ReviewBatchNotFoundError(id);
    const items = await this.deps.repo.itemsFor(id);
    return { batch, items };
  }

  async setItemDecision(
    restaurant_id: string, batch_id: string, item_id: string,
    decision: 'accept_new' | 'merge' | 'reject', target_id?: string | null,
  ): Promise<void> {
    const { batch, items } = await this.getBatch(restaurant_id, batch_id);
    if (batch.status !== 'staged') throw new ReviewBatchAlreadyProcessedError(batch_id, batch.status);
    const item = items.find((i) => i.id === item_id);
    if (!item) throw new ReviewBatchNotFoundError(item_id);
    await this.deps.repo.updateItem(item_id, { decision, decision_target_id: target_id ?? null });
  }

  /** §6.14 AC-6 — approve promotes the batch all-or-nothing. */
  async approve(restaurant_id: string, batch_id: string, user_id: string): Promise<{ inserted: number; merged: number }> {
    const { batch, items } = await this.getBatch(restaurant_id, batch_id);
    if (batch.status !== 'staged') throw new ReviewBatchAlreadyProcessedError(batch_id, batch.status);
    if (items.some((i) => i.decision === 'pending')) {
      throw new Error('cannot approve batch: items still pending decision');
    }
    const result = await this.deps.writer.promote(batch, items);
    await this.deps.repo.updateBatch(batch_id, {
      status: 'approved', approved_at: this.now(), approved_by: user_id,
    });
    return result;
  }

  /** §6.14 AC-7 — rollback within 14 days of approval. */
  async rollback(restaurant_id: string, batch_id: string): Promise<{ removed: number }> {
    const { batch } = await this.getBatch(restaurant_id, batch_id);
    if (batch.status !== 'approved') throw new ReviewBatchAlreadyProcessedError(batch_id, batch.status);
    if (!batch.approved_at) throw new ReviewBatchAlreadyProcessedError(batch_id, batch.status);
    const age = this.now().getTime() - batch.approved_at.getTime();
    if (age > ROLLBACK_WINDOW_MS) throw new ReviewRollbackWindowError();
    const result = await this.deps.writer.rollback(batch);
    await this.deps.repo.updateBatch(batch_id, { status: 'rolled_back', rolled_back_at: this.now() });
    return result;
  }
}
