"use client"

import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeHighlight from "rehype-highlight"
import { memo, useState, useMemo, isValidElement } from "react"
import type { UIMessage } from "ai"
import { CodeBlock } from "@/components/diffs/code-block"
import { StructuredValueViewer } from "@/components/diffs/structured-value-viewer"
import { extractTextContent } from "@/lib/diffs/detect"

interface ToolPart {
  type: string
  toolCallId: string
  toolName?: string
  title?: string
  state: string
  input?: unknown
  output?: unknown
}

const remarkPlugins = [remarkGfm]
const rehypePlugins = [rehypeHighlight]

function isToolPart(part: { type: string }): part is ToolPart {
  return (part.type.startsWith("tool-") || part.type === "dynamic-tool") && "toolCallId" in part
}

function ToolCallPart({ part }: { part: ToolPart }) {
  const [open, setOpen] = useState(false)
  const done = part.state === "output-available" || part.state === "output-error" || part.state === "output-denied"
  const name = part.toolName || part.title || part.type.replace(/^tool-/, "")

  return (
    <div className="my-1.5 border border-border text-[10px] rounded-sm overflow-hidden">
      <div className="flex items-center gap-2 px-2 py-1 bg-secondary/80 cursor-pointer" onClick={() => setOpen(!open)}>
        <span className="text-accent-blue font-mono">{name}</span>
        <span className="ml-auto text-muted-foreground">{done ? "done" : "running..."}</span>
        <span className="text-muted-foreground">{open ? "[-]" : "[+]"}</span>
      </div>
      {open && (
        <div className="p-2 space-y-1">
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
  const markdownComponents = useMemo(() => ({
    pre: ({ children }: { children?: React.ReactNode }) => {
      let codeText = extractTextContent(children ?? "")
      let codeClassName: string | undefined

      if (isValidElement(children)) {
        codeClassName = (children.props as { className?: string }).className
        codeText = extractTextContent((children.props as { children?: React.ReactNode }).children ?? "")
      }

      return (
        <CodeBlock code={codeText} codeClassName={codeClassName}>
          {children}
        </CodeBlock>
      )
    },
    code: ({ className, children, ...props }: { className?: string; children?: React.ReactNode }) => {
      const isBlock = className?.startsWith("hljs") || className?.includes("language-")
      if (isBlock) {
        return <code className={className} {...props}>{children}</code>
      }
      return (
        <code
          className="rounded-[3px] border border-white/8 bg-white/[0.06] px-1 py-px text-[0.9em] text-accent-blue"
          {...props}
        >
          {children}
        </code>
      )
    },
    p: ({ children }: { children?: React.ReactNode }) => (
      <p className="mb-2 whitespace-pre-wrap leading-6">{children}</p>
    ),
    h1: ({ children }: { children?: React.ReactNode }) => (
      <h1 className="mb-2 mt-4 border-b border-white/8 pb-1 text-sm font-semibold text-foreground first:mt-0">{children}</h1>
    ),
    h2: ({ children }: { children?: React.ReactNode }) => (
      <h2 className="mb-1.5 mt-3 text-[13px] font-semibold text-foreground first:mt-0">{children}</h2>
    ),
    h3: ({ children }: { children?: React.ReactNode }) => (
      <h3 className="mb-1 mt-2.5 text-xs font-semibold text-foreground first:mt-0">{children}</h3>
    ),
    h4: ({ children }: { children?: React.ReactNode }) => (
      <h4 className="mb-1 mt-2 text-xs font-medium text-foreground/80 first:mt-0">{children}</h4>
    ),
    ul: ({ children }: { children?: React.ReactNode }) => (
      <ul className="mb-2 ml-1 space-y-0.5 pl-3">{children}</ul>
    ),
    ol: ({ children }: { children?: React.ReactNode }) => (
      <ol className="mb-2 ml-1 list-decimal space-y-0.5 pl-4">{children}</ol>
    ),
    li: ({ children }: { children?: React.ReactNode }) => (
      <li className="relative pl-2 leading-6 before:absolute before:left-[-8px] before:top-[10px] before:h-1 before:w-1 before:rounded-full before:bg-white/30 before:content-[''] [ol_&]:before:content-none">{children}</li>
    ),
    a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
      <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent-blue underline decoration-accent-blue/30 underline-offset-2 hover:decoration-accent-blue/60">{children}</a>
    ),
    blockquote: ({ children }: { children?: React.ReactNode }) => (
      <blockquote className="my-2 border-l-2 border-white/15 pl-3 text-white/60">{children}</blockquote>
    ),
    strong: ({ children }: { children?: React.ReactNode }) => (
      <strong className="font-semibold text-foreground">{children}</strong>
    ),
    em: ({ children }: { children?: React.ReactNode }) => (
      <em className="text-foreground/90">{children}</em>
    ),
    hr: () => <hr className="my-3 border-white/8" />,
    table: ({ children }: { children?: React.ReactNode }) => (
      <div className="my-2 overflow-x-auto">
        <table className="w-full border-collapse text-[11px]">{children}</table>
      </div>
    ),
    thead: ({ children }: { children?: React.ReactNode }) => (
      <thead className="border-b border-white/15">{children}</thead>
    ),
    tbody: ({ children }: { children?: React.ReactNode }) => (
      <tbody className="divide-y divide-white/6">{children}</tbody>
    ),
    tr: ({ children }: { children?: React.ReactNode }) => (
      <tr className="hover:bg-white/[0.02]">{children}</tr>
    ),
    th: ({ children }: { children?: React.ReactNode }) => (
      <th className="px-2 py-1.5 text-left font-medium text-white/60">{children}</th>
    ),
    td: ({ children }: { children?: React.ReactNode }) => (
      <td className="px-2 py-1.5 text-white/80">{children}</td>
    ),
    del: ({ children }: { children?: React.ReactNode }) => (
      <del className="text-white/40 line-through">{children}</del>
    ),
    input: ({ checked, ...props }: { checked?: boolean }) => (
      <input
        type="checkbox"
        checked={checked}
        readOnly
        className="mr-1.5 accent-accent-green"
        {...props}
      />
    ),
  }), [])

  if (!message.parts) return null

  return (
    <div>
      {message.parts.map((part, i) => {
        if (part.type === "text") {
          return (
            <div key={`${message.id}-${i}`} className="message-content">
              <ReactMarkdown
                remarkPlugins={remarkPlugins}
                rehypePlugins={rehypePlugins}
                components={markdownComponents}
              >
                {part.text}
              </ReactMarkdown>
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
