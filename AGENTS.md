# Tally Effects repository guide

This file applies to the entire repository.

It records Tally's durable architectural intent and the engineering constraints that have
emerged from design reviews. It is not a claim that every roadmap item below is already
implemented. Before changing behavior, inspect the current branch, `README.md`, `src/index.ts`,
the relevant implementation, and its tests. Preserve implemented, tested behavior unless the
task explicitly asks to change it. Treat sections labeled **Design direction** or **Unresolved**
as context, not permission to ship a speculative API.

## Product intent

Tally Effects (`tally-effects`) is a composable, source-driven framework for deriving and
replicating gameplay state. It is a library, not a game engine and not a collection of concrete
buff/debuff classes.

The central model is:

- a `Property` defines a value and how ordered modifiers resolve it;
- a `Source` is a runtime cause of state;
- a `SourceType` turns source data into modifier contributions;
- a `Modifier` contributes an operation to one property;
- a `Descriptor` is a portable recipe whose runtime-specific handler creates and maintains a
  source;
- an `AgentState` owns the runtime state for one entity.

Effects emerge from those pieces. Do not introduce a mandatory first-class "effect object" that
duplicates their responsibilities.

The TypeScript package is the first implementation of a broader contract. The long-term goal is
to port the same semantics to core Luau and provide separate Roblox and roblox-ts integrations.
Port the contract and observable behavior, not TypeScript implementation details.

## Runtime and package constraints

- Keep the core engine- and host-agnostic. Do not put Roblox services, DOM assumptions, transport
  code, or application-specific entities into core state logic.
- The package is ESM, targets ES2025, and uses explicit `.js` specifiers in TypeScript imports.
- Node 22 is the current minimum, and CI tests Node 22, 24, and 26. The package is also smoke-tested
  as a packed consumer under Bun and Deno.
- Do not use runtime APIs that only exist in a newer matrix entry. In particular, keep using the
  repository's `getOrInsert` / `getOrInsertComputed` helpers instead of Node 26-only
  `Map.prototype.getOrInsert` APIs while Node 22 remains supported.
- Avoid Node-only built-ins and globals in runtime library code when a portable language feature
  or injected adapter will work. A Node engine declaration is not permission to make the domain
  model Node-specific.
- Keep browser compatibility as a design target. Do not claim browser support without a real
  packed-consumer or browser smoke test.
- Keep `src/index.ts` deliberate. Export supported contracts there; do not expose an internal
  mechanism merely because another source file needs it.
- Package validation must exercise the tarball produced by `npm pack`, not only imports from the
  repository source tree.

## Architectural boundaries

| Component | Owns | Must not own |
| --- | --- | --- |
| `Property` | Immutable default value, equality, and resolution semantics | Per-agent mutable state or source lifecycle |
| `Modifier` | A typed contribution targeting one property | Registration, timing, or effect lifecycle |
| `ModifierRegistry` | Canonical ordered/indexed storage for active modifiers | Public gameplay policy |
| `SourceType` | Immutable contribution, priority, duplication, equality, and optional replication definitions | Runtime instance state |
| `Source` | Runtime data, provenance, identity, updates, and destruction | Global configuration or transport |
| `DescriptorType` | Immutable portable descriptor shape, output source type, equality, duplication, and optional replication definitions | Runtime-specific behavior |
| `Descriptor` | Runtime descriptor data and its binding lifecycle | Networking |
| `DescriptorHandler` / `DescriptorBinding` | Translate portable descriptor data into local runtime behavior and maintain the derived source | Authoritative replication policy |
| `AgentState` | Per-entity facade over sources, descriptors, property reads, batching, and lifecycle observation | Shared application configuration |
| `SourceManager` / `DescriptorManager` | Concrete publication, update, removal, and callback mechanics for their instance kind | Independent copies of shared admission policy |
| `TallyContext` | Optional registries, handler configuration, cross-agent observation, and replication coordination | Being required to use definitions or `AgentState` |
| Replication receivers | Apply snapshots/events to local agent state | Transporting packets |

Prefer composition over inheritance. Property implementations intentionally compose reusable
definition behavior and implement public interfaces directly. New shared behavior should
normally be a small focused component or function, not a base-class hierarchy.

`AgentState` is a facade. Keep source-specific behavior in `SourceManager`, descriptor-specific
behavior in `DescriptorManager`, and genuinely shared behavior in shared primitives. In
particular, do not duplicate a complex admission algorithm in both managers.

## Definitions and registration

