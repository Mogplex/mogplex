import type { TextStreamPart, ToolSet } from "ai";
import { describe, expect, it } from "vitest";
import {
  createAgentUserFacingOutputTransform,
  isExplicitInfrastructureDiagnosticRequest,
  sanitizeAgentUserFacingText,
} from "./user-facing-output";

describe("agent user-facing output", () => {
  it("replaces internal infrastructure details with product language", () => {
    const output = sanitizeAgentUserFacingText(
      "Vercel Sandbox sbx_01HXYZ987654 is running from /vercel/sandbox/.worktrees/wt-7/src/app.ts. Trigger.dev deployment run_01HXYZ987654 failed, so retry the command.",
      { repoName: "widgets" }
    );

    expect(output).not.toMatch(/Vercel|Trigger\.dev/);
    expect(output).not.toMatch(/sbx_|run_01|\/vercel\/sandbox/);
    expect(output).toMatch(/development environment/i);
    expect(output).toMatch(/src\/app\.ts/);
    expect(output).toMatch(/retry the command/i);
  });

  it("preserves requested diagnostics but still redacts secrets", () => {
    const output = sanitizeAgentUserFacingText(
      "Vercel Sandbox sbx_01HXYZ987654 failed at /vercel/sandbox/src/app.ts with token ghp_abcdefghijklmnopqrstuvwxyz1234567890.",
      { allowInfrastructureDiagnostics: true }
    );

    expect(output).toMatch(/Vercel Sandbox/);
    expect(output).toMatch(/sbx_01HXYZ987654/);
    expect(output).toMatch(/\/vercel\/sandbox\/src\/app\.ts/);
    expect(output).not.toMatch(/ghp_abcdefghijklmnopqrstuvwxyz1234567890/);
  });

  it("requires a deliberate infrastructure diagnostics request", () => {
    expect(
      isExplicitInfrastructureDiagnosticRequest(
        "Show me the internal sandbox provider and absolute path for debugging."
      )
    ).toBe(true);
    expect(
      isExplicitInfrastructureDiagnosticRequest(
        "Deploy this app and tell me when the preview is ready."
      )
    ).toBe(false);
  });

  it("keeps provider names that the user requested", () => {
    const output = sanitizeAgentUserFacingText(
      "The Supabase integration is configured; sandbox sbx_01HXYZ987654 is running.",
      { userRequestText: "Configure the Supabase integration." }
    );

    expect(output).toMatch(/Supabase integration/);
    expect(output).not.toMatch(/sbx_01HXYZ987654/);
  });

  it("preserves ordinary status text while hiding configuration names", () => {
    expect(sanitizeAgentUserFacingText("Selection required")).toBe(
      "Selection required"
    );
    expect(sanitizeAgentUserFacingText("INTERNAL_TOKEN is missing")).toBe(
      "required configuration is missing"
    );
  });

  it("catches infrastructure details split across stream deltas", async () => {
    const transform = createAgentUserFacingOutputTransform<ToolSet>();
    const source = new ReadableStream<TextStreamPart<ToolSet>>({
      start(controller) {
        controller.enqueue({ type: "text-start", id: "answer" });
        controller.enqueue({
          type: "text-delta",
          id: "answer",
          text: "The Vercel Sand",
        });
        controller.enqueue({
          type: "text-delta",
          id: "answer",
          text: "box sbx_01HXYZ987654 is at /vercel/sandbox/src/app.ts.",
        });
        controller.enqueue({ type: "text-end", id: "answer" });
        controller.close();
      },
    });

    const chunks: TextStreamPart<ToolSet>[] = [];
    const reader = source
      .pipeThrough(
        transform({
          tools: {},
          stopStream: () => undefined,
        })
      )
      .getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    const text = chunks
      .filter((chunk) => chunk.type === "text-delta")
      .map((chunk) => chunk.text)
      .join("");
    expect(text).not.toMatch(/Vercel|sbx_|\/vercel\/sandbox/);
    expect(text).toMatch(/src\/app\.ts/);
  });
});
