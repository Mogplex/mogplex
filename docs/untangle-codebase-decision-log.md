# Untangle codebase decision log

Date: 2026-11-08
Branch: `refactor/untangle-codebase`
Base: `main` / `origin/main` at `d008c811`

## Scope

Core structural untangling only. Optional comment cleanup and test cleanup were not selected. Existing tests remain the regression safety net. Behavior should stay unchanged except where a structural fix demonstrably removes a bug.

## Baseline

- The repository started clean on `main`; `git pull --ff-only origin main` reported it already up to date.
- Initial `pnpm typecheck` failed before edits because `.next/types/validator.ts` referenced stale route types and `@floating-ui/dom` was absent from the installed dependencies.
- `pnpm install --frozen-lockfile` followed by `pnpm test:all` passed before edits: the final database tier reported 158 files passed and one skipped, with 691 tests passed and seven skipped.

## Audit evidence

- 3,941 tracked JS/TS files; approximately 618,000 lines in tracked TS/TSX files.
- Highest-churn co-change clusters include Control session wiring and the orchestrator registry, system prompt, and sandbox tools.
- Aggregate imports show route/domain cycles (`app` <-> `lib/control`), domain/UI reversals (`lib/sandbox` -> `hooks`, `hooks` -> `components`), and reusable panes importing page-owned observability presentation.

## Problem inventory

### Orchestrator tool registry

- `lib/agents/orchestrator/registry.ts:161-293` has a name-based special case for every implemented tool. Adding or changing a tool requires editing its category definition and this separate dispatch chain.
- Tool metadata (`implemented`, category, description, access) lives in `lib/agents/orchestrator/tools/*.ts`, while construction and context availability live in `registry.ts`. Nothing in the type system ties the two together; `registry.test.ts:53-58` exists specifically to detect this drift after the fact.
- `lib/agents/orchestrator/registry.ts:303-311` silently synthesizes a sandbox binding for callers that did not provide one, so every construction branch must understand that implicit normalization convention.
- `lib/agents/orchestrator/tools/*.ts` declares unused schema maps for unimplemented tools. The maps have no consumers outside their declarations; they are speculative configuration rather than executable behavior. The planned-tool inventory itself is consumed by the system prompt and is not classified as dead.

### Control execution ownership and dependency direction

- `app/api/control/chat/_lib/execute.ts` and neighboring route modules import the Control runtime from `lib/control`, while `lib/control/turn-runtime.ts:3-8`, `turn-dispatch.ts:5-9`, and `continuation-runtime.ts:7-8` import route execution, context, messages, and call creation back. The feature is split across route and domain folders in both directions.
- `lib/control/turn-store.ts:2`, `background-context.ts:11`, `step-checkpoint.ts:9`, `native-execution.ts:3`, and `workspace-checkpoint.ts:5` depend on route-owned types, so route refactors can break Trigger workers and durable runtime code.
- `lib/control/workspace-checkpoint.ts:22-28` dynamically imports the sandbox changes route and manufactures an internal `Request`; `lib/mogplex-api/native-sandbox-execution.ts:16-25` does the same for sandbox exec. Domain behavior is coupled to HTTP route internals and their calling conventions instead of an application service.
- `lib/slack/native-webhook-dispatch.ts:2-3` and `lib/slack/connection-recovery/interactions.ts:17` import Slack route internals, repeating the same route-to-domain dependency reversal outside Control.

### Ambient active-team request state

- `components/active-scope-provider.tsx:15-45` owns mutable module-global request state and pure header/fetch helpers, while `components/active-scope-provider.tsx:57-64` synchronizes that global from a React effect. Non-React callers implicitly depend on provider mount/effect ordering.
- At least 14 modules under `hooks/` import `getActiveTeamRequestHeaders` from the React provider, including `hooks/use-sandbox.ts:8`, `hooks/use-conversations.ts:3`, and `hooks/use-terminal-exec.ts:4`. Stable data hooks therefore depend on a more volatile component module.

### Sandbox UI ownership and dependency direction

