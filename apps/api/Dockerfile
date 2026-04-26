# syntax=docker/dockerfile:1.7
# Multi-stage Dockerfile for @tp/api (AD-10)

FROM node:20.11.1-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /repo

# ---- deps stage: install workspace deps with frozen lockfile ----
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml* package.json ./
COPY apps/api/package.json apps/api/
COPY packages/types/package.json packages/types/
COPY packages/conversions/package.json packages/conversions/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @tp/api... --filter @tp/types --filter @tp/conversions

# ---- build stage: compile TS ----
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/types packages/types
COPY packages/conversions packages/conversions
COPY apps/api apps/api
RUN pnpm --filter @tp/api exec prisma generate \
 && pnpm --filter @tp/types build \
 && pnpm --filter @tp/conversions build \
 && pnpm --filter @tp/api build

# ---- runner stage: minimal image, non-root ----
FROM node:20.11.1-alpine AS runner
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate \
 && addgroup -S app && adduser -S app -G app
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3001 \
    HOST=0.0.0.0

COPY --from=build --chown=app:app /repo/package.json /repo/pnpm-workspace.yaml /repo/pnpm-lock.yaml* ./
COPY --from=build --chown=app:app /repo/apps/api/package.json ./apps/api/
COPY --from=build --chown=app:app /repo/apps/api/dist ./apps/api/dist
COPY --from=build --chown=app:app /repo/apps/api/prisma ./apps/api/prisma
COPY --from=build --chown=app:app /repo/packages/types/package.json ./packages/types/
COPY --from=build --chown=app:app /repo/packages/types/dist ./packages/types/dist
COPY --from=build --chown=app:app /repo/packages/conversions/package.json ./packages/conversions/
COPY --from=build --chown=app:app /repo/packages/conversions/dist ./packages/conversions/dist

RUN pnpm install --prod --frozen-lockfile --filter @tp/api... \
 && pnpm --filter @tp/api exec prisma generate

USER app
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/healthz || exit 1

CMD ["node", "apps/api/dist/main.js"]
