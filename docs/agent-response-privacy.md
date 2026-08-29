# Agent response privacy boundary

Mogplex keeps operational diagnostics available for troubleshooting without
making them part of ordinary agent replies.

By default, user-facing agent text must not contain:

- hosting, compute, job, or data-provider names used only by the runtime;
- internal filesystem paths, service URLs, or runtime topology;
- compute, deployment, project, or run identifiers;
- raw stack traces, internal configuration names, or service errors; or
- credentials, tokens, or secret values.

Replies should retain the product-level result and next action. They can say
that a development environment is running or stopped, describe a connection or
configuration action the user must take, and use repository-relative file
paths when those paths help.

## Explicit diagnostics

Infrastructure details can be included only when an authenticated user
deliberately asks for them in a resource-scoped Control conversation. The
disclosure is limited to the requested diagnostic context. Secret redaction is
always enforced, including during explicit diagnostics.

The response stream buffers each text or reasoning segment before applying the
boundary. This prevents a provider from bypassing redaction by splitting an
internal path or identifier across stream chunks. Raw operational telemetry
remains on its existing authorized operator surface.
