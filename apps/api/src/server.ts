import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { PrismaClient } from '@prisma/client';
import { correlationIdPlugin } from './observability/correlation-id.js';
import { healthRoutes } from './routes/health.js';
import { authPlugin } from './auth/plugin.js';
import { AuthService } from './auth/service.js';
import { prismaUserRepo, prismaRefreshTokenRepo } from './auth/prisma-repos.js';
import { registerAuthRoutes } from './auth/routes.js';
import { registerLoginRateLimit } from './auth/rate-limit.js';
import { IngredientsService } from './ingredients/service.js';
import {
  prismaIngredientRepo,
  prismaIngredientCostRepo,
  prismaRecipeLineRef,
} from './ingredients/prisma-repos.js';
import { registerIngredientRoutes } from './ingredients/routes.js';
import { SuppliersService } from './suppliers/service.js';
import { prismaSupplierRepo, prismaSupplierOfferRepo, prismaSupplierKpiSource } from './suppliers/prisma-repos.js';
import { registerSupplierRoutes } from './suppliers/routes.js';
import {
  LocationsService, UtensilsService, WasteReasonsService, StationsService, ParLevelsService,
} from './settings/service.js';
import {
  prismaLocationRepo, prismaUtensilRepo, prismaEquivalenceRepo,
  prismaWasteReasonRepo, prismaStationRepo, prismaParLevelRepo,
} from './settings/prisma-repos.js';
import { registerSettingsRoutes } from './settings/routes.js';
import { RecipesService } from './recipes/service.js';
import { prismaRecipeRepo, prismaRecipeVersionRepo, prismaCostContext } from './recipes/prisma-repos.js';
import { registerRecipeRoutes } from './recipes/routes.js';
import { PrepService } from './prep/service.js';
import { prismaPrepSheetRepo, prismaPrepRunRepo, prismaParRepo } from './prep/prisma-repos.js';
import { registerPrepRoutes } from './prep/routes.js';
import { registerPrepThroughputRoute } from './prep/throughput.js';
import { registerPrepItemRoutes } from './prep/items-routes.js';
import { InventoryService } from './inventory/service.js';
import { prismaInventoryCountRepo } from './inventory/prisma-repos.js';
import { registerInventoryRoutes } from './inventory/routes.js';
import { DeliveriesService } from './deliveries/service.js';
import { prismaDeliveryRepo, prismaDeliveryCostRepo } from './deliveries/prisma-repos.js';
import { registerDeliveryRoutes } from './deliveries/routes.js';
import { registerInternalDeliveryRoutes, prismaOcrQueueSource } from './deliveries/internal-routes.js';
import { OrdersService } from './orders/service.js';
import { prismaOrderRepo, prismaSuggestionSource } from './orders/prisma-repos.js';
import { registerOrderRoutes } from './orders/routes.js';
import { resolveEmailTransport } from './orders/email.js';
import { WasteService } from './waste/service.js';
import { prismaWasteRepo, prismaCostLookup, prismaExpiredSource } from './waste/prisma-repos.js';
import { registerWasteRoutes } from './waste/routes.js';
import { MigrationReviewService } from './migration/review.js';
import { prismaReviewBatchRepo, prismaCanonicalSource, prismaPromotionWriter } from './migration/review-prisma-repos.js';
import { registerMigrationReviewRoutes } from './migration/review-routes.js';
import { AlohaService } from './aloha/service.js';
import { prismaAlohaRepo } from './aloha/prisma-repos.js';
import { registerAlohaRoutes, prismaAlohaMappingRepo } from './aloha/routes.js';
import { ReportsService } from './reports/service.js';
import { prismaReportsRepo } from './reports/prisma-repos.js';
import { registerReportsRoutes } from './reports/routes.js';
import { createForecastClient } from './forecast-proxy/client.js';
import { registerForecastRoutes, prismaAccuracyRepo } from './forecast-proxy/routes.js';
import { OverrideService, prismaOverrideRepo, type PrismaOverrideClient } from './forecast-proxy/override.js';
import { UserAdminService } from './users/service.js';
import { prismaUserAdminRepo } from './users/prisma-repo.js';
import { registerUserAdminRoutes } from './users/routes.js';

