// TASK-066 — Aloha import service (§6.12a, AD-3, AD-7).
//
// Wraps the aloha_pmix_parser in a transactional, idempotent import. Re-importing
// the same business_date is a no-op for that day's PosSales (replace by import_run
// with status='ok' is the source of truth — older runs are flagged superseded).

import { randomBytes } from 'node:crypto';
import { aloha_pmix_parser } from '../migration/parsers/aloha_pmix_parser.js';
import type { BatchContext, StagingPosSale } from '../migration/types.js';

export type AlohaImportSource = 'sftp' | 'api' | 'middleware' | 'manual_upload';
export type AlohaImportStatus = 'ok' | 'failed' | 'partial';
export type PosRowKind = 'item' | 'modifier' | 'stockout_86' | 'cover' | 'unclassified';

export interface AlohaImportRun {
  id: string;
  restaurant_id: string;
  business_date: Date;
  source: AlohaImportSource;
  started_at: Date;
  completed_at: Date | null;
  status: AlohaImportStatus;
  rows_ingested: number;
  error_detail: string | null;
}

export interface PosSaleRow {
  id: string;
  import_run_id: string;
  restaurant_id: string;
  business_date: Date;
  category: string | null;
  aloha_item_name: string;
  row_kind: PosRowKind;
  qty: number;
  unit_price_cents: number | null;
  item_sales_cents: number | null;
  aloha_cost_cents: number | null;
}

export interface CoverCount {
  id: string;
  restaurant_id: string;
  import_run_id: string | null;
  business_date: Date;
  covers: number;
}

export interface StockoutEvent {
  id: string;
  restaurant_id: string;
  import_run_id: string | null;
  business_date: Date;
  ingredient_id: string | null;
  recipe_id: string | null;
  aloha_marker_name: string;
  count: number;
  mapped: boolean;
}

export interface ReconciliationItem {
  id: string;
  restaurant_id: string;
  aloha_item_name: string;
  row_kind: PosRowKind;
  first_seen_on: Date;
  occurrences: number;
  resolved: boolean;
}

export interface AlohaRepo {
  insertRun(run: AlohaImportRun): Promise<void>;
  updateRun(id: string, patch: Partial<AlohaImportRun>): Promise<void>;
  /** Atomic delete-then-insert of a day's pos_sales + covers + stockouts under a single tx. */
  replaceDay(restaurant_id: string, business_date: Date, op: () => Promise<{
    pos_sales: PosSaleRow[]; covers: CoverCount | null; stockouts: StockoutEvent[];
  }>): Promise<void>;
  recentRuns(restaurant_id: string, limit: number): Promise<AlohaImportRun[]>;
  /** Insert (or upsert by aloha_item_name + row_kind) into reconciliation queue. */
  enqueueReconciliation(items: ReconciliationItem[]): Promise<void>;
}

export class AlohaImportError extends Error {
  constructor(msg: string) { super(msg); this.name = 'AlohaImportError'; }
}

function uuidv4(): string {
  const b = randomBytes(16);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = b.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function stripToDate(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function mapRowKind(kind: StagingPosSale['kind']): PosRowKind {
  switch (kind) {
    case 'item': return 'item';
    case 'modifier': return 'modifier';
    case 'stockout': return 'stockout_86';
    case 'cover': return 'cover';
    default: return 'unclassified';
  }
}

export interface AlohaServiceDeps {
  repo: AlohaRepo;
  now?: () => Date;
}

export class AlohaService {
  private readonly now: () => Date;
  constructor(private readonly deps: AlohaServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /** §6.12a AC-6 — `import_run_idempotent`: re-import for same business_date replaces atomically. */
  async importPmix(
    restaurant_id: string,
    source: AlohaImportSource,
    rows: readonly (readonly string[])[],
  ): Promise<AlohaImportRun> {
    const ctx: BatchContext = {
      batch_id: uuidv4(),
      source_file: `aloha_${source}_${this.now().toISOString()}`,
      parser_version: 'pmix-1',
      restaurant_id,
      started_at: this.now(),
    };
    const parsed = aloha_pmix_parser(rows, ctx);

    const run: AlohaImportRun = {
      id: uuidv4(),
      restaurant_id,
      business_date: stripToDate(parsed.rows[0]?.business_date ? new Date(parsed.rows[0]!.business_date) : this.now()),
      source,
      started_at: this.now(),
      completed_at: null,
      status: 'ok',
      rows_ingested: 0,
      error_detail: parsed.errors.length > 0 ? `${parsed.errors.length} row errors` : null,
    };

    await this.deps.repo.insertRun(run);

    try {
      await this.deps.repo.replaceDay(restaurant_id, run.business_date, async () => {
        const pos: PosSaleRow[] = parsed.rows.map((r) => ({
          id: uuidv4(),
          import_run_id: run.id,
          restaurant_id,
          business_date: stripToDate(new Date(r.business_date)),
          category: null,
          aloha_item_name: r.menu_item_name,
          row_kind: mapRowKind(r.kind),
          qty: r.qty_sold,
          unit_price_cents: null,
          item_sales_cents: r.net_sales_cents,
          aloha_cost_cents: null,
        }));
        const coversRow = parsed.rows.find((r) => r.kind === 'cover');
        const covers: CoverCount | null = coversRow ? {
          id: uuidv4(),
          restaurant_id,
          import_run_id: run.id,
          business_date: stripToDate(new Date(coversRow.business_date)),
          covers: Math.round(coversRow.qty_sold),
        } : null;
        const stockouts: StockoutEvent[] = parsed.rows
          .filter((r) => r.kind === 'stockout')
          .map((r) => ({
            id: uuidv4(),
            restaurant_id,
            import_run_id: run.id,
            business_date: stripToDate(new Date(r.business_date)),
            ingredient_id: null,
            recipe_id: null,
            aloha_marker_name: r.menu_item_name,
            count: 1,
            mapped: false,
          }));
        return { pos_sales: pos, covers, stockouts };
      });
      run.completed_at = this.now();
      run.rows_ingested = parsed.rows.length;
      await this.deps.repo.updateRun(run.id, run);
    } catch (err) {
      run.status = 'failed';
      run.completed_at = this.now();
      run.error_detail = (err as Error).message;
      await this.deps.repo.updateRun(run.id, run);
      throw new AlohaImportError(run.error_detail);
    }

    // Items + modifiers get enqueued for reconciliation if no menu/modifier map exists.
    const reconcileTargets = parsed.rows.filter((r) => r.kind === 'item' || r.kind === 'modifier');
    if (reconcileTargets.length > 0) {
      const grouped = new Map<string, ReconciliationItem>();
      for (const r of reconcileTargets) {
        const key = `${r.menu_item_name}|${r.kind}`;
        const existing = grouped.get(key);
        if (existing) { existing.occurrences += 1; }
        else {
          grouped.set(key, {
            id: uuidv4(),
            restaurant_id,
            aloha_item_name: r.menu_item_name,
            row_kind: mapRowKind(r.kind),
            first_seen_on: stripToDate(new Date(r.business_date)),
            occurrences: 1,
            resolved: false,
          });
        }
      }
      await this.deps.repo.enqueueReconciliation([...grouped.values()]);
    }

    return run;
  }

  recentRuns(restaurant_id: string, limit = 30): Promise<AlohaImportRun[]> {
    return this.deps.repo.recentRuns(restaurant_id, limit);
  }
}
