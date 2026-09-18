import type { Memory, MemoryLane, MemoryScope } from "@/lib/memories-client";

/**
 * Memory context for the Control coordinator.
 *
 * Every Control turn starts with the operator's durable memories in the
 * system prompt: stable facts (semantic), accepted procedures (procedural),
 * and the most recent events (episodic) for the selected repository, plus a
 * relevance search against the current request. Session-lane rows are run
 * logs and never reach the prompt. Loading is fail-open and time-boxed so a
 * slow memory store can never delay a turn.
 */

export const CONTROL_MEMORY_TIMEOUT_MS = 2_500;
export const CONTROL_MEMORY_MAX_CHARS = 6_000;
export const CONTROL_MEMORY_ITEM_MAX_CHARS = 600;
export const CONTROL_MEMORY_LIMITS = {
  semantic: 20,
  procedural: 12,
  episodic: 8,
  relevant: 8,
} as const;

/** Writers whose rows are machine logs, not memories worth prompting with. */
const EXCLUDED_SOURCES = new Set(["automation", "harness"]);

export type ControlMemoryContextInput = {
  userId: string;
  repoId?: string | null;
  /** Latest operator text; drives the relevance search. */
  query: string;
};

export type ControlMemoryContextDeps = {
  listByLane: (
    lane: MemoryLane,
    limit: number,
    scope?: MemoryScope
  ) => Promise<Memory[]>;
  searchMemories: (
    query: string,
    limit: number,
    scope?: MemoryScope
  ) => Promise<Memory[]>;
};

export type ControlMemoryContext = {
  semantic: Memory[];
  procedural: Memory[];
  episodic: Memory[];
  relevant: Memory[];
};

function repoIdOf(memory: Memory): string | null {
  const value = memory.metadata?.repo_id;
  return typeof value === "string" && value ? value : null;
}

function sourceOf(memory: Memory): string | null {
  const value = memory.metadata?.source;
  return typeof value === "string" ? value : null;
}

/**
 * A memory belongs in the prompt when it is global (no repo) or scoped to
 * the selected repo, and was not written by a machine log writer.
 */
export function isPromptWorthy(
  memory: Memory,
  repoId: string | null | undefined
): boolean {
  if (memory.lane === "session") return false;
  const source = sourceOf(memory);
  if (source && EXCLUDED_SOURCES.has(source)) return false;
  const memoryRepo = repoIdOf(memory);
  if (!memoryRepo) return true;
  return Boolean(repoId) && memoryRepo === repoId;
}

function dedupe(groups: Memory[][]): Memory[][] {
  const seen = new Set<string>();
  return groups.map((group) =>
    group.filter((memory) => {
      if (seen.has(memory.id)) return false;
      seen.add(memory.id);
      return true;
    })
  );
}

/**
 * Pure selection step: filter each lane to prompt-worthy rows, cap per lane,
 * and drop cross-lane duplicates (a relevance hit that is already listed
 * under its lane is not repeated).
 */
export function selectControlMemories(input: {
  repoId?: string | null;
  semantic: Memory[];
  procedural: Memory[];
  episodic: Memory[];
  relevant: Memory[];
}): ControlMemoryContext | null {
  const keep = (rows: Memory[], limit: number) =>
    rows.filter((row) => isPromptWorthy(row, input.repoId)).slice(0, limit);
  const [semantic, procedural, episodic, relevant] = dedupe([
    keep(input.semantic, CONTROL_MEMORY_LIMITS.semantic),
    keep(input.procedural, CONTROL_MEMORY_LIMITS.procedural),
    keep(input.episodic, CONTROL_MEMORY_LIMITS.episodic),
    keep(input.relevant, CONTROL_MEMORY_LIMITS.relevant),
  ]);
  if (
    semantic.length + procedural.length + episodic.length + relevant.length ===
    0
  ) {
    return null;
  }
  return { semantic, procedural, episodic, relevant };
}

