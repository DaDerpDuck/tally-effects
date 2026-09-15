import { afterAll } from "vitest";

globalThis.__tallyDuplicationTransactionSuite = "Descriptor admission and teardown reentrancy";
await import("../fixtures/duplicationTransactionCases.js");
afterAll(() => {
	globalThis.__tallyDuplicationTransactionSuite = undefined;
});
