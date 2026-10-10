import type { SandboxError } from "@/lib/sandbox/error-state";
import type { PreviewPaneTab } from "@/hooks/use-split-panes";

export interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PreviewPaneProps {
  previewUrl?: string;
  sandboxRecordId?: string;
  sandboxCreating?: boolean;
  sandboxError?: SandboxError | null;
  sandboxId?: string;
  workingBranch?: string | null;
  rootLabel?: string;
  activeRepo?: {
    id: string;
    full_name: string;
    default_branch?: string;
    working_branch?: string | null;
  } | null;
  initialTab?: PreviewPaneTab;
  hideCodeTab?: boolean;
  activeFilePath?: string | null;
  onActiveFileChange?: (filePath: string | null) => void;
  onRetargetFilePath?: (
    fromPath: string,
    toPath: string,
    sandboxId: string
  ) => void;
  onClearFilePath?: (targetPath: string, sandboxId: string) => void;
  onTabChange?: (tab: PreviewPaneTab) => void;
  onPopOut?: (activeFile?: string) => void;
  /** Explicit null isolates Control from the repository workspace selection. */
  workspaceSessionId?: string | null;
  onSandboxChange?: (sandboxId: string) => void;
  onFeedback?: (text: string) => void;
}
