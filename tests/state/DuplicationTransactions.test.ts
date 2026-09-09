import { describe, expect, it } from "vitest";
import {
	AgentState,
	defineDescriptorType,
	defineNumberProperty,
	defineSourceType,
	DuplicationGroup,
	type Source,
} from "../src/index.js";
import { DuplicationIndex } from "../../src/tally/state/duplication/DuplicationIndex.js";
import { DuplicationResolver } from "../../src/tally/state/duplication/DuplicationResolver.js";
import type {
	DuplicableType,
	DuplicationCandidate,
} from "../../src/tally/state/duplication/DuplicationCandidate.js";
import type { PlannedInstance } from "../../src/tally/state/PlannedInstance.js";

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

	it("preserves a group's stack limit when ranking reenters admission", () => {
		const group = new DuplicationGroup({
			policy: "replace",
			maxStack: 1,
			selector: "lowest",
		});
		let reentered = false;
		const agent = new AgentState<undefined>(undefined);
		const SourceType = defineSourceType<number>({
			name: "ReentrantGroupedRankingSource",
			priority: 100,
			duplication: group.member({
				rank: (value) => {
					if (value === 1 && !reentered) {
						reentered = true;
						agent.addSource(SourceType, 2);
					}
					return value;
				},
			}),
			contribute: () => [],
		});

		agent.addSource(SourceType, 1);
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

	it("rolls back modifiers from a Source cancelled during contribution", () => {
		const Property = defineNumberProperty({
			name: "CancelledPendingSourceProperty",
			defaultValue: 0,
		});
		const group = new DuplicationGroup({
			policy: "replace",
			maxStack: 1,
			selector: "oldest",
		});
		let reentered = false;
		const agent = new AgentState<undefined>(undefined);
		const SourceType = defineSourceType<number>({
			name: "CancelledPendingSource",
			priority: 100,
			duplication: group.member(),
			contribute: (value) => {
				if (!reentered) {
					reentered = true;
					agent.addSource(SourceType, 2);
				}
				return [Property.add(value)];
			},
		});

		agent.addSource(SourceType, 1);

		expect([...agent.getSources(SourceType)].map((source) => source.get())).toEqual([2]);
		expect(agent.get(Property)).toBe(2);
	});

	it("rolls back modifiers from a Source destroyed during its update", () => {
		const Property = defineNumberProperty({
			name: "DestroyedUpdatingSourceProperty",
			defaultValue: 0,
		});
		const group = new DuplicationGroup({
			policy: "replace",
			maxStack: 1,
			selector: "oldest",
		});
		let reentered = false;
		const agent = new AgentState<undefined>(undefined);
		const SourceType = defineSourceType<number>({
			name: "DestroyedUpdatingSource",
			priority: 100,
			duplication: group.member(),
			contribute: (value) => {
				if (value === 3 && !reentered) {
					reentered = true;
					agent.addSource(SourceType, 2);
				}
				return [Property.add(value)];
			},
		});

		const first = agent.addSource(SourceType, 1)!;
		first.set(3);
		agent.addSource(
			defineSourceType<undefined>({
				name: "DestroyedUpdatingSourceResolutionTrigger",
				priority: 100,
				contribute: () => [Property.add(0)],
			}),
			undefined
		);

		expect([...agent.getSources(SourceType)].map((source) => source.get())).toEqual([2]);
		expect(agent.get(Property)).toBe(2);
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
		const agent = new AgentState<undefined>(undefined);
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
		const agent = new AgentState<undefined>(undefined);
		agent.registerDescriptorHandler(DescriptorType, (ctx, data) => {
			ctx.addSource(data);
			throw new Error("handler failed");
		});

		expect(() => agent.addDescriptor(DescriptorType, 1)).toThrow("handler failed");

		expect(agent.getSources(OutputType)).toEqual(new Set());
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

	it("unregisters a Source destroyed by pending reconciliation", () => {
		let reentered = false;
		const agent = new AgentState<undefined>(undefined);
		const added = new Array<Source<number>>();
		const SourceType = defineSourceType<number>({
			name: "PendingReconciliationDestroyedSource",
			priority: 100,
			duplication: {
				policy: "reconcile",
				reconcile: (existing) => existing.destroy(),
			},
			contribute: () => {
				if (!reentered) {
					reentered = true;
					agent.addSource(SourceType, 2);
				}
				return [];
			},
		});
		agent.onSourceAdded((source) => added.push(source as Source<number>));

		agent.addSource(SourceType, 1);

		expect(agent.getSources(SourceType)).toEqual(new Set());
		expect(added).toEqual([]);
		expect(agent.addSource(SourceType, 3)).toBeDefined();
	});

	it("cancels the incoming reservation when eviction throws", () => {
		type Candidate = DuplicationCandidate<number>;

		const type = {
			duplication: { kind: "replace" },
		} as unknown as DuplicableType<Candidate, number>;
		const index = new DuplicationIndex();
		const resolver = new DuplicationResolver(index);
		const plan = (candidate: Candidate, onCancel: () => void): PlannedInstance<Candidate> => ({
			get: () => candidate,
			commit: () => candidate,
			publish: () => {},
			cancel: onCancel,
		});
		const throwingCandidate: Candidate = {
			type,
			get: () => 1,
			destroy: () => {
				throw new Error("destroy failed");
			},
		};
		const first = resolver.resolve(() => plan(throwingCandidate, () => {}), type, 1, undefined);
		if (first.result === "added") first.publish();

		let cancelled = false;
		const incomingCandidate: Candidate = {
			type,
			get: () => 2,
			destroy: () => {},
		};

		expect(() =>
			resolver.resolve(
				() => plan(incomingCandidate, () => (cancelled = true)),
				type,
				2,
				undefined
			)
		).toThrow("destroy failed");

		expect(cancelled).toBe(true);
		expect(index.view(type, undefined)).toEqual([]);
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

	it("notifies Source removal when an added observer destroys the Source", () => {
		const SourceType = defineSourceType<number>({
			name: "AddedObserverRemovedSource",
			priority: 100,
			contribute: () => [],
		});
		const agent = new AgentState(undefined);
		const events = new Array<string>();
		agent.onSourceAdded((source) => {
			events.push("added");
			source.destroy();
		});
		agent.onSourceRemoved(() => events.push("removed"));

		agent.addSource(SourceType, 1);

		expect(events).toEqual(["added", "removed"]);
	});

	it("rolls back a Source when an added observer throws", () => {
		const SourceType = defineSourceType<number>({
			name: "ThrowingAddedSource",
			priority: 100,
			duplication: { policy: "ignore" },
			contribute: () => [],
		});
		const agent = new AgentState(undefined);
		let shouldThrow = true;
		agent.onSourceAdded(() => {
			if (shouldThrow) throw new Error("added callback failed");
		});

		expect(() => agent.addSource(SourceType, 1)).toThrow("added callback failed");
		expect(agent.getSources(SourceType)).toEqual(new Set());

		shouldThrow = false;
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
		const agent = new AgentState<undefined>(undefined);
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

	it("rolls back a Descriptor when an added observer throws", () => {
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
		const agent = new AgentState<undefined>(undefined);
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

		expect(() => agent.addDescriptor(DescriptorType, 1)).toThrow("added callback failed");
		expect(agent.getDescriptors(DescriptorType)).toEqual(new Set());
		expect(agent.getSources(OutputType)).toEqual(new Set());

		shouldThrow = false;
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
