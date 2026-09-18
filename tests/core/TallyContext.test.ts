import { describe, expect, it, vi } from "vitest";
import {
	AgentState,
	BooleanProperty,
	defineBooleanProperty,
	defineDescriptorType,
	defineNumberProperty,
	defineSourceType,
	createTestReporter,
	NumberProperty,
	type ReplicationEvent,
	TallyContext,
	testReporter,
} from "../src/index.js";

interface PoisonData {
	intensity: number;
}

const PoisonSource = defineSourceType<PoisonData>({
	name: "Poison",
	priority: 100,
	contribute: () => [],
	duplication: { policy: "ignore" },
});

function createContextFixture(reporter = testReporter) {
	const tally = new TallyContext({ reporter });
	const agent = tally.createAgentState(undefined);
	return { agent, tally };
}

describe("tally context source events", () => {
	it("forwards replication events emitted by its agents", () => {
		const ReplicatedSource = defineSourceType<number>({
			name: "ContextForwardedReplicationSource",
			priority: 100,
			contribute: () => [],
			replication: {
				serialize: (value) => value,
				deserialize: (value) => value as number,
			},
		});
		const { agent, tally } = createContextFixture();
		const callback = vi.fn();
		tally.onReplicationEmit(callback);

		agent.addSource(ReplicatedSource, 5);

		expect(callback).toHaveBeenCalledExactlyOnceWith(agent, {
			target: "source",
			event: {
				kind: "added",
				source: {
					id: 0,
					type: ReplicatedSource.name,
					priority: 100,
					key: undefined,
					data: 5,
				},
			},
		});
	});

	it("forwards source additions", () => {
		const { agent, tally } = createContextFixture();
		const callback = vi.fn();
		tally.onSourceAdded(callback);

		const first = agent.addSource(PoisonSource, { intensity: 5 });
		agent.addSource(PoisonSource, { intensity: 10 });
		first!.destroy();
		const second = agent.addSource(PoisonSource, { intensity: 5 });

		expect(callback).toHaveBeenCalledTimes(2);
		expect(callback).toHaveBeenNthCalledWith(1, agent, first);
		expect(callback).toHaveBeenNthCalledWith(2, agent, second);
	});

	it("reports source observer failures after notifying later context observers", () => {
		const { reporter, reports } = createTestReporter();
		const { agent, tally } = createContextFixture(reporter);
		const laterObserver = vi.fn();
		tally.onSourceAdded(() => {
			throw new Error("context source observer failed");
		});
		tally.onSourceAdded(laterObserver);

		expect(() => agent.addSource(PoisonSource, { intensity: 5 })).not.toThrow();
		expect(laterObserver).toHaveBeenCalledTimes(1);
		expect(agent.getSources(PoisonSource).size).toBe(1);
		expect(reports).toHaveLength(1);
		expect(reports[0]?.error).toEqual(new Error("context source observer failed"));
	});

	it("forwards source removals", () => {
		const { agent, tally } = createContextFixture();
		const callback = vi.fn();
		tally.onSourceRemoved(callback);

		const source = agent.addSource(PoisonSource, { intensity: 5 })!;
		agent.addSource(PoisonSource, { intensity: 10 });
		expect(callback).not.toHaveBeenCalled();

		source.destroy();
		agent.addSource(PoisonSource, { intensity: 5 });

		expect(callback).toHaveBeenCalledTimes(1);
		expect(callback).toHaveBeenCalledWith(agent, source);
	});

	it("forwards source updates", () => {
		const { agent, tally } = createContextFixture();
		const callback = vi.fn();
		tally.onSourceUpdated(callback);

		const first = agent.addSource(PoisonSource, { intensity: 5 })!;
		first.set({ intensity: 15 });
		agent.addSource(PoisonSource, { intensity: 10 });
		first.destroy();

		const second = agent.addSource(PoisonSource, { intensity: 5 })!;
		second.set({ intensity: 10 });

		expect(callback).toHaveBeenCalledTimes(2);
		expect(callback).toHaveBeenNthCalledWith(1, agent, first);
		expect(callback).toHaveBeenNthCalledWith(2, agent, second);
	});

	it("stops forwarding source events after destruction", () => {
		const { agent, tally } = createContextFixture();
		const added = vi.fn();
		const updated = vi.fn();
		const removed = vi.fn();

		tally.onSourceAdded(added);
		tally.onSourceUpdated(updated);
		tally.onSourceRemoved(removed);
		tally.destroy();

		const SourceType = defineSourceType<number>({
			name: "AfterDestroySource",
			priority: 100,
			contribute: () => [],
		});
		const source = agent.addSource(SourceType, 1)!;
		source.set(2);
		source.destroy();

		expect(added).not.toHaveBeenCalled();
		expect(updated).not.toHaveBeenCalled();
		expect(removed).not.toHaveBeenCalled();
	});
});

