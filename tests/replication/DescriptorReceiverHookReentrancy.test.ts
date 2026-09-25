import { describe, expect, it } from "vitest";
import {
	AgentState,
	DescriptorReceiver,
	defineDescriptorType,
	defineSourceType,
	testReporter,
} from "../src/index.js";

const hookKinds = ["type lookup", "deserialization"] as const;
const receiveKinds = ["events", "snapshot"] as const;

describe("Descriptor receiver hook reentrancy", () => {
	for (const hook of hookKinds) {
		for (const receive of receiveKinds) {
			it(`rejects Descriptor mutation during ${hook} in ${receive} and applies independent items`, () => {
				const agent = new AgentState(undefined, { reporter: testReporter });
				const SideEffect = defineSourceType<number>({
					name: "DescriptorReceiverHookSideEffect",
					priority: 100,
					contribute: () => [],
				});
				const Derived = defineSourceType<number>({
					name: "DescriptorReceiverHookDerived",
					priority: 100,
					contribute: () => [],
				});
				const Replicated = defineDescriptorType<number, number>({
					name: "DescriptorReceiverHookReplicated",
					source: Derived,
					replication: {
						serialize: (data) => data,
						deserialize: (data) => {
							if (hook === "deserialization" && data === 1)
								agent.addSource(SideEffect, 99);
							return data as number;
						},
					},
				});
				agent.registerDescriptorHandler(Replicated, (context, data) => {
					const source = context.addSource(data)!;
					return {
						source,
						update: (value) => source.set(value),
						destroy: () => source.destroy(),
					};
				});
				const receiver = new DescriptorReceiver(agent, (name) => {
					if (hook === "type lookup" && name === "bad") agent.addSource(SideEffect, 99);
					return Replicated;
				});
				const bad = { id: 1, type: "bad", data: 1 };
				const good = { id: 2, type: "good", data: 2 };

				expect(() => {
					if (receive === "events")
						receiver.apply([
							{ target: "descriptor", event: { kind: "added", descriptor: bad } },
							{ target: "descriptor", event: { kind: "added", descriptor: good } },
						]);
					else receiver.applySnapshot({ sources: [], descriptors: [bad, good] });
				}).toThrow("Failed to apply 1 replication");
				expect(agent.getSources(SideEffect).size).toBe(0);
				const descriptors = [...agent.getDescriptors(Replicated)];
				expect(descriptors.map((descriptor) => descriptor.get())).toEqual([2]);
				expect(descriptors[0]?.getSource().get()).toBe(2);
				expect(agent.getSources(Derived).size).toBe(1);
			});
		}
	}

	it("rejects Descriptor mutation during update deserialization", () => {
		const agent = new AgentState(undefined, { reporter: testReporter });
		const Derived = defineSourceType<number>({
			name: "DescriptorReceiverUpdateDerived",
			priority: 100,
			contribute: () => [],
		});
		const Replicated = defineDescriptorType<number, number>({
			name: "DescriptorReceiverUpdateHook",
			source: Derived,
			replication: {
				serialize: (data) => data,
				deserialize: (data) => {
					if (data === 2) agent.addDescriptor(Replicated, 99);
					return data as number;
				},
			},
		});
		agent.registerDescriptorHandler(Replicated, (context, data) => {
			const source = context.addSource(data)!;
			return {
				source,
				update: (value) => source.set(value),
				destroy: () => source.destroy(),
			};
		});
		const receiver = new DescriptorReceiver(agent, () => Replicated);
		receiver.apply([
			{
				target: "descriptor",
				event: { kind: "added", descriptor: { id: 1, type: "descriptor", data: 1 } },
			},
		]);

		expect(() =>
			receiver.apply([{ target: "descriptor", event: { kind: "updated", id: 1, data: 2 } }])
		).toThrow("Failed to apply 1 replication event(s)");
		const descriptors = [...agent.getDescriptors(Replicated)];
		expect(descriptors.map((descriptor) => descriptor.get())).toEqual([1]);
		expect(descriptors[0]?.getSource().get()).toBe(1);
	});

	it("checks the gate before recursively receiving a snapshot", () => {
		const agent = new AgentState(undefined, { reporter: testReporter });
		const Derived = defineSourceType<number>({
			name: "RecursiveDescriptorReceiverDerived",
			priority: 100,
			contribute: () => [],
		});
		const Replicated = defineDescriptorType<number, number>({
			name: "RecursiveDescriptorReceiver",
			source: Derived,
			replication: { serialize: (data) => data, deserialize: (data) => data as number },
		});
		agent.registerDescriptorHandler(Replicated, (context, data) => {
			const source = context.addSource(data)!;
			return {
				source,
				update: (value) => source.set(value),
				destroy: () => source.destroy(),
			};
		});
		const receiver = new DescriptorReceiver(agent, (name) => {
			if (name === "outer") receiver.applySnapshot({ sources: [], descriptors: [] });
			return Replicated;
		});

		expect(() =>
			receiver.apply([
				{
					target: "descriptor",
					event: { kind: "added", descriptor: { id: 1, type: "outer", data: 1 } },
				},
			])
		).toThrow("Failed to apply 1 replication event(s)");
		expect(agent.getDescriptors(Replicated).size).toBe(0);
	});
});
