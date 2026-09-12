import { describe, expect, it } from "vitest";
import {
  DEPENDABOT_ALERT_ACTIONS,
  handleDependabotAlert,
  normalizeDependabotAlertActions,
} from "./dependabot";
import { coerceGraph, getStartConfig } from "./flows/graph";
import { buildFlowStarterTemplateGraph } from "./flows/templates";

describe("Dependabot alert contract", () => {
  it.each(DEPENDABOT_ALERT_ACTIONS)(
    "normalizes the %s lifecycle with nullable context",
    (action) => {
      const [event] = handleDependabotAlert({
        action,
        alert: { number: 7, state: "open" },
      });
      expect(event.triggerEvent).toBe("dependabot_alert");
      expect(event.metadata).toMatchObject({
        webhook_action: action,
        alert_number: 7,
        dependency_package: null,
        first_patched_version: null,
        identifiers: [],
        cves: [],
      });
    }
  );
  it.each([
    null,
    [],
    {},
    { number: 0 },
    { number: -1 },
    { number: 1.5 },
    { number: "1" },
    { number: Number.MAX_SAFE_INTEGER + 1 },
  ])("ignores invalid required alert identity: %j", (alert) => {
    expect(handleDependabotAlert({ action: "created", alert })).toEqual([]);
  });
  it("handles malformed optional fields and canonical CVE fallback", () => {
    const [event] = handleDependabotAlert({
      action: "created",
      alert: {
        number: 8,
        dependency: [],
        security_vulnerability: {
          package: { name: "widget", ecosystem: "npm" },
          first_patched_version: [],
        },
        security_advisory: {
          cve_id: "CVE-2026-1",
          identifiers: [
            null,
            {},
            { type: "CVE", value: "CVE-2026-1" },
            { type: "GHSA", value: "GHSA-1" },
          ],
        },
        dismissed_by: { login: "maintainer" },
        dismissed_reason: "tolerable_risk",
        dismissed_comment: "Not reachable",
        auto_dismissed_at: "2026-09-12",
      },
    });
    expect(event.metadata).toMatchObject({
      dependency_package: "widget",
      dependency_ecosystem: "npm",
      first_patched_version: null,
      cves: ["CVE-2026-1"],
      dismissed_by: "maintainer",
      dismissed_reason: "tolerable_risk",
      dismissed_comment: "Not reachable",
      auto_dismissed_at: "2026-09-12",
    });
    expect(
      handleDependabotAlert({ action: "other", alert: { number: 1 } })
    ).toEqual([]);
  });
  it("preserves explicit empty selections through graph serialization", () => {
    expect(normalizeDependabotAlertActions(undefined)).toEqual(["created"]);
    for (const value of [[], null, "fixed", ["invalid"]])
      expect(normalizeDependabotAlertActions(value)).toEqual([]);
    expect(
      normalizeDependabotAlertActions(["fixed", "fixed", "created", 9])
    ).toEqual(["fixed", "created"]);
    const graph = buildFlowStarterTemplateGraph({
      templateId: "dependabot-autopilot",
      agentId: "agent",
      agentName: "Remediator",
    });
    expect(getStartConfig(coerceGraph(graph))).toMatchObject({
      event: "dependabot_alert",
      dependabotAlertActions: ["created"],
    });
    const start = graph.nodes.find((node) => node.type === "start")!;
    start.data.dependabotAlertActions = [];
    expect(
      getStartConfig(coerceGraph(JSON.parse(JSON.stringify(graph))))
        ?.dependabotAlertActions
    ).toEqual([]);
    expect(
      graph.nodes.find((node) => node.type === "agent")?.data
    ).toMatchObject({ role: "triage", harness: "mogplex" });
  });
});
