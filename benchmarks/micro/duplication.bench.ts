import assert from "node:assert/strict";
import {
	AgentState,
	defineDuplicationGroup,
	type Descriptor,
	type Source,
} from "../../src/index.js";
import { addBatchedTask, createBench, HEAVY_BENCH_OPTIONS, runBench } from "../shared/bench.js";
import {
	createDescriptorFixture,
	createNumberSourceFixture,
	createSourceType,
} from "../shared/fixtures.js";

const firstAdmission = createBench("Source duplication: first admission");

for (const policy of ["allow", "ignore", "replace"] as const) {
	const type = createSourceType({ duplication: { policy } });
	const agent = new AgentState(undefined);
	let added: Source<undefined> | undefined;

	firstAdmission.add(
		policy,
		() => {
			added = agent.addSource(type);
		},
		{
			async: false,
			afterEach() {
				added?.destroy();
				added = undefined;
			},
		}
	);
}

{
	const type = createSourceType({
		duplication: { policy: "reconcile", reconcile() {} },
	});
	const agent = new AgentState(undefined);
	let added: Source<undefined> | undefined;

	firstAdmission.add(
		"reconcile",
		() => {
			added = agent.addSource(type);
		},
		{
			async: false,
			afterEach() {
				added?.destroy();
				added = undefined;
			},
		}
	);
}

runBench(firstAdmission);

const conflictingAdmission = createBench("Source duplication: conflicting admission");

{
	const type = createSourceType({ duplication: { policy: "allow" } });
	const agent = new AgentState(undefined);
	let added: Source<undefined> | undefined;

	conflictingAdmission.add(
		"allow",
		() => {
			added = agent.addSource(type);
		},
		{
			async: false,
			beforeAll() {
				agent.addSource(type);
			},
			afterEach() {
				added?.destroy();
				added = undefined;
			},
			afterAll() {
				agent.destroyAllSources();
			},
		}
	);
}

{
	const type = createSourceType({ duplication: { policy: "ignore" } });
	const agent = new AgentState(undefined);

	addBatchedTask(
		conflictingAdmission,
		"ignore",
		1_000,
		() => {
			agent.addSource(type);
		},
		{
			async: false,
			beforeAll() {
				agent.addSource(type);
			},
			afterAll() {
				agent.destroyAllSources();
			},
		}
	);
}

{
	const type = createSourceType({ duplication: { policy: "replace" } });
	const agent = new AgentState(undefined);

	conflictingAdmission.add(
		"replace",
		() => {
			agent.addSource(type);
		},
		{
			async: false,
			beforeAll() {
				agent.addSource(type);
			},
			afterAll() {
				agent.destroyAllSources();
			},
		}
	);
}

{
	const type = createSourceType({
		duplication: { policy: "reconcile", reconcile() {} },
	});
	const agent = new AgentState(undefined);

	addBatchedTask(
		conflictingAdmission,
		"reconcile / no-op",
		1_000,
		() => {
			agent.addSource(type);
		},
		{
			async: false,
			beforeAll() {
				agent.addSource(type);
			},
			afterAll() {
				agent.destroyAllSources();
			},
		}
	);
}

{
	const { agent, property, type } = createNumberSourceFixture({
		policy: "reconcile",
		reconcile: (existing, incoming) => existing.set(incoming),
	});
	let value = 1;
	addBatchedTask(
		conflictingAdmission,
		"reconcile / update one modifier",
		100,
		() => {
			value = value === 1 ? 2 : 1;
			agent.addSource(type, value);
		},
		{
			beforeAll() {
				value = 1;
				agent.addSource(type, value);
			},
			afterAll() {
				try {
					assert.equal(agent.getSources(type).size, 1);
					assert.equal(agent.get(property), value);
				} finally {
					agent.destroyAllSources();
				}
			},
		}
	);
}

runBench(conflictingAdmission);

const keyedAdmission = createBench("Source duplication: keyed admission");

{
	const type = createSourceType({ duplication: { policy: "ignore" } });
	const agent = new AgentState(undefined);

	addBatchedTask(
		keyedAdmission,
		"ignore / same key",
		1_000,
		() => {
			agent.addSource(type, undefined, { key: "occupied" });
		},
		{
			beforeAll() {
				agent.addSource(type, undefined, { key: "occupied" });
			},
			afterAll() {
				assert.equal(agent.getSources(type).size, 1);
				agent.destroyAllSources();
			},
		}
	);
}

{
	const type = createSourceType({ duplication: { policy: "ignore" } });
	const agent = new AgentState(undefined);
	let added: Source<undefined> | undefined;

	keyedAdmission.add(
		"ignore / different key",
		() => {
			added = agent.addSource(type, undefined, { key: "available" });
		},
		{
			async: false,
			beforeAll() {
				agent.addSource(type, undefined, { key: "occupied" });
			},
			afterEach() {
				assert.ok(added);
				added.destroy();
				added = undefined;
			},
			afterAll() {
				assert.equal(agent.getSources(type).size, 1);
				agent.destroyAllSources();
			},
		}
	);
}

runBench(keyedAdmission);

const groupedAdmission = createBench("Source duplication: grouped selection");

