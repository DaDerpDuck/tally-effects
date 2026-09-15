import { describe, expect, it } from "vitest";
import type { ModifierOrder } from "../../src/tally/modifier/ModifierOrder.js";
import { ModifierRegistry } from "../../src/tally/modifier/ModifierRegistry.js";
import { OrderingDomain } from "../../src/tally/modifier/OrderingDomain.js";
import {
	AgentState,
	contributeModifier,
	defineSourceType,
	registerProperty,
	resolvePropertyDefinition,
	type Modifier,
	type Property,
	type PropertyDefinition,
	type Registrable,
	type Registry,
	type ResolvedPropertyDefinition,
	testReporter,
} from "../src/index.js";

interface CustomModifier extends Modifier<object | undefined> {
	operation: "set";
	value: object;
}

class CustomProperty implements Property<object | undefined, CustomModifier>, Registrable {
	readonly name: string;
	readonly defaultValue: object | undefined;

	constructor(
		private readonly definition: ResolvedPropertyDefinition<object | undefined, CustomModifier>
	) {
		this.name = definition.name;
		this.defaultValue = definition.defaultValue;
	}

	valueEquals(a: object | undefined, b: object | undefined): boolean {
		return Object.is(a, b);
	}

	resolve(base: object | undefined, modifiers: readonly CustomModifier[]): object | undefined {
		return this.definition.resolve(base, modifiers);
	}

	register(registry: Registry): void {
		registerProperty(registry, this);
	}

	set(v: object) {
		return contributeModifier({
			property: this,
			operation: "set",
			value: v,
		});
	}

	unset() {
		return contributeModifier({
			property: this,
			operation: "set",
			value: undefined,
		});
	}
}

function defaultCustomResolve(
	base: object | undefined,
	modifiers: readonly CustomModifier[]
): object | undefined {
	let final = base;

	for (const modifier of modifiers) {
		switch (modifier.operation) {
			case "set":
				final = modifier.value;
				break;
		}
	}

	return final;
}

function defineCustomProperty(definition: PropertyDefinition<object | undefined, CustomModifier>) {
	return new CustomProperty(
		resolvePropertyDefinition(definition, {
			resolve: defaultCustomResolve,
			valueEquals: Object.is,
		})
	);
}

const Custom = defineCustomProperty({
	name: "Custom",
	defaultValue: {
		foo: "bar",
	},
});

const CustomSource = defineSourceType<boolean>({
	name: "PropSource",
	priority: 100,
	contribute: (data) => [data ? Custom.set({ test: "bar" }) : Custom.unset()],
	duplication: { policy: "allow" },
});

const defaultOrder: ModifierOrder = {
	priority: 0,
	domain: OrderingDomain.local,
	sequence: 0,
	modifierIndex: 0,
};

function resolve(registry: ModifierRegistry, base: object | undefined) {
	return Custom.resolve(base, registry.get(Custom));
}

describe("custom property", () => {
	it("resolves custom property correctly", () => {
		const registry = new ModifierRegistry();
		Custom.set({ test: "bar" }).applyTo(registry, defaultOrder);
		const result = resolve(registry, undefined);
		expect(result).toEqual({ test: "bar" });
	});

	it("unsets custom property correctly", () => {
		const registry = new ModifierRegistry();
		Custom.unset().applyTo(registry, defaultOrder);
		const result = resolve(registry, undefined);
		expect(result).toBe(undefined);
	});

	it("agent resolves custom property correctly", () => {
		const agent = new AgentState(undefined, testReporter);
		expect(agent.get(Custom)).toEqual({ foo: "bar" });

		const source1 = agent.addSource(CustomSource, true)!;
		expect(source1).toBeDefined();
		expect(agent.get(Custom)).toEqual({ test: "bar" });
	});

	it("agent resolves undefined property correctly", () => {
		const agent = new AgentState(undefined, testReporter);
		expect(agent.get(Custom)).toEqual({ foo: "bar" });

		const source1 = agent.addSource(CustomSource, false)!;
		expect(source1).toBeDefined();
		expect(agent.get(Custom)).toBe(undefined);
	});
});
