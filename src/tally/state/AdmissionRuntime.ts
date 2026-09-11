import type { AdmissionLease } from "./AdmissionTransaction.js";
import type { DuplicationCandidate } from "./duplication/DuplicationCandidate.js";

export type RuntimeOwnership =
	| {
			readonly kind: "admitting";
			readonly lease: AdmissionLease;
	  }
	| {
			readonly kind: "live";
			readonly unlink: () => void;
	  }
	| {
			readonly kind: "destroyed";
	  };

export interface AdmissionRuntime<TData> {
	/** The public candidate facade; it may exist before the admission is live. */
	readonly instance: DuplicationCandidate<TData>;

	/** Compute provisional runtime state without manager publication or lifecycle events. */
	prepare(): void;
	/** Register prepared state with the owning manager; the duplication entry stays pending. */
	install(): void;
	/** Publish the added notification; callbacks may reenter and cancel the admission. */
	announceAdded(): void;
	/** Transfer the runtime to live ownership with an exact index-unlink capability. */
	markLive(unlink: () => void): void;
	/** Undo partial preparation/installation; does not commit or perform pending-index policy. */
	rollbackAdmission(): void;
}
