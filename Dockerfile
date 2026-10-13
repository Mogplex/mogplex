# syntax=docker/dockerfile:1

# Self-hosted Mogplex web app image.
#
# This image contains ONLY the Next.js application. Every backing service is
# bring-your-own and must be reachable from the container at runtime:
# database + auth, Trigger.dev, sandbox infrastructure, AI providers, email,
# GitHub App, and so on. Read docs/self-hosting.md before building — the
# hosted product at https://mogplex.com is the supported way to use Mogplex.
#
# The public app URL is read at runtime from APP_URL, so one image serves any
# domain. Other NEXT_PUBLIC_* variables (Sentry DSN, consent backend, Vercel
# sign-in client ID, legacy Supabase keys) are still inlined into the client
# bundle at BUILD time: pass them as --build-arg and rebuild when they change.

ARG NODE_VERSION=22.22.0

FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
ENV HUSKY=0 \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
# .pnpmfile.cjs is part of the frozen lockfile's checksum; without it the
# install refuses to run.
COPY package.json pnpm-lock.yaml .pnpmfile.cjs ./
RUN pnpm install --frozen-lockfile

# One-shot schema migrations, used by docker-compose's `migrate` service. It
# keeps the dev dependency (tsx) that the runner needs; the runtime image
# does not ship it.
FROM node:${NODE_VERSION}-bookworm-slim AS migrate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY scripts/apply-neon-migrations.ts ./scripts/
COPY lib/db ./lib/db
COPY neon ./neon
CMD ["node_modules/.bin/tsx", "scripts/apply-neon-migrations.ts"]

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

# Next's type-check pass needs more than Node's default heap (it runs out of
# memory near 2 GB). Docker Desktop's default 8 GB VM leaves room for 6 GB.
ENV NODE_OPTIONS=--max-old-space-size=6144

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
# The compose `cron` service runs this dependency-free scheduler from the same
# image; it reads the cron routes from vercel.json.
COPY --from=build --chown=nextjs:nextjs /app/vercel.json ./vercel.json
COPY --from=build --chown=nextjs:nextjs /app/scripts/self-host-cron.mjs ./scripts/self-host-cron.mjs

USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "server.js"]
