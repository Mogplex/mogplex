import * as Sentry from "@sentry/nextjs";

type Envelope = Parameters<
  NonNullable<
    ReturnType<NonNullable<ReturnType<typeof Sentry.getClient>>["getTransport"]>
  >["send"]
>[0];

/**
 * Initialise a real Sentry client whose transport keeps events in memory.
 * Runner-agnostic: call it from a vitest or node:test setup hook, clear
 * `events` between tests, and `Sentry.flush()` before asserting.
 */
export function installInMemorySentry(): { events: Sentry.Event[] } {
  const capture = { events: [] as Sentry.Event[] };
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
      flush: async () => true,
    }),
  });
  return capture;
}
