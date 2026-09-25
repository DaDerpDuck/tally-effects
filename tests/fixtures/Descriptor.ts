import { vi } from "vitest";
import {
	AgentState,
	contributeModifier,
	defineDescriptorType,
	defineNumberProperty,
	defineSourceType,
	DescriptorType,
	type Property,
	TallyContext,
	testReporter,
} from "../src/index.js";

export interface DescriptorData {
	value: number;
}

export const Value = defineNumberProperty({ name: "DescriptorValue", defaultValue: 0 });

export const DescriptorSource = defineSourceType<DescriptorData>({
	name: "DescriptorSource",
	priority: 100,
	contribute: (data) => [Value.add(data.value)],
});

export const ValueDescriptor = defineDescriptorType<DescriptorData, DescriptorData>({
	name: "ValueDescriptor",
	source: DescriptorSource,
	replication: {
		serialize: (data) => data.value,
		deserialize: (value) => {
			if (typeof value !== "number")
				throw new Error("Expected descriptor value to be a number");
			return { value };
		},
	},
});

export function registerHandler(
	agent: AgentState<undefined> | TallyContext<undefined>,
	descriptorType: DescriptorType<DescriptorData, DescriptorData> = ValueDescriptor,
	onDestroy = vi.fn()
) {
	agent.registerDescriptorHandler(descriptorType, (ctx, data) => {
		const source = ctx.addSource({ value: data.value })!;

		return {
			source,
			update(data) {
				source.set(data);
			},
			destroy() {
				onDestroy();
				source.destroy();
			},
		};
	});

	return onDestroy;
}

export function createAgentFixture() {
	const agent = new AgentState<undefined>(undefined, { reporter: testReporter });
	const bindingDestroyed = registerHandler(agent);
	return { agent, bindingDestroyed };
}

export function createResolutionFailureSourceType(name: string) {
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
		sourceType,
		throwOnResolve() {
			shouldThrow = true;
		},
	};
}
