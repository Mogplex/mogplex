import {
  tasks,
  type AnyOnStartAttemptHookFunction,
  type AnyOnCatchErrorHookFunction,
} from "@trigger.dev/sdk/v3";
import { isSchemaDriftError } from "@/lib/schema-drift";

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

export const stopSchemaDriftRetries: AnyOnCatchErrorHookFunction = ({
  error,
}) => {
  // Repeating a whole task can duplicate earlier side effects. Repair the
  // schema before explicitly retrying instead of replaying the same failure.
  if (isSchemaDriftError(error)) return { skipRetrying: true };
};

tasks.onStartAttempt("pin-worker-version", pinWorkerVersion);
tasks.catchError("schema-drift", stopSchemaDriftRetries);
