import { describe, expect, it } from "vitest";
import {
	AgentState,
	createReplicationSnapshot,
	defineDescriptorType,
	defineNumberProperty,
	defineSourceType,
	DescriptorReceiver,
	type DescriptorType,
	type ReplicationDefinition,
	type ReplicationEvent,
	serializeDescriptor,
	TallyContext,
} from "../src/index.js";

interface SourceData {
	readonly value: number;
}

interface DescriptorData {
	readonly value: number;
	readonly sourceKey: string;
}

const Value = defineNumberProperty({ name: "ReplicatedDescriptorValue", defaultValue: 0 });

const sourceReplication: ReplicationDefinition<SourceData> = {
	serialize: (data) => data.value,
	deserialize: (serialized) => {
		if (typeof serialized !== "number") throw new Error("Expected a numeric Source value");
		return { value: serialized };
	},
};

const descriptorReplication: ReplicationDefinition<DescriptorData> = {
	serialize: (data) => [data.value, data.sourceKey],
	deserialize: (serialized) => {
		if (
			!Array.isArray(serialized) ||
			typeof serialized[0] !== "number" ||
			typeof serialized[1] !== "string"
		)
			throw new Error("Expected serialized Descriptor data");
		return { value: serialized[0], sourceKey: serialized[1] };
	},
};

const DescriptorSource = defineSourceType<SourceData>({
	name: "ReplicatedDescriptorSource",
	priority: 100,
	contribute: (data) => [Value.add(data.value)],
	replication: sourceReplication,
});

const ValueDescriptor = defineDescriptorType<DescriptorData, SourceData>({
	name: "ReplicatedValueDescriptor",
	source: DescriptorSource,
	replication: descriptorReplication,
});

function registerHandler(
	tally: TallyContext<undefined>,
	descriptorType: DescriptorType<DescriptorData, SourceData>
) {
	tally.registerDescriptorHandler(descriptorType, (ctx, data) => {
		const source = ctx.addSource({ value: data.value }, { key: data.sourceKey });
		if (!source) return undefined;

		return {
			source,
			update(updated) {
				source.set({ value: updated.value });
			},
			destroy() {
				source.destroy();
			},
		};
	});
}

interface ReplicationFixtureOptions {
	readonly descriptorTypes?: readonly DescriptorType<DescriptorData, SourceData>[];
	readonly relayEvents?: boolean;
}

function createReplicationFixture({
	descriptorTypes = [],
	relayEvents = true,
}: ReplicationFixtureOptions = {}) {
	const allDescriptorTypes = [ValueDescriptor, ...descriptorTypes];
	const createTally = () => {
		const tally = new TallyContext<undefined>();
		tally.register(Value);
		tally.register(DescriptorSource);
		for (const descriptorType of allDescriptorTypes) {
			tally.register(descriptorType);
			registerHandler(tally, descriptorType);
		}
		return tally;
	};

	const serverTally = createTally();
	const serverAgent = serverTally.createAgentState(undefined);
	const clientTally = createTally();
	const clientAgent = clientTally.createAgentState(undefined);
	const receiver = new DescriptorReceiver(clientAgent, (name) =>
		clientTally.descriptors.get(name)
	);
	const emittedEvents: ReplicationEvent[] = [];

	serverTally.onReplicationEmit((_, event) => {
		emittedEvents.push(event);
		if (relayEvents) receiver.apply([event]);
	});

	return { clientAgent, emittedEvents, receiver, serverAgent };
}

function getOnlyDescriptor(
	agent: AgentState<undefined>,
	descriptorType: DescriptorType<DescriptorData, SourceData> = ValueDescriptor
) {
	const descriptors = [...agent.getDescriptors(descriptorType)];
	expect(descriptors).toHaveLength(1);
	return descriptors[0]!;
}

function expectOnlyEvent(events: ReplicationEvent[], expected: ReplicationEvent) {
	expect(events).toEqual([expected]);
	events.length = 0;
}

