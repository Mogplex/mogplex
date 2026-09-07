/**
 * Project grouping for the control session sidebar (pure, unit-tested).
 */

export type SessionGroupInput = {
  id: string;
  project?: string | null;
  updated_at: string;
};

export type SessionGroup<T extends SessionGroupInput> = {
  /** Display name; "General" collects sessions without a project. */
  name: string;
  /** Project slug as stored, or null for the General group. */
  project: string | null;
  sessions: T[];
};

export const GENERAL_GROUP_NAME = "General";

const PROJECT_COLORS = [
  "bg-project-blue",
  "bg-project-amber",
  "bg-project-green",
  "bg-project-red",
  "bg-project-teal",
  "bg-project-purple",
  "bg-project-pink",
] as const;

const NEUTRAL_COLOR = "bg-project-neutral";

function projectColorSlot(name: string): number {
  let hash = 0;
  for (const char of name) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 997;
  }
  return hash % PROJECT_COLORS.length;
}

/** Stable categorical color, independent of sorting and runtime status. */
export function projectColorClass(name: string): string {
  if (name === GENERAL_GROUP_NAME) return NEUTRAL_COLOR;
  return PROJECT_COLORS[projectColorSlot(name)];
}

/**
 * Colors for every project shown together. Each name prefers its hashed
 * color, but a name whose color is already taken moves to the next free one,
 * so projects on screen at the same time never share a dot until the palette
 * runs out. Names are claimed in alphabetical order so the result does not
 * depend on sidebar sorting or recency.
 */
export function assignProjectColors(names: string[]): Map<string, string> {
  const colors = new Map<string, string>();
  const taken = new Set<number>();
  for (const name of [...new Set(names)].sort()) {
    if (name === GENERAL_GROUP_NAME) {
      colors.set(name, NEUTRAL_COLOR);
      continue;
    }
    const preferred = projectColorSlot(name);
    let slot = preferred;
    if (taken.size < PROJECT_COLORS.length) {
      while (taken.has(slot)) slot = (slot + 1) % PROJECT_COLORS.length;
    }
    taken.add(slot);
    colors.set(name, PROJECT_COLORS[slot]);
  }
  return colors;
}

/**
 * Group sessions by project. Sessions inside a group sort by latest
 * activity first; groups sort by their most recently active session, with
 * General last so named projects always lead.
 */
export function groupSessionsByProject<T extends SessionGroupInput>(
  sessions: T[]
): SessionGroup<T>[] {
  const byProject = new Map<string | null, T[]>();
  for (const session of sessions) {
    const key = session.project?.trim() || null;
    const list = byProject.get(key) ?? [];
    list.push(session);
    byProject.set(key, list);
  }

  const latestActivity = (list: T[]) =>
    list.reduce(
      (latest, s) => Math.max(latest, Date.parse(s.updated_at) || 0),
      0
    );

  const groups: SessionGroup<T>[] = [...byProject.entries()].map(
    ([project, list]) => ({
      name: project ?? GENERAL_GROUP_NAME,
      project,
      sessions: [...list].sort(
        (a, b) =>
          (Date.parse(b.updated_at) || 0) - (Date.parse(a.updated_at) || 0)
      ),
    })
  );

  return groups.sort((a, b) => {
    if (a.project === null) return 1;
    if (b.project === null) return -1;
    return latestActivity(b.sessions) - latestActivity(a.sessions);
  });
}
