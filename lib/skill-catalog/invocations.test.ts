import { describe, expect, it } from "vitest";
import { findSkillTokens, resolveInvokedSkills } from "./invocations";
import { catalogOf, skillRow } from "./test-fixtures";

const skills = catalogOf(
  skillRow("Deploy checklist"),
  skillRow("Release notes"),
  skillRow("Compact")
);

function invokedSlugs(
  text: string | string[],
  options?: Parameters<typeof resolveInvokedSkills>[2]
) {
  return resolveInvokedSkills(text, skills, options).map((skill) => skill.slug);
}

describe("findSkillTokens", () => {
  it("should read a leading slash command and dollar mentions in order", () => {
    expect(
      findSkillTokens("/deploy-checklist staging, then $release-notes")
    ).toEqual(["deploy-checklist", "release-notes"]);
  });

  it("should ignore a slash that is not the first word", () => {
    expect(findSkillTokens("look at src/deploy-checklist please")).toEqual([]);
    expect(findSkillTokens("please run /deploy-checklist")).toEqual([]);
  });

  it("should treat underscores and case as the same handle", () => {
    expect(findSkillTokens("use $Deploy_Checklist.")).toEqual([
      "deploy-checklist",
    ]);
  });

  it("should skip tokens inside code spans and fenced blocks", () => {
    const text = [
      "Run `echo $release-notes` and",
      "```sh",
      "export X=$deploy-checklist",
      "```",
      "then $compact",
    ].join("\n");
    expect(findSkillTokens(text)).toEqual(["compact"]);
  });

  it("should skip an unterminated fenced block to the end", () => {
    expect(findSkillTokens("```\n$compact")).toEqual([]);
  });

  it("should not read a dollar amount, an escaped dollar, or a suffix", () => {
    expect(
      findSkillTokens("costs $5, US$compact, \\$compact, a$compact")
    ).toEqual(["5"]);
  });
});

describe("resolveInvokedSkills", () => {
  it("should resolve only tokens that name a catalog skill", () => {
    expect(invokedSlugs("cd $HOME && $release-notes for $unknown")).toEqual([
      "release-notes",
    ]);
  });

  it("should return nothing for an empty catalog", () => {
    expect(resolveInvokedSkills("$release-notes", [])).toEqual([]);
  });

  it("should keep a surface's own slash command out of skill resolution", () => {
    const reservedSlashNames = new Set(["compact"]);
    expect(invokedSlugs("/compact now", { reservedSlashNames })).toEqual([]);
    expect(invokedSlugs("/compact $compact", { reservedSlashNames })).toEqual([
      "compact",
    ]);
  });

  it("should carry a skill invoked in an earlier message, once", () => {
    expect(
      invokedSlugs([
        "/deploy-checklist staging",
        "now production",
        "$release-notes and again $deploy-checklist",
      ])
    ).toEqual(["deploy-checklist", "release-notes"]);
  });
});
