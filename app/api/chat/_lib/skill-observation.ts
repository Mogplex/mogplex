import { after } from "next/server";
import { observeSkillSelection } from "@/lib/decisions/skills";
import type { DecisionScope } from "@/lib/decisions/types";
import type { ConversationSkills } from "@/lib/skill-catalog/chat";

export type ChatSkillObservationDeps = {
  observe: typeof observeSkillSelection;
  /** Keeps the function alive until the record is written. */
  runAfterResponse: (work: () => Promise<void>) => void;
};

const defaultDeps: ChatSkillObservationDeps = {
  observe: observeSkillSelection,
  runAfterResponse: (work) => after(work),
};

/**
 * Records which of the user's skills a workspace chat turn needed. It runs
 * beside the turn and is handed to `after()`, so it never delays the first
 * token and is not dropped when the response closes. A user who keeps no
 * skills asks nothing.
 */
export function observeChatSkills(
  input: { skills: ConversationSkills; request: string; scope: DecisionScope },
  deps: ChatSkillObservationDeps = defaultDeps
): void {
  if (input.skills.available.length === 0) return;
  const observed = deps.observe({
    catalog: {
      skills: input.skills.available,
      invokedIds: input.skills.invoked.map((skill) => skill.id),
    },
    request: input.request,
    delivery: "inline",
    scope: input.scope,
  });
  try {
    deps.runAfterResponse(() => observed);
  } catch {
    // Outside a request scope the check still runs; it just is not held open.
  }
}
