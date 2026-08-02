"use client"

import {
  ACTIVITY_DATE_RANGE_PRESET_OPTIONS,
  type ActivityDateRangePreset,
  type ActivityDateRangeSelection,
  type ResolvedActivityDateRange,
} from "@/lib/observability/activity-date-range"

function toLocalInputValue(iso: string | undefined): string {
  if (!iso) return ""
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  const pad = (value: number) => String(value).padStart(2, "0")
  const yyyy = date.getFullYear()
  const mm = pad(date.getMonth() + 1)
  const dd = pad(date.getDate())
  const hh = pad(date.getHours())
  const mi = pad(date.getMinutes())
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`
}

function fromLocalInputValue(value: string): string | undefined {
  if (!value) return undefined
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return undefined
  return parsed.toISOString()
}

export function ActivityDateRangeFilter({
  selection,
  onChange,
}: {
  selection: ActivityDateRangeSelection
  onChange: (next: ActivityDateRangeSelection) => void
}) {
  const handlePresetChange = (preset: ActivityDateRangePreset) => {
    if (preset === "custom") {
      onChange({ preset, custom: selection.custom })
      return
    }
    onChange({ preset, custom: {} })
  }

  const handleCustomChange = (
    key: keyof ResolvedActivityDateRange,
    raw: string
  ) => {
    onChange({
      preset: "custom",
      custom: {
        ...selection.custom,
        [key]: fromLocalInputValue(raw),
      },
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label="Date range"
        value={selection.preset}
        onChange={(e) =>
          handlePresetChange(e.target.value as ActivityDateRangePreset)
        }
        className="bg-background border border-border rounded px-2 py-1 text-sm text-foreground min-w-[140px]"
      >
        {ACTIVITY_DATE_RANGE_PRESET_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      {selection.preset === "custom" && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            From
            <input
              type="datetime-local"
              aria-label="Custom range start"
              value={toLocalInputValue(selection.custom.from)}
              onChange={(e) => handleCustomChange("from", e.target.value)}
              className="bg-background border border-border rounded px-2 py-1 text-sm text-foreground"
            />
          </label>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            To
            <input
              type="datetime-local"
              aria-label="Custom range end"
              value={toLocalInputValue(selection.custom.to)}
              onChange={(e) => handleCustomChange("to", e.target.value)}
              className="bg-background border border-border rounded px-2 py-1 text-sm text-foreground"
            />
          </label>
        </div>
      )}
    </div>
  )
}