describe("tally context descriptor events", () => {
	it("forwards descriptor additions only to added observers", () => {
		const Output = defineSourceType<number>({
			name: "ContextDescriptorAdditionOutput",
			priority: 100,
			contribute: () => [],
		});
		const DescriptorType = defineDescriptorType<number, number>({
			name: "ContextDescriptorAddition",
			source: Output,
		});
		const tally = new TallyContext<undefined>({ reporter: testReporter });
		tally.registerDescriptorHandler(DescriptorType, (context, value) => {
			const source = context.addSource(value)!;
			return { source, update: (next) => source.set(next), destroy: () => source.destroy() };
		});
		const agent = tally.createAgentState(undefined);
		const added = vi.fn();
		const removed = vi.fn();
		tally.onDescriptorAdded(added);
		tally.onDescriptorRemoved(removed);

		const descriptor = agent.addDescriptor(DescriptorType, 1)!;

		expect(added).toHaveBeenCalledExactlyOnceWith(agent, descriptor);
		expect(removed).not.toHaveBeenCalled();
	});

	it("stops forwarding descriptor events after destruction", () => {
		const SourceType = defineSourceType<number>({
			name: "AfterDestroyDescriptorSource",
			priority: 100,
			contribute: () => [],
		});
		const DescriptorType = defineDescriptorType<number, number>({
			name: "AfterDestroyDescriptor",
			source: SourceType,
		});
		const tally = new TallyContext<undefined>({ reporter: testReporter });
		tally.registerDescriptorHandler(DescriptorType, (ctx, data) => {
			const source = ctx.addSource(data)!;
			return {
				source,
				update(next) {
					source.set(next);
				},
				destroy() {
					source.destroy();
				},
			};
		});
		const agent = tally.createAgentState(undefined);
		const added = vi.fn();
		const updated = vi.fn();
		const removed = vi.fn();
		tally.onDescriptorAdded(added);
		tally.onDescriptorUpdated(updated);
		tally.onDescriptorRemoved(removed);

		tally.destroy();
		const descriptor = agent.addDescriptor(DescriptorType, 1)!;
		descriptor.set(2);
		descriptor.destroy();

		expect(added).not.toHaveBeenCalled();
		expect(updated).not.toHaveBeenCalled();
		expect(removed).not.toHaveBeenCalled();
	});
});

describe("tally context lifecycle", () => {
	it("rejects mutations after destruction while keeping reads and callbacks safe", () => {
		const SourceType = defineSourceType<number>({
			name: "DestroyedContextSource",
			priority: 100,
			contribute: () => [],
		});
		const DescriptorType = defineDescriptorType<number, number>({
			name: "DestroyedContextDescriptor",
			source: SourceType,
		});
		const tally = new TallyContext<undefined>({ reporter: testReporter });
		tally.destroy();

		expect(tally.sources).toEqual(new Map());
		expect(tally.properties).toEqual(new Map());
		expect(tally.descriptors).toEqual(new Map());

		const sourceAdded = vi.fn();
		const descriptorAdded = vi.fn();
		const replication = vi.fn();
		const disconnectSource = tally.onSourceAdded(sourceAdded);
		const disconnectDescriptor = tally.onDescriptorAdded(descriptorAdded);
		const disconnectReplication = tally.onReplicationEmit(replication);

		expect(() => tally.createAgentState(undefined)).toThrow();
		expect(() => tally.register(SourceType)).toThrow();
		expect(() => tally.registerDescriptorHandler(DescriptorType, () => undefined)).toThrow();
		expect(() => tally.destroy()).not.toThrow();
		expect(sourceAdded).not.toHaveBeenCalled();
		expect(descriptorAdded).not.toHaveBeenCalled();
		expect(replication).not.toHaveBeenCalled();
		expect(() => disconnectSource()).not.toThrow();
		expect(() => disconnectDescriptor()).not.toThrow();
		expect(() => disconnectReplication()).not.toThrow();
	});
});

