import { describe, expect, it } from "vitest";
import {
	AgentState,
	createReplicationSnapshot,
	defineNumberProperty,
	defineSourceType,
	serializeSource,
	SourceReceiver,
	type ReplicationEvent,
	type SourceType,
	TallyContext,
} from "../src/index.js";

interface SourceData {
	readonly value: number;
}

const Value = defineNumberProperty({ name: "ReplicatedSourceValue", defaultValue: 0 });

function defineReplicatedSource(name: string) {
	return defineSourceType<SourceData>({
		name,
		priority: 100,
		contribute: (data) => [Value.add(data.value)],
		replication: {
			serialize: (data) => data.value,
			deserialize: (serialized) => {
				if (typeof serialized !== "number")
					throw new Error("Expected a numeric Source value");
				return { value: serialized };
			},
		},
	});
}

const ValueSource = defineReplicatedSource("ReplicatedValueSource");

interface ReplicationFixtureOptions {
	readonly relayEvents?: boolean;
	readonly sourceTypes?: readonly SourceType<SourceData>[];
}

function createReplicationFixture({
	relayEvents = true,
	sourceTypes = [],
}: ReplicationFixtureOptions = {}) {
	const allSourceTypes = [ValueSource, ...sourceTypes];
	const createTally = () => {
		const tally = new TallyContext<undefined>();
		tally.register(Value);
		for (const sourceType of allSourceTypes) tally.register(sourceType);
		return tally;
	};

	const serverTally = createTally();
	const serverAgent = serverTally.createAgentState(undefined);
	const clientTally = createTally();
	const clientAgent = clientTally.createAgentState(undefined);
	const receiver = new SourceReceiver(clientAgent, (name) => clientTally.sources.get(name));
	const emittedEvents: ReplicationEvent[] = [];

	serverTally.onReplicationEmit((_, event) => {
		emittedEvents.push(event);
		if (relayEvents) receiver.apply([event]);
	});

	return {
		clientAgent,
		clientTally,
		emittedEvents,
		receiver,
		serverAgent,
		serverTally,
	};
}

function getOnlySource(
	agent: AgentState<undefined>,
	sourceType: SourceType<SourceData> = ValueSource
) {
	const sources = [...agent.getSources(sourceType)];
	expect(sources).toHaveLength(1);
	return sources[0]!;
}

function getSourceNames(agent: AgentState<undefined>) {
	return new Set(
		agent
			.getSources()
			.values()
			.map((source) => source.type.name)
	);
}

describe("Source replication events", () => {
	it("reconstructs an added Source with its data, priority, key, and provenance", () => {
		const { clientAgent, emittedEvents, serverAgent } = createReplicationFixture();

		const serverSource = serverAgent.addSource(
			ValueSource,
			{ value: 5 },
			{ key: "player:one", priority: 250 }
		)!;

		expect(emittedEvents).toEqual([
			{
				target: "source",
				event: {
					kind: "added",
					source: {
						id: serverSource.id,
						type: ValueSource.name,
						priority: 250,
						key: "player:one",
						data: 5,
					},
				},
			},
		]);

		const clientSource = getOnlySource(clientAgent);
		expect(clientSource.get()).toEqual({ value: 5 });
		expect(clientSource.priority).toBe(250);
		expect(clientSource.key).toBe("player:one");
		expect(clientSource.provenance).toEqual({
			domain: "replicated",
			sequence: serverSource.id,
		});
		expect(clientAgent.get(Value)).toBe(5);
	});

	it("applies updates without changing immutable Source metadata", () => {
		const { clientAgent, emittedEvents, serverAgent } = createReplicationFixture();
		const serverSource = serverAgent.addSource(
			ValueSource,
			{ value: 5 },
			{ key: "player:one", priority: 250 }
		)!;
		emittedEvents.length = 0;

		serverSource.set({ value: 10 });

		expect(emittedEvents).toEqual([
			{
				target: "source",
				event: { kind: "updated", id: serverSource.id, data: 10 },
			},
		]);
		const clientSource = getOnlySource(clientAgent);
		expect(clientSource.get()).toEqual({ value: 10 });
		expect(clientSource.priority).toBe(250);
		expect(clientSource.key).toBe("player:one");
		expect(clientAgent.get(Value)).toBe(10);
	});

	it("removes the reconstructed Source", () => {
		const { clientAgent, emittedEvents, serverAgent } = createReplicationFixture();
		const serverSource = serverAgent.addSource(ValueSource, { value: 5 })!;
		emittedEvents.length = 0;

		serverSource.destroy();

		expect(emittedEvents).toEqual([
			{
				target: "source",
				event: { kind: "removed", id: serverSource.id },
			},
		]);
		expect(clientAgent.getSources(ValueSource).size).toBe(0);
		expect(clientAgent.get(Value)).toBe(0);
	});

	it("keeps same-type replicated and client-local Sources independent", () => {
		const { clientAgent, serverAgent } = createReplicationFixture();
		const clientLocal = clientAgent.addSource(ValueSource, { value: 1000 })!;
		const first = serverAgent.addSource(ValueSource, { value: 1 })!;
		const second = serverAgent.addSource(ValueSource, { value: 10 })!;
		serverAgent.addSource(ValueSource, { value: 100 });

		expect(clientAgent.getSources(ValueSource)).toContain(clientLocal);
		expect(clientAgent.getSources(ValueSource).size).toBe(4);
		expect(clientAgent.get(Value)).toBe(1111);

		second.set({ value: 20 });
		first.destroy();

		expect(clientAgent.getSources(ValueSource).size).toBe(3);
		expect(clientAgent.get(Value)).toBe(1120);
	});

	it("preserves distinct duplication keys during reconstruction", () => {
		const KeyedSource = defineSourceType<SourceData>({
			name: "ReplicatedKeyedSource",
			priority: 100,
			duplication: { policy: "ignore" },
			contribute: (data) => [Value.add(data.value)],
			replication: ValueSource.replication,
		});
		const { clientAgent, serverAgent } = createReplicationFixture({
			sourceTypes: [KeyedSource],
		});

		serverAgent.addSource(KeyedSource, { value: 1 }, { key: "a" });
		serverAgent.addSource(KeyedSource, { value: 10 }, { key: "b" });

		expect(
			new Set(
				clientAgent
					.getSources(KeyedSource)
					.values()
					.map((source) => source.key)
			)
		).toEqual(new Set(["a", "b"]));
		expect(clientAgent.get(Value)).toBe(11);
	});

	it("continues applying valid events when one Source type is unknown", () => {
		const { clientAgent, receiver, serverAgent } = createReplicationFixture({
			relayEvents: false,
		});
		const first = serverAgent.addSource(ValueSource, { value: 1 })!;
		const second = serverAgent.addSource(ValueSource, { value: 2 })!;

		expect(() =>
			receiver.apply([
				{
					target: "source",
					event: { kind: "added", source: serializeSource(first) },
				},
				{
					target: "source",
					event: {
						kind: "added",
						source: {
							id: 404,
							type: "UnknownSource",
							priority: 0,
							key: undefined,
							data: null,
						},
					},
				},
				{
					target: "source",
					event: { kind: "added", source: serializeSource(second) },
				},
			])
		).toThrow("Failed to apply 1 replication event(s)");
		expect(clientAgent.getSources(ValueSource).size).toBe(2);
		expect(clientAgent.get(Value)).toBe(3);
	});

	it("rejects updates for Sources that were never reconstructed", () => {
		const { receiver } = createReplicationFixture({ relayEvents: false });

		expect(() =>
			receiver.apply([{ target: "source", event: { kind: "updated", id: 404, data: null } }])
		).toThrow("Failed to apply 1 replication event(s)");
	});
});

