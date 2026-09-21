import { describe, expect, it, vi } from "vitest";
import {
  fetchRegistrySkillMarkdown,
  parseSkillMarkdown,
  registrySkillMarkdownUrls,
  REGISTRY_SKILL_MAX_CHARS,
  type FetchLike,
} from "./skill-md";

const SKILL_MD = [
  "---",
  "name: web-design-guidelines",
  'description: "Review UI code for guideline compliance."',
  "---",
  "",
  "# Web Interface Guidelines",
  "",
  "Fetch the guidelines, then review the files.",
].join("\n");

function respond(map: Record<string, string | number | Error>): FetchLike {
  return vi.fn(async (url: string) => {
    const hit = map[url];
    if (hit instanceof Error) throw hit;
    if (typeof hit === "string") {
      return { ok: true, status: 200, text: async () => hit };
    }
    return { ok: false, status: hit ?? 404, text: async () => "" };
  });
}

describe("registrySkillMarkdownUrls", () => {
  it("should try the common layouts in order on the source repo", () => {
    expect(
      registrySkillMarkdownUrls(
        "vercel-labs/agent-skills",
        "web-design-guidelines"
      )
    ).toEqual([
      "https://raw.githubusercontent.com/vercel-labs/agent-skills/HEAD/skills/web-design-guidelines/SKILL.md",
      "https://raw.githubusercontent.com/vercel-labs/agent-skills/HEAD/web-design-guidelines/SKILL.md",
      "https://raw.githubusercontent.com/vercel-labs/agent-skills/HEAD/.claude/skills/web-design-guidelines/SKILL.md",
      "https://raw.githubusercontent.com/vercel-labs/agent-skills/HEAD/.agents/skills/web-design-guidelines/SKILL.md",
    ]);
  });

  it("should keep a nested skill id and refuse anything that could leave the repo", () => {
    expect(registrySkillMarkdownUrls("acme/skills", "group/deploy")[0]).toBe(
      "https://raw.githubusercontent.com/acme/skills/HEAD/skills/group/deploy/SKILL.md"
    );
    for (const [source, skillId] of [
      ["acme", "deploy"],
      ["acme/skills/extra", "deploy"],
      ["acme/skills", "../../other/repo"],
      ["acme/skills", "deploy?ref=x"],
      ["acme/ski lls", "deploy"],
      ["evil.example/@acme", "deploy#frag"],
      ["acme/skills", ""],
    ]) {
      expect(
        registrySkillMarkdownUrls(source, skillId),
        `${source} ${skillId}`
      ).toEqual([]);
    }
  });
});

describe("parseSkillMarkdown", () => {
  it("should split the frontmatter from the instructions", () => {
    expect(parseSkillMarkdown(SKILL_MD)).toEqual({
      name: "web-design-guidelines",
      description: "Review UI code for guideline compliance.",
      content:
        "# Web Interface Guidelines\n\nFetch the guidelines, then review the files.",
    });
  });

  it("should take a file without frontmatter as instructions", () => {
    expect(parseSkillMarkdown("  # Just do it\n")).toEqual({
      name: null,
      description: null,
      content: "# Just do it",
    });
  });
});

describe("fetchRegistrySkillMarkdown", () => {
  const [first, second] = registrySkillMarkdownUrls("acme/skills", "deploy");

  it("should return the first layout that exists", async () => {
    const fetchImpl = respond({ [first]: 404, [second]: SKILL_MD });
    const result = await fetchRegistrySkillMarkdown(
      { source: "acme/skills", skillId: "deploy" },
      fetchImpl
    );
    expect(result).toMatchObject({
      name: "web-design-guidelines",
      url: second,
    });
    expect(result?.content.startsWith("# Web Interface Guidelines")).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("should skip a layout that errors or is empty, and give up quietly", async () => {
    const result = await fetchRegistrySkillMarkdown(
      { source: "acme/skills", skillId: "deploy" },
      respond({
        [first]: new Error("socket hang up"),
        [second]: "---\nname: x\n---\n",
      })
    );
    expect(result).toBeNull();
  });

  it("should fetch nothing for an unsafe source", async () => {
    const fetchImpl = respond({});
    expect(
      await fetchRegistrySkillMarkdown(
        { source: "acme/skills", skillId: "../x" },
        fetchImpl
      )
    ).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("should cap a very large file", async () => {
    const result = await fetchRegistrySkillMarkdown(
      { source: "acme/skills", skillId: "deploy" },
      respond({ [first]: "x".repeat(REGISTRY_SKILL_MAX_CHARS + 500) })
    );
    expect(result?.content.length).toBe(REGISTRY_SKILL_MAX_CHARS);
  });
});