describe("tally context registry", () => {
	it("registers properties by name", () => {
		const tally = new TallyContext({ reporter: testReporter });
		const booleanProperty = tally.register(
			defineBooleanProperty({ name: "Boolean", defaultValue: false })
		);
		const numberProperty = tally.register(
			defineNumberProperty({ name: "Number", defaultValue: 0 })
		);

		expect(tally.properties).toEqual(
			new Map<string, BooleanProperty | NumberProperty>([
				["Boolean", booleanProperty],
				["Number", numberProperty],
			])
		);
		expect(tally.properties.get("Nonexistent")).toBeUndefined();
	});

	it("registers source types by name", () => {
		const tally = new TallyContext({ reporter: testReporter });
		const first = tally.register(
			defineSourceType({
				name: "Source1",
				priority: 100,
				contribute: () => [],
			})
		);
		const second = tally.register(
			defineSourceType({
				name: "Source2",
				priority: 100,
				contribute: () => [],
			})
		);

		expect(tally.sources).toEqual(
			new Map([
				["Source1", first],
				["Source2", second],
			])
		);
		expect(tally.sources.get("Nonexistent")).toBeUndefined();
	});

	it("allows the same property instance to be registered repeatedly", () => {
		const tally = new TallyContext({ reporter: testReporter });
		const property = defineBooleanProperty({ name: "Boolean", defaultValue: false });

		tally.register(property);
		tally.register(property);

		expect(tally.properties).toEqual(new Map([["Boolean", property]]));
	});

	it("rejects a different property with the same name", () => {
		const tally = new TallyContext({ reporter: testReporter });
		tally.register(defineBooleanProperty({ name: "Boolean", defaultValue: false }));

		expect(() =>
			tally.register(defineBooleanProperty({ name: "Boolean", defaultValue: false }))
		).toThrow("Duplicate property name: Boolean");
	});

	it("allows the same source type instance to be registered repeatedly", () => {
		const tally = new TallyContext({ reporter: testReporter });
		const sourceType = defineSourceType({
			name: "Source1",
			priority: 100,
			contribute: () => [],
		});

		tally.register(sourceType);
		tally.register(sourceType);

		expect(tally.sources).toEqual(new Map([["Source1", sourceType]]));
	});

	it("rejects a different source type with the same name", () => {
		const tally = new TallyContext({ reporter: testReporter });
		tally.register(
			defineSourceType({
				name: "Source1",
				priority: 100,
				contribute: () => [],
			})
		);

		expect(() =>
			tally.register(
				defineSourceType({
					name: "Source1",
					priority: 100,
					contribute: () => [],
				})
			)
		).toThrow("Duplicate source name: Source1");
	});
});

