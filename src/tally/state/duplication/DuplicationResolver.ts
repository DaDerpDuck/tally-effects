import type { PlannedInstance } from "../PlannedInstance.js";
import type {
	AnyDuplicableType,
	DuplicableType,
	DuplicationCandidate,
} from "./DuplicationCandidate.js";
import type { AnyDuplicationEntry, DuplicationEntry } from "./DuplicationEntry.js";
import { DuplicationIndex } from "./DuplicationIndex.js";

export type DuplicationDecision =
	| { readonly action: "add"; readonly evict: readonly AnyDuplicationEntry[] }
	| { readonly action: "ignore" }
	| {
			readonly action: "reconcile";
			reconcile(): void;
	  };

export type DuplicationResult<TInstance extends DuplicationCandidate<TData>, TData> =
	| { readonly result: "added"; publish(): TInstance | undefined }
	| { readonly result: "ignored" }
	| { readonly result: "reconciled" };

export class DuplicationResolver {
	private static readonly DecideAddStructure = { action: "add", evict: [] } as const;
	private static readonly DecideIgnoreStructure = { action: "ignore" } as const;

	constructor(private readonly index: DuplicationIndex) {}

	decide<TInstance extends DuplicationCandidate<TData>, TData>(
		type: DuplicableType<TInstance, TData>,
		data: TData,
		key: string | undefined
	): DuplicationDecision {
		const policy = type.duplication;
		if (policy.kind === "allow") return DuplicationResolver.DecideAddStructure;

		const domain = this.domainOf(type);
		if (policy.kind === "ignore") {
			if (this.index.size(domain, key) > 0) return DuplicationResolver.DecideIgnoreStructure;
			else return DuplicationResolver.DecideAddStructure;
		}

		if (policy.kind === "replace") {
			if (this.index.size(domain, key) > 0)
				return {
					action: "add",
					evict: this.index.snapshot(domain, key),
				};
			return DuplicationResolver.DecideAddStructure;
		}

		if (policy.kind === "reconcile") {
			if (this.index.size(domain, key) > 0) {
				const entry = this.index.first(domain, key)! as DuplicationEntry<TInstance>;
				return {
					action: "reconcile",
					reconcile: () => {
						if (entry.state.kind === "pending")
							entry.state.afterCommit.push(() =>
								policy.reconcile(
									entry.state.kind === "pending"
										? entry.state.planned.get()
										: entry.state.candidate,
									data
								)
							);
						else policy.reconcile(entry.state.candidate, data);
					},
				};
			} else return DuplicationResolver.DecideAddStructure;
		}

		if (policy.kind === "group") {
			if (policy.group.policy === "ignore") {
				if (this.index.size(domain, key) >= policy.group.maxStack)
					return DuplicationResolver.DecideIgnoreStructure;
				else return DuplicationResolver.DecideAddStructure;
			}
			if (policy.group.policy === "replace") {
				if (policy.group.maxStack <= 0) return DuplicationResolver.DecideIgnoreStructure;

				/* User-provided rank/replaceIf methods may cause reentrant behavior,
				so we must revalidate the index hasn't changed */
				const selector = policy.group.selector;
				for (;;) {
					const revision = this.index.getRevision(domain, key);
					const conflicts = this.index.snapshot(domain, key);
					if (conflicts.length < policy.group.maxStack)
						return DuplicationResolver.DecideAddStructure;

					let selectedCandidate = conflicts[0]!;
					let rank = selectedCandidate.score();
					let order = selectedCandidate.order;

					for (let i = 1; i < conflicts.length; i++) {
						const conflict = conflicts[i]!;
						if (
							(selector === "oldest" && conflict.order < order) ||
							(selector === "newest" && conflict.order >= order)
						) {
							rank = conflict.score();
							order = conflict.order;
							selectedCandidate = conflict;
						} else {
							const cRank = conflict.score();
							if (
								(selector === "lowest" &&
									(cRank < rank || (cRank === rank && conflict.order < order))) ||
								(selector === "highest" &&
									(cRank > rank || (cRank === rank && conflict.order >= order)))
							) {
								rank = cRank;
								order = conflict.order;
								selectedCandidate = conflict;
							}
						}
					}

					if (policy.replaceIf(rank, policy.rank(data))) {
						if (this.index.getRevision(domain, key) === revision)
							// TODO: Select the full eviction set when this bucket already exceeds maxStack.
							return { action: "add", evict: [selectedCandidate] };
					} else {
						if (this.index.getRevision(domain, key) === revision)
							return DuplicationResolver.DecideIgnoreStructure;
					}
				}
			}
		}

		throw new Error(`Invalid policy kind "${policy.kind}"`);
	}

	resolve<TInstance extends DuplicationCandidate<TData>, TData>(
		plannedInstanceSupplier: () => PlannedInstance<TInstance> | undefined,
		type: DuplicableType<TInstance, TData>,
		data: TData,
		key: string | undefined
	): DuplicationResult<TInstance, TData> {
		const decision = this.decide(type, data, key);
		if (decision.action === "ignore") return { result: "ignored" };
		if (decision.action === "reconcile") {
			decision.reconcile();
			return { result: "reconciled" };
		}
		if (decision.action === "add") {
			const plannedInstance = plannedInstanceSupplier();
			if (!plannedInstance) return { result: "ignored" };
			let score: (() => number) | undefined = undefined;
			if (type.duplication.kind === "group") {
				const rank = type.duplication.rank;
				score = () => rank(plannedInstance.get().get());
			}

			const plannedEntry = this.index.plan(this.domainOf(type), key, plannedInstance, score);
			const afterCommitCallbacks =
				plannedEntry.entry.state.kind === "pending"
					? plannedEntry.entry.state.afterCommit
					: [];

			try {
				decision.evict.forEach((entry) => entry.evict());
				const liveEntry = plannedEntry.commit();

				if (!liveEntry) return { result: "ignored" };

				return {
					result: "added",
					publish: () => {
						try {
							afterCommitCallbacks.forEach((callback) =>{
								if (liveEntry.entry.active) callback(liveEntry.candidate)
							});
							if (liveEntry.entry.active) {
								liveEntry.publish();
								return liveEntry.entry.active ? liveEntry.candidate : undefined;
							} else {
								liveEntry.evict();
							}
						} catch (e) {
							liveEntry.evict();
							throw e;
						}
					},
				};
			} finally {
				plannedEntry.evict();
			}
		}
		throw new Error("Unknown decision action");
	}

	private domainOf(type: AnyDuplicableType): object {
		return type.duplication.kind === "group" ? type.duplication.group : type;
	}
}
