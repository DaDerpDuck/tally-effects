import type { Disconnect } from "../../util/Disconnect.js";
import { getOrInsertComputed } from "../../util/GetOrInsert.js";
import type { PlannedInstance } from "../PlannedInstance.js";
import type { DuplicationCandidate } from "./DuplicationCandidate.js";

export type PlannedDuplicationEntry<TInstance extends DuplicationCandidate> = {
	readonly kind: "pending";
	readonly plannedCandidate: PlannedInstance<TInstance>;
	readonly candidate: TInstance;
	readonly order: number;
	active: boolean;
	readonly score: () => number;
	readonly evict: () => void;
	readonly commit: () => LiveDuplicationEntry<TInstance> | undefined;
};

export type LiveDuplicationEntry<TInstance extends DuplicationCandidate> = {
	readonly kind: "live";
	readonly candidate: TInstance;
	readonly order: number;
	active: boolean;
	readonly score: () => number;
	readonly evict: () => void;
	readonly publish: () => void;
};

export type DuplicationEntry<TInstance extends DuplicationCandidate = DuplicationCandidate> =
	PlannedDuplicationEntry<TInstance> | LiveDuplicationEntry<TInstance>;

interface DuplicationBucket {
	readonly entries: DuplicationEntry[];
	shrink(): void;
}

export class DuplicationIndex {
	private static readonly EmptyArray = new Array<DuplicationEntry>(0);
	private order = 0;

	private readonly duplicationStruct = {
		unkeyed: new Map<object, DuplicationEntry[]>(),
		keyed: new Map<object, Map<string, DuplicationEntry[]>>(),
	} as const;

	get(domain: object, key: string | undefined): readonly DuplicationEntry[] {
		if (key === undefined)
			return this.duplicationStruct.unkeyed.get(domain) ?? DuplicationIndex.EmptyArray;
		else
			return (
				this.duplicationStruct.keyed.get(domain)?.get(key) ?? DuplicationIndex.EmptyArray
			);
	}

	plan<TInstance extends DuplicationCandidate>(
		domain: object,
		key: string | undefined,
		plannedInstance: PlannedInstance<TInstance>,
		score?: () => number
	): PlannedDuplicationEntry<TInstance> {
		const bucket = this.getOrCreateBucket(domain, key);

		const plannedEntry: PlannedDuplicationEntry<TInstance> = {
			kind: "pending",
			plannedCandidate: plannedInstance,
			candidate: plannedInstance.get(),
			order: this.order++,
			active: true,
			score: score ?? (() => plannedEntry.order),
			commit() {
				if (!plannedEntry.active) return;
				plannedEntry.active = false;
				const index = bucket.entries.findIndex((e) => e === plannedEntry);
				if (index < 0) return;
				const liveCandidate = plannedEntry.plannedCandidate.commit();
				if (!liveCandidate) return; // publish rejected for whatever reason
				const liveEntry: LiveDuplicationEntry<TInstance> = {
					kind: "live",
					candidate: liveCandidate,
					order: plannedEntry.order,
					active: true,
					score: plannedEntry.score,
					evict() {
						if (!liveEntry.active) return;
						liveEntry.active = false;
						const index = bucket.entries.findIndex((e) => e === liveEntry);
						if (index < 0) return;
						bucket.entries[index] = bucket.entries[bucket.entries.length - 1]!;
						bucket.entries.pop();
						bucket.shrink();
						liveEntry.candidate.destroy();
					},
					publish() {
						plannedEntry.plannedCandidate.publish(liveEntry.candidate);
					},
				};
				bucket.entries[index] = liveEntry;
				return liveEntry;
			},
			evict() {
				if (!plannedEntry.active) return;
				plannedEntry.active = false;
				const index = bucket.entries.findIndex((e) => e === plannedEntry);
				if (index < 0) return;
				bucket.entries[index] = bucket.entries[bucket.entries.length - 1]!;
				bucket.entries.pop();
				bucket.shrink();
				plannedEntry.plannedCandidate.cancel();
			},
		};

		bucket.entries.push(plannedEntry);
		return plannedEntry;
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
