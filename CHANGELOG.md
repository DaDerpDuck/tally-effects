## [Unreleased]

## [0.3.1] - 2026-09-25

### Changed

- **[Breaking]** Replication receiver type resolvers and deserializers now reject mutations to the
  receiving AgentState while they run. A receiver also rejects a nested receive operation
  started from a restricted hook.
- Added a reentrancy glossary and JSDoc boundary tags for restricted hooks, supported
  callbacks, local mutation gates, and mutation entry checks.
- Source and Descriptor added events now fire after admission commits and the candidate becomes
  live. Candidates destroyed before their added event do not emit their own lifecycle
  notifications.
- `AgentState` now rejects mutations attempted from Source or Descriptor data equality,
  Source contribution, Modifier allocation, Property resolution or equality, and duplication
  rank or replacement hooks, and replication serialization. Required admission and update
  hooks throw; Property hook failures are reported and leave the last successful cached value
  intact. Live replication serialization failures are reported and suppress the event; snapshot
  serialization failures throw. Descriptor handlers, bindings, and lifecycle callbacks remain
  reentrant.

### Fixed

- Roll back modifiers allocated by a custom contribution even if it throws before returning
  its handle.
- Destroy bindings returned after a reentrant Descriptor admission cancellation, and clean
  derived Sources added after cancellation even if the handler then throws.
- Apply reconciled Descriptor data to its binding before a pending admission commits.

## [0.3.0] - 2026-09-18

### Added

- Added the exported structured `TallyReport` and `TallyReporter` contracts for host-owned
  diagnostic reporting.
- Added keyed duplication for Sources and Descriptors. A string key partitions a type or
  group duplication domain; omitted keys use the unkeyed bucket.
- Added `DuplicationGroup` and `defineDuplicationGroup` for shared, heterogeneous
  duplication domains with optional stack limits and ranked replacement selection.
- Added duplication keys to replicated Source and Descriptor state so receivers preserve
  authoritative key buckets during live-event and snapshot reconstruction.
- Added `AgentState.onReplicationEmit()`. `TallyContext`
  continues to forward events from the AgentStates it creates as a convenience for shared
  configuration and observation.
- Added fluent `AgentState.makeSource()` and `AgentState.makeDescriptor()` builders for
  configuring per-instance priorities and duplication keys before creation.
- Added a `TALLY_VERSION` runtime version variable.

### Changed

- **[Breaking]** `AgentState` and `TallyContext` now require an options object containing a
  `TallyReporter`. Supply a host-owned reporter to receive errors from callbacks and best-effort
  lifecycle cleanup. `TallyContext.createAgentState` accepts a partial agent options override.
- Public observation callbacks are now best-effort: all listeners run, and their failures are
  reported instead of being synchronously thrown from lifecycle operations.
- Property resolver and `valueEquals` failures now retain the last successful cached value and
  are retried after a later mutation. Tally reports these exceptional failures without undoing
  the committed Source mutation or interrupting lifecycle cleanup.

### Fixed

- Fixed Source updates so a property-change observer failure cannot orphan replacement Modifiers
  or prevent later cleanup.
- Fixed source and descriptor teardown so resolution, binding-cleanup, and observer failures are
  reported without preventing remaining lifecycle cleanup.
- Fixed callback subscription mutation semantics: new or reconnected subscriptions wait until the
  next emission, while disconnecting a pending subscription prevents its invocation.
- Fixed failed Property resolution to retain the last successful cache and remain dirty for a
  later retry.

## [0.2.0] - 2026-08-29

### Added

- Added strongly typed Modifier support to Property through a new optional TModifier type parameter.
    - Custom Properties can now describe the exact Modifier type accepted by their resolver.
    - ModifierCollection and ModifierRegistry preserve the Property's Modifier type when retrieving or iterating Modifiers.
- Added and exported NumberModifier and BooleanModifier for extending the built-in Property implementations.
- Added and exported ResolvedPropertyDefinition and DefaultPropertyDefinition for representing fully resolved Property definitions and their required defaults.
- Added and exported resolvePropertyDefinition for composing user-supplied Property definitions with implementation-specific default behavior.
- Added public Registry, Registrable, and registerProperty APIs to support custom registrable Property implementations.

### Changed

- Refactored the Property architecture to favor composition over inheritance.
    - NumberProperty and BooleanProperty now implement Property and Registrable directly rather than inheriting their behavior from BaseProperty.
    - Default resolution and equality behavior are now composed by defineNumberProperty and defineBooleanProperty before constructing the Property.
    - PropertyDefinition now accepts the Property's concrete Modifier type, allowing custom resolvers to receive the strongly typed Modifiers.
- Generalized internal registration behavior shared by Properties, Sources, and Descriptors.
- Refactored AgentState into a facade over dedicated state managers, separating source resolution and descriptor lifecycle responsibilities without intentionally changing the public AgentState API.
- Fixed undefined properties resolving to default value.
- Added npm package keywords to improve package discovery.

### Removed

- **[Breaking]** Removed BaseProperty from the public API. Custom property implementations should implement the Property and Registrable interfaces directly and may use resolvePropertyDefinition and registerProperty to reuse Tally's standard Property behavior.
- **[Breaking]** Direct construction of NumberProperty and BooleanProperty now expects a resolved Property definition. Applications should prefer the existing defineNumberProperty and defineBooleanProperty helpers for normal Property creation.

## [0.1.0] - 2026-08-26

### Added

- Initial public release of Tally.
