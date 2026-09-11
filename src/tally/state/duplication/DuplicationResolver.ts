import type { Disconnect } from "../../util/Disconnect.js";
import type { PlannedInstance } from "../PlannedInstance.js";
import type {
	AnyDuplicableType,
	DuplicableType,
	DuplicationCandidate,
} from "./DuplicationCandidate.js";
import {
	DuplicationIndex,
	type DuplicationEntry,
	type LiveDuplicationEntry,
} from "./DuplicationIndex.js";

export type DuplicationDecision<TInstance extends DuplicationCandidate<TData>, TData> =
	| { readonly action: "add"; readonly evict: readonly DuplicationEntry[] }
	| { readonly action: "ignore" }
	| {
			readonly action: "reconcile";
			readonly target: TInstance;
			reconcile(): void;
	  };

export type DuplicationResult<TInstance extends DuplicationCandidate<TData>, TData> =
	| { readonly result: "added"; instance: TInstance; unregister(): void; publish(): void }
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
	): DuplicationDecision<TInstance, TData> {
		const policy = type.duplication;
		if (policy.kind === "allow") return DuplicationResolver.DecideAddStructure;

		const domain = this.domainOf(type);
		const conflicts = this.index.get(domain, key);
		if (policy.kind === "ignore") {
			if (conflicts.length > 0) return DuplicationResolver.DecideIgnoreStructure;
			else return DuplicationResolver.DecideAddStructure;
		}

		if (policy.kind === "replace") {
			if (conflicts.length > 0)
				return {
					action: "add",
					evict: conflicts,
				};
			return DuplicationResolver.DecideAddStructure;
		}

		if (policy.kind === "reconcile") {
			if (conflicts.length > 0) {
				const target = conflicts.values().next().value!.candidate as TInstance;
				return {
					action: "reconcile",
					target: conflicts.values().next().value!.candidate as TInstance,
					reconcile: () => policy.reconcile(target, data),
				};
			} else return DuplicationResolver.DecideAddStructure;
		}

		if (policy.kind === "group") {
			if (policy.group.policy === "ignore") {
				if (conflicts.length >= policy.group.maxStack)
					return DuplicationResolver.DecideIgnoreStructure;
				else return DuplicationResolver.DecideAddStructure;
			}
			if (policy.group.policy === "replace") {
				if (policy.group.maxStack <= 0) return DuplicationResolver.DecideIgnoreStructure;
				if (conflicts.length < policy.group.maxStack)
					return DuplicationResolver.DecideAddStructure;

				const selector = policy.group.selector;
				let selectedCandidate = conflicts.values().next().value!;
				let rank = selectedCandidate.score();
				let order = selectedCandidate.order;

				for (const conflict of conflicts) {
					const cRank = conflict.score();

					if (
						(selector === "oldest" && conflict.order < order) ||
						(selector === "newest" && conflict.order >= order) ||
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

				if (policy.replaceIf(rank, policy.rank(data))) {
					// TODO: Trim bucket size if needed, but I think we can run on the assumption that
					// buckets won't ever exceed max stack
					return { action: "add", evict: [selectedCandidate] };
				} else {
					return DuplicationResolver.DecideIgnoreStructure;
				}
			}
		}

		throw new Error(`Invalid policy kind "${policy.kind}"`);
	}

	resolve<TInstance extends DuplicationCandidate<TData>, TData>(
		plannedInstance: PlannedInstance<TInstance>,
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
			let score: (() => number) | undefined = undefined;
			if (type.duplication.kind === "group") {
				const rank = type.duplication.rank;
				score = () => rank(plannedInstance.get().get());
			}

			const plannedEntry = this.index.plan(this.domainOf(type), key, plannedInstance, score);
			decision.evict.forEach((entry) => entry.evict());

			try {
				const liveEntry = plannedEntry.commit();

				if (!liveEntry) return { result: "ignored" };

				return {
					result: "added",
					instance: liveEntry.candidate,
					unregister: () => liveEntry.evict(),
					publish: () => liveEntry.publish(),
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
