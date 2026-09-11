import type { AdmissionRuntime } from "./AdmissionRuntime.js";
import type { AdmissionLease } from "./AdmissionTransaction.js";
import type { DuplicableType, DuplicationCandidate } from "./duplication/DuplicationCandidate.js";

export interface AdmissionPlan<
	TData,
	TCandidate extends DuplicationCandidate<TData>,
	TRuntime extends AdmissionRuntime<TData>,
> {
	readonly type: DuplicableType<TCandidate, TData>;
	readonly key: string | undefined;
	readonly data: TData;
	createRuntime(lease: AdmissionLease): TRuntime | undefined;
}
