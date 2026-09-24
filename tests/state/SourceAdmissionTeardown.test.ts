import { afterAll } from "vitest";

globalThis.__tallyDuplicationTransactionSuite = "Source admission and teardown reentrancy";
await import("../fixtures/DuplicationTransactionCases.js");
afterAll(() => {
	globalThis.__tallyDuplicationTransactionSuite = undefined;
});
