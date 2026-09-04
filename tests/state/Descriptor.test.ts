import { describe, expect, it, vi } from "vitest";
import {
	AgentState,
	createReplicationSnapshot,
	defineDescriptorType,
	defineNumberProperty,
	defineSourceType,
	DescriptorReceiver,
	DescriptorType,
	serializeDescriptor,
	TallyContext,
	type ReplicationEvent,
} from "../src/index.js";

interface DescriptorData {
	value: number;
}

const Value = defineNumberProperty({ name: "DescriptorValue", defaultValue: 0 });

const DescriptorSource = defineSourceType<DescriptorData>({
	name: "DescriptorSource",
	priority: 100,
	contribute: (data) => [Value.add(data.value)],
});

const ValueDescriptor = defineDescriptorType<DescriptorData, DescriptorData>({
	name: "ValueDescriptor",
	source: DescriptorSource,
	replication: {
		serialize: (data) => data.value,
		deserialize: (value) => {
			if (typeof value !== "number")
				throw new Error("Expected descriptor value to be a number");
			return { value };
		},
	},
});

function registerHandler(
	agent: AgentState<undefined> | TallyContext<undefined>,
	descriptorType: DescriptorType<DescriptorData, DescriptorData> = ValueDescriptor,
	onDestroy = vi.fn()
) {
	agent.registerDescriptorHandler(descriptorType, (ctx, data) => {
		const source = ctx.addSource({ value: data.value })!;

		return {
			source,
			update(data) {
				source.set(data);
			},
			destroy() {
				onDestroy();
				source.destroy();
			},
		};
	});

	return onDestroy;
}

function createAgentFixture() {
	const agent = new AgentState<undefined>(undefined);
	const bindingDestroyed = registerHandler(agent);
	return { agent, bindingDestroyed };
}

function createReplicationFixture(attachReplication = true) {
	const serverTally = new TallyContext<undefined>();
	registerHandler(serverTally);
	const serverAgent = serverTally.createAgentState(undefined);
	serverTally.register(ValueDescriptor);

	const clientTally = new TallyContext<undefined>();
	registerHandler(clientTally);
	const clientAgent = clientTally.createAgentState(undefined);
	clientTally.register(ValueDescriptor);

	const receiver = new DescriptorReceiver(clientAgent, (name) =>
		clientTally.descriptors.get(name)
	);
	if (attachReplication) serverTally.onReplicationEmit((_, event) => receiver.apply([event]));

	return { clientAgent, clientTally, receiver, serverAgent, serverTally };
}

function getOnlyDescriptor(agent: AgentState<undefined>) {
	const descriptors = [...agent.getDescriptors(ValueDescriptor)];
	expect(descriptors).toHaveLength(1);
	return descriptors[0]!;
}

describe("descriptor type", () => {
	it("references a SourceType rather than a runtime Source", () => {
		expect(ValueDescriptor.source).toBe(DescriptorSource);
	});

	it("registers descriptors by name", () => {
		const tally = new TallyContext<undefined>();
		tally.register(ValueDescriptor);

		expect(tally.descriptors.get("ValueDescriptor")).toBe(ValueDescriptor);
	});

	it("allows the same descriptor type instance to be registered repeatedly", () => {
		const tally = new TallyContext<undefined>();

		tally.register(ValueDescriptor);
		tally.register(ValueDescriptor);

		expect(tally.descriptors.size).toBe(1);
		expect(tally.descriptors.get("ValueDescriptor")).toBe(ValueDescriptor);
	});
});