describe("Descriptor replication events", () => {
	it("replicates the full Descriptor lifecycle and derives its Source locally", () => {
		const { clientAgent, emittedEvents, serverAgent } = createReplicationFixture();
		const serverDescriptor = serverAgent.addDescriptor(
			ValueDescriptor,
			{ value: 5, sourceKey: "source:one" },
			{ key: "descriptor:one" }
		)!;

		expectOnlyEvent(emittedEvents, {
			target: "descriptor",
			event: {
				kind: "added",
				descriptor: {
					id: serverDescriptor.id,
					type: ValueDescriptor.name,
					key: "descriptor:one",
					data: [5, "source:one"],
				},
			},
		});
		const clientDescriptor = getOnlyDescriptor(clientAgent);
		expect(clientDescriptor.get()).toEqual({ value: 5, sourceKey: "source:one" });
		expect(clientDescriptor.key).toBe("descriptor:one");
		expect(clientDescriptor.provenance).toEqual({
			domain: "replicated",
			sequence: serverDescriptor.id,
		});
		expect(clientDescriptor.getSource().get()).toEqual({ value: 5 });
		expect(clientDescriptor.getSource().key).toBe("source:one");
		expect(clientDescriptor.getSource().provenance).toEqual({
			domain: "descriptor-replicated",
			sequence: serverDescriptor.id,
		});
		expect(clientAgent.get(Value)).toBe(5);

		serverDescriptor.set({ value: 8, sourceKey: "source:one" });

		expectOnlyEvent(emittedEvents, {
			target: "descriptor",
			event: {
				kind: "updated",
				id: serverDescriptor.id,
				data: [8, "source:one"],
			},
		});
		expect(clientDescriptor.get()).toEqual({ value: 8, sourceKey: "source:one" });
		expect(clientDescriptor.getSource().get()).toEqual({ value: 8 });
		expect(clientDescriptor.key).toBe("descriptor:one");
		expect(clientDescriptor.getSource().key).toBe("source:one");
		expect(clientAgent.get(Value)).toBe(8);

		serverDescriptor.destroy();

		expectOnlyEvent(emittedEvents, {
			target: "descriptor",
			event: { kind: "removed", id: serverDescriptor.id },
		});
		expect(clientAgent.getDescriptors(ValueDescriptor).size).toBe(0);
		expect(clientAgent.getSources(DescriptorSource).size).toBe(0);
		expect(clientAgent.get(Value)).toBe(0);
	});

	it("preserves distinct duplication keys during reconstruction", () => {
		const KeyedDescriptor = defineDescriptorType<DescriptorData, SourceData>({
			name: "ReplicatedKeyedDescriptor",
			source: DescriptorSource,
			duplication: { policy: "ignore" },
			replication: descriptorReplication,
		});
		const { clientAgent, serverAgent } = createReplicationFixture({
			descriptorTypes: [KeyedDescriptor],
		});

		serverAgent.addDescriptor(
			KeyedDescriptor,
			{ value: 1, sourceKey: "source:a" },
			{ key: "a" }
		);
		serverAgent.addDescriptor(
			KeyedDescriptor,
			{ value: 10, sourceKey: "source:b" },
			{ key: "b" }
		);

		expect(
			new Set(
				clientAgent
					.getDescriptors(KeyedDescriptor)
					.values()
					.map((descriptor) => descriptor.key)
			)
		).toEqual(new Set(["a", "b"]));
		expect(clientAgent.get(Value)).toBe(11);
	});

	it("does not emit events for Descriptors without replication metadata", () => {
		const LocalDescriptor = defineDescriptorType<DescriptorData, SourceData>({
			name: "LocalOnlyDescriptorEvent",
			source: DescriptorSource,
		});
		const { emittedEvents, serverAgent } = createReplicationFixture({
			descriptorTypes: [LocalDescriptor],
		});
		const descriptor = serverAgent.addDescriptor(LocalDescriptor, {
			value: 1,
			sourceKey: "local",
		})!;

		descriptor.set({ value: 2, sourceKey: "local" });
		descriptor.destroy();

		expect(emittedEvents).toEqual([]);
	});

	it("reports invalid events after applying the rest of the batch", () => {
		const LocalDescriptor = defineDescriptorType<DescriptorData, SourceData>({
			name: "LocalOnlyDescriptorReceiver",
			source: DescriptorSource,
		});
		const { clientAgent, receiver, serverAgent } = createReplicationFixture({
			descriptorTypes: [LocalDescriptor],
			relayEvents: false,
		});
		const first = serverAgent.addDescriptor(ValueDescriptor, {
			value: 1,
			sourceKey: "source:first",
		})!;
		const second = serverAgent.addDescriptor(ValueDescriptor, {
			value: 2,
			sourceKey: "source:second",
		})!;

		expect(() =>
			receiver.apply([
				{
					target: "descriptor",
					event: { kind: "added", descriptor: serializeDescriptor(first) },
				},
				{
					target: "descriptor",
					event: {
						kind: "added",
						descriptor: {
							id: 403,
							type: LocalDescriptor.name,
							key: undefined,
							data: null,
						},
					},
				},
				{
					target: "descriptor",
					event: {
						kind: "added",
						descriptor: {
							id: 404,
							type: "UnknownDescriptor",
							key: undefined,
							data: null,
						},
					},
				},
				{
					target: "descriptor",
					event: { kind: "added", descriptor: serializeDescriptor(second) },
				},
			])
		).toThrow("Failed to apply 2 replication event(s)");
		expect(clientAgent.getDescriptors(LocalDescriptor).size).toBe(0);
		expect(clientAgent.getDescriptors(ValueDescriptor).size).toBe(2);
		expect(clientAgent.getSources(DescriptorSource).size).toBe(2);
		expect(clientAgent.get(Value)).toBe(3);
	});

	it("rejects updates for Descriptors that were never reconstructed", () => {
		const { receiver } = createReplicationFixture({ relayEvents: false });

		expect(() =>
			receiver.apply([
				{ target: "descriptor", event: { kind: "updated", id: 404, data: null } },
			])
		).toThrow("Failed to apply 1 replication event(s)");
	});
});

