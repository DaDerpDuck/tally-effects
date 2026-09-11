import { getOrInsertComputed } from "../../util/GetOrInsert.js";
import type { PlannedInstance } from "../PlannedInstance.js";
import type { DuplicationCandidate } from "./DuplicationCandidate.js";
import type {
	AnyDuplicationEntry,
	DuplicationEntry,
	LiveDuplicationEntryHandle,
	PlannedDuplicationEntryHandle,
} from "./DuplicationEntry.js";

interface DuplicationBucket {
	readonly entries: AnyDuplicationEntry[];
	shrink(): void;
}

export class DuplicationIndex {
	private static readonly EmptyArray = new Array<AnyDuplicationEntry>(0);
	private order = 0;

	private readonly duplicationStruct = {
		unkeyed: new Map<object, AnyDuplicationEntry[]>(),
		keyed: new Map<object, Map<string, AnyDuplicationEntry[]>>(),
	} as const;

	get(domain: object, key: string | undefined): readonly AnyDuplicationEntry[] {
		if (key === undefined)
			return (
				this.duplicationStruct.unkeyed.get(domain)?.slice() ?? DuplicationIndex.EmptyArray
			);
		else
			return (
				this.duplicationStruct.keyed.get(domain)?.get(key)?.slice() ??
				DuplicationIndex.EmptyArray
			);
	}

	plan<TInstance extends DuplicationCandidate>(
		domain: object,
		key: string | undefined,
		plannedInstance: PlannedInstance<TInstance>,
		score?: () => number
	): PlannedDuplicationEntryHandle<TInstance> {
		const bucket = this.getOrCreateBucket(domain, key);
		const entryOrder = this.order++;
		const stableEntry: DuplicationEntry<TInstance> = {
			order: entryOrder,
			score: score ?? (() => entryOrder),
			state: {
				kind: "pending",
				planned: plannedInstance,
				afterCommit: [],
			},
			active: true,
			committed: false,

			evict() {
				if (!this.active) return;
				this.active = false;
				const index = bucket.entries.findIndex((e) => Object.is(e, this));
				if (index < 0) return;
				bucket.entries[index] = bucket.entries[bucket.entries.length - 1]!;
				bucket.entries.pop();
				bucket.shrink();
				if (this.state.kind === "pending") this.state.planned.cancel();
				else this.state.candidate.destroy();
			},
		};

		const plannedHandle: PlannedDuplicationEntryHandle<TInstance> = {
			kind: "pending",
			entry: stableEntry,
			commit() {
				if (
					!this.entry.active ||
					this.entry.committed ||
					this.entry.state.kind !== "pending"
				)
					return;
				const liveCandidate = this.entry.state.planned.commit();
				if (!liveCandidate) return;
				if (!this.entry.active) {
					liveCandidate.destroy();
					return;
				}

				const publish = this.entry.state.planned.publish;

				this.entry.state = {
					kind: "live",
					candidate: liveCandidate,
				};
				this.entry.committed = true;

				const liveHandle: LiveDuplicationEntryHandle<TInstance> = {
					kind: "live",
					entry: stableEntry,
					candidate: liveCandidate,
					publish() {
						publish(liveCandidate);
					},
					evict() {
						this.entry.evict();
					},
				};

				return liveHandle;
			},
			afterCommit(callback) {
				if (this.entry.state.kind !== "pending") return;
				this.entry.state.afterCommit.push(callback);
			},
			evict() {
				if (this.entry.committed) return;
				this.entry.evict();
			},
		};

		bucket.entries.push(stableEntry);
		return plannedHandle;
	}

	private getOrCreateBucket(domain: object, key: string | undefined): DuplicationBucket {
		if (key === undefined) {
			const entries = getOrInsertComputed(this.duplicationStruct.unkeyed, domain, () => []);
			return {
				entries,
				shrink: () => {
					if (entries.length === 0) this.duplicationStruct.unkeyed.delete(domain);
				},
			};
		} else {
			const keyBucket = getOrInsertComputed(
				this.duplicationStruct.keyed,
				domain,
				() => new Map<string, DuplicationEntry[]>()
			);
			const entries = getOrInsertComputed(keyBucket, key, () => []);
			return {
				entries,
				shrink: () => {
					if (entries.length === 0) keyBucket.delete(key);
					if (keyBucket.size === 0) this.duplicationStruct.keyed.delete(domain);
				},
			};
		}
	}
}
