import {
  defaultCandidateDecide,
  labelCandidates,
  observeQuietly,
  type CandidateDecideFn,
} from "./candidates";
import { clipText } from "./state";
import type { DecisionScope } from "./types";

const REQUEST_MAX_CHARS = 4000;
const MEMORY_MAX_CHARS = 600;

export type InjectedMemory = { id: string; content: string };

/** The memories a turn put in its prompt, by the section they appeared in. */
export type InjectedMemoryGroups = Readonly<
  Record<string, readonly InjectedMemory[]>
>;

export type MemoryRelevanceInput = {
  /** The operator's latest message. */
  request: string;
  groups: InjectedMemoryGroups;
  scope: DecisionScope;
};

/**
 * Record which of the injected memories bear on the request. The prompt is
 * already built when this runs and nothing is filtered: the answers sit next
 * to what was injected so a relevance filter can be judged before it exists.
 * Never rejects, and a turn without memories or request text asks nothing.
 */
export function observeMemoryRelevance(
  input: MemoryRelevanceInput,
  decideFn: CandidateDecideFn = defaultCandidateDecide
): Promise<void> {
  return observeQuietly("memory relevance", async () => {
    const request = input.request.trim();
    const injected = Object.entries(input.groups).flatMap(([group, rows]) =>
      rows.map((memory) => ({ group, memory }))
    );
    if (!request || injected.length === 0) return;
    const { labelled, omitted } = labelCandidates(injected);
    await decideFn(
      "memory_relevance",
      {
        request: clipText(request, REQUEST_MAX_CHARS),
        memories: Object.fromEntries(
          labelled.map(({ key, item }) => [
            key,
            clipText(item.memory.content.trim(), MEMORY_MAX_CHARS),
          ])
        ),
      },
      input.scope,
      {
        candidates: labelled.map(({ key }) => key),
        baseline: {
          injected: injected.length,
          byGroup: Object.fromEntries(
            Object.entries(input.groups).map(([group, rows]) => [
              group,
              rows.length,
            ])
          ),
        },
        metadata: {
          omitted,
          candidates: Object.fromEntries(
            labelled.map(({ key, item }) => [
              key,
              { id: item.memory.id, group: item.group },
            ])
          ),
        },
      }
    );
  });
}
