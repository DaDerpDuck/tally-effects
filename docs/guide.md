# Tally Effects usage guide

For the installation command and a first example, see the [README](../README.md).
This guide covers the options behind that example. A Source contributes Modifiers to
Properties on an `AgentState`; a Descriptor can create Sources through a local handler.
The examples below build on each other.

## Error reporting

`AgentState` and `TallyContext` require a host-provided `TallyReporter`:

```ts
import {
    AgentState,
    defineDescriptorType,
    defineDuplicationGroup,
    defineNumberProperty,
    defineSourceType,
    type TallyReporter,
} from "tally-effects";

const reporter: TallyReporter = {
    report(report) {
        console.error(report.error);
    },
};
const player = { id: "player-1" };
const agent = new AgentState(player, { reporter });
```

Observation callbacks run synchronously. If one fails, Tally reports it and continues with the remaining callbacks. Recoverable cleanup and property-resolution failures are reported too.

`TallyReporter.report()` receives one structured `TallyReport` object. Its stable fields are `error`, `code`, and `operation`; reports can also identify a public lifecycle `event` and a public `subject`. The reporter owns human-readable formatting, allowing hosts to share the same contract without sharing a logging implementation.

## Properties

Properties define values that Tally resolves. A Property provides a default value and defines how its Modifiers combine.

```ts
const HealthRegen = defineNumberProperty({
    name: "HealthRegen",
    defaultValue: 1,
});
```

## Sources

A Source is a runtime cause of state attached to an AgentState. Each Source is an instance of a SourceType, which defines the Modifiers that Source contributes.

A SourceType defines how Source data becomes modifiers. This example builds on the
`HealthRegen` Property above:

```ts
type PoisonData = { regenMultiplier: number };

const Poisoned = defineSourceType<PoisonData>({
    name: "Poisoned",
    priority: 100,
    contribute: (data) => [
        HealthRegen.multiply(data.regenMultiplier),
    ],
});
```

### Priorities and keys

`AgentState.makeSource()` creates a fluent, agent-scoped builder for one `SourceType`. Use it when setting a Source's priority or duplication key:

```ts
const poison = agent
    .makeSource(Poisoned)
    .priority(200) // overrides Poisoned.priority for this builder
    .key("poison:spider-7")
    .add({ regenMultiplier: 0.5 });
```

`key()` selects the duplication bucket. `provenance()` is an advanced ordering and replication setting; leave it unset for ordinary use, and let replication receivers set it for received state.

Builders are mutable and reusable: their configured settings remain in effect for every later `.add()` call. Create a new builder, or change its settings, when the next Source needs different values. `.add()` returns `undefined` when a duplicate policy rejects or reconciles the new Source.

## Priorities and deterministic ordering

Modifiers are resolved deterministically using a lexicographic ordering key: Source priority, ordering domain (authoritative before local), provenance sequence, and the Modifier's contribution index within its Source. The result does not depend on collection iteration order or the local order in which replicated state arrived.

## Duplicate policies

A duplicate policy determines what happens when a Source or Descriptor is added in a conflicting duplication bucket. The policies are listed below:

| Policy | Behavior |
| ------ | -------- |
| `allow` | create another instance |
| `ignore` | reject the new instance |
| `replace` | destroy the old instance and create the new one |
| `reconcile` | let application code merge incoming data into the existing instance |

By default, a type is its own duplication domain and all of its instances use the unkeyed bucket. Use a builder's `key()` method to partition that domain. Different keys do not conflict, while `undefined` remains the unkeyed bucket:

```ts
const ShieldStrength = defineNumberProperty({
    name: "ShieldStrength",
    defaultValue: 0,
});
const Shield = defineSourceType<{ amount: number }>({
    name: "Shield",
    priority: 100,
    duplication: { policy: "ignore" },
    contribute: ({ amount }) => [ShieldStrength.add(amount)],
});

const first = agent
    .makeSource(Shield)
    .key("left-hand")
    .add({ amount: 10 });

const second = agent
    .makeSource(Shield)
    .key("right-hand")
    .add({ amount: 20 });
```

Use a `DuplicationGroup` when different SourceTypes or DescriptorTypes should share a domain. A group can set a stack limit and, for replacement, choose the `oldest`, `newest`, `lowest`, or `highest` candidate. Each member supplies its own rank function:

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

Ignored and reconciled additions return `undefined` because they do not create a new instance. Source and Descriptor added events fire after the new instance becomes active.

## Descriptors

Some effects depend on local world data that a Source does not own. A proximity-based effect, for example, may need to track a moving target.

Descriptors are optional instances that separate what state should exist from how that state is produced in the current runtime. A Descriptor contains the portable data, while a locally registered DescriptorHandler uses that data to create and maintain its Source.

