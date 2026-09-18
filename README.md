# Tally Effects

A composable, source-driven status effect framework for deriving and replicating gameplay state.

Tally models gameplay state as Properties modified by Sources.
Rather than treating status effects as first-class objects, effects emerge
from combinations of Sources, Modifiers, Properties, and Descriptors.

## Features

- composable property modifiers
- configurable source priorities
- deterministic ordering
- duplicate policies
- descriptors for derived/runtime-maintained state
- transport-agnostic replication
- snapshots and delta replication
- strongly typed TypeScript API

## Installation

Tally is available as an npm package.

`npm install tally-effects`

## Quick Start

This example defines a `MovementSpeed` Property with a default value of 16. While a `Sprinting` source is active, it contributes a multiplier to that Property. Destroying the Source removes its contribution and restores the resolved value to 16.

```ts
import { defineNumberProperty, defineSourceType, AgentState, type TallyReporter } from "tally-effects";

const MovementSpeed = defineNumberProperty({
    name: "MovementSpeed",
    defaultValue: 16,
});

const Sprinting = defineSourceType<number>({
    name: "Sprinting",
    priority: 100,
    contribute: (multiplier) => [ MovementSpeed.multiply(multiplier) ],
});

const reporter: TallyReporter = {
    report(report) {
        // Forward this to the application's diagnostic system.
        // report.code, report.operation, report.event, and report.error
        // provide stable machine-readable context.
    },
};

const agent = new AgentState(player, { reporter });

const sprint = agent.addSource(Sprinting, 1.5);

agent.get(MovementSpeed); // 24

sprint?.destroy();

agent.get(MovementSpeed); // 16
```

The basic flow is:

```
Source
  ↓ contributes
Modifier
  ↓ modifies
Property
  ↓ resolves to
final value
```

### Error Reporting

`AgentState` and `TallyContext` require a host-provided `TallyReporter`:

```ts
import { AgentState, TallyContext } from "tally-effects";

const agent = new AgentState(player, { reporter });
```

Tally invokes callbacks synchronously and remains reentrant, but observation callbacks are
best-effort. A failed callback is reported after it fails and does not stop later callbacks or
make an already-completed update, removal, or destruction appear to have failed. Teardown and
property-resolution failures encountered during lifecycle work are reported the same way so
cleanup can continue. Tally also contains exceptions thrown by the reporter itself; reporters
should still avoid throwing so diagnostics are not lost.

`TallyReporter.report()` receives one structured `TallyReport` object. Its stable fields are
`error`, `code`, and `operation`; reports can also identify a public lifecycle `event` and a
public `subject`. The reporter owns human-readable formatting, allowing hosts to share the same contract without sharing a logging implementation.

### Properties

Properties define values that Tally resolves. A Property provides a default value and defines how its Modifiers combine.

```ts
const HealthRegen = defineNumberProperty({
    name: "HealthRegen",
    defaultValue: 1,
});
```

### Sources

A Source is a runtime cause of state attached to an AgentState. Each Source is an instance of a SourceType, which defines the Modifiers that Source contributes.

A SourceType defines how Source data becomes modifiers:

```ts
const Poisoned = defineSourceType<PoisonData>({
    name: "Poisoned",
    priority: 100,
    contribute: (data) => [
        HealthRegen.multiply(data.regenMultiplier),
    ],
});
```

#### Priorities and keys

`AgentState.makeSource()` creates a fluent, agent-scoped builder for one
`SourceType`. Use it when setting a Source's priority or duplication key:

```ts
const poison = agent
    .makeSource(Poisoned)
    .priority(200) // overrides Poisoned.priority for this builder
    .key("poison:spider-7")
    .add({ regenMultiplier: 0.5 });
```

`key()` selects the duplication bucket. `provenance()` is an advanced ordering
and replication setting; leave it unset for ordinary local state, and let
replication receivers set it for received state.

Builders are mutable and reusable: their configured settings remain in effect
for every later `.add()` call. Create a new builder, or change its settings,
when the next Source needs different values. `.add()` returns `undefined` when
a duplicate policy rejects or reconciles the new Source.

### Priorities and Deterministic Ordering

Modifiers are resolved deterministically using a lexicographic ordering key: Source
priority, ordering domain (authoritative before local), provenance sequence, and the
Modifier's contribution index within its Source. The result does not depend on
collection iteration order or the local order in which replicated state arrived.

### Duplicate Policies

A duplicate policy determines what happens when a Source or Descriptor is added in a
conflicting duplication bucket. The policies are listed below:

| Policy | Behavior |
| ------ | -------- |
| `allow` | create another instance |
| `ignore` | reject the new instance |
| `replace` | destroy the old instance and create the new one |
| `reconcile` | let application code merge incoming data into the existing instance |

