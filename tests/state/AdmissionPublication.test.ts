import { describe, expect, it } from "vitest";
import {
	AgentState,
	defineDescriptorType,
	defineNumberProperty,
	defineSourceType,
	type ReplicationDefinition,
	type ReplicationEvent,
	testReporter,
} from "../src/index.js";

const Value = defineNumberProperty({ name: "AdmissionPublicationValue", defaultValue: 0 });

const numberReplication: ReplicationDefinition<number> = {
	serialize: (data) => data,
	deserialize: (data) => {
		if (typeof data !== "number") throw new Error("Expected a number");
		return data;
	},
};

const PublishedSource = defineSourceType<number>({
	name: "PublishedSource",
	priority: 100,
	contribute: (data) => [Value.add(data)],
	replication: numberReplication,
});

const DerivedSource = defineSourceType<number>({
	name: "PublishedDescriptorOutput",
	priority: 100,
	contribute: (data) => [Value.add(data)],
});

const PublishedDescriptor = defineDescriptorType<number, number>({
	name: "PublishedDescriptor",
	source: DerivedSource,
	replication: numberReplication,
});

function createDescriptorAgent() {
	const agent = new AgentState(undefined, { reporter: testReporter });
	agent.registerDescriptorHandler(PublishedDescriptor, (context, data) => {
		const source = context.addSource(data)!;
		return {
			source,
			update: (nextData) => source.set(nextData),
			destroy: () => source.destroy(),
		};
	});
	return agent;
}

describe("admission publication", () => {
	it("finishes the Source added notification before resolving changes made by its listeners", () => {
		const agent = new AgentState(undefined, { reporter: testReporter });
		const events: string[] = [];
		agent.onPropertyChanged(Value, (value) => events.push(`property:${value}`));
		agent.onSourceAdded((source) => {
			events.push("added:first");
			source.set(2);
		});
		agent.onSourceAdded(() => events.push("added:second"));

		agent.addSource(PublishedSource, 1);

		expect(events).toEqual(["property:1", "added:first", "added:second", "property:2"]);
	});

	it("finishes the Descriptor added notification before resolving changes made by its listeners", () => {
		const agent = createDescriptorAgent();
		const events: string[] = [];
		agent.onPropertyChanged(Value, (value) => events.push(`property:${value}`));
		agent.onDescriptorAdded((descriptor) => {
			events.push("added:first");
			descriptor.set(2);
		});
		agent.onDescriptorAdded(() => events.push("added:second"));

		agent.addDescriptor(PublishedDescriptor, 1);

		expect(events).toEqual(["property:1", "added:first", "added:second", "property:2"]);
	});

	it("emits a Source added with the final data after a property observer updates it", () => {
		const agent = new AgentState(undefined, { reporter: testReporter });
		const lifecycle: string[] = [];
		const replication: ReplicationEvent[] = [];
		agent.onSourceAdded((source) => lifecycle.push(`added:${source.get()}`));
		agent.onSourceUpdated((source) => lifecycle.push(`updated:${source.get()}`));
		agent.onReplicationEmit((event) => replication.push(event));
		agent.onPropertyChanged(Value, (value) => {
			if (value === 1) [...agent.getSources(PublishedSource)][0]?.set(2);
		});

		const source = agent.addSource(PublishedSource, 1);

		expect(source?.get()).toBe(2);
		expect(agent.get(Value)).toBe(2);
		expect(lifecycle).toEqual(["added:2"]);
		expect(replication.map((event) => event.event.kind)).toEqual(["added"]);
		expect(replication[0]?.event).toMatchObject({ source: { data: 2 } });
	});

	it("does not emit Source lifecycle events when a property observer destroys it before added", () => {
		const agent = new AgentState(undefined, { reporter: testReporter });
		const lifecycle: string[] = [];
		const replication: ReplicationEvent[] = [];
		agent.onSourceAdded(() => lifecycle.push("added"));
		agent.onSourceRemoved(() => lifecycle.push("removed"));
		agent.onReplicationEmit((event) => replication.push(event));
		agent.onPropertyChanged(Value, (value) => {
			if (value === 1) [...agent.getSources(PublishedSource)][0]?.destroy();
		});

		expect(agent.addSource(PublishedSource, 1)).toBeUndefined();
		expect(agent.getSources(PublishedSource)).toEqual(new Set());
		expect(lifecycle).toEqual([]);
		expect(replication).toEqual([]);
	});

	it("emits a Descriptor added with the final data after a property observer updates it", () => {
		const agent = createDescriptorAgent();
		const lifecycle: string[] = [];
		const replication: ReplicationEvent[] = [];
		agent.onDescriptorAdded((descriptor) => lifecycle.push(`added:${descriptor.get()}`));
		agent.onDescriptorUpdated((descriptor) => lifecycle.push(`updated:${descriptor.get()}`));
		agent.onReplicationEmit((event) => replication.push(event));
		agent.onPropertyChanged(Value, (value) => {
			if (value === 1) [...agent.getDescriptors(PublishedDescriptor)][0]?.set(2);
		});

		const descriptor = agent.addDescriptor(PublishedDescriptor, 1);

		expect(descriptor?.get()).toBe(2);
		expect(descriptor?.getSource().get()).toBe(2);
		expect(agent.get(Value)).toBe(2);
		expect(lifecycle).toEqual(["added:2"]);
		expect(replication.map((event) => event.event.kind)).toEqual(["added"]);
		expect(replication[0]?.event).toMatchObject({ descriptor: { data: 2 } });
	});

	it("does not emit Descriptor lifecycle events when a property observer destroys it before added", () => {
		const agent = createDescriptorAgent();
		const lifecycle: string[] = [];
		const replication: ReplicationEvent[] = [];
		agent.onDescriptorAdded(() => lifecycle.push("added"));
		agent.onDescriptorRemoved(() => lifecycle.push("removed"));
		agent.onReplicationEmit((event) => replication.push(event));
		agent.onPropertyChanged(Value, (value) => {
			if (value === 1) [...agent.getDescriptors(PublishedDescriptor)][0]?.destroy();
		});

		expect(agent.addDescriptor(PublishedDescriptor, 1)).toBeUndefined();
		expect(agent.getDescriptors(PublishedDescriptor)).toEqual(new Set());
		expect(agent.getSources(DerivedSource)).toEqual(new Set());
		expect(lifecycle).toEqual([]);
		expect(replication).toEqual([]);
	});
});
