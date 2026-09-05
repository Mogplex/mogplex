import { expect, it } from "vitest";
import { runDeepLinkDestination } from "./navigation";

it("existing Slack View work links open the exact run workspace in the user's scope", () => {
  expect(runDeepLinkDestination("alex", "run-1", "call-1")).toBe(
    "/alex/projects/workspace?run=run-1"
  );
});
it("keeps explicit run details in observability", () => {
  expect(runDeepLinkDestination("alex", "run-1", "call-1", "details")).toBe(
    "/alex/observability?call_id=call-1"
  );
});
