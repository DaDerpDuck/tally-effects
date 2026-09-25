import { describe, expect, it, vi } from "vitest";
import {
	AgentState,
	defineNumberProperty,
	defineSourceType,
	type Source,
	testReporter,
} from "../src/index.js";

describe("Source admission and teardown reentrancy", () => {
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
});
