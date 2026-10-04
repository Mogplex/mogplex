import * as Sentry from "@sentry/nextjs";
import { startServerStartupTiming } from "@/lib/observability/server-startup-timing";
import { createControlStartupTraceSampler } from "@/lib/observability/control-startup-trace-sampler";
import {
  beforeSendServerEvent,
  SENTRY_SERVER_IGNORE_SPANS,
} from "@/lib/observability/sentry-server-filters";

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
const tracesSampleRate = Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1);

if (dsn) {
  const finishSentryInit = startServerStartupTiming("sentry_init");
  try {
    Sentry.init({
      dsn,
      environment:
        process.env.SENTRY_ENVIRONMENT ??
        process.env.VERCEL_ENV ??
        process.env.NODE_ENV,
      tracesSampleRate,
      tracesSampler:
        process.env.VERCEL_ENV === "production"
          ? createControlStartupTraceSampler(tracesSampleRate)
          : undefined,
      ignoreSpans: [...SENTRY_SERVER_IGNORE_SPANS],
      beforeSend: beforeSendServerEvent,
      debug: false,
      sendDefaultPii: false,
    });
  } finally {
    finishSentryInit();
  }
}
