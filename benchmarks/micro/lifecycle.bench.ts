import { AgentState, type Descriptor, type Source } from "../../src/index.js";
import { createBench, HEAVY_BENCH_OPTIONS, runBench } from "../shared/bench.js";
import {
	createDescriptorFixture,
	createNumberSourceFixture,
	createSourceType,
} from "../shared/fixtures.js";

const sourceLifecycle = createBench("Source lifecycle");

{
	const agent = new AgentState(undefined);
	const type = createSourceType();
	let source: Source<undefined> | undefined;

	sourceLifecycle.add(
		"add / no modifiers",
		() => {
			source = agent.addSource(type);
		},
		{
			async: false,
			afterEach() {
				source?.destroy();
				source = undefined;
			},
		}
	);
}

{
	const { agent, type } = createNumberSourceFixture();
	let source: Source<number> | undefined;

	sourceLifecycle.add(
		"add / one modifier",
		() => {
			source = agent.addSource(type, 1);
		},
		{
			async: false,
			afterEach() {
				source?.destroy();
				source = undefined;
			},
		}
	);
}

{
	const { agent, type } = createNumberSourceFixture();
	let source: Source<number>;
	let value = 1;

	sourceLifecycle.add(
		"update / one modifier",
		() => {
			value = value === 1 ? 2 : 1;
			source.set(value);
		},
		{
			async: false,
			beforeAll() {
				source = agent.addSource(type, value)!;
			},
			afterAll() {
				agent.destroyAllSources();
			},
		}
	);
}

{
	const { agent, type } = createNumberSourceFixture();
	let source: Source<number>;

	sourceLifecycle.add(
		"destroy / one modifier",
		() => {
			source.destroy();
		},
		{
			async: false,
			beforeEach() {
				source = agent.addSource(type, 1)!;
			},
			afterAll() {
				agent.destroyAllSources();
			},
		}
	);
}

runBench(sourceLifecycle);

const descriptorLifecycle = createBench("Descriptor lifecycle");

{
	const { agent, descriptorType } = createDescriptorFixture();
	let descriptor: Descriptor<number, number> | undefined;

	descriptorLifecycle.add(
		"add",
		() => {
			descriptor = agent.addDescriptor(descriptorType, 1);
		},
		{
			async: false,
			afterEach() {
				descriptor?.destroy();
				descriptor = undefined;
			},
		}
	);
}

{
	const { agent, descriptorType } = createDescriptorFixture();
	let descriptor: Descriptor<number, number>;
	let value = 1;

	descriptorLifecycle.add(
		"update",
		() => {
			value = value === 1 ? 2 : 1;
			descriptor.set(value);
		},
		{
			async: false,
			beforeAll() {
				descriptor = agent.addDescriptor(descriptorType, value)!;
			},
			afterAll() {
				agent.destroyAllDescriptors();
			},
		}
	);
}

{
	const { agent, descriptorType } = createDescriptorFixture();
	let descriptor: Descriptor<number, number>;

	descriptorLifecycle.add(
		"destroy",
		() => {
			descriptor.destroy();
		},
		{
			async: false,
			beforeEach() {
				descriptor = agent.addDescriptor(descriptorType, 1)!;
			},
			afterAll() {
				agent.destroyAllDescriptors();
			},
		}
	);
}

runBench(descriptorLifecycle);

const batchResolution = createBench("Source insertion batching", HEAVY_BENCH_OPTIONS);

for (const size of [10, 100, 1_000] as const) {
	for (const batched of [false, true]) {
		const { agent, type } = createNumberSourceFixture();
		const addSources = () => {
			for (let i = 0; i < size; i++) agent.addSource(type, 1);
		};

		batchResolution.add(
			`${batched ? "batched" : "unbatched"} / ${size} sources`,
			() => {
				if (batched) agent.batch(addSources);
				else addSources();
			},
			{
				async: false,
				afterEach() {
					agent.destroyAllSources();
				},
			}
		);
	}
}

runBench(batchResolution);
