import { describe, expect, it } from "vitest";
import { readToolPolicy, toolApproval, updateToolPolicy } from "./policy";
import { normalizeMcpServerCreateInput } from "./normalization";
import {
  buildPayload,
  serverToForm,
} from "@/components/settings/mcp-servers/helpers";

describe("saved MCP permission controls", () => {
  it("rejects malformed HTTP permissions on the API and browser save paths", () => {
    expect(() =>
      normalizeMcpServerCreateInput({
        name: "docs",
        transport: "http",
        url: "https://example.com/mcp",
        extra: { tools: { search: { approval_mode: "unknown" } } },
      })
    ).toThrow("Correct the tool permissions");
    expect(() =>
      buildPayload({
        ...serverToForm(null),
        extraText: '{"enabled_tools":"all"}',
      })
    ).toThrow("Correct the tool permissions");
  });

  it("keeps CLI metadata and strict permissions through browser and API serialization", () => {
    const extra = {
      cwd: "/repo",
      enabled_tools: [],
      disabled_tools: ["delete"],
      tools: { publish: { approval_mode: "prompt", custom: 7 } },
    };
    const form = {
      ...serverToForm(null),
      name: "docs",
      url: "https://example.com/mcp",
      extraText: JSON.stringify(extra),
    };
    const payload = buildPayload(form);
    expect(normalizeMcpServerCreateInput(payload).extra).toEqual(extra);
  });
  it("preserves CLI fields and unrelated tool metadata when changing a permission", () => {
    const extra = {
      cwd: "/repo",
      tools: {
        publish: { approval_mode: "prompt", custom: 42 },
        search: { enabled: false },
      },
    };
    const changed = updateToolPolicy(extra, { tool: "publish", mode: "auto" });
    expect(changed).toEqual({
      cwd: "/repo",
      tools: {
        publish: { approval_mode: "auto", custom: 42 },
        search: { enabled: false },
      },
    });
    expect(extra.tools.publish.approval_mode).toBe("prompt");
  });

  it("keeps allowlists, blocklists and disabled tools stronger than approval overrides", () => {
    const policy = readToolPolicy({
      enabled_tools: ["publish", "delete", "disabled"],
      disabled_tools: ["delete"],
      default_tools_approval_mode: "prompt",
      tools: {
        publish: { approval_mode: "approve" },
        delete: { approval_mode: "auto" },
        disabled: { enabled: false },
      },
    });
    expect(toolApproval(policy, "search")).toBe("deny");
    expect(toolApproval(policy, "delete")).toBe("deny");
    expect(toolApproval(policy, "disabled")).toBe("deny");
    expect(toolApproval(policy, "publish")).toBe("approve");
  });

  it("supports removing an override without losing other tool fields", () => {
    const changed = updateToolPolicy(
      {
        tools: {
          search: { enabled: false, approval_mode: "prompt", custom: true },
        },
      },
      { tool: "search", mode: "inherit" }
    );
    expect(changed).toEqual({
      tools: { search: { enabled: false, custom: true } },
    });
  });

  it("rejects malformed policies instead of silently relaxing them", () => {
    for (const extra of [
      { enabled_tools: "all" },
      { tools: { search: { enabled: "no" } } },
      { default_tools_approval_mode: "unknown" },
    ]) {
      expect(() => readToolPolicy(extra)).toThrow();
      expect(() => updateToolPolicy(extra, { mode: "auto" })).toThrow();
    }
  });

  it("edits the default without changing per-tool permissions or allowlists", () => {
    const extra = {
      enabled_tools: [],
      disabled_tools: ["delete"],
      tools: { publish: { approval_mode: "prompt" } },
    };
    const changed = updateToolPolicy(extra, { mode: "auto" });
    expect(changed).toEqual({ ...extra, default_tools_approval_mode: "auto" });
    expect(toolApproval(readToolPolicy(changed), "publish")).toBe("deny");
  });
});
