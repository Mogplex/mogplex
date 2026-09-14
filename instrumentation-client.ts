import * as Sentry from "@sentry/nextjs";
import { SENTRY_DENY_URLS } from "@/lib/observability/sentry-deny-urls";
import {
  clientDeploymentId,
  createDeploymentFetch,
} from "@/lib/deployment-fetch";
import { setDeploymentFailure } from "@/lib/deployment-failure-store";

// Runs before hydration, including SDK transports and direct component fetches.
window.fetch = createDeploymentFetch(window.fetch.bind(window), {
  origin: window.location.origin,
  deploymentId: clientDeploymentId,
  onSchemaDrift: () => setDeploymentFailure(true),
});

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment:
      process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ??
      process.env.NEXT_PUBLIC_VERCEL_ENV ??
      process.env.NODE_ENV,
    tracesSampleRate: Number(
      process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? 0.1
    ),
    replaysSessionSampleRate: Number(
      process.env.NEXT_PUBLIC_SENTRY_REPLAYS_SESSION_SAMPLE_RATE ?? 0
    ),
    replaysOnErrorSampleRate: Number(
      process.env.NEXT_PUBLIC_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE ?? 1
    ),
    integrations: [Sentry.replayIntegration()],
    denyUrls: [...SENTRY_DENY_URLS],
    debug: false,
    sendDefaultPii: false,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
