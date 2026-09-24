import { afterAll } from "vitest";

globalThis.__tallyDuplicationTransactionSuite = "Descriptor admission and teardown reentrancy";
await import("../fixtures/DuplicationTransactionCases.js");
afterAll(() => {
	globalThis.__tallyDuplicationTransactionSuite = undefined;
});
