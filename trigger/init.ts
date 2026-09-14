import {
  tasks,
  type AnyOnStartAttemptHookFunction,
  type AnyOnCatchErrorHookFunction,
  type AnyOnMiddlewareHookFunction,
} from "@trigger.dev/sdk/v3";
import * as Sentry from "@sentry/nextjs";
import { isSchemaDriftError } from "@/lib/schema-drift";
import {
  reportSchemaDrift,
  withSchemaDriftContext,
} from "@/lib/observability/schema-drift";

export const schemaDriftTelemetry: AnyOnMiddlewareHookFunction = async ({
  ctx,
  next,
}) => {
  const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (dsn && !Sentry.getClient()) {
    Sentry.init({ dsn, defaultIntegrations: false, sendDefaultPii: false });
  }
  await withSchemaDriftContext(
    {
      release: ctx.deployment?.git?.commitSha,
      workerVersion: ctx.deployment?.version ?? ctx.run.version,
      taskId: ctx.task.id,
      runId: ctx.run.id,
      environment: ctx.environment.type.toLowerCase(),
    },
    next
  );
};

export const pinWorkerVersion: AnyOnStartAttemptHookFunction = ({ ctx }) => {
  // triggerAndWait already locks children; fire-and-forget calls do not.
  // App pins copied by Vercel env sync must never select a different worker.
  delete process.env.TRIGGER_EXTERNAL_DEPLOYMENT_ID;
  process.env.TRIGGER_AUTOMATIC_SKEW_VERSION_PROTECTION = "0";
  if (ctx.environment.type === "DEVELOPMENT") {
    delete process.env.TRIGGER_VERSION;
  } else {
    const version = ctx.deployment?.version ?? ctx.run.version;
    if (!version)
      throw new Error("Cannot pin child tasks without the worker version");
    process.env.TRIGGER_VERSION = version;
  }
};

export const stopSchemaDriftRetries: AnyOnCatchErrorHookFunction = async ({
  error,
  ctx,
}) => {
  // Repeating a whole task can duplicate earlier side effects. Repair the
  // schema before explicitly retrying instead of replaying the same failure.
  if (isSchemaDriftError(error)) {
    await reportSchemaDrift(error, { operation: "task", target: ctx.task.id });
    return { skipRetrying: true };
  }
};

tasks.middleware("schema-drift-telemetry", schemaDriftTelemetry);
tasks.onStartAttempt("pin-worker-version", pinWorkerVersion);
tasks.catchError("schema-drift", stopSchemaDriftRetries);
