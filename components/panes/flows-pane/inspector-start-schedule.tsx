"use client"

import { useRef, useState } from "react"
import { Clock } from "iconoir-react"
import { Input } from "@/components/ui/input"
import { isValidRunAt } from "@/lib/flows/one-time-config"
import type { StartInspectorProps } from "./inspector-start"
import { InspectorCallout, InspectorField, WorkflowCombobox, WorkflowSelect } from "./inspector-shared"

export function StartScheduleFields({ node, updateNodeData }: Pick<StartInspectorProps, "node" | "updateNodeData">) {
  const previous = useRef({
    cron: node.data.scheduleCron ?? "0 9 * * 1-5",
    timezone: node.data.scheduleTimezone ?? "UTC",
    runAt: node.data.scheduleRunAt ?? "",
  })
  const [touched, setTouched] = useState(false)
  const isOnce = node.data.scheduleRunAt !== undefined
  const runAt = node.data.scheduleRunAt ?? ""
  const error = isOnce && touched && !isValidRunAt(runAt)
    ? "Enter a valid date and time with an explicit timezone offset."
    : null
  const hintId = `run-at-hint-${node.id}`
  const errorId = `run-at-error-${node.id}`

  return (
    <>
      <InspectorField label="Repeat">
        <WorkflowSelect
          ariaLabel="Repeat"
          value={isOnce ? "once" : "recurring"}
          onValueChange={(value) => {
            if (isOnce) {
              previous.current.runAt = runAt
            } else {
              previous.current.cron = node.data.scheduleCron ?? "0 9 * * 1-5"
              previous.current.timezone = node.data.scheduleTimezone ?? "UTC"
            }
            const schedule = {
              scheduleRunAt: value === "once" ? previous.current.runAt : undefined,
              scheduleCron: value === "once" ? undefined : previous.current.cron,
              scheduleTimezone: previous.current.timezone,
            }
            setTouched(false)
            updateNodeData(node.id, (data) => ({ ...data, ...schedule }))
          }}
          options={[{ value: "once", label: "Run once" }, { value: "recurring", label: "Recurring" }]}
        />
      </InspectorField>
      {isOnce ? (
        <InspectorField label="Run at">
          <Input
            data-testid="flow-trigger-run-at"
            aria-label="Run at"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? `${hintId} ${errorId}` : hintId}
            value={runAt}
            onBlur={() => setTouched(true)}
            onChange={(event) => updateNodeData(node.id, (data) => ({ ...data, scheduleRunAt: event.target.value }), { mergeKey: `start-run-at-${node.id}` })}
            placeholder="2027-01-15T15:00:00-05:00"
          />
          <p id={hintId} className="mt-2 text-[11px] text-muted-foreground">Include the date, time, and timezone offset. Runs once after publishing.</p>
          {error && <p id={errorId} role="alert" className="mt-2 text-[11px] text-destructive">{error}</p>}
        </InspectorField>
      ) : (
        <>
          <InspectorField label="Cron schedule">
            <Input
              data-testid="flow-trigger-schedule-cron"
              value={node.data.scheduleCron ?? ""}
              onChange={(event) => updateNodeData(node.id, (data) => ({ ...data, scheduleCron: event.target.value }), { mergeKey: `start-schedule-cron-${node.id}` })}
              placeholder="0 9 * * 1-5"
              className="font-mono"
            />
          </InspectorField>
          <InspectorField label="Timezone">
            <WorkflowCombobox
              testId="flow-trigger-schedule-timezone"
              ariaLabel="Timezone"
              value={node.data.scheduleTimezone ?? "UTC"}
              onValueChange={(value) => updateNodeData(node.id, (data) => ({ ...data, scheduleTimezone: value }), { mergeKey: `start-schedule-timezone-${node.id}` })}
              placeholder="America/New_York"
              options={[
                { value: "UTC", label: "UTC" },
                { value: "America/New_York", label: "America/New_York" },
                { value: "America/Chicago", label: "America/Chicago" },
                { value: "America/Denver", label: "America/Denver" },
                { value: "America/Los_Angeles", label: "America/Los_Angeles" },
                { value: "Europe/London", label: "Europe/London" },
                { value: "Europe/Berlin", label: "Europe/Berlin" },
                { value: "Asia/Tokyo", label: "Asia/Tokyo" },
              ]}
            />
          </InspectorField>
          <InspectorCallout variant="hint" icon={<Clock />}>
            Five-field cron, evaluated by Trigger.dev in the selected timezone.
          </InspectorCallout>
        </>
      )}
    </>
  )
}
