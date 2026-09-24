import { beforeAll, expect, it, vi } from "vitest";
import type { SlackCancelCommandDeps } from "./cancel-command";
import { buildRunRow } from "@/tests/unit/helpers/mogplex-api-runs-fixtures";
import { presentMogplexApiRun } from "@/lib/mogplex-api/runs";

let cancelText: typeof import("./cancel-command").slackCancelCommandText;
beforeAll(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  cancelText = (await import("./cancel-command")).slackCancelCommandText;
});
const scope = {
  userId: "user-1",
  teamId: "T1",
  channelId: "C1",
  slackUserId: "U1",
};
const runId = "00000000-0000-4000-8000-000000000001";
function fixture(overrides: Partial<SlackCancelCommandDeps> = {}) {
  return {
    listCancelableRuns: vi.fn<SlackCancelCommandDeps["listCancelableRuns"]>(
      async () => [{ id: runId, status: "streaming" }]
    ),
    cancelRun: vi.fn<SlackCancelCommandDeps["cancelRun"]>(async () => ({
      status: "cancelled",
      alreadyTerminal: false,
      run: presentMogplexApiRun(
        buildRunRow({ id: runId, status: "cancelled" })
      ),
    })),
    ...overrides,
  };
}
it("cancels the selected run and reports that saved work remains", async () => {
  const deps = fixture();
  expect(await cancelText(scope, runId, deps)).toContain(
    "Cancellation requested"
  );
  expect(deps.listCancelableRuns).toHaveBeenCalledWith({ ...scope, runId });
  expect(deps.cancelRun).toHaveBeenCalledWith({ userId: scope.userId, runId });
});
it("rejects invalid IDs without loading or cancelling runs", async () => {
  const deps = fixture();
  expect(await cancelText(scope, "all", deps)).toContain("Usage:");
  expect(deps.listCancelableRuns).not.toHaveBeenCalled();
  expect(deps.cancelRun).not.toHaveBeenCalled();
});
it.each(["", runId])(
  "reports no matching run for %s without cancelling anything",
  async (argument) => {
    const deps = fixture({ listCancelableRuns: async () => [] });
    expect(await cancelText(scope, argument, deps)).toMatch(
      argument ? /not found/ : /no active/
    );
    expect(deps.cancelRun).not.toHaveBeenCalled();
  }
);
it("lists multiple channel runs without guessing or cancelling any", async () => {
  const second = "00000000-0000-4000-8000-000000000002";
  const deps = fixture({
    listCancelableRuns: async () => [
      { id: runId, status: "streaming" },
      { id: second, status: "pending" },
    ],
  });
  const text = await cancelText(scope, "", deps);
  expect(text).toContain(runId);
  expect(text).toContain(second);
  expect(text).toContain("Choose one");
  expect(deps.cancelRun).not.toHaveBeenCalled();
});
it("does not claim cancellation when completion wins the race", async () => {
  const deps = fixture({
    cancelRun: async () => ({
      status: "success",
      alreadyTerminal: true,
      run: presentMogplexApiRun(buildRunRow({ status: "success" })),
    }),
  });
  expect(await cancelText(scope, "", deps)).toContain(
    "already finished (status: success)"
  );
});
it("reports a disappeared run", async () => {
  expect(
    await cancelText(scope, "", fixture({ cancelRun: async () => null }))
  ).toContain("no longer available");
});

it("reports lookup failure without attempting cancellation", async () => {
  const deps = fixture({
    listCancelableRuns: async () => {
      throw new Error("database unavailable");
    },
  });
  expect(await cancelText(scope, "", deps)).toContain(
    "Run lookup failed, so no cancellation was sent"
  );
  expect(deps.cancelRun).not.toHaveBeenCalled();
});
it("provides a specific retry command on failure without leaking provider details", async () => {
  const text = await cancelText(
    scope,
    "",
    fixture({
      cancelRun: async () => {
        throw new Error("private provider credentials");
      },
    })
  );
  expect(text).toContain(`Cancellation failed for run \`${runId}\``);
  expect(text).toContain(`/mogplex-cancel ${runId}`);
  expect(text).not.toContain("private provider");
});
