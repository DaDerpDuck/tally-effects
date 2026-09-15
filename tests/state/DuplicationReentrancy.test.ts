import { afterAll } from "vitest";

globalThis.__tallyDuplicationTransactionSuite = "reentrant admission, reconciliation, and rollback";
await import("../fixtures/duplicationTransactionCases.js");
afterAll(() => {
	globalThis.__tallyDuplicationTransactionSuite = undefined;
});
