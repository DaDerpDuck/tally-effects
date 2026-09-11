## [Unreleased]

### Added

- Added keyed duplication for Sources and Descriptors. A string key partitions a type or
  group duplication domain; omitted keys use the unkeyed bucket.
- Added `DuplicationGroup` and `defineDuplicationGroup` for shared, heterogeneous
  duplication domains with optional stack limits and ranked replacement selection.
- Added duplication keys to replicated Source and Descriptor state so receivers preserve
  authoritative key buckets during live-event and snapshot reconstruction.

### Changed

- Reworked Source and Descriptor admission around shared pending/live duplication
  reservations so lifecycle reentrancy, replacement, reconciliation, and cancellation
  share one policy decision.

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
