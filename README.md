# Tally Effects

Keep gameplay values in sync with the things affecting them.

Define a Property for a value such as movement speed, then define SourceTypes for sprinting, equipment, buffs, or debuffs. Each active Source contributes Modifiers; Tally resolves the value as Sources are added, updated, and destroyed. Effects emerge from these reusable pieces, so several mechanics can affect the same value.

## Why Tally?

- **Composable state:** Sources contribute to Properties without each gameplay system maintaining its own final total.
- **Predictable results:** Priorities, deterministic ordering, and duplicate policies define how overlapping Sources behave.
- **Multiplayer support:** Opt-in replication provides events and snapshots while your application chooses the transport. Descriptors can turn portable state into Sources maintained by each runtime.
- **Fits your game:** The core is independent of a particular engine or host, with a strongly typed TypeScript API.

## Install

```sh
npm install tally-effects
```

## Quick start

This Source makes a player's movement speed 50% faster while sprinting. Destroying it restores the Property's default value.

```ts
import {
    AgentState,
    defineNumberProperty,
    defineSourceType,
    type TallyReporter,
} from "tally-effects";

const MovementSpeed = defineNumberProperty({
    name: "MovementSpeed",
    defaultValue: 16,
});

const Sprinting = defineSourceType<number>({
    name: "Sprinting",
    priority: 100,
    contribute: (multiplier) => [MovementSpeed.multiply(multiplier)],
});

const reporter: TallyReporter = {
    report(report) {
        console.error(report.error);
    },
};

const player = { id: "player-1" };
const agent = new AgentState(player, { reporter });

agent.get(MovementSpeed); // 16

const sprint = agent.addSource(Sprinting, 1.5);
agent.get(MovementSpeed); // 24

sprint?.destroy();
agent.get(MovementSpeed); // 16
```

## Core mechanics

### Properties and Sources

A Property owns its default value and how Modifiers combine. A SourceType turns data into Modifiers; each Source is an active instance attached to an `AgentState`. Updating or destroying a Source changes the resolved value, so equipment, abilities, and status effects can contribute to the same Property without maintaining a shared total themselves.

### Priorities and deterministic order

Lower-priority Sources resolve first. For example, boots that add 4 speed at priority 50 apply before sprinting's multiplier at priority 100:

```ts
const Boots = defineSourceType<undefined>({
    name: "Boots",
    priority: 50,
    contribute: () => [MovementSpeed.add(4)],
});

agent.addSource(Boots);
agent.addSource(Sprinting, 1.5);
agent.get(MovementSpeed); // (16 + 4) × 1.5 = 30
```

At equal priority, Tally uses stable provenance ordering, so replicated state resolves consistently even when events arrive in a different order. Updating a Source keeps its place.

### Duplicate policies and keys

Choose what happens when another Source or Descriptor enters the same duplication bucket:

| Policy | Result |
| --- | --- |
| `allow` (default) | Keep both instances |
| `ignore` | Keep the existing instance |
| `replace` | Replace the existing instance |
| `reconcile` | Merge incoming data into the existing instance |

Keys give one type separate buckets. This lets two auras coexist while a new version of one aura replaces only its own instance:

```ts
const SpeedAura = defineSourceType<number>({
    name: "SpeedAura",
    priority: 75,
    duplication: { policy: "replace" },
    contribute: (bonus) => [MovementSpeed.add(bonus)],
});

agent.makeSource(SpeedAura).key("ally:one").add(2);
agent.makeSource(SpeedAura).key("ally:two").add(3);
agent.makeSource(SpeedAura).key("ally:one").add(4); // replaces the first aura
```

Duplication groups let different types share a domain, stack limit, and replacement rule.

### Descriptors for runtime-dependent effects

A Source is enough when its own data can determine its Modifiers. Use a Descriptor when the data records *what should be happening*, but producing the Source also requires local world state or services. For example, `{ targetId: "wolf" }` can express that an agent is affected by a nearby wolf without trying to serialize the wolf object, a spatial query, or an event subscription.

`defineDescriptorType()` pairs that portable data with the SourceType it will produce. Before adding the Descriptor, register a handler on the `AgentState`, or on the `TallyContext` that creates it. The handler translates Descriptor data into local behavior and returns a binding:

```text
Descriptor data -> local handler and binding -> derived Source -> Modifiers
```

Create derived Sources through `ctx.addSource()`. This ties their provenance and lifetime to the Descriptor, prevents them from replicating as independent state, and ensures they are cleaned up with it. When `descriptor.set()` changes the portable data, Tally calls the binding's `update()` method. When the Descriptor is destroyed, Tally calls `destroy()` so the binding can disconnect local listeners, then removes the Sources created through its context.

The same Descriptor name and data can have different handlers: a server might calculate and apply a movement penalty, while a client might maintain a presentation-oriented Source from its own local state. Descriptors also work entirely within one runtime; compatible names and data contracts matter only when you choose to replicate them. See the [descriptor guide](docs/guide.md#descriptors) for a complete type, handler, update, and cleanup example.

### Replication on your transport

Replication is opt-in for each SourceType or DescriptorType through `serialize` and `deserialize`. An authoritative `AgentState` emits live events for additions, updates, and removals; `createReplicationSnapshot(agent)` captures its current state for a joining client. Your application sends these messages to the matching agent through its own transport. Each receiver uses local type definitions with compatible names and data formats; a replicated Descriptor runs the receiving runtime's own handler.

Given a configured receiving `agent` and a `TallyContext` named `tally`, the receiver side is small:

```ts
import {
    DescriptorReceiver,
    SourceReceiver,
    type ReplicationEvent,
    type ReplicationSnapshot,
} from "tally-effects";

const sources = new SourceReceiver(agent, (name) => tally.sources.get(name));
const descriptors = new DescriptorReceiver(agent, (name) => tally.descriptors.get(name));

function receiveEvents(events: readonly ReplicationEvent[]) {
    sources.apply(events);
    descriptors.apply(events);
}

function receiveSnapshot(snapshot: ReplicationSnapshot) {
    sources.applySnapshot(snapshot);
    descriptors.applySnapshot(snapshot);
}
```

The receivers reconcile authoritative IDs and filter events for their own kind. Received state does not echo back, and descriptor-derived Sources are not emitted separately. See the [replication guide](docs/guide.md#replicating-a-descriptor-with-different-local-handlers) for the shared definitions, server and client handlers, and transport wiring.

The [usage guide](docs/guide.md) covers builders, duplication groups, descriptor handlers, replication setup, and error reporting in detail.

Tally is pre-1.0; public APIs may evolve as the library gains real-world usage.
