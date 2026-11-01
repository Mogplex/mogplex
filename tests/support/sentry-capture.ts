import * as Sentry from "@sentry/nextjs";

type Envelope = Parameters<
  NonNullable<
    ReturnType<NonNullable<ReturnType<typeof Sentry.getClient>>["getTransport"]>
  >["send"]
>[0];

/**
 * Initialise a real Sentry client whose transport keeps events in memory.
 * Runner-agnostic: call it from a vitest or node:test setup hook, clear
 * `events` between tests, and `Sentry.flush()` before asserting. Set
 * `failFlush` to simulate a telemetry outage.
 */
export function installInMemorySentry(): {
  events: Sentry.Event[];
  failFlush: boolean;
} {
  const capture = { events: [] as Sentry.Event[], failFlush: false };
  Sentry.init({
    dsn: "https://public@sentry.test/1",
    defaultIntegrations: false,
    transport: () => ({
      send: async (envelope: Envelope) => {
        for (const [header, payload] of envelope[1]) {
          if (header.type === "event") {
            capture.events.push(payload as Sentry.Event);
          }
        }
        return { statusCode: 200 };
      },
      flush: async () => {
        if (capture.failFlush) throw new Error("transport flush unavailable");
        return true;
      },
    }),
  });
  return capture;
}
