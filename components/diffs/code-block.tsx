"use client"

import type { ReactNode } from "react"
import { useCallback, useMemo, useState } from "react"
import { copyText } from "@/lib/clipboard"
import { detectPatch, getLanguageFromClassName } from "@/lib/diffs/detect"
import { PatchViewer } from "@/components/diffs/patch-viewer"
import { cn } from "@/lib/utils"

const COPY_LABELS = { idle: "copy", copied: "copied", failed: "copy failed" } as const

function CopyButton({ text }: { text: string }) {
  const [copyState, setCopyState] = useState<keyof typeof COPY_LABELS>("idle")

  const handleCopy = useCallback(async () => {
    setCopyState((await copyText(text)) ? "copied" : "failed")
    setTimeout(() => setCopyState("idle"), 1500)
  }, [text])

  return (
    <button
      onClick={handleCopy}
      className="absolute right-1.5 top-1.5 rounded border border-white/8 bg-white/[0.04] px-1.5 py-0.5 text-[9px] text-white/40 opacity-0 transition-opacity group-hover:opacity-100 hover:text-white/70"
    >
      {COPY_LABELS[copyState]}
    </button>
  )
}

interface CodeBlockProps {
  code: string
  children?: ReactNode
  codeClassName?: string
  className?: string
  wrap?: boolean
}

export function CodeBlock({ code, children, codeClassName, className, wrap }: CodeBlockProps) {
  const detectedPatch = useMemo(
    () => detectPatch(code, getLanguageFromClassName(codeClassName)),
    [code, codeClassName],
  )

  if (detectedPatch) {
    return <PatchViewer detectedPatch={detectedPatch} className={className} />
  }

  return (
    <div className={cn("group relative my-2", className)}>
      {code && <CopyButton text={code} />}
      <pre
        className={cn(
          "rounded-sm border border-white/8 bg-white/[0.03] p-3 text-[11px] leading-5",
          wrap ? "whitespace-pre-wrap break-words" : "overflow-x-auto",
        )}
      >
        {children}
      </pre>
    </div>
  )
}