describe("Descriptor replication snapshots", () => {
	it("reconciles additions, updates, removals, keys, and Source ownership", () => {
		const { clientAgent, receiver, serverAgent } = createReplicationFixture({
			relayEvents: false,
		});
		const first = serverAgent.addDescriptor(
			ValueDescriptor,
			{ value: 1, sourceKey: "source:first" },
			{ key: "first" }
		)!;
		const removed = serverAgent.addDescriptor(
			ValueDescriptor,
			{ value: 10, sourceKey: "source:removed" },
			{ key: "removed" }
		)!;

		const initialSnapshot = createReplicationSnapshot(serverAgent);
		expect(initialSnapshot).toEqual({
			sources: [],
			descriptors: [
				{
					id: first.id,
					type: ValueDescriptor.name,
					key: "first",
					data: [1, "source:first"],
				},
				{
					id: removed.id,
					type: ValueDescriptor.name,
					key: "removed",
					data: [10, "source:removed"],
				},
			],
		});
		receiver.applySnapshot(initialSnapshot);
		expect(clientAgent.getDescriptors(ValueDescriptor).size).toBe(2);
		expect(clientAgent.getSources(DescriptorSource).size).toBe(2);
		expect(clientAgent.get(Value)).toBe(11);

		first.set({ value: 2, sourceKey: "source:first" });
		removed.destroy();
		serverAgent.addDescriptor(
			ValueDescriptor,
			{ value: 20, sourceKey: "source:added" },
			{ key: "added" }
		);
		receiver.applySnapshot(createReplicationSnapshot(serverAgent));

		const clientDescriptors = [...clientAgent.getDescriptors(ValueDescriptor)];
		expect(clientDescriptors).toHaveLength(2);
		expect(new Set(clientDescriptors.map((descriptor) => descriptor.key))).toEqual(
			new Set(["first", "added"])
		);
		expect(new Set(clientDescriptors.map((descriptor) => descriptor.get().value))).toEqual(
			new Set([2, 20])
		);
		expect(clientAgent.getSources(DescriptorSource).size).toBe(2);
		expect(clientAgent.get(Value)).toBe(22);
	});

	it("is idempotent and preserves client-local Descriptors", () => {
		const { clientAgent, receiver, serverAgent } = createReplicationFixture({
			relayEvents: false,
		});
		const clientLocal = clientAgent.addDescriptor(
			ValueDescriptor,
			{ value: 100, sourceKey: "source:local" },
			{ key: "local" }
		)!;
		serverAgent.addDescriptor(
			ValueDescriptor,
			{ value: 5, sourceKey: "source:remote" },
			{ key: "remote" }
		);
		const snapshot = createReplicationSnapshot(serverAgent);

		receiver.applySnapshot(snapshot);
		receiver.applySnapshot(snapshot);

		expect(clientAgent.getDescriptors(ValueDescriptor)).toContain(clientLocal);
		expect(clientAgent.getDescriptors(ValueDescriptor).size).toBe(2);
		expect(clientAgent.getSources(DescriptorSource).size).toBe(2);
		expect(clientAgent.get(Value)).toBe(105);
	});

	it("excludes Descriptors without replication metadata", () => {
		const LocalDescriptor = defineDescriptorType<DescriptorData, SourceData>({
			name: "LocalOnlyDescriptorSnapshot",
			source: DescriptorSource,
		});
		const { clientAgent, receiver, serverAgent } = createReplicationFixture({
			descriptorTypes: [LocalDescriptor],
			relayEvents: false,
		});
		serverAgent.addDescriptor(LocalDescriptor, { value: 100, sourceKey: "source:local" });
		serverAgent.addDescriptor(ValueDescriptor, { value: 5, sourceKey: "source:remote" });

		const snapshot = createReplicationSnapshot(serverAgent);
		receiver.applySnapshot(snapshot);

		expect(snapshot.sources).toEqual([]);
		expect(snapshot.descriptors).toHaveLength(1);
		expect(snapshot.descriptors[0]?.type).toBe(ValueDescriptor.name);
		expect(clientAgent.getDescriptors(ValueDescriptor).size).toBe(1);
		expect(clientAgent.getDescriptors(LocalDescriptor).size).toBe(0);
		expect(clientAgent.get(Value)).toBe(5);
	});
});
