/** A stable category for a failure reported by Tally. */
export type TallyReportCode =
	| "binding-cleanup-failed"
	| "callback-failed"
	| "derived-source-cleanup-failed"
	| "property-equality-failed"
	| "property-resolution-failed"
	| "replication-serialization-failed";

/** The public lifecycle operation in which a report occurred. */
export type TallyReportOperation = "admit" | "destroy" | "resolve" | "update";

/** A public event being observed, where the failure occurred during observation. */
export type TallyReportEvent =
	| "descriptor-added"
	| "descriptor-removed"
	| "descriptor-updated"
	| "property-changed"
	| "replication-emitted"
	| "source-added"
	| "source-removed"
	| "source-updated";

/**
 * Identifies the public entity associated with a diagnostic report.
 *
 * Subjects are discriminated by {@link kind} and carry only stable identity
 * data, allowing hosts to route or display reports without depending on
 * Tally's internal runtime objects.
 */
export type TallyReportSubject =
	| {
			readonly kind: "property";
			readonly name: string;
	  }
	| {
			readonly kind: "source";
			readonly type: string;
			readonly id: number;
	  }
	| {
			readonly kind: "descriptor";
			readonly type: string;
			readonly id: number;
	  };

/**
 * A host-owned diagnostic emitted for failures Tally can safely contain.
 */
export interface TallyReport {
	readonly error: unknown;
	readonly code: TallyReportCode;
	readonly operation: TallyReportOperation;
	readonly event?: TallyReportEvent | undefined;
	readonly subject?: TallyReportSubject | undefined;
}

export interface TallyReporter {
	report(report: TallyReport): void;
}

export function tallyReport(reporter: TallyReporter, report: TallyReport) {
	try {
		reporter.report(report);
	} catch (e) {
		void e;
	}
}