Descriptors work without replication. The [multiplayer example](#replicating-a-descriptor-with-different-local-handlers) later in this guide shows how two runtimes can use the same Descriptor name and data with different local handlers.

```
Descriptor
    ↓ runtime handler
DescriptorBinding
    ↓ adds
Source
    ↓ contributes
Modifiers
```

For example, a `ProximityFear` Descriptor can identify what the player should be afraid of without containing server- or client-specific logic for measuring that object's proximity. Here, `localTargets` stands in for application-owned proximity state:

```ts
type ProximityData = { targetId: string };

const FearLevel = defineNumberProperty({
    name: "FearLevel",
    defaultValue: 0,
});
const Fear = defineSourceType<number>({
    name: "Fear",
    priority: 100,
    contribute: (level) => [FearLevel.add(level)],
});
const ProximityFear = defineDescriptorType<ProximityData, number>({
    name: "ProximityFear",
    source: Fear,
});

const localTargets = new Map([["nearby-wolf", { near: true }]]);
const calculateFear = ({ targetId }: ProximityData) =>
    localTargets.get(targetId)?.near ? 10 : 0;
```

Register a handler on each `AgentState` that needs to create the Descriptor. A `TallyContext` can also register handlers once and apply them to the AgentStates it creates.

```ts
agent.registerDescriptorHandler(
    ProximityFear,
    (ctx, data) => {
        let currentData = data;
        const source = ctx.addSource(
            calculateFear(currentData)
        );

        if (!source)
            return;
        const refresh = () => source.set(calculateFear(currentData));

        // Subscribe refresh to local movement events here.
        // Keep the unsubscribe function for destroy().

        return {
            source,
            update(next) {
                currentData = next;
                refresh();
            },
            destroy() {
                // Unsubscribe from movement events here.
                source.destroy();
            },
        };
    }
);
```

Register descriptor handlers before adding their Descriptor. When using a `TallyContext`, register them before creating AgentStates so each agent receives the expected handler.
The example recalculates on Descriptor updates. Connect `refresh` to local
movement events for proximity changes, and remove that listener in `destroy()`.

### Descriptor keys

`AgentState.makeDescriptor()` creates a builder for one `DescriptorType`. Use it when setting a Descriptor's duplication key:

```ts
const fear = agent
    .makeDescriptor(ProximityFear)
    .key("fear:nearby-wolf")
    .add({ targetId: "nearby-wolf" });
```

Descriptor builders support `key()` and the advanced `provenance()` setting. Like Source builders, they retain their settings across `.add()` calls, and `.add()` returns `undefined` when descriptor admission does not create an instance (for example, a duplicate policy rejects it or its handler declines to bind it).

## Replication

Replication is opt-in for each SourceType or DescriptorType. For enabled types,
a locally authoritative `AgentState` emits live events, and
`createReplicationSnapshot(agent)` captures current state. Your application
transports that data. `TallyContext` forwards events from the AgentStates it
creates when one context owns multiple agents.

Tally provides receivers for applying replication events and snapshots.

This keeps actor-local state independent: an actor can own one `AgentState`, subscribe with `agent.onReplicationEmit()`, and send that event across its actor boundary. The receiving actor recreates the matching type definitions and handlers locally, then applies the event through its `SourceReceiver` or `DescriptorReceiver`.

Replication serializers, deserializers, and receiver type lookups should only convert or resolve data. They must not mutate the AgentState they operate on.

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

### Replicating a Descriptor with different local handlers

This example uses one `TallyContext` per runtime to configure multiple players. The shared module defines the wire contract and common context setup. The server and client each register a local `ProximityAura` DescriptorType with the same name and data format, but their handlers create different Sources.

**Shared module (`shared.ts`):**

```ts
import {
    TallyContext,
    defineNumberProperty,
    type ReplicationDefinition,
    type TallyReporter,
} from "tally-effects";

export const MovementSpeed = defineNumberProperty({
    name: "MovementSpeed",
    defaultValue: 16,
});

export type AuraData = { targetId: string };
export const auraReplication: ReplicationDefinition<AuraData> = {
    serialize: ({ targetId }) => targetId,
    deserialize(value) {
        if (typeof value !== "string")
            throw new TypeError("Expected a target ID");
        return { targetId: value };
    },
};

export function createGameContext(reporter: TallyReporter) {
    const tally = new TallyContext<{ id: string }>({ reporter });
    tally.register(MovementSpeed);
    return tally;
}
```

**Server application (`server.ts`):** the handler derives a walk-speed Source. The application supplies a distance query and a movement subscription so the Source stays current as the world changes.

```ts
import {
    createReplicationSnapshot,
    defineDescriptorType,
    defineSourceType,
    type ReplicationEvent,
    type TallyReporter,
} from "tally-effects";
import {
    MovementSpeed,
    auraReplication,
    createGameContext,
    type AuraData,
} from "./shared.js";

const ServerHaste = defineSourceType<number>({
    name: "ServerHaste",
    priority: 100,
    contribute: (multiplier) => [MovementSpeed.multiply(multiplier)],
});
const ServerAura = defineDescriptorType<AuraData, number>({
    name: "ProximityAura",
    source: ServerHaste,
    replication: auraReplication,
});

export function createServerGame(
    reporter: TallyReporter,
    distanceTo: (playerId: string, targetId: string) => number,
    subscribeMovement: (playerId: string, refresh: () => void) => () => void,
    sendEvent: (playerId: string, event: ReplicationEvent) => void
) {
    const tally = createGameContext(reporter);
    tally.register(ServerHaste);
    tally.register(ServerAura);
    tally.registerDescriptorHandler(ServerAura, (ctx, data) => {
        let targetId = data.targetId;
        const speed = () => distanceTo(ctx.agent.entity.id, targetId) < 5 ? 1.25 : 1;
        const source = ctx.addSource(speed());
        if (!source) return;
        const refresh = () => source.set(speed());
        const unsubscribe = subscribeMovement(ctx.agent.entity.id, refresh);

        return {
            source,
            update(next) { targetId = next.targetId; refresh(); },
            destroy() { unsubscribe(); source.destroy(); },
        };
    });

    tally.onReplicationEmit((agent, event) => sendEvent(agent.entity.id, event));
    return {
        createPlayer(playerId: string) {
            const agent = tally.createAgentState({ id: playerId });
            agent.addDescriptor(ServerAura, { targetId: "wolf" });
            return { agent, snapshotForJoin: () => createReplicationSnapshot(agent) };
        },
    };
}
```

**Transport boundary:** implement `sendEvent(playerId, event)` with your network transport. Deliver each event to the matching client's `receiveEvent(event)`. When a client joins, send `snapshotForJoin()` through the transport to `receiveSnapshot(snapshot)`. These messages carry the Descriptor's name, ID, and serialized data; the server's derived Source is not sent separately.

**Client application (`client.ts`):** the same Descriptor name and data produce a screen effect through a different local SourceType and handler.

```ts
import {
    DescriptorReceiver,
    defineDescriptorType,
    defineNumberProperty,
    defineSourceType,
    type ReplicationEvent,
    type ReplicationSnapshot,
    type TallyReporter,
} from "tally-effects";
import {
    auraReplication,
    createGameContext,
    type AuraData,
} from "./shared.js";

const ScreenIntensity = defineNumberProperty({
    name: "ScreenIntensity",
    defaultValue: 0,
});
const ClientVisual = defineSourceType<number>({
    name: "ClientVisual",
    priority: 100,
    contribute: (intensity) => [ScreenIntensity.override(intensity)],
});
const ClientAura = defineDescriptorType<AuraData, number>({
    name: "ProximityAura",
    source: ClientVisual,
    replication: auraReplication,
});

export function createClientGame(
    reporter: TallyReporter,
    distanceTo: (playerId: string, targetId: string) => number,
    subscribeMovement: (playerId: string, refresh: () => void) => () => void
) {
    const tally = createGameContext(reporter);
    tally.register(ScreenIntensity);
    tally.register(ClientVisual);
    tally.register(ClientAura);
    tally.registerDescriptorHandler(ClientAura, (ctx, data) => {
        let targetId = data.targetId;
        const intensity = () => distanceTo(ctx.agent.entity.id, targetId) < 5 ? 0.7 : 0;
        const source = ctx.addSource(intensity());
        if (!source) return;
        const refresh = () => source.set(intensity());
        const unsubscribe = subscribeMovement(ctx.agent.entity.id, refresh);

        return {
            source,
            update(next) { targetId = next.targetId; refresh(); },
            destroy() { unsubscribe(); source.destroy(); },
        };
    });

    return {
        createPlayer(playerId: string) {
            const agent = tally.createAgentState({ id: playerId });
            const receiver = new DescriptorReceiver(
                agent,
                (name) => tally.descriptors.get(name)
            );
            return {
                agent,
                receiveEvent: (event: ReplicationEvent) => receiver.apply([event]),
                receiveSnapshot: (snapshot: ReplicationSnapshot) =>
                    receiver.applySnapshot(snapshot),
            };
        },
    };
}
```

The server's nearby aura makes movement speed 20 instead of 16; receiving that Descriptor gives the client a local screen intensity of 0.7. `DescriptorReceiver` matches its name and authoritative ID, then invokes the client's handler. Later updates and removals reach the same Descriptor, and snapshots reconcile late joiners. `SourceReceiver` follows the same pattern for direct Sources that opt into replication. Received state does not echo back.

For callback and mutation boundaries, see the [reentrancy glossary](../REENTRANCY.md).
