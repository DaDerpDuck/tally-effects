import assert from "node:assert/strict";
import {
	AgentState,
	createReplicationSnapshot,
	defineDescriptorType,
	defineNumberProperty,
	defineSourceType,
	DescriptorReceiver,
	SourceReceiver,
	type ReplicationDefinition,
	type ReplicationEvent,
	type ReplicationSnapshot,
} from "../../src/index.js";
import type { Scenario } from "../shared/scenario.js";

const numberReplication: ReplicationDefinition<number> = {
	serialize: (value) => value,
	deserialize(value) {
		if (typeof value !== "number") throw new Error("Expected a number");
		return value;
	},
};

/** Both snapshots have the same size; half the IDs persist, half are replaced. */
function snapshots(
	size: number,
	sourceName: string,
	descriptorName: string
): ReplicationSnapshot[] {
	return [false, true].map((high) => ({
		sources: Array.from({ length: size }, (_, index) => ({
			id: index + 1 + (high && index >= Math.floor(size / 2) ? size : 0),
			type: sourceName,
			priority: 100,
			data: high ? 2 : 1,
		})),
		descriptors: Array.from({ length: size }, (_, index) => ({
			id: 4 * size + index + 1 + (high && index >= Math.floor(size / 2) ? size : 0),
			type: descriptorName,
			data: high ? 2 : 1,
		})),
	}));
}

function delta(from: ReplicationSnapshot, to: ReplicationSnapshot): ReplicationEvent[] {
	const events: ReplicationEvent[] = [];
	const oldSources = new Set(from.sources.map((source) => source.id));
	const newSources = new Set(to.sources.map((source) => source.id));
	for (const source of from.sources) {
		if (!newSources.has(source.id))
			events.push({ target: "source", event: { kind: "removed", id: source.id } });
	}
	for (const source of to.sources) {
		events.push({
			target: "source",
			event: oldSources.has(source.id)
				? { kind: "updated", id: source.id, data: source.data }
				: { kind: "added", source },
		});
	}
	const oldDescriptors = new Set(from.descriptors.map((descriptor) => descriptor.id));
	const newDescriptors = new Set(to.descriptors.map((descriptor) => descriptor.id));
	for (const descriptor of from.descriptors) {
		if (!newDescriptors.has(descriptor.id))
			events.push({ target: "descriptor", event: { kind: "removed", id: descriptor.id } });
	}
	for (const descriptor of to.descriptors) {
		events.push({
			target: "descriptor",
			event: oldDescriptors.has(descriptor.id)
				? { kind: "updated", id: descriptor.id, data: descriptor.data }
				: { kind: "added", descriptor },
		});
	}
	return events;
}

export function createSyncScenario(size: number, mode: "snapshot" | "events"): Scenario {
	const value = defineNumberProperty({ name: "ReplicatedValue", defaultValue: 0 });
	const sourceType = defineSourceType<number>({
		name: "ReplicatedEffect",
		priority: 100,
		contribute: (data) => [value.add(data)],
		replication: numberReplication,
	});
	const descriptorType = defineDescriptorType<number, number>({
		name: "ReplicatedDescriptor",
		source: sourceType,
		replication: numberReplication,
	});
	const agent = new AgentState(undefined);
	agent.registerDescriptorHandler(descriptorType, (context, data) => {
		const source = context.addSource(data)!;
		return { source, update: (next) => source.set(next), destroy: () => source.destroy() };
	});
	// A local prediction must survive authoritative reconciliation.
	agent.addSource(sourceType, 7);
	const sourceReceiver = new SourceReceiver(agent, (name) =>
		name === sourceType.name ? sourceType : undefined
	);
	const descriptorReceiver = new DescriptorReceiver(agent, (name) =>
		name === descriptorType.name ? descriptorType : undefined
	);
	const [low, high] = snapshots(size, sourceType.name, descriptorType.name) as [
		ReplicationSnapshot,
		ReplicationSnapshot,
	];
	const toHigh = delta(low, high);
	const toLow = delta(high, low);
	const applySnapshot = (snapshot: ReplicationSnapshot) =>
		agent.batch(() => {
			sourceReceiver.applySnapshot(snapshot);
			descriptorReceiver.applySnapshot(snapshot);
		});
	applySnapshot(low);
	let isHigh = false;
	let observed = agent.get(value);
	let notifications = 0;
	agent.onPropertyChanged(value, (next) => {
		observed = next;
		notifications++;
	});

	return {
		run() {
			isHigh = !isHigh;
			notifications = 0;
			if (mode === "snapshot") applySnapshot(isHigh ? high : low);
			else
				agent.batch(() => {
					const events = isHigh ? toHigh : toLow;
					sourceReceiver.apply(events);
					descriptorReceiver.apply(events);
				});
		},
		verify() {
			assert.equal(agent.getSources().size, size * 2 + 1);
			assert.equal(agent.getDescriptors().size, size);
			assert.equal(agent.get(value), size * 2 * (isHigh ? 2 : 1) + 7);
			assert.equal(observed, agent.get(value));
			assert.equal(notifications, 1);
			const expected = isHigh ? high : low;
			assert.deepEqual(
				[...agent.getSources()]
					.filter((source) => source.provenance.domain === "replicated")
					.map((source) => source.provenance.sequence)
					.sort((a, b) => a - b),
				expected.sources.map((source) => source.id).sort((a, b) => a - b)
			);
			assert.deepEqual(
				[...agent.getDescriptors()]
					.map((descriptor) => descriptor.provenance.sequence)
					.sort((a, b) => a - b),
				expected.descriptors.map((descriptor) => descriptor.id).sort((a, b) => a - b)
			);
			// Received state and descriptor-derived sources must never echo back.
			const outgoing = createReplicationSnapshot(agent);
			assert.equal(outgoing.sources.length, 1);
			assert.equal(outgoing.sources[0]!.data, 7);
			assert.equal(outgoing.descriptors.length, 0);
		},
		destroy() {
			agent.destroy();
		},
	};
}
