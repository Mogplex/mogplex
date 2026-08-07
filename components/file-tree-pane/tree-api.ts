import { getActiveTeamRequestHeaders } from "@/components/active-scope-provider";
import { readJsonResponse } from "./helpers";

export interface TreeMove {
  fromPath: string;
  toPath: string;
}

export async function fetchTreePaths(sandboxId: string) {
  const payload = await readJsonResponse<{ paths: string[] }>(
    await fetch(`/api/sandbox/${sandboxId}/tree`, { cache: "no-store" })
  );
  return payload.paths || [];
}

export async function renameTreeItem(
  sandboxId: string,
  sourcePath: string,
  destinationPath: string
) {
  return readJsonResponse<{ moves: TreeMove[] }>(
    await fetch(`/api/sandbox/${sandboxId}/tree`, {
      method: "PATCH",
      headers: getActiveTeamRequestHeaders({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({
        moves: [{ fromPath: sourcePath, toPath: destinationPath }],
      }),
    })
  );
}

export async function moveTreeItems(sandboxId: string, moves: TreeMove[]) {
  return readJsonResponse<{ moves: TreeMove[] }>(
    await fetch(`/api/sandbox/${sandboxId}/tree`, {
      method: "PATCH",
      headers: getActiveTeamRequestHeaders({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({ moves }),
    })
  );
}

export async function createTreeItem(
  sandboxId: string,
  kind: "directory" | "file",
  path: string
) {
  return readJsonResponse<{ path: string }>(
    await fetch(`/api/sandbox/${sandboxId}/tree`, {
      method: "POST",
      headers: getActiveTeamRequestHeaders({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({ kind, path }),
    })
  );
}

export async function deleteTreeItem(sandboxId: string, path: string) {
  return readJsonResponse<{ path: string }>(
    await fetch(`/api/sandbox/${sandboxId}/tree`, {
      method: "DELETE",
      headers: getActiveTeamRequestHeaders({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({ path }),
    })
  );
}
