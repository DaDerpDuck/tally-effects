import { describe, expect, it, vi } from "vitest";
import { defineSourceType, createTestReporter } from "../src/index.js";
import { PoisonSource, createContextFixture } from "../fixtures/TallyContext.js";

describe("tally context source events", () => {
	it("forwards replication events emitted by its agents", () => {
		const ReplicatedSource = defineSourceType<number>({
			name: "ContextForwardedReplicationSource",
			priority: 100,
			contribute: () => [],
			replication: {
				serialize: (value) => value,
				deserialize: (value) => value as number,
			},
		});
		const { agent, tally } = createContextFixture();
		const callback = vi.fn();
		tally.onReplicationEmit(callback);

		agent.addSource(ReplicatedSource, 5);

		expect(callback).toHaveBeenCalledExactlyOnceWith(agent, {
			target: "source",
			event: {
				kind: "added",
				source: {
					id: 0,
					type: ReplicatedSource.name,
					priority: 100,
					key: undefined,
					data: 5,
				},
			},
		});
	});
	it("forwards source additions", () => {
		const { agent, tally } = createContextFixture();
		const callback = vi.fn();
		tally.onSourceAdded(callback);

		const first = agent.addSource(PoisonSource, { intensity: 5 });
		agent.addSource(PoisonSource, { intensity: 10 });
		first!.destroy();
		const second = agent.addSource(PoisonSource, { intensity: 5 });

		expect(callback).toHaveBeenCalledTimes(2);
		expect(callback).toHaveBeenNthCalledWith(1, agent, first);
		expect(callback).toHaveBeenNthCalledWith(2, agent, second);
	});
	it("reports source observer failures after notifying later context observers", () => {
		const { reporter, reports } = createTestReporter();
		const { agent, tally } = createContextFixture(reporter);
		const laterObserver = vi.fn();
		tally.onSourceAdded(() => {
			throw new Error("context source observer failed");
		});
		tally.onSourceAdded(laterObserver);

		expect(() => agent.addSource(PoisonSource, { intensity: 5 })).not.toThrow();
		expect(laterObserver).toHaveBeenCalledTimes(1);
		expect(agent.getSources(PoisonSource).size).toBe(1);
		expect(reports).toHaveLength(1);
		expect(reports[0]?.error).toEqual(new Error("context source observer failed"));
	});
	it("forwards source removals", () => {
		const { agent, tally } = createContextFixture();
		const callback = vi.fn();
		tally.onSourceRemoved(callback);

		const source = agent.addSource(PoisonSource, { intensity: 5 })!;
		agent.addSource(PoisonSource, { intensity: 10 });
		expect(callback).not.toHaveBeenCalled();

		source.destroy();
		agent.addSource(PoisonSource, { intensity: 5 });

		expect(callback).toHaveBeenCalledTimes(1);
		expect(callback).toHaveBeenCalledWith(agent, source);
	});
	it("forwards source updates", () => {
		const { agent, tally } = createContextFixture();
		const callback = vi.fn();
		tally.onSourceUpdated(callback);

		const first = agent.addSource(PoisonSource, { intensity: 5 })!;
		first.set({ intensity: 15 });
		agent.addSource(PoisonSource, { intensity: 10 });
		first.destroy();

		const second = agent.addSource(PoisonSource, { intensity: 5 })!;
		second.set({ intensity: 10 });

		expect(callback).toHaveBeenCalledTimes(2);
		expect(callback).toHaveBeenNthCalledWith(1, agent, first);
		expect(callback).toHaveBeenNthCalledWith(2, agent, second);
	});
	it("stops forwarding source events after destruction", () => {
		const { agent, tally } = createContextFixture();
		const added = vi.fn();
		const updated = vi.fn();
		const removed = vi.fn();

		tally.onSourceAdded(added);
		tally.onSourceUpdated(updated);
		tally.onSourceRemoved(removed);
		tally.destroy();

		const SourceType = defineSourceType<number>({
			name: "AfterDestroySource",
			priority: 100,
			contribute: () => [],
		});
		const source = agent.addSource(SourceType, 1)!;
		source.set(2);
		source.destroy();

		expect(added).not.toHaveBeenCalled();
		expect(updated).not.toHaveBeenCalled();
		expect(removed).not.toHaveBeenCalled();
	});
});
