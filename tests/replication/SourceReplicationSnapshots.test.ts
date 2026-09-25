import { describe, expect, it } from "vitest";
import {
	type SourceData,
	Value,
	ValueSource,
	createReplicationFixture,
	defineReplicatedSource,
	getOnlySource,
	getSourceNames,
} from "../fixtures/SourceReplication.js";
import { createReplicationSnapshot, defineSourceType } from "../src/index.js";

describe("Source replication snapshots", () => {
	it("reconciles additions, updates, removals, and keys", () => {
		const FirstSource = defineReplicatedSource("SnapshotFirstSource");
		const SecondSource = defineReplicatedSource("SnapshotSecondSource");
		const RemovedSource = defineReplicatedSource("SnapshotRemovedSource");
		const { clientAgent, receiver, serverAgent } = createReplicationFixture({
			relayEvents: false,
			sourceTypes: [FirstSource, SecondSource, RemovedSource],
		});
		const first = serverAgent.addSource(FirstSource, { value: 5 }, { key: "first" })!;
		const removed = serverAgent.addSource(RemovedSource, { value: 6 }, { key: "removed" })!;

		receiver.applySnapshot(createReplicationSnapshot(serverAgent));

		expect(clientAgent.getSources().size).toBe(2);
		expect(clientAgent.get(Value)).toBe(11);
		expect(getSourceNames(clientAgent)).toEqual(
			new Set([FirstSource.name, RemovedSource.name])
		);
		expect(getOnlySource(clientAgent, FirstSource).key).toBe("first");

		first.set({ value: 7 });
		removed.destroy();
		serverAgent.addSource(SecondSource, { value: 8 }, { key: "second" });
		receiver.applySnapshot(createReplicationSnapshot(serverAgent));

		expect(clientAgent.getSources().size).toBe(2);
		expect(clientAgent.get(Value)).toBe(15);
		expect(getSourceNames(clientAgent)).toEqual(new Set([FirstSource.name, SecondSource.name]));
		expect(getOnlySource(clientAgent, FirstSource).get()).toEqual({ value: 7 });
		expect(getOnlySource(clientAgent, SecondSource).key).toBe("second");
	});
	it("is idempotent and preserves client-local Sources", () => {
		const { clientAgent, receiver, serverAgent } = createReplicationFixture({
			relayEvents: false,
		});
		const clientLocal = clientAgent.addSource(ValueSource, { value: 100 }, { key: "local" })!;
		serverAgent.addSource(ValueSource, { value: 5 }, { key: "remote" });
		const snapshot = createReplicationSnapshot(serverAgent);

		receiver.applySnapshot(snapshot);
		receiver.applySnapshot(snapshot);

		expect(clientAgent.getSources(ValueSource)).toContain(clientLocal);
		expect(clientAgent.getSources(ValueSource).size).toBe(2);
		expect(clientAgent.get(Value)).toBe(105);
		expect(
			new Set(
				clientAgent
					.getSources(ValueSource)
					.values()
					.map((source) => source.key)
			)
		).toEqual(new Set(["local", "remote"]));
	});
	it("excludes Source types without replication metadata", () => {
		const LocalSource = defineSourceType<SourceData>({
			name: "SnapshotLocalSource",
			priority: 100,
			contribute: (data) => [Value.add(data.value)],
		});
		const { clientAgent, receiver, serverAgent } = createReplicationFixture({
			relayEvents: false,
			sourceTypes: [LocalSource],
		});
		serverAgent.addSource(ValueSource, { value: 5 });
		serverAgent.addSource(LocalSource, { value: 100 });

		const snapshot = createReplicationSnapshot(serverAgent);
		receiver.applySnapshot(snapshot);

		expect(snapshot.sources).toHaveLength(1);
		expect(snapshot.sources[0]?.type).toBe(ValueSource.name);
		expect(clientAgent.getSources().size).toBe(1);
		expect(clientAgent.get(Value)).toBe(5);
	});
});
