import {
	contributeModifier,
	defineNumberProperty,
	defineSourceType,
	type Property,
} from "../src/index.js";

export function createResolutionFailureFixture(name: string) {
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

export const Poison = defineNumberProperty({
	name: "Poison",
	defaultValue: 0,
});

export interface PoisonData {
	intensity: number;
}

export const PoisonSource = defineSourceType<PoisonData>({
	name: "Poison",
	priority: 100,

	contribute: (data) => [Poison.add(data.intensity)],
});
