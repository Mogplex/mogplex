"use client"

import { memo, useState } from "react"
import type { UIMessage } from "ai"
import { MessageResponse } from "@/components/ai-elements/message"
import { StructuredValueViewer } from "@/components/diffs/structured-value-viewer"

interface ToolPart {
  type: string
  toolCallId: string
  toolName?: string
  title?: string
  state: string
  input?: unknown
  output?: unknown
  errorText?: string
}

function isToolPart(part: { type: string }): part is ToolPart {
  return (part.type.startsWith("tool-") || part.type === "dynamic-tool") && "toolCallId" in part
}

function ToolCallPart({ part }: { part: ToolPart }) {
  const [open, setOpen] = useState(false)
  const done = part.state === "output-available" || part.state === "output-error" || part.state === "output-denied"
  const name = part.toolName || part.title || part.type.replace(/^tool-/, "")

  return (
    <div className="my-1.5 border border-border text-[10px] rounded-sm overflow-hidden">
      <button type="button" aria-expanded={open} className="flex w-full items-center gap-2 px-2 py-1 bg-secondary/80 cursor-pointer" onClick={() => setOpen(!open)}>
        <span className="text-accent-blue font-mono">{name}</span>
        <span className="ml-auto text-muted-foreground">{part.state === "output-error" ? "error" : part.state === "output-denied" ? "denied" : done ? "done" : "running..."}</span>
        <span className="text-muted-foreground">{open ? "[-]" : "[+]"}</span>
      </button>
      {open && (
        <div className="p-2 space-y-1">
          {part.state === "output-error" && part.errorText && <p className="text-accent-red">{part.errorText}</p>}
          <div>
            <span className="text-muted-foreground">INPUT: </span>
            <StructuredValueViewer value={part.input} className="my-1" stringLanguage="language-json" />
          </div>
          {done && part.output !== undefined && (
            <div>
              <span className="text-muted-foreground">OUTPUT: </span>
              <StructuredValueViewer value={part.output} className="my-1" />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export const MessageContent = memo(function MessageContent({ message }: { message: UIMessage }) {
  if (!message.parts) return null

  return (
    <div>
      {message.parts.map((part, i) => {
        if (part.type === "text") {
          return (
            <div key={`${message.id}-${i}`} className="message-content">
              <MessageResponse>{part.text}</MessageResponse>
            </div>
          )
        }

        if (isToolPart(part)) {
          return <ToolCallPart key={part.toolCallId} part={part} />
        }

        return null
      })}
    </div>
  )
})
