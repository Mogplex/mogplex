import { describe, expect, it, vi } from "vitest";
import {
  NO_CONVERSATION_SKILLS,
  readUserTexts,
  renderConversationSkills,
  resolveConversationSkills,
} from "./chat";
import { catalogOf, skillRow } from "./test-fixtures";

const noRecord = async () => {};

const skills = catalogOf(
  skillRow("Deploy checklist", { content: "1. Run the tests." }),
  skillRow("Release notes", { content: "Group changes by area." })
);

describe("readUserTexts", () => {
  it("should read user text from parts, content arrays, and strings", () => {
    expect(
      readUserTexts([
        { role: "system", content: "$deploy-checklist" },
        {
          role: "user",
          parts: [{ type: "text", text: "one" }, { type: "file" }],
        },
        {
          role: "assistant",
          parts: [{ type: "text", text: "$release-notes" }],
        },
        {
          role: "user",
          content: [
            { type: "text", text: "two" },
            { type: "text", text: "three" },
          ],
        },
        { role: "user", content: "four" },
        { role: "user", parts: [] },
      ])
    ).toEqual(["one", "two\nthree", "four"]);
  });
});

describe("resolveConversationSkills", () => {
  it("should deliver an invoked skill in full and index the rest", async () => {
    const loadCatalog = vi.fn(async () => ({ skills }));
    const recordUse = vi.fn(async () => {});
    const result = await resolveConversationSkills(
      {
        userId: "user-1",
        repoId: "repo-1",
        userTexts: ["/deploy-checklist staging", "and now production"],
      },
      { loadCatalog, recordUse }
    );
    expect(loadCatalog).toHaveBeenCalledWith({
      userId: "user-1",
      repoId: "repo-1",
    });
    expect(result.invoked.map((skill) => skill.slug)).toEqual([
      "deploy-checklist",
    ]);
    // The invocation was counted on the turn it was typed, not again now.
    expect(recordUse).toHaveBeenCalledWith("user-1", []);
    const prompt = renderConversationSkills(result, "tool");
    expect(prompt).toContain("1. Run the tests.");
    expect(prompt).toContain("- $release-notes: Release notes");
    expect(prompt).not.toContain("Group changes by area.");
  });

  it("should count a skill as used on the turn that invokes it", async () => {
    const recordUse = vi.fn(async () => {});
    await resolveConversationSkills(
      {
        userId: "user-1",
        userTexts: ["/deploy-checklist staging", "now use $release-notes"],
      },
      { loadCatalog: async () => ({ skills }), recordUse }
    );
    expect(recordUse).toHaveBeenCalledTimes(1);
    expect(recordUse).toHaveBeenCalledWith("user-1", [skills[1]]);
  });

  it("should still deliver invoked skills when the agent cannot load others", async () => {
    const result = await resolveConversationSkills(
      { userId: "user-1", userTexts: ["use $release-notes"] },
      { loadCatalog: async () => ({ skills }), recordUse: noRecord }
    );
    const prompt = renderConversationSkills(result, "none");
    expect(prompt).toContain("Group changes by area.");
    expect(prompt).not.toContain("Available skills");
  });

  it("should honor the surface's reserved slash names", async () => {
    const result = await resolveConversationSkills(
      {
        userId: "user-1",
        userTexts: ["/deploy-checklist"],
        invocation: { reservedSlashNames: new Set(["deploy-checklist"]) },
      },
      { loadCatalog: async () => ({ skills }), recordUse: noRecord }
    );
    expect(result.invoked).toEqual([]);
    expect(renderConversationSkills(result, "none")).toBeNull();
  });

  it("should say nothing for a user without skills", async () => {
    expect(
      await resolveConversationSkills(
        { userId: "user-1", userTexts: ["$anything"] },
        { loadCatalog: async () => ({ skills: [] }), recordUse: noRecord }
      )
    ).toBe(NO_CONVERSATION_SKILLS);
  });

  it("should let the turn run when the catalog cannot load", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      await resolveConversationSkills(
        { userId: "user-1", userTexts: ["$deploy-checklist"] },
        {
          loadCatalog: async () => {
            throw new Error("database offline");
          },
          recordUse: noRecord,
        }
      )
    ).toBe(NO_CONVERSATION_SKILLS);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
