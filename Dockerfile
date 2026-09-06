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

# Client-side settings are inlined at build time. Neon needs no Supabase
# credentials; legacy deployments must explicitly select their backend.
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_MOGPLEX_DATA_BACKEND=neon
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
# Optional client-side integrations.
ARG NEXT_PUBLIC_C15T_URL
ARG NEXT_PUBLIC_SENTRY_DSN
ARG NEXT_PUBLIC_VERCEL_APP_CLIENT_ID
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL} \
    MOGPLEX_DATA_BACKEND=${NEXT_PUBLIC_MOGPLEX_DATA_BACKEND} \
    NEXT_PUBLIC_MOGPLEX_DATA_BACKEND=${NEXT_PUBLIC_MOGPLEX_DATA_BACKEND} \
    NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL} \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY} \
    NEXT_PUBLIC_C15T_URL=${NEXT_PUBLIC_C15T_URL} \
    NEXT_PUBLIC_SENTRY_DSN=${NEXT_PUBLIC_SENTRY_DSN} \
    NEXT_PUBLIC_VERCEL_APP_CLIENT_ID=${NEXT_PUBLIC_VERCEL_APP_CLIENT_ID}

# Runtime secrets come from the environment, never build-time placeholders.
RUN pnpm build

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    MOGPLEX_DATA_BACKEND=neon \
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