- Properties, source types, and descriptor types are immutable reusable definitions.
- Definitions must remain usable with a directly constructed `AgentState`; registration is not a
  prerequisite for core behavior.
- `TallyContext` and registration are optional conveniences for name lookup, replication,
  descriptor-handler setup, and cross-agent coordination.
- Registration names are identities used at serialization boundaries. Reject two different
  definitions with the same registered name; re-registering the same object may remain
  idempotent.
- Preserve strong generic relationships across properties, modifiers, source data, descriptor
  data, and handler output. Use type erasure only at genuinely heterogeneous boundaries.
- Equality hooks suppress semantically redundant updates. The default is `Object.is`; do not
  silently replace domain-specific equality with reference or structural equality.

## Property resolution and deterministic ordering

Properties own resolution. Sources contribute modifiers; they do not compute or cache the final
property value themselves. `AgentState` caches resolved values and invalidates only affected
properties.

Modifier order is a compatibility and replication invariant. Apply the ordering key
lexicographically, with lower values first:

1. source priority;
2. ordering domain, authoritative before local;
3. provenance sequence;
4. modifier contribution index within the source.

Do not depend on `Map`, `Set`, snapshot, or packet arrival order. Updating a source may rebuild its
modifier handles, but it must retain the same semantic ordering position. Two peers that receive
the same authoritative state in different local orders must converge to the same result.

`AgentState.batch()` coalesces dirty-property resolution until the outermost batch completes.
Nested batches are supported. A read inside a batch may therefore see the value from the start of
the batch. Property-change callbacks fire after resolution and only when `Property.valueEquals`
reports an actual change.

A batch is not an admission transaction. It is a resolution/coalescing primitive. Do not use
deferred callbacks or deferred property resolution as a substitute for making state admission
atomic and reentrancy-safe.

## Source and descriptor lifecycle

- `Source.set()` recomputes that source's contributions without changing its provenance or
  ordering position.
- Destruction is terminal and idempotent. Mutating a destroyed instance throws; repeated
  destruction is harmless.
- Descriptor updates flow through the binding. Descriptor destruction tears down the binding and
  its derived source.
- Register internal state before publishing an added event. Remove an instance from every internal
  map/index before publishing removed or destroy events.
- Public callbacks are reentrant user code. Correctness must hold if a contribution function,
  reconciliation function, descriptor handler, added callback, removed callback, update callback,
  or destroy callback immediately performs another admission or destruction.
- An instance destroyed from its own added notification must not remain in a manager or duplication
  index. A removed observer must be able to add a replacement immediately.
- Exceptions or declined publication must roll back reservations and partial internal state. A
  later admission must not be blocked by a leaked pending entry.
- Keep property resolution batching separate from lifecycle-event semantics. Today property
  callbacks are coalesced; source and descriptor lifecycle callbacks are not implicitly an
  end-of-batch event queue. Any change to that observation model is a public semantic change.

### Descriptor boundary

A descriptor says what portable state should exist; a local handler decides how to realize it in
the current runtime. The intended flow is descriptor data to local handler/binding to ordinary
source to modifiers to properties.

Use `DescriptorHandlerContext.addSource()` for a descriptor's derived source. It supplies
descriptor provenance so that descriptor-derived sources do not replicate independently and
produce duplicate state or replication echoes. Direct `agent.addSource()` calls inside handlers
must be treated as an intentional escape hatch, not the default.

Handlers should be registered before creating agents through `TallyContext`; existing agents are
not retroactively reconfigured by later context registration unless an API explicitly implements
that behavior.

## Replication invariants

- Tally emits portable state/events and supplies receivers. The application owns networking,
  routing, reliability, authorization, and transport encoding.
- Replication serialization is opt-in per source or descriptor type.
- Only locally authoritative top-level state is emitted. Replicated state must not echo back, and a
  descriptor-derived source must not be emitted separately from its descriptor.
- Preserve authoritative IDs as provenance sequences so deterministic ordering survives live
  events and snapshots.
- Receivers reconcile by authoritative ID, batch their mutations, and should continue collecting
  independent event errors before throwing an aggregate failure.
- Live-event application and snapshot application must converge, including when source and
  descriptor snapshots are applied in different orders.
- Whenever public state gains a new identity dimension, decide explicitly whether it crosses the
  replication boundary and test live events, snapshots, serialization, and backward compatibility.
- Duplication keys cross the replication boundary. Serializers include them for Sources and
  Descriptors; receivers treat an absent key from a pre-key payload as the unkeyed bucket.

