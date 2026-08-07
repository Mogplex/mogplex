"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { InfoCircle, Trash } from "iconoir-react"
import type { FlowNode } from "@/lib/types"
import type { FlowCanvasNode } from "@/lib/flows/editor"
import { WorkflowSelect, InspectorField, InspectorCallout } from "./inspector-shared"

type ParallelNodeData = Extract<FlowNode, { type: "parallel" }>["data"]
type JoinNodeData = Extract<FlowNode, { type: "join" }>["data"]
type DelayNodeData = Extract<FlowNode, { type: "delay" }>["data"]
type EndNodeData = Extract<FlowNode, { type: "end" }>["data"]

export interface ParallelInspectorProps {
  node: FlowCanvasNode & { data: ParallelNodeData }
  updateNodeData: (
    nodeId: string,
    updater: (data: Record<string, unknown>) => Record<string, unknown>,
    options?: { mergeKey?: string | null },
  ) => void
  onDelete: () => void
}

export function ParallelInspector({
  node,
  updateNodeData,
  onDelete,
}: ParallelInspectorProps) {
  return (
    <>
      <InspectorField label="Label">
        <Input
          value={String(node.data.label || "")}
          onChange={(event) => updateNodeData(node.id, (data) => ({
            ...data,
            label: event.target.value,
          }), { mergeKey: `parallel-label-${node.id}` })}
        />
      </InspectorField>
      <InspectorCallout variant="hint" icon={<InfoCircle />}>
        Wire at least two outgoing branches from this split, then merge them with a Join node.
      </InspectorCallout>
      <div className="flex justify-end border-t border-border/60 pt-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onDelete}
          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash />
          Delete node
        </Button>
      </div>
    </>
  )
}

export interface JoinInspectorProps {
  node: FlowCanvasNode & { data: JoinNodeData }
  updateNodeData: (
    nodeId: string,
    updater: (data: Record<string, unknown>) => Record<string, unknown>,
    options?: { mergeKey?: string | null },
  ) => void
  onDelete: () => void
}

export function JoinInspector({
  node,
  updateNodeData,
  onDelete,
}: JoinInspectorProps) {
  return (
    <>
      <InspectorField label="Label">
        <Input
          value={String(node.data.label || "")}
          onChange={(event) => updateNodeData(node.id, (data) => ({
            ...data,
            label: event.target.value,
          }), { mergeKey: `join-label-${node.id}` })}
        />
      </InspectorField>
      <InspectorField label="Policy">
        <WorkflowSelect
          ariaLabel="Policy"
          value={node.data.policy ?? "wait_for_all"}
          onValueChange={(value) => {
            const nextPolicy = value as "wait_for_all" | "wait_for_any" | "quorum"
            updateNodeData(node.id, (data) => ({
              ...data,
              policy: nextPolicy,
              quorum: nextPolicy === "quorum"
                ? (typeof data.quorum === "number" && (data.quorum as number) >= 2 ? data.quorum : 2)
              : null,
            }), { mergeKey: `join-policy-${node.id}` })
          }}
          options={[
            {
              value: "wait_for_all",
              label: "Wait for all branches",
            },
            {
              value: "wait_for_any",
              label: "Wait for any branch",
            },
            {
              value: "quorum",
              label: "Quorum (N of branches)",
            },
          ]}
        />
      </InspectorField>
      {node.data.policy === "quorum" && (
        <InspectorField label="Quorum">
          <Input
            type="number"
            min={2}
            step={1}
            value={typeof node.data.quorum === "number" ? node.data.quorum : 2}
            onChange={(event) => {
              const parsed = Number(event.target.value)
              updateNodeData(node.id, (data) => ({
                ...data,
                quorum: Number.isFinite(parsed) && parsed >= 2 ? Math.trunc(parsed) : 2,
              }), { mergeKey: `join-quorum-${node.id}` })
            }}
          />
        </InspectorField>
      )}
      <div className="flex justify-end border-t border-border/60 pt-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onDelete}
          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash />
          Delete node
        </Button>
      </div>
    </>
  )
}

export interface DelayInspectorProps {
  node: FlowCanvasNode & { data: DelayNodeData }
  updateNodeData: (
    nodeId: string,
    updater: (data: Record<string, unknown>) => Record<string, unknown>,
    options?: { mergeKey?: string | null },
  ) => void
  onDelete: () => void
}

export function DelayInspector({
  node,
  updateNodeData,
  onDelete,
}: DelayInspectorProps) {
  return (
    <>
      <InspectorField label="Label">
        <Input
          value={String(node.data.label || "")}
          onChange={(event) => updateNodeData(node.id, (data) => ({
            ...data,
            label: event.target.value,
          }), { mergeKey: `delay-label-${node.id}` })}
        />
      </InspectorField>
      <div className="grid gap-3 @xs:grid-cols-2">
        <InspectorField label="Duration">
          <Input
            type="number"
            min={1}
            step={1}
            value={node.data.duration}
            onChange={(event) => updateNodeData(node.id, (data) => ({
              ...data,
              duration: Number(event.target.value || 1),
            }), { mergeKey: `delay-duration-${node.id}` })}
          />
        </InspectorField>
        <InspectorField label="Unit">
          <WorkflowSelect
            ariaLabel="Unit"
            value={node.data.unit}
            onValueChange={(value) => updateNodeData(node.id, (data) => ({
              ...data,
              unit: value,
            }), { mergeKey: `delay-unit-${node.id}` })}
            options={[
              { value: "seconds", label: "Seconds" },
              { value: "minutes", label: "Minutes" },
              { value: "hours", label: "Hours" },
            ]}
          />
        </InspectorField>
      </div>
      <div className="flex justify-end border-t border-border/60 pt-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onDelete}
          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash />
          Delete node
        </Button>
      </div>
    </>
  )
}

export interface EndInspectorProps {
  node: FlowCanvasNode & { data: EndNodeData }
  updateNodeData: (
    nodeId: string,
    updater: (data: Record<string, unknown>) => Record<string, unknown>,
    options?: { mergeKey?: string | null },
  ) => void
}

export function EndInspector({
  node,
  updateNodeData,
}: EndInspectorProps) {
  return (
    <InspectorField label="Label">
      <Input
        value={String(node.data.label || "")}
        onChange={(event) => updateNodeData(node.id, (data) => ({
          ...data,
          label: event.target.value,
        }), { mergeKey: `end-label-${node.id}` })}
      />
    </InspectorField>
  )
}
