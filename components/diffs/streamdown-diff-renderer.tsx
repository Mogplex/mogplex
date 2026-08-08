"use client"

import { useMemo } from "react"
import { CodeBlock, type CustomRenderer, type CustomRendererProps } from "streamdown"
import { detectPatch } from "@/lib/diffs/detect"
import { PatchViewer } from "@/components/diffs/patch-viewer"

function DiffRenderer({ code, language, isIncomplete }: CustomRendererProps) {
  const detectedPatch = useMemo(() => detectPatch(code, language), [code, language])

  if (detectedPatch) {
    return <PatchViewer detectedPatch={detectedPatch} />
  }

  return <CodeBlock code={code} language={language} isIncomplete={isIncomplete} />
}

export const streamdownDiffRenderer: CustomRenderer = {
  language: ["diff", "patch"],
  component: DiffRenderer,
}
