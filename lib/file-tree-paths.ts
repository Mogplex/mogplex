export function isDirectoryTreePath(path: string) {
  return path.endsWith("/");
}

export function stripDirectoryTreePath(path: string) {
  return isDirectoryTreePath(path) ? path.slice(0, -1) : path;
}

export function ensureDirectoryTreePath(path: string) {
  return isDirectoryTreePath(path) ? path : `${path}/`;
}

export function getTreePathBasename(path: string) {
  const trimmed = stripDirectoryTreePath(path);
  const lastSlash = trimmed.lastIndexOf("/");
  const basename = lastSlash === -1 ? trimmed : trimmed.slice(lastSlash + 1);
  return isDirectoryTreePath(path) ? `${basename}/` : basename;
}

export function getParentDirectoryTreePath(path: string) {
  const trimmed = stripDirectoryTreePath(path);
  const lastSlash = trimmed.lastIndexOf("/");
  if (lastSlash === -1) return null;
  return ensureDirectoryTreePath(trimmed.slice(0, lastSlash));
}

export function getAncestorDirectoryTreePaths(
  path: string,
  options?: { includeSelf?: boolean }
) {
  const target = stripDirectoryTreePath(path);
  if (!target) return [];

  const segments = target.split("/");
  const limit = isDirectoryTreePath(path)
    ? options?.includeSelf
      ? segments.length
      : segments.length - 1
    : segments.length - 1;

  const ancestors: string[] = [];
  for (let index = 1; index <= limit; index += 1) {
    ancestors.push(ensureDirectoryTreePath(segments.slice(0, index).join("/")));
  }
  return ancestors;
}

export function matchesTreePathTarget(path: string, targetPath: string) {
  return isDirectoryTreePath(targetPath)
    ? path === targetPath || path.startsWith(targetPath)
    : path === targetPath;
}

export function retargetTreePath(
  path: string,
  fromPath: string,
  toPath: string
) {
  if (isDirectoryTreePath(fromPath)) {
    if (!matchesTreePathTarget(path, fromPath)) return null;
    return `${toPath}${path.slice(fromPath.length)}`;
  }

  return path === fromPath ? toPath : null;
}

export function dedupeTreePaths(paths: readonly string[]) {
  return [...new Set(paths)];
}

export function sortTreePaths(paths: readonly string[]) {
  return dedupeTreePaths(paths).sort((left, right) => {
    const leftTrimmed = stripDirectoryTreePath(left);
    const rightTrimmed = stripDirectoryTreePath(right);
    const byName = leftTrimmed.localeCompare(rightTrimmed);
    if (byName !== 0) return byName;
    if (isDirectoryTreePath(left) === isDirectoryTreePath(right)) return 0;
    return isDirectoryTreePath(left) ? -1 : 1;
  });
}

export function addTreePath(paths: readonly string[], path: string) {
  return sortTreePaths([...paths, path]);
}

export function removeTreePath(paths: readonly string[], targetPath: string) {
  return sortTreePaths(
    paths.filter((path) => !matchesTreePathTarget(path, targetPath))
  );
}

export function applyTreeMoves(
  paths: readonly string[],
  moves: ReadonlyArray<{ fromPath: string; toPath: string }>
) {
  const nextPaths = paths.map((path) => {
    let nextPath = path;
    for (const move of moves) {
      const retargeted = retargetTreePath(nextPath, move.fromPath, move.toPath);
      if (retargeted) nextPath = retargeted;
    }
    return nextPath;
  });

  return sortTreePaths(nextPaths);
}

export function buildTreeDropDestinationPath(
  sourcePath: string,
  targetDirectoryPath: string | null
) {
  const basename = getTreePathBasename(sourcePath);
  return targetDirectoryPath ? `${targetDirectoryPath}${basename}` : basename;
}