By default, a type is its own duplication domain and all of its instances use the
unkeyed bucket. Use a builder's `key()` method to partition that domain. Different
keys do not conflict, while `undefined` remains the unkeyed bucket:

```ts
const first = agent
    .makeSource(Shield)
    .key("left-hand")
    .add({ amount: 10 });

const second = agent
    .makeSource(Shield)
    .key("right-hand")
    .add({ amount: 20 });
```

Use a `DuplicationGroup` when different SourceTypes or DescriptorTypes should share a
domain. A group can set a stack limit and, for replacement, choose the `oldest`,
`newest`, `lowest`, or `highest` candidate. Each member supplies its own rank function,
so heterogeneous data remains type-safe:

```ts
const damageOverTime = defineDuplicationGroup({
    policy: "replace",
    maxStack: 3,
    selector: "lowest",
});

const Burning = defineSourceType<number>({
    name: "Burning",
    priority: 100,
    duplication: damageOverTime.member({ rank: (damage) => damage }),
    contribute: (damage) => [ HealthRegen.add(-damage) ],
});
```

Admission is synchronous and reentrant. An incoming candidate participates in conflicts
while it is still pending, so callbacks that immediately add, update, or destroy state see
a consistent duplication bucket. Replacement decisions are revalidated after preparation
and before any candidate is evicted. Ignored and reconciled additions return `undefined`
because they do not create a new instance. A replacement may also return `undefined` if
reentrant lifecycle work cancels it before publication.

### Descriptors

Some Sources cannot be represented by replicated data alone. A proximity-based Source, for example, may depend on an object that exists differently on the server and client.

Descriptors are optional instances that separate what state should exist from how that state is produced in the current runtime. A Descriptor contains the portable data, while a locally registered DescriptorHandler uses that data to create and maintain its Source.

```
Descriptor
    ↓ runtime handler
DescriptorBinding
    ↓ adds
Source
    ↓ contributes
Modifiers
```

For example, a `ProximityFear` Descriptor can identify what the player should be afraid of without containing server- or client-specific logic for measuring that object's proximity.

```ts
const ProximityFear = defineDescriptorType<
    ProximityData,
    FearData
>({
    name: "ProximityFear",
    source: Fear, // source type
    replication: {
        serialize: ...,
        deserialize: ...,
    },
});
```

Register a handler on each `AgentState` that needs to create the Descriptor. A
`TallyContext` can also register handlers once and apply them to the AgentStates it creates.

```ts
agent.registerDescriptorHandler(
    ProximityFear,
    (ctx, data) => {
        const source = ctx.addSource(
            calculateFear(data)
        );

        if (!source)
            return;

        return {
            source,
            update(next) {
                source.set(
                    calculateFear(next)
                );
            },
            destroy() {
                source.destroy();
            },
        };
    }
);
```

Register descriptor handlers before adding their Descriptor. When using a `TallyContext`,
register them before creating AgentStates so each agent receives the expected handler.

#### Descriptor keys

`AgentState.makeDescriptor()` creates a builder for one `DescriptorType`. Use it when setting a Descriptor's duplication key:

```ts
const fear = agent
    .makeDescriptor(ProximityFear)
    .key("fear:nearby-wolf")
    .add(proximityData);
```

Descriptor builders support `key()` and the advanced `provenance()` setting.
Like Source builders, they retain their settings across `.add()` calls, and
`.add()` returns `undefined` when descriptor admission does not create an
instance (for example, a duplicate policy rejects it or its handler declines
to bind it).

### Replication

Each `AgentState` emits replication events, but Tally does not own your networking layer.
Developers are expected to implement how to transport the data. `TallyContext` forwards events
from the AgentStates it creates as a convenience when one context owns multiple agents.

Tally does offer receivers for accepting replication events.

This keeps actor-local state independent: an actor can own one `AgentState`, subscribe with
`agent.onReplicationEmit()`, and send that event across its actor boundary. The receiving actor
recreates the matching type definitions and handlers locally, then applies the event through its
`SourceReceiver` or `DescriptorReceiver`.

When replication is enabled, Source and Descriptor duplication keys are serialized and
reconstructed with their state. Payloads without a key are treated as belonging to the
unkeyed bucket, allowing pre-key snapshots and events to remain usable.

The replication flow looks like:

```
Authoritative AgentState
      ↓
agent.onReplicationEmit()
      ↓
your transport
      ↓
SourceReceiver / DescriptorReceiver
      ↓
Receiving AgentState
```

## Status

Tally is currently pre-1.0. Public APIs may evolve as the library gains real-world usage.
