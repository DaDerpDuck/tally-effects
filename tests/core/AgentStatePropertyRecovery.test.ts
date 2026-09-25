import { describe, expect, it, vi } from "vitest";
import { createResolutionFailureFixture } from "../fixtures/AgentState.js";
import {
	AgentState,
	contributeModifier,
	createTestReporter,
	defineNumberProperty,
	defineSourceType,
	type Property,
} from "../src/index.js";

describe("agent state", () => {
	it("completes Source removal despite an unrelated pending equality failure", () => {
		let shouldThrow = false;
		const pendingProperty: Property<number> = {
			name: "PendingEqualityProperty",
			defaultValue: 0,
			resolve: (base, modifiers) =>
				modifiers.reduce((value, modifier) => value + (modifier.value as number), base),
			valueEquals(a, b) {
				if (shouldThrow) throw new Error("pending equality failed");
				return Object.is(a, b);
			},
		};
		const PendingSource = defineSourceType<number>({
			name: "PendingEqualitySource",
			priority: 100,
			contribute: (value) => [
				contributeModifier({ property: pendingProperty, operation: "add", value }),
			],
		});
		const unrelatedProperty = defineNumberProperty({
			name: "RemovalAfterPendingEqualityProperty",
			defaultValue: 0,
		});
		const UnrelatedSource = defineSourceType<number>({
			name: "RemovalAfterPendingEqualitySource",
			priority: 100,
			contribute: (value) => [unrelatedProperty.add(value)],
		});
		const { reporter, reports } = createTestReporter();
		const agent = new AgentState(undefined, { reporter });
		const pending = agent.addSource(PendingSource, 1)!;
		const unrelated = agent.addSource(UnrelatedSource, 1)!;
		const destroyed = vi.fn();
		const removed = vi.fn();
		unrelated.onDestroy(destroyed);
		agent.onSourceRemoved(removed);

		shouldThrow = true;
		expect(() => pending.set(2)).not.toThrow();

		expect(() => unrelated.destroy()).not.toThrow();
		expect(destroyed).toHaveBeenCalledWith(unrelated);
		expect(removed).toHaveBeenCalledWith(unrelated);
		expect(reports).toHaveLength(2);
	});
	it("reports updates after an equality failure during Source teardown", () => {
		let shouldThrow = false;
		const property: Property<number> = {
			name: "UpdateAfterTeardownEqualityProperty",
			defaultValue: 0,
			resolve: (base, modifiers) =>
				modifiers.reduce((value, modifier) => value + (modifier.value as number), base),
			valueEquals(a, b) {
				if (shouldThrow) throw new Error("update equality failed");
				return Object.is(a, b);
			},
		};
		const SourceType = defineSourceType<number>({
			name: "UpdateAfterTeardownEqualitySource",
			priority: 100,
			contribute: (value) => [contributeModifier({ property, operation: "add", value })],
		});
		const { reporter, reports } = createTestReporter();
		const agent = new AgentState(undefined, { reporter });
		const tornDown = agent.addSource(SourceType, 1)!;
		const updated = agent.addSource(SourceType, 1)!;
		const updatedCallback = vi.fn();
		updated.onUpdate(updatedCallback);

		shouldThrow = true;
		expect(() => tornDown.destroy()).not.toThrow();
		expect(reports).toHaveLength(1);

		expect(() => updated.set(2)).not.toThrow();
		expect(updated.get()).toBe(2);
		expect(updatedCallback).toHaveBeenCalledWith(updated);
		expect(reports).toHaveLength(2);
	});
	it("keeps source modifiers owned when a property observer throws during an update", () => {
		const Property = defineNumberProperty({
			name: "ThrowingObserverProperty",
			defaultValue: 0,
		});
		const SourceType = defineSourceType<number>({
			name: "ThrowingObserverSource",
			priority: 100,
			contribute: (value) => [Property.add(value)],
		});
		const { reporter, reports } = createTestReporter();
		const agent = new AgentState(undefined, { reporter });
		const source = agent.addSource(SourceType, 1)!;
		const disconnect = agent.onPropertyChanged(Property, (value) => {
			if (value === 2) throw new Error("property observer failed");
		});

		expect(() => source.set(2)).not.toThrow();
		expect(reports).toHaveLength(1);
		expect(reports[0]?.error).toEqual(new Error("property observer failed"));
		expect(source.get()).toBe(2);
		expect(agent.get(Property)).toBe(2);

		disconnect();
		source.set(3);
		expect(agent.get(Property)).toBe(3);

		source.destroy();
		expect(agent.getSources(SourceType)).toEqual(new Set());
		expect(agent.get(Property)).toBe(0);
	});
	it("notifies Source observers after property resolution fails during update and removal", () => {
		const { sourceType, throwOnResolve } = createResolutionFailureFixture(
			"SourceNotificationResolutionFailure"
		);
		const { reporter, reports } = createTestReporter();
		const agent = new AgentState(undefined, { reporter });
		const source = agent.addSource(sourceType, 1)!;
		const updated = vi.fn();
		const removed = vi.fn();
		agent.onSourceUpdated(updated);
		agent.onSourceRemoved(removed);

		throwOnResolve();
		expect(() => source.set(2)).not.toThrow();
		expect(updated).toHaveBeenCalledWith(source);
		expect(reports).toEqual([
			expect.objectContaining({
				error: new Error("SourceNotificationResolutionFailure resolution failed"),
				code: "property-resolution-failed",
				operation: "resolve",
				subject: {
					kind: "property",
					name: "SourceNotificationResolutionFailureProperty",
				},
			}),
		]);

		expect(() => source.destroy()).not.toThrow();
		expect(removed).toHaveBeenCalledWith(source);
		expect(reports).toEqual([
			expect.objectContaining({
				error: new Error("SourceNotificationResolutionFailure resolution failed"),
				code: "property-resolution-failed",
				operation: "resolve",
				subject: {
					kind: "property",
					name: "SourceNotificationResolutionFailureProperty",
				},
			}),
			expect.objectContaining({
				error: new Error("SourceNotificationResolutionFailure resolution failed"),
				code: "property-resolution-failed",
				operation: "resolve",
				subject: {
					kind: "property",
					name: "SourceNotificationResolutionFailureProperty",
				},
			}),
		]);
	});
	it("keeps a failed property resolution dirty and recovers its last successful cache", () => {
		const { property, sourceType, throwOnResolve, allowResolve } =
			createResolutionFailureFixture("RecoverableResolutionFailure");
		const { reporter, reports } = createTestReporter();
		const agent = new AgentState(undefined, { reporter });
		const source = agent.addSource(sourceType, 1)!;

		throwOnResolve();
		expect(() => source.set(2)).not.toThrow();
		// The cache deliberately remains at the last successful resolution.
		expect(agent.get(property)).toBe(1);

		allowResolve();
		agent.batch(() => {});
		expect(agent.get(property)).toBe(2);
		expect(reports).toHaveLength(1);
	});
});
