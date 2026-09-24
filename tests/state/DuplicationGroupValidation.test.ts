import { describe, expect, it } from "vitest";
import { DuplicationGroup } from "../src/index.js";

describe("duplication group validation", () => {
	it.each([Number.NaN, 1.5])("rejects an invalid maxStack of %s", (maxStack) => {
		expect(
			() =>
				new DuplicationGroup({
					policy: "replace",
					maxStack,
					selector: "oldest",
				})
		).toThrow(/maxStack/);
	});

	it.each([
		{ policy: "invalid", maxStack: 1, selector: "oldest" },
		{ policy: "replace", maxStack: 1, selector: "invalid" },
	])("rejects an invalid runtime group definition %#", (definition) => {
		expect(() => new DuplicationGroup(definition as never)).toThrow();
	});
});
