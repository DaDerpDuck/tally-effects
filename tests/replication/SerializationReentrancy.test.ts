import { describe, expect, it } from "vitest";
import {
	AgentState,
	createReplicationSnapshot,
	createTestReporter,
	defineDescriptorType,
	defineSourceType,
	testReporter,
	type ReplicationEvent,
} from "../src/index.js";

describe("replication serialization reentrancy", () => {
	it("does not let Source serialization update state before its added event", () => {
		const { reporter, reports } = createTestReporter();
		const agent = new AgentState(undefined, { reporter });
		const events: ReplicationEvent[] = [];
		const SourceType = defineSourceType<number>({
			name: "ReentrantSourceSerializer",
			priority: 100,
			contribute: () => [],
			replication: {
				serialize(data) {
					if (data === 1) [...agent.getSources(SourceType)][0]?.set(2);
					return data;
				},
				deserialize: (data) => data as number,
			},
		});
		agent.onReplicationEmit((event) => events.push(event));

		const source = agent.addSource(SourceType, 1)!;

		expect(events).toEqual([]);
		expect(source.get()).toBe(1);
		expect(reports).toEqual([
			expect.objectContaining({
				code: "replication-serialization-failed",
				operation: "admit",
				event: "source-added",
				error: expect.objectContaining({
					message: expect.stringContaining("Cannot mutate AgentState"),
				}),
			}),
		]);
	});

	it("does not let Descriptor serialization update state before its added event", () => {
		const { reporter, reports } = createTestReporter();
		const agent = new AgentState(undefined, { reporter });
		const events: ReplicationEvent[] = [];
		const Output = defineSourceType<number>({
			name: "ReentrantDescriptorSerializerOutput",
			priority: 100,
			contribute: () => [],
		});
		const DescriptorType = defineDescriptorType<number, number>({
			name: "ReentrantDescriptorSerializer",
			source: Output,
			replication: {
				serialize(data) {
					if (data === 1) [...agent.getDescriptors(DescriptorType)][0]?.set(2);
					return data;
				},
				deserialize: (data) => data as number,
			},
		});
		agent.registerDescriptorHandler(DescriptorType, (context, data) => {
			const source = context.addSource(data)!;
			return {
				source,
				update: (value) => source.set(value),
				destroy: () => source.destroy(),
			};
		});
		agent.onReplicationEmit((event) => events.push(event));

		const descriptor = agent.addDescriptor(DescriptorType, 1)!;

		expect(events).toEqual([]);
		expect(descriptor.get()).toBe(1);
		expect(descriptor.getSource().get()).toBe(1);
		expect(reports).toEqual([
			expect.objectContaining({
				code: "replication-serialization-failed",
				operation: "admit",
				event: "descriptor-added",
				error: expect.objectContaining({
					message: expect.stringContaining("Cannot mutate AgentState"),
				}),
			}),
		]);
	});

	it("does not let snapshot serialization change the Source being serialized", () => {
		const agent = new AgentState(undefined, { reporter: testReporter });
		const SourceType = defineSourceType<number>({
			name: "ReentrantSnapshotSerializer",
			priority: 100,
			contribute: () => [],
			replication: {
				serialize(data) {
					if (data === 1) [...agent.getSources(SourceType)][0]?.set(2);
					return data;
				},
				deserialize: (data) => data as number,
			},
		});
		const source = agent.addSource(SourceType, 1)!;

		expect(() => createReplicationSnapshot(agent)).toThrow("Cannot mutate AgentState");
		expect(source.get()).toBe(1);
	});

	it("does not let snapshot serialization change the Descriptor being serialized", () => {
		const agent = new AgentState(undefined, { reporter: testReporter });
		const Output = defineSourceType<number>({
			name: "ReentrantDescriptorSnapshotOutput",
			priority: 100,
			contribute: () => [],
		});
		const DescriptorType = defineDescriptorType<number, number>({
			name: "ReentrantDescriptorSnapshotSerializer",
			source: Output,
			replication: {
				serialize(data) {
					if (data === 1) [...agent.getDescriptors(DescriptorType)][0]?.set(2);
					return data;
				},
				deserialize: (data) => data as number,
			},
		});
		agent.registerDescriptorHandler(DescriptorType, (context, data) => {
			const source = context.addSource(data)!;
			return {
				source,
				update: (value) => source.set(value),
				destroy: () => source.destroy(),
			};
		});
		const descriptor = agent.addDescriptor(DescriptorType, 1)!;

		expect(() => createReplicationSnapshot(agent)).toThrow("Cannot mutate AgentState");
		expect(descriptor.get()).toBe(1);
		expect(descriptor.getSource().get()).toBe(1);
	});
});