## Duplication and admission

The basic public policies are `allow`, `ignore`, `replace`, and `reconcile`:

- `allow` admits another instance;
- `ignore` rejects the incoming instance when a conflict exists;
- `replace` removes conflicts and admits the incoming instance;
- `reconcile` applies user logic to an existing target and does not publish a second instance.

An add that is ignored or reconciled currently returns `undefined`. Do not change return semantics
casually; they are part of the public API.

The keyed/grouped transactional design below is the active model. Preserve its public behavior
and its admission invariants when changing duplicate policies.

### Domains, groups, and keys

- A duplication domain defines which types can conflict. A normal type uses itself as its domain.
  All members of a `DuplicationGroup` use the actual shared group object as their domain so
  heterogeneous member types can conflict.
- A key partitions a domain. Only candidates in the same domain and same key bucket conflict.
  `undefined` represents the unkeyed bucket. If key normalization is introduced, normalize only
  `undefined`; do not collapse another supported key value such as `null` into it.
- Keep the public candidate object minimal: its type plus the operations needed to inspect or
  destroy it. A `Source` or `Descriptor` should not decide whether its domain is its concrete type
  or a group, and it should not carry resolved policy machinery merely for indexing.
- Resolve public definitions into a flattened internal policy with the cases `allow`, `ignore`,
  `replace`, `reconcile`, and `group`.
- Heterogeneous group conflict queries cannot honestly return a homogeneous typed array. Keep
  exact-type retrieval strongly typed and erase group-wide conflict results to the common
  duplication-candidate interface.
- Group ranking belongs to each member because member data can be heterogeneous. Index entries may
  retain a member-owned score closure; do not cast every member's data to one invented group type.
- Replacement planning must support an eviction set, not assume only one candidate can ever need
  removal. Stack-limit recovery and reentrant admissions can require plural eviction.
- Validate stack limits and selector configuration at definition time and cover invalid numeric
  inputs with tests.

### Responsibility split

Keep the duplication subsystem divided along these lines:

- `DuplicationIndex` is a queryable storage primitive organized conceptually as
  `domain -> key -> entries`. It stores and retrieves pending/live candidates, preserves stable
  entry order, unregisters exact entries, and prunes empty buckets. It does not choose policy,
  invoke application lifecycle, or own managers.
- `DuplicationResolver` derives domains, queries conflicts, evaluates policy, and produces a
  complete admission decision such as add with an eviction set, ignore, or reconcile with a
  target.
- An admission transaction/reservation coordinates planning, publication, commit, cancellation,
  and rollback across reentrant user code.
- `SourceManager` and `DescriptorManager` execute their concrete lifecycle work, batching, and
  events after consuming the shared decision.

Do not re-check policy independently in a manager after the resolver has decided it. That creates
time-of-check/time-of-use disagreement under reentrancy.

`DuplicationIndex` must remain queryable for every admitted candidate, including candidates whose
policy is `allow`. This is an explicit product requirement for future custom queries and policies.
Do not add a `disabled` policy or a fast path that makes allowed candidates invisible. Optimize
their representation or lookup without deleting the information.

Queries should return read-only snapshots or otherwise prevent callers from mutating index-owned
buckets. Registration should return an exact-entry cleanup handle, and empty key/domain buckets
must be removed.

### Admission transaction invariants

Correctness comes before allocation wins. Any implementation may vary, but it must preserve these
observable properties:

- Reserve an incoming candidate early enough that nested admissions see it as pending.
- Pending candidates participate in conflict and stack-limit decisions.
- A pending candidate remains cancellable while user code publishes or binds it.
- Commit turns the same reservation into live state only after publication succeeds.
- Ignore, failed contribution, thrown handler, declined binding, or other cancellation removes the
  reservation and cleans partial work.
- Replacement is atomic from the admission model's perspective. Reentrant callbacks cannot make a
  `maxStack` bucket overfill or resurrect an evicted candidate.
- Reconciliation against a pending candidate is preserved and reflected when that candidate
  becomes live.
- Internal unregistration occurs before removal observers can reenter.
- Destroying an instance during its added notification leaves no live or pending index entry.

Regression coverage for admission work should include same-key and different-key cases, shared
groups, heterogeneous member rankers, reentrant eviction, reentrant publication, pending
reconciliation, failed publication rollback, declined descriptor binding, removal-observer
replacement, and destruction during added notification.

## Future capabilities

These are product directions, not implemented contracts:

