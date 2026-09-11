import type { AdmissionRuntime } from "../AdmissionRuntime.js";
import type { AdmissionTransaction } from "../AdmissionTransaction.js";
import type { DuplicationCandidate } from "./DuplicationCandidate.js";

export type DuplicationEntryState<
	TData,
	TCandidate extends DuplicationCandidate<TData>,
	TRuntime extends AdmissionRuntime<TData>,
> =
	| {
			readonly kind: "pending";
			readonly admission: AdmissionTransaction<TData, TCandidate, TRuntime>;
	  }
	| {
			readonly kind: "live";
			readonly candidate: TCandidate;
	  }
	| {
			readonly kind: "removed";
	  };

type EntryStateKinds = DuplicationEntryState<
	unknown,
	DuplicationCandidate<unknown>,
	AdmissionRuntime<unknown>
>["kind"];

export interface AnyDuplicationEntry {
	readonly domain: object;
	readonly key: string | undefined;
	readonly order: number;
	slot: number;
	state: { readonly kind: EntryStateKinds };
	score(): number;
}

export interface DuplicationEntry<
	TData,
	TCandidate extends DuplicationCandidate<TData>,
	TRuntime extends AdmissionRuntime<TData>,
> extends AnyDuplicationEntry {
	readonly domain: object;
	readonly key: string | undefined;
	readonly order: number;
	slot: number;
	state: DuplicationEntryState<TData, TCandidate, TRuntime>;
	score(): number;
}
