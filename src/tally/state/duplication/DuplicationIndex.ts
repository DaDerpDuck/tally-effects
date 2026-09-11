import { getOrInsertComputed } from "../../util/GetOrInsert.js";
import type { PlannedInstance } from "../PlannedInstance.js";
import type { DuplicationCandidate } from "./DuplicationCandidate.js";
import type {
	AnyDuplicationEntry,
	DuplicationEntry,
	LiveDuplicationEntryHandle,
	PlannedDuplicationEntryHandle,
} from "./DuplicationEntry.js";

class DuplicationBucket {
	readonly entries: AnyDuplicationEntry[] = [];
	public revision = 0;

	constructor(
		readonly domain: object,
		readonly key: string | undefined
	) {}
}

export class DuplicationIndex {
	private static readonly EmptyArray = new Array<AnyDuplicationEntry>(0);
	private order = 0;

	private readonly duplicationStruct = {
		unkeyed: new Map<object, DuplicationBucket>(),
		keyed: new Map<object, Map<string, DuplicationBucket>>(),
	} as const;

	getRevision(domain: object, key: string |undefined): number {
		return this.getBucket(domain, key)?.revision ?? -1;
	}

	size(domain: object, key: string | undefined) {
		return this.view(domain, key).length;
	}

	first(domain: object, key: string | undefined) {
		return this.view(domain, key)[0];
	}

	snapshot(domain: object, key: string | undefined): readonly AnyDuplicationEntry[] {
		return this.view(domain, key).slice();
	}

	view(domain: object, key: string | undefined): readonly AnyDuplicationEntry[] {
		if (key === undefined)
			return (
				this.duplicationStruct.unkeyed.get(domain)?.entries ??
				DuplicationIndex.EmptyArray
			);
		else
			return (
				this.duplicationStruct.keyed.get(domain)?.get(key)?.entries ??
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
		// eslint-disable-next-line @typescript-eslint/no-this-alias
		const self = this;
		const stableEntry: DuplicationEntry<TInstance> = {
			order: entryOrder,
			score: score ?? (() => entryOrder),
			state: {
				kind: "pending",
				planned: plannedInstance,
				afterCommit: [],
			},
			slot: bucket.entries.length,
			active: true,
			committed: false,

			evict() {
				if (!this.active) return;
				this.active = false;
				if (this.slot < 0) return;
				bucket.entries[this.slot] = bucket.entries[bucket.entries.length - 1]!;
				bucket.entries[this.slot]!.slot = this.slot;
				bucket.entries.pop();
				this.slot = -1;
				if (bucket.entries.length === 0) {
					if (bucket.key === undefined) {
						self.duplicationStruct.unkeyed.delete(bucket.domain);
					} else {
						const keyBucket = self.duplicationStruct.keyed.get(bucket.domain);
						keyBucket?.delete(bucket.key);
						if (keyBucket?.size === 0)
							self.duplicationStruct.keyed.delete(bucket.domain);
					}
				}

				bucket.revision++;
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

				// planned instance will be reachable until publication finishes
				const planned = this.entry.state.planned;

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
						planned.publish(liveCandidate);
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
		bucket.revision++;
		return plannedHandle;
	}

	private getOrCreateBucket(domain: object, key: string | undefined): DuplicationBucket {
		if (key === undefined) {
			return getOrInsertComputed(
				this.duplicationStruct.unkeyed,
				domain,
				() => new DuplicationBucket(domain, key)
			);
		} else {
			const keyBucket = getOrInsertComputed(
				this.duplicationStruct.keyed,
				domain,
				() => new Map<string, DuplicationBucket>()
			);
			return getOrInsertComputed(keyBucket, key, () => new DuplicationBucket(domain, key));
		}
	}

	private getBucket(domain: object, key: string | undefined): DuplicationBucket | undefined {
		if (key === undefined) 
			return this.duplicationStruct.unkeyed.get(domain)
		 else 
			return this.duplicationStruct.keyed.get(domain)?.get(key);
		
	}
}
