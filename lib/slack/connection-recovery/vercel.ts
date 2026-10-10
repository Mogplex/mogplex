import { getOAuthToken } from "@/lib/oauth-tokens";
import { z } from "zod";

export type SlackVercelProject = {
  id: string;
  name: string;
  repository: string | null;
  framework: string | null;
};
const pagination = z
  .object({ next: z.number().nullable().optional() })
  .optional();
const teamsPage = z.object({
  teams: z.array(z.object({ id: z.string(), slug: z.string().optional() })),
  pagination,
});
const projectsPage = z.object({
  projects: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      framework: z.string().nullish(),
      link: z
        .object({
          type: z.string().optional(),
          org: z.string().optional(),
          repo: z.union([z.string(), z.number()]).optional(),
        })
        .nullish(),
    })
  ),
  pagination,
});

export class SlackVercelAccessError extends Error {
  constructor(readonly needsAuthorization: boolean) {
    super(
      needsAuthorization
        ? "Vercel access needs authorization for the requested team."
        : "Vercel could not load projects right now."
    );
  }
}

async function vercelGet<T>(
  url: URL,
  token: string,
  schema: z.ZodType<T>
): Promise<T> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new SlackVercelAccessError([401, 403, 404].includes(response.status));
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) throw new SlackVercelAccessError(false);
  return parsed.data;
}

/** Reads only the requesting user's token. Platform credentials never apply. */
export async function loadSlackVercelProjects(
  userId: string,
  team?: string,
  getToken = getOAuthToken
) {
  const token = await getToken(userId, "vercel");
  if (!token) throw new SlackVercelAccessError(true);
  let teamId: string | undefined;
  if (team && team !== "personal") {
    const url = new URL("https://api.vercel.com/v2/teams?limit=100");
    const seen = new Set<number>();
    for (;;) {
      const page = await vercelGet(url, token, teamsPage);
      teamId = page.teams?.find(
        (item) =>
          item.id === team || item.slug?.toLowerCase() === team.toLowerCase()
      )?.id;
      if (teamId || !page.pagination?.next || seen.has(page.pagination.next))
        break;
      seen.add(page.pagination.next);
      url.searchParams.set("until", String(page.pagination.next));
    }
    if (!teamId) throw new SlackVercelAccessError(true);
  }
  const url = new URL("https://api.vercel.com/v10/projects?limit=100");
  if (teamId) url.searchParams.set("teamId", teamId);
  const projects: SlackVercelProject[] = [];
  const seen = new Set<number>();
  for (;;) {
    const page = await vercelGet(url, token, projectsPage);
    for (const project of page.projects ?? []) {
      projects.push({
        id: project.id,
        name: project.name,
        framework: project.framework ?? null,
        repository:
          project.link?.type === "github" &&
          project.link.org &&
          project.link.repo
            ? `${project.link.org}/${project.link.repo}`
            : null,
      });
    }
    if (!page.pagination?.next || seen.has(page.pagination.next)) break;
    seen.add(page.pagination.next);
    url.searchParams.set("until", String(page.pagination.next));
  }
  return projects;
}
