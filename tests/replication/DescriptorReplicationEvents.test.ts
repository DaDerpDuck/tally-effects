import { describe, expect, it } from "vitest";
import {
	type DescriptorData,
	DescriptorSource,
	type SourceData,
	Value,
	ValueDescriptor,
	createReplicationFixture,
	descriptorReplication,
	expectOnlyEvent,
	getOnlyDescriptor,
} from "../fixtures/DescriptorReplication.js";
import { defineDescriptorType, serializeDescriptor } from "../src/index.js";

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
	it("emits added before removed when an earlier added observer destroys the live Descriptor", () => {
		const { clientAgent, emittedEvents, serverAgent } = createReplicationFixture({
			beforeReplicationSubscribe(agent) {
				agent.onDescriptorAdded((descriptor) => descriptor.destroy());
			},
		});

		expect(
			serverAgent.addDescriptor(ValueDescriptor, { value: 5, sourceKey: "source" })
		).toBeUndefined();
		expect(emittedEvents.map((event) => [event.target, event.event.kind])).toEqual([
			["descriptor", "added"],
			["descriptor", "removed"],
		]);
		expect(serverAgent.getDescriptors().size).toBe(0);
		expect(serverAgent.getSources(DescriptorSource).size).toBe(0);
		expect(clientAgent.getDescriptors().size).toBe(0);
		expect(clientAgent.getSources(DescriptorSource).size).toBe(0);
		expect(clientAgent.get(Value)).toBe(0);
	});
});
