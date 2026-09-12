import type { AdmissionTransaction } from "./AdmissionTransaction.js";
import type { DuplicationCandidate } from "./DuplicationCandidate.js";

export type DuplicationEntryState<TCandidate extends DuplicationCandidate, TRuntime> =
	| {
			readonly kind: "pending";
			readonly admission: AdmissionTransaction<TCandidate, TRuntime>;
	  }
	| {
			readonly kind: "live";
			readonly candidate: TCandidate;
	  }
	| {
			readonly kind: "removed";
	  };

export interface AnyDuplicationEntry {
	readonly domain: object;
	readonly key: string | undefined;
	readonly order: number;
	slot: number;
}

export interface DuplicationEntry<
	TCandidate extends DuplicationCandidate,
	TRuntime,
> extends AnyDuplicationEntry {
	readonly domain: object;
	readonly key: string | undefined;
	readonly order: number;
	slot: number;
	state: DuplicationEntryState<TCandidate, TRuntime>;
}
