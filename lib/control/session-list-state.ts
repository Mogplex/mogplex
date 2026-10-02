export function resolveSessionListState({
  loaded,
  error,
  count,
}: {
  loaded: boolean;
  error: string | null;
  count: number;
}): "loading" | "error" | "empty" | "ready" {
  if (error) return "error";
  if (!loaded) return "loading";
  return count === 0 ? "empty" : "ready";
}
