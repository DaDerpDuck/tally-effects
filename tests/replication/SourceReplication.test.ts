import { describe, expect, it } from "vitest";
import {
	createReplicationSnapshot,
	defineNumberProperty,
	defineSourceType,
	serializeSource,
	SourceReceiver,
	type SourceTypeDefinition,
	TallyContext,
} from "../src/index.js";

interface Player {
	name: string;
}

interface PropSourceData {
	value: number;
}

const Property = defineNumberProperty({ name: "Property", defaultValue: 0 });

const basicSourceDef: SourceTypeDefinition<PropSourceData> = {
	name: "PropertySource",
	priority: 100,
	contribute: (data) => [Property.add(data.value)],
	replication: {
		serialize: (data) => data.value,
		deserialize: (value: number) => ({ value }),
	},
} as const;
const PropertySource = defineSourceType<PropSourceData>(basicSourceDef);

function createReplicationFixture(attachReplicationEmit: boolean = true) {
	const serverTally = new TallyContext<Player>();
	const serverAgent = serverTally.createAgentState({ name: "Bob" });
	serverTally.register(PropertySource);
	serverTally.register(Property);

	const clientTally = new TallyContext<Player>();
	const clientAgent = clientTally.createAgentState({ name: "Bob" });
	clientTally.register(PropertySource);
	clientTally.register(Property);

	const receiver = new SourceReceiver(clientAgent, (name) => clientTally.sources.get(name));
	if (attachReplicationEmit)
		serverTally.onReplicationEmit((_, event) => {
			receiver.apply([event]);
		});

	return { clientTally, clientAgent, serverTally, serverAgent, receiver };
}

function getClientSource(clientAgent: ReturnType<typeof createReplicationFixture>["clientAgent"]) {
	const sources = [...clientAgent.getSources(PropertySource)];
	expect(sources).toHaveLength(1);
	return sources[0]!;
}