- `lib/sandbox/session-retarget.ts:1-3` directly reads and mutates conversation, pane, and session Zustand stores. This is UI orchestration located in the domain layer and makes `lib/sandbox` depend on `hooks`.
- `lib/sandbox/pane-binding.ts:1-2` imports pane types and behavior from `hooks/use-split-panes`; `lib/sandbox/navigation.ts:1` imports workspace navigation types from the same hook.
- `lib/sandbox/ui-state-resolver.ts:5` and `preview-launch-context.ts:5` import the workspace `Session` contract from `hooks/use-sessions`, coupling pure sandbox presentation to a client store module.

### Control session mutations

- `components/control/use-control-sessions.ts:319-392`, `394-426`, and `428-474` separately implement overlapping archive/delete state transitions: revision updates, removed-id tracking, list removal, message cleanup, selection clearing, and local-storage cleanup can drift between paths.
- `components/control/use-control-sessions.ts:332-349` duplicates the optimistic-concurrency fetch/rebase/retry sequence in `lib/control/session-persistence.ts:22-43`. One protocol change must currently be made in both client workflows.
- `components/control/use-control-sessions.ts:373-375` and `428-474` contain archive/unarchive-specific branches around the general update operation, instead of one session mutation model owning those transitions.

### Shared contracts and presentation owned by routes/pages

- `components/observability-pane.tsx:5`, `components/panes/agent-roster-pane.tsx:18`, and `components/panes/output-pane.tsx:20-25` import formatters and React presenters from the dashboard observability page. Reusable workspace panes consequently depend on a specific page's private component directory.
- `components/settings/use-team-settings-actions.ts:10-12` and three other team-settings components import response contracts from team route handlers. The API contract changes for server/client reasons but its route implementation is the only shared owner.
- `components/panes/agent-roster-pane.tsx:6` and `components/panes/output-pane.tsx:10` import `AgentRosterItem` from `app/api/agents/roster/route.ts:10-17`, pulling a server route module into two client component contracts.

### Split-pane ownership and mutations

- `hooks/use-split-panes.ts:85-87` owns a writable local `root`/`activeId`, while every workspace session owns another writable pair in `hooks/session-types.ts:17-29`.
- `app/(dashboard)/[scope]/projects/workspace/_components/workspace-shell.tsx:158-201` implements the implicit synchronization protocol with a previous-session ref, a just-switched flag, debounced writes, and unmount flushing; `lib/pane-tree-session-sync.ts:37-81` separately implements that timer state machine.
- `hooks/use-split-panes.ts:117-144` reimplements pane removal and collapse despite `hooks/split-panes-layout.ts:17-57` already owning those invariants.
- `hooks/use-split-panes.ts:168-248` reimplements adjacent editor insertion with `[45, 55]` sizes, while the shared insertion operation in `hooks/split-panes-layout.ts:67-122` uses `[50, 50]`.
- `hooks/use-split-panes.ts:315-360` manually constructs files/editor panes instead of using `hooks/split-panes-factories.ts:34-55`.
- `hooks/use-split-panes.ts:146-156` and its returned `appendLine` are dead: no caller uses them.

### Sandbox launch and binding coordination

- Callers repeat the protocol of pending-branch setup, launch/restart, outcome checking, and session rebinding in `components/preview-pane/use-preview-pane.ts:219-244,272-389`, `hooks/use-terminal-input.ts:146-192`, `hooks/use-repo-settings-actions.ts:80-113`, and `components/pane-content/agent-pane/use-harness-run.ts:121-160`.
- `components/panes/home-pane.tsx:111-159` and `app/(dashboard)/[scope]/projects/workspace/_components/workspace-shell.tsx:280-329` repeat whole-workspace open-plus-launch coordination.
- `components/preview-pane/use-preview-pane.ts:68-73` gives `workspaceSessionId` three meanings: `undefined` selects the global workspace, `null` isolates Control, and a string selects an explicit session. `components/control/task-preview.tsx:10-12` depends on that implicit `null` convention.

### Agent conversation ownership

- AI SDK chat owns messages in `components/pane-content/agent-pane/use-workspace-chat.ts:12-33`, while Zustand owns another array in `hooks/conversation-types.ts:41-53` and `hooks/use-conversations.ts:270-288`.
- `components/pane-content/agent-pane/agent-pane.tsx:157-171,383-418` manually hydrates, mirrors, starts, and resumes both message stores plus the pane conversation id.
- `components/pane-content/agent-pane/use-chat-history-recovery.ts:39-48` updates both copies separately during recovery; `agent-pane.tsx:103-112` derives the active id from three possible sources.

