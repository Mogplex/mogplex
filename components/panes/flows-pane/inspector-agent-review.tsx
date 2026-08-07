"use client"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import type { FlowCanvasNode } from "@/lib/flows/editor"
import type { FlowAgentHarness, FlowNode, Repo, TriggerEvent } from "@/lib/types"
import { INSPECTOR_SELECT_CLASS } from "./constants"
import type { AutomationSandboxTestResult } from "./types"
import { WorkflowSelect } from "./inspector-shared"

type AgentNodeData = Extract<FlowNode, { type: "agent" }>["data"]

type UpdateNodeData = (
  nodeId: string,
  updater: (data: Record<string, unknown>) => Record<string, unknown>,
  options?: { mergeKey?: string | null },
) => void

export interface ReviewOptionsSectionProps {
  node: FlowCanvasNode & { data: AgentNodeData }
  updateNodeData: UpdateNodeData
  selectedAgentHarness: FlowAgentHarness
  selectedStartConfig: { event: TriggerEvent } | null
  sandboxTestRepoId: string
  onSandboxTestRepoIdChange: (id: string) => void
  sandboxTestRepos: Repo[]
  sandboxTestResult: AutomationSandboxTestResult | null
  sandboxTestError: string | null
  sandboxTestRunning: boolean
  onRunSandboxTest: () => void
  onClearSandboxTest: () => void
}

export function ReviewOptionsSection({
  node,
  updateNodeData,
  selectedAgentHarness,
  selectedStartConfig,
  sandboxTestRepoId,
  onSandboxTestRepoIdChange,
  sandboxTestRepos,
  sandboxTestResult,
  sandboxTestError,
  sandboxTestRunning,
  onRunSandboxTest,
  onClearSandboxTest,
}: ReviewOptionsSectionProps) {
  return (
    <div className="space-y-2">
      {selectedAgentHarness === "mogplex" && (
        <>
          <label
            htmlFor={`agent-autofix-${node.id}`}
            className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/80 bg-card/60 px-3 py-3 transition-colors hover:border-primary/30 hover:bg-card/80"
          >
            <Checkbox
              id={`agent-autofix-${node.id}`}
              checked={node.data.autofix === true}
              onCheckedChange={(checked) => {
                const enabled = checked === true
                updateNodeData(node.id, (data) => ({
                  ...data,
                  autofix: enabled,
                  autofixSandbox: enabled ? data.autofixSandbox === true : false,
                }), { mergeKey: `agent-autofix-${node.id}` })
              }}
              className="mt-0.5"
            />
            <span className="space-y-1">
              <span className="block text-sm font-medium text-foreground">Auto-fix issues</span>
              <span className="block text-xs leading-5 text-muted-foreground">
                Allow this reviewer node to push follow-up fixes when it reports material PR findings.
              </span>
            </span>
          </label>

          {node.data.autofix === true && (
            <SandboxOptions
              node={node}
              updateNodeData={updateNodeData}
              sandboxTestRepoId={sandboxTestRepoId}
              onSandboxTestRepoIdChange={onSandboxTestRepoIdChange}
              sandboxTestRepos={sandboxTestRepos}
              sandboxTestResult={sandboxTestResult}
              sandboxTestError={sandboxTestError}
              sandboxTestRunning={sandboxTestRunning}
              onRunSandboxTest={onRunSandboxTest}
              onClearSandboxTest={onClearSandboxTest}
            />
          )}
        </>
      )}

      <label
        htmlFor={`agent-automerge-${node.id}`}
        className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/80 bg-card/60 px-3 py-3 transition-colors hover:border-primary/30 hover:bg-card/80"
      >
        <Checkbox
          id={`agent-automerge-${node.id}`}
          checked={node.data.autoMerge === true}
          onCheckedChange={(checked) => updateNodeData(node.id, (data) => ({
            ...data,
            autoMerge: checked === true,
          }), { mergeKey: `agent-automerge-${node.id}` })}
          className="mt-0.5"
        />
        <span className="space-y-1">
          <span className="block text-sm font-medium text-foreground">Auto-merge when review passes</span>
          <span className="block text-xs leading-5 text-muted-foreground">
            You do not need to rerun the review when CI finishes. GitHub waits for required checks and branch protection, then squash-merges the pull request.
          </span>
        </span>
      </label>

      {selectedAgentHarness === "mogplex" && selectedStartConfig?.event === "ci_failure" && (
        <label
          htmlFor={`agent-autorevert-${node.id}`}
          className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/80 bg-card/60 px-3 py-3 transition-colors hover:border-primary/30 hover:bg-card/80"
        >
          <Checkbox
            id={`agent-autorevert-${node.id}`}
            checked={node.data.autoRevert === true}
            onCheckedChange={(checked) => updateNodeData(node.id, (data) => ({
              ...data,
              autoRevert: checked === true,
            }), { mergeKey: `agent-autorevert-${node.id}` })}
            className="mt-0.5"
          />
          <span className="space-y-1">
            <span className="block text-sm font-medium text-foreground">Allow revert PRs</span>
            <span className="block text-xs leading-5 text-muted-foreground">
              Let this agent open a revert PR when the pushed commit broke CI. Only works while that commit is still the branch head, and never pushes to the branch directly.
            </span>
          </span>
        </label>
      )}

      {selectedAgentHarness === "mogplex" && (
        <label
          htmlFor={`agent-require-approval-${node.id}`}
          className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/80 bg-card/60 px-3 py-3 transition-colors hover:border-primary/30 hover:bg-card/80"
        >
          <Checkbox
            id={`agent-require-approval-${node.id}`}
            checked={node.data.requireApproval === true}
            onCheckedChange={(checked) => updateNodeData(node.id, (data) => ({
              ...data,
              requireApproval: checked === true,
            }), { mergeKey: `agent-require-approval-${node.id}` })}
            className="mt-0.5"
          />
          <span className="space-y-1">
            <span className="block text-sm font-medium text-foreground">Require approval for tool calls</span>
            <span className="block text-xs leading-5 text-muted-foreground">
              Pause before each tool call until you approve or deny it from Observability, with an optional note to steer the agent. Waits share a 10-minute window per run; unanswered calls are denied and the run continues.
            </span>
          </span>
        </label>
      )}
    </div>
  )
}

