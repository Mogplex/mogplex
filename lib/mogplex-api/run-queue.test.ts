import { afterEach, expect, it, vi } from "vitest";
import { startMogplexApiRun, type StartMogplexApiRunDeps } from "./runs";
import {
  buildStartDeps,
  buildUser,
} from "../../tests/unit/helpers/mogplex-api-runs-fixtures";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("the real queue request does not disable supervisor retries", async () => {
  vi.stubEnv("TRIGGER_SECRET_KEY", "tr_dev_test_fixture");
  const requests: Array<{
    url: string;
    body: { options?: { maxAttempts?: number } };
  }> = [];
  vi.stubGlobal(
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push({ url: request.url, body: await request.json() });
      return Response.json({
        id: "run_supervisor",
        publicAccessToken: "fixture",
      });
    }
  );
  const deps: Partial<StartMogplexApiRunDeps> = buildStartDeps();
  delete deps.queueRun;
  const result = await startMogplexApiRun({
    user: buildUser(),
    idempotencyKey: "queue-test",
    body: { repoId: "repo-1", prompt: "Check the repo", harness: "mogplex" },
    deps,
  });
  expect(result.run.runtime.runId).toBe("run_supervisor");
  expect(requests).toHaveLength(1);
  expect(requests[0].url).toContain("execute-external-agent-run/trigger");
  expect(requests[0].body.options?.maxAttempts).toBeUndefined();
});