### Flow run presentation bypasses

- `components/panes/output-pane.tsx:149-166,262-291` implements run actions directly from flags instead of using `lib/flows/run-presentation.ts:156-219`; its requeue label and stale-status handling have already drifted from the shared presenter.
- `components/panes/flow-run-details/header-overview.tsx:29-41` uses the shared status presenter only after full detail loads, so a summary with active waits can display `running` while the rail displays `waiting`.
- `components/panes/flow-run-details.tsx:28-98` owns generic run-action types and buttons, forcing the rail and handler hooks to import the details-modal implementation.

### Flow draft state

- `components/panes/flows-pane/use-flow-save-publish-state.ts:78-138` mirrors four state values into refs and requires one effect to be declared before hydration to avoid stale reads.
- `components/panes/flows-pane/use-flow-save-publish-handlers.ts:15-50` receives a large setter/ref bag manually threaded by `components/panes/flows-pane.tsx:228-233`, while autosave sequencing lives separately at `flows-pane.tsx:321-333`.
- `baselineDraftSignature`, `resetHistoryMerge`, and `setRunActionState` are exposed or destructured without consumers at `use-flow-save-publish-state.ts:226` and `flows-pane.tsx:228,272`.

### Cross-component state contracts

- `components/panes/output-pane.tsx:3` imports selection stores from `components/panes/agent-roster-pane.tsx:26-40`, coupling output state to the roster component implementation.
- Desktop and mobile renderers manually thread nearly identical pane props in `components/split-container.tsx:110-167` and `components/mobile/workspace-shell.tsx:111-128`.

### Sandbox persistence and boot streaming

- `app/api/sandbox/[id]/stop/route.ts:343-356` and `app/api/sandbox/[id]/route.ts:301-309` retry failed generation-guarded writes without the generation predicate, potentially stopping or deleting a replacement workspace.
- `app/api/sandbox/[id]/restart/route.ts:303-360` omits the `expectedLastBootStartedAt` predicate used by equivalent resume writes at `app/api/sandbox/[id]/resume/route.ts:334-391`.
- `lib/sandbox/records.ts:65-77` reloads embedded projections by row id without reapplying the successful compare-and-swap predicates.
- Resume and restart independently implement bootstrap/SSE translation, snapshots, persistence, conflict cleanup, and claim release in their route and `_lib` modules; the boot-guard divergence is evidence of semantic drift.

### Route handlers used as application services

- Collection launch invokes the restart route (`app/api/sandbox/_lib/deps.ts:137-143`), v1 launch invokes the collection route (`app/api/v1/mogplex/sandboxes/route.ts:48-93`), and legacy restart makes an authenticated HTTP request back to the collection route (`app/api/sandbox/[id]/restart/_lib/legacy-restart.ts:139-183`).
- GitHub dispatch uses `retryFailures` to change return/throw behavior throughout `app/api/webhooks/github/_lib/verified-dispatch.ts` and `data-loaders.ts`; Trigger then inspects `NextResponse` objects instead of typed outcomes.

### Harness and agent execution special cases

- `lib/agents/run-chat-agent.ts:280-286` consumes a text-only stream that drops error parts, then finalizes normally even when `finishReason` is `error`; `trigger/slack-event-lib/modes.ts:333-350` can publish and persist that failed turn as delivered. `lib/mogplex-api/native-run.ts:311-326` already owns the correct full-stream semantics.
- `lib/harness/acp/bridge-script.ts:242-253` swallows mode-setting failure and prompts anyway, so the requested SAFE/AUTO/YOLO policy is not a launch precondition.
- `app/api/sandbox/[id]/harness/_lib/setup.ts:251-269` logs MCP injection failure and continues; `lib/harness/acp/bridge-script.ts:58-74` continues with no MCP servers when configuration cannot be read.
- `app/api/sandbox/[id]/harness/_lib/execution.ts:223-239` stores prompt excerpts in harness episodic memory despite the outcome-only memory contract.
- `lib/decisions/turn-observer.ts:62-88` starts loop checks without retaining their promises, so `onEnd` does not await all decision work as its callers assume.
- `lib/workflows/pr-review-format-check.ts:165-169,243-249` and `pr-review-self-revision.ts:106-121` allow `advise` mode to rewrite text and trigger revision, although only `enforce` may change control flow.
- `lib/decisions/evaluator.ts:36-54,128-164` scopes circuit-breaker failures to the whole process, allowing one account's failures to suppress unrelated accounts' decisions.

