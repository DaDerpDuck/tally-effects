import { describe, expect, it } from "vitest";
import { AgentState, SourceReceiver, defineSourceType, testReporter } from "../src/index.js";

const hookKinds = ["type lookup", "deserialization"] as const;
const receiveKinds = ["events", "snapshot"] as const;

describe("Source receiver hook reentrancy", () => {
	for (const hook of hookKinds) {
		for (const receive of receiveKinds) {
			it(`rejects Source mutation during ${hook} in ${receive} and applies independent items`, () => {
				const agent = new AgentState(undefined, { reporter: testReporter });
				const SideEffect = defineSourceType<number>({
					name: "SourceReceiverHookSideEffect",
					priority: 100,
					contribute: () => [],
				});
				const Replicated = defineSourceType<number>({
					name: "SourceReceiverHookReplicated",
					priority: 100,
					contribute: () => [],
					replication: {
						serialize: (data) => data,
						deserialize: (data) => {
							if (hook === "deserialization" && data === 1)
								agent.addSource(SideEffect, 99);
							return data as number;
						},
					},
				});
				const receiver = new SourceReceiver(agent, (name) => {
					if (hook === "type lookup" && name === "bad") agent.addSource(SideEffect, 99);
					return Replicated;
				});
				const bad = { id: 1, type: "bad", priority: 100, data: 1 };
				const good = { id: 2, type: "good", priority: 100, data: 2 };

				expect(() => {
					if (receive === "events")
						receiver.apply([
							{ target: "source", event: { kind: "added", source: bad } },
							{ target: "source", event: { kind: "added", source: good } },
						]);
					else receiver.applySnapshot({ sources: [bad, good], descriptors: [] });
				}).toThrow("Failed to apply 1 replication");
				expect(agent.getSources(SideEffect).size).toBe(0);
				expect([...agent.getSources(Replicated)].map((source) => source.get())).toEqual([
					2,
				]);
			});
		}
	}

	it("rejects mutation during update deserialization", () => {
		const agent = new AgentState(undefined, { reporter: testReporter });
		const Replicated = defineSourceType<number>({
			name: "SourceReceiverUpdateHook",
			priority: 100,
			contribute: () => [],
			replication: {
				serialize: (data) => data,
				deserialize: (data) => {
					if (data === 2) agent.addSource(Replicated, 99);
					return data as number;
				},
			},
		});
		const receiver = new SourceReceiver(agent, () => Replicated);
		receiver.apply([
			{
				target: "source",
				event: { kind: "added", source: { id: 1, type: "source", priority: 100, data: 1 } },
			},
		]);

		expect(() =>
			receiver.apply([{ target: "source", event: { kind: "updated", id: 1, data: 2 } }])
		).toThrow("Failed to apply 1 replication event(s)");
		expect([...agent.getSources(Replicated)].map((source) => source.get())).toEqual([1]);
	});

	it("checks the gate before recursively receiving events", () => {
		const agent = new AgentState(undefined, { reporter: testReporter });
		const Replicated = defineSourceType<number>({
			name: "RecursiveSourceReceiver",
			priority: 100,
			contribute: () => [],
			replication: { serialize: (data) => data, deserialize: (data) => data as number },
		});
		const receiver = new SourceReceiver(agent, (name) => {
			if (name === "outer") receiver.apply([]);
			return Replicated;
		});

		expect(() =>
			receiver.apply([
				{
					target: "source",
					event: {
						kind: "added",
						source: { id: 1, type: "outer", priority: 100, data: 1 },
					},
				},
			])
		).toThrow("Failed to apply 1 replication event(s)");
		expect(agent.getSources(Replicated).size).toBe(0);
	});

	it("allows a receiver hook to mutate another AgentState", () => {
		const agent = new AgentState(undefined, { reporter: testReporter });
		const other = new AgentState(undefined, { reporter: testReporter });
		const Replicated = defineSourceType<number>({
			name: "OtherAgentReceiverHook",
			priority: 100,
			contribute: () => [],
			replication: {
				serialize: (data) => data,
				deserialize: (data) => {
					other.addSource(Replicated, 99);
					return data as number;
				},
			},
		});
		const receiver = new SourceReceiver(agent, () => Replicated);

		receiver.apply([
			{
				target: "source",
				event: { kind: "added", source: { id: 1, type: "source", priority: 100, data: 1 } },
			},
		]);
		expect([...agent.getSources(Replicated)].map((source) => source.get())).toEqual([1]);
		expect([...other.getSources(Replicated)].map((source) => source.get())).toEqual([99]);
	});
});
