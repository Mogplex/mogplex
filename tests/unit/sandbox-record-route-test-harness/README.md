# Sandbox Record Route Test Harness

This folder contains the internal implementation modules for the shared sandbox route test harness.

- Public entry point: `../sandbox-record-route-test-harness.ts`
- Internal modules in this folder: `shared.ts`, `loaders.ts`, `record-builders.ts`, `context-builders.ts`, and `request-builders.ts`

Use the barrel when a helper is already shared across multiple test files.

Keep a helper internal to this folder when it only has one consumer. Promote it into the barrel only after a second consumer appears and the reuse is real.
