import assert from "node:assert/strict";
import {
	AgentState,
	createReplicationSnapshot,
	defineNumberProperty,
	SourceReceiver,
	DescriptorReceiver,
	type ReplicationSnapshot,
	type SourceType,
} from "../../src/index.js";
import { BENCH_SIZES, createBench, HEAVY_BENCH_OPTIONS, runBench } from "../shared/bench.js";
import { createDescriptorFixture, createSourceType } from "../shared/fixtures.js";

function createReplicatedSourceType() {
	const property = defineNumberProperty({
		name: "ReplicatedBenchmarkValue",
		defaultValue: 0,
	});
	const type = createSourceType<number>({
		name: "ReplicatedBenchmarkSource",
		contribute: (value) => [property.add(value)],
		replication: {
			serialize: (value) => value,
			deserialize(value) {
				if (typeof value !== "number") throw new Error("Expected a number");
				return value;
			},
		},
	});

	return type;
}

function createSnapshot(size: number, value: number): ReplicationSnapshot {
	return {
		sources: Array.from({ length: size }, (_, index) => ({
			id: index + 1,
			type: "ReplicatedBenchmarkSource",
			priority: 0,
			key: undefined,
			data: value,
		})),
		descriptors: [],
	};
}

const snapshotCreation = createBench("Replication snapshot creation", HEAVY_BENCH_OPTIONS);

for (const size of BENCH_SIZES.slice(0, -1)) {
	let agent: AgentState<undefined>;
	let type: SourceType<number>;
	let snapshot: ReplicationSnapshot;

	snapshotCreation.add(
		`${size} ${size === 1 ? "source" : "sources"}`,
		() => {
			snapshot = createReplicationSnapshot(agent);
		},
		{
			async: false,
			beforeAll() {
				type = createReplicatedSourceType();
				agent = new AgentState(undefined);
				agent.batch(() => {
					for (let i = 0; i < size; i++) agent.addSource(type, i);
				});
			},
			afterAll() {
				try {
					assert.equal(snapshot.sources.length, size);
				} finally {
					agent.destroy();
				}
			},
		}
	);
}

runBench(snapshotCreation);

const snapshotApplication = createBench("Replication snapshot application", {
	...HEAVY_BENCH_OPTIONS,
	iterations: 64,
});

for (const size of BENCH_SIZES.slice(0, -1)) {
	const lowSnapshot = createSnapshot(size, 1);
	const highSnapshot = createSnapshot(size, 2);
	let agent: AgentState<undefined>;
	let receiver: SourceReceiver;
	let high = false;

	snapshotApplication.add(
		`${size} source ${size === 1 ? "update" : "updates"}`,
		() => {
			high = !high;
			receiver.applySnapshot(high ? highSnapshot : lowSnapshot);
		},
		{
			async: false,
			beforeAll() {
				const type = createReplicatedSourceType();
				agent = new AgentState(undefined);
				receiver = new SourceReceiver(agent, (name) =>
					name === type.name ? type : undefined
				);
				receiver.applySnapshot(lowSnapshot);
				high = false;
			},
			afterAll() {
				agent.destroy();
			},
		}
	);
}

runBench(snapshotApplication);

const descriptorApplication = createBench(
	"Descriptor replication snapshot application",
	HEAVY_BENCH_OPTIONS
);

for (const size of [1, 10, 100, 1_000]) {
	let fixture: ReturnType<typeof createDescriptorFixture>;
	let receiver: DescriptorReceiver;
	let high = false;
	const snapshot = (value: number): ReplicationSnapshot => ({
		sources: [],
		descriptors: Array.from({ length: size }, (_, index) => ({
			id: index + 1,
			type: "BenchmarkDescriptor",
			key: undefined,
			data: value,
		})),
	});
	const lowSnapshot = snapshot(1);
	const highSnapshot = snapshot(2);
	descriptorApplication.add(
		`${size} descriptor ${size === 1 ? "update" : "updates"}`,
		() => {
			high = !high;
			receiver.applySnapshot(high ? highSnapshot : lowSnapshot);
		},
		{
			async: false,
			beforeAll() {
				fixture = createDescriptorFixture({
					replication: {
						serialize: (value) => value,
						deserialize(value) {
							if (typeof value !== "number") throw new Error("Expected a number");
							return value;
						},
					},
				});
				receiver = new DescriptorReceiver(fixture.agent, (name) =>
					name === fixture.descriptorType.name ? fixture.descriptorType : undefined
				);
				receiver.applySnapshot(lowSnapshot);
				high = false;
			},
			afterAll() {
				try {
					assert.equal(fixture.agent.getDescriptors().size, size);
					assert.equal(fixture.agent.getSources().size, size);
					assert.equal(fixture.agent.get(fixture.property), size * (high ? 2 : 1));
				} finally {
					fixture.agent.destroy();
				}
			},
		}
	);
}
runBench(descriptorApplication);
