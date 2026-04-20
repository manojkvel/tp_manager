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
import { prismaSupplierRepo, prismaSupplierOfferRepo } from './suppliers/prisma-repos.js';
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
import { InventoryService } from './inventory/service.js';
import { prismaInventoryCountRepo } from './inventory/prisma-repos.js';
import { registerInventoryRoutes } from './inventory/routes.js';
import { DeliveriesService } from './deliveries/service.js';
import { prismaDeliveryRepo, prismaDeliveryCostRepo } from './deliveries/prisma-repos.js';
import { registerDeliveryRoutes } from './deliveries/routes.js';
import { OrdersService } from './orders/service.js';
import { prismaOrderRepo, prismaSuggestionSource } from './orders/prisma-repos.js';
import { registerOrderRoutes } from './orders/routes.js';
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

  const ordersService = new OrdersService({
    orders: prismaOrderRepo(prisma),
    source: prismaSuggestionSource(prisma),
  });
  await registerOrderRoutes(app, ordersService);

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
