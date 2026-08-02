"use client"
import { useState } from "react"
import useSWR from "swr"

type FileItem = { id: string; name: string; content: string; type: string }

interface Props {
  /** Compact mode for split-pane usage */
  compact?: boolean
}

const fetcher = (url: string) => fetch(url).then(res => res.ok ? res.json() : [])

export function RulesSection({ compact }: Props) {
  const { data: files = [], mutate } = useSWR<FileItem[]>("/api/rules?table=agent_rules", fetcher)
  const [selected, setSelected] = useState<FileItem | null>(null)
  const [editing, setEditing] = useState(false)
  const [content, setContent] = useState("")
  const [newName, setNewName] = useState("")
  const [showNew, setShowNew] = useState(false)

  const selectFile = (f: FileItem) => {
    setSelected(f)
    setContent(f.content)
    setEditing(false)
  }

  const saveFile = async () => {
    if (!selected) return
    await fetch("/api/rules", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: selected.id, table: "agent_rules", content }),
    })
    setSelected({ ...selected, content })
    setEditing(false)
    await mutate()
  }

  const createFile = async () => {
    if (!newName.trim()) return
    await fetch("/api/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ table: "agent_rules", name: newName.trim(), content: `# ${newName.trim()}\n\n`, type: "rules" }),
    })
    setNewName("")
    setShowNew(false)
    await mutate()
  }

  const deleteFile = async (id: string) => {
    await fetch(`/api/rules?id=${id}&table=agent_rules`, { method: "DELETE" })
    if (selected?.id === id) { setSelected(null); setContent("") }
    await mutate()
  }

  if (compact) {
    return (
      <div className="flex flex-1 overflow-hidden">
        <div className="w-40 border-r border-border flex flex-col">
          <div className="flex items-center justify-between px-2 py-1 border-b border-border">
            <span className="ui-label">Rules</span>
            <button onClick={() => setShowNew(true)} className="text-accent-blue text-[11px] hover:underline">New</button>
          </div>
          {showNew && (
            <div className="p-2 border-b border-border space-y-1">
              <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="filename.md" className="w-full px-2 py-1 bg-input border border-border rounded text-[11px] text-foreground" />
              <div className="flex gap-1">
                <button onClick={createFile} className="flex-1 px-2 py-1 bg-primary text-primary-foreground text-[11px] rounded">Add</button>
                <button onClick={() => setShowNew(false)} className="px-2 py-1 bg-secondary text-[11px] rounded">Cancel</button>
              </div>
            </div>
          )}
          <div className="flex-1 overflow-auto">
            {files.length === 0 && <div className="p-2 text-muted-foreground text-[11px]">No rules yet</div>}
            {files.map(f => (
              <div key={f.id} onClick={() => selectFile(f)} className={`flex items-center justify-between px-2 py-1 cursor-pointer hover:bg-secondary group ${selected?.id === f.id ? "bg-secondary text-foreground" : ""}`}>
                <span className="text-[11px] truncate">{f.name}</span>
                <button onClick={e => { e.stopPropagation(); deleteFile(f.id) }} className="text-[11px] text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100">Delete</button>
              </div>
            ))}
          </div>
        </div>
        <div className="flex-1 flex flex-col overflow-hidden">
          {selected ? (
            <>
              <div className="flex items-center justify-between px-2 py-1 border-b border-border">
                <span className="text-foreground text-[11px]">{selected.name}</span>
                <div className="flex gap-2">
                  {editing ? (
                    <>
                      <button onClick={saveFile} className="text-accent-blue text-[11px] hover:underline">Save</button>
                      <button onClick={() => { setContent(selected.content); setEditing(false) }} className="text-muted-foreground text-[11px] hover:underline">Cancel</button>
                    </>
                  ) : (
                    <button onClick={() => setEditing(true)} className="text-accent-blue text-[11px] hover:underline">Edit</button>
                  )}
                </div>
              </div>
              {editing ? (
                <textarea value={content} onChange={e => setContent(e.target.value)} className="flex-1 p-2 bg-card text-foreground text-xs resize-none outline-none" />
              ) : (
                <div className="flex-1 overflow-auto p-2 text-foreground text-xs whitespace-pre-wrap">{content}</div>
              )}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-[11px]">Select a file or create a new rule</div>
          )}
        </div>
      </div>
    )
  }

  // Full-page layout for Library
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="ui-section-title">Agent Rules</div>
          <div className="ui-section-caption">
            Global · applies to every space unless excluded in that space&apos;s settings.
            {" "}{files.length} rules total. Rules provide instructions and constraints for your agents.
          </div>
        </div>
        <button onClick={() => setShowNew(true)} className="border border-border px-3 py-1.5 text-sm text-foreground hover:bg-secondary cursor-pointer">
          New Rule
        </button>
      </div>

      {showNew && (
        <div className="border border-border bg-card p-4 space-y-2">
          <div className="ui-kicker">New Rule</div>
          <div className="flex gap-2">
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="rule-name.md"
              className="flex-1 border border-border bg-input px-3 py-2 text-sm text-foreground"
            />
            <button onClick={createFile} className="border border-border px-3 py-2 text-sm text-foreground hover:bg-secondary cursor-pointer">Create</button>
            <button onClick={() => setShowNew(false)} className="border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-secondary cursor-pointer">Cancel</button>
          </div>
        </div>
      )}

      <div className="border border-border bg-card">
        {files.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No rules yet. Create one to get started.</div>
        ) : (
          <div className="divide-y divide-border">
            {files.map(f => (
              <div
                key={f.id}
                className={`px-4 py-3 cursor-pointer hover:bg-secondary/50 ${selected?.id === f.id ? "bg-secondary" : ""}`}
                onClick={() => selectFile(f)}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm text-foreground">{f.name}</span>
                  <button
                    onClick={e => { e.stopPropagation(); deleteFile(f.id) }}
                    className="text-[11px] text-muted-foreground hover:text-destructive"
                  >
                    Delete
                  </button>
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5 truncate">{f.content.slice(0, 100)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <div className="border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-2">
            <span className="text-sm text-foreground">{selected.name}</span>
            <div className="flex gap-2">
              {editing ? (
                <>
                  <button onClick={saveFile} className="text-accent-blue text-[11px] hover:underline cursor-pointer">Save</button>
                  <button onClick={() => { setContent(selected.content); setEditing(false) }} className="text-muted-foreground text-[11px] hover:underline cursor-pointer">Cancel</button>
                </>
              ) : (
                <button onClick={() => setEditing(true)} className="text-accent-blue text-[11px] hover:underline cursor-pointer">Edit</button>
              )}
            </div>
          </div>
          {editing ? (
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              className="w-full min-h-[200px] p-4 bg-card text-foreground text-xs font-mono resize-none outline-none"
            />
          ) : (
            <div className="p-4 text-foreground text-xs whitespace-pre-wrap">{content}</div>
          )}
        </div>
      )}
    </div>
  )
}