describe("descriptor lifecycle", () => {
	it("requires a descriptor handler before creation", () => {
		const agent = new AgentState<undefined>(undefined);

		expect(() => agent.addDescriptor(ValueDescriptor, { value: 5 })).toThrow(
			"Attempted to add a descriptor source before a descriptor handler was assigned"
		);
	});

	it("creates a descriptor and initializes its binding", () => {
		const { agent } = createAgentFixture();

		const descriptor = agent.addDescriptor(ValueDescriptor, { value: 5 })!;

		expect(descriptor.type).toBe(ValueDescriptor);
		expect(descriptor.get()).toEqual({ value: 5 });
		expect(descriptor.getSource().type).toBe(DescriptorSource);
		expect(descriptor.getSource().get()).toEqual({ value: 5 });
		expect(agent.get(Value)).toBe(5);
		expect(agent.getDescriptors(ValueDescriptor)).toEqual(new Set([descriptor]));
	});

	it("updates descriptor data and its binding", () => {
		const { agent } = createAgentFixture();
		const descriptor = agent.addDescriptor(ValueDescriptor, { value: 5 })!;
		const updated = vi.fn();
		descriptor.onUpdate(updated);

		descriptor.set({ value: 8 });

		expect(descriptor.get()).toEqual({ value: 8 });
		expect(descriptor.getSource().get()).toEqual({ value: 8 });
		expect(agent.get(Value)).toBe(8);
		expect(updated).toHaveBeenCalledTimes(1);
		expect(updated).toHaveBeenCalledWith(descriptor);
	});

	it("uses Object.is as the default descriptor data equality", () => {
		const { agent } = createAgentFixture();
		const initial = { value: 5 };
		const descriptor = agent.addDescriptor(ValueDescriptor, initial)!;
		const updated = vi.fn();
		descriptor.onUpdate(updated);

		descriptor.set(initial);
		expect(updated).not.toHaveBeenCalled();

		descriptor.set({ value: 5 });
		expect(updated).toHaveBeenCalledTimes(1);
	});

	it("uses custom descriptor data equality to suppress binding updates", () => {
		const EquivalentDescriptor = defineDescriptorType<DescriptorData, DescriptorData>({
			name: "EquivalentDescriptor",
			source: DescriptorSource,
			dataEquals: (a, b) => a.value === b.value,
		});
		const agent = new AgentState<undefined>(undefined);
		registerHandler(agent, EquivalentDescriptor);
		const descriptor = agent.addDescriptor(EquivalentDescriptor, { value: 5 })!;
		const descriptorUpdated = vi.fn();
		const sourceUpdated = vi.fn();
		descriptor.onUpdate(descriptorUpdated);
		descriptor.getSource().onUpdate(sourceUpdated);

		descriptor.set({ value: 5 });
		expect(descriptorUpdated).not.toHaveBeenCalled();
		expect(sourceUpdated).not.toHaveBeenCalled();

		descriptor.set({ value: 8 });
		expect(descriptorUpdated).toHaveBeenCalledTimes(1);
		expect(sourceUpdated).toHaveBeenCalledTimes(1);
	});

	it("disconnects descriptor update observers", () => {
		const { agent } = createAgentFixture();
		const descriptor = agent.addDescriptor(ValueDescriptor, { value: 1 })!;
		const updated = vi.fn();
		const disconnect = descriptor.onUpdate(updated);

		descriptor.set({ value: 2 });
		disconnect();
		disconnect();
		descriptor.set({ value: 3 });

		expect(updated).toHaveBeenCalledTimes(1);
	});

	it("destroys its binding and removes itself from the agent", () => {
		const { agent, bindingDestroyed } = createAgentFixture();
		const descriptor = agent.addDescriptor(ValueDescriptor, { value: 5 })!;
		const destroyed = vi.fn();
		descriptor.onDestroy(destroyed);

		descriptor.destroy();

		expect(bindingDestroyed).toHaveBeenCalledTimes(1);
		expect(destroyed).toHaveBeenCalledTimes(1);
		expect(destroyed).toHaveBeenCalledWith(descriptor);
		expect(agent.getDescriptors(ValueDescriptor).size).toBe(0);
		expect(agent.getSources(DescriptorSource).size).toBe(0);
		expect(agent.get(Value)).toBe(0);
	});

	it("destroys a descriptor binding only once", () => {
		const { agent, bindingDestroyed } = createAgentFixture();
		const descriptor = agent.addDescriptor(ValueDescriptor, { value: 5 })!;

		descriptor.destroy();
		descriptor.destroy();

		expect(bindingDestroyed).toHaveBeenCalledTimes(1);
		expect(agent.getDescriptors(ValueDescriptor).size).toBe(0);
	});

	it("throws when mutating a destroyed descriptor", () => {
		const { agent } = createAgentFixture();
		const descriptor = agent.addDescriptor(ValueDescriptor, { value: 5 })!;
		descriptor.destroy();

		expect(() => descriptor.set({ value: 8 })).toThrow();
		expect(descriptor.get()).toEqual({ value: 5 });
	});

	it("allows inert descriptor callbacks after destruction", () => {
		const { agent } = createAgentFixture();
		const descriptor = agent.addDescriptor(ValueDescriptor, { value: 5 })!;
		descriptor.destroy();

		const updated = vi.fn();
		const destroyed = vi.fn();
		const disconnectUpdate = descriptor.onUpdate(updated);
		const disconnectDestroy = descriptor.onDestroy(destroyed);

		expect(() => descriptor.destroy()).not.toThrow();
		expect(updated).not.toHaveBeenCalled();
		expect(destroyed).not.toHaveBeenCalled();
		expect(() => disconnectUpdate()).not.toThrow();
		expect(() => disconnectDestroy()).not.toThrow();
	});

	it("rejects descriptor mutations on a destroyed AgentState while keeping callbacks safe", () => {
		const { agent } = createAgentFixture();
		agent.destroy();

		expect(agent.getDescriptors()).toEqual(new Set());
		const added = vi.fn();
		const disconnectAdded = agent.onDescriptorAdded(added);

		expect(() => agent.addDescriptor(ValueDescriptor, { value: 5 })).toThrow();
		expect(() => registerHandler(agent)).toThrow();
		expect(added).not.toHaveBeenCalled();
		expect(() => disconnectAdded()).not.toThrow();
	});

	it("keeps multiple descriptors of the same type independent", () => {
		const { agent } = createAgentFixture();
		const first = agent.addDescriptor(ValueDescriptor, { value: 1 })!;
		const second = agent.addDescriptor(ValueDescriptor, { value: 10 })!;

		expect(agent.getDescriptors(ValueDescriptor).size).toBe(2);
		expect(agent.get(Value)).toBe(11);

		first.set({ value: 2 });

		expect(first.get()).toEqual({ value: 2 });
		expect(second.get()).toEqual({ value: 10 });
		expect(agent.get(Value)).toBe(12);
	});

	it("filters descriptors by type", () => {
		const { agent } = createAgentFixture();
		const OtherDescriptor = defineDescriptorType<DescriptorData, DescriptorData>({
			name: "OtherDescriptor",
			source: DescriptorSource,
			replication: ValueDescriptor.replication,
		});
		registerHandler(agent, OtherDescriptor);

		const first = agent.addDescriptor(ValueDescriptor, { value: 1 })!;
		const second = agent.addDescriptor(OtherDescriptor, { value: 2 })!;

		expect(agent.getDescriptors(ValueDescriptor)).toEqual(new Set([first]));
		expect(agent.getDescriptors(OtherDescriptor)).toEqual(new Set([second]));
		expect(agent.getDescriptors()).toEqual(new Set([first, second]));
	});

	it("destroys every descriptor binding when all descriptors are destroyed", () => {
		const agent = new AgentState<undefined>(undefined);
		const bindingDestroyed = registerHandler(agent);
		agent.addDescriptor(ValueDescriptor, { value: 1 });
		agent.addDescriptor(ValueDescriptor, { value: 2 });

		agent.destroyAllDescriptors();

		expect(bindingDestroyed).toHaveBeenCalledTimes(2);
		expect(agent.getDescriptors().size).toBe(0);
		expect(agent.getSources(DescriptorSource).size).toBe(0);
		expect(agent.get(Value)).toBe(0);
	});
});