### Harness ownership and surplus

- `lib/harness/segment-store.ts:1-4` imports canonical protocol types from a client conversation store instead of owning them.
- `lib/harness/config.ts:22-42,88,107` declares unread `provider` and `timeoutMs` fields; actual command recovery uses a separate deadline.
- The sandbox provider remains partially Vercel-specific in harness acquisition, command types, error classification, and creation callbacks. This is the explicitly unfinished Track B migration in `plans/self-hosting-and-byo-compute.md`, not a wrapper to improvise around.

### Workflow queue and terminal-state coupling

- `lib/automation-dispatch.ts:75-96` passes pending-queue caps of 25 and 100 on every enqueue, contradicting the dormant-cap contract in `lib/workflows/automation-guardrails.ts:34-41`; the checked-in RPC suppresses work at those thresholds.
- Retry admits unsupported assignment/trigger-backed runs (`lib/job-runs.ts:59-61`, `lib/job-run-retry.ts:166-245,351-375`) even though execution rejects them as `MISSING_CONFIG`; pending repair also scans unsupported sources.
- `trigger/sandbox-baseline-snapshot-reaper.ts:37-47` treats every snapshot deletion error as already gone, and `lib/sandbox/baseline-snapshot-reaper.ts:112-129` then clears the only cleanup handle and counts success.
- Queue release is duplicated between `lib/workflows/automation-job-persistence.ts:231-305` and `lib/workflows/job-run-cancel-child-ops.ts:139-187`; both use a loader capped at 500 active rows. Cancellation, supersession, and missing-runtime reconciliation perform different terminal cleanup.
- `lib/workflows/automation-job-executor-core.ts:188-201` claims initial PR-check creation errors are reporter-captured, but reporter state is initialized afterward with no error.

### Workflow and editor contracts

- `lib/job-runs.ts:3-12` includes start source `api`, while `lib/job-run-service.ts:57-68` and `lib/flows/test-store-types.ts:100-106` omit it.
- List, detail, and E2E mappers duplicate flow-run attribution in `lib/flows/api-run-utils.ts`, `api-run-queries.ts`, and `test-store-runs.ts`; detail hardcodes missing `cost_usd`, and E2E hardcodes `active_wait_count`.
- Trigger events, condition operators, await kinds/units, transform operations, and API node types are parallel lists across `lib/types`, `lib/flows/assistant-tools-constants.ts`, operator modules, and `lib/mogplex-api/automation-request.ts`. `DEFAULT_FLOW_SCHEDULE` is also restated by the assistant factory.
- Editor test dispatch and public API dispatch prepare runs separately and differ on `duplicateSensitive`; the intent of that difference is undocumented.
- `lib/flows/run-presentation.ts:196-215` has an unreachable failed-run Repair branch because `lib/job-runs.ts:46-57` permits repair only for pending runs.
- `lib/runtime-providers.ts:6-12` and `lib/workflows/automation-job-workflow.ts:104-119` contain unused wrappers/a preconstructed task alias; `lib/flows/wait-service-routing.ts:157-192` duplicates its own resume aggregation helper at `:210-252`.

### API classifiers and duplicated policies

- Repository skill inclusion/exclusion is queried separately in `app/api/repos/[id]/skills/route.ts:22-70` and `lib/skill-catalog/store.ts:70-100`; both repo skill/rule panel routes discard database errors. Repository rules have no runtime reader beyond the panel, but whether that is intentional is a product question.
- `lib/observability/activity-row.ts:5-13` and `app/api/observability/calls/route.ts:124-129,255-287` encode surface classification separately in TypeScript and PostgREST logic.
- Provider ids and verification are split across `lib/vault.ts`, settings key routes, team schemas, and UI metadata; OpenRouter network errors already classify differently from other providers.
- Attachment count/byte/data-URL policy is copied across chat, Control, harness, and client modules, with three different decoders.
- Chat and Control maintain parallel terminal-finalization coordinators and transition logic in their respective `_lib` modules.
- `app/api/settings/model-chain/route.ts` uses the transactional chain RPC while `app/api/settings/model-fallbacks/route.ts` directly updates the same profile columns through `lib/models/fallback-preferences.ts`.
- `app/api/skills/vercel-docs/route.ts:11-16,86-94` sorts a process-global cached array in place, making later filtered results depend on previous requests.
- Several route files re-export pure helpers only so tests can import them, making route modules the public helper API.

