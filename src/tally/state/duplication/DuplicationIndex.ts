import type { Disconnect } from "../../util/Disconnect.js";
import { getOrInsert } from "../../util/GetOrInsert.js";
import type { DuplicationCandidate } from "./DuplicationCandidate.js";

const UnspecifiedKey = Symbol("UnspecifiedKey");

export interface DuplicationEntry {
	readonly candidate: DuplicationCandidate;
	readonly order: number;
	readonly score: () => number;
	readonly replaceIf: (existingRank: number, incomingRank: number) => boolean;
}

export class DuplicationIndex {
	private readonly duplicationMap = new Map<
		object,
		Map<string | typeof UnspecifiedKey, Set<DuplicationEntry>>
	>();

	get(domain: object, key: string | undefined): readonly DuplicationEntry[] {
		return (
			this.duplicationMap
				.get(domain)
				?.get(key ?? UnspecifiedKey)
				?.values()
				.toArray() ?? []
		);
	}

	add(domain: object, key: string | undefined, entry: DuplicationEntry): Disconnect {
		const keyBucket = getOrInsert(
			this.duplicationMap,
			domain,
			new Map<unknown, Set<DuplicationEntry>>()
		);
		const entries = getOrInsert(keyBucket, key ?? UnspecifiedKey, new Set());
		entries.add(entry);

		return () => {
			entries.delete(entry);
			if (entries.size === 0) keyBucket.delete(key ?? UnspecifiedKey);
			if (keyBucket.size === 0) this.duplicationMap.delete(domain);
		};
	}
}
