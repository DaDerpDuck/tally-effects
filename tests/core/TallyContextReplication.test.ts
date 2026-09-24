import { describe, expect, it, vi } from "vitest";
import {
	AgentState,
	defineNumberProperty,
	defineSourceType,
	createTestReporter,
	type ReplicationEvent,
	testReporter,
} from "../src/index.js";

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
