import { getOrInsertComputed } from "../../util/GetOrInsert.js";
import type { AdmissionRuntime } from "../AdmissionRuntime.js";
import type { AdmissionTransaction } from "../AdmissionTransaction.js";
import type { DuplicationCandidate } from "./DuplicationCandidate.js";
import type { AnyDuplicationEntry, DuplicationEntry } from "./DuplicationEntry.js";

class DuplicationBucket {
	readonly entries: AnyDuplicationEntry[] = [];
	public revision = 0;

	constructor(
		readonly domain: object,
		readonly key: string | undefined
	) {}
}

export interface DuplicationBasis {
	readonly token: object;
	readonly revision: number;
	readonly domain: object;
	readonly key: string | undefined;
}

export interface DuplicationSnapshot {
	readonly entries: readonly AnyDuplicationEntry[];
	readonly basis: DuplicationBasis;
}

export class DuplicationIndex {
	private static readonly EmptyArray = new Array<AnyDuplicationEntry>(0);
	private order = 0;

	private readonly duplicationStruct = {
		unkeyed: new Map<object, DuplicationBucket>(),
		keyed: new Map<object, Map<string, DuplicationBucket>>(),
	} as const;

	reserve<
		TData,
		TCandidate extends DuplicationCandidate<TData>,
		TRuntime extends AdmissionRuntime<TData>,
	>(
		domain: object,
		key: string | undefined,
		admission: AdmissionTransaction<TData, TCandidate, TRuntime>,
		score: () => number
	): DuplicationEntry<TData, TCandidate, TRuntime> {
		const bucket = this.getOrCreateBucket(domain, key);
		const entry: DuplicationEntry<TData, TCandidate, TRuntime> = {
			domain,
			key,
			order: this.order++,
			slot: bucket.entries.length,
			state: {
				kind: "pending",
				admission,
			},
			score,
		};
		bucket.entries.push(entry);
		bucket.revision++;
		return entry;
	}

	activate<
		TData,
		TCandidate extends DuplicationCandidate<TData>,
		TRuntime extends AdmissionRuntime<TData>,
	>(entry: DuplicationEntry<TData, TCandidate, TRuntime>, runtime: TRuntime) {
		entry.state = {
			kind: "live",
			candidate: runtime.instance as TCandidate,
		};
		const bucket = this.getBucket(entry.domain, entry.key);
		if (bucket) bucket.revision++;
	}

	unlink(entry: AnyDuplicationEntry) {
		if (entry.slot < 0 || entry.state.kind === "removed") return;
		const bucket = this.getBucket(entry.domain, entry.key);
		if (!bucket) return;
		bucket.entries[entry.slot] = bucket.entries[bucket.entries.length - 1]!;
		bucket.entries[entry.slot]!.slot = entry.slot;
		bucket.entries.pop();
		entry.slot = -1;
		entry.state = { kind: "removed" };
		bucket.revision++;
		if (bucket.entries.length === 0) this.deleteBucket(bucket);
	}

	size(domain: object, key: string | undefined) {
		return this.borrowedView(domain, key).length;
	}

	first(domain: object, key: string | undefined) {
		return this.borrowedView(domain, key)[0];
	}

	snapshot(domain: object, key: string | undefined): DuplicationSnapshot {
		const bucket = this.getBucket(domain, key);
		if (!bucket) return { entries: [], basis: this.basis(domain, key) };
		return {
			entries: [...bucket.entries],
			basis: this.basis(domain, key),
		};
	}

	basis(domain: object, key: string | undefined): DuplicationBasis {
		const bucket = this.getBucket(domain, key);
		if (!bucket) return { token: {}, revision: -1, domain, key };
		return {
			token: bucket,
			revision: bucket.revision,
			domain,
			key,
		};
	}

	isCurrent(basis: DuplicationBasis): boolean {
		const bucket = this.getBucket(basis.domain, basis.key);
		if (!bucket) return false;
		return basis.token === bucket && basis.revision === bucket.revision;
	}

	borrowedView(domain: object, key: string | undefined): readonly AnyDuplicationEntry[] {
		return this.getBucket(domain, key)?.entries ?? DuplicationIndex.EmptyArray;
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
		if (key === undefined) return this.duplicationStruct.unkeyed.get(domain);
		else return this.duplicationStruct.keyed.get(domain)?.get(key);
	}

	private deleteBucket(bucket: DuplicationBucket) {
		if (bucket.key === undefined) {
			this.duplicationStruct.unkeyed.delete(bucket.domain);
			return;
		}

		const keyedDomain = this.duplicationStruct.keyed.get(bucket.domain);
		if (!keyedDomain) return;
		keyedDomain.delete(bucket.key);
		if (keyedDomain.size === 0) this.duplicationStruct.keyed.delete(bucket.domain);
	}
}
