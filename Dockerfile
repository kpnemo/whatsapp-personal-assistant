# syntax=docker/dockerfile:1.7
ARG NODE_VERSION=22.22.2
ARG PNPM_VERSION=9.12.3

FROM node:${NODE_VERSION}-alpine AS base
RUN apk add --no-cache openssl \
 && npm install -g corepack@latest \
 && corepack enable \
 && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY packages/api/package.json packages/api/
COPY packages/worker/package.json packages/worker/
COPY packages/agent/package.json packages/agent/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/web/package.json packages/web/
COPY website/package.json website/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @wpa/db exec prisma generate
RUN pnpm -r --filter "@wpa/*" --filter "!@wpa/test-utils" build
RUN pnpm --filter @wpa/web build

FROM node:${NODE_VERSION}-alpine AS runtime
RUN npm install -g corepack@latest \
 && corepack enable \
 && corepack prepare pnpm@${PNPM_VERSION} --activate \
 && apk add --no-cache supervisor tini curl openssl
WORKDIR /app
ENV NODE_ENV=production
ENV PNPM_HOME=/usr/local/share/pnpm
ENV PATH=$PNPM_HOME:$PATH

COPY --from=build /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./
COPY --from=build /app/packages ./packages
COPY --from=build /app/node_modules ./node_modules
COPY supervisord/supervisord.conf /etc/supervisord.conf
COPY scripts/entrypoint-migrate.sh /usr/local/bin/entrypoint-migrate.sh
RUN chmod +x /usr/local/bin/entrypoint-migrate.sh

RUN addgroup -S wpa && adduser -S wpa -G wpa \
 && chown -R wpa:wpa /app

USER wpa
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS http://localhost:3000/healthz || exit 1
ENV WEB_DIST=/app/packages/web/dist
ENV ENTRYPOINT_ROLE=all

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["/usr/local/bin/entrypoint-migrate.sh"]
