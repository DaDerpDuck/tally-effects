import { afterAll } from "vitest";

globalThis.__tallyDuplicationTransactionSuite = "reentrant admission, reconciliation, and rollback";
await import("../fixtures/DuplicationTransactionCases.js");
afterAll(() => {
	globalThis.__tallyDuplicationTransactionSuite = undefined;
});
