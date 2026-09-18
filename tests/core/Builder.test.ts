import { describe, expect, it } from "vitest";
import {
	AgentState,
	defineDescriptorType,
	defineNumberProperty,
	defineSourceType,
	testReporter,
} from "../src/index.js";

describe("agent state builders", () => {
	it("adds Sources with the builder's configured options", () => {
		const property = defineNumberProperty({
			name: "BuilderSourceProperty",
			defaultValue: 0,
		});
		const sourceType = defineSourceType<number>({
			name: "BuilderSource",
			priority: 100,
			contribute: (value) => [property.add(value)],
		});
		const agent = new AgentState(undefined, { reporter: testReporter });
		const builder = agent
			.makeSource(sourceType)
			.priority(25)
			.key("poison")
			.provenance({ domain: "local", sequence: 10 });

		const first = builder.add(1)!;
		const second = builder.add(2)!;

		expect(agent.get(property)).toBe(3);
		expect(first).toMatchObject({
			type: sourceType,
			priority: 25,
			key: "poison",
			provenance: { domain: "local", sequence: 10 },
		});
		expect(second).toMatchObject({
			type: sourceType,
			priority: 25,
			key: "poison",
			provenance: { domain: "local", sequence: 10 },
		});
	});

	it("adds Descriptors with the builder's configured options", () => {
		const property = defineNumberProperty({
			name: "BuilderDescriptorProperty",
			defaultValue: 0,
		});
		const sourceType = defineSourceType<number>({
			name: "BuilderDescriptorSource",
			priority: 100,
			contribute: (value) => [property.add(value)],
		});
		const descriptorType = defineDescriptorType<number, number>({
			name: "BuilderDescriptor",
			source: sourceType,
		});
		const agent = new AgentState(undefined, { reporter: testReporter });
		agent.registerDescriptorHandler(descriptorType, (context, data) => {
			const source = context.addSource(data)!;
			return {
				source,
				update: (next) => source.set(next),
				destroy: () => source.destroy(),
			};
		});

		const descriptor = agent
			.makeDescriptor(descriptorType)
			.key("nearby-wolf")
			.provenance({ domain: "local", sequence: 20 })
			.add(5)!;

		expect(agent.get(property)).toBe(5);
		expect(descriptor).toMatchObject({
			type: descriptorType,
			key: "nearby-wolf",
			provenance: { domain: "local", sequence: 20 },
		});
		expect(descriptor.getSource().provenance).toEqual({
			domain: "descriptor-local",
			sequence: 20,
		});
	});
});
