import type { ResolvedDuplicatePolicy } from "./DuplicatePolicy.js";

export interface DuplicationCandidate<TData = unknown> {
	readonly type: AnyDuplicableType;
	get(): TData;
	destroy(): void;
}

export interface AnyDuplicableType {
	readonly duplication: ResolvedDuplicatePolicy<unknown, unknown>;
}

export interface DuplicableType<TInstance, TData> extends AnyDuplicableType {
	readonly duplication: ResolvedDuplicatePolicy<TInstance, TData>;
}
