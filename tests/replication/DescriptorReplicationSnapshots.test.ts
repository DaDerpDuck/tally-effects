import { describe, expect, it } from "vitest";
import {
	type DescriptorData,
	DescriptorSource,
	type SourceData,
	Value,
	ValueDescriptor,
	createReplicationFixture,
} from "../fixtures/DescriptorReplication.js";
import { createReplicationSnapshot, defineDescriptorType } from "../src/index.js";

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
