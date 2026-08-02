# syntax=docker/dockerfile:1

# Self-hosted Mogplex web app image.
#
# This image contains ONLY the Next.js application. Every backing service is
# bring-your-own and must be reachable from the container at runtime:
# database + auth, Trigger.dev, sandbox infrastructure, AI providers, email,
# GitHub App, and so on. Read docs/self-hosting.md before building — the
# hosted product at https://mogplex.com is the supported way to use Mogplex.
#
# NEXT_PUBLIC_* variables are inlined into the client bundle at BUILD time.
# You cannot inject them when the container starts; pass them as --build-arg
# and rebuild the image whenever they change.

ARG NODE_VERSION=22.22.0

FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
ENV HUSKY=0 \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app
ENV HUSKY=0 \
    NEXT_TELEMETRY_DISABLED=1 \
    NEXT_OUTPUT=standalone
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Client-side (inlined at build time). The placeholder defaults mirror
# .github/workflows/ci.yml so the image builds without args, but an image
# built with placeholders CANNOT talk to a real backend — pass your real
# values as --build-arg (docker-compose.yml requires them from .env).
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY=build-placeholder-anon-key
# Optional client-side integrations.
ARG NEXT_PUBLIC_C15T_URL
ARG NEXT_PUBLIC_SENTRY_DSN
ARG NEXT_PUBLIC_VERCEL_APP_CLIENT_ID
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL} \
    NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL} \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY} \
    NEXT_PUBLIC_C15T_URL=${NEXT_PUBLIC_C15T_URL} \
    NEXT_PUBLIC_SENTRY_DSN=${NEXT_PUBLIC_SENTRY_DSN} \
    NEXT_PUBLIC_VERCEL_APP_CLIENT_ID=${NEXT_PUBLIC_VERCEL_APP_CLIENT_ID}

# The service-role placeholder exists only for this command: module-load
# Supabase clients must construct during page-data collection (same as CI).
# The real value comes from your runtime env file, never the image.
RUN SUPABASE_SERVICE_ROLE_KEY=build-placeholder-service-role-key pnpm build

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN groupadd --system nextjs && useradd --system --gid nextjs nextjs

COPY --from=build --chown=nextjs:nextjs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nextjs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nextjs /app/public ./public

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