### Authentication failure boundaries

- `lib/auth.ts:25-46`, `lib/auth/api-key.ts:164-173`, and `lib/auth/mogplex-oauth.ts:29-36,78-100` collapse identity-store failures into missing profiles or invalid credentials rather than operational errors.

## Redesign and implementation

1. **Make lifecycle generation and terminal outcomes explicit.** Required sandbox generation predicates will never be dropped on retry; a non-null guarded write is the CAS verdict and embedded relation reloads read by id only. Resume/restart will share one boot-stream service. Snapshot deletion will distinguish not-found from failure. Pending caps will default to disabled (`null`) to match the documented policy, executable-source capability will gate retry/repair, and unsupported failed-run Repair will disappear.
2. **Make run preparation and completion single-owner services.** Slack will consume full stream errors before delivery; ACP mode and MCP configuration will become launch preconditions; decision observers will join pending work; `advise` will be observational; outcome-only harness memory will contain no prompt. PR-check creation and terminal queue release will return typed outcomes through one coordinator.
3. **Colocate tool definitions with construction.** `OrchestratorToolDef` will become a discriminated union: implemented definitions carry a builder, planned definitions do not. Category modules will own their builders and context availability; the registry will only normalize context and execute definitions. Unused planned schema maps will go.
4. **Make Control and sandbox routes adapters.** Control request types, validation, startup, and execution move to `lib/control`; Slack webhook parsing/dispatch and sandbox exec/changes services move out of route internals. Routes and Trigger workers will depend on those services in one direction. GitHub dispatch will use typed outcomes/errors rather than a caller boolean.
5. **Give client state one controller per transition.** The session store becomes the canonical split-pane tree; shared detach/insert/factory primitives own mutations. Control session mutation/rebase/removal logic moves behind one persistence contract. Workspace/sandbox binding uses an explicit target, and agent conversation id/message transitions use one controller.
6. **Centralize presentation and contracts.** Flow-run actions/status use the shared presenter everywhere; row/select mappers and graph capability constants feed every surface. Shared observability presentation, roster/output stores, API response types, and harness segment types move to neutral owners.
7. **Remove effect-order and ambient coupling.** Active-team request helpers move to a stable non-React module without changing the intentional ambient request scope. Flow draft hydration will not depend on effect declaration order; unused exposed state will be removed.
8. **Unify API policies.** Provider support, attachment parsing, observability classification, model-chain writes, and repo-skill reads will each have one owner. Cached Vercel docs become immutable; auth store failures remain operational errors; test-only route re-exports are removed after imports move.
9. **Preserve product-ambiguous behavior explicitly.** Repository rules will not be connected or deleted without a product decision; the duplicate-sensitive API difference will become an explicit policy parameter rather than being silently unified. The documented sandbox Track B migration will not be replaced by another facade.

Implementation status and verification evidence will be appended below as each phase lands.

## Verification log

- Baseline `pnpm test:all`: passed.
- Baseline `pnpm exec next typegen && pnpm typecheck`: passed.

## Implementation status

Completed:

- Orchestrator definitions carry type-required builders; executable schemas are colocated, central name dispatch and unused schema maps are gone, and request-local tool caches share stable sandbox bindings.
- Control chat, Slack webhooks, sandbox collection/exec/changes/harness/resume are library services with thin route adapters. Production code no longer imports those route modules.
- Split-pane state has one canonical session owner, no-op suppression, shared mutations, and coalesced storage writes. Control session mutations share one conflict policy; archive/restore does not rebase.
- Flow-run actions/status, Control session writes, queue release, flow capabilities, attachment decoding, and shared API/observability contracts have single owners.
- Sandbox stop/delete/restart writes preserve provider and boot-generation predicates. Snapshot deletion is failure-aware and replacement-safe.
- Slack consumes full stream errors; ACP mode/MCP are launch preconditions; decision observers join work; `advise` cannot rewrite; model-scoped breakers exclude 4xx; retry is executable-source gated.
- Auth store failures propagate while missing identities stay unauthenticated. Vercel docs cache is immutable. Model fallback writes share the chain RPC for valid chains and retain the legacy profile-write contract when the primary appears in the fallback list.

