import {
	AgentState,
	defineDescriptorType,
	defineNumberProperty,
	defineSourceType,
	type DescriptorTypeDefinition,
	type DuplicatePolicy,
	type Source,
	type SourceTypeDefinition,
} from "../../src/index.js";
import type { TallyReporter } from "../../src/index.js";

export const benchmarkReporter: TallyReporter = {
	report: () => {},
};

export function createSourceType<TData = undefined>(
	options?: Partial<SourceTypeDefinition<TData>>
) {
	return defineSourceType<TData>({
		name: "BenchmarkSource",
		priority: 0,
		contribute() {
			return [];
		},
		...options,
	});
}

export function createNumberSourceFixture(duplication?: DuplicatePolicy<Source<number>, number>) {
	const property = defineNumberProperty({
		name: "BenchmarkValue",
		defaultValue: 0,
	});
	const type = createSourceType<number>({
		priority: 100,
		contribute: (value) => [property.add(value)],
		...(duplication === undefined ? {} : { duplication }),
	});
	const agent = new AgentState(undefined, benchmarkReporter);

	return { agent, property, type };
}

export function createDescriptorFixture(
	options?: Partial<DescriptorTypeDefinition<number, number>>
) {
	const { agent, property, type: sourceType } = createNumberSourceFixture();
	const descriptorType = defineDescriptorType<number, number>({
		name: "BenchmarkDescriptor",
		source: sourceType,
		...options,
	});

	agent.registerDescriptorHandler(descriptorType, (context, value) => {
		const source = context.addSource(value);
		if (!source) return undefined;

		return {
			source,
			update(nextValue) {
				source.set(nextValue);
			},
			destroy() {
				source.destroy();
			},
		};
	});

	return { agent, descriptorType, property, sourceType };
}