function clip(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > CONTROL_MEMORY_ITEM_MAX_CHARS
    ? `${flat.slice(0, CONTROL_MEMORY_ITEM_MAX_CHARS - 1)}…`
    : flat;
}

function dateOf(memory: Memory): string {
  return (memory.updated_at || memory.created_at).slice(0, 10);
}

/**
 * Render the selected memories as the `<memory>` block body. Sections are
 * omitted when empty; the whole block is truncated to CONTROL_MEMORY_MAX_CHARS
 * so a large store cannot crowd out the rest of the prompt.
 */
export function formatControlMemoryContext(
  context: ControlMemoryContext | null
): string | null {
  if (!context) return null;
  const sections: string[] = [];
  const push = (title: string, rows: Memory[], withDate = false) => {
    if (rows.length === 0) return;
    sections.push(
      [
        `## ${title}`,
        ...rows.map((row) =>
          withDate
            ? `- [${dateOf(row)}] ${clip(row.content)}`
            : `- ${clip(row.content)}`
        ),
      ].join("\n")
    );
  };
  push("Facts about this operator and repository", context.semantic);
  push("Procedures the operator has accepted", context.procedural);
  push("Recent events", context.episodic, true);
  push("Related to this request", context.relevant);
  if (sections.length === 0) return null;
  const body = sections.join("\n\n");
  return body.length > CONTROL_MEMORY_MAX_CHARS
    ? `${body.slice(0, CONTROL_MEMORY_MAX_CHARS - 1)}…`
    : body;
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number
): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Load and format memory context for one Control turn. Never throws and
 * never takes longer than CONTROL_MEMORY_TIMEOUT_MS; returns null when the
 * operator has no prompt-worthy memories or the store is slow.
 */
export async function loadControlMemoryContext(
  input: ControlMemoryContextInput,
  deps: ControlMemoryContextDeps
): Promise<string | null> {
  const repoScope: MemoryScope | undefined = input.repoId
    ? { repoId: input.repoId }
    : undefined;
  const fetchLimit = 50;
  const query = input.query.trim().slice(0, 400);
  const loaded = await withTimeout(
    Promise.all([
      deps.listByLane("semantic", fetchLimit),
      deps.listByLane("procedural", fetchLimit),
      deps.listByLane(
        "episodic",
        CONTROL_MEMORY_LIMITS.episodic * 3,
        repoScope
      ),
      query
        ? deps.searchMemories(
            query,
            CONTROL_MEMORY_LIMITS.relevant * 2,
            repoScope
          )
        : Promise.resolve([] as Memory[]),
    ]),
    CONTROL_MEMORY_TIMEOUT_MS
  );
  if (!loaded) return null;
  const [semantic, procedural, episodic, relevant] = loaded;
  return formatControlMemoryContext(
    selectControlMemories({
      repoId: input.repoId,
      semantic,
      procedural,
      episodic,
      relevant,
    })
  );
}

/**
 * Production wiring: memories client behind the DI boundary above.
 *
 * Team scope is intentionally not applied here. Every memory row is owned by
 * `userId` (the store filters on `user_id`, never on team membership), so a
 * team-tagged row is still the operator's own note, and Control's writers
 * (`memory_write`, `handoff_note`, promotion) stamp no team id. Control
 * therefore reads everything the operator owns, personal or team-tagged;
 * the widget's personal/team toggle is a browsing filter, not a boundary.
 */
export async function loadControlMemoryContextForUser(
  input: ControlMemoryContextInput
): Promise<string | null> {
  try {
    const mod = await import("@/lib/memories-client");
    const client = mod.createMemoriesClient(input.userId);
    return await loadControlMemoryContext(input, {
      listByLane: (lane, limit, scope) =>
        mod.listByLane(client, lane, limit, scope),
      searchMemories: (query, limit, scope) =>
        mod.searchMemories(client, query, undefined, limit, scope),
    });
  } catch (error) {
    console.warn("[control/memory] failed to load memory context", {
      error: error instanceof Error ? error.message : error,
    });
    return null;
  }
}
