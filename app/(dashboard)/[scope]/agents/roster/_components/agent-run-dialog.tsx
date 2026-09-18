"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { Agent } from "@/lib/types";
import { useRepos } from "@/hooks/use-repos";
import { scopedHref } from "@/lib/scoped-href";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const HARNESSES = [
  { id: "codex", label: "Codex" },
  { id: "claude-code", label: "Claude Code" },
  { id: "mogplex", label: "Mogplex" },
] as const;

type StartedRun = { runId: string; branch: { working: string } };

export function AgentRunDialog({
  agent,
  onClose,
  onStarted,
}: {
  agent: Agent | null;
  onClose: () => void;
  onStarted?: () => void;
}) {
  const { scope } = useParams<{ scope: string }>();
  const { repos, isLoading: reposLoading } = useRepos();
  const [repoId, setRepoId] = useState("");
  const [harness, setHarness] = useState<(typeof HARNESSES)[number]["id"]>("codex");
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState<StartedRun | null>(null);

  useEffect(() => {
    if (!agent) return;
    setPrompt("");
    setError(null);
    setStarted(null);
    setSubmitting(false);
  }, [agent]);

  useEffect(() => {
    if (!repoId && repos.length > 0) setRepoId(repos[0].id);
  }, [repoId, repos]);

  const submit = async () => {
    if (!agent || !repoId || !prompt.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/agents/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: agent.id,
          repoId,
          harness,
          prompt: prompt.trim(),
        }),
      });
      const payload = (await res.json().catch(() => null)) as
        | { run?: StartedRun; error?: string }
        | null;
      if (!res.ok || !payload?.run) {
        setError(payload?.error || "Failed to start run");
        return;
      }
      setStarted(payload.run);
      onStarted?.();
    } catch {
      setError("Network error while starting the run");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={Boolean(agent)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="w-[min(94vw,640px)] max-w-none">
        <DialogHeader>
          <DialogTitle>Run {agent?.name}</DialogTitle>
          <DialogDescription>
            Start a repository run as this agent. Its system prompt, rules, and
            skills load into the sandbox before the task.
          </DialogDescription>
        </DialogHeader>
        {started ? (
          <div className="space-y-3 text-sm">
            <p className="text-foreground">
              Run started on branch{" "}
              <code className="font-mono text-xs">{started.branch.working}</code>.
            </p>
            <p className="text-muted-foreground font-mono text-xs">
              {started.runId}
            </p>
            <div className="flex justify-end gap-2">
              <Link
                href={scopedHref(scope, "/observe")}
                className="text-primary text-sm hover:underline"
              >
                Open Observe
              </Link>
              <button
                onClick={onClose}
                className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-sm px-3 py-1.5 text-sm"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="text-foreground block font-medium">
                  Repository
                </span>
                <select
                  aria-label="Repository"
                  value={repoId}
                  onChange={(e) => setRepoId(e.target.value)}
                  disabled={reposLoading || repos.length === 0}
                  className="bg-input border-border text-foreground h-10 w-full rounded-sm border px-3 text-sm"
                >
                  {repos.length === 0 && (
                    <option value="">
                      {reposLoading ? "Loading repositories..." : "No repositories"}
                    </option>
                  )}
                  {repos.map((repo) => (
                    <option key={repo.id} value={repo.id}>
                      {repo.full_name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-foreground block font-medium">Harness</span>
                <select
                  aria-label="Harness"
                  value={harness}
                  onChange={(e) =>
                    setHarness(e.target.value as (typeof HARNESSES)[number]["id"])
                  }
                  className="bg-input border-border text-foreground h-10 w-full rounded-sm border px-3 text-sm"
                >
                  {HARNESSES.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="space-y-1 text-sm">
              <span className="text-foreground block font-medium">Task</span>
              <textarea
                aria-label="Task"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="What should this agent do in the repository?"
                className="bg-input border-border text-foreground min-h-[140px] w-full resize-y rounded-sm border px-3 py-2 text-sm"
              />
            </label>
            {error && <div className="text-destructive text-sm">{error}</div>}
            <div className="flex justify-end gap-2">
              <button
                onClick={onClose}
                className="text-muted-foreground hover:text-foreground px-3 py-1.5 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={submitting || !repoId || !prompt.trim()}
                className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-sm px-3 py-1.5 text-sm disabled:opacity-50"
              >
                {submitting ? "Starting..." : "Start run"}
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
