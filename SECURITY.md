# Security Policy

## Supported Versions

Mogplex is still pre-`1.0`. Security fixes land on `main` first.

| Version                                              | Supported |
| ---------------------------------------------------- | --------- |
| `main`                                               | Yes       |
| Older commits, stale branches, and unpublished forks | No        |

Once stable releases exist, the latest supported release line will be called out here.

## Reporting a Vulnerability

Please do **not** open a public GitHub issue for security problems.

Use one of these private paths instead:

1. GitHub private vulnerability reporting for this repository, if it is enabled
2. If private reporting is not available, contact the maintainers privately using the repository owner's published contact details

Include as much of the following as you can:

- a clear summary of the issue
- affected routes, files, or features
- reproduction steps or proof of concept
- impact assessment
- any suggested mitigation or fix

## What to Expect

- We aim to acknowledge reports within 3 business days
- We will triage, reproduce, and validate impact before discussing timelines publicly
- We prefer to keep details private until a fix or mitigation is ready
- If the report is valid, we will work with the reporter on a reasonable disclosure timeline

## Scope

We care especially about reports involving:

- auth, session, and OAuth flows
- multitenant data isolation and RLS
- repo access, webhook handling, and GitHub App behavior
- sandbox isolation, SSRF, secret handling, and outbound network controls
- supply-chain and dependency risks with a practical exploitation path

Good-faith, responsible disclosure is appreciated.
