// TASK-034 — Suppliers service unit tests (§6.2 AC-1..5).
//
// AC-1: CRUD (name, contact, phone, email, order cadence, lead time, min order)
// AC-2: supplier detail lists ingredients supplied
// AC-3: N supplier offers per ingredient with rank; rank reorder preserves history
// AC-4: delivery history filter by supplier (covered in Wave 6)
// AC-5: Price Creep report flags >X% rise over window

import { beforeEach, describe, expect, it } from 'vitest';
import {
  SuppliersService,
  priceCreep,
  type SupplierRepo,
  type SupplierOfferRepo,
  type SupplierRow,
  type SupplierOfferRow,
} from '../service.js';

const RID = '00000000-0000-0000-0000-0000000000bb';

function inMemoryRepos() {
  const suppliers = new Map<string, SupplierRow>();
  const offers = new Map<string, SupplierOfferRow>();

  const repo: SupplierRepo = {
    async list(restaurant_id, filters) {
      return [...suppliers.values()].filter(
        (s) => s.restaurant_id === restaurant_id && (filters?.includeInactive || s.is_active),
      );
    },
    async findById(id) {
      return suppliers.get(id) ?? null;
    },
    async findByName(restaurant_id, name) {
      for (const s of suppliers.values()) {
        if (s.restaurant_id === restaurant_id && s.name.toLowerCase() === name.toLowerCase()) return s;
      }
      return null;
    },
    async insert(row) {
      suppliers.set(row.id, row);
    },
    async update(id, patch) {
      const s = suppliers.get(id);
      if (!s) throw new Error('not found');
      suppliers.set(id, { ...s, ...patch });
    },
    async deactivate(id) {
      const s = suppliers.get(id);
      if (!s) throw new Error('not found');
      suppliers.set(id, { ...s, is_active: false });
    },
  };

  const offerRepo: SupplierOfferRepo = {
    async offersForIngredient(ingredient_id) {
      return [...offers.values()]
        .filter((o) => o.ingredient_id === ingredient_id && o.effective_until === null)
        .sort((a, b) => a.rank - b.rank);
    },
    async offersForSupplier(supplier_id) {
      return [...offers.values()].filter((o) => o.supplier_id === supplier_id && o.effective_until === null);
    },
    async insert(row) {
      offers.set(row.id, row);
    },
    async endCurrent(ingredient_id, supplier_id, at) {
      for (const [id, o] of offers) {
        if (o.ingredient_id === ingredient_id && o.supplier_id === supplier_id && o.effective_until === null) {
          offers.set(id, { ...o, effective_until: at });
        }
      }
    },
    async historyForIngredient(ingredient_id) {
      return [...offers.values()].filter((o) => o.ingredient_id === ingredient_id);
    },
  };

  return { repo, offerRepo, offers };
}

describe('SuppliersService — CRUD (§6.2 AC-1)', () => {
  it('creates + reads + updates a supplier', async () => {
    const { repo, offerRepo } = inMemoryRepos();
    const svc = new SuppliersService({ repo, offers: offerRepo });
    const s = await svc.create(RID, {
      name: 'US Foods', contact_name: 'Rep', email: 'rep@us.com', phone: '555-0100',
      lead_time_days: 2, min_order_cents: 10000, order_cadence: 'weekly',
    });
    expect(s.lead_time_days).toBe(2);
    const updated = await svc.update(RID, s.id, { lead_time_days: 3 });
    expect(updated.lead_time_days).toBe(3);
  });

  it('rejects duplicate names within a restaurant', async () => {
    const { repo, offerRepo } = inMemoryRepos();
    const svc = new SuppliersService({ repo, offers: offerRepo });
    await svc.create(RID, { name: 'Sysco' });
    await expect(svc.create(RID, { name: 'sysco' })).rejects.toThrow(/already exists/i);
  });

  it('deactivate instead of hard-delete', async () => {
    const { repo, offerRepo } = inMemoryRepos();
    const svc = new SuppliersService({ repo, offers: offerRepo });
    const s = await svc.create(RID, { name: 'Baldor' });
    await svc.deactivate(RID, s.id);
    const list = await svc.list(RID);
    expect(list).toHaveLength(0);
    const listWithInactive = await svc.list(RID, { includeInactive: true });
    expect(listWithInactive).toHaveLength(1);
  });
});

