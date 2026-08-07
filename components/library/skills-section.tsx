"use client";
import { useState, useCallback, useEffect } from "react";
import useSWR from "swr";
import { toast } from "@/hooks/use-toast";
import { SkillEditor } from "./skill-editor";
import { BrowseTab, VercelTab, InstalledTab } from "./skills-tabs";
import {
  type Skill,
  type RegistrySkill,
  type VercelDoc,
  type TabType,
  encodePathSegments,
  readJsonSafely,
} from "./skills-section-types";

interface Props {
  /** Compact mode for split-pane usage */
  compact?: boolean;
}

const skillsFetcher = (url: string) => fetch(url).then(res => res.ok ? res.json() : []);

export function SkillsSection({ compact }: Props) {
  const [tab, setTab] = useState<TabType>("browse");
  const [registry, setRegistry] = useState<RegistrySkill[]>([]);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Skill | null>(null);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [registryError, setRegistryError] = useState<string | null>(null);
  const [vercelDocs, setVercelDocs] = useState<VercelDoc[]>([]);
  const [vercelPreview, setVercelPreview] = useState<string | null>(null);
  const [vercelMarkdown, setVercelMarkdown] = useState("");
  const [installingRegistryId, setInstallingRegistryId] = useState<string | null>(null);
  const [installingVercelPath, setInstallingVercelPath] = useState<string | null>(null);

  const skillsKey = tab === "installed" && search
    ? `/api/skills?q=${encodeURIComponent(search)}`
    : "/api/skills";
  const { data: skills = [], mutate: mutateSkills } = useSWR<Skill[]>(skillsKey, skillsFetcher);
  const { data: allSkills = [], mutate: mutateAllSkills } = useSWR<Skill[]>("/api/skills", skillsFetcher);

  const fetchRegistry = useCallback(async (q?: string) => {
    setRegistryError(null);
    setLoading(true);
    const url = q ? `/api/skills/registry?q=${encodeURIComponent(q)}` : "/api/skills/registry";
    try {
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setRegistry(data.skills || []);
      } else {
        setRegistry([]);
        setRegistryError(`Registry returned ${res.status}`);
      }
    } catch { setRegistry([]); setRegistryError("Failed to load registry"); }
    setLoading(false);
  }, []);

  const fetchVercelDocs = useCallback(async (q?: string) => {
    setLoading(true);
    try {
      const params = q ? `?q=${encodeURIComponent(q)}` : "";
      const res = await fetch(`/api/skills/vercel-docs${params}`);
      if (res.ok) {
        const data = await res.json();
        setVercelDocs(data.docs || []);
      }
    } catch { setVercelDocs([]); }
    setLoading(false);
  }, []);

  const previewVercelDoc = async (path: string) => {
    if (vercelPreview === path) {
      setVercelPreview(null);
      setVercelMarkdown("");
      return;
    }
    setVercelPreview(path);
    setVercelMarkdown("Loading...");
    try {
      const res = await fetch(`/api/skills/vercel-docs/${encodePathSegments(path)}`);
      setVercelMarkdown(res.ok ? (await res.json()).markdown || "" : "Failed to load document.");
    } catch {
      setVercelMarkdown("Failed to load document.");
    }
  };

  const showInstalledSkills = useCallback(() => {
    setSearch("");
    setTab("installed");
  }, []);

  const saveSkill = async (skill: Partial<Skill>) => {
    const method = skill.id ? "PUT" : "POST";
    const res = await fetch("/api/skills", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(skill),
    });

    if (!res.ok) {
      const errorData = await readJsonSafely(res);
      throw new Error(errorData?.error || `Failed to ${skill.id ? "save" : "create"} skill`);
    }

    const savedSkill = await res.json() as Skill;
    setEditing(null);
    setCreating(false);
    await Promise.all([mutateSkills(), mutateAllSkills()]);
    return savedSkill;
  };

  const deleteSkill = async (id: string) => {
    const res = await fetch(`/api/skills?id=${id}`, { method: "DELETE" });
    if (!res.ok) {
      const errorData = await readJsonSafely(res);
      toast({ title: "Delete failed", description: errorData?.error || "Failed to delete skill", variant: "destructive" });
      return;
    }
    await Promise.all([mutateSkills(), mutateAllSkills()]);
    toast({ title: "Skill deleted" });
  };

  const installVercelDoc = async (doc: VercelDoc) => {
    setInstallingVercelPath(doc.path);
    try {
      const res = await fetch(`/api/skills/vercel-docs/${encodePathSegments(doc.path)}`);
      if (!res.ok) {
        const errorData = await readJsonSafely(res);
        throw new Error(errorData?.error || `Failed to fetch doc (${res.status})`);
      }
      const data = await res.json();
      await saveSkill({
        name: data.title || doc.title,
        content: data.markdown,
        description: doc.description || `Vercel docs: ${doc.path}`,
        is_public: false,
      });
      showInstalledSkills();
      toast({ title: "Skill installed", description: data.title || doc.title });
    } catch (error) {
      toast({ title: "Install failed", description: error instanceof Error ? error.message : "Failed to install skill", variant: "destructive" });
    } finally {
      setInstallingVercelPath(null);
    }
  };

  const installFromRegistry = async (rs: RegistrySkill) => {
    setInstallingRegistryId(rs.id);
    try {
      const detailPath = encodePathSegments(`${rs.source}/${rs.skillId}`);
      const detailRes = await fetch(`/api/skills/registry/${detailPath}`);
      const detailData = detailRes.ok ? await detailRes.json() : null;
      const content = detailData?.content?.trim()
        ? detailData.content
        : `# Installed from skills.sh\n# Source: ${rs.source}\n# Skill: ${rs.skillId}\n# Run: ${detailData?.installCommand || `npx skills add ${rs.source} --skill ${rs.skillId}`}\n\n${detailData?.description || rs.description || ""}`;

      await saveSkill({
        name: detailData?.name || rs.name,
        content,
        is_public: false,
        description: detailData?.description || rs.description || null,
      });
      showInstalledSkills();
      toast({ title: "Skill installed", description: detailData?.name || rs.name });
    } catch (error) {
      toast({ title: "Install failed", description: error instanceof Error ? error.message : "Failed to install skill", variant: "destructive" });
    } finally {
      setInstallingRegistryId(null);
    }
  };

  useEffect(() => { if (tab === "browse") void fetchRegistry(); }, [tab, fetchRegistry]);
  useEffect(() => { if (tab === "vercel") void fetchVercelDocs(); }, [tab, fetchVercelDocs]);

  if (editing || creating) {
    return (
      <SkillEditor
        skill={editing}
        onSave={saveSkill}
        onCancel={() => { setEditing(null); setCreating(false); }}
        compact={compact}
      />
    );
  }

  if (compact) {
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
        {tab === "browse" && <BrowseTab compact search={search} setSearch={setSearch} fetchRegistry={fetchRegistry} loading={loading} registry={registry} registryError={registryError} setRegistryError={setRegistryError} installingRegistryId={installingRegistryId} installFromRegistry={installFromRegistry} />}
        {tab === "vercel" && <VercelTab compact search={search} setSearch={setSearch} fetchVercelDocs={fetchVercelDocs} loading={loading} vercelDocs={vercelDocs} vercelPreview={vercelPreview} vercelMarkdown={vercelMarkdown} previewVercelDoc={previewVercelDoc} installingVercelPath={installingVercelPath} installVercelDoc={installVercelDoc} />}
        {tab === "installed" && <InstalledTab compact search={search} setSearch={setSearch} setCreating={setCreating} skills={skills} setEditing={setEditing} deleteSkill={deleteSkill} />}
      </div>
    );
  }

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
        <button role="tab" aria-selected={tab === "browse"} onClick={() => setTab("browse")} className={`px-3 py-1.5 border text-sm cursor-pointer ${tab === "browse" ? "border-primary text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>
          Skills.sh Registry
        </button>
        <button role="tab" aria-selected={tab === "vercel"} onClick={() => setTab("vercel")} className={`px-3 py-1.5 border text-sm cursor-pointer ${tab === "vercel" ? "border-primary text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>
          Vercel Docs
        </button>
        <button role="tab" aria-selected={tab === "installed"} onClick={() => setTab("installed")} className={`px-3 py-1.5 border text-sm cursor-pointer ${tab === "installed" ? "border-primary text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>
          Installed ({allSkills.length})
        </button>
      </div>

      {tab === "browse" && <BrowseTab search={search} setSearch={setSearch} fetchRegistry={fetchRegistry} loading={loading} registry={registry} registryError={registryError} setRegistryError={setRegistryError} installingRegistryId={installingRegistryId} installFromRegistry={installFromRegistry} />}
      {tab === "vercel" && <VercelTab search={search} setSearch={setSearch} fetchVercelDocs={fetchVercelDocs} loading={loading} vercelDocs={vercelDocs} vercelPreview={vercelPreview} vercelMarkdown={vercelMarkdown} previewVercelDoc={previewVercelDoc} installingVercelPath={installingVercelPath} installVercelDoc={installVercelDoc} />}
      {tab === "installed" && <InstalledTab search={search} setSearch={setSearch} setCreating={setCreating} skills={skills} setEditing={setEditing} deleteSkill={deleteSkill} />}
    </div>
  );
}
