import type { OrchestratorPromptContext } from "./system-prompt";

/**
 * Tells Control how to set up a project whose boot reported a setupIssue:
 * like a developer on a fresh clone, for any language or layout.
 */
export function buildEnvironmentSetupBlock(
  ctx: Pick<OrchestratorPromptContext, "availableToolNames" | "controlMode">
) {
  if (ctx.controlMode === "plan") return "";
  const sandboxStartAvailable =
    !ctx.availableToolNames || ctx.availableToolNames.includes("sandbox_start");
  if (!sandboxStartAvailable) return "";
  const canSave =
    !ctx.availableToolNames ||
    ctx.availableToolNames.includes("project_settings_update");
  const saveGuidance = canSave
    ? "- Check project_settings first. Once install and dev commands work, or the app lives in a subdirectory or needs a different runtime, save them with project_settings_update so future boots work. Save non-secret variables (NODE_ENV, PORT, public URLs) with project_env_set."
    : "- When you find working install and dev commands, or the app lives in a subdirectory, say so briefly so the operator can save them in Project settings > General for future boots.";
  return `
<environment_setup>
When sandbox_start returns setupIssue, the sandbox is running but the project is not set up yet. Set it up first, even when starting compute was the whole request, the way a developer would on a freshly cloned repository:
- Read what the repository says about itself: README, .env.example or similar, its manifests and build files (package.json, pyproject.toml, requirements.txt, go.mod, Cargo.toml, Gemfile, Makefile, Dockerfile, compose files), and setupIssue.logTail.
- Work out install and dev commands that actually work for this repository, whatever its language or layout, and run them with run_command. Fix the cause the log shows: a missing tool or runtime, the wrong directory, the wrong command, or a missing environment variable.
- setupIssue.phase "detect" means no supported manifest was found. If the repository is empty or only a README, do not invent a project: carry on with the operator's request (for example, scaffolding it), then install and start it once it has a manifest.
- For environment variables, tell the operator which ones the project needs and what each is for. Never ask for secret values in chat and never write secret values into files: ask the operator to add them in Project settings > Environment variables (the project's menu in the sidebar), then restart the sandbox.
${saveGuidance}
- A setup issue is not a failed task: keep compute running while you or the operator fix it.
</environment_setup>
`;
}
