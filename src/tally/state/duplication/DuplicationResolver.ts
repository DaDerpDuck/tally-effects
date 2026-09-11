import type { AdmissionRuntime } from "../AdmissionRuntime.js";
import type { DuplicationCandidate } from "./DuplicationCandidate.js";
import type { AnyDuplicationEntry, DuplicationEntry } from "./DuplicationEntry.js";
import { DuplicationIndex } from "./DuplicationIndex.js";

export type DuplicationDecision<
	TData,
	TCandidate extends DuplicationCandidate<TData>,
	TRuntime extends AdmissionRuntime<TData>,
> =
	| { readonly action: "add"; readonly evict: readonly AnyDuplicationEntry[] }
	| { readonly action: "ignore" }
	| {
			readonly action: "reconcile";
			readonly target: DuplicationEntry<TData, TCandidate, TRuntime>;
			reconcile(target: TCandidate): void;
	  };

export class DuplicationResolver {
	private static readonly DecideAddStructure = { action: "add", evict: [] } as const;
	private static readonly DecideIgnoreStructure = { action: "ignore" } as const;

	constructor(private readonly index: DuplicationIndex) {}

	decide<
		TData,
		TCandidate extends DuplicationCandidate<TData>,
		TRuntime extends AdmissionRuntime<TData>,
	>(
		entry: DuplicationEntry<TData, TCandidate, TRuntime>
	): DuplicationDecision<TData, TCandidate, TRuntime> {
		const entryState = entry.state;
		if (entryState.kind === "removed") return DuplicationResolver.DecideIgnoreStructure;

		const candidate =
			entryState.kind === "pending"
				? entryState.admission.pendingCandidate()
				: entryState.candidate;

		const domain = entry.domain;
		const key = entry.key;
		const type = candidate.type;
		const data = candidate.get();
		const policy = type.duplication;
		if (policy.kind === "allow") return DuplicationResolver.DecideAddStructure;

		const snapshot = this.index.snapshot(entry.domain, entry.key);

		if (policy.kind === "ignore") {
			return this.hasOther(snapshot.entries, entry)
				? DuplicationResolver.DecideIgnoreStructure
				: DuplicationResolver.DecideAddStructure;
		}

		if (policy.kind === "replace") {
			const evictions = snapshot.entries.filter((x) => x !== entry);
			return evictions.length > 0
				? {
						action: "add",
						evict: evictions,
					}
				: DuplicationResolver.DecideAddStructure;
		}

		if (policy.kind === "reconcile") {
			if (this.hasOther(snapshot.entries, entry)) {
				const reconcileTarget = this.firstOther(
					snapshot.entries,
					entry
				)! as DuplicationEntry<TData, TCandidate, TRuntime>;
				return {
					action: "reconcile",
					target: reconcileTarget,
					reconcile: (target) => policy.reconcile(target, data),
				};
			} else return DuplicationResolver.DecideAddStructure;
		}

		if (policy.kind === "group") {
			if (policy.group.policy === "ignore") {
				let conflictCount = 0;
				for (const conflict of snapshot.entries) {
					if (conflict !== entry) conflictCount++;
				}

				return conflictCount >= policy.group.maxStack
					? DuplicationResolver.DecideIgnoreStructure
					: DuplicationResolver.DecideAddStructure;
			}

			if (policy.group.policy === "replace") {
				if (policy.group.maxStack <= 0) return DuplicationResolver.DecideIgnoreStructure;

				/* User-provided rank/replaceIf methods may cause reentrant behavior,
				so we must revalidate the index hasn't changed */
				const selector = policy.group.selector;
				for (;;) {
					const snapshot = this.index.snapshot(domain, key);
					const conflicts = snapshot.entries.filter((x) => x !== entry);
					if (conflicts.length < policy.group.maxStack)
						return DuplicationResolver.DecideAddStructure;

					let selectedCandidate = conflicts[0]!;
					let rank = selectedCandidate.score();
					let order = selectedCandidate.order;

					for (let i = 1; i < conflicts.length; i++) {
						const conflict = conflicts[i]!;
						if (conflict === entry) continue;
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
						if (this.index.isCurrent(snapshot))
							// TODO: Select the full eviction set when this bucket already exceeds maxStack.
							return { action: "add", evict: [selectedCandidate] };
					} else if (this.index.isCurrent(snapshot)) {
						return DuplicationResolver.DecideIgnoreStructure;
					}
				}
			}
		}

		throw new Error(`Invalid policy kind "${policy.kind}"`);
	}

	private hasOther(
		entries: readonly AnyDuplicationEntry[],
		incoming: AnyDuplicationEntry
	): boolean {
		for (const entry of entries) {
			if (entry !== incoming) return true;
		}
		return false;
	}

	private firstOther<TEntry extends AnyDuplicationEntry>(
		entries: readonly TEntry[],
		incoming: AnyDuplicationEntry
	): TEntry | undefined {
		for (const entry of entries) {
			if (entry !== incoming) return entry;
		}
		return undefined;
	}
}
