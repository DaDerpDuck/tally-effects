import { afterAll } from "vitest";

globalThis.__tallyDuplicationTransactionSuite = "Source admission and teardown reentrancy";
await import("../fixtures/duplicationTransactionCases.js");
afterAll(() => {
	globalThis.__tallyDuplicationTransactionSuite = undefined;
});
