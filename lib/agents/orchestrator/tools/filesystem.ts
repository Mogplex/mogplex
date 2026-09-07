/**
 * Filesystem tools for the orchestrator.
 */
import { z } from "zod";
import type { OrchestratorToolDef } from "../types";

// --- Tool definitions ---

export const FILESYSTEM_TOOLS: OrchestratorToolDef[] = [
  {
    name: "read_file",
    category: "filesystem",
    description:
      "Read a file from the live sandbox checkout, or from GitHub when no sandbox is running",
    access: "read",
    implemented: true,
  },
  {
    name: "write_file",
    category: "filesystem",
    description: "Write a whole file in the sandbox and return the diff",
    access: "mutation",
    implemented: true,
  },
  {
    name: "edit_file",
    category: "filesystem",
    description: "Replace exact text in a sandbox file and return the diff",
    access: "mutation",
    implemented: true,
  },
  {
    name: "search_repo",
    category: "filesystem",
    description: "Search repository contents using GitHub code search",
    access: "read",
    implemented: true,
  },
  {
    name: "list_files",
    category: "filesystem",
    description:
      "List a directory in the live sandbox checkout, or on GitHub when no sandbox is running",
    access: "read",
    implemented: true,
  },
  {
    name: "read_repo_map",
    category: "filesystem",
    description: "Get a structural overview of the repository",
    access: "read",
    implemented: false,
  },
  {
    name: "copy_files",
    category: "filesystem",
    description: "Copy files between paths within the sandbox",
    access: "mutation",
    implemented: false,
  },
  {
    name: "delete_file",
    category: "filesystem",
    description: "Delete a file from the sandbox (requires approval)",
    access: "approval",
    implemented: false,
  },
];

// --- Schemas ---

export const readRepoMapSchema = z.object({
  maxDepth: z.number().optional().describe("Maximum directory depth"),
  includePatterns: z
    .array(z.string())
    .optional()
    .describe("Glob patterns to include"),
});

export const copyFilesSchema = z.object({
  source: z.string().describe("Source path"),
  destination: z.string().describe("Destination path"),
  recursive: z.boolean().optional().describe("Copy recursively"),
});

export const deleteFileSchema = z.object({
  path: z.string().describe("File path to delete"),
  reason: z.string().describe("Reason for deletion (for approval)"),
});

// --- Schema map for stub tools ---

export const FILESYSTEM_SCHEMAS: Record<string, z.ZodType> = {
  read_repo_map: readRepoMapSchema,
  copy_files: copyFilesSchema,
  delete_file: deleteFileSchema,
};
