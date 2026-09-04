import type { Disconnect } from "../../util/Disconnect.js";
import type {
	AnyDuplicableType,
	DuplicableType,
	DuplicationCandidate,
} from "./DuplicationCandidate.js";
import { DuplicationIndex } from "./DuplicationIndex.js";

export type DuplicationDecision<TInstance extends DuplicationCandidate<TData>, TData> =
	| { readonly action: "add"; evict: readonly DuplicationCandidate[] }
	| { readonly action: "ignore" }
	| {
			readonly action: "reconcile";
			readonly target: TInstance;
			reconcile(existing: TInstance, incoming: TData): void;
	  };

export class DuplicationResolver {
	private order = 0;

	constructor(private readonly index: DuplicationIndex) {}

	decide<TInstance extends DuplicationCandidate<TData>, TData>(
		type: DuplicableType<TInstance, TData>,
		data: TData,
		key: string | undefined
	): DuplicationDecision<TInstance, TData> {
		const policy = type.duplication;
		if (policy.kind === "allow") return { action: "add", evict: [] };

		const domain = this.domainOf(type);
		const conflicts = this.index.get(domain, key);
		if (policy.kind === "ignore") {
			if (conflicts.length > 0) return { action: "ignore" };
			else return { action: "add", evict: [] };
		}

		if (policy.kind === "replace") {
			if (conflicts.length > 0)
				return { action: "add", evict: conflicts.map((entry) => entry.candidate) };
			return { action: "add", evict: [] };
		}

		if (policy.kind === "reconcile") {
			if (conflicts.length > 0)
				return {
					action: "reconcile",
					target: conflicts[0]!.candidate as TInstance,
					reconcile: policy.reconcile,
				};
			else return { action: "add", evict: [] };
		}

		if (policy.kind === "group") {
			if (policy.group.policy === "ignore") {
				if (conflicts.length >= policy.group.maxStack) return { action: "ignore" };
				else return { action: "add", evict: [] };
			}
			if (policy.group.policy === "replace") {
				if (policy.group.maxStack <= 0) return { action: "ignore" };
				if (conflicts.length < policy.group.maxStack) return { action: "add", evict: [] };

				const selector = policy.group.selector;
				let selectedCandidate = conflicts[0]!;
				let rank = selectedCandidate.score();
				let order = selectedCandidate.order;

				for (let i = 1; i < conflicts.length; i++) {
					const conflict = conflicts[i]!;
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
					return { action: "add", evict: [selectedCandidate!.candidate] };
				} else {
					return { action: "ignore" };
				}
			}
		}

		throw new Error(`Invalid policy kind "${policy.kind}"`);
	}

	track<TInstance extends DuplicationCandidate<TData>, TData>(
		type: DuplicableType<TInstance, TData>,
		key: string | undefined,
		instance: TInstance
	): Disconnect {
		const order = this.order++;
		let score: () => number;
		let replaceIf: (existingRank: number, incomingRank: number) => boolean;
		if (type.duplication.kind === "group") {
			const rank = type.duplication.rank;
			score = () => rank(instance.get());
			replaceIf = type.duplication.replaceIf;
		} else {
			score = () => order;
			replaceIf = () => true;
		}

		return this.index.add(this.domainOf(type), key, {
			candidate: instance,
			order,
			score,
			replaceIf,
		});
	}

	private domainOf(type: AnyDuplicableType): object {
		return type.duplication.kind === "group" ? type.duplication.group : type;
	}
}