describe("Source replication snapshots", () => {
	it("reconciles additions, updates, removals, and keys", () => {
		const FirstSource = defineReplicatedSource("SnapshotFirstSource");
		const SecondSource = defineReplicatedSource("SnapshotSecondSource");
		const RemovedSource = defineReplicatedSource("SnapshotRemovedSource");
		const { clientAgent, receiver, serverAgent } = createReplicationFixture({
			relayEvents: false,
			sourceTypes: [FirstSource, SecondSource, RemovedSource],
		});
		const first = serverAgent.addSource(FirstSource, { value: 5 }, { key: "first" })!;
		const removed = serverAgent.addSource(RemovedSource, { value: 6 }, { key: "removed" })!;

		receiver.applySnapshot(createReplicationSnapshot(serverAgent));

		expect(clientAgent.getSources().size).toBe(2);
		expect(clientAgent.get(Value)).toBe(11);
		expect(getSourceNames(clientAgent)).toEqual(
			new Set([FirstSource.name, RemovedSource.name])
		);
		expect(getOnlySource(clientAgent, FirstSource).key).toBe("first");

		first.set({ value: 7 });
		removed.destroy();
		serverAgent.addSource(SecondSource, { value: 8 }, { key: "second" });
		receiver.applySnapshot(createReplicationSnapshot(serverAgent));

		expect(clientAgent.getSources().size).toBe(2);
		expect(clientAgent.get(Value)).toBe(15);
		expect(getSourceNames(clientAgent)).toEqual(new Set([FirstSource.name, SecondSource.name]));
		expect(getOnlySource(clientAgent, FirstSource).get()).toEqual({ value: 7 });
		expect(getOnlySource(clientAgent, SecondSource).key).toBe("second");
	});

	it("is idempotent and preserves client-local Sources", () => {
		const { clientAgent, receiver, serverAgent } = createReplicationFixture({
			relayEvents: false,
		});
		const clientLocal = clientAgent.addSource(ValueSource, { value: 100 }, { key: "local" })!;
		serverAgent.addSource(ValueSource, { value: 5 }, { key: "remote" });
		const snapshot = createReplicationSnapshot(serverAgent);

		receiver.applySnapshot(snapshot);
		receiver.applySnapshot(snapshot);

		expect(clientAgent.getSources(ValueSource)).toContain(clientLocal);
		expect(clientAgent.getSources(ValueSource).size).toBe(2);
		expect(clientAgent.get(Value)).toBe(105);
		expect(
			new Set(
				clientAgent
					.getSources(ValueSource)
					.values()
					.map((source) => source.key)
			)
		).toEqual(new Set(["local", "remote"]));
	});

	it("excludes Source types without replication metadata", () => {
		const LocalSource = defineSourceType<SourceData>({
			name: "SnapshotLocalSource",
			priority: 100,
			contribute: (data) => [Value.add(data.value)],
		});
		const { clientAgent, clientTally, receiver, serverAgent, serverTally } =
			createReplicationFixture({ relayEvents: false });
		clientTally.register(LocalSource);
		serverTally.register(LocalSource);
		serverAgent.addSource(ValueSource, { value: 5 });
		serverAgent.addSource(LocalSource, { value: 100 });

		const snapshot = createReplicationSnapshot(serverAgent);
		receiver.applySnapshot(snapshot);

		expect(snapshot.sources).toHaveLength(1);
		expect(snapshot.sources[0]?.type).toBe(ValueSource.name);
		expect(clientAgent.getSources().size).toBe(1);
		expect(clientAgent.get(Value)).toBe(5);
	});
});
