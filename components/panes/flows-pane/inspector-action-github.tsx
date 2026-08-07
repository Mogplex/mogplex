"use client"

import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { GitMerge } from "iconoir-react"
import type { FlowNode } from "@/lib/types"
import type { FlowCanvasNode } from "@/lib/flows/editor"
import { WorkflowSelect, InspectorField, InspectorCallout } from "./inspector-shared"

type ActionNodeData = Extract<FlowNode, { type: "action" }>["data"]

export type GitHubPostCommentData = Extract<ActionNodeData, { operation: "github.post_comment" }>
export type GitHubCreateIssueData = Extract<ActionNodeData, { operation: "github.create_issue" }>
export type GitHubUpdateLabelsData = Extract<ActionNodeData, { operation: "github.update_labels" }>
export type GitHubSetStatusData = Extract<ActionNodeData, { operation: "github.set_status" }>
export type GitHubSubmitReviewData = Extract<ActionNodeData, { operation: "github.submit_review" }>
export type GitHubMergePullRequestData = Extract<ActionNodeData, { operation: "github.merge_pull_request" }>

export type UpdateNodeData = (
  nodeId: string,
  updater: (data: Record<string, unknown>) => Record<string, unknown>,
  options?: { mergeKey?: string | null },
) => void

export function GitHubPostCommentFields({ node, updateNodeData }: {
  node: FlowCanvasNode & { data: GitHubPostCommentData }
  updateNodeData: UpdateNodeData
}) {
  return (
    <>
      <InspectorField label="Issue or PR number">
        <Input
          data-testid="flow-action-github-target-number"
          value={node.data.targetNumber ?? ""}
          onChange={(event) => updateNodeData(node.id, (data) => ({
            ...data,
            targetNumber: event.target.value.trim()
              ? event.target.value
              : null,
          }), { mergeKey: `action-github-target-${node.id}` })}
          placeholder="Use triggering issue or PR"
        />
      </InspectorField>
      <InspectorField label="Comment">
        <Textarea
          data-testid="flow-action-github-comment"
          value={node.data.body}
          onChange={(event) => updateNodeData(node.id, (data) => ({
            ...data,
            body: event.target.value,
          }), { mergeKey: `action-github-comment-${node.id}` })}
          rows={6}
          placeholder={"Completed for {{ repo.full_name }}"}
        />
      </InspectorField>
    </>
  )
}

export function GitHubCreateIssueFields({ node, updateNodeData }: {
  node: FlowCanvasNode & { data: GitHubCreateIssueData }
  updateNodeData: UpdateNodeData
}) {
  return (
    <>
      <InspectorField label="Issue title">
        <Input
          data-testid="flow-action-github-issue-title"
          value={node.data.title}
          onChange={(event) => updateNodeData(node.id, (data) => ({
            ...data,
            title: event.target.value,
          }), { mergeKey: `action-github-issue-title-${node.id}` })}
          placeholder={"Follow up: {{ repo.full_name }}"}
        />
      </InspectorField>
      <InspectorField label="Issue body">
        <Textarea
          data-testid="flow-action-github-issue-body"
          value={node.data.body}
          onChange={(event) => updateNodeData(node.id, (data) => ({
            ...data,
            body: event.target.value,
          }), { mergeKey: `action-github-issue-body-${node.id}` })}
          rows={6}
          placeholder={"Created by workflow for {{ repo.full_name }}"}
        />
      </InspectorField>
      <InspectorField label="Labels (comma separated)">
        <Input
          data-testid="flow-action-github-issue-labels"
          value={node.data.labels.join(", ")}
          onChange={(event) => updateNodeData(node.id, (data) => ({
            ...data,
            labels: event.target.value
              .split(",")
              .map((label) => label.trim())
              .filter(Boolean),
          }), { mergeKey: `action-github-issue-labels-${node.id}` })}
          placeholder="automation, follow-up"
        />
      </InspectorField>
    </>
  )
}

export function GitHubUpdateLabelsFields({ node, updateNodeData }: {
  node: FlowCanvasNode & { data: GitHubUpdateLabelsData }
  updateNodeData: UpdateNodeData
}) {
  return (
    <>
      <InspectorField label="Issue or PR number">
        <Input
          data-testid="flow-action-github-label-target"
          value={node.data.targetNumber ?? ""}
          onChange={(event) => updateNodeData(node.id, (data) => ({
            ...data,
            targetNumber: event.target.value.trim()
              ? event.target.value
              : null,
          }), { mergeKey: `action-github-label-target-${node.id}` })}
          placeholder="Use triggering issue or PR"
        />
      </InspectorField>
      <InspectorField label="Add labels">
        <Input
          data-testid="flow-action-github-add-labels"
          value={node.data.addLabels.join(", ")}
          onChange={(event) => updateNodeData(node.id, (data) => ({
            ...data,
            addLabels: event.target.value
              .split(",")
              .map((label) => label.trim())
              .filter(Boolean),
          }), { mergeKey: `action-github-add-labels-${node.id}` })}
          placeholder="ready, reviewed"
        />
      </InspectorField>
      <InspectorField label="Remove labels">
        <Input
          data-testid="flow-action-github-remove-labels"
          value={node.data.removeLabels.join(", ")}
          onChange={(event) => updateNodeData(node.id, (data) => ({
            ...data,
            removeLabels: event.target.value
              .split(",")
              .map((label) => label.trim())
              .filter(Boolean),
          }), { mergeKey: `action-github-remove-labels-${node.id}` })}
          placeholder="needs-review"
        />
      </InspectorField>
    </>
  )
}

