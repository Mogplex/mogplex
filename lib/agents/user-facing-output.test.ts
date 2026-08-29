import type { TextStreamPart, ToolSet } from "ai";
import { describe, expect, it } from "vitest";
import {
  createAgentUserFacingOutputTransform,
  isExplicitInfrastructureDiagnosticRequest,
  resolveInfrastructureDiagnosticScope,
  sanitizeAgentUserFacingError,
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

  it("replaces internal GitHub capability details with actionable product language", () => {
    const output = sanitizeAgentUserFacingText(
      "Still blocked — github_api only supports GET/HEAD and is scoped to the current workspace repo; cross-repository paths are rejected."
    );

    expect(output).not.toMatch(
      /github_api|GET\/HEAD|workspace repo|cross-repository paths/i
    );
    expect(output).toMatch(/GitHub connection/i);
    expect(output).toMatch(/requested repository/i);
  });

  it("preserves only explicitly requested diagnostic categories", () => {
    const output = sanitizeAgentUserFacingText(
      "Vercel Sandbox sbx_01HXYZ987654 failed at /vercel/sandbox/src/app.ts and called http://worker.internal/jobs/run_01HXYZ987654.",
      { diagnosticScope: ["provider", "filesystem-path"] }
    );

    expect(output).toMatch(/Vercel Sandbox/);
    expect(output).toMatch(/\/vercel\/sandbox\/src\/app\.ts/);
    expect(output).not.toMatch(/sbx_01HXYZ987654|worker\.internal|run_01H/);
  });

  it("always redacts representative credential formats", () => {
    const credentialUrl = `postgres://${["app", "correct-horse-battery-staple"].join(":")}@${["db", "internal"].join(".")}/app`;
    const output = sanitizeAgentUserFacingText(
      [
        "OPENAI_API_KEY=unclassified-value",
        "Authorization: Bearer opaque-access-value",
        "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE",
        "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature-value",
        credentialUrl,
      ].join("\n"),
      {
        diagnosticScope: [
          "provider",
          "filesystem-path",
          "identifier",
          "internal-url",
          "stack-trace",
          "configuration-name",
          "runtime-topology",
        ],
      }
    );

    expect(output).not.toMatch(
      /unclassified-value|opaque-access-value|AKIAIOSFODNN7EXAMPLE|eyJhbGci|correct-horse/
    );
    expect(output.match(/\[redacted\]/g)?.length).toBeGreaterThanOrEqual(5);
  });

  it("keeps raw runtime errors sanitized during diagnostic requests", () => {
    const output = sanitizeAgentUserFacingError(
      "Vercel Sandbox sbx_01HXYZ987654 failed at /vercel/sandbox/src/app.ts"
    );

    expect(output).not.toMatch(/Vercel|sbx_01H|\/vercel\/sandbox/);
    expect(output).toMatch(/development environment|repository workspace/i);
  });

  it("redacts generic host paths, private URLs, and non-JavaScript stacks", () => {
    const output = sanitizeAgentUserFacingError(
      [
        "Failed at /app/src/index.ts and /opt/service/config.json.",
        "Mounted /mnt/runtime data/project.db from C:\\Program Files\\runtime\\config.json.",
        "User checkout: /Users/Jane Doe/project/file.ts.",
        '  File "/root/project/main.py", line 10, in run',
        "    at com.acme.Worker.run(Worker.java:42)",
        "Called http://10.12.0.8:8080/jobs and http://worker:3000/health.",
        "Public help: https://example.com/docs/troubleshooting.",
        "Retry from the project settings.",
      ].join("\n")
    );

    expect(output).not.toMatch(
      /\/app\/|\/opt\/|\/mnt\/|\/root\/|\/Users\/Jane|C:\\Program Files|10\.12\.0\.8|worker:3000|Worker\.java|File "/
    );
    expect(output).toMatch(/repository workspace|internal service/i);
    expect(output).toMatch(/https:\/\/example\.com\/docs\/troubleshooting/);
    expect(output).toMatch(/Retry from the project settings/);
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
    expect(
      resolveInfrastructureDiagnosticScope(
        "Show me the sandbox provider and absolute filesystem path for debugging."
      )
    ).toEqual(["provider", "filesystem-path", "runtime-topology"]);
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

  it("sanitizes tool failures and result errors before stream serialization", async () => {
    const transform = createAgentUserFacingOutputTransform<ToolSet>();
    const source = new ReadableStream<TextStreamPart<ToolSet>>({
      start(controller) {
        controller.enqueue({
          type: "tool-error",
          toolCallId: "tool-1",
          toolName: "run_command",
          input: {},
          error:
            "Vercel Sandbox failed at /opt/runtime/app.ts with OPENAI_API_KEY=tool-secret",
          dynamic: true,
        });
        controller.enqueue({
          type: "tool-result",
          toolCallId: "tool-2",
          toolName: "run_command",
          input: {},
          output: {
            status: "error",
            error: "https://192.168.20.4:8080 failed from /app/main.py",
          },
          dynamic: true,
        });
        controller.close();
      },
    });

    const chunks: TextStreamPart<ToolSet>[] = [];
    const reader = source
      .pipeThrough(transform({ tools: {}, stopStream: () => undefined }))
      .getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    const serialized = JSON.stringify(chunks);
    expect(serialized).not.toMatch(
      /Vercel Sandbox|\/opt\/runtime|OPENAI_API_KEY|tool-secret|192\.168\.20\.4|\/app\/main\.py/
    );
    expect(serialized).toMatch(/development environment|internal service/);
  });
});
