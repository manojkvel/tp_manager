// TASK-052 — Prep sheet service (§6.4).
//
// Morning generator: for each menu/prep recipe with a ParLevel set for today's
// day-of-week, compute `needed = par − on_hand_within_shelf_life`, clamped at 0.
// Marking a row complete stamps `prepared_on` + yields a PrepRun row that the
// on-hand calculator picks up on subsequent generations.

import { randomBytes } from 'node:crypto';

export type PrepRowStatus = 'pending' | 'in_progress' | 'complete' | 'skipped';

export interface PrepSheetRow {
  id: string;
  prep_sheet_id: string;
  recipe_version_id: string;
  recipe_id: string;
  recipe_name: string;
  needed_qty: number;
  status: PrepRowStatus;
  started_at: Date | null;
  completed_at: Date | null;
  user_id: string | null;
  skip_reason: string | null;
  // v1.7 — prep sheet QC + assignment fields
  assigned_to_user_id: string | null;
  qc_signed_by_user_id: string | null;
  qc_signed_at: Date | null;
  temp_f: number | null;
}

export interface PrepSheetSummary {
  total_rows: number;
  completed_rows: number;
  completion_pct: number;
  qc_passed: number;
  pending: number;
  in_progress: number;
  skipped: number;
  below_par: number;
  total_needed_qty: number;
}

export interface PrepSheet {
  id: string;
  restaurant_id: string;
  date: Date;
  generated_at: Date;
  rows: PrepSheetRow[];
}

export interface PrepRun {
  id: string;
  recipe_version_id: string;
  prepared_on: Date;
  prepared_by_user_id: string | null;
  qty_yielded: number;
  expires_on: Date | null;
  created_at: Date;
}

export interface ParForDay {
  recipe_id: string;
  recipe_version_id: string;
  recipe_name: string;
  qty: number;
  shelf_life_days: number | null;
}

export interface PrepSheetRepo {
  findByDate(restaurant_id: string, date: Date): Promise<PrepSheet | null>;
  insert(sheet: PrepSheet): Promise<void>;
  getRow(id: string): Promise<{ row: PrepSheetRow; restaurant_id: string } | null>;
  updateRow(id: string, patch: Partial<PrepSheetRow>): Promise<void>;
}

export interface PrepRunRepo {
  insert(run: PrepRun): Promise<void>;
  /** Sum of `qty_yielded` for runs still within shelf-life (prepared_on + shelf_life_days ≥ asOf). */
  onHandWithinShelfLife(recipe_version_id: string, shelf_life_days: number | null, asOf: Date): Promise<number>;
}

export interface ParRepo {
  /** Returns par rows for a given day-of-week (0=Sun..6=Sat), scoped to tenant. */
  forDayOfWeek(restaurant_id: string, day_of_week: number): Promise<ParForDay[]>;
}

export class PrepSheetNotFoundError extends Error {
  constructor(id: string) { super(`prep sheet row ${id} not found`); this.name = 'PrepSheetNotFoundError'; }
}

export class SkipReasonRequiredError extends Error {
  constructor() { super('skip reason required'); this.name = 'SkipReasonRequiredError'; }
}