describe("replication", () => {
	it("replicates source addition", () => {
		const { clientAgent, serverAgent } = createReplicationFixture();

		serverAgent.addSource(PropertySource, { value: 5 });

		const clientSource = getClientSource(clientAgent);
		expect(clientSource.priority).toBe(100);
		expect(clientSource.get()).toEqual({ value: 5 });
		expect(clientAgent.get(Property)).toBe(5);
	});

	it("replicates source updates", () => {
		const { clientAgent, serverAgent } = createReplicationFixture();
		const serverSource = serverAgent.addSource(PropertySource, { value: 5 }, { key: "abc" })!;

		serverSource.set({ value: 10 });

		const clientSource = getClientSource(clientAgent);
		expect(clientSource.priority).toBe(100);
		expect(clientSource.key).toBe("abc");
		expect(clientSource.get()).toEqual({ value: 10 });
		expect(clientAgent.get(Property)).toBe(10);
	});

	it("replicates source removal", () => {
		const { clientAgent, serverAgent } = createReplicationFixture();
		const serverSource = serverAgent.addSource(PropertySource, { value: 5 })!;
		expect(clientAgent.getSources(PropertySource).size).toBe(1);

		serverSource.destroy();

		expect(clientAgent.getSources(PropertySource).size).toBe(0);
		expect(clientAgent.get(Property)).toBe(0);
	});

	it("replicates same-type sources", () => {
		const { clientAgent, serverAgent } = createReplicationFixture();
		clientAgent.addSource(PropertySource, { value: 1000 });
		const serverSource1 = serverAgent.addSource(PropertySource, { value: 1 })!;
		const serverSource2 = serverAgent.addSource(PropertySource, { value: 10 })!;
		const serverSource3 = serverAgent.addSource(PropertySource, { value: 100 })!;
		expect(clientAgent.getSources(PropertySource).size).toBe(4);
		expect(clientAgent.get(Property)).toBe(1111);

		serverSource2.set({ value: 20 });
		serverSource1.destroy();
		expect(clientAgent.getSources(PropertySource).size).toBe(3);
		expect(clientAgent.get(Property)).toBe(1120);
	});

	it("reconciles snapshot", () => {
		const { clientAgent, serverAgent, clientTally, serverTally, receiver } =
			createReplicationFixture(false);

		const PropertySource1 = defineSourceType<PropSourceData>({
			...basicSourceDef,
			name: "PropertySource1",
		});
		clientTally.register(PropertySource1);
		serverTally.register(PropertySource1);

		const PropertySource2 = defineSourceType<PropSourceData>({
			...basicSourceDef,
			name: "PropertySource2",
		});
		clientTally.register(PropertySource2);
		serverTally.register(PropertySource2);

		const PropertySource3 = defineSourceType<PropSourceData>({
			...basicSourceDef,
			name: "PropertySource3",
		});
		clientTally.register(PropertySource3);
		serverTally.register(PropertySource3);

		const source1 = serverAgent.addSource(PropertySource1, { value: 5 })!;
		const source3 = serverAgent.addSource(PropertySource3, { value: 6 })!;
		expect(clientAgent.getSources().size).toBe(0);
		expect(clientAgent.get(Property)).toBe(0);

		receiver.applySnapshot(createReplicationSnapshot(serverAgent));
		expect(clientAgent.getSources().size).toBe(2);
		expect(clientAgent.get(Property)).toBe(11);
		expect(
			new Set(
				clientAgent
					.getSources()
					.values()
					.map((source) => source.type.name)
			)
		).toEqual(new Set(["PropertySource1", "PropertySource3"]));

		source1.set({ value: 7 });
		source3.destroy();
		serverAgent.addSource(PropertySource2, { value: 8 });
		receiver.applySnapshot(createReplicationSnapshot(serverAgent));
		expect(clientAgent.getSources().size).toBe(2);
		expect(clientAgent.get(Property)).toBe(15);
		expect(
			new Set(
				clientAgent
					.getSources()
					.values()
					.map((source) => source.type.name)
			)
		).toEqual(new Set(["PropertySource1", "PropertySource2"]));
	});

	it("filters snapshot", () => {
		const { clientAgent, serverAgent, clientTally, serverTally, receiver } =
			createReplicationFixture(false);

		const LocalPropertySource = defineSourceType<PropSourceData>({
			name: "LocalPropertySource",
			priority: 100,
			contribute: (data) => [Property.add(data.value)],
		});
		clientTally.register(LocalPropertySource);
		serverTally.register(LocalPropertySource);

		serverAgent.addSource(PropertySource, { value: 5 });
		serverAgent.addSource(LocalPropertySource, { value: 6 });
		expect(clientAgent.getSources().size).toBe(0);
		expect(clientAgent.get(Property)).toBe(0);
		expect(serverAgent.getSources().size).toBe(2);
		expect(serverAgent.get(Property)).toBe(11);

		receiver.applySnapshot(createReplicationSnapshot(serverAgent));
		expect(clientAgent.getSources().size).toBe(1);
		expect(clientAgent.get(Property)).toBe(5);
		expect(
			new Set(
				clientAgent
					.getSources()
					.values()
					.map((source) => source.type.name)
			)
		).toEqual(new Set(["PropertySource"]));
	});

	it("throws on unknown source type", () => {
		const { clientAgent, serverAgent, receiver } = createReplicationFixture(false);

		expect(() =>
			receiver.apply([
				{
					target: "source",
					event: {
						kind: "added",
						source: serializeSource(
							serverAgent.addSource(PropertySource, { value: 1 })!
						),
					},
				},
				{
					target: "source",
					event: {
						kind: "added",
						source: {
							id: 10,
							type: "unknown",
							priority: 0,
							key: undefined,
							data: null,
						},
					},
				},
				{
					target: "source",
					event: {
						kind: "added",
						source: serializeSource(
							serverAgent.addSource(PropertySource, { value: 2 })!
						),
					},
				},
			])
		).toThrow("Failed to apply 1 replication event(s)");
		expect(clientAgent.getSources().size).toBe(2);
	});

	it("throws when updating a source that was never reconstructed", () => {
		const { receiver } = createReplicationFixture(false);

		expect(() =>
			receiver.apply([{ target: "source", event: { kind: "updated", id: 404, data: null } }])
		).toThrow("Failed to apply 1 replication event(s)");
	});
});
