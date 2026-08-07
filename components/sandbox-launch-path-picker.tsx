"use client";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { WorkspaceFetchState } from "./sandbox-launch-types";

type PathPickerProps = {
  pathSelection: string;
  setPathSelection: (value: string) => void;
  customPath: string;
  setCustomPath: (value: string) => void;
  pathError: string | null;
  setPathError: (value: string | null) => void;
  workspaceState: WorkspaceFetchState;
  repoDefaultPath: string | null;
  REPO_ROOT_VALUE: string;
  CUSTOM_PATH_VALUE: string;
};

export function SandboxLaunchPathPicker({
  pathSelection,
  setPathSelection,
  customPath,
  setCustomPath,
  pathError,
  setPathError,
  workspaceState,
  repoDefaultPath,
  REPO_ROOT_VALUE,
  CUSTOM_PATH_VALUE,
}: PathPickerProps) {
  return (
    <div className="space-y-2">
      <div className="text-muted-foreground flex items-center justify-between text-[11px] tracking-[0.2em] uppercase">
        <span>Working Directory</span>
        {repoDefaultPath ? (
          <span className="font-mono tracking-normal normal-case">
            Default: {repoDefaultPath}
          </span>
        ) : null}
      </div>
      <Select
        value={pathSelection}
        onValueChange={(value) => {
          setPathSelection(value);
          setPathError(null);
        }}
      >
        <SelectTrigger className="font-mono text-[12px]">
          <SelectValue placeholder="Pick a working directory" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={REPO_ROOT_VALUE}>Repo root</SelectItem>
          {workspaceState.status === "ready"
            ? workspaceState.workspaces.map((ws) => (
                <SelectItem
                  key={ws.path}
                  value={ws.path}
                  className="font-mono text-[12px]"
                >
                  {ws.path}
                  {ws.framework ? ` · ${ws.framework}` : ""}
                </SelectItem>
              ))
            : null}
          <SelectItem
            value={CUSTOM_PATH_VALUE}
            className="font-mono text-[12px]"
          >
            Other path...
          </SelectItem>
        </SelectContent>
      </Select>
      {pathSelection === CUSTOM_PATH_VALUE ? (
        <Input
          value={customPath}
          onChange={(event) => {
            setCustomPath(event.target.value);
            setPathError(null);
          }}
          placeholder="apps/web"
          className="font-mono text-[12px]"
        />
      ) : null}
      {workspaceState.status === "loading" ? (
        <p className="text-muted-foreground text-[11px] leading-5">
          Detecting workspaces...
        </p>
      ) : null}
      {workspaceState.status === "error" ? (
        <p className="text-muted-foreground text-[11px] leading-5">
          Couldn't detect workspaces — pick a path manually if needed.
        </p>
      ) : null}
      {pathError ? (
        <div className="border-destructive/40 bg-destructive/10 text-destructive rounded-lg border px-3 py-2 text-[11px]">
          {pathError}
        </div>
      ) : null}
    </div>
  );
}
