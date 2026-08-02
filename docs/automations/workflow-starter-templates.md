# Workflow Starter Templates

Status: Implemented

Starter templates create editable, inactive workflow drafts from known-valid
graphs. They reduce setup time without adding a second execution or persistence
model.

User-saved graphs use the separate
[Reusable Workflow Templates](./reusable-workflow-templates.md) contract.

## Shipped Starters

- **Blank workflow**: `@mogplex` mention → agent → done.
- **Pull request review**: pull request opened → review agent → done.
- **Dependabot autopilot**: Dependabot pull request opened → review agent with
  sandbox autofix and safe auto-merge enabled → done.
- **Issue triage**: issue opened → triage agent → done.

The Dependabot starter is scoped with `authorFilter: "dependabot_only"`. Like
every starter, it remains inactive until the user reviews and publishes it.

## Source And API

- `lib/flows/templates.ts` is the built-in template registry and graph builder.
- `POST /api/flows` accepts a validated `template_id`.
- `components/panes/flows-pane.tsx` presents the quick-start picker.

Template creation uses the user's first configured agent, matching the existing
new-workflow behavior. The resulting graph is a normal flow draft: users can
change its trigger, agent harness, nodes, edges, and settings before publishing.

Unknown template ids are rejected at the route boundary. Templates do not
accept arbitrary graph JSON through the create route.

## Adding A Starter

1. Add its id and metadata to `FLOW_STARTER_TEMPLATES`.
2. Build its graph in `buildFlowStarterTemplateGraph()`.
3. Add validity and behavior assertions in
   `tests/unit/flow-templates.test.ts`.
4. Add its icon to the picker and extend the API/browser coverage if its
   creation behavior differs from existing starters.

Keep starters deterministic and immediately understandable. Connection-specific
values such as Slack channels should remain unconfigured until the user selects
an owned connection.
