import { describe, expect, it, vi } from "vitest";
import {
	AgentState,
	contributeModifier,
	createTestReporter,
	defineNumberProperty,
	defineSourceType,
	type Property,
} from "../src/index.js";

describe("agent state", () => {
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
});
