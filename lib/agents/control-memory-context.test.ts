import { describe, expect, it } from "vitest";
import type { Memory } from "@/lib/memories-client";
import {
  CONTROL_MEMORY_ITEM_MAX_CHARS,
  CONTROL_MEMORY_LIMITS,
  CONTROL_MEMORY_MAX_CHARS,
  CONTROL_MEMORY_TIMEOUT_MS,
  formatControlMemoryContext,
  isPromptWorthy,
  loadControlMemoryContext,
  selectControlMemories,
  type ControlMemoryContextDeps,
} from "./control-memory-context";

let seq = 0;
function memory(
  lane: Memory["lane"],
  content: string,
  metadata?: Record<string, unknown>
): Memory {
  seq += 1;
  return {
    id: `m-${seq}`,
    lane,
    content,
    metadata,
    created_at: "2026-09-10T00:00:00.000Z",
    updated_at: "2026-09-12T00:00:00.000Z",
  };
}

describe("isPromptWorthy", () => {
  it("keeps global rows and rows scoped to the selected repo", () => {
    expect(isPromptWorthy(memory("semantic", "global fact"), "repo-1")).toBe(
      true
    );
    expect(
      isPromptWorthy(
        memory("semantic", "repo fact", { repo_id: "repo-1" }),
        "repo-1"
      )
    ).toBe(true);
  });

  it("drops rows scoped to a different repo or with no selected repo", () => {
    const scoped = memory("semantic", "other repo", { repo_id: "repo-2" });
    expect(isPromptWorthy(scoped, "repo-1")).toBe(false);
    expect(isPromptWorthy(scoped, null)).toBe(false);
  });

  it("never prompts with session rows or machine log writers", () => {
    expect(isPromptWorthy(memory("session", "user said hi"), "repo-1")).toBe(
      false
    );
    expect(
      isPromptWorthy(
        memory("episodic", "pr_review: reviewed #1", { source: "automation" }),
        "repo-1"
      )
    ).toBe(false);
    expect(
      isPromptWorthy(
        memory("episodic", "codex: ran task", { source: "harness" }),
        "repo-1"
      )
    ).toBe(false);
  });
});

describe("selectControlMemories", () => {
  it("returns null when nothing survives filtering", () => {
    expect(
      selectControlMemories({
        repoId: "repo-1",
        semantic: [memory("semantic", "x", { repo_id: "repo-2" })],
        procedural: [],
        episodic: [memory("episodic", "y", { source: "automation" })],
        relevant: [],
      })
    ).toBeNull();
  });

  it("caps each lane and drops a relevance hit already listed under its lane", () => {
    const semantic = Array.from({ length: 30 }, (_, i) =>
      memory("semantic", `fact ${i}`)
    );
    const selected = selectControlMemories({
      repoId: null,
      semantic,
      procedural: [],
      episodic: [],
      relevant: [semantic[0], memory("procedural", "unique hit")],
    });
    expect(selected?.semantic).toHaveLength(CONTROL_MEMORY_LIMITS.semantic);
    expect(selected?.relevant.map((row) => row.content)).toEqual([
      "unique hit",
    ]);
  });
});

describe("formatControlMemoryContext", () => {
  it("renders only non-empty sections, dates events, and clips long items", () => {
    const long = "x".repeat(CONTROL_MEMORY_ITEM_MAX_CHARS + 50);
    const text = formatControlMemoryContext({
      semantic: [memory("semantic", "Prefers pnpm")],
      procedural: [],
      episodic: [memory("episodic", "Shipped pricing page")],
      relevant: [memory("semantic", long)],
    });
    expect(text).toContain("## Facts about this operator and repository");
    expect(text).toContain("- Prefers pnpm");
    expect(text).not.toContain("## Procedures");
    expect(text).toContain("- [2026-09-12] Shipped pricing page");
    expect(text).toContain("…");
    expect(text?.length).toBeLessThanOrEqual(CONTROL_MEMORY_MAX_CHARS);
  });

  it("returns null for a null selection", () => {
    expect(formatControlMemoryContext(null)).toBeNull();
  });
});

describe("loadControlMemoryContext", () => {
  const rows = {
    semantic: [memory("semantic", "Uses conventional commits")],
    procedural: [memory("procedural", "Run pnpm test before commit")],
    episodic: [
      memory("episodic", "Chose Neon over Supabase", { repo_id: "repo-1" }),
    ],
  };

  function deps(overrides: Partial<ControlMemoryContextDeps> = {}) {
    const calls: Array<{ lane?: string; query?: string; scope?: unknown }> = [];
    const impl: ControlMemoryContextDeps = {
      listByLane: async (lane, _limit, scope) => {
        calls.push({ lane, scope });
        return rows[lane as keyof typeof rows] ?? [];
      },
      searchMemories: async (query, _limit, scope) => {
        calls.push({ query, scope });
        return [memory("semantic", "Related fact")];
      },
      ...overrides,
    };
    return { impl, calls };
  }

  it("scopes events and search to the repo and leaves facts global", async () => {
    const { impl, calls } = deps();
    const text = await loadControlMemoryContext(
      { userId: "u1", repoId: "repo-1", query: "add billing" },
      impl
    );
    expect(text).toContain("Uses conventional commits");
    expect(text).toContain("Run pnpm test before commit");
    expect(text).toContain("Chose Neon over Supabase");
    expect(text).toContain("Related fact");
    expect(calls.find((c) => c.lane === "semantic")?.scope).toBeUndefined();
    expect(calls.find((c) => c.lane === "episodic")?.scope).toEqual({
      repoId: "repo-1",
    });
    expect(calls.find((c) => c.query)?.scope).toEqual({ repoId: "repo-1" });
  });

  it("skips the relevance search when the request is empty", async () => {
    const { impl, calls } = deps();
    await loadControlMemoryContext({ userId: "u1", query: "   " }, impl);
    expect(calls.some((c) => c.query !== undefined)).toBe(false);
  });

  it("fails open to null when the store throws or stalls", async () => {
    const throwing = deps({
      listByLane: async () => {
        throw new Error("db down");
      },
    });
    expect(
      await loadControlMemoryContext(
        { userId: "u1", query: "x" },
        throwing.impl
      )
    ).toBeNull();

    const stalled = deps({
      listByLane: () => new Promise(() => {}),
    });
    const started = Date.now();
    expect(
      await loadControlMemoryContext({ userId: "u1", query: "x" }, stalled.impl)
    ).toBeNull();
    expect(Date.now() - started).toBeGreaterThanOrEqual(
      CONTROL_MEMORY_TIMEOUT_MS - 50
    );
  });
});
