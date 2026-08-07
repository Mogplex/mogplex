"use client"
import { useState } from "react"
import { toast } from "@/hooks/use-toast"
import { GLOBAL_SKILL_SCOPE, formatSkillScope } from "@/lib/skills"
import type { Skill } from "./skills-section-types"

interface SkillEditorProps {
  skill: Skill | null
  onSave: (s: Partial<Skill>) => Promise<Skill>
  onCancel: () => void
  compact?: boolean
}

export function SkillEditor({
  skill,
  onSave,
  onCancel,
  compact,
}: SkillEditorProps) {
  const [name, setName] = useState(skill?.name || "")
  const [description, setDescription] = useState(skill?.description || "")
  const [content, setContent] = useState(skill?.content || "")
  const [isPublic, setIsPublic] = useState(skill?.is_public || false)
  const scope = skill?.scope ?? GLOBAL_SKILL_SCOPE

  const handleSave = async () => {
    if (!name.trim() || !content.trim()) return
    try {
      await onSave({
        id: skill?.id,
        name,
        description: description || null,
        content,
        is_public: isPublic,
      })
      toast({ title: skill ? "Skill saved" : "Skill created", description: name })
    } catch (error) {
      toast({
        title: skill ? "Save failed" : "Create failed",
        description: error instanceof Error ? error.message : "Failed to save skill",
        variant: "destructive",
      })
    }
  }

  if (compact) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-2 py-1.5 border-b border-border">
          <span className="text-[11px] font-medium text-foreground">{skill ? "EDIT SKILL" : "NEW SKILL"}</span>
          <button onClick={onCancel} className="text-muted-foreground text-[11px] hover:text-foreground">Cancel</button>
        </div>
        <div className="flex-1 overflow-auto p-2 space-y-2">
          <div>
            <label className="ui-label">Name</label>
            <input value={name} onChange={e => setName(e.target.value)} className="w-full px-2 py-1.5 bg-input text-foreground text-[11px] border border-border mt-0.5" />
          </div>
          <div>
            <label className="ui-label">Description</label>
            <input value={description} onChange={e => setDescription(e.target.value)} className="w-full px-2 py-1.5 bg-input text-foreground text-[11px] border border-border mt-0.5" />
          </div>
          <div>
            <label className="ui-label">Scope</label>
            <div className="mt-0.5 border border-border bg-muted px-2 py-1.5 text-[11px] text-muted-foreground">
              {formatSkillScope(scope)}
            </div>
          </div>
          <div>
            <label className="ui-label">Content</label>
            <textarea value={content} onChange={e => setContent(e.target.value)} rows={12} className="w-full px-2 py-1.5 bg-input text-foreground text-[11px] font-mono border border-border mt-0.5 resize-none" />
          </div>
          <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <input type="checkbox" checked={isPublic} onChange={e => setIsPublic(e.target.checked)} />
            Make public
          </label>
        </div>
        <div className="p-2 border-t border-border">
          <button onClick={() => void handleSave()} className="w-full py-2 bg-primary text-primary-foreground text-[11px] border border-primary hover:bg-primary/90">
            Save skill
          </button>
        </div>
      </div>
    )
  }

  // Full-page editor
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="ui-section-title">{skill ? "Edit skill" : "New skill"}</div>
        <button onClick={onCancel} className="text-muted-foreground text-sm hover:text-foreground cursor-pointer">Cancel</button>
      </div>
      <div className="border border-border bg-card p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="ui-label uppercase">Name</label>
            <input value={name} onChange={e => setName(e.target.value)} className="w-full border border-border bg-input px-3 py-2 text-sm text-foreground mt-1" />
          </div>
          <div>
            <label className="ui-label uppercase">Scope</label>
            <div className="mt-1 border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
              {formatSkillScope(scope)}
            </div>
          </div>
        </div>
        <div>
          <label className="ui-label uppercase">Description</label>
          <input value={description} onChange={e => setDescription(e.target.value)} className="w-full border border-border bg-input px-3 py-2 text-sm text-foreground mt-1" />
        </div>
        <div>
          <label className="ui-label uppercase">Content</label>
          <textarea value={content} onChange={e => setContent(e.target.value)} rows={16} className="w-full border border-border bg-input px-3 py-2 text-sm text-foreground font-mono mt-1 resize-none" />
        </div>
        <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <input type="checkbox" checked={isPublic} onChange={e => setIsPublic(e.target.checked)} />
          Make public
        </label>
        <button onClick={() => void handleSave()} className="border border-primary px-4 py-2 text-sm text-primary hover:bg-primary hover:text-primary-foreground cursor-pointer">
          Save skill
        </button>
      </div>
    </div>
  )
}
