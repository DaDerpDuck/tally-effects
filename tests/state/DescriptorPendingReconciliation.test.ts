import { describe, expect, it } from "vitest";
import {
	AgentState,
	defineDescriptorType,
	defineNumberProperty,
	defineSourceType,
	testReporter,
} from "../src/index.js";

const Value = defineNumberProperty({ name: "PendingReconciliationValue", defaultValue: 0 });
const Output = defineSourceType<number>({
	name: "PendingReconciliationOutput",
	priority: 100,
	contribute: (value) => [Value.add(value)],
});
const ReconciledDescriptor = defineDescriptorType<number, number>({
	name: "PendingReconciledDescriptor",
	source: Output,
	duplication: {
		policy: "reconcile",
		reconcile: (existing, incoming) => existing.set(incoming),
	},
});

describe("pending Descriptor reconciliation", () => {
	it("applies reconciled data to the binding before the added notification", () => {
		const agent = new AgentState(undefined, { reporter: testReporter });
		const notifications: string[] = [];
		agent.onDescriptorAdded((descriptor) =>
			notifications.push(`added:${descriptor.get()}:${descriptor.getSource().get()}`)
		);
		agent.onDescriptorUpdated(() => notifications.push("updated"));
		agent.registerDescriptorHandler(ReconciledDescriptor, (context, data) => {
			const source = context.addSource(data)!;
			if (data === 1) agent.addDescriptor(ReconciledDescriptor, 2);
			return {
				source,
				update: (next) => source.set(next),
				destroy: () => source.destroy(),
			};
		});

		const descriptor = agent.addDescriptor(ReconciledDescriptor, 1)!;

		expect(descriptor.get()).toBe(2);
		expect(descriptor.getSource().get()).toBe(2);
		expect(agent.get(Value)).toBe(2);
		expect(agent.getDescriptors(ReconciledDescriptor)).toEqual(new Set([descriptor]));
		expect(agent.getSources(Output)).toEqual(new Set([descriptor.getSource()]));
		expect(notifications).toEqual(["added:2:2"]);

		descriptor.destroy();
		expect(agent.getDescriptors(ReconciledDescriptor)).toEqual(new Set());
		expect(agent.getSources(Output)).toEqual(new Set());
	});

	it("rolls back the Descriptor and derived Source if replaying reconciliation fails", () => {
		const agent = new AgentState(undefined, { reporter: testReporter });
		const notifications: string[] = [];
		let cleaned = 0;
		let shouldFail = true;
		agent.onDescriptorAdded(() => notifications.push("added"));
		agent.onDescriptorRemoved(() => notifications.push("removed"));
		agent.registerDescriptorHandler(ReconciledDescriptor, (context, data) => {
			const source = context.addSource(data)!;
			if (data === 1) agent.addDescriptor(ReconciledDescriptor, 2);
			return {
				source,
				update: (next) => {
					if (shouldFail) throw new Error("binding update failed");
					source.set(next);
				},
				destroy: () => {
					cleaned++;
					source.destroy();
				},
			};
		});

		expect(() => agent.addDescriptor(ReconciledDescriptor, 1)).toThrow("binding update failed");
		expect(cleaned).toBe(1);
		expect(agent.getDescriptors(ReconciledDescriptor)).toEqual(new Set());
		expect(agent.getSources(Output)).toEqual(new Set());
		expect(agent.get(Value)).toBe(0);
		expect(notifications).toEqual([]);

		shouldFail = false;
		expect(agent.addDescriptor(ReconciledDescriptor, 3)?.get()).toBe(3);
	});
});
