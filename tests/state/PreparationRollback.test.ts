import { afterAll } from "vitest";

globalThis.__tallyDuplicationTransactionSuite = "failed preparation and contribution rollback";
await import("../fixtures/DuplicationTransactionCases.js");
afterAll(() => {
	globalThis.__tallyDuplicationTransactionSuite = undefined;
});
