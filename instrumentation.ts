import * as Sentry from "@sentry/nextjs";
import { startServerStartupTiming } from "@/lib/observability/server-startup-timing";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const finishSentryImport = startServerStartupTiming("sentry_config_import");
    try {
      await import("./sentry.server.config");
    } finally {
      finishSentryImport();
    }

    if (
      process.env.SANDBOX_DISABLE_USER_BILLING &&
      !process.env.NEXT_PUBLIC_SANDBOX_DISABLE_USER_BILLING
    ) {
      throw new Error(
        "[sandbox-billing] SANDBOX_DISABLE_USER_BILLING is set but has been renamed to NEXT_PUBLIC_SANDBOX_DISABLE_USER_BILLING — kill-switch is inactive. Fix your env before deploying."
      );
    }
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
