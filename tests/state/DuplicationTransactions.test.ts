import { describe, expect, it } from "vitest";
import {
	AgentState,
	defineDescriptorType,
	defineNumberProperty,
	defineSourceType,
	DuplicationGroup,
	type Source,
} from "../src/index.js";

describe("duplication admission transactions", () => {
	it("preserves a group's stack limit when an eviction callback reenters admission", () => {
		const group = new DuplicationGroup({
			policy: "replace",
			maxStack: 1,
			selector: "oldest",
		});
		const SourceType = defineSourceType<number>({
			name: "ReentrantGroupedReplacementSource",
			priority: 100,
			duplication: group.member(),
			contribute: () => [],
		});
		const agent = new AgentState(undefined);
		const first = agent.addSource(SourceType, 1)!;
		first.onDestroy(() => agent.addSource(SourceType, 2));

		agent.addSource(SourceType, 3);

		expect(agent.getSources(SourceType).size).toBe(1);
	});

	it("lets the newer grouped admission replace a candidate still being published", () => {
		const group = new DuplicationGroup({
			policy: "replace",
			maxStack: 1,
			selector: "oldest",
		});
		let reentered = false;
		const agent = new AgentState<undefined>(undefined);
		const SourceType = defineSourceType<number>({
			name: "ReentrantGroupedPublishSource",
			priority: 100,
			duplication: group.member(),
			contribute: (value) => {
				if (!reentered) {
					reentered = true;
					agent.addSource(SourceType, 2);
				}
				return [];
			},
		});

		agent.addSource(SourceType, 1);

		expect([...agent.getSources(SourceType)].map((source) => source.get())).toEqual([2]);
	});

	it("removes a failed Source reservation so admission can be retried", () => {
		let shouldThrow = true;
		const SourceType = defineSourceType<number>({
			name: "FailedSourceAdmission",
			priority: 100,
			duplication: { policy: "ignore" },
			contribute: () => {
				if (shouldThrow) throw new Error("contribution failed");
				return [];
			},
		});
		const agent = new AgentState(undefined);

		expect(() => agent.addSource(SourceType, 1)).toThrow("contribution failed");
		shouldThrow = false;

		expect(agent.addSource(SourceType, 2)).toBeDefined();
	});

	it("removes a declined Descriptor reservation so admission can be retried", () => {
		const OutputType = defineSourceType<number>({
			name: "DeclinedDescriptorOutput",
			priority: 100,
			contribute: () => [],
		});
		const DescriptorType = defineDescriptorType<number, number>({
			name: "DeclinedDescriptorAdmission",
			source: OutputType,
			duplication: { policy: "ignore" },
		});
		const agent = new AgentState(undefined);
		let shouldBind = false;
		agent.registerDescriptorHandler(DescriptorType, (ctx, data) => {
			if (!shouldBind) return undefined;
			const source = ctx.addSource(data)!;
			return {
				source,
				update: (value) => source.set(value),
				destroy: () => source.destroy(),
			};
		});

		expect(agent.addDescriptor(DescriptorType, 1)).toBeUndefined();
		shouldBind = true;

		expect(agent.addDescriptor(DescriptorType, 2)).toBeDefined();
	});

	it("applies reconciliation that occurs while a Source is being published", () => {
		const Property = defineNumberProperty({
			name: "PendingReconciliationProperty",
			defaultValue: 0,
		});
		let reentered = false;
		const agent = new AgentState<undefined>(undefined);
		const SourceType = defineSourceType<number>({
			name: "PendingReconciliationSource",
			priority: 100,
			duplication: {
				policy: "reconcile",
				reconcile: (existing, incoming) => existing.set(incoming),
			},
			contribute: (value) => {
				if (!reentered) {
					reentered = true;
					agent.addSource(SourceType, 2);
				}
				return [Property.add(value)];
			},
		});

		const source = agent.addSource(SourceType, 1)!;

		expect(source.get()).toBe(2);
		expect(agent.get(Property)).toBe(2);
	});

	it("unregisters a Source before removed observers attempt replacement", () => {
		const SourceType = defineSourceType<number>({
			name: "RemovalObserverReplacementSource",
			priority: 100,
			duplication: { policy: "ignore" },
			contribute: () => [],
		});
		const agent = new AgentState(undefined);
		const first = agent.addSource(SourceType, 1)!;
		let replacement: Source<number> | undefined;
		agent.onSourceRemoved(() => {
			replacement = agent.addSource(SourceType, 2);
		});

		first.destroy();

		expect(replacement).toBeDefined();
		expect(agent.getSources(SourceType)).toEqual(new Set([replacement]));
	});

	it("does not retain a Source destroyed during its added notification", () => {
		const SourceType = defineSourceType<number>({
			name: "AddedObserverDestroyedSource",
			priority: 100,
			duplication: { policy: "ignore" },
			contribute: () => [],
		});
		const agent = new AgentState(undefined);
		const disconnect = agent.onSourceAdded((source) => {
			disconnect();
			source.destroy();
		});

		agent.addSource(SourceType, 1);

		expect(agent.addSource(SourceType, 2)).toBeDefined();
	});

	it("does not retain a Descriptor destroyed during its added notification", () => {
		const OutputType = defineSourceType<number>({
			name: "AddedObserverDestroyedDescriptorOutput",
			priority: 100,
			contribute: () => [],
		});
		const DescriptorType = defineDescriptorType<number, number>({
			name: "AddedObserverDestroyedDescriptor",
			source: OutputType,
			duplication: { policy: "ignore" },
		});
		const agent = new AgentState(undefined);
		agent.registerDescriptorHandler(DescriptorType, (ctx, data) => {
			const source = ctx.addSource(data)!;
			return {
				source,
				update: (value) => source.set(value),
				destroy: () => source.destroy(),
			};
		});
		const disconnect = agent.onDescriptorAdded((descriptor) => {
			disconnect();
			descriptor.destroy();
		});

		agent.addDescriptor(DescriptorType, 1);

		expect(agent.addDescriptor(DescriptorType, 2)).toBeDefined();
	});
});

describe("duplication group validation", () => {
	it.each([Number.NaN, 1.5])("rejects an invalid maxStack of %s", (maxStack) => {
		expect(
			() =>
				new DuplicationGroup({
					policy: "replace",
					maxStack,
					selector: "oldest",
				})
		).toThrow(/maxStack/);
	});
});
