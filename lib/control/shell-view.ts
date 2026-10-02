export function resolveShellView({
  newMission,
  hasMission,
  sessionId,
  sessionsLoaded,
  restoring = false,
}: {
  newMission: boolean;
  hasMission: boolean;
  sessionId: string | null;
  sessionsLoaded: boolean;
  restoring?: boolean;
}): "loading" | "new" | "mission" {
  if (newMission) return "new";
  if (!sessionsLoaded || restoring) return "loading";
  return hasMission || sessionId ? "mission" : "new";
}
