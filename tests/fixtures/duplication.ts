import { vi } from "vitest";
import {
	AgentState,
	defineDescriptorType,
	defineNumberProperty,
	defineSourceType,
	testReporter,
	type Descriptor,
	type DuplicatePolicy,
	type Source,
} from "../src/index.js";

/** Public inputs shared by the source duplication-policy tests. */
export function createSourceDuplicationFixture(
	duplication?: DuplicatePolicy<Source<number>, number>
) {
	const Property = defineNumberProperty({ name: "SourceDuplicationProperty", defaultValue: 0 });
	const SourceType = defineSourceType<number>({
		name: "SourceDuplicationSource",
		priority: 100,
		contribute: (value) => [Property.add(value)],
		...(duplication === undefined ? {} : { duplication }),
	});
	const agent = new AgentState(undefined, testReporter);

	return { agent, Property, SourceType };
}

/**
 * Configures the ordinary descriptor-to-source binding used by duplication tests.
 * Callers can assert teardown through the returned spy without depending on binding internals.
 */
export function createDescriptorDuplicationFixture(
	duplication?: DuplicatePolicy<Descriptor<number, number>, number>
) {
	const Property = defineNumberProperty({
		name: "DescriptorDuplicationProperty",
		defaultValue: 0,
	});
	const SourceType = defineSourceType<number>({
		name: "DescriptorDuplicationSource",
		priority: 100,
		contribute: (value) => [Property.add(value)],
	});
	const DescriptorType = defineDescriptorType<number, number>({
		name: "DescriptorDuplicationDescriptor",
		source: SourceType,
		...(duplication === undefined ? {} : { duplication }),
		replication: {
			serialize: (value) => value,
			deserialize: (value) => {
				if (typeof value !== "number") throw new Error("Expected a number");
				return value;
			},
		},
	});
	const agent = new AgentState(undefined, testReporter);
	const bindingDestroyed = vi.fn();

	agent.registerDescriptorHandler(DescriptorType, (ctx, data) => {
		const source = ctx.addSource(data)!;
		return {
			source,
			update(value) {
				source.set(value);
			},
			destroy() {
				bindingDestroyed();
				source.destroy();
			},
		};
	});

	return { agent, bindingDestroyed, DescriptorType, Property, SourceType };
}
