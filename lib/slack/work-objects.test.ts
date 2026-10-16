import { describe, expect, it } from "vitest";
import { buildRunWorkObject, parseRunLink } from "./work-objects";

process.env.NEXT_PUBLIC_APP_URL ||= "https://mogplex.com";

const RUN_ID = "00000000-0000-4000-8000-000000000031";

const run = {
  id: RUN_ID,
  status: "streaming" as const,
  prompt: "Fix the header\nMore detail",
  harness: "codex" as const,
  working_branch: "fix/header",
  metadata: {},
  created_at: "2026-10-16T10:00:00.000Z",
  updated_at: "2026-10-16T10:05:00.000Z",
};

describe("parseRunLink", () => {
  it("should read the run id from run links on this deployment", () => {
    const origin = "https://mogplex.com";
    expect(parseRunLink(`${origin}/runs/${RUN_ID}`, origin)).toBe(RUN_ID);
    expect(
      parseRunLink(`${origin}/acme/runs/${RUN_ID}?view=details`, origin)
    ).toBe(RUN_ID);
  });

  it("should ignore other hosts, paths and ids", () => {
    const origin = "https://mogplex.com";
    expect(parseRunLink(`https://evil.test/runs/${RUN_ID}`, origin)).toBeNull();
    expect(parseRunLink(`${origin}/runs/${RUN_ID}/logs`, origin)).toBeNull();
    expect(parseRunLink(`${origin}/runs/not-a-uuid`, origin)).toBeNull();
    expect(parseRunLink("not a url", origin)).toBeNull();
  });
});

describe("buildRunWorkObject", () => {
  it("should present a running run as a task with its facts", () => {
    const entity = buildRunWorkObject({
      run,
      repoFullName: "acme/web",
      appUnfurlUrl: `https://mogplex.com/runs/${RUN_ID}`,
    }) as {
      entity_type: string;
      external_ref: { id: string };
      app_unfurl_url: string;
      entity_payload: {
        attributes: { title: { text: string } };
        fields: { status: { value: string; tag_color: string } };
        custom_fields: { key: string; value: string }[];
        actions: { primary_actions: { text: string; value: string }[] };
      };
    };

    expect(entity.entity_type).toBe("slack#/entities/task");
    expect(entity.external_ref.id).toBe(RUN_ID);
    expect(entity.app_unfurl_url).toContain(RUN_ID);
    expect(entity.entity_payload.attributes.title.text).toBe("Fix the header");
    expect(entity.entity_payload.fields.status).toEqual({
      value: "Running",
      tag_color: "blue",
    });
    expect(
      entity.entity_payload.custom_fields.map((field) => field.value)
    ).toEqual(["acme/web", "fix/header", "Codex"]);
    expect(
      entity.entity_payload.actions.primary_actions.map((action) => action.text)
    ).toEqual(["Changes so far"]);
  });

  it("should offer Details once the run ends and leave out the unfurl url for the flexpane", () => {
    const entity = buildRunWorkObject({
      run: { ...run, status: "success" },
    }) as Record<string, unknown> & {
      entity_payload: {
        fields: { status: { value: string } };
        actions: { primary_actions: { text: string }[] };
      };
    };

    expect(entity.app_unfurl_url).toBeUndefined();
    expect(entity.entity_payload.fields.status.value).toBe("Finished");
    expect(
      entity.entity_payload.actions.primary_actions.map((action) => action.text)
    ).toEqual(["View changes", "Details"]);
  });

  it.each([
    ["pending", {}, "Queued", "gray", []],
    ["awaiting_input", {}, "Waiting for you", "yellow", ["Changes so far"]],
    ["failed", {}, "Failed", "red", ["View changes", "Details"]],
    ["cancelled", {}, "Cancelled", "gray", ["View changes", "Details"]],
  ] as const)(
    "should show a %s run with its status and buttons",
    (status, metadata, value, tagColor, buttons) => {
      const entity = buildRunWorkObject({
        run: { ...run, status, metadata, harness: "other" as "codex" },
      }) as {
        entity_payload: {
          fields: { status: unknown };
          custom_fields: { key: string; value: string }[];
          actions?: { primary_actions: { text: string }[] };
        };
      };

      expect(entity.entity_payload.fields.status).toEqual({
        value,
        tag_color: tagColor,
      });
      expect(
        entity.entity_payload.actions?.primary_actions.map((a) => a.text) ?? []
      ).toEqual(buttons);
      expect(entity.entity_payload.custom_fields.at(-1)?.value).toBe("other");
    }
  );

  it("should include the latest progress summary as the description", () => {
    const entity = buildRunWorkObject({
      run: {
        ...run,
        slack_progress: {
          phase: "Editing",
          summary: "Updated the header styles",
          next: "",
          tasks: [],
          lastActivityAt: 1,
          sequence: 1,
        },
      },
    }) as { entity_payload: { fields: { description?: { value: string } } } };

    expect(entity.entity_payload.fields.description?.value).toBe(
      "Updated the header styles"
    );
  });

  it("should call out a plan waiting for review", () => {
    const entity = buildRunWorkObject({
      run: {
        ...run,
        status: "awaiting_input",
        metadata: { checkpoint_kind: "plan" },
      },
    }) as { entity_payload: { fields: { status: unknown } } };

    expect(entity.entity_payload.fields.status).toEqual({
      value: "Plan ready for review",
      tag_color: "yellow",
    });
  });
});
