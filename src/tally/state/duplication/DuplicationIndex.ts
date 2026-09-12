import { getOrInsertComputed } from "../../util/GetOrInsert.js";
import type { AdmissionTransaction } from "./AdmissionTransaction.js";
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

interface DuplicationSnapshot {
	readonly entries: readonly AnyDuplicationEntry[];
	readonly bucketToken: object;
	readonly revision: number;
	readonly domain: object;
	readonly key: string | undefined;
}

export class DuplicationIndex {
	private static readonly EmptyArray = new Array<AnyDuplicationEntry>(0);
	private order = 0;

	private readonly duplicationStruct = {
		unkeyed: new Map<object, DuplicationBucket>(),
		keyed: new Map<object, Map<string, DuplicationBucket>>(),
	} as const;

	reserve<TCandidate extends DuplicationCandidate, TRuntime>(
		domain: object,
		key: string | undefined,
		admission: AdmissionTransaction<TCandidate, TRuntime>
	): DuplicationEntry<TCandidate, TRuntime> {
		const bucket = this.getOrCreateBucket(domain, key);
		const entry: DuplicationEntry<TCandidate, TRuntime> = {
			domain,
			key,
			order: this.order++,
			slot: bucket.entries.length,
			state: {
				kind: "pending",
				admission,
			},
		};
		bucket.entries.push(entry);
		return entry;
	}

	activate<TCandidate extends DuplicationCandidate, TRuntime>(
		entry: DuplicationEntry<TCandidate, TRuntime>,
		runtime: TRuntime
	) {
		// TODO
	}

	unlink(entry: DuplicationEntry<DuplicationCandidate, unknown>) {
		if (entry.slot < 0 || entry.state.kind === "removed") return;
		const bucket = this.getBucket(entry.domain, entry.key);
		if (!bucket) return;
		bucket.entries[entry.slot] = bucket.entries[bucket.entries.length - 1]!;
		bucket.entries[entry.slot]!.slot = entry.slot;
		bucket.entries.pop();
		entry.slot = -1;
		entry.state = { kind: "removed" };
		bucket.revision++;
	}

	size(domain: object, key: string | undefined) {
		return this.view(domain, key).length;
	}

	first(domain: object, key: string | undefined) {
		return this.view(domain, key)[0];
	}

	snapshot(domain: object, key: string | undefined): DuplicationSnapshot {
		const bucket = this.getBucket(domain, key);
		if (!bucket) return { entries: [], bucketToken: {}, revision: -1, domain, key };
		return {
			entries: [...bucket.entries],
			bucketToken: bucket,
			revision: bucket.revision,
			domain,
			key,
		};
	}

	isCurrent(snapshot: DuplicationSnapshot): boolean {
		const bucket = this.getBucket(snapshot.domain, snapshot.key);
		if (!bucket) return false;
		return snapshot.bucketToken === bucket && snapshot.revision === bucket.revision;
	}

	view(domain: object, key: string | undefined): readonly AnyDuplicationEntry[] {
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
}