export interface BuildServerOpts {
  prisma?: PrismaClient;
}

export async function buildServer(opts: BuildServerOpts = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
    disableRequestLogging: false,
    trustProxy: true,
  });

  const jwtSecret = process.env['JWT_ACCESS_SECRET'];
  if (!jwtSecret || jwtSecret.length < 32) {
    throw new Error('JWT_ACCESS_SECRET is required and must be at least 32 characters');
  }
  const accessTtl = Number(process.env['JWT_ACCESS_TTL_SEC'] ?? 900);
  const refreshTtl = Number(process.env['JWT_REFRESH_TTL_SEC'] ?? 2592000);

  await app.register(cookie, { secret: process.env['COOKIE_SECRET'] ?? jwtSecret });
  await app.register(correlationIdPlugin);
  await app.register(authPlugin, { jwtSecret });
  await registerLoginRateLimit(app, { maxPerMinute: 5 });
  await app.register(healthRoutes);

  const prisma = opts.prisma ?? new PrismaClient();
  const authService = new AuthService({
    users: prismaUserRepo(prisma),
    refreshTokens: prismaRefreshTokenRepo(prisma),
    jwtSecret,
    accessTokenTtlSeconds: accessTtl,
    refreshTokenTtlSeconds: refreshTtl,
  });
  await registerAuthRoutes(app, { service: authService });

  const userAdminService = new UserAdminService({
    users: prismaUserAdminRepo(prisma),
    refreshTokens: prismaRefreshTokenRepo(prisma),
  });
  await registerUserAdminRoutes(app, userAdminService);

  const ingredientsService = new IngredientsService({
    repo: prismaIngredientRepo(prisma),
    costs: prismaIngredientCostRepo(prisma),
    refs: prismaRecipeLineRef(prisma),
  });
  await registerIngredientRoutes(app, ingredientsService);

  const supplierOffers = prismaSupplierOfferRepo(prisma);
  const suppliersService = new SuppliersService({
    repo: prismaSupplierRepo(prisma),
    offers: supplierOffers,
  });
  await registerSupplierRoutes(app, {
    service: suppliersService,
    historyForIngredient: (ingredient_id) => supplierOffers.historyForIngredient(ingredient_id),
    kpiSource: prismaSupplierKpiSource(prisma),
  });

  await registerSettingsRoutes(app, {
    locations: new LocationsService(prismaLocationRepo(prisma)),
    utensils: new UtensilsService(prismaUtensilRepo(prisma), prismaEquivalenceRepo(prisma)),
    wasteReasons: new WasteReasonsService(prismaWasteReasonRepo(prisma)),
    stations: new StationsService(prismaStationRepo(prisma)),
    parLevels: new ParLevelsService(prismaParLevelRepo(prisma)),
  });

  const recipesService = new RecipesService({
    recipes: prismaRecipeRepo(prisma),
    versions: prismaRecipeVersionRepo(prisma),
    costs: prismaCostContext(prisma),
  });
  await registerRecipeRoutes(app, recipesService, {
    labels: async (restaurant_id, { ingredient_ids, recipe_ids }) => {
      const out: Record<string, string> = {};
      if (ingredient_ids.length) {
        const rows = await prisma.ingredient.findMany({
          where: { restaurant_id, id: { in: ingredient_ids } },
          select: { id: true, name: true },
        });
        for (const r of rows) out[r.id] = r.name;
      }
      if (recipe_ids.length) {
        const rows = await prisma.recipe.findMany({
          where: { restaurant_id, id: { in: recipe_ids } },
          select: { id: true, name: true },
        });
        for (const r of rows) out[r.id] = r.name;
      }
      return out;
    },
  });

  const prepService = new PrepService({
    sheets: prismaPrepSheetRepo(prisma),
    runs: prismaPrepRunRepo(prisma),
    pars: prismaParRepo(prisma),
  });
  await registerPrepRoutes(app, prepService);
  await registerPrepThroughputRoute(app, prisma);
  await registerPrepItemRoutes(app, prisma);

  const inventoryService = new InventoryService({
    counts: prismaInventoryCountRepo(prisma),
  });
  await registerInventoryRoutes(app, inventoryService, {
    async inventoryKpi(restaurant_id) {
      const items_tracked = await prisma.ingredient.count({
        where: { restaurant_id, is_archived: false },
      });
      // Take lines from the most-recent *completed* count (immutable snapshot).
      const latest = await prisma.inventoryCount.findFirst({
        where: { restaurant_id, status: 'completed' },
        orderBy: { date: 'desc' },
        select: { id: true },
      });
      if (!latest) return { value_cents: 0, items_tracked };
      // eslint-disable-next-line @tp/tp/require-restaurant-id -- scoped via count_id from owned count
      const lines = await prisma.inventoryCountLine.findMany({
        where: { count_id: latest.id },
        select: { ingredient_id: true, actual_qty: true, unit_cost_cents: true },
      });
      let value_cents = 0;
      for (const l of lines) {
        if (l.unit_cost_cents != null) {
          value_cents += Math.round(Number(l.actual_qty) * l.unit_cost_cents);
          continue;
        }
        if (!l.ingredient_id) continue;
        // eslint-disable-next-line @tp/tp/require-restaurant-id -- scoped via ingredient_id FK already owned
        const cost = await prisma.ingredientCost.findFirst({
          where: { ingredient_id: l.ingredient_id },
          orderBy: { effective_from: 'desc' },
          select: { unit_cost_cents: true },
        });
        if (cost) value_cents += Math.round(Number(l.actual_qty) * cost.unit_cost_cents);
      }
      return { value_cents, items_tracked };
    },
  });

  const deliveriesService = new DeliveriesService({
    deliveries: prismaDeliveryRepo(prisma),
    costs: prismaDeliveryCostRepo(prisma),
  });
  await registerDeliveryRoutes(app, deliveriesService);
  await registerInternalDeliveryRoutes(
    app,
    deliveriesService,
    prismaOcrQueueSource(prisma),
    process.env.WORKER_API_TOKEN ?? process.env.SERVICE_TOKEN,
  );

  const ordersService = new OrdersService({
    orders: prismaOrderRepo(prisma),
    source: prismaSuggestionSource(prisma),
  });
  const emailTransport = await resolveEmailTransport();
  await registerOrderRoutes(app, ordersService, {
    transport: emailTransport,
    fromAddress: process.env.EMAIL_FROM ?? 'orders@tp-manager.local',
    lookup: {
      async getSupplier(restaurant_id, supplier_id) {
        // eslint-disable-next-line @tp/tp/require-restaurant-id -- scoped by FK + rid check below
        const s = await prisma.supplier.findUnique({ where: { id: supplier_id } });
        if (!s || s.restaurant_id !== restaurant_id) return null;
        return { id: s.id, name: s.name, email: s.email, contact_name: s.contact_name };
      },
      async getRestaurant(restaurant_id) {
        const r = await prisma.restaurant.findUnique({ where: { id: restaurant_id } });
        if (!r) return null;
        const owner = await prisma.user.findFirst({
          where: { restaurant_id, role: 'owner' },
          select: { email: true },
        });
        return { name: r.name, owner_email: owner?.email ?? null };
      },
      async decorateLines(rawLines) {
        const ids = rawLines.map((l) => l.ingredient_id);
        // eslint-disable-next-line @tp/tp/require-restaurant-id -- scoped by ingredient_id set already owned via order linage
        const ings = await prisma.ingredient.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true, uom: true },
        });
        const byId = new Map(ings.map((i) => [i.id, i]));
        return rawLines.map((l) => ({
          ...l,
          ingredient_name: byId.get(l.ingredient_id)?.name,
          uom: byId.get(l.ingredient_id)?.uom ?? null,
        }));
      },
    },
  });

  const wasteService = new WasteService({
    repo: prismaWasteRepo(prisma),
    costs: prismaCostLookup(prisma),
    expired: prismaExpiredSource(prisma),
  });
  await registerWasteRoutes(app, wasteService);

  const reviewService = new MigrationReviewService({
    repo: prismaReviewBatchRepo(prisma),
    canonical: prismaCanonicalSource(prisma),
    writer: prismaPromotionWriter(prisma),
  });
  await registerMigrationReviewRoutes(app, reviewService);

  const alohaService = new AlohaService({ repo: prismaAlohaRepo(prisma) });
  await registerAlohaRoutes(app, alohaService, prismaAlohaMappingRepo(prisma));

  const reportsService = new ReportsService({ repo: prismaReportsRepo(prisma) });
  await registerReportsRoutes(app, reportsService, {
    countIngredientsNeedingSupplier: (rid) => prisma.ingredient.count({
      where: { restaurant_id: rid, is_archived: false, default_supplier_id: null },
    }),
    countDisputedDeliveries: (rid) => prisma.delivery.count({
      where: { restaurant_id: rid, status: 'disputed' },
    }),
    recentActivity: async (rid, limit) => {
      const [deliveries, wastes, counts, orders, preps] = await Promise.all([
        prisma.delivery.findMany({
          where: { restaurant_id: rid },
          orderBy: { received_on: 'desc' },
          take: limit,
          include: { supplier: { select: { name: true } } },
        }),
        prisma.wasteEntry.findMany({
          where: { restaurant_id: rid },
          orderBy: { at: 'desc' },
          take: limit,
        }),
        prisma.inventoryCount.findMany({
          where: { restaurant_id: rid, status: 'completed' },
          orderBy: { created_at: 'desc' },
          take: limit,
          select: { id: true, created_at: true, date: true },
        }),
        prisma.order.findMany({
          where: { restaurant_id: rid },
          orderBy: { created_at: 'desc' },
          take: limit,
          include: { supplier: { select: { name: true } } },
        }),
        prisma.prepSheetRow.findMany({
          where: { prep_sheet: { restaurant_id: rid }, completed_at: { not: null } },
          orderBy: { completed_at: 'desc' },
          take: limit,
          include: { recipe_version: { include: { recipe: { select: { name: true } } } } },
        }),
      ]);

      const wasteIngredientIds = wastes.map((w) => w.ingredient_id).filter((x): x is string => !!x);
      const ingredientNames = wasteIngredientIds.length
        ? new Map(
            (await prisma.ingredient.findMany({
              where: { id: { in: wasteIngredientIds } },
              select: { id: true, name: true },
            })).map((i) => [i.id, i.name]),
          )
        : new Map<string, string>();

      const items = [
        ...deliveries.map((d) => ({
          id: `delivery:${d.id}`,
          at: d.received_on ?? d.created_at,
          kind: 'delivery' as const,
          label: `Delivery from ${d.supplier?.name ?? 'supplier'}`,
          hint: d.status,
        })),
        ...wastes.map((w) => ({
          id: `waste:${w.id}`,
          at: w.at,
          kind: 'waste' as const,
          label: `Waste logged — ${w.ingredient_id ? ingredientNames.get(w.ingredient_id) ?? 'item' : 'item'}`,
          hint: `${Number(w.qty)} ${w.uom}`,
        })),
        ...counts.map((c) => ({
          id: `count:${c.id}`,
          at: c.created_at,
          kind: 'count' as const,
          label: 'Inventory count completed',
          hint: c.date.toISOString().slice(0, 10),
        })),
        ...orders.map((o) => ({
          id: `order:${o.id}`,
          at: o.created_at,
          kind: 'order' as const,
          label: `Order — ${o.supplier?.name ?? 'supplier'}`,
          hint: o.status,
        })),
        ...preps.map((p) => ({
          id: `prep:${p.id}`,
          at: p.completed_at ?? p.started_at ?? new Date(0),
          kind: 'prep' as const,
          label: `Prep complete — ${p.recipe_version?.recipe?.name ?? 'item'}`,
        })),
      ];
      return items
        .sort((a, b) => b.at.getTime() - a.at.getTime())
        .slice(0, limit);
    },
    deliverySchedule: async (rid, now) => {
      const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const todayEnd = new Date(todayStart.getTime() + 86_400_000);
      const localNow = now;
      const todayDow = localNow.getDay();
      const tomorrowDow = (todayDow + 1) % 7;

      const [deliveries, suppliers] = await Promise.all([
        prisma.delivery.findMany({
          where: {
            restaurant_id: rid,
            received_on: { gte: todayStart, lt: todayEnd },
          },
          include: { supplier: { select: { id: true, name: true } } },
          orderBy: { received_on: 'asc' },
        }),
        prisma.supplier.findMany({
          where: { restaurant_id: rid, status: 'active', cutoff_time: { not: null } },
          select: { id: true, name: true, delivery_days: true, cutoff_time: true },
        }),
      ]);

      const deliveries_today = deliveries.map((d) => ({
        delivery_id: d.id,
        supplier_id: d.supplier_id,
        supplier_name: d.supplier?.name ?? 'supplier',
        status: d.status as 'pending' | 'verified' | 'disputed',
        received_on: d.received_on.toISOString().slice(0, 10),
        discrepancy_count: d.discrepancy_count,
      }));

      const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const cutoffs_today = suppliers
        .filter((s) => s.delivery_days.includes(tomorrowDow) && s.cutoff_time)
        .map((s) => {
          const [hh, mm] = (s.cutoff_time ?? '00:00').split(':').map((n) => Number(n));
          const cutoff = new Date(localNow);
          cutoff.setHours(hh ?? 0, mm ?? 0, 0, 0);
          const diffMs = cutoff.getTime() - localNow.getTime();
          const minutes = Math.round(diffMs / 60_000);
          return {
            supplier_id: s.id,
            supplier_name: s.name,
            cutoff_time: s.cutoff_time ?? '',
            next_delivery_day: DAY_NAMES[tomorrowDow] ?? '',
            minutes_until_cutoff: minutes,
          };
        })
        .sort((a, b) => (a.minutes_until_cutoff ?? 0) - (b.minutes_until_cutoff ?? 0));

      return { deliveries_today, cutoffs_today };
    },
  }, {
    async listIngredientsByIds(rid, ids) {
      if (ids.length === 0) return [];
      const rows = await prisma.ingredient.findMany({
        where: { restaurant_id: rid, id: { in: ids } },
        select: { id: true, name: true, par_qty: true },
      });
      const costs = await prisma.ingredientCost.findMany({
        where: { ingredient_id: { in: ids } },
        orderBy: { effective_from: 'desc' },
        distinct: ['ingredient_id'],
        select: { ingredient_id: true, unit_cost_cents: true },
      });
      const costMap = new Map(costs.map((c) => [c.ingredient_id, c.unit_cost_cents]));
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        par_qty: r.par_qty ? Number(r.par_qty) : null,
        latest_unit_cost_cents: costMap.get(r.id) ?? null,
      }));
    },
  });

  const forecastClient = createForecastClient({ baseUrl: process.env.ML_SERVICE_URL ?? '' });
  const overrideService = new OverrideService({
    repo: prismaOverrideRepo(prisma as unknown as PrismaOverrideClient),
  });
  await registerForecastRoutes(
    app,
    forecastClient,
    prismaAccuracyRepo(prisma as unknown as {
      forecastModel: { findMany(args: unknown): Promise<Array<Record<string, unknown>>> };
    }),
    overrideService,
  );

  app.addHook('onClose', async () => {
    if (!opts.prisma) await prisma.$disconnect();
  });

  return app;
}
