# Reusable Workflow Templates

Status: Implemented Updated: 2026-07-24

Users can save a valid workflow draft as a personal or team template and create a new, inactive draft from it in another GitHub account or repository.

## Safety Contract

- Personal templates are scoped to their owner. Team templates are scoped to a product team.
- Active team members can list and reuse team templates. Saving and deleting requires the team's `projects.write` capability.
- Saving validates the source graph before copying it.
- GitHub installation and repository filters are removed from the stored graph.
- Slack workspace and channel identifiers are removed.
- Webhook secrets are never part of the graph and are not copied.
- Team templates also remove private agent assignments. The creator's source flow identifier is not returned to other team members.
- Creation binds the selected installation and optional repository, validates the instantiated graph, and never publishes or activates it.
- Repository-bound external triggers require a target repository.
- The picker identifies agent, Slack, and webhook settings that must be reconnected before the new draft can publish.

## Product Surface

- The Quick Start picker separates team, personal, and built-in starters.
- The creation target includes a GitHub account and repository.
- `Save current as template` saves the latest persisted draft and asks whether it should be available only to the current user or to the active team.
- Saved templates can be removed from Quick Start without changing workflows that were already created from them.
- Whole-workflow duplication remains available for same-target copies.
