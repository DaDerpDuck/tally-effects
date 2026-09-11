import type { PlannedInstance } from "../PlannedInstance.js";
import type { DuplicationCandidate } from "./DuplicationCandidate.js";

export type DuplicationEntryState<T extends DuplicationCandidate> =
	| {
			readonly kind: "pending";
			readonly planned: PlannedInstance<T>;
			readonly afterCommit: Array<(instance: T) => void>;
	  }
	| {
			readonly kind: "live";
			readonly candidate: T;
	  };

export interface AnyDuplicationEntry {
	readonly order: number;
	readonly score: () => number;
	slot: number;
	active: boolean;
	committed: boolean;

	evict(): void;
}

export interface DuplicationEntry<
	T extends DuplicationCandidate = DuplicationCandidate,
> extends AnyDuplicationEntry {
	readonly order: number;
	readonly score: () => number;
	state: DuplicationEntryState<T>;
	slot: number;
	active: boolean;
	committed: boolean;

	evict(): void;
}

export interface PlannedDuplicationEntryHandle<T extends DuplicationCandidate> {
	readonly kind: "pending";
	readonly entry: DuplicationEntry<T>;
	readonly commit: () => LiveDuplicationEntryHandle<T> | undefined;
	readonly afterCommit: (callback: (instance: T) => void) => void;
	readonly evict: () => void;
}

export interface LiveDuplicationEntryHandle<T extends DuplicationCandidate> {
	readonly kind: "live";
	readonly entry: DuplicationEntry<T>;
	readonly candidate: T;
	readonly publish: () => void;
	readonly evict: () => void;
}
