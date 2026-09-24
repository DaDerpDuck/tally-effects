import { describe, expect, it, vi } from "vitest";
import {
	AgentState,
	defineDescriptorType,
	defineSourceType,
	DuplicationGroup,
	testReporter,
} from "../src/index.js";

describe("reentrant admission, reconciliation, and rollback", () => {
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
		const agent = new AgentState(undefined, { reporter: testReporter });
		const first = agent.addSource(SourceType, 1)!;
		first.onDestroy(() => agent.addSource(SourceType, 2));

		agent.addSource(SourceType, 3);

		expect(agent.getSources(SourceType).size).toBe(1);
	});

	it("revalidates a grouped eviction when preparation mutates the incoming rank", () => {
		const group = new DuplicationGroup({
			policy: "replace",
			maxStack: 1,
			selector: "highest",
		});
		const SourceType = defineSourceType<{ rank: number }>({
			name: "PreparationMutatedGroupedRank",
			priority: 100,
			duplication: group.member({
				rank: (data) => data.rank,
				replaceIf: (existingRank, incomingRank) => incomingRank > existingRank,
			}),
			contribute: (data) => {
				if (data.rank === 10) data.rank = 0;
				return [];
			},
		});
		const agent = new AgentState(undefined, { reporter: testReporter });
		const existing = agent.addSource(SourceType, { rank: 5 })!;

		expect(agent.addSource(SourceType, { rank: 10 })).toBeUndefined();
		expect(agent.getSources(SourceType)).toEqual(new Set([existing]));
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
		const agent = new AgentState(undefined, { reporter: testReporter });

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
		const agent = new AgentState(undefined, { reporter: testReporter });
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

	it("rolls back a Descriptor binding cancelled during handler execution", () => {
		const OutputType = defineSourceType<number>({
			name: "CancelledPendingDescriptorOutput",
			priority: 100,
			contribute: () => [],
		});
		const group = new DuplicationGroup({
			policy: "replace",
			maxStack: 1,
			selector: "oldest",
		});
		const DescriptorType = defineDescriptorType<number, number>({
			name: "CancelledPendingDescriptor",
			source: OutputType,
			duplication: group.member(),
		});
		let reentered = false;
		const agent = new AgentState<undefined>(undefined, { reporter: testReporter });
		agent.registerDescriptorHandler(DescriptorType, (ctx, data) => {
			if (!reentered) {
				reentered = true;
				agent.addDescriptor(DescriptorType, 2);
			}
			const source = ctx.addSource(data)!;
			return {
				source,
				update: (value) => source.set(value),
				destroy: () => source.destroy(),
			};
		});

		agent.addDescriptor(DescriptorType, 1);

		expect(
			[...agent.getDescriptors(DescriptorType)].map((descriptor) => descriptor.get())
		).toEqual([2]);
		expect([...agent.getSources(OutputType)].map((source) => source.get())).toEqual([2]);
	});

	it("cancels a pending Descriptor destroyed by a reentrant reconciliation", () => {
		const OutputType = defineSourceType<number>({
			name: "ReconciledPendingDescriptorOutput",
			priority: 100,
			contribute: () => [],
		});
		const DescriptorType = defineDescriptorType<number, number>({
			name: "ReconciledPendingDescriptor",
			source: OutputType,
			duplication: {
				policy: "reconcile",
				reconcile: (existing, incoming) => {
					if (incoming === 2) existing.destroy();
				},
			},
		});
		const agent = new AgentState(undefined, { reporter: testReporter });
		const descriptorAdded = vi.fn();
		const descriptorRemoved = vi.fn();
		agent.onDescriptorAdded(descriptorAdded);
		agent.onDescriptorRemoved(descriptorRemoved);
		agent.registerDescriptorHandler(DescriptorType, (ctx, data) => {
			const source = ctx.addSource(data)!;
			if (data === 1) agent.addDescriptor(DescriptorType, 2);
			return {
				source,
				update: (value) => source.set(value),
				destroy: () => source.destroy(),
			};
		});

		expect(agent.addDescriptor(DescriptorType, 1)).toBeUndefined();
		expect(agent.getDescriptors(DescriptorType)).toEqual(new Set());
		expect(agent.getSources(OutputType)).toEqual(new Set());
		expect(descriptorAdded).not.toHaveBeenCalled();
		expect(descriptorRemoved).not.toHaveBeenCalled();
		expect(agent.addDescriptor(DescriptorType, 3)).toBeDefined();
	});

	it("rolls back a Descriptor's derived Source when its handler throws", () => {
		const OutputType = defineSourceType<number>({
			name: "FailedDescriptorHandlerOutput",
			priority: 100,
			contribute: () => [],
		});
		const DescriptorType = defineDescriptorType<number, number>({
			name: "FailedDescriptorHandler",
			source: OutputType,
		});
		const agent = new AgentState<undefined>(undefined, { reporter: testReporter });
		agent.registerDescriptorHandler(DescriptorType, (ctx, data) => {
			ctx.addSource(data);
			throw new Error("handler failed");
		});

		expect(() => agent.addDescriptor(DescriptorType, 1)).toThrow("handler failed");

		expect(agent.getSources(OutputType)).toEqual(new Set());
	});
});
