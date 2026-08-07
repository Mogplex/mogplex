"use client";

import { formatSkillScope } from "@/lib/skills";
import type { Skill, RegistrySkill, VercelDoc } from "./skills-section-types";
import { formatInstalls } from "./skills-section-types";

interface BrowseTabProps {
  compact?: boolean;
  search: string;
  setSearch: (v: string) => void;
  fetchRegistry: (q?: string) => void;
  loading: boolean;
  registry: RegistrySkill[];
  registryError: string | null;
  setRegistryError: (v: string | null) => void;
  installingRegistryId: string | null;
  installFromRegistry: (rs: RegistrySkill) => void;
}

export function BrowseTab({
  compact,
  search,
  setSearch,
  fetchRegistry,
  loading,
  registry,
  registryError,
  setRegistryError,
  installingRegistryId,
  installFromRegistry,
}: BrowseTabProps) {
  if (compact) {
    return (
      <>
        <div className="flex gap-1 p-1 border-b border-border">
          <input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === "Enter" && fetchRegistry(search)} placeholder="SEARCH SKILLS.SH..." className="flex-1 px-2 py-1 bg-input text-foreground text-[11px] border border-border" />
          <button onClick={() => fetchRegistry(search)} className="px-2 py-1 bg-secondary text-[11px] text-muted-foreground border border-border hover:text-foreground">Find</button>
        </div>
        <div className="flex-1 overflow-auto p-2 space-y-1">
          {loading && <div className="text-muted-foreground text-[11px]">Searching...</div>}
          {!loading && registry.length === 0 && <div className="text-muted-foreground text-[11px]">No skills found</div>}
          {registryError && <div className="text-destructive text-[11px]">{registryError} <button onClick={() => { setRegistryError(null); fetchRegistry(); }} className="underline">Retry</button></div>}
          {registry.map((rs, i) => (
            <div key={rs.id || i} className="border border-border p-2 group">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-foreground text-[11px] font-medium truncate">{rs.name}</div>
                  <div className="text-muted-foreground text-[11px] truncate">{rs.source}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[11px] text-muted-foreground">{formatInstalls(rs.installs)}</span>
                  <button onClick={() => installFromRegistry(rs)} disabled={installingRegistryId === rs.id} className="text-[11px] px-2 py-1 bg-primary text-primary-foreground rounded hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-60">
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
    );
  }

  return (
    <div className="border border-border bg-card">
      <div className="flex gap-2 p-3 border-b border-border">
        <input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === "Enter" && fetchRegistry(search)} placeholder="Search skills.sh..." className="flex-1 border border-border bg-input px-3 py-2 text-sm text-foreground" />
        <button onClick={() => fetchRegistry(search)} className="border border-border px-3 py-2 text-sm text-foreground hover:bg-secondary cursor-pointer">Search</button>
      </div>
      <div className="max-h-[50vh] overflow-auto divide-y divide-border">
        {loading && <div className="p-4 text-sm text-muted-foreground">Searching...</div>}
        {!loading && registry.length === 0 && <div className="p-4 text-sm text-muted-foreground">No skills found</div>}
        {registryError && <div className="p-4 text-sm text-destructive">{registryError} <button onClick={() => { setRegistryError(null); fetchRegistry(); }} className="underline">Retry</button></div>}
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
                <button onClick={() => installFromRegistry(rs)} disabled={installingRegistryId === rs.id} className="border border-border px-2 py-1 text-[11px] text-foreground hover:bg-secondary cursor-pointer disabled:cursor-not-allowed disabled:opacity-60">
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
  );
}

interface VercelTabProps {
  compact?: boolean;
  search: string;
  setSearch: (v: string) => void;
  fetchVercelDocs: (q?: string) => void;
  loading: boolean;
  vercelDocs: VercelDoc[];
  vercelPreview: string | null;
  vercelMarkdown: string;
  previewVercelDoc: (path: string) => void;
  installingVercelPath: string | null;
  installVercelDoc: (doc: VercelDoc) => void;
}

export function VercelTab({
  compact,
  search,
  setSearch,
  fetchVercelDocs,
  loading,
  vercelDocs,
  vercelPreview,
  vercelMarkdown,
  previewVercelDoc,
  installingVercelPath,
  installVercelDoc,
}: VercelTabProps) {
  if (compact) {
    return (
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
                  <button onClick={() => installVercelDoc(doc)} disabled={installingVercelPath === doc.path} className="text-[11px] px-2 py-1 bg-primary text-primary-foreground rounded hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-60">
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
    );
  }

  return (
    <div className="border border-border bg-card">
      <div className="flex gap-2 p-3 border-b border-border">
        <input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === "Enter" && fetchVercelDocs(search)} placeholder="Search Vercel docs..." className="flex-1 border border-border bg-input px-3 py-2 text-sm text-foreground" />
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
                <button onClick={() => installVercelDoc(doc)} disabled={installingVercelPath === doc.path} className="border border-border px-2 py-1 text-[11px] text-foreground hover:bg-secondary cursor-pointer disabled:cursor-not-allowed disabled:opacity-60">
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
  );
}

interface InstalledTabProps {
  compact?: boolean;
  search: string;
  setSearch: (v: string) => void;
  setCreating: (v: boolean) => void;
  skills: Skill[];
  setEditing: (s: Skill) => void;
  deleteSkill: (id: string) => void;
}

export function InstalledTab({
  compact,
  search,
  setSearch,
  setCreating,
  skills,
  setEditing,
  deleteSkill,
}: InstalledTabProps) {
  if (compact) {
    return (
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
                <button onClick={e => { e.stopPropagation(); deleteSkill(s.id); }} className="opacity-0 group-hover:opacity-100 text-destructive text-[11px]">Delete</button>
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
    );
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..." className="flex-1 border border-border bg-input px-3 py-2 text-sm text-foreground" />
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
                  <button onClick={e => { e.stopPropagation(); deleteSkill(s.id); }} className="opacity-0 group-hover:opacity-100 text-[11px] text-muted-foreground hover:text-destructive">Delete</button>
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
  );
}
