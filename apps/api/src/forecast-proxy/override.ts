// GAP-05 — Forecast override capture (§6.12b AC-5).
//
// The owner / kitchen lead can override any advisory forecast. We persist the
// expected (model output), override (human number), reason, and — once the day
// passes — the actual qty. Phase 2 will use these tuples as a learning signal
// for when humans systematically disagree with the model.

import { randomBytes } from 'node:crypto';

export type ForecastEntityType = 'recipe' | 'ingredient';

export interface OverrideRow {
  id: string;
  restaurant_id: string;
  entity_type: ForecastEntityType;
  entity_id: string;
  target_date: string; // ISO date
  expected_qty: number;
  override_qty: number;
  actual_qty: number | null;
  reason: string | null;
  user_id: string | null;
  at: Date;
}

export interface CaptureInput {
  entity_type: ForecastEntityType;
  entity_id: string;
  target_date: string;
  expected_qty: number;
  override_qty: number;
  reason?: string;
  user_id?: string;
}

export interface ListFilters {
  entity_type?: ForecastEntityType;
  entity_id?: string;
  from_date?: string;
  to_date?: string;
}

export interface OverrideRepo {
  insert(row: OverrideRow): Promise<void>;
  list(restaurant_id: string, filters?: ListFilters): Promise<OverrideRow[]>;
  findById(id: string): Promise<OverrideRow | null>;
  update(id: string, patch: Partial<OverrideRow>): Promise<OverrideRow>;
}

export class OverrideValidationError extends Error {
  constructor(field: string, msg: string) {
    super(`${field}: ${msg}`);
    this.name = 'OverrideValidationError';
  }
}

export class OverrideNotFoundError extends Error {
  constructor(id: string) {
    super(`override ${id} not found`);
    this.name = 'OverrideNotFoundError';
  }
}

function uuidv4(): string {
  const b = randomBytes(16);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = b.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface OverrideServiceDeps {
  repo: OverrideRepo;
  now?: () => Date;
}

export class OverrideService {
  private readonly now: () => Date;
  constructor(private readonly deps: OverrideServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async capture(restaurant_id: string, input: CaptureInput): Promise<OverrideRow> {
    if (input.override_qty < 0) throw new OverrideValidationError('override_qty', 'must be ≥ 0');
    if (input.expected_qty < 0) throw new OverrideValidationError('expected_qty', 'must be ≥ 0');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.target_date)) {
      throw new OverrideValidationError('target_date', 'must be YYYY-MM-DD');
    }

    const row: OverrideRow = {
      id: uuidv4(),
      restaurant_id,
      entity_type: input.entity_type,
      entity_id: input.entity_id,
      target_date: input.target_date,
      expected_qty: input.expected_qty,
      override_qty: input.override_qty,
      actual_qty: null,
      reason: input.reason ?? null,
      user_id: input.user_id ?? null,
      at: this.now(),
    };
    await this.deps.repo.insert(row);
    return row;
  }

  list(restaurant_id: string, filters: ListFilters = {}): Promise<OverrideRow[]> {
    return this.deps.repo.list(restaurant_id, filters);
  }

  async recordActual(restaurant_id: string, id: string, actual_qty: number): Promise<OverrideRow> {
    if (actual_qty < 0) throw new OverrideValidationError('actual_qty', 'must be ≥ 0');
    const existing = await this.deps.repo.findById(id);
    if (!existing || existing.restaurant_id !== restaurant_id) {
      throw new OverrideNotFoundError(id);
    }
    return this.deps.repo.update(id, { actual_qty });
  }
}

export function inMemoryOverrideRepo(): OverrideRepo {
  const rows: OverrideRow[] = [];
  return {
    async insert(row) { rows.push(row); },
    async list(restaurant_id, filters = {}) {
      return rows.filter((r) => {
        if (r.restaurant_id !== restaurant_id) return false;
        if (filters.entity_type && r.entity_type !== filters.entity_type) return false;
        if (filters.entity_id && r.entity_id !== filters.entity_id) return false;
        if (filters.from_date && r.target_date < filters.from_date) return false;
        if (filters.to_date && r.target_date > filters.to_date) return false;
        return true;
      });
    },
    async findById(id) {
      return rows.find((r) => r.id === id) ?? null;
    },
    async update(id, patch) {
      const idx = rows.findIndex((r) => r.id === id);
      if (idx < 0) throw new OverrideNotFoundError(id);
      rows[idx] = { ...rows[idx]!, ...patch };
      return rows[idx]!;
    },
  };
}

export interface PrismaOverrideClient {
  forecastOverride: {
    create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
    findMany(args: unknown): Promise<Array<Record<string, unknown>>>;
    findUnique(args: unknown): Promise<Record<string, unknown> | null>;
    update(args: unknown): Promise<Record<string, unknown>>;
  };
}

function toRow(r: Record<string, unknown>): OverrideRow {
  const target = r.target_date instanceof Date
    ? r.target_date.toISOString().slice(0, 10)
    : String(r.target_date).slice(0, 10);
  return {
    id: String(r.id),
    restaurant_id: String(r.restaurant_id),
    entity_type: String(r.entity_type) as ForecastEntityType,
    entity_id: String(r.entity_id),
    target_date: target,
    expected_qty: Number(r.expected_qty),
    override_qty: Number(r.override_qty),
    actual_qty: r.actual_qty == null ? null : Number(r.actual_qty),
    reason: r.reason == null ? null : String(r.reason),
    user_id: r.user_id == null ? null : String(r.user_id),
    at: r.at instanceof Date ? r.at : new Date(String(r.at)),
  };
}

export function prismaOverrideRepo(prisma: PrismaOverrideClient): OverrideRepo {
  return {
    async insert(row) {
      await prisma.forecastOverride.create({
        data: {
          id: row.id,
          restaurant_id: row.restaurant_id,
          entity_type: row.entity_type,
          entity_id: row.entity_id,
          target_date: new Date(row.target_date + 'T00:00:00Z'),
          expected_qty: row.expected_qty,
          override_qty: row.override_qty,
          actual_qty: row.actual_qty,
          reason: row.reason,
          user_id: row.user_id,
          at: row.at,
        },
      });
    },
    async list(restaurant_id, filters = {}) {
      const where: Record<string, unknown> = { restaurant_id };
      if (filters.entity_type) where.entity_type = filters.entity_type;
      if (filters.entity_id) where.entity_id = filters.entity_id;
      if (filters.from_date || filters.to_date) {
        const range: Record<string, Date> = {};
        if (filters.from_date) range.gte = new Date(filters.from_date + 'T00:00:00Z');
        if (filters.to_date) range.lte = new Date(filters.to_date + 'T00:00:00Z');
        where.target_date = range;
      }
      const rows = await prisma.forecastOverride.findMany({ where, orderBy: { target_date: 'desc' } });
      return rows.map(toRow);
    },
    async findById(id) {
      const r = await prisma.forecastOverride.findUnique({ where: { id } });
      return r ? toRow(r) : null;
    },
    async update(id, patch) {
      const data: Record<string, unknown> = {};
      if (patch.actual_qty !== undefined) data.actual_qty = patch.actual_qty;
      if (patch.reason !== undefined) data.reason = patch.reason;
      const r = await prisma.forecastOverride.update({ where: { id }, data });
      return toRow(r);
    },
  };
}
