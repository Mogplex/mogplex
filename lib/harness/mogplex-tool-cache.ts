import type { Tool } from "ai";

type BuiltTools = { tools: Record<string, Tool>; cleanup: () => Promise<void> };

type Entry = {
  built: Promise<BuiltTools>;
  expiresAt: number;
  inUse: number;
};

/**
 * Reuses one run's built tool set across its MCP requests for a short window,
 * so a harness making many calls does not re-resolve connections and re-dial
 * saved MCP servers each time. Authorization stays per request; only the build
 * is shared. An entry is torn down once it has expired and no call holds it.
 */
export function createToolBuildCache(ttlMs: number, now = () => Date.now()) {
  const entries = new Map<string, Entry>();

  const dispose = (key: string, entry: Entry) => {
    if (entries.get(key) === entry) entries.delete(key);
    void entry.built.then((built) => built.cleanup()).catch(() => undefined);
  };

  const sweep = () => {
    const time = now();
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= time && entry.inUse === 0) dispose(key, entry);
    }
  };

  return {
    /** Borrow the build for `key`, building it if none is fresh. */
    async acquire(
      key: string,
      build: () => Promise<BuiltTools>
    ): Promise<{ tools: Record<string, Tool>; release: () => void }> {
      sweep();
      let entry = entries.get(key);
      if (!entry || entry.expiresAt <= now()) {
        entry = { built: build(), expiresAt: now() + ttlMs, inUse: 0 };
        entries.set(key, entry);
      }
      const held = entry;
      held.inUse += 1;
      let built: BuiltTools;
      try {
        built = await held.built;
      } catch (error) {
        // A failed build is never reused.
        held.inUse -= 1;
        if (entries.get(key) === held) entries.delete(key);
        throw error;
      }
      let released = false;
      return {
        tools: built.tools,
        release: () => {
          if (released) return;
          released = true;
          held.inUse -= 1;
          if (entries.get(key) !== held) {
            if (held.inUse === 0) void built.cleanup().catch(() => undefined);
            return;
          }
          sweep();
          // Close an idle build even if no request comes to sweep it.
          if (held.inUse === 0) {
            const timer = setTimeout(
              sweep,
              Math.max(held.expiresAt - now(), 0)
            );
            timer.unref?.();
          }
        },
      };
    },
    /** Entries still cached; for tests. */
    size: () => entries.size,
  };
}
