"use client"

import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { InfoCircle } from "iconoir-react"
import type { FlowNode } from "@/lib/types"
import type { FlowCanvasNode } from "@/lib/flows/editor"
import { InspectorField, InspectorCallout } from "./inspector-shared"

type ActionNodeData = Extract<FlowNode, { type: "action" }>["data"]

export type SandboxRunCommandData = Extract<ActionNodeData, { operation: "sandbox.run_command" }>

export type UpdateNodeData = (
  nodeId: string,
  updater: (data: Record<string, unknown>) => Record<string, unknown>,
  options?: { mergeKey?: string | null },
) => void

export interface SandboxFieldsProps {
  node: FlowCanvasNode & { data: SandboxRunCommandData }
  updateNodeData: UpdateNodeData
}

export function SandboxRunCommandFields({ node, updateNodeData }: SandboxFieldsProps) {
  return (
    <>
      <InspectorField label="Command">
        <Textarea
          data-testid="flow-action-command"
          value={node.data.command}
          onChange={(event) => updateNodeData(node.id, (data) => ({
            ...data,
            command: event.target.value,
          }), { mergeKey: `action-command-${node.id}` })}
          rows={5}
          placeholder="pnpm test"
          className="font-mono text-xs"
        />
      </InspectorField>
      <InspectorCallout variant="hint" icon={<InfoCircle />}>
        Command text is static. Workflow templates are disabled here
        so untrusted trigger data cannot become shell source.
      </InspectorCallout>
      <InspectorField label="Working directory (optional)">
        <Input
          data-testid="flow-action-working-directory"
          value={node.data.workingDirectory ?? ""}
          onChange={(event) => updateNodeData(node.id, (data) => ({
            ...data,
            workingDirectory: event.target.value.trim()
              ? event.target.value
              : null,
          }), { mergeKey: `action-working-directory-${node.id}` })}
          placeholder="apps/web"
          className="font-mono"
        />
      </InspectorField>
      <InspectorCallout variant="info" icon={<InfoCircle />}>
        Commands run against the trigger branch in an isolated sandbox.
        Consecutive command actions reuse that workflow workspace.
      </InspectorCallout>
    </>
  )
}
