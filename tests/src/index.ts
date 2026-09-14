export * from "../../src/index.js";

import type { TallyReport, TallyReporter } from "../../src/index.js";

export const testReporter: TallyReporter = {
	report: () => {},
};

export function createTestReporter() {
	const reports: TallyReport[] = [];
	const reporter: TallyReporter = {
		report(report) {
			reports.push(report);
		},
	};
	return { reporter, reports };
}