for (const selector of ["oldest", "newest", "lowest", "highest"] as const) {
	const group = defineDuplicationGroup({ policy: "replace", maxStack: 8, selector });
	const type = createSourceType<number>({
		duplication: group.member({ rank: (value) => value }),
	});
	const agent = new AgentState(undefined);
	let value = 8;

	groupedAdmission.add(
		`${selector} / 8 occupants`,
		() => {
			agent.addSource(type, value++);
		},
		{
			async: false,
			beforeAll() {
				for (let index = 0; index < 8; index++) agent.addSource(type, index);
			},
			afterAll() {
				assert.equal(agent.getSources(type).size, 8);
				agent.destroyAllSources();
			},
		}
	);
}

{
	const group = defineDuplicationGroup({ policy: "replace", maxStack: 8, selector: "lowest" });
	const type = createSourceType<number>({
		duplication: group.member({
			rank: (value) => value,
			replaceIf: (existing, incoming) => incoming > existing,
		}),
	});
	const agent = new AgentState(undefined);

	addBatchedTask(
		groupedAdmission,
		"replaceIf rejects / 8 occupants",
		100,
		() => {
			agent.addSource(type, 0);
		},
		{
			beforeAll() {
				for (let value = 100; value < 108; value++) agent.addSource(type, value);
			},
			afterAll() {
				assert.equal(agent.getSources(type).size, 8);
				agent.destroyAllSources();
			},
		}
	);
}

{
	const group = defineDuplicationGroup({ policy: "replace", maxStack: 8, selector: "lowest" });
	const type = createSourceType<number>({
		duplication: group.member({
			rank: (value) => value,
			replaceIf: (existing, incoming) => incoming > existing,
		}),
	});
	const agent = new AgentState(undefined);
	let value = 100;

	groupedAdmission.add(
		"replaceIf accepts / 8 occupants",
		() => {
			agent.addSource(type, value++);
		},
		{
			async: false,
			beforeAll() {
				for (let initial = 0; initial < 8; initial++) agent.addSource(type, initial);
			},
			afterAll() {
				assert.equal(agent.getSources(type).size, 8);
				agent.destroyAllSources();
			},
		}
	);
}

runBench(groupedAdmission);

const descriptorAdmission = createBench("Descriptor duplication: conflicting admission");

{
	const { agent, descriptorType } = createDescriptorFixture({
		duplication: { policy: "ignore" },
	});

	addBatchedTask(
		descriptorAdmission,
		"ignore",
		100,
		() => {
			agent.addDescriptor(descriptorType, 2);
		},
		{
			beforeAll() {
				agent.addDescriptor(descriptorType, 1);
			},
			afterAll() {
				assert.equal(agent.getDescriptors(descriptorType).size, 1);
				agent.destroyAllDescriptors();
			},
		}
	);
}

{
	const { agent, descriptorType } = createDescriptorFixture({
		duplication: { policy: "replace" },
	});

	descriptorAdmission.add(
		"replace",
		() => {
			agent.addDescriptor(descriptorType, 2);
		},
		{
			async: false,
			beforeAll() {
				agent.addDescriptor(descriptorType, 1);
			},
			afterAll() {
				assert.equal(agent.getDescriptors(descriptorType).size, 1);
				agent.destroyAllDescriptors();
			},
		}
	);
}

{
	const { agent, descriptorType } = createDescriptorFixture({
		duplication: {
			policy: "reconcile",
			reconcile: (existing, incoming) => existing.set(incoming),
		},
	});
	let value = 1;

	descriptorAdmission.add(
		"reconcile / update binding",
		() => {
			value = value === 1 ? 2 : 1;
			agent.addDescriptor(descriptorType, value);
		},
		{
			async: false,
			beforeAll() {
				agent.addDescriptor(descriptorType, value);
			},
			afterAll() {
				assert.equal(agent.getDescriptors(descriptorType).size, 1);
				agent.destroyAllDescriptors();
			},
		}
	);
}

runBench(descriptorAdmission);

const allowBucketScaling = createBench(
	"Source duplication: allow bucket scaling",
	HEAVY_BENCH_OPTIONS
);

for (const size of [100, 1_000, 10_000] as const) {
	{
		const type = createSourceType({ duplication: { policy: "allow" } });
		const agent = new AgentState(undefined);

		allowBucketScaling.add(
			`add / ${size} occupants`,
			() => {
				for (let index = 0; index < size; index++) agent.addSource(type);
			},
			{
				async: false,
				afterEach() {
					assert.equal(agent.getSources(type).size, size);
					agent.destroyAllSources();
				},
			}
		);
	}

	{
		const type = createSourceType({ duplication: { policy: "allow" } });
		const agent = new AgentState(undefined);

		allowBucketScaling.add(
			`remove / ${size} occupants`,
			() => {
				agent.destroyAllSources();
			},
			{
				async: false,
				beforeEach() {
					for (let index = 0; index < size; index++) agent.addSource(type);
				},
				afterEach() {
					assert.equal(agent.getSources(type).size, 0);
				},
			}
		);
	}
}

runBench(allowBucketScaling);