- Duration should be an optional convenience layered on ordinary state admission, with an explored
  builder shape similar to `agent.withDuration(5).addSource(...)`.
- Timeline behavior must use an injectable clock/scheduler abstraction. Do not hard-code
  `Date.now()`, `setTimeout()`, a Roblox scheduler, or another host clock into core semantics.
- Design duration with virtual time in mind: pause, time stop, time scaling, and effects that can
  influence other timelines should be possible without coupling core to a specific engine.
- The exact placement of Timeline as state, service, or another primitive is unresolved. Do not
  freeze that boundary as a side effect of an unrelated feature.
- Tags and richer querying are planned after the basic duration layer. Query-oriented requirements
  are why indexes should retain information even when the built-in policy does not need it today.
- Lifecycle-only or instantaneous effects, such as a hurt visual, are a legitimate use case, but
  no dedicated public primitive has been settled. Do not force every future effect to modify a
  persistent property merely to fit the current model.

## Performance principles

Source/descriptor admission and property resolution are hot paths, but performance changes must
not weaken lifecycle or replication semantics.

- Measure before and after. Never infer a win from fewer lines, fewer objects in one path, or one
  benchmark run.
- Preserve `allow` indexing. Preferred optimizations include direct bucket lookup, allocation-free
  common decisions, avoiding duplicate pending/live entries, pruning retained closures, and only
  invoking selectors/rankers when necessary.
- Keep microbenchmarks for isolated paths and scenario benchmarks for realistic graphs and mixed
  lifecycle operations. Important dimensions include first admission, conflicting admission,
  add/update/remove, property resolution, listeners, descriptors, replication, bucket width,
  stack spam, read-heavy versus mutation-heavy behavior, and teardown.
- Use deterministic fixtures and validate final values and live-object counts outside timed
  regions. Setup that is not part of the claimed operation should stay outside timing.
- Compare the same workloads, runtime, settings, execution transform, and hardware. Benchmark the
  library as `tsc`-emitted JavaScript; do not compare a `tsx`-transformed result against compiled
  output and report the difference as a library regression.
- Run repeated measurements in separate processes. Relative MAD and range spread describe noise;
  they are not significance tests. A relative MAD warning threshold is diagnostic, not a universal
  pass/fail line.
- Tinybench saturation warnings such as zero MAD, zero-dominated samples, or too few distinct
  timings mean the workload needs more work per sample or longer measurement, not that the result
  is perfectly stable.
- Keep benchmark results informational. Do not add a CI failure gate for small percentage changes
  in a noisy shared runner.

See `benchmarks/README.md` for the branch's supported commands, profiles, scenario meanings, output
schema, and comparison rules. The benchmark harness can evolve; the semantic rules above should
remain.

## Tests and verification

Use the smallest relevant checks while iterating, then run the full applicable suite before
handoff. The normal release-quality checks are:

```sh
npm ci
npm run typetest
npm run lint
npm run format:check
npm test
npm run build
npm pack --dry-run
```

For runtime/distribution changes, also test the packed tarball from a clean consumer under the
supported runtimes. For performance changes, run the relevant benchmark suite and a comparable
baseline; unit tests alone are insufficient.

Testing expectations:

- Prefer deterministic tests with no wall-clock sleeps.
- Test public behavior through exported APIs where practical; add focused internal tests only when
  an internal data-structure invariant cannot be observed otherwise.
- Add type tests for generic inference and intentional heterogeneous boundaries.
- Every bug fix gets a regression test that fails for the original reason.
- Lifecycle changes require reentrancy, failure, cleanup, and callback-order tests, not only the
  happy path.
- Replication changes require live-event, snapshot, convergence, and echo-suppression coverage.
- A benchmark is not a correctness test, and a correctness test is not a benchmark.

## Change discipline

- Keep changes scoped to the requested behavior. Do not bundle unrelated cleanup into an
  architectural change.
- If asked only to review or investigate, do not mutate a branch. Report findings and proposed
  fixes instead.
- Preserve public behavior by default even while the package is pre-1.0. If a break is intentional,
  make it explicit, update exports/types/tests/docs, and add it to `CHANGELOG.md`.
- Update `README.md` when the user-facing mental model or API changes. Update benchmark
  documentation when measurement semantics or report fields change.
- Fix transaction correctness before optimizing it. Then benchmark the compiled implementation and
  optimize demonstrated costs without removing required queryability.
- Do not publish, tag, release, merge, or rewrite branch history unless the task explicitly asks
  for it.
