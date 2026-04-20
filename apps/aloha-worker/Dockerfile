# syntax=docker/dockerfile:1.7
# Multi-stage Dockerfile for @tp/aloha-worker (AD-10)

FROM node:20.11.1-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /repo

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml* package.json ./
COPY apps/aloha-worker/package.json apps/aloha-worker/
COPY packages/types/package.json packages/types/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @tp/aloha-worker... --filter @tp/types

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/types packages/types
COPY apps/aloha-worker apps/aloha-worker
RUN pnpm --filter @tp/types build \
 && pnpm --filter @tp/aloha-worker build

FROM node:20.11.1-alpine AS runner
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate \
 && addgroup -S app && adduser -S app -G app
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3002 \
    HOST=0.0.0.0

COPY --from=build --chown=app:app /repo/package.json /repo/pnpm-workspace.yaml /repo/pnpm-lock.yaml* ./
COPY --from=build --chown=app:app /repo/apps/aloha-worker/package.json ./apps/aloha-worker/
COPY --from=build --chown=app:app /repo/apps/aloha-worker/dist ./apps/aloha-worker/dist
COPY --from=build --chown=app:app /repo/packages/types/package.json ./packages/types/
COPY --from=build --chown=app:app /repo/packages/types/dist ./packages/types/dist

RUN pnpm install --prod --frozen-lockfile --filter @tp/aloha-worker...

USER app
EXPOSE 3002
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3002/healthz || exit 1

CMD ["node", "apps/aloha-worker/dist/main.js"]
