import { describe, expect, it } from "vitest";
import { mutationError } from "../fixtures/MutationGate.js";
import {
	AgentState,
	createTestReporter,
	defineNumberProperty,
	defineSourceType,
} from "../src/index.js";

describe("restricted hook mutation reentrancy", () => {
	it("reports and retains the last cache when property resolution attempts mutation", () => {
		const { reporter, reports } = createTestReporter();
		const agent = new AgentState(undefined, { reporter });
		const Nested = defineSourceType<undefined>({
			name: "NestedPropertyResolutionAdmission",
			priority: 100,
			contribute: () => [],
		});
		const Property = defineNumberProperty({
			name: "RestrictedPropertyResolution",
			defaultValue: 0,
			valueEquals: Object.is,
			resolve: () => {
				agent.addSource(Nested);
				return 1;
			},
		});
		const Restricted = defineSourceType<undefined>({
			name: "RestrictedPropertyResolutionSource",
			priority: 100,
			contribute: () => [Property.add(1)],
		});

		expect(agent.addSource(Restricted)).toBeDefined();
		expect(agent.get(Property)).toBe(0);
		expect(agent.getSources(Nested)).toEqual(new Set());
		expect(reports).toHaveLength(2);
		expect(reports).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "property-resolution-failed",
					error: expect.objectContaining({
						message: mutationError("property-resolution"),
					}),
				}),
			])
		);

		const Unrelated = defineSourceType<undefined>({
			name: "PropertyResolutionRetryTrigger",
			priority: 100,
			contribute: () => [],
		});
		expect(agent.addSource(Unrelated)).toBeDefined();
		expect(reports).toHaveLength(4);
		expect(agent.get(Property)).toBe(0);
	});
	it("reports and retains the last cache when property equality attempts mutation", () => {
		const { reporter, reports } = createTestReporter();
		const agent = new AgentState(undefined, { reporter });
		const Nested = defineSourceType<undefined>({
			name: "NestedPropertyEqualityAdmission",
			priority: 100,
			contribute: () => [],
		});
		const Property = defineNumberProperty({
			name: "RestrictedPropertyEquality",
			defaultValue: 0,
			resolve: () => 1,
			valueEquals: () => {
				agent.addSource(Nested);
				return false;
			},
		});
		const Restricted = defineSourceType<undefined>({
			name: "RestrictedPropertyEqualitySource",
			priority: 100,
			contribute: () => [Property.add(1)],
		});

		expect(agent.addSource(Restricted)).toBeDefined();
		expect(agent.get(Property)).toBe(0);
		expect(agent.getSources(Nested)).toEqual(new Set());
		expect(reports).toHaveLength(2);
		expect(reports).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "property-equality-failed",
					error: expect.objectContaining({
						message: mutationError("property-equality"),
					}),
				}),
			])
		);

		const Unrelated = defineSourceType<undefined>({
			name: "PropertyEqualityRetryTrigger",
			priority: 100,
			contribute: () => [],
		});
		expect(agent.addSource(Unrelated)).toBeDefined();
		expect(reports).toHaveLength(4);
		expect(agent.get(Property)).toBe(0);
	});
});