export interface PrepServiceDeps {
  sheets: PrepSheetRepo;
  runs: PrepRunRepo;
  pars: ParRepo;
  now?: () => Date;
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

export class PrepService {
  private readonly now: () => Date;
  constructor(private readonly deps: PrepServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /** §6.4 AC-2 — generate the daily sheet. Idempotent per (restaurant_id, date). */
  async generate(restaurant_id: string, date: Date): Promise<PrepSheet> {
    const day = stripToDate(date);
    const existing = await this.deps.sheets.findByDate(restaurant_id, day);
    if (existing) return existing;

    const dayOfWeek = day.getUTCDay();
    const pars = await this.deps.pars.forDayOfWeek(restaurant_id, dayOfWeek);
    const sheet_id = uuidv4();
    const rows: PrepSheetRow[] = [];
    for (const par of pars) {
      const onHand = await this.deps.runs.onHandWithinShelfLife(par.recipe_version_id, par.shelf_life_days, day);
      const needed = Math.max(0, par.qty - onHand);
      if (needed <= 0) continue; // §6.4 AC-2 — only show items that need prepping
      rows.push({
        id: uuidv4(),
        prep_sheet_id: sheet_id,
        recipe_version_id: par.recipe_version_id,
        recipe_id: par.recipe_id,
        recipe_name: par.recipe_name,
        needed_qty: needed,
        status: 'pending',
        started_at: null,
        completed_at: null,
        user_id: null,
        skip_reason: null,
        assigned_to_user_id: null,
        qc_signed_by_user_id: null,
        qc_signed_at: null,
        temp_f: null,
      });
    }
    const sheet: PrepSheet = { id: sheet_id, restaurant_id, date: day, generated_at: this.now(), rows };
    await this.deps.sheets.insert(sheet);
    return sheet;
  }

  async start(restaurant_id: string, row_id: string, user_id: string | null): Promise<void> {
    const ctx = await this.deps.sheets.getRow(row_id);
    if (!ctx || ctx.restaurant_id !== restaurant_id) throw new PrepSheetNotFoundError(row_id);
    await this.deps.sheets.updateRow(row_id, { status: 'in_progress', started_at: this.now(), user_id });
  }

  /** §6.4 AC-4 — mark complete: stamp prepared_on, insert PrepRun so on-hand bumps. */
  async markComplete(
    restaurant_id: string,
    row_id: string,
    user_id: string | null,
    shelf_life_days: number | null,
  ): Promise<PrepRun> {
    const ctx = await this.deps.sheets.getRow(row_id);
    if (!ctx || ctx.restaurant_id !== restaurant_id) throw new PrepSheetNotFoundError(row_id);
    const now = this.now();
    const preparedOn = stripToDate(now);
    const expires = shelf_life_days != null
      ? new Date(preparedOn.getTime() + shelf_life_days * 86_400_000)
      : null;
    const run: PrepRun = {
      id: uuidv4(),
      recipe_version_id: ctx.row.recipe_version_id,
      prepared_on: preparedOn,
      prepared_by_user_id: user_id,
      qty_yielded: ctx.row.needed_qty,
      expires_on: expires,
      created_at: now,
    };
    await this.deps.runs.insert(run);
    await this.deps.sheets.updateRow(row_id, { status: 'complete', completed_at: now, user_id });
    return run;
  }

  /** §6.4 AC-5 — skip with a reason. */
  async markSkipped(restaurant_id: string, row_id: string, reason: string): Promise<void> {
    if (!reason.trim()) throw new SkipReasonRequiredError();
    const ctx = await this.deps.sheets.getRow(row_id);
    if (!ctx || ctx.restaurant_id !== restaurant_id) throw new PrepSheetNotFoundError(row_id);
    await this.deps.sheets.updateRow(row_id, { status: 'skipped', skip_reason: reason });
  }

  /** v1.7 §6.4 AC-6 — partial edit: assignee, temp_f, status tweaks. */
  async patchRow(
    restaurant_id: string,
    row_id: string,
    patch: Partial<Pick<PrepSheetRow, 'assigned_to_user_id' | 'temp_f' | 'needed_qty'>>,
  ): Promise<void> {
    const ctx = await this.deps.sheets.getRow(row_id);
    if (!ctx || ctx.restaurant_id !== restaurant_id) throw new PrepSheetNotFoundError(row_id);
    await this.deps.sheets.updateRow(row_id, patch);
  }

  /** v1.7 §6.4 AC-7 — sign off QC after completion. */
  async signQc(
    restaurant_id: string, row_id: string, qc_user_id: string, temp_f: number | null,
  ): Promise<void> {
    const ctx = await this.deps.sheets.getRow(row_id);
    if (!ctx || ctx.restaurant_id !== restaurant_id) throw new PrepSheetNotFoundError(row_id);
    await this.deps.sheets.updateRow(row_id, {
      qc_signed_by_user_id: qc_user_id,
      qc_signed_at: this.now(),
      temp_f: temp_f ?? ctx.row.temp_f,
    });
  }

  /** v1.7 §6.4 AC-8 — sheet KPIs (completion %, QC count, below-PAR). */
  summarise(sheet: PrepSheet): PrepSheetSummary {
    const total = sheet.rows.length;
    const completed = sheet.rows.filter((r) => r.status === 'complete').length;
    const pending = sheet.rows.filter((r) => r.status === 'pending').length;
    const in_progress = sheet.rows.filter((r) => r.status === 'in_progress').length;
    const skipped = sheet.rows.filter((r) => r.status === 'skipped').length;
    const qc = sheet.rows.filter((r) => r.qc_signed_at != null).length;
    const below = sheet.rows.filter((r) => r.needed_qty > 0 && r.status !== 'complete').length;
    return {
      total_rows: total,
      completed_rows: completed,
      completion_pct: total === 0 ? 0 : Math.round((completed / total) * 1000) / 10,
      qc_passed: qc,
      pending,
      in_progress,
      skipped,
      below_par: below,
      total_needed_qty: sheet.rows.reduce((s, r) => s + r.needed_qty, 0),
    };
  }
}