describe("agent state replication emission", () => {
	const Property = defineNumberProperty({ name: "Property", defaultValue: 0 });
	const PropertySource = defineSourceType<{ value: number }>({
		name: "PropertySource",
		priority: 100,
		contribute: (data) => [Property.add(data.value)],
		replication: {
			serialize: (data) => data.value,
			deserialize: (value: number) => ({ value }),
		},
		dataEquals(a, b) {
			return Object.is(a.value, b.value);
		},
	});

	function createReplicationFixture() {
		const agent = new AgentState(undefined, { reporter: testReporter });
		const callback = vi.fn<(event: ReplicationEvent) => void>();
		agent.onReplicationEmit(callback);
		return { agent, callback };
	}

	function emittedEvents(callback: ReturnType<typeof createReplicationFixture>["callback"]) {
		return callback.mock.calls.map(([event]) => event);
	}

	it("emits added events with serialized source state", () => {
		const { agent, callback } = createReplicationFixture();

		agent.addSource(PropertySource, { value: 5 }, { priority: 100 });
		agent.addSource(PropertySource, { value: 6 }, { priority: 200 });
		agent.addSource(PropertySource, { value: 7 }, { priority: 300 });

		expect(emittedEvents(callback)).toEqual([
			{
				target: "source",
				event: {
					kind: "added",
					source: {
						id: 0,
						type: "PropertySource",
						priority: 100,
						key: undefined,
						data: 5,
					},
				},
			},
			{
				target: "source",
				event: {
					kind: "added",
					source: {
						id: 1,
						type: "PropertySource",
						priority: 200,
						key: undefined,
						data: 6,
					},
				},
			},
			{
				target: "source",
				event: {
					kind: "added",
					source: {
						id: 2,
						type: "PropertySource",
						priority: 300,
						key: undefined,
						data: 7,
					},
				},
			},
		] satisfies ReplicationEvent[]);
	});

	it("emits removed events with source ids", () => {
		const { agent, callback } = createReplicationFixture();
		const first = agent.addSource(PropertySource, { value: 5 })!;
		const second = agent.addSource(PropertySource, { value: 5 })!;
		const third = agent.addSource(PropertySource, { value: 5 })!;

		callback.mockClear();
		third.destroy();
		first.destroy();
		second.destroy();
		second.destroy();

		expect(emittedEvents(callback)).toEqual([
			{ target: "source", event: { kind: "removed", id: 2 } },
			{ target: "source", event: { kind: "removed", id: 0 } },
			{ target: "source", event: { kind: "removed", id: 1 } },
		] satisfies ReplicationEvent[]);
	});

	it("emits updated events with serialized data", () => {
		const { agent, callback } = createReplicationFixture();
		const first = agent.addSource(PropertySource, { value: 5 })!;
		const second = agent.addSource(PropertySource, { value: 5 })!;
		const third = agent.addSource(PropertySource, { value: 5 })!;

		callback.mockClear();
		third.set({ value: 8 });
		first.set({ value: 8 });
		second.set({ value: 8 });
		// Should not emit due to equality check
		second.set({ value: 8 });

		expect(emittedEvents(callback)).toEqual([
			{ target: "source", event: { kind: "updated", id: 2, data: 8 } },
			{ target: "source", event: { kind: "updated", id: 0, data: 8 } },
			{ target: "source", event: { kind: "updated", id: 1, data: 8 } },
		] satisfies ReplicationEvent[]);
	});

	it("reports replication serialization failures through the agent reporter", () => {
		const { reporter, reports } = createTestReporter();
		const agent = new AgentState(undefined, { reporter });
		const ThrowingReplicationSource = defineSourceType<number>({
			name: "ThrowingReplicationSerialization",
			priority: 100,
			contribute: () => [],
			replication: {
				serialize() {
					throw new Error("serialization failed");
				},
				deserialize: (value) => value as number,
			},
		});

		agent.onReplicationEmit(() => {});
		expect(() => agent.addSource(ThrowingReplicationSource, 1)).not.toThrow();
		expect(agent.getSources(ThrowingReplicationSource).size).toBe(1);
		expect(reports).toEqual([
			expect.objectContaining({
				error: new Error("serialization failed"),
				code: "replication-serialization-failed",
				operation: "admit",
				event: "source-added",
			}),
		]);
	});

	it("does not emit events for source types without replication", () => {
		const { agent, callback } = createReplicationFixture();
		const LocalOnlySource = defineSourceType<number>({
			name: "LocalOnlySource",
			priority: 100,
			contribute: () => [],
		});

		const source = agent.addSource(LocalOnlySource, 1)!;
		source.set(2);
		source.destroy();

		expect(callback).not.toHaveBeenCalled();
	});

	it("preserves source identity across lifecycle events", () => {
		const { agent, callback } = createReplicationFixture();
		const source = agent.addSource(PropertySource, { value: 1 }, { priority: 50 })!;
		source.set({ value: 2 });
		source.destroy();

		expect(emittedEvents(callback).map((event) => event.target)).toEqual([
			"source",
			"source",
			"source",
		]);
		expect(
			emittedEvents(callback)
				.filter((event) => event.target === "source")
				.map((event) => event.event.kind)
		).toEqual(["added", "updated", "removed"]);
		expect(
			emittedEvents(callback)
				.filter((event) => event.target === "source")
				.map((event) =>
					event.event.kind === "added" ? event.event.source.id : event.event.id
				)
		).toEqual([0, 0, 0]);
	});
});
