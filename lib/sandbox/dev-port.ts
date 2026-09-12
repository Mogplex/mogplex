import { normalizeRootDirectory } from "@/lib/repo-settings";
import { resolveMonorepoWebTargetFromFiles } from "./runtimes/node-monorepo";
import { resolvePackageDevPort } from "./package-dev-port";
import {
  githubRepositoryFiles,
  type RepositoryFiles,
} from "./repository-files";

export async function detectRepositoryDevPort(
  files: RepositoryFiles,
  input: {
    rootDirectory?: string | null;
    devCommand?: string | null;
    devPort?: number | null;
  }
) {
  if (input.devPort != null) return input.devPort;
  const root = normalizeRootDirectory(input.rootDirectory);
  const target = root ? null : await resolveMonorepoWebTargetFromFiles(files);
  return resolvePackageDevPort(files, {
    ...input,
    rootDirectory: target?.path ?? root,
  });
}

export async function detectGithubDevPort(input: {
  repoFullName: string;
  githubToken: string;
  ref: string;
  rootDirectory?: string | null;
  devCommand?: string | null;
  devPort?: number | null;
}) {
  if (input.devPort != null) return input.devPort;
  return detectRepositoryDevPort(githubRepositoryFiles(input), input);
}
