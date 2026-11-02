"use client";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RepoSettingsForm } from "@/components/repo-settings-form";
import { RepoSecretsPanel } from "@/components/repo-secrets-panel";
import { RepoSnapshotPanel } from "@/components/repo-snapshot-panel";
import { RepoSkillsPanel } from "@/components/repo-skills-panel";
import { RepoRulesPanel } from "@/components/repo-rules-panel";
import { RepoModelsPanel } from "@/components/repo-models-panel";
import { useRepos } from "@/hooks/use-repos";
import { useRepoSettingsActions } from "@/hooks/use-repo-settings-actions";
import { EnvVarsPanel } from "./env-vars-panel";

export type ProjectSettingsTab =
  | "env"
  | "general"
  | "secrets"
  | "skills"
  | "rules"
  | "models"
  | "snapshot";

const TABS: { id: ProjectSettingsTab; label: string }[] = [
  { id: "env", label: "Environment variables" },
  { id: "general", label: "General" },
  { id: "secrets", label: "GitHub Secrets" },
  { id: "skills", label: "Skills" },
  { id: "rules", label: "Rules" },
  { id: "models", label: "Models" },
  { id: "snapshot", label: "Snapshot" },
];

/**
 * Right-side drawer over Command Center for one project's settings. It reads
 * the repo from the shared repos cache, so saves show up everywhere at once.
 */
export function ProjectSettingsDrawer({
  repoId,
  tab,
  onTabChange,
  onClose,
}: {
  repoId: string | null;
  tab: ProjectSettingsTab;
  onTabChange: (tab: ProjectSettingsTab) => void;
  onClose: () => void;
}) {
  const { repos, isLoading, error, mutate } = useRepos({
    showHidden: true,
    enabled: repoId !== null,
  });
  const { saveRepo, restartRepoSandbox } = useRepoSettingsActions(mutate);
  const repo = repos.find((item) => item.id === repoId) ?? null;

  return (
    <Sheet open={repoId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="gap-0">
        <SheetHeader className="border-border border-b">
          <SheetTitle>Project settings</SheetTitle>
          <SheetDescription>
            {repo?.full_name ?? "Settings for this project"}
          </SheetDescription>
        </SheetHeader>
        {repo ? (
          <Tabs
            value={tab}
            onValueChange={(value) => onTabChange(value as ProjectSettingsTab)}
            className="min-h-0 flex-1 gap-0"
          >
            <TabsList className="mx-4 mt-3 h-auto flex-wrap justify-start">
              {TABS.map((item) => (
                <TabsTrigger key={item.id} value={item.id}>
                  {item.label}
                </TabsTrigger>
              ))}
            </TabsList>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {/* Keyed by repo so each project opens with its own saved draft. */}
              <TabsContent value="env">
                <EnvVarsPanel key={repo.id} repo={repo} onSave={saveRepo} />
              </TabsContent>
              <TabsContent value="general">
                <RepoSettingsForm
                  key={repo.id}
                  repo={repo}
                  onSave={saveRepo}
                  onRestart={restartRepoSandbox}
                />
              </TabsContent>
              <TabsContent value="secrets">
                <RepoSecretsPanel repo={repo} />
              </TabsContent>
              <TabsContent value="skills">
                <RepoSkillsPanel repo={repo} />
              </TabsContent>
              <TabsContent value="rules">
                <RepoRulesPanel repo={repo} />
              </TabsContent>
              <TabsContent value="models">
                <RepoModelsPanel repo={repo} />
              </TabsContent>
              <TabsContent value="snapshot">
                <RepoSnapshotPanel repo={repo} />
              </TabsContent>
            </div>
          </Tabs>
        ) : (
          <p className="text-muted-foreground p-4 text-sm">
            {isLoading
              ? "Loading project…"
              : error
                ? "Could not load this project. Close and try again."
                : "This project is no longer connected."}
          </p>
        )}
      </SheetContent>
    </Sheet>
  );
}