interface SandboxOptionsProps {
  node: FlowCanvasNode & { data: AgentNodeData }
  updateNodeData: UpdateNodeData
  sandboxTestRepoId: string
  onSandboxTestRepoIdChange: (id: string) => void
  sandboxTestRepos: Repo[]
  sandboxTestResult: AutomationSandboxTestResult | null
  sandboxTestError: string | null
  sandboxTestRunning: boolean
  onRunSandboxTest: () => void
  onClearSandboxTest: () => void
}

function SandboxOptions({
  node,
  updateNodeData,
  sandboxTestRepoId,
  onSandboxTestRepoIdChange,
  sandboxTestRepos,
  sandboxTestResult,
  sandboxTestError,
  sandboxTestRunning,
  onRunSandboxTest,
  onClearSandboxTest,
}: SandboxOptionsProps) {
  return (
    <div className="space-y-3 border-l border-border/70 pl-4">
      <label
        htmlFor={`agent-autofix-sandbox-${node.id}`}
        className="flex cursor-pointer items-start gap-3 py-1"
      >
        <Checkbox
          id={`agent-autofix-sandbox-${node.id}`}
          checked={node.data.autofixSandbox === true}
          onCheckedChange={(checked) => updateNodeData(node.id, (data) => ({
            ...data,
            autofixSandbox: checked === true,
          }), { mergeKey: `agent-autofix-sandbox-${node.id}` })}
          className="mt-0.5"
        />
        <span className="space-y-1">
          <span className="block text-sm font-medium text-foreground">Use sandbox for autofix</span>
          <span className="block text-xs leading-5 text-muted-foreground">
            Launch an isolated repo sandbox, inject configured sandbox env vars, and push fixes from that checkout.
          </span>
        </span>
      </label>

      {node.data.autofixSandbox === true && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <WorkflowSelect
              ariaLabel="Sandbox test repository"
              value={sandboxTestRepoId}
              onValueChange={(value) => {
                onSandboxTestRepoIdChange(value)
                onClearSandboxTest()
              }}
              disabled={sandboxTestRunning || sandboxTestRepos.length === 0}
              className={cn(INSPECTOR_SELECT_CLASS, "min-w-0 flex-1")}
              options={
                sandboxTestRepos.length === 0
                  ? [{
                      value: "",
                      label: "No repos available",
                    }]
                  : sandboxTestRepos.map((repo) => ({
                      value: repo.id,
                      label: repo.full_name,
                    }))
              }
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onRunSandboxTest}
              disabled={!sandboxTestRepoId || sandboxTestRunning}
              className="h-8 shrink-0 px-3 text-xs"
            >
              {sandboxTestRunning ? "Testing..." : "Test"}
            </Button>
          </div>

          {sandboxTestResult && (
            <div
              className={cn(
                "rounded-md border px-3 py-2 text-xs leading-5",
                sandboxTestResult.ok
                  ? "border-accent-green/30 bg-accent-green/[0.08] text-accent-green"
                  : "border-accent-red/30 bg-accent-red/[0.08] text-accent-red",
              )}
            >
              <div className="font-medium">
                {sandboxTestResult.ok ? "Sandbox setup ready" : sandboxTestResult.error || "Sandbox setup needs attention"}
              </div>
              {sandboxTestResult.env && (
                <div className="mt-1 text-muted-foreground">
                  Env: {sandboxTestResult.env.count} vars from {sandboxTestResult.env.source}
                  {sandboxTestResult.env.configured ? "" : " (no repo env configured)"}
                  {sandboxTestResult.env.warning ? `; ${sandboxTestResult.env.warning}` : ""}
                </div>
              )}
            </div>
          )}

          {sandboxTestError && (
            <div className="rounded-md border border-accent-red/30 bg-accent-red/[0.08] px-3 py-2 text-xs leading-5 text-accent-red">
              {sandboxTestError}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
