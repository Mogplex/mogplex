import * as Sentry from "@sentry/nextjs";
import {
  beforeSendServerEvent,
  SENTRY_SERVER_IGNORE_SPANS,
} from "@/lib/observability/sentry-server-filters";

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment:
      process.env.SENTRY_ENVIRONMENT ??
      process.env.VERCEL_ENV ??
      process.env.NODE_ENV,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    ignoreSpans: [...SENTRY_SERVER_IGNORE_SPANS],
    beforeSend: beforeSendServerEvent,
    debug: false,
    sendDefaultPii: false,
  });
}
