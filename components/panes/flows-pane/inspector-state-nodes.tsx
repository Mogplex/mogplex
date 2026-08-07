"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { InfoCircle, Trash } from "iconoir-react"
import type { FlowNode, FlowTransformAssignment, FlowTransformOperation } from "@/lib/types"
import type { FlowCanvasNode } from "@/lib/flows/editor"
import { FLOW_TRANSFORM_OPERATION_OPTIONS } from "./constants"
import { WorkflowSelect, InspectorField, InspectorCallout } from "./inspector-shared"

type SetVariableNodeData = Extract<FlowNode, { type: "set_variable" }>["data"]
type TransformNodeData = Extract<FlowNode, { type: "transform" }>["data"]

export interface SetVariableInspectorProps {
  node: FlowCanvasNode & { data: SetVariableNodeData }
  updateNodeData: (
    nodeId: string,
    updater: (data: Record<string, unknown>) => Record<string, unknown>,
    options?: { mergeKey?: string | null },
  ) => void
  onDelete: () => void
}

export function SetVariableInspector({
  node,
  updateNodeData,
  onDelete,
}: SetVariableInspectorProps) {
  const assignments = node.data.assignments ?? []

  const readAssignments = (data: Record<string, unknown>) =>
    Array.isArray(data.assignments)
      ? (data.assignments as Array<{ key: string; template: string }>)
      : []

  return (
    <>
      <InspectorField label="Label">
        <Input
          value={String(node.data.label || "")}
          onChange={(event) => updateNodeData(node.id, (data) => ({
            ...data,
            label: event.target.value,
          }), { mergeKey: `set-variable-label-${node.id}` })}
        />
      </InspectorField>
      <div className="space-y-3">
        <div className="ui-label">Assignments</div>
        {assignments.map((assignment, index) => (
          <div key={index} className="space-y-2 rounded-lg border border-border/60 bg-card/40 p-3">
            <InspectorField label="Key">
              <Input
                value={String(assignment.key || "")}
                placeholder="e.g. has_tests_changed"
                onChange={(event) => updateNodeData(node.id, (data) => ({
                  ...data,
                  assignments: readAssignments(data).map((entry, i) =>
                    i === index ? { ...entry, key: event.target.value } : entry
                  ),
                }), { mergeKey: `set-variable-key-${node.id}-${index}` })}
              />
            </InspectorField>
            <InspectorField label="Value template">
              <Input
                value={String(assignment.template || "")}
                placeholder='{{ metadata.pr_number }} or PR #{{ metadata.pr_number }}'
                onChange={(event) => updateNodeData(node.id, (data) => ({
                  ...data,
                  assignments: readAssignments(data).map((entry, i) =>
                    i === index ? { ...entry, template: event.target.value } : entry
                  ),
                }), { mergeKey: `set-variable-template-${node.id}-${index}` })}
              />
            </InspectorField>
            <div className="flex justify-end">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => updateNodeData(node.id, (data) => ({
                  ...data,
                  assignments: readAssignments(data).filter((_, i) => i !== index),
                }), { mergeKey: `set-variable-remove-${node.id}-${index}` })}
                className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              >
                Remove
              </Button>
            </div>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => updateNodeData(node.id, (data) => ({
            ...data,
            assignments: [...readAssignments(data), { key: "", template: "" }],
          }), { mergeKey: `set-variable-add-${node.id}` })}
        >
          Add assignment
        </Button>
      </div>
      <InspectorCallout variant="hint" icon={<InfoCircle />}>
        A whole-string template like <span className="font-mono text-foreground">{"{{ metadata.pr_number }}"}</span> preserves the source type. Mixed text interpolates as a string. Read downstream as <span className="font-mono text-foreground">state.&lt;key&gt;</span>.
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

export interface TransformInspectorProps {
  node: FlowCanvasNode & { data: TransformNodeData }
  updateNodeData: (
    nodeId: string,
    updater: (data: Record<string, unknown>) => Record<string, unknown>,
    options?: { mergeKey?: string | null },
  ) => void
  onDelete: () => void
}

export function TransformInspector({
  node,
  updateNodeData,
  onDelete,
}: TransformInspectorProps) {
  const assignments = node.data.assignments ?? []

  const readAssignments = (data: Record<string, unknown>) =>
    Array.isArray(data.assignments)
      ? (data.assignments as FlowTransformAssignment[])
      : []

  const updateAssignment = (
    index: number,
    updater: (
      assignment: FlowTransformAssignment
    ) => FlowTransformAssignment,
    mergeKey: string,
  ) => updateNodeData(node.id, (data) => ({
    ...data,
    assignments: readAssignments(data).map((assignment, assignmentIndex) =>
      assignmentIndex === index ? updater(assignment) : assignment
    ),
  }), { mergeKey })

  return (
    <>
      <InspectorField label="Label">
        <Input
          data-testid="flow-transform-label"
          value={node.data.label}
          onChange={(event) => updateNodeData(node.id, (data) => ({
            ...data,
            label: event.target.value,
          }), { mergeKey: `transform-label-${node.id}` })}
        />
      </InspectorField>
      <div className="space-y-3">
        <div className="ui-label">Transformations</div>
        {assignments.map((assignment, index) => {
          const operation = FLOW_TRANSFORM_OPERATION_OPTIONS.find(
            (option) => option.value === assignment.operation
          ) ?? FLOW_TRANSFORM_OPERATION_OPTIONS[0]
          return (
            <div
              key={index}
              data-testid={`flow-transform-assignment-${index}`}
              className="space-y-2 rounded-lg border border-border/60 bg-card/40 p-3"
            >
              <InspectorField label="Write to state">
                <Input
                  data-testid={`flow-transform-key-${index}`}
                  value={assignment.key}
                  placeholder="has_tests_changed"
                  onChange={(event) => updateAssignment(
                    index,
                    (current) => ({ ...current, key: event.target.value }),
                    `transform-key-${node.id}-${index}`,
                  )}
                />
              </InspectorField>
              <InspectorField label="Source path">
                <Input
                  data-testid={`flow-transform-source-${index}`}
                  value={assignment.source}
                  placeholder="metadata.changed_files"
                  onChange={(event) => updateAssignment(
                    index,
                    (current) => ({ ...current, source: event.target.value }),
                    `transform-source-${node.id}-${index}`,
                  )}
                />
              </InspectorField>
              <InspectorField label="Operation">
                <WorkflowSelect
                  testId={`flow-transform-operation-${index}`}
                  ariaLabel="Operation"
                  value={assignment.operation}
                  onValueChange={(value) => {
                    const nextOperation = value as FlowTransformOperation
                    const nextOption = FLOW_TRANSFORM_OPERATION_OPTIONS.find(
                      (option) => option.value === nextOperation
                    )
                    updateAssignment(
                      index,
                      (current) => ({
                        ...current,
                        operation: nextOperation,
                        ...(nextOption?.argumentLabel
                          ? { argument: current.argument ?? "" }
                          : { argument: undefined }),
                      }),
                      `transform-operation-${node.id}-${index}`,
                    )
                  }}
                  options={FLOW_TRANSFORM_OPERATION_OPTIONS.map((option) => ({
                    value: option.value,
                    label: option.label,
                  }))}
                />
              </InspectorField>
              {operation.argumentLabel ? (
                <InspectorField label={operation.argumentLabel}>
                  <Input
                    data-testid={`flow-transform-argument-${index}`}
                    value={assignment.argument ?? ""}
                    placeholder={operation.argumentPlaceholder}
                    onChange={(event) => updateAssignment(
                      index,
                      (current) => ({
                        ...current,
                        argument: event.target.value,
                      }),
                      `transform-argument-${node.id}-${index}`,
                    )}
                  />
                </InspectorField>
              ) : null}
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => updateNodeData(node.id, (data) => ({
                    ...data,
                    assignments: readAssignments(data).filter(
                      (_, assignmentIndex) => assignmentIndex !== index
                    ),
                  }), { mergeKey: `transform-remove-${node.id}-${index}` })}
                  className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                >
                  Remove
                </Button>
              </div>
            </div>
          )
        })}
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="flow-transform-add-assignment"
          onClick={() => updateNodeData(node.id, (data) => ({
            ...data,
            assignments: [
              ...readAssignments(data),
              {
                key: "",
                source: "metadata.changed_files",
                operation: "array_length",
              },
            ],
          }), { mergeKey: `transform-add-${node.id}` })}
        >
          Add transformation
        </Button>
      </div>
      <InspectorCallout variant="hint" icon={<InfoCircle />}>
        Transform reads trigger metadata or existing workflow state and writes
        typed results to <span className="font-mono text-foreground">state.&lt;key&gt;</span>.
        Use a second Transform node when one result feeds another.
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