describe("descriptor replication", () => {
	it("replicates descriptor addition", () => {
		const { clientAgent, serverAgent } = createReplicationFixture();

		serverAgent.addDescriptor(ValueDescriptor, { value: 5 });

		const clientDescriptor = getOnlyDescriptor(clientAgent);
		expect(clientDescriptor.get()).toEqual({ value: 5 });
		expect(clientDescriptor.getSource().get()).toEqual({ value: 5 });
		expect(clientAgent.get(Value)).toBe(5);
	});

	it("replicates descriptor updates using the latest descriptor data", () => {
		const { clientAgent, serverAgent } = createReplicationFixture();
		const serverDescriptor = serverAgent.addDescriptor(ValueDescriptor, { value: 5 })!;

		serverDescriptor.set({ value: 8 });

		const clientDescriptor = getOnlyDescriptor(clientAgent);
		expect(clientDescriptor.get()).toEqual({ value: 8 });
		expect(clientDescriptor.getSource().get()).toEqual({ value: 8 });
		expect(clientAgent.get(Value)).toBe(8);
	});

	it("replicates descriptor removal", () => {
		const { clientAgent, serverAgent } = createReplicationFixture();
		const serverDescriptor = serverAgent.addDescriptor(ValueDescriptor, { value: 5 })!;
		expect(clientAgent.getDescriptors(ValueDescriptor).size).toBe(1);

		serverDescriptor.destroy();

		expect(clientAgent.getDescriptors(ValueDescriptor).size).toBe(0);
		expect(clientAgent.getSources(DescriptorSource).size).toBe(0);
		expect(clientAgent.get(Value)).toBe(0);
	});

	it("does not emit events for descriptors without replication", () => {
		const LocalDescriptor = defineDescriptorType<DescriptorData, DescriptorData>({
			name: "LocalOnlyDescriptorEvent",
			source: DescriptorSource,
		});
		const tally = new TallyContext<undefined>();
		registerHandler(tally, LocalDescriptor);
		const agent = tally.createAgentState(undefined);
		const events: ReplicationEvent[] = [];
		tally.onReplicationEmit((_, event) => events.push(event));

		const descriptor = agent.addDescriptor(LocalDescriptor, { value: 1 })!;
		descriptor.set({ value: 2 });
		descriptor.destroy();

		expect(events).toEqual([]);
	});

	it("excludes descriptors without replication from snapshots", () => {
		const LocalDescriptor = defineDescriptorType<DescriptorData, DescriptorData>({
			name: "LocalOnlyDescriptorSnapshot",
			source: DescriptorSource,
		});
		const agent = new AgentState<undefined>(undefined);
		registerHandler(agent, LocalDescriptor);
		registerHandler(agent, ValueDescriptor);
		agent.addDescriptor(LocalDescriptor, { value: 100 });
		const replicated = agent.addDescriptor(ValueDescriptor, { value: 5 })!;

		const snapshot = createReplicationSnapshot(agent);

		expect(snapshot.descriptors).toEqual([
			{ id: replicated.id, type: ValueDescriptor.name, data: 5 },
		]);
	});

	it("rejects incoming replication for a descriptor without replication metadata", () => {
		const LocalDescriptor = defineDescriptorType<DescriptorData, DescriptorData>({
			name: "LocalOnlyDescriptorReceiver",
			source: DescriptorSource,
		});
		const agent = new AgentState<undefined>(undefined);
		registerHandler(agent, LocalDescriptor);
		const receiver = new DescriptorReceiver(agent, (name) =>
			name === LocalDescriptor.name ? LocalDescriptor : undefined
		);

		expect(() =>
			receiver.apply([
				{
					target: "descriptor",
					event: {
						kind: "added",
						descriptor: { id: 10, type: LocalDescriptor.name, key: undefined, data: 1 },
					},
				},
			])
		).toThrow("Failed to apply 1 replication event(s)");
		expect(agent.getDescriptors(LocalDescriptor).size).toBe(0);
	});

	it("throws when updating a descriptor that was never reconstructed", () => {
		const { receiver } = createReplicationFixture(false);

		expect(() =>
			receiver.apply([
				{ target: "descriptor", event: { kind: "updated", id: 404, data: null } },
			])
		).toThrow("Failed to apply 1 replication event(s)");
	});

	it("reconciles descriptor snapshots", () => {
		const { clientAgent, receiver, serverAgent } = createReplicationFixture(false);
		const first = serverAgent.addDescriptor(ValueDescriptor, { value: 1 })!;
		const second = serverAgent.addDescriptor(ValueDescriptor, { value: 10 })!;

		receiver.applySnapshot(createReplicationSnapshot(serverAgent));
		expect(clientAgent.getDescriptors(ValueDescriptor).size).toBe(2);
		expect(clientAgent.get(Value)).toBe(11);

		first.set({ value: 2 });
		second.destroy();
		receiver.applySnapshot(createReplicationSnapshot(serverAgent));

		expect(clientAgent.getDescriptors(ValueDescriptor).size).toBe(1);
		expect(getOnlyDescriptor(clientAgent).get()).toEqual({ value: 2 });
		expect(clientAgent.get(Value)).toBe(2);
	});

	it("is idempotent when the same descriptor snapshot is applied repeatedly", () => {
		const { clientAgent, receiver, serverAgent } = createReplicationFixture(false);
		serverAgent.addDescriptor(ValueDescriptor, { value: 5 });
		const snapshot = createReplicationSnapshot(serverAgent);

		receiver.applySnapshot(snapshot);
		receiver.applySnapshot(snapshot);

		expect(clientAgent.getDescriptors(ValueDescriptor).size).toBe(1);
		expect(clientAgent.getSources(DescriptorSource).size).toBe(1);
		expect(clientAgent.get(Value)).toBe(5);
	});

	it("preserves client-local descriptors during snapshot reconciliation", () => {
		const { clientAgent, receiver, serverAgent } = createReplicationFixture(false);
		const localDescriptor = clientAgent.addDescriptor(ValueDescriptor, { value: 100 })!;
		serverAgent.addDescriptor(ValueDescriptor, { value: 5 });

		receiver.applySnapshot(createReplicationSnapshot(serverAgent));

		expect(clientAgent.getDescriptors(ValueDescriptor)).toContain(localDescriptor);
		expect(clientAgent.getDescriptors(ValueDescriptor).size).toBe(2);
		expect(clientAgent.get(Value)).toBe(105);
	});

	it("continues applying valid events when one descriptor type is unknown", () => {
		const { clientAgent, receiver, serverAgent } = createReplicationFixture(false);
		const serverDescriptor = serverAgent.addDescriptor(ValueDescriptor, { value: 5 })!;

		const events: ReplicationEvent[] = [
			{
				target: "descriptor",
				event: { kind: "added", descriptor: serializeDescriptor(serverDescriptor) },
			},
			{
				target: "descriptor",
				event: {
					kind: "added",
					descriptor: { id: 999, type: "UnknownDescriptor", key: undefined, data: 10 },
				},
			},
		];

		expect(() => receiver.apply(events)).toThrow("Failed to apply 1 replication event(s)");
		expect(clientAgent.getDescriptors(ValueDescriptor).size).toBe(1);
		expect(clientAgent.get(Value)).toBe(5);
	});
});

