import * as Sentry from "@sentry/nextjs";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from "vitest";
import { reportSchemaDrift, withSchemaDriftContext } from "./schema-drift";

let events: Sentry.Event[];
let failDelivery = false;
beforeEach(() => {
  events = [];
  failDelivery = false;
});
beforeAll(() => {
  Sentry.init({
    dsn: "https://public@sentry.test/1",
    defaultIntegrations: false,
    transport: () => ({
      send: async (
        envelope: Parameters<
          NonNullable<
            ReturnType<
              NonNullable<ReturnType<typeof Sentry.getClient>>["getTransport"]
            >
          >["send"]
        >[0]
      ) => {
        if (failDelivery) throw new Error("delivery unavailable");
        for (const [header, payload] of envelope[1]) {
          if (header.type === "event") events.push(payload as Sentry.Event);
        }
        return { statusCode: 200 };
      },
      flush: async () => true,
    }),
  });
});
afterAll(async () => {
  await Sentry.close();
});
afterEach(() => {
  Sentry.getIsolationScope().clear();
  vi.unstubAllEnvs();
});

const missingColumn = Object.assign(new Error("private SQL and user value"), {
  code: "42703",
  detail: "private payload",
  query: "private query",
});

it("delivers an actionable web event without query values or ambient request data", async () => {
  vi.stubEnv("TRIGGER_EXTERNAL_DEPLOYMENT_ID", "web-commit");
  vi.stubEnv("VERCEL_ENV", "production");
  Sentry.setUser({ email: "private@example.test" });
  Sentry.addBreadcrumb({ message: "private SQL breadcrumb" });
  Sentry.setExtra("payload", "private task data");
  await reportSchemaDrift(missingColumn, {
    operation: "insert",
    target: "repos",
  });
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    message: "Database schema contract mismatch",
    level: "error",
    release: "web-commit",
    environment: "production",
    tags: {
      failure_kind: "schema_drift",
      execution_runtime: "web",
      schema_code: "42703",
      operation: "insert",
      db_target: "repos",
    },
    fingerprint: ["schema-drift", "web", "42703", "insert", "repos"],
  });
  expect(JSON.stringify(events[0])).not.toContain("private");
});

it("keeps concurrent worker contexts separate and ignores a newer synced app release", async () => {
  vi.stubEnv("TRIGGER_EXTERNAL_DEPLOYMENT_ID", "newer-web-commit");
  await Promise.all(
    ["old", "new"].map((release) =>
      withSchemaDriftContext(
        {
          release,
          workerVersion: `version-${release}`,
          taskId: "worker",
          runId: `run-${release}`,
          environment: "production",
        },
        async () => {
          await Promise.resolve();
          await reportSchemaDrift(missingColumn, {
            operation: "rpc",
            target: "save_run",
          });
        }
      )
    )
  );
  expect(
    events.map((event) => ({
      release: event.release,
      context: event.contexts?.schema_drift,
    }))
  ).toEqual(
    expect.arrayContaining(
      ["old", "new"].map((release) => ({
        release,
        context: expect.objectContaining({
          release,
          worker_version: `version-${release}`,
          run_id: `run-${release}`,
          task_id: "worker",
          execution_runtime: "trigger",
        }),
      }))
    )
  );
  expect(events).toHaveLength(2);
  expect(JSON.stringify(events)).not.toContain("newer-web-commit");
});

it("uses the worker version when commit metadata is absent and recognizes wrapped safe messages", async () => {
  const { SCHEMA_DRIFT_MESSAGE } = await import("@/lib/schema-drift");
  await withSchemaDriftContext(
    {
      workerVersion: "20260914.3",
      taskId: "worker",
      runId: "run-1",
      environment: "staging",
    },
    () =>
      reportSchemaDrift(new Error(SCHEMA_DRIFT_MESSAGE), {
        operation: "task",
        target: "worker",
      })
  );
  expect(events[0]).toMatchObject({
    release: "trigger:20260914.3",
    environment: "staging",
    tags: { schema_code: "SCHEMA_DRIFT" },
  });
});

it("does not report ordinary failures and contains telemetry delivery failures", async () => {
  await reportSchemaDrift(new Error("network failure"), {
    operation: "insert",
    target: "repos",
  });
  expect(events).toEqual([]);
  failDelivery = true;
  await expect(
    reportSchemaDrift(missingColumn, { operation: "insert", target: "repos" })
  ).resolves.toBeUndefined();
});