describe('SuppliersService — ranked offers (§6.2 AC-3)', () => {
  let svc: SuppliersService;
  let ingId: string;
  let s1: SupplierRow;
  let s2: SupplierRow;
  let offers: ReturnType<typeof inMemoryRepos>['offers'];

  beforeEach(async () => {
    const h = inMemoryRepos();
    offers = h.offers;
    svc = new SuppliersService({ repo: h.repo, offers: h.offerRepo });
    ingId = 'ing-1';
    s1 = await svc.create(RID, { name: 'S1' });
    s2 = await svc.create(RID, { name: 'S2' });
  });

  it('upserts an offer with a rank', async () => {
    await svc.upsertOffer(RID, { supplier_id: s1.id, ingredient_id: ingId, unit_cost_cents: 900, rank: 1 });
    await svc.upsertOffer(RID, { supplier_id: s2.id, ingredient_id: ingId, unit_cost_cents: 1000, rank: 2 });
    const ranked = await svc.rankedOffersForIngredient(ingId);
    expect(ranked.map((o) => o.supplier_id)).toEqual([s1.id, s2.id]);
  });

  it('reranking preserves history (no rows deleted, rank on new active row)', async () => {
    await svc.upsertOffer(RID, { supplier_id: s1.id, ingredient_id: ingId, unit_cost_cents: 900, rank: 1 });
    await svc.upsertOffer(RID, { supplier_id: s2.id, ingredient_id: ingId, unit_cost_cents: 1000, rank: 2 });
    await svc.reorderOffers(RID, ingId, [s2.id, s1.id]);
    const ranked = await svc.rankedOffersForIngredient(ingId);
    expect(ranked.map((o) => o.supplier_id)).toEqual([s2.id, s1.id]);
    // both inserts and the re-rank writes are persisted — historyForIngredient
    // returns all rows ever written.
    expect([...offers.values()].length).toBeGreaterThanOrEqual(4);
  });

  it('price changes close the current offer and open a new one', async () => {
    await svc.upsertOffer(RID, { supplier_id: s1.id, ingredient_id: ingId, unit_cost_cents: 900, rank: 1 });
    await svc.upsertOffer(RID, { supplier_id: s1.id, ingredient_id: ingId, unit_cost_cents: 950, rank: 1 });
    const ranked = await svc.rankedOffersForIngredient(ingId);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]!.unit_cost_cents).toBe(950);
  });
});

describe('priceCreep (§6.2 AC-5)', () => {
  it('flags ingredients where cost rose beyond the threshold in the window', () => {
    const now = new Date('2026-04-19T00:00:00Z');
    const windowDays = 30;
    const offers: SupplierOfferRow[] = [
      // Rose 20% in window — flagged (threshold 10%)
      { id: 'a1', supplier_id: 's', ingredient_id: 'ing-1', supplier_pack_size: null,
        unit_cost_cents: 100, rank: 1, effective_from: new Date('2026-04-10'), effective_until: new Date('2026-04-15'), created_at: new Date() },
      { id: 'a2', supplier_id: 's', ingredient_id: 'ing-1', supplier_pack_size: null,
        unit_cost_cents: 120, rank: 1, effective_from: new Date('2026-04-15'), effective_until: null, created_at: new Date() },
      // Rose 5% — not flagged
      { id: 'b1', supplier_id: 's', ingredient_id: 'ing-2', supplier_pack_size: null,
        unit_cost_cents: 200, rank: 1, effective_from: new Date('2026-04-10'), effective_until: new Date('2026-04-15'), created_at: new Date() },
      { id: 'b2', supplier_id: 's', ingredient_id: 'ing-2', supplier_pack_size: null,
        unit_cost_cents: 210, rank: 1, effective_from: new Date('2026-04-15'), effective_until: null, created_at: new Date() },
      // Outside the window
      { id: 'c1', supplier_id: 's', ingredient_id: 'ing-3', supplier_pack_size: null,
        unit_cost_cents: 100, rank: 1, effective_from: new Date('2025-01-01'), effective_until: new Date('2025-02-01'), created_at: new Date() },
      { id: 'c2', supplier_id: 's', ingredient_id: 'ing-3', supplier_pack_size: null,
        unit_cost_cents: 200, rank: 1, effective_from: new Date('2025-02-01'), effective_until: null, created_at: new Date() },
    ];

    const report = priceCreep(offers, { windowDays, thresholdPct: 10, now });
    const ids = report.map((r) => r.ingredient_id).sort();
    expect(ids).toEqual(['ing-1']);
    expect(report[0]!.pct_change).toBeCloseTo(20, 1);
  });
});