describe("descriptor replication ownership", () => {
	const ReplicatedDescriptorSource = defineSourceType<DescriptorData>({
		name: "ReplicatedDescriptorSource",
		priority: 100,
		contribute: (data) => [Value.add(data.value)],
		replication: {
			serialize: (data) => data.value,
			deserialize: (value) => {
				if (typeof value !== "number")
					throw new Error("Expected source value to be a number");
				return { value };
			},
		},
	});

	const ReplicatedSourceDescriptor = new DescriptorType<DescriptorData, DescriptorData>({
		name: "ReplicatedSourceDescriptor",
		source: ReplicatedDescriptorSource,
		replication: ValueDescriptor.replication,
	});

	it("replicates a descriptor-owned Source through the descriptor only", () => {
		const tally = new TallyContext<undefined>();
		const agent = tally.createAgentState(undefined);
		registerHandler(agent, ReplicatedSourceDescriptor);
		const events: ReplicationEvent[] = [];
		tally.onReplicationEmit((_, event) => events.push(event));

		agent.addDescriptor(ReplicatedSourceDescriptor, { value: 5 });

		expect(events.map((event) => event.target)).toEqual(["descriptor"]);
	});

	it("excludes descriptor-owned Sources from the direct Source snapshot namespace", () => {
		const agent = new AgentState<undefined>(undefined);
		registerHandler(agent, ReplicatedSourceDescriptor);
		agent.addDescriptor(ReplicatedSourceDescriptor, { value: 5 });

		const snapshot = createReplicationSnapshot(agent);

		expect(snapshot.descriptors).toHaveLength(1);
		expect(snapshot.sources).toHaveLength(0);
	});
});
