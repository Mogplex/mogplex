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
  if (hasMission || sessionId) return "mission";
  if (!sessionsLoaded || restoring) return "loading";
  return "new";
}
