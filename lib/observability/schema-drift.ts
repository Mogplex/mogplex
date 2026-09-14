import * as Sentry from "@sentry/nextjs";
import { isSchemaDriftError, SCHEMA_DRIFT_CODE } from "@/lib/schema-drift";

export type SchemaDriftOperation = { operation: string; target: string };
type WorkerContext = {
  release?: string;
  workerVersion?: string;
  taskId: string;
  runId: string;
  environment: string;
};

export function withSchemaDriftContext<T>(
  context: WorkerContext,
  callback: () => T
): T {
  return Sentry.withIsolationScope((scope) => {
    scope.setContext("schema_drift_worker", context);
    return callback();
  });
}

export async function reportSchemaDrift(
  error: unknown,
  operation: SchemaDriftOperation
): Promise<void> {
  if (!isSchemaDriftError(error)) return;
  const worker = Sentry.getIsolationScope().getScopeData().contexts
    .schema_drift_worker as WorkerContext | undefined;
  const code =
    typeof error === "object" &&
    error &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : SCHEMA_DRIFT_CODE;
  // Synced Vercel environment values can describe a different worker release.
  const release = worker
    ? (worker.release ?? `trigger:${worker.workerVersion ?? "unknown"}`)
    : process.env.TRIGGER_EXTERNAL_DEPLOYMENT_ID ||
      process.env.VERCEL_GIT_COMMIT_SHA ||
      process.env.SENTRY_RELEASE;
  const tags = {
    failure_kind: "schema_drift",
    schema_code: code,
    operation: operation.operation,
    db_target: operation.target,
    execution_runtime: worker ? "trigger" : "web",
    ...(worker?.workerVersion ? { worker_version: worker.workerVersion } : {}),
    ...(worker ? { task_id: worker.taskId } : {}),
  };
  const event: Sentry.Event = {
    message: "Database schema contract mismatch",
    level: "error",
    release,
    environment:
      worker?.environment ??
      process.env.SENTRY_ENVIRONMENT ??
      process.env.VERCEL_ENV ??
      process.env.NODE_ENV,
    tags,
    fingerprint: [
      "schema-drift",
      tags.execution_runtime,
      code,
      operation.operation,
      operation.target,
    ],
    contexts: {
      schema_drift: {
        ...tags,
        ...(worker ? { run_id: worker.runId } : {}),
        release,
      },
    },
  };
  // Do not send SQL, parameters, task payloads, or ambient request breadcrumbs.
  console.error(
    "[schema-drift] Database contract mismatch",
    event.contexts?.schema_drift
  );
  try {
    Sentry.withScope((scope) => {
      scope.addEventProcessor((processed) => ({
        ...event,
        event_id: processed.event_id,
        timestamp: processed.timestamp,
        platform: "node",
      }));
      Sentry.captureEvent(event);
    });
    // Await delivery on this failure path before a serverless request/task ends.
    // A telemetry outage must never replace the original safe failure.
    await Sentry.flush(2_000);
  } catch {
    console.error("[schema-drift] Could not deliver diagnostic event");
  }
}
