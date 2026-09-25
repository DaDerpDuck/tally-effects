# Tally Effects repository guide

This file applies to the whole repository. Preserve current, tested behavior unless the task
explicitly changes it; inspect the branch, `README.md`, `src/index.ts`, relevant code, and tests
before changing behavior. Product directions are context, not permission to introduce speculative
APIs.

## Product and package boundaries

Tally Effects is a composable, source-driven library for deriving and replicating gameplay state,
not a game engine or a collection of concrete effect classes. Effects emerge from `Property`,
`Modifier`, `SourceType`, `Source`, `Descriptor`, and `AgentState`; do not add a mandatory
first-class effect object.

- Keep core state logic engine-, host-, transport-, and application-agnostic.
- Keep the ESM/ES2025 package compatible with Node 22. Use explicit `.js` TypeScript specifiers
  and existing `getOrInsert` helpers rather than Node 26-only APIs.
- Avoid Node-only runtime dependencies when portable language features or injected adapters work.
- Keep `src/index.ts` deliberate: export supported contracts, not incidental internals.
- Validate distribution behavior with the `npm pack` tarball. Browser compatibility needs a real
  smoke test before it is claimed.

## Architecture

Definitions (`Property`, source types, descriptor types) are immutable and reusable; registration
through `TallyContext` is optional and must not be required by `AgentState`. Preserve strong
generic relationships and domain equality hooks (`Object.is` by default).

- Properties own immutable defaults, equality, and modifier resolution. `AgentState` owns
  per-entity reads, caching, batching, and lifecycle observation.
- Public `Source` and `Descriptor` objects are thin facades. Their runtimes own mutable data,
  resources, callbacks, and lifecycle; managers provide storage and event/batching adapters.
- `SourceType` and `DescriptorType` own immutable contribution, duplication, equality, and
  optional replication definitions. Descriptor handlers/bindings translate portable descriptor
  state into local derived sources.
- Keep shared admission policy in the admission subsystem: its coordinator orchestrates
  transactions, resolver decisions, and index queries. Do not duplicate admission algorithms in
  managers or instances. Prefer composition over inheritance.

## Core semantics

- Resolve modifiers lexicographically by source priority, authoritative-before-local domain,
  provenance sequence, then contribution index. Updates retain their ordering position.
- `AgentState.batch()` coalesces property resolution until the outermost batch ends; nested batches
  work, and reads during a batch may see the starting value. Emit property changes only for actual
  `Property.valueEquals` changes.
- Property resolution and `Property.valueEquals` are best-effort cache maintenance after source
  state commits. Report their failures, retain the last successful property cache, and leave the
  property dirty for a later attempt; they must not undo a committed mutation or interrupt
  lifecycle teardown.
- A source update must atomically replace owned modifier resources before user-visible resolution
  or notification. Roll back allocation failures; do not orphan resources when listeners fail.
- Destruction is terminal and idempotent; mutations after destruction throw. Unregister internal
  state before removed/destroy observers run. All lifecycle behavior must remain correct under
  reentrancy, including destruction during an added callback.
- Callbacks are synchronous and reentrant. Invoke all callbacks from the emission-start snapshot,
  report each failure via the injected `TallyReporter`, and never let callback or reporter failures
  undo a completed mutation or halt independent teardown. Lifecycle teardown is best-effort;
  required pre-commit extension work (source data equality, contribution, modifier allocation,
  binding, and duplication) still throws on failure.
- Descriptor handlers should add derived sources with `DescriptorHandlerContext.addSource()` so
  provenance suppresses independent replication. Descriptor teardown cleans every derived source,
  including reentrant additions, while retaining a successfully bound `getSource()` result.

## Replication and duplicate admission

- Replication is opt-in per definition; the application owns transport. Emit only locally
  authoritative top-level state, preserve authoritative IDs as provenance, and suppress echoes and
  descriptor-derived duplicate emissions. Receivers reconcile IDs and batch mutations so snapshots
  and live events converge regardless of arrival order.
- Duplicate policies are `allow`, `ignore`, `replace`, and `reconcile`; ignored/reconciled adds
  return `undefined`. Domains may be concrete types or shared group objects, and keys partition
  conflicts (`undefined` is only the unkeyed bucket).
- Keep every admitted candidate, including `allow`, queryable in the duplication index. Group-wide
  results use a common candidate interface; exact-type retrieval remains strongly typed.
- Admission reserves pending candidates early, makes them visible to nested admission, validates
  decisions after preparation when eviction is possible, and commits before public added events.
  Roll back partial state on failure or cancellation. Replacement and reconciliation must remain
  reentrancy-safe and atomic from the admission model's perspective.

## Change discipline and verification

- Treat duration/timelines, richer queries/tags, and lifecycle-only effects as future direction;
  do not freeze their public boundaries incidentally. Timeline behavior requires an injected clock
  or scheduler.
- Keep changes scoped. Update the README for user-visible API or mental-model changes and the
  changelog for intentional breaks. Do not publish, tag, merge, or rewrite history unless asked.
- Add regression tests for bugs and cover lifecycle changes with reentrancy, failure, cleanup, and
  callback-order cases. Replication changes need live-event, snapshot, convergence, and
  echo-suppression coverage. Preserve type tests at generic/heterogeneous boundaries.
- Measure performance changes before and after using the compiled implementation and comparable
  deterministic workloads; benchmarks are informational, not correctness substitutes.
- Run the smallest relevant checks while iterating, then applicable release checks: `npm run
  typetest`, `npm run lint`, `npm run format:check`, `npm test`, `npm run build`, `npm pack
  --dry-run`.
