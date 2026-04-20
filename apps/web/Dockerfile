# syntax=docker/dockerfile:1.7
# Multi-stage Dockerfile for @tp/web (AD-10) — builds the Vite PWA and serves via nginx

FROM node:20.11.1-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /repo

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml* package.json ./
COPY apps/web/package.json apps/web/
COPY packages/types/package.json packages/types/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @tp/web... --filter @tp/types

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/types packages/types
COPY apps/web apps/web
RUN pnpm --filter @tp/types build \
 && pnpm --filter @tp/web build

FROM nginx:1.27-alpine AS runner
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["nginx", "-g", "daemon off;"]
