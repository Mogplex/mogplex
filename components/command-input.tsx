"use client"
import { useState, useRef, useCallback, useMemo, useEffect, type ReactNode } from "react"
import { createPortal } from "react-dom"
import type { SlashCommand } from "@/lib/slash-commands"
import { getCommandInputSuggestions } from "@/lib/command-input-autocomplete"
import { useIsMobile } from "@/hooks/use-mobile"
import { ClaudeFill, OpenaiFill } from "@/components/icons/harness-icons"
import { McpStatusButton } from "@/components/chat/mcp-status-button"
import type { CommandInputAttachment as Attachment } from "./command-input-types"
import { useCommandInputAttachments } from "./use-command-input-attachments"

export type { CommandInputAttachment as Attachment } from "./command-input-types"

interface Props {
  onSubmit: (cmd: string, attachments?: Attachment[]) => void
  builtinCommands: SlashCommand[]
  customCommands?: SlashCommand[]
  models: string[]
  mode?: string
  contextPct?: number
  repoPath?: string
  repoId?: string
  model?: string
  onModelSelect?: (model: string) => void
  isRunning?: boolean
  runningLabel?: string
  onStop?: () => void
}

const HARNESS_ENTRIES: { id: "claude-code" | "codex"; label: string; icon: ReactNode }[] = [
  { id: "claude-code", label: "Claude Code", icon: <ClaudeFill className="h-3 w-3" /> },
  { id: "codex", label: "Codex", icon: <OpenaiFill className="h-3 w-3" /> },
]

