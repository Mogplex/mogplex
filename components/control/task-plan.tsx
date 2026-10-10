"use client";

import { getToolOrDynamicToolName, isToolUIPart, type UIMessage } from "ai";
import { controlToolOutcome } from "@/lib/control/tool-outcome";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function TaskPlan({ messages }: { messages: UIMessage[] }) {
  const plan = messages.flatMap(message => message.parts).findLast(part =>
    isToolUIPart(part) && getToolOrDynamicToolName(part) === "plan_mission" && part.state === "output-available" && controlToolOutcome(part.state, part.output) === "done"
  );
  const input = plan && "input" in plan ? asRecord(plan.input) : null;
  const tasks = Array.isArray(input?.tasks) ? input.tasks.map(asRecord).filter(task => task && typeof task.title === "string") : [];
  return <div className="space-y-5 p-5 text-sm">
    <div>
      <h2 className="font-semibold">{typeof input?.title === "string" ? input.title : "Plan"}</h2>
      <p className="mt-1 text-muted-foreground">{tasks.length ? "The agent’s saved plan for this task." : "No plan saved yet. Plans the agent saves for this task will appear here."}</p>
    </div>
    <ol className="space-y-5">
      {tasks.map((task, index) => <li key={String(task?.slug ?? index)} className="flex gap-3">
        <span className="text-muted-foreground font-mono text-xs pt-0.5">{index + 1}.</span>
        <div className="min-w-0 space-y-1">
          <h3 className="font-medium">{String(task?.title)}</h3>
          {typeof task?.prompt === "string" && <p className="whitespace-pre-wrap break-words text-muted-foreground">{task.prompt}</p>}
        </div>
      </li>)}
    </ol>
  </div>;
}