Re-audit regressions fixed:

- Archive conflict retry is opt-in, with archive/restore disabled and the generic update API unable to bypass that policy.
- Memory tools share a request-local bundle and execution-time sandbox scope.
- Canonical pane updates suppress no-ops and debounce only storage, not state.
- Same-name persistent boot guards, Better Auth missing profiles, snapshot replacement ids, and trigger-backed retry sources are handled explicitly.
- Embedded sandbox reloads read by id after a guarded write, so stale pre-write predicates and ambiguous post-write filters cannot reject a successful claim.
- Hydration uses `useEffectEvent`; late saves are revision guarded; project/session launches bind the intended session.
- Conversation history retains legacy and cross-session records so workspace restoration remains reachable.
- The changes route adapter exposes both `GET` and `POST`; a route-contract regression test covers the mutation export.
- Queue pagination has an `id` tie-breaker, and retry source types reuse the canonical union.

## Per-area review guide

Git rename scores identify the behavior-neutral moves below; the focused tests and CI cover both those moves and the intentional deltas.

| Area | Behavior-neutral code motion | Intentional behavior changes |
| --- | --- | --- |
| Control chat | Every moved module except `messages.ts` is a 100% rename into `lib/control/chat/`. | Queueing, lifecycle completion, auth, and legacy-history fixes. |
| Slack webhooks | `event-types.ts`, `native-input.ts`, and `verified-dispatch.ts` are 100% renames. | Stream errors are fully consumed before delivery. |
| Sandbox collection | Every existing collection `_lib` module and its tests are 100% renames. | Readiness, persistence, and launch-race fixes are isolated from those moves. |
| Exec and harness | Exec command/shell helpers and most harness internals are 100% renames; the remaining files have small dependency-seam edits. | One `POST` entry point per adapter, explicit env injection, and cancellation/delivery fixes. |
| Sandbox lifecycle | No byte-for-byte claim; review `records.ts`, resume, restart, stop, and delete directly. | CAS conflict responses, id-only embedded reloads, failure-aware snapshot reaping, and per-repo failure isolation. |
| Pane and session state | `pane-binding.ts` is a 100% rename. | Canonical store ownership, empty-session fallback, and callbacks bound to their originating session. |
| Repair and queue | No byte-for-byte claim; review `job-runs.ts`, `job-run-repair.ts`, and `queue-release.ts` directly. | Executable-source gating, skipped-run reporting, stable pagination, and coordinated queue release. |
| Flow editor and presentation | No byte-for-byte claim; review the shared presenter and save handlers directly. | Revision-guarded saves and diagnostics for failed saves after flow switches. |
| Auth and shared contracts | `lib/observability/formatters.ts` is a 100% rename. | Missing identities fail closed; shared types consolidate existing wire contracts without intentionally changing them. |

Final verification:

- `pnpm test:all`: passed — 3,289 Vitest tests, 4,723 Node tests with eight skipped, and 691 database tests with seven skipped.
- `pnpm typecheck`: passed.
- `pnpm lint`: passed with zero errors and 990 pre-existing warnings.
- `pnpm build`: passed.
- Playwright flow-run observability, keyboard autosave, and activation reliability specs: 12 passed.
- Final structural and UI audits found no remaining worthwhile issues after the fixes above. Deferred Track B and intentional compatibility behavior were excluded.
- `git diff --check`: passed.

Documented future work, not silently claimed complete:

- GitHub webhook's `retryFailures` transport boolean and typed outcomes.
- Resume/restart boot-stream consolidation and the documented provider-neutral Track B migration.
- Chat/Control finalization consolidation, flow-run row/select mapping consolidation, provider verification registry, observability SQL/presentation unification, and repository-skill read sharing. Repository-rule runtime behavior remains product-ambiguous and was not changed.
- Broader launch coordination and remaining test-only export cleanup.
