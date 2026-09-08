import assert from "node:assert/strict";
import { AgentState, type Source } from "../../src/index.js";
import { addBatchedTask, createBench, runBench } from "../shared/bench.js";
import { createNumberSourceFixture, createSourceType } from "../shared/fixtures.js";

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
