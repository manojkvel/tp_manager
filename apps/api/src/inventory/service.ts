// TASK-053 — Inventory-count service (§6.5).
//
// Counts are location-grouped with pause/resume (offline-safe). Historic counts
// are immutable — amending creates a new count that references the prior via
// `amends_count_id` and flips the prior's status to `amended`.

import { randomBytes } from 'node:crypto';

export type InventoryCountStatus = 'open' | 'paused' | 'completed' | 'amended';

export interface InventoryCount {
  id: string;
  restaurant_id: string;
  date: Date;
  status: InventoryCountStatus;
  started_by: string | null;
  completed_by: string | null;
  amends_count_id: string | null;
  created_at: Date;
}

export interface InventoryCountLine {
  id: string;
  count_id: string;
  ref_type: 'ingredient' | 'recipe';
  ingredient_id: string | null;
  recipe_version_id: string | null;
  location_id: string | null;
  expected_qty: number | null;
  actual_qty: number;
  unit_cost_cents: number | null;
}

export interface AddLineInput {
  ref_type: 'ingredient' | 'recipe';
  ingredient_id?: string | null;
  recipe_version_id?: string | null;
  location_id?: string | null;
  expected_qty?: number | null;
  actual_qty: number;
  unit_cost_cents?: number | null;
}

export interface InventoryCountRepo {
  findById(id: string): Promise<InventoryCount | null>;
  insert(row: InventoryCount): Promise<void>;
  updateStatus(id: string, status: InventoryCountStatus, completed_by?: string | null): Promise<void>;
  linesFor(count_id: string): Promise<InventoryCountLine[]>;
  insertLine(line: InventoryCountLine): Promise<void>;
  replaceLine(line: InventoryCountLine): Promise<void>;
}

export class InventoryCountNotFoundError extends Error {
  constructor(id: string) { super(`inventory count ${id} not found`); this.name = 'InventoryCountNotFoundError'; }
}

export class InventoryCountImmutableError extends Error {
  constructor(id: string, status: string) {
    super(`count ${id} is ${status}; create an amendment instead`);
    this.name = 'InventoryCountImmutableError';
  }
}

export class InvalidCountTransitionError extends Error {
  constructor(from: string, to: string) { super(`cannot transition count from ${from} to ${to}`); this.name = 'InvalidCountTransitionError'; }
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

export interface InventoryServiceDeps {
  counts: InventoryCountRepo;
  now?: () => Date;
}

export class InventoryService {
  private readonly now: () => Date;
  constructor(private readonly deps: InventoryServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  private async ownedOrThrow(restaurant_id: string, id: string): Promise<InventoryCount> {
    const c = await this.deps.counts.findById(id);
    if (!c || c.restaurant_id !== restaurant_id) throw new InventoryCountNotFoundError(id);
    return c;
  }

  async start(restaurant_id: string, date: Date, started_by: string | null): Promise<InventoryCount> {
    const row: InventoryCount = {
      id: uuidv4(),
      restaurant_id,
      date: stripToDate(date),
      status: 'open',
      started_by,
      completed_by: null,
      amends_count_id: null,
      created_at: this.now(),
    };
    await this.deps.counts.insert(row);
    return row;
  }

  /** §6.5 AC-4 — pause/resume for offline-safe workflows. */
  async pause(restaurant_id: string, id: string): Promise<void> {
    const c = await this.ownedOrThrow(restaurant_id, id);
    if (c.status !== 'open') throw new InvalidCountTransitionError(c.status, 'paused');
    await this.deps.counts.updateStatus(id, 'paused');
  }

  async resume(restaurant_id: string, id: string): Promise<void> {
    const c = await this.ownedOrThrow(restaurant_id, id);
    if (c.status !== 'paused') throw new InvalidCountTransitionError(c.status, 'open');
    await this.deps.counts.updateStatus(id, 'open');
  }

  async addLine(restaurant_id: string, count_id: string, input: AddLineInput): Promise<InventoryCountLine> {
    const c = await this.ownedOrThrow(restaurant_id, count_id);
    if (c.status === 'completed' || c.status === 'amended') {
      throw new InventoryCountImmutableError(count_id, c.status);
    }
    const line: InventoryCountLine = {
      id: uuidv4(),
      count_id,
      ref_type: input.ref_type,
      ingredient_id: input.ingredient_id ?? null,
      recipe_version_id: input.recipe_version_id ?? null,
      location_id: input.location_id ?? null,
      expected_qty: input.expected_qty ?? null,
      actual_qty: input.actual_qty,
      unit_cost_cents: input.unit_cost_cents ?? null,
    };
    await this.deps.counts.insertLine(line);
    return line;
  }

  async complete(restaurant_id: string, id: string, completed_by: string | null): Promise<void> {
    const c = await this.ownedOrThrow(restaurant_id, id);
    if (c.status === 'completed' || c.status === 'amended') {
      throw new InventoryCountImmutableError(id, c.status);
    }
    await this.deps.counts.updateStatus(id, 'completed', completed_by);
  }

  /** §6.5 AC-5 — amend by creating a new count that references the prior. */
  async amend(restaurant_id: string, prior_id: string, started_by: string | null): Promise<InventoryCount> {
    const prior = await this.ownedOrThrow(restaurant_id, prior_id);
    if (prior.status !== 'completed') {
      throw new InvalidCountTransitionError(prior.status, 'amended');
    }
    const priorLines = await this.deps.counts.linesFor(prior_id);
    const next: InventoryCount = {
      id: uuidv4(),
      restaurant_id,
      date: stripToDate(this.now()),
      status: 'open',
      started_by,
      completed_by: null,
      amends_count_id: prior_id,
      created_at: this.now(),
    };
    await this.deps.counts.insert(next);
    for (const l of priorLines) {
      await this.deps.counts.insertLine({ ...l, id: uuidv4(), count_id: next.id });
    }
    await this.deps.counts.updateStatus(prior_id, 'amended');
    return next;
  }

  linesFor(count_id: string): Promise<InventoryCountLine[]> {
    return this.deps.counts.linesFor(count_id);
  }

  get(restaurant_id: string, id: string): Promise<InventoryCount> {
    return this.ownedOrThrow(restaurant_id, id);
  }
}
