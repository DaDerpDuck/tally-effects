import { describe, expect, it } from "vitest";
import {
	type SourceData,
	Value,
	ValueSource,
	createReplicationFixture,
	getOnlySource,
} from "../fixtures/SourceReplication.js";
import { defineSourceType, serializeSource } from "../src/index.js";

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
	it("emits added before removed when an earlier added observer destroys the live Source", () => {
		const { clientAgent, emittedEvents, serverAgent } = createReplicationFixture({
			beforeReplicationSubscribe(agent) {
				agent.onSourceAdded((source) => source.destroy());
			},
		});

		expect(serverAgent.addSource(ValueSource, { value: 5 })).toBeUndefined();
		expect(emittedEvents.map((event) => [event.target, event.event.kind])).toEqual([
			["source", "added"],
			["source", "removed"],
		]);
		expect(serverAgent.getSources().size).toBe(0);
		expect(clientAgent.getSources().size).toBe(0);
		expect(clientAgent.get(Value)).toBe(0);
	});
});
