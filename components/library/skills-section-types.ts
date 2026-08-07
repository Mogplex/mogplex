import type { SkillScope } from "@/lib/skills";

export type Skill = {
  id: string;
  name: string;
  description: string | null;
  scope: SkillScope;
  content: string;
  is_public: boolean;
  tags: string[];
  usage_count: number;
  created_at: string;
};

export type RegistrySkill = {
  id: string;
  skillId: string;
  name: string;
  source: string;
  installs: number;
  description?: string;
};

export type VercelDoc = {
  title: string;
  path: string;
  url: string;
  description: string;
  depth: number;
};

export type TabType = "browse" | "vercel" | "installed";

export function encodePathSegments(path: string) {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export async function readJsonSafely(res: Response) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export function formatInstalls(n?: number) {
  if (!n) return "0";
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
}
