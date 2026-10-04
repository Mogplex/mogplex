type StartupPhase = "sentry_config_import" | "sentry_init";

// These application clocks exclude static SDK module loading. The config
// import includes init; compare them with provider startup, never add them.
export function startServerStartupTiming(phase: StartupPhase): () => void {
  if (process.env.VERCEL_ENV !== "production") return () => {};

  const startedAt = performance.now();
  return () => {
    try {
      console.info(
        JSON.stringify({
          event: "mogplex.server_startup",
          phase,
          durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
          release: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
        })
      );
    } catch {
      // Observability must not turn a successful initialization into a failure.
    }
  };
}
