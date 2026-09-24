import { describe, expect, it, vi } from "vitest";
import {
	AgentState,
	defineDescriptorType,
	defineNumberProperty,
	defineSourceType,
	DuplicationGroup,
	type ModifierContribution,
	type Descriptor,
	type Source,
	testReporter,
	createTestReporter,
} from "../src/index.js";

declare global {
	var __tallyDuplicationTransactionSuite: string | undefined;
}

const selectedSuite = globalThis.__tallyDuplicationTransactionSuite;
const describeSuite = (name: string, callback: () => void) => {
	if (selectedSuite === undefined || selectedSuite === name) describe(name, callback);
};

describeSuite("reentrant admission, reconciliation, and rollback", () => {
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

describeSuite("Source admission and teardown reentrancy", () => {
	it("reports eviction destroy callback failures and admits the replacement", () => {
		const SourceType = defineSourceType<number>({
			name: "ThrowingEvictionSource",
			priority: 100,
			duplication: { policy: "replace" },
			contribute: () => [],
		});
		const agent = new AgentState(undefined, { reporter: testReporter });
		const first = agent.addSource(SourceType, 1)!;
		first.onDestroy(() => {
			throw new Error("destroy failed");
		});

		expect(() => agent.addSource(SourceType, 2)).not.toThrow();
		expect(agent.getSources(SourceType).size).toBe(1);

		expect(agent.addSource(SourceType, 3)).toBeDefined();
	});

	it("unregisters a Source before removed observers attempt replacement", () => {
		const SourceType = defineSourceType<number>({
			name: "RemovalObserverReplacementSource",
			priority: 100,
			duplication: { policy: "ignore" },
			contribute: () => [],
		});
		const agent = new AgentState(undefined, { reporter: testReporter });
		const first = agent.addSource(SourceType, 1)!;
		let replacement: Source<number> | undefined;
		agent.onSourceRemoved(() => {
			replacement = agent.addSource(SourceType, 2);
		});

		first.destroy();

		expect(replacement).toBeDefined();
		expect(agent.getSources(SourceType)).toEqual(new Set([replacement]));
	});

	it("finishes Source teardown when destroy callbacks throw", () => {
		const Property = defineNumberProperty({
			name: "ThrowingSourceDestroyCallbackProperty",
			defaultValue: 0,
		});
		const SourceType = defineSourceType<number>({
			name: "ThrowingSourceDestroyCallback",
			priority: 100,
			duplication: { policy: "ignore" },
			contribute: (value) => [Property.add(value)],
		});
		const agent = new AgentState(undefined, { reporter: testReporter });
		const source = agent.addSource(SourceType, 1)!;
		const laterDestroyCallback = vi.fn();
		const removed = vi.fn();
		source.onDestroy(() => {
			throw new Error("source destroy callback failed");
		});
		source.onDestroy(laterDestroyCallback);
		agent.onSourceRemoved(removed);

		expect(() => source.destroy()).not.toThrow();

		expect(laterDestroyCallback).toHaveBeenCalledWith(source);
		expect(removed).toHaveBeenCalledWith(source);
		expect(agent.getSources(SourceType)).toEqual(new Set());
		expect(agent.get(Property)).toBe(0);
		expect(agent.addSource(SourceType, 2)).toBeDefined();
	});

	it("does not announce a Source destroyed by a property observer before its added event", () => {
		const Property = defineNumberProperty({
			name: "PropertyObserverDestroyedPendingSourceProperty",
			defaultValue: 0,
		});
		const SourceType = defineSourceType<number>({
			name: "PropertyObserverDestroyedPendingSource",
			priority: 100,
			duplication: { policy: "ignore" },
			contribute: (value) => [Property.add(value)],
		});
		const agent = new AgentState(undefined, { reporter: testReporter });
		const added = vi.fn();
		agent.onSourceAdded(added);
		agent.onPropertyChanged(Property, (value) => {
			if (value !== 1) return;
			for (const source of agent.getSources(SourceType)) source.destroy();
		});

		const destroyedDuringAdmission = agent.addSource(SourceType, 1);

		expect(destroyedDuringAdmission).toBeUndefined();
		expect(added).not.toHaveBeenCalled();
		expect(agent.getSources(SourceType)).toEqual(new Set());
		expect(agent.addSource(SourceType, 2)).toBeDefined();
	});

	it("unregisters a Source before property observers attempt replacement", () => {
		const Property = defineNumberProperty({
			name: "PropertyObserverReplacementSourceProperty",
			defaultValue: 0,
		});
		const SourceType = defineSourceType<number>({
			name: "PropertyObserverReplacementSource",
			priority: 100,
			duplication: { policy: "ignore" },
			contribute: (value) => [Property.add(value)],
		});
		const agent = new AgentState(undefined, { reporter: testReporter });
		const first = agent.addSource(SourceType, 1)!;
		let replacement: Source<number> | undefined;
		agent.onPropertyChanged(Property, (value) => {
			if (value === 0) replacement = agent.addSource(SourceType, 2);
		});

		first.destroy();

		expect(replacement).toBeDefined();
		expect(agent.getSources(SourceType)).toEqual(new Set([replacement]));
		expect(agent.get(Property)).toBe(2);
	});

	it("does not retain a Source destroyed during its added notification", () => {
		const SourceType = defineSourceType<number>({
			name: "AddedObserverDestroyedSource",
			priority: 100,
			duplication: { policy: "ignore" },
			contribute: () => [],
		});
		const agent = new AgentState(undefined, { reporter: testReporter });
		const disconnect = agent.onSourceAdded((source) => {
			disconnect();
			source.destroy();
		});

		agent.addSource(SourceType, 1);

		expect(agent.addSource(SourceType, 2)).toBeDefined();
	});

	it("notifies Source removal when an added observer destroys the Source", () => {
		const SourceType = defineSourceType<number>({
			name: "AddedObserverRemovedSource",
			priority: 100,
			contribute: () => [],
		});
		const agent = new AgentState(undefined, { reporter: testReporter });
		const events = new Array<string>();
		agent.onSourceAdded((source) => {
			events.push("added");
			source.destroy();
		});
		agent.onSourceRemoved(() => events.push("removed"));

		agent.addSource(SourceType, 1);

		expect(events).toEqual(["added", "removed"]);
	});

	it("reports a Source added observer failure without rolling back", () => {
		const SourceType = defineSourceType<number>({
			name: "ThrowingAddedSource",
			priority: 100,
			duplication: { policy: "ignore" },
			contribute: () => [],
		});
		const agent = new AgentState(undefined, { reporter: testReporter });
		let shouldThrow = true;
		agent.onSourceAdded(() => {
			if (shouldThrow) throw new Error("added callback failed");
		});

		expect(() => agent.addSource(SourceType, 1)).not.toThrow();
		expect(agent.getSources(SourceType).size).toBe(1);

		shouldThrow = false;
		agent.getSources(SourceType).forEach((source) => source.destroy());
		expect(agent.addSource(SourceType, 2)).toBeDefined();
	});

	it("resolves properties after rolling back a Source whose added observer throws", () => {
		const Property = defineNumberProperty({
			name: "ThrowingAddedSourceRollbackResolutionProperty",
			defaultValue: 0,
		});
		const SourceType = defineSourceType<number>({
			name: "ThrowingAddedSourceRollbackResolution",
			priority: 100,
			duplication: { policy: "ignore" },
			contribute: (value) => [Property.add(value)],
		});
		const agent = new AgentState(undefined, { reporter: testReporter });
		agent.onSourceAdded(() => {
			throw new Error("added callback failed");
		});

		expect(() => agent.addSource(SourceType, 1)).not.toThrow();
		expect(agent.getSources(SourceType).size).toBe(1);
		expect(agent.get(Property)).toBe(1);
	});

	it("resolves properties after rolling back a Descriptor whose added observer throws", () => {
		const Property = defineNumberProperty({
			name: "ThrowingAddedDescriptorRollbackResolutionProperty",
			defaultValue: 0,
		});
		const OutputType = defineSourceType<number>({
			name: "ThrowingAddedDescriptorRollbackResolutionOutput",
			priority: 100,
			contribute: (value) => [Property.add(value)],
		});
		const DescriptorType = defineDescriptorType<number, number>({
			name: "ThrowingAddedDescriptorRollbackResolution",
			source: OutputType,
			duplication: { policy: "ignore" },
		});
		const agent = new AgentState<undefined>(undefined, { reporter: testReporter });
		agent.registerDescriptorHandler(DescriptorType, (ctx, data) => {
			const source = ctx.addSource(data)!;
			return {
				source,
				update: (value) => source.set(value),
				destroy: () => source.destroy(),
			};
		});
		agent.onDescriptorAdded(() => {
			throw new Error("added callback failed");
		});

		expect(() => agent.addDescriptor(DescriptorType, 1)).not.toThrow();
		expect(agent.getDescriptors(DescriptorType).size).toBe(1);
		expect(agent.getSources(OutputType).size).toBe(1);
		expect(agent.get(Property)).toBe(1);
	});

	it("reports a Source property observer failure after admission", () => {
		const Property = defineNumberProperty({
			name: "ThrowingAdmissionFlushSourceProperty",
			defaultValue: 0,
		});
		const SourceType = defineSourceType<number>({
			name: "ThrowingAdmissionFlushSource",
			priority: 100,
			duplication: { policy: "ignore" },
			contribute: (value) => [Property.add(value)],
		});
		const agent = new AgentState(undefined, { reporter: testReporter });
		agent.onPropertyChanged(Property, (value) => {
			if (value === 1) throw new Error("admission flush failed");
		});

		expect(() => agent.addSource(SourceType, 1)).not.toThrow();
		expect(agent.getSources(SourceType).size).toBe(1);
		expect(agent.get(Property)).toBe(1);

		agent.getSources(SourceType).forEach((source) => source.destroy());
		expect(agent.addSource(SourceType, 2)).toBeDefined();
		expect(agent.get(Property)).toBe(2);
	});

	it("reports a Descriptor property observer failure after admission", () => {
		const Property = defineNumberProperty({
			name: "ThrowingAdmissionFlushDescriptorProperty",
			defaultValue: 0,
		});
		const OutputType = defineSourceType<number>({
			name: "ThrowingAdmissionFlushDescriptorOutput",
			priority: 100,
			contribute: (value) => [Property.add(value)],
		});
		const DescriptorType = defineDescriptorType<number, number>({
			name: "ThrowingAdmissionFlushDescriptor",
			source: OutputType,
			duplication: { policy: "ignore" },
		});
		const agent = new AgentState(undefined, { reporter: testReporter });
		agent.registerDescriptorHandler(DescriptorType, (ctx, data) => {
			const source = ctx.addSource(data)!;
			return {
				source,
				update: (value) => source.set(value),
				destroy: () => source.destroy(),
			};
		});
		agent.onPropertyChanged(Property, (value) => {
			if (value === 1) throw new Error("admission flush failed");
		});

		expect(() => agent.addDescriptor(DescriptorType, 1)).not.toThrow();
		expect(agent.getDescriptors(DescriptorType).size).toBe(1);
		expect(agent.getSources(OutputType).size).toBe(1);
		expect(agent.get(Property)).toBe(1);

		agent.getDescriptors(DescriptorType).forEach((descriptor) => descriptor.destroy());
		expect(agent.addDescriptor(DescriptorType, 2)).toBeDefined();
		expect(agent.get(Property)).toBe(2);
	});
});

describeSuite("failed preparation and contribution rollback", () => {
	it("rolls back earlier modifier handles when a later contribution throws", () => {
		const Property = defineNumberProperty({
			name: "PartialModifierApplicationProperty",
			defaultValue: 0,
		});
		const throwingContribution: ModifierContribution = {
			applyTo() {
				throw new Error("second modifier failed");
			},
		};
		const SourceType = defineSourceType<number>({
			name: "PartialModifierApplicationSource",
			priority: 100,
			contribute: (value) =>
				value === 1 ? [Property.add(1), throwingContribution] : [Property.add(value)],
		});
		const { reporter, reports } = createTestReporter();
		const agent = new AgentState(undefined, { reporter });

		expect(() => agent.addSource(SourceType, 1)).toThrow("second modifier failed");
		expect(agent.getSources(SourceType)).toEqual(new Set());
		expect(agent.get(Property)).toBe(0);

		agent.addSource(SourceType, 2);
		expect(agent.get(Property)).toBe(2);
	});

	it("notifies Source removal after property resolution observers throw", () => {
		const Property = defineNumberProperty({
			name: "ThrowingRemovalResolutionProperty",
			defaultValue: 0,
		});
		const SourceType = defineSourceType<number>({
			name: "ThrowingRemovalResolutionSource",
			priority: 100,
			contribute: (value) => [Property.add(value)],
		});
		const agent = new AgentState(undefined, { reporter: testReporter });
		const source = agent.addSource(SourceType, 1)!;
		const destroyed = vi.fn();
		const removed = vi.fn();
		source.onDestroy(destroyed);
		agent.onSourceRemoved(removed);
		agent.onPropertyChanged(Property, (value) => {
			if (value === 0) throw new Error("removal resolution failed");
		});

		expect(() => source.destroy()).not.toThrow();
		expect(destroyed).toHaveBeenCalledWith(source);
		expect(removed).toHaveBeenCalledWith(source);
		expect(agent.getSources(SourceType)).toEqual(new Set());
		expect(agent.get(Property)).toBe(0);
	});
});

describeSuite("Descriptor admission and teardown reentrancy", () => {
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
		const agent = new AgentState(undefined, { reporter: testReporter });
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

	it("does not announce a Descriptor destroyed by a property observer before its added event", () => {
		const Property = defineNumberProperty({
			name: "PropertyObserverDestroyedPendingDescriptorProperty",
			defaultValue: 0,
		});
		const OutputType = defineSourceType<number>({
			name: "PropertyObserverDestroyedPendingDescriptorOutput",
			priority: 100,
			contribute: (value) => [Property.add(value)],
		});
		const DescriptorType = defineDescriptorType<number, number>({
			name: "PropertyObserverDestroyedPendingDescriptor",
			source: OutputType,
			duplication: { policy: "ignore" },
		});
		const agent = new AgentState(undefined, { reporter: testReporter });
		agent.registerDescriptorHandler(DescriptorType, (ctx, data) => {
			const source = ctx.addSource(data)!;
			return {
				source,
				update: (value) => source.set(value),
				destroy: () => source.destroy(),
			};
		});
		const added = vi.fn();
		agent.onDescriptorAdded(added);
		agent.onPropertyChanged(Property, (value) => {
			if (value !== 1) return;
			for (const descriptor of agent.getDescriptors(DescriptorType)) descriptor.destroy();
		});

		const destroyedDuringAdmission = agent.addDescriptor(DescriptorType, 1);

		expect(destroyedDuringAdmission).toBeUndefined();
		expect(added).not.toHaveBeenCalled();
		expect(agent.getDescriptors(DescriptorType)).toEqual(new Set());
		expect(agent.getSources(OutputType)).toEqual(new Set());
		expect(agent.addDescriptor(DescriptorType, 2)).toBeDefined();
	});

	it("unregisters a Descriptor before its derived Source removal observers reenter", () => {
		const OutputType = defineSourceType<number>({
			name: "DerivedRemovalReplacementOutput",
			priority: 100,
			contribute: () => [],
		});
		const DescriptorType = defineDescriptorType<number, number>({
			name: "DerivedRemovalReplacementDescriptor",
			source: OutputType,
			duplication: { policy: "ignore" },
		});
		const agent = new AgentState(undefined, { reporter: testReporter });
		agent.registerDescriptorHandler(DescriptorType, (ctx, data) => {
			const source = ctx.addSource(data)!;
			return {
				source,
				update: (value) => source.set(value),
				destroy: () => source.destroy(),
			};
		});
		const descriptor = agent.addDescriptor(DescriptorType, 1)!;
		let replacement: Descriptor<number, number> | undefined;
		const disconnect = agent.onSourceRemoved(() => {
			disconnect();
			replacement = agent.addDescriptor(DescriptorType, 2);
		});

		descriptor.destroy();

		expect(replacement).toBeDefined();
		expect(agent.getDescriptors(DescriptorType)).toEqual(new Set([replacement]));
	});

	it("cleans up a Descriptor when its binding destroy callback throws", () => {
		const OutputType = defineSourceType<number>({
			name: "ThrowingDestroyDescriptorOutput",
			priority: 100,
			contribute: () => [],
		});
		const DescriptorType = defineDescriptorType<number, number>({
			name: "ThrowingDestroyDescriptor",
			source: OutputType,
			duplication: { policy: "ignore" },
		});
		const agent = new AgentState(undefined, { reporter: testReporter });
		let shouldThrow = true;
		agent.registerDescriptorHandler(DescriptorType, (ctx, data) => {
			const source = ctx.addSource(data)!;
			return {
				source,
				update: (value) => source.set(value),
				destroy: () => {
					if (shouldThrow) throw new Error("binding destroy failed");
					source.destroy();
				},
			};
		});
		const descriptor = agent.addDescriptor(DescriptorType, 1)!;

		expect(() => descriptor.destroy()).not.toThrow();
		expect(agent.getDescriptors(DescriptorType)).toEqual(new Set());
		expect(agent.getSources(OutputType)).toEqual(new Set());

		shouldThrow = false;
		expect(agent.addDescriptor(DescriptorType, 2)).toBeDefined();
	});

	it("tears down a Descriptor binding before removed observers attempt replacement", () => {
		const OutputType = defineSourceType<number>({
			name: "RemovedDescriptorReplacementOutput",
			priority: 100,
			duplication: { policy: "ignore" },
			contribute: () => [],
		});
		const DescriptorType = defineDescriptorType<number, number>({
			name: "RemovedDescriptorReplacement",
			source: OutputType,
		});
		const agent = new AgentState(undefined, { reporter: testReporter });
		agent.registerDescriptorHandler(DescriptorType, (ctx, data) => {
			const source = ctx.addSource(data)!;
			return {
				source,
				update: (value) => source.set(value),
				destroy: () => source.destroy(),
			};
		});
		const descriptor = agent.addDescriptor(DescriptorType, 1)!;
		let replacement: Source<number> | undefined;
		agent.onDescriptorRemoved(() => {
			replacement = agent.addSource(OutputType, 2);
		});

		descriptor.destroy();

		expect(replacement).toBeDefined();
		expect(agent.getSources(OutputType)).toEqual(new Set([replacement]));
	});

	it("finishes Descriptor teardown when destroy callbacks throw", () => {
		const Property = defineNumberProperty({
			name: "ThrowingDescriptorDestroyCallbackProperty",
			defaultValue: 0,
		});
		const OutputType = defineSourceType<number>({
			name: "ThrowingDescriptorDestroyCallbackOutput",
			priority: 100,
			contribute: (value) => [Property.add(value)],
		});
		const DescriptorType = defineDescriptorType<number, number>({
			name: "ThrowingDescriptorDestroyCallback",
			source: OutputType,
			duplication: { policy: "ignore" },
		});
		const agent = new AgentState(undefined, { reporter: testReporter });
		agent.registerDescriptorHandler(DescriptorType, (ctx, data) => {
			const source = ctx.addSource(data)!;
			return {
				source,
				update: (value) => source.set(value),
				destroy: () => source.destroy(),
			};
		});
		const descriptor = agent.addDescriptor(DescriptorType, 1)!;
		const laterDestroyCallback = vi.fn();
		const removed = vi.fn();
		descriptor.onDestroy(() => {
			throw new Error("descriptor destroy callback failed");
		});
		descriptor.onDestroy(laterDestroyCallback);
		agent.onDescriptorRemoved(removed);

		expect(() => descriptor.destroy()).not.toThrow();

		expect(laterDestroyCallback).toHaveBeenCalledWith(descriptor);
		expect(removed).toHaveBeenCalledWith(descriptor);
		expect(agent.getDescriptors(DescriptorType)).toEqual(new Set());
		expect(agent.getSources(OutputType)).toEqual(new Set());
		expect(agent.get(Property)).toBe(0);
		expect(agent.addDescriptor(DescriptorType, 2)).toBeDefined();
	});

	it("notifies Descriptor removal when an added observer destroys the Descriptor", () => {
		const OutputType = defineSourceType<number>({
			name: "AddedObserverRemovedDescriptorOutput",
			priority: 100,
			contribute: () => [],
		});
		const DescriptorType = defineDescriptorType<number, number>({
			name: "AddedObserverRemovedDescriptor",
			source: OutputType,
		});
		const agent = new AgentState<undefined>(undefined, { reporter: testReporter });
		agent.registerDescriptorHandler(DescriptorType, (ctx, data) => {
			const source = ctx.addSource(data)!;
			return {
				source,
				update: (value) => source.set(value),
				destroy: () => source.destroy(),
			};
		});
		const events = new Array<string>();
		agent.onDescriptorAdded((descriptor) => {
			events.push("added");
			descriptor.destroy();
		});
		agent.onDescriptorRemoved(() => events.push("removed"));

		agent.addDescriptor(DescriptorType, 1);

		expect(events).toEqual(["added", "removed"]);
	});

	it("reports a Descriptor added observer failure without rolling back", () => {
		const OutputType = defineSourceType<number>({
			name: "ThrowingAddedDescriptorOutput",
			priority: 100,
			contribute: () => [],
		});
		const DescriptorType = defineDescriptorType<number, number>({
			name: "ThrowingAddedDescriptor",
			source: OutputType,
			duplication: { policy: "ignore" },
		});
		const agent = new AgentState<undefined>(undefined, { reporter: testReporter });
		agent.registerDescriptorHandler(DescriptorType, (ctx, data) => {
			const source = ctx.addSource(data)!;
			return {
				source,
				update: (value) => source.set(value),
				destroy: () => source.destroy(),
			};
		});
		let shouldThrow = true;
		agent.onDescriptorAdded(() => {
			if (shouldThrow) throw new Error("added callback failed");
		});

		expect(() => agent.addDescriptor(DescriptorType, 1)).not.toThrow();
		expect(agent.getDescriptors(DescriptorType).size).toBe(1);
		expect(agent.getSources(OutputType).size).toBe(1);

		shouldThrow = false;
		agent.getDescriptors(DescriptorType).forEach((descriptor) => descriptor.destroy());
		expect(agent.addDescriptor(DescriptorType, 2)).toBeDefined();
	});

	it("makes a Descriptor terminal when binding cleanup throws", () => {
		const OutputType = defineSourceType<number>({
			name: "ThrowingRollbackDescriptorOutput",
			priority: 100,
			contribute: () => [],
		});
		const DescriptorType = defineDescriptorType<number, number>({
			name: "ThrowingRollbackDescriptor",
			source: OutputType,
		});
		const agent = new AgentState<undefined>(undefined, { reporter: testReporter });
		let captured: Descriptor<number, number> | undefined;
		agent.registerDescriptorHandler(DescriptorType, (ctx, data) => {
			const source = ctx.addSource(data)!;
			return {
				source,
				update: (value) => source.set(value),
				destroy: () => {
					throw new Error("binding cleanup failed");
				},
			};
		});
		agent.onDescriptorAdded((descriptor) => {
			captured = descriptor as Descriptor<number, number>;
			throw new Error("added callback failed");
		});

		expect(() => agent.addDescriptor(DescriptorType, 1)).not.toThrow();
		expect(agent.getDescriptors(DescriptorType).size).toBe(1);
		expect(agent.getSources(OutputType).size).toBe(1);

		expect(() => captured!.destroy()).not.toThrow();
		expect(agent.getDescriptors(DescriptorType)).toEqual(new Set());
		expect(agent.getSources(OutputType)).toEqual(new Set());
		expect(() => captured!.set(2)).toThrow("Descriptor has been destroyed");
	});

	it("finishes Descriptor removal notifications and aggregates binding cleanup failures", () => {
		const OutputType = defineSourceType<number>({
			name: "AggregateDescriptorCleanupOutput",
			priority: 100,
			contribute: () => [],
		});
		const DescriptorType = defineDescriptorType<number, number>({
			name: "AggregateDescriptorCleanup",
			source: OutputType,
		});
		const agent = new AgentState<undefined>(undefined, { reporter: testReporter });
		agent.registerDescriptorHandler(DescriptorType, (ctx, data) => {
			const source = ctx.addSource(data)!;
			source.onDestroy(() => {
				throw new Error("derived source cleanup failed");
			});
			return {
				source,
				update: (value) => source.set(value),
				destroy: () => {
					throw new Error("binding cleanup failed");
				},
			};
		});
		const descriptor = agent.addDescriptor(DescriptorType, 1)!;
		const removed = vi.fn();
		agent.onDescriptorRemoved(removed);

		expect(() => descriptor.destroy()).not.toThrow();
		expect(removed).toHaveBeenCalledWith(descriptor);
		expect(agent.getDescriptors(DescriptorType)).toEqual(new Set());
		expect(agent.getSources(OutputType)).toEqual(new Set());
	});
});

describeSuite("duplication group validation", () => {
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

	it.each([
		{ policy: "invalid", maxStack: 1, selector: "oldest" },
		{ policy: "replace", maxStack: 1, selector: "invalid" },
	])("rejects an invalid runtime group definition %#", (definition) => {
		expect(() => new DuplicationGroup(definition as never)).toThrow();
	});
});
