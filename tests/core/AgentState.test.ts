import { describe, expect, it, vi } from "vitest";
import {
	AgentState,
	contributeModifier,
	createTestReporter,
	defineBooleanProperty,
	defineDescriptorType,
	defineNumberProperty,
	defineSourceType,
	testReporter,
	type Property,
	type ModifierContribution,
} from "../src/index.js";

function createResolutionFailureFixture(name: string) {
	let shouldThrow = false;
	const property: Property<number> = {
		name: `${name}Property`,
		defaultValue: 0,
		valueEquals: Object.is,
		resolve(base, modifiers) {
			if (shouldThrow) throw new Error(`${name} resolution failed`);
			return modifiers.reduce((value, modifier) => value + (modifier.value as number), base);
		},
	};
	const sourceType = defineSourceType<number>({
		name: `${name}Source`,
		priority: 100,
		contribute: (value) => [contributeModifier({ property, operation: "add", value })],
	});

	return {
		property,
		sourceType,
		throwOnResolve() {
			shouldThrow = true;
		},
		allowResolve() {
			shouldThrow = false;
		},
	};
}

describe("agent state", () => {
	const Poison = defineNumberProperty({
		name: "Poison",
		defaultValue: 0,
	});

	interface PoisonData {
		intensity: number;
	}

	const PoisonSource = defineSourceType<PoisonData>({
		name: "Poison",
		priority: 100,

		contribute: (data) => [Poison.add(data.intensity)],
	});

	it("adds source", () => {
		const agent = new AgentState(undefined, { reporter: testReporter });
		expect(agent.get(Poison)).toBe(0);

		const source = agent.addSource(PoisonSource, { intensity: 5 });
		expect(source).toBeDefined();
		expect(agent.get(Poison)).toBe(5);
	});

	it("resolves source with falsy cache (number)", () => {
		const agent = new AgentState(undefined, { reporter: testReporter });
		expect(agent.get(Poison)).toBe(0);

		const source = agent.addSource(PoisonSource, { intensity: 5 })!;
		expect(agent.get(Poison)).toBe(5);

		source.set({ intensity: 0 });
		expect(agent.get(Poison)).toBe(0);

		source.set({ intensity: 5 });
		expect(agent.get(Poison)).toBe(5);

		source.destroy();
		expect(agent.get(Poison)).toBe(0);
	});

	it("resolves source with falsy cache (boolean)", () => {
		const BooleanProp = defineBooleanProperty({ name: "Boolean", defaultValue: false });

		const BooleanSource = defineSourceType<boolean>({
			name: "BooleanSource",
			priority: 100,
			contribute: (data) => [BooleanProp.toggle(data)],
		});

		const agent = new AgentState(undefined, { reporter: testReporter });
		expect(agent.get(BooleanProp)).toBe(false);

		const source = agent.addSource(BooleanSource, true)!;
		expect(agent.get(BooleanProp)).toBe(true);

		source.set(false);
		expect(agent.get(BooleanProp)).toBe(false);

		source.set(true);
		expect(agent.get(BooleanProp)).toBe(true);

		source.destroy();
		expect(agent.get(BooleanProp)).toBe(false);
	});

	it("handles dynamic source contribution shape", () => {
		const Prop1 = defineNumberProperty({ name: "Prop1", defaultValue: 10 });
		const Prop2 = defineNumberProperty({ name: "Prop2", defaultValue: 20 });

		const PropSource = defineSourceType<boolean>({
			name: "PropSource",
			priority: 100,
			contribute(data) {
				if (data) return [Prop1.add(1), Prop2.add(1)];
				else return [Prop1.add(1)];
			},
		});

		const agent = new AgentState(undefined, { reporter: testReporter });
		expect(agent.get(Prop1)).toBe(10);
		expect(agent.get(Prop2)).toBe(20);

		const source = agent.addSource(PropSource, true)!;
		expect(agent.get(Prop1)).toBe(11);
		expect(agent.get(Prop2)).toBe(21);

		source.set(false);
		expect(agent.get(Prop1)).toBe(11);
		expect(agent.get(Prop2)).toBe(20);

		source.destroy();
		expect(agent.get(Prop1)).toBe(10);
		expect(agent.get(Prop2)).toBe(20);
	});

	it("handles duplicate source identities", () => {
		const NumProp = defineNumberProperty({ name: "NumProp", defaultValue: 0 });

		const PropSource = defineSourceType<number>({
			name: "PropSource",
			priority: 100,
			contribute: (data) => [NumProp.add(data)],
			duplication: { policy: "allow" },
		});

		const agent = new AgentState(undefined, { reporter: testReporter });
		expect(agent.get(NumProp)).toBe(0);

		const source1 = agent.addSource(PropSource, 1)!;
		expect(source1).toBeDefined();
		expect(agent.get(NumProp)).toBe(1);

		const source2 = agent.addSource(PropSource, 10)!;
		expect(source2).toBeDefined();
		expect(agent.get(NumProp)).toBe(11);

		const source3 = agent.addSource(PropSource, 100)!;
		expect(source3).toBeDefined();
		expect(agent.get(NumProp)).toBe(111);

		source2.set(20);
		expect(agent.get(NumProp)).toBe(121);

		source1.set(2);
		expect(agent.get(NumProp)).toBe(122);

		source3.set(200);
		expect(agent.get(NumProp)).toBe(222);
	});

	it("uses Object.is as the default source data equality", () => {
		const SourceType = defineSourceType<{ value: number }>({
			name: "DefaultSourceEquality",
			priority: 100,
			contribute: () => [],
		});
		const agent = new AgentState(undefined, { reporter: testReporter });
		const initial = { value: 1 };
		const source = agent.addSource(SourceType, initial)!;
		const updated = vi.fn();
		source.onUpdate(updated);

		source.set(initial);
		expect(updated).not.toHaveBeenCalled();

		source.set({ value: 1 });
		expect(updated).toHaveBeenCalledTimes(1);
	});

	it("uses custom source data equality to suppress updates", () => {
		const SourceType = defineSourceType<{ value: number; label: string }>({
			name: "CustomSourceEquality",
			priority: 100,
			contribute: () => [],
			dataEquals: (a, b) => a.value === b.value,
		});
		const agent = new AgentState(undefined, { reporter: testReporter });
		const source = agent.addSource(SourceType, { value: 1, label: "first" })!;
		const updated = vi.fn();
		source.onUpdate(updated);

		source.set({ value: 1, label: "second" });
		expect(updated).not.toHaveBeenCalled();

		source.set({ value: 2, label: "second" });
		expect(updated).toHaveBeenCalledTimes(1);
	});

	it("throws and restores the prior Source state when contribution or modifier application fails", () => {
		const Property = defineNumberProperty({
			name: "SourceSetFailureProperty",
			defaultValue: 0,
		});
		const throwingModifier: ModifierContribution = {
			applyTo() {
				throw new Error("modifier application failed");
			},
		};
		const SourceType = defineSourceType<number>({
			name: "SourceSetFailure",
			priority: 100,
			contribute(value) {
				if (value === 2) throw new Error("contribution failed");
				if (value === 3) return [throwingModifier];
				return [Property.add(value)];
			},
		});
		const agent = new AgentState(undefined, { reporter: testReporter });
		const source = agent.addSource(SourceType, 1)!;
		const updated = vi.fn();
		source.onUpdate(updated);

		expect(() => source.set(2)).toThrow("contribution failed");
		expect(source.get()).toBe(1);
		expect(agent.get(Property)).toBe(1);

		expect(() => source.set(3)).toThrow("modifier application failed");
		expect(source.get()).toBe(1);
		expect(agent.get(Property)).toBe(1);
		expect(updated).not.toHaveBeenCalled();
	});

	it("propagates source equality failures without changing the source", () => {
		const SourceType = defineSourceType<number>({
			name: "ThrowingSourceEquality",
			priority: 100,
			contribute: () => [],
			dataEquals() {
				throw new Error("source equality failed");
			},
		});
		const agent = new AgentState(undefined, { reporter: testReporter });
		const source = agent.addSource(SourceType, 1)!;

		expect(() => source.set(2)).toThrow("source equality failed");
		expect(source.get()).toBe(1);
	});

	it("reports property equality failures while preserving the last successful cache", () => {
		let shouldThrow = false;
		const property: Property<number> = {
			name: "ThrowingPropertyEquality",
			defaultValue: 0,
			resolve(base, modifiers) {
				return modifiers.reduce(
					(value, modifier) => value + (modifier.value as number),
					base
				);
			},
			valueEquals(a, b) {
				if (shouldThrow) throw new Error("property equality failed");
				return Object.is(a, b);
			},
		};
		const SourceType = defineSourceType<number>({
			name: "ThrowingPropertyEqualitySource",
			priority: 100,
			contribute: (value) => [contributeModifier({ property, operation: "add", value })],
		});
		const { reporter, reports } = createTestReporter();
		const agent = new AgentState(undefined, { reporter });
		const source = agent.addSource(SourceType, 1)!;

		shouldThrow = true;
		expect(() => source.set(2)).not.toThrow();
		expect(source.get()).toBe(2);
		expect(agent.get(property)).toBe(1);
		expect(reports).toEqual([
			expect.objectContaining({
				error: new Error("property equality failed"),
				code: "property-equality-failed",
				operation: "resolve",
				subject: { kind: "property", name: "ThrowingPropertyEquality" },
			}),
		]);

		shouldThrow = false;
		agent.batch(() => {});
		expect(agent.get(property)).toBe(2);
	});

	it("contains property equality failures during Source teardown", () => {
		let shouldThrow = false;
		const property: Property<number> = {
			name: "TeardownPropertyEquality",
			defaultValue: 0,
			resolve: (base, modifiers) =>
				modifiers.reduce((value, modifier) => value + (modifier.value as number), base),
			valueEquals(a, b) {
				if (shouldThrow) throw new Error("teardown equality failed");
				return Object.is(a, b);
			},
		};
		const SourceType = defineSourceType<number>({
			name: "TeardownPropertyEqualitySource",
			priority: 100,
			contribute: (value) => [contributeModifier({ property, operation: "add", value })],
		});
		const { reporter, reports } = createTestReporter();
		const agent = new AgentState(undefined, { reporter });
		const source = agent.addSource(SourceType, 1)!;

		shouldThrow = true;
		expect(() => source.destroy()).not.toThrow();
		expect(agent.getSources(SourceType)).toEqual(new Set());
		expect(reports).toEqual([
			expect.objectContaining({
				error: new Error("teardown equality failed"),
				code: "property-equality-failed",
				operation: "resolve",
				subject: {
					kind: "property",
					name: "TeardownPropertyEquality",
				},
			}),
		]);
	});

	it("contains property equality failures during batched Source teardown", () => {
		let shouldThrow = false;
		const property: Property<number> = {
			name: "TeardownPropertyEquality",
			defaultValue: 0,
			resolve: (base, modifiers) =>
				modifiers.reduce((value, modifier) => value + (modifier.value as number), base),
			valueEquals(a, b) {
				if (shouldThrow) throw new Error("teardown equality failed");
				return Object.is(a, b);
			},
		};
		const SourceType = defineSourceType<number>({
			name: "TeardownPropertyEqualitySource",
			priority: 100,
			contribute: (value) => [contributeModifier({ property, operation: "add", value })],
		});
		const { reporter, reports } = createTestReporter();
		const agent = new AgentState(undefined, { reporter });
		const source = agent.addSource(SourceType, 1)!;

		shouldThrow = true;
		expect(() => agent.batch(() => source.destroy())).not.toThrow();
		expect(agent.getSources(SourceType)).toEqual(new Set());
		expect(reports).toEqual([
			expect.objectContaining({
				error: new Error("teardown equality failed"),
				code: "property-equality-failed",
				operation: "resolve",
				subject: {
					kind: "property",
					name: "TeardownPropertyEquality",
				},
			}),
		]);
	});

	it("reports update equality failures during an unrelated batched Source teardown", () => {
		let shouldThrow = false;
		const updatedProperty: Property<number> = {
			name: "UpdatedPropertyEquality",
			defaultValue: 0,
			resolve: (base, modifiers) =>
				modifiers.reduce((value, modifier) => value + (modifier.value as number), base),
			valueEquals(a, b) {
				if (shouldThrow) throw new Error("updated property equality failed");
				return Object.is(a, b);
			},
		};
		const teardownProperty = defineNumberProperty({
			name: "UnrelatedTeardownProperty",
			defaultValue: 0,
		});
		const UpdatedSource = defineSourceType<number>({
			name: "UpdatedPropertyEqualitySource",
			priority: 100,
			contribute: (value) => [
				contributeModifier({ property: updatedProperty, operation: "add", value }),
			],
		});
		const TeardownSource = defineSourceType<number>({
			name: "UnrelatedTeardownSource",
			priority: 100,
			contribute: (value) => [teardownProperty.add(value)],
		});
		const { reporter, reports } = createTestReporter();
		const agent = new AgentState(undefined, { reporter });
		const updated = agent.addSource(UpdatedSource, 1)!;
		const tornDown = agent.addSource(TeardownSource, 1)!;

		shouldThrow = true;
		expect(() =>
			agent.batch(() => {
				updated.set(2);
				tornDown.destroy();
			})
		).not.toThrow();

		expect(updated.get()).toBe(2);
		expect(agent.get(updatedProperty)).toBe(1);
		expect(agent.getSources(TeardownSource)).toEqual(new Set());
		expect(reports).toEqual([
			expect.objectContaining({
				error: new Error("updated property equality failed"),
				code: "property-equality-failed",
				operation: "resolve",
				subject: { kind: "property", name: "UpdatedPropertyEquality" },
			}),
		]);
	});

	it("retries failed equality resolution while completing Source teardown", () => {
		let shouldThrow = false;
		const throwingProperty: Property<number> = {
			name: "ThrowingTeardownProperty",
			defaultValue: 0,
			resolve: (base, modifiers) =>
				modifiers.reduce((value, modifier) => value + (modifier.value as number), base),
			valueEquals(a, b) {
				if (shouldThrow) throw new Error("teardown equality failed");
				return Object.is(a, b);
			},
		};

		const ThrowingSource = defineSourceType<number>({
			name: "ThrowingTeardownSource",
			priority: 100,
			contribute: (value) => [
				contributeModifier({ property: throwingProperty, operation: "add", value }),
			],
		});

		const unrelatedProperty = defineNumberProperty({
			name: "UnrelatedTeardownProperty",
			defaultValue: 0,
		});
		const UnrelatedSource = defineSourceType<number>({
			name: "UnrelatedTeardownSource",
			priority: 100,
			contribute: (value) => [unrelatedProperty.add(value)],
		});

		const { reporter, reports } = createTestReporter();
		const agent = new AgentState(undefined, { reporter });
		const first = agent.addSource(ThrowingSource, 1)!;
		const second = agent.addSource(UnrelatedSource, 1)!;
		const secondDestroyed = vi.fn();
		second.onDestroy(secondDestroyed);

		shouldThrow = true;
		expect(() => first.destroy()).not.toThrow();

		// Retries the still-dirty first Property while tearing down `second`.
		expect(() => second.destroy()).not.toThrow();

		expect(secondDestroyed).toHaveBeenCalledWith(second);
		expect(agent.getSources(UnrelatedSource)).toEqual(new Set());
		expect(reports).toHaveLength(2);
		expect(reports).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "property-equality-failed",
					subject: { kind: "property", name: "ThrowingTeardownProperty" },
				}),
			])
		);
	});

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

	it("throws when mutating a destroyed source", () => {
		const agent = new AgentState(undefined, { reporter: testReporter });
		const source = agent.addSource(PoisonSource, { intensity: 5 })!;

		source.destroy();

		expect(() => source.set({ intensity: 10 })).toThrow();
		expect(source.get()).toEqual({ intensity: 5 });
	});

	it("allows inert source callbacks after destruction", () => {
		const agent = new AgentState(undefined, { reporter: testReporter });
		const source = agent.addSource(PoisonSource, { intensity: 5 })!;
		source.destroy();

		const updated = vi.fn();
		const destroyed = vi.fn();
		const disconnectUpdate = source.onUpdate(updated);
		const disconnectDestroy = source.onDestroy(destroyed);

		expect(() => source.destroy()).not.toThrow();
		expect(updated).not.toHaveBeenCalled();
		expect(destroyed).not.toHaveBeenCalled();
		expect(() => disconnectUpdate()).not.toThrow();
		expect(() => disconnectDestroy()).not.toThrow();
	});

	it("rejects AgentState mutations after destruction while keeping reads and callbacks safe", () => {
		const agent = new AgentState(undefined, { reporter: testReporter });
		agent.addSource(PoisonSource, { intensity: 5 });
		agent.destroy();

		expect(agent.get(Poison)).toBe(0);
		expect(agent.getSources()).toEqual(new Set());
		expect(agent.hasSource(PoisonSource)).toBe(false);

		const added = vi.fn();
		const changed = vi.fn();
		const destroyed = vi.fn();
		const disconnectAdded = agent.onSourceAdded(added);
		const disconnectChanged = agent.onPropertyChanged(Poison, changed);
		const disconnectDestroyed = agent.onDestroy(destroyed);

		expect(() => agent.addSource(PoisonSource, { intensity: 10 })).toThrow();
		expect(() => agent.destroy()).not.toThrow();
		expect(added).not.toHaveBeenCalled();
		expect(changed).not.toHaveBeenCalled();
		expect(destroyed).not.toHaveBeenCalled();
		expect(() => disconnectAdded()).not.toThrow();
		expect(() => disconnectChanged()).not.toThrow();
		expect(() => disconnectDestroyed()).not.toThrow();
	});

	it("has property observation on source add", () => {
		const agent = new AgentState(undefined, { reporter: testReporter });
		const callback = vi.fn();

		agent.onPropertyChanged(Poison, callback);
		agent.addSource(PoisonSource, { intensity: 5 });

		expect(callback).toHaveBeenCalledWith(5, 0);
	});

	it("has property observation on source set", () => {
		const agent = new AgentState(undefined, { reporter: testReporter });
		const callback = vi.fn();

		agent.onPropertyChanged(Poison, callback);

		const poisonSource = agent.addSource(PoisonSource, { intensity: 5 })!;
		expect(callback).toHaveBeenCalledTimes(1);
		expect(callback).toHaveBeenCalledWith(5, 0);

		poisonSource.set({ intensity: 2 });
		expect(callback).toHaveBeenCalledTimes(2);
		expect(callback).toHaveBeenCalledWith(2, 5);
	});

	it("has no-op property observation on source set", () => {
		const agent = new AgentState(undefined, { reporter: testReporter });
		const callback = vi.fn();

		agent.onPropertyChanged(Poison, callback);

		const poisonSource = agent.addSource(PoisonSource, { intensity: 5 })!;
		expect(callback).toHaveBeenCalledTimes(1);
		expect(callback).toHaveBeenCalledWith(5, 0);

		poisonSource.set({ intensity: 5 });
		expect(callback).toHaveBeenCalledTimes(1);
	});

	it("uses property value equality only for change notifications", () => {
		const Property = defineNumberProperty({
			name: "ApproximatePropertyEquality",
			defaultValue: 0,
			valueEquals: (a, b) => Math.floor(a) === Math.floor(b),
		});
		const SourceType = defineSourceType<number>({
			name: "ApproximatePropertySource",
			priority: 100,
			contribute: (value) => [Property.override(value)],
		});
		const agent = new AgentState(undefined, { reporter: testReporter });
		const changed = vi.fn();
		agent.onPropertyChanged(Property, changed);
		const source = agent.addSource(SourceType, 1.1)!;
		expect(changed).toHaveBeenCalledTimes(1);

		source.set(1.2);
		expect(agent.get(Property)).toBe(1.2);
		expect(changed).toHaveBeenCalledTimes(1);

		source.set(2.1);
		expect(agent.get(Property)).toBe(2.1);
		expect(changed).toHaveBeenCalledTimes(2);
	});

	it("has property observation on source destroy", () => {
		const agent = new AgentState(undefined, { reporter: testReporter });
		const callback = vi.fn();

		agent.onPropertyChanged(Poison, callback);

		const poisonSource = agent.addSource(PoisonSource, { intensity: 5 })!;
		expect(callback).toHaveBeenCalledTimes(1);
		expect(callback).toHaveBeenCalledWith(5, 0);

		poisonSource.destroy();
		expect(callback).toHaveBeenCalledTimes(2);
		expect(callback).toHaveBeenCalledWith(0, 5);
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

	it("disconnects source observation", () => {
		const agent = new AgentState(undefined, { reporter: testReporter });
		const callback = vi.fn();

		const disconnect = agent.onPropertyChanged(Poison, callback);
		disconnect();
		agent.addSource(PoisonSource, { intensity: 5 });

		expect(callback).toHaveBeenCalledTimes(0);
	});

	it("checks has source", () => {
		const agent = new AgentState(undefined, { reporter: testReporter });
		expect(agent.hasSource(PoisonSource)).toBe(false);

		const source = agent.addSource(PoisonSource, { intensity: 100 })!;
		expect(agent.hasSource(PoisonSource)).toBe(true);

		source.destroy();
		expect(agent.hasSource(PoisonSource)).toBe(false);
	});

	it("assigns unique monotonic source ids within an agent", () => {
		const agent = new AgentState(undefined, { reporter: testReporter });
		const SourceType = defineSourceType<undefined>({
			name: "IdentifiedSource",
			priority: 100,
			contribute: () => [],
		});

		const source1 = agent.addSource(SourceType)!;
		const source2 = agent.addSource(SourceType)!;
		const source3 = agent.addSource(SourceType)!;

		expect([source1.id, source2.id, source3.id]).toEqual([0, 1, 2]);
	});

	it("removes destroyed sources from unfiltered getSources", () => {
		const agent = new AgentState(undefined, { reporter: testReporter });
		const SourceTypeA = defineSourceType<undefined>({
			name: "SourceA",
			priority: 100,
			contribute: () => [],
		});
		const SourceTypeB = defineSourceType<undefined>({
			name: "SourceB",
			priority: 100,
			contribute: () => [],
		});

		const source1 = agent.addSource(SourceTypeA)!;
		const source2 = agent.addSource(SourceTypeB)!;
		const source3 = agent.addSource(SourceTypeA)!;

		expect(agent.getSources()).toEqual(new Set([source1, source2, source3]));

		source2.destroy();
		expect(agent.getSources()).toEqual(new Set([source1, source3]));
	});

	it("destroyAllSources removes all source state and restores defaults", () => {
		const Property = defineNumberProperty({ name: "DestroyAllProperty", defaultValue: 10 });
		const SourceTypeA = defineSourceType<number>({
			name: "DestroyAllSourceA",
			priority: 0,
			contribute: (value) => [Property.add(value)],
		});
		const SourceTypeB = defineSourceType<number>({
			name: "DestroyAllSourceB",
			priority: 100,
			contribute: (value) => [Property.multiply(value)],
		});
		const agent = new AgentState(undefined, { reporter: testReporter });

		agent.addSource(SourceTypeA, 5);
		agent.addSource(SourceTypeB, 2);
		expect(agent.get(Property)).toBe(30);

		agent.destroyAllSources();

		expect(agent.getSources()).toEqual(new Set());
		expect(agent.hasSource(SourceTypeA)).toBe(false);
		expect(agent.hasSource(SourceTypeB)).toBe(false);
		expect(agent.get(Property)).toBe(10);
	});

	it("settles all Sources and Descriptors when AgentState destruction encounters errors", () => {
		const FirstSourceType = defineSourceType<undefined>({
			name: "AgentDestroyThrowingFirstSource",
			priority: 100,
			contribute: () => [],
		});
		const SecondSourceType = defineSourceType<undefined>({
			name: "AgentDestroySecondSource",
			priority: 100,
			contribute: () => [],
		});
		const DescriptorOutput = defineSourceType<undefined>({
			name: "AgentDestroyDescriptorOutput",
			priority: 100,
			contribute: () => [],
		});
		const DescriptorType = defineDescriptorType<undefined, undefined>({
			name: "AgentDestroyDescriptor",
			source: DescriptorOutput,
		});
		const agent = new AgentState(undefined, { reporter: testReporter });
		agent.registerDescriptorHandler(DescriptorType, (ctx) => {
			const source = ctx.addSource(undefined)!;
			return {
				source,
				update: () => {},
				destroy: () => source.destroy(),
			};
		});
		const first = agent.addSource(FirstSourceType)!;
		const second = agent.addSource(SecondSourceType)!;
		const descriptor = agent.addDescriptor(DescriptorType, undefined)!;
		first.onDestroy(() => {
			throw new Error("first source destroy failed");
		});

		expect(() => agent.destroy()).not.toThrow();
		expect(agent.getSources()).toEqual(new Set());
		expect(agent.getDescriptors()).toEqual(new Set());
		expect(() => second.set(undefined)).toThrow("Source has been destroyed");
		expect(() => descriptor.set(undefined)).toThrow("Descriptor has been destroyed");
	});

	it("destroys Descriptors after a Source teardown resolution failure", () => {
		const { sourceType, throwOnResolve } = createResolutionFailureFixture(
			"AgentDestroyResolutionFailure"
		);
		const DescriptorOutput = defineSourceType<undefined>({
			name: "AgentDestroyResolutionFailureDescriptorOutput",
			priority: 100,
			contribute: () => [],
		});
		const DescriptorType = defineDescriptorType<undefined, undefined>({
			name: "AgentDestroyResolutionFailureDescriptor",
			source: DescriptorOutput,
		});
		const { reporter, reports } = createTestReporter();
		const agent = new AgentState(undefined, { reporter });
		agent.registerDescriptorHandler(DescriptorType, (context) => {
			const source = context.addSource(undefined)!;
			return { source, update: () => {}, destroy: () => source.destroy() };
		});
		agent.addSource(sourceType, 1);
		agent.addDescriptor(DescriptorType, undefined);

		throwOnResolve();
		expect(() => agent.destroy()).not.toThrow();
		expect(reports).toEqual([
			expect.objectContaining({
				error: new Error("AgentDestroyResolutionFailure resolution failed"),
				code: "property-resolution-failed",
				operation: "resolve",
				subject: {
					kind: "property",
					name: "AgentDestroyResolutionFailureProperty",
				},
			}),
		]);
		expect(agent.getDescriptors(DescriptorType)).toEqual(new Set());
		expect(agent.getSources(DescriptorOutput)).toEqual(new Set());
	});

	it("does not notify a disconnected property observer more than once", () => {
		const Property = defineNumberProperty({ name: "DisconnectProperty", defaultValue: 0 });
		const SourceType = defineSourceType<number>({
			name: "DisconnectSource",
			priority: 100,
			contribute: (value) => [Property.add(value)],
		});
		const agent = new AgentState(undefined, { reporter: testReporter });
		const callback = vi.fn();
		const disconnect = agent.onPropertyChanged(Property, callback);

		disconnect();
		disconnect();
		agent.addSource(SourceType, 1);

		expect(callback).not.toHaveBeenCalled();
	});
});
