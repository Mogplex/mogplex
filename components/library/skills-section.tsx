"use client"
import { useState, useCallback, useEffect } from "react"
import useSWR from "swr"
import { toast } from "@/hooks/use-toast"
import { GLOBAL_SKILL_SCOPE, formatSkillScope, type SkillScope } from "@/lib/skills"

type Skill = {
  id: string
  name: string
  description: string | null
  scope: SkillScope
  content: string
  is_public: boolean
  tags: string[]
  usage_count: number
  created_at: string
}

type RegistrySkill = {
  id: string
  skillId: string
  name: string
  source: string
  installs: number
  description?: string
}

type VercelDoc = {
  title: string
  path: string
  url: string
  description: string
  depth: number
}

interface Props {
  /** Compact mode for split-pane usage */
  compact?: boolean
}

const skillsFetcher = (url: string) => fetch(url).then(res => res.ok ? res.json() : [])

function encodePathSegments(path: string) {
  return path.split("/").map(segment => encodeURIComponent(segment)).join("/")
}

async function readJsonSafely(res: Response) {
  try {
    return await res.json()
  } catch {
    return null
  }
}

export function SkillsSection({ compact }: Props) {
  const [tab, setTab] = useState<"browse" | "vercel" | "installed">("browse")
  const [registry, setRegistry] = useState<RegistrySkill[]>([])
  const [search, setSearch] = useState("")
  const [editing, setEditing] = useState<Skill | null>(null)
  const [creating, setCreating] = useState(false)
  const [loading, setLoading] = useState(false)
  const [registryError, setRegistryError] = useState<string | null>(null)
  const [vercelDocs, setVercelDocs] = useState<VercelDoc[]>([])
  const [vercelPreview, setVercelPreview] = useState<string | null>(null)
  const [vercelMarkdown, setVercelMarkdown] = useState("")
  const [installingRegistryId, setInstallingRegistryId] = useState<string | null>(null)
  const [installingVercelPath, setInstallingVercelPath] = useState<string | null>(null)

  // Search only applies on the installed tab; other tabs share the unfiltered list.
  const skillsKey = tab === "installed" && search
    ? `/api/skills?q=${encodeURIComponent(search)}`
    : "/api/skills"
  const { data: skills = [], mutate: mutateSkills } = useSWR<Skill[]>(skillsKey, skillsFetcher)
  const { data: allSkills = [], mutate: mutateAllSkills } = useSWR<Skill[]>("/api/skills", skillsFetcher)

  const fetchRegistry = useCallback(async (q?: string) => {
    setRegistryError(null)
    setLoading(true)
    const url = q
      ? `/api/skills/registry?q=${encodeURIComponent(q)}`
      : "/api/skills/registry"
    try {
      const res = await fetch(url)
      if (res.ok) {
        const data = await res.json()
        setRegistry(data.skills || [])
      } else {
        setRegistry([])
        setRegistryError(`Registry returned ${res.status}`)
      }
    } catch { setRegistry([]); setRegistryError("Failed to load registry") }
    setLoading(false)
  }, [])

  const fetchVercelDocs = useCallback(async (q?: string) => {
    setLoading(true)
    try {
      const params = q ? `?q=${encodeURIComponent(q)}` : ""
      const res = await fetch(`/api/skills/vercel-docs${params}`)
      if (res.ok) {
        const data = await res.json()
        setVercelDocs(data.docs || [])
      }
    } catch { setVercelDocs([]) }
    setLoading(false)
  }, [])

  const previewVercelDoc = async (path: string) => {
    if (vercelPreview === path) {
      setVercelPreview(null)
      setVercelMarkdown("")
      return
    }
    setVercelPreview(path)
    setVercelMarkdown("Loading...")
    try {
      const res = await fetch(`/api/skills/vercel-docs/${encodePathSegments(path)}`)
      if (res.ok) {
        const data = await res.json()
        setVercelMarkdown(data.markdown || "")
      } else {
        setVercelMarkdown("Failed to load document.")
      }
    } catch {
      setVercelMarkdown("Failed to load document.")
    }
  }

  const showInstalledSkills = useCallback(() => {
    setSearch("")
    setTab("installed")
  }, [])

  const installVercelDoc = async (doc: VercelDoc) => {
    setInstallingVercelPath(doc.path)
    try {
      const res = await fetch(`/api/skills/vercel-docs/${encodePathSegments(doc.path)}`)
      if (!res.ok) {
        const errorData = await readJsonSafely(res)
        throw new Error(errorData?.error || `Failed to fetch doc (${res.status})`)
      }
      const data = await res.json()
      await saveSkill({
        name: data.title || doc.title,
        content: data.markdown,
        description: doc.description || `Vercel docs: ${doc.path}`,
        is_public: false,
      })
      showInstalledSkills()
      toast({ title: "Skill installed", description: data.title || doc.title })
    } catch (error) {
      toast({
        title: "Install failed",
        description: error instanceof Error ? error.message : "Failed to install skill",
        variant: "destructive",
      })
    } finally {
      setInstallingVercelPath(null)
    }
  }

  useEffect(() => { if (tab === "browse") void fetchRegistry() }, [tab, fetchRegistry])
  useEffect(() => { if (tab === "vercel") void fetchVercelDocs() }, [tab, fetchVercelDocs])

  const saveSkill = async (skill: Partial<Skill>) => {
    const method = skill.id ? "PUT" : "POST"
    const res = await fetch("/api/skills", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(skill),
    })

    if (!res.ok) {
      const errorData = await readJsonSafely(res)
      throw new Error(errorData?.error || `Failed to ${skill.id ? "save" : "create"} skill`)
    }

    const savedSkill = await res.json() as Skill
    setEditing(null)
    setCreating(false)
    await Promise.all([mutateSkills(), mutateAllSkills()])
    return savedSkill
  }

  const deleteSkill = async (id: string) => {
    const res = await fetch(`/api/skills?id=${id}`, { method: "DELETE" })
    if (!res.ok) {
      const errorData = await readJsonSafely(res)
      toast({
        title: "Delete failed",
        description: errorData?.error || "Failed to delete skill",
        variant: "destructive",
      })
      return
    }
    await Promise.all([mutateSkills(), mutateAllSkills()])
    toast({ title: "Skill deleted" })
  }

  const installFromRegistry = async (rs: RegistrySkill) => {
    setInstallingRegistryId(rs.id)
    try {
      const detailPath = encodePathSegments(`${rs.source}/${rs.skillId}`)
      const detailRes = await fetch(`/api/skills/registry/${detailPath}`)
      const detailData = detailRes.ok ? await detailRes.json() : null
      const content = detailData?.content?.trim()
        ? detailData.content
        : `# Installed from skills.sh\n# Source: ${rs.source}\n# Skill: ${rs.skillId}\n# Run: ${detailData?.installCommand || `npx skills add ${rs.source} --skill ${rs.skillId}`}\n\n${detailData?.description || rs.description || ""}`

      await saveSkill({
        name: detailData?.name || rs.name,
        content,
        is_public: false,
        description: detailData?.description || rs.description || null,
      })
      showInstalledSkills()
      toast({ title: "Skill installed", description: detailData?.name || rs.name })
    } catch (error) {
      toast({
        title: "Install failed",
        description: error instanceof Error ? error.message : "Failed to install skill",
        variant: "destructive",
      })
    } finally {
      setInstallingRegistryId(null)
    }
  }

  const formatInstalls = (n?: number) => {
    if (!n) return "0"
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
    return n.toString()
  }

  if (editing || creating) {
    return (
      <SkillEditor
        skill={editing}
        onSave={saveSkill}
        onCancel={() => { setEditing(null); setCreating(false) }}
        compact={compact}
      />
    )
  }

  if (compact) {
    // Pane layout — original compact design
    return (
      <div className="flex flex-col h-full">
        <div role="tablist" className="flex border-b border-border">
          <button role="tab" aria-selected={tab === "browse"} onClick={() => setTab("browse")} className={`flex-1 px-2 py-2 text-[11px] ${tab === "browse" ? "bg-muted text-foreground border-b-2 border-foreground" : "text-muted-foreground hover:bg-secondary"}`}>
            Skills.sh
          </button>
          <button role="tab" aria-selected={tab === "vercel"} onClick={() => setTab("vercel")} className={`flex-1 px-2 py-2 text-[11px] ${tab === "vercel" ? "bg-muted text-foreground border-b-2 border-foreground" : "text-muted-foreground hover:bg-secondary"}`}>
            Vercel Docs
          </button>
          <button role="tab" aria-selected={tab === "installed"} onClick={() => setTab("installed")} className={`flex-1 px-2 py-2 text-[11px] ${tab === "installed" ? "bg-muted text-foreground border-b-2 border-foreground" : "text-muted-foreground hover:bg-secondary"}`}>
            Installed ({allSkills.length})
          </button>
        </div>

        {tab === "browse" && (
          <>
            <div className="flex gap-1 p-1 border-b border-border">
              <input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === "Enter" && fetchRegistry(search)} placeholder="SEARCH SKILLS.SH..." className="flex-1 px-2 py-1 bg-input text-foreground text-[11px] border border-border" />
              <button onClick={() => fetchRegistry(search)} className="px-2 py-1 bg-secondary text-[11px] text-muted-foreground border border-border hover:text-foreground">Find</button>
            </div>
            <div className="flex-1 overflow-auto p-2 space-y-1">
              {loading && <div className="text-muted-foreground text-[11px]">Searching...</div>}
              {!loading && registry.length === 0 && <div className="text-muted-foreground text-[11px]">No skills found</div>}
              {registryError && <div className="text-destructive text-[11px]">{registryError} <button onClick={() => { setRegistryError(null); void fetchRegistry() }} className="underline">Retry</button></div>}
              {registry.map((rs, i) => (
                <div key={rs.id || i} className="border border-border p-2 group">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-foreground text-[11px] font-medium truncate">{rs.name}</div>
                      <div className="text-muted-foreground text-[11px] truncate">{rs.source}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[11px] text-muted-foreground">{formatInstalls(rs.installs)}</span>
                      <button
                        onClick={() => installFromRegistry(rs)}
                        disabled={installingRegistryId === rs.id}
                        className="text-[11px] px-2 py-1 bg-primary text-primary-foreground rounded hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {installingRegistryId === rs.id ? "Adding..." : "Add"}
                      </button>
                    </div>
                  </div>
                  {rs.description && <div className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{rs.description}</div>}
                </div>
              ))}
            </div>
            <div className="p-2 border-t border-border text-[11px] text-muted-foreground">
              <a href="https://skills.sh" target="_blank" rel="noopener noreferrer" className="text-accent-blue hover:underline">Browse more at skills.sh</a>
            </div>
          </>
        )}

        {tab === "vercel" && (
          <>
            <div className="flex gap-1 p-1 border-b border-border">
              <input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === "Enter" && fetchVercelDocs(search)} placeholder="SEARCH VERCEL DOCS..." className="flex-1 px-2 py-1 bg-input text-foreground text-[11px] border border-border" />
              <button onClick={() => fetchVercelDocs(search)} className="px-2 py-1 bg-secondary text-[11px] text-muted-foreground border border-border hover:text-foreground">Find</button>
            </div>
            <div className="flex-1 overflow-auto p-2 space-y-1">
              {loading && <div className="text-muted-foreground text-[11px]">Searching...</div>}
              {!loading && vercelDocs.length === 0 && <div className="text-muted-foreground text-[11px]">No docs found</div>}
              {vercelDocs.map((doc) => (
                <div key={doc.path} className="border border-border p-2 group">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-foreground text-[11px] font-medium truncate">{doc.title}</div>
                      <div className="text-muted-foreground text-[11px] truncate">{doc.path}</div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button onClick={() => previewVercelDoc(doc.path)} className="text-[11px] px-2 py-1 border border-border rounded hover:bg-secondary">{vercelPreview === doc.path ? "Hide" : "Preview"}</button>
                      <button
                        onClick={() => installVercelDoc(doc)}
                        disabled={installingVercelPath === doc.path}
                        className="text-[11px] px-2 py-1 bg-primary text-primary-foreground rounded hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {installingVercelPath === doc.path ? "Installing..." : "Install"}
                      </button>
                    </div>
                  </div>
                  {doc.description && <div className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{doc.description}</div>}
                  {vercelPreview === doc.path && (
                    <pre className="mt-2 p-2 bg-muted text-[11px] text-foreground font-mono overflow-auto max-h-40 whitespace-pre-wrap border border-border">{vercelMarkdown.slice(0, 2000)}{vercelMarkdown.length > 2000 ? "\n..." : ""}</pre>
                  )}
                </div>
              ))}
            </div>
            <div className="p-2 border-t border-border text-[11px] text-muted-foreground">
              Powered by <a href="https://vercel.com/docs" target="_blank" rel="noopener noreferrer" className="text-accent-blue hover:underline">vercel.com/docs</a>
            </div>
          </>
        )}

        {tab === "installed" && (
          <>
            <div className="flex gap-1 p-1 border-b border-border">
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="SEARCH..." className="flex-1 px-2 py-1 bg-input text-foreground text-[11px] border border-border" />
              <button onClick={() => setCreating(true)} className="px-2 py-1 bg-primary text-primary-foreground text-[11px] rounded">New</button>
            </div>
            <div className="flex-1 overflow-auto p-2 space-y-1">
              {skills.length === 0 && (
                <div className="text-muted-foreground text-[11px]">No skills yet</div>
              )}
              {skills.map(s => (
                <div key={s.id} onClick={() => setEditing(s)} className="border border-border p-2 cursor-pointer hover:bg-secondary group">
                  <div className="flex items-center justify-between">
                    <span className="text-foreground text-[11px]">{s.name}</span>
                    <button onClick={e => { e.stopPropagation(); deleteSkill(s.id) }} className="opacity-0 group-hover:opacity-100 text-destructive text-[11px]">Delete</button>
                  </div>
                  {s.description && <div className="text-muted-foreground text-[11px] mt-0.5">{s.description}</div>}
                  <div className="flex gap-2 mt-1 text-[11px] text-muted-foreground">
                    <span>Scope: {formatSkillScope(s.scope)}</span>
                    {s.is_public && <span className="text-accent-green">Public</span>}
                    <span>{s.usage_count} uses</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    )
  }

  // Full-page Library layout
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="ui-section-title">Skills</div>
          <div className="ui-section-caption">
            Global · applies to every space unless excluded in that space&apos;s settings.
            {" "}
            {allSkills.length} installed skills. Project-specific skills are managed in each space&apos;s settings.
          </div>
        </div>
      </div>

      <div role="tablist" className="flex gap-2">
        <button
          role="tab"
          aria-selected={tab === "browse"}
          onClick={() => setTab("browse")}
          className={`px-3 py-1.5 border text-sm cursor-pointer ${tab === "browse" ? "border-primary text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
        >
          Skills.sh Registry
        </button>
        <button
          role="tab"
          aria-selected={tab === "vercel"}
          onClick={() => setTab("vercel")}
          className={`px-3 py-1.5 border text-sm cursor-pointer ${tab === "vercel" ? "border-primary text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
        >
          Vercel Docs
        </button>
        <button
          role="tab"
          aria-selected={tab === "installed"}
          onClick={() => setTab("installed")}
          className={`px-3 py-1.5 border text-sm cursor-pointer ${tab === "installed" ? "border-primary text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
        >
          Installed ({allSkills.length})
        </button>
      </div>

      {tab === "browse" && (
        <div className="border border-border bg-card">
          <div className="flex gap-2 p-3 border-b border-border">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === "Enter" && fetchRegistry(search)}
              placeholder="Search skills.sh..."
              className="flex-1 border border-border bg-input px-3 py-2 text-sm text-foreground"
            />
            <button onClick={() => fetchRegistry(search)} className="border border-border px-3 py-2 text-sm text-foreground hover:bg-secondary cursor-pointer">Search</button>
          </div>
          <div className="max-h-[50vh] overflow-auto divide-y divide-border">
            {loading && <div className="p-4 text-sm text-muted-foreground">Searching...</div>}
            {!loading && registry.length === 0 && <div className="p-4 text-sm text-muted-foreground">No skills found</div>}
            {registryError && <div className="p-4 text-sm text-destructive">{registryError} <button onClick={() => { setRegistryError(null); void fetchRegistry() }} className="underline">Retry</button></div>}
            {registry.map((rs, i) => (
              <div key={rs.id || i} className="px-4 py-3 hover:bg-secondary/50">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-foreground font-medium">{rs.name}</div>
                    <div className="text-[11px] text-muted-foreground">{rs.source}</div>
                    {rs.description && <div className="text-[11px] text-muted-foreground mt-1">{rs.description}</div>}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-[11px] text-muted-foreground">{formatInstalls(rs.installs)} installs</span>
                    <button
                      onClick={() => installFromRegistry(rs)}
                      disabled={installingRegistryId === rs.id}
                      className="border border-border px-2 py-1 text-[11px] text-foreground hover:bg-secondary cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {installingRegistryId === rs.id ? "Installing..." : "Install"}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="p-3 border-t border-border text-[11px] text-muted-foreground">
            <a href="https://skills.sh" target="_blank" rel="noopener noreferrer" className="text-accent-blue hover:underline">Browse more at skills.sh</a>
          </div>
        </div>
      )}

      {tab === "vercel" && (
        <div className="border border-border bg-card">
          <div className="flex gap-2 p-3 border-b border-border">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === "Enter" && fetchVercelDocs(search)}
              placeholder="Search Vercel docs..."
              className="flex-1 border border-border bg-input px-3 py-2 text-sm text-foreground"
            />
            <button onClick={() => fetchVercelDocs(search)} className="border border-border px-3 py-2 text-sm text-foreground hover:bg-secondary cursor-pointer">Search</button>
          </div>
          <div className="max-h-[50vh] overflow-auto divide-y divide-border">
            {loading && <div className="p-4 text-sm text-muted-foreground">Searching...</div>}
            {!loading && vercelDocs.length === 0 && <div className="p-4 text-sm text-muted-foreground">No docs found</div>}
            {vercelDocs.map((doc) => (
              <div key={doc.path} className="px-4 py-3 hover:bg-secondary/50">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-foreground font-medium">{doc.title}</div>
                    <div className="text-[11px] text-muted-foreground">{doc.path}</div>
                    {doc.description && <div className="text-[11px] text-muted-foreground mt-1">{doc.description}</div>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => previewVercelDoc(doc.path)} className="border border-border px-2 py-1 text-[11px] text-foreground hover:bg-secondary cursor-pointer">
                      {vercelPreview === doc.path ? "Hide" : "Preview"}
                    </button>
                    <button
                      onClick={() => installVercelDoc(doc)}
                      disabled={installingVercelPath === doc.path}
                      className="border border-border px-2 py-1 text-[11px] text-foreground hover:bg-secondary cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {installingVercelPath === doc.path ? "Installing..." : "Install"}
                    </button>
                  </div>
                </div>
                {vercelPreview === doc.path && (
                  <pre className="mt-2 p-3 bg-muted text-[11px] text-foreground font-mono overflow-auto max-h-60 whitespace-pre-wrap border border-border rounded">{vercelMarkdown.slice(0, 3000)}{vercelMarkdown.length > 3000 ? "\n..." : ""}</pre>
                )}
              </div>
            ))}
          </div>
          <div className="p-3 border-t border-border text-[11px] text-muted-foreground">
            Powered by <a href="https://vercel.com/docs" target="_blank" rel="noopener noreferrer" className="text-accent-blue hover:underline">vercel.com/docs</a>
          </div>
        </div>
      )}

      {tab === "installed" && (
        <>
          <div className="flex items-center gap-2">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search..."
              className="flex-1 border border-border bg-input px-3 py-2 text-sm text-foreground"
            />
            <button onClick={() => setCreating(true)} className="border border-border px-3 py-2 text-sm text-foreground hover:bg-secondary cursor-pointer">
              New skill
            </button>
          </div>

          <div className="border border-border bg-card">
            {skills.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">No skills yet.</div>
            ) : (
              <div className="divide-y divide-border">
                {skills.map(s => (
                  <div key={s.id} onClick={() => setEditing(s)} className="px-4 py-3 cursor-pointer hover:bg-secondary/50 group">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-foreground">{s.name}</span>
                      <button onClick={e => { e.stopPropagation(); deleteSkill(s.id) }} className="opacity-0 group-hover:opacity-100 text-[11px] text-muted-foreground hover:text-destructive">Delete</button>
                    </div>
                    {s.description && <div className="text-[11px] text-muted-foreground mt-0.5">{s.description}</div>}
                    <div className="flex gap-3 mt-1 text-[11px] text-muted-foreground">
                      <span>Scope: {formatSkillScope(s.scope)}</span>
                      {s.is_public && <span className="text-accent-green">Public</span>}
                      <span>{s.usage_count} uses</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function SkillEditor({
  skill,
  onSave,
  onCancel,
  compact,
}: {
  skill: Skill | null
  onSave: (s: Partial<Skill>) => Promise<Skill>
  onCancel: () => void
  compact?: boolean
}) {
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
