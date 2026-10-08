"use client"

import { useState } from "react"
import { Copy, InfoCircle, WarningTriangle } from "iconoir-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  type AutomationInputField,
  coerceAutomationInputFields,
  validateAutomationInputFields,
} from "@/lib/flows/automation-inputs"
import { InspectorCallout, InspectorField } from "./inspector-shared"

const INPUT_FIELDS_EXAMPLE = `[
  { "key": "slug", "type": "string", "required": true, "pattern": "[a-z0-9-]+" },
  { "key": "details", "type": "json" }
]`

function parseInputFields(text: string) {
  if (!text.trim()) return { fields: [], errors: [] }
  try {
    const parsed: unknown = JSON.parse(text)
    if (!Array.isArray(parsed)) {
      return { fields: null, errors: ["Inputs must be a JSON array of fields."] }
    }
    const fields = coerceAutomationInputFields(parsed)
    const dropped = parsed.length - fields.length
    const errors = validateAutomationInputFields(fields)
    if (dropped > 0) {
      errors.unshift(
        `${dropped} field${dropped === 1 ? " needs" : "s need"} a key and a type of string, integer, boolean or json.`,
      )
    }
    return { fields: errors.length > 0 ? null : fields, errors }
  } catch {
    return { fields: null, errors: ["Inputs are not valid JSON."] }
  }
}

/**
 * Start-node settings for an automation started by an integration: the
 * trigger endpoint and the declared input fields, the only values a caller
 * may supply.
 */
export function ApiTriggerFields({
  automationId,
  inputFields,
  onInputFieldsChange,
  copyValue,
}: {
  automationId: string
  inputFields: AutomationInputField[] | undefined
  onInputFieldsChange: (fields: AutomationInputField[]) => void
  copyValue: (value: string, label: string) => Promise<void>
}) {
  const [text, setText] = useState(() =>
    inputFields?.length ? JSON.stringify(inputFields, null, 2) : "",
  )
  const [errors, setErrors] = useState<string[]>([])
  const path = `/api/v1/mogplex/automations/${automationId}/trigger`

  return (
    <>
      <InspectorField label="Trigger endpoint">
        <div className="flex gap-2">
          <Input readOnly value={`POST ${path}`} className="font-mono text-[11px]" />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => {
              const origin = typeof window === "undefined" ? "" : window.location.origin
              void copyValue(`${origin}${path}`, "Endpoint")
            }}
            aria-label="Copy trigger endpoint"
          >
            <Copy className="size-3.5" />
          </Button>
        </div>
      </InspectorField>
      <InspectorField label="Inputs (JSON)">
        <Textarea
          data-testid="flow-trigger-api-inputs"
          aria-label="Inputs"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onBlur={() => {
            const result = parseInputFields(text)
            setErrors(result.errors)
            if (result.fields) onInputFieldsChange(result.fields)
          }}
          placeholder={INPUT_FIELDS_EXAMPLE}
          className="min-h-32 font-mono text-[11px]"
          spellCheck={false}
        />
      </InspectorField>
      {errors.length > 0 ? (
        <InspectorCallout variant="warn" icon={<WarningTriangle />}>
          {errors.join(" ")}
        </InspectorCallout>
      ) : null}
      <InspectorCallout variant="hint" icon={<InfoCircle />}>
        Integrations call this endpoint with a Mogplex API key, a{" "}
        <span className="font-mono">repoId</span>, an{" "}
        <span className="font-mono">Idempotency-Key</span> header and{" "}
        <span className="font-mono">input</span> matching these fields. Inputs
        reach the agent as data; they cannot change its instructions,
        repository or permissions.
      </InspectorCallout>
    </>
  )
}
