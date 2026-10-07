import { describe, expect, it } from "vitest";
import {
	AgentState,
	DescriptorReceiver,
	SourceReceiver,
	createTestReporter,
	defineDescriptorType,
	defineSourceType,
} from "../src/index.js";

const receiveMethods = ["apply", "applySnapshot"] as const;

describe("SourceReceiver reentrancy", () => {
	for (const outer of receiveMethods) {
		for (const nested of receiveMethods) {
			it(`rejects ${nested} from an added callback during ${outer}`, () => {
				const { reporter, reports } = createTestReporter();
				const agent = new AgentState(undefined, { reporter });
				const Replicated = defineSourceType<number>({
					name: "SourceReceiverReentrancy",
					priority: 100,
					contribute: () => [],
					replication: {
						serialize: (data) => data,
						deserialize: (data) => data as number,
					},
				});
				const receiver = new SourceReceiver(agent, () => Replicated);
				const source = { id: 7, type: Replicated.name, priority: 100, data: 1 };
				const removed = { target: "source", event: { kind: "removed", id: 7 } } as const;
				const callbacks: string[] = [];

				agent.onSourceAdded(() => {
					callbacks.push("nested receive");
					if (nested === "apply") receiver.apply([removed]);
					else receiver.applySnapshot({ sources: [], descriptors: [] });
				});
				agent.onSourceAdded(() => callbacks.push("later callback"));

				if (outer === "apply")
					receiver.apply([{ target: "source", event: { kind: "added", source } }]);
				else receiver.applySnapshot({ sources: [source], descriptors: [] });

				expect(callbacks).toEqual(["nested receive", "later callback"]);
				expect(reports).toHaveLength(1);
				expect(reports[0]).toMatchObject({
					code: "callback-failed",
					event: "source-added",
					operation: "admit",
				});
				expect(reports[0]?.error).toBeInstanceOf(Error);
				expect((reports[0]?.error as Error).message).toContain(
					`SourceReceiver.${nested}()`
				);
				expect([...agent.getSources(Replicated)].map((item) => item.get())).toEqual([1]);

				receiver.apply([removed]);
				expect(agent.getSources(Replicated).size).toBe(0);
				expect(reports).toHaveLength(1);
			});
		}
	}

	for (const method of receiveMethods) {
		it(`clears the guard when ${method} throws before processing items`, () => {
			const agent = new AgentState(undefined, { reporter: createTestReporter().reporter });
			const Replicated = defineSourceType<number>({
				name: "SourceReceiverRecovery",
				priority: 100,
				contribute: () => [],
				replication: {
					serialize: (data) => data,
					deserialize: (data) => data as number,
				},
			});
			const receiver = new SourceReceiver(agent, () => Replicated);

			if (method === "apply") expect(() => receiver.apply(null as never)).toThrow();
			else
				expect(() =>
					receiver.applySnapshot({ sources: null as never, descriptors: [] })
				).toThrow();

			receiver.apply([
				{
					target: "source",
					event: {
						kind: "added",
						source: { id: 7, type: Replicated.name, priority: 100, data: 1 },
					},
				},
			]);
			expect(agent.getSources(Replicated).size).toBe(1);
		});
	}
});

describe("DescriptorReceiver reentrancy", () => {
	for (const outer of receiveMethods) {
		for (const nested of receiveMethods) {
			it(`rejects ${nested} from an added callback during ${outer}`, () => {
				const { reporter, reports } = createTestReporter();
				const agent = new AgentState(undefined, { reporter });
				const Derived = defineSourceType<number>({
					name: "DescriptorReceiverReentrancyDerived",
					priority: 100,
					contribute: () => [],
				});
				const Replicated = defineDescriptorType<number, number>({
					name: "DescriptorReceiverReentrancy",
					source: Derived,
					replication: {
						serialize: (data) => data,
						deserialize: (data) => data as number,
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
				const descriptor = { id: 7, type: Replicated.name, data: 1 };
				const removed = {
					target: "descriptor",
					event: { kind: "removed", id: 7 },
				} as const;
				const callbacks: string[] = [];

				agent.onDescriptorAdded(() => {
					callbacks.push("nested receive");
					if (nested === "apply") receiver.apply([removed]);
					else receiver.applySnapshot({ sources: [], descriptors: [] });
				});
				agent.onDescriptorAdded(() => callbacks.push("later callback"));

				if (outer === "apply")
					receiver.apply([
						{ target: "descriptor", event: { kind: "added", descriptor } },
					]);
				else receiver.applySnapshot({ sources: [], descriptors: [descriptor] });

				expect(callbacks).toEqual(["nested receive", "later callback"]);
				expect(reports).toHaveLength(1);
				expect(reports[0]).toMatchObject({
					code: "callback-failed",
					event: "descriptor-added",
					operation: "admit",
				});
				expect(reports[0]?.error).toBeInstanceOf(Error);
				expect((reports[0]?.error as Error).message).toContain(
					`DescriptorReceiver.${nested}()`
				);
				expect([...agent.getDescriptors(Replicated)].map((item) => item.get())).toEqual([
					1,
				]);
				expect([...agent.getSources(Derived)].map((item) => item.get())).toEqual([1]);

				receiver.apply([removed]);
				expect(agent.getDescriptors(Replicated).size).toBe(0);
				expect(agent.getSources(Derived).size).toBe(0);
				expect(reports).toHaveLength(1);
			});
		}
	}

	for (const method of receiveMethods) {
		it(`clears the guard when ${method} throws before processing items`, () => {
			const agent = new AgentState(undefined, { reporter: createTestReporter().reporter });
			const Derived = defineSourceType<number>({
				name: "DescriptorReceiverRecoveryDerived",
				priority: 100,
				contribute: () => [],
			});
			const Replicated = defineDescriptorType<number, number>({
				name: "DescriptorReceiverRecovery",
				source: Derived,
				replication: {
					serialize: (data) => data,
					deserialize: (data) => data as number,
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

			if (method === "apply") expect(() => receiver.apply(null as never)).toThrow();
			else
				expect(() =>
					receiver.applySnapshot({ sources: [], descriptors: null as never })
				).toThrow();

			receiver.apply([
				{
					target: "descriptor",
					event: {
						kind: "added",
						descriptor: { id: 7, type: Replicated.name, data: 1 },
					},
				},
			]);
			expect(agent.getDescriptors(Replicated).size).toBe(1);
		});
	}
});
