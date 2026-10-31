import { afterEach, expect, it, vi } from "vitest";
import type { ResumeFlowWaitCandidate } from "./wait-service-core";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

for (const kind of ["github_label_added", "ci_workflow_completed"] as const) {
  it(`${kind} preserves a stranded token rollback as an explicit operator-repair outcome`, async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-test-service-role");
    vi.stubEnv("TRIGGER_SECRET_KEY", "tr_dev_synthetic_wait_routing_test");
    const {
      routeGithubLabeledEventToFlowWaits,
      routeGithubCiCompletedEventToFlowWaits,
    } = await import("./wait-service-routing");
    const candidate: ResumeFlowWaitCandidate = {
      id: "wait-1",
      user_id: "user-1",
      job_run_id: "job-1",
      flow_id: "flow-1",
      installation_id: 99,
      repo_id: "repo-1",
      node_id: "await",
      resume_token: "synthetic-token",
      wait_kind: kind,
      wait_config:
        kind === "github_label_added"
          ? { kind, labelName: "ready", prOnly: false }
          : {
              kind,
              workflowName: "CI",
              conclusion: "success",
              expectedSha: null,
            },
    };
    let completionAttempts = 0;
    let rollbackAttempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/flows")) return Response.json([]);
        if (url.pathname.endsWith("/flow_waits")) {
          if ((init?.method ?? "GET") === "GET") {
            expect(url.searchParams.get("installation_id")).toBe("eq.99");
            return Response.json([candidate]);
          }
          const body = JSON.parse(String(init?.body)) as { status: string };
          if (body.status === "resumed")
            return Response.json({ resume_token: candidate.resume_token });
          rollbackAttempts++;
          return Response.json(
            { message: "rollback unavailable" },
            { status: 400 }
          );
        }
        if (url.pathname.includes("/waitpoints/tokens/")) {
          completionAttempts++;
          return Response.json(
            { error: "completion unavailable" },
            { status: 400 }
          );
        }
        throw new Error(`Unexpected external request: ${url.pathname}`);
      })
    );
    const event = {
      installationId: 99,
      repoId: "repo-1",
      repoFullName: "acme/web",
      accountType: "Organization" as const,
      labelName: "ready",
      isPullRequest: false,
      workflowName: "CI",
      conclusion: "success",
      headSha: "abc",
      deliveryId: "delivery-1",
      payload: {},
    };
    const result =
      kind === "github_label_added"
        ? await routeGithubLabeledEventToFlowWaits(event)
        : await routeGithubCiCompletedEventToFlowWaits(event);
    expect(completionAttempts).toBe(1);
    expect(rollbackAttempts).toBe(1);
    expect(result).toMatchObject({
      matched: 1,
      resumed: 0,
      completeFailed: 1,
      rollbackFailed: true,
    });
    expect(result.failures).toHaveLength(1);
  });
}
