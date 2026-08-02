"use client"

import { useMemo } from "react"
import { CodeBlock } from "@/components/diffs/code-block"
import { PatchViewer } from "@/components/diffs/patch-viewer"
import { detectPatchInValue } from "@/lib/diffs/detect"

interface StructuredValueViewerProps {
  value: unknown
  className?: string
  stringLanguage?: string
}

export function StructuredValueViewer({
  value,
  className,
  stringLanguage,
}: StructuredValueViewerProps) {
  const detectedPatch = useMemo(() => detectPatchInValue(value), [value])

  const serialized = useMemo(() => {
    if (typeof value === "string") return value
    if (value === undefined) return ""
    return JSON.stringify(value, null, 2)
  }, [value])

  if (detectedPatch) {
    return (
      <div className="space-y-1">
        {detectedPatch.sourcePath && (
          <div className="text-[10px] text-muted-foreground">
            Diff source: {detectedPatch.sourcePath}
          </div>
        )}
        <PatchViewer detectedPatch={detectedPatch} className={className} />
      </div>
    )
  }

  return (
    <CodeBlock
      code={serialized}
      className={className}
      codeClassName={typeof value === "string" ? stringLanguage : "language-json"}
      wrap
    >
      <code>{serialized}</code>
    </CodeBlock>
  )
}
