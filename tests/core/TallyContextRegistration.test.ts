import { describe, expect, it, vi } from "vitest";
import {
	BooleanProperty,
	defineBooleanProperty,
	defineDescriptorType,
	defineNumberProperty,
	defineSourceType,
	NumberProperty,
	TallyContext,
	testReporter,
} from "../src/index.js";

describe("tally context lifecycle", () => {
	it("rejects mutations after destruction while keeping reads and callbacks safe", () => {
		const SourceType = defineSourceType<number>({
			name: "DestroyedContextSource",
			priority: 100,
			contribute: () => [],
		});
		const DescriptorType = defineDescriptorType<number, number>({
			name: "DestroyedContextDescriptor",
			source: SourceType,
		});
		const tally = new TallyContext<undefined>({ reporter: testReporter });
		tally.destroy();

		expect(tally.sources).toEqual(new Map());
		expect(tally.properties).toEqual(new Map());
		expect(tally.descriptors).toEqual(new Map());

		const sourceAdded = vi.fn();
		const descriptorAdded = vi.fn();
		const replication = vi.fn();
		const disconnectSource = tally.onSourceAdded(sourceAdded);
		const disconnectDescriptor = tally.onDescriptorAdded(descriptorAdded);
		const disconnectReplication = tally.onReplicationEmit(replication);

		expect(() => tally.createAgentState(undefined)).toThrow();
		expect(() => tally.register(SourceType)).toThrow();
		expect(() => tally.registerDescriptorHandler(DescriptorType, () => undefined)).toThrow();
		expect(() => tally.destroy()).not.toThrow();
		expect(sourceAdded).not.toHaveBeenCalled();
		expect(descriptorAdded).not.toHaveBeenCalled();
		expect(replication).not.toHaveBeenCalled();
		expect(() => disconnectSource()).not.toThrow();
		expect(() => disconnectDescriptor()).not.toThrow();
		expect(() => disconnectReplication()).not.toThrow();
	});
});

describe("tally context registry", () => {
	it("registers properties by name", () => {
		const tally = new TallyContext({ reporter: testReporter });
		const booleanProperty = tally.register(
			defineBooleanProperty({ name: "Boolean", defaultValue: false })
		);
		const numberProperty = tally.register(
			defineNumberProperty({ name: "Number", defaultValue: 0 })
		);

		expect(tally.properties).toEqual(
			new Map<string, BooleanProperty | NumberProperty>([
				["Boolean", booleanProperty],
				["Number", numberProperty],
			])
		);
		expect(tally.properties.get("Nonexistent")).toBeUndefined();
	});
	it("registers source types by name", () => {
		const tally = new TallyContext({ reporter: testReporter });
		const first = tally.register(
			defineSourceType({
				name: "Source1",
				priority: 100,
				contribute: () => [],
			})
		);
		const second = tally.register(
			defineSourceType({
				name: "Source2",
				priority: 100,
				contribute: () => [],
			})
		);

		expect(tally.sources).toEqual(
			new Map([
				["Source1", first],
				["Source2", second],
			])
		);
		expect(tally.sources.get("Nonexistent")).toBeUndefined();
	});
	it("allows the same property instance to be registered repeatedly", () => {
		const tally = new TallyContext({ reporter: testReporter });
		const property = defineBooleanProperty({ name: "Boolean", defaultValue: false });

		tally.register(property);
		tally.register(property);

		expect(tally.properties).toEqual(new Map([["Boolean", property]]));
	});
	it("rejects a different property with the same name", () => {
		const tally = new TallyContext({ reporter: testReporter });
		tally.register(defineBooleanProperty({ name: "Boolean", defaultValue: false }));

		expect(() =>
			tally.register(defineBooleanProperty({ name: "Boolean", defaultValue: false }))
		).toThrow("Duplicate property name: Boolean");
	});
	it("allows the same source type instance to be registered repeatedly", () => {
		const tally = new TallyContext({ reporter: testReporter });
		const sourceType = defineSourceType({
			name: "Source1",
			priority: 100,
			contribute: () => [],
		});

		tally.register(sourceType);
		tally.register(sourceType);

		expect(tally.sources).toEqual(new Map([["Source1", sourceType]]));
	});
	it("rejects a different source type with the same name", () => {
		const tally = new TallyContext({ reporter: testReporter });
		tally.register(
			defineSourceType({
				name: "Source1",
				priority: 100,
				contribute: () => [],
			})
		);

		expect(() =>
			tally.register(
				defineSourceType({
					name: "Source1",
					priority: 100,
					contribute: () => [],
				})
			)
		).toThrow("Duplicate source name: Source1");
	});
});