export function CommandInput({
  onSubmit,
  builtinCommands,
  customCommands = [],
  models,
  mode = "AUTO",
  contextPct = 100,
  repoPath,
  repoId,
  model,
  onModelSelect,
  isRunning = false,
  runningLabel = "Agent is working",
  onStop,
}: Props) {
  const isMobile = useIsMobile()
  const [value, setValue] = useState("")
  const [showMenu, setShowMenu] = useState(false)
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [modelFilter, setModelFilter] = useState("")
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)
  const modelMenuRef = useRef<HTMLDivElement>(null)
  const modelBtnRef = useRef<HTMLButtonElement>(null)
  const [menuPos, setMenuPos] = useState<{ left: number; bottom: number } | null>(null)
  const allCmds = useMemo(() => [...builtinCommands, ...customCommands], [builtinCommands, customCommands])
  const {
    addFiles,
    attachmentError,
    attachments,
    clearAttachments,
    removeAttachment,
  } = useCommandInputAttachments()

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    void addFiles(Array.from(e.dataTransfer.files))
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.items).flatMap(item => {
      const file = item.kind === "file" ? item.getAsFile() : null
      return file ? [file] : []
    })
    if (files.length > 0) void addFiles(files)
  }

  const getFilteredCmds = useCallback(() => {
    return getCommandInputSuggestions({
      value,
      commands: allCmds,
      models,
      selectedModel: model,
    })
  }, [allCmds, model, models, value])

  const filtered = getFilteredCmds()

  // Sync menu visibility when filtered results change
  useEffect(() => {
    const shouldShow = value.startsWith("/") && filtered.length > 0
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deriving UI state from input value
    setShowMenu(shouldShow)
    setSelectedIdx(0)
  }, [value, filtered.length])

  // Close model picker on outside click
  useEffect(() => {
    if (!modelMenuOpen) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (modelMenuRef.current?.contains(target)) return
      if (modelBtnRef.current?.contains(target)) return
      setModelMenuOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [modelMenuOpen])

  const handleKey = (e: React.KeyboardEvent) => {
    if (isRunning && e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      return
    }
    if (showMenu && !isRunning) {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setSelectedIdx(i => Math.min(i + 1, filtered.length - 1))
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        setSelectedIdx(i => Math.max(i - 1, 0))
      } else if (e.key === "Tab" || e.key === "Enter") {
        if (filtered[selectedIdx]) {
          e.preventDefault()
          const item = filtered[selectedIdx]
          if ("isModel" in item) {
            onSubmit(`/model ${item.name}`)
            setValue("")
            setShowMenu(false)
          } else {
            setValue(`/${item.name} `)
            setShowMenu(false)
          }
          return
        }
      } else if (e.key === "Escape") {
        setShowMenu(false)
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !showMenu) {
      e.preventDefault()
      if (value.trim() || attachments.length) {
        onSubmit(value.trim(), attachments.length ? attachments : undefined)
        setValue("")
        clearAttachments()
      }
    }
  }

  return (
    <div className="relative" ref={dropRef}
      onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}>
      {showMenu && !isRunning && (
        <div className="absolute bottom-full left-0 w-full max-w-80 bg-card/95 backdrop-blur-sm border border-border rounded-md mb-1 max-h-48 overflow-auto shadow-lg">
          {filtered.map((c, i) => (
            <div key={c.name} onClick={() => {
              if ("isModel" in c) {
                onSubmit(`/model ${c.name}`)
                setValue("")
              } else {
                setValue(`/${c.name} `)
              }
              setShowMenu(false)
            }} className={`px-3 py-1.5 cursor-pointer ${i === selectedIdx ? "bg-secondary text-foreground" : "hover:bg-muted"}`}>
              <span className={i === selectedIdx ? "text-foreground" : "text-accent-blue"}>
                {"isModel" in c ? c.name : `/${c.name}${c.args ? ` ${c.args}` : ""}`}
              </span>
              <span className={`ml-2 text-[11px] ${i === selectedIdx ? "text-secondary-foreground" : "text-muted-foreground"}`}>{c.description}</span>
            </div>
          ))}
        </div>
      )}
      {isRunning && (
        <div
          data-testid="agent-running-indicator"
          aria-live="polite"
          className="border-accent-blue/20 bg-accent-blue/[0.06] text-accent-blue flex items-center gap-2 border-t px-3 py-2 text-xs"
        >
          <span className="bg-accent-blue h-1.5 w-1.5 animate-pulse rounded-full" />
          <span>{runningLabel}</span>
          {onStop && (
            <button
              type="button"
              onClick={onStop}
              className="text-accent-red hover:bg-accent-red/10 ml-auto rounded px-2 py-0.5"
            >
              Stop
            </button>
          )}
        </div>
      )}
      {attachments.length > 0 && (
        <div className="flex gap-2 px-2 py-2 border-t border-border overflow-x-auto">
          {attachments.map((a, i) => (
            <div key={i} className="relative flex-shrink-0 group">
              {a.type === "image" ? (
                <img src={a.url} alt={a.name} className="h-12 w-12 object-cover border border-border rounded" />
              ) : (
                <div className="h-12 w-12 bg-secondary flex items-center justify-center border border-border rounded text-[11px] text-muted-foreground">{a.name.slice(-4)}</div>
              )}
              <button type="button" aria-label={`Remove ${a.name}`} onClick={() => removeAttachment(i)} className="absolute -top-1 -right-1 w-4 h-4 bg-destructive text-destructive-foreground text-[11px] rounded-full opacity-0 group-hover:opacity-100">×</button>
            </div>
          ))}
        </div>
      )}
      {attachmentError && (
        <div role="alert" className="text-accent-red border-border border-t px-3 py-1.5 text-xs">
          {attachmentError}
        </div>
      )}
      <div className={`flex items-end gap-2 px-3 py-3 border-t border-border bg-secondary pb-[max(0.75rem,env(safe-area-inset-bottom))] ${isDragging ? "bg-accent-blue/10 border-dashed border-accent-blue" : ""}`}>
        <span className="text-foreground leading-5">{">"}</span>
        <textarea ref={inputRef} value={value} onChange={e => setValue(e.target.value)} onKeyDown={handleKey} onPaste={handlePaste}
          rows={1}
          className="flex-1 bg-transparent outline-none text-foreground text-sm placeholder:text-muted-foreground resize-y min-h-5 max-h-48 [field-sizing:content]"
          placeholder={isRunning ? "Agent is working. You can draft the next message here." : "Ask the agent what to build, fix, or explain. Type / for commands or drop files here."} />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[12px] text-muted-foreground border-t border-border/50">
        <span className={mode === "YOLO" ? "text-accent-amber" : ""}>Mode: {mode}</span>
        <span className="text-border">|</span>
        <span>Context: {contextPct}% left</span>
        <span className="text-border">|</span>
        <div className="relative">
          <button
            ref={modelBtnRef}
            disabled={isRunning}
            onClick={() => {
              setModelMenuOpen(o => {
                if (!o && modelBtnRef.current) {
                  const rect = modelBtnRef.current.getBoundingClientRect()
                  setMenuPos({ left: rect.left, bottom: window.innerHeight - rect.top + 4 })
                }
                return !o
              })
              setModelFilter("")
            }}
            className="text-accent-blue cursor-pointer hover:underline disabled:cursor-not-allowed disabled:opacity-50"
          >
            Model: {model?.startsWith("harness:") ? (model === "harness:claude-code" ? "Claude Code" : "Codex") : model?.split("/")[1] || "gpt-5-mini"}
          </button>
          {modelMenuOpen && (isMobile ? (
            <div ref={modelMenuRef} className="absolute bottom-full left-0 right-0 bg-card border border-border shadow-lg max-h-56 flex flex-col z-[9999] mb-1">
              <input
                value={modelFilter}
                onChange={e => setModelFilter(e.target.value)}
                placeholder="Search models..."
                className="border-b border-border bg-input px-2 py-1.5 text-[11px] text-foreground outline-none"
                autoFocus
              />
              <div className="flex-1 overflow-auto">
                {(!modelFilter || "claude code".includes(modelFilter.toLowerCase()) || "codex".includes(modelFilter.toLowerCase())) && (
                  <>
                    <div className="px-2 py-1 text-[11px] text-muted-foreground uppercase tracking-wider bg-secondary/50">CLI Harnesses</div>
                    {HARNESS_ENTRIES
                      .filter(h => !modelFilter || h.label.toLowerCase().includes(modelFilter.toLowerCase()))
                      .map(h => (
                      <button
                        key={h.id}
                        onClick={() => {
                          onModelSelect?.(`harness:${h.id}`)
                          setModelMenuOpen(false)
                          setModelFilter("")
                        }}
                        className={`w-full text-left px-2 py-2.5 text-xs hover:bg-secondary/50 flex items-center gap-1.5 ${model === `harness:${h.id}` ? "text-accent-blue bg-accent-blue/5" : "text-foreground"}`}
                      >
                        <span>{h.icon}</span>
                        {h.label}
                      </button>
                    ))}
                    <div className="border-b border-border/50 my-0.5" />
                    <div className="px-2 py-1 text-[11px] text-muted-foreground uppercase tracking-wider bg-secondary/50">Models</div>
                  </>
                )}
                {models.filter(m => !modelFilter || m.toLowerCase().includes(modelFilter.toLowerCase())).map(m => (
                  <button
                    key={m}
                    onClick={() => {
                      if (onModelSelect) {
                        onModelSelect(m)
                      } else {
                        onSubmit(`/model ${m}`)
                      }
                      setModelMenuOpen(false)
                      setModelFilter("")
                    }}
                    className={`w-full text-left px-2 py-2.5 text-xs hover:bg-secondary/50 ${m === model ? "text-accent-blue bg-accent-blue/5" : "text-foreground"}`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
          ) : menuPos && createPortal(
            <div ref={modelMenuRef} className="fixed w-72 bg-card border border-border shadow-lg max-h-56 flex flex-col z-[9999]" style={{ left: menuPos.left, bottom: menuPos.bottom }}>
              <input
                value={modelFilter}
                onChange={e => setModelFilter(e.target.value)}
                placeholder="Search models..."
                className="border-b border-border bg-input px-2 py-1.5 text-[11px] text-foreground outline-none"
                autoFocus
              />
              <div className="flex-1 overflow-auto">
                {(!modelFilter || "claude code".includes(modelFilter.toLowerCase()) || "codex".includes(modelFilter.toLowerCase())) && (
                  <>
                    <div className="px-2 py-1 text-[11px] text-muted-foreground uppercase tracking-wider bg-secondary/50">CLI Harnesses</div>
                    {HARNESS_ENTRIES
                      .filter(h => !modelFilter || h.label.toLowerCase().includes(modelFilter.toLowerCase()))
                      .map(h => (
                      <button
                        key={h.id}
                        onClick={() => {
                          onModelSelect?.(`harness:${h.id}`)
                          setModelMenuOpen(false)
                          setModelFilter("")
                        }}
                        className={`w-full text-left px-2 py-1.5 text-[11px] hover:bg-secondary/50 flex items-center gap-1.5 ${model === `harness:${h.id}` ? "text-accent-blue bg-accent-blue/5" : "text-foreground"}`}
                      >
                        <span>{h.icon}</span>
                        {h.label}
                      </button>
                    ))}
                    <div className="border-b border-border/50 my-0.5" />
                    <div className="px-2 py-1 text-[11px] text-muted-foreground uppercase tracking-wider bg-secondary/50">Models</div>
                  </>
                )}
                {models.filter(m => !modelFilter || m.toLowerCase().includes(modelFilter.toLowerCase())).map(m => (
                  <button
                    key={m}
                    onClick={() => {
                      if (onModelSelect) {
                        onModelSelect(m)
                      } else {
                        onSubmit(`/model ${m}`)
                      }
                      setModelMenuOpen(false)
                      setModelFilter("")
                    }}
                    className={`w-full text-left px-2 py-1.5 text-[11px] hover:bg-secondary/50 ${m === model ? "text-accent-blue bg-accent-blue/5" : "text-foreground"}`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>,
            document.body
          ))}
        </div>
        {repoPath && (
          <>
            <span className="text-border">|</span>
            <span className="text-foreground">Repo: {repoPath}</span>
          </>
        )}
        <span className="text-border">|</span>
        <McpStatusButton repoId={repoId} />
      </div>
    </div>
  )
}
