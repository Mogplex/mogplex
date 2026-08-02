// Swap the first path segment (the scope) when the user picks a different
// scope from the switcher. If the current path is root-relative ("/" or
// "/[scope]"), navigate to the new scope's root. Search/hash are preserved.
export function switchScopePath(
  currentPath: string,
  currentScope: string | undefined,
  nextScope: string
): string {
  if (!nextScope) {
    throw new Error("switchScopePath: nextScope is required");
  }

  // Normalize: drop search/hash so we can rebuild deterministically.
  const [pathOnly, ...rest] = currentPath.split(/(?=[?#])/);
  const suffix = rest.join("");

  if (!pathOnly || pathOnly === "/") return `/${nextScope}${suffix}`;

  const segments = pathOnly.split("/").filter(Boolean);
  if (segments.length === 0) return `/${nextScope}${suffix}`;

  // If the first segment matches the current scope, swap it. Otherwise we're
  // on an unscoped surface (/new, /invite, /cli-auth, …) and the right
  // destination is the new scope's root — not "prefix the unscoped path".
  if (currentScope && segments[0] === currentScope) {
    segments[0] = nextScope;
    return `/${segments.join("/")}${suffix}`;
  }

  return `/${nextScope}`;
}