export function GitHubSetStatusFields({ node, updateNodeData }: {
  node: FlowCanvasNode & { data: GitHubSetStatusData }
  updateNodeData: UpdateNodeData
}) {
  return (
    <>
      <InspectorField label="Commit SHA">
        <Input
          data-testid="flow-action-github-status-sha"
          value={node.data.commitSha ?? ""}
          onChange={(event) => updateNodeData(node.id, (data) => ({
            ...data,
            commitSha: event.target.value.trim()
              ? event.target.value
              : null,
          }), { mergeKey: `action-github-status-sha-${node.id}` })}
          placeholder="Use triggering commit"
          className="font-mono"
        />
      </InspectorField>
      <InspectorField label="State">
        <WorkflowSelect
          testId="flow-action-github-status-state"
          ariaLabel="State"
          value={node.data.state}
          onValueChange={(value) => updateNodeData(node.id, (data) => ({
            ...data,
            state: value,
          }), { mergeKey: `action-github-status-state-${node.id}` })}
          options={[
            { value: "pending", label: "Pending" },
            { value: "success", label: "Success" },
            { value: "failure", label: "Failure" },
            { value: "error", label: "Error" },
          ]}
        />
      </InspectorField>
      <InspectorField label="Status context">
        <Input
          data-testid="flow-action-github-status-context"
          value={node.data.context}
          onChange={(event) => updateNodeData(node.id, (data) => ({
            ...data,
            context: event.target.value,
          }), { mergeKey: `action-github-status-context-${node.id}` })}
          placeholder="mogplex/workflow"
        />
      </InspectorField>
      <InspectorField label="Description (optional)">
        <Input
          data-testid="flow-action-github-status-description"
          value={node.data.description ?? ""}
          onChange={(event) => updateNodeData(node.id, (data) => ({
            ...data,
            description: event.target.value.trim()
              ? event.target.value
              : null,
          }), { mergeKey: `action-github-status-description-${node.id}` })}
          placeholder="Workflow completed"
        />
      </InspectorField>
      <InspectorField label="Details URL (optional)">
        <Input
          data-testid="flow-action-github-status-url"
          value={node.data.targetUrl ?? ""}
          onChange={(event) => updateNodeData(node.id, (data) => ({
            ...data,
            targetUrl: event.target.value.trim()
              ? event.target.value
              : null,
          }), { mergeKey: `action-github-status-url-${node.id}` })}
          placeholder={"{{ outputs_by_label.Deploy.url }}"}
        />
      </InspectorField>
    </>
  )
}

export function GitHubSubmitReviewFields({ node, updateNodeData }: {
  node: FlowCanvasNode & { data: GitHubSubmitReviewData }
  updateNodeData: UpdateNodeData
}) {
  return (
    <>
      <InspectorField label="Pull request number">
        <Input
          data-testid="flow-action-github-review-target"
          value={node.data.pullRequestNumber ?? ""}
          onChange={(event) => updateNodeData(node.id, (data) => ({
            ...data,
            pullRequestNumber: event.target.value.trim()
              ? event.target.value
              : null,
          }), { mergeKey: `action-github-review-target-${node.id}` })}
          placeholder="Use triggering pull request"
        />
      </InspectorField>
      <InspectorField label="Review decision">
        <WorkflowSelect
          testId="flow-action-github-review-event"
          ariaLabel="Review decision"
          value={node.data.event}
          onValueChange={(value) => updateNodeData(node.id, (data) => ({
            ...data,
            event: value,
          }), { mergeKey: `action-github-review-event-${node.id}` })}
          options={[
            { value: "COMMENT", label: "Comment" },
            { value: "APPROVE", label: "Approve" },
            {
              value: "REQUEST_CHANGES",
              label: "Request changes",
            },
          ]}
        />
      </InspectorField>
      <InspectorField label="Review body">
        <Textarea
          data-testid="flow-action-github-review-body"
          value={node.data.body}
          onChange={(event) => updateNodeData(node.id, (data) => ({
            ...data,
            body: event.target.value,
          }), { mergeKey: `action-github-review-body-${node.id}` })}
          rows={6}
          placeholder={"Reviewed by {{ outputs_by_label.Review }}"}
        />
      </InspectorField>
    </>
  )
}

export function GitHubMergePullRequestFields({ node, updateNodeData }: {
  node: FlowCanvasNode & { data: GitHubMergePullRequestData }
  updateNodeData: UpdateNodeData
}) {
  return (
    <>
      <InspectorField label="Pull request number">
        <Input
          data-testid="flow-action-github-merge-target"
          value={node.data.pullRequestNumber ?? ""}
          onChange={(event) => updateNodeData(node.id, (data) => ({
            ...data,
            pullRequestNumber: event.target.value.trim()
              ? event.target.value
              : null,
          }), { mergeKey: `action-github-merge-target-${node.id}` })}
          placeholder="Use triggering pull request"
        />
      </InspectorField>
      <InspectorField label="Squash commit title (optional)">
        <Input
          data-testid="flow-action-github-merge-title"
          value={node.data.commitTitle ?? ""}
          onChange={(event) => updateNodeData(node.id, (data) => ({
            ...data,
            commitTitle: event.target.value.trim()
              ? event.target.value
              : null,
          }), { mergeKey: `action-github-merge-title-${node.id}` })}
          placeholder={"Merge after {{ outputs_by_label.Review }}"}
        />
      </InspectorField>
      <InspectorCallout variant="info" icon={<GitMerge />}>
        The merge runs after this workflow and its review check complete.
        Mogplex only squash-merges an open, non-draft pull request
        that GitHub reports conflict-free and clean under branch protection.
        PR-review flows also require an explicit no-issues verdict.
        A changed triggering head or failed gate refuses the merge.
      </InspectorCallout>
    </>
  )
}
