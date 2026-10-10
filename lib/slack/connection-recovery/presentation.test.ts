import { describe, expect, it } from "vitest";
import {
  buildConnectionRecoveryCard,
  buildConnectionRecoveryModal,
  buildConnectionResumePayload,
  connectionRecoveryTargetSchema,
} from "./presentation";

describe("Slack connection recovery", () => {
  it("does not offer actions while loading or after continuation", () => {
    for (const state of [{ loading: true }, { completed: true }]) {
      const modal = buildConnectionRecoveryModal({
        id: "request",
        appUrl: "https://mogplex.example",
        target: { provider: "github", access: "read" },
        ...state,
      });
      expect(modal.blocks.some((block) => block.type === "actions")).toBe(
        false
      );
    }
  });
  it("gives a missing repository a provider action and a same-thread continuation", () => {
    const card = buildConnectionRecoveryCard({
      id: "request-id",
      target: {
        provider: "github",
        repository: "acme/widgets",
        access: "write",
      },
      appUrl: "https://mogplex.example",
    });
    expect(card.text).toContain("acme/widgets");
    expect(card.blocks).toContainEqual(
      expect.objectContaining({
        type: "actions",
        elements: expect.arrayContaining([
          expect.objectContaining({
            action_id: "mogplex_connection_open",
            value: "request-id",
            text: { type: "plain_text", text: "Connect GitHub" },
          }),
        ]),
      })
    );
    expect(JSON.stringify(card.blocks)).toContain(
      "https://mogplex.example/slack-connectors/github.png"
    );
    const modal = buildConnectionRecoveryModal({
      id: "request-id",
      target: {
        provider: "github",
        repository: "acme/widgets",
        access: "write",
      },
      appUrl: "https://mogplex.example",
    });
    expect(modal.type).toBe("modal");
    expect(modal.private_metadata).toBe("request-id");
    expect(JSON.stringify(modal.blocks)).toContain(
      "https://mogplex.example/slack/connections?request=request-id"
    );
    expect(JSON.stringify(modal.blocks)).toContain("Check access & continue");
  });

  it("rejects URLs and traversal as repository targets", () => {
    for (const repository of [
      "https://evil.test/a/b",
      "acme/../widgets",
      "acme/widgets?x=1",
      "acme/<@U1>",
      "acme/..",
      "acme/.",
    ]) {
      expect(
        connectionRecoveryTargetSchema.safeParse({
          provider: "github",
          repository,
        }).success
      ).toBe(false);
    }
  });

  it("offers an explicit restore action for hidden repositories", () => {
    const input = {
      id: "restore",
      target: {
        provider: "github" as const,
        repository: "acme/widgets",
        access: "read" as const,
      },
      appUrl: "https://mogplex.example",
      restoreRepository: true,
    };
    expect(buildConnectionRecoveryCard(input).text).toContain(
      "removed from Mogplex"
    );
    const modal = buildConnectionRecoveryModal(input);
    expect(modal.title.text).toBe("Restore repository");
    expect(JSON.stringify(modal.blocks)).toContain(
      "mogplex_connection_restore"
    );
    expect(JSON.stringify(modal.blocks)).not.toContain(
      "mogplex_connection_authorize"
    );
  });

  it("uses Vercel and saved connector icons and confirms a scope move explicitly", () => {
    const input = { id: "request", appUrl: "https://mogplex.example" };
    const vercel = buildConnectionRecoveryCard({
      ...input,
      target: { provider: "vercel", team: "acme" },
    });
    expect(vercel.text).toContain("Vercel team acme");
    expect(JSON.stringify(vercel.blocks)).toContain(
      "slack-connectors/vercel.png"
    );
    const modal = buildConnectionRecoveryModal({
      ...input,
      target: { provider: "connection", connectionId: "id" },
      name: "Docs",
      icon: "notion",
      scopeRepair: {
        label: "Use for this repository",
        explanation: "Move to acme/widgets from its previous project",
      },
    });
    expect(JSON.stringify(modal.blocks)).toContain(
      "slack-connectors/notion.png"
    );
    expect(JSON.stringify(modal.blocks)).toContain('"confirm"');
    expect(JSON.stringify(modal.blocks)).toContain("Move to acme/widgets");
  });

  it("resumes with stable event identity, the saved intent and the original thread", () => {
    const payload = {
      teamId: "T1",
      channelId: "D1",
      threadTs: "10.01",
      messageTs: "10.02",
      slackUserId: "U1",
      eventId: "Ev1",
      text: "fix it",
      channelType: "im" as const,
      eventType: "message" as const,
    };
    const resumed = buildConnectionResumePayload({
      id: "request-id",
      payload,
      resumeText: "Fix acme/widgets and open a pull request.",
    });
    expect(resumed).toMatchObject({
      teamId: "T1",
      channelId: "D1",
      threadTs: "10.01",
      slackUserId: "U1",
      eventId: "slack-connection:request-id",
    });
    expect(resumed.text).toContain("Fix acme/widgets and open a pull request.");
    expect(
      buildConnectionResumePayload({
        id: "request-id",
        payload,
        resumeText: "Fix acme/widgets and open a pull request.",
      })
    ).toEqual(resumed);
  });
});
